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
//        → { sessions: [{ id, name, title, state, parkedReason, project,
//            workspace, createdAt, updatedAt, dshSessionId, org }] }
//        (flattened sidebar state — the same snapshot the desktop renders)
//   GET  /__arxa/conversations/<id>/messages?limit=<n 1..1000, default 200>
//        → { sessionId, messages: [{ seq, role: 'user'|'assistant', text, at }] }
//        ascending by seq; human prompts only (synthetic context/injects and
//        tool-result user messages are not conversation surface)
//   POST /__arxa/conversations/<id>/messages   body { text, mode? }
//        → { ok: true, accepted: true, rpcId }
//        errors: 400 malformed-json | empty-text · 404 no-such-session ·
//        409 no-live-agent · 502 prompt-failed | sidebar-unavailable | history-failed
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

export const name = 'arxa-conversation'
export const inject = ['webServer', 'apiProxy']

/** Fold history entries ({ event, view } pairs) into phone transcript rows.
 * Human turns only: user/message whose source is genuinely the user, and
 * every finalized assistant/message. Streaming chunks, tool calls/results,
 * boundary markers and log-only events are not conversation surface. */
export function foldHistory(entries) {
  const out = []
  for (const entry of entries ?? []) {
    const e = entry?.event
    if (!e || typeof e !== 'object' || typeof e.seq !== 'number') continue
    if (e.type === 'user/message') {
      const m = e.data
      if (!m || m.role !== 'user') continue
      if (m.source?.kind !== 'user') continue
      const text = textOf(m.content)
      if (text === '') continue
      out.push({ seq: e.seq, role: 'user', text, at: e.time })
    } else if (e.type === 'assistant/message') {
      const m = e.data?.message
      if (!m || m.role !== 'assistant') continue
      const text = textOf(m.content)
      if (text === '') continue
      out.push({ seq: e.seq, role: 'assistant', text, at: e.time })
    }
  }
  return out.sort((a, b) => a.seq - b.seq)
}

function textOf(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim()
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
  const httpImpl = deps.httpImpl ?? ((url, opts) => fetch(url, opts))
  // The dsh child receives its port via --port argv, not env — ARXA_PORT is
  // rarely set; the launcher's default (7891) is the honest fallback.
  const sidebarUrl = deps.sidebarUrl
    ?? 'http://127.0.0.1:' + ((deps.env ?? process.env).ARXA_PORT ?? '7891')
    + '/__arxa/sidebar/state'

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
        return json(res, 200, { sessions: flattenSidebar(await r.json()) })
      } catch (e) {
        return json(res, 502, { ok: false, error: 'sidebar-unavailable', detail: String(e?.message ?? e) })
      }
    },
  })

  // ---- per-session transcript + send
  ctx.webServer.register({
    name: 'arxa-conversation-session',
    // NO trailing slash: the webserver's prefix match appends its own
    // '/' — a trailing-slash registration can never match (empty 404).
    path: '/__arxa/conversations',
    kind: 'prefix',
    handler: async (req, res) => {
      const url = new URL(req.url, 'http://engine.local')
      const parts = url.pathname.split('/') // ['', '__arxa', 'conversations', '<id>', 'messages']
      if (parts[4] !== 'messages' || parts.length !== 5 || parts[3] === '') {
        return json(res, 404, { ok: false, error: 'no-such-route' })
      }
      const sessionId = decodeURIComponent(parts[3])

      if (req.method === 'GET') {
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
        return json(res, 200, { sessionId, messages: foldHistory(response.result.value?.events) })
      }

      if (req.method === 'POST') {
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
          if (text === '') return json(res, 400, { ok: false, error: 'empty-text' })
          const mode = body?.mode === 'steer' ? 'steer' : 'queue'
          let response
          try {
            response = await api.sessions.prompt({
              rpcId: randomUUID(),
              payload: { sessionId, mode, content: [{ type: 'text', text }] },
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

      return json(res, 405, { ok: false, error: 'method-not-allowed' })
    },
  })
}
