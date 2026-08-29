/**
 * arxa-sidebar (host half) — ROWS WORLD (sidebar rethink, docs/plans/sidebar-org-rethink.md).
 *
 * The stock Workspaces section (dsh-client-ui-workspace, transformed by
 * scripts/gen-workspace.mjs) renders orgs as rows; this host half is its
 * only data face. Two routes on the same webServer pattern as before:
 *
 *   GET  /__arxa/sidebar/state?project=<id|slug>
 *        → { seam, root, orgs: [{ id, name, slug, path, open, sessions }],
 *            trashCount, selectedProject }
 *        Every org carries its registry session rows (read-only listSessions
 *        — no shell lock needed to LIST); the open org additionally serves
 *        projects and the selected scope. Archived sessions never leave the
 *        host (D39 archivedSessionIds contract).
 *
 *   POST /__arxa/sidebar/action  body { action, arg }
 *        org.create | org.open | org.close | org.rename | org.new-session |
 *        session.open | session.archive | trash.restore
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

  /**
   * One org's session rows off the plain registry read — no shell lock, no
   * open cycle: LISTING sessions is read-only fs (+ git common-dir walk).
   * An org that never opened (no repo yet) or an unreadable registry lists
   * as empty; a row is presentation, not a lifecycle.
   */
  const orgSessions = (l, org) => {
    try {
      return shell.listSessions(org.path, process.env)
        .filter((s) => s.state !== 'archived')
        .map((s) => ({ id: s.id, name: s.name, state: s.state, parkedReason: s.parkedReason, project: s.project ?? null }))
    } catch {
      return []
    }
  }

  const emptySnap = (seam) => ({
    seam,
    root: false,
    orgs: [],
    trashCount: 0,
    selectedProject: null,
  })

  /** Snapshot for the rows client: orgs with their session rows inline. */
  const snapshot = async (selectedProject) => {
    const l = await getLifecycle()
    if (!l) return emptySnap(SEAM_LIFECYCLE_STUBBED)
    const cur = l.current
    const orgs = l.listOrgs().map(({ id, name, slug, path, manifest }) => ({
      id,
      name,
      slug,
      path,
      open: cur?.path === path,
      createdAt: manifest?.createdAt ?? null,
      sessions: orgSessions(l, { path }),
    }))
    // Project scope (open org only): the client's id-or-slug selection
    // resolves once against the registry's slug; unknown renders as none.
    const selSlug = (() => {
      if (!cur || selectedProject == null) return null
      const hit = cur.projects().find((p) => p.slug === selectedProject || p.id === selectedProject)
      return hit ? hit.slug : null
    })()
    return {
      seam: false,
      root: true,
      orgs,
      trashCount: cur ? cur.trashCount() : 0,
      // Open-org view only: the trash lives at the workspace root, but the
      // surface (Q6) hangs off the open org's row menu.
      trash: cur ? shell.listTrash(l.workspaceRoot).map((e) => ({
        entryId: e.entryId,
        name: (e.origin?.originalPath ?? e.entryId).replace(/[/\\]+$/, '').split('/').pop() || e.entryId,
      })) : [],
      selectedProject: selSlug,
    }
  }

  ctx.webServer.register({
    name: 'arxa-sidebar-state',
    path: '/__arxa/sidebar/state',
    kind: 'exact',
    handler: async (req, res) => {
      try {
        json(res, await snapshot(params(req).get('project')))
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
          const { action, arg } = JSON.parse(raw || '{}')
          const l = await getLifecycle()
          if (!l) return json(res, { ok: false, seam: SEAM_LIFECYCLE_STUBBED, error: 'no-workspace', action })

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

          const table = {
            /** Create + open: a freshly scaffolded org is the place you are about to work. */
            'org.create': async () => {
              const created = l.createOrg(typeof arg?.name === 'string' && arg.name.trim() !== '' ? arg.name : 'Untitled Organisation')
              await ensureOpen(created.path) // switch, not open — single handle
            },
            'org.open': () => ensureOpen(arg?.orgId ?? arg),
            'org.close': () => l.closeOrg(),
            'org.rename': () => l.renameOrg(orgByRef(arg?.orgId).path, arg?.name),
            'org.new-session': async () => {
              // No orgId = the shell CTA: session in the CURRENT open org.
              const cur = arg?.orgId ? await ensureOpen(arg.orgId) : handle()
              // Rows start sessions at org level; the project scope stays a
              // display/selection concept (Q4), not a creation default.
              return cur.newSession(undefined, null)
            },
            'session.open': async () => {
              const cur = await ensureOpen(arg?.orgId)
              return cur.resumeSession(arg?.sessionId)
            },
            'session.archive': async () => {
              const cur = await ensureOpen(arg?.orgId)
              return cur.archiveSession(arg?.sessionId)
            },
            'trash.restore': () => handle().restoreTrash(arg?.entryId ?? null),
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
