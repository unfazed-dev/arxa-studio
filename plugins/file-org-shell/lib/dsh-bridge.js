/**
 * dsh bridge (Phase D, D71 core) — the seam between the git session registry
 * (durable worktree/branch record) and dsh (conversation record).
 *
 * The bridge is a set of FOUR FACES injected through createOrgLifecycle({
 * dsh: faces }): spawn({cwd,name}), attach(id), list(), archive(ids) — plus
 * the optional fifth hasUserMessage(id) → boolean (Q3 empty-drop probe). The
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
  async function spawn({ cwd, name, id } = {}) {
    if (typeof f.spawn !== 'function') return { ok: false, reason: 'dsh-unavailable' }
    try {
      const out = await f.spawn({ cwd, name, id })
      return out && typeof out.id === 'string' && out.id !== ''
        ? { ok: true, id: out.id }
        : { ok: false, reason: 'dsh-unavailable' }
    } catch (err) {
      const detail = String(err?.message ?? err)
      console.error('[file-org-shell] dsh spawn degraded:', detail)
      return { ok: false, reason: 'dsh-unavailable', error: detail }
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

  /**
   * Q1 follow-up (2026-09-03): pin an existing dsh session's header title to
   * the registry name (resume + rename). Spawn pins at birth; sessions born
   * earlier kept dsh's auto title on reopen. Best-effort — {ok:false} when
   * dsh is unavailable or the session is not live in-process.
   */
  async function retitle(id, name) {
    if (typeof f.retitle !== 'function') return { ok: false, reason: 'dsh-unavailable' }
    if (typeof id !== 'string' || id === '' || typeof name !== 'string' || name.trim() === '') {
      return { ok: false, reason: 'dsh-unavailable' }
    }
    try {
      const out = await f.retitle(id, name)
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

  /**
   * Q3 empty-session probe (2026-09-02): has a user message ever landed in
   * this dsh session? → {ok:true,value:boolean} | {ok:false,reason}.
   * Unknown/unavailable is NOT "empty" — callers may only act (drop) on
   * `ok && value === false`; doubt keeps the row.
   */
  async function hasUserMessage(id) {
    if (typeof f.hasUserMessage !== 'function') return { ok: false, reason: 'dsh-unavailable' }
    try {
      const out = await f.hasUserMessage(id)
      if (typeof out === 'boolean') return { ok: true, value: out }
      // Nested bridge: the arxa-sidebar host hands createOrgLifecycle its
      // own bridge (getBridge()), not raw faces, so the inner answer arrives
      // in bridge shape. Pass a definite verdict through; anything else is
      // doubt (seen 2026-09-02: without this the drop never fired live).
      if (out && typeof out === 'object' && out.ok === true && typeof out.value === 'boolean') return { ok: true, value: out.value }
      return { ok: false, reason: out && typeof out === 'object' && typeof out.reason === 'string' ? out.reason : 'dsh-unavailable' }
    } catch (err) {
      return { ok: false, reason: 'dsh-unavailable', error: String(err?.message ?? err) }
    }
  }

  return { spawn, attach, retitle, list, archive, hasUserMessage }
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
            // only the live pills (running / pendingInteraction). The
            // pills are OMITTED when absent — the stock renderer's
            // pendingInteraction switch is exhaustive over undefined |
            // the literal union, and a served null crashes it
            // (assertNever, seen live 2026-08-30 the moment the first
            // resume-spawn landed a live row).
            displayTitle: s.name ?? live.displayTitle ?? null,
            ...(live.running === void 0 ? {} : { running: live.running }),
            ...(live.pendingInteraction === void 0 || live.pendingInteraction === null ? {} : { pendingInteraction: live.pendingInteraction }),
          }
        : {}),
    }
  })
}
