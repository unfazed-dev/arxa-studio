// Org purge leaves dsh session logs behind (2026-09-07 audit): every
// session whose cwd was inside the purged org keeps a project dir under
// dsh's persistence root and reappears in the session list forever (the
// "30 orphan sessions" of the startup work). This walks the persistence
// with its own helpers and removes the session dirs whose header cwd sits
// under the purged path. Nothing else is touched; a header that cannot be
// read is kept (doubt keeps the row).
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
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

/**
 * Remove sessions whose header cwd sits under an OS temp root AND no longer
 * exists. Sessions with a missing cwd elsewhere are reported as `stranded`,
 * never removed: an unmounted volume is indistinguishable from a deletion.
 * @returns {Promise<{ removed: string[], kept: number, stranded: string[], skipped?: string }>}
 */
export async function sweepDeadTmpSessions(persistence, { tmpRoots, log = () => {} } = {}) {
  const p = persistence
  if (!p || typeof p.listProjectDirs !== 'function' || typeof p.listSessionDirs !== 'function' || typeof p.readFirstZstdLine !== 'function') {
    return { removed: [], kept: 0, stranded: [], skipped: 'persistence-unavailable' }
  }
  // Both spellings of each root: a vanished cwd cannot be realpath'd, so the
  // raw form must match too (macOS: /var → /private/var, /tmp → /private/tmp).
  const roots = [...new Set((tmpRoots ?? [tmpdir(), '/tmp', '/private/tmp']).flatMap((r) => {
    const raw = resolve(r)
    try { return [raw, realpathSync(raw)] } catch { return [raw] }
  }))]
  const underTmp = (cwd) => {
    const c = resolve(cwd)
    return roots.some((r) => c === r || c.startsWith(r + sep))
  }
  const suffix = p.compression === 'zstd' ? '.jsonl.zstd' : '.jsonl'
  const removed = []
  const stranded = []
  let kept = 0
  for (const project of await p.listProjectDirs()) {
    for (const dir of await p.listSessionDirs(project)) {
      let header = null
      try { header = JSON.parse((await p.readFirstZstdLine(join(dir, 'session' + suffix))) || 'null') } catch { header = null }
      const cwd = header && typeof header.cwd === 'string' ? header.cwd : null
      if (cwd && !existsSync(cwd)) {
        if (underTmp(cwd)) { await rm(dir, { recursive: true, force: true }); removed.push(header.id ?? dir); continue }
        stranded.push(cwd)
      }
      kept++
    }
    try { if ((await p.listSessionDirs(project)).length === 0) await rm(project, { recursive: true, force: true }) } catch { /* leave it */ }
  }
  log('dead-tmp session sweep: removed ' + removed.length + ', kept ' + kept + ', stranded ' + stranded.length)
  return { removed, kept, stranded: [...new Set(stranded)] }
}

/** Ledger of purged org paths: `~/.arxa/purged-orgs.json`, a string array. */
export function purgedOrgsLedgerPath() {
  return join(homedir(), '.arxa', 'purged-orgs.json')
}
/** True when `p` is a directory tree holding no regular files at all. */
function isEmptyTree(p) {
  try {
    if (!statSync(p).isDirectory()) return false
    for (const e of readdirSync(p, { withFileTypes: true })) {
      if (!e.isDirectory() || !isEmptyTree(join(p, e.name))) return false
    }
    return true
  } catch { return false }
}
function readLedger(file) {
  try { const v = JSON.parse(readFileSync(file, 'utf8')); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [] } catch { return [] }
}
function writeLedger(file, list) {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify(list, null, 2) + '\n')
}
export function rememberPurgedOrg(orgPath, { file = purgedOrgsLedgerPath() } = {}) {
  const list = readLedger(file)
  const p = resolve(orgPath)
  if (!list.includes(p)) writeLedger(file, [...list, p])
}

/**
 * Sweep sessions under every ledgered path that is still gone; a path that
 * exists again (org re-created there) leaves the ledger untouched by us.
 * @returns {Promise<{ swept: Record<string, number>, forgotten: string[] }>}
 */
export async function sweepPurgedOrgs(persistence, { file = purgedOrgsLedgerPath(), registry = null, log = () => {} } = {}) {
  const list = readLedger(file)
  const swept = {}
  const forgotten = []
  const keep = []
  for (const p of list) {
    if (existsSync(p)) {
      // dsh's session controller mkdir -p's a session cwd on open, so a page
      // still pointing at a purged org rebuilds an EMPTY folder skeleton at
      // every boot. A skeleton with no files is still the purged org: remove
      // it and keep sweeping. Anything with a file in it is a real re-create.
      if (!isEmptyTree(p)) { forgotten.push(p); continue }
      await rm(p, { recursive: true, force: true })
    }
    keep.push(p)
    const r = await sweepSessionsUnder(persistence, p)
    const w = await sweepWorkspacesUnder(registry, p)
    if (r.removed.length + w.removed.length > 0) swept[p] = r.removed.length + w.removed.length
  }
  if (forgotten.length > 0) writeLedger(file, keep)
  if (Object.keys(swept).length > 0 || forgotten.length > 0) log('purged-org sweep: ' + JSON.stringify({ swept, forgotten }))
  return { swept, forgotten }
}

/**
 * Delete dsh workspace records whose path sits under `orgPath`, through the
 * registry service itself (never the store file). Without this the page's
 * current workspace keeps pointing at the purged org and dsh's session
 * controller mkdir -p's the dead cwd back at every boot.
 * @param registry dsh workspaceRegistry ({ list(), delete(id) }) or null
 * @returns {Promise<{ removed: string[], skipped?: string }>}
 */
export async function sweepWorkspacesUnder(registry, orgPath) {
  if (!registry || typeof registry.list !== 'function' || typeof registry.delete !== 'function') return { removed: [], skipped: 'registry-unavailable' }
  const base = resolve(orgPath)
  const inside = (p) => typeof p === 'string' && (resolve(p) === base || resolve(p).startsWith(base + sep))
  const removed = []
  let rows
  try { rows = await registry.list() } catch { return { removed, skipped: 'list-failed' } }
  for (const w of Array.isArray(rows) ? rows : []) {
    const p = w?.path ?? w?.record?.path
    const id = w?.id
    if (!inside(p) || typeof id !== 'string') continue
    try { if (await registry.delete(id)) removed.push(id) } catch { /* a record that will not go stays reported by the next sweep */ }
  }
  return { removed }
}
