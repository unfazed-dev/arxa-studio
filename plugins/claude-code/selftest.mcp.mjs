import { strict as assert } from 'node:assert'
import { createArxaMcpServer, stripMcpPrefix, MCP_PREFIX } from './lib/mcp-bridge.js'
import { fromLoop } from './lib/pending.js'

let passed = 0
const ok = (msg) => { passed++; console.log(`ok ${passed} - ${msg}`) }

/** Reach the low-level server's request-handler map through its public surface (setRequestHandler
 * / server.request), which the installed MCP SDK has none of for driving a handler directly — so
 * this test uses the private `_requestHandlers` map, guarded here so an SDK upgrade that renames
 * or removes it fails with a clear message instead of a confusing one. */
const getHandlers = (cfg) => {
  const map = cfg.instance.server._requestHandlers
  assert.ok(map && typeof map.get === 'function' && map.get('tools/list'),
    '@modelcontextprotocol/sdk: _requestHandlers (or its "tools/list" entry) is missing — ' +
    'the pinned SDK version may have changed the private Server shape; update this test to match. ' +
    `Server own keys: ${cfg?.instance?.server ? Object.keys(cfg.instance.server).join(', ') : '(no server)'}`)
  return map
}

assert.equal(MCP_PREFIX, 'mcp__arxa__')
ok('MCP_PREFIX is the arxa mcp server prefix')
assert.equal(stripMcpPrefix('mcp__arxa__gen_ui'), 'gen_ui')
assert.equal(stripMcpPrefix('Read'), 'Read')
ok('stripMcpPrefix strips the prefix when present and passes other names through unchanged')

const schemas = [
  { name: 'gen_ui', description: 'Render a card', parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } },
  { name: 'Read', description: 'mirror', parameters: { type: 'object', properties: {} } },
]

// --- basic shape + tools/list respects exclude + tools/call relays through onCall
{
  const calls = []
  const cfg = createArxaMcpServer({
    schemas,
    exclude: ['Read'],
    onCall: async (name, args) => { calls.push([name, args]); return { text: 'rendered', isError: false } },
    timeoutMs: 5000,
  })
  assert.equal(cfg.type, 'sdk'); assert.equal(cfg.name, 'arxa'); assert.equal(cfg.timeout, 5000)
  ok('createArxaMcpServer returns the McpSdkServerConfigWithInstance shape')

  const handlers = getHandlers(cfg)
  const list = await handlers.get('tools/list')({ method: 'tools/list', params: {} }, {})
  assert.deepEqual(list.tools, [{ name: 'gen_ui', description: 'Render a card', inputSchema: schemas[0].parameters }])
  ok('tools/list carries the schema verbatim (no re-derivation) and omits excluded tools')

  const res = await handlers.get('tools/call')({ method: 'tools/call', params: { name: 'gen_ui', arguments: { title: 'hi' } } }, {})
  assert.deepEqual(calls, [['gen_ui', { title: 'hi' }]])
  assert.deepEqual(res, { content: [{ type: 'text', text: 'rendered' }], isError: false })
  ok('tools/call invokes onCall with the bare name and arguments, and relays its result')
}

// --- exclude actually excludes: a call for it is refused, not just hidden from the list
{
  const calls = []
  const cfg = createArxaMcpServer({
    schemas,
    exclude: ['Read'],
    onCall: async (name, args) => { calls.push([name, args]); return { text: 'should never run', isError: false } },
    timeoutMs: 5000,
  })
  const handlers = getHandlers(cfg)
  const res = await handlers.get('tools/call')({ method: 'tools/call', params: { name: 'Read', arguments: {} } }, {})
  assert.equal(res.isError, true)
  assert.deepEqual(calls, [], 'onCall must never run for an excluded tool')
  ok('an excluded tool is refused when called anyway, and onCall is never invoked for it')
}

// --- the mcp__arxa__ prefix is stripped before the name reaches onCall
{
  const calls = []
  const cfg = createArxaMcpServer({
    schemas,
    exclude: ['Read'],
    onCall: async (name, args) => { calls.push(name); return { text: 'ok', isError: false } },
    timeoutMs: 5000,
  })
  const handlers = getHandlers(cfg)
  await handlers.get('tools/call')({ method: 'tools/call', params: { name: `${MCP_PREFIX}gen_ui`, arguments: { title: 'x' } } }, {})
  assert.deepEqual(calls, ['gen_ui'])
  ok('a prefixed tool name is stripped before onCall sees it')
}

// --- a call parks on fromLoop.expect() and only resolves once the loop delivers the result
{
  const parkId = 'mcp-selftest-park-1'
  const cfg = createArxaMcpServer({
    schemas: [{ name: 'park_me', description: 'x', parameters: { type: 'object', properties: {} } }],
    exclude: [],
    onCall: async () => fromLoop.expect(parkId),
    timeoutMs: 5000,
  })
  const handlers = getHandlers(cfg)
  let settled = false
  const call = handlers.get('tools/call')({ method: 'tools/call', params: { name: 'park_me', arguments: {} } }, {})
  call.then(() => { settled = true })
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(settled, false, 'the call must still be parked before the loop resolves it')
  fromLoop.resolve(parkId, { text: 'loop result', isError: false })
  const res = await call
  assert.deepEqual(res, { content: [{ type: 'text', text: 'loop result' }], isError: false })
  ok('a call parks on fromLoop.expect() and resolves once the loop delivers the result')
}

// --- a timed-out call settles as a readable error, and a rejection that lands after the race
// is already decided never becomes an unhandled rejection (the hazard: PendingResults.clear()
// rejects outstanding waiters, and a promise obtained but not synchronously listened to would
// turn that into a process-crashing unhandled rejection).
{
  let unhandled = null
  const onUnhandled = (err) => { unhandled = err }
  process.on('unhandledRejection', onUnhandled)
  try {
    let rejectLate
    const neverResolvesInTime = new Promise((_resolve, reject) => { rejectLate = reject })
    const cfg = createArxaMcpServer({
      schemas: [{ name: 'slow', description: 'x', parameters: { type: 'object', properties: {} } }],
      exclude: [],
      onCall: async () => neverResolvesInTime,
      timeoutMs: 20,
    })
    const handlers = getHandlers(cfg)
    const res = await handlers.get('tools/call')({ method: 'tools/call', params: { name: 'slow', arguments: {} } }, {})
    assert.equal(res.isError, true)
    assert.match(res.content[0].text, /timed out/)
    ok('a call that outlives timeoutMs settles as a readable timeout error instead of hanging')

    rejectLate(new Error('late failure')) // arrives after the timeout already won the race
    await new Promise((r) => setTimeout(r, 20)) // let an unhandled rejection surface if it would
    assert.equal(unhandled, null, 'a late rejection on the losing side of the race must not become an unhandled rejection')
    ok('a rejection landing after the timeout has already settled the call is not an unhandled rejection')
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
}

// --- withTimeout's `r.err` branch: the tool call REJECTS before the timeout wins. This is the
// module's whole contract — turning a real tool failure into text Claude can read rather than
// throwing into the MCP request pump — and it had never been exercised. The timeout branch
// (r.done === false) and the success branch were covered; this one was not.
{
  for (const [label, thrown, expected] of [
    ['an Error', new Error('disk on fire'), /tool call failed: disk on fire/],
    ['a bare string', 'no message property', /tool call failed: no message property/],
    ['an object with no message', { code: 'EACCES' }, /tool call failed: /],
  ]) {
    const cfg = createArxaMcpServer({
      schemas: [{ name: 'boom', description: 'x', parameters: { type: 'object', properties: {} } }],
      exclude: [],
      onCall: async () => { throw thrown },
      timeoutMs: 60_000, // generous: the rejection must win the race, not the clock
    })
    const handlers = getHandlers(cfg)
    const res = await handlers.get('tools/call')({ method: 'tools/call', params: { name: 'boom', arguments: {} } }, {})
    assert.equal(res.isError, true, `${label} must settle as an error result, not throw`)
    assert.match(res.content[0].text, expected)
    assert.doesNotMatch(res.content[0].text, /timed out/, `${label} must report the failure, not a timeout`)
  }
  ok('a tool call that rejects before the timeout becomes readable error text, whatever it threw')
}

console.log(`# ${passed} ok`)
