import { strict as assert } from 'node:assert'
import { makeCanUseTool } from './lib/approval.js'

let passed = 0
const ok = (msg) => { passed++; console.log(`ok ${passed} - ${msg}`) }

// --- brief's step-1 scenario, verbatim ---
const asked = []
const approval = { request: async (r) => { asked.push(r); return r.toolName === 'Bash' ? 'allowed-once' : 'rejected' } }
const agent = { id: 'a1' }
const can = makeCanUseTool({ approval, agent, isArxaTool: (n) => n.startsWith('mcp__arxa__') })
const sig = new AbortController().signal

assert.deepEqual(
  await can('Bash', { command: 'ls' }, { signal: sig, toolUseID: 'tu1', title: 'Run ls' }),
  { behavior: 'allow', updatedInput: { command: 'ls' } }
)
ok('allowed-once maps to an allow carrying the original input back through updatedInput')

assert.deepEqual(asked[0], { agent, toolName: 'Bash', callId: 'tu1', reason: 'Run ls', signal: sig })
ok('approval.request receives agent, toolName, callId (from toolUseID), reason (from title) and signal')

const denied = await can('Write', { file_path: 'x' }, { signal: sig, toolUseID: 'tu2' })
assert.equal(denied.behavior, 'deny')
assert.match(denied.message, /rejected/)
ok('a rejected outcome denies, with a message naming the outcome')

assert.deepEqual(
  await can('mcp__arxa__gen_ui', { a: 1 }, { signal: sig, toolUseID: 'tu3' }),
  { behavior: 'allow', updatedInput: { a: 1 } }
)
assert.equal(asked.length, 2, 'arxa tools are gated by the dsh loop, not asked twice')
ok('an arxa MCP tool bypasses approval.request entirely (isArxaTool short-circuit)')

// --- fail-closed: every non-'allowed-once' outcome must deny, never fall through to allow ---
for (const outcome of ['cancelled', 'unavailable']) {
  const a = { request: async () => outcome }
  const c = makeCanUseTool({ approval: a, agent, isArxaTool: () => false })
  const r = await c('Bash', {}, { signal: sig, toolUseID: 'tx-' + outcome })
  assert.equal(r.behavior, 'deny')
  ok(`${outcome} denies (never read as consent)`)
}

{
  const a = { request: async () => 'some-future-outcome-nobody-defined-yet' }
  const c = makeCanUseTool({ approval: a, agent, isArxaTool: () => false })
  const r = await c('Bash', {}, { signal: sig, toolUseID: 'tx-unknown' })
  assert.equal(r.behavior, 'deny')
  ok('an unrecognised approval.request outcome denies rather than defaulting to allow')
}

{
  const a = { request: async () => { throw new Error('approval backend unreachable') } }
  const c = makeCanUseTool({ approval: a, agent, isArxaTool: () => false })
  const r = await c('Bash', {}, { signal: sig, toolUseID: 'tx-throw' })
  assert.equal(r.behavior, 'deny')
  ok('a thrown error from approval.request denies rather than allowing or crashing the caller')
}

console.log(`selftest.approval: ${passed} ok`)
