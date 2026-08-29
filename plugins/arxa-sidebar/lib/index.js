/**
 * arxa-sidebar (host half) — serves the sidebar's data faces over the same
 * webServer route pattern arxa-waiting-page uses (/__arxa/*):
 *
 *   GET  /__arxa/sidebar/state?project=<id>
 *        → { seam, org, orgs, projects, parkedSessions, trashCount, cta }
 *        CTAs are computed HERE (lib/cta-state.mjs) so the state machine has
 *        one testable home; the client renders what it receives.
 *   POST /__arxa/sidebar/action  body { id, action, arg? }
 *        → dispatches to the Phase A lifecycle API.
 *
 * PHASE A SEAM — FLIPPED. The real plugin (plugins/file-org-shell/) is on
 * this branch and this host half consumes its actual surface:
 *   createOrgLifecycle({ workspaceRoot }) → { listOrgs, createOrg, openOrg,
 *   closeOrg, switchOrg, current (getter) }, with the contract faces
 *   (projects / parkedSessions / trashCount and the project/session/trash
 *   verbs) exposed ON the open-org handle so switch/close teardown stays
 *   the lifecycle's job. Workspace root comes from the persisted
 *   loadWorkspaceRoot() (ARXA_HOME-scoped workspace.json); no root chosen
 *   yet renders the no-org state, not an error.
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
import { computeCtas } from './cta-state.mjs'

/** Flipped by the integrator: plugins/file-org-shell is merged on this branch. */
export const SEAM_LIFECYCLE_STUBBED = false

export const name = 'arxa-sidebar'
export const inject = ['webServer']

/** Import-probe the Phase A plugin in both deployment shapes. */
async function importShell() {
  try {
    return await import('arxa-file-org-shell')
  } catch {
    return import(new URL('../../file-org-shell/lib/index.js', import.meta.url).href)
  }
}

export function apply(ctx) {
  /** Singleton — holds the single open-org handle across requests. */
  let lifecycle = null
  let shell = null

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
    lifecycle = shell.createOrgLifecycle({ workspaceRoot: root })
    return lifecycle
  }

  const json = (res, body) => {
    res.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(body))
  }
  const params = (req) => new URL(req.url, 'http://x').searchParams

  const emptySnap = (seam) => ({
    seam,
    org: null,
    orgs: [],
    projects: [],
    parkedSessions: [],
    trashCount: 0,
    selectedProject: null,
  })

  /** Snapshot of the open org through the plan contract faces. */
  const snapshot = async (selectedProject) => {
    const l = await getLifecycle()
    if (!l) return emptySnap(SEAM_LIFECYCLE_STUBBED)
    const orgs = l.listOrgs().map(({ id, name: orgName, slug, path }) => ({ id, name: orgName, slug, path }))
    const cur = l.current
    if (!cur) return { ...emptySnap(false), orgs }
    return {
      seam: false,
      org: { id: cur.manifest.id, name: cur.manifest.name },
      orgs,
      // Contract faces: org manifest (workspace plugin), session registry
      // (worktree lifecycle), trash — all through the open org handle so
      // teardown on switch/close stays the lifecycle's job.
      projects: cur.projects(),
      parkedSessions: cur.parkedSessions(),
      trashCount: cur.trashCount(),
      // Machine + consumers compare against the registry's project scope,
      // which stores slugs; resolve the client's id-or-slug selection once.
      // Unknown selection renders as no selection (mutations throw instead).
      selectedProject: (() => {
        if (selectedProject == null) return null
        const hit = cur.projects().find((p) => p.slug === selectedProject || p.id === selectedProject)
        return hit ? hit.slug : null
      })(),
    }
  }

  ctx.webServer.register({
    name: 'arxa-sidebar-state',
    path: '/__arxa/sidebar/state',
    kind: 'exact',
    handler: async (req, res) => {
      try {
        const snap = await snapshot(params(req).get('project'))
        json(res, { ...snap, cta: computeCtas(snap) })
      } catch (e) {
        json(res, { ...emptySnap(SEAM_LIFECYCLE_STUBBED), error: String(e?.message ?? e) })
      }
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
          const { action, arg, project } = JSON.parse(raw || '{}')
          const l = await getLifecycle()
          if (!l) return json(res, { ok: false, seam: SEAM_LIFECYCLE_STUBBED, error: 'no-workspace', action })

          /** Client rows send org ids; openOrg wants a path. Accept both. */
          const orgPath = (idOrPath) => {
            const hit = l.listOrgs().find((o) => o.id === idOrPath || o.path === idOrPath)
            if (hit) return hit.path
            if (typeof idOrPath === 'string' && idOrPath !== '') return idOrPath
            throw new Error('org-not-found')
          }
          /** Open-org handle or loud failure — no silent ok on a closed org. */
          const handle = () => {
            if (!l.current) throw new Error('no-org-open')
            return l.current
          }
          /** Sole-org convenience for the Open CTA — the shell has no picker. */
          const soleOrgId = () => {
            const orgs = l.listOrgs()
            if (orgs.length === 1) return orgs[0].id
            throw new Error(orgs.length === 0 ? 'org-not-found' : 'org-choice-required — use the org switcher')
          }
          /**
           * Selected project (id or slug) → registry scope value (slug).
           * Loud on unknown: mutations never silently degrade scope.
           */
          const projectSlug = (sel) => {
            if (sel == null) return null
            const hit = handle().projects().find((p) => p.slug === sel || p.id === sel)
            if (!hit) throw new Error(`unknown-project: ${sel}`)
            return hit.slug
          }
          /**
           * Resolution ladder: exact session id → sole match in scope
           * (selected project's sessions + org-level ones) → sole parked
           * anywhere → error. Ambiguity is an error, never a guess.
           */
          const parkedId = (a, selSlug) => {
            const parked = handle().parkedSessions()
            if (a != null) {
              const byId = parked.find((s) => s.id === a)
              if (byId) return byId.id
            }
            const scoped = parked.filter((s) => s.project == null || s.project === selSlug)
            if (scoped.length === 1) return scoped[0].id
            if (parked.length === 1) return parked[0].id
            throw new Error(parked.length === 0 ? 'no-parked-session' : 'ambiguous-parked-session')
          }

          // Plan contract: ONE org-open entry point; switch/close tear down
          // in reverse before opening the next org. Untitled defaults keep
          // the New-* CTAs one-click (slugs are uniquified downstream).
          const table = {
            'org.open': () => l.openOrg(orgPath(arg ?? soleOrgId())),
            'org.new': () => l.createOrg(arg || 'Untitled Organisation'),
            'org.switch': () => l.switchOrg(orgPath(arg)),
            'org.close': () => l.closeOrg(),
            'project.new': () => handle().newProject(arg || 'Untitled Project'),
            'session.new': () => handle().newSession(typeof arg === 'string' ? arg : undefined, projectSlug(project)),
            'session.resume': () => handle().resumeSession(parkedId(arg, projectSlug(project))),
            'session.merge': () => handle().mergeSession(parkedId(arg, projectSlug(project))),
            'trash.restore': () => handle().restoreTrash(arg),
            // 'ci.run' reserved for Phase D3 — deliberately absent.
          }
          const fn = table[action]
          if (!fn) return json(res, { ok: false, error: 'unknown-action', action })
          await fn()
          json(res, { ok: true, action })
        } catch (e) {
          json(res, { ok: false, error: String(e?.message ?? e) })
        }
      })
    },
  })
}
