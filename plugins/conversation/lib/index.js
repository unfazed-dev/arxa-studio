// arxa-conversation — the phone's window into a dsh session (the mobile
// Claude-Code-replica rail; code_shell in arxa_studio_mobile).
//
// Derived-only posture, same fence as arxa-approvals (:31-44 there): nothing
// persists here. Transcripts fold ON DEMAND from the durable session log via
// apiProxy.sessions.history (JSONL is the source of truth — an engine restart
// re-serves full history with no warm-up), and a send injects a plain user
// turn via apiProxy.sessions.prompt (queue = send, steer = inject mid-turn).
//
//   GET  /__arxa/conversations
//        → { sessions: [{ id, name, title, state, running, parkedReason,
//            project, workspace, createdAt, updatedAt, dshSessionId, org }] }
//        (flattened sidebar state + the live-turn flag — running is the
//        plugin's turn/start..turn/end tracking, the phone's active dot)
//   GET  /__arxa/conversations/<id>/messages?limit=<n 1..1000, default 200>
//        → { sessionId, messages: [{ id, seq, role, kind, text, at, ... }] }
//        ascending by seq; the assistant surface folds into expandable rows:
//        kind 'text' | 'thinking' | 'tool' (tool rows carry name, input and
//        the paired output text + error flag when its result arrived; user
//        rows have no kind). Synthetic context/injects and tool-result user
//        messages are not conversation surface
//   POST /__arxa/conversations/<id>/messages   body { text, mode?, images? }
//        images: [{ mediaType, data }<canonical base64>] — admitted by the
//        host at prompt admission (count/bytes/media-type limits apply)
//        → { ok: true, accepted: true, rpcId }
//        errors: 400 malformed-json | empty-text | malformed-image ·
//        404 no-such-session · 409 no-live-agent · 502 prompt-failed |
//        sidebar-unavailable | history-failed
//   GET  /__arxa/conversations/<id>/attachments/<attachmentId>
//        → { attachment: ref, data }<base64> — the session must reference the
//        image (the host owns that ownership check); transcript thumbnails
//        errors: 404 no-such-session | attachment-not-found · 502 attachment-failed
//   GET  /__arxa/conversations/events        (SSE, text/event-stream)
//        → live pings: { type: 'sessions' } when the session list changes;
//          { type: 'session', sessionId, reason } when one conversation's
//          surface moved (user/message | assistant/message | turn/start |
//          turn/end | session/title | question/requested | question/resolved)
//        one shared apiProxy.events.mux tap fans out to every subscriber;
//        ': ping' comments every 15s keep intermediaries honest
//   GET  /__arxa/conversations/<id>/commands
//        → { commands: [{ name, description, input }] } — the engine's human
//        command registry (the studio composer's `+` palette, verbatim); a
//        parked session is hydrated first (commands are agent-scoped)
//   POST /__arxa/conversations/<id>/commands body { line }
//        line: the complete slash-command line, e.g. "/compact" — executed by
//        the engine's registry WITHOUT reaching the model
//        → { ok: true, kind: 'success'|'error', text } — the command's own
//        honest result text; errors: 400 malformed-json | empty-line ·
//        404 no-such-session · 409 no-live-agent · 502 command-failed
//   GET  /__arxa/conversations/<id>/export
//        → the transcript as a markdown download (text/markdown,
//        content-disposition attachment) folded from the same durable log
//   POST /__arxa/conversations/<id>/model    body { provider, model }
//        → { ok: true, selected } (apiproxy resumes the session itself)
//   POST /__arxa/conversations/<id>/mode     body { mode }
//        → { ok: true, mode } — appends one durable sandbox/mode event; a
//        parked session is hydrated through agents.resume first, so the
//        switch never depends on the session's agent being live
//        errors: 400 malformed-json | unknown-mode · 404 no-such-session ·
//        409 no-live-agent (no agents factory) · 502 mode-failed
//
// Boundaries (deliberate, do not relax):
// - The engine re-validates every prompt at host admission; this plugin is
//   downstream of that fence and stays permissive.
// - No doorbell, no mirrorOut yet: the transcript is pull-based over the
//   already-authenticated tunnel. Push-on-new-message joins the existing
//   doorbell rail only on product evidence (ponytail: same ceiling as the
//   approvals doorbell decision B1 — evidence first, rail second).
// - Never throws into the engine: every handler answers, failures are
//   honest status codes.

import { randomUUID } from 'node:crypto'

import { SANDBOX_MODES, setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'

export const name = 'arxa-conversation'
export const inject = ['webServer', 'apiProxy', 'agents', 'sandboxPolicy', 'commands', 'agentPresets']

/** Per-row char ceiling for the fold — a pathological tool output must not
 * drag megabytes through the tunnel. The marker names the honest count. */
const MAX_ROW_CHARS = 24000

function capText(text) {
  if (typeof text !== 'string') return ''
  return text.length <= MAX_ROW_CHARS
    ? text
    : text.slice(0, MAX_ROW_CHARS) + '\n… truncated (' + text.length + ' chars)'
}

/** Pretty-print a tool-call arguments string when it parses as JSON — the
 * phone's expandable sheet shows it verbatim, so make it readable. */
function prettyArguments(raw) {
  if (typeof raw !== 'string' || raw === '') return ''
  try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw }
}

/** Fold history entries ({ event, view } pairs) into phone transcript rows.
 * Human turns (user/message whose source is genuinely the user), and the
 * assistant surface the phone renders as expandable rows: finalized
 * assistant/message blocks split into 'text' and 'thinking' rows, and each
 * tool/call becomes a 'tool' row whose matching tool/result (paired by
 * callId) folds in as its output. Streaming chunks, boundary markers and
 * log-only events are not conversation surface. When [sessionId] is
 * provided every row carries a unique globally-stable id
 * ('<sessionId>:<seq>:<n>' — several rows can share one seq); the phone keys
 * widgets and its cache on it. */
export function foldHistory(entries, { sessionId } = {}) {
  const out = []
  const pendingCalls = new Map() // callId -> the tool row awaiting its result
  let nonce = 0
  for (const entry of entries ?? []) {
    const e = entry?.event
    if (!e || typeof e !== 'object' || typeof e.seq !== 'number') continue
    const push = (row) => {
      if (typeof sessionId === 'string' && sessionId !== '') row.id = sessionId + ':' + e.seq + ':' + nonce++
      out.push(row)
    }
    if (e.type === 'user/message') {
      const m = e.data
      if (!m || m.role !== 'user') continue
      if (m.source?.kind !== 'user') continue
      const text = textOf(m.content)
      const images = imagesOf(m.content)
      if (text === '' && images.length === 0) continue
      const row = { seq: e.seq, role: 'user', text: capText(text), at: e.time }
      if (images.length > 0) row.images = images
      push(row)
    } else if (e.type === 'assistant/message') {
      const m = e.data?.message
      if (!m || m.role !== 'assistant') continue
      const blocks = Array.isArray(m.content) ? m.content : []
      for (const block of blocks) {
        // 'tool-call' blocks deliberately do NOT fold here — the discrete
        // tool/call events carry the same calls (with arguments); emitting
        // both would duplicate the row.
        if (block?.type === 'reasoning' && typeof block.text === 'string' && block.text.trim() !== '') {
          push({ seq: e.seq, role: 'assistant', kind: 'thinking', text: capText(block.text), at: e.time })
        } else if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
          push({ seq: e.seq, role: 'assistant', kind: 'text', text: capText(block.text), at: e.time })
        }
      }
    } else if (e.type === 'tool/call') {
      const d = e.data
      if (!d || typeof d.callId !== 'string' || typeof d.name !== 'string') continue
      const row = {
        seq: e.seq, role: 'assistant', kind: 'tool', name: d.name,
        input: capText(prettyArguments(d.arguments)), at: e.time,
      }
      pendingCalls.set(d.callId, row)
      push(row)
    } else if (e.type === 'tool/result') {
      const results = Array.isArray(e.data?.message?.content) ? e.data.message.content : []
      const result = results.find((b) => b?.type === 'tool-result')
      const row = result == null ? undefined : pendingCalls.get(result.toolCallId)
      if (row === undefined) continue
      const text = (Array.isArray(result.content) ? result.content : [])
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n')
        .trim()
      row.text = capText(text)
      row.error = result.isError === true
    }
  }
  return out.sort((a, b) => a.seq - b.seq)
}

/** Stamp each session row with its live turn state (the phone's active
 * indicator). Pure; selftest-owned. Unknown -> false. */
export function withRunning(rows, running) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    running: typeof row?.dshSessionId === 'string' && running?.has(row.dshSessionId) === true,
  }))
}

function textOf(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

/** Attachment ids of the admitted image blocks (durable refs in order). */
function imagesOf(content) {
  if (!Array.isArray(content)) return []
  return content
    .filter((b) => b?.type === 'image' && typeof b.attachment?.attachmentId === 'string')
    .map((b) => b.attachment.attachmentId)
}

/** Fold the session's sandbox mode: the LAST sandbox/mode event wins;
 * absent means the deployment default (unknown here — the phone shows the
 * deployment's own default via the desktop). */
export function foldMode(entries) {
  let mode
  for (const entry of entries ?? []) {
    const e = entry?.event
    if (e?.type === 'sandbox/mode' && typeof e.data?.mode === 'string') mode = e.data.mode
  }
  return mode ?? null
}

/** Fold one apiProxy.events.mux frame into the phone's live SSE payload
 * (or null when the frame is not phone surface). Pure; selftest-owned.
 *   session/projection        → { type: 'sessions' }   (list moved)
 *   user/message (source kind  → { type: 'session', sessionId, reason: 'user/message' })
 *   'user') / assistant/message, turn/start, turn/end, session/title,
 *   question/requested, question/resolved → { type: 'session', ... }
 * Streaming chunks, tool calls/results and log-only events are NOT phone
 * surface — the phone re-pulls the folded transcript, it does not stream.
 * The payload.sessionId carries the dsh session id form when the frame has
 * one (the routes' key). */
export function foldMuxEvent(frame) {
  const payload = frame?.payload
  const type = payload?.type
  if (typeof type !== 'string' || type === '') return null
  if (type === 'session/projection') return { type: 'sessions' }
  // Surface moves ride the session/event WRAPPER — measured on the wire:
  // payload { type: 'session/event', sessionId, event: { type: 'turn/start',
  // seq, time, data } }. Unwrap before matching; direct domain frames still
  // work (type falls through) so the selftest's legacy shapes stay honest.
  const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : null
  const domainType = type === 'session/event' ? payload?.event?.type : type
  const reasons = ['user/message', 'assistant/message', 'turn/start', 'turn/end', 'session/title', 'question/requested', 'question/resolved']
  if (!reasons.includes(domainType)) return null
  // user/message frames from the model's own context-injects are not human
  // surface, but they still move the log — the phone's fold already filters
  // them, so a cheap re-pull is harmless. Every reason pings.
  if (!sessionId) return null
  return { type: 'session', sessionId, reason: domainType }
}

/** Render the transcript as a markdown download. Pure; selftest-owned.
 * Same human-turn filter as foldHistory (this is the conversation, not the
 * operation log): user rows and finalized assistant rows, ascending by seq.
 * Image references render as their attachment ids — the bytes live in the
 * engine's attachment store keyed by exactly those ids. */
export function renderTranscriptMarkdown(sessionId, entries, { mode } = {}) {
  const lines = [
    '# ' + sessionId,
    '',
    mode ? 'Sandbox mode: ' + mode : null,
    '',
  ].filter((l) => l !== null)
  for (const entry of entries ?? []) {
    const e = entry?.event
    if (!e || typeof e !== 'object' || typeof e.seq !== 'number') continue
    if (e.type === 'user/message') {
      const m = e.data
      if (!m || m.role !== 'user' || m.source?.kind !== 'user') continue
      const text = textOf(m.content)
      const images = imagesOf(m.content)
      if (text === '' && images.length === 0) continue
      lines.push('## user', '')
      if (text !== '') lines.push(text, '')
      for (const id of images) lines.push('- image: ' + id)
      if (images.length > 0) lines.push('')
    } else if (e.type === 'assistant/message') {
      const m = e.data?.message
      if (!m || m.role !== 'assistant') continue
      const text = textOf(m.content)
      if (text === '') continue
      lines.push('## assistant', '', text, '')
    }
  }
  return lines.join('\n').trim() + '\n'
}
/** Flatten the sidebar snapshot (orgs → sessions) into phone session rows. */
export function flattenSidebar(snapshot) {
  const rows = []
  for (const org of snapshot?.orgs ?? []) {
    for (const s of org?.sessions ?? []) {
      rows.push({
        id: String(s.id ?? ''),
        name: s.name ?? null,
        title: (typeof s.displayTitle === 'string' && s.displayTitle !== '' ? s.displayTitle : s.name) ?? null,
        state: s.state ?? null,
        running: s.running ?? null,
        parkedReason: s.parkedReason ?? null,
        project: s.project ?? null,
        workspace: s.workspace ?? null,
        createdAt: s.createdAt ?? null,
        updatedAt: s.updatedAt ?? null,
        dshSessionId: s.dshSessionId ?? null,
        org: org.name ?? null,
      })
    }
  }
  return rows
}

export function apply(ctx, deps = {}) {
  const api = deps.apiProxy ?? ctx.apiProxy
  const agents = deps.agents ?? ctx.agents
  const sandboxPolicy = deps.sandboxPolicy ?? ctx.sandboxPolicy
  const commands = deps.commands ?? ctx.commands
  const presets = deps.presets ?? ctx.agentPresets
  const httpImpl = deps.httpImpl ?? ((url, opts) => fetch(url, opts))
  // The dsh child receives its port via --port argv, not env — ARXA_PORT is
  // rarely set; the launcher's default (7891) is the honest fallback.
  const sidebarUrl = deps.sidebarUrl
    ?? 'http://127.0.0.1:' + ((deps.env ?? process.env).ARXA_PORT ?? '7891')
    + '/__arxa/sidebar/state'

  const readBody = (req) => new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')) } catch { resolve(undefined) }
    })
  })

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }

  // ---- sessions list: the flattened desktop sidebar snapshot
  ctx.webServer.register({
    name: 'arxa-conversations-list',
    path: '/__arxa/conversations',
    kind: 'exact',
    handler: async (req, res) => {
      try {
        const r = await httpImpl(sidebarUrl, { signal: AbortSignal.timeout(4000) })
        if (!r.ok) {
          return json(res, 502, { ok: false, error: 'sidebar-unavailable', status: r.status })
        }
        return json(res, 200, { sessions: withRunning(flattenSidebar(await r.json()), live.running) })
      } catch (e) {
        return json(res, 502, { ok: false, error: 'sidebar-unavailable', detail: String(e?.message ?? e) })
      }
    },
  })

  // ---- live rail: one shared events.mux tap fanned out over SSE subscribers.
  // The engine's mux is the same feed the studio web client rides; frames the
  // phone cares about (foldMuxEvent above) become one-line JSON pings. The
  // tap starts with the first subscriber, re-dials with backoff if the stream
  // ever ends, and stops (interval cleared) when the last subscriber leaves.
  // [running] is the live-turn set (turn/start .. turn/end per dsh session) —
  // the sessions-list active indicator rides it (withRunning on the list
  // route). It seeds empty on plugin boot and converges at the next turn
  // boundary: honest, not clairvoyant.
  const live = { subs: new Set(), tap: null, backoff: null, heartbeat: null, running: new Set() }
  function liveBroadcast(event) {
    const payload = 'data: ' + JSON.stringify(event) + '\n\n'
    for (const res of live.subs) {
      try { res.write(payload) } catch { live.subs.delete(res) }
    }
  }
  async function liveTapLoop(signal) {
    while (!signal.aborted) {
      try {
        for await (const frame of api.events.mux({}, signal)) {
          // the live-turn tracking rides the same frames the pings do —
          // same session/event wrapper foldMuxEvent unwraps: the domain
          // event is NESTED (payload.event.type), never payload.type
          const payload = frame?.payload
          const domainType = payload?.type === 'session/event' ? payload?.event?.type : payload?.type
          const sid = typeof payload?.sessionId === 'string' ? payload.sessionId : null
          if (sid !== null && domainType === 'turn/start') live.running.add(sid)
          if (sid !== null && domainType === 'turn/end') live.running.delete(sid)
          const event = foldMuxEvent(frame)
          if (event) liveBroadcast(event)
        }
      } catch (e) {
        if (signal.aborted) return
      }
      // the stream ended (engine restart of the inner rail?) — re-dial.
      // unref: a dial-wait timer must never hold the host process open —
      // the selftest hung on exactly this timer until it was unref'd.
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 2000)
        if (typeof t.unref === 'function') t.unref()
      })
    }
  }
  function liveStart() {
    if (live.tap) return
    const ac = new AbortController()
    live.ac = ac
    live.tap = liveTapLoop(ac.signal)
    live.heartbeat = setInterval(() => {
      for (const res of live.subs) {
        try { res.write(': ping\n\n') } catch { live.subs.delete(res) }
      }
    }, 15000)
    // unref: bookkeeping must never hold the host process open (same
    // lesson as the re-dial backoff below)
    if (typeof live.heartbeat.unref === 'function') live.heartbeat.unref()
  }
  function liveStop() {
    if (live.subs.size > 0 || !live.tap) return
    // The tap itself STAYS: the live-turn tracking (live.running) must keep
    // watching turn/start..turn/end even with zero subscribers, or a turn
    // that runs while no phone is connected would leave the active flag
    // stale. Only the subscriber heartbeat (and its interval) retires.
    clearInterval(live.heartbeat)
  }
  // Generator-effect cleanup (the engine's ctx.effect); guarded so the
  // selftest's minimal fake ctx can still drive the routes.
  if (typeof ctx.effect === 'function') {
    ctx.effect(function* () {
      yield () => { live.ac?.abort() }
    }, 'arxa-conversation: live tap')
  }
  // Boot-start the tap: live-turn tracking must watch from process start,
  // not from the phone's first SSE subscribe — a turn that runs before any
  // subscriber ever connected (fresh app sitting on the sessions list)
  // was invisible to the active dot. Subscribers are only the fan-out;
  // the tracking is the point. Guarded: fake ctxs without an events mux
  // (selftest fakes) skip it.
  if (typeof api?.events?.mux === 'function') liveStart()

  // ---- SSE: GET /__arxa/conversations/events (served from the prefix
  // handler below — the 4-segment branch; kind-exact vs prefix match order
  // is not a contract I am willing to bet the live rail on)
  function serveEvents(req, res) {
    if (req.method !== 'GET') return json(res, 404, { ok: false, error: 'no-such-route' })
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    })
    req.on('close', () => {
      live.subs.delete(res)
      liveStop()
    })
    live.subs.add(res)
    liveStart()
    // retry hint + an immediate hello so the client knows the rail is up
    res.write('retry: 2000\n\n')
    res.write('data: ' + JSON.stringify({ type: 'hello' }) + '\n\n')
  }

  // ---- per-session transcript + send
  ctx.webServer.register({
    name: 'arxa-conversation-session',
    // NO trailing slash: the webserver's prefix match appends its own
    // '/' — a trailing-slash registration can never match (empty 404).
    path: '/__arxa/conversations',
    kind: 'prefix',
    handler: async (req, res) => {
      const url = new URL(req.url, 'http://engine.local')
      const parts = url.pathname.split('/')
      // ['', '__arxa', 'conversations', '<id>', '<messages|models|model|mode|commands|export>',
      //  ('attachments' → '<attachmentId>')]
      if (parts.length === 4 && parts[3] === 'events') return serveEvents(req, res)
      if (parts.length === 6 && parts[3] !== '' && parts[4] === 'attachments' && parts[5] !== '') {
        return serveAttachment(req, res, {
          api,
          sessionId: decodeURIComponent(parts[3]),
          attachmentId: decodeURIComponent(parts[5]),
        })
      }
      if (parts.length !== 5 || parts[3] === '') {
        return json(res, 404, { ok: false, error: 'no-such-route' })
      }
      const sessionId = decodeURIComponent(parts[3])
      const section = parts[4]

      // ---- attachment read (phone transcript thumbnails): the RPC owns the
      // session-ownership check (the image must be referenced by THIS session).
      async function serveAttachment(req, res, { api, sessionId, attachmentId }) {
        if (req.method !== 'GET') return json(res, 404, { ok: false, error: 'no-such-route' })
        let response
        try {
          response = await api.sessions.attachment({ rpcId: randomUUID(), payload: { sessionId, attachmentId } })
        } catch (e) {
          return json(res, 502, { ok: false, error: 'attachment-failed', detail: String(e?.message ?? e) })
        }
        if (response?.result?.ok !== true) {
          const err = response?.result?.error
          if (err?.code === 'session-not-found') {
            return json(res, 404, { ok: false, error: 'no-such-session', sessionId })
          }
          return json(res, 404, { ok: false, error: 'attachment-not-found', code: err?.code, detail: err?.message })
        }
        return json(res, 200, response.result.value)
      }

      // ---- human commands: the studio composer's `+` palette, verbatim.
      // commands are agent-scoped engine RPCs, so a parked session is
      // hydrated first (the same agents.resume factory every prompt ride
      // uses). Execution NEVER reaches the model — the registry answers
      // from the log and the seams (/compact folds history, /plan toggles
      // plan mode, /goal edits the goal record, /permission + /model are
      // the interactive ones the phone wires to its own pickers).
      async function hydrate(sessionId) {
        const direct = typeof agents?.get === 'function' ? agents.get(sessionId) : undefined
        const directAgent = direct?.agent ?? direct
        if (directAgent?.session) return { ok: true, agent: directAgent }
        if (typeof agents?.resume !== 'function') return { ok: false, code: 'no-agents' }
        try {
          // Mount the deployment's default preset during resume so the
          // resumed agent carries the FULL per-agent surface — the compact/
          // plan/model commands live in the preset's agent scope, not in
          // the global registry (the web rides the identical composition
          // through the gateway's agent resolver).
          const setup = typeof presets?.resolve === 'function' && typeof presets?.mount === 'function'
            ? async (agentCtx) => {
                const resolved = await presets.resolve(undefined)
                await presets.mount(agentCtx, resolved.id)
              }
            : undefined
          const handle = await agents.resume({
            resumeSessionId: sessionId,
            ...(setup ? { setup } : {}),
          })
          const agent = handle?.agent ?? handle
          return agent?.session ? { ok: true, agent } : { ok: false, code: 'no-live-agent' }
        } catch (e) {
          const detail = String(e?.message ?? e)
          if (/not found|no such session/i.test(detail)) return { ok: false, code: 'no-such-session', detail }
          return { ok: false, code: 'resume-failed', detail }
        }
      }

      if (req.method === 'GET' && section === 'commands') {
        if (typeof commands?.list !== 'function') return json(res, 502, { ok: false, error: 'commands-failed', detail: 'no commands registry' })
        const up = await hydrate(sessionId)
        if (!up.ok) {
          if (up.code === 'no-such-session') return json(res, 404, { ok: false, error: 'no-such-session', sessionId })
          if (up.code === 'no-agents' || up.code === 'no-live-agent') return json(res, 409, { ok: false, error: 'no-live-agent' })
          return json(res, 502, { ok: false, error: 'commands-failed', detail: up.detail })
        }
        const agent = up.agent
        try {
          const rows = commands.list(agent)
          return json(res, 200, { commands: rows ?? [] })
        } catch (e) {
          return json(res, 502, { ok: false, error: 'commands-failed', detail: String(e?.message ?? e) })
        }
      }

      if (req.method === 'POST' && section === 'commands') {
        const body = await readBody(req)
        if (body === undefined) return json(res, 400, { ok: false, error: 'malformed-json' })
        const line = typeof body?.line === 'string' ? body.line.trim() : ''
        if (line === '' || !line.startsWith('/')) return json(res, 400, { ok: false, error: 'empty-line' })
        if (typeof commands?.execute !== 'function') return json(res, 502, { ok: false, error: 'command-failed', detail: 'no commands registry' })
        const up = await hydrate(sessionId)
        if (!up.ok) {
          if (up.code === 'no-such-session') return json(res, 404, { ok: false, error: 'no-such-session', sessionId })
          if (up.code === 'no-agents' || up.code === 'no-live-agent') return json(res, 409, { ok: false, error: 'no-live-agent' })
          return json(res, 502, { ok: false, error: 'command-failed', detail: up.detail })
        }
        try {
          // in-process registry call — the same object the web's command
          // remotes ride; undefined = the line did not resolve (unknown
          // name or syntax) and the registry logged nothing
          const outcome = await commands.execute(up.agent, line, [], new AbortController().signal)
          if (outcome === undefined || outcome === null) {
            return json(res, 400, { ok: false, error: 'unknown-command', line })
          }
          return json(res, 200, { ok: true, kind: outcome.result?.kind ?? 'success', text: outcome.result?.text ?? '' })
        } catch (e) {
          return json(res, 502, { ok: false, error: 'command-failed', detail: String(e?.message ?? e) })
        }
      }

      // ---- transcript export: the conversation as a markdown download
      if (req.method === 'GET' && section === 'export') {
        let response
        try {
          response = await api.sessions.history({ rpcId: randomUUID(), payload: { sessionId, maxMessages: 1000 } })
        } catch (e) {
          return json(res, 502, { ok: false, error: 'export-failed', detail: String(e?.message ?? e) })
        }
        if (response?.result?.ok !== true) {
          const err = response?.result?.error
          if (err?.code === 'session-not-found') return json(res, 404, { ok: false, error: 'no-such-session', sessionId })
          return json(res, 502, { ok: false, error: 'export-failed', code: err?.code, detail: err?.message })
        }
        const events = response.result.value?.events
        const body = renderTranscriptMarkdown(sessionId, events, { mode: foldMode(events) })
        res.writeHead(200, {
          'content-type': 'text/markdown; charset=utf-8',
          'content-disposition': 'attachment; filename="arxa-' + sessionId + '.md"',
          'cache-control': 'no-store',
        })
        return void res.end(body)
      }

      // ---- model directory (advisory; the menu's data)
      if (req.method === 'GET' && section === 'models') {
        let response
        try {
          response = await api.sessions.models({ rpcId: randomUUID(), payload: { sessionId } })
        } catch (e) {
          return json(res, 502, { ok: false, error: 'models-failed', detail: String(e?.message ?? e) })
        }
        if (response?.result?.ok !== true) {
          const err = response?.result?.error
          if (err?.code === 'session-not-found') {
            return json(res, 404, { ok: false, error: 'no-such-session', sessionId })
          }
          return json(res, 502, { ok: false, error: 'models-failed', code: err?.code, detail: err?.message })
        }
        return json(res, 200, response.result.value)
      }

      // ---- model selection
      if (req.method === 'POST' && section === 'model') {
        const body = await readBody(req)
        if (body === undefined) return json(res, 400, { ok: false, error: 'malformed-json' })
        const provider = typeof body?.provider === 'string' ? body.provider.trim() : ''
        const model = typeof body?.model === 'string' ? body.model.trim() : ''
        if (provider === '' || model === '') return json(res, 400, { ok: false, error: 'empty-model' })
        let response
        try {
          response = await api.sessions.selectModel({
            rpcId: randomUUID(),
            payload: { sessionId, provider, model },
          })
        } catch (e) {
          return json(res, 502, { ok: false, error: 'select-model-failed', detail: String(e?.message ?? e) })
        }
        if (response?.result?.ok !== true) {
          const err = response?.result?.error
          if (err?.code === 'session-not-found') {
            return json(res, 404, { ok: false, error: 'no-such-session', sessionId })
          }
          return json(res, 502, { ok: false, error: 'select-model-failed', code: err?.code, detail: err?.message })
        }
        return json(res, 200, { ok: true, selected: response.result.value?.selected })
      }

      // ---- sandbox mode (read-only | workspace-write | danger-full-access)
      if (req.method === 'POST' && section === 'mode') {
        const body = await readBody(req)
        if (body === undefined) return json(res, 400, { ok: false, error: 'malformed-json' })
        const mode = body?.mode
        if (!SANDBOX_MODES.includes(mode)) {
          return json(res, 400, { ok: false, error: 'unknown-mode', mode, allowed: SANDBOX_MODES })
        }
        // THE switch is a durable sandbox/mode event — it must not depend
        // on the session's agent being live. A parked session (engine child
        // restarted, or the phone's first touch of an old conversation) is
        // hydrated through the same agents.resume factory every prompt ride
        // uses; only then does the policy's write path append the event.
        let session = typeof agents?.get === 'function' ? agents.get(sessionId)?.session : undefined
        if (!session && typeof agents?.resume === 'function') {
          try {
            const handle = await agents.resume({ resumeSessionId: sessionId })
            session = handle?.agent?.session ?? handle?.session ?? null
          } catch (e) {
            const detail = String(e?.message ?? e)
            if (/not found|no such session/i.test(detail)) {
              return json(res, 404, { ok: false, error: 'no-such-session', sessionId })
            }
            return json(res, 502, { ok: false, error: 'mode-failed', detail })
          }
        }
        if (!session) return json(res, 409, { ok: false, error: 'no-live-agent' })
        try {
          setSandboxMode(session, mode)
        } catch (e) {
          return json(res, 502, { ok: false, error: 'mode-failed', detail: String(e?.message ?? e) })
        }
        return json(res, 200, { ok: true, mode })
      }

      if (req.method === 'GET' && section === 'messages') {
        const rawLimit = parseInt(url.searchParams.get('limit') ?? '200', 10)
        const maxMessages = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1000) : 200
        let response
        try {
          response = await api.sessions.history({ rpcId: randomUUID(), payload: { sessionId, maxMessages } })
        } catch (e) {
          return json(res, 502, { ok: false, error: 'history-failed', detail: String(e?.message ?? e) })
        }
        if (response?.result?.ok !== true) {
          const err = response?.result?.error
          if (err?.code === 'session-not-found') {
            return json(res, 404, { ok: false, error: 'no-such-session', sessionId })
          }
          return json(res, 502, { ok: false, error: 'history-failed', code: err?.code, detail: err?.message })
        }
        const events = response.result.value?.events
        // effective mode = last sandbox/mode event ?? the deployment default
        // (a small tail page can miss the creation-time event; the default
        // covers that — the only drift is an ancient mid-log override, and a
        // mode switch writes a NEW event the tail page catches).
        const mode = foldMode(events) ?? sandboxPolicy?.defaultMode ?? null
        return json(res, 200, { sessionId, mode, messages: foldHistory(events, { sessionId }) })
      }

      if (req.method === 'POST' && section === 'messages') {
        let raw = ''
        req.on('data', (c) => { raw += c })
        req.on('end', async () => {
          let body
          try {
            body = JSON.parse(raw || '{}')
          } catch {
            return json(res, 400, { ok: false, error: 'malformed-json' })
          }
          const text = typeof body?.text === 'string' ? body.text.trim() : ''
          const rawImages = Array.isArray(body?.images) ? body.images : []
          const images = []
          for (const img of rawImages) {
            if (img === null || typeof img !== 'object') continue
            const mediaType = typeof img.mediaType === 'string' ? img.mediaType : ''
            const data = typeof img.data === 'string' ? img.data : ''
            if (mediaType === '' || data === '') {
              return json(res, 400, { ok: false, error: 'malformed-image' })
            }
            images.push({ type: 'image', mediaType, data })
          }
          if (text === '' && images.length === 0) return json(res, 400, { ok: false, error: 'empty-text' })
          const mode = body?.mode === 'steer' ? 'steer' : 'queue'
          const content = []
          if (text !== '') content.push({ type: 'text', text })
          content.push(...images)
          let response
          try {
            response = await api.sessions.prompt({
              rpcId: randomUUID(),
              payload: { sessionId, mode, content },
            })
          } catch (e) {
            return json(res, 502, { ok: false, error: 'prompt-failed', detail: String(e?.message ?? e) })
          }
          if (response?.result?.ok !== true) {
            const err = response?.result?.error
            if (err?.code === 'session-not-found') {
              return json(res, 404, { ok: false, error: 'no-such-session', sessionId })
            }
            if (err?.code === 'agent-busy' || /agent/i.test(String(err?.code ?? ''))) {
              return json(res, 409, { ok: false, error: 'no-live-agent', code: err?.code })
            }
            return json(res, 502, { ok: false, error: 'prompt-failed', code: err?.code, detail: err?.message })
          }
          if (response.result.value?.accepted !== true) {
            return json(res, 502, { ok: false, error: 'prompt-failed', detail: 'host did not accept' })
          }
          return json(res, 200, { ok: true, accepted: true, rpcId: response.rpcId })
        })
        return
      }

      // unknown section or wrong method on it — one honest answer
      return json(res, 404, { ok: false, error: 'no-such-route' })
    },
  })
}
