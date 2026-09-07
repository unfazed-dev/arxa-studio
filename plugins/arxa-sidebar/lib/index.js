/**
 * arxa-sidebar (host half) — ROWS WORLD (sidebar rethink, docs/plans/sidebar-org-rethink.md).
 *
 * The stock Workspaces section (dsh-client-ui-workspace, transformed by
 * scripts/gen-workspace.mjs) renders orgs as rows; this host half is its
 * only data face. Two routes on the same webServer pattern as before:
 *
 *   GET  /__arxa/sidebar/state?project=<id|slug>
 *        → { seam, root, orgs: [{ id, name, slug, path, open, sessions }],
 *            trashCount, archives, sessionTrash, selectedProject }
 *        Every org carries its registry session rows (read-only listSessions
 *        — no shell lock needed to LIST); the open org additionally serves
 *        projects and the selected scope. `archives` (2026-09-05 grill) is
 *        the D39-sanctioned browse face: every org's ARCHIVED rows, listed
 *        for the Archives section — active faces still never include them.
 *        `sessionTrash` lists session-kind trash entries across all orgs
 *        (the destructive door must be visible the moment it exists, D82).
 *
 *   POST /__arxa/sidebar/action  body { action, arg }
 *        org.create | org.open | org.close | org.rename | org.new-session |
 *        session.open | session.archive | trash.restore | workspace.root
 *        (ci.run stays reserved for Phase D3 — deliberately absent.)
 *
 * Import resolution is probed in two shapes so every deployment works
 * without a declared dependency (this package stays zero-dep by convention):
 *   1. bare `arxa-file-org-shell`  — packed mode (flat node_modules copies)
 *   2. relative ../../file-org-shell — repo checkout + pnpm file: symlink
 *
 * Nothing here touches the Arxa Digital Solutions database — all data comes
 * from the local lifecycle API (filesystem + git). No localStorage on the
 * client; layout state stays transient per the dsh layout contract.
 */

/** Flipped by the integrator: plugins/file-org-shell is merged on this branch. */
export const SEAM_LIFECYCLE_STUBBED = false

export const name = 'arxa-sidebar'
// sessions / workspaceRegistry / sessionTitle — dsh's in-process cordis
// services (dsh-session / dsh-workspace / dsh-session-title): the Phase D
// bridge faces (sessions.create cwd contract, archivedSessionIds, titles).
export const inject = ['webServer', 'sessions', 'workspaceRegistry', 'sessionTitle', 'agents']

/** Host object arxa-git-card reads (filled in apply(); `ready` flips then).
  * Also published process-wide under Symbol.for('arxa.sidebar.host') so the
  * card host finds it even when pnpm's virtual store gives the two plugins
  * distinct module instances of this file. */
export const sidebarHost = { ready: false }
export const SIDEBAR_HOST_KEY = Symbol.for('arxa.sidebar.host')

/** Import-probe the Phase A plugin in both deployment shapes. A failure is
  * LOGGED: a silent null here made both routes serve the stub while the UI
  * still rendered no-org — measured and cursed in bin/arxa-studio.mjs. */
async function importShell() {
  try {
    return await import('arxa-file-org-shell')
  } catch (bare) {
    try {
      return await import(new URL('../../file-org-shell/lib/index.js', import.meta.url).href)
    } catch (rel) {
      console.error('[arxa-sidebar] importShell failed from', import.meta.url, '— bare:', bare?.message, '| relative:', rel?.message)
      return null
    }
  }
}

/** Import-probe the Phase B github-link plugin in three deployment shapes
  * (same rationale as importShell; D69 gate half — the account link):
  *   1. bare "arxa-github-link" — once bin/arxa-studio.mjs carries the
  *      imports-map entry (ONE line, blocked by a parallel session's WIP
  *      as of 2026-08-29);
  *   2. ARXA_GITHUB_LINK_PATH — absolute path to lib/index.js, for profile
  *      boots (evidence server / desktop) that lack the map entry;
  *   3. relative ../../github-link — repo checkout + pnpm file: symlink. */
async function importGithubLink() {
  try {
    return await import('arxa-github-link')
  } catch { /* not in the imports map (yet) — fall through */ }
  const viaEnv = process.env.ARXA_GITHUB_LINK_PATH
  if (viaEnv) {
    try {
      return await import(new URL('file://' + viaEnv).href)
    } catch (envErr) {
      console.error('[arxa-sidebar] ARXA_GITHUB_LINK_PATH failed:', envErr?.message)
    }
  }
  return await import(new URL('../../github-link/lib/index.js', import.meta.url).href)
}

/** Import-probe git-workspace (Phase 4 card actions) in both deployment
  * shapes — same discipline as importShell / artifact-viewer's gw():
  *   1. bare "git-workspace" — the flat copy bin/arxa-studio.mjs places in
  *      the profile's top-level node_modules (fiveLibs);
  *   2. relative ../../git-workspace — repo checkout (smoke.mjs, selftests).
  * The relative shape alone is NOT enough in an installed profile: this
  * plugin is a pnpm file: symlink into the .pnpm virtual store, so
  * ../../git-workspace resolves beside the store entry, where no sibling
  * exists (measured live 2026-09-02: workspace.new-session → Cannot find
  * module …/.pnpm/arxa-sidebar@…/node_modules/git-workspace/lib/index.js).
  * Cached: the card actions call this per request. */
let gwCache = null
async function importGitWorkspace() {
  if (gwCache) return gwCache
  try {
    gwCache = await import('git-workspace')
  } catch {
    gwCache = await import(new URL('../../git-workspace/lib/index.js', import.meta.url).href)
  }
  return gwCache
}

export function apply(ctx, opts = {}) {
  console.log('[arxa-boot] sidebar apply')
  /** Singleton — holds the single open-org handle across requests. */
  let lifecycle = null
  let shell = null
  /** Singleton dsh bridge (Phase D, D71) — built once the shell module loads. */
  let dshBridge = null
  /** GitHub link service (Phase B/W3, D69 gate half). opts.github overrides
    * for tests (the engine's ctx is inject-guarded — arbitrary properties
    * throw); otherwise the real local-first service (keyring + browser PKCE)
    * is built once. Import failure degrades to null — the gate then reads as
    * unlinked and says so, never silently open. */
  let ghSvc = null
  let ghResolved = false
  const getGithub = async () => {
    if (opts.github) return opts.github
    if (ghResolved) return ghSvc
    ghResolved = true
    try {
      ghSvc = importGithubLink().then((m) => m.createGithubLink({}))
    } catch {
      ghSvc = Promise.reject(new Error('github-link unavailable'))
    }
    return ghSvc
  }

  /** D111/D116: live checks for `main`'s head, shared by card.status's
    * teaser face and the new-session gate — 30 s per-repo cache so neither
    * a status poll nor every session birth pays a fresh API round trip.
    * Returns null (never a false green) when the repo is unlinked,
    * local-only, has no manifest, has no `main`, or the API call fails. */
  const mainChecksCache = new Map() // repoPath -> { at, checks }
  const MAIN_CHECKS_TTL_MS = 30_000
  const mainChecksFor = async (repoPath, manifest, g, gw) => {
    if (!manifest?.repoOwner || !manifest?.repoName || manifest?.localOnly) return null
    if (!g) return null
    const cached = mainChecksCache.get(repoPath)
    if (cached && Date.now() - cached.at < MAIN_CHECKS_TTL_MS) return cached.checks
    const mainSha = gw.runGit(['rev-parse', 'main'], { cwd: repoPath, allowFail: true })
    if (!mainSha) return null
    const checks = await g.prChecks(manifest.repoOwner, manifest.repoName, mainSha).catch(() => null)
    mainChecksCache.set(repoPath, { at: Date.now(), checks })
    return checks
  }

  /**
   * Real dsh faces over the engine's in-process services. sessions.create
   * carries the worktree cwd (dsh's sessions.create cwd contract); the
   * workspace registry owns the archivedSessionIds set (D39). Absent or
   * misshapen services degrade to the unavailable stub (registry-only).
   */
  const makeDshFaces = () => {
    try {
      const sessions = ctx.sessions
      if (!sessions || typeof sessions.create !== 'function') return {}
      // Q1 (2026-09-03): pin a dsh session's header title to the arxa registry
      // name. Untouched, dsh generates a title from the first few words of the
      // opening message, so the header disagreed with both the sidebar row and
      // the breadcrumb tail. rename() appends source:{kind:'user'}, which
      // supersedes in-flight automatic generation AND stops later messages
      // scheduling any — a pin, not just a first value. It needs the EXACT
      // live Session (it identity-checks against the store), so callers pass
      // sessions.get(id); a session not loaded in-process is a no-op (the
      // next resume re-pins it). Shared by spawn (birth) and retitle
      // (resume/rename — sessions born before the pin existed kept dsh's
      // auto title on reopen, seen live 2026-09-03 on note-002).
      const pinTitleTo = (live, name) => {
        try {
          const svc = ctx.sessionTitle
          if (process.env.ARXA_DEBUG_TITLE) console.error('[pinTitle] live=' + !!live + ' svc=' + !!svc + ' rename=' + (typeof svc?.rename) + ' name=' + JSON.stringify(name))
          if (!live || !svc || typeof svc.rename !== 'function') return false
          if (typeof name !== 'string' || name.trim() === '') return false
          svc.rename(live, name)
          if (process.env.ARXA_DEBUG_TITLE) console.error('[pinTitle] renamed ok')
          return true
        } catch (err) {
          if (process.env.ARXA_DEBUG_TITLE) console.error('[pinTitle] threw: ' + String(err?.message ?? err))
          return false /* title is presentation — never fails the caller */
        }
      }
      // Deferred pins (measured 2026-09-03 on the s2 engine): at boot the
      // sidebar's session.open → resumeSession → retitle runs BEFORE the
      // client loads the conversation, so sessions.get(id) is undefined and
      // an immediate pin has nothing to rename. Park the name; the store
      // announces "session/created" when the session enters (create AND
      // restore both go through prepare → enter → announce), and the pin
      // lands then — one tick later, outside the store's announce phase so
      // the title append never races the announcing entry.
      const pendingTitles = new Map()
      if (typeof ctx.on === 'function') {
        try {
          ctx.on('session/created', (session) => {
            // dsh 0.1.2-rc.1 keys the record by header.id; 0.1.1 had a top-level id.
            const rawId = session && (session.id ?? session.header?.id)
            const id = typeof rawId === 'string' ? rawId : undefined
            if (id === undefined || !pendingTitles.has(id)) return
            const name = pendingTitles.get(id)
            pendingTitles.delete(id)
            if (process.env.ARXA_DEBUG_TITLE) console.error('[pinTitle] session/created fired for parked ' + id)
            setTimeout(() => {
              const live = typeof sessions.get === 'function' ? sessions.get(id) : undefined
              pinTitleTo(live ?? session, name)
            }, 0)
          })
        } catch { /* listener is best-effort — retitle still pins live sessions */ }
      }
      const faces = {
        // D93 root-cause fix (2026-08-31): a dsh session whose cwd matches no
        // workspace is born into the engine's GLOBAL archivedSessionIds — and
        // WorkspaceRuntime.project() clears every selection of an archived
        // session, so arxa rows could never hold an open conversation. Spawn
        // now resolves-or-creates a workspace AT the session worktree (dsh's
        // attachSession validates cwd === workspace.path) so every arxa
        // session is a workspace resident from birth. Best-effort: residency
        // failure degrades to the old behaviour, never blocks the spawn.
        spawn: async ({ cwd, name, id: arxaId }) => {
          // Root-cause fixes (2026-08-31):
          // 1. UNIQUE ID — an omitted id makes the store mint a scope-local
          //    "session-<n>"; those collide across scopes in the merged list,
          //    so open(dshSessionId) could bind to a foreign stub. Derive a
          //    unique, traceable id from the arxa session id instead.
          // 2. LIVE AGENT — a bare sessions.create() yields a session with NO
          //    agent, and the api layer (models/selectModel/prompt) resolves
          //    sessions through agentFor() → fencedLiveAgent/agents.resume,
          //    which refuses a live-but-agentless session ("cannot prepare
          //    session while it is live"). Going through ctx.agents.create()
          //    uses the engine's real factory so the session is born WITH its
          //    agent loop — prompting works from the first message.
          // dsh stores a conversation as a DIRECTORY named by its id, so the
          // path identity's `/` cannot survive the trip (Q3, 2026-09-03):
          // `RESTO/notes/note-wt-260903-001` → `arxa-RESTO-notes-note-wt-260903-001`.
          // Canonical helper: git-workspace `dshSessionKey` — inlined here
          // because this package stays zero-dep by convention.
          const wanted = typeof arxaId === 'string' && arxaId.trim() !== ''
            ? 'arxa-' + arxaId.split('/').filter(Boolean).join('-')
            : undefined
          const agents = ctx.agents
          // Q1 (2026-09-03): pin the header title to the worktree name at
          // birth (see pinTitleTo). `name` is the registry name, which Q3
          // defaults to the id and a rename diverges.
          const pinTitle = (live) => { pinTitleTo(live, name) }
          if (agents && typeof agents.create === 'function') {
            try {
              let setup
              let presetId
              try {
                const presets = typeof ctx.get === 'function' ? ctx.get('agentPresets') : undefined
                if (presets && typeof presets.resolve === 'function' && typeof presets.mount === 'function') {
                  // 3. RECORDED PRESET (2026-09-03) — resolve BEFORE create.
                  //    Mounting inside setup composes the agent correctly but
                  //    leaves NOTHING on the session, so the stock
                  //    AgentPresetLabel (header.actions, reads
                  //    state.byId[id].agentPreset) rendered null on every
                  //    arxa-spawned session while dsh-spawned ones showed
                  //    their mode. The id has to ride on `meta`: agents.create
                  //    forwards meta to sessions.prepare (dsh-agent-loop
                  //    createAgent), which writes header.agentPreset
                  //    (dsh-session prepare), which the wire SessionSummary
                  //    passes through. Resolve failure degrades exactly as
                  //    before — no preset recorded, host default composition.
                  const resolved = await presets.resolve(undefined)
                  if (resolved && typeof resolved.id === 'string' && resolved.id !== '') presetId = resolved.id
                  setup = async (agentCtx) => { await presets.mount(agentCtx, resolved.id) }
                }
              } catch { /* no preset roster — the host default composition stands */ }
              const handle = await agents.create({
                ...(wanted === undefined ? {} : { sessionId: wanted }),
                meta: { cwd, ...(presetId === undefined ? {} : { agentPreset: presetId }) },
                ...(setup === undefined ? {} : { setup })
              })
              const id = (handle && handle.session && handle.session.id) || (handle && handle.id) || wanted
              // The AgentHandle does NOT carry `.session` (measured: live=false
              // — that is also why the id resolver above falls through to
              // handle.id). rename() identity-checks against the store, so the
              // store is the only place to get an object it will accept.
              pinTitle(typeof sessions.get === 'function' ? sessions.get(id) : undefined)
              try {
                const registry = ctx.workspaceRegistry
                if (registry && typeof registry.resolveByPath === 'function') {
                  const { realpath } = await import('node:fs/promises')
                  const canonical = await realpath(cwd)
                  let ws = await registry.resolveByPath(canonical)
                  if (!ws && typeof registry.createCanonical === 'function') ws = await registry.createCanonical(canonical, name)
                  if (ws && typeof ws.attachSession === 'function') await ws.attachSession(id)
                }
              } catch { /* residency is best-effort — never blocks the spawn */ }
              return { id }
            } catch { /* factory unavailable/refused — degrade to a bare session */ }
          }
          let id
          try {
            id = sessions.create(wanted, { meta: { cwd } }).id
          } catch (e) {
            // Idempotent re-spawn (crash between create and annotate): reuse
            // the session we already made for this arxa id.
            if (!(wanted && typeof sessions.get === 'function' && sessions.get(wanted))) throw e
            id = wanted
          }
          pinTitle(typeof sessions.get === 'function' ? sessions.get(id) : undefined)
          try {
            const registry = ctx.workspaceRegistry
            if (registry && typeof registry.resolveByPath === 'function') {
              const { realpath } = await import('node:fs/promises')
              const canonical = await realpath(cwd)
              let ws = await registry.resolveByPath(canonical)
              if (!ws && typeof registry.createCanonical === 'function') ws = await registry.createCanonical(canonical, name)
              if (ws && typeof ws.attachSession === 'function') await ws.attachSession(id)
            }
          } catch { /* residency is best-effort — never blocks the spawn */ }
          return { id }
        },
        list: async () => {
          const title = ctx.sessionTitle
          const rows = sessions.list().map(async (s) => {
            let displayTitle
            try {
              const t = await Promise.resolve(typeof title?.get === 'function' ? title.get(s) : undefined)
              displayTitle = typeof t === 'string' ? t : (t && typeof t.title === 'string' ? t.title : undefined)
            } catch { /* title is presentation — degrade */ }
            // running/pendingInteraction stay client-runtime-produced (D63
            // resolution): the SessionManager mux classifies them; the
            // server-side join leaves them undefined so the client's own
            // pill data wins.
            return { id: s.id, displayTitle }
          })
          return Promise.all(rows)
        },
      }
      if (typeof sessions.get === 'function') {
        faces.attach = async (id) => ({ ok: !!sessions.get(id) })
        // Q1 follow-up (2026-09-03): re-pin on resume/rename. Sessions born
        // before the spawn pin existed (or renamed since) otherwise keep dsh's
        // auto-generated title in the header. A session not live in-process
        // is parked in pendingTitles and pinned on "session/created" when
        // the client loads it — {ok:true, deferred:true}; never an error.
        faces.retitle = async (id, name) => {
          if (typeof name !== 'string' || name.trim() === '') return { ok: false, reason: 'name-required' }
          const live = sessions.get(id)
          if (live) return { ok: pinTitleTo(live, name) }
          pendingTitles.set(id, name)
          if (process.env.ARXA_DEBUG_TITLE) console.error('[pinTitle] parked ' + id + ' → "' + name + '" (not live yet)')
          return { ok: true, deferred: true }
        }
      }
      // Q3 empty-session probe (2026-09-02): has a user message ever landed
      // in this dsh session? Live store first (Session.events); a session
      // not loaded in-process is read from its on-disk log under
      // $DSH_HOME/sessions/<cwd-slug>/<id>/session.jsonl.zstd — one zstd
      // frame per append, so split on the frame magic and inflate each.
      // Throws when neither source can answer: the bridge turns that into
      // {ok:false} and the lifecycle keeps the row (never drop on doubt).
      faces.hasUserMessage = async (id) => {
        const live = typeof sessions.get === 'function' ? sessions.get(id) : undefined
        const events = live && Array.isArray(live.events) ? live.events : null
        if (events) return events.some((e) => e && e.type === 'user/message')
        return readLogHasUserMessage(id)
      }
      const registry = ctx.workspaceRegistry
      if (registry && typeof registry.archiveSession === 'function') {
        faces.archive = async (ids) => {
          for (const id of ids) await registry.archiveSession(id)
        }
      }
      return faces
    } catch {
      return {}
    }
  }

  async function readLogHasUserMessage(id) {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const os = await import('node:os')
    const zlib = await import('node:zlib')
    const envHome = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
    const root = path.join(envHome !== '' ? envHome : path.join(os.homedir(), '.dsh'), 'sessions')
    let scopes
    try { scopes = await fs.readdir(root) } catch { throw new Error('dsh-log-unavailable: ' + root) }
    if (typeof zlib.zstdDecompressSync !== 'function') throw new Error('zstd-unavailable')
    const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
    for (const scope of scopes) {
      let buf
      try { buf = await fs.readFile(path.join(root, scope, id, 'session.jsonl.zstd')) } catch { continue }
      const starts = []
      let i = 0
      while ((i = buf.indexOf(MAGIC, i)) !== -1) { starts.push(i); i += 4 }
      for (let k = 0; k < starts.length; k++) {
        let text
        try { text = zlib.zstdDecompressSync(buf.subarray(starts[k], starts[k + 1] ?? buf.length)).toString('utf8') } catch { continue }
        if (text.includes('"type":"user/message"')) return true
      }
      return false
    }
    throw new Error('dsh-log-missing: ' + id)
  }

  const getBridge = () => {
    if (dshBridge) return dshBridge
    if (typeof shell?.createDshBridge !== 'function') return null
    dshBridge = shell.createDshBridge(makeDshFaces())
    return dshBridge
  }

  /**
   * Lazily create the lifecycle. Retried per-request while null because the
   * workspace root may be chosen (saveWorkspaceRoot) after boot.
   */
  const getLifecycle = async () => {
    if (lifecycle) return lifecycle
    shell ??= await importShell().catch(() => null)
    if (typeof shell?.createOrgLifecycle !== 'function') return null
    const root = (() => {
      try { return shell.loadWorkspaceRoot?.() } catch { return null }
    })()
    if (!root) return null // no workspace chosen yet → no-org state
    // D73 root-cause fix: the github faces MUST reach the lifecycle or its
    // throw-proof stub answers github-unavailable for every publish (the
    // exact silent drop that kept TOPO/RESTO off GitHub while linked).
    // Import failure degrades to undefined → the loud stub — never a crash.
    const github = await getGithub().catch(() => undefined)
    lifecycle = shell.createOrgLifecycle({ workspaceRoot: root, dsh: getBridge() ?? undefined, github: github ?? undefined })
    return lifecycle
  }

  const json = (res, body) => {
    res.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(body))
  }

  /** The three per-request org helpers over a lifecycle — shared by the
    * action route below and by arxa-git-card's route (sidebarHost). */
  const orgHelpers = (l) => {
    /** Client rows send org ids; openOrg wants a path. */
    const orgByRef = (ref) => {
      const hit = l.listOrgs().find((o) => o.id === ref || o.slug === ref || o.path === ref)
      if (!hit) throw new Error('org-not-found: ' + ref)
      return hit
    }
    /** The single open-org handle or loud failure — no silent ok. */
    const handle = () => {
      if (!l.current) throw new Error('no-org-open')
      return l.current
    }
    /** Open exactly this org (switch tears the old one down first). */
    const ensureOpen = async (ref) => {
      const org = orgByRef(ref)
      if (l.current?.path === org.path) return l.current
      if (l.current) await l.switchOrg(org.path)
      else await l.openOrg(org.path)
      return l.current
    }
    return { orgByRef, handle, ensureOpen }
  }

  /** Publish the org shell to arxa-git-card (docs/plans/
    * git-card-stock-dock-rebuild.md A2): its card.* / insight.* /
    * version.mint actions moved out of this table on 2026-09-02 but still
    * run against the SAME open-org singleton. Set on every apply() so a
    * test harness that applies twice sees the latest ctx/opts (fake github). */
  Object.assign(sidebarHost, {
    ready: true,
    seam: SEAM_LIFECYCLE_STUBBED,
    orgContext: async () => {
      const l = await getLifecycle()
      return l ? { l, ...orgHelpers(l) } : null
    },
    getGithub,
    mainChecksFor,
    importGitWorkspace,
  })
  globalThis[SIDEBAR_HOST_KEY] = sidebarHost
  const params = (req) => new URL(req.url, 'http://x').searchParams

  /**
   * One org's session rows off the plain registry read — no shell lock, no
   * open cycle: LISTING sessions is read-only fs (+ git common-dir walk).
   * An org that never opened (no repo yet) or an unreadable registry lists
   * as empty; a row is presentation, not a lifecycle. Returns BOTH halves
   * (2026-09-05 grill): active rows for the tree and archived rows for the
   * Archives section — one registry read feeds the two faces.
   */
  const orgSessions = async (l, org) => {
    try {
      // Registry rows (durable worktree/branch record) joined with dsh's
      // live session list by dshSessionId (Phase D, D71). Join failures
      // degrade silently to the registry rows.
      // D98/D99: project sessions live in the PROJECT repo's registry, so the
      // rows face aggregates org + every project registry (org first, then
      // projects in slug order). An older shell without the aggregate lister
      // degrades to org-only rows rather than failing the face.
      const listAll = shell.listSessionsAcrossRepos ?? shell.listSessions
      const all = listAll(org.path, process.env)
      const shape = (s) => ({
        id: s.id,
        name: s.name,
        state: s.state,
        parkedReason: s.parkedReason,
        project: s.project ?? null,
        // Workspace scope + real timestamps (grilled 2026-08-30): rows
        // render under their workspace row; ages read from ms epochs —
        // the 56y bug was fake ordinals rendered as ages from 1970.
        workspace: s.workspace ?? null,
        createdAt: s.createdAt ?? null,
        updatedAt: s.updatedAt ?? null,
        dshSessionId: s.dshSessionId ?? null,
        // The crumb last segment (Q2: … / session / worktree) reads this — it was
        // never served, so the segment silently never rendered (2026-09-02).
        worktree: s.worktree ?? null,
      })
      const rows = all.filter((s) => s.state !== 'archived').map(shape)
      // D39 browse face: archived rows ride the Archives section (the one
      // sanctioned surface); active faces above still never include them.
      const archived = all.filter((s) => s.state === 'archived').map((s) => ({
        sessionId: s.id,
        name: s.name,
        project: s.project ?? null,
        workspace: s.workspace ?? null,
        updatedAt: s.updatedAt ?? s.createdAt ?? null,
      }))
      const bridge = getBridge()
      const live = bridge ? await bridge.list() : []
      return { active: shell.joinDshLive(rows, live), archived }
    } catch {
      return { active: [], archived: [] }
    }
  }

  /**
   * Session-kind trash entries across ALL orgs (2026-09-05 grill): the
   * trash's Sessions group must be visible the moment an entry exists —
   * D82's own principle — so the face aggregates every org's trash, not
   * just the open one. Pure fs read per org; orgs without a trash list [].
   */
  const orgSessionTrash = (l) => {
    const out = []
    for (const org of l.listOrgs()) {
      let entries = []
      try { entries = shell.listTrash(org.path) } catch { continue }
      for (const e of entries) {
        if (!e.origin || e.origin.kind !== shell.SESSION_TRASH_KIND) continue
        out.push({
          entryId: e.entryId,
          name: e.origin.name || e.origin.sessionId,
          orgId: org.id,
          orgName: org.name,
          sessionId: e.origin.sessionId,
          branch: e.origin.branch ?? null,
        })
      }
    }
    return out
  }

  const emptySnap = (seam) => ({
    seam,
    root: false,
    orgs: [],
    rows: [],
    tree: null,
    trashCount: 0,
    archives: [],
    sessionTrash: [],
    selectedProject: null,
  })

  /** D96: last detached sync kick (throttle window guard). */
  let lastSyncKick = 0

  /** Snapshot for the rows client: orgs with their session rows inline. */
  const snapshot = async (selectedProject) => {
    const l = await getLifecycle()
    if (!l) return emptySnap(SEAM_LIFECYCLE_STUBBED)
    const cur = l.current
    // D96 refresh: every state poll may kick ONE detached sync per minute
    // for the OPEN org — the sidebar re-renders off the next poll after
    // the pull lands. Fire-and-forget: a snapshot must never await git.
    try {
      if (cur && typeof l.syncOrgRepos === 'function' && Date.now() - lastSyncKick > 60_000) {
        lastSyncKick = Date.now()
        void l.syncOrgRepos(cur.path).catch(() => {})
      }
    } catch { /* advisory */ }
    /** Tree face for ONE org (v2, grilled 2026-08-30): docks with their
     * fixed containers + projects with their fixed containers +
     * per-workspace session counts. The client flattens this into
     * container rows (org / dock / project) and leaf workspace rows —
     * the leaves are the stock dsh workspace groups. */
    const treeOf = (p) => {
      if (typeof l.orgTree !== 'function') return null
      try { return l.orgTree(p) } catch { return null }
    }
    // Archives face (2026-09-05 grill): every org's archived rows, tagged
    // with their org — the client groups by it. One registry read per org
    // (shared with the sessions face below) — no extra git work.
    const archivesByOrg = new Map()
    const orgs = await Promise.all(l.listOrgs().map(async ({ id, name, slug, path, manifest }) => {
      const sess = await orgSessions(l, { path })
      archivesByOrg.set(path, (sess.archived || []).map((a) => ({ ...a, orgId: id, orgName: name })))
      return {
        id,
        name,
        slug,
        path,
        open: cur?.path === path,
        // Initial-snapshot state (2025-08 create-org hang), open org only:
        // the rows client disables the New Session CTA while true.
        snapshotPending: cur?.path === path ? !!cur.snapshotPending?.() : false,
        createdAt: manifest?.createdAt ?? null,
        // D90: connected = the org repo is published (repoUrl in the manifest).
        connected: !!manifest?.repoUrl,
        sessions: sess.active,
        // v2 tree face: docks/containers/projects for this org. Read-only;
        // failures degrade to null (the client renders the org row only).
        tree: treeOf(path),
      }
    }))
    const archives = [...archivesByOrg.values()].flat()
    // Project scope (open org only): the client's id-or-slug selection
    // resolves once against the registry's slug; unknown renders as none.
    const selSlug = (() => {
      if (!cur || selectedProject == null) return null
      const hit = cur.projects().find((p) => p.slug === selectedProject || p.id === selectedProject)
      return hit ? hit.slug : null
    })()
    const tree = cur ? treeOf(cur.path) : null
    return {
      seam: false,
      root: true,
      orgs,
      // v2: the flat rows face is gone — every org carries its own tree
      // (orgs[].tree) and the client nests from there.
      tree,
      trashCount: cur ? cur.trashCount() : 0,
      // Open-org view only: the trash lives at the workspace root, but the
      // surface (Q6) hangs off the open org's row menu.
      // D69: trash is org-local (<org>/.arxa/trash) — the surface (Q6)
      // hangs off the open org's row menu and lists THAT org's trash.
      // 2026-09-05: session entries are a DIFFERENT kind (logical markers,
      // not folder moves) — they ride sessionTrash below, never this face.
      trash: cur ? shell.listTrash(cur.path).filter((e) => e.origin?.kind !== shell.SESSION_TRASH_KIND).map((e) => ({
        entryId: e.entryId,
        name: (e.origin?.originalPath ?? e.entryId).replace(/[/\\]+$/, '').split('/').pop() || e.entryId,
      })) : [],
      // D81: orgs trashed whole (workspace-root trash) — restore or purge
      // (GitHub repos deleted) from the Trash row.
      orgTrash: (l.listOrgTrash ? l.listOrgTrash() : []).map((e) => ({
        entryId: e.entryId,
        name: e.name || e.entryId,
      })),
      // 2026-09-05 grill: the Archives section's data (every org's archived
      // sessions, org-tagged) and the trash's Sessions group (every org's
      // session-kind entries — the destructive door visible the moment it
      // exists, D82). Both ride the change signature client-side.
      archives,
      sessionTrash: orgSessionTrash(l),
      selectedProject: selSlug,
    }
  }

  // Readiness for the desktop splash (2026-09-07, docs/plans/
  // studio-startup-ready-when-open.md). The shell used to lift "Getting things
  // ready…" the moment the port answered, which is BEFORE plugins apply — the
  // user then watched the app load. 200 once the org shell (the heaviest
  // import on the boot path) is loaded, or there is no workspace to load;
  // 503 while it is still importing. The org itself opens on the client's
  // first action, so it is deliberately NOT part of this gate — waiting for
  // it here would wait forever. CORS `*` on this one boolean so the shell's
  // own page (a different origin) can read the status.
  let readyLogged = null
  let stateLogged = false
  ctx.webServer.register({
    name: 'arxa-ready',
    path: '/__arxa/ready',
    kind: 'exact',
    handler: async (req, res) => {
      let ready = false
      try {
        const l = await getLifecycle()
        if (readyLogged !== (l !== null)) { readyLogged = l !== null; console.log('[arxa-boot] ready=' + (l !== null)) }
        let root = null
        try { root = shell?.loadWorkspaceRoot?.() ?? null } catch { root = null }
        ready = l !== null || !root
      } catch { ready = false }
      res.writeHead(ready ? 200 : 503, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      })
      res.end(JSON.stringify({ ready }))
    },
  })

  ctx.webServer.register({
    name: 'arxa-sidebar-state',
    path: '/__arxa/sidebar/state',
    kind: 'exact',
    handler: async (req, res) => {
      try {
        const st0 = Date.now()
        const snap = await snapshot(params(req).get('project'))
        if (!stateLogged) { stateLogged = true; console.log('[arxa-boot] state first served in ' + (Date.now() - st0) + 'ms') }
        json(res, snap)
      } catch (e) {
        json(res, { ...emptySnap(SEAM_LIFECYCLE_STUBBED), error: String(e?.message ?? e) })
      }
    },
  })

  /** macOS native folder locator for the create-org modal: `choose folder`
    * runs in the user's GUI session (the engine IS on the user's machine),
    * so the real system panel opens over the app. Other platforms answer
    * unsupported and keep the typed-path fallback. Cancel is not an error. */
  ctx.webServer.register({
    name: 'arxa-sidebar-pick-folder',
    path: '/__arxa/sidebar/pick-folder',
    kind: 'exact',
    handler: async (req, res) => {
      let raw = ''
      req.on('data', (c) => { raw += c })
      req.on('end', async () => {
        try {
          if (process.platform !== 'darwin') {
            return json(res, { ok: false, error: 'folder picker unsupported on ' + process.platform })
          }
          const { title } = JSON.parse(raw || '{}')
          const prompt = String(title ?? 'Choose a folder').replace(/["\\]/g, '')
          const { spawn } = await import('node:child_process')
          const child = spawn('/usr/bin/osascript', ['-e',
            'POSIX path of (choose folder with prompt "' + prompt + '")'])
          let out = ''
          let err = ''
          child.stdout.on('data', (c) => { out += c })
          child.stderr.on('data', (c) => { err += c })
          const code = await new Promise((r) => child.on('exit', r))
          if (code === 0) {
            const p = out.trim().replace(/\/+$/, '') || '/'
            return json(res, { ok: true, path: p })
          }
          const canceled = code === 128 || /User canceled/.test(err)
          return json(res, { ok: false, canceled, error: canceled ? 'canceled' : err.trim() || ('osascript exited ' + code) })
        } catch (e) {
          json(res, { ok: false, error: String(e?.message ?? e) })
        }
      })
    },
  })

  /** Folder info for the create-time history question (2025-08): how many
    * top-level entries does the picked folder already hold? A COUNT only —
    * names and contents never leave the machine. Non-existent folder = 0
    * (typed paths may not exist yet; scaffold creates them). */
  ctx.webServer.register({
    name: 'arxa-sidebar-folder-info',
    path: '/__arxa/sidebar/folder-info',
    kind: 'exact',
    handler: async (req, res) => {
      let raw = ''
      req.on('data', (c) => { raw += c })
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(raw || '{}')
          const requested = typeof parsed?.path === 'string' ? parsed.path.trim() : ''
          if (requested === '') return json(res, { ok: false, error: 'path required' })
          const [{ default: path }, { default: os }, { default: fs }] = await Promise.all([
            import('node:path'), import('node:os'), import('node:fs'),
          ])
          const expanded = requested.startsWith('~') ? path.join(os.homedir(), requested.slice(1)) : path.resolve(requested)
          let entryCount = 0
          let exists = false
          try {
            entryCount = fs.readdirSync(expanded).length
            exists = true
          } catch { exists = false }
          // D92: is the resolved target already an arxa organisation? Powers
          // the create modal's "already lives here — open it instead" branch.
          let isOrg = false
          try { isOrg = fs.existsSync(path.join(expanded, 'org.json')) } catch { isOrg = false }
          return json(res, { ok: true, path: expanded, exists, entryCount, isOrg })
        } catch (e) {
          json(res, { ok: false, error: String(e?.message ?? e) })
        }
      })
    },
  })
  /** Open an https URL in the user's default browser (device-flow hand-off:
    * github.com/login/device). https + github.com allowlisted — this route
    * must never become a generic command surface. Non-darwin: xdg-open. */
  ctx.webServer.register({
    name: 'arxa-sidebar-open-external',
    path: '/__arxa/sidebar/open-external',
    kind: 'exact',
    handler: async (req, res) => {
      let raw = ''
      req.on('data', (c) => { raw += c })
      req.on('end', async () => {
        let settled = false
        const finish = (v) => { if (!settled) { settled = true; json(res, v) } }
        try {
          const { url } = JSON.parse(raw || '{}')
          let parsed = null
          try { parsed = new URL(String(url)) } catch {}
          if (!parsed || parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') {
            return finish({ ok: false, error: 'only https://github.com URLs may be opened' })
          }
          const { spawn } = await import('node:child_process')
          const bin = process.platform === 'darwin' ? '/usr/bin/open' : 'xdg-open'
          const child = spawn(bin, [parsed.toString()], { stdio: 'ignore', detached: true })
          child.on('error', (e) => finish({ ok: false, error: String(e?.message ?? e) }))
          child.unref()
          finish({ ok: true, opened: parsed.toString() })
        } catch (e) {
          finish({ ok: false, error: String(e?.message ?? e) })
        }
      })
    },
  })

  ctx.webServer.register({
    name: 'arxa-sidebar-action',
    path: '/__arxa/sidebar/action',
    kind: 'exact',
    handler: async (req, res) => {
      let raw = ''
      req.on('data', (c) => { raw += c })
      req.on('end', async () => {
        try {
          const { action, arg } = JSON.parse(raw || '{}')
          /** D36 first run: pick the folder organisations live under. Handled
            * before the lifecycle guard because its whole job is to make one
            * exist. Expands ~, creates the folder, validates via the D36 rules
            * (never the checkout, never OS app-data), then rebuilds the
            * singleton against the new root. */
          if (action === 'workspace.root') {
            const requested = typeof arg?.path === 'string' ? arg.path.trim() : ''
            if (requested === '') return json(res, { ok: false, error: 'root path required', action })
            const [{ default: fs }, { default: os }, { default: path }] = await Promise.all([
              import('node:fs'), import('node:os'), import('node:path'),
            ])
            const expanded = requested.startsWith('~')
              ? path.join(os.homedir(), requested.slice(1))
              : path.resolve(requested)
            fs.mkdirSync(expanded, { recursive: true })
            shell ??= await importShell().catch(() => null)
            if (typeof shell?.saveWorkspaceRoot !== 'function') {
              return json(res, { ok: false, seam: SEAM_LIFECYCLE_STUBBED, error: 'shell-unavailable', action })
            }
            shell.saveWorkspaceRoot(expanded)
            lifecycle = null // force getLifecycle to re-read the saved root
            const next = await getLifecycle()
            return json(res, { ok: true, action, root: !!next })
          }
          /** GitHub link acts are ACCOUNT-level: they must work on the very
            * first run — before any workspace/org exists (D69: the sign-in
            * step is the first thing the create modal offers). Handled before
            * the lifecycle guard for exactly that reason. */
          if (action === 'github.status' || action === 'github.link' || action === 'github.unlink' || action === 'github.device') {
            const g = await getGithub()
            if (!g) return json(res, { ok: false, error: 'github-unavailable', action })
            if (action === 'github.device') {
              return json(res, { ok: true, action, result: typeof g.deviceCode === 'function' ? g.deviceCode() : null })
            }
            const out = await (action === 'github.status' ? g.status() : action === 'github.link' ? g.link() : g.unlink())
            return json(res, { ok: true, action, result: out })
          }
          /** org.create-at (D69 placement half): the picked folder ITSELF
            * becomes the org — scaffold in place, touch recents, open. Works
            * on the very first run (no lifecycle yet), like workspace.root.
            * The account gate rides HERE, before any disk write. */
          if (action === 'org.create-at') {
            const requested = typeof arg?.path === 'string' ? arg.path.trim() : ''
            const nm = typeof arg?.name === 'string' && arg.name.trim() !== '' ? arg.name.trim() : ''
            if (requested === '') return json(res, { ok: false, error: 'org path required', action })
            if (nm === '') return json(res, { ok: false, error: 'org name required', action })
            // D90: link defaults ON; the modal toggle sends link:false to
            // create the org local-only (no gate, no heal, localOnly flag).
            const link = arg?.link !== false
            const g = link ? await getGithub().catch(() => null) : null
            if (g) {
              const st = await g.status().catch(() => ({ linked: false }))
              if (!st.linked) return json(res, { ok: false, error: 'linked-required', action })
            }
            const [{ default: path }, { default: os }, { default: fs }] = await Promise.all([
              import('node:path'), import('node:os'), import('node:fs'),
            ])
            const expanded = requested.startsWith('~') ? path.join(os.homedir(), requested.slice(1)) : path.resolve(requested)
            // D92 create contract (grilled 2026-08-31): the location is
            // ALWAYS the parent root; the org folder is ALWAYS root +
            // slug(name). The D69/D77 "picked folder becomes the org when its
            // name happens to match" heuristic is DELETED — its two invisible
            // branches silently nested orgs inside mismatched folders or
            // hijacked whole matching folders. The modal previews the target
            // live; this is the server-side mirror (never trust the client).
            // A non-empty target is a hard refusal: never merge, never
            // version foreign files unasked (the PLATO lesson, kept).
            // Dual probe (see importGitWorkspace): bare "workspace" is the
            // flat profile copy; the relative shape only resolves in-repo.
            const { slugify } = await import('workspace').catch(
              () => import(new URL('../../workspace/lib/slug.js', import.meta.url).href))
            const nameSlug = slugify(nm)
            if (nameSlug === '' || nameSlug === 'untitled') {
              return json(res, { ok: false, error: 'org name has no slug: ' + nm, action })
            }
            const target = path.join(expanded, nameSlug)
            try {
              if (fs.readdirSync(target).length > 0) {
                return json(res, { ok: false, error: 'folder-exists: ' + target + ' already exists and is not empty', action })
              }
            } catch { /* absent — the normal case; the scaffold below creates it */ }
            // Typed paths may not exist yet — create, then let the D36 rules
            // validate (same precedent as the workspace.root verb).
            fs.mkdirSync(target, { recursive: true })
            shell ??= await importShell().catch(() => null)
            if (typeof shell?.scaffoldOrg !== 'function') {
              return json(res, { ok: false, seam: SEAM_LIFECYCLE_STUBBED, error: 'shell-unavailable', action })
            }
            let created
            try {
              created = shell.scaffoldOrg(target, nm) // throws typed: bad folder / double scaffold
            } catch (e) {
              return json(res, { ok: false, error: String(e?.message ?? e), action })
            }
            if (typeof shell.touchRecent === 'function') { try { shell.touchRecent(created.path) } catch {} }
            // Rebind the singleton: recents[0] is now the new org, and each
            // org IS its own root (D69) — the cached lifecycle still points
            // at the previous root. Graceful teardown first (reverse order,
            // shell lock released), then a fresh lifecycle opens the new org.
            // D90 packed-mode lesson: the naive '../../file-org-shell' URL
            // does NOT exist under the profile's node_modules — annotate via
            // importShell's dual resolution (bare 'arxa-file-org-shell' first).
            if (!link) { try { shell ??= await importShell().catch(() => null); if (typeof shell?.annotateOrgManifest === 'function') shell.annotateOrgManifest(created.path, { localOnly: true }) } catch { /* best-effort flag */ } }
            if (lifecycle?.current) { try { await lifecycle.closeOrg() } catch {} }
            lifecycle = null
            const l2 = await getLifecycle()
            // includeExisting stays false — parity with the old modal default
            // (arxa-files-only history; a fresh scaffold holds nothing else).
            if (l2) await l2.openOrg(created.path, { deferSnapshot: true, includeExisting: false })
            // D92: sticky create root — the modal reopens at the last-used
            // parent (VS Code / GitHub Desktop last-clone-dir pattern).
            try {
              const arxaDir = path.join(os.homedir(), '.arxa')
              fs.mkdirSync(arxaDir, { recursive: true })
              fs.writeFileSync(path.join(arxaDir, 'create-root.json'), JSON.stringify({ root: requested }, null, 2))
            } catch { /* best-effort — the default root stands */ }
            // snapshot runs detached; includeExisting is fixed false (above)
            return json(res, { ok: true, action, result: { path: created.path, slug: created.slug ?? path.basename(created.path) } })
          }
          /**
           * Q4/Q5 (2026-09-03): subagent + background-job control.
           *
           * These sit ABOVE the lifecycle gate on purpose. A session's
           * children and its jobs exist whether or not an arxa org is open,
           * so answering them with `no-workspace` would be a lie about the
           * machine's state.
           *
           * ID CURRENCY: the DSH session id, raw. `listChildren` and
           * `interrupt` both address durable dsh sessions. Nothing on this
           * path may normalise it to a registry id the way the git-card
           * route does for ITS actions — that would address a different
           * object and silently answer about the wrong thing.
           *
           * The capability map is computed HERE and shipped with every row,
           * because it is not uniform and the client must not guess it:
           *
           *   dsh-subagent's ONLY stop verb is `interrupt`, and its own
           *   contract (dsh-subagent/lib/types/index.d.ts:138-152) says it
           *   PRESERVES the Activation and parks unclaimed inbox work —
           *   "once the interrupted driver is idle, a waking send resumes
           *   the parked FIFO queue". That is a pause. There is no terminate
           *   verb for a subagent at all, and an interrupt aimed at a
           *   one-shot child is documented as an accepted no-op.
           *
           *   dsh-jobs is the mirror image: `kill` is a real cancel, and the
           *   status union (running|stopping|completed|killed|failed) has no
           *   paused member — there is nothing to pause with.
           *
           * So subagents pause, jobs cancel, and every other cell is false
           * carrying the reason the UI puts on the disabled control. Naming
           * the gap is the feature; a button that lies is not.
           */
          if (action.startsWith('agent.')) {
            /**
             * TRANSPORT (re-corrected 2026-09-03 against a live engine —
             * the earlier note here was wrong about jobs; see below).
             *
             * SUBAGENTS: `ctx.subagents` is not reachable from a top-level
             * plugin. It is composed under the agent scope, so this context's
             * `reflect.get` does not resolve it and a bare property read
             * throws cordis' "without inject". Adding it to this plugin's
             * `inject` would not help — the service is not in this fiber's
             * store at all — and would make a missing service stop the whole
             * arxa shell from loading. `ctx.apiProxy` IS reachable (approvals
             * and conversation already inject it) and exposes the subagent
             * domain over the same code path the browser's RPC uses. Verified
             * live: `subagent.list` answers while the direct property read
             * reports nothing (scripts/agent-services-probe.mjs).
             *
             * JOBS ARE DIFFERENT, and the previous version of this comment
             * generalised the subagent result to them without probing them
             * separately. That was wrong. The job REGISTRY is a HOST service —
             * `dsh-jobs-local` is loaded by dsh-base/cordis.patch.yml:69,
             * beside `agent` and `settings` — so a top-level plugin reaches it
             * with `ctx.get('jobs')`, which is dsh's own documented way to
             * read an optional capability. What IS true is narrower: there is
             * no `job.*` RPC and no jobs field on the ApiProxy, so no CLIENT
             * can stop a job. The host can.
             *
             * `plugins/arxa-jobs` does exactly that, and its cancel reaches
             * the browser: `dsh-jobs-local.kill()` calls
             * `notifyChanged(job.owner)` (:207) and dsh-host-apiproxy
             * subscribes `jobs.onJobsChanged` to push a `session/jobs` frame
             * addressed to `owner.id` (:3589). Proven live over the client's
             * own ws /api/events.mux — `stopping` then `killed` arrived 166ms
             * after an arxa-initiated cancel (scripts/jobs-push-proof.mjs).
             *
             * This sidebar surface is still read-only about jobs; the cancel
             * lives in arxa-jobs. Keep the two consistent — if this ever grows
             * a job control, route it through arxa-jobs rather than a second
             * path to the same registry.
             */
            const rpc = () => ({ rpcId: 'arxa-' + Math.random().toString(36).slice(2) })
            const proxy = (() => {
              try {
                const viaReflect = ctx.reflect?.get?.('apiProxy')
                if (viaReflect) return viaReflect
              } catch { /* fall through */ }
              try { return ctx.apiProxy ?? null } catch { return null }
            })()
            const sid = typeof arg?.sessionId === 'string' && arg.sessionId !== '' ? arg.sessionId : null
            if (!sid) return json(res, { ok: false, error: 'sessionId-required', action })
            /** Unwrap an RpcResponse; a refusal reads as absence, never a throw. */
            const value = async (call) => {
              try {
                const r = await call
                return r?.result?.ok === true ? r.result.value : null
              } catch { return null }
            }

            const subRows = async () => {
              if (!proxy?.subagents?.list) return { rows: [], parentAvailable: false }
              const cat = await value(proxy.subagents.list({ ...rpc(), payload: { parentSessionId: sid } }))
              if (!cat) return { rows: [], parentAvailable: false }
              const rows = (cat.entries ?? []).filter((c) => c && c.kind === 'child').map((c) => {
                const continuable = c.mode === 'continuable'
                const running = c.activity === 'running'
                return {
                  kind: 'subagent',
                  id: c.id,
                  label: c.label || c.id,
                  mode: c.mode,
                  activity: c.activity,
                  hasChildren: c.hasChildren === true,
                  /* `wake` is the D3 control and it is NOT a verb button: it
                   * opens a message box, because `subagent.prompt` carries the
                   * human's words. Only a CONTINUABLE child is addressable —
                   * the RPC's own address type is
                   * `Extract<SubagentAddress, { mode: 'continuable' }>`, so a
                   * one-shot child cannot be woken by anything, and the row
                   * says so rather than offering a box that would be refused.
                   *
                   * Deliberately not gated on `running`: waking a child that is
                   * paused is the whole point, and one that is still running
                   * queues the message on its parked FIFO. `resume` stays false
                   * forever — there is no content-free resume verb. */
                  can: { pause: continuable && running, resume: false, cancel: false, wake: continuable },
                  why: {
                    ...(continuable && running ? {} : { pause: continuable ? 'not-running' : 'one-shot' }),
                    resume: continuable ? 'send-message' : 'one-shot',
                    cancel: 'no-terminate-verb',
                    ...(continuable ? {} : { wake: 'one-shot' }),
                  },
                }
              })
              return { rows, parentAvailable: cat.parentAvailable === true }
            }

            const agentTable = {
              'agent.list': async () => {
                const { rows, parentAvailable } = await subRows()
                return {
                  sessionId: sid,
                  parentLive: parentAvailable,
                  services: { subagents: Boolean(proxy?.subagents?.list), jobs: false },
                  subagents: rows,
                  // Stated, not implied: the client lists jobs from its own
                  // store because no host API can enumerate or stop them.
                  jobs: [],
                  jobsReadable: false,
                  jobsControllable: false,
                  jobsReason: 'no-job-api',
                }
              },
              /** The one live verb. `interrupt` PRESERVES the Activation and
                * parks unclaimed inbox work (dsh-subagent index.d.ts:138-152)
                * — that is a pause, and it is the only one that exists. */
              'agent.pause': async () => {
                if (arg?.kind !== 'subagent') return { ok: false, reason: 'no-job-api' }
                if (!proxy?.subagents?.interrupt) return { ok: false, reason: 'service-unavailable' }
                const id = arg?.id
                if (typeof id !== 'string' || id === '') return { ok: false, reason: 'id-required' }
                const out = await value(proxy.subagents.interrupt({
                  ...rpc(),
                  payload: { parentSessionId: sid, childSessionId: id, mode: 'continuable' },
                }))
                if (!out) return { ok: false, reason: 'refused' }
                return { ok: true, outcome: 'paused' }
              },
              /** Still no resume verb, and there never will be a content-free
                * one: waking a paused child needs words the human writes, and
                * inventing them is not a resume. The refusal now points at the
                * control that DOES exist — `agent.wake` below — instead of
                * naming a dead end. */
              'agent.resume': async () => ({
                ok: false,
                reason: arg?.kind === 'job' ? 'jobs-have-no-pause' : 'send-message',
              }),
              /** THE WAKE (D3). `subagent.prompt` is dsh's own sanctioned way to
                * reach a paused child: its contract says it "delivers human
                * content to a continuable child", and a pause made by
                * `agent.pause` above parks the inbox rather than ending the
                * Activation — so this resumes the parked FIFO queue with the
                * human's message at the front.
                *
                * `mode: 'continuable'` is not optional decoration: the address
                * type is `Extract<SubagentAddress, { mode: 'continuable' }>`, so
                * a one-shot child is not addressable here at all. That is the
                * runtime refusing to wake something that cannot be woken, which
                * is exactly the distinction the row's capability map draws. */
              'agent.wake': async () => {
                if (arg?.kind !== 'subagent') return { ok: false, reason: 'subagents-only' }
                if (!proxy?.subagents?.prompt) return { ok: false, reason: 'service-unavailable' }
                const id = arg?.id
                if (typeof id !== 'string' || id === '') return { ok: false, reason: 'id-required' }
                const text = typeof arg?.text === 'string' ? arg.text.trim() : ''
                // An empty wake would deliver nothing and still count as a turn.
                if (text === '') return { ok: false, reason: 'message-required' }
                const out = await value(proxy.subagents.prompt({
                  ...rpc(),
                  payload: {
                    parentSessionId: sid,
                    childSessionId: id,
                    mode: 'continuable',
                    content: [{ type: 'text', text }],
                  },
                }))
                if (!out) return { ok: false, reason: 'refused' }
                return { ok: true, outcome: 'woken' }
              },
              /** Cancel is still refused HERE, and the two reasons are now
                * different in a way that matters. A subagent genuinely has no
                * terminate verb in the runtime. A job HAS one — but it lives on
                * the host registry that `plugins/arxa-jobs` owns, not on the
                * agent plane this route reaches, so a job row is dispatched to
                * /__arxa/jobs/action by the client and never arrives here. If
                * one ever does, it is a routing bug, and this says so rather
                * than repeating the retired "no-job-api". */
              'agent.cancel': async () => ({
                ok: false,
                reason: arg?.kind === 'job' ? 'wrong-plane' : 'no-terminate-verb',
              }),
            }
            const agentFn = agentTable[action]
            if (!agentFn) return json(res, { ok: false, error: 'unknown-action', action })
            const agentOut = await agentFn()
            return json(res, { ok: true, action, result: agentOut })
          }

          const l = await getLifecycle()
          if (!l) return json(res, { ok: false, seam: SEAM_LIFECYCLE_STUBBED, error: 'no-workspace', action })
          const { orgByRef, handle, ensureOpen } = orgHelpers(l)

          const table = {
            /** D92: the create modal's defaults — the sticky last-used parent
              * root (create-root.json, written on every successful
              * org.create-at) plus the host homedir, so the client can
              * expand `~` itself and preview the absolute target per
              * keystroke. Read-only, nothing leaves the machine. */
            'create.defaults': async () => {
              const [{ default: path }, { default: os }, { default: fs }] = await Promise.all([
                import('node:path'), import('node:os'), import('node:fs'),
              ])
              let root = null
              try {
                root = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.arxa', 'create-root.json'), 'utf8')).root ?? null
              } catch { /* first run — the ~/Arxa default stands */ }
              if (typeof root !== 'string' || root.trim() === '') root = null
              return { root, home: os.homedir() }
            },
            /** Create + open: a freshly scaffolded org is the place you are about to work. */
            'org.create': async () => {
              // D69 gate half: no org is created without a linked GitHub
              // account. Degrades OPEN only when the github-link plugin
              // itself is unavailable (import failure) — a loud condition
              // surfaced by github.status, never a silent pass.
              const g = await getGithub().catch(() => null)
              if (g && arg?.link !== false) {
                const st = await g.status().catch(() => ({ linked: false }))
                if (!st.linked) throw new Error('linked-required')
              }
              const created = l.createOrg(typeof arg?.name === 'string' && arg.name.trim() !== '' ? arg.name : 'Untitled Organisation')
              if (arg?.link === false) { try { shell ??= await importShell().catch(() => null); if (typeof shell?.annotateOrgManifest === 'function') shell.annotateOrgManifest(created.path, { localOnly: true }) } catch { /* best-effort flag */ } }
              await ensureOpen(created.path) // switch, not open — single handle
            },
            // D90: per-org / per-project GitHub connect + disconnect.
            'org.disconnect': async () => l.disconnectGithub(orgByRef(arg?.orgId).path, { removeRepos: arg?.removeRepos === true }),
            'project.connect': async () => l.connectProject(orgByRef(arg?.orgId).path, String(arg?.projectSlug ?? '')),
            'project.disconnect': async () => l.disconnectProjectGithub(orgByRef(arg?.orgId).path, String(arg?.projectSlug ?? ''), { removeRepos: arg?.removeRepos === true }),
            'org.open': async () => {
              const ref = arg?.orgId ?? arg
              try {
                // `await` is load-bearing: a bare `return promise` resolves
                // OUTSIDE this try, so an unknown-ref rejection skipped the
                // catch and the by-path fallback below was unreachable
                // (measured 2026-09-02: org.open with a bare path on a fresh
                // home answered "org not found").
                return await ensureOpen(ref)
              } catch (e) {
                // D92: open-by-path when the org exists on disk but fell out
                // of recents — the create modal's "already lives here — open
                // it instead" branch lands here with a bare path.
                if (typeof ref !== 'string' || !ref.startsWith('/')) throw e
                const [{ default: fs }] = await Promise.all([import('node:fs')])
                let isOrgFolder = false
                try { isOrgFolder = fs.existsSync(ref + '/org.json') } catch { isOrgFolder = false }
                if (!isOrgFolder) throw e
                shell ??= await importShell().catch(() => null)
                if (typeof shell?.touchRecent === 'function') { try { shell.touchRecent(ref) } catch {} }
                if (lifecycle?.current) { try { await lifecycle.closeOrg() } catch {} }
                lifecycle = null
                const l3 = await getLifecycle()
                if (!l3) throw new Error('no-workspace')
                return l3.openOrg(ref)
              }
            },
            'org.close': () => l.closeOrg(),
            /** D95/D96 manual sync door: push every local main commit and
              * ff-pull remote advances for the org + all its project repos
              * (divergence parks as a sync-conflict note, never merges).
              * The open-time heal already runs the same sweep detached. */
            'org.sync': async () => {
              const cur = arg?.orgId ? await ensureOpen(arg.orgId) : handle()
              // syncOrgRepos lives on the LIFECYCLE (factory return), not
              // the open handle — the handle is presentation + publish.
              return l.syncOrgRepos(cur.path)
            },
            'org.rename': () => l.renameOrg(orgByRef(arg?.orgId).path, arg?.name),
            /** D74 manual publish (the org menu affordance): idempotent —
              * create the private repo when missing, push all branches,
              * annotate the manifest. Opens the org first when a ref is
              * given (single-handle contract, same as workspace.new-session).
              * The result carries ok/reason so the UI can say WHY when the
              * account is unlinked or the snapshot is still pending. */
            'github.publish': async () => {
              const cur = arg?.orgId ? await ensureOpen(arg.orgId) : handle()
              return cur.publishGithub()
            },
            // 'org.new-session' is GONE (grilled 2026-08-30): org rows
            // never host sessions — the legacy + path that reached this
            // action created org-level worktrees by accident. Unknown
            // action is the loud default below.
            'workspace.new-session': async () => {
              // Sessions are born in a WORKSPACE (v2): a fixed dock
              // container ('notes', 'meetings/scheduler') or a project
              // container ('projects/<slug>/design'). Unknown workspace is
              // loud. orgId rides along so a row under a NON-open org
              // switches there first (single open handle, ensureOpen).
              const cur = arg?.orgId ? await ensureOpen(arg.orgId) : handle()
              const ws = typeof arg?.workspace === 'string' ? arg.workspace : ''
              if (ws === '') throw new Error('workspace-required')
              // D111: a genuinely red main blocks a new session from being
              // born onto it (nobody should start work on a broken base) —
              // but a sleepy runner, a still-running check, or no CI at all
              // must never stop a session from starting. Unlinked/local-only
              // repos and any API failure proceed silently (infrastructure
              // never blocks); the notice rides along for the client to show.
              //
              // A workspace can route to the org repo OR a project's own
              // repo (D98/D99) — a project has its own manifest and its own
              // GitHub link, independent of the org's. Gate against whatever
              // repo the session will actually land in, not always the org.
              // `newSession` below performs its own routing/validation and
              // stays the sole source of truth for workspace-shape errors —
              // a resolution failure here just means "can't tell it's
              // linked", so it is treated the same as unlinked (notice null)
              // and the real error still surfaces from `newSession` itself.
              let notice = null
              const g = await getGithub().catch(() => null)
              if (g) {
                const gw = await importGitWorkspace()
                let route = null
                try { route = gw.resolveSessionRepo(cur.path, ws, { env: process.env }) } catch { route = null }
                if (route) {
                  const manifestFile = route.repoPath + (route.kind === 'project' ? '/project.json' : '/org.json')
                  let manifest = {}
                  try { manifest = JSON.parse((await import('node:fs')).readFileSync(manifestFile, 'utf8')) } catch {}
                  const checks = await mainChecksFor(route.repoPath, manifest, g, gw).catch(() => null)
                  if (checks) {
                    if (checks.state === 'red') throw new Error('main-red')
                    if (checks.asleep) notice = 'runner-asleep'
                    else if (checks.state === 'pending') notice = 'checks-pending'
                  }
                }
              }
              const session = await cur.newSession(undefined, ws)
              return { ...session, notice }
            },
            'session.rename': async () => {
              // One rename, every surface (grilled 2026-08-30): registry
              // name is the display truth; git stays keyed by session id.
              const cur = arg?.orgId ? await ensureOpen(arg.orgId) : handle()
              if (typeof arg?.sessionId !== 'string' || typeof arg?.name !== 'string') {
                throw new Error('session-id-and-name-required')
              }
              return cur.renameSession(arg.sessionId, arg.name)
            },
            'project.create': async () => {
              // v2 (grilled 2026-08-30): the Projects dock + creates an
              // auto-named project (project-001…) with its 10 fixed
              // containers; publish logic rides newProject unchanged.
              const cur = arg?.orgId ? await ensureOpen(arg.orgId) : handle()
              return cur.newProject(typeof arg?.name === 'string' ? arg.name : '')
            },
            'project.rename': async () => {
              // D80: FULL-MOVE rename (grilled 2026-08-30) — folder +
              // manifest + session rekeys + the GitHub repo PATCH,
              // pre-flighted synchronously; any post-move failure rides
              // repoRenamePending and the next heal finishes it.
              const cur = await ensureOpen(arg?.orgId)
              if (typeof arg?.projectSlug !== 'string' || arg.projectSlug.trim() === '' ||
                  typeof arg?.name !== 'string' || arg.name.trim() === '') {
                throw new Error('project-slug-and-name-required')
              }
              return l.renameProject(cur.path, arg.projectSlug, arg.name)
            },
            'org.trash': () => l.trashOrg(orgByRef(arg?.orgId).path),
            'orgtrash.restore': () => l.restoreOrg(arg?.entryId),
            'orgtrash.purge': async () => {
              if (typeof arg?.entryId !== 'string' || arg.entryId.trim() === '') throw new Error('entry-id-required')
              return l.purgeOrgTrash(arg.entryId)
            },
            'projecttrash.purge': async () => {
              if (typeof arg?.entryId !== 'string' || arg.entryId.trim() === '') throw new Error('entry-id-required')
              const cur = handle()
              return cur.purgeTrash(arg.entryId)
            },
            'project.trash': async () => {
              // D80: local-only soft delete (restorable in the Trash row).
              const cur = await ensureOpen(arg?.orgId)
              if (typeof arg?.projectSlug !== 'string' || arg.projectSlug.trim() === '') {
                throw new Error('project-slug-required')
              }
              return cur.trashProject(arg.projectSlug)
            },
            'session.open': async () => {
              const so0 = Date.now()
              const cur = await ensureOpen(arg?.orgId)
              console.log('[arxa-boot] session.open ensureOpen=' + (Date.now() - so0) + 'ms')
              return cur.resumeSession(arg?.sessionId, { dropIfEmpty: arg?.dropIfEmpty === true })
            },
            'session.archive': async () => {
              const cur = await ensureOpen(arg?.orgId)
              // dropRemote: close-without-merge cleanup — the caller asserts the
              // PR is closed, so the unmerged remote branch may go too.
              return cur.archiveSession(arg?.sessionId, { dropRemote: arg?.dropRemote === true })
            },
            // ---- Archives section (2026-09-05 grill) ---------------------
            // Restore = bare revival (worktree back from the parked branch;
            // the row reappears under its workspace). The conversation
            // attaches when the user opens the row — trash-restore parity.
            'session.revive': async () => {
              const cur = await ensureOpen(arg?.orgId)
              if (typeof arg?.sessionId !== 'string' || arg.sessionId.trim() === '') {
                throw new Error('session-id-required')
              }
              return cur.reviveSessionOnly(arg.sessionId)
            },
            // Move to Trash (reversible): a logical entry + registry-row
            // removal. The branch parks until the trash's own purge — the
            // Archives row never destroys anything.
            'session.trash': async () => {
              const cur = await ensureOpen(arg?.orgId)
              if (typeof arg?.sessionId !== 'string' || arg.sessionId.trim() === '') {
                throw new Error('session-id-required')
              }
              return cur.trashArchivedSession(arg.sessionId)
            },
            'sessiontrash.restore': async () => {
              const cur = await ensureOpen(arg?.orgId)
              if (typeof arg?.entryId !== 'string' || arg.entryId.trim() === '') throw new Error('entry-id-required')
              return cur.restoreSessionEntry(arg.entryId)
            },
            // Purge-modal data: the live CI/CD picture (open PR on the
            // parked branch, the owning repo's GitHub coordinates).
            'sessiontrash.precheck': async () => {
              const cur = await ensureOpen(arg?.orgId)
              if (typeof arg?.entryId !== 'string' || arg.entryId.trim() === '') throw new Error('entry-id-required')
              return cur.precheckSessionEntry(arg.entryId)
            },
            // The ONE destructive door for a session (D47): remote-first
            // branch delete when published, then local refs + the entry.
            'sessiontrash.purge': async () => {
              const cur = await ensureOpen(arg?.orgId)
              if (typeof arg?.entryId !== 'string' || arg.entryId.trim() === '') throw new Error('entry-id-required')
              return cur.purgeSessionEntry(arg.entryId)
            },
            'trash.restore': () => handle().restoreTrash(arg?.entryId ?? null),
            // 'ci.run' reserved for Phase D3 — deliberately absent.
          }
          const fn = table[action]
          if (!fn) return json(res, { ok: false, error: 'unknown-action', action })
          const out = await fn()
          json(res, out !== undefined ? { ok: true, action, result: out } : { ok: true, action })
        } catch (e) {
          json(res, { ok: false, error: String(e?.message ?? e) })
        }
      })
    },
  })
}
