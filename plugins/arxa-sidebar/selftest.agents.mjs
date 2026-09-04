#!/usr/bin/env node
/**
 * arxa-sidebar agent-control selftest (Q4/Q5, docs/plans/
 * session-naming-agent-controls-and-cicd-card.md).
 *
 * These actions ship a CAPABILITY MAP, not a uniform set of buttons, because
 * the runtime underneath is not uniform:
 *
 *   dsh-subagent's only stop verb is `interrupt`, and its contract
 *   (dsh-subagent/lib/types/index.d.ts:138-152) preserves the Activation and
 *   parks unclaimed inbox work — that is a PAUSE. There is no terminate verb
 *   for a subagent, and interrupting a one-shot child is an accepted no-op.
 *
 *   dsh-jobs is the mirror: `kill` is a real cancel and the status union
 *   (running|stopping|completed|killed|failed) has no paused member.
 *
 * So the matrix under test is: subagents pause, jobs cancel, everything else
 * false-with-a-reason. This exercises the real handler with fake services —
 * a source-string check would not catch the map being computed wrongly.
 *
 * Exit 0 = every assertion held.
 */
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname)
const host = await import(path.join(here, 'lib', 'index.js'))

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}

const PARENT = 'arxa-note-wt-260903-001'
const OWNER = { id: PARENT }

/** Build a host bound to one fake cordis ctx and return an action caller. */
function mount(ctxExtra) {
  const routes = {}
  const ctx = { webServer: { register: (r) => { routes[r.path] = r.handler } }, ...ctxExtra }
  host.apply(ctx, { github: {} })
  return (action, arg) => new Promise((res) => {
    const req = { url: '/__arxa/sidebar/action', method: 'POST', _h: {}, on(ev, fn) { this._h[ev] = fn } }
    routes['/__arxa/sidebar/action'](req, { writeHead() {}, end: (s) => res(JSON.parse(s)) })
    queueMicrotask(() => {
      req._h.data?.(JSON.stringify({ action, arg }))
      req._h.end?.()
    })
  })
}

const children = [
  { kind: 'child', id: 'c-run', mode: 'continuable', activity: 'running', label: 'live child', hasChildren: false },
  { kind: 'child', id: 'c-cold', mode: 'continuable', activity: 'inactive', label: 'cold child', hasChildren: false },
  { kind: 'child', id: 'c-shot', mode: 'one-shot', activity: 'running', label: 'one-shot child', hasChildren: false },
  // A diagnostic candidate is not a controllable row and must be dropped.
  { kind: 'diagnostic', id: 'c-bad', reason: 'corrupt' },
]
const okRes = (rpcId, value) => ({ rpcId, result: { ok: true, value } })

// ---- 1. the full matrix, everything live -----------------------------------
const interrupts = []
const prompts = []
const act = mount({
  apiProxy: {
    subagents: {
      list: async (req) => okRes(req.rpcId, { entries: children, parentAvailable: true }),
      interrupt: async (req) => { interrupts.push(req.payload); return okRes(req.rpcId, { accepted: true }) },
      prompt: async (req) => { prompts.push(req.payload); return okRes(req.rpcId, { accepted: true }) },
    },
  },
})

let r = await act('agent.list', { sessionId: PARENT })
const rows = r.result
const sub = Object.fromEntries((rows.subagents || []).map((x) => [x.id, x]))
const job = Object.fromEntries((rows.jobs || []).map((x) => [x.id, x]))

check('list: diagnostic candidates are not controllable rows', (rows.subagents || []).length === 3 && !sub['c-bad'])
check('list: jobs are declared unreachable rather than reported empty', rows.jobsControllable === false && rows.jobsReason === 'no-job-api' && rows.jobsReadable === false)
check('list: reports the live parent and the subagent service', rows.parentLive === true && rows.services.subagents === true && rows.services.jobs === false)

check('matrix: a running continuable subagent PAUSES (the only live pause)',
  sub['c-run'].can.pause === true && sub['c-run'].can.cancel === false && sub['c-run'].can.resume === false)
check('matrix: a subagent never offers cancel — the runtime has no terminate verb',
  ['c-run', 'c-cold', 'c-shot'].every((k) => sub[k].can.cancel === false && sub[k].why.cancel === 'no-terminate-verb'))
check('matrix: an inactive continuable child cannot pause, and says why',
  sub['c-cold'].can.pause === false && sub['c-cold'].why.pause === 'not-running')
check('matrix: a one-shot child offers nothing, and says why (interrupt is a documented no-op there)',
  sub['c-shot'].can.pause === false && sub['c-shot'].why.pause === 'one-shot' && sub['c-shot'].why.resume === 'one-shot')
check('matrix: resume is never live — waking a paused child needs a message the human writes',
  Object.values(sub).every((x) => x.can.resume === false) && sub['c-run'].why.resume === 'send-message')
check('matrix: no job rows come from the host at all — it has no API to enumerate them',
  Object.keys(job).length === 0)

// ---- 2. the two live verbs actually reach the runtime -----------------------
r = await act('agent.pause', { sessionId: PARENT, kind: 'subagent', id: 'c-run' })
check('pause: interrupts the named child, addressed to THIS session as parent',
  r.result.ok === true && interrupts.length === 1
  && interrupts[0].childSessionId === 'c-run'
  && interrupts[0].parentSessionId === PARENT
  && interrupts[0].mode === 'continuable',
  JSON.stringify(interrupts))

// ---- 3. every refusal is structured, never a thrown error -------------------
r = await act('agent.resume', { sessionId: PARENT, kind: 'subagent', id: 'c-run' })
check('resume: refuses with the reason a paused child actually wakes by',
  r.ok === true && r.result.ok === false && r.result.reason === 'send-message')
r = await act('agent.cancel', { sessionId: PARENT, kind: 'subagent', id: 'c-run' })
check('cancel on a subagent: refused as no-terminate-verb, not attempted',
  r.result.ok === false && r.result.reason === 'no-terminate-verb')
// A job cancel is no longer a GAP — it is a different PLANE. The registry is a
// host service that plugins/arxa-jobs owns, so the client dispatches job rows to
// /__arxa/jobs/action and one arriving here means the routing broke. The reason
// says that rather than repeating the retired "no-job-api", which would now
// describe the product wrongly.
r = await act('agent.cancel', { sessionId: PARENT, kind: 'job', id: 'bash-1' })
check('cancel on a job: refused as wrong-plane — jobs are cancelled by arxa-jobs, not here',
  r.result.ok === false && r.result.reason === 'wrong-plane')
r = await act('agent.pause', { sessionId: PARENT, kind: 'job', id: 'bash-1' })
check('pause on a job: refused as no-job-api, and never reaches the subagent runtime',
  r.result.ok === false && r.result.reason === 'no-job-api' && interrupts.length === 1)

// ---- THE WAKE (D3) ---------------------------------------------------------
// `subagent.prompt` is the sanctioned way to reach a paused child: its contract
// delivers human content to a continuable child, and `agent.pause` above parks
// the inbox rather than ending the Activation. There is no content-free resume
// verb and there never will be, so this carries the human's words or refuses.
r = await act('agent.wake', { sessionId: PARENT, kind: 'subagent', id: 'c-run', text: 'carry on with the survey' })
check('wake: delivers the human\'s words to the named child, addressed to THIS parent',
  r.result.ok === true && r.result.outcome === 'woken' && prompts.length === 1
  && prompts[0].childSessionId === 'c-run' && prompts[0].parentSessionId === PARENT
  && prompts[0].mode === 'continuable'
  && JSON.stringify(prompts[0].content) === JSON.stringify([{ type: 'text', text: 'carry on with the survey' }]),
  JSON.stringify(prompts[0] ?? null))
// An empty wake would spend a turn delivering nothing.
r = await act('agent.wake', { sessionId: PARENT, kind: 'subagent', id: 'c-run', text: '   ' })
check('wake: an empty message is refused BEFORE the runtime is touched',
  r.result.ok === false && r.result.reason === 'message-required' && prompts.length === 1)
r = await act('agent.wake', { sessionId: PARENT, kind: 'job', id: 'bash-1' })
check('wake: a job is not a subagent — refused without reaching the runtime',
  r.result.ok === false && r.result.reason === 'subagents-only' && prompts.length === 1)
// Only a continuable child is addressable: subagent.prompt's address type is
// Extract<SubagentAddress, { mode: 'continuable' }>, so the row must not offer
// a box for a one-shot child.
check('wake: a CONTINUABLE child offers the box; a one-shot one explains why not',
  sub['c-run'].can.wake === true && sub['c-shot'].can.wake === false
  && sub['c-shot'].why.wake === 'one-shot',
  JSON.stringify({ run: sub['c-run'].can, shot: sub['c-shot'].can, why: sub['c-shot'].why.wake }))
// Deliberately NOT gated on activity: waking a child that is paused/idle is the
// whole point. `c-cold` is continuable but inactive — it can be woken and it
// cannot be paused, and those two are independent.
check('wake: an INACTIVE continuable child is still wakeable (pause is what needs running)',
  sub['c-cold'].can.wake === true && sub['c-cold'].can.pause === false
  && sub['c-cold'].why.pause === 'not-running',
  JSON.stringify(sub['c-cold'].can))
check('wake: resume stays refused forever — it would have to invent the message',
  sub['c-run'].can.resume === false && sub['c-run'].why.resume === 'send-message')
r = await act('agent.list', {})
check('a missing sessionId is refused loudly, never guessed', r.ok === false && r.error === 'sessionId-required')

// ---- 4. a cold session: jobs unreachable, subagents still listable ----------
const cold = mount({
  apiProxy: {
    subagents: {
      list: async (req) => okRes(req.rpcId, { entries: children, parentAvailable: false }),
      interrupt: async (req) => okRes(req.rpcId, { accepted: true }),
    },
  },
})
r = await cold('agent.list', { sessionId: PARENT })
check('cold parent: subagents still list — the catalog needs no live parent Agent',
  r.result.subagents.length === 3 && r.result.parentLive === false)

// ---- 5. a profile without the services: degrade, never take the sidebar down -
// cordis' ReflectService THROWS on an unregistered service ("cannot get
// property X without inject") rather than reading undefined — optional
// chaining alone would not survive this, so the handler try/catches. This
// fake reproduces that exact behaviour, which is what a build without an
// apiProxy would do to this route.
const throwing = new Proxy({ webServer: null }, {
  get(target, prop) {
    if (prop === 'webServer') return target.webServer
    if (prop === 'then') return undefined
    throw new Error(`cannot get property "${String(prop)}" without inject`)
  },
  has: () => true,
})
const routes2 = {}
throwing.webServer = { register: (r2) => { routes2[r2.path] = r2.handler } }
host.apply(throwing, { github: {} })
const bare = (action, arg) => new Promise((res) => {
  const req = { url: '/__arxa/sidebar/action', method: 'POST', _h: {}, on(ev, fn) { this._h[ev] = fn } }
  routes2['/__arxa/sidebar/action'](req, { writeHead() {}, end: (s) => res(JSON.parse(s)) })
  queueMicrotask(() => { req._h.data?.(JSON.stringify({ action, arg })); req._h.end?.() })
})
r = await bare('agent.list', { sessionId: PARENT })
check('no apiProxy: the surface degrades to empty-with-a-reason, it does not crash',
  r.ok === true && r.result.services.subagents === false
  && r.result.subagents.length === 0 && r.result.jobs.length === 0,
  JSON.stringify(r))
r = await bare('agent.pause', { sessionId: PARENT, kind: 'subagent', id: 'c-run' })
check('no apiProxy: pause refuses as service-unavailable',
  r.result.ok === false && r.result.reason === 'service-unavailable')

console.log(failures === 0 ? '\narxa-sidebar agent-control selftest: ALL GREEN' : `\narxa-sidebar agent-control selftest: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
