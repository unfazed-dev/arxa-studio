/**
 * dsh bridge (Phase D, D71 core) — the seam between the git session registry
 * (durable worktree/branch record) and dsh (conversation record).
 *
 * The bridge is a set of FOUR FACES injected through createOrgLifecycle({
 * dsh: faces }): spawn({cwd,name}), attach(id), list(), archive(ids). The
 * deployment (arxa-sidebar host half) builds the real faces from dsh's
 * in-process cordis services — ctx.sessions (SessionStore, ctx key
 * "sessions": create(undefined, { meta: { cwd } }) is the sessions.create
 * cwd contract), ctx.workspaceRegistry (archiveSession/archivedSessionIds —
 * the D39 contract) and ctx.sessionTitle. Tests inject mocks.
 *
 * DEFAULT (no faces, or faces missing): a loud no-op. Every face reports
 * dsh-unavailable and the lifecycle degrades to registry-only — never a
 * hard failure, so tests stay offline-green and sandbox deployments work.
 * Every method is throw-proof: callers never need try/catch around dsh.
 */

/**
 * Create the throw-proof bridge over injected faces (or the unavailable stub).
 *
 * @param {{ spawn?: Function, attach?: Function, list?: Function, archive?: Function }} faces
 */
export function createDshBridge(faces = {}) {
  const f = faces && typeof faces === 'object' ? faces : {}

  /** Spawn a dsh session with cwd = the session worktree. → {ok,id}|{ok:false,reason} */
  async function spawn({ cwd, name } = {}) {
    if (typeof f.spawn !== 'function') return { ok: false, reason: 'dsh-unavailable' }
    try {
      const out = await f.spawn({ cwd, name })
      return out && typeof out.id === 'string' && out.id !== ''
        ? { ok: true, id: out.id }
        : { ok: false, reason: 'dsh-unavailable' }
    } catch (err) {
      return { ok: false, reason: 'dsh-unavailable', error: String(err?.message ?? err) }
    }
  }

  /** Re-attach (focus/open) an existing dsh session by id. Best-effort. */
  async function attach(id) {
    if (typeof f.attach !== 'function') return { ok: false, reason: 'dsh-unavailable' }
    try {
      const out = await f.attach(id)
      return out && typeof out === 'object' ? out : { ok: true }
    } catch (err) {
      return { ok: false, reason: 'dsh-unavailable', error: String(err?.message ?? err) }
    }
  }

  /** dsh's live session rows: [{ id, displayTitle?, running?, pendingInteraction? }]. */
  async function list() {
    if (typeof f.list !== 'function') return []
    try {
      const rows = await f.list()
      return Array.isArray(rows) ? rows : []
    } catch {
      return [] // join failure degrades silently to registry rows
    }
  }

  /** Feed dsh's archivedSessionIds set (D39): archived ids leave dsh active views. */
  async function archive(ids) {
    if (typeof f.archive !== 'function' || !Array.isArray(ids) || ids.length === 0) {
      return { ok: false, reason: 'dsh-unavailable' }
    }
    try {
      await f.archive(ids)
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: 'dsh-unavailable', error: String(err?.message ?? err) }
    }
  }

  return { spawn, attach, list, archive }
}

/**
 * Pure join (Phase D live rows): registry session rows + dsh's live list →
 * rows carrying dshSessionId plus the live fields (displayTitle, running,
 * pendingInteraction) WHEN the row's dshSessionId resolves in the list.
 * Any failure or gap degrades to the registry row (name/state as today) —
 * never throws, never drops a row.
 *
 * @param {Array<{ dshSessionId?: string|null }>} rows registry rows
 * @param {Array<{ id: string }>|null|undefined} liveRows dsh live list
 */
export function joinDshLive(rows, liveRows) {
  const byId = new Map()
  if (Array.isArray(liveRows)) {
    for (const r of liveRows) {
      if (r && typeof r.id === 'string' && r.id !== '') byId.set(r.id, r)
    }
  }
  return (Array.isArray(rows) ? rows : []).map((s) => {
    const live = s?.dshSessionId ? byId.get(s.dshSessionId) : undefined
    return {
      ...s,
      dshSessionId: s?.dshSessionId ?? null,
      ...(live
        ? {
            // Registry name wins (grilled 2026-08-30 rename rule): one
            // rename must read the same everywhere in arxa; dsh keeps
            // only the live pills (running / pendingInteraction).
            displayTitle: s.name ?? live.displayTitle ?? null,
            running: live.running ?? null,
            pendingInteraction: live.pendingInteraction ?? null,
          }
        : {}),
    }
  })
}
