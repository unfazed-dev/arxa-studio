/**
 * Org lifecycle service (Phase A of docs/plans/file-org-shell-integration.md).
 *
 * Composes the six proven file-organisation libraries into the shell's org
 * lifecycle. This file owns ORDER and TEARDOWN only — every capability
 * (scaffold, stamp/migrate, index, git, mirror, rail) stays in its library.
 *
 * openOrg order (plan-mandated, one unwind stack):
 *   1. shell lock        — per-org process lock at <org>/.arxa/locks (D69)
 *   2. stamp/migrate     — workspace openOrg: crash recovery → stamp check
 *                          (StampRefusalError when newer) → forward-only
 *                          migration; the library serializes rewind with its
 *                          own .git lock underneath
 *   3. index             — workspace-index backend at <org>/.arxa/index.db,
 *                          rebuild-if-missing
 *   4. git attach        — initOrgRepo (idempotent), requires git: fail loud
 *   5. sessions ready    — registry readable, archived ids derivable
 *   6. optional rails    — account-mirror / cairn-rail ONLY if configured;
 *                          absence is a normal state, not an error
 *
 * Any step failing tears down, in reverse, exactly what earlier steps
 * acquired (no leaked locks or backends) and rethrows as OrgOpenError with
 * the failing step named. Close/switch run the same teardown for a healthy
 * handle. No step spawns a process or watcher; after closeOrg nothing
 * remains that could express a path inside (or outside) the org.
 *
 * Ownership boundary (CLAUDE.md): everything here is local-first. The
 * account-mirror rail defaults to ABSENT and only attaches when the caller
 * provides a provider; no feature below requires any remote database.
 */

import fs from 'node:fs'
import path from 'node:path'

import {
  scanWorkspace,
  scaffoldOrg,
  scaffoldOrgInRoot,
  scaffoldProject,
  openOrg as workspaceOpenOrg,
  validateWorkspaceRoot,
  listTrash,
  restoreFromTrash,
  renameInManifest,
  orgManifestPath,
  touchRecent,
  CATEGORIES,
} from '../../workspace/lib/index.js'
import {
  openBackend,
  rebuild,
  INDEX_DIR,
  INDEX_FILE,
} from '../../workspace-index/lib/index.js'
import {
  ensureGit,
  isRepo,
  initOrgRepo,
  listSessions,
  archivedSessionIds,
  openSession,
  annotateSession,
  reviveSession,
  archiveSession as archiveSessionBranch,
  sessionStageBoundary,
} from '../../git-workspace/lib/index.js'
import { runGit } from '../../git-workspace/lib/index.js'
import { refreshAccountMirror, ensureAccountExcluded } from '../../account-mirror/lib/index.js'
import { claimMaterializer, materialize, readEdits } from '../../cairn-rail/lib/index.js'

import { OrgOpenError, OrgAlreadyOpenError, OrgNotOpenError } from './errors.js'
import { acquireShellLock } from './shell-lock.js'
import { createDshBridge, joinDshLive } from './dsh-bridge.js'

/** Step names carried by OrgOpenError.step, in execution order. */
export const STEPS = Object.freeze([
  'shell-lock',
  'stamp-migrate',
  'index',
  'git-attach',
  'sessions',
  'account-mirror',
  'cairn-rail',
])

function orgSlugOf(orgPath) {
  return path.basename(path.resolve(orgPath))
}

/**
 * Add `/.arxa/` to the org repo's `.git/info/exclude` — the same choke
 * point git-workspace sessions.js uses (it only installs the exclusion on
 * first SESSION open) and account-mirror uses for `/account/`. Without
 * this, org-level runtime state (`<org>/.arxa/facts/` — rail claims and
 * applied-ids) is untracked-and-unignored on a fresh repo, so workspace's
 * crash recovery would stash live facts as migration debris. Installing it
 * at attach time, before any rail runs, closes that window shell-side
 * without touching the libraries.
 */
function ensureRuntimeExcluded(orgPath, env) {
  const commonDir = runGit(['rev-parse', '--git-common-dir'], { cwd: orgPath, env, allowFail: true })
  if (!commonDir) return false
  const resolved = path.isAbsolute(commonDir) ? commonDir : path.join(orgPath, commonDir)
  const excludeFile = path.join(resolved, 'info', 'exclude')
  const line = '/.arxa/'
  const current = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : ''
  if (current.split('\n').includes(line)) return true
  fs.mkdirSync(path.dirname(excludeFile), { recursive: true })
  const sep = current === '' || current.endsWith('\n') ? '' : '\n'
  fs.writeFileSync(excludeFile, current + sep + line + '\n')
  return true
}

/**
 * Create the org lifecycle service for one workspace root.
 *
 * Boot is DISCOVERY ONLY: constructing the service never opens an org
 * (plan: "no org auto-opened"). Rails config is per-service:
 *   rails.account.provider  — object with fetchArtifacts(); absent = no mirror
 *   rails.cairn.deviceId    — this device's materializer id; absent = no rail
 *
 * @param {{ workspaceRoot: string, env?: NodeJS.ProcessEnv, rails?: object }} opts
 */
export function createOrgLifecycle({ workspaceRoot, env = process.env, rails = {}, dsh } = {}) {
  if (typeof workspaceRoot !== 'string' || workspaceRoot === '') {
    throw new TypeError('createOrgLifecycle: workspaceRoot (string) is required')
  }
  validateWorkspaceRoot(workspaceRoot)
  const root = path.resolve(workspaceRoot)
  // dsh bridge (Phase D, D71): injectable faces (spawn/attach/list/archive);
  // absent or partial faces degrade to the loud no-op 'dsh-unavailable' stub.
  const dshBridge = createDshBridge(dsh)
  // Last-known dsh live list, refreshed whenever the lifecycle touches dsh.
  // The rows faces stay SYNCHRONOUS (presentation joins must not open an
  // async cycle) and join against this cache; a never-refreshed cache
  // degrades to plain registry rows.
  let dshLive = []

  /** @type {null | object} the single open-org handle */
  let current = null

  /**
   * Keep the index orgs row's denormalised name in step with a manifest
   * rename. Reuses the open org's backend when the renamed org is open;
   * otherwise opens a short-lived backend. The index is a derived cache —
   * a failed sync degrades to a stale name, so it must never fail the
   * rename itself.
   */
  function indexRenameOrg(rootDir, orgPath, displayName) {
    const slug = path.basename(orgPath)
    const rowId = `${slug}/org.json`
    try {
      const owns = !(current && current.path === path.resolve(orgPath))
      // Per-org index (D69): the backend lives at <org>/.arxa/index.db.
      const backend = owns ? openBackend(rootDir) : current.index.backend
      try {
        // Parsed rows key on the org uuid; the row id rides in .path
        // ('org.json' in the per-org index, '<slug>/org.json' in the
        // legacy root index) — keep the row's own id on the update.
        const hit = backend.query('orgs').find((o) => o.path === rowId || o.slug === slug)
        if (hit) backend.put('orgs', hit.path ?? rowId, { ...hit, name: displayName })
      } finally {
        if (owns) backend.close()
      }
    } catch {
      /* derived cache — a stale name heals on the next rebuild */
    }
  }

  function listOrgs() {
    // workspace scanWorkspace returns Maps keyed by id; expose plain rows.
    return [...scanWorkspace(root).orgs.values()]
  }

  function createOrg(displayName) {
    // D69: org-create scaffolds IN PLACE into the picked folder. A service
    // bound to a folder that is itself an org has no create verb; a service
    // bound to a parent root (legacy shape) creates <root>/<slug>/ and
    // scaffolds inside it.
    if (fs.existsSync(orgManifestPath(root))) {
      throw new Error('org-create is in-place since D69: scaffold into the picked folder directly (scaffoldOrg)')
    }
    const created = scaffoldOrgInRoot(root, displayName)
    try {
      touchRecent(created.path, env)
    } catch {
      /* recents are advisory */
    }
    return created
  }

  async function openOrg(orgPath) {
    if (current) throw new OrgAlreadyOpenError(current.path, orgPath)
    const resolved = path.resolve(orgPath)
    const slug = orgSlugOf(resolved)

    // Reverse-unwind stack: every acquired resource pushes its release;
    // failure pops and runs them newest-first, then rethrows typed.
    const undo = []
    let step = STEPS[0]
    try {
      // 1. shell lock — real from the very first step, repo or not. Per-org
      //    state home: <org>/.arxa (D69) — lock, index, trash, rail all live
      //    inside the opened org folder now.
      step = 'shell-lock'
      const releaseLock = acquireShellLock(resolved, resolved)
      undo.push(releaseLock)

      // 2. crash recovery → stamp check → forward-only migration.
      step = 'stamp-migrate'
      const opened = workspaceOpenOrg(resolved, { env })

      // 3. index open, rebuild-if-missing (derived cache: rebuild is the
      //    whole recovery story — no migrations, no reconciliation).
      step = 'index'
      const indexWasMissing = !fs.existsSync(path.join(resolved, INDEX_DIR, INDEX_FILE))
      const backend = openBackend(resolved) // <org>/.arxa/index.db
      undo.push(() => backend.close())
      let counts = null
      if (indexWasMissing || !backend.query('orgs').some((o) => o.slug === slug)) {
        counts = rebuild(resolved, backend).counts
      }

      // 4. git repo attach — mandatory; no repo means no sessions and no
      //    rewind safety, so a missing git binary fails the open loudly.
      step = 'git-attach'
      ensureGit(env)
      const repo = initOrgRepo(resolved, env)
      ensureRuntimeExcluded(resolved, env) // /.arxa/ runtime state never enters git
      ensureAccountExcluded(resolved, env) // belt-and-braces /account/ (D37)

      // 5. session lifecycle ready — registry readable, archived derivable.
      step = 'sessions'
      const sessions = listSessions(resolved, env)
      const archived = archivedSessionIds(resolved, env)

      // 6. optional rails — attach ONLY if configured; absence is normal.
      step = 'account-mirror'
      let mirror = { attached: false, reason: 'not-configured' }
      if (rails.account?.provider) {
        const refreshed = await refreshAccountMirror(resolved, rails.account.provider, env)
        mirror = { attached: true, ...refreshed }
      }
      step = 'cairn-rail'
      let cairn = { attached: false, reason: 'not-configured' }
      if (rails.cairn?.deviceId) {
        claimMaterializer(resolved, slug, rails.cairn.deviceId)
        const applied = materialize(resolved, slug, rails.cairn.deviceId)
        cairn = { attached: true, deviceId: rails.cairn.deviceId, applied, edits: readEdits(resolved, slug).length }
      }

      // Recents (D69): a successful open records the org folder, the
      // recents list being the org-discovery surface that replaced the
      // workspace-root tree. Best-effort: a persistence failure must not
      // fail an otherwise healthy open.
      try {
        touchRecent(resolved, env)
      } catch {
        /* recents are advisory */
      }

      current = {
        path: resolved,
        slug,
        manifest: opened.manifest,
        orgVersion: opened.orgVersion,
        migrated: opened.migrated,
        repoInitialised: repo.initialised,
        sessions,
        archivedSessionIds: archived,
        index: { backend, rebuilt: counts !== null, counts },
        rails: { account: mirror, cairn },
        // ---- contract faces (Phase B, docs/plans/file-org-shell-integration.md):
        // the sidebar consumes projects / parked sessions / trash and the
        // project/session/trash verbs THROUGH the open org handle, so
        // teardown on switch/close stays this lifecycle's job. Each face
        // reads fresh state; the static `sessions` snapshot above is the
        // open-time record and stays for diagnostics.
        projects() {
          // Org-local scan: the open org folder is itself scannable (D69
          // in-place layout — root-self org detection in resolve.js).
          return [...scanWorkspace(resolved).projects.values()]
            .filter((p) => p.orgId === opened.manifest.id)
            .map(({ id, name, slug: projectSlug, path: projectPath }) => (
              { id, name, slug: projectSlug, path: projectPath }
            ))
        },
        parkedSessions() {
          // Sessions carry an optional project scope: slug for project
          // sessions, null for org-level. Legacy registry entries predate
          // the field and read as null — no migration needed.
          return joinDshLive(
            listSessions(resolved, env)
              .filter((s) => s.state !== 'open')
              .map((s) => ({ id: s.id, name: s.name, state: s.state, parkedReason: s.parkedReason, project: s.project ?? null, dshSessionId: s.dshSessionId ?? null })),
            dshLive,
          )
        },
        activeSessions() {
          // Rows face (sidebar rethink): every registry session that still
          // participates in the active views — open AND parked — with
          // archived ones held back per the D39 archivedSessionIds contract.
          // Named around the static open-time `sessions` snapshot above,
          // which stays for diagnostics.
          return joinDshLive(
            listSessions(resolved, env)
              .filter((s) => s.state !== 'archived')
              .map((s) => ({ id: s.id, name: s.name, state: s.state, parkedReason: s.parkedReason, project: s.project ?? null, dshSessionId: s.dshSessionId ?? null })),
            dshLive,
          )
        },
        trashCount() {
          return listTrash(resolved).length // org-local trash: <org>/.arxa/trash
        },
        newProject(displayName) {
          return scaffoldProject(resolved, displayName)
        },
        async newSession(name, project) {
          // Sessions carry an optional project scope (annotation in the
          // registry): accept project id or slug, store the slug (stable
          // across renames). Unknown project is a loud error, never a
          // silently org-level session.
          let projectSlug = null
          if (project != null) {
            const hit = [...scanWorkspace(resolved).projects.values()]
              .find((p) => p.orgId === opened.manifest.id && (p.slug === project || p.id === project))
            if (!hit) throw new Error(`unknown-project: ${project}`)
            projectSlug = hit.slug
          }
          const session = openSession(resolved, { name, project: projectSlug, env })
          // Phase D (D71): AFTER branch+worktree exist, spawn the dsh session
          // with cwd = the worktree path (dsh sessions.create cwd contract)
          // and store its id on the registry row. Unavailable dsh degrades to
          // registry-only with a loud annotation — never a hard failure.
          const spawned = await dshBridge.spawn({ cwd: session.worktree, name: session.name })
          dshLive = await dshBridge.list()
          return annotateSession(
            resolved,
            session.id,
            spawned.ok
              ? { dshSessionId: spawned.id, dshStatus: null }
              : { dshSessionId: null, dshStatus: spawned.reason ?? 'dsh-unavailable' },
            env,
          )
        },
        async resumeSession(id) {
          const row = listSessions(resolved, env).find((s) => s.id === id)
          const out = reviveSession(resolved, id, env)
          // Re-attach the dsh conversation (focus/open by dshSessionId) when
          // the row carries one. Best-effort: dsh absence never blocks git
          // revival.
          if (row?.dshSessionId) await dshBridge.attach(row.dshSessionId)
          dshLive = await dshBridge.list()
          return out
        },
        async archiveSession(id) {
          // D39/D40 archive: flag out of active views, WIP-commit, prune the
          // worktree, keep the branch. The rows face then holds it back.
          const row = listSessions(resolved, env).find((s) => s.id === id)
          const out = archiveSessionBranch(resolved, id, env)
          // Feed dsh's archivedSessionIds set (D39 contract): the archived
          // session vanishes from dsh active views; its transcript persists
          // dsh-side. Best-effort.
          if (row?.dshSessionId) await dshBridge.archive([row.dshSessionId])
          dshLive = await dshBridge.list()
          return out
        },
        mergeSession(id, message) {
          reviveSession(resolved, id, env) // boundary requires an open session
          return sessionStageBoundary(resolved, id, { message, env })
        },
        restoreTrash(entryId, opts = {}) {
          // No entry id → restore EVERYTHING in the trash: the sidebar has
          // one "Restore from trash" CTA, not per-entry rows. Each entry is
          // independent — one conflict (occupied destination, history
          // boundary) must not block the rest. An explicit entryId restores
          // just that one and returns the single-entry result.
          if (entryId == null) {
            const restored = []
            const failed = []
            for (const entry of listTrash(resolved)) {
              try {
                const r = restoreFromTrash(resolved, entry.entryId, { env, ...opts })
                restored.push({ entryId: entry.entryId, restoredPath: r.restoredPath })
              } catch (e) {
                failed.push({ entryId: entry.entryId, error: String(e?.message ?? e) })
              }
            }
            return { restored, failed }
          }
          return restoreFromTrash(resolved, entryId, { env, ...opts })
        },
        _undo: undo,
      }
      return current
    } catch (err) {
      for (const release of undo.reverse()) {
        try {
          release()
        } catch {
          // teardown is best-effort; the original error is the one that matters
        }
      }
      throw err instanceof OrgAlreadyOpenError ? err : new OrgOpenError(resolved, step, err)
    }
  }

  function closeOrg() {
    if (!current) throw new OrgNotOpenError()
    const closing = current
    current = null // handle is dead even if a release below throws
    let firstErr = null
    for (const release of [...closing._undo].reverse()) {
      try {
        release()
      } catch (err) {
        firstErr ??= err
      }
    }
    if (firstErr) throw firstErr
    return { path: closing.path, slug: closing.slug }
  }

  async function switchOrg(orgPath) {
    const resolved = path.resolve(orgPath)
    if (current && current.path === resolved) return current
    if (current) closeOrg() // full reverse teardown BEFORE the next open
    return openOrg(resolved)
  }

  /**
   * Rename an org: display-name-only (D41). The slug/folder on disk never
   * moves — registry paths, worktrees and the index all key on it — so a
   * rewrite of org.json's `name` is the whole operation. When the renamed
   * org is the open one, refresh the handle's cached manifest in place so
   * served state shows the new name without a reopen cycle.
   */
  function renameOrg(orgPath, displayName) {
    if (typeof displayName !== 'string' || displayName.trim() === '') {
      throw new TypeError('renameOrg: displayName must be a non-empty string')
    }
    const resolved = path.resolve(orgPath)
    const manifestFile = orgManifestPath(resolved)
    if (!fs.existsSync(manifestFile)) {
      throw new Error('unknown-org: ' + resolved)
    }
    const manifest = renameInManifest(manifestFile, displayName)
    if (current && current.path === resolved) current.manifest = manifest
    // Index rows carry a denormalised name; without this the index kept the
    // pre-rename name forever (measured: SUPO→MIRA left name "SUPO" in
    // index.db while org.json said MIRA — listOrgs reads the manifest, but
    // every index consumer saw the stale name until a full rebuild).
    indexRenameOrg(resolved, resolved, displayName) // per-org index (D69)
    return { path: resolved, slug: path.basename(resolved), manifest }
  }

  /**
   * Read-only org tree for sidebar surfaces: the five fixed categories
   * (D42) with on-disk presence, the org's projects, and a per-project
   * session count off the registry. Reads never take the shell lock —
   * listing is presentation, not lifecycle (same contract as listOrgs).
   * Sessions are omitted entirely when the org has no repo yet.
   */
  function orgTree(orgPath) {
    const resolved = path.resolve(orgPath)
    const { orgs, projects } = scanWorkspace(root)
    const org = [...orgs.values()].find((o) => o.path === resolved)
    if (!org) throw new Error('unknown-org: ' + resolved)
    const categories = CATEGORIES.map((slug) => ({
      slug,
      exists: fs.existsSync(path.join(resolved, slug)),
    }))
    const orgProjects = [...projects.values()]
      .filter((p) => p.orgId === org.id)
      .map(({ id, name, slug, path: projectPath }) => ({ id, name, slug, path: projectPath }))
    let sessionsByProject = null
    let orgSessionCount = 0
    try {
      const rows = listSessions(resolved, env)
      sessionsByProject = {}
      for (const s of rows) {
        if (s.state === 'archived') continue // D39: archived never surfaces
        if (s.project) sessionsByProject[s.project] = (sessionsByProject[s.project] ?? 0) + 1
        else orgSessionCount += 1
      }
    } catch {
      sessionsByProject = null // no repo / unreadable registry — counts stay hidden
    }
    return { categories, projects: orgProjects, sessionsByProject, orgSessionCount }
  }

  return {
    workspaceRoot: root,
    listOrgs,
    orgTree,
    createOrg,
    openOrg,
    closeOrg,
    switchOrg,
    renameOrg,
    /** The open org handle, or null. */
    get current() {
      return current
    },
    /** True when `orgPath` is attached as a git repo (diagnostic). */
    isOrgRepo(orgPath) {
      return isRepo(path.resolve(orgPath), env)
    },
    /** Belt-and-braces exclusion for account/ (used by configured mirrors). */
    ensureAccountExcluded,
  }
}
