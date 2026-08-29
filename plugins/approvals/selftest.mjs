// arxa-approvals exit checks (grill D60–D68):
// a question/requested frame becomes a cairn-row-shaped approval record;
// the mux replay of a known id never re-doors; question/resolved deletes;
// decide shape-checks mirror the engine fence; the routes serve the list and
// answer through apiProxy.respond with first-claimant-wins (second decide →
// not-pending 409); the doorbell fires on first sight only and never throws.
// Run: node plugins/approvals/selftest.mjs  (also rides scripts/ci.mjs)

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import {
  apply,
  approvalRecord,
  decideEnvelope,
  foldFrame,
} from './lib/index.js'

const QUESTION_FRAME = (rpcId, sessionId = 'sess-1') => ({
  rpcId,
  payload: {
    type: 'question/requested',
    sessionId,
    questions: [
      {
        id: 'q1',
        question: 'Approve the deploy?',
        header: 'Deploy',
        options: [
          { label: 'Approve', description: 'ship it' },
          { label: 'Deny', description: 'hold' },
        ],
      },
    ],
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

// 2. Folding: first sight doors; the mux replay of the same rpcId does NOT;
//    resolved deletes; foreign frames are ignored.
{
  const pending = new Map()
  const first = foldFrame(pending, QUESTION_FRAME('rpc-2'), 2000)
  assert.ok(first, 'first sight returns the record to door')
  const replay = foldFrame(pending, QUESTION_FRAME('rpc-2'), 3000)
  assert.equal(replay, undefined, 'replay must not re-door')
  assert.equal(pending.get('rpc-2').raised_at, 2000, 'replay keeps the original raised_at')
  foldFrame(pending, { rpcId: 'x', payload: { type: 'session/event', sessionId: 'sess-1' } })
  assert.equal(pending.size, 1, 'session frames are not approvals')
  foldFrame(pending, { rpcId: 'rpc-2', payload: { type: 'question/resolved', sessionId: 'sess-1', outcome: 'answered' } })
  assert.equal(pending.size, 0, 'resolved deletes the record')
}

// 3. decideEnvelope: a legal approval becomes the exact respond message the
//    browser composer sends; shape violations fail with honest errors.
{
  const record = approvalRecord(QUESTION_FRAME('rpc-3'), 4000)
  const good = decideEnvelope(record, { id: 'rpc-3', answers: [{ id: 'q1', selected: ['Approve'] }] })
  assert.equal(good.ok, true)
  assert.deepEqual(good.message, {
    rpcId: 'rpc-3',
    result: {
      ok: true,
      value: {
        sessionId: 'sess-1',
        answer: { answers: [{ id: 'q1', selected: ['Approve'] }] },
      },
    },
  })
  const custom = decideEnvelope(record, { id: 'rpc-3', answers: [{ id: 'q1', selected: [], custom: 'later' }] })
  assert.equal(custom.ok, true)
  assert.equal(custom.message.result.value.answer.answers[0].custom, 'later')
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

// 4. apply(): fake engine — mux frames flow in, routes serve the projection,
//    decide → apiProxy.respond, first-claimant-wins, doorbell first-sight.
{
  const frames = []
  const responded = []
  const doorbelled = []
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
    apiProxy: {
      events: {
        mux: async function* () {
          yield QUESTION_FRAME('rpc-4')
          yield QUESTION_FRAME('rpc-4') // replay must not re-door
          yield QUESTION_FRAME('rpc-5', 'sess-2')
        },
      },
      respond: async (message) => {
        responded.push(message)
        return message.rpcId === 'rpc-4' ? { accepted: true } : { accepted: false, reason: 'not-pending' }
      },
    },
    webServer: {
      register: (route) => routes.set(route.path, route.handler),
    },
    effect: () => () => {},
  }
  apply(ctx, { doorbell: (record) => doorbelled.push(record.id) })
  await new Promise((resolve) => setTimeout(resolve, 20))

  const listRes = resFor()
  await routes.get('/__arxa/approvals')({}, listRes)
  assert.equal(listRes.status, 200)
  assert.deepEqual(listRes.body.approvals.map((a) => a.id), ['rpc-4', 'rpc-5'], 'oldest first')
  assert.deepEqual(doorbelled, ['rpc-4', 'rpc-5'], 'doorbell fires once per pending, replay excluded')

  const decided = resFor()
  await routes.get('/__arxa/approvals/action')(reqWith(JSON.stringify({
    action: 'decide',
    arg: { id: 'rpc-4', answers: [{ id: 'q1', selected: ['Approve'] }] },
  })), decided)
  await decided.done
  assert.equal(decided.status, 200)
  assert.equal(decided.body.ok, true)
  assert.equal(responded.length, 1)
  assert.equal(responded[0].rpcId, 'rpc-4')

  const listAfter = resFor()
  await routes.get('/__arxa/approvals')({}, listAfter)
  assert.deepEqual(listAfter.body.approvals.map((a) => a.id), ['rpc-5'], 'decided approval leaves the list immediately')

  const lost = resFor()
  await routes.get('/__arxa/approvals/action')(reqWith(JSON.stringify({
    action: 'decide',
    arg: { id: 'rpc-5', answers: [{ id: 'q1', selected: ['Deny'] }] },
  })), lost)
  await lost.done
  assert.equal(lost.status, 409, 'a refused receipt (someone answered first) is a conflict')
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

console.log('arxa-approvals selftest: 4 checks green')
