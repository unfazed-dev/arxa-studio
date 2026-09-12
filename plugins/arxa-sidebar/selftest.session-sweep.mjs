// Selftest: org purge session sweep removes only sessions whose cwd is under
// the purged org; unreadable headers and outside cwds are kept.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
import { sweepSessionsUnder, sweepDeadTmpSessions, rememberPurgedOrg, sweepPurgedOrgs, sweepWorkspacesUnder, quiesceSessionsUnder } from './lib/session-sweep.js'

const dir = mkdtempSync(join(tmpdir(), 'arxa-sweep-'))
const root = join(dir, 'sessions')
const mk = (project, id, header) => {
  const d = join(root, project, id); mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'session.jsonl.zstd'), header === null ? '' : JSON.stringify(header))
  return d
}
try {
  const a = mk('p-resto', 'a', { id: 'a', cwd: '/vol/RESTO/.arxa/worktrees/x' })
  const b = mk('p-resto', 'b', { id: 'b', cwd: '/vol/RESTO' })
  const c = mk('p-other', 'c', { id: 'c', cwd: '/vol/RESTOX/notes' }) // prefix trap
  const d = mk('p-other', 'd', { id: 'd', cwd: '/vol/TOPO' })
  const e = mk('p-bad', 'e', null) // unreadable header → kept
  const fake = {
    root, compression: 'zstd',
    async listProjectDirs() { return readdirSync(root, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => join(root, x.name)) },
    async listSessionDirs(p) { return readdirSync(p, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => join(p, x.name)) },
    async readFirstZstdLine(p) { const s = require('node:fs').readFileSync(p, 'utf8'); return s === '' ? undefined : s },
  }
  const r = await sweepSessionsUnder(fake, '/vol/RESTO')
  assert.deepEqual(r.removed.sort(), ['a', 'b'])
  assert.equal(r.kept, 3)
  assert.ok(!existsSync(a) && !existsSync(b), 'inside sessions removed')
  assert.ok(existsSync(c) && existsSync(d) && existsSync(e), 'outside / prefix-trap / unreadable kept')
  assert.ok(!existsSync(join(root, 'p-resto')), 'emptied project dir removed')
  assert.deepEqual(await sweepSessionsUnder(null, '/vol/RESTO'), { removed: [], kept: 0, skipped: 'persistence-unavailable' })

  // Dead-tmp sweep: a missing cwd under a temp root is removed; a missing cwd
  // elsewhere is reported as stranded and kept; an existing tmp cwd is kept.
  const tmpRoot = join(dir, 'fake-tmp'); mkdirSync(join(tmpRoot, 'alive'), { recursive: true })
  const t1 = mk('p-tmp', 't1', { id: 't1', cwd: join(tmpRoot, 'gone', 'ws') })
  const t2 = mk('p-tmp', 't2', { id: 't2', cwd: join(tmpRoot, 'alive') })
  const t3 = mk('p-vol', 't3', { id: 't3', cwd: '/Volumes/unmounted-drive/org' })
  const r2 = await sweepDeadTmpSessions(fake, { tmpRoots: [tmpRoot] })
  assert.deepEqual(r2.removed, ['t1'])
  assert.ok(r2.stranded.includes('/Volumes/unmounted-drive/org') && !r2.stranded.some((c) => c.startsWith(tmpRoot)), 'missing cwd outside tmp is reported, never removed')
  assert.ok(!existsSync(t1) && existsSync(t2) && existsSync(t3), 'only the dead tmp session is removed')

  // Purged-org ledger: a dead path is swept at every boot; a path that exists
  // again is dropped from the ledger.
  const ledger = join(dir, 'purged-orgs.json')
  const gone = join(dir, 'GONE-ORG'); const back = join(dir, 'BACK-ORG'); mkdirSync(back); writeFileSync(join(back, 'org.json'), '{}') // a real re-create has files
  rememberPurgedOrg(gone, { file: ledger }); rememberPurgedOrg(back, { file: ledger }); rememberPurgedOrg(gone, { file: ledger })
  assert.deepEqual(JSON.parse(readFileSync(ledger, 'utf8')), [gone, back], 'ledger dedupes')
  const g1 = mk('p-gone', 'g1', { id: 'g1', cwd: join(gone, '.arxa', 'worktrees', 'x') })
  const b1 = mk('p-back', 'b1', { id: 'b1', cwd: back })
  const r3 = await sweepPurgedOrgs(fake, { file: ledger })
  assert.deepEqual(r3, { swept: { [gone]: 1 }, forgotten: [back] })
  assert.ok(!existsSync(g1) && existsSync(b1), 'dead-path session swept, re-created path kept')
  assert.deepEqual(JSON.parse(readFileSync(ledger, 'utf8')), [gone], 'existing path left the ledger')
  // An empty skeleton at a purged path (dsh mkdir -p of a dead cwd) is still
  // dead: removed, swept, and kept in the ledger.
  mkdirSync(join(gone, '.arxa', 'worktrees', 'x'), { recursive: true })
  const g2 = mk('p-gone', 'g2', { id: 'g2', cwd: join(gone, '.arxa', 'worktrees', 'x') })
  const r4 = await sweepPurgedOrgs(fake, { file: ledger })
  assert.deepEqual(r4, { swept: { [gone]: 1 }, forgotten: [] })
  assert.ok(!existsSync(gone) && !existsSync(g2), 'skeleton and its session removed')
  assert.deepEqual(JSON.parse(readFileSync(ledger, 'utf8')), [gone], 'skeleton path stays ledgered')

  // Workspace records under the org go through the registry's own delete.
  const rows = [{ id: 'w1', path: '/vol/RESTO/.arxa/worktrees/a' }, { id: 'w2', path: '/vol/RESTOX' }, { id: 'w3', path: '/vol/RESTO' }]
  const deleted = []
  const reg = { async list() { return rows }, async delete(id) { deleted.push(id); return true } }
  assert.deepEqual(await sweepWorkspacesUnder(reg, '/vol/RESTO'), { removed: ['w1', 'w3'] })
  assert.deepEqual(deleted, ['w1', 'w3'], 'prefix trap kept, exact + nested removed')
  assert.deepEqual(await sweepWorkspacesUnder(null, '/vol/RESTO'), { removed: [], skipped: 'registry-unavailable' })

  // ---- quiesceSessionsUnder (Bug B: stop live sessions before org trash) --
  // Two live inside, one live outside, one live prefix-trap, one under but
  // already stopped. The agentControl fake mirrors the real face contract:
  // stop the ids asked, classify ids with nothing live as alreadyStopped.
  mk('p-quiesce', 'q-in-1', { id: 'q-in-1', cwd: '/vol/RESTO/.arxa/worktrees/q1' })
  mk('p-quiesce', 'q-in-2', { id: 'q-in-2', cwd: '/vol/RESTO' })
  mk('p-quiesce', 'q-out', { id: 'q-out', cwd: '/vol/TOPO' })
  mk('p-quiesce', 'q-pre', { id: 'q-pre', cwd: '/vol/RESTOX/notes' }) // prefix trap
  mk('p-quiesce', 'q-gone', { id: 'q-gone', cwd: '/vol/RESTO/notes' }) // under, already stopped
  const liveStore = { get: (id) => (id === 'q-gone' ? undefined : { id }) }
  const control = {
    asked: null,
    async stopAgentIds(ids) {
      control.asked = [...ids].sort()
      const stopped = []
      const alreadyStopped = []
      for (const id of ids) (liveStore.get(id) ? stopped : alreadyStopped).push(id)
      return { ok: true, stopped, alreadyStopped }
    },
  }
  const qr = await quiesceSessionsUnder({ sessions: liveStore, sessionPersistence: fake, agentControl: control }, '/vol/RESTO')
  assert.deepEqual(qr.stopped.slice().sort(), ['q-in-1', 'q-in-2'])
  assert.deepEqual(qr.alreadyStopped, ['q-gone'])
  assert.deepEqual(control.asked, ['q-gone', 'q-in-1', 'q-in-2'], 'outside + prefix-trap sessions are never asked to stop')

  // Fails closed: a stop that reports failure throws naming ONLY session ids.
  const bad = { stopAgentIds: async () => ({ ok: false, reason: 'stop-failed', failed: ['q-in-1'] }) }
  await assert.rejects(
    () => quiesceSessionsUnder({ sessions: liveStore, sessionPersistence: fake, agentControl: bad }, '/vol/RESTO'),
    (e) => { assert.match(e.message, /^session-stop-failed: q-in-1$/); assert.ok(!e.message.includes('/'), 'no paths in the error'); return true },
  )
  // No agent control while sessions sit under the org: still fails closed.
  await assert.rejects(
    () => quiesceSessionsUnder({ sessions: liveStore, sessionPersistence: fake, agentControl: null }, '/vol/RESTO'),
    /session-stop-unavailable: q-gone q-in-1 q-in-2/,
  )
  // A face that never answers is cut off by the bound (trash must not hang).
  await assert.rejects(
    () => quiesceSessionsUnder({ sessions: liveStore, sessionPersistence: fake, agentControl: { stopAgentIds: () => new Promise(() => {}) } }, '/vol/RESTO', { timeoutMs: 20 }),
    /session-stop-timeout: q-gone q-in-1 q-in-2/,
  )
  // A live row with no persisted dir is still found (a session born seconds ago).
  const freshStore = { list: () => [{ id: 'q-fresh', cwd: '/vol/RESTO/dock' }], get: (id) => (id === 'q-fresh' ? { id } : undefined) }
  const control2 = { stopAgentIds: async (ids) => ({ ok: true, stopped: ids, alreadyStopped: [] }) }
  const qr2 = await quiesceSessionsUnder({ sessions: freshStore, sessionPersistence: fake, agentControl: control2 }, '/vol/RESTO')
  assert.deepEqual(qr2.stopped.slice().sort(), ['q-fresh', 'q-gone', 'q-in-1', 'q-in-2'])
  // No persistence (an offline host): skip, never block the trash.
  assert.deepEqual(await quiesceSessionsUnder({ agentControl: control }, '/vol/RESTO'), { stopped: [], alreadyStopped: [], skipped: 'persistence-unavailable' })
  // Nothing under the org: nothing to stop, no agentControl needed.
  assert.deepEqual(await quiesceSessionsUnder({ sessions: liveStore, sessionPersistence: fake, agentControl: null }, '/vol/EMPTY'), { stopped: [], alreadyStopped: [] })

  console.log('arxa-sidebar selftest.session-sweep: ALL GREEN')
} finally { rmSync(dir, { recursive: true, force: true }) }
