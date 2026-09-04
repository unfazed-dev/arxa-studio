#!/usr/bin/env node
/**
 * jobs-push-proof — the live half of arxa-jobs' proof. NOT a CI suite.
 *
 * THE QUESTION. `plugins/arxa-jobs/selftest.mjs` proves the logic offline and
 * `scripts/jobs-fence-check.mjs` proves the registry's fence still has the
 * shape arxa reads. Neither can answer the thing a user actually notices:
 * arxa cancels a job HOST-side, with a synthetic `{ id: sessionId }` caller and
 * no client RPC anywhere in the path — does the BROWSER find out, or does the
 * session header keep showing a row for a job that is already dead?
 *
 * That gap is structural. `JobView` is push-only: the chip is painted from
 * `session/jobs` frames arriving over the client's WebSocket. Nothing in an
 * offline test can observe that channel.
 *
 * THE CHAIN, read in the installed dsh before running this:
 *   dsh-jobs-local.kill()          -> this.notifyChanged(job.owner)         :207
 *   dsh-host-apiproxy/lib/index.js -> jobs.onJobsChanged(owner => push a
 *                                     'session/jobs' frame to owner.id)     :3589
 * Note `notifyChanged` is handed the job's STORED owner (a real Agent), not
 * arxa's synthetic caller — which is why a cancel made on the human's behalf
 * still addresses the right session. This script confirms that end to end.
 *
 * WHY IT IS NOT IN CI. It needs a live engine and spends one real model call
 * to make a genuine background job. Run it by hand after touching arxa-jobs,
 * the registry, or anything on the event path:
 *
 *   node bin/arxa-studio.mjs --no-open --port 7897 &
 *   node scripts/jobs-push-proof.mjs 7897
 *
 * It creates its OWN scratch session, so no real work is touched, and it
 * cleans the job up by design — cancelling it is the test.
 */
const PORT = process.argv[2] ?? '7897'
const B = `http://127.0.0.1:${PORT}`
const PROMPT =
  'Run exactly this one command in the BACKGROUND and then stop: `sleep 300`. ' +
  'Use your Bash tool with background mode so it becomes a background job. ' +
  'Do not run anything else, do not explain, do not read any files.'

let rpcN = 0
const rpc = async (method, payload = {}) =>
  (await (await fetch(`${B}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `proof-${++rpcN}`, method, payload }),
  })).json())?.result

const arxa = async (action, arg = {}) =>
  (await (await fetch(`${B}/__arxa/jobs/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, arg }),
  })).json())?.result

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const check = (label, cond, note = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${note ? '  — ' + note : ''}`)
  if (!cond) failed++
}

async function main() {
  try {
    const r = await fetch(`${B}/`)
    if (!r.ok) throw new Error(String(r.status))
  } catch {
    console.log(`SKIP  no engine on ${B} — start one first (see the header of this file)`)
    process.exit(0)
  }

  // ---- a scratch session, so no real work is touched ---------------------
  const sid = (await rpc('session.create', {}))?.value?.sessionId
  check('scratch session created', typeof sid === 'string', sid)
  if (!sid) process.exit(1)

  const empty = await arxa('jobs.list', { sessionId: sid })
  check('arxa reads a REAL session id and reports zero jobs, controllable',
    empty?.ok === true && empty.rows.length === 0 && empty.controllable === true,
    JSON.stringify(empty))

  // ---- a genuine background job, made the way a user makes one ----------
  console.log('\n=== asking the agent for a background `sleep 300` ===')
  await rpc('session.prompt', { sessionId: sid, mode: 'queue', content: [{ type: 'text', text: PROMPT }] })
  let job = null
  for (let i = 0; i < 90 && job === null; i++) {
    await sleep(1000)
    job = ((await arxa('jobs.list', { sessionId: sid }))?.rows ?? []).find((r) => r.live) ?? null
  }
  check('a real background job reached arxa\'s list', job !== null,
    job ? `${job.id} ${job.kind} "${job.label}" ${job.status}` : 'none within 90s')
  if (!job) process.exit(1)
  check('the row names the session that owns it', job.ownerSession === sid, job.ownerSession)

  // ---- watch the channel the browser watches ----------------------------
  console.log('\n=== opening the client\'s own channel: ws /api/events.mux ===')
  const frames = []
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/events.mux`)
  ws.onmessage = (m) => { try { frames.push(JSON.parse(String(m.data))) } catch {} }
  const jobFrames = (from = 0) => frames.slice(from)
    .map((x) => x.payload ?? x)
    .filter((p) => p?.type === 'session/jobs' && p.sessionId === sid)
  const opened = await new Promise((res) => {
    ws.onopen = () => res(true); ws.onerror = () => res(false); setTimeout(() => res(false), 8000)
  })
  check('the client channel is open', opened === true)
  if (!opened) process.exit(1)

  await sleep(3000)
  const before = jobFrames().at(-1)
  check('the channel announced the RUNNING job — this is what paints the chip',
    before !== undefined && (before.jobs ?? []).some((j) => j.id === job.id && j.status === 'running'),
    before ? JSON.stringify((before.jobs ?? []).map((j) => j.id + ':' + j.status)) : 'no session/jobs frame')

  // ---- THE QUESTION -----------------------------------------------------
  console.log('\n=== cancelling through arxa (host registry, synthetic caller) ===')
  const mark = frames.length
  const t0 = Date.now()
  const out = await arxa('jobs.cancel', { sessionId: sid, jobId: job.id })
  check('arxa accepted the cancel and reported a settling outcome',
    out?.ok === true && out.outcome === 'requested', JSON.stringify({ ok: out?.ok, outcome: out?.outcome }))

  console.log('\n=== waiting for the push the browser would receive ===')
  let pushed = []
  while (Date.now() - t0 < 25000) {
    await sleep(150)
    pushed = jobFrames(mark)
    const last = pushed.at(-1)
    if (last && !(last.jobs ?? []).some((j) => j.id === job.id && j.status === 'running')) break
  }
  check('a session/jobs frame arrived AFTER the arxa cancel', pushed.length > 0,
    pushed.length > 0 ? `${pushed.length} frame(s) in ${Date.now() - t0}ms` : 'NOTHING in 25s — the chip would go stale')
  for (const p of pushed) {
    console.log(`   << [${(p.jobs ?? []).map((j) => j.id + ':' + j.status).join(', ') || '(empty — row cleared)'}]`)
  }
  const last = pushed.at(-1)
  if (last) {
    const row = (last.jobs ?? []).find((j) => j.id === job.id)
    check('…and the final pushed state is not still running',
      row === undefined || row.status !== 'running', row ? `${row.id}:${row.status}` : 'row removed')
  }

  // ---- a second cancel is a fact, not an error --------------------------
  const again = await arxa('jobs.cancel', { sessionId: sid, jobId: job.id })
  check('cancelling an already-dead job answers already-finished',
    again?.ok === true && again.outcome === 'already-finished', JSON.stringify(again))

  try { ws.close() } catch {}
  console.log(`\njobs push proof: ${failed === 0
    ? 'PASS — an arxa cancel reaches the browser'
    : failed + ' FAILURE(S) — a cancel may leave a stale row on screen'}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error('threw:', e); process.exit(1) })
