// arxa-approvals — the approvals loop engine half (grill D60–D68,
// arxa-studio docs/plans/arxa-studio-grill-decisions.md; doorbell decision
// B1 in arxa docs/plans/doorbell-decision-2026-08-29.md).
//
// An Approval IS a dsh session's pending human-input request (D63: derived
// projection, never a first-class record). This plugin consumes the apiProxy
// mux stream — which replays every still-pending question on attach, then
// pushes live — folds question frames into approval records (cairn-row-
// shaped per D61, so the B2 sync swap changes transport, not model), rings
// arxa-push-doorbell on FIRST sight of a pending (D65: the call passes only
// the id; the library's fixed content-free copy stands), and serves the
// phone over the pairing tunnel:
//
//   GET  /__arxa/approvals
//        → { approvals: [record…] } oldest first
//   POST /__arxa/approvals/action   body { action: 'decide',
//        arg: { id, answers: [{ id, selected: [label…], custom? }] } }
//        → ctx.apiProxy.respond — first claimant wins (D62), so the desktop
//          web UI and the phone can never double-answer: whoever answers
//          first claims the wait; the loser gets not-pending.
//
// Boundaries (deliberate, do not relax):
// - Derived state ONLY. Nothing persists: a restart re-derives the list from
//   the mux replay; a question/resolved frame deletes its record. raised_at
//   is minted at first sight (replays of a known id keep the original).
// - The doorbell never blocks and never throws into the engine (the
//   arxa-push-doorbell library contract); a missing library degrades to
//   routes-only, logged once.
// - The decide action shape-checks cheaply here, but the ENGINE re-validates
//   the batch against the live pending question (apiproxy matchesQuestions:
//   every question answered, ids in order, labels legal) — this plugin is
//   downstream of that fence and stays permissive.
// - The record's status field ships 'pending' only: decided approvals DELETE
//   (the projection is the live list, not history). The field exists for the
//   future cairn table (D61) where history matters.

export const name = 'arxa-approvals'
export const inject = ['webServer', 'apiProxy']

/** Project one question/requested mux frame into an approval record.
 * Field names ARE the future cairn table's columns (D61). kind stays
 * 'approval' for every pending question (D64: one class in practice; the
 * plan-review/question split joins only on product evidence). */
export function approvalRecord(frame, nowMs = Date.now()) {
  const questions = Array.isArray(frame?.payload?.questions) ? frame.payload.questions : []
  const first = questions[0]
  const summary = typeof first?.question === 'string' && first.question.trim() !== ''
    ? first.question
    : 'Session needs your decision'
  return {
    id: String(frame.rpcId),
    session_id: String(frame.payload?.sessionId ?? ''),
    kind: 'approval',
    summary,
    questions,
    raised_at: nowMs,
    status: 'pending',
  }
}

/** Fold one mux frame into the pending map. Returns the record to doorbell —
 * first sight of an rpcId only: the mux replays every pending on reattach,
 * and a replayed id must not re-buzz (collapse_key would coalesce it on the
 * rail anyway, but the phone-side list must not churn either). */
export function foldFrame(pending, frame, nowMs = Date.now()) {
  const type = frame?.payload?.type
  if (type === 'question/requested') {
    if (!frame.rpcId) return undefined
    const id = String(frame.rpcId)
    if (pending.has(id)) return undefined
    const record = approvalRecord(frame, nowMs)
    pending.set(id, record)
    return record
  }
  if (type === 'question/resolved') pending.delete(String(frame.rpcId ?? ''))
  return undefined
}

/** Fold one session/jobs mux frame (last-wins snapshots per session) into
 * the announced-jobs set. Returns [{id, outcome}] for every job FIRST seen
 * in a terminal status — running/stopping never ring, and a replayed
 * terminal id must not re-buzz (collapse_key task:<id> would coalesce it on
 * the rail anyway). 'completed' → completed; 'failed' and 'killed' → failed
 * (any non-success terminal is a failure to the owner). */
export function foldJobsFrame(announced, frame) {
  if (frame?.payload?.type !== 'session/jobs') return []
  const jobs = Array.isArray(frame.payload.jobs) ? frame.payload.jobs : []
  const fresh = []
  for (const job of jobs) {
    if (!job || typeof job.id !== 'string' || !job.id) continue
    const status = String(job.status ?? '')
    if (status !== 'completed' && status !== 'failed' && status !== 'killed') continue
    if (announced.has(job.id)) continue
    announced.add(job.id)
    fresh.push({ id: job.id, outcome: status === 'completed' ? 'completed' : 'failed' })
  }
  return fresh
}

/** Shape-check a decide action against its pending record and build the
 * apiProxy.respond envelope (the same message shape the browser composer
 * sends). Mirrors the engine-side checks closely enough to fail fast with
 * honest errors; the engine remains the authority. */
export function decideEnvelope(record, arg) {
  const answers = Array.isArray(arg?.answers) ? arg.answers : null
  if (!answers) return { ok: false, error: 'answers-required' }
  if (answers.length !== record.questions.length) {
    return { ok: false, error: 'every-question-must-be-answered' }
  }
  for (let i = 0; i < answers.length; i += 1) {
    const answer = answers[i]
    const question = record.questions[i]
    if (String(answer?.id) !== String(question.id)) {
      return { ok: false, error: 'answer-ids-must-match-question-order' }
    }
    const selected = Array.isArray(answer.selected) ? answer.selected : null
    if (!selected) return { ok: false, error: 'selected-required' }
    if (new Set(selected).size !== selected.length) {
      return { ok: false, error: 'duplicate-selection' }
    }
    const custom = typeof answer.custom === 'string' ? answer.custom.trim() : undefined
    if (custom === '') return { ok: false, error: 'custom-cannot-be-empty' }
    if (question.multiSelect !== true) {
      if (custom !== undefined && selected.length > 0) {
        return { ok: false, error: 'single-select-cannot-combine-custom-and-selection' }
      }
      if (selected.length > 1) return { ok: false, error: 'single-select-allows-one' }
    }
    const labels = new Set((question.options ?? []).map((option) => option.label))
    for (const label of selected) {
      if (!labels.has(label)) return { ok: false, error: 'unknown-option-label' }
    }
  }
  return {
    ok: true,
    message: {
      rpcId: record.id,
      result: {
        ok: true,
        value: {
          sessionId: record.session_id,
          answer: {
            answers: answers.map((answer) => ({
              id: answer.id,
              selected: answer.selected,
              ...(typeof answer.custom === 'string' && answer.custom.trim() !== ''
                ? { custom: answer.custom }
                : {}),
            })),
          },
        },
      },
    },
  }
}

/** Import-probe the doorbell library in both deployment shapes (the
 * arxa-sidebar importShell pattern): bare package name (packed mode flat
 * node_modules copy), then the repo-relative path (checkout mode). A failure
 * is LOGGED once and cached — a missing doorbell degrades to routes-only,
 * never an engine crash. */
let doorbellProbe = null
export function loadDoorbell(importBare = (s) => import(s), importRelative = (s) => import(s)) {
  if (doorbellProbe !== null) return doorbellProbe
  doorbellProbe = (async () => {
    try {
      return await importBare('arxa-push-doorbell')
    } catch {
      try {
        return await importRelative(new URL('../../push-doorbell/lib/index.js', import.meta.url).href)
      } catch (relative) {
        console.error(
          '[arxa-approvals] push-doorbell import failed from', import.meta.url,
          '— bare and relative both refused; doorbell degraded to off. Relative cause:',
          relative?.message ?? relative,
        )
        return {}
      }
    }
  })()
  return doorbellProbe
}

/** TEST SEAM (gate: literal env ARXA_APPROVALS_TEST_SEAM=true — the
 * ARXA_DOORBELL_PUSH convention). Raises a REAL user-questions ask through
 * the real provider against a LIVE (idle is fine) agent, so the simulator
 * e2e can exercise the whole approvals rail — mux frame, projection, phone
 * decide via apiProxy.respond, agent-side ask() resolution — without an
 * LLM-funded turn (the operator's zai key was 429-insufficient-balance on
 * 2026-08-29; a synthetic question through the same provider is identical
 * on the wire to a tool-raised one). Never enabled in production boots.
 * Route shape (registered only when gated on):
 *   POST /__arxa/approvals/__test_raise { sessionId, questions } → { raised }
 *   GET  /__arxa/approvals/__test_raised → { pending: n, lastAnswer? } */
function applyTestSeam(ctx, deps) {
  const raised = []
  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  ctx.webServer.register({
    name: 'arxa-approvals-test-raise',
    path: '/__arxa/approvals/__test_raise',
    kind: 'exact',
    handler: async (req, res) => {
      let raw = ''
      req.on('data', (c) => { raw += c })
      req.on('end', async () => {
        try {
          const { sessionId, questions } = JSON.parse(raw || '{}')
          const agents = ctx.get('agents')
          const agent = agents?.get(String(sessionId ?? ''))
          if (!agent) return json(res, 409, { ok: false, error: 'no-live-agent' })
          const entry = { askedAt: Date.now(), answer: null }
          raised.push(entry)
          // Fire the ask; when ANYONE (phone or desktop composer) answers,
          // apiProxy.respond resolves this promise — the agent-unblock proof.
          deps.userQuestionsAsk?.(ctx, { questions, agent }).then(
            (answer) => { entry.answer = answer },
            (rejected) => { entry.answer = { rejected: String(rejected?.message ?? rejected) } },
          )
          json(res, 200, { ok: true, raised: raised.length })
        } catch (e) {
          json(res, 400, { ok: false, error: String(e?.message ?? e) })
        }
      })
    },
  })
  ctx.webServer.register({
    name: 'arxa-approvals-test-raised',
    path: '/__arxa/approvals/__test_raised',
    kind: 'exact',
    handler: async (req, res) => json(res, 200, {
      pending: raised.filter((r) => r.answer === null).length,
      answered: raised.filter((r) => r.answer !== null).map((r) => r.answer),
    }),
  })
}

/** The real ask the seam fires (overridable in the selftest). Uses
 * ctx.get, not ctx.userQuestions: the plugin's static inject is
 * webServer+apiProxy, and cordis refuses property access to a service the
 * plugin did not declare — the seam is optional, so it resolves
 * dynamically and reports absence honestly. */
function defaultUserQuestionsAsk(ctx, request) {
  const service = ctx.get('userQuestions')
  if (!service) return Promise.reject(new Error('user-questions service not composed'))
  return service.ask(request)
}

/** Host half. deps is the test seam: { doorbell(record) } overrides the
 * library call so the selftest asserts first-sight-only firing without a
 * pushd. */
export function apply(ctx, deps = {}) {
  const pending = new Map()
  const ac = new AbortController()

  const ringDoorbell = (record) => {
    if (typeof deps.doorbell === 'function') {
      try { deps.doorbell(record) } catch { /* never throws into the engine */ }
      return
    }
    void loadDoorbell()
      .then((lib) => lib.notifyApprovalRequested?.({ id: record.id }))
      .catch(() => {})
  }

  // Task/job completions ride the SAME mux stream as session/jobs frames
  // (last-wins snapshots; foldJobsFrame rings first-sight terminal ids
  // only) and the SAME doorbell library + dark gate.
  const announcedJobs = new Set()
  const ringTaskDoorbell = (finished) => {
    if (typeof deps.taskDoorbell === 'function') {
      try { deps.taskDoorbell(finished) } catch { /* never throws into the engine */ }
      return
    }
    void loadDoorbell()
      .then((lib) => lib.notifyTaskFinished?.(finished))
      .catch(() => {})
  }

  // The mux stream: replay of every still-pending question on attach, then
  // live requested/resolved frames. One long-lived consumer: question frames
  // fold into approvals, session/jobs frames ring the task doorbell on first
  // sight of a terminal job id; everything else the stream carries is
  // ignored here.
  void (async () => {
    try {
      for await (const frame of ctx.apiProxy.events.mux({}, ac.signal)) {
        const fresh = foldFrame(pending, frame)
        if (fresh) ringDoorbell(fresh)
        for (const finished of foldJobsFrame(announcedJobs, frame)) ringTaskDoorbell(finished)
      }
    } catch (ended) {
      if (!ac.signal.aborted) {
        console.error('[arxa-approvals] mux stream ended:', ended?.message ?? ended)
      }
    }
  })()

  ctx.effect(function* () {
    yield () => ac.abort()
  }, 'arxa-approvals: mux stream')

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }

  ctx.webServer.register({
    name: 'arxa-approvals-list',
    path: '/__arxa/approvals',
    kind: 'exact',
    handler: async (req, res) => {
      const approvals = [...pending.values()].sort((a, b) => a.raised_at - b.raised_at)
      json(res, 200, { approvals })
    },
  })

  if (process.env.ARXA_APPROVALS_TEST_SEAM === 'true') {
    applyTestSeam(ctx, { userQuestionsAsk: deps.userQuestionsAsk ?? defaultUserQuestionsAsk })
  }

  ctx.webServer.register({
    name: 'arxa-approvals-action',
    path: '/__arxa/approvals/action',
    kind: 'exact',
    handler: async (req, res) => {
      let raw = ''
      req.on('data', (c) => { raw += c })
      req.on('end', async () => {
        let action
        let arg
        try {
          ;({ action, arg } = JSON.parse(raw || '{}'))
        } catch {
          return json(res, 400, { ok: false, error: 'malformed-json' })
        }
        if (action !== 'decide') return json(res, 400, { ok: false, error: 'unknown-action', action })
        const record = pending.get(String(arg?.id ?? ''))
        if (!record) return json(res, 409, { ok: false, error: 'not-pending', action })
        const envelope = decideEnvelope(record, arg)
        if (!envelope.ok) return json(res, 400, { ok: false, error: envelope.error, action })
        let receipt
        try {
          receipt = await ctx.apiProxy.respond(envelope.message)
        } catch (respondThrew) {
          // Loud, never silent: D62 — a decision that cannot reach the
          // engine reports inline instead of queueing.
          return json(res, 502, { ok: false, error: String(respondThrew?.message ?? respondThrew), action })
        }
        if (receipt?.accepted !== true) {
          // not-pending (someone answered first) or bad-response (engine
          // re-validation refused the batch) — both are conflicts, not bugs.
          return json(res, 409, { ok: false, error: receipt?.reason ?? 'respond-refused', action })
        }
        // First claimant won: drop immediately so the list never shows a
        // decided approval while the question/resolved frame is in flight.
        pending.delete(record.id)
        json(res, 200, { ok: true, action, id: record.id })
      })
    },
  })
}
