/**
 * arxa-dashboard — host half (docs/plans/org-row-dashboard.md, D9).
 *
 * One route on the git card's webServer pattern:
 *   POST /__arxa/dashboard/action  body { action, arg }
 * running over the org shell the sidebar publishes under
 * Symbol.for('arxa.sidebar.host'). Verbs:
 *   ping            → { ready: true }
 *   row.stats       → identity of a selected row { kind, orgId, rowId, name, path, exists,
 *                     createdAt, updatedAt } plus tier-1 figures (lib/repo.js, arg.range 30|90|365|all):
 *                     activity { since, days[{day,count}], commits, current, longest, weeks[13] }
 *                     repository { files, folders, branches, contributors, lastCommit, dirty, repos }
 *                     — { reason: 'unavailable' } for both when git-workspace is absent.
 *   row.sessions    → { rows: [...] } the registry sessions scoped to the row
 *                     (org = all; projects = project-scoped; another category =
 *                     workspace under it; project = that project), each with the
 *                     dsh projection metrics of lib/projections.js (null when the
 *                     conversation never checkpointed). { reason } when the
 *                     sidebar host has no session lister.
 *   row.delivery    → tier-3 GitHub delivery (lib/delivery.js, arg.fresh bypasses the 60 s
 *                     cache): { login, repos: [{ name, owner, repo, branch, ci, runs }],
 *                     ci, rate, truncated, fetchedAt } — or { reason: 'unavailable' |
 *                     'not-linked' | 'relink' } when github-link cannot answer. Per-user
 *                     GitHub through the user's own OAuth grant; no Arxa Digital Solutions
 *                     database is ever in the path (CLAUDE.md boundary).
 *   row.engine      → tier-4 arxa engine, read from the on-disk file contract only
 *                     (lib/engine.js, D5 — never shells out to the `arxa` binary):
 *                     { projects: [{ name, phase, step, steps, status, attempts, dirty,
 *                     rejections, screens, flows, shipped, halted, updatedAt }], phase,
 *                     shipped, withEngine, scanned } — or { reason: 'not-set-up' |
 *                     'not-applicable' } when the engine never ran for the row.
 *   session.focus   → { sessionId, deltaMs } focus heartbeat (D10): adds the delta to
 *                     `focusMs` on the registry row through git-workspace's own
 *                     annotateSession writer; { reason: 'unavailable' } without it.
 *   session.summary → { id, name, dshSessionId, title, stats, tokens, lastPromptAt,
 *                     summary: { turnCount, goal, todos }, activity: { tools, files, commands, lastCommand, lastTool, lastToolAt } }
 *                     — facts about what was done (goal/todos units + tool/call surface events), never transcript text; { reason: 'no-conversation' |
 *                     'no-projection' } instead of throwing when absent.
 *
 * Paths NEVER come from the browser: the org is resolved by id through the
 * shell's own registry (lifecycle.listOrgs) and a row is one of the fixed
 * category slugs or `projects/<slug>` under it — anything else is refused.
 * dsh faces (sessions, sessionProjections, sessionPersistence) are read
 * optionally through ctx.get — the dashboard degrades to registry rows
 * without them, it never blocks the sidebar's boot.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { deliveryOf } from './delivery.js'
import { engineFor } from './engine.js'
import { activityFromEvents, metricsFromValues, readMetrics, readValues, summaryFromValues } from './projections.js'
import { activityOf, reposFor, repositoryOf, sinceFor, timesOf } from './repo.js'

export const name = 'arxa-dashboard'
export const inject = ['webServer']

const HOST_KEY = Symbol.for('arxa.sidebar.host')
const CATEGORIES = new Set(['projects', 'notes', 'meetings', 'account', 'communications'])

/** Any small JSON file on disk, or null. Plain read: the dashboard only ever
  * READS manifests and engine state, so it does not need git-workspace's seat
  * resolver or the engine's Dart. A missing or malformed file is null, never a
  * throw — a dashboard does not fail a row because a file is absent. */
function readJson(filePath) {
  try { const m = JSON.parse(readFileSync(filePath, 'utf8')); return m && typeof m === 'object' ? m : null } catch { return null }
}

/** The sidebar's published host object, or null before its apply() ran (git-card precedent). */
async function sidebarHost() {
  const g = globalThis[HOST_KEY]
  if (g?.ready) return g
  try {
    const m = await import('arxa-sidebar')
    if (m.sidebarHost?.ready) return m.sidebarHost
  } catch { /* not resolvable bare — checkout shape below */ }
  try {
    const m = await import(new URL('../../arxa-sidebar/lib/index.js', import.meta.url).href)
    if (m.sidebarHost?.ready) return m.sidebarHost
  } catch { /* fall through */ }
  return globalThis[HOST_KEY]?.ready ? globalThis[HOST_KEY] : null
}

/**
 * Resolve a selection to a row scope, or throw a coded error.
 * @param {{ id: string, name: string, path: string }[]} orgs - lifecycle.listOrgs()
 * @param {{ orgId?: unknown, rowId?: unknown }} arg
 * @returns {{ kind: 'org'|'category'|'project', orgId: string, rowId: string, name: string, path: string, orgName: string, orgPath: string }}
 */
export function resolveRow(orgs, arg) {
  const orgId = typeof arg?.orgId === 'string' ? arg.orgId : ''
  const rowId = typeof arg?.rowId === 'string' ? arg.rowId : ''
  const org = Array.isArray(orgs) ? orgs.find((o) => o && o.id === orgId) : undefined
  if (!org) throw new Error('org-not-found')
  if (rowId === '') return { kind: 'org', orgId, rowId, name: org.name, path: org.path, orgName: org.name, orgPath: org.path }
  const parts = rowId.split('/')
  if (parts.length === 1 && CATEGORIES.has(parts[0])) {
    return { kind: 'category', orgId, rowId, name: parts[0], path: join(org.path, parts[0]), orgName: org.name, orgPath: org.path }
  }
  if (parts.length === 2 && parts[0] === 'projects' && /^[a-z0-9][a-z0-9._-]*$/i.test(parts[1])) {
    const path = resolve(org.path, 'projects', parts[1])
    if (!path.startsWith(resolve(org.path) + sep)) throw new Error('row-refused')
    return { kind: 'project', orgId, rowId, name: parts[1], path, orgName: org.name, orgPath: org.path }
  }
  throw new Error('row-refused')
}

/**
 * The registry sessions that belong to a row. Pure; exported for the selftest.
 * @param {{ project?: string|null, workspace?: string|null }[]} rows - sidebar active session rows
 * @param {{ kind: string, name: string }} row - resolveRow() result
 */
export function scopeSessions(rows, row) {
  const list = Array.isArray(rows) ? rows : []
  if (row.kind === 'org') return list
  if (row.kind === 'project') return list.filter((s) => s && s.project === row.name)
  if (row.name === 'projects') return list.filter((s) => s && typeof s.project === 'string' && s.project !== '')
  return list.filter((s) => s && typeof s.workspace === 'string' && (s.workspace === row.name || s.workspace.startsWith(row.name + '/')))
}

/** Owned JSON for one session row: registry leaves + live pills + projection metrics. */
function shapeSession(s, metricsFor) {
  const dshSessionId = typeof s.dshSessionId === 'string' && s.dshSessionId !== '' ? s.dshSessionId : null
  return {
    id: s.id,
    name: typeof s.name === 'string' ? s.name : s.id,
    state: s.state ?? null,
    parkedReason: s.parkedReason ?? null,
    project: s.project ?? null,
    workspace: s.workspace ?? null,
    createdAt: s.createdAt ?? null,
    updatedAt: s.updatedAt ?? null,
    dshSessionId,
    dshStatus: s.dshStatus ?? null,
    running: s.running === true,
    pendingInteraction: typeof s.pendingInteraction === 'string' ? s.pendingInteraction : null,
    // Absent unit ⇒ null, never zero: a row written before the heartbeat existed
    // has no focus figure, it does not have a focus figure of zero.
    focusMs: typeof s.focusMs === 'number' && Number.isFinite(s.focusMs) && s.focusMs > 0 ? s.focusMs : null,
    metrics: dshSessionId ? metricsFor(dshSessionId) : null,
  }
}

/**
 * A heartbeat can only ever claim the interval it covers (D10): the client
 * posts one slice per ~30 s, so anything above two minutes is a slept machine
 * or a forged body, not attention. Refused, never clamped — a clamp would
 * quietly bank the lie.
 */
export const FOCUS_MAX_MS = 120_000
export function focusTotal(prev, deltaMs) {
  if (typeof deltaMs !== 'number' || !Number.isFinite(deltaMs) || deltaMs <= 0 || deltaMs > FOCUS_MAX_MS) throw new Error('focus-delta-refused')
  const base = typeof prev === 'number' && Number.isFinite(prev) && prev > 0 ? prev : 0
  return Math.round(base + deltaMs)
}

export function apply(ctx) {
  const json = (res, body) => {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  const face = (n) => { try { return typeof ctx.get === 'function' ? ctx.get(n) : undefined } catch { return undefined } }
  /** dsh read faces, resolved per call (a face can appear after our apply). */
  const dshEnv = () => {
    const persistence = face('sessionPersistence')
    return {
      dshHome: persistence && typeof persistence.root === 'string' ? dirname(persistence.root) : null,
      sessions: face('sessions'),
      projections: face('sessionProjections'),
    }
  }
  const metricsFor = (env) => (id) => { try { return readMetrics(env, id) } catch { return null } }

  ctx.webServer.register({
    name: 'arxa-dashboard-action',
    path: '/__arxa/dashboard/action',
    kind: 'exact',
    handler: async (req, res) => {
      let raw = ''
      req.on('data', (c) => { raw += c })
      req.on('end', async () => {
        let action
        try {
          const parsed = JSON.parse(raw || '{}')
          action = parsed.action
          const arg = parsed.arg
          if (action === 'ping') return json(res, { ok: true, action, result: { ready: true } })
          const sb = await sidebarHost()
          if (!sb) return json(res, { ok: false, error: 'sidebar-not-ready', action })
          const oc = await sb.orgContext()
          if (!oc || !oc.l || typeof oc.l.listOrgs !== 'function') return json(res, { ok: false, error: 'no-workspace', action })
          const orgs = oc.l.listOrgs()
          /** Active session rows of one org through the sidebar's own lister (registry ⋈ dsh live). */
          const sessionsOf = async (row) => {
            if (typeof sb.sessionsOf !== 'function') return null
            const org = orgs.find((o) => o.id === row.orgId)
            const out = await sb.sessionsOf(oc.l, org)
            return Array.isArray(out?.active) ? out.active : []
          }
          const table = {
            'row.stats': async () => {
              const row = resolveRow(orgs, arg)
              const exists = existsSync(row.path)
              // git figures through the sidebar's own git-workspace import (allowFail: empty repo = zeros, never a throw)
              const gw = typeof sb.importGitWorkspace === 'function' ? await sb.importGitWorkspace().catch(() => null) : null
              if (!exists || !gw || typeof gw.runGit !== 'function') return { ...row, exists, ...timesOf(row.path, null), activity: { reason: 'unavailable' }, repository: { reason: 'unavailable' } }
              const run = (args, cwd) => gw.runGit(args, { cwd, env: process.env, allowFail: true, timeout: 8000 })
              const repos = reposFor(row)
              const since = sinceFor(arg?.range)
              const activity = activityOf(run, repos, { since })
              const repository = repositoryOf(run, repos, { since })
              return { ...row, exists, ...timesOf(row.path, repository.lastCommit && repository.lastCommit.at), activity, repository }
            },
            'row.sessions': async () => {
              const row = resolveRow(orgs, arg)
              const all = await sessionsOf(row)
              if (all === null) return { reason: 'unavailable', rows: [] }
              const env = dshEnv()
              const rows = scopeSessions(all, row).map((s) => shapeSession(s, metricsFor(env)))
              rows.sort((a, b) => (Date.parse(b.updatedAt || b.createdAt || '') || 0) - (Date.parse(a.updatedAt || a.createdAt || '') || 0))
              return { rows }
            },
            'row.delivery': async () => {
              const row = resolveRow(orgs, arg)
              if (!existsSync(row.path)) return { reason: 'unavailable' }
              const gw = typeof sb.importGitWorkspace === 'function' ? await sb.importGitWorkspace().catch(() => null) : null
              const g = typeof sb.getGithub === 'function' ? await sb.getGithub().catch(() => null) : null
              if (typeof sb.mainChecksFor !== 'function') return { reason: 'unavailable' }
              return deliveryOf({
                g, gw, mainChecksFor: sb.mainChecksFor, readManifest: readJson,
                repos: reposFor(row), fresh: arg?.fresh === true,
              })
            },
            'row.engine': async () => {
              const row = resolveRow(orgs, arg)
              if (!existsSync(row.path)) return { reason: 'not-set-up', projects: [], scanned: 0 }
              return engineFor({ readJson, row, repos: reposFor(row) })
            },
            'session.focus': async () => {
              // The id is proven to live in THIS org's registry before anything is
              // written, and the path comes from the org registry — never the browser.
              const row = resolveRow(orgs, { orgId: arg?.orgId, rowId: '' })
              const sessionId = typeof arg?.sessionId === 'string' ? arg.sessionId : ''
              const all = await sessionsOf(row)
              const s = (all || []).find((x) => x && x.id === sessionId)
              if (!s) throw new Error('session-not-found')
              const gw = typeof sb.importGitWorkspace === 'function' ? await sb.importGitWorkspace().catch(() => null) : null
              if (!gw || typeof gw.annotateSession !== 'function') return { reason: 'unavailable' }
              const focusMs = focusTotal(s.focusMs, arg?.deltaMs)
              // git-workspace owns the registry write (read-modify-write of the whole
              // file, D98 repo discovery from the org path). It also stamps updatedAt:
              // watching a session IS session activity, so the rendered age stays honest.
              gw.annotateSession(row.orgPath, sessionId, { focusMs })
              return { id: sessionId, focusMs }
            },
            'session.summary': async () => {
              const row = resolveRow(orgs, { orgId: arg?.orgId, rowId: '' })
              const sessionId = typeof arg?.sessionId === 'string' ? arg.sessionId : ''
              const all = await sessionsOf(row)
              const s = (all || []).find((x) => x && x.id === sessionId)
              if (!s) throw new Error('session-not-found')
              const base = shapeSession(s, () => null)
              if (!base.dshSessionId) return { ...base, reason: 'no-conversation' }
              const env = dshEnv()
              let v = null
              try { v = readValues(env, base.dshSessionId) } catch { v = null }
              if (!v) return { ...base, reason: 'no-projection' }
              // Activity = what the tools did (dsh surface events). Optional face;
              // without it the summary still carries goal/todos/turns.
              let activity = null
              try {
                const q = face('sessionQuery')
                if (q && typeof q.readSurface === 'function') {
                  const surface = await q.readSurface(base.dshSessionId)
                  activity = activityFromEvents(surface && surface.events)
                }
              } catch { activity = null }
              return { ...base, ...metricsFromValues(v.values), createdAt: base.createdAt ?? (v.createdAt ? new Date(v.createdAt).toISOString() : null), summary: summaryFromValues(v.values), activity }
            },
          }
          const fn = table[action]
          if (!fn) return json(res, { ok: false, error: 'unknown-action', action })
          const out = await fn()
          json(res, { ok: true, action, result: out })
        } catch (e) {
          json(res, { ok: false, error: String(e?.message ?? e), action })
        }
      })
    },
  })
}
