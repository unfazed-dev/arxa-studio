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
  readManifest,
  writeManifest,
  orgManifestPath,
  projectManifestPath,
  slugify,
  touchRecent,
  readRecents,
  removeRecent,
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
  hasHead,
  initOrgRepo,
  initProjectRepo,
  setOrigin,
  spawnSnapshotOrgRepo,
  snapshotWorkerLive,
  listSessions,
  archivedSessionIds,
  openSession,
  annotateSession,
  nextSessionName,
  reviveSession,
  archiveSession as archiveSessionBranch,
  sessionStageBoundary,
  rekeySessionsProject,
} from '../../git-workspace/lib/index.js'
import { runGit } from '../../git-workspace/lib/index.js'
import { getTemplate, TEMPLATE_VERSION } from '../../workspace/lib/template.js'
import { refreshAccountMirror, ensureAccountExcluded } from '../../account-mirror/lib/index.js'
import { claimMaterializer, materialize, readEdits } from '../../cairn-rail/lib/index.js'

import { OrgOpenError, OrgAlreadyOpenError, OrgNotOpenError } from './errors.js'
import { acquireShellLock } from './shell-lock.js'
import { createDshBridge, joinDshLive } from './dsh-bridge.js'
import { createGithubBridge, annotateProjectManifest } from './github-bridge.js'

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
export function createOrgLifecycle({ workspaceRoot, env = process.env, rails = {}, dsh, github } = {}) {
  if (typeof workspaceRoot !== 'string' || workspaceRoot === '') {
    throw new TypeError('createOrgLifecycle: workspaceRoot (string) is required')
  }
  validateWorkspaceRoot(workspaceRoot)
  const root = path.resolve(workspaceRoot)
  // dsh bridge (Phase D, D71): injectable faces (spawn/attach/list/archive);
  // absent or partial faces degrade to the loud no-op 'dsh-unavailable' stub.
  const dshBridge = createDshBridge(dsh)
  // github bridge (W3b, D69 publish half): injectable status/createPrivateRepo
  // faces; absent faces degrade to the loud 'github-unavailable' stub —
  // publishing never blocks or fails local project creation (CLAUDE.md
  // boundary: local-first, no cloud dependency for core function).
  const githubBridge = createGithubBridge(github)
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
    // Recents IS the org registry (org-model-v2 Phase A: "sidebar serves
    // recents for the org switcher"). The old single-root scan listed only
    // the most-recent org folder and its children — creating a second org
    // anywhere made the first vanish from the switcher (seen live
    // 2026-08-30: RESTO hid TOPO). A recents row is a pointer, not a
    // promise: dead paths and manifest-less folders skip silently.
    const out = []
    for (const p of readRecents(env)) {
      try {
        const manifest = readManifest(orgManifestPath(p))
        out.push({ id: manifest.id, name: manifest.name, slug: path.basename(p), path: p, manifest })
      } catch {
        /* dead pointer — not an org today */
      }
    }
    return out
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

  async function openOrg(orgPath, opts = {}) {
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
      //    The INITIAL SNAPSHOT may be deferred (opts.deferSnapshot — the
      //    create-org request path): the initial 'add -A' is unbounded on
      //    a D69 in-place root that already holds bulk content, and running
      //    it inline froze the whole app for the length of the hashing
      //    (2025-08 create-org hang). Deferred or interrupted snapshots
      //    run DETACHED instead; hasHead() stays the session gate, and
      //    every open re-vouches for (or respawns) a pending snapshot.
      step = 'git-attach'
      ensureGit(env)
      const existingUnborn = isRepo(resolved, env) && !hasHead(resolved, env)
      const repo = initOrgRepo(resolved, env, {
        deferSnapshot: opts.deferSnapshot === true || existingUnborn,
        // Create-time contract (2025-08): false = version arxa-managed org
        // files only; pre-existing content in the picked folder stays
        // untracked. Default true = the D37 everything-but-projects/account.
        includeExisting: opts.includeExisting !== false,
        managedDirs: opts.managedDirs ?? CATEGORIES,
      })
      ensureRuntimeExcluded(resolved, env) // /.arxa/ runtime state never enters git
      ensureAccountExcluded(resolved, env) // belt-and-braces /account/ (D37)
      const snapshotPending = repo.deferred === true || !hasHead(resolved, env)
      if (snapshotPending && !snapshotWorkerLive(resolved, env)) spawnSnapshotOrgRepo(resolved, env)

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
        /** Initial-snapshot face (2025-08 create-org hang): true until the
        * detached first git snapshot lands HEAD. The rows client disables
        * session creation and says why while this is true. */
        snapshotPending() {
          return !hasHead(resolved, env)
        },
        /**
         * W3b (D69 publish half): scaffold the local project, THEN — only
         * when github faces are injected AND linked — create the private
         * repo, wire it as the project repo's origin, and annotate the
         * manifest with repoOwner/repoName/repoPrivate/repoUrl. ANY failure
         * is a loud manifest annotation (githubStatus), NEVER a throw: the
         * local project always exists either way (CLAUDE.md local-first).
         */
        async newProject(displayName) {
          // Auto-name (grilled 2026-08-30): project-001, project-002… when
          // the caller leaves the name blank — per-dock counter, no ids.
          let name = typeof displayName === 'string' ? displayName.trim() : ''
          if (name === '') {
            const slugs = [...scanWorkspace(resolved).projects.values()]
              .filter((p) => p.orgId === opened.manifest.id)
              .map((p) => p.slug)
            let max = 0
            for (const s of slugs) {
              const m = /^project-(\d+)$/.exec(s)
              if (m) max = Math.max(max, Number(m[1]))
            }
            name = 'project-' + String(max + 1).padStart(3, '0')
          }
          const created = scaffoldProject(resolved, name)
          try {
            initProjectRepo(created.path, env) // idempotent repo attach
            const st = await githubBridge.status()
            if (st.ok && st.linked) {
              const made = await githubBridge.createPrivateRepo(created.slug)
              if (!made.ok) throw new Error(made.reason ?? 'github-unavailable')
              setOrigin(created.path, made.repo.repoUrl, env)
              created.manifest = annotateProjectManifest(created.path, made.repo)
            } else {
              annotateProjectManifest(created.path, {
                githubStatus: st.ok ? 'not-linked' : (st.reason ?? 'github-unavailable'),
              })
            }
          } catch (err) {
            annotateProjectManifest(created.path, {
              githubStatus: 'publish-failed: ' + String(err?.message ?? err),
            })
          }
          return created
        },
        async newSession(name, workspace) {
          // Sessions branch from HEAD; until the initial snapshot lands
          // there is nothing to branch from. Loud, human, and the rows
          // client normally prevents reaching this at all (CTA disabled).
          if (!hasHead(resolved, env)) throw new Error('initial-snapshot-pending: the first git snapshot of this organisation is still running — sessions unlock the moment it completes')
          // Workspace-born sessions (grilled 2026-08-30): a session lives
          // in a WORKSPACE row — a fixed dock container ('notes',
          // 'meetings/scheduler', …) or a project container
          // ('projects/<slug>/design'). Org-level sessions are gone: the
          // legacy + path that created them was removed with the org-row
          // affordance. Unknown workspace is loud, never a fallback.
          const ws = typeof workspace === 'string' && workspace !== '' ? workspace : null
          if (!ws) throw new Error('workspace-required: sessions are born in a workspace row (a dock container or a project container), never at org level')
          const template = getTemplate(TEMPLATE_VERSION)
          let projectSlug = null
          const projectScope = /^projects\/([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*)$/.exec(ws)
          if (projectScope) {
            const hit = [...scanWorkspace(resolved).projects.values()]
              .find((p) => p.orgId === opened.manifest.id && p.slug === projectScope[1])
            if (!hit || !template.projectContainers.includes(projectScope[2])) {
              throw new Error('unknown-workspace: ' + ws)
            }
            projectSlug = hit.slug
          } else if (!template.fixedWorkspaces.includes(ws)) {
            throw new Error('unknown-workspace: ' + ws)
          }
          // Auto-name (grilled 2026-08-30): singular(folder)+counter, no
          // ids — the branch/worktree keep the session id as stable key.
          const title = typeof name === 'string' && name.trim() !== ''
            ? name.trim()
            : nextSessionName(listSessions(resolved, env), ws)
          const session = openSession(resolved, { name: title, project: projectSlug, workspace: ws, env })
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
        /** Rename (grilled 2026-08-30): the registry name is the single
        * display truth — every arxa surface reads it. Git never moves:
        * branch + worktree stay keyed by the session id. */
        async renameSession(id, name) {
          const title = typeof name === 'string' ? name.trim() : ''
          if (title === '') throw new Error('name-required: a session name cannot be empty')
          if (listSessions(resolved, env).every((s) => s.id !== id)) throw new Error('unknown-session: ' + id)
          return annotateSession(resolved, id, { name: title }, env)
        },
        async resumeSession(id) {
          // Sessions branch from HEAD; until the initial snapshot lands
          // there is nothing to branch from. Loud, human, and the rows
          // client normally prevents reaching this at all (CTA disabled).
          if (!hasHead(resolved, env)) throw new Error('initial-snapshot-pending: the first git snapshot of this organisation is still running — sessions unlock the moment it completes')
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
          // Sessions branch from HEAD; until the initial snapshot lands
          // there is nothing to branch from. Loud, human, and the rows
          // client normally prevents reaching this at all (CTA disabled).
          if (!hasHead(resolved, env)) throw new Error('initial-snapshot-pending: the first git snapshot of this organisation is still running — sessions unlock the moment it completes')
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
   * Rename an org (D72 proper rename — supersedes D41's slug-stability
   * clause): display name + folder + remote move as ONE all-or-nothing
   * operation. The slug is derived from the new display name; the folder
   * moves via fs.renameSync (same-volume parent-sibling assumption —
   * documented; a cross-volume move is out of scope). The org repo's .git,
   * the session registry (git-common-dir/arxa/), and the session worktrees
   * (<org>/.arxa/worktrees) all move WITH the folder; worktrees register
   * absolute paths, so `git worktree repair` re-points them best-effort
   * after the move (`worktree prune` is FORBIDDEN — D40: never deletes).
   *
   * A same-slug rename degrades to the D41 display-name-only write. When
   * the renamed org is the CURRENT open handle it is re-opened on the new
   * path (switchOrg semantics). ROLLBACK: any step after the mv renames
   * the folder back, restores the manifest name, and rethrows.
   */
  async function renameOrg(orgPath, displayName) {
    if (typeof displayName !== 'string' || displayName.trim() === '') {
      throw new TypeError('renameOrg: displayName must be a non-empty string')
    }
    const oldPath = path.resolve(orgPath)
    const manifestFile = orgManifestPath(oldPath)
    if (!fs.existsSync(manifestFile)) {
      throw new Error('unknown-org: ' + oldPath)
    }
    const oldSlug = path.basename(oldPath)
    const oldName = readManifest(manifestFile).name // for rollback
    const newSlug = slugify(displayName)
    const newPath = path.join(path.dirname(oldPath), newSlug)
    const manifest = renameInManifest(manifestFile, displayName)

    if (newSlug === oldSlug) {
      // display-name-only (D72 rider): no folder move, no rekey.
      if (current && current.path === oldPath) current.manifest = manifest
      indexRenameOrg(oldPath, oldPath, displayName) // per-org index (D69)
      return { path: oldPath, slug: oldSlug, manifest, moved: false }
    }
    if (fs.existsSync(newPath)) {
      throw new Error('renameOrg: destination already exists: ' + newPath)
    }

    fs.renameSync(oldPath, newPath)
    try {
      // Worktrees register ABSOLUTE paths; after the folder move each one
      // needs an explicit repair (bare 'worktree repair' fatals on the
      // first stale gitdir). Best-effort; prune is FORBIDDEN (D40).
      try {
        const wtRoot = path.join(newPath, '.arxa', 'worktrees')
        for (const entry of fs.existsSync(wtRoot) ? fs.readdirSync(wtRoot) : []) {
          runGit(['worktree', 'repair', path.join(wtRoot, entry)], { cwd: newPath, env, allowFail: true })
        }
      } catch {
        /* repair is best-effort; nothing is ever pruned (D40) */
      }
      try {
        removeRecent(oldPath, env) // recents: drop old path …
      } catch { /* recents are advisory */ }
      try {
        touchRecent(newPath, env) // … and record the new one
      } catch { /* recents are advisory */ }
      indexRenameOrg(newPath, newPath, displayName)
      if (current && current.path === oldPath) {
        closeOrg() // reverse teardown on the moved handle …
        try {
          // … the old-slug lock file moved with the folder; release pointed
          // at the pre-move path, so sweep it (idempotent).
          fs.rmSync(path.join(newPath, '.arxa', 'locks', oldSlug + '.lock'), { force: true })
        } catch { /* best-effort */ }
        await openOrg(newPath) // … and re-open on the new path
      }
      return { path: newPath, slug: newSlug, manifest, moved: true }
    } catch (err) {
      // All-or-nothing (D72): put the folder AND the manifest back, then
      // re-open the handle at the old path (best-effort — the org was open
      // when the rename started) before surfacing the failure.
      fs.renameSync(newPath, oldPath)
      try {
        renameInManifest(orgManifestPath(oldPath), oldName)
      } catch { /* best-effort under the rethrow */ }
      try {
        fs.rmSync(path.join(oldPath, '.arxa', 'locks', newSlug + '.lock'), { force: true })
      } catch { /* best-effort */ }
      if (!current) {
        try {
          await openOrg(oldPath)
        } catch { /* the original error is the one that matters */ }
      }
      throw err
    }
  }

  /**
   * Rename a project (D72): folder + manifest name + slug as one
   * all-or-nothing move. The session registry's project field is rekeyed
   * oldSlug → newSlug (slugs are the stable scope the registry stores).
   * When the manifest carries a repoUrl, `repoRenamePending` is recorded —
   * the GitHub repo-name PATCH rides the production client id later
   * (recorded, never faked); the LOCAL origin URL is rewritten best-effort
   * ONLY when github faces report linked. Rollback: any step after the mv
   * renames the folder back and rethrows.
   */
  async function renameProject(orgPath, oldSlug, newName) {
    if (typeof newName !== 'string' || newName.trim() === '') {
      throw new TypeError('renameProject: newName must be a non-empty string')
    }
    if (typeof oldSlug !== 'string' || oldSlug.trim() === '') {
      throw new TypeError('renameProject: oldSlug must be a non-empty string')
    }
    const org = path.resolve(orgPath)
    if (!fs.existsSync(orgManifestPath(org))) throw new Error('unknown-org: ' + org)
    const oldPath = path.join(org, 'projects', oldSlug)
    const manifestFile = projectManifestPath(oldPath)
    if (!fs.existsSync(manifestFile)) throw new Error('unknown-project: ' + oldSlug)
    const newSlug = slugify(newName)
    const newPath = path.join(org, 'projects', newSlug)
    if (newSlug !== oldSlug && fs.existsSync(newPath)) {
      throw new Error('renameProject: destination already exists: ' + newPath)
    }

    const manifest = readManifest(manifestFile)
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    fs.renameSync(oldPath, newPath)
    try {
      manifest.name = newName
      manifest.slug = newSlug
      const pending = Boolean(manifest.repoUrl)
      if (pending) manifest.repoRenamePending = true
      writeManifest(projectManifestPath(newPath), manifest)

      let rekeyed = 0
      try {
        rekeyed = rekeySessionsProject(org, oldSlug, newSlug, env)
      } catch { /* registry optional — no sessions yet is a normal state */ }

      let originUpdated = false
      if (pending && manifest.repoOwner) {
        const st = await githubBridge.status()
        if (st.ok && st.linked) {
          try {
            setOrigin(
              newPath,
              manifest.repoUrl.replace(new RegExp('/' + esc(oldSlug) + '(\\.git)?$'), '/' + newSlug),
              env,
            )
            originUpdated = true
          } catch { /* best-effort: the PATCH ride owns the remote rename */ }
        }
      }
      return { path: newPath, slug: newSlug, manifest, rekeyed, originUpdated, repoRenamePending: pending }
    } catch (err) {
      fs.renameSync(newPath, oldPath) // all-or-nothing (D72)
      throw err
    }
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
    // Scan the ORG FOLDER itself (2026-08-30): scanning the lifecycle root
    // tied every tree to the most-recent org — any other registered org
    // threw unknown-org and lost its rows (TOPO under RESTO's root). The
    // org folder is its own truth (D69 in-place layout).
    const { orgs, projects } = scanWorkspace(resolved)
    const org = [...orgs.values()].find((o) => o.path === resolved)
    if (!org) throw new Error('unknown-org: ' + resolved)
    // v2 tree face (grilled 2026-08-30): docks + their fixed containers,
    // projects + their fixed containers. The client flattens this into
    // container rows (orgs, docks, projects) and leaf workspace rows.
    const template = getTemplate(TEMPLATE_VERSION)
    const docks = template.docks.map((d) => ({
      slug: d.slug,
      exists: fs.existsSync(path.join(resolved, d.slug)),
      // A dock with no fixed containers (notes) is itself a workspace;
      // the projects dock holds projects instead.
      workspace: d.slug !== 'projects' && (d.containers ?? []).length === 0,
      containers: d.containers, // null = projects dock (dynamic children)
    }))
    const orgProjects = [...projects.values()]
      .filter((p) => p.orgId === org.id)
      .map(({ id, name, slug, path: projectPath }) => ({
        id, name, slug, path: projectPath,
        containers: [...template.projectContainers],
      }))
    let sessionsByWorkspace = null
    try {
      const rows = listSessions(resolved, env)
      sessionsByWorkspace = {}
      for (const s of rows) {
        if (s.state === 'archived') continue // D39: archived never surfaces
        const key = s.workspace ?? '' // '' = pre-v2 org-level relic
        sessionsByWorkspace[key] = (sessionsByWorkspace[key] ?? 0) + 1
      }
    } catch {
      sessionsByWorkspace = null // no repo / unreadable registry — counts stay hidden
    }
    return { docks, projects: orgProjects, sessionsByWorkspace }
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
    renameProject,
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
