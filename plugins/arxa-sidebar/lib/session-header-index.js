// Session header index (2026-09-07 boot trace). dsh's JSONL persistence
// rebuilds the session list from disk on every call: per saved session it
// opens the compressed log and decodes its first Zstandard frame to read the
// header line, serially. 55 sessions cost 400-800ms and the client will not
// open ANY session until that list lands, so it sat on the boot critical path.
//
// A header line never changes without the file changing, so this caches
// `readFirstZstdLine(path)` by (size, mtimeMs) and persists the cache beside
// dsh's own storages. The original method still runs for new or changed logs
// and for anything odd (missing file, undefined line, errors), so dsh's parse,
// identity and duplicate checks are untouched — only the frame decode is
// skipped. Wrapping the narrowest seam keeps every dsh semantic in dsh.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const FLUSH_DELAY_MS = 500

/**
 * Wrap a JsonlSessionPersistence instance's first-line reader with a
 * size+mtime keyed cache persisted at `file` (default: <dsh home>/storages/
 * arxa-session-header-index.json, derived from the persistence root).
 * @returns {{ stats(): {hits:number,misses:number,size:number}, flush(): void, path: string } | null}
 */
export function armHeaderIndex(persistence, { file, log = () => {} } = {}) {
  if (!persistence || typeof persistence.readFirstZstdLine !== 'function' || typeof persistence.root !== 'string') return null
  const path = file ?? join(dirname(persistence.root), 'storages', 'arxa-session-header-index.json')
  let entries = {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed && parsed.v === 1 && parsed.entries && typeof parsed.entries === 'object') entries = parsed.entries
  } catch { entries = {} }
  const orig = persistence.readFirstZstdLine.bind(persistence)
  let hits = 0
  let misses = 0
  let dirty = false
  let timer = null
  const flush = () => {
    timer = null
    if (!dirty) return
    dirty = false
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path + '.tmp', JSON.stringify({ v: 1, entries }))
      renameSync(path + '.tmp', path)
    } catch (e) { log('header index flush failed: ' + (e?.message ?? e)) }
  }
  const scheduleFlush = () => {
    dirty = true
    if (timer) return
    timer = setTimeout(flush, FLUSH_DELAY_MS)
    timer.unref?.()
  }
  // ponytail: entries for deleted logs linger (a few hundred bytes each);
  // prune on flush if the file ever matters.
  persistence.readFirstZstdLine = async (logPath, signal) => {
    let st
    try { st = await stat(logPath) } catch { return orig(logPath, signal) }
    const hit = entries[logPath]
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs && typeof hit.line === 'string') { hits++; return hit.line }
    const line = await orig(logPath, signal)
    misses++
    if (typeof line === 'string') {
      entries[logPath] = { size: st.size, mtimeMs: st.mtimeMs, line }
      scheduleFlush()
    }
    return line
  }
  log('header index armed: ' + Object.keys(entries).length + ' cached at ' + path)
  return { stats: () => ({ hits, misses, size: Object.keys(entries).length }), flush, path }
}
