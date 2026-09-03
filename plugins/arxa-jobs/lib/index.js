/**
 * arxa-jobs — host half. Background-job list and cancel for one session.
 *
 * WHY THIS EXISTS. dsh ships `@deepseek-ai/dsh-client-ui-jobs`, a session-header
 * chip that lists background jobs. It is read-only by construction: `JobView`
 * reaches the browser only as the push event `session/jobs`
 * (dsh-host-apiproxy/lib/types/api/events.d.ts:124), and the RPC map
 * (types/api/rpc-map.d.ts) has NO `job.*` verb. So no client can stop a job.
 *
 * But the REGISTRY is a host service. `@deepseek-ai/dsh-jobs-local` is loaded by
 * dsh-base/cordis.patch.yml:69, beside `agent` and `settings` — host plane, not
 * agent plane. A top-level plugin reaches it with `ctx.get('jobs')`, which is
 * the documented way to read an optional capability (dsh's own
 * `cordis-plugin-development` skill, "Access Services": read with `ctx.get(name)`
 * and handle absence; declare `inject` only for a hard dependency). We do NOT
 * declare it, because a missing registry must degrade rather than stop arxa
 * loading.
 *
 * WHAT THE FENCE IS. `dsh-jobs-local` gates access by comparing ids:
 *
 *     assertAccess(job, caller) {
 *       if (job.owner !== void 0 && job.owner.id !== caller?.id)
 *         throw new Error(`job ${job.id} belongs to another session`)
 *     }
 *
 * `caller` is any object with `.id`, and `Agent.id` is the session id
 * (dsh-agent/lib/types/runtime-types.d.ts:60-62 — "the single identity shared
 * with session"). So `{ id: sessionId }` is a correct caller for that session.
 * That fence exists to stop agent A touching agent B's jobs. arxa is the host UI
 * acting for the human, who owns every session in their own app, so using it is
 * use and not circumvention (decision D1,
 * docs/plans/job-controls-and-background-agent-insights.md).
 *
 * WHAT GUARDS IT. The shape above is not a published contract, so
 * `scripts/jobs-fence-check.mjs` asserts it against the installed dsh on every
 * CI run — a dsh upgrade that tightens the fence turns RED naming the file
 * instead of failing in a user's hands. At runtime every registry call is
 * wrapped and any throw degrades to the same honest `no-job-api` refusal arxa
 * showed before this plugin existed (D2). A user on a newer dsh gets a disabled
 * control with a reason, never a crash and never a lie.
 *
 * WHAT IS DELIBERATELY ABSENT. No subagent terminate. `subagent.*` is
 * `history · interrupt · list · prompt`; `session.cancel` states "Session-backed
 * subagents reject with `agent-busy`". The live `Agent.cancel()` object method
 * would go around that refusal, which is different from using a verb dsh simply
 * never offered — so it stays unused (D6).
 */

export const name = 'arxa-jobs'
export const inject = ['webServer']

/** Milliseconds a job may be `stopping` before we stop calling it live. */
export const STOPPING_GRACE_MS = 30_000

/** Statuses that mean the job is still doing something. */
const LIVE = new Set(['running', 'stopping'])

export function isLive(job) {
  return LIVE.has(String(job?.status ?? ''))
}

/**
 * The caller object the registry's `.id` fence accepts for one session.
 * Deliberately a bare shape rather than a real Agent: `list`/`kill` only ever
 * read `.id` (see the header), and asking dsh for a live Agent would make an
 * offline or already-finished session unreadable.
 */
export function callerFor(sessionId) {
  const id = typeof sessionId === 'string' ? sessionId.trim() : ''
  return id === '' ? null : { id }
}

/**
 * Project a registry snapshot to the shape the card renders. Mirrors dsh's own
 * `JobView` (dsh-host-apiproxy/lib/types/api/jobs.d.ts) so a row from here and a
 * row from the push event are interchangeable — the client must never care
 * which door a job came through.
 */
export function jobRow(snapshot, now = Date.now()) {
  if (!snapshot || typeof snapshot !== 'object') return null
  const startedAt = Number(snapshot.startedAt)
  const endedAt = Number(snapshot.endedAt)
  const started = Number.isFinite(startedAt) ? startedAt : null
  const ended = Number.isFinite(endedAt) ? endedAt : null
  const live = isLive(snapshot)
  return {
    id: String(snapshot.id ?? ''),
    kind: String(snapshot.kind ?? ''),
    label: String(snapshot.label ?? ''),
    status: String(snapshot.status ?? ''),
    detail: snapshot.detail === undefined ? null : String(snapshot.detail),
    ownerSession: snapshot.ownerSession === undefined ? null : String(snapshot.ownerSession),
    startedAt: started,
    endedAt: ended,
    // Elapsed is computed HERE rather than in the browser so a row is
    // meaningful in a log, a test, and a screenshot — not only on screen.
    elapsedMs: started === null ? null : Math.max(0, (live ? now : ended ?? now) - started),
    live,
    // Only a live job can be cancelled. A terminal one is not an error to
    // cancel — the registry answers `already-finished` — but offering the
    // button would be a lie about what is about to happen.
    canCancel: live,
  }
}

/**
 * Read the registry, or say why not. Never throws: a missing service, a
 * tightened fence and a broken call all arrive here as the same honest refusal,
 * because the user-visible consequence is identical (D2).
 */
export function readJobs(ctx, sessionId, now = Date.now()) {
  const caller = callerFor(sessionId)
  if (caller === null) return { ok: false, reason: 'sessionId-required', rows: [], controllable: false }
  const registry = registryOf(ctx)
  if (registry === null) return { ok: false, reason: 'no-job-api', rows: [], controllable: false }
  try {
    const raw = registry.list(caller)
    const rows = (Array.isArray(raw) ? raw : []).map((s) => jobRow(s, now)).filter(Boolean)
    return { ok: true, reason: null, rows, controllable: true }
  } catch (err) {
    return { ok: false, reason: 'registry-refused', message: reason(err), rows: [], controllable: false }
  }
}

/**
 * Ask the registry to stop one job. `requested` is not `stopped`: the registry
 * calls the producer's own cancel and marks the record `stopping`, so the row
 * stays visible until the producer actually settles. Reporting "cancelled" here
 * would be the same class of lie as a button that cannot fire.
 */
export function cancelJob(ctx, sessionId, jobId, why = 'cancelled from arxa') {
  const caller = callerFor(sessionId)
  if (caller === null) return { ok: false, reason: 'sessionId-required' }
  const id = typeof jobId === 'string' ? jobId.trim() : ''
  if (id === '') return { ok: false, reason: 'jobId-required' }
  const registry = registryOf(ctx)
  if (registry === null) return { ok: false, reason: 'no-job-api' }
  try {
    const outcome = registry.kill(id, caller, why)
    // `already-finished` is a fact, not a failure — the job ended between the
    // render and the click, which is the common race on a 1s-ticking list.
    return { ok: true, outcome: String(outcome ?? 'requested') }
  } catch (err) {
    const message = reason(err)
    // The registry's own fence message is the one case worth naming precisely:
    // it means this session does not own that job, which is a different problem
    // from the service being gone.
    if (/belongs to another session/i.test(message)) return { ok: false, reason: 'not-yours', message }
    if (/unknown job|no such job/i.test(message)) return { ok: false, reason: 'gone', message }
    return { ok: false, reason: 'registry-refused', message }
  }
}

/** `ctx.get('jobs')`, or null. Never a bare `ctx.jobs` — that throws without inject. */
function registryOf(ctx) {
  try {
    const viaGet = typeof ctx?.get === 'function' ? ctx.get('jobs') : undefined
    if (viaGet) return viaGet
  } catch { /* fall through — absence and refusal are the same answer here */ }
  try {
    const viaReflect = ctx?.reflect?.get?.('jobs')
    if (viaReflect) return viaReflect
  } catch { /* fall through */ }
  return null
}

function reason(err) {
  return String(err?.message ?? err ?? 'unknown').slice(0, 200)
}

export function apply(ctx) {
  const json = (res, body) => {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }

  ctx.webServer.register({
    name: 'arxa-jobs-action',
    path: '/__arxa/jobs/action',
    kind: 'exact',
    handler: async (req, res) => {
      let raw = ''
      req.on('data', (c) => { raw += c })
      req.on('end', () => {
        let action = ''
        try {
          const parsed = JSON.parse(raw || '{}')
          action = String(parsed.action ?? '')
          const arg = parsed.arg ?? {}
          const sid = arg?.sessionId
          if (action === 'jobs.list') return json(res, { ok: true, action, result: readJobs(ctx, sid) })
          if (action === 'jobs.cancel') {
            const out = cancelJob(ctx, sid, arg?.jobId, arg?.reason)
            // Hand back the refreshed list with the outcome so one round trip
            // both acts and re-renders; a cancel that leaves a stale row on
            // screen reads as a button that did nothing.
            return json(res, { ok: true, action, result: { ...out, list: readJobs(ctx, sid) } })
          }
          return json(res, { ok: false, action, error: 'unknown-action' })
        } catch (err) {
          return json(res, { ok: false, action, error: reason(err) })
        }
      })
    },
  })
}
