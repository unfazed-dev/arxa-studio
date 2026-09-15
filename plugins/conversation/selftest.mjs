// arxa-conversation selftest — pure node, network-free (same discipline as
// plugins/approvals/selftest.mjs). 2026-09-05 amendment: dsh 0.1.2-rc.1
// removed apiProxy — the fakes model the successor surface (the
// sessionController service called in-process, throwing RemoteError-code
// errors; host session/event + api-session/* listeners; the typert
// gateway's $events feed for question pings).
// Run: node plugins/conversation/selftest.mjs
import { strict as assert } from 'node:assert'
import { foldHistory, foldMode, flattenSidebar, foldSessionEvent, SESSIONS_PING_EVENTS, renderTranscriptMarkdown, withRunning, apply } from './lib/index.js'

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
// The fake sessionController: plain methods, RemoteError-shaped rejections
// ({code: 'session/…'} — the real service throws dsh-typert-protocol
// RemoteErrors; only .code and .message matter to the routes).
const remoteError = (code, message = code) => { const e = new Error(message); e.code = code; return e }
const makeCtx = ({ sessionController, gateway, fetchImpl, sidebarUrl, agents, commands }) => {
  // Two tables, mirroring the real webserver: exact and prefixes are
  // separate Maps — a path may exist in both (list + per-session here).
  // `fire` drives the host-event listeners the live rail registers on ctx.
  const routes = new Map()
  const listeners = new Map()
  const ctx = {
    webServer: { register: (r) => routes.set(r.kind + ':' + r.path, r.handler) },
    on: (name, cb) => {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(cb)
      return () => listeners.get(name)?.delete(cb)
    },
  }
  routes.fire = (name, ...args) => { for (const cb of [...(listeners.get(name) ?? [])]) cb(...args) }
  apply(ctx, { sessionController, typertGateway: gateway, httpImpl: fetchImpl, sidebarUrl, agents, commands })
  return routes
}
// The fake typert gateway's $events carrier (the question-ping rail) —
// faithful to the REAL surface: openWireStream is an async METHOD returning
// a PROMISE of the generation's async iterator (dsh-api-gateway :581).
const gatewayOf = (frames = []) => ({
  openWireStream: async (endpoint, payload, signal) => {
    assert.equal(endpoint, '$events')
    assert.deepEqual(payload, { args: {} })
    return (async function* () {
      yield { type: 'ready', clientId: 'client-1', host: {} }
      for (const frame of frames) yield frame
      await new Promise((resolve) => {
        if (signal?.aborted) return resolve()
        signal?.addEventListener?.('abort', () => resolve(), { once: true })
      })
    })()
  },
})
const fakeRes = () => {
  const res = { status: null, body: null, raw: null, headers: null, writes: [] }
  // The route's end-callback is async and detaches from the handler call;
  // tests that assert on a POST's response await `settled` so the send
  // chain (now resume + prompt) finishes first.
  res.settled = new Promise((r) => { res._settle = r })
  res.writeHead = (s, h) => { res.status = s; res.headers = h }
  res.end = (b) => {
    res.raw = b
    try { res.body = JSON.parse(b) } catch { res.body = undefined }
    res._settle()
  }
  res.write = (c) => { res.writes.push(c) }
  return res
}
const fakeReq = (method, url, body) => ({
  method, url,
  _close: null,
  on: (ev, cb) => {
    if (ev === 'data' && body != null) cb(body)
    if (ev === 'end') cb()
    if (ev === 'close') fakeReqCloseCbs.push(cb)
  },
})
const fakeReqCloseCbs = []

// ---- 4. GET transcript happy path
{
  const history = [
    { type: 'event', event: ev('user/message', 2, 110, 'q', USER) },
    { type: 'event', event: { type: 'assistant/message', seq: 5, time: 140, data: { message: { role: 'assistant', content: [{ type: 'text', text: 'a' }] } } } },
  ]
  const routes = makeCtx({
    sessionController: {
      page: async (request) => {
        assert.deepEqual(request, { address: { kind: 'session', sessionId: 's-1' }, throughSeq: -1, maxMessages: 50 })
        return { records: history, hasMore: false }
      },
    },
  })
  const res = fakeRes()
  await routes.get('prefix:/__arxa/conversations')(fakeReq('GET', '/__arxa/conversations/s-1/messages?limit=50'), res)
  assert.equal(res.status, 200)
  assert.equal(res.body.sessionId, 's-1')
  assert.deepEqual(res.body.messages.map((m) => m.text), ['q', 'a'])
  ok('GET transcript: folds a sessionController page, honors limit')
}

// ---- 5. GET transcript error mapping
{
  const routes = makeCtx({
    sessionController: { page: async () => { throw remoteError('session/not-found', 'gone') } },
  })
  const res = fakeRes()
  await routes.get('prefix:/__arxa/conversations')(fakeReq('GET', '/__arxa/conversations/s-x/messages'), res)
  assert.equal(res.status, 404)
  assert.equal(res.body.error, 'no-such-session')
  const routes2 = makeCtx({
    sessionController: { page: async () => { throw new Error('transport down') } },
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
    sessionController: {
      prompt: async (request) => { seen = request; return { accepted: true } },
      page: async () => ({ records: [], hasMore: false }),
    },
    // The send path resumes the agent before admitting the prompt (parked
    // sessions after an engine restart 502'd — 2026-09-14); give the fake a
    // live-agent resume.
    agents: { get: () => undefined, resume: async () => ({ agent: { session: {} } }) },
  })
  const handler = routes.get('prefix:/__arxa/conversations')
  const res = fakeRes()
  await handler(fakeReq('POST', '/__arxa/conversations/s-1/messages', JSON.stringify({ text: '  do the thing  ' })), res)
  await res.settled
  assert.equal(res.status, 200)
  assert.deepEqual({ ok: res.body.ok, accepted: res.body.accepted }, { ok: true, accepted: true })
  assert.equal(typeof seen.requestId, 'string')
  assert.equal(seen.sessionId, 's-1')
  assert.equal(seen.mode, 'queue')
  assert.deepEqual(seen.content, [{ type: 'text', text: 'do the thing' }])
  assert.equal(res.body.rpcId, seen.requestId, 'the phone gets back the requestId the Host echoes as rpcId')

  const resTrim = fakeRes()
  await handler(fakeReq('POST', '/__arxa/conversations/s-1/messages', JSON.stringify({ text: 'x', mode: 'steer' })), resTrim)
  // (steer passes through below in the error harness; here just verify no crash)
  const resEmpty = fakeRes()
  await handler(fakeReq('POST', '/__arxa/conversations/s-1/messages', JSON.stringify({ text: '   ' })), resEmpty)
  await resEmpty.settled
  assert.equal(resEmpty.status, 400)
  assert.equal(resEmpty.body.error, 'empty-text')
  const resBad = fakeRes()
  await handler(fakeReq('POST', '/__arxa/conversations/s-1/messages', '{not json'), resBad)
  await resBad.settled
  assert.equal(resBad.status, 400)
  assert.equal(resBad.body.error, 'malformed-json')
  ok('POST send: happy path + empty-text + malformed-json')
}

// ---- 7. POST send error mapping
{
  // Same live-agent resume as section 6 — the mapping under test is the
  // PROMPT's rejection, so hydration must succeed here.
  const liveAgents = { get: () => undefined, resume: async () => ({ agent: { session: {} } }) }
  const mk = (promptImpl) => makeCtx({ sessionController: { prompt: promptImpl, page: async () => ({ records: [], hasMore: false }) }, agents: liveAgents })
  const notFound = mk(async () => { throw remoteError('session/not-found', 'gone') })
  const r1 = fakeRes()
  await notFound.get('prefix:/__arxa/conversations')(
    fakeReq('POST', '/__arxa/conversations/s-x/messages', JSON.stringify({ text: 'hi' })), r1)
  await r1.settled
  assert.equal(r1.status, 404); assert.equal(r1.body.error, 'no-such-session')

  const busy = mk(async () => { throw remoteError('session/agent-busy', 'busy') })
  const r2 = fakeRes()
  await busy.get('prefix:/__arxa/conversations')(
    fakeReq('POST', '/__arxa/conversations/s-x/messages', JSON.stringify({ text: 'hi' })), r2)
  await r2.settled
  assert.equal(r2.status, 409); assert.equal(r2.body.error, 'no-live-agent')

  const threw = mk(async () => { throw new Error('socket blew') })
  const r3 = fakeRes()
  await threw.get('prefix:/__arxa/conversations')(
    fakeReq('POST', '/__arxa/conversations/s-x/messages', JSON.stringify({ text: 'hi' })), r3)
  await r3.settled
  assert.equal(r3.status, 502); assert.equal(r3.body.error, 'prompt-failed')
  ok('POST send: 404 / 409 no-live-agent / 502 prompt-failed')
}

// ---- 8. conversations list route
{
  const snap = { orgs: [{ name: 'T', sessions: [{ id: 's-9', name: 'n', state: 'open' }] }] }
  const routes = makeCtx({
    sessionController: {},
    fetchImpl: async () => ({ ok: true, json: async () => snap }),
    sidebarUrl: 'http://127.0.0.1:1/__arxa/sidebar/state',
  })
  const res = fakeRes()
  await routes.get('exact:/__arxa/conversations')(fakeReq('GET', '/__arxa/conversations'), res)
  assert.equal(res.status, 200)
  assert.equal(res.body.sessions[0].id, 's-9')
  assert.equal(res.body.sessions[0].org, 'T')

  const down = makeCtx({
    sessionController: {},
    fetchImpl: async () => { throw new Error('refused') },
    sidebarUrl: 'http://127.0.0.1:1/__arxa/sidebar/state',
  })
  const res2 = fakeRes()
  await down.get('exact:/__arxa/conversations')(fakeReq('GET', '/__arxa/conversations'), res2)
  assert.equal(res2.status, 502)
  assert.equal(res2.body.error, 'sidebar-unavailable')
  ok('GET conversations: flattened snapshot + honest 502 when sidebar down')
}

// ---- 9. mode fold + models/model/mode routes
{
  assert.equal(foldMode([]), null, 'no mode events -> null (deployment default)')
  const entries = [
    { event: { type: 'sandbox/mode', seq: 1, time: 1, data: { mode: 'read-only' } } },
    { event: { type: 'sandbox/mode', seq: 9, time: 2, data: { mode: 'danger-full-access' } } },
  ]
  assert.equal(foldMode(entries), 'danger-full-access', 'LAST sandbox/mode wins')
  ok('foldMode: last event wins, null when never switched')

  let catalogCalls = 0
  const routes = makeCtx({
    sessionController: {
      modelCatalog: async () => {
        catalogCalls += 1
        return { default: { provider: 'z', model: 'glm-5.2' }, routableProviders: ['z'], groups: [] }
      },
      prompt: async () => ({ accepted: true }),
      page: async () => ({ records: [], hasMore: false }),
    },
  })
  const handler = routes.get('prefix:/__arxa/conversations')
  const resM = fakeRes()
  await handler(fakeReq('GET', '/__arxa/conversations/s-1/models'), resM)
  assert.equal(resM.status, 200)
  assert.equal(catalogCalls, 1, 'the catalog is the Host-generation directory (no per-session call)')
  assert.equal(resM.body.default.model, 'glm-5.2')

  const resBad = fakeRes()
  await handler(fakeReq('POST', '/__arxa/conversations/s-1/mode', JSON.stringify({ mode: 'sudo' })), resBad)
  assert.equal(resBad.status, 400)
  assert.equal(resBad.body.error, 'unknown-mode')

  const appended = []
  const setRoutes = makeCtx({
    sessionController: {},
    agents: {
      // LIVE path: the session's agent is resident — its session appends directly.
      get: (id) => id === 's-1' ? { session: { append: (type, data) => { appended.push(['live', type, data]) } } } : undefined,
      // PARKED path: agents.resume hydrates the persisted session first.
      resume: async ({ resumeSessionId }) => {
        if (resumeSessionId === 's-2') {
          return { agent: { session: { append: (type, data) => { appended.push(['resumed', type, data]) } } } }
        }
        throw new Error(`session "${resumeSessionId}" not found in persistence`)
      },
    },
  })
  const setHandler = setRoutes.get('prefix:/__arxa/conversations')
  const resSet = fakeRes()
  await setHandler(fakeReq('POST', '/__arxa/conversations/s-1/mode', JSON.stringify({ mode: 'read-only' })), resSet)
  assert.equal(resSet.status, 200)
  assert.equal(resSet.body.mode, 'read-only')
  assert.deepEqual(appended[0], ['live', 'sandbox/mode', { mode: 'read-only' }], 'live session: mode event appended')

  const resParked = fakeRes()
  await setHandler(fakeReq('POST', '/__arxa/conversations/s-2/mode', JSON.stringify({ mode: 'workspace-write' })), resParked)
  assert.equal(resParked.status, 200, 'a parked session hydrates and accepts the switch')
  assert.equal(resParked.body.mode, 'workspace-write')
  assert.deepEqual(appended[1], ['resumed', 'sandbox/mode', { mode: 'workspace-write' }], 'parked session: resumed then appended')

  const resGone = fakeRes()
  await setHandler(fakeReq('POST', '/__arxa/conversations/s-3/mode', JSON.stringify({ mode: 'read-only' })), resGone)
  assert.equal(resGone.status, 404)
  assert.equal(resGone.body.error, 'no-such-session')
  ok('model catalog + mode validation + mode set (live, parked, gone)')
}

// ---- 10. image attachments: fold carries ids, POST forwards parts, read route
{
  const rows = foldHistory([
    { event: { type: 'user/message', seq: 1, time: 1, data: {
        role: 'user', source: { kind: 'user' },
        content: [
          { type: 'text', text: 'look at this' },
          { type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/jpeg', bytes: 9, width: 2, height: 2 } },
          { type: 'image', attachment: { attachmentId: 'att-2', mediaType: 'image/png', bytes: 9, width: 2, height: 2 } },
        ] } } },
    { event: { type: 'user/message', seq: 2, time: 2, data: {
        role: 'user', source: { kind: 'user' },
        content: [{ type: 'image', attachment: { attachmentId: 'att-3', mediaType: 'image/jpeg', bytes: 9, width: 2, height: 2 } }] } } },
    { event: { type: 'user/message', seq: 3, time: 3, data: {
        role: 'user', source: { kind: 'context' }, content: [{ type: 'text', text: 'synthetic' }] } } },
  ])
  assert.equal(rows.length, 2, 'image-only user turns survive the fold; synthetic ones do not')
  assert.deepEqual(rows[0].images, ['att-1', 'att-2'], 'admitted attachment ids ride the row')
  assert.equal(rows[1].text, '')
  assert.deepEqual(rows[1].images, ['att-3'])
  assert.equal(rows[0].images === undefined ? 'undefined' : 'array', 'array')

  // POST /messages forwards image parts after the text part.
  let promptSeen
  const imgRoutes = makeCtx({
    sessionController: { prompt: async (request) => { promptSeen = request; return { accepted: true } } },
    agents: { get: () => undefined, resume: async () => ({ agent: { session: {} } }) },
  })
  const imgHandler = imgRoutes.get('prefix:/__arxa/conversations')
  const resImg = fakeRes()
  await imgHandler(fakeReq('POST', '/__arxa/conversations/s-1/messages', JSON.stringify({
    text: 'shot from the site',
    images: [{ mediaType: 'image/jpeg', data: 'aGVsbG8=' }],
  })), resImg)
  await resImg.settled
  assert.equal(resImg.status, 200)
  assert.deepEqual(promptSeen.content, [
    { type: 'text', text: 'shot from the site' },
    { type: 'image', mediaType: 'image/jpeg', data: 'aGVsbG8=' },
  ], 'image parts forwarded verbatim after the text')

  const resBadImg = fakeRes()
  await imgHandler(fakeReq('POST', '/__arxa/conversations/s-1/messages', JSON.stringify({
    text: 'x', images: [{ mediaType: 'image/jpeg' }],
  })), resBadImg)
  assert.equal(resBadImg.status, 400)
  assert.equal(resBadImg.body.error, 'malformed-image')

  // GET attachment proxies the controller; host refusals map honestly.
  const attRoutes = makeCtx({
    sessionController: { attachment: async (request) => {
      assert.deepEqual(request, { sessionId: 's-1', attachmentId: 'att-1' })
      return { attachment: { attachmentId: 'att-1', mediaType: 'image/jpeg' }, data: 'aGVsbG8=' }
    } },
  })
  const attHandler = attRoutes.get('prefix:/__arxa/conversations')
  const resAtt = fakeRes()
  await attHandler(fakeReq('GET', '/__arxa/conversations/s-1/attachments/att-1'), resAtt)
  assert.equal(resAtt.status, 200)
  assert.equal(resAtt.body.data, 'aGVsbG8=')

  const attRefused = makeCtx({
    sessionController: { attachment: async () => { throw remoteError('session/attachment-invalid', 'Image is not referenced by this session.') } },
  })
  const resAttRefused = fakeRes()
  await attRefused.get('prefix:/__arxa/conversations')(
    fakeReq('GET', '/__arxa/conversations/s-1/attachments/att-x'), resAttRefused)
  assert.equal(resAttRefused.status, 404)
  assert.equal(resAttRefused.body.error, 'attachment-not-found')
  ok('image attachments: fold ids + POST forward + attachment read (+ refused)')
}

// ---- 11. foldSessionEvent: the phone's live-rail filter (the host
//      session/event dispatch — no wire wrapper to unwrap anymore)
{
  assert.deepEqual(
    foldSessionEvent('arxa-s-1', 'user/message'),
    { type: 'session', sessionId: 'arxa-s-1', reason: 'user/message' })
  assert.deepEqual(
    foldSessionEvent('arxa-s-2', 'turn/end'),
    { type: 'session', sessionId: 'arxa-s-2', reason: 'turn/end' })
  assert.deepEqual(
    foldSessionEvent('arxa-s-1', 'question/requested'),
    { type: 'session', sessionId: 'arxa-s-1', reason: 'question/requested' },
    'question reasons stay phone surface (fed from the $events rail)')
  assert.equal(foldSessionEvent('s', 'assistant/chunk'), null, 'chunks never ping — the phone re-pulls the fold')
  assert.equal(foldSessionEvent('s', 'tool/call'), null)
  assert.equal(foldSessionEvent('s', 'request/header'), null)
  assert.equal(foldSessionEvent(null, 'turn/start'), null, 'no sessionId, no ping')
  assert.equal(foldSessionEvent('s', null), null)
  assert.equal(foldSessionEvent('s', ''), null)
  // the sessions-list pings: the api-session emits (session/projection's
  // successor) — membership, activity, running flag, failures.
  assert.deepEqual(SESSIONS_PING_EVENTS, [
    'api-session/added', 'api-session/removed', 'api-session/activity', 'api-session/status', 'api-session/error',
  ])
  ok('foldSessionEvent: surface moves ping, noise dropped, api-session list pings')
}

// ---- 12. renderTranscriptMarkdown: the export body
{
  const entries = [
    { event: ev('user/message', 1, 100, 'what changed', USER) },
    { event: { type: 'sandbox/mode', seq: 2, time: 1, data: { mode: 'workspace-write' } } },
    { event: ev('user/message', 3, 110, 'synthetic', PLUGIN) },
    { event: { type: 'assistant/message', seq: 4, time: 120, data: { message: { role: 'assistant', content: [{ type: 'text', text: 'the answer' }] } } } },
    { event: { type: 'user/message', seq: 5, time: 130, data: { role: 'user', source: { kind: 'user' }, content: [
      { type: 'image', attachment: { attachmentId: 'att-9', mediaType: 'image/jpeg', bytes: 1, width: 2, height: 2 } }] } } },
  ]
  const md = renderTranscriptMarkdown('arxa-s-1', entries, { mode: 'workspace-write' })
  assert.ok(md.startsWith('# arxa-s-1'), 'title line')
  assert.ok(md.includes('Sandbox mode: workspace-write'))
  assert.ok(md.includes('## user') && md.includes('what changed'))
  assert.ok(md.includes('## assistant') && md.includes('the answer'))
  assert.ok(md.includes('image: att-9'), 'image refs render as durable ids')
  assert.ok(!md.includes('synthetic'), 'non-human turns stay out')
  ok('renderTranscriptMarkdown: human surface + image ids + mode header')
}

// ---- 13. commands: list + execute (hydration, honest refusals)
{
  let listSeenAgent
  let execSeen
  const registry = {
    list: (agent) => { listSeenAgent = agent; return [{ name: 'compact', description: 'Compact older conversation history' }, { name: 'plan', description: 'Enter or leave plan mode' }] },
    execute: async (agent, line, images, signal) => {
      execSeen = { line, images }
      if (line === '/compact') return { commandId: 'c1', result: { kind: 'success', text: 'Compacted 3 history items (~1200 tokens).' } }
      if (line === '/nope') return undefined
      throw new Error('agent is running')
    },
  }
  const routes = makeCtx({
    sessionController: {},
    commands: registry,
    agents: {
      get: () => undefined,
      resume: async ({ resumeSessionId }) => {
        if (resumeSessionId === 's-1') return { agent: { session: { append: () => {} } } }
        throw new Error('session "s-404" not found in persistence')
      },
    },
  })
  const handler = routes.get('prefix:/__arxa/conversations')
  const resList = fakeRes()
  await handler(fakeReq('GET', '/__arxa/conversations/s-1/commands'), resList)
  assert.equal(resList.status, 200)
  assert.ok(listSeenAgent?.session, 'commands.list receives the hydrated agent')
  assert.equal(resList.body.commands[0].name, 'compact')

  const resRun = fakeRes()
  await handler(fakeReq('POST', '/__arxa/conversations/s-1/commands', JSON.stringify({ line: '/compact' })), resRun)
  assert.equal(resRun.status, 200)
  assert.equal(resRun.body.kind, 'success')
  assert.ok(resRun.body.text.includes('Compacted'))

  const resUnknown = fakeRes()
  await handler(fakeReq('POST', '/__arxa/conversations/s-1/commands', JSON.stringify({ line: '/nope' })), resUnknown)
  assert.equal(resUnknown.status, 400)
  assert.equal(resUnknown.body.error, 'unknown-command')

  const resBad = fakeRes()
  await handler(fakeReq('POST', '/__arxa/conversations/s-1/commands', JSON.stringify({ line: 'hello' })), resBad)
  assert.equal(resBad.status, 400)
  assert.equal(resBad.body.error, 'empty-line')

  const resBusy = fakeRes()
  await handler(fakeReq('POST', '/__arxa/conversations/s-1/commands', JSON.stringify({ line: '/plan' })), resBusy)
  assert.equal(resBusy.status, 502)
  assert.equal(resBusy.body.error, 'command-failed')
  assert.deepEqual(execSeen, { line: '/plan', images: [] }, 'execute rides the registry with no images')

  const resGone = fakeRes()
  await handler(fakeReq('GET', '/__arxa/conversations/s-404/commands'), resGone)
  assert.equal(resGone.status, 404)
  assert.equal(resGone.body.error, 'no-such-session')
  ok('commands: palette lists, execute answers, unknown 400, gone 404')
}

// ---- 14. export: markdown download route
{
  const history = [
    { type: 'event', event: ev('user/message', 1, 100, 'q', USER) },
    { type: 'event', event: { type: 'assistant/message', seq: 2, time: 110, data: { message: { role: 'assistant', content: [{ type: 'text', text: 'a' }] } } } },
  ]
  const routes = makeCtx({
    sessionController: { page: async (request) => {
      if (request.address.sessionId !== 's-1') throw remoteError('session/not-found', 'gone')
      assert.deepEqual(request, { address: { kind: 'session', sessionId: 's-1' }, throughSeq: -1, maxMessages: 1000 })
      return { records: history, hasMore: false }
    } },
  })
  const handler = routes.get('prefix:/__arxa/conversations')
  const res = fakeRes()
  await handler(fakeReq('GET', '/__arxa/conversations/s-1/export'), res)
  assert.equal(res.status, 200)
  assert.ok(String(res.headers['content-type']).includes('text/markdown'))
  assert.ok(String(res.headers['content-disposition']).includes('arxa-s-1.md'))
  assert.ok(String(res.raw).includes('## user'))
  const resGone = fakeRes()
  await routes.get('prefix:/__arxa/conversations')(fakeReq('GET', '/__arxa/conversations/s-x/export'), resGone)
  assert.equal(resGone.status, 404)
  ok('export: markdown download headers + 404 mapping')
}

// ---- 15. SSE: subscribe, receive hello + folded pings from BOTH rails
//      (host events AND the gateway $events question feed), clean detach
{
  const routes = makeCtx({
    sessionController: {},
    gateway: gatewayOf([
      // one question asked (waterfall frame) then answered elsewhere
      // (cancel frame) — the $events question rail's full lifecycle
      { type: 'waterfall', event: 'user-questions/request', eventId: 'ev-1', agentId: 'arxa-s-1', request: { questions: [] } },
      { type: 'cancel', eventId: 'ev-1' },
    ]),
  })
  const handler = routes.get('prefix:/__arxa/conversations')
  const req = fakeReq('GET', '/__arxa/conversations/events')
  const res = fakeRes()
  await handler(req, res)
  assert.equal(res.status, 200)
  assert.ok(String(res.headers['content-type']).includes('text/event-stream'))
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.ok(res.writes.some((w) => w.includes('hello')), 'hello announces the rail')
  assert.ok(res.writes.some((w) => w.includes('question/requested')), 'a user-questions waterfall frame pings the asking session')
  assert.ok(res.writes.some((w) => w.includes('question/resolved')), 'the cancel frame pings the resolution')
  // host-event rail: an api-session emit moves the list, a domain event
  // moves one conversation
  routes.fire('api-session/added', 'arxa-s-9')
  routes.fire('session/event', { id: 'arxa-s-1' }, { type: 'user/message', seq: 1, time: 1, data: {} })
  routes.fire('session/event', { id: 'arxa-s-1' }, { type: 'assistant/chunk', seq: 2, time: 2, data: {} })
  assert.ok(res.writes.some((w) => w.includes('"sessions"')), 'api-session emit pings the list')
  assert.ok(res.writes.some((w) => w.includes('"user/message"')), 'a surface move pings its session')
  assert.ok(!res.writes.some((w) => w.includes('"assistant/chunk"')), 'chunks stay filtered')
  for (const cb of fakeReqCloseCbs.splice(0)) cb()
  await new Promise((resolve) => setTimeout(resolve, 30))
  ok('SSE: hello + live ping fanout (both rails) + detach')
}

// ---- 16. foldHistory: thinking + tool surface (the phone's expandable rows)
{
  const entries = [
    { event: { type: 'user/message', seq: 1, time: 1, data: {
        role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] } } },
    { event: { type: 'assistant/message', seq: 2, time: 2, data: { message: { role: 'assistant', content: [
        { type: 'reasoning', text: 'Let me check the gate.' },
        { type: 'tool-call', callId: 'same-call-different-shape' },
        { type: 'text', text: 'Checking.' },
    ] } } } },
    { event: { type: 'tool/call', seq: 3, time: 3, data: {
        turn: 1, step: 1, callId: 'c9', name: 'ctx_batch_execute', arguments: '{"commands":["git status"]}' } } },
    { event: { type: 'tool/result', seq: 4, time: 4, data: { message: { role: 'user',
        source: { kind: 'tool', callId: 'c9' },
        content: [{ type: 'tool-result', toolCallId: 'c9', content: [{ type: 'text', text: 'On branch main' }], isError: false }] } } } },
    { event: { type: 'tool/call', seq: 5, time: 5, data: {
        turn: 2, step: 1, callId: 'c10', name: 'read', arguments: 'not json at all' } } },
    { event: { type: 'tool/result', seq: 6, time: 6, data: { message: { role: 'user',
        source: { kind: 'tool', callId: 'ghost' },
        content: [{ type: 'tool-result', toolCallId: 'ghost', content: [], isError: true }] } } } },
  ]
  const rows = foldHistory(entries, { sessionId: 'arxa-s-1' })
  assert.deepEqual(
    rows.map((r) => r.kind ?? 'user'),
    ['user', 'thinking', 'text', 'tool', 'tool'],
    'reasoning+text split into expandable rows; tool/call rows join them')
  assert.equal(rows[1].text, 'Let me check the gate.')
  assert.equal(rows[3].name, 'ctx_batch_execute')
  assert.equal(rows[3].input, '{\n  "commands": [\n    "git status"\n  ]\n}', 'arguments pretty-print')
  assert.equal(rows[3].text, 'On branch main', 'the paired result folds in as output')
  assert.equal(rows[3].error, false)
  assert.ok(rows[3].id.startsWith('arxa-s-1:3:'), 'ids are globally namespaced (cache + widget keys)')
  assert.equal(rows[4].input, 'not json at all', 'unparseable arguments ride raw')
  assert.equal(rows[4].text, undefined, 'a call with no result stays honestly pending')
  assert.equal(rows.length, new Set(rows.map((r) => r.id)).size, 'ids unique even across shared seqs')
  // legacy shape: no sessionId -> no ids (old callers unchanged)
  assert.equal('id' in foldHistory([{ event: { type: 'user/message', seq: 1, time: 1, data: {
    role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'x' }] } } }])[0], false)
  // long output is capped with an honest marker
  const longRows = foldHistory([
    { event: { type: 'tool/call', seq: 1, time: 1, data: { turn: 1, step: 1, callId: 'big', name: 'read', arguments: '{}' } } },
    { event: { type: 'tool/result', seq: 2, time: 2, data: { message: { role: 'user',
        source: { kind: 'tool', callId: 'big' },
        content: [{ type: 'tool-result', toolCallId: 'big', content: [{ type: 'text', text: 'x'.repeat(30000) }] }] } } } },
  ])
  assert.ok(longRows[0].text.length < 30000 && longRows[0].text.includes('truncated'), 'row text capped')
  ok('foldHistory kinds: thinking/tool rows, result pairing, ids, cap')
}

// ---- 17. withRunning: the sessions-list active flag
{
  const rows = [{ id: 'r1', dshSessionId: 'arxa-s-1' }, { id: 'r2', dshSessionId: 'arxa-s-2' }]
  const stamped = withRunning(rows, new Set(['arxa-s-1']))
  assert.equal(stamped[0].running, true)
  assert.equal(stamped[1].running, false)
  assert.equal(withRunning(rows, null)[0].running, false, 'null set -> all false')
  assert.equal(withRunning(undefined, new Set()).length, 0, 'null rows -> empty')
  assert.deepEqual(withRunning([{ id: 'x', dshSessionId: 42 }], new Set(['42']))[0].running, false, 'non-string id never matches')
  ok('withRunning: live-turn flag stamped per dsh session')
}

// ---- 18. boot-start tracking: the running set works with ZERO subscribers
//      (host session/event dispatch — no subscription stream involved)
{
  const snap = { orgs: [{ name: 'T', sessions: [{ id: 'live-1', name: 'n', state: 'open', dshSessionId: 'arxa-s-live' }] }] }
  const routes = makeCtx({
    sessionController: {},
    fetchImpl: async () => ({ ok: true, json: async () => snap }),
    sidebarUrl: 'http://127.0.0.1:1/__arxa/sidebar/state',
  })
  // no SSE subscribe anywhere in this block — the rail must run from boot
  routes.fire('session/event', { id: 'arxa-s-live' }, { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } })
  const res = fakeRes()
  await routes.get('exact:/__arxa/conversations')(fakeReq('GET', '/__arxa/conversations'), res)
  assert.equal(res.status, 200)
  assert.equal(res.body.sessions[0].running, true, 'turn tracked before any subscriber ever connected')
  routes.fire('session/event', { id: 'arxa-s-live' }, { type: 'turn/end', seq: 2, time: 2, data: { turn: 1 } })
  const res2 = fakeRes()
  await routes.get('exact:/__arxa/conversations')(fakeReq('GET', '/__arxa/conversations'), res2)
  assert.equal(res2.body.sessions[0].running, false, 'turn/end clears the flag')
  ok('boot-start tracking: running flips with zero subscribers; suite still exits')
}

console.log('arxa-conversation selftest: ' + checks + ' checks green')
