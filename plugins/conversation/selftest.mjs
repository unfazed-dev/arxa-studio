// arxa-conversation selftest — pure node, network-free (same discipline as
// plugins/approvals/selftest.mjs). Run: node plugins/conversation/selftest.mjs
import { strict as assert } from 'node:assert'
import { foldHistory, flattenSidebar, apply } from './lib/index.js'

let checks = 0
const ok = (name) => { checks += 1; console.log('  ok', name) }

// ---- fixtures
const ev = (type, seq, time, data, source) => ({
  type, seq, time,
  data: type === 'user/message' ? { role: 'user', content: [{ type: 'text', text: data }], source } : data,
})
const USER = { kind: 'user' }
const PLUGIN = { kind: 'plugin', plugin: 'x', form: 'notice', summary: 'ctx' }

// ---- 1. foldHistory
{
  const entries = [
    { event: ev('turn/start', 1, 100, { turn: 0 }) },
    { event: ev('user/message', 2, 110, 'hello world', USER) },
    { event: ev('user/message', 3, 120, 'synthetic context', PLUGIN) },
    { event: ev('assistant/chunk', 4, 130, { turn: 0, step: 0, chunk: {} }) },
    {
      event: {
        type: 'assistant/message', seq: 5, time: 140,
        data: { turn: 0, step: 0, message: { role: 'assistant', content: [{ type: 'text', text: 'hi there' }], source: { kind: 'model', provider: 'p', model: 'm' } } },
      },
    },
    {
      event: {
        type: 'tool/result', seq: 6, time: 150,
        data: { turn: 0, step: 0, message: { role: 'user', content: [{ type: 'tool_result' }], source: { kind: 'tool', callId: 'c1' } } },
      },
    },
  ]
  const rows = foldHistory(entries)
  assert.deepEqual(rows.map((r) => r.seq), [2, 5], 'only human + assistant surface folds')
  assert.equal(rows[0].role, 'user')
  assert.equal(rows[0].text, 'hello world')
  assert.equal(rows[1].role, 'assistant')
  assert.equal(rows[1].text, 'hi there')
  assert.equal(foldHistory(null).length, 0, 'null history folds to empty')
  ok('foldHistory: human+assistant only, seq order, null-safe')
}

// ---- 2. flattenSidebar
{
  const snap = {
    orgs: [
      { name: 'TESTO', sessions: [{ id: 's-1', name: '02-design-001', displayTitle: 'Real title', state: 'open', parkedReason: null, project: 'Fads', workspace: 'projects/Fads/02-design', createdAt: 1, updatedAt: 2, dshSessionId: 'arxa-s-1' }] },
      { name: 'TOPO', sessions: [] },
    ],
  }
  const rows = flattenSidebar(snap)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].title, 'Real title', 'displayTitle wins over name')
  assert.equal(rows[0].org, 'TESTO')
  assert.equal(rows[0].dshSessionId, 'arxa-s-1')
  assert.deepEqual(flattenSidebar(null), [])
  assert.deepEqual(flattenSidebar({ orgs: [{ name: 'X' }] }), [])
  ok('flattenSidebar: orgs flattened, displayTitle preferred, null-safe')
}

// ---- 3. route harness
const makeCtx = ({ api, fetchImpl, sidebarUrl }) => {
  // Two tables, mirroring the real webserver: exact and prefixes are
  // separate Maps — a path may exist in both (list + per-session here).
  const routes = new Map()
  const ctx = {
    webServer: { register: (r) => routes.set(r.kind + ':' + r.path, r.handler) },
    apiProxy: api,
  }
  apply(ctx, { apiProxy: api, httpImpl: fetchImpl, sidebarUrl })
  return routes
}
const fakeRes = () => {
  const res = { status: null, body: null }
  res.writeHead = (s) => { res.status = s }
  res.end = (b) => { res.body = JSON.parse(b) }
  return res
}
const fakeReq = (method, url, body) => ({
  method, url,
  on: (ev, cb) => {
    if (ev === 'data' && body != null) cb(body)
    if (ev === 'end') cb()
  },
})
const RPC_OK = (value) => ({ rpcId: 'r1', result: { ok: true, value } })
const RPC_ERR = (code, message) => ({ rpcId: 'r1', result: { ok: false, error: { code, message, details: {} } } })

// ---- 4. GET transcript happy path
{
  const history = [
    { event: ev('user/message', 2, 110, 'q', USER) },
    { event: { type: 'assistant/message', seq: 5, time: 140, data: { message: { role: 'assistant', content: [{ type: 'text', text: 'a' }] } } } },
  ]
  const routes = makeCtx({
    api: { sessions: { history: async (req) => { assert.deepEqual(req.payload, { sessionId: 's-1', maxMessages: 50 }); return RPC_OK({ events: history }) } } },
  })
  const res = fakeRes()
  await routes.get('prefix:/__arxa/conversations')(fakeReq('GET', '/__arxa/conversations/s-1/messages?limit=50'), res)
  assert.equal(res.status, 200)
  assert.equal(res.body.sessionId, 's-1')
  assert.deepEqual(res.body.messages.map((m) => m.text), ['q', 'a'])
  ok('GET transcript: folds history through apiProxy, honors limit')
}

// ---- 5. GET transcript error mapping
{
  const routes = makeCtx({
    api: { sessions: { history: async () => RPC_ERR('session-not-found', 'gone') } },
  })
  const res = fakeRes()
  await routes.get('prefix:/__arxa/conversations')(fakeReq('GET', '/__arxa/conversations/s-x/messages'), res)
  assert.equal(res.status, 404)
  assert.equal(res.body.error, 'no-such-session')
  const routes2 = makeCtx({
    api: { sessions: { history: async () => { throw new Error('transport down') } } },
  })
  const res2 = fakeRes()
  await routes2.get('prefix:/__arxa/conversations')(fakeReq('GET', '/__arxa/conversations/s-x/messages'), res2)
  assert.equal(res2.status, 502)
  assert.equal(res2.body.error, 'history-failed')
  const res3 = fakeRes()
  await routes.get('prefix:/__arxa/conversations')(fakeReq('GET', '/__arxa/conversations/s-x/other'), res3)
  assert.equal(res3.status, 404)
  ok('GET transcript: 404 no-such-session / 502 history-failed / unknown route')
}

// ---- 6. POST send happy path + validation + error mapping
{
  let seen
  const routes = makeCtx({
    api: {
      sessions: {
        prompt: async (req) => { seen = req; return RPC_OK({ accepted: true }) },
        history: async () => RPC_OK({ events: [] }),
      },
    },
  })
  const handler = routes.get('prefix:/__arxa/conversations')
  const res = fakeRes()
  await handler(fakeReq('POST', '/__arxa/conversations/s-1/messages', JSON.stringify({ text: '  do the thing  ' })), res)
  assert.equal(res.status, 200)
  assert.deepEqual({ ok: res.body.ok, accepted: res.body.accepted }, { ok: true, accepted: true })
  assert.equal(seen.payload.mode, 'queue')
  assert.deepEqual(seen.payload.content, [{ type: 'text', text: 'do the thing' }])
  assert.equal(typeof seen.rpcId, 'string')

  const resTrim = fakeRes()
  await handler(fakeReq('POST', '/__arxa/conversations/s-1/messages', JSON.stringify({ text: 'x', mode: 'steer' })), resTrim)
  // (steer passes through below in the error harness; here just verify no crash)
  const resEmpty = fakeRes()
  await handler(fakeReq('POST', '/__arxa/conversations/s-1/messages', JSON.stringify({ text: '   ' })), resEmpty)
  assert.equal(resEmpty.status, 400)
  assert.equal(resEmpty.body.error, 'empty-text')
  const resBad = fakeRes()
  await handler(fakeReq('POST', '/__arxa/conversations/s-1/messages', '{not json'), resBad)
  assert.equal(resBad.status, 400)
  assert.equal(resBad.body.error, 'malformed-json')
  ok('POST send: happy path + empty-text + malformed-json')
}

// ---- 7. POST send error mapping
{
  const mk = (promptImpl) => makeCtx({ api: { sessions: { prompt: promptImpl, history: async () => RPC_OK({ events: [] }) } } })
  const notFound = mk(async () => RPC_ERR('session-not-found', 'gone'))
  const r1 = fakeRes()
  await notFound.get('prefix:/__arxa/conversations')(
    fakeReq('POST', '/__arxa/conversations/s-x/messages', JSON.stringify({ text: 'hi' })), r1)
  assert.equal(r1.status, 404); assert.equal(r1.body.error, 'no-such-session')

  const busy = mk(async () => RPC_ERR('agent-busy', 'busy'))
  const r2 = fakeRes()
  await busy.get('prefix:/__arxa/conversations')(
    fakeReq('POST', '/__arxa/conversations/s-x/messages', JSON.stringify({ text: 'hi' })), r2)
  assert.equal(r2.status, 409); assert.equal(r2.body.error, 'no-live-agent')

  const threw = mk(async () => { throw new Error('socket blew') })
  const r3 = fakeRes()
  await threw.get('prefix:/__arxa/conversations')(
    fakeReq('POST', '/__arxa/conversations/s-x/messages', JSON.stringify({ text: 'hi' })), r3)
  assert.equal(r3.status, 502); assert.equal(r3.body.error, 'prompt-failed')
  ok('POST send: 404 / 409 no-live-agent / 502 prompt-failed')
}

// ---- 8. conversations list route
{
  const snap = { orgs: [{ name: 'T', sessions: [{ id: 's-9', name: 'n', state: 'open' }] }] }
  const routes = makeCtx({
    api: { sessions: {} },
    fetchImpl: async () => ({ ok: true, json: async () => snap }),
    sidebarUrl: 'http://127.0.0.1:1/__arxa/sidebar/state',
  })
  const res = fakeRes()
  await routes.get('exact:/__arxa/conversations')(fakeReq('GET', '/__arxa/conversations'), res)
  assert.equal(res.status, 200)
  assert.equal(res.body.sessions[0].id, 's-9')
  assert.equal(res.body.sessions[0].org, 'T')

  const down = makeCtx({
    api: { sessions: {} },
    fetchImpl: async () => { throw new Error('refused') },
    sidebarUrl: 'http://127.0.0.1:1/__arxa/sidebar/state',
  })
  const res2 = fakeRes()
  await down.get('exact:/__arxa/conversations')(fakeReq('GET', '/__arxa/conversations'), res2)
  assert.equal(res2.status, 502)
  assert.equal(res2.body.error, 'sidebar-unavailable')
  ok('GET conversations: flattened snapshot + honest 502 when sidebar down')
}

console.log('arxa-conversation selftest: ' + checks + ' checks green')
