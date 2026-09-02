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
const jobSnaps = [
  { id: 'bash-1', kind: 'bash', label: 'long build', status: 'running', ownerSession: PARENT, startedAt: 1 },
  { id: 'bash-2', kind: 'bash', label: 'finished build', status: 'completed', ownerSession: PARENT, startedAt: 1, finishedAt: 2 },
  // Another session's job must never appear on this session's surface.
  { id: 'bash-9', kind: 'bash', label: 'someone else', status: 'running', ownerSession: 'other', startedAt: 1 },
]

// ---- 1. the full matrix, everything live -----------------------------------
const interrupts = []
const kills = []
const act = mount({
  agents: { get: (id) => (id === PARENT ? OWNER : undefined) },
  subagents: {
    listChildren: async () => children,
    interrupt: (id, authority) => { interrupts.push([id, authority]) },
  },
  jobs: {
    list: (caller) => (caller === OWNER ? jobSnaps : []),
    kill: (id, caller, reason) => { kills.push([id, caller, reason]); return 'requested' },
  },
})

let r = await act('agent.list', { sessionId: PARENT })
const rows = r.result
const sub = Object.fromEntries((rows.subagents || []).map((x) => [x.id, x]))
const job = Object.fromEntries((rows.jobs || []).map((x) => [x.id, x]))

check('list: diagnostic candidates are not controllable rows', (rows.subagents || []).length === 3 && !sub['c-bad'])
check('list: only this session\'s jobs are surfaced', (rows.jobs || []).length === 2 && !job['bash-9'], JSON.stringify(rows.jobs))
check('list: reports the live parent and both services', rows.parentLive === true && rows.services.subagents === true && rows.services.jobs === true && rows.jobsReadable === true)

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
check('matrix: a running job CANCELS (the only live cancel) and cannot pause',
  job['bash-1'].can.cancel === true && job['bash-1'].can.pause === false && job['bash-1'].why.pause === 'jobs-have-no-pause')
check('matrix: a finished job cannot cancel, and says why',
  job['bash-2'].can.cancel === false && job['bash-2'].why.cancel === 'already-finished')

// ---- 2. the two live verbs actually reach the runtime -----------------------
r = await act('agent.pause', { sessionId: PARENT, kind: 'subagent', id: 'c-run' })
check('pause: interrupts the named child under THIS session\'s human authority',
  r.result.ok === true && interrupts.length === 1
  && interrupts[0][0] === 'c-run'
  && interrupts[0][1].kind === 'user' && interrupts[0][1].parentSessionId === PARENT,
  JSON.stringify(interrupts))

r = await act('agent.cancel', { sessionId: PARENT, kind: 'job', id: 'bash-1' })
check('cancel: kills the named job as the OWNER agent (the fence jobs.kill enforces)',
  r.result.ok === true && r.result.outcome === 'requested'
  && kills.length === 1 && kills[0][0] === 'bash-1' && kills[0][1] === OWNER,
  JSON.stringify(kills.map((k) => [k[0], k[1] === OWNER])))

// ---- 3. every refusal is structured, never a thrown error -------------------
r = await act('agent.resume', { sessionId: PARENT, kind: 'subagent', id: 'c-run' })
check('resume: refuses with the reason a paused child actually wakes by',
  r.ok === true && r.result.ok === false && r.result.reason === 'send-message')
r = await act('agent.cancel', { sessionId: PARENT, kind: 'subagent', id: 'c-run' })
check('cancel on a subagent: refused as no-terminate-verb, not attempted',
  r.result.ok === false && r.result.reason === 'no-terminate-verb' && kills.length === 1)
r = await act('agent.pause', { sessionId: PARENT, kind: 'job', id: 'bash-1' })
check('pause on a job: refused as jobs-have-no-pause, not attempted',
  r.result.ok === false && r.result.reason === 'jobs-have-no-pause' && interrupts.length === 1)
r = await act('agent.list', {})
check('a missing sessionId is refused loudly, never guessed', r.ok === false && r.error === 'sessionId-required')

// ---- 4. a cold session: jobs unreachable, subagents still listable ----------
const cold = mount({
  agents: { get: () => undefined },
  subagents: { listChildren: async () => children, interrupt: () => {} },
  jobs: { list: () => jobSnaps, kill: () => 'requested' },
})
r = await cold('agent.list', { sessionId: PARENT })
check('cold session: jobs are UNREACHABLE rather than reported empty',
  r.result.jobsReadable === false && r.result.jobs.length === 0 && r.result.parentLive === false)
check('cold session: subagents still list — listChildren needs no live Agent',
  r.result.subagents.length === 3)
r = await cold('agent.cancel', { sessionId: PARENT, kind: 'job', id: 'bash-1' })
check('cold session: cancel refuses with owner-not-live instead of throwing',
  r.ok === true && r.result.ok === false && r.result.reason === 'owner-not-live')

// ---- 5. a profile without the services: degrade, never take the sidebar down -
// cordis' ReflectService THROWS on an unregistered service ("cannot get
// property X without inject") rather than reading undefined — optional
// chaining alone would not survive this, so the handler try/catches. This
// fake reproduces that exact behaviour.
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
check('no services: the surface degrades to empty-with-a-reason, it does not crash',
  r.ok === true && r.result.services.subagents === false && r.result.services.jobs === false
  && r.result.subagents.length === 0 && r.result.jobs.length === 0,
  JSON.stringify(r))
r = await bare('agent.pause', { sessionId: PARENT, kind: 'subagent', id: 'c-run' })
check('no services: pause refuses as service-unavailable',
  r.result.ok === false && r.result.reason === 'service-unavailable')

console.log(failures === 0 ? '\narxa-sidebar agent-control selftest: ALL GREEN' : `\narxa-sidebar agent-control selftest: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
