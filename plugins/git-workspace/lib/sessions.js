// Session lifecycle (D38–D40): branch-per-session worktrees.
//
// A session (see CONTEXT.md) is one work context — chat/agent thread or
// interactive editing surface. Every session owns a git branch + a
// worktree; main is NEVER edited directly (D38). Sessions never end —
// they are archived (D39).
//
// Mechanics:
// - Session branch:   `arxa/session/<id>` off main.
// - Session worktree: `<repo>/.arxa/worktrees/<id>`, hidden from the
//   repo (and from every other worktree, since excludes live in the
//   common git dir) via `.git/info/exclude` — so the D18 `add -A` WIP
//   wall can never swallow a nested worktree.
// - Session registry: `<git-common-dir>/arxa/sessions.json` — repo-local
//   state that travels nowhere, like `refs/arxa/stage-base` (phase 3).
// - Per-session squash base: `refs/arxa/session-base/<id>`. The shared
//   `refs/arxa/stage-base` cannot serve concurrent sessions (refs are
//   common across worktrees — two sessions would corrupt each other's
//   base), so each session squashes against its own base ref via the
//   `baseRef` extension of commits.js.
//
// Stage boundary (D38): the default gate + merge moment. The session's
// WIP run is squashed to one clean stage commit (D18 mechanics reused
// verbatim), the gate runs (arxa-cicd `check.sh` when present = code
// repo; light checks otherwise = content repo — an ABSENT check.sh is a
// configuration state, not an error), and green merges to main. Red
// parks the branch. Parked branches (red gate / held / archived
// unmerged) are NEVER auto-deleted (D40) — this module exposes no
// branch-deletion API at all.
//
// Archive (D39/D40): prunes the worktree (after a final WIP commit so
// nothing is ever lost) but keeps the branch; revival recreates the
// worktree from the parked branch and continues from parked state.
//
// dsh integration point (`archivedSessionIds`): dsh is not reachable
// from this repo. The plugin-side contract is `archivedSessionIds
// (repoPath)` below — dsh's session list must treat every id it returns
// as archived-out-of-active-views (transcripts persist on dsh's side;
// the branch parks here). Wire-up lands with the dsh sync rail.
//
// Concurrency: two sessions hitting a stage boundary race on main. The
// merge runs inside the primary worktree (where main is checked out) so
// git's own index/ref locks serialize the racers; the loser fails
// loudly via SessionMergeError with all commits intact on its parked
// branch — recover by reviving/retrying, never by deleting anything.
//
// Platform note (M8): worktrees are desktop-only in v1 — mobile is
// online-only and edits travel the cairn rail as edit-log entries
// materialized by a desktop, so NO mobile code path ever requires a
// worktree (or git at all) on the device.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ensureGit } from './probe.js'
import { runGit, STAGE_IDENTITY } from './run.js'
import { wipCommit, stageBoundarySquash, STAGE_BASE_REF } from './commits.js'

export const SESSION_BRANCH_PREFIX = 'arxa/session/'
export const SESSION_BASE_PREFIX = 'refs/arxa/session-base/'
export const SESSIONS_DIR = '.arxa/worktrees'
export const SESSIONS_FILE = 'sessions.json'
export const GATE_CHECK_SCRIPT = 'check.sh'

/** Session lifecycle states (CONTEXT.md: sessions never end — they are archived). */
export const SESSION_STATES = Object.freeze(['open', 'parked', 'archived'])

/** Loud, recoverable merge failure: the session branch keeps every commit. */
export class SessionMergeError extends Error {
  constructor(id, detail) {
    super(
      `session "${id}" could not merge to main — ${detail}. ` +
      'The session branch is parked with all commits intact; resolve and retry (D40: never deleted).',
    )
    this.name = 'SessionMergeError'
    this.sessionId = id
  }
}

// ---- registry (repo-local state, travels nowhere) --------------------------

function gitCommonDir(repoPath, env) {
  const out = runGit(['rev-parse', '--git-common-dir'], { cwd: repoPath, env })
  return path.resolve(repoPath, out)
}

function registryPath(repoPath, env) {
  return path.join(gitCommonDir(repoPath, env), 'arxa', SESSIONS_FILE)
}

function readRegistry(repoPath, env) {
  const p = registryPath(repoPath, env)
  if (!fs.existsSync(p)) return { sessions: [] }
  const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (!Array.isArray(parsed.sessions)) throw new TypeError(`${p} is not a session registry`)
  return parsed
}

function writeRegistry(repoPath, registry, env) {
  const p = registryPath(repoPath, env)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(registry, null, 2) + '\n')
}

function getSession(registry, id) {
  const s = registry.sessions.find((s) => s.id === id)
  if (!s) throw new Error(`unknown session "${id}"`)
  return s
}

/** All sessions for a repo (registry order). */
export function listSessions(repoPath, env = process.env) {
  return readRegistry(repoPath, env).sessions
}

/**
 * dsh contract (D39): ids of archived sessions. dsh flags these out of
 * active views (`archivedSessionIds`); transcripts persist on dsh's
 * side, branches park here. See header for the integration point.
 */
export function archivedSessionIds(repoPath, env = process.env) {
  return listSessions(repoPath, env)
    .filter((s) => s.state === 'archived')
    .map((s) => s.id)
}

// ---- open ------------------------------------------------------------------

/** Ensure `.arxa/` never enters any worktree's `add -A` (exclude lives in the common dir). */
function ensureExcluded(repoPath, env) {
  const info = path.join(gitCommonDir(repoPath, env), 'info')
  const exclude = path.join(info, 'exclude')
  const line = '/.arxa/'
  const current = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : ''
  if (current.split('\n').includes(line)) return
  fs.mkdirSync(info, { recursive: true })
  fs.writeFileSync(exclude, current + (current.endsWith('\n') || current === '' ? '' : '\n') + line + '\n')
}

function sessionWorktreePath(repoPath, id) {
  return path.join(repoPath, SESSIONS_DIR, id)
}

/**
 * Open a session (D38): branch + worktree off main. Main itself is
 * never edited directly — all edits happen in the session worktree.
 *
 * @returns {{ id, name, branch, worktree, state }}
 */
export function openSession(repoPath, { id, name, env = process.env } = {}) {
  ensureGit(env)
  if (!id) id = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new TypeError(`session id "${id}" is not a valid branch/path component`)
  }
  const registry = readRegistry(repoPath, env)
  if (registry.sessions.some((s) => s.id === id)) {
    throw new Error(`session "${id}" already exists — revive it instead of reopening`)
  }
  const mainSha = runGit(['rev-parse', '-q', '--verify', 'refs/heads/main'], {
    cwd: repoPath, env, allowFail: true,
  })
  if (!mainSha) throw new Error(`no main branch in ${repoPath} — init the repo first (initOrgRepo/initProjectRepo)`)
  ensureExcluded(repoPath, env)
  const branch = `${SESSION_BRANCH_PREFIX}${id}`
  const worktree = sessionWorktreePath(repoPath, id)
  fs.mkdirSync(path.dirname(worktree), { recursive: true })
  runGit(['worktree', 'add', '-b', branch, worktree, 'main'], { cwd: repoPath, env })
  // Per-session squash base (see header): starts at the branch point.
  runGit(['update-ref', `${SESSION_BASE_PREFIX}${id}`, mainSha], { cwd: repoPath, env })
  const session = { id, name: name || id, branch, worktree, state: 'open', parkedReason: null }
  registry.sessions.push(session)
  writeRegistry(repoPath, registry, env)
  return session
}

// ---- gate ------------------------------------------------------------------

/**
 * The gate (D38): run arxa-cicd `check.sh` at the worktree root when
 * present (code repo); light checks otherwise (content repo). An absent
 * check.sh is a configuration state, NOT an error — `configured` says
 * which kind ran.
 *
 * @returns {{ green: boolean, kind: 'check.sh'|'light', configured: boolean, output: string }}
 */
export function runGate(worktree, env = process.env) {
  const script = path.join(worktree, GATE_CHECK_SCRIPT)
  if (fs.existsSync(script)) {
    try {
      const out = execFileSync('sh', [script], {
        cwd: worktree,
        env: { ...env },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024,
      })
      return { green: true, kind: 'check.sh', configured: true, output: out.trim() }
    } catch (err) {
      const output = [err.stdout, err.stderr].filter(Boolean).map(String).join('\n').trim()
      return { green: false, kind: 'check.sh', configured: true, output: output || err.message }
    }
  }
  // Content repo: light checks — the worktree must be a healthy checkout
  // with nothing uncommitted (the squash just ran) and a resolvable HEAD.
  const status = runGit(['status', '--porcelain'], { cwd: worktree, env, allowFail: true })
  const headSha = runGit(['rev-parse', '-q', '--verify', 'HEAD'], { cwd: worktree, env, allowFail: true })
  const green = status === '' && Boolean(headSha)
  return { green, kind: 'light', configured: false, output: green ? '' : (status ?? 'unresolvable HEAD') }
}

// ---- stage boundary --------------------------------------------------------

function parkSession(repoPath, id, reason, env) {
  const registry = readRegistry(repoPath, env)
  const session = getSession(registry, id)
  session.state = 'parked'
  session.parkedReason = reason
  writeRegistry(repoPath, registry, env)
  return session
}

/**
 * Stage boundary for a session (D38): squash the session's WIP run into
 * one clean stage commit (D18 mechanics, per-session base ref), run the
 * gate, and on green merge to main. Red parks the branch (D40: parked,
 * never deleted). A merge conflict or a lost ref race parks the branch
 * and throws SessionMergeError — loud, recoverable, zero commits lost.
 *
 * The merge itself runs in the primary worktree; that is a ref/index
 * operation on main, not a direct edit — D38's "main never edited
 * directly" holds: every commit reaching main is a stage commit or a
 * stage merge commit.
 *
 * @returns {{ squashed, sha, gate, merged, parked, session }}
 */
export function sessionStageBoundary(repoPath, id, { message, env = process.env } = {}) {
  const registry = readRegistry(repoPath, env)
  const session = getSession(registry, id)
  if (session.state !== 'open') {
    throw new Error(`session "${id}" is ${session.state} — revive it before hitting a stage boundary`)
  }
  const baseRef = `${SESSION_BASE_PREFIX}${id}`
  const squash = stageBoundarySquash(session.worktree, {
    message: message || `${session.name} checkpoint`,
    env,
    baseRef,
  })
  const gate = runGate(session.worktree, env)
  if (!gate.green) {
    const parked = parkSession(repoPath, id, 'gate-red', env)
    return { ...squash, gate, merged: false, parked: true, session: parked }
  }
  // Green → merge moment. --ff-only covers the common single-session
  // case; a diverged main gets a true stage merge commit. Conflicts
  // abort cleanly and park — the session branch keeps everything.
  const ff = runGit(['merge', '--ff-only', session.branch], { cwd: repoPath, env, allowFail: true })
  if (ff === null) {
    const merged = runGit(
      ['merge', '--no-ff', '-m', `stage: merge ${session.name}`, session.branch],
      { cwd: repoPath, env, identity: STAGE_IDENTITY, allowFail: true },
    )
    if (merged === null) {
      runGit(['merge', '--abort'], { cwd: repoPath, env, allowFail: true })
      parkSession(repoPath, id, 'merge-conflict', env)
      throw new SessionMergeError(id, 'merge conflict with main')
    }
  }
  // Keep the repo-level stage base (phase 3) on the new main tip so
  // main-side tooling still sees the last boundary.
  runGit(['update-ref', STAGE_BASE_REF, 'refs/heads/main'], { cwd: repoPath, env })
  return { ...squash, gate, merged: true, parked: false, session }
}

/** User holds a session's work back from main (parks it; D40: never deleted). */
export function holdSession(repoPath, id, env = process.env) {
  return parkSession(repoPath, id, 'held', env)
}

// ---- archive / revive ------------------------------------------------------

/**
 * Archive (D39/D40): flag the session out of active views (see
 * `archivedSessionIds`), take a final WIP commit so nothing uncommitted
 * is lost, prune the worktree — and KEEP the branch. Unmerged work
 * stays parked on it forever until revived; nothing is auto-deleted.
 *
 * @returns {{ id, state, branch }}
 */
export function archiveSession(repoPath, id, env = process.env) {
  const registry = readRegistry(repoPath, env)
  const session = getSession(registry, id)
  if (session.state === 'archived') return session
  if (fs.existsSync(session.worktree)) {
    wipCommit(session.worktree, { message: 'archive snapshot', env })
    runGit(['worktree', 'remove', session.worktree], { cwd: repoPath, env })
  } else {
    runGit(['worktree', 'prune'], { cwd: repoPath, env, allowFail: true })
  }
  session.state = 'archived'
  writeRegistry(repoPath, registry, env)
  return session
}

/**
 * Revive (D39/D40): recreate the worktree from the parked branch and
 * continue from parked state. The branch was never deleted, so the full
 * session history (including any unmerged work) is exactly where the
 * archive left it.
 *
 * @returns {{ id, state, worktree }}
 */
export function reviveSession(repoPath, id, env = process.env) {
  const registry = readRegistry(repoPath, env)
  const session = getSession(registry, id)
  if (session.state === 'open') return session
  if (!fs.existsSync(session.worktree)) {
    fs.mkdirSync(path.dirname(session.worktree), { recursive: true })
    runGit(['worktree', 'add', session.worktree, session.branch], { cwd: repoPath, env })
  }
  session.state = 'open'
  session.parkedReason = null
  writeRegistry(repoPath, registry, env)
  return session
}
