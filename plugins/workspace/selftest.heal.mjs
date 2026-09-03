#!/usr/bin/env node
/**
 * Workspace store heal selftest.
 *
 * The ORACLE here is dsh's OWN `validateStoredState`, loaded by absolute file
 * URL (the package's `exports` map blocks the bare subpath, but a direct path
 * import bypasses specifier resolution). That matters: a hand-rolled copy of
 * the validator in this file would pass whenever the heal and the copy shared
 * a misunderstanding. Borrowing dsh's function means "healed" is judged by the
 * exact code that refuses to boot.
 *
 * Every case below is a clause of that validator, plus the real shape that
 * took the engine down on 2026-09-03 (a legacy bare-leaf id claimed by two
 * workspaces).
 *
 * Exit 0 = every assertion held.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const { healWorkspaceStore } = await import(path.join(here, 'lib', 'store-heal.js'))

const dshValidator = path.join(
  repoRoot, 'node_modules', '@deepseek-ai', 'dsh-workspace', 'lib', 'types', 'index.js',
)
const { WorkspaceRegistry } = await import(dshValidator)
const validateLikeDsh = (store) =>
  WorkspaceRegistry.prototype.validateStoredState.call(
    { requireTable: () => new Map(Object.entries(store.tables.workspaces)) },
    store.global,
  )

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}
/** dsh's validator throws on a bad store; this turns that into a boolean. */
const boots = (store) => { try { validateLikeDsh(store); return true } catch { return false } }

const mk = (workspaces, ids, initialized = true) => ({
  unit: { name: 'workspace', version: 2 },
  global: { initialized, workspaceIds: ids ?? Object.keys(workspaces), archivedSessionIds: [] },
  tables: { workspaces },
})
// Only `/live` exists on disk in these tests; `/gone` never does.
const exists = (p) => String(p).startsWith('/live')

// ---- 1. the real incident (H4): one legacy id, two workspaces -------------
// `arxa-note-wt-260903-001` is a BARE LEAF from the retired nextSessionId
// mint. The org-led scheme cannot produce it, so no write-path guard would
// ever have prevented this store from existing.
const incident = mk({
  'ws-gone': { path: '/gone/RESTO', sessionIds: ['arxa-note-wt-260903-001'] },
  'ws-live': { path: '/live/TESTO', sessionIds: ['arxa-note-wt-260903-001', 'arxa-x-1'] },
})
check('incident: the un-healed store is exactly what dsh refuses to boot', !boots(incident))
const healed = healWorkspaceStore(incident, { exists })
check('incident: the healed store boots under dsh\'s own validator', boots(healed.store),
  JSON.stringify(healed.changes))
check('incident: the claim is kept by the workspace whose path still EXISTS',
  healed.store.tables.workspaces['ws-live'].sessionIds.includes('arxa-note-wt-260903-001')
  && !healed.store.tables.workspaces['ws-gone'].sessionIds.includes('arxa-note-wt-260903-001'))
check('incident: the workspace record itself is never deleted, only the duplicate claim',
  Object.keys(healed.store.tables.workspaces).length === 2)
check('incident: the input store is not mutated', incident.tables.workspaces['ws-gone'].sessionIds.length === 1)
check('incident: the repair is reported, not silent', healed.changes.length > 0)

// ---- 2. one case per remaining validator clause ---------------------------
const dupOrder = mk({ a: { path: '/live/a', sessionIds: [] } }, ['a', 'a'])
check('workspaceIds repeating an id is refused by dsh, and healed', !boots(dupOrder) && boots(healWorkspaceStore(dupOrder, { exists }).store))

const ghostId = mk({ a: { path: '/live/a', sessionIds: [] } }, ['a', 'ghost'])
check('workspaceIds naming a missing workspace is refused, and healed', !boots(ghostId) && boots(healWorkspaceStore(ghostId, { exists }).store))

const orphan = mk({ a: { path: '/live/a', sessionIds: [] }, b: { path: '/live/b', sessionIds: [] } }, ['a'])
check('a table row absent from workspaceIds is refused, and healed', !boots(orphan) && boots(healWorkspaceStore(orphan, { exists }).store))

const dupPath = mk({
  a: { path: '/live/same', sessionIds: ['s1'] },
  b: { path: '/live/same', sessionIds: ['s2', 's3'] },
})
const dupPathHealed = healWorkspaceStore(dupPath, { exists })
check('two workspaces claiming one path is refused, and healed', !boots(dupPath) && boots(dupPathHealed.store))
check('duplicate path: the record holding MORE sessions survives',
  dupPathHealed.store.tables.workspaces.b !== undefined && dupPathHealed.store.tables.workspaces.a === undefined)

// ---- 3. a session claimed three times, none of the paths alive ------------
// The tie-break must still terminate and still leave exactly one claim.
const triple = mk({
  x: { path: '/gone/x', sessionIds: ['dup'] },
  y: { path: '/gone/y', sessionIds: ['dup'] },
  z: { path: '/gone/z', sessionIds: ['dup'] },
}, ['x', 'y', 'z'])
const tripleHealed = healWorkspaceStore(triple, { exists })
check('a triple claim with no live path still heals to exactly one holder',
  boots(tripleHealed.store)
  && Object.values(tripleHealed.store.tables.workspaces).filter((w) => w.sessionIds.includes('dup')).length === 1)
check('triple claim: the tie-break keeps the EARLIEST in workspaceIds order',
  tripleHealed.store.tables.workspaces.x.sessionIds.includes('dup'))

// ---- 4. a healthy store must come back untouched ---------------------------
// A heal that rewrites a good store would churn the user's file on every boot.
const clean = mk({
  a: { path: '/live/a', sessionIds: ['s1', 's2'] },
  b: { path: '/live/b', sessionIds: ['s3'] },
})
const cleanHealed = healWorkspaceStore(clean, { exists })
check('a healthy store is reported as unchanged', boots(clean) && cleanHealed.changes.length === 0)
check('a healthy store is returned byte-identical', JSON.stringify(cleanHealed.store) === JSON.stringify(clean))

// ---- 5. heal is idempotent -------------------------------------------------
const twice = healWorkspaceStore(healed.store, { exists })
check('healing an already-healed store changes nothing', twice.changes.length === 0)

// ---- 6. the live store on this machine, if present -------------------------
// Read-only: proves the heal survives real data shapes, never writes.
const { readFileSync, existsSync } = await import('node:fs')
const liveStore = path.join(process.env.HOME ?? '', '.arxa', 'dsh', 'storages', 'workspace.json')
if (existsSync(liveStore)) {
  const real = JSON.parse(readFileSync(liveStore, 'utf8'))
  const realHealed = healWorkspaceStore(real)
  check('the real store on this machine heals to a bootable state', boots(realHealed.store),
    JSON.stringify(realHealed.changes).slice(0, 300))
} else {
  console.log('SKIP  no live workspace store on this machine')
}

console.log(failures === 0 ? '\nworkspace store-heal selftest: ALL GREEN' : `\nworkspace store-heal selftest: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
