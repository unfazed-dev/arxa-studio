// Selftest: org purge session sweep removes only sessions whose cwd is under
// the purged org; unreadable headers and outside cwds are kept.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
import { sweepSessionsUnder } from './lib/session-sweep.js'

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
  console.log('arxa-sidebar selftest.session-sweep: ALL GREEN')
} finally { rmSync(dir, { recursive: true, force: true }) }
