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
  softDelete,
  softDeleteSession,
  SESSION_TRASH_KIND,
  hardDelete,
  hardDeleteToken,
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
  ensureGeneratedIgnored,
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
  getOrigin,
  pushRepo,
  // 2026-09-07: the remote calls on the org-open heal/sync path run off the
  // event loop — see runGitAsync. Same results, the host stays responsive.
  fetchRepoAsync,
  pushRepoAsync,
  spawnSnapshotOrgRepo,
  snapshotWorkerLive,
  listSessions,
  // D98: the org registry is no longer the whole picture — project sessions
  // live in their own repo's registry. `allSessions` is the aggregate view.
  parkedSessions as allSessions,
  resolveSessionRepo,
  archivedSessionIds,
  openSession,
  annotateSession,
  mintSessionPath,
  listWorktreeDirs,
  recordStage,
  reviewedTip,
  reviveSession,
  dropSession,
  removeSessionRow,
  restoreSessionRow,
  dropSessionRefs,
  archiveSession as archiveSessionBranch,
  sessionStageBoundary,
  rekeySessionsProject,
  writeFrameFiles,
  ensureFrameUnignored,
  FRAME_VERSION,
  settingsPayload,
  protectionPayload,
  wipCommit,
  createWipWatcher,
  fetchRepo,
  mainSyncState,
  ffMergeMain,
} from '../../git-workspace/lib/index.js'
import { runGit } from '../../git-workspace/lib/index.js'
import { arxaHome, readOrgNames, rememberOrgName } from '../../workspace/lib/root.js'
import { getTemplate, TEMPLATE_VERSION } from '../../workspace/lib/template.js'
import { refreshAccountMirror, ensureAccountExcluded } from '../../account-mirror/lib/index.js'
import { claimMaterializer, materialize, readEdits } from '../../cairn-rail/lib/index.js'

import { OrgOpenError, OrgAlreadyOpenError, OrgNotOpenError } from './errors.js'
import { acquireShellLock } from './shell-lock.js'
import { createDshBridge, joinDshLive } from './dsh-bridge.js'
import { createGithubBridge, annotateProjectManifest, annotateOrgManifest } from './github-bridge.js'

/**
 * The A4 sandbox bridge (Task 10): one `start({ repoPath, branch,
 * sessionId })` face returning `{ ok, tier?, container?, reason? }`. The
 * default is the REAL Docker lifecycle (detect, never install), with the
 * machine's Docker state measured once per lifecycle (a session-create must
 * not shell out to probe per row) and cached — a started daemon mid-run is
 * picked up by the next org open. Absent/partial faces degrade to the loud
 * 'sandbox-unavailable' stub, exactly like the dsh and github bridges.
 */
export function createSandboxBridge(faces = {}) {
  if (typeof faces.start === 'function') return { start: faces.start }
  let dockerMemo
  return {
    async start (spec) {
      try {
        const dc = await import('../../sandbox/lib/devcontainer.js')
        dockerMemo ??= dc.detectDocker()
        if (!dockerMemo.available) return { ok: false, reason: dockerMemo.reason }
        dc.ensureDevcontainer(spec.repoPath, undefined, { docker: dockerMemo })
        const handle = await dc.startContainer(spec)
        return { ok: true, tier: 'A4', container: handle.container }
      } catch (err) {
        return { ok: false, reason: String(err?.message ?? err) }
      }
    },
  }
}

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
export function createOrgLifecycle({ workspaceRoot, env = process.env, rails = {}, dsh, github, sandbox } = {}) {
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
  // sandbox bridge (Task 10, A4): Docker project isolation at session start.
  // Injectable `start` face; the default DETECTS Docker (never installs) and
  // degrades honestly — an unreachable daemon never breaks a session, it
  // annotates the row with the truthful reason (S3).
  const sandboxBridge = createSandboxBridge(sandbox)

  /** Registry-row snapshots of sessions parked in the org trash (2026-09-05
   *  archives grill). A trashed session's row is gone but its branch still
   *  occupies the id namespace; minting feeds these ghosts so a newborn
   *  session never collides with a parked branch. Read-only, always local,
   *  degrades to [] when the trash is unreadable. */
  const ghostSessions = (orgPath) => {
    try {
      return listTrash(orgPath)
        .filter((e) => e.origin && e.origin.kind === SESSION_TRASH_KIND && e.origin.session)
        .map((e) => e.origin.session)
    } catch {
      return []
    }
  }

  // ---- D73 publish half (grilled 2026-08-30): orgs AND projects publish.
  // The unit is the repo; the flow is always: linked? → repo exists?
  // (origin reuse counts) → create → origin → push --all → manifest.
  // ANY failure is a loud manifest annotation, NEVER a throw — the local
  // repo is the source of truth and must survive every GitHub-shaped
  // failure (CLAUDE.md local-first boundary).

  /** Token-carrying push URL for a GitHub html_url. The token rides THIS
    * command line only — it is never persisted, never logged, and never
    * written into .git/config (origin keeps the clean URL). Non-GitHub
    * URLs (test doubles point at local bare repos) pass through as-is. */
  /** Git reports a rejected token as TEXT on a non-zero exit, not as a status
   * code, so this is the only way to tell "your token is dead" apart from
   * "the remote hung up". Kept deliberately broad — a false positive costs one
   * wasted token refresh, a false negative costs a repo that never syncs
   * again (measured on RESTO, 2026-09-03). */
  const AUTH_FAILURE_RE = /invalid username or token|authentication failed|could not read username|403 forbidden|401/i

  /**
   * Push, and on an auth-shaped failure mint a FORCED fresh credential and try
   * once more. This mirrors what createPrivateRepo / renameRepo / wireFrame
   * already do for their REST calls; the push path was the one hole, so a
   * token GitHub had already rejected while the local expiry clock still read
   * "alive" failed permanently with no route back.
   *
   * Throws the ORIGINAL error when the retry also fails, so the manifest
   * records the real cause rather than "retry failed".
   */
  async function pushWithAuthRetry(repoPath, repoUrl, kind = 'org') {
    const creds = await githubBridge.gitCredentials()
    if (!creds || !creds.ok) return { ok: false, reason: 'no-creds' }
    try {
      await pushRepoAsync(repoPath, pushUrlFor(repoUrl, creds), env)
      return { ok: true, refreshed: false }
    } catch (err) {
      if (!AUTH_FAILURE_RE.test(String(err?.message ?? err))) throw err
      const fresh = await githubBridge.gitCredentials(true).catch(() => null)
      if (!fresh || !fresh.ok) throw err
      try {
        await pushRepoAsync(repoPath, pushUrlFor(repoUrl, fresh), env)
        return { ok: true, refreshed: true }
      } catch { throw err }
    }
  }

  /**
   * Cleanup stage (2026-09-03): drop the session branch `arxa/<identity>` on GitHub once the
   * branch is merged into main, or when the caller closed its PR and says
   * `dropRemote`. Never deletes an unmerged branch on its own — GitHub would
   * close the open PR under the user. Returns a short status string.
   */
  async function dropRemoteSessionBranch(orgPath, row, opts = {}) {
    if (!row?.branch) return 'no-branch'
    const { repoPath, kind } = resolveSessionRepo(orgPath, row.workspace, { env })
    const m = readManifest(kind === 'org' ? orgManifestPath(repoPath) : projectManifestPath(repoPath))
    if (!m.repoUrl) return 'not-published'
    // Ask whether the session's REAL work landed, not whether its branch tip
    // did. After a merge the tip is routinely a WIP auto-save — the watcher
    // fires, or archive takes its own "nothing is ever lost" snapshot — and
    // that checkpoint is by definition not in main. Testing the raw tip
    // therefore answered "unmerged" for a session that had just merged
    // cleanly, and every such branch was kept on the remote forever
    // (2026-09-03, kitchen-project #1). WIP commits are app plumbing, D18:
    // they carry the WIP committer identity and are squashed away at the next
    // boundary, so they are exactly what this question should skip.
    const reviewed = reviewedTip(repoPath, row.branch, env)
    const merged = reviewed
      ? runGit(['merge-base', '--is-ancestor', reviewed, 'main'], { cwd: repoPath, env, allowFail: true }) !== null
      : false
    if (!merged && opts.dropRemote !== true) return 'kept-unmerged'
    const creds = await githubBridge.gitCredentials()
    if (!creds || !creds.ok) return 'kept-no-creds'
    const url = pushUrlFor(m.repoUrl, creds)
    const exists = runGit(['ls-remote', '--heads', url, row.branch], { cwd: repoPath, env, allowFail: true })
    if (!exists || exists.trim() === '') return 'absent'
    runGit(['push', url, '--delete', 'refs/heads/' + row.branch], { cwd: repoPath, env })
    // Drop the local mirror of the branch we just deleted.
    //
    // `push --delete` DOES prune `refs/remotes/<remote>/<branch>` — but only
    // when it is given a remote NAME. The delete above goes to a
    // token-bearing URL (pushUrlFor, so the push never falls back to a TTY
    // password prompt), and a URL has no tracking namespace to prune, so git
    // deletes the branch and leaves the mirror standing. Measured both ways
    // before writing this line, because the plausible-sounding reason (the
    // ref was hand-written by prflow's pushSessionBranch, so git does not
    // own it) is NOT why — a named-remote delete prunes that same
    // hand-written ref perfectly well.
    //
    // Left behind, the ref claims a remote branch that no longer exists:
    // ahead/behind on a revived session would answer from it, and one
    // accumulates per merged session forever (RESTO and kitchen-project
    // both carried one, 2026-09-03).
    runGit(['update-ref', '-d', 'refs/remotes/origin/' + row.branch], { cwd: repoPath, env, allowFail: true })
    return merged ? 'deleted-merged' : 'deleted-closed'
  }

  function pushUrlFor(repoUrl, creds) {
    if (typeof repoUrl !== 'string' || !repoUrl.startsWith('https://github.com/')) return repoUrl
    return 'https://' + encodeURIComponent(creds.login) + ':' + encodeURIComponent(creds.token)
      + '@' + repoUrl.slice('https://'.length)
  }

  /**
   * D74 heal face: the org repo, THEN every existing project under it —
   * projects created before D73 (or while unlinked) retrofit on the same
   * idempotent pass. Each project is independent: one failure annotates
   * its own manifest and never blocks the others.
   */
  async function publishOrgAndProjects(orgPath, orgSlug) {
    const orgRes = await publishRepoOnce(orgPath, orgSlug, 'org')
    let orgId = null
    try {
      orgId = readManifest(orgManifestPath(orgPath)).id
    } catch { /* unreadable org manifest — no project scoping possible */ }
    const projectResults = []
    if (orgId) {
      for (const p of [...scanWorkspace(orgPath).projects.values()].filter((x) => x.orgId === orgId)) {
        // D91: a project marked local-only (born into a local-only org, or
        // manually disconnected) stays local until project.connect — the
        // org-level publish and the D74 heal must not resurrect it.
        let pLocal = false
        try { pLocal = Boolean(readManifest(projectManifestPath(p.path)).localOnly) } catch { /* unreadable — inherit */ }
        if (pLocal) { projectResults.push({ slug: p.slug, ok: true, skipped: 'local-only' }); continue }
        projectResults.push({ slug: p.slug, ...(await publishRepoOnce(p.path, p.slug, 'project')) })
      }
    }
    return { ...orgRes, projects: projectResults }
  }
  /**
   * D90 disconnect core: strip the GitHub link from ONE repo (org root or
   * project). deleteRepo first when removeRepos (loud refusal keeps the
   * link intact — same all-or-nothing posture as purge); then the origin
   * remote is removed, the manifest stripped, and localOnly set so the
   * D74 heal never re-publishes. Connect (publishRepoOnce) clears it.
   */
  async function disconnectOne(repoPath, slug, kind, removeRepos) {
    const manifestFile = kind === 'org' ? orgManifestPath(repoPath) : projectManifestPath(repoPath)
    const m = (() => { try { return readManifest(manifestFile) } catch { return null } })()
    if (!m || !m.repoUrl) return { ok: true, skipped: 'not-connected', slug }
    const full = m.repoOwner + '/' + (m.repoName || slug)
    if (removeRepos) {
      const made = await githubBridge.deleteRepo(m.repoOwner, m.repoName || slug)
      if (!made.ok) throw new Error('disconnect incomplete: GitHub deletion failed for ' + full + ' (' + (made.error || made.reason) + ') — the org stays connected')
    }
    try {
      delete m.repoUrl
      delete m.repoOwner
      delete m.repoName
      delete m.repoPrivate
      delete m.githubStatus
      delete m.githubPublishedAt
      m.localOnly = true
      writeManifest(manifestFile, m)
      try { runGit(['add', path.basename(manifestFile)], { cwd: repoPath, allowFail: true }); runGit(['commit', '-m', 'chore(github): remove the GitHub link state', '--', path.basename(manifestFile)], { cwd: repoPath, allowFail: true }) } catch { /* best-effort */ }
    } catch { /* strip best-effort — remote removal still proceeds */ }
    // D90: only a REMOVE deletes the GitHub side, so only then does the
    // origin remote die. KEEP leaves origin pointing at the live repo —
    // reconnect then flows through the existing-origin publish path (no
    // create, no 422, push is idempotent over our own history).
    if (removeRepos) { try { runGit(['remote', 'remove', 'origin'], { cwd: repoPath, allowFail: true }) } catch { /* best-effort */ } }
    return { ok: true, slug, repo: full, removed: !!removeRepos }
  }
  /** D90: disconnect the ORG repo AND every published project under it. */
  async function disconnectGithub(orgPath, { removeRepos = false } = {}) {
    const resolved = path.resolve(orgPath)
    const out = [await disconnectOne(resolved, path.basename(resolved), 'org', removeRepos)]
    try {
      const orgId = readManifest(orgManifestPath(resolved)).id
      for (const p of [...scanWorkspace(resolved).projects.values()].filter((x) => x.orgId === orgId && x.path !== resolved)) {
        out.push(await disconnectOne(p.path, p.slug, 'project', removeRepos))
      }
    } catch { /* org manifest unreadable — org repo only */ }
    return { ok: true, results: out, removedRepos: out.filter((r2) => r2.removed).map((r2) => r2.repo) }
  }
  /** D90: disconnect ONE project's repo. */
  async function disconnectProjectGithub(orgPath, projectSlug, { removeRepos = false } = {}) {
    const orgResolved = path.resolve(orgPath)
    let target = null
    try {
      const orgId = readManifest(orgManifestPath(orgResolved)).id
      target = [...scanWorkspace(orgResolved).projects.values()].find((x) => x.orgId === orgId && x.slug === projectSlug && x.path !== orgResolved)
    } catch { /* unreadable org manifest */ }
    if (!target) throw new Error('no-project: ' + projectSlug)
    return disconnectOne(target.path, projectSlug, 'project', removeRepos)
  }
  /** D90: connect ONE project (manual publish, project-scoped). */
  async function connectProject(orgPath, projectSlug) {
    const orgResolved = path.resolve(orgPath)
    let target = null
    try {
      const orgId = readManifest(orgManifestPath(orgResolved)).id
      target = [...scanWorkspace(orgResolved).projects.values()].find((x) => x.orgId === orgId && x.slug === projectSlug && x.path !== orgResolved)
    } catch { /* unreadable org manifest */ }
    if (!target) throw new Error('no-project: ' + projectSlug)
    return publishRepoOnce(target.path, projectSlug, 'project')
  }


  /**
   * Idempotent publish of ONE repo (org root or nested project). Skips
   * when the manifest already carries repoUrl (published). Reuses an
   * existing origin from an earlier partial publish; creates the private
   * repo when absent; pushes all branches; annotates the manifest with
   * the repo fields + githubStatus. Throw-proof by contract.
   *
   * @param {'org' | 'project'} kind
   */
  /** Part B S1 — wire the CI frame once a repo is published: ci.yml +
   *  PR template committed and pushed, merge-commit-only repo settings, branch
   *  protection (the measured free-plan 403 recorded as plan-limited,
   *  S0 V1 — the card enforces gates client-side regardless, Q2), and a
   *  canon self-hosted runner on this machine (Q5). Best-effort end to
   *  end: a published repo without the frame still works; wireFrameOnce
   *  retries on the next publish/heal while frameWired !== true. */
  async function wireFrameOnce(repoPath, kind) {
    try {
      const manifestFile = kind === 'org' ? orgManifestPath(repoPath) : projectManifestPath(repoPath)
      const m = readManifest(manifestFile)
      if (!m.repoUrl || !m.repoOwner || !m.repoName) return { skipped: 'not-published' }
      // "Wired" only counts when the frame files are actually versioned.
      // RESTO (2026-09-03) carried frameWired:true while check.sh and
      // .github/ sat ignored by the org whitelist .gitignore: git refused
      // the `add` (exit 1, "use -f"), allowFail swallowed it, so GitHub
      // never had a workflow and no CI run ever happened. Re-wire in that
      // state, and verify tracking instead of trusting the add.
      const frameTracked = () => runGit(['ls-files', '--error-unmatch', '--', 'check.sh', '.github/workflows/ci.yml'], { cwd: repoPath, allowFail: true }) !== null
      const alreadyWired = m.frameWired === true && frameTracked()
      // upgrade: a stale stamped file (older FRAME_VERSION) is rewritten;
      // a hand-modified one is left alone (conflicted) — nothing ever
      // called upgrade before, so RESTO kept a pre-Q7 ci.yml forever.
      const wrote = writeFrameFiles(repoPath, kind, { includeCiYml: true, upgrade: true })
      if (kind === 'org') ensureFrameUnignored(repoPath)
      // A project scaffolded before TARGET_BUILD_LINES existed keeps its old
      // .gitignore forever (ensureProjectGitignore never overwrites), so the
      // patch has to happen on a path every published project passes through.
      // This is that path — it already re-applies the frame every time.
      if (kind === 'project') ensureGeneratedIgnored(repoPath)
      runGit(['add', '--', '.gitignore', 'check.sh', '.github'], { cwd: repoPath, allowFail: true })
      if (!frameTracked()) {
        throw new Error('frame-files-untracked: check.sh/.github are ignored by .gitignore, the frame cannot reach GitHub')
      }
      // `diff --cached --quiet` exits 1 (→ null) when something is staged.
      if (runGit(['diff', '--cached', '--quiet'], { cwd: repoPath, allowFail: true }) === null) {
        const msg = alreadyWired
          ? `chore(ci): upgrade the arxa frame to v${FRAME_VERSION}`
          : 'chore(ci): wire the arxa frame (checks, workflow, PR template)'
        runGit(['commit', '-m', msg], { cwd: repoPath, allowFail: true })
        await pushWithAuthRetry(repoPath, m.repoUrl, kind).catch(() => null)
      }
      // Settings + protection are re-applied EVERY time, not only on first
      // wire: both calls are idempotent, and the payload changes over time
      // (2026-09-02 flipped squash-only → merge-commit-only). RESTO was wired
      // 2026-08-31 under the old payload, frameWired:true made every later
      // heal return here, and card.pr.merge got a 405 from GitHub because the
      // repo still allowed only squash. Drift in the payload must heal.
      const wired = await githubBridge.wireFrame(m.repoOwner, m.repoName, { settings: settingsPayload(), protection: protectionPayload() })
      if (alreadyWired && wired.ok) {
        // Record a protection change the same way first-wire does (annotate
        // + commit the manifest). Writing without committing left org.json
        // dirty on every reopen and tripped the D78 clean-tree gate.
        if (m.frameProtection !== wired.protection) {
          try {
            const fields = { frameProtection: wired.protection }
            if (kind === 'org') annotateOrgManifest(repoPath, fields)
            else annotateProjectManifest(repoPath, fields)
            const file = path.basename(manifestFile)
            runGit(['add', file], { cwd: repoPath, allowFail: true })
            runGit(['commit', '-m', 'chore(github): record frame protection', '--', file], { cwd: repoPath, allowFail: true })
            await pushWithAuthRetry(repoPath, m.repoUrl, kind).catch(() => null)
          } catch { /* annotation best-effort */ }
        }
        return { skipped: 'wired', settings: 'reapplied', upgraded: wrote.upgraded, conflicted: wrote.conflicted }
      }
      const fields = {}
      if (wired.ok) {
        fields.frameWired = true
        fields.frameProtection = wired.protection
        const runner = await githubBridge.ensureRunner(m.repoOwner, m.repoName)
        fields.frameRunner = runner.ok ? 'ok' : String(runner.reason ?? 'failed')
      } else {
        fields.frameWired = 'failed: ' + String(wired.error ?? wired.reason ?? 'unknown')
      }
      try {
        if (kind === 'org') annotateOrgManifest(repoPath, fields)
        else annotateProjectManifest(repoPath, fields)
        const file = path.basename(manifestFile)
        runGit(['add', file], { cwd: repoPath, allowFail: true })
        runGit(['commit', '-m', 'chore(github): record frame state', '--', file], { cwd: repoPath, allowFail: true })
        if (fields.frameWired === true) {
          await pushWithAuthRetry(repoPath, m.repoUrl, kind).catch(() => null)
        }
      } catch { /* annotation best-effort */ }
      return { ok: wired.ok === true, protection: wired.protection ?? null }
    } catch (err) {
      if (process.env.ARXA_FRAME_DEBUG) console.error('[wireFrameOnce]', repoPath, String(err?.stack ?? err).slice(0, 600))
      // Record the failure on the manifest (githubStatus, not frameWired) so
      // the next publish/heal retries and the UI can say why — the common
      // cause is a pre-workflow-scope link needing ONE re-link (S1 live).
      try {
        const fields = { frameWired: 'failed: ' + String(err?.message ?? err).slice(0, 160) }
        if (kind === 'org') annotateOrgManifest(repoPath, fields)
        else annotateProjectManifest(repoPath, fields)
        const mf = kind === 'org' ? orgManifestPath(repoPath) : projectManifestPath(repoPath)
        runGit(['add', path.basename(mf)], { cwd: repoPath, allowFail: true })
        runGit(['commit', '-m', 'chore(github): record frame retry state', '--', path.basename(mf)], { cwd: repoPath, allowFail: true })
      } catch { /* best-effort */ }
      return { ok: false, reason: 'frame-wire-failed: ' + String(err?.message ?? err) }
    }
  }

  /**
   * D95/D96 (2026-09-01 sync grill): make ONE repo's main match GitHub.
   * Fetch first (never touches local main), then: diverged → park loudly,
   * ONCE, via a committed manifest note — never auto-merge; ahead → push
   * immediately (the silent creds-skip is exactly how project-001 drifted
   * 3 commits); behind → fast-forward only. Throw-proof by contract.
   * Returns a status word for the sweep summary.
   */
  async function syncRepoNow(repoPath, kind) {
    try {
      const manifestFile = kind === 'org' ? orgManifestPath(repoPath) : projectManifestPath(repoPath)
      let manifest
      try { manifest = readManifest(manifestFile) } catch { return 'no-manifest' }
      if (!manifest.repoUrl) return 'local'
      if (manifest.localOnly) return 'local'
      const creds = await githubBridge.gitCredentials()
      if (!creds || !creds.ok) return 'no-creds'
      const url = pushUrlFor(manifest.repoUrl, creds)
      if (!(await fetchRepoAsync(repoPath, url, env))) return 'fetch-failed'
      /** A sync that reaches a healthy end state must CLEAR a stale failure.
       * Without this one blip left `publish-failed: … Invalid username or
       * token` on the manifest forever, so the org read as broken long after
       * it had healed — which is most of why RESTO "looked" unsynced. */
      const clearStaleStatus = async () => {
        try {
          const st = manifest.githubStatus
          if (typeof st !== 'string') return
          if (!/^(publish-failed|sync-conflict|push-failed)/.test(st)) return
          const fields = { githubStatus: 'published' }
          if (kind === 'org') annotateOrgManifest(repoPath, fields)
          else annotateProjectManifest(repoPath, fields)
          const file = path.basename(manifestFile)
          runGit(['add', file], { cwd: repoPath, allowFail: true })
          const committed = runGit(['commit', '-m', 'chore(github): clear a healed sync status', '--', file], { cwd: repoPath, allowFail: true })
          // This commit is made AFTER the ahead/behind read, so nothing above
          // will push it: leaving it here would trade "stuck showing a stale
          // error" for "permanently 1 ahead of origin" — the very symptom
          // being fixed. Push it now. Best-effort: a failure just means the
          // next sync finds ahead>0 and pushes it then.
          if (committed !== null) await pushWithAuthRetry(repoPath, manifest.repoUrl, kind).catch(() => null)
        } catch { /* advisory — never fail a good sync on bookkeeping */ }
      }
      const state = mainSyncState(repoPath, env)
      if (state.diverged) {
        // Park ONCE (the note itself commits — D78: never leave the
        // manifest dirty); every later sweep just reports the status.
        const note = 'sync-conflict: local and GitHub main both moved — resolve manually'
        try {
          if (manifest.githubStatus !== note) {
            if (kind === 'org') annotateOrgManifest(repoPath, { githubStatus: note })
            else annotateProjectManifest(repoPath, { githubStatus: note })
            const file = path.basename(manifestFile)
            runGit(['add', file], { cwd: repoPath, allowFail: true })
            runGit(['commit', '-m', 'chore(github): record sync conflict', '--', file], { cwd: repoPath, allowFail: true })
          }
        } catch { /* advisory */ }
        return 'diverged'
      }
      if (state.ahead > 0) {
        try {
          const pushed = await pushWithAuthRetry(repoPath, manifest.repoUrl, kind)
          if (!pushed.ok) return 'no-creds'
          await clearStaleStatus()
          return 'pushed'
        } catch (err) {
          return 'push-failed: ' + String(err?.message ?? err).slice(0, 120)
        }
      }
      if (state.behind > 0) {
        const pulled = ffMergeMain(repoPath, env)
        if (pulled) await clearStaleStatus()
        return pulled ? 'pulled' : 'in-sync'
      }
      await clearStaleStatus()
      return 'in-sync'
    } catch (err) {
      return 'error: ' + String(err?.message ?? err).slice(0, 120)
    }
  }

  /**
   * D95/D96: sweep ONE org — the org repo, then every project repo under
   * it — through syncRepoNow. Called detached on every open (inside the
   * D74 heal) and by the org.sync refresh door. Never throws.
   */
  async function syncOrgRepos(orgPath) {
    const resolved = path.resolve(orgPath)
    const out = [{ repo: resolved, kind: 'org', status: await syncRepoNow(resolved, 'org') }]
    try {
      const { orgs, projects } = scanWorkspace(resolved)
      const org = [...orgs.values()].find((o) => o.path === resolved)
      if (org) {
        for (const p of projects.values()) {
          if (p.orgId !== org.id) continue
          out.push({ repo: p.path, kind: 'project', slug: p.slug, status: await syncRepoNow(p.path, 'project') })
        }
      }
    } catch { /* scan failure — the org repo result still stands */ }
    return out
  }

  async function publishRepoOnce(repoPath, slug, kind) {
    const manifestFile = kind === 'org' ? orgManifestPath(repoPath) : projectManifestPath(repoPath)
    // D78: an annotation left uncommitted dirties the repo, and the NEXT
    // open's clean-tree gate then refuses the org (measured on PLATO/TOPO:
    // "uncommitted or untracked changes" at stamp-migrate). The git repo is
    // the source of truth — commit the manifest the moment it is annotated.
    const commitManifest = () => {
      const file = path.basename(manifestFile)
      try {
        runGit(['add', file], { cwd: repoPath, allowFail: true })
        runGit(['commit', '-m', 'chore(github): record link state', '--', file], { cwd: repoPath, allowFail: true })
      } catch { /* best effort — annotation still stands in the worktree */ }
    }
    const annotate = (fields) => {
      try {
        const out = kind === 'org' ? annotateOrgManifest(repoPath, fields) : annotateProjectManifest(repoPath, fields)
        commitManifest()
        return out
      } catch { return null }
    }
    let manifest
    try {
      manifest = readManifest(manifestFile)
    } catch {
      return { ok: false, reason: 'manifest-unreadable' }
    }
    if (manifest.repoUrl) {
      // D78: skip the CREATE, never the SYNC — migration commits (template
      // v3 renames, .gitkeep) must reach the remote on the next heal or
      // manual publish without a full re-publish. Push is idempotent
      // (up-to-date is a clean no-op); failures annotate loud, never throw.
      try {
        const creds = await githubBridge.gitCredentials()
        if (creds && creds.ok) {
          // D80: consume a pending rename BEFORE the sync push — PATCH the
          // repo to the folder's current slug, adopt the canonical URL,
          // clear the flag, commit the manifest, then push (which now lands
          // on the new name). A failed PATCH keeps the flag, annotates loud,
          // and falls through: the old URL still redirects, nothing lost.
          if (manifest.repoRenamePending && manifest.repoOwner) {
            const target = path.basename(repoPath)
            const made = await githubBridge.renameRepo(manifest.repoOwner, manifest.repoName || target, target)
            if (made.ok) {
              const fresh = readManifest(manifestFile)
              fresh.repoUrl = made.repo.repoUrl
              fresh.repoName = target
              fresh.githubStatus = 'published'
              delete fresh.repoRenamePending
              writeManifest(manifestFile, fresh)
              commitManifest()
              manifest.repoUrl = made.repo.repoUrl
              manifest.repoName = target
              manifest.repoRenamePending = undefined
              try { setOrigin(repoPath, made.repo.repoUrl, env) } catch { /* best-effort */ }
              await pushRepoAsync(repoPath, pushUrlFor(made.repo.repoUrl, creds), env)
              await wireFrameOnce(repoPath, kind)
              return { ok: true, skipped: 'published', slug, repoUrl: made.repo.repoUrl }
            }
            annotate({ githubStatus: 'publish-failed: repo rename failed: ' + String(made.error ?? made.reason ?? 'unknown') + ' — pending flag kept' })
          }
          await pushRepoAsync(repoPath, pushUrlFor(manifest.repoUrl, creds), env)
        }
      } catch (err) {
        annotate({ githubStatus: 'publish-failed: sync push failed: ' + String(err?.message ?? err) })
        return { ok: false, reason: 'push-failed', slug, repoUrl: manifest.repoUrl }
      }
      await wireFrameOnce(repoPath, kind)
      // D95: wireFrameOnce's annotate commits land AFTER the sync push
      // above — sync once more so they reach GitHub in the same breath.
      await syncRepoNow(repoPath, kind)
      return { ok: true, skipped: 'published', slug, repoUrl: manifest.repoUrl }
    }
    const st = await githubBridge.status()
    if (!st.ok || !st.linked) {
      annotate({ githubStatus: st.ok ? 'not-linked' : (st.reason ?? 'github-unavailable') })
      return { ok: false, reason: st.ok ? 'not-linked' : (st.reason ?? 'github-unavailable') }
    }
    try {
      let repoUrl = getOrigin(repoPath, env)
      if (!repoUrl) {
        const made = await githubBridge.createPrivateRepo(slug)
        if (!made.ok) throw new Error(made.error ? made.reason + ' (' + made.error + ')' : (made.reason ?? 'github-unavailable'))
        setOrigin(repoPath, made.repo.repoUrl, env)
        repoUrl = made.repo.repoUrl
      }
      const creds = await githubBridge.gitCredentials()
      if (!creds.ok) throw new Error(creds.reason ?? 'github-unavailable')
      await pushRepoAsync(repoPath, pushUrlFor(repoUrl, creds), env)
      annotate({
        repoUrl,
        repoOwner: creds.login,
        repoName: slug,
        repoPrivate: true,
        githubStatus: 'published',
        githubPublishedAt: new Date().toISOString(),
        localOnly: false, // D90: connecting clears the local-only answer
      })
      await wireFrameOnce(repoPath, kind)
      await syncRepoNow(repoPath, kind) // D95: fresh publishes land wired + synced
      return { ok: true, slug, repoUrl }
    } catch (err) {
      annotate({ githubStatus: 'publish-failed: ' + String(err?.message ?? err) })
      return { ok: false, reason: String(err?.message ?? err) }
    }
  }
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

  /**
   * Q6 (2026-09-03): org folder names are unique, case-insensitively.
   *
   * A session identity STARTS with the org folder name, and the desktop keeps
   * one dsh conversation store for every org, so two orgs called `RESTO` would
   * mint colliding identities and collide in the conversation store. Git refs
   * are case-sensitive while macOS folders are not, which makes `resto` vs
   * `RESTO` the same folder but two different branches — refuse both shapes.
   */
  function assertOrgFolderNameFree(candidatePath, selfPath) {
    const resolved = path.resolve(candidatePath)
    const wanted = path.basename(resolved).toLowerCase()
    // `selfPath` is the org's own CURRENT location, and it exists for the
    // case-only rename (D80): renaming /a/resto → /a/RESTO gives a candidate
    // whose resolved string differs from the org's own recents entry, so the
    // "same org, re-opened" skip below would not fire and the org would
    // collide with itself. Exclude by where it is now, not by where it is going.
    const self = selfPath === undefined ? null : path.resolve(selfPath)
    const claims = [
      ...listOrgs().map((o) => o.path),
      // The recents list is capped at RECENTS_CAP, so it is NOT the full set
      // of orgs that have minted session ids. The ledger is (see readOrgNames).
      ...Object.values(readOrgNames(env)),
    ]
    for (const claimPath of claims) {
      const claimed = path.resolve(claimPath)
      if (claimed === resolved) continue // the same org, re-opened
      if (self !== null && claimed === self) continue // the org renaming itself
      if (path.basename(claimed).toLowerCase() !== wanted) continue
      // A ledger entry whose folder is GONE is a name the user is free to
      // reuse — refusing forever would strand the name after a delete. Any
      // residue left in the dsh store is healed at boot by the workspace
      // store preflight (plugins/workspace/lib/store-heal.js), so the
      // remaining risk is a repaired store, not a dead engine.
      if (!fs.existsSync(claimed)) continue
      throw new Error(
        `org-name-taken: "${path.basename(claimed)}" is already an organisation at ${claimed}. ` +
        'A session identity begins with the org folder name, so two organisations cannot ' +
        'share one (case-insensitively) — rename this folder before adding it.',
      )
    }
    return resolved
  }

  /**
   * Q7 (2026-09-03): identity is pinned at birth and never re-derived.
   *
   * Every session id starts with the org folder name AS IT WAS at creation, and
   * that string is already baked into a branch, a worktree directory and a dsh
   * conversation key. If the folder has since been renamed on disk, resuming
   * would keep building under a name that no longer describes reality — and
   * renaming the branch to catch up would CLOSE any open PR (GitHub closes a PR
   * whose head branch is renamed). So the org opens in `path-moved`: rows stay
   * visible, resume refuses, and restoring the folder name clears it.
   *
   * Only the BASENAME is compared, so moving the org to another disk (the case
   * the org-move handling already supports) keeps working. Pre-path rows (no
   * `/` in the id) are ignored — they predate this contract.
   *
   * @returns {{ expected: string[], actual: string }|null}
   */
  function sessionPathDrift(orgPath, checkEnv = env) {
    const actual = path.basename(path.resolve(orgPath))
    const expected = new Set()
    let rows = []
    try { rows = allSessions(orgPath, checkEnv) } catch { return null }
    for (const s of rows) {
      if (!s || typeof s.id !== 'string' || !s.id.includes('/')) continue
      const first = s.id.split('/')[0]
      if (first !== actual) expected.add(first)
    }
    return expected.size === 0 ? null : { expected: [...expected], actual }
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
    // Refuse BEFORE the folder enters the registry (Q6). The scaffolded folder
    // is left on disk untouched — renaming it and adding it is the recovery.
    assertOrgFolderNameFree(created.path)
    rememberOrgName(created.path, env) // claim the folder name for good (H2)
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
    // Q6: the universal chokepoint — an org that cannot open cannot mint a
    // session, so a colliding folder name can never reach an identity.
    assertOrgFolderNameFree(resolved)
    rememberOrgName(resolved, env) // claim the folder name for good (H2)
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
      // Part B S1: the frame rides the FIRST open — new orgs (create-at
      // opens immediately after scaffold) and legacy orgs alike get their
      // green-by-absence check.sh + PR template. Only-if-absent (never
      // clobbers user edits); local-only orgs simply carry the local half.
      // The files are COMMITTED immediately when HEAD exists — an untracked
      // check.sh would trip the next open's clean-tree gate (D78 lesson).
      // Before HEAD they ride the initial snapshot instead.
      //
      // Open is also the MIGRATION point. writeFrameFiles never clobbers, so
      // a repo created before a generator fix would otherwise keep its old
      // gate forever — silently, which is the worst kind. `upgrade` refreshes
      // a stamped file only while its hash still matches what arxa wrote; a
      // file a human edited comes back `conflicted` and is left alone.
      try {
        const frOpen = writeFrameFiles(resolved, 'org', { upgrade: true })
        if ((frOpen.written.length || frOpen.upgraded.length) && hasHead(resolved, env)) {
          runGit(['add', 'check.sh', '.github'], { cwd: resolved, allowFail: true })
          runGit(['commit', '-m', frOpen.upgraded.length
            ? `chore(ci): refresh the arxa frame to v${FRAME_VERSION}`
            : 'chore(ci): add the arxa frame (day-zero checks)'], { cwd: resolved, allowFail: true })
        }
        // Each project is its own repo with its own frame, and nothing else
        // ever revisits it — wireFrameOnce short-circuits on frameWired — so
        // without this sweep a project's gate is frozen at whatever version
        // it was born with. Projects are swept on org open for that reason.
        for (const p of scanWorkspace(resolved).projects.values()) {
          try {
            const fr = writeFrameFiles(p.path, 'project', { upgrade: true })
            if (fr.upgraded.length && hasHead(p.path, env)) {
              runGit(['add', 'check.sh', '.github'], { cwd: p.path, allowFail: true })
              runGit(['commit', '-m', `chore(ci): refresh the arxa frame to v${FRAME_VERSION}`], { cwd: p.path, allowFail: true })
            }
          } catch { /* one project's frame must never fail the org open */ }
        }
      } catch { /* frame is best-effort */ }

      // 5. session lifecycle ready — registry readable, archived derivable.
      step = 'sessions'
      const sessions = allSessions(resolved, env) // D98: org + every project registry
      const archived = archivedSessionIds(resolved, env)

      // 5b. WIP watcher (Part B S2, Q9) + frame emission (S1): a debounced
      // net over the primary worktree + every OPEN session worktree,
      // catching out-of-band edits (Finder, the user's editor — the D92c
      // class). Owned by this handle; closeOrg stops it; session faces
      // reconfigure the path set. Booted ONLY once HEAD exists — a
      // deferred (create-time) open must stay instant (the 2025-08 hang
      // contract); the heal boots the net the moment HEAD lands.
      const openWorktrees = () =>
        allSessions(resolved, env) // D98: project session worktrees need the WIP net too
          .filter((s) => s.state === 'open' && s.worktree)
          .map((s) => s.worktree)
      let wipWatcher = null
      const startWipNet = () => {
        if (wipWatcher) return
        try {
          wipWatcher = createWipWatcher({
            paths: [resolved, ...openWorktrees()],
            debounceMs: 3000,
            onQuiet: (p) => {
              // Unborn HEAD means the detached INITIAL SNAPSHOT owns the
              // first commit — the watcher never commits into an unborn
              // repo (it would add -A the bulk).
              try { if (!hasHead(p, env)) return; wipCommit(p, { message: 'auto-save (watcher)', env }) } catch { /* never kill the net */ }
            },
          })
          undo.push(() => wipWatcher.stop())
        } catch { /* the event pokes remain without the watcher */ }
        // Frame emission rides the same gate: files + immediate commit so
        // the clean-tree gate stays happy (D78). Never clobbers user files.
        try {
          const frOpen = writeFrameFiles(resolved, 'org')
          if (frOpen.written.length && hasHead(resolved, env)) {
            runGit(['add', 'check.sh', '.github'], { cwd: resolved, allowFail: true })
            runGit(['commit', '-m', 'chore(ci): add the arxa frame (day-zero checks)'], { cwd: resolved, allowFail: true })
          }
        } catch { /* frame is best-effort */ }
      }
      const syncWipWatchPaths = () => {
        try { wipWatcher?.setPaths([resolved, ...openWorktrees()]) } catch { /* advisory */ }
      }
      if (!snapshotPending) startWipNet()

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

      // D74 heal-on-open: an org with a linked GitHub account and no
      // published repo gets one — DETACHED (publish involves the network;
      // open must stay instant, the same discipline as the detached
      // initial snapshot). Waits (bounded, condition-polled) for HEAD so
      // a freshly created org publishes in THIS session once its
      // deferred snapshot lands. The in-flight promise parks on the
      // handle so a manual publish can await it instead of racing it.
      const githubHeal = (async () => {
        try {
          // D90: a local-only / disconnected org NEVER auto-publishes — the
          // flag is the user's explicit "keep this org off GitHub" answer.
          try { if (readManifest(orgManifestPath(resolved)).localOnly) return { ok: false, reason: 'local-only' } } catch { /* unreadable — heal on */ }
          for (let tries = 0; !hasHead(resolved, env) && tries < 240; tries++) {
            await new Promise((resolveTick) => setTimeout(resolveTick, 250))
          }
          if (!hasHead(resolved, env)) return { ok: false, reason: 'initial-snapshot-pending' }
          startWipNet() // deferred opens boot the WIP net + frame here
          const published = await publishOrgAndProjects(resolved, slug)
          // D95/D96: the heal's pushes run BEFORE wireFrameOnce's annotate
          // commits — this sweep is what makes "every main commit reaches
          // GitHub" true end-to-end on open (the project-001 lesson).
          const synced = await syncOrgRepos(resolved)
          return { ...published, synced }
        } catch {
          /* publish is throw-proof by contract — this is belt-and-braces */
        }
      })()

      current = {
        path: resolved,
        slug,
        manifest: opened.manifest,
        orgVersion: opened.orgVersion,
        migrated: opened.migrated,
        repoInitialised: repo.initialised,
        /** Q7: non-null when the org folder was renamed under pinned session
          * identities — the UI shows `path-moved` and resume refuses. */
        pathMoved: sessionPathDrift(resolved),
        sessions,
        archivedSessionIds: archived,
        index: { backend, rebuilt: counts !== null, counts },
        rails: { account: mirror, cairn },
        /** Detached D74 heal — the manual publish below awaits it so a
          * click never races the open-time attempt. */
        githubHeal,
        /** D74 manual publish (the menu affordance): idempotent, awaits the
          * heal first, loud not-linked / pending reasons for the UI. */
        async publishGithub() {
          if (!hasHead(resolved, env)) {
            return { ok: false, reason: 'initial-snapshot-pending: the first git snapshot of this organisation is still running — publishing unlocks the moment it completes' }
          }
          try { await githubHeal } catch { /* throw-proof */ }
          return publishOrgAndProjects(resolved, slug)
        },
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
            allSessions(resolved, env) // D98: org + project registries
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
            allSessions(resolved, env) // D98: org + project registries
              .filter((s) => s.state !== 'archived')
              .map((s) => ({ id: s.id, name: s.name, state: s.state, parkedReason: s.parkedReason, project: s.project ?? null, dshSessionId: s.dshSessionId ?? null })),
            dshLive,
          )
        },
        trashCount() {
          return listTrash(resolved).length // org-local trash: <org>/.arxa/trash
        },
        async purgeTrash(entryId) {
          // D81: hard delete of a trashed PROJECT — its GitHub repo goes
          // first (linked required, loud refusal otherwise), then the D23
          // token purge. The entry lives in THIS org's local trash.
          const entry = listTrash(resolved).find((e) => e.entryId === entryId)
          if (!entry) throw new Error('no-trash-entry: ' + entryId)
          // 2026-09-05: session entries ride the same directory but a
          // different verb — folder purge on one would drop the marker
          // without touching the parked branch (quiet restore-loss).
          if (entry.origin && entry.origin.kind === SESSION_TRASH_KIND) {
            throw new Error('session-entry: use sessiontrash.purge for session entries')
          }
          // D90: the link is required only when there IS a repo to delete.
          let repo = null
          if (entry.origin && entry.origin.slug) {
            try {
              const pm = readManifest(path.join(entry.entryPath, entry.origin.slug, 'project.json'))
              if (pm && pm.repoUrl && pm.repoOwner) repo = { owner: pm.repoOwner, name: pm.repoName || entry.origin.slug }
            } catch { /* damaged entry: purge locally, nothing remote to delete */ }
          }
          if (repo) {
            const made = await githubBridge.deleteRepo(repo.owner, repo.name)
            if (!made.ok) throw new Error('purge incomplete: GitHub deletion failed (' + (made.error || made.reason) + ') — the trash entry was kept')
          }
          return hardDelete(resolved, entryId, { confirm: hardDeleteToken(entryId) })
        },
        trashProject(projectSlug) {
          // D80 project menu: a trashed project parks in the ORG trash
          // (restorable). The GitHub repo is deliberately untouched —
          // Trash is LOCAL by contract (grilled 2026-08-30); repo deletion
          // stays a CLI-side act and is never faked here.
          const hit = [...scanWorkspace(resolved).projects.values()]
            .find((p) => p.orgId === opened.manifest.id && p.slug === projectSlug)
          if (!hit) throw new Error('unknown-project: ' + projectSlug)
          return softDelete(resolved, hit.path, { env })
        },
        /** D115 closeout (2026-09-12): EXPLICIT repo repair for a
        * hand-created project — a folder with a valid project.json but no
        * .git. Sessions route to the PROJECT repo (D98/D99) and refuse with
        * the org-snapshot wording, and until now nothing ever attached one
        * (initProjectRepo ran only from newProject). Program ruling 2: this
        * is the offered door ("Initialize Git repository" in the notice
        * surface) — never a silent attach on open or session start.
        *
        * One call, one initial commit: the inherited localOnly answer, the
        * missing frame files, and the existing contents land TOGETHER, so
        * the tree a session branches from is born whole. An existing repo
        * is an idempotent no-op.
        *
        * @returns {{ ok: true, repoPath: string, head: boolean, frame: object|null }} */
        async prepareProjectRepo(projectSlug) {
          const slug = typeof projectSlug === 'string' ? projectSlug.trim() : ''
          // Only a SCANNED project of THIS open org resolves — the same
          // lookup trashProject uses (project.json present, orgId bound).
          const hit = slug === '' ? null : [...scanWorkspace(resolved).projects.values()]
            .find((p) => p.orgId === opened.manifest.id && p.slug === slug)
          if (!hit) throw new Error('unknown-project: ' + slug)
          const repoPath = path.resolve(hit.path)
          // Root confinement + path identity (same constraint class the
          // routing layer enforces): resolve and realpath before mutation,
          // refuse reserved state dirs and anything that is or escapes
          // through a symlink. The scan only yields real subdirectories of
          // projects/, so these are belt-and-braces — cheap, and they hold
          // the line if the scan's rules ever loosen.
          const base = path.basename(repoPath)
          if (base === '.git' || base === '.arxa') {
            throw new Error('repo-repair-refused: ' + slug + ' is a reserved state directory')
          }
          try {
            if (fs.lstatSync(repoPath).isSymbolicLink()) {
              throw new Error('repo-repair-refused: ' + slug + ' is a symlink')
            }
            const orgReal = fs.realpathSync(resolved)
            const real = fs.realpathSync(repoPath)
            if (!real.startsWith(orgReal + path.sep)) {
              throw new Error('repo-repair-refused: ' + slug + ' escapes the organisation through a symlink')
            }
          } catch (err) {
            if (String(err?.message ?? err).startsWith('repo-repair-refused')) throw err
            throw new Error('repo-repair-refused: ' + slug + ' is not reachable')
          }
          // Existing usable repo → no-op (repair is for the repo-less only).
          if (isRepo(repoPath, env)) {
            return { ok: true, repoPath, head: hasHead(repoPath, env), frame: null }
          }
          // D91 inheritance rides the SAME single commit: annotate before
          // init so the local-only answer is part of the first snapshot.
          try {
            if (Boolean(readManifest(orgManifestPath(resolved)).localOnly)) {
              annotateProjectManifest(repoPath, { localOnly: true })
            }
          } catch { /* unreadable org manifest — inherit the connected default */ }
          // Missing frame files ONLY (writeFrameFiles never clobbers a
          // human edit), then ONE initProjectRepo so the existing contents
          // and the fresh frame land in a single initial commit.
          const frame = writeFrameFiles(repoPath, 'project')
          initProjectRepo(repoPath, env)
          return { ok: true, repoPath, head: hasHead(repoPath, env), frame }
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
          // Auto-name (D78, grilled 2026-08-30): 01-project, 02-project… —
          // 2-digit prefix FIRST, matching the stage-folder convention. The
          // counter reads BOTH schemes (old project-NNN pre-D78 orgs keep
          // counting from their highest number) — per-dock counter, no ids.
          let name = typeof displayName === 'string' ? displayName.trim() : ''
          if (name === '') {
            const slugs = [...scanWorkspace(resolved).projects.values()]
              .filter((p) => p.orgId === opened.manifest.id)
              .map((p) => p.slug)
            let max = 0
            for (const s of slugs) {
              const mNew = /^(\d+)-project$/.exec(s)
              const mOld = /^project-(\d+)$/.exec(s)
              if (mNew) max = Math.max(max, Number(mNew[1]))
              else if (mOld) max = Math.max(max, Number(mOld[1]))
            }
            name = String(max + 1).padStart(2, '0') + '-project'
          }
          const created = scaffoldProject(resolved, name)
          try {
            initProjectRepo(created.path, env) // idempotent repo attach
            // Part B S1: every new project repo carries the frame from its
            // first commit (stack-probe check.sh + PR template; ci.yml waits
            // for publish — wireFrameOnce adds it with the remote).
            try {
              writeFrameFiles(created.path, 'project')
              if (hasHead(created.path, env)) {
                runGit(['add', 'check.sh', '.github'], { cwd: created.path, allowFail: true })
                runGit(['commit', '-m', 'chore(ci): add the arxa frame (day-zero checks)'], { cwd: created.path, allowFail: true })
              }
            } catch { /* best-effort */ }
            // D91 inheritance: a LOCAL-ONLY org creates LOCAL-ONLY projects
            // — no repo, no push; project.connect links it manually when
            // wanted. A connected org inherits the D73 behavior: publish on
            // create. The manifest commit mirrors publishRepoOnce (D78: an
            // uncommitted annotation dirties the tree and the next open's
            // clean-tree gate refuses the org).
            let orgLocalOnly = false
            try { orgLocalOnly = Boolean(readManifest(orgManifestPath(resolved)).localOnly) } catch { /* unreadable — inherit the connected default */ }
            if (orgLocalOnly) {
              const manifestName = path.basename(projectManifestPath(created.path))
              annotateProjectManifest(created.path, { localOnly: true })
              try {
                runGit(['add', manifestName, 'check.sh', '.github'], { cwd: created.path, allowFail: true })
                runGit(['commit', '-m', 'chore(project): born into a local-only organisation', '--', manifestName], { cwd: created.path, allowFail: true })
              } catch { /* best-effort — annotation still stands in the worktree */ }
            } else {
              // D73: the whole publish half (linked? → create → origin →
              // push --all → manifest annotation) is shared with the org path.
              await publishRepoOnce(created.path, created.slug, 'project')
            }
            try {
              created.manifest = readManifest(projectManifestPath(created.path))
            } catch { /* annotation read-back is presentation */ }
          } catch (err) {
            annotateProjectManifest(created.path, {
              githubStatus: 'publish-failed: ' + String(err?.message ?? err),
            })
          }
          return created
        },
        async newSession(name, workspace) {
          // Sessions branch from HEAD; until the initial snapshot lands there
          // is nothing to branch from. That guard now lives in routing
          // (`resolveSessionRepo`, below) so it checks the repo the session
          // ACTUALLY lands in — a fresh project can lack HEAD while the org
          // has one. Same message, so the rows client keeps recognising it.
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
          // D79: slugs preserve case — "projects/POLO/00-moodboard" is a
          // legal workspace key and must parse.
          //
          // TRACK BINDING (grilled 2026-09-08, sessions-bound-to-tracks.md):
          // inside a project a session is bound to what it works ON, not just
          // to the phase of work. The nine numbered stages therefore take a
          // session only under a TRACK — `<stage>/application` or
          // `<stage>/website` — and the bare stage container is refused. Both
          // track folders are scaffolded under every container of every
          // project in every template version (projectDirsV2/V3/V4), so this
          // costs no migration and no disk probe. `notes` is the exception
          // (Q2/Q7): not a pipeline stage, so it binds to itself and its own
          // two track folders are NOT session points — one door per container.
          // Depth is invisible to git routing (resolveSessionRepo reads only
          // `projects` and the slug), so nothing below changes.
          const projectScope =
            /^projects\/([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)(?:\/([A-Za-z0-9][A-Za-z0-9._-]*))?$/.exec(ws)
          if (projectScope) {
            const [, slug, container, track] = projectScope
            const hit = [...scanWorkspace(resolved).projects.values()]
              .find((p) => p.orgId === opened.manifest.id && p.slug === slug)
            if (!hit || !template.projectContainers.includes(container)) {
              throw new Error('unknown-workspace: ' + ws)
            }
            // v4 names them `projectTracks`; v2/v3 carry the same two strings
            // under `projectTargets`, so this reads correctly on every version.
            const tracks = template.projectTracks ?? template.projectTargets ?? []
            if (container === 'notes') {
              if (track !== undefined) throw new Error('unknown-workspace: ' + ws)
            } else if (track === undefined) {
              throw new Error(
                'workspace-needs-track: "' + ws + '" is a stage, not a session home — ' +
                  'create the session in ' + ws + '/application or ' + ws + '/website',
              )
            } else if (!tracks.includes(track)) {
              throw new Error('unknown-workspace: ' + ws)
            }
            projectSlug = hit.slug
          } else if (!template.fixedWorkspaces.includes(ws)) {
            // G2 (grilled 2026-09-06): a bare dock's first-level subfolder is a
            // workspace row too ('notes/ideas'), so it must be able to host a
            // session. The allowance is a DISK check here rather than a wider
            // template vocabulary — these folders are the user's, not the
            // scaffold's. routeDock still owns the repo decision, so account/**
            // stays refused and an unknown dock still routes nowhere.
            const bare = /^([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(ws)
            const dock = bare === null ? undefined : template.docks.find((d) => d.slug === bare[1])
            const isBareDock = dock !== undefined && dock.slug !== 'projects' && (dock.containers ?? []).length === 0
            let isDir = false
            if (isBareDock) {
              try { isDir = fs.statSync(path.join(resolved, bare[1], bare[2])).isDirectory() } catch { isDir = false }
            }
            if (!isDir) throw new Error('unknown-workspace: ' + ws)
          }
          // D98/D99: the workspace row decides WHICH repo owns this session.
          // A project workspace attaches branch + worktree to the project
          // repo so project history actually receives the work (B2). Routing
          // refuses loudly — account/, unknown docks, and a target without
          // HEAD — and never silently falls back to the org repo.
          const route = resolveSessionRepo(resolved, ws, { env })
          const repoPath = route.repoPath
          // Auto-name (grilled 2026-08-30): singular(folder)+counter, no
          // ids — the branch/worktree keep the session id as stable key.
          // The counter reads the OWNING repo's registry: two projects each
          // get their own design-001 rather than colliding through the org.
          // Q2 (2026-09-03): the id is minted from the workspace context —
          // `note-wt-260903-001` — so the worktree directory and the branch
          // read as the thing they are. Q3: when the caller supplies no
          // name, `name` DEFAULTS TO THE ID rather than to the old
          // singular+counter, so one string reads across the sidebar row,
          // the breadcrumb tail and the header title. An explicit name still
          // wins and simply diverges from the id (rename semantics, D-2026-08-30).
          // Uniqueness must span EVERY registry, not just this repo's: the id
          // becomes the dsh session id (`arxa-<id>`), and dsh has one session
          // store for the whole app — two projects minting the same readable
          // id would put two arxa sessions on one conversation. So the mint
          // reads the cross-registry aggregate. The counter still keys on the
          // workspace string (unique per project: `projects/alpha/notes` vs
          // `projects/beta/notes`), so numbering inside a container is
          // natural; the day-namespace is shared, which is the deliberate
          // trade for readable ids (supersedes D98's per-repo counters —
          // those were safe only while ids were opaque and separate).
          // Identity = the relative disk path, minted once and stored; never
          // re-derived from the live folder name afterwards (Q2/Q7). The org
          // segment comes from the org FOLDER, verbatim (Q5) — the add/create
          // guard keeps folder names unique, which is what makes the dsh key
          // unique across orgs.
          const sid = mintSessionPath({
            org: path.basename(resolved),
            workspace: ws,
            name,
            sessions: allSessions(resolved, env),
            // 2026-09-05 (trash-flow collision, seen in the archives
            // probe): a trashed session's row is gone but its BRANCH still
            // parks in the repo — an id minted off the registry alone can
            // collide with it and `worktree add` dies ("a branch named X
            // already exists"). Feed the trash's session ghosts (id+name
            // snapshots) so both counters skip identities that are still
            // parked. A purged session leaves the trash and its name frees.
            ghosts: ghostSessions(resolved),
          })
          // orgPath: a project session's branch lives in the project repo, its
          // checkout under the ORG's single `.arxa/worktrees/` root.
          const session = openSession(repoPath, {
            id: sid,
            orgPath: resolved,
            name: typeof name === 'string' && name.trim() !== '' ? name.trim() : undefined,
            project: projectSlug,
            workspace: ws,
            env,
          })
          // Phase D (D71): AFTER branch+worktree exist, spawn the dsh session
          // with cwd = the worktree path (dsh sessions.create cwd contract)
          // and store its id on the registry row. Unavailable dsh degrades to
          // registry-only with a loud annotation — never a hard failure.
          const spawned = await dshBridge.spawn({ cwd: session.worktree, name: session.name, id: session.id })
          dshLive = await dshBridge.list()
          syncWipWatchPaths() // session set changed — re-watch
          // Task 10 (A4): automatic-if-Docker-is-present. The bridge clones
          // the exact session branch into a private volume and starts the
          // hardened container; results return through the host recovery
          // ref, and finishSession refuses teardown while any container
          // commit is unrecovered (lib/finish.js). Never a session-fatal
          // step: degradation annotates (S3).
          const container = await sandboxBridge.start({ repoPath, branch: session.branch, sessionId: session.id })
          return annotateSession(
            repoPath,
            session.id,
            {
              ...(spawned.ok
                ? { dshSessionId: spawned.id, dshStatus: null }
                : { dshSessionId: null, dshStatus: spawned.reason ?? 'dsh-unavailable' }),
              ...(container.ok
                ? { containerTier: container.tier ?? 'A4', containerStatus: null }
                : { containerTier: null, containerStatus: container.reason ?? 'sandbox-unavailable' }),
            },
            env,
          )
        },
        /** Rename (grilled 2026-08-30): the registry name is the single
        * display truth — every arxa surface reads it. Git never moves:
        * branch + worktree stay keyed by the session id. */
        async renameSession(id, name) {
          const title = typeof name === 'string' ? name.trim() : ''
          if (title === '') throw new Error('name-required: a session name cannot be empty')
          // D98: the id may live in a project registry — look across all of
          // them, and let annotateSession's own preamble find the owner.
          const row = allSessions(resolved, env).find((s) => s.id === id)
          if (!row) throw new Error('unknown-session: ' + id)
          const out = annotateSession(resolved, id, { name: title }, env)
          // Q1 follow-up (2026-09-03): the dsh header title follows the
          // registry name — re-pin the live conversation. Best-effort.
          if (row.dshSessionId) await dshBridge.retitle(row.dshSessionId, title)
          return out
        },
        async resumeSession(id, opts = {}) {
          // Boot trace (2026-09-07): one line per resume naming what each
          // step cost. Read next to the client's `trace boot` line.
          const rt0 = Date.now()
          const laps = []
          const lap = (n) => laps.push(n + '=' + (Date.now() - rt0))
          // Q7: pinned identity vs the folder on disk. Refuse rather than
          // resume onto a path that no longer describes reality — the branch,
          // the worktree and the dsh key all carry the old name.
          const drift = sessionPathDrift(resolved)
          if (drift) {
            throw new Error(
              `path-moved: these sessions were created under "${drift.expected.join('", "')}" ` +
              `but this organisation's folder is now named "${drift.actual}". Rename it back to ` +
              `"${drift.expected[0]}" to resume, or archive the sessions.`,
            )
          }
          // Sessions branch from HEAD; until the initial snapshot lands
          // there is nothing to branch from. Loud, human, and the rows
          // client normally prevents reaching this at all (CTA disabled).
          if (!hasHead(resolved, env)) throw new Error('initial-snapshot-pending: the first git snapshot of this organisation is still running — sessions unlock the moment it completes')
          // D98: a project session's row lives in the project registry.
          // reviveSession's own preamble routes the git work; this lookup
          // only needs the dsh annotation, so read the aggregate.
          const row = allSessions(resolved, env).find((s) => s.id === id)
          lap('head+rows')
          // Q3 (grilled 2026-09-02): a BOOT resume of a session whose
          // conversation never received a user message is not a resume —
          // the row is dropped (dsh archive, worktree, branch, registry
          // row) and the caller lands on the welcome hero. Only a POSITIVE
          // "no message" verdict drops; dsh unavailable/unknown keeps the
          // row (never destroy on doubt). Rows without a dshSessionId were
          // never conversed in — nothing to judge, they resume as before.
          if (opts?.dropIfEmpty === true && row?.dshSessionId) {
            const probe = await dshBridge.hasUserMessage(row.dshSessionId)
            lap('probe')
            if (probe.ok && probe.value === false) {
              await dshBridge.archive([row.dshSessionId])
              const dropped = dropSession(resolved, id, env)
              dshLive = await dshBridge.list()
              syncWipWatchPaths() // session set changed — re-watch
              return { ...dropped, dropped: true, state: 'dropped' }
            }
          }
          const out = reviveSession(resolved, id, env)
          lap('revive')
          // Re-attach the dsh conversation (focus/open by dshSessionId) when
          // the row carries one. Rows born while dsh was unavailable (or
          // pre-Phase-D) have none — SPAWN the engine conversation now
          // (cwd = the worktree) so every opened session owns one; the
          // sidebar client then focuses it via the client sessions service
          // (2026-08-30). Best-effort: dsh absence never blocks git revival.
          if (row?.dshSessionId) {
            await dshBridge.attach(row.dshSessionId)
            // Q1 follow-up (2026-09-03): re-pin the header title to the
            // registry name on every resume (boot restore + row click both
            // route through session.open). Sessions born before the spawn
            // pin existed kept dsh's auto title — seen live on note-002.
            await dshBridge.retitle(row.dshSessionId, typeof out?.name === 'string' ? out.name : row.name)
            lap('attach+retitle')
          } else if (out?.worktree) {
            const spawned = await dshBridge.spawn({ cwd: out.worktree, name: out.name })
            if (spawned.ok) await annotateSession(resolved, id, { dshSessionId: spawned.id, dshStatus: null }, env)
          }
          dshLive = await dshBridge.list()
          lap('list')
          console.log('[arxa-boot] resume ' + id + ' ' + laps.join(' '))
          syncWipWatchPaths() // session set changed — re-watch
          return out
        },
        async archiveSession(id, opts = {}) {
          // Sessions branch from HEAD; until the initial snapshot lands
          // there is nothing to branch from. Loud, human, and the rows
          // client normally prevents reaching this at all (CTA disabled).
          if (!hasHead(resolved, env)) throw new Error('initial-snapshot-pending: the first git snapshot of this organisation is still running — sessions unlock the moment it completes')
          // D39/D40 archive: flag out of active views, WIP-commit, prune the
          // worktree, keep the branch. The rows face then holds it back.
          // D98: aggregate lookup — a project session's row is not in the org
          // registry, and an undefined row here silently skipped dsh archive.
          const row = allSessions(resolved, env).find((s) => s.id === id)
          // Q14: record the closing stages BEFORE the worktree goes. The
          // registry is the record and needs no network, so an offline org
          // keeps a complete history and simply has nowhere to publish it.
          try {
            recordStage(row?.repoPath ?? resolved, id, {
              stage: 'archived', actor: String(opts?.actor ?? 'arxa studio'),
              detail: 'worktree pruned, branch kept (D39: archive is never delete)',
            }, env)
          } catch { /* the archive itself must never fail on its own bookkeeping */ }
          const out = archiveSessionBranch(resolved, id, env)
          // Remote branch (cleanup stage, 2026-09-03 smoke): a session whose
          // branch is already merged into main has nothing left on GitHub —
          // its PR is merged, so drop the remote branch. An unmerged branch
          // may still back an open PR (deleting it would close the PR), so
          // it is kept unless the caller says `dropRemote` (close-without-
          // merge path). Local branch is always kept (D39: archive ≠ delete).
          out.remoteBranch = await dropRemoteSessionBranch(resolved, row, opts).catch((err) => 'failed: ' + String(err?.message ?? err))
          try {
            recordStage(row?.repoPath ?? resolved, id, {
              stage: 'cleaned', actor: String(opts?.actor ?? 'arxa studio'),
              result: String(out.remoteBranch ?? 'kept').startsWith('failed') ? 'failed' : 'ok',
              detail: 'remote branch: ' + String(out.remoteBranch ?? 'kept'),
            }, env)
          } catch { /* bookkeeping never fails the cleanup */ }
          // Feed dsh's archivedSessionIds set (D39 contract): the archived
          // session vanishes from dsh active views; its transcript persists
          // dsh-side. Best-effort.
          if (row?.dshSessionId) await dshBridge.archive([row.dshSessionId])
          dshLive = await dshBridge.list()
          syncWipWatchPaths() // session set changed — re-watch
          return out
        },
        /** ---- archives row (2026-09-05 grill) --------------------------------
         * Archives never destroys: Restore = bare revival, Move-to-Trash =
         * a logical entry (softDeleteSession) + registry-row removal. The
         * destructive door lives in the TRASH (sessiontrash.purge), keeping
         * D47's "hard delete only from trash" one-door law. */
        async reviveSessionOnly(id) {
          // Archives row Restore: git revival ONLY — no dsh attach, no
          // retitle, no dropIfEmpty probing. The row reappears under its
          // workspace (state open); the conversation attaches when the user
          // clicks it (session.open → resumeSession, the existing path).
          if (!hasHead(resolved, env)) {
            throw new Error('initial-snapshot-pending: the first git snapshot of this organisation is still running — sessions unlock the moment it completes')
          }
          const out = reviveSession(resolved, id, env)
          dshLive = await dshBridge.list()
          syncWipWatchPaths() // session set changed — re-watch
          return out
        },
        async trashArchivedSession(id, opts = {}) {
          // Archives row Move-to-Trash. Only ARCHIVED sessions may enter —
          // the live tree keeps its Archive menu, and a parked-but-unarchived
          // session must not slip into the destructive tier unreviewed.
          const row = allSessions(resolved, env).find((s) => s.id === id)
          if (!row) throw new Error('unknown-session: ' + id)
          if (row.state !== 'archived') {
            throw new Error(`not-archived: session "${id}" is ${row.state} — archive it first (D47: the trash door opens only from the archives tier)`)
          }
          // Entry FIRST, row second (crash-safe ordering): an entry without
          // a row is restorable; a row without an entry is an orphan.
          const entry = softDeleteSession(resolved, { repoPath: row.repoPath, session: row })
          const removed = removeSessionRow(row.repoPath, id, env)
          try {
            recordStage(row.repoPath ?? resolved, id, {
              stage: 'trashed', actor: String(opts?.actor ?? 'arxa studio'),
              detail: `entry ${entry.entryId} — branch parked until the trash purge (D40)`,
            }, env)
          } catch { /* bookkeeping never fails the move */ }
          dshLive = await dshBridge.list()
          syncWipWatchPaths() // session set changed — re-watch
          return { entryId: entry.entryId, session: removed, branch: entry.origin.branch }
        },
        restoreSessionEntry(entryId) {
          // Trash row → Archives: the registry row returns verbatim (state
          // 'archived', exactly where it left). The branch never moved —
          // but verify it still exists so restore never resurrects a row
          // whose git body was deleted by hand.
          const entry = listTrash(resolved).find((e) => e.entryId === entryId)
          if (!entry) throw new Error('no-trash-entry: ' + entryId)
          if (!entry.origin || entry.origin.kind !== SESSION_TRASH_KIND) {
            throw new Error('not-a-session-entry: ' + entryId)
          }
          const repoPath = path.resolve(resolved, entry.origin.repoPath || '.')
          if (!isRepo(repoPath)) {
            throw new Error(`repo-gone: ${entry.origin.repoPath} no longer exists — the owning project may itself be in the trash (restore that first)`)
          }
          if (entry.origin.branch) {
            const tip = runGit(['rev-parse', '--verify', entry.origin.branch], { cwd: repoPath, env, allowFail: true })
            if (tip === null) {
              throw new Error(`branch-gone: parked branch "${entry.origin.branch}" no longer exists in ${entry.origin.repoPath} — the session cannot be revived`)
            }
          }
          const row = restoreSessionRow(repoPath, entry.origin.session, env)
          const deleted = hardDelete(resolved, entryId, { confirm: hardDeleteToken(entryId) })
          try {
            recordStage(repoPath, row.id, {
              stage: 'restored', actor: 'arxa studio',
              detail: `restored from trash entry ${entryId} into the archives row`,
            }, env)
          } catch { /* bookkeeping never fails the restore */ }
          return { sessionId: row.id, state: row.state ?? 'archived', deleted: deleted.deleted }
        },
        /** Purge-modal data (the CI/CD-aware half): what deleting forever
         * actually touches — the parked branch, the owning repo's GitHub
         * coordinates when published, and the OPEN PR riding that branch
         * (deleting the branch closes it). Pure read; never blocks. */
        async precheckSessionEntry(entryId) {
          const entry = listTrash(resolved).find((e) => e.entryId === entryId)
          if (!entry) throw new Error('no-trash-entry: ' + entryId)
          if (!entry.origin || entry.origin.kind !== SESSION_TRASH_KIND) {
            throw new Error('not-a-session-entry: ' + entryId)
          }
          const repoPath = path.resolve(resolved, entry.origin.repoPath || '.')
          const out = {
            entryId,
            sessionId: entry.origin.sessionId,
            name: entry.origin.name,
            branch: entry.origin.branch,
            repoPath: entry.origin.repoPath,
            repoGone: !isRepo(repoPath),
            repo: null,
            openPr: null,
          }
          if (out.repoGone) return out // purge degrades to entry removal
          const manifestFile = repoPath === path.resolve(resolved)
            ? orgManifestPath(resolved)
            : projectManifestPath(repoPath)
          let manifest = {}
          try { manifest = readManifest(manifestFile) } catch { /* unpublished repo — no remote half */ }
          if (manifest?.repoOwner && manifest?.repoName && getOrigin(repoPath, env) !== null) {
            out.repo = { owner: manifest.repoOwner, name: manifest.repoName }
            // The live CI/CD check (the modal's warning line): an open PR
            // backed by this branch closes the moment the branch dies.
            const prs = await githubBridge.prListForHead(manifest.repoOwner, manifest.repoName, entry.origin.branch)
            if (prs.ok && Array.isArray(prs.prs) && prs.prs.length > 0) {
              const pr = prs.prs[0]
              out.openPr = { number: pr.number ?? null, title: pr.title ?? null, url: pr.html_url ?? null }
            }
          }
          return out
        },
        async purgeSessionEntry(entryId, opts = {}) {
          // The ONE destructive door for a session (D47): remote-first when
          // the owning repo is published and the branch still has a remote
          // half, then the local refs, then the entry. A remote failure
          // THROWS with the entry kept — idempotent retry, same posture as
          // project purge. No origin → local-only, no link required.
          const entry = listTrash(resolved).find((e) => e.entryId === entryId)
          if (!entry) throw new Error('no-trash-entry: ' + entryId)
          if (!entry.origin || entry.origin.kind !== SESSION_TRASH_KIND) {
            throw new Error('not-a-session-entry: ' + entryId)
          }
          const repoPath = path.resolve(resolved, entry.origin.repoPath || '.')
          const out = { entryId, sessionId: entry.origin.sessionId, remoteBranch: 'no-origin', refs: null, deleted: null }
          if (!isRepo(repoPath)) {
            // The owning project travelled into the trash whole — its
            // branches ride the project entry and die with ITS purge. Here
            // only the marker can go.
            out.refs = { id: entry.origin.sessionId, branch: entry.origin.branch, branchDropped: false, baseRefDropped: false, repoGone: true }
          } else {
            if (entry.origin.branch && getOrigin(repoPath, env) !== null && !opts?.localOnly) {
              const manifestFile = repoPath === path.resolve(resolved)
                ? orgManifestPath(resolved)
                : projectManifestPath(repoPath)
              let manifest = {}
              try { manifest = readManifest(manifestFile) } catch { /* unpublished — no remote coordinates */ }
              if (manifest?.repoOwner && manifest?.repoName) {
                const made = await githubBridge.deleteBranch(manifest.repoOwner, manifest.repoName, entry.origin.branch)
                if (!made.ok) {
                  throw new Error('purge incomplete: remote branch deletion failed (' + (made.error || made.reason) + ') — the trash entry was kept')
                }
                out.remoteBranch = made.alreadyGone ? 'already-gone' : 'deleted'
              }
            }
            out.refs = dropSessionRefs(repoPath, {
              id: entry.origin.sessionId,
              branch: entry.origin.branch,
              // The manifest snapshot's worktree: normally already pruned at
              // archive time, but a crash between archive steps can leave it
              // holding the branch checked out — dropSessionRefs removes it
              // first so `branch -D` cannot be refused.
              worktree: entry.origin.session?.worktree ?? null,
            }, env)
          }
          out.deleted = hardDelete(resolved, entryId, { confirm: hardDeleteToken(entryId) })
          try {
            recordStage(repoPath, entry.origin.sessionId, {
              stage: 'purged', actor: String(opts?.actor ?? 'arxa studio'),
              result: 'ok',
              detail: `branch ${entry.origin.branch ?? '(none)'} — remote: ${out.remoteBranch}`,
            }, env)
          } catch { /* bookkeeping never fails the purge */ }
          dshLive = await dshBridge.list()
          syncWipWatchPaths() // session set changed — re-watch
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
              // Session entries are NOT folder moves — routing one through
              // restoreFromTrash would fail on its missing payload; route
              // them to their own verb instead (all-at-once stays honest).
              if (entry.origin && entry.origin.kind === SESSION_TRASH_KIND) {
                try {
                  const r = current.restoreSessionEntry(entry.entryId)
                  restored.push({ entryId: entry.entryId, restoredPath: 'session:' + r.sessionId })
                } catch (e) {
                  failed.push({ entryId: entry.entryId, error: String(e?.message ?? e) })
                }
                continue
              }
              try {
                const r = restoreFromTrash(resolved, entry.entryId, { env, ...opts })
                restored.push({ entryId: entry.entryId, restoredPath: r.restoredPath })
              } catch (e) {
                failed.push({ entryId: entry.entryId, error: String(e?.message ?? e) })
              }
            }
            return { restored, failed }
          }
          // Single-entry restore: a session entry has its own verb (the
          // payload is a registry row, not a folder).
          const one = listTrash(resolved).find((e) => e.entryId === entryId)
          if (one && one.origin && one.origin.kind === SESSION_TRASH_KIND) {
            return current.restoreSessionEntry(entryId)
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
    // D80: case-only renames hop through a temp name (same directory on
    // case-insensitive filesystems); every other collision stays an error.
    const caseOnly = newSlug.toLowerCase() === oldSlug.toLowerCase()
    if (!caseOnly && fs.existsSync(newPath)) {
      throw new Error('renameOrg: destination already exists: ' + newPath)
    }
    // H1 (2026-09-03): the existsSync above only catches a collision in the
    // SAME directory. Renaming /a/FOO → /a/RESTO while /b/RESTO exists passed
    // it happily, and both orgs then minted `RESTO/...` session ids — one dsh
    // conversation key, two orgs, engine dead at next boot. createOrg and
    // addOrg have always enforced the folder-name invariant; rename never did.
    assertOrgFolderNameFree(newPath, oldPath)
    // D80: pre-flight the GitHub rename BEFORE the move — a taken name
    // aborts with the org untouched; unverifiable degrades to the net.
    const ghManifest = readManifest(orgManifestPath(oldPath))
    const st80 = await githubBridge.status()
    const linked80 = Boolean(st80.ok && st80.linked)
    let ride80 = 'none'
    if (ghManifest.repoUrl) {
      ride80 = linked80 && ghManifest.repoOwner ? 'patch' : 'pending'
      if (ride80 === 'patch') {
        const taken = await githubBridge.repoNameTaken(ghManifest.repoOwner, newSlug)
        if (taken.ok && taken.taken) {
          throw new Error('renameOrg: GitHub repo name already taken: ' + ghManifest.repoOwner + '/' + newSlug)
        }
        if (!taken.ok) ride80 = 'pending'
      }
    }

    if (caseOnly) {
      const tmpPath = oldPath + '-case-tmp'
      fs.renameSync(oldPath, tmpPath)
      fs.renameSync(tmpPath, newPath)
    } else {
      fs.renameSync(oldPath, newPath)
    }
    try {
      // Worktrees register ABSOLUTE paths; after the folder move each one
      // needs an explicit repair (bare 'worktree repair' fatals on the
      // first stale gitdir). Best-effort; prune is FORBIDDEN (D40).
      try {
        // Walk to the REAL checkouts. A session identity is a path now, so the
        // top-level entry under the worktrees root is an intermediate folder
        // (the org segment) and repairing it is a silent no-op — the actual
        // checkout sits two or more levels down, keeping a gitlink that still
        // points at the pre-rename path. listWorktreeDirs recurses to the
        // directories that are genuinely worktrees.
        // A worktree is repaired by the repo that OWNS it, and a project
        // session's checkout lives under the org root while belonging to the
        // project repo (Q3a). Its identity path says which: `<org>/projects/
        // <slug>/…` is the project's, anything else is the org's.
        const wtRoot = path.join(newPath, '.arxa', 'worktrees')
        for (const rel of listWorktreeDirs(wtRoot)) {
          const seg = rel.split('/')
          const owner = seg[1] === 'projects' && seg[2]
            ? path.join(newPath, 'projects', seg[2])
            : newPath
          runGit(['worktree', 'repair', path.join(wtRoot, ...seg)], { cwd: owner, env, allowFail: true })
        }
      } catch {
        /* repair is best-effort; nothing is ever pruned (D40) */
      }
      try {
        removeRecent(oldPath, env) // recents: drop old path …
      } catch { /* recents are advisory */ }
      try {
        touchRecent(newPath, env) // … and record the new one
        rememberOrgName(newPath, env) // …and claim the new folder name (H1)
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
      // D80: ride the GitHub rename now that the move succeeded — failure
      // lands in repoRenamePending (the heal consumes it), never in a
      // thrown-away local move.
      let originUpdated80 = false
      let pending80 = false
      if (ride80 !== 'none') {
        const fields = {}
        if (ride80 === 'patch') {
          const made = await githubBridge.renameRepo(ghManifest.repoOwner, ghManifest.repoName || oldSlug, newSlug)
          if (made.ok) {
            fields.repoUrl = made.repo.repoUrl
            fields.repoName = newSlug
            fields.githubStatus = 'published'
            try {
              setOrigin(newPath, made.repo.repoUrl, env)
              originUpdated80 = true
            } catch { /* canonical URL recorded in the manifest */ }
          } else {
            fields.repoRenamePending = true
          }
        } else {
          fields.repoRenamePending = true
        }
        if (Object.keys(fields).length > 0) {
          pending80 = fields.repoRenamePending === true
          annotateOrgManifest(newPath, fields)
          try {
            runGit(['add', 'org.json'], { cwd: newPath, env, allowFail: true })
            runGit(['commit', '-m', 'chore(org): rename ' + oldSlug + ' to ' + newSlug, '--', 'org.json'], { cwd: newPath, env, allowFail: true })
          } catch { /* best-effort — the annotation lesson (D78) */ }
        }
      }
      let finalManifest = manifest
      try { finalManifest = readManifest(orgManifestPath(newPath)) } catch { /* keep the pre-ride read */ }
      return { path: newPath, slug: newSlug, manifest: finalManifest, moved: true, originUpdated: originUpdated80, repoRenamePending: pending80 }
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
    // D80: a case-only rename (polo → POLO) resolves onto the SAME
    // directory on case-insensitive filesystems — the plain guard would
    // refuse it. It is legal, handled by the internal two-hop below.
    const caseOnly = newSlug.toLowerCase() === oldSlug.toLowerCase() && newSlug !== oldSlug
    if (newSlug !== oldSlug && !caseOnly && fs.existsSync(newPath)) {
      throw new Error('renameProject: destination already exists: ' + newPath)
    }

    const manifest = readManifest(manifestFile)
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // D80: resolve the GitHub side BEFORE the local move — a taken name
    // aborts here and leaves the project untouched. An unverifiable check
    // (unlinked / unavailable face) degrades to the pending net, never a
    // silent go.
    const st = await githubBridge.status()
    const linked = Boolean(st.ok && st.linked)
    const hasRepo = Boolean(manifest.repoUrl)
    let ride = 'none' // 'patch' | 'pending' | 'none'
    if (hasRepo && newSlug !== oldSlug) {
      ride = linked && manifest.repoOwner ? 'patch' : 'pending'
      if (ride === 'patch') {
        const taken = await githubBridge.repoNameTaken(manifest.repoOwner, newSlug)
        if (taken.ok && taken.taken) {
          throw new Error('renameProject: GitHub repo name already taken: ' + manifest.repoOwner + '/' + newSlug)
        }
        if (!taken.ok) ride = 'pending'
      }
    }
    let originUpdated = false
    if (newSlug !== oldSlug) {
      if (caseOnly) {
        const tmpPath = path.join(org, 'projects', oldSlug + '-case-tmp')
        fs.renameSync(oldPath, tmpPath)
        fs.renameSync(tmpPath, newPath)
      } else {
        fs.renameSync(oldPath, newPath)
      }
    }
    try {
      manifest.name = newName
      manifest.slug = newSlug
      if (hasRepo && newSlug !== oldSlug) {
        if (ride === 'patch') {
          const made = await githubBridge.renameRepo(manifest.repoOwner, manifest.repoName || oldSlug, newSlug)
          if (made.ok) {
            manifest.repoUrl = made.repo.repoUrl
            manifest.repoName = newSlug
            delete manifest.repoRenamePending
            manifest.githubStatus = 'published'
            try {
              setOrigin(newPath, made.repo.repoUrl, env)
              originUpdated = true
            } catch { /* best-effort: the canonical URL is in the manifest */ }
          } else {
            manifest.repoRenamePending = true // the heal ride PATCHes it (D80 net)
          }
        } else {
          manifest.repoRenamePending = true
          if (linked && manifest.repoOwner) {
            try {
              setOrigin(
                newPath,
                manifest.repoUrl.replace(new RegExp('/' + esc(oldSlug) + '(\\\\.git)?$'), '/' + newSlug),
                env,
              )
              originUpdated = true
            } catch { /* the heal ride owns the remote rename */ }
          }
        }
      }
      writeManifest(projectManifestPath(newPath), manifest)
      // D78 annotation lesson: commit the manifest the moment it changes —
      // dirty project repos would fail the next open's clean-tree gate.
      try {
        runGit(['add', 'project.json'], { cwd: newPath, env, allowFail: true })
        runGit(['commit', '-m', 'chore(project): rename ' + oldSlug + ' to ' + newSlug, '--', 'project.json'], { cwd: newPath, env, allowFail: true })
      } catch { /* best-effort — the manifest edit still stands */ }

      let rekeyed = 0
      try {
        rekeyed = rekeySessionsProject(org, oldSlug, newSlug, env)
      } catch { /* registry optional — no sessions yet is a normal state */ }

      return { path: newPath, slug: newSlug, manifest, rekeyed, originUpdated, repoRenamePending: manifest.repoRenamePending === true }
    } catch (err) {
      fs.renameSync(newPath, oldPath) // all-or-nothing (D72)
      throw err
    }
  }
  // ---- D81: the org itself is trashable. D69 in-place layout: the org
  // folder IS its own workspace root, so the trash scope is the PARENT
  // directory (<parent>/.arxa/trash, a scanner-skipped dot-dir) and a
  // small index in ARXA_HOME tracks trashed orgs across parents.
  function orgTrashIndexPath() {
    return path.join(arxaHome(env), 'org-trash.json')
  }
  function readOrgTrashIndex() {
    try { return JSON.parse(fs.readFileSync(orgTrashIndexPath(), 'utf8')) } catch { return [] }
  }
  function writeOrgTrashIndex(list) {
    fs.mkdirSync(path.dirname(orgTrashIndexPath()), { recursive: true })
    fs.writeFileSync(orgTrashIndexPath(), JSON.stringify(list, null, 2) + '\n')
  }
  /** Repos a trashed org owns: the org repo + each published project.
   * Pure manifest reads inside the trash entry — no network. */
  function orgTrashEntryRepos(entryPath) {
    const repos = []
    const slug = fs.readdirSync(entryPath).find((d) => fs.existsSync(path.join(entryPath, d, 'org.json')))
    if (!slug) return repos
    const orgDir = path.join(entryPath, slug)
    const read = (p) => { try { return readManifest(p) } catch { return null } }
    // A manifest without repo fields (never annotated, or torn) used to leave
    // that repo alive on GitHub after the purge (2026-09-07 audit). The git
    // remote of the folder's OWN repo is the fallback source of truth.
    const fromRemote = (dir) => {
      if (!fs.existsSync(path.join(dir, '.git'))) return null
      const url = runGit(['config', '--get', 'remote.origin.url'], { cwd: dir, env, allowFail: true })
      const m = /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(url ?? '').trim())
      return m ? { owner: m[1], name: m[2] } : null
    }
    const om = read(path.join(orgDir, 'org.json'))
    const orgRepo = om && om.repoUrl && om.repoOwner ? { owner: om.repoOwner, name: om.repoName || slug } : (om?.localOnly ? null : fromRemote(orgDir))
    if (orgRepo) repos.push({ ...orgRepo, kind: 'org' })
    const projectsDir = path.join(orgDir, 'projects')
    for (const d of fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir) : []) {
      const pDir = path.join(projectsDir, d)
      const pm = read(path.join(pDir, 'project.json'))
      const pr = pm && pm.repoUrl && pm.repoOwner ? { owner: pm.repoOwner, name: pm.repoName || d } : (pm?.localOnly ? null : fromRemote(pDir))
      if (pr && !repos.some((r) => r.owner === pr.owner && r.name === pr.name)) repos.push({ ...pr, kind: 'project', project: d })
    }
    return repos
  }

  /** Move the org itself into its parent trash (D81). Local-only:
   * GitHub repos are untouched — the trash is restorable by contract.
   * Closes the open handle first (single open-handle contract).
   * D89: the trash entry is the purge contract's ONLY manifest snapshot,
   * so an in-flight open-time publish MUST land before the folder freezes
   * (the D88 orphan: create→trash inside a second froze a bare org.json
   * while the detached heal had already created the GitHub repo — the
   * later purge found no repos and deleted nothing). Bounded grace: a
   * broken snapshot must never hang the trash verb. */
  async function trashOrg(orgPath, { displayName } = {}) {
    const resolved = path.resolve(orgPath)
    if (!fs.existsSync(orgManifestPath(resolved))) throw new Error('unknown-org: ' + resolved)
    const bounded = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))])
    if (current && current.path === resolved && current.githubHeal) {
      try { await bounded(current.githubHeal, 10000) } catch { /* throw-proof */ }
    } else {
      // Cold mid-publish org (created seconds ago, already switched away):
      // complete the freeze best-effort so this window can't orphan either.
      let pending = null
      // The MANIFEST, not the folder: readManifest(resolved) threw EISDIR on
      // every non-current org, so trash treated each as bare, published it to
      // GitHub (repo + runner) and then waited out the 15s bound (2026-09-07
      // smoke: a localOnly org gained a repo on the way into the trash).
      try { pending = readManifest(orgManifestPath(resolved)) } catch { /* treated as bare */ }
      if (!pending?.repoUrl && !pending?.localOnly && hasHead(resolved, env)) {
        try { await bounded(publishOrgAndProjects(resolved, path.basename(resolved)), 15000) } catch { /* throw-proof */ }
      }
    }
    if (current && current.path === resolved) closeOrg()
    // Identity survives the move (Bug B task, 2026-09-12): the display name
    // lives in org.json, which the move takes away from the index's reader.
    // Read it BEFORE softDelete; the entry keeps the folder SLUG in `name`
    // (purge/restore derive paths from it) and adds `displayName` for rows.
    const manifest = (() => { try { return readManifest(orgManifestPath(resolved)) } catch { return null } })()
    const shown = typeof displayName === 'string' && displayName.trim() !== ''
      ? displayName.trim()
      : (typeof manifest?.name === 'string' && manifest.name.trim() !== '' ? manifest.name : null)
    const scope = path.dirname(resolved)
    const entry = softDelete(scope, resolved, { env })
    const list = readOrgTrashIndex()
    list.push({
      entryId: entry.entryId, scope, name: path.basename(resolved),
      ...(shown === null ? {} : { displayName: shown }),
      deletedAt: new Date().toISOString(),
    })
    writeOrgTrashIndex(list)
    try { removeRecent(resolved) } catch { /* recents are advisory */ }
    return { ...entry, scope }
  }

  /** Org-scope trash listing: index entries whose folder still exists.
   * `name` renders the display name when the entry has one (the org row and
   * the trash row must agree — Bug B task, 2026-09-12); restore and purge
   * key off entryId / the index's own slug, never off this row. */
  function listOrgTrash() {
    return readOrgTrashIndex()
      .map((e) => {
        const entryPath = path.join(e.scope, '.arxa', 'trash', e.entryId)
        return fs.existsSync(entryPath) ? { entryId: e.entryId, entryPath, name: e.displayName ?? e.name, scope: e.scope } : null
      })
      .filter(Boolean)
  }

  /** Restore a trashed org to its original path (collision = typed error). */
  function restoreOrg(entryId) {
    const rec = readOrgTrashIndex().find((e) => e.entryId === entryId)
    if (!rec) throw new Error('no-trash-entry: ' + entryId)
    const res = restoreFromTrash(rec.scope, entryId, { env })
    writeOrgTrashIndex(readOrgTrashIndex().filter((e) => e.entryId !== entryId))
    try { touchRecent(res.restoredPath, env) } catch { /* recents are advisory */ }
    return res
  }

  /**
   * Purge a trashed org (D81): delete every GitHub repo it owns (linked
   * required — a 403 surfaces the re-link guidance) and only then hard
   * delete the folder behind the D23 confirm token. ANY failed deletion
   * keeps the entry and reports exactly what happened, so a partial
   * purge is always loud and always retryable.
   */
  async function purgeOrgTrash(entryId) {
    const rec = readOrgTrashIndex().find((e) => e.entryId === entryId)
    if (!rec) throw new Error('no-trash-entry: ' + entryId)
    const entryPath = path.join(rec.scope, '.arxa', 'trash', entryId)
    const repos = orgTrashEntryRepos(entryPath)
    // D90: the link is required only when there ARE repos to delete — a
    // local-only org purges without GitHub entirely.
    if (repos.length > 0) {
      const st = await githubBridge.status()
      if (!st.ok || !st.linked) {
        throw new Error('linked-required: purging ' + entryId + ' must delete its GitHub repos, and GitHub is not linked — nothing was deleted')
      }
    }
    const deleted = []
    const failed = []
    for (const r of repos) {
      const made = await githubBridge.deleteRepo(r.owner, r.name)
      if (made.ok) deleted.push(r.owner + '/' + r.name)
      else failed.push({ repo: r.owner + '/' + r.name, error: made.error || made.reason })
    }
    if (failed.length > 0) {
      const err = new Error('purge incomplete: deleted [' + deleted.join(', ') + '] but failed [' + failed.map((f2) => f2.repo + ' (' + f2.error + ')').join('; ') + '] — the trash entry was kept')
      err.deleted = deleted
      err.failed = failed
      throw err
    }
    // Repos are gone: their self-hosted runners have nothing left to serve.
    // Best-effort, reported, never blocks the purge (2026-09-07 audit: the
    // LaunchAgent + ~/.arxa/runners dir used to survive every org purge).
    const runners = []
    for (const r of repos) {
      const rr = await githubBridge.removeRunner(r.owner, r.name)
      if (rr.existing) runners.push({ repo: r.owner + '/' + r.name, ok: rr.ok === true, serviceRemoved: rr.serviceRemoved === true, error: rr.error ?? rr.reason })
    }
    const purged = hardDelete(rec.scope, entryId, { confirm: hardDeleteToken(entryId) })
    writeOrgTrashIndex(readOrgTrashIndex().filter((e) => e.entryId !== entryId))
    return { ...purged, orgPath: path.join(rec.scope, rec.name), deletedRepos: deleted, runners }
  }

  /**
   * Read-only org tree for sidebar surfaces: the five fixed categories
   * (D42) with on-disk presence, the org's projects, and a per-project
   * session count off the registry. Reads never take the shell lock —
   * listing is presentation, not lifecycle (same contract as listOrgs).
   * Sessions are omitted entirely when the org has no repo yet.
   */
  /** First-level subdirectory names of a bare dock, sorted, dotfiles
   * skipped. A dock that was never scaffolded reads as []. */
  function bareDockFolders(dir) {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort()
    } catch {
      return []
    }
  }
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
    const docks = template.docks.map((d) => {
      // A dock with no fixed containers (notes) is itself a workspace;
      // the projects dock holds projects instead.
      const workspace = d.slug !== 'projects' && (d.containers ?? []).length === 0
      return {
        slug: d.slug,
        exists: fs.existsSync(path.join(resolved, d.slug)),
        workspace,
        containers: d.containers, // null = projects dock (dynamic children)
        // G2 (grilled 2026-09-06): a bare dock's first-level subfolders are
        // real workspace rows — a note folder hosts its own sessions, the
        // way a project container does. Disk truth, never template
        // vocabulary: the user makes these folders, so nothing fixed can
        // enumerate them.
        ...(workspace ? { folders: bareDockFolders(path.join(resolved, d.slug)) } : {}),
      }
    })
    const orgProjects = [...projects.values()]
      .filter((p) => p.orgId === org.id)
      .map(({ id, name, slug, path: projectPath }) => ({
        id, name, slug, path: projectPath,
        // D90: per-project GitHub connection state for menus + markers.
        connected: (() => { try { return !!readManifest(projectManifestPath(projectPath)).repoUrl } catch { return false } })(),
        // D115 closeout: repo presence per project — the client offers the
        // explicit "Initialize Git repository" repair for a hand-created
        // project (false) and never for one that already has a repo.
        hasRepo: isRepo(projectPath, env),
        containers: [...template.projectContainers],
      }))
    let sessionsByWorkspace = null
    try {
      const rows = allSessions(resolved, env) // D98: counts include project sessions
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
    /** D95/D96: push + ff-pull the org and every project repo (refresh door). */
    syncOrgRepos,
    createOrg,
    openOrg,
    closeOrg,
    switchOrg,
    renameOrg,
    renameProject,
    trashOrg,
    // D90: GitHub connect/disconnect surface (org + project scope).
    disconnectGithub,
    disconnectProjectGithub,
    connectProject,
    listOrgTrash,
    restoreOrg,
    purgeOrgTrash,
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
