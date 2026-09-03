/**
 * arxa-jobs selftest — the logic and EVERY refusal path, offline.
 *
 * The fake registry here is deliberately a faithful copy of the real fence from
 * `@deepseek-ai/dsh-jobs-local` (an `.id` comparison, nothing else), so these
 * cases exercise the same rule the product hits. What keeps the copy honest is
 * `scripts/jobs-fence-check.mjs`, which asserts the real implementation still
 * has that shape — a fake nobody checks is how a suite goes green against a
 * contract that already moved.
 *
 * What this CANNOT prove: that a real background job ever lands in the registry
 * for a session id we can name. That needs a live run and is D5's first
 * assertion. Nothing here should be read as covering it.
 */
import assert from 'node:assert/strict'

import { jobRow, readJobs, cancelJob, callerFor, isLive } from './lib/index.js'

let passed = 0
function ok(cond, label) {
  assert.ok(cond, label)
  passed++
  console.log('  ✓ ' + label)
}

/** A registry with the REAL fence, so a wrong caller is refused the real way. */
function fakeRegistry(jobs, { throwOn = null } = {}) {
  const store = new Map(jobs.map((j) => [j.id, { ...j }]))
  const assertAccess = (job, caller) => {
    if (job.owner !== undefined && job.owner.id !== caller?.id) {
      throw new Error(`job ${job.id} belongs to another session`)
    }
  }
  return {
    list(caller) {
      if (throwOn === 'list') throw new Error('registry exploded')
      const session = caller?.id
      return [...store.values()].filter((j) => j.owner === undefined || j.owner.id === session)
    },
    kill(id, caller, reason) {
      if (throwOn === 'kill') throw new Error('registry exploded')
      const job = store.get(id)
      if (!job) throw new Error(`unknown job ${id}`)
      assertAccess(job, caller)
      if (job.status === 'completed' || job.status === 'killed' || job.status === 'failed') return 'already-finished'
      job.status = 'stopping'
      job.reason = reason
      return 'requested'
    },
    _get: (id) => store.get(id),
  }
}
const ctxWith = (registry) => ({ get: (n) => (n === 'jobs' ? registry : undefined) })

const T0 = 1_000_000
const MINE = { id: 'sess-a' }
const THEIRS = { id: 'sess-b' }
const JOBS = [
  { id: 'bash-1', kind: 'bash', label: 'npm test', status: 'running', owner: MINE, startedAt: T0 },
  { id: 'subagent-1', kind: 'subagent', label: 'survey the plans', status: 'running', owner: MINE, startedAt: T0 - 5000 },
  { id: 'bash-2', kind: 'bash', label: 'done already', status: 'completed', owner: MINE, startedAt: T0 - 9000, endedAt: T0 - 4000 },
  { id: 'bash-3', kind: 'bash', label: 'someone else', status: 'running', owner: THEIRS, startedAt: T0 },
  { id: 'bash-4', kind: 'bash', label: 'unowned', status: 'running', startedAt: T0 },
]

console.log('\n— a row says what is true of a job —')
{
  const live = jobRow(JOBS[0], T0 + 3000)
  ok(live.elapsedMs === 3000, `a live job's elapsed runs to NOW (${live.elapsedMs}ms)`)
  ok(live.live === true && live.canCancel === true, 'it is live and cancellable')
  const done = jobRow(JOBS[2], T0 + 60_000)
  ok(done.elapsedMs === 5000, `a finished job's elapsed FREEZES at its end (${done.elapsedMs}ms, not 69000)`)
  ok(done.canCancel === false, 'and it offers no cancel — the button would be a lie')
  ok(isLive({ status: 'stopping' }) === true, "'stopping' still counts as live — the producer has not settled")
  ok(jobRow(null) === null, 'a junk snapshot projects to null rather than a half-row')
}

console.log('\n— the fence: this session sees its own work and the unowned —')
{
  const out = readJobs(ctxWith(fakeRegistry(JOBS)), 'sess-a', T0)
  const ids = out.rows.map((r) => r.id)
  ok(out.ok === true && out.controllable === true, 'the registry answers')
  ok(ids.includes('bash-1') && ids.includes('subagent-1'), `own jobs are listed (${ids.join(', ')})`)
  ok(!ids.includes('bash-3'), "another session's job is NOT listed")
  ok(ids.includes('bash-4'), 'an unowned job IS listed — the registry shares those by design')
  ok(out.rows.find((r) => r.id === 'subagent-1').kind === 'subagent',
    'a background SUBAGENT is a job of kind subagent — the same row type, not a separate surface')
}

console.log('\n— cancelling —')
{
  const reg = fakeRegistry(JOBS)
  const ctx = ctxWith(reg)
  const out = cancelJob(ctx, 'sess-a', 'bash-1')
  ok(out.ok === true && out.outcome === 'requested', `a live job reports 'requested', never 'cancelled' (${out.outcome})`)
  ok(reg._get('bash-1').status === 'stopping', 'the record goes to stopping — the producer has not settled yet')
  ok(cancelJob(ctx, 'sess-a', 'bash-2').outcome === 'already-finished',
    "a job that ended between render and click is 'already-finished', not an error")
  const theirs = cancelJob(ctx, 'sess-a', 'bash-3')
  ok(theirs.ok === false && theirs.reason === 'not-yours',
    `another session's job refuses with its own reason (${theirs.reason})`)
  const gone = cancelJob(ctx, 'sess-a', 'bash-99')
  ok(gone.ok === false && gone.reason === 'gone', `an unknown id reads as 'gone' (${gone.reason})`)
}

console.log('\n— every degrade path lands on an honest refusal (D2) —')
{
  ok(readJobs({ get: () => undefined }, 'sess-a').reason === 'no-job-api',
    'no registry at all → no-job-api, the same words arxa showed before this plugin')
  ok(cancelJob({ get: () => undefined }, 'sess-a', 'bash-1').reason === 'no-job-api',
    'and cancel says it too, rather than throwing into the route')
  ok(readJobs(ctxWith(fakeRegistry(JOBS, { throwOn: 'list' })), 'sess-a').reason === 'registry-refused',
    'a THROWING registry degrades rather than 500s — this is the dsh-upgrade path')
  ok(cancelJob(ctxWith(fakeRegistry(JOBS, { throwOn: 'kill' })), 'sess-a', 'bash-1').reason === 'registry-refused',
    'same for cancel')
  const bad = readJobs(ctxWith(fakeRegistry(JOBS)), '')
  ok(bad.reason === 'sessionId-required' && bad.rows.length === 0, 'no session id → refused, and never a list')
  ok(callerFor('  ') === null, 'a blank session id is not a caller — it must not match an unowned job by accident')
}

console.log('\n— a bare ctx.jobs read is never used (it throws without inject) —')
{
  // The cordis Guard rejects `ctx.jobs` unless the plugin declares inject, and
  // arxa deliberately does NOT declare it so a missing registry degrades
  // instead of stopping the whole shell from loading.
  const hostile = { get: () => undefined, get jobs() { throw new Error('cannot get property "jobs" without inject') } }
  ok(readJobs(hostile, 'sess-a').reason === 'no-job-api',
    'a ctx that throws on the bare read still answers no-job-api, never crashes')
}

console.log(`\narxa-jobs: ${passed} assertions green`)
