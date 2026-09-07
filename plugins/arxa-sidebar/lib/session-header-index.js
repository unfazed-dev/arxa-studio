// Session list cache for dsh's JSONL persistence (2026-09-07 boot traces).
//
// dsh rebuilds the session list from disk on every call: per saved session it
// checks two paths, opens the compressed log, decodes its first Zstandard
// frame for the header line and verifies identity — serially, ~4 awaits per
// session. The client will not open ANY session until that list lands, so it
// sat on the boot critical path: 0.8–1.4s for 55 sessions while the host was
// also serving the page, 400ms idle.
//
// Two layers, narrowest seams first:
//  1. Header index — `readFirstZstdLine(path)` cached by (size, mtimeMs). A
//     header line never changes without the file changing. Saves the decode;
//     measured alone it was NOT the cost (second trace: all hits, still 1.4s).
//  2. List cache — `list()` served from the previous answer while the SET of
//     present logs is unchanged, decided by one parallel scan (readdir +
//     access, three event-loop turns). A header cannot change without its log
//     path changing (the id is in the path), so the answer stays exact.
//     New/removed logs → dsh's own list runs, then the cache refreshes.
//     Skipped on a hit: dsh's identity/duplicate/encoding checks — they
//     passed when the answer was cached and nothing they check has changed.
// Both persist beside dsh's own storages so the first boot list is a hit.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const FLUSH_DELAY_MS = 500

/**
 * Wrap a JsonlSessionPersistence instance. Returns null when the object is
 * not persistence-shaped (nothing wrapped).
 * @returns {{ stats(): object, flush(): void, path: string } | null}
 */
export function armHeaderIndex(persistence, { file, log = () => {} } = {}) {
  if (!persistence || typeof persistence.readFirstZstdLine !== 'function' || typeof persistence.root !== 'string') return null
  const path = file ?? join(dirname(persistence.root), 'storages', 'arxa-session-header-index.json')
  let entries = {}
  let listCache = null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed && parsed.v === 1) {
      if (parsed.entries && typeof parsed.entries === 'object') entries = parsed.entries
      if (parsed.list && typeof parsed.list.fp === 'string' && Array.isArray(parsed.list.headers)) listCache = parsed.list
    }
  } catch { entries = {}; listCache = null }

  let hits = 0
  let misses = 0
  let listHits = 0
  let listMisses = 0
  let dirty = false
  let timer = null
  const flush = () => {
    timer = null
    if (!dirty) return
    dirty = false
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path + '.tmp', JSON.stringify({ v: 1, entries, ...(listCache ? { list: listCache } : {}) }))
      renameSync(path + '.tmp', path)
    } catch (e) { log('header index flush failed: ' + (e?.message ?? e)) }
  }
  const scheduleFlush = () => {
    dirty = true
    if (timer) return
    timer = setTimeout(flush, FLUSH_DELAY_MS)
    timer.unref?.()
  }

  // Layer 1 — header index.
  // ponytail: entries for deleted logs linger (a few hundred bytes each);
  // prune on flush if the file ever matters.
  const origFirstLine = persistence.readFirstZstdLine.bind(persistence)
  persistence.readFirstZstdLine = async (logPath, signal) => {
    let st
    try { st = await stat(logPath) } catch { return origFirstLine(logPath, signal) }
    const hit = entries[logPath]
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs && typeof hit.line === 'string') { hits++; return hit.line }
    const line = await origFirstLine(logPath, signal)
    misses++
    if (typeof line === 'string') {
      entries[logPath] = { size: st.size, mtimeMs: st.mtimeMs, line }
      scheduleFlush()
    }
    return line
  }

  // Layer 2 — list cache.
  const canScan = typeof persistence.listProjectDirs === 'function' && typeof persistence.listSessionDirs === 'function' && typeof persistence.list === 'function'
  if (canScan) {
    const suffix = () => (persistence.compression === 'zstd' ? '.jsonl.zstd' : '.jsonl')
    const fingerprint = async (signal) => {
      const projects = await persistence.listProjectDirs(signal)
      const dirs = (await Promise.all(projects.map((p) => persistence.listSessionDirs(p, signal)))).flat()
      const present = await Promise.all(dirs.map(async (d) => {
        const p = join(d, 'session' + suffix())
        try { await access(p); return p } catch { return null }
      }))
      return present.filter(Boolean).sort().join('\n')
    }
    const origList = persistence.list.bind(persistence)
    persistence.list = async (signal) => {
      const fp = await fingerprint(signal)
      if (listCache && listCache.fp === fp) { listHits++; return structuredClone(listCache.headers) }
      const headers = await origList(signal)
      listCache = { fp, headers: structuredClone(headers) }
      listMisses++
      scheduleFlush()
      return headers
    }
  }

  log('header index armed: ' + Object.keys(entries).length + ' headers, list ' + (listCache ? 'cached' : 'cold') + (canScan ? '' : ' (scan unavailable)') + ' at ' + path)
  return {
    stats: () => ({ hits, misses, size: Object.keys(entries).length, listHits, listMisses }),
    flush,
    path,
  }
}
