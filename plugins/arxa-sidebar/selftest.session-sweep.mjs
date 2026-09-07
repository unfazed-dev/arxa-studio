// Selftest: org purge session sweep removes only sessions whose cwd is under
// the purged org; unreadable headers and outside cwds are kept.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
import { sweepSessionsUnder, sweepDeadTmpSessions, rememberPurgedOrg, sweepPurgedOrgs, sweepWorkspacesUnder } from './lib/session-sweep.js'

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
  console.log('arxa-sidebar selftest.session-sweep: ALL GREEN')
} finally { rmSync(dir, { recursive: true, force: true }) }
