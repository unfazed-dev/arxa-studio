import { strict as assert } from 'node:assert'
import { TurnBridge, MCP_PREFIX, stripMcpPrefix } from './lib/bridge.js'
import { PendingResults } from './lib/pending.js'

let passed = 0
const ok = (msg) => { passed++; console.log(`ok ${passed} - ${msg}`) }

async function * from (arr) { for (const m of arr) yield m }
const collect = async (gen) => { const out = []; for await (const c of gen) out.push(c); return out }
const tick = () => new Promise((r) => setImmediate(r))
const init = { type: 'system', subtype: 'init', apiKeySource: 'none', session_id: 'cs-1', model: 'sonnet', claude_code_version: '2.1.259', tools: [] }
const ev = (event, parent = null) => ({ type: 'stream_event', event, parent_tool_use_id: parent, session_id: 'cs-1', uuid: 'u' })

/** A stream the test drives by hand, so a consumer can be parked mid-turn. */
function channel () {
  const items = []; let waiter; let closed
  const wake = () => { const w = waiter; waiter = undefined; w?.() }
  return {
    push (m) { items.push(m); wake() },
    throwErr (err) { closed = { err }; wake() },
    async * [Symbol.asyncIterator] () {
      while (true) {
        if (items.length) { yield items.shift(); continue }
        if (closed) throw closed.err
        await new Promise((r) => { waiter = r })
      }
    },
  }
}

// --- plain text turn
{
  const sessions = []
  const b = new TurnBridge({ pending: new PendingResults(), onSession: (id, m) => sessions.push([id, m]), onRateLimit: () => {}, messages: from([
    init,
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } }),
    ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } }),
    ev({ type: 'content_block_stop', index: 0 }),
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Hello' }] } },
    { type: 'result', subtype: 'success', is_error: false, result: 'Hello', usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 1 } },
  ]) })
  const chunks = await collect(b.segment())
  assert.deepEqual(sessions, [['cs-1', 'sonnet']])
  assert.deepEqual(chunks, [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'Hel' }, { type: 'text-delta', index: 0, text: 'lo' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello' } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 1 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]); ok('text turn → chunks')
  assert.equal(b.claudeSessionId, 'cs-1')
  assert.equal(b.finished, true); ok('finished flips once the consumer has seen the result')
}

// --- tool round: segment 1 ends on tool-calls, result resolves pending, segment 2 finishes
{
  const pending = new PendingResults()
  const b = new TurnBridge({ pending, onSession: () => {}, onRateLimit: () => {}, messages: from([
    init,
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: 'Read', input: {} } }),
    ev({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file_path":' } }),
    ev({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"a.txt"}' } }),
    ev({ type: 'content_block_stop', index: 0 }),
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'a.txt' } }] } },
    { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'body of a', is_error: false }] } },
    ev({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }),
    ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Read it.' } }),
    ev({ type: 'content_block_stop', index: 1 }),
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Read it.' }] } },
    { type: 'result', subtype: 'success', is_error: false, result: 'Read it.', usage: { input_tokens: 1, output_tokens: 1 } },
  ]) })
  const seg1 = await collect(b.segment())
  assert.deepEqual(seg1, [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: 'tu_1', name: 'Read', argumentsDelta: '' },
    { type: 'tool-call-delta', index: 0, id: 'tu_1', argumentsDelta: '{"file_path":' },
    { type: 'tool-call-delta', index: 0, id: 'tu_1', argumentsDelta: '"a.txt"}' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'tu_1', name: 'Read', arguments: '{"file_path":"a.txt"}' } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]); ok('segment 1 ends on tool-calls')
  assert.deepEqual(await pending.expect('tu_1'), { text: 'body of a', isError: false }); ok('tool_result resolves the mirror')
  const seg2 = await collect(b.segment())
  assert.equal(seg2[0].index, 0, 'index restarts per segment')
  assert.deepEqual(seg2.at(-1), { type: 'finish', reason: { kind: 'stop' } }); ok('segment 2 finishes the turn')
  await assert.rejects(collect(b.segment()), /after the turn finished/); ok('a segment asked for after the end throws instead of hanging')
}

// --- nested (subagent) frames are ignored; api key refused; error result throws
{
  const b = new TurnBridge({ pending: new PendingResults(), onSession: () => {}, onRateLimit: () => {}, messages: from([
    init, ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, 'tu_parent'),
    { type: 'result', subtype: 'success', is_error: false, result: '', usage: { input_tokens: 0, output_tokens: 0 } },
  ]) })
  const c = await collect(b.segment())
  assert.deepEqual(c.map((x) => x.type), ['usage', 'finish']); ok('subagent frames skipped')
}
{
  const b = new TurnBridge({ pending: new PendingResults(), onSession: () => {}, onRateLimit: () => {}, messages: from([{ ...init, apiKeySource: 'ANTHROPIC_API_KEY' }]) })
  await assert.rejects(collect(b.segment()), /API key is configured/); ok('api key refused')
}
{
  const limits = []
  const b = new TurnBridge({ pending: new PendingResults(), onSession: () => {}, onRateLimit: (i) => limits.push(i), messages: from([
    init, { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', utilization: 0.9 } },
    { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['boom'], usage: { input_tokens: 0, output_tokens: 0 } },
  ]) })
  await assert.rejects(collect(b.segment()), /boom/)
  assert.deepEqual(limits, [{ status: 'allowed_warning', utilization: 0.9 }]); ok('rate limit forwarded, error result throws')
}
// --- bridged arxa tool: dispatched under its dsh name, id reported to onToolUse
{
  const seen = []
  const b = new TurnBridge({ pending: new PendingResults(), onSession: () => {}, onRateLimit: () => {}, onToolUse: (id, name) => seen.push([id, name]), messages: from([
    init,
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_9', name: 'mcp__arxa__gen_ui', input: {} } }),
    ev({ type: 'content_block_stop', index: 0 }),
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'tu_9', name: 'mcp__arxa__gen_ui', input: {} }] } },
  ]) })
  const c = await collect(b.segment())
  assert.equal(c.find((x) => x.type === 'block-end').block.name, 'gen_ui')
  assert.deepEqual(seen, [['tu_9', 'mcp__arxa__gen_ui']]); ok('mcp prefix stripped, onToolUse called')
  assert.equal(stripMcpPrefix('Read'), 'Read')
  assert.equal(stripMcpPrefix(`${MCP_PREFIX}x`), 'x'); ok('stripMcpPrefix leaves unprefixed names alone')
}
// --- results arrive while nobody is reading a segment (the loop is dispatching tools)
{
  const pending = new PendingResults()
  const b = new TurnBridge({ pending, onSession: () => {}, onRateLimit: () => {}, messages: from([
    init, { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_bg', content: 'bg', is_error: false }] } },
  ]) })
  assert.deepEqual(await pending.expect('tu_bg'), { text: 'bg', isError: false }); ok('background pump resolves results without segment()')
  void b
}
// --- the loop ran the call itself: the echoed result has no waiter and must not park forever
{
  const pending = new PendingResults()
  const b = new TurnBridge({ pending, onSession: () => {}, onRateLimit: () => {}, messages: from([
    init,
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'tu_m', name: 'mcp__arxa__gen_ui', input: {} }] } },
    { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_m', content: 'echo', is_error: false }] } },
  ]) })
  await tick(); await tick()   // let the pump drain the whole array before we look
  const race = await Promise.race([pending.expect('tu_m').then(() => 'parked'), tick().then(() => 'dropped')])
  assert.equal(race, 'dropped'); ok('an mcp result nobody awaits is dropped, not parked')
  void b
}
// --- a block left open when the segment ends is still closed
{
  const b = new TurnBridge({ pending: new PendingResults(), onSession: () => {}, onRateLimit: () => {}, messages: from([
    init,
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_o', name: 'Bash', input: {} } }),
    ev({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":"ls"}' } }),
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'tu_o', name: 'Bash', input: { command: 'ls' } }] } },
  ]) })
  const c = await collect(b.segment())
  assert.deepEqual(c.at(-2), { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'tu_o', name: 'Bash', arguments: '{"command":"ls"}' } })
  assert.deepEqual(c.at(-1), { type: 'finish', reason: { kind: 'tool-calls' } }); ok('an unstopped tool-call block is closed before the tool-calls finish')
}
// --- a failing pump wakes the parked consumer and the one that arrives afterwards
{
  const chan = channel()
  const b = new TurnBridge({ pending: new PendingResults(), onSession: () => {}, onRateLimit: () => {}, messages: chan })
  chan.push(init)
  const parked = collect(b.segment())
  await tick()                      // the consumer is now waiting on an empty queue
  chan.throwErr(new Error('stream exploded'))
  await assert.rejects(parked, /stream exploded/); ok('a pump failure wakes the already-parked consumer')
  await assert.rejects(collect(b.segment()), /stream exploded/); ok('and a consumer arriving after the failure sees it too')
}
// --- two consumers at once is a mistake, not a deadlock
{
  const chan = channel()
  const b = new TurnBridge({ pending: new PendingResults(), onSession: () => {}, onRateLimit: () => {}, messages: chan })
  chan.push(init)
  const first = collect(b.segment())
  await tick()
  await assert.rejects(collect(b.segment()), /already being consumed/); ok('a second concurrent segment() throws instead of stranding the first')
  chan.throwErr(new Error('done with it'))
  await assert.rejects(first, /done with it/)
}
// --- a dead stream must not leave the loop waiting inside a mirror tool forever
{
  const call = { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'tu_hang', name: 'Bash', input: {} }] } }
  {
    const pending = new PendingResults(); const chan = channel()
    const b = new TurnBridge({ pending, onSession: () => {}, onRateLimit: () => {}, messages: chan })
    chan.push(init); chan.push(call)
    assert.deepEqual((await collect(b.segment())).at(-1), { type: 'finish', reason: { kind: 'tool-calls' } })
    const waiting = pending.expect('tu_hang')            // the loop is now inside the mirror tool
    chan.throwErr(new Error('child died mid tool round'))
    const out = await waiting
    assert.equal(out.isError, true); assert.match(out.text, /child died mid tool round/)
    ok('a stream failure settles the mirror tool already waiting on a result')
  }
  {
    const pending = new PendingResults(); const chan = channel()
    const b = new TurnBridge({ pending, onSession: () => {}, onRateLimit: () => {}, messages: chan })
    chan.push(init); chan.push(call)
    await collect(b.segment())
    chan.throwErr(new Error('child died mid tool round'))
    await tick()
    const out = await pending.expect('tu_hang')          // dispatched only after the stream died
    assert.equal(out.isError, true); ok('and the mirror tool that starts waiting after the failure')
  }
  {
    const pending = new PendingResults()
    const b = new TurnBridge({ pending, onSession: () => {}, onRateLimit: () => {}, messages: from([
      init, call, { type: 'result', subtype: 'success', is_error: false, result: '', usage: { input_tokens: 0, output_tokens: 0 } },
    ]) })
    await collect(b.segment())
    const out = await pending.expect('tu_hang')
    assert.equal(out.isError, true); assert.match(out.text, /ended before this tool reported a result/)
    ok('a turn that ends without a tool_result fails that tool instead of hanging it')
  }
}

console.log(`# ${passed} ok`)
