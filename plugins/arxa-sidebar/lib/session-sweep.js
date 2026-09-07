// Org purge leaves dsh session logs behind (2026-09-07 audit): every
// session whose cwd was inside the purged org keeps a project dir under
// dsh's persistence root and reappears in the session list forever (the
// "30 orphan sessions" of the startup work). This walks the persistence
// with its own helpers and removes the session dirs whose header cwd sits
// under the purged path. Nothing else is touched; a header that cannot be
// read is kept (doubt keeps the row).
import { rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

/**
 * @param persistence JsonlSessionPersistence-shaped (root, compression, listProjectDirs, listSessionDirs, readFirstZstdLine)
 * @param orgPath absolute path of the purged org
 * @returns {Promise<{ removed: string[], kept: number, skipped?: string }>}
 */
export async function sweepSessionsUnder(persistence, orgPath, { log = () => {} } = {}) {
  const p = persistence
  if (!p || typeof p.listProjectDirs !== 'function' || typeof p.listSessionDirs !== 'function' || typeof p.readFirstZstdLine !== 'function') {
    return { removed: [], kept: 0, skipped: 'persistence-unavailable' }
  }
  const base = resolve(orgPath)
  const inside = (cwd) => typeof cwd === 'string' && (resolve(cwd) === base || resolve(cwd).startsWith(base + sep))
  const suffix = p.compression === 'zstd' ? '.jsonl.zstd' : '.jsonl'
  const removed = []
  let kept = 0
  const projects = await p.listProjectDirs()
  for (const project of projects) {
    for (const dir of await p.listSessionDirs(project)) {
      let header = null
      try { header = JSON.parse((await p.readFirstZstdLine(join(dir, 'session' + suffix))) || 'null') } catch { header = null }
      if (header && inside(header.cwd)) {
        await rm(dir, { recursive: true, force: true })
        removed.push(header.id ?? dir)
      } else {
        kept++
      }
    }
    // An emptied project dir is just clutter; dsh lists projects by their sessions.
    try { if ((await p.listSessionDirs(project)).length === 0) await rm(project, { recursive: true, force: true }) } catch { /* leave it */ }
  }
  log('session sweep under ' + base + ': removed ' + removed.length + ', kept ' + kept)
  return { removed, kept }
}
