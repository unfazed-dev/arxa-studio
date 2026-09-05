// arxa-approvals exit checks (grill D60–D68; 2026-09-05 amendment: dsh
// 0.1.2-rc.1 removed apiProxy, so the fakes model the typert gateway's
// $events world — waterfall frames, cancel frames, $events/result):
// a `user-questions/request` waterfall frame becomes a cairn-row-shaped
// approval record; the $events replay of a known id never re-doors; a
// cancel frame (someone answered / ask aborted) deletes; decide
// shape-checks are the whole fence now; the routes serve the list and
// answer through '$events/result' with first-claimant-wins (a decide whose
// delivery was cancelled → not-pending 409); the doorbell fires on first
// sight only and never throws; jobs ride the jobs registry's
// onJobsChanged snapshots.
// Run: node plugins/approvals/selftest.mjs  (also rides scripts/ci.mjs)

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import {
  apply,
  approvalRecord,
  decideEnvelope,
  foldFrame,
  foldJobsFrame,
  mirrorOutBody,
  mirrorOutConfig,
} from './lib/index.js'

const QUESTIONS = [
  {
    id: 'q1',
    question: 'Approve the deploy?',
    header: 'Deploy',
    options: [
      { label: 'Approve', description: 'ship it' },
      { label: 'Deny', description: 'hold' },
    ],
  },
]

// The $events wire shape (dsh-api-gateway openRemoteEvents → deliverRemoteEvent):
// {type:'waterfall', event, eventId, agentId, request} — the projected
// user-questions request carries `questions` (agent/signal stripped); the
// agentId IS the asking session.
const QUESTION_FRAME = (eventId, sessionId = 'sess-1') => ({
  type: 'waterfall',
  event: 'user-questions/request',
  eventId,
  agentId: sessionId,
  request: { questions: QUESTIONS.map((q) => ({ ...q })) },
})

const CANCEL_FRAME = (eventId) => ({ type: 'cancel', eventId })

const JOB = (id, status) => ({ id, kind: 'bash', label: 'job', status, startedAt: 1 })

/** The fake typert gateway shared by every apply() harness. Models the REAL
 * TypertGatewayService surface this plugin touches — including that
 * openWireStream is an async METHOD returning a PROMISE of the generation's
 * async iterator (dsh-api-gateway :581; the boot smoke caught the plugin
 * feeding that promise straight into for-await, so the fake keeps the exact
 * shape): ready frame first, then frames, the generation held open until
 * abort. dispatchRpc('$events/result', …) → {ok:true}; the gateway's
 * first-wins settle is modelled by feeding CANCEL_FRAMEs for anything the
 * "browser" already answered. */
const fakeGateway = (frames = [], dispatchLog = []) => ({
  openWireStream: async (endpoint, payload, signal) => {
    assert.equal(endpoint, '$events')
    assert.deepEqual(payload, { args: {} })
    return (async function* () {
      yield { type: 'ready', clientId: 'client-1', host: { home: '/tmp/arxa-test' } }
      for (const frame of frames) yield frame
      await new Promise((resolve) => {
        if (signal?.aborted) return resolve()
        signal?.addEventListener?.('abort', () => resolve(), { once: true })
      })
    })()
  },
  dispatchRpc: async (endpoint, message) => {
    assert.equal(endpoint, '$events/result')
    dispatchLog.push(message)
    return { ok: true, value: undefined }
  },
})

// 1. Projection: a requested frame → a cairn-row-shaped record (D61/D64).
{
  const record = approvalRecord(QUESTION_FRAME('rpc-1'), 1000)
  assert.deepEqual(Object.keys(record).sort(), [
    'id', 'kind', 'questions', 'raised_at', 'session_id', 'status', 'summary',
  ])
  assert.equal(record.id, 'rpc-1')
  assert.equal(record.session_id, 'sess-1')
  assert.equal(record.kind, 'approval')
  assert.equal(record.summary, 'Approve the deploy?')
  assert.equal(record.status, 'pending')
  assert.equal(record.raised_at, 1000)
  assert.equal(record.questions.length, 1)
}

// 2. Folding: first sight doors; the $events replay of the same eventId does
//    NOT; cancel deletes; foreign frames (other waterfall events, emits)
//    are ignored.
{
  const pending = new Map()
  const first = foldFrame(pending, QUESTION_FRAME('rpc-2'), 2000)
  assert.ok(first, 'first sight returns the record to door')
  const replay = foldFrame(pending, QUESTION_FRAME('rpc-2'), 3000)
  assert.equal(replay, undefined, 'replay must not re-door')
  assert.equal(pending.get('rpc-2').raised_at, 2000, 'replay keeps the original raised_at')
  foldFrame(pending, { type: 'emit', event: 'api-session/added', args: [] })
  assert.equal(pending.size, 1, 'emit frames are not approvals')
  foldFrame(pending, { type: 'waterfall', event: 'approval/request', eventId: 'ap-1', agentId: 'sess-1', request: {} })
  assert.equal(pending.size, 1, 'the sandbox-approval seam is not an arxa approval (D63)')
  foldFrame(pending, CANCEL_FRAME('rpc-2'))
  assert.equal(pending.size, 0, 'cancel deletes the record')
}

// 2b. Task folding: jobs.onJobsChanged snapshots ring ONLY first-sight
//     terminal ids; running/stopping never ring; killed maps to failed;
//     non-arrays are ignored.
{
  const announced = new Set()
  assert.deepEqual(foldJobsFrame(announced, [JOB('j1', 'running'), JOB('j2', 'stopping')]), [])
  assert.deepEqual(foldJobsFrame(announced, undefined), [], 'no snapshot, no fold')
  assert.deepEqual(
    foldJobsFrame(announced, [JOB('j1', 'running'), JOB('j1b', 'completed'), JOB('j1c', 'failed'), JOB('j1d', 'killed')]),
    [
      { id: 'j1b', outcome: 'completed' },
      { id: 'j1c', outcome: 'failed' },
      { id: 'j1d', outcome: 'failed' },
    ],
  )
  // Last-wins replay of the same snapshot must not re-buzz.
  assert.deepEqual(foldJobsFrame(announced, [JOB('j1b', 'completed')]), [])
  // A job that completes while unobserved rings on first terminal sight.
  assert.deepEqual(foldJobsFrame(new Set(), [JOB('late', 'completed')]), [{ id: 'late', outcome: 'completed' }])
}

// 3. decideEnvelope: a legal approval becomes the exact $events/result value
//    the browser question composer resolves the waterfall with; shape
//    violations fail with honest errors.
{
  const record = approvalRecord(QUESTION_FRAME('rpc-3'), 4000)
  const good = decideEnvelope(record, { id: 'rpc-3', answers: [{ id: 'q1', selected: ['Approve'] }] })
  assert.equal(good.ok, true)
  assert.deepEqual(good.value, { answers: [{ id: 'q1', selected: ['Approve'] }] })
  const custom = decideEnvelope(record, { id: 'rpc-3', answers: [{ id: 'q1', selected: [], custom: 'later' }] })
  assert.equal(custom.ok, true)
  assert.equal(custom.value.answers[0].custom, 'later')
  assert.equal(decideEnvelope(record, { id: 'rpc-3', answers: [] }).error, 'every-question-must-be-answered')
  assert.equal(
    decideEnvelope(record, { id: 'rpc-3', answers: [{ id: 'q1', selected: ['Maybe'] }] }).error,
    'unknown-option-label',
  )
  assert.equal(
    decideEnvelope(record, { id: 'rpc-3', answers: [{ id: 'q1', selected: ['Approve', 'Deny'] }] }).error,
    'single-select-allows-one',
  )
  assert.equal(
    decideEnvelope(record, { id: 'rpc-3', answers: [{ id: 'q1', selected: ['Approve'], custom: 'x' }] }).error,
    'single-select-cannot-combine-custom-and-selection',
  )
}

// 4. apply(): fake engine — $events frames flow in (with the ready frame
//    that names this generation's client), routes serve the projection,
//    decide → '$events/result' with first-claimant-wins, doorbell
//    first-sight, jobs ring through onJobsChanged snapshots.
{
  // The fake jobs registry (dsh-jobs-local's host face): onJobsChanged
  // captures the listener and returns a disposer; list answers snapshots.
  const jobsSnapshots = new Map()
  let jobsListener = null
  const jobs = {
    onJobsChanged: (listener) => { jobsListener = listener; return () => { jobsListener = null } },
    list: (owner) => jobsSnapshots.get(owner.id) ?? [],
  }

  const frames = [
    QUESTION_FRAME('rpc-4'),
    QUESTION_FRAME('rpc-4'), // replay must not re-door
    QUESTION_FRAME('rpc-5', 'sess-2'),
    // The "browser" answers rpc-5 first: the gateway settles it once and
    // cancels OUR delivery — the phone's later decide must find nothing.
    CANCEL_FRAME('rpc-5'),
  ]
  const responded = []
  const doorbelled = []
  const taskDoorbelled = []
  const routes = new Map()
  const resFor = () => {
    const res = { status: 0, body: '' }
    let resolveDone
    res.done = new Promise((resolve) => { resolveDone = resolve })
    res.writeHead = (status) => { res.status = status }
    res.end = (body) => { res.body = JSON.parse(body); resolveDone() }
    return res
  }
  const reqWith = (body) => {
    const req = new EventEmitter()
    req.url = '/__arxa/approvals/action'
    req.on = (event, listener) => {
      EventEmitter.prototype.on.call(req, event, listener)
      return req
    }
    process.nextTick(() => {
      req.emit('data', body ?? '')
      req.emit('end')
    })
    return req
  }
  const ctx = {
    typertGateway: fakeGateway(frames, responded),
    get: (name) => (name === 'jobs' ? jobs : undefined),
    webServer: {
      register: (route) => routes.set(route.path, route.handler),
    },
    // The real ctx.effect runs its callback at registration (the cordis
    // Fiber effect contract) — the jobs rail registers through it, so the
    // fake must invoke the callback, not just accept it.
    effect: (fn) => {
      const dispose = typeof fn === 'function' ? fn() : undefined
      return () => { if (typeof dispose === 'function') dispose() }
    },
  }
  apply(ctx, {
    doorbell: (record) => doorbelled.push(record.id),
    taskDoorbell: (finished) => taskDoorbelled.push(finished),
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  // The jobs rail: same last-wins snapshot sequence the old session/jobs
  // frames carried, now delivered by onJobsChanged(owner).
  jobsSnapshots.set('sess-1', [{ id: 'job-a', kind: 'bash', label: 'a', status: 'running', startedAt: 1 }])
  jobsListener({ id: 'sess-1' })
  jobsSnapshots.set('sess-1', [
    { id: 'job-a', kind: 'bash', label: 'a', status: 'completed', startedAt: 1, finishedAt: 2 },
    { id: 'job-b', kind: 'bash', label: 'b', status: 'failed', startedAt: 1, finishedAt: 3 },
  ])
  jobsListener({ id: 'sess-1' })
  jobsSnapshots.set('sess-1', [{ id: 'job-a', kind: 'bash', label: 'a', status: 'completed', startedAt: 1, finishedAt: 2 }])
  jobsListener({ id: 'sess-1' })

  const listRes = resFor()
  await routes.get('/__arxa/approvals')({}, listRes)
  assert.equal(listRes.status, 200)
  assert.deepEqual(listRes.body.approvals.map((a) => a.id), ['rpc-4'], 'oldest first; the cancelled rpc-5 is gone')
  assert.deepEqual(doorbelled, ['rpc-4', 'rpc-5'], 'doorbell fires once per pending, replay excluded')
  assert.deepEqual(taskDoorbelled, [
    { id: 'job-a', outcome: 'completed' },
    { id: 'job-b', outcome: 'failed' },
  ], 'task doorbell fires once per terminal job, running and replay excluded')

  const decided = resFor()
  await routes.get('/__arxa/approvals/action')(reqWith(JSON.stringify({
    action: 'decide',
    arg: { id: 'rpc-4', answers: [{ id: 'q1', selected: ['Approve'] }] },
  })), decided)
  await decided.done
  assert.equal(decided.status, 200)
  assert.equal(decided.body.ok, true)
  assert.equal(responded.length, 1)
  assert.deepEqual(responded[0], {
    clientId: 'client-1',
    eventId: 'rpc-4',
    outcome: { kind: 'result', value: { answers: [{ id: 'q1', selected: ['Approve'] }] } },
  }, 'decide settles through the exact $events/result wire shape')

  const listAfter = resFor()
  await routes.get('/__arxa/approvals')({}, listAfter)
  assert.deepEqual(listAfter.body.approvals.map((a) => a.id), [], 'decided approval leaves the list immediately')

  const lost = resFor()
  await routes.get('/__arxa/approvals/action')(reqWith(JSON.stringify({
    action: 'decide',
    arg: { id: 'rpc-5', answers: [{ id: 'q1', selected: ['Deny'] }] },
  })), lost)
  await lost.done
  assert.equal(lost.status, 409, 'a cancelled delivery (the browser answered first) is a conflict')
  assert.equal(lost.body.error, 'not-pending')

  const unknown = resFor()
  await routes.get('/__arxa/approvals/action')(reqWith(JSON.stringify({ action: 'decide', arg: { id: 'gone' } })), unknown)
  await unknown.done
  assert.equal(unknown.status, 409)

  const badAction = resFor()
  await routes.get('/__arxa/approvals/action')(reqWith(JSON.stringify({ action: 'nonsense' })), badAction)
  await badAction.done
  assert.equal(badAction.status, 400)
}

// 5. cairn sync proxy end-to-end on loopback (B2 phase-1b): a REAL fake
//    mirror (http server) and the captured handlers mounted on bare
//    servers. HTTP passes through prefix-stripped with headers and body
//    verbatim; the /sync upgrade splices raw bytes both directions; a dead
//    mirror is an honest 502, never a hang.
{
  const http = (await import('node:http')).default
  const crypto = (await import('node:crypto')).default

  // -- the fake mirror --
  const mirrorSeen = { healthz: null, post: null, upgradePath: null }
  const mirror = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      mirrorSeen.healthz = req.url
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    if (req.url === '/push-tokens') {
      let raw = ''
      req.on('data', (c) => { raw += c })
      req.on('end', () => {
        mirrorSeen.post = { url: req.url, auth: req.headers.authorization, body: raw }
        res.writeHead(202, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
  mirror.on('upgrade', (req, socket, head) => {
    mirrorSeen.upgradePath = req.url
    const accept = crypto.createHash('sha1')
      .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64')
    socket.write('HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: ' + accept + '\r\n\r\n')
    if (head.length) socket.write(head)
    socket.on('data', (d) => socket.write(d)) // echo server: the raw-splice proof
  })
  await new Promise((resolve) => mirror.listen(0, '127.0.0.1', resolve))
  const mirrorPort = mirror.address().port

  // -- apply() against a fake ctx carrying both registration tables --
  const routes2 = new Map()
  const upgrades = new Map()
  const ctx2 = {
    typertGateway: fakeGateway(),
    webServer: {
      register: (route) => routes2.set(route.path, route.handler),
      registerUpgrade: (route) => upgrades.set(route.path, route.handler),
    },
    effect: () => () => {},
  }
  apply(ctx2, {
    env: { ARXA_CAIRN_MIRROR_BIND: '127.0.0.1:' + mirrorPort },
    doorbell: () => {},
    taskDoorbell: () => {},
    cairnSyncToken: async () => 'bootstrap-tok',
  })
  assert.ok(routes2.has('/__cairn'), 'the HTTP prefix leg is registered')
  assert.ok(upgrades.has('/__cairn/sync'), 'the upgrade leg is registered')

  // mount the captured handlers on bare servers (the webserver's job)
  const mount = http.createServer((req, res) => { routes2.get('/__cairn')(req, res) })
  mount.on('upgrade', (req, socket, head) => { upgrades.get('/__cairn/sync')(req, socket, head) })
  await new Promise((resolve) => mount.listen(0, '127.0.0.1', resolve))
  const mountPort = mount.address().port
  const base = 'http://127.0.0.1:' + mountPort

  // 5a. GET passes through prefix-stripped.
  {
    const res = await fetch(base + '/__cairn/healthz')
    const body = await res.json()
    assert.equal(res.status, 200)
    assert.deepEqual(body, { ok: true })
    assert.equal(mirrorSeen.healthz, '/healthz', 'prefix stripped')
  }
  // 5b. POST: authorization + body verbatim (push-tokens shape).
  {
    const res = await fetch(base + '/__cairn/push-tokens', {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'dev-token', platform: 'ios' }),
    })
    assert.equal(res.status, 202)
    assert.equal(mirrorSeen.post.auth, 'Bearer test-secret', 'bearer passes verbatim')
    assert.equal(mirrorSeen.post.url, '/push-tokens')
    assert.ok(mirrorSeen.post.body.includes('dev-token'))
  }
  // 5c. The /sync upgrade splices raw bytes both directions (echo proof).
  {
    const echo = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port: mountPort,
        path: '/__cairn/sync',
        headers: {
          connection: 'Upgrade',
          upgrade: 'websocket',
          'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'sec-websocket-version': '13',
        },
      })
      req.on('upgrade', (res2, socket) => {
        socket.on('data', function onData(d) {
          socket.off('data', onData)
          resolve({ status: res2.statusCode, echo: d.toString('utf8') })
          socket.end()
        })
        socket.write('splice-ping')
      })
      req.on('response', (res2) => reject(new Error('got plain response ' + res2.statusCode)))
      req.on('error', reject)
      req.end()
    })
    assert.equal(echo.status, 101, 'mirror 101 relayed')
    assert.equal(mirrorSeen.upgradePath, '/sync', 'upgrade path stripped')
    assert.equal(echo.echo, 'splice-ping', 'raw bytes round-trip the splice')
  }
  // 5d. Dead mirror: an honest 502, not a hang or a throw.
  {
    const dead = http.createServer(() => {})
    await new Promise((resolve) => dead.listen(0, '127.0.0.1', resolve))
    const deadPort = dead.address().port
    dead.close()
    const routes3 = new Map()
    const deadCtx = {
      typertGateway: fakeGateway(),
      webServer: {
        register: (route) => routes3.set(route.path, route.handler),
        registerUpgrade: () => () => {},
      },
      effect: () => () => {},
    }
    apply(deadCtx, { env: { ARXA_CAIRN_MIRROR_BIND: '127.0.0.1:' + deadPort }, doorbell: () => {}, taskDoorbell: () => {} })
    const deadMount = http.createServer((req, res) => { routes3.get('/__cairn')(req, res) })
    await new Promise((resolve) => deadMount.listen(0, '127.0.0.1', resolve))
    const deadRes = await fetch('http://127.0.0.1:' + deadMount.address().port + '/__cairn/healthz')
    assert.equal(deadRes.status, 502, 'unreachable mirror is a 502')
    assert.deepEqual(await deadRes.json(), { error: 'cairn-sidecar-unreachable' })
    await new Promise((resolve) => deadMount.close(resolve))
  }

  // 5e. The bootstrap route: a configured seam returns the sync bearer,
  //     an unconfigured one 404s (the phone then boots localOnly).
  {
    const fakeRes = () => {
      const res = { status: 0, body: null }
      let resolveDone
      res.done = new Promise((resolve) => { resolveDone = resolve })
      res.writeHead = (status) => { res.status = status }
      res.end = (body) => { res.body = JSON.parse(body); resolveDone() }
      return res
    }
    const okRes = fakeRes()
    await routes2.get('/__arxa/cairn-sync')({}, okRes)
    await okRes.done
    assert.equal(okRes.status, 200)
    assert.deepEqual(okRes.body, { token: 'bootstrap-tok' })

    const noneCtx = {
      typertGateway: fakeGateway(),
      webServer: {
        register: (route) => routes4.set(route.path, route.handler),
        registerUpgrade: () => () => {},
      },
      effect: () => () => {},
    }
    const routes4 = new Map()
    apply(noneCtx, {
      env: { ARXA_CAIRN_MIRROR_BIND: '127.0.0.1:' + mirrorPort },
      doorbell: () => {},
      taskDoorbell: () => {},
      cairnSyncToken: async () => null,
    })
    const noneRes = fakeRes()
    await routes4.get('/__arxa/cairn-sync')({}, noneRes)
    await noneRes.done
    assert.equal(noneRes.status, 404)
    assert.deepEqual(noneRes.body, { error: 'cairn-sync-not-configured' })
  }

  // Close ALL connections, not just the listeners: the fetch keep-alive
  // sockets (and any half-drained splice socket) would otherwise hold the
  // process open for the server keep-alive timeout — and an unlucky race
  // could hold it forever (caught flaky 2026-08-30).
  mirror.closeAllConnections?.()
  mount.closeAllConnections?.()
  mirror.close()
  mount.close()
}

// Every assertion above passed — exit explicitly so a leaked handle can
// never turn a green suite into a CI hang.
// 6. mirror-out writer (B2 phase-1b, gated): config gate literalism, the
//    ingest body shape (org_id tenant tag), and the fold→writer wiring —
//    exactly one POST body per folded record, gated off by default.
{
  const noLib = async () => { throw new Error("no keystore in tests") }
  assert.deepEqual(await mirrorOutConfig({}, undefined, noLib),
      { enabled: false, ingestUrl: 'http://127.0.0.1:8190/ingest' },
      'gate is OFF unless the literal env speaks')
  assert.equal((await mirrorOutConfig({ ARXA_MIRROR_OUT: 'true' }, undefined, noLib)).enabled, true)
  assert.equal(
    (await mirrorOutConfig({ ARXA_MIRROR_OUT: 'true', ARXA_CAIRN_MIRROR_BIND: '127.0.0.1:9999' }, undefined, noLib)).ingestUrl,
    'http://127.0.0.1:9999/ingest',
    'bind override flows into the ingest URL',
  )
  const record = approvalRecord(QUESTION_FRAME('rpc-7'), 5000)
  const body = mirrorOutBody(record)
  assert.deepEqual(body.events, [{
    table: 'approvals', op: 'upsert',
    row: { ...record, org_id: 'local' },
  }], 'one upsert event, row tagged with the tenant the doorbell hint needs')

  // fold → writer wiring: with the gate on, every folded record reaches the
  // writer exactly once; the gate-off path never calls it.
  const routes5 = new Map()
  const mirrorOutSeen = []
  const mirrorOutCtx = {
    typertGateway: fakeGateway([QUESTION_FRAME('rpc-8')]),
    webServer: { register: (route) => routes5.set(route.path, route.handler) },
    effect: () => () => {},
  }
  apply(mirrorOutCtx, {
    env: { ARXA_MIRROR_OUT: 'true' },
    doorbell: () => {},
    taskDoorbell: () => {},
    cairnSyncToken: async () => null,
    mirrorOut: (rec) => mirrorOutSeen.push(rec),
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(mirrorOutSeen.map((x) => x.id), ['rpc-8'], 'fold reaches the writer once')

  // Gate-off case: NO mirrorOut seam and a rejecting keystore loader — the
  // real path must never reach fetch (and never touch the real keystore).
  let fetchCalls = 0
  const origFetch = globalThis.fetch
  globalThis.fetch = (...args) => { fetchCalls += 1; return origFetch(...args) }
  const quietCtx = {
    typertGateway: fakeGateway([QUESTION_FRAME('rpc-9')]),
    webServer: { register: (route) => routes5.set(route.path, route.handler) },
    effect: () => () => {},
  }
  apply(quietCtx, { doorbell: () => {}, taskDoorbell: () => {}, loadLib: async () => { throw new Error("no keystore in tests") } })
  await new Promise((resolve) => setTimeout(resolve, 20))
  globalThis.fetch = origFetch
  assert.equal(fetchCalls, 0, 'gate off → the writer is never invoked')
}

console.log('arxa-approvals selftest: 6 checks green')
process.exit(0)
