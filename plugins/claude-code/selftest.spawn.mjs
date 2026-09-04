import { strict as assert } from 'node:assert'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { makeSpawner, CLAUDE_EXTRA_ROOTS } from './lib/spawn.js'

let n = 0; const ok = (s) => { n++; console.log(`  ok ${s}`) }
assert.deepEqual(CLAUDE_EXTRA_ROOTS, [join(homedir(), '.claude', 'projects')]); ok('one extra root, the hidden transcript dir')

const mkdirCalls = []
const mkdir = (dir, opts) => { mkdirCalls.push({ dir, opts }) }
const calls = []
const confine = (argv, policy) => { calls.push({ argv, policy }); return { argv: ['sandbox-exec', '-p', 'P', ...argv] } }
const spawned = []
const spawn = (cmd, args, opts) => { spawned.push({ cmd, args, opts }); return { pid: 1 } }
const policy = { mode: 'workspace-write', workspaceRoot: '/ws', sessionId: 's' }
const spawner = makeSpawner({ confine, policy, spawn, mkdir })
const proc = spawner({ command: '/opt/bin/claude', args: ['--output-format', 'stream-json'], cwd: '/ws', env: { PATH: '/x' } })
assert.equal(proc.pid, 1)
assert.deepEqual(mkdirCalls, [{ dir: join(homedir(), '.claude', 'projects'), opts: { recursive: true } }])
ok('transcript dir created (recursive, injected) before confine — no real filesystem touched')
assert.deepEqual(calls[0].argv, ['/opt/bin/claude', '--output-format', 'stream-json'])
assert.deepEqual(calls[0].policy, { ...policy, extraWritableRoots: CLAUDE_EXTRA_ROOTS }); ok('confine gets the policy plus the extra root')
assert.equal(spawned[0].cmd, 'sandbox-exec')
assert.deepEqual(spawned[0].args, ['-p', 'P', '/opt/bin/claude', '--output-format', 'stream-json'])
assert.deepEqual(spawned[0].opts, { cwd: '/ws', env: { PATH: '/x' }, stdio: ['pipe', 'pipe', 'pipe'], signal: undefined }); ok('spawns the confined argv with piped stdio')
console.log(`selftest.spawn: ${n} ok`)
