/**
 * Org lifecycle service (Phase A of docs/plans/file-org-shell-integration.md).
 *
 * Composes the six proven file-organisation libraries into the shell's org
 * lifecycle. This file owns ORDER and TEARDOWN only — every capability
 * (scaffold, stamp/migrate, index, git, mirror, rail) stays in its library.
 *
 * openOrg order (plan-mandated, one unwind stack):
 *   1. shell lock        — per-org process lock at the workspace root
 *   2. stamp/migrate     — workspace openOrg: crash recovery → stamp check
 *                          (StampRefusalError when newer) → forward-only
 *                          migration; the library serializes rewind with its
 *                          own .git lock underneath
 *   3. index             — workspace-index backend, rebuild-if-missing
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
  scaffoldProject,
  openOrg as workspaceOpenOrg,
  validateWorkspaceRoot,
  listTrash,
  restoreFromTrash,
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
  reviveSession,
  sessionStageBoundary,
} from '../../git-workspace/lib/index.js'
import { runGit } from '../../git-workspace/lib/index.js'
import { refreshAccountMirror, ensureAccountExcluded } from '../../account-mirror/lib/index.js'
import { claimMaterializer, materialize, readEdits } from '../../cairn-rail/lib/index.js'

import { OrgOpenError, OrgAlreadyOpenError, OrgNotOpenError } from './errors.js'
import { acquireShellLock } from './shell-lock.js'

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
export function createOrgLifecycle({ workspaceRoot, env = process.env, rails = {} } = {}) {
  if (typeof workspaceRoot !== 'string' || workspaceRoot === '') {
    throw new TypeError('createOrgLifecycle: workspaceRoot (string) is required')
  }
  validateWorkspaceRoot(workspaceRoot)
  const root = path.resolve(workspaceRoot)

  /** @type {null | object} the single open-org handle */
  let current = null

  function listOrgs() {
    // workspace scanWorkspace returns Maps keyed by id; expose plain rows.
    return [...scanWorkspace(root).orgs.values()]
  }

  function createOrg(displayName) {
    return scaffoldOrg(root, displayName)
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
      // 1. shell lock — real from the very first step, repo or not.
      step = 'shell-lock'
      const releaseLock = acquireShellLock(root, resolved)
      undo.push(releaseLock)

      // 2. crash recovery → stamp check → forward-only migration.
      step = 'stamp-migrate'
      const opened = workspaceOpenOrg(resolved, { env })

      // 3. index open, rebuild-if-missing (derived cache: rebuild is the
      //    whole recovery story — no migrations, no reconciliation).
      step = 'index'
      const indexWasMissing = !fs.existsSync(path.join(root, INDEX_DIR, INDEX_FILE))
      const backend = openBackend(root)
      undo.push(() => backend.close())
      let counts = null
      if (indexWasMissing || !backend.query('orgs').some((o) => o.slug === slug)) {
        counts = rebuild(root, backend).counts
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
        claimMaterializer(root, slug, rails.cairn.deviceId)
        const applied = materialize(root, slug, rails.cairn.deviceId)
        cairn = { attached: true, deviceId: rails.cairn.deviceId, applied, edits: readEdits(root, slug).length }
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
          return [...scanWorkspace(root).projects.values()]
            .filter((p) => p.orgId === opened.manifest.id)
            .map(({ id, name, slug: projectSlug, path: projectPath }) => (
              { id, name, slug: projectSlug, path: projectPath }
            ))
        },
        parkedSessions() {
          // Sessions carry an optional project scope: slug for project
          // sessions, null for org-level. Legacy registry entries predate
          // the field and read as null — no migration needed.
          return listSessions(resolved, env)
            .filter((s) => s.state !== 'open')
            .map((s) => ({ id: s.id, name: s.name, state: s.state, parkedReason: s.parkedReason, project: s.project ?? null }))
        },
        trashCount() {
          return listTrash(root).length
        },
        newProject(displayName) {
          return scaffoldProject(resolved, displayName)
        },
        newSession(name, project) {
          // Sessions carry an optional project scope (annotation in the
          // registry): accept project id or slug, store the slug (stable
          // across renames). Unknown project is a loud error, never a
          // silently org-level session.
          let projectSlug = null
          if (project != null) {
            const hit = [...scanWorkspace(root).projects.values()]
              .find((p) => p.orgId === opened.manifest.id && (p.slug === project || p.id === project))
            if (!hit) throw new Error(`unknown-project: ${project}`)
            projectSlug = hit.slug
          }
          return openSession(resolved, { name, project: projectSlug, env })
        },
        resumeSession(id) {
          return reviveSession(resolved, id, env)
        },
        mergeSession(id, message) {
          reviveSession(resolved, id, env) // boundary requires an open session
          return sessionStageBoundary(resolved, id, { message, env })
        },
        restoreTrash(entryId, opts = {}) {
          return restoreFromTrash(root, entryId, { env, ...opts })
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

  return {
    workspaceRoot: root,
    listOrgs,
    createOrg,
    openOrg,
    closeOrg,
    switchOrg,
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
