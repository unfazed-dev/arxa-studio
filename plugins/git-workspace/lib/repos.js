// Repo boundaries (D37): the org root is one git repo (notes, meetings,
// communications, org context); each projects/<name> is its own repo,
// nested inside and IGNORED by the org repo; account/ is excluded from
// version control entirely (billing mirrors + secrets never enter git
// history). The ignore rules live in a committed .gitignore so they
// travel with the org repo when it is cloned/shared per D17.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { runGit, STAGE_IDENTITY } from './run.js'
import { ensureGit, gitBin } from './probe.js'

// Pinned config for DETACHED git workers, same surface as run.js's -c
// flags but carried as env (GIT_CONFIG_*) so a /bin/sh chain needs no
// per-flag plumbing. Git >= 2.31 reads these; run.js still pins via -c
// for its own execFileSync calls.
const SNAPSHOT_CONFIG = Object.freeze([
  ['init.defaultBranch', 'main'],
  ['commit.gpgsign', 'false'],
  ['tag.gpgsign', 'false'],
  ['core.hooksPath', ''],
  ['core.autocrlf', 'false'],
])

// Committed at the org root. The "/projects/" star pattern keeps every
// nested project repo (and any stray folder under projects/) out of the
// org repo — without it, git would record nested repos as gitlink
// entries and `git add -A` would embed them in org history. "/account/"
// implements the D37 exclusion of billing mirrors and secrets.
export const ORG_GITIGNORE = `# arxa studio (D37): nested project repos are their own repos — the org
# repo never tracks anything under projects/.
/projects/*/
# account/ is excluded from version control entirely (D37): billing
# mirrors and secrets never enter git history.
/account/
`

/** True when `dir` is itself the top level of a git repo. */
export function isRepo(dir, env = process.env) {
  if (!fs.existsSync(path.join(dir, '.git'))) return false
  const top = runGit(['rev-parse', '--show-toplevel'], { cwd: dir, env, allowFail: true })
  if (top === null) return false
  // realpath both sides: macOS tmp dirs are symlinks (/var → /private/var)
  // and git reports the resolved path.
  return fs.realpathSync(top) === fs.realpathSync(dir)
}

function initRepo(dir, env) {
  runGit(['init'], { cwd: dir, env })
}

/**
/** True when the repo at "dir" has at least one commit on HEAD. This is
 * the SESSION-UNLOCK contract: worktrees need a commit to branch from,
 * so has-head is exactly initial-snapshot-complete. */
export function hasHead(dir, env = process.env) {
  return runGit(['rev-parse', '-q', '--verify', 'HEAD'], { cwd: dir, env, allowFail: true }) !== null
}

function snapshotMarkerPath(orgPath) {
  return path.join(orgPath, '.arxa', 'snapshot.json')
}

function writeSnapshotMarker(orgPath, body) {
  try {
    fs.mkdirSync(path.join(orgPath, '.arxa'), { recursive: true })
    fs.writeFileSync(snapshotMarkerPath(orgPath), JSON.stringify(body))
  } catch { /* the marker is advisory; snapshot truth lives in git itself */ }
}

/** The detached initial-snapshot marker, or null. Advisory diagnostics
 * only (which pid, since when) — correctness NEVER depends on it:
 * hasHead() is the truth; this merely says whether a worker may exist. */
export function readSnapshotMarker(orgPath) {
  try { return JSON.parse(fs.readFileSync(snapshotMarkerPath(orgPath), 'utf8')) } catch { return null }
}

// The out-of-process initial-snapshot worker: same pinned git surface as
// runGit (config via -c, identity via env, no user git state touched),
// argv-array execFileSync — no shell, no quoting. Written fresh per spawn
// into the org runtime dir and run with the app's own node binary.
const SNAPSHOT_WORKER = [
  'import { execFileSync } from \'node:child_process\'',
  'import fs from \'node:fs\'',
  'const org = process.argv[2]',
  'const git = process.argv[3]',
  'const marker = org + \'/.arxa/snapshot.json\'',
  'const pin = [\'-c\', \'init.defaultBranch=main\', \'-c\', \'commit.gpgsign=false\', \'-c\', \'tag.gpgsign=false\', \'-c\', \'core.hooksPath=\', \'-c\', \'core.autocrlf=false\', \'-c\', \'safe.directory=\' + org]',
  'const opt = { cwd: org, env: process.env }',
  'try {',
  '  execFileSync(git, [...pin, \'add\', \'-A\'], opt)',
  '  execFileSync(git, [...pin, \'commit\', \'-m\', \'stage: scaffold organisation\'], opt)',
  '  execFileSync(git, [...pin, \'update-ref\', \'refs/arxa/stage-base\', \'HEAD\'], opt)',
  '  fs.writeFileSync(marker, JSON.stringify({ state: \'done\', finishedAt: new Date().toISOString() }))',
  '} catch (e) {',
  '  try { fs.writeFileSync(marker, JSON.stringify({ state: \'error\', error: String(e && e.message ? e.message : e) })) } catch {}',
  '  process.exit(1)',
  '}',
].join('\n')

function snapshotWorkerEnv(orgPath, env) {
  const child = { ...env }
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_COMMON_DIR']) delete child[k]
  child.GIT_CONFIG_NOSYSTEM = '1'
  child.GIT_CONFIG_GLOBAL = os.devNull
  child.GIT_AUTHOR_NAME = STAGE_IDENTITY.name
  child.GIT_AUTHOR_EMAIL = STAGE_IDENTITY.email
  child.GIT_COMMITTER_NAME = STAGE_IDENTITY.name
  child.GIT_COMMITTER_EMAIL = STAGE_IDENTITY.email
  return child
}

/** The initial stage snapshot, synchronously: stage everything, commit
 * the scaffold stage, pin the stage-base ref. SYNCHRONOUS and unbounded —
 * on a D69 in-place org root that already holds bulk content this can run
 * for minutes and freeze the caller (execFileSync). Request paths MUST
 * prefer spawnSnapshotOrgRepo; the sync form stays for tests, explicit
 * healing, and callers with no event loop to protect. */
export function snapshotOrgRepo(orgPath, env = process.env) {
  runGit(['add', '-A'], { cwd: orgPath, env })
  runGit(['commit', '-m', 'chore(org): scaffold the organisation tree'], { cwd: orgPath, env })
  runGit(['update-ref', 'refs/arxa/stage-base', 'HEAD'], { cwd: orgPath, env })
}

/** True when a detached initial-snapshot worker for this org may still be
 * alive: marker pid answers kill(0) AND /bin/ps shows the worker command
 * for it (the second check defeats pid reuse). Conservative — verification
 * failure reads as live, which only ever delays a respawn; a false "dead"
 * would double-spawn competing git adds. */
export function snapshotWorkerLive(orgPath) {
  const m = readSnapshotMarker(orgPath)
  if (!m || m.state !== 'running' || typeof m.pid !== 'number') return false
  try { process.kill(m.pid, 0) } catch { return false }
  try {
    const cmd = execFileSync('/bin/ps', ['-o', 'command=', '-p', String(m.pid)], { encoding: 'utf8' })
    return cmd.includes('snapshot-worker')
  } catch { return true }
}

/** Run the initial snapshot DETACHED (survives app quit) and return the
 * worker pid. Completion is announced by git itself: hasHead() flips true,
 * and the worker leaves a done/error marker for diagnostics. A multi-minute
 * add -A over bulk content can no longer freeze the app. */
export function spawnSnapshotOrgRepo(orgPath, env = process.env) {
  ensureGit(env)
  const dir = path.join(orgPath, '.arxa')
  fs.mkdirSync(dir, { recursive: true })
  const worker = path.join(dir, 'snapshot-worker.mjs')
  fs.writeFileSync(worker, SNAPSHOT_WORKER)
  const marker = path.join(dir, 'snapshot.json')
  // Pre-write the running marker so snapshotWorkerLive can vouch for the
  // worker from the instant it exists; the worker overwrites it at the end.
  writeSnapshotMarker(orgPath, { state: 'running', pid: null, startedAt: new Date().toISOString() })
  const ch = spawn(process.execPath, [worker, orgPath, gitBin(env)], {
    cwd: orgPath,
    env: snapshotWorkerEnv(orgPath, env),
    detached: true,
    stdio: 'ignore',
  })
  writeSnapshotMarker(orgPath, { state: 'running', pid: ch.pid, startedAt: new Date().toISOString() })
  ch.unref()
  return { pid: ch.pid, marker }
}

/** The .gitignore the org repo gets at init. includeExisting (the
 * create-time choice, 2025-08) picks between two contracts: the D37
 * default that versions the whole folder minus projects//account, and a
 * whitelist that versions only arxa-managed org files — pre-existing
 * content in the picked folder stays untracked and untouched. managedDirs
 * is the workspace template's category list; projects (own repos) and
 * account (secrets) are never whitelisted. */
export function orgIgnoreFor({ includeExisting = true, managedDirs = [] } = {}) {
  if (includeExisting) return ORG_GITIGNORE
  const lines = [
    '# arxa studio (create-time choice): only arxa-managed org files are',
    '# versioned — pre-existing content in this folder stays untracked and',
    '# untouched. Nested project repos and account/ are never tracked (D37).',
    '/*',
    '!/.gitignore',
    '!/org.json',
    '!/AGENTS.md',
  ]
  for (const d of managedDirs) {
    if (d !== 'projects' && d !== 'account') lines.push('!/' + d + '/')
  }
  return lines.join('\n') + '\n'
}

/**
 * Turn a scaffolded org folder (plugins/workspace scaffoldOrg output)
 * into the org repo: git init, D37 ignore rules, and an initial stage
 * commit — so a stage-boundary squash base always exists from day one.
 * Idempotent: re-running on an existing org repo is a no-op, and a repo
 * left with an UNBORN HEAD (a previous attempt died mid-snapshot) is
 * healed by snapshotting — the exact wedge the 2025-08 create-org hang
 * left on disk. deferSnapshot skips the (unbounded) initial snapshot for
 * request-path callers: they return fast and spawn the detached worker
 * instead. hasHead() remains the session gate either way.
 *
 * @returns {{ path: string, initialised: boolean, deferred: boolean }}
 */
export function initOrgRepo(orgPath, env = process.env, { deferSnapshot = false, includeExisting = true, managedDirs = [] } = {}) {
  const ignore = orgIgnoreFor({ includeExisting, managedDirs })
  if (isRepo(orgPath, env)) {
    if (hasHead(orgPath, env)) return { path: orgPath, initialised: false, deferred: false }
    if (!deferSnapshot) snapshotOrgRepo(orgPath, env) // heal an interrupted initial snapshot
    return { path: orgPath, initialised: false, deferred: deferSnapshot }
  }
  initRepo(orgPath, env)
  fs.writeFileSync(path.join(orgPath, '.gitignore'), ignore)
  if (!deferSnapshot) snapshotOrgRepo(orgPath, env)
  return { path: orgPath, initialised: true, deferred: deferSnapshot }
}

/**
 * Push the repo's PRIMARY branch to `url` (D73 publish half). Session
 * branches (`arxa/session/*`) are local working state — they never publish;
 * when HEAD sits on one (a session is open), the primary branch resolves
 * main → master instead. The URL carries its own credentials when GitHub
 * (token embedded by the caller, NEVER persisted — it rides this one
 * command line only). GIT_TERMINAL_PROMPT=0 turns a credentials problem
 * into a loud failure instead of a hang.
 *
 * @returns {{ ref: string, output: string }} the pushed branch ref + git stdout
 */
export function pushRepo(dir, url, env = process.env) {
  if (typeof url !== 'string' || url.trim() === '') {
    throw new TypeError('pushRepo: url must be a non-empty string')
  }
  let ref = runGit(['symbolic-ref', '--short', 'HEAD'], { cwd: dir, env, allowFail: true })
  if (!ref || ref.startsWith('arxa/session/')) {
    ref = runGit(['show-ref', '--verify', '--hash', 'refs/heads/main'], { cwd: dir, env, allowFail: true }) !== null
      ? 'main'
      : 'master'
  }
  const output = runGit(['push', url, 'refs/heads/' + ref + ':refs/heads/' + ref], {
    cwd: dir,
    env: { ...env, GIT_TERMINAL_PROMPT: '0' },
  })
  return { ref, output }
}

/** Read the URL of the `origin` remote, or null when absent (allowFail). */
export function getOrigin(dir, env = process.env) {
  return runGit(['remote', 'get-url', 'origin'], { cwd: dir, env, allowFail: true })
}

/**
 * Point a repo's `origin` remote at `url` — create it when absent,
 * UPDATE it when one already exists (W3b: republish/rename must never
 * throw on a pre-existing remote).
 *
 * @returns {{ path: string, url: string, updated: boolean }}
 */
export function setOrigin(dir, url, env = process.env) {
  if (typeof url !== 'string' || url.trim() === '') {
    throw new TypeError('setOrigin: url must be a non-empty string')
  }
  const existing = getOrigin(dir, env)
  if (existing !== null) {
    runGit(['remote', 'set-url', 'origin', url], { cwd: dir, env })
    return { path: dir, url, updated: true }
  }
  runGit(['remote', 'add', 'origin', url], { cwd: dir, env })
  return { path: dir, url, updated: false }
}

/**
 * D96 (2026-09-01 sync grill): fetch the remote's main into the local
 * origin/main tracking ref. The URL carries its own credentials when
 * GitHub (token embedded by the caller, NEVER persisted — the same
 * one-command-line doctrine as pushRepo). A bare local path (tests) or
 * file:// URL works credentials-free. Failure is a quiet null: offline is
 * a normal state, the caller decides what to annotate.
 *
 * @returns {boolean} true when the fetch command succeeded.
 */
export function fetchRepo(dir, url, env = process.env) {
  if (typeof url !== 'string' || url.trim() === '') {
    throw new TypeError('fetchRepo: url must be a non-empty string')
  }
  const out = runGit(['fetch', url, '+refs/heads/main:refs/remotes/origin/main'], {
    cwd: dir,
    env: { ...env, GIT_TERMINAL_PROMPT: '0' },
    allowFail: true,
  })
  return out !== null || runGit(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'], { cwd: dir, env, allowFail: true }) !== null
}

/**
 * D96: where local main sits relative to origin/main. Pure refs — no
 * network. Counts are 0 when either side is missing (unborn repo, never
 * fetched), so callers can treat "no origin/main" as nothing-to-pull.
 */
export function mainSyncState(dir, env = process.env) {
  const remote = runGit(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'], { cwd: dir, env, allowFail: true })
  if (remote === null) return { remote: false, behind: 0, ahead: 0 }
  const behind = Number(runGit(['rev-list', '--count', 'main..origin/main'], { cwd: dir, env, allowFail: true })) || 0
  const ahead = Number(runGit(['rev-list', '--count', 'origin/main..main'], { cwd: dir, env, allowFail: true })) || 0
  return { remote: true, behind, ahead, diverged: behind > 0 && ahead > 0 }
}

/**
 * D96: fast-forward local main to origin/main. ONLY ever moves main
 * forward (--ff-only): a diverged history must never be auto-merged —
 * the caller parks it loudly instead. Returns true when main advanced.
 */
export function ffMergeMain(dir, env = process.env) {
  const before = runGit(['rev-parse', '--short', 'main'], { cwd: dir, env, allowFail: true })
  runGit(['merge', '--ff-only', 'origin/main'], { cwd: dir, env, allowFail: true })
  const after = runGit(['rev-parse', '--short', 'main'], { cwd: dir, env, allowFail: true })
  return before !== null && after !== null && before !== after
}

/**
 * Turn a scaffolded project folder (scaffoldProject output) into its own
 * repo, nested inside and ignored by the org repo (D37). Initial stage
 * commit covers project.json + AGENTS.md. Idempotent.
 *
 * @returns {{ path: string, initialised: boolean }}
 */
export function initProjectRepo(projectPath, env = process.env) {
  if (isRepo(projectPath, env)) return { path: projectPath, initialised: false }
  initRepo(projectPath, env)
  runGit(['add', '-A'], { cwd: projectPath, env })
  runGit(['commit', '-m', 'chore(project): scaffold the project tree'], { cwd: projectPath, env })
  runGit(['update-ref', 'refs/arxa/stage-base', 'HEAD'], { cwd: projectPath, env })
  return { path: projectPath, initialised: true }
}
