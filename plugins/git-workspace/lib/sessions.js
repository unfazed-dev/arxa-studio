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
import { getOrigin } from './repos.js'
import { projectRepos } from './routing.js'

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

// The common dir for a given working directory never changes while that
// directory exists, but D98 aggregation reads N+1 registries per sidebar
// handler — one `git rev-parse` spawn each, five handlers deep. Memoise, and
// invalidate by existence so a deleted/recreated repo recomputes.
const commonDirCache = new Map()

function gitCommonDir(repoPath, env) {
  const hit = commonDirCache.get(repoPath)
  if (hit && fs.existsSync(hit)) return hit
  const out = runGit(['rev-parse', '--git-common-dir'], { cwd: repoPath, env })
  const resolved = path.resolve(repoPath, out)
  commonDirCache.set(repoPath, resolved)
  return resolved
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

// ---- repo discovery (D98) --------------------------------------------------
//
// Once sessions live in the repo their workspace routes to, an id alone no
// longer says WHICH registry holds it. Every id-keyed face gains this
// preamble: try the repo it was handed, then the project repos nested under
// it, then give up and let the caller's own `unknown session` error stand.
//
// A project repo has no `projects/` subdirectory, so calling this with a
// project path falls through after the first read — the preamble is free
// there and correct at the org.

function registryHasId(repoPath, id, env) {
  try {
    return readRegistry(repoPath, env).sessions.some((s) => s.id === id)
  } catch {
    return false
  }
}

/**
 * The repo whose registry holds `id`. Falls back to `repoPath` unchanged when
 * nothing matches, so the caller raises its usual `unknown session "<id>"`.
 */
export function sessionRepoFor(repoPath, id, env = process.env) {
  if (registryHasId(repoPath, id, env)) return repoPath
  for (const { repoPath: p } of projectRepos(repoPath, env)) {
    if (registryHasId(p, id, env)) return p
  }
  return repoPath
}

/**
 * Every session across the org registry and all project registries, each row
 * tagged with the repo it came from (D98 / project-sessions-physical.md).
 *
 * Rows carry `repoPath` (the owning working directory), `origin` ('org' |
 * 'project') and `projectSlug`. Session ids are minted as
 * `s-<base36 time>-<random>` so they stay unique across registries without
 * coordination — aggregation never has to reconcile a collision.
 *
 * Registry order within a repo is preserved; org rows come first, then
 * projects in slug order.
 */
export function parkedSessions(orgPath, env = process.env) {
  const out = []
  const take = (repoPath, origin, projectSlug) => {
    let rows
    try {
      rows = readRegistry(repoPath, env).sessions
    } catch {
      return // not a repo, or no registry yet — nothing to aggregate
    }
    for (const s of rows) out.push({ ...s, repoPath, origin, projectSlug: s.project ?? projectSlug ?? null })
  }
  take(orgPath, 'org', null)
  for (const { slug, repoPath } of projectRepos(orgPath, env)) take(repoPath, 'project', slug)
  return out
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

/**
 * Additive registry-row annotation (Phase D dsh bridge, D71): merge `fields`
 * onto one session row — e.g. `{ dshSessionId }` after a dsh spawn. The
 * registry stays the storage of record; the field is optional and old rows
 * simply lack it (consumers read it as null). Unknown id throws like the
 * rest of the module.
 */
export function annotateSession(repoPath, id, fields, env = process.env) {
  repoPath = sessionRepoFor(repoPath, id, env) // D98 repo-discovery preamble
  const registry = readRegistry(repoPath, env)
  const session = getSession(registry, id)
  Object.assign(session, fields)
  // Any annotation is session activity: keep the rendered age honest
  // (the 56y bug was fake timestamps rendered as ages-from-epoch).
  session.updatedAt = Date.now()
  writeRegistry(repoPath, registry, env)
  return session
}

/**
 * Auto-name (grilled 2026-08-30): singular(folder) + per-folder counter,
 * zero-padded to 3 — note-001, email-001, design-001. No ids in names:
 * the worktree dir + branch keep the unique session id as the stable key,
 * so display duplicates across different parents are safe (rows sit under
 * their parent). Counter scans the SAME workspace folder only.
 */
export function nextSessionName(sessions, workspace) {
  const folder = String(workspace || '').split('/').filter(Boolean).pop() || 'session'
  const prefix = folder.length > 3 && folder.endsWith('s') ? folder.slice(0, -1) : folder
  let max = 0
  for (const s of sessions) {
    if (s.workspace !== workspace || typeof s.name !== 'string') continue
    const m = /^([A-Za-z][A-Za-z0-9._-]*)-(\d+)$/.exec(s.name)
    if (m && m[1] === prefix) max = Math.max(max, Number(m[2]))
  }
  return prefix + '-' + String(max + 1).padStart(3, '0')
}

/**
 * Rekey the project scope of every session row (D72 proper rename): after a
 * project's folder+slug move, registry rows carrying `project: oldSlug`
 * are stamped with the new slug. The registry stores slugs, not paths
 * (stable across renames) — this keeps that promise true after a rename.
 * Returns the number of rekeyed rows.
 */
export function rekeySessionsProject(repoPath, oldSlug, newSlug, env = process.env) {
  if (!oldSlug || !newSlug) throw new TypeError('rekeySessionsProject: both slugs are required')
  const registry = readRegistry(repoPath, env)
  let n = 0
  for (const s of registry.sessions) {
    if (s.project === oldSlug) {
      s.project = newSlug
      n++
    }
  }
  if (n > 0) writeRegistry(repoPath, registry, env)
  return n
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
 * `project` scopes the session (annotation only — the branch/worktree
 * still live on the repo given here): a project slug for project
 * sessions, null/undefined for org-level sessions. Registry is the
 * storage of record; consumers (file-org-shell, sidebar) interpret it.
 *
 * @returns {{ id, name, branch, worktree, state, project: string|null }}
 */
export function openSession(repoPath, { id, name, project, workspace, env = process.env } = {}) {
  if (project !== undefined && project !== null && (typeof project !== 'string' || project === '')) {
    throw new TypeError(`session project must be a slug string, null, or undefined; got ${JSON.stringify(project)}`)
  }
  if (workspace !== undefined && workspace !== null && (typeof workspace !== 'string' || workspace === '')) {
    throw new TypeError(`session workspace must be a non-empty path string, null, or undefined; got ${JSON.stringify(workspace)}`)
  }
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
  const now = Date.now()
  const session = {
    id,
    name: name || id,
    branch,
    worktree,
    state: 'open',
    parkedReason: null,
    project: project ?? null,
    // Workspace scope (grilled 2026-08-30): the org-relative folder this
    // session belongs to — 'notes', 'meetings/scheduler',
    // 'projects/<slug>/design'. Creation paths never produce org-level
    // (null) sessions any more; null is a pre-v2 relic on old rows.
    workspace: workspace ?? null,
    createdAt: now,
    updatedAt: now,
  }
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
/**
 * Whether a session worktree is still usable.
 *
 * A worktree directory can be deleted out from under the registry — git keeps
 * its administrative entry and flags it `prunable`. Callers that ask git for
 * `status --porcelain` with `allowFail` get `null` back, and a `?? ''` turns
 * that into "no output", which every counter in the codebase reads as CLEAN.
 * That is B1: the card reported a worktree that no longer exists as having
 * nothing to commit. Ask this first and branch on it, rather than coalescing.
 *
 * - `ok`         — present and git answers
 * - `missing`    — the directory is gone
 * - `unreadable` — present, but git cannot use it (broken gitdir link, locked)
 */
export function worktreeHealth(worktree, env = process.env) {
  if (typeof worktree !== 'string' || worktree === '' || !fs.existsSync(worktree)) return 'missing'
  return runGit(['status', '--porcelain'], { cwd: worktree, env, allowFail: true }) === null
    ? 'unreadable'
    : 'ok'
}

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
  repoPath = sessionRepoFor(repoPath, id, env) // D98: merge into the OWNING repo's main
  const registry = readRegistry(repoPath, env)
  const session = getSession(registry, id)
  if (session.state !== 'open') {
    throw new Error(`session "${id}" is ${session.state} — revive it before hitting a stage boundary`)
  }
  const baseRef = `${SESSION_BASE_PREFIX}${id}`
  const squash = stageBoundarySquash(session.worktree, {
    message: message || `chore(session): ${session.name} checkpoint`,
    trailer: `Arxa-Stage: session ${id}`,
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
      ['merge', '--no-ff', '-m', `chore(session): merge ${session.name} into main`, '-m', `Arxa-Stage: session ${id}`, session.branch],
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

  // Boundary push (D18 via D69): the FIRST push happens only here — after
  // the green merge to main. Best-effort and never session-fatal (D23:
  // pushes fail loud in the RESULT, the local merge stands; nothing parks
  // for a push failure). No origin = a normal local-only state.
  let push = { pushed: false, reason: 'no-origin' }
  const origin = getOrigin(repoPath, env)
  if (origin !== null) {
    const pushed = runGit(['push', '-u', 'origin', 'main'], { cwd: repoPath, env, allowFail: true })
    push = pushed !== null ? { pushed: true, origin } : { pushed: false, reason: 'push-failed' }
  }

  return { ...squash, gate, merged: true, parked: false, session, push }
}

/** User holds a session's work back from main (parks it; D40: never deleted). */
export function holdSession(repoPath, id, env = process.env) {
  return parkSession(sessionRepoFor(repoPath, id, env), id, 'held', env) // D98 preamble
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
  repoPath = sessionRepoFor(repoPath, id, env) // D98 repo-discovery preamble
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
  repoPath = sessionRepoFor(repoPath, id, env) // D98 repo-discovery preamble
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

/**
 * Drop (grilled 2026-09-02, Q3): a session that was opened but never used —
 * no user message ever landed in its conversation — is not resumed on
 * relaunch; it is removed outright so no orphan row survives. Worktree
 * (force: a never-typed-in session has no work worth a WIP snapshot),
 * branch, squash-base ref and registry row all go. Idempotent: an unknown
 * id is a `dropped:false` result, never a throw — boot cleanup must never
 * fail the boot.
 *
 * @returns {{ id, dropped: boolean, worktree?: string, branch?: string }}
 */
export function dropSession(repoPath, id, env = process.env) {
  repoPath = sessionRepoFor(repoPath, id, env) // D98 repo-discovery preamble
  const registry = readRegistry(repoPath, env)
  const session = registry.sessions.find((s) => s.id === id)
  if (!session) return { id, dropped: false }
  if (session.worktree && fs.existsSync(session.worktree)) {
    runGit(['worktree', 'remove', '--force', session.worktree], { cwd: repoPath, env, allowFail: true })
  }
  runGit(['worktree', 'prune'], { cwd: repoPath, env, allowFail: true })
  if (session.branch) runGit(['branch', '-D', session.branch], { cwd: repoPath, env, allowFail: true })
  runGit(['update-ref', '-d', `${SESSION_BASE_PREFIX}${id}`], { cwd: repoPath, env, allowFail: true })
  registry.sessions = registry.sessions.filter((s) => s.id !== id)
  writeRegistry(repoPath, registry, env)
  return { id, dropped: true, worktree: session.worktree, branch: session.branch }
}
