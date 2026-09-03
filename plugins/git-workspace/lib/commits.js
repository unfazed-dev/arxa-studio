// Two-tier commits (D18): continuous local-only WIP auto-commits
// underneath (crash-safety, the substrate for undo); clean squashed
// stage commits on top; only stage commits are ever seen by history,
// sharing, or CI.
//
// Mechanics (hardened per advisor consult):
// - WIP commits carry a distinct committer identity (wip@arxa.invalid)
//   AND a "wip:" subject prefix — tier membership is decided by
//   identity, so a user commit that merely starts with "wip:" is never
//   swallowed as app plumbing.
// - The last stage boundary is recorded in the ref
//   `refs/arxa/stage-base` (repo-local state, travels nowhere) instead
//   of being rediscovered by log scanning.
// - The squash takes a final WIP auto-commit first (so the stage commit
//   is built from committed state, and an aborted commit aborts the
//   squash), then builds the clean commit with `git commit-tree` +
//   `git update-ref` — no index mutation, no reset, no user hooks.
//   The WIP run drops out of branch history; it lingers only in the
//   local reflog, which is never pushed.

import { runGit, WIP_IDENTITY, STAGE_IDENTITY } from './run.js'

export const STAGE_BASE_REF = 'refs/arxa/stage-base'
export const WIP_PREFIX = 'wip:'

const SEP = '\x1f' // unit separator for log parsing

function head(repoPath, env) {
  return runGit(['rev-parse', 'HEAD'], { cwd: repoPath, env })
}

function currentBranchRef(repoPath, env) {
  const ref = runGit(['symbolic-ref', '-q', 'HEAD'], { cwd: repoPath, env, allowFail: true })
  if (!ref) throw new Error(`detached HEAD in ${repoPath} — stage commits require a branch`)
  return ref
}

/**
 * The recorded last stage boundary (falls back to HEAD's root commit).
 * `baseRef` (phase 4 extension): sessions track their own boundary in a
 * per-session ref — refs are shared across worktrees, so concurrent
 * sessions cannot all use the one STAGE_BASE_REF.
 */
export function stageBase(repoPath, env = process.env, baseRef = STAGE_BASE_REF) {
  const recorded = runGit(['rev-parse', '-q', '--verify', baseRef], {
    cwd: repoPath, env, allowFail: true,
  })
  if (recorded) return recorded
  const roots = runGit(['rev-list', '--max-parents=0', 'HEAD'], { cwd: repoPath, env })
  return roots.split('\n')[0]
}

/** True when the working tree has anything uncommitted (incl. untracked). */
export function isDirty(repoPath, env = process.env) {
  return runGit(['status', '--porcelain'], { cwd: repoPath, env }) !== ''
}

/**
 * WIP tier: one continuous auto-commit. Commits everything (add -A)
 * under the WIP identity. No-op when the tree is clean.
 *
 * @returns {{ committed: boolean, sha: string|null }}
 */
export function wipCommit(repoPath, { message, env = process.env } = {}) {
  if (!isDirty(repoPath, env)) return { committed: false, sha: null }
  runGit(['add', '-A'], { cwd: repoPath, env })
  const subject = `${WIP_PREFIX} ${message || `auto-save ${new Date().toISOString()}`}`
  runGit(['commit', '-m', subject], { cwd: repoPath, env, identity: WIP_IDENTITY })
  return { committed: true, sha: head(repoPath, env) }
}

/** Commits since the last stage boundary (newest first), WIP tier flagged by committer identity. */
export function wipRun(repoPath, env = process.env, baseRef = STAGE_BASE_REF) {
  const base = stageBase(repoPath, env, baseRef)
  const out = runGit(
    ['log', `--format=%H${'%x1f'}%ce${'%x1f'}%s`, `${base}..HEAD`],
    { cwd: repoPath, env },
  )
  if (!out) return []
  return out.split('\n').map((line) => {
    const [sha, committerEmail, subject] = line.split(SEP)
    return { sha, subject, wip: committerEmail === WIP_IDENTITY.email }
  })
}

/**
 * Stage boundary (D18): squash everything since the last stage boundary
 * into ONE clean stage commit. Takes a final WIP auto-commit first; if
 * there is nothing at all to squash, returns `{ squashed: false }`.
 * History after this shows only stage commits — the WIP layer never
 * reaches history, sharing, or CI.
 *
 * @param {string} repoPath
 * @param {{ message: string, env?: object, baseRef?: string }} opts
 *        `baseRef` (phase 4): per-session boundary ref — see stageBase.
 * @returns {{ squashed: boolean, sha: string|null }}
 */
export function stageBoundarySquash(repoPath, { message, trailer, env = process.env, baseRef = STAGE_BASE_REF }) {
  if (!message) throw new TypeError('stageBoundarySquash requires a message')
  // Final WIP auto-commit so the squash is built from committed state.
  // If this throws (index.lock, etc.) the squash aborts with it.
  wipCommit(repoPath, { message: 'pre-squash snapshot', env })

  const base = stageBase(repoPath, env, baseRef)
  const tip = head(repoPath, env)
  if (base === tip) return { squashed: false, sha: null } // nothing since last boundary

  const branchRef = currentBranchRef(repoPath, env)
  // Q7 (2026-08-31): the stage subject is the caller's message VERBATIM —
  // conventional everywhere history looks; the old `stage:` prefix is
  // dead. Provenance rides a git TRAILER (Arxa-Stage: <origin>) —
  // machine-parseable, invisible in subjects.
  const treeArgs = ['commit-tree', `${tip}^{tree}`, '-p', base, '-m', message]
  if (trailer) treeArgs.push('-m', trailer)
  // Hook-free, index-free clean commit: same tree as HEAD, parent = base.
  const stageSha = runGit(treeArgs, { cwd: repoPath, env, identity: STAGE_IDENTITY })
  // Atomic move of the branch: fails if someone advanced it under us.
  runGit(['update-ref', branchRef, stageSha, tip], { cwd: repoPath, env })
  runGit(['update-ref', baseRef, stageSha], { cwd: repoPath, env })
  return { squashed: true, sha: stageSha }
}

/**
 * Stage-tier history (what sharing/CI/history surfaces consume): every
 * commit reachable from HEAD, which after squashes is stage commits
 * only. Returns subjects newest-first, SHAs included for plumbing —
 * UX surfaces must render the version chip (versions.js), never these
 * SHAs (D44).
 */
export function stageLog(repoPath, env = process.env) {
  const out = runGit(['log', `--format=%H${'%x1f'}%s`], { cwd: repoPath, env })
  if (!out) return []
  return out.split('\n').map((line) => {
    const [sha, subject] = line.split(SEP)
    return { sha, subject }
  })
}

// ---- D101: commit-day streaks, derived live from git --------------------
// Streaks are computed from `git log` on demand, never persisted — git is
// authoritative and this codebase's dominant bug class is stale caches
// (D88, D96, B7). A short, module-scope, per-repo cache only smooths
// repeated reads within one open (e.g. re-renders of the insight panel),
// it is not a store.

const COMMIT_DAYS_TTL_MS = 60_000
const commitDaysCache = new Map() // repoPath -> { at, since, value }

/** Local calendar day (YYYY-MM-DD) for "today"/"yesterday" comparisons —
 *  matches `git log --date=short`, which renders in local time. */
function localYmd(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(ymd, delta) {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + delta)
  return localYmd(dt)
}

/**
 * Commit-day streak data for the insight panel (D101, phase 4 A3):
 * `git log --date=short --pretty=%ad --since=<since>`, bucketed by day.
 *
 * @param {string} repoPath
 * @param {{ since?: string, env?: object }} [opts] `since` is any git
 *        `--since` expression (default '90 days' — a rolling window, not
 *        a fixed date, so the cache key does not need to change daily).
 * @returns {{ days: {day:string, count:number}[], current: number, longest: number }}
 *          `days` ascending by date. `current` counts consecutive days
 *          ending today; if today has no commits yet (the session is
 *          still in progress) it falls back to counting the streak ending
 *          yesterday, so an in-progress streak isn't shown as broken
 *          before the day is even over. `longest` is the longest run in
 *          the queried window.
 */
export function commitDays(repoPath, { since = '90 days', env = process.env } = {}) {
  const cached = commitDaysCache.get(repoPath)
  const now = Date.now()
  if (cached && cached.since === since && now - cached.at < COMMIT_DAYS_TTL_MS) {
    return cached.value
  }

  // allowFail: an empty/newly-initialised repo (no commits yet) must read
  // as all-zeros, never throw.
  const out = runGit(
    ['log', '--date=short', '--pretty=%ad', `--since=${since}`],
    { cwd: repoPath, env, allowFail: true },
  )

  const counts = new Map() // day -> count
  if (out) {
    for (const day of out.split('\n')) {
      if (!day) continue
      counts.set(day, (counts.get(day) ?? 0) + 1)
    }
  }

  const days = [...counts.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))

  const today = localYmd(new Date())
  const startDay = counts.has(today) ? today : addDays(today, -1)
  let current = 0
  let cursor = startDay
  while (counts.has(cursor)) {
    current += 1
    cursor = addDays(cursor, -1)
  }

  let longest = 0
  let run = 0
  let prevDay = null
  for (const { day } of days) {
    run = prevDay !== null && addDays(prevDay, 1) === day ? run + 1 : 1
    longest = Math.max(longest, run)
    prevDay = day
  }

  const value = { days, current, longest }
  commitDaysCache.set(repoPath, { at: now, since, value })
  return value
}

/** Test-only escape hatch: force the next commitDays() call to recompute. */
commitDays.clearCache = () => commitDaysCache.clear()

/**
 * The newest commit on `branch` that represents the session's actual work —
 * i.e. the newest one that is NOT a WIP checkpoint.
 *
 * "Did this session's work land in main?" must not be asked of the raw branch
 * tip. After a merge the tip is routinely a WIP auto-save (the watcher fires,
 * or archive takes its own snapshot), and that checkpoint is by definition not
 * in main — so the raw tip answers "unmerged" for a session that merged
 * cleanly, and its remote branch is then kept forever (2026-09-03,
 * kitchen-project #1). WIP commits are app plumbing (D18): they carry the WIP
 * committer identity and are squashed away at the next boundary, so they are
 * exactly what this question skips.
 *
 * Returns null when the branch is unreadable or holds nothing but WIP.
 */
export function reviewedTip(repoPath, branch, env = process.env, { limit = 100 } = {}) {
  const log = runGit(['log', branch, '-n', String(limit), '--format=%H%x09%ce'], { cwd: repoPath, env, allowFail: true })
  if (!log) return null
  for (const line of log.split('\n')) {
    const [sha, committer] = line.split('\t')
    if (sha && committer !== WIP_IDENTITY.email) return sha
  }
  return null
}
