import { strict as assert } from 'node:assert'
import { ClaudeCodeAdapter } from './lib/adapter.js'
import { fromClaude, fromLoop } from './lib/pending.js'
import { MIRROR_TOOL_NAMES } from './lib/mirror-tools.js'

let passed = 0
const ok = (msg) => { passed++; console.log(`ok ${passed} - ${msg}`) }

async function * from (arr) { for (const m of arr) yield m }
const collect = async (gen) => { const out = []; for await (const c of gen) out.push(c); return out }
const settledIn = (promise, ms) => Promise.race([
  promise.then(() => 'resolved', () => 'rejected'),
  new Promise((r) => setTimeout(() => r('pending'), ms)),
])

const init = { type: 'system', subtype: 'init', apiKeySource: 'none', session_id: 'cs-9', model: 'sonnet', claude_code_version: '2.1.259', tools: [] }
const ev = (event) => ({ type: 'stream_event', event, parent_tool_use_id: null })
const done = (text) => [
  ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
  ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }),
  ev({ type: 'content_block_stop', index: 0 }),
  { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text }] } },
  { type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 1, output_tokens: 1 } },
]

const queries = []
const interrupts = []
const fakeQuery = (script) => (params) => { queries.push(params); const it = from(script); it.interrupt = async () => { interrupts.push(params) }; it.close = () => {}; return it }

const events = []
const agent = {
  id: 'agent-1',
  session: { header: { cwd: '/ws' }, events, append: (type, data) => { events.push({ type, data }); return { seq: events.length - 1 } } },
  ctx: { tools: { schemas: () => [{ name: 'gen_ui', description: 'card', parameters: { type: 'object', properties: {} } }, { name: 'Read', description: 'm', parameters: {} }] } },
}
let initiator = agent
const confined = []
const ctx = {
  agents: { currentInitiator: () => initiator },
  sandbox: { confine: (argv, policy) => { confined.push({ argv, policy }); return { argv } } },
  // `session?.` because the no-agent utility path resolves a policy with no session at all.
  sandboxPolicy: { resolve: ({ session }) => ({ mode: 'workspace-write', workspaceRoot: session?.header?.cwd, sessionId: 's' }) },
  approval: { request: async () => 'allowed-once' },
}
const probe = { current: async () => ({ loggedIn: true, version: '2.1.259', subscriptionType: 'max', models: [{ provider: 'claude-code', id: 'fable', name: 'Fable', description: 'Best', efforts: ['high'] }, { provider: 'claude-code', id: 'sonnet', name: 'Sonnet', description: 'Fast', efforts: [] }] }) }

// spawn/mkdir are injected so exercising spawnClaudeCodeProcess neither starts a process nor
// creates ~/.claude/projects on the machine running the test.
const spawns = []
const mkdirs = []
const mk = (script, p = probe) => new ClaudeCodeAdapter({
  query: fakeQuery(script), probe: p, ctx, binary: '/opt/bin/claude', env: { PATH: '/x' }, version: '0.1.0',
  spawn: (cmd, args, opts) => { spawns.push({ cmd, args, opts }); return { pid: 1234 } },
  mkdir: (dir, opts) => { mkdirs.push({ dir, opts }) },
})

assert.deepEqual(mk([]).providerInfo('claude-code'), { id: 'claude-code', name: 'Claude Code (your subscription)' })
ok('providerInfo')

const models = await mk([]).listModels('claude-code')
assert.equal(models[0].description, 'Best — included on Max, up to 50% of your weekly limit')
ok('listModels carries tier label')

const resolved = await mk([]).resolveModel('claude-code', 'fable')
assert.deepEqual(resolved.reasoning, { efforts: [{ id: 'high', name: 'high' }], defaultEffort: 'high' })
assert.deepEqual(resolved.context, { contextWindow: 200_000 })
ok('resolveModel efforts')

// --- first turn, fresh session: options assembled per D5/D7/D10
{
  const rateLimitEvent = { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', utilization: 0.9, rateLimitType: 'seven_day' } }
  const a = mk([init, rateLimitEvent, ...done('Hi')])
  const chunks = await collect(a.stream({ provider: 'claude-code', model: 'fable', system: 'You are arxa.', messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }], tools: [] }))
  assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'stop' } })
  const o = queries[0].options
  assert.equal(queries[0].prompt, 'hello')
  assert.deepEqual(o.settingSources, []); assert.equal(o.permissionMode, 'default'); assert.equal(o.strictMcpConfig, true)
  assert.deepEqual(o.systemPrompt, { type: 'custom', prompt: 'You are arxa.' })
  assert.equal(o.model, 'fable'); assert.equal(o.fallbackModel, 'opus'); assert.equal(o.resume, undefined)
  assert.equal(o.pathToClaudeCodeExecutable, '/opt/bin/claude'); assert.equal(o.cwd, '/ws'); assert.equal(o.includePartialMessages, true)
  assert.equal(o.mcpServers.arxa.type, 'sdk'); assert.equal(typeof o.canUseTool, 'function'); assert.equal(typeof o.spawnClaudeCodeProcess, 'function')
  assert.deepEqual(events.find((e) => e.type === 'claude-code/session').data, { claudeSessionId: 'cs-9', model: 'sonnet' })
  ok('fresh turn options + session event')

  // Task 14: a rate_limit_event publishes to the shared provider/status channel, not a
  // claude-code-only event — Claude Code is the first producer of the provider-neutral pill.
  const statuses = events.filter((e) => e.type === 'provider/status').map((e) => e.data)
  assert.deepEqual(statuses.find((d) => d.level === 'warn'), {
    provider: 'claude-code', level: 'warn', text: 'Claude 90%', title: 'Claude weekly limit · 90% used',
    utilization: 0.9, detail: { rateLimitType: 'seven_day', status: 'allowed_warning' },
  })
  assert.equal(events.find((e) => e.type === 'claude-code/rate-limit'), undefined)
  ok('rate limit publishes provider/status, not the old claude-code/rate-limit event')

  // D10: `fallbackModel: 'opus'` can swap the model out from under the user, and a silent
  // downgrade is worse than a slow turn. This fixture IS a fallback — 'fable' was asked for
  // and the child reported 'sonnet' — so the turn owes the user a visible note.
  assert.deepEqual(statuses.find((d) => d.level === 'info'), {
    provider: 'claude-code', level: 'info', text: 'Running on sonnet',
    title: 'fable was unavailable — Claude Code fell back to sonnet',
  })
  ok('a model fallback is announced on the provider/status channel instead of happening silently')

  // D5 tool lock: an allowlist on `tools` (the SDK's availability knob), never a denylist and
  // never `allowedTools` — which only auto-approves and would bypass canUseTool entirely.
  assert.deepEqual(o.tools, [...MIRROR_TOOL_NAMES, 'mcp__arxa__gen_ui'])
  assert.equal(o.allowedTools, undefined)
  assert.equal(o.disallowedTools, undefined)
  assert.equal(o.bypassPermissions, undefined)
  assert.equal(o.allowDangerouslySkipPermissions, undefined)
  ok('tools is an allowlist of mirrored built-ins + arxa mcp tools; no auto-approve or bypass knob is set')
}

// --- Task 14 fix round 1: a rate_limit_info that fails PROVIDER_STATUS_SCHEMA (here, a negative
// resetsAt — a case rate-limit.js's utilization clamp doesn't cover) must not kill the turn.
// appendProviderStatus's .parse() throws; onRateLimit swallows it and drops the update instead
// of letting the throw reach TurnBridge's pump() and blow up stream()'s generator. The turn
// finishes normally and no provider/status event is appended for the bad one.
{
  events.length = 0
  const badRateLimitEvent = { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', resetsAt: -100 } }
  const a = mk([init, badRateLimitEvent, ...done('still here')])
  const chunks = await collect(a.stream({ provider: 'claude-code', model: 'sonnet', system: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], tools: [] }))
  assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'stop' } })
  assert.equal(events.find((e) => e.type === 'provider/status'), undefined)
  ok('a rate_limit_info that fails schema validation is dropped silently, the turn is not killed')
}

// --- second turn resumes and does NOT hand off
{
  const a = mk([init, ...done('Again')])
  await collect(a.stream({ provider: 'claude-code', model: 'sonnet', system: 's', messages: [
    { role: 'user', content: [{ type: 'text', text: 'hello' }] }, { role: 'assistant', content: [{ type: 'text', text: 'Hi' }] }, { role: 'user', content: [{ type: 'text', text: 'more' }] }], tools: [] }))
  assert.equal(queries.at(-1).options.resume, 'cs-9'); assert.equal(queries.at(-1).prompt, 'more'); assert.equal(queries.at(-1).options.fallbackModel, undefined)
  ok('resume, no handoff')
}

// --- engine switch into claude: no session event yet → handoff prefix
{
  events.length = 0
  const a = mk([init, ...done('Sw')])
  await collect(a.stream({ provider: 'claude-code', model: 'sonnet', system: 's', messages: [
    { role: 'user', content: [{ type: 'text', text: 'built by deepseek' }] }, { role: 'assistant', content: [{ type: 'text', text: 'done' }] }, { role: 'user', content: [{ type: 'text', text: 'continue' }] }], tools: [] }))
  assert.match(queries.at(-1).prompt, /^Conversation so far/); assert.match(queries.at(-1).prompt, /User: continue$/)
  ok('handoff on switch')
}

// --- tool round across two stream() calls + mcp bridged result
{
  events.length = 0
  const script = [init,
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_r', name: 'Read', input: {} } }),
    ev({ type: 'content_block_stop', index: 0 }),
    ev({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_g', name: 'mcp__arxa__gen_ui', input: {} } }),
    ev({ type: 'content_block_stop', index: 1 }),
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'tu_r', name: 'Read', input: {} }, { type: 'tool_use', id: 'tu_g', name: 'mcp__arxa__gen_ui', input: {} }] } },
    { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_r', content: 'file!', is_error: false }] } },
    ...done('All done')]
  const a = mk(script)
  const base = { provider: 'claude-code', model: 'sonnet', system: 's', tools: [] }
  const seg1 = await collect(a.stream({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }] }))
  const names = seg1.filter((c) => c.type === 'block-end').map((c) => c.block.name)
  assert.deepEqual(names, ['Read', 'gen_ui'], 'mcp prefix stripped so the real dsh tool runs'); assert.deepEqual(seg1.at(-1).reason, { kind: 'tool-calls' })
  assert.deepEqual(await fromClaude.expect('tu_r'), { text: 'file!', isError: false })
  // the MCP handler asks for gen_ui's result; the loop answers via the next stream() messages
  const handlers = queries.at(-1).options.mcpServers.arxa.instance.server._requestHandlers
  const mcpCall = handlers.get('tools/call')({ method: 'tools/call', params: { name: 'gen_ui', arguments: {} } }, {})
  const seg2 = await collect(a.stream({ ...base, messages: [
    { role: 'user', content: [{ type: 'text', text: 'go' }] },
    { role: 'assistant', content: [{ type: 'tool-call', id: 'tu_r', name: 'Read', arguments: '{}' }, { type: 'tool-call', id: 'tu_g', name: 'gen_ui', arguments: '{}' }] },
    { role: 'user', content: [{ type: 'tool-result', toolCallId: 'tu_r', content: [{ type: 'text', text: 'file!' }] }, { type: 'tool-result', toolCallId: 'tu_g', content: [{ type: 'text', text: 'card shown' }] }] }] }))
  assert.deepEqual(await mcpCall, { content: [{ type: 'text', text: 'card shown' }], isError: false })
  assert.deepEqual(seg2.at(-1), { type: 'finish', reason: { kind: 'stop' } })
  ok('tool round + mcp result round-trip')

  // The spawner the SDK would have called: arxa's sandbox wraps the argv, with the transcript
  // dir granted. Driven directly here because a fake query() never starts a process.
  const proc = queries.at(-1).options.spawnClaudeCodeProcess({ command: '/opt/bin/claude', args: ['--print'], cwd: '/ws', env: { PATH: '/x' }, signal: undefined })
  assert.equal(confined[0].policy.extraWritableRoots.length, 1)
  assert.equal(confined[0].policy.mode, 'workspace-write')
  assert.deepEqual(confined[0].argv, ['/opt/bin/claude', '--print'])
  assert.equal(spawns[0].opts.cwd, '/ws'); assert.equal(proc.pid, 1234); assert.equal(mkdirs.length, 1)
  ok('spawner built with the sandbox policy')
}

// --- a result Claude reported that no mirror tool ever claimed must not outlive the turn:
// `early` has no eviction of its own, so a finished turn has to drop the ids it registered.
{
  events.length = 0
  const script = [init,
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_leak', name: 'Read', input: {} } }),
    ev({ type: 'content_block_stop', index: 0 }),
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'tu_leak', name: 'Read', input: {} }] } },
    { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_leak', content: 'unclaimed', is_error: false }] } },
    ...done('finished')]
  const a = mk(script)
  const base = { provider: 'claude-code', model: 'sonnet', system: 's', tools: [] }
  const seg1 = await collect(a.stream({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }] }))
  assert.deepEqual(seg1.at(-1).reason, { kind: 'tool-calls' })
  assert.equal(fromClaude.early.has('tu_leak'), true, 'the result parked while the loop was dispatching')
  const seg2 = await collect(a.stream({ ...base, messages: [
    { role: 'user', content: [{ type: 'text', text: 'go' }] },
    { role: 'assistant', content: [{ type: 'tool-call', id: 'tu_leak', name: 'Read', arguments: '{}' }] },
    { role: 'user', content: [{ type: 'tool-result', toolCallId: 'tu_leak', content: [{ type: 'text', text: 'unclaimed' }] }] }] }))
  assert.deepEqual(seg2.at(-1), { type: 'finish', reason: { kind: 'stop' } })
  assert.equal(fromClaude.early.has('tu_leak'), false, 'the finished turn released the id it registered')
  ok('a finished turn drops its own unclaimed pending results')
}

// --- a real tool failure: the loop's wait is rejected, and the MCP call Claude is blocked on
// settles as readable error text instead of hanging the child.
{
  events.length = 0
  const otherSession = fromLoop.expect('other-session-call')       // a concurrent session's wait
  const otherState = settledIn(otherSession, 30)
  const script = [init,
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_f', name: 'mcp__arxa__gen_ui', input: {} } }),
    ev({ type: 'content_block_stop', index: 0 }),
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'tu_f', name: 'mcp__arxa__gen_ui', input: {} }] } },
    ...done('never read')]
  const a = mk(script)
  const controller = new AbortController()
  const seg = await collect(a.stream({ provider: 'claude-code', model: 'sonnet', system: 's', tools: [], signal: controller.signal, messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }] }))
  assert.deepEqual(seg.at(-1).reason, { kind: 'tool-calls' })
  const handlers = queries.at(-1).options.mcpServers.arxa.instance.server._requestHandlers
  const mcpCall = handlers.get('tools/call')({ method: 'tools/call', params: { name: 'gen_ui', arguments: {} } }, {})
  controller.abort()
  const failed = await mcpCall
  assert.equal(failed.isError, true)
  assert.match(failed.content[0].text, /arxa: tool call failed/)
  ok('an aborted turn turns the loop-side rejection into text Claude can read, not a hang')

  assert.equal(await otherState, 'pending', 'another session\'s pending wait must survive this turn ending')
  ok('clear() is scoped to the ids this turn registered')
  fromLoop.clear(['other-session-call'])
  assert.equal(await settledIn(otherSession, 30), 'rejected')
}

// --- a dsh tool that FAILED must reach Claude flagged as an error. dsh's ToolResultBlock carries
// `isError?: boolean` (dsh-llm lib/types/types.d.ts:73); every other case here leaves it unset, so
// this is the only one that proves the flag is read from the field dsh actually writes.
{
  events.length = 0
  const script = [init,
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_bad', name: 'mcp__arxa__gen_ui', input: {} } }),
    ev({ type: 'content_block_stop', index: 0 }),
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'tu_bad', name: 'mcp__arxa__gen_ui', input: {} }] } },
    ...done('understood')]
  const a = mk(script)
  const base = { provider: 'claude-code', model: 'sonnet', system: 's', tools: [] }
  const seg1 = await collect(a.stream({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }] }))
  assert.deepEqual(seg1.at(-1).reason, { kind: 'tool-calls' })
  const handlers = queries.at(-1).options.mcpServers.arxa.instance.server._requestHandlers
  const mcpCall = handlers.get('tools/call')({ method: 'tools/call', params: { name: 'gen_ui', arguments: {} } }, {})
  await collect(a.stream({ ...base, messages: [
    { role: 'user', content: [{ type: 'text', text: 'go' }] },
    { role: 'assistant', content: [{ type: 'tool-call', id: 'tu_bad', name: 'gen_ui', arguments: '{}' }] },
    { role: 'user', content: [{ type: 'tool-result', toolCallId: 'tu_bad', content: [{ type: 'text', text: 'gate refused this call' }], isError: true }] }] }))
  assert.deepEqual(await mcpCall, { content: [{ type: 'text', text: 'gate refused this call' }], isError: true })
  ok('a failed dsh tool reaches claude flagged as an error, not as ordinary output it would read as success')
}

// --- a signal that had already aborted before stream() reached the listener must still stop the
// child: addEventListener on an aborted signal never fires, and probe.current() is a real await
// (a cold TTL spawns) between the caller aborting and the wiring being reached.
{
  events.length = 0
  const before = interrupts.length
  const controller = new AbortController()
  controller.abort()
  const a = mk([init, ...done('nobody reads this')])
  await collect(a.stream({ provider: 'claude-code', model: 'sonnet', system: 's', tools: [], signal: controller.signal, messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }] }))
  assert.equal(interrupts.length, before + 1, 'the pre-aborted signal still interrupted the child')
  assert.equal(queries.at(-1).options.abortController.signal.aborted, true, 'and aborted the sdk controller')
  assert.equal(a.turns.size, 0, 'and left no turn parked')
  ok('a signal that aborted before the listener was attached still tears the turn down')
}

// --- a stale turn's abort arriving after the agent moved on must not evict the live turn, or the
// next step would find nothing parked and respawn a child mid-conversation.
{
  events.length = 0
  const script = [init,
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_s', name: 'Read', input: {} } }),
    ev({ type: 'content_block_stop', index: 0 }),
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'tu_s', name: 'Read', input: {} }] } },
    ...done('later')]
  const a = mk(script)
  const base = { provider: 'claude-code', model: 'sonnet', system: 's', tools: [] }
  const stale = new AbortController()
  await collect(a.stream({ ...base, signal: stale.signal, messages: [{ role: 'user', content: [{ type: 'text', text: 'first' }] }] }))
  await collect(a.stream({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'second' }] }] }))
  const liveTurn = a.turns.get('agent-1')
  assert.ok(liveTurn, 'the second turn is parked waiting for its tool results')
  stale.abort()
  assert.equal(a.turns.get('agent-1'), liveTurn, "the stale turn's abort left the live turn alone")
  ok('an abort from a superseded turn does not evict the turn running now')
}

// --- superseding a parked turn must STOP its child, not merely release its ids. Nothing below
// the adapter aborts it (dsh's LlmRuntime only forwards options.signal, it never creates one), so
// an orphan keeps working unread and bills the user's own subscription.
{
  events.length = 0
  const script = [init,
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_p', name: 'Read', input: {} } }),
    ev({ type: 'content_block_stop', index: 0 }),
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'tu_p', name: 'Read', input: {} }] } },
    ...done('later')]
  const a = mk(script)
  const base = { provider: 'claude-code', model: 'sonnet', system: 's', tools: [] }
  await collect(a.stream({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'first' }] }] }))
  const superseded = queries.at(-1)
  const before = interrupts.length
  assert.equal(superseded.options.abortController.signal.aborted, false, 'the first child is still running')
  await collect(a.stream({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'second' }] }] }))
  assert.equal(superseded.options.abortController.signal.aborted, true, 'the superseded child was aborted')
  assert.equal(interrupts.length, before + 1, 'and interrupted')
  assert.equal(queries.at(-1).options.abortController.signal.aborted, false, 'the turn that replaced it is untouched')
  ok('superseding a parked turn stops its child instead of orphaning it')
}

// --- a child that has already exited makes interrupt throw; teardown must survive that and still
// release the ids, or a parked MCP call would hang the next turn.
{
  events.length = 0
  const script = [init,
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_h', name: 'mcp__arxa__gen_ui', input: {} } }),
    ev({ type: 'content_block_stop', index: 0 }),
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'tu_h', name: 'mcp__arxa__gen_ui', input: {} }] } },
    ...done('later')]
  const hostile = (params) => {
    queries.push(params)
    const it = from(script)
    it.interrupt = () => { throw new Error('child already exited') }
    it.close = () => {}
    return it
  }
  const a = new ClaudeCodeAdapter({ query: hostile, probe, ctx, binary: '/opt/bin/claude', env: { PATH: '/x' }, version: '0.1.0', spawn: () => ({ pid: 1 }), mkdir: () => {} })
  const base = { provider: 'claude-code', model: 'sonnet', system: 's', tools: [] }
  await collect(a.stream({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'first' }] }] }))
  const handlers = queries.at(-1).options.mcpServers.arxa.instance.server._requestHandlers
  const mcpCall = handlers.get('tools/call')({ method: 'tools/call', params: { name: 'gen_ui', arguments: {} } }, {})
  // The supersede runs teardown on the hostile child; the throw must not escape into this call.
  await collect(a.stream({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'second' }] }] }))
  const failed = await mcpCall
  assert.equal(failed.isError, true)
  assert.match(failed.content[0].text, /arxa: tool call failed/)
  ok('a teardown whose interrupt throws still releases the turn\'s pending ids')
}

// --- a name Claude calls with no matching tool_use in flight is refused, not parked forever
{
  events.length = 0
  const a = mk([init, ...done('hi')])
  await collect(a.stream({ provider: 'claude-code', model: 'sonnet', system: 's', tools: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }] }))
  const handlers = queries.at(-1).options.mcpServers.arxa.instance.server._requestHandlers
  const res = await handlers.get('tools/call')({ method: 'tools/call', params: { name: 'gen_ui', arguments: {} } }, {})
  assert.equal(res.isError, true); assert.match(res.content[0].text, /no pending call for gen_ui/)
  ok('an mcp call with no queued tool_use id is refused instead of parking forever')
}

// --- signed out / old version refuse before spawning
{
  const before = queries.length
  // The real signed-out string the CLI produces — not a placeholder. F13: the three
  // failure kinds below used to collapse into one fixed "not signed in" line that
  // discarded account.error, so a timeout and a sign-out were indistinguishable.
  const signedOut = { loggedIn: false, error: 'Not logged in · Please run /login', models: [] }
  const out = mk([], { current: async () => signedOut })
  await assert.rejects(collect(out.stream({ provider: 'claude-code', model: 'sonnet', messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }] }] })), /claude auth login/)
  // A probe that timed out is NOT a sign-out: saying so sent users to re-run a login
  // they had already done. The real cause has to survive into the message.
  const timedOut = mk([], { current: async () => ({ loggedIn: false, error: 'initialize timed out', models: [] }) })
  await assert.rejects(
    collect(timedOut.stream({ provider: 'claude-code', model: 'sonnet', messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }] }] })),
    (e) => /initialize timed out/.test(e.message) && !/not signed in/.test(e.message))
  // No CLI at all is a third case: telling this user to run a command they cannot run is a dead end.
  const noBin = mk([], { current: async () => ({ loggedIn: false, error: 'no claude binary on PATH and no bundled binary', models: [] }) })
  await assert.rejects(
    collect(noBin.stream({ provider: 'claude-code', model: 'sonnet', messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }] }] })),
    /not installed.*docs\.claude\.com/s)
  const old = mk([], { current: async () => ({ loggedIn: true, version: '2.1.240', subscriptionType: 'max', models: [] }) })
  await assert.rejects(collect(old.stream({ provider: 'claude-code', model: 'fable', messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }] }] })), /2\.1\.255/)
  assert.equal(queries.length, before)
  ok('refusals spawn nothing')
}

// --- utility purpose: no mcp, no tools, no resume
{
  const a = mk([init, ...done('Summary')])
  const chunks = await collect(a.stream({ provider: 'claude-code', model: 'haiku', purpose: 'compaction', messages: [{ role: 'user', content: [{ type: 'text', text: 'summarise' }] }] }))
  assert.equal(chunks.filter((c) => c.type === 'text-delta').map((c) => c.text).join(''), 'Summary')
  const o = queries.at(-1).options
  assert.deepEqual(o.tools, []); assert.equal(o.maxTurns, 1); assert.equal(o.mcpServers, undefined); assert.equal(o.persistSession, false)
  assert.equal(o.cwd, '/ws'); assert.deepEqual(o.settingSources, []); assert.equal(o.permissionMode, 'default')
  // The utility path shares base(), but the security knobs are pinned here too rather than left
  // to hold structurally — a later edit to either path must fail a test, not pass quietly.
  assert.deepEqual(o.systemPrompt, { type: 'custom', prompt: 'Answer concisely.' })
  assert.equal(o.allowedTools, undefined); assert.equal(o.disallowedTools, undefined)
  assert.equal(o.bypassPermissions, undefined); assert.equal(o.allowDangerouslySkipPermissions, undefined)
  ok('compaction path is tool-less')
}

// --- no initiating agent at all (a call outside any session) takes the same utility path
{
  initiator = undefined
  try {
    const a = mk([init, ...done('Anon')])
    const chunks = await collect(a.stream({ provider: 'claude-code', model: 'haiku', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }))
    assert.equal(chunks.at(-1).reason.kind, 'stop')
    const o = queries.at(-1).options
    assert.deepEqual(o.tools, []); assert.equal(o.maxTurns, 1); assert.equal(o.mcpServers, undefined)
    ok('no initiating agent falls back to the utility path')
  } finally { initiator = agent }
}

// --- D5: the child never inherits arxa's own working directory.
// `cwd: … ?? process.cwd()` ran Claude wherever the controller happened to be started.
{
  const rooted = {
    ...ctx,
    // A session with no cwd of its own, but a sandbox policy that does have a workspace root:
    // that root is what the confinement is built from, so it is the right fallback.
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: '/policy-root', sessionId: 's' }) },
  }
  const rootlessAgent = { ...agent, session: { ...agent.session, header: {} } }
  initiator = rootlessAgent
  try {
    const a = new ClaudeCodeAdapter({ query: fakeQuery([init, ...done('ok')]), probe, ctx: rooted, binary: '/opt/bin/claude', env: { PATH: '/x' }, version: '0.1.0' })
    await collect(a.stream({ provider: 'claude-code', model: 'sonnet', system: 's', tools: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }))
    assert.equal(queries.at(-1).options.cwd, '/policy-root')
    ok('a session with no cwd falls back to the sandbox policy workspace root, not process.cwd()')

    // And with no root anywhere, the turn is refused rather than run in an arbitrary directory.
    const nowhere = { ...ctx, sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: undefined, sessionId: 's' }) } }
    const b = new ClaudeCodeAdapter({ query: fakeQuery([init, ...done('ok')]), probe, ctx: nowhere, binary: '/opt/bin/claude', env: { PATH: '/x' }, version: '0.1.0' })
    const before = queries.length
    await assert.rejects(
      collect(b.stream({ provider: 'claude-code', model: 'sonnet', system: 's', tools: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })),
      /no workspace root/,
    )
    assert.equal(queries.length, before, 'no child is started when there is nowhere safe to start it')
    ok('with no workspace root anywhere the turn is refused, and no child is spawned')
  } finally { initiator = agent }
}

// --- D5 applies to the utility path too: a session with no cwd of its own must fall back to
// the sandbox policy's workspace root, not process.cwd() — the same rule the turn path enforces.
{
  const rooted = {
    ...ctx,
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: '/policy-root', sessionId: 's' }) },
  }
  const rootlessAgent = { ...agent, session: { ...agent.session, header: {} } }
  initiator = rootlessAgent
  try {
    const a = new ClaudeCodeAdapter({ query: fakeQuery([init, ...done('Summary')]), probe, ctx: rooted, binary: '/opt/bin/claude', env: { PATH: '/x' }, version: '0.1.0' })
    await collect(a.stream({ provider: 'claude-code', model: 'haiku', purpose: 'compaction', messages: [{ role: 'user', content: [{ type: 'text', text: 'summarise' }] }] }))
    assert.equal(queries.at(-1).options.cwd, '/policy-root')
    ok('utility path: a session with no cwd falls back to the sandbox policy workspace root, not process.cwd()')
  } finally { initiator = agent }
}

// --- a recorded Claude session the binary no longer holds falls back to a fresh start.
// Clearing ~/.claude/projects, or moving to another machine, used to make every later turn in
// that session error out: `resume` pointed at a transcript that was simply gone.
{
  events.length = 0
  events.push({ type: 'claude-code/session', data: { claudeSessionId: 'cs-gone', model: 'sonnet' } })
  // Per-call scripts: the first attempt dies before saying anything, the second succeeds.
  const scripts = [
    (async function * () { throw new Error('No conversation found with session ID: cs-gone') })(),
    from([init, ...done('picked up where we left off')]),
  ]
  const a = new ClaudeCodeAdapter({
    query: (params) => { queries.push(params); const it = scripts.shift(); it.interrupt = async () => {}; it.close = () => {}; return it },
    probe, ctx, binary: '/opt/bin/claude', env: { PATH: '/x' }, version: '0.1.0',
  })
  const before = queries.length
  const chunks = await collect(a.stream({ provider: 'claude-code', model: 'sonnet', system: 's', tools: [], messages: [
    { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Hi' }] },
    { role: 'user', content: [{ type: 'text', text: 'carry on' }] }] }))
  assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'stop' } }, 'the turn completes instead of erroring')
  assert.equal(queries.length - before, 2, 'exactly one retry, not a loop')
  assert.equal(queries.at(-2).options.resume, 'cs-gone', 'the first attempt did try the recorded session')
  assert.equal(queries.at(-1).options.resume, undefined, 'the retry starts fresh')
  assert.match(queries.at(-1).prompt, /^Conversation so far/, 'and hands Claude the history as flat text')
  assert.match(queries.at(-1).prompt, /User: carry on$/)
  ok('a dead resume restarts fresh with a handoff instead of failing the turn')
}

// --- but a child that DID start and then failed must surface that failure.
// `sawInit` is the discriminator: a real error after a healthy start is not a dead resume, and
// retrying it would hide it and pay for the turn twice.
{
  events.length = 0
  events.push({ type: 'claude-code/session', data: { claudeSessionId: 'cs-9', model: 'sonnet' } })
  const scripts = [
    (async function * () { yield init; throw new Error('model overloaded') })(),
    from([init, ...done('should never run')]),
  ]
  const a = new ClaudeCodeAdapter({
    query: (params) => { queries.push(params); const it = scripts.shift(); it.interrupt = async () => {}; it.close = () => {}; return it },
    probe, ctx, binary: '/opt/bin/claude', env: { PATH: '/x' }, version: '0.1.0',
  })
  const before = queries.length
  await assert.rejects(
    collect(a.stream({ provider: 'claude-code', model: 'sonnet', system: 's', tools: [], messages: [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Hi' }] },
      { role: 'user', content: [{ type: 'text', text: 'go' }] }] })),
    /model overloaded/,
  )
  assert.equal(queries.length - before, 1, 'a failure after a healthy start is not retried')
  ok('a failure after the child reported its session surfaces instead of being retried away')
}

console.log(`# ${passed} ok`)
