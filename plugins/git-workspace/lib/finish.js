// Session lifecycle, Phase 3 (D108, D104 as revised by D107): Finish + Sweep.
//
// D107 (docs/plans/git-card-sessions-worktree-rewire.md §9): sessions
// collapse to one commit and merge with `--no-ff` (or fast-forward, when
// main hasn't diverged) — either way the session branch's tip is a real
// ancestor of main afterwards. That is exactly what `sessionStageBoundary`
// in sessions.js already does on a green gate (`merge --ff-only` falling
// back to `merge --no-ff`). So under D107, ordinary git ancestry
// (`merge-base --is-ancestor`, `branch --merged`) is trustworthy again —
// the old D104 GitHub-squash workaround (gate on PR `merged: true`, or a
// `rev-list --count` fallback) is no longer needed for correctness. Keep
// the PR flag as a UI signal only; this module gates on ancestry.
//
// Finish reuses `archiveSession` (sessions.js) for the worktree-removal +
// final-snapshot half — it is not reimplemented here — and adds the two
// things archive deliberately never does (D40: archive never deletes):
// branch deletion and the per-session base-ref cleanup, both gated on the
// branch actually being merged into main.

import fs from 'node:fs'
import { runGit } from './run.js'
import { listSessions, archiveSession, annotateSession, SESSION_BASE_PREFIX, SESSION_BRANCH_PREFIX } from './sessions.js'

/** Finish refused: the session branch is not (yet) merged into main. */
export class FinishRefusedError extends Error {
  constructor(id, branch, reason) {
    super(`session "${id}" (${branch}) cannot finish — ${reason}`)
    this.name = 'FinishRefusedError'
    this.sessionId = id
    this.branch = branch
    this.reason = reason
  }
}

function getSessionOrThrow(repoPath, id, env) {
  const session = listSessions(repoPath, env).find((s) => s.id === id)
  if (!session) throw new Error(`unknown session "${id}"`)
  return session
}

/** How many commits main has that `branch` lacks — soft context, not a gate (D108). */
export function behindMain(repoPath, branch, env = process.env) {
  const out = runGit(['rev-list', '--count', `${branch}..main`], { cwd: repoPath, env })
  return Number(out)
}

/** The branch's own tip: `{ sha, subject }` — what revive shows for "this session's last commit". */
export function branchTip(repoPath, branch, env = process.env) {
  const out = runGit(['log', '-1', '--format=%H%x1f%s', branch], { cwd: repoPath, env })
  const sep = out.indexOf('\x1f')
  return { sha: out.slice(0, sep), subject: out.slice(sep + 1) }
}

/** True iff `branch`'s tip is an ancestor of main (D107: real merges, so this is trustworthy again). */
export function isMergedIntoMain(repoPath, branch, env = process.env) {
  return runGit(['merge-base', '--is-ancestor', branch, 'main'], { cwd: repoPath, env, allowFail: true }) !== null
}

function isWorktreeClean(worktreePath, env) {
  const status = runGit(['status', '--porcelain'], { cwd: worktreePath, env, allowFail: true })
  return status === ''
}

/**
 * Finish a session (D104/D107): refuses unless its branch is merged into
 * main; otherwise archives it (via `archiveSession` — worktree removal +
 * final snapshot, skipped if already archived), then deletes the branch
 * and its per-session base ref. Never force-deletes anything that isn't
 * independently verified clean first, and never `rm -rf`.
 *
 * Also refuses (before touching anything) if the worktree still has
 * uncommitted changes: `archiveSession` would WIP-commit them, moving the
 * branch tip past what was actually verified merged, silently widening
 * the ancestry check we just passed. Caught up front, not after — a
 * refusal must never leave a half-mutated repo.
 *
 * @returns {{ finished: boolean, id: string, branch: string, dryRun?: boolean,
 *   reason?: string, archivedNow?: boolean, worktreeRemoved?: boolean,
 *   branchDeleted?: boolean, baseRefDeleted?: boolean }}
 */
export function finishSession(repoPath, id, { env = process.env, dryRun = false } = {}) {
  const session = getSessionOrThrow(repoPath, id, env)
  const branch = session.branch
  const merged = isMergedIntoMain(repoPath, branch, env)

  if (!merged) {
    if (dryRun) return { finished: false, dryRun: true, id, branch, reason: 'not-merged' }
    throw new FinishRefusedError(id, branch, 'not-merged')
  }

  if (session.state !== 'archived' && fs.existsSync(session.worktree) && !isWorktreeClean(session.worktree, env)) {
    if (dryRun) return { finished: false, dryRun: true, id, branch, reason: 'worktree-dirty' }
    throw new FinishRefusedError(id, branch, 'worktree-dirty')
  }

  if (dryRun) return { finished: false, dryRun: true, id, branch, wouldFinish: true }

  let archivedNow = false
  if (session.state !== 'archived') {
    try {
      archiveSession(repoPath, id, env)
      archivedNow = true
    } catch (err) {
      // archiveSession's plain `worktree remove` refuses on anything it
      // doesn't expect. Fall back to --force ONLY when independently
      // verified clean — never on a dirty tree, never `rm -rf`.
      if (fs.existsSync(session.worktree) && isWorktreeClean(session.worktree, env)) {
        runGit(['worktree', 'remove', '--force', session.worktree], { cwd: repoPath, env })
        archiveSession(repoPath, id, env) // worktree now gone -> prune path, sets archived
        archivedNow = true
      } else {
        throw err
      }
    }
  }

  // No explicit `worktree prune` here: archiveSession already prunes on
  // every path that removes a worktree (normal remove, and the gone-worktree
  // fallback below) — a second prune call here was pure redundant spawn cost.

  const branchDeleted = runGit(['branch', '-d', branch], { cwd: repoPath, env, allowFail: true }) !== null
  if (!branchDeleted) {
    throw new Error(`finishSession: "git branch -d ${branch}" refused despite passing the ancestry check`)
  }

  const baseRef = `${SESSION_BASE_PREFIX}${id}`
  const hasBaseRef = runGit(['show-ref', '--verify', '--quiet', baseRef], { cwd: repoPath, env, allowFail: true }) !== null
  let baseRefDeleted = false
  if (hasBaseRef) {
    runGit(['update-ref', '-d', baseRef], { cwd: repoPath, env })
    baseRefDeleted = true
  }

  // Stamp finishedAt so a finished session reads as distinct from a merely
  // parked/archived one (branch+worktree both gone; revive must not be
  // offered on it — the card layer gates on this field).
  annotateSession(repoPath, id, { finishedAt: Date.now() }, env)

  return { finished: true, id, branch, archivedNow, worktreeRemoved: true, branchDeleted, baseRefDeleted }
}

/**
 * Sweep the backlog: every registry session whose branch is merged into
 * main gets finished. `dryRun` (default true) previews `finished` without
 * touching anything — pass `dryRun: false` to actually run it.
 *
 * @returns {{ finished: object[], skipped: object[] }}
 */
export function sweepMerged(repoPath, { env = process.env, dryRun = true } = {}) {
  const mergedOut = runGit(['branch', '--merged', 'main', '--format=%(refname:short)'], { cwd: repoPath, env })
  const merged = new Set(mergedOut.split('\n').map((s) => s.trim()).filter(Boolean))
  const allOut = runGit(['branch', '--format=%(refname:short)'], { cwd: repoPath, env })
  const allBranches = new Set(allOut.split('\n').map((s) => s.trim()).filter(Boolean))

  const finished = []
  const skipped = []
  for (const session of listSessions(repoPath, env)) {
    if (!session.branch.startsWith(SESSION_BRANCH_PREFIX)) continue
    // Already finished: branch (and its worktree) are gone, so it's not a
    // sweep candidate at all — distinct from "not merged yet", otherwise
    // every already-finished session pollutes `skipped` as 'not-merged'
    // on every future sweep, forever.
    if (!allBranches.has(session.branch)) {
      skipped.push({ id: session.id, branch: session.branch, reason: 'already-finished' })
      continue
    }
    if (!merged.has(session.branch)) {
      skipped.push({ id: session.id, branch: session.branch, reason: 'not-merged' })
      continue
    }
    if (dryRun) {
      finished.push({ id: session.id, branch: session.branch, dryRun: true, wouldFinish: true })
      continue
    }
    try {
      finished.push(finishSession(repoPath, session.id, { env, dryRun: false }))
    } catch (err) {
      skipped.push({ id: session.id, branch: session.branch, reason: err.reason || err.message })
    }
  }
  return { finished, skipped }
}
