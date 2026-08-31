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
// B2 phase-1b also splices the phone's cairn sync rail through here (the
// SAME pairing tunnel): `/__cairn` (prefix, HTTP) and `/__cairn/sync`
// (upgrade) proxy prefix-stripped to the desktop's cairn-server sidecar
// (CAIRN_BIND, default 127.0.0.1:8190) — headers and bodies verbatim, the
// upgrade spliced raw after the mirror's 101. Loopback exposure only: the
// sidecar binds 127.0.0.1 and this route exists solely inside the engine's
// already-authenticated tunnel. Mirror down does not mean engine down: both
// legs fail honestly (502 / socket destroy) and never throw.
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

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

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

// ---- cairn sync proxy (B2 phase-1b) -------------------------------------
//
// The phone's cairn client dials ws://127.0.0.1:<proxyPort>/__cairn/sync on
// the transport's loopback proxy; this plugin splices that through to the
// desktop's cairn-server sidecar. Plain HTTP under /__cairn proxies the same
// way (healthz probes, push-tokens). Prefix-strip is the only rewrite:
// /__cairn/sync -> /sync - headers (the phone's Authorization bearer for
// CAIRN_SYNC_AUTH=bearer, ADR-0010 addendum) and bodies pass verbatim, and
// after the mirror's 101 the upgrade is RAW bytes both ways (we never parse
// cairn wire frames).

/** The sidecar bind the proxy splices to. `ARXA_CAIRN_MIRROR_BIND` wins -
 *  the same env-override discipline as the doorbell's ARXA_PUSHD_URL. */
export function cairnMirrorBind(env = process.env) {
  const raw = typeof env.ARXA_CAIRN_MIRROR_BIND === 'string' ? env.ARXA_CAIRN_MIRROR_BIND.trim() : ''
  return raw || '127.0.0.1:8190'
}

/** /__cairn/<rest> -> /<rest>; the bare prefix maps to '/'. Query strings
 *  survive (rawUrl is the request target). The webserver only dispatches
 *  the registered prefix here, so nothing else can arrive. */
export function stripCairnPrefix(rawUrl) {
  const rest = String(rawUrl ?? '/').slice('/__cairn'.length)
  return rest.startsWith('/') ? rest : '/' + rest
}

/** host:port -> [host, port] (loopback binds only; portless means 80). */
function splitBind(bind) {
  const at = bind.lastIndexOf(':')
  return at === -1 ? [bind, '80'] : [bind.slice(0, at), bind.slice(at + 1)]
}

/** Relay a mirror response head as raw wire bytes (the 101-upgrade splice
 *  and the plain non-101 relay render the same way). */
function responseHead(statusCode, statusMessage, headers) {
  const lines = ['HTTP/1.1 ' + statusCode + ' ' + (statusMessage ?? '')]
  for (const [name, value] of Object.entries(headers ?? {})) {
    for (const v of Array.isArray(value) ? value : [value]) lines.push(name + ': ' + v)
  }
  return lines.join('\r\n') + '\r\n\r\n'
}

/** One HTTP request through to the mirror. Streams both directions so
 *  request and response bodies are never buffered; a dead mirror is an
 *  honest 502 (headers already sent -> destroy), never a throw. */
function proxyHttpRequest(bind, req, res, httpImpl) {
  const [host, port] = splitBind(bind)
  const upstream = httpImpl.request({
    host,
    port: Number(port),
    method: req.method,
    path: stripCairnPrefix(req.url ?? '/'),
    headers: req.headers,
  }, (mirror) => {
    res.writeHead(mirror.statusCode ?? 502, mirror.headers)
    mirror.pipe(res)
  })
  upstream.on('error', () => {
    if (res.headersSent) {
      res.destroy()
      return
    }
    res.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ error: 'cairn-sidecar-unreachable' }))
  })
  req.pipe(upstream)
}

/** The /sync WebSocket splice: negotiate with the mirror, relay its 101 head
 *  verbatim, then pipe both sockets raw. A non-101 answer (401 wrong bearer,
 *  404) is relayed as a plain response so the client sees the mirror's
 *  honest status; a dead mirror just destroys the socket. */
function spliceCairnUpgrade(bind, req, socket, head, httpImpl, wsStats = null) {
  const [host, port] = splitBind(bind)
  const upstream = httpImpl.request({
    host,
    port: Number(port),
    path: stripCairnPrefix(req.url ?? '/'),
    headers: req.headers,
  })
  upstream.on('upgrade', (mirrorRes, mirrorSocket, mirrorHead) => {
    if (wsStats) wsStats.ok += 1
    socket.write(responseHead(mirrorRes.statusCode, mirrorRes.statusMessage, mirrorRes.headers))
    if (mirrorHead?.length) socket.write(mirrorHead)
    mirrorSocket.pipe(socket)
    socket.pipe(mirrorSocket)
    const die = () => {
      mirrorSocket.destroy()
      socket.destroy()
    }
    mirrorSocket.on('error', die)
    socket.on('error', die)
    mirrorSocket.on('close', die)
    socket.on('close', die)
  })
  upstream.on('response', (mirrorRes) => {
    if (wsStats) wsStats.refused += 1
    const chunks = []
    mirrorRes.on('data', (c) => chunks.push(c))
    mirrorRes.on('end', () => {
      socket.end(
        responseHead(mirrorRes.statusCode, mirrorRes.statusMessage, mirrorRes.headers) +
          Buffer.concat(chunks),
      )
    })
  })
  upstream.on('error', () => {
    if (wsStats) wsStats.failed += 1
    socket.destroy()
  })
  upstream.end()
}

/** Register both legs. The upgrade leg rides webServer.registerUpgrade -
 *  exact-path, one protocol owner per path (the webserver destroys sockets
 *  for upgrade paths nothing claims). The optional call keeps older fakes
 *  honest; the real webServer always carries it. */
export function applyCairnProxy(ctx, deps = {}) {
  const httpImpl = deps.httpImpl ?? http
  const bind = cairnMirrorBind(deps.env ?? process.env)
  ctx.webServer.register({
    name: 'arxa-approvals-cairn-proxy',
    path: '/__cairn',
    kind: 'prefix',
    handler: (req, res) => proxyHttpRequest(bind, req, res, httpImpl),
  })
  ctx.webServer.registerUpgrade?.({
    path: '/__cairn/sync',
    handler: (req, socket, head) => {
      if (wsStats) wsStats.attempts += 1
      spliceCairnUpgrade(bind, req, socket, head, httpImpl, wsStats)
    },
  })

  // Boot observability: the phone's sync-decision hinges on whether this
  // bootstrap was ever reached. Two counters, exposed for the rig.
  const bootStats = { hits: 0, ok: 0, lastHitAt: null }
  // WS splice diagnostics: attempts (phone reached the upgrade), ok (mirror
  // answered 101 and the splice is live), refused (mirror answered non-101),
  // failed (mirror unreachable). Exposed via /__arxa/cairn-sync/_stats.
  const wsStats = { attempts: 0, ok: 0, refused: 0, failed: 0 }

  // Bootstrap bearer for the paired phone: the sync session it opens
  // through the proxy must present the mirror's CAIRN_SYNC_BEARER_TOKEN
  // (ADR-0010 addendum) so the session is AUTHENTICATED and its push-token
  // registration sticks. The tunnel is the auth boundary — everything else
  // it exposes (these approvals routes included) already rides the same
  // trust — so handing the paired phone the secret changes nothing about
  // who can read what; it only gives the sync session an identity.
  ctx.webServer.register({
    name: 'arxa-approvals-cairn-sync-bootstrap',
    path: '/__arxa/cairn-sync',
    kind: 'exact',
    handler: async (req, res) => {
      bootStats.hits += 1
      bootStats.lastHitAt = new Date().toISOString()
      const token = deps.cairnSyncToken
        ? await deps.cairnSyncToken()
        : await cairnSyncToken(deps.env ?? process.env)
      if (!token) {
        res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ error: 'cairn-sync-not-configured' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ token }))
      bootStats.ok += 1
    },
  })
  ctx.webServer.register({
    name: 'arxa-approvals-cairn-sync-stats',
    path: '/__arxa/cairn-sync/_stats',
    kind: 'exact',
    handler: async (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ...bootStats, ws: { ...wsStats } }))
    },
  })
}

/** The sync bearer a paired phone may bootstrap with (B2 phase-1b).
 *  `ARXA_CAIRN_SYNC_TOKEN` wins (dev rigs); otherwise the desktop sidecar
 *  keystore's CAIRN_SYNC_BEARER_TOKEN (cairn-server.env, same app-local-
 *  data dir as pushd.env, read through the doorbell library's keystore
 *  helpers). Null = not configured → the route 404s and the phone boots
 *  localOnly (honest degradation, never a boot failure). */
export async function cairnSyncToken(env = process.env, readFile = fs.readFileSync, loadLib = loadDoorbell) {
  const override = typeof env.ARXA_CAIRN_SYNC_TOKEN === 'string' ? env.ARXA_CAIRN_SYNC_TOKEN.trim() : ''
  if (override) return override
  let lib
  try {
    lib = await loadLib()
  } catch {
    return null
  }
  if (typeof lib?.appDataDir !== 'function' || typeof lib?.parseEnvFile !== 'function') return null
  try {
    const keystore = lib.parseEnvFile(readFile(path.join(lib.appDataDir(env), 'cairn-server.env'), 'utf8'))
    const token = typeof keystore.CAIRN_SYNC_BEARER_TOKEN === 'string' ? keystore.CAIRN_SYNC_BEARER_TOKEN.trim() : ''
    return token || null
  } catch {
    return null
  }
}
// ---- mirror-out writer (B2 phase-1b, gated) -----------------------------
//
// OFF by default (the push-doorbell convention): ARXA_MIRROR_OUT=true makes
// every fold POST its cairn-row to the desktop mirror's /ingest — the
// phone's sync rail then carries it (row payload + org_id tenant tag), and
// the doorbell fires per the mirror's table config. The admin bearer comes
// from the same keystore the bootstrap route reads. Best-effort like the
// doorbell: a failed POST is a counted debug log, never a throw — sync
// correctness rides the durable LSN checkpoint, not this hint.

/** The mirror-out runtime config. Enabled by the literal env gate OR the
 *  sidecar keystore's ARXA_MIRROR_OUT=true — the keystore copy is how the
 *  posture survives desktop restarts the operator didn't hand-launch.
 *  The ingest base rides the SAME bind as the proxy (ARXA_CAIRN_MIRROR_BIND). */
export async function mirrorOutConfig(env = process.env, readFile = fs.readFileSync, loadLib = loadDoorbell) {
  const envFlag = typeof env.ARXA_MIRROR_OUT === 'string' && env.ARXA_MIRROR_OUT.trim() === 'true'
  let enabled = envFlag
  if (!enabled) {
    try {
      const lib = await loadLib()
      if (typeof lib?.appDataDir === 'function' && typeof lib?.parseEnvFile === 'function') {
        const keystore = lib.parseEnvFile(readFile(path.join(lib.appDataDir(env), 'cairn-server.env'), 'utf8'))
        enabled = typeof keystore.ARXA_MIRROR_OUT === 'string' && keystore.ARXA_MIRROR_OUT.trim() === 'true'
      }
    } catch { /* unreadable keystore stays gate-off */ }
  }
  return { enabled, ingestUrl: 'http://' + cairnMirrorBind(env) + '/ingest' }
}

/** The admin bearer for /ingest (ADR-0042): ARXA_MIRROR_ADMIN_TOKEN wins;
 *  else the sidecar keystore's CAIRN_ADMIN_TOKEN (cairn-server.env, the
 *  same file the bootstrap route reads). Null = not configured → skip.
 *  Ingest stamping makes this the WRITE-side credential: the rows land
 *  under the mirror's own identity, so keep it loopback-only. */
export async function mirrorAdminToken(env = process.env, readFile = fs.readFileSync, loadLib = loadDoorbell) {
  const override = typeof env.ARXA_MIRROR_ADMIN_TOKEN === 'string' ? env.ARXA_MIRROR_ADMIN_TOKEN.trim() : ''
  if (override) return override
  let lib
  try {
    lib = await loadLib()
  } catch {
    return null
  }
  if (typeof lib?.appDataDir !== 'function' || typeof lib?.parseEnvFile !== 'function') return null
  try {
    const keystore = lib.parseEnvFile(readFile(path.join(lib.appDataDir(env), 'cairn-server.env'), 'utf8'))
    const token = typeof keystore.CAIRN_ADMIN_TOKEN === 'string' ? keystore.CAIRN_ADMIN_TOKEN.trim() : ''
    return token || null
  } catch {
    return null
  }
}

/** The /ingest body for one folded approval (ADR-0042 contract). The row
 *  carries org_id=local — the tenant tag the mirror's tenant-wide doorbell
 *  hint needs (ADR-0010 addendum + fanout's tenant-column source). */
export function mirrorOutBody(record) {
  return { events: [{ table: 'approvals', op: 'upsert', row: { ...record, org_id: 'local' } }] }
}

/** The /ingest body for one terminal task (B3: 'everything the session
 *  tools trigger' — task completions ride the phone rail too, as their own
 *  table so the phone can project them independently of approvals). */
export function mirrorOutTaskBody(sessionId, finished, nowMs = Date.now()) {
  const failed = finished.outcome !== 'completed'
  return { events: [{ table: 'tasks', op: 'upsert', row: {
    id: String(finished.id),
    session_id: String(sessionId ?? ''),
    kind: 'task',
    summary: String(finished.label ?? finished.id),
    status: failed ? 'failed' : 'completed',
    raised_at: Number(finished.startedAt ?? 0),
    finished_at: Number(finished.finishedAt ?? nowMs),
    org_id: 'local',
  } }] }
}

/** One mirror-out POST with a ready /ingest body. Returns {ok, status?|error?};
 *  NEVER throws — timeouts and refusals are return values. */
export async function postMirrorOut(cfg, body, adminToken, fetchImpl = fetch) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2000)
  try {
    const res = await fetchImpl(cfg.ingestUrl, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + adminToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) return { ok: false, status: res.status }
    return { ok: true, status: res.status }
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) }
  } finally {
    clearTimeout(timer)
  }
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

  // The gated mirror-out writer (B2 phase-1b): folds POST to the mirror's
  // /ingest so the phone's sync rail carries approvals. The deps seam keeps
  // the selftest fetch-free; the real path reads the keystore bearer.
  const mirrorOut = (record) => {
    if (typeof deps.mirrorOut === 'function') {
      try { deps.mirrorOut(record) } catch { /* never throws into the engine */ }
      return
    }
    void (async () => {
      try {
        const cfg = await mirrorOutConfig(deps.env ?? process.env, fs.readFileSync, deps.loadLib ?? loadDoorbell)
        if (!cfg.enabled) return
        const adminToken = await mirrorAdminToken(deps.env ?? process.env, fs.readFileSync, deps.loadLib ?? loadDoorbell)
        if (!adminToken) {
          console.error('[arxa-approvals] mirror-out gated on but no admin bearer (cairn-server.env)')
          return
        }
        const result = await postMirrorOut(cfg, mirrorOutBody(record), adminToken)
        if (!result.ok) {
          console.error('[arxa-approvals] mirror-out failed:', result.status ?? result.error)
        }
      } catch { /* never throws into the engine */ }
    })()
  }

  const mirrorOutTask = (finished, frame) => {
    if (typeof deps.mirrorOutTask === 'function') {
      try { deps.mirrorOutTask(finished, frame) } catch { /* never throws into the engine */ }
      return
    }
    void (async () => {
      try {
        const cfg = await mirrorOutConfig(deps.env ?? process.env, fs.readFileSync, deps.loadLib ?? loadDoorbell)
        if (!cfg.enabled) return
        const adminToken = await mirrorAdminToken(deps.env ?? process.env, fs.readFileSync, deps.loadLib ?? loadDoorbell)
        if (!adminToken) return
        const sessionId = String(frame?.payload?.sessionId ?? '')
        await postMirrorOut(cfg, mirrorOutTaskBody(sessionId, finished), adminToken)
      } catch { /* never throws into the engine */ }
    })()
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
        if (fresh) {
          ringDoorbell(fresh)
          mirrorOut(fresh)
        }
        for (const finished of foldJobsFrame(announcedJobs, frame)) {
          ringTaskDoorbell(finished)
          mirrorOutTask(finished, frame)
        }
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
  // The cairn sync rail rides the same tunnel (B2 phase-1b) - always on;
  // a missing sidecar is the handlers' honest 502, never a boot failure.
  applyCairnProxy(ctx, deps)
}
