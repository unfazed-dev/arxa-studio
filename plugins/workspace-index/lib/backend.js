/**
 * Storage-backend seam for the workspace index (Phase 2, D46).
 *
 * THE INDEX IS A PURE DERIVED CACHE. The file tree is the single source of
 * truth; deleting everything this backend stores and rebuilding from the tree
 * must lose nothing (enforced by selftest.mjs). Nothing here may ever hold
 * data that does not also live on disk.
 *
 * The interface below (open/put/query/clear/close) is the seam that D32
 * "bring your own database" plugs into later: a user-provided backend (e.g.
 * their own Supabase/Postgres) implements this same five-method contract and
 * is swapped in at openBackend(). Per the ownership boundary in CLAUDE.md,
 * no arxa studio feature may require the Arxa Digital Solutions database —
 * so the shipped implementation is strictly local (node:sqlite, no native
 * npm deps, no network). Do NOT build the BYO side here; only keep the seam
 * clean.
 *
 * Backend contract:
 *   put(tbl, id, obj)  — upsert one JSON row under (tbl, id)
 *   query(tbl)         — all rows of tbl, parsed, ordered by id ascending
 *   clear()            — drop all rows (format stamp survives)
 *   close()            — release resources
 *
 * A format-version stamp is kept in the store. On open, a mismatch clears
 * the store: cache-shape changes are handled by rebuild, never by migration
 * (legal because the cache is derived — see D46).
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** Bump when the cached row shape changes; mismatch triggers clear-on-open. */
export const FORMAT_VERSION = 1

/** Directory (under the workspace root) that holds the index store. */
export const INDEX_DIR = '.arxa'
export const INDEX_FILE = 'index.db'

class SqliteBackend {
  constructor(root) {
    const dir = join(root, INDEX_DIR)
    mkdirSync(dir, { recursive: true })
    this.path = join(dir, INDEX_FILE)
    this.db = new DatabaseSync(this.path)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rows (
        tbl  TEXT NOT NULL,
        id   TEXT NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (tbl, id)
      );
    `)
    const row = this.db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('format_version')
    if (!row || Number(row.value) !== FORMAT_VERSION) {
      // Derived cache: a shape change means rebuild, never migrate.
      this.clear()
      this.db
        .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
        .run('format_version', String(FORMAT_VERSION))
    }
  }

  put(tbl, id, obj) {
    this.db
      .prepare('INSERT OR REPLACE INTO rows (tbl, id, json) VALUES (?, ?, ?)')
      .run(tbl, id, JSON.stringify(obj))
  }

  query(tbl) {
    return this.db
      .prepare('SELECT json FROM rows WHERE tbl = ? ORDER BY id ASC')
      .all(tbl)
      .map((r) => JSON.parse(r.json))
  }

  clear() {
    this.db.exec('DELETE FROM rows')
  }

  close() {
    this.db.close()
  }
}

/**
 * Open the local storage backend for a workspace root.
 * This is the ONLY place a D32 BYO backend would be selected later.
 */
export function openBackend(root) {
  return new SqliteBackend(root)
}
