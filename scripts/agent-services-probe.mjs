#!/usr/bin/env node
/**
 * Agent-service presence probe — the one thing plugins/arxa-sidebar/
 * selftest.agents.mjs CANNOT cover.
 *
 * That selftest drives the real handler with FAKE services, so it proves the
 * capability map is computed correctly given a service surface. It cannot
 * prove the arxa profile actually loads `ctx.subagents` / `ctx.jobs`, nor
 * that the real services return the shapes the handler assumes. A wrong
 * assumption there is silent: the chip would just render empty forever.
 *
 * So this asks a LIVE engine and asserts the real surface. Deterministic —
 * no model turn, no API key, no network beyond localhost. A model-driven
 * spawn was deliberately NOT built here: its green would depend on a model
 * choosing to background a bash call, which is not a fact about this code.
 *
 *   arxa --no-open &            # or any running arxa engine
 *   node scripts/agent-services-probe.mjs
 *
 * Exits non-zero on the first broken contract.
 */
const BASE = process.env.ARXA_BASE || 'http://127.0.0.1:7891'

const post = (action, arg) =>
  fetch(BASE + '/__arxa/sidebar/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, arg }),
  }).then((r) => r.json())

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}

const state = await fetch(BASE + '/__arxa/sidebar/state').then((r) => r.json()).catch(() => null)
if (!state) {
  console.error('no engine at ' + BASE + ' — start one with `arxa --no-open` first')
  process.exit(2)
}

// Any session will do: the probe is about the SERVICES, not about a
// particular session's children. A session with no children still proves the
// services resolved and returned the right container shapes.
const org = (state.orgs || []).find((o) => o.open) || (state.orgs || [])[0] || null
const session = org && (org.sessions || []).find((s) => s.dshSessionId) || null
const sid = session ? session.dshSessionId : null
if (!sid) {
  console.error('no session with a dsh id in the open org — create one in the UI first')
  process.exit(2)
}
console.log('probing session ' + sid)

const r = await post('agent.list', { sessionId: sid })
check('agent.list answers on a live engine', r.ok === true, JSON.stringify(r))
if (r.ok !== true) process.exit(1)
const d = r.result

// THE point of this probe. It already earned its keep once: the first run
// showed BOTH services unresolved while `subagent.list` answered fine over
// RPC, which is how the composition-scoping was found. The route now goes
// through ctx.apiProxy; if that ever stops resolving, the chip would render
// empty forever and only this check would say so.
check('the subagent domain resolves from the sidebar host', d.services.subagents === true,
  'subagent API did not resolve — the chip would render empty forever')
check('jobs are honestly declared uncontrollable (no job.* RPC exists in this build)',
  d.services.jobs === false && d.jobsControllable === false && d.jobsReason === 'no-job-api',
  JSON.stringify({ services: d.services, jobsControllable: d.jobsControllable, jobsReason: d.jobsReason }))

check('listChildren returned an array of controllable rows', Array.isArray(d.subagents), JSON.stringify(d.subagents))
check('every subagent row carries the capability map the UI gates on',
  d.subagents.every((x) => x.kind === 'subagent' && typeof x.id === 'string'
    && x.can && typeof x.can.pause === 'boolean' && typeof x.can.cancel === 'boolean'
    && x.why && typeof x.why.cancel === 'string'),
  JSON.stringify(d.subagents.slice(0, 2)))
check('no subagent row ever claims a cancel (the runtime has no terminate verb)',
  d.subagents.every((x) => x.can.cancel === false))

check('jobs readability is stated, never implied', typeof d.jobsReadable === 'boolean' && typeof d.parentLive === 'boolean')
check('the host ships no job rows — the client lists them from its own store',
  Array.isArray(d.jobs) && d.jobs.length === 0)

// Refusals must be structured on the real engine too, not thrown.
const refused = await post('agent.resume', { sessionId: sid, kind: 'subagent', id: 'nope' })
check('resume refuses structurally on the real engine', refused.ok === true && refused.result.ok === false, JSON.stringify(refused))
const bad = await post('agent.list', {})
check('a missing sessionId is refused, never guessed', bad.ok === false && bad.error === 'sessionId-required', JSON.stringify(bad))

console.log(failures === 0 ? '\nagent-services probe: ALL GREEN' : `\nagent-services probe: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
