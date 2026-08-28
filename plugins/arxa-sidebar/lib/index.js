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
 * PHASE A SEAM (integrator flips): Phase A's lifecycle plugin
 * (plugins/file-org-shell/, built in parallel by builder-file-org-shell) is
 * consumed strictly by the plan contract — createOrgLifecycle() with a single
 * org-open entry point and reverse teardown on switch/close, plus
 * discoverOrgs(). Its code is not merged into this branch yet, so
 * resolveLifecycle() import-probes it and falls back to an inert stub that
 * reports seam:true. To flip: ensure `arxa-file-org-shell` resolves (add it
 * to the profile package.json deps in bin/arxa-studio.mjs the same way this
 * plugin is added) and set SEAM_LIFECYCLE_STUBBED to false; selftest.mjs
 * step "seam" then verifies the real import instead of the stub.
 *
 * Nothing here touches the Arxa Digital Solutions database — all data comes
 * from the local lifecycle API (filesystem + git). No localStorage on the
 * client; layout state stays transient per the dsh layout contract.
 */
import { computeCtas } from './cta-state.mjs'

/** Flipped to false by the integrator once plugins/file-org-shell is merged. */
export const SEAM_LIFECYCLE_STUBBED = true

export const name = 'arxa-sidebar'
export const inject = ['webServer']

/** Import-probe the Phase A plugin; null while the seam is stubbed. */
async function resolveLifecycle() {
  try {
    const mod = await import('arxa-file-org-shell')
    if (typeof mod.createOrgLifecycle === 'function') return mod.createOrgLifecycle()
    return null
  } catch {
    return null
  }
}

export function apply(ctx) {
  let lifecycle = null
  const lifecycleReady = resolveLifecycle().then((l) => { lifecycle = l })

  const json = (res, body) => {
    res.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(body))
  }
  const params = (req) => new URL(req.url, 'http://x').searchParams

  /** Snapshot of the open org through the plan contract, stub-safe. */
  const snapshot = async (selectedProject) => {
    await lifecycleReady
    if (!lifecycle) {
      return {
        seam: true,
        org: null,
        orgs: [],
        projects: [],
        parkedSessions: [],
        trashCount: 0,
        selectedProject: null,
      }
    }
    const current = (await lifecycle.current?.()) ?? null
    const orgs = (await lifecycle.discoverOrgs?.()) ?? []
    return {
      seam: false,
      org: current ? { id: current.id, name: current.name } : null,
      orgs,
      // Contract faces: org manifest (workspace plugin), version chips (git
      // rail), session badges (worktree lifecycle) — all through the open
      // org handle so teardown on switch/close stays the lifecycle's job.
      projects: (await current?.projects?.()) ?? [],
      parkedSessions: (await current?.parkedSessions?.()) ?? [],
      trashCount: (await current?.trashCount?.()) ?? 0,
      selectedProject: selectedProject ?? null,
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
        json(res, { seam: SEAM_LIFECYCLE_STUBBED, error: String(e?.message ?? e) })
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
          await lifecycleReady
          if (!lifecycle) return json(res, { ok: false, seam: true, action })
          // Plan contract: ONE org-open entry point; switch/close tear down
          // in reverse before opening the next org.
          const table = {
            'org.open': () => lifecycle.open(arg),
            'org.new': () => lifecycle.create?.(arg),
            'org.switch': () => lifecycle.switch(arg),
            'org.close': () => lifecycle.close(),
            'project.new': () => lifecycle.currentSync?.()?.newProject?.(arg),
            'session.new': () => lifecycle.currentSync?.()?.newSession?.(arg),
            'session.resume': () => lifecycle.currentSync?.()?.resumeSession?.(arg),
            'session.merge': () => lifecycle.currentSync?.()?.mergeSession?.(arg),
            'trash.restore': () => lifecycle.currentSync?.()?.restoreTrash?.(arg),
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
