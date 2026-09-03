// Bringing main into a session (grilled 2026-09-03, docs/plans/session-integrate-main.md).
//
// The gap this closes: tier 3 put two sessions on the same file from the same
// base. The first landed; the second was 2 behind AND conflicting, and arxa
// had no way out — the only escape was raw `git rebase` in a terminal, inside
// a worktree arxa had made. There was no `card.rebase`, no `session.integrate`,
// nothing. The whole repair had to happen outside the product.
//
// WHY MERGE AND NOT REBASE. `readySession` already collapses the branch to one
// commit above `merge-base('main', branch)` on every commit, so after either
// verb the branch ends as the identical single commit — the merge commit is
// erased by the collapse that follows it. The verbs differ only in the failure
// path: a rebase replays every commit and can stop N times (D18 leaves a WIP
// commit per quiet period, so N is not small), while a merge stops exactly
// once. Same destination, a tenth of the conflict stops.
//
// WHY NOTHING HERE RUNS ON ITS OWN. Every shipped implementation of "keep the
// branch current" computes the merge somewhere disposable and never writes to
// a developer's checkout: GitHub's Update-branch works on the copy on GitHub
// and warns that a local clone will need a hard reset; merge queues build a
// throwaway branch; GitLab merge trains use a synthetic commit. So `mergePreview`
// is the automatic half — it answers "would this conflict?" touching nothing —
// and `integrateMain` writes only when a person presses something or a commit
// asks for it. DORA's data says know within a day; it does not say let a robot
// type into the file someone is editing.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { runGit, runGitProbe } from './run.js'
import { isDirty, wipCommit } from './commits.js'
import { getOrigin, fetchRepo, ffMergeMain, mainSyncState } from './repos.js'
import { recordStage } from './ledger.js'

/** Conflict markers at the start of a line — what a resolution must remove. */
const MARKER_RE = '^(<<<<<<<|>>>>>>>) '

/**
 * Is a merge sitting half-finished in this worktree?
 *
 * Asked of git every time rather than stored on the session row (grilled
 * 2026-09-03). A stored flag is a second copy of a truth git already owns, and
 * every copy can go stale: resolve in a terminal and the row still says
 * conflicted, or crash mid-merge and the row was never written at all. Reading
 * it costs one `rev-parse` and cannot be wrong.
 */
export function isIntegrating(worktree, env = process.env) {
  return runGit(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: worktree, env, allowFail: true }) !== null
}

/** Tracked files still carrying conflict markers. */
export function conflictMarkerFiles(worktree, env = process.env) {
  const r = runGitProbe(['grep', '-lE', MARKER_RE], { cwd: worktree, env })
  if (r.status !== 0) return [] // 1 = no matches; anything else = nothing to report
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
}

/** Paths git itself still considers unmerged. */
export function unmergedPaths(worktree, env = process.env) {
  const out = runGit(['diff', '--name-only', '--diff-filter=U'], { cwd: worktree, env, allowFail: true })
  return (out ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
}

/** Does this git know `merge-tree --write-tree` (2.38+)? */
function hasWriteTree(worktree, env) {
  const v = runGit(['--version'], { cwd: worktree, env, allowFail: true }) ?? ''
  const m = /(\d+)\.(\d+)/.exec(v)
  if (!m) return false
  return Number(m[1]) > 2 || (Number(m[1]) === 2 && Number(m[2]) >= 38)
}

/**
 * Would merging `main` into `branch` conflict — without touching anything.
 *
 * This is the automatic half, and it runs once per open session every 30
 * seconds, so "touching nothing" is a hard requirement rather than a nicety.
 *
 * MEASURED 2026-09-03 on git 2.51: a plain `merge-tree --write-tree` leaves 2
 * loose objects in the repo PER CALL. At this cadence that is an object-store
 * leak, so the probe runs with GIT_OBJECT_DIRECTORY pointed at a scratch dir
 * and the real store as an alternate — reads still resolve, writes are thrown
 * away with the directory. Re-measured with the redirect: 0 objects added,
 * byte-identical output.
 *
 * Older git has no `--write-tree`. The fallback is the LEGACY three-argument
 * form, which every git version has and which writes nothing at all. A
 * detached temp worktree would also work and is what retro-CI uses, but it
 * writes to disk and takes seconds — a 30-second poll cannot afford it.
 *
 * `conflicts` is `null`, never `false`, when neither form could answer. The
 * caller shows no badge rather than a clean one: "we did not check" and "there
 * is no conflict" are different claims and only one of them was earned.
 *
 * @returns {{ behind: number, conflicts: boolean|null, files: string[], mode: string }}
 */
export function mergePreview(repoPath, branch, { env = process.env, base = 'main' } = {}) {
  const behind = Number(runGit(['rev-list', '--count', `${branch}..${base}`], { cwd: repoPath, env, allowFail: true }) ?? '') || 0
  if (behind === 0) return { behind: 0, conflicts: false, files: [], mode: 'not-behind' }

  if (hasWriteTree(repoPath, env)) {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-mergeprobe-'))
    try {
      const r = runGitProbe(['merge-tree', '--write-tree', '--name-only', base, branch], {
        cwd: repoPath,
        env,
        objectDir: { write: scratch, read: path.join(repoPath, '.git', 'objects') },
      })
      if (r.status === 0) return { behind, conflicts: false, files: [], mode: 'merge-tree' }
      if (r.status === 1) {
        // stdout: tree oid on line 1, then the conflicted paths, then a blank
        // line and git's own narrative — which is prose, not paths.
        const lines = r.stdout.split('\n')
        const files = []
        for (const line of lines.slice(1)) {
          if (line.trim() === '') break
          files.push(line.trim())
        }
        return { behind, conflicts: true, files, mode: 'merge-tree' }
      }
      // any other status: fall through to the legacy probe
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true })
    }
  }

  const mergeBase = runGit(['merge-base', base, branch], { cwd: repoPath, env, allowFail: true })
  if (mergeBase === null) return { behind, conflicts: null, files: [], mode: 'unavailable' }
  const legacy = runGitProbe(['merge-tree', mergeBase, branch, base], { cwd: repoPath, env })
  if (legacy.status !== 0) return { behind, conflicts: null, files: [], mode: 'unavailable' }
  // The legacy form prints the merged result inline; a real conflict shows as
  // markers in that output. No markers means it merged cleanly.
  const conflicts = /^\+?<<<<<<< /m.test(legacy.stdout)
  const files = conflicts
    ? [...legacy.stdout.matchAll(/^(?:changed in both|added in both)\n\s+base\s+\S+\s+\S+\s+(\S+)/gm)].map((m) => m[1])
    : []
  return { behind, conflicts, files, mode: 'merge-tree-legacy' }
}

/**
 * Bring main into a session's worktree.
 *
 * Order matters and each step earns its place:
 *
 * 1. `reconcileLocalMain` — fetch, then fast-forward LOCAL main. Both halves
 *    are needed. The fetch is the only way to learn main moved on GitHub (or
 *    from another machine), and the fast-forward is what makes the collapse
 *    that follows correct: `readySession` computes `merge-base('main', branch)`
 *    against local main, so integrating against a stale local main would leave
 *    the collapse reasoning from an old base.
 * 2. Not behind → return, having written nothing.
 * 3. `wipCommit` if the tree is dirty. `git merge` refuses to start on a dirty
 *    tree, and in arxa the tree is dirty most of the time — D18 keeps a
 *    continuous WIP tier and `watch.js` commits it on a timer. A commit is
 *    used rather than a stash on purpose: a stash pop can itself conflict,
 *    stacking a second conflict on top of the one being resolved, and a
 *    dropped stash is unrecoverable where a commit is not. The collapse erases
 *    it at the next commit anyway.
 * 4. Merge. A conflict is left IN PLACE — markers in the files, MERGE_HEAD
 *    set — because in arxa the thing that resolves them is the agent working
 *    in that worktree. Aborting would restore the tree and leave the user
 *    exactly where they started: knowing there is a conflict, with no way to
 *    act on it.
 */
export function integrateMain(session, { author, collaborator, env = process.env, origin, base = 'main' } = {}) {
  const worktree = session.worktree
  const repoPath = session.repoPath ?? worktree

  if (isIntegrating(worktree, env)) {
    return { integrated: false, conflicted: true, reason: 'already-integrating', files: unmergedPaths(worktree, env), behind: null, onto: null }
  }

  const url = origin !== undefined ? origin : getOrigin(repoPath, env)
  let fetched = false
  if (url !== null && url !== undefined) {
    fetched = fetchRepo(repoPath, url, env)
    ffMergeMain(repoPath, env)
  }
  const sync = mainSyncState(repoPath, env)

  const behind = Number(runGit(['rev-list', '--count', `HEAD..${base}`], { cwd: worktree, env, allowFail: true }) ?? '') || 0
  const onto = runGit(['rev-parse', '--short', base], { cwd: worktree, env, allowFail: true })
  if (behind === 0) {
    return { integrated: false, conflicted: false, reason: url ? 'current' : 'no-origin', behind: 0, onto, fetched, sync, files: [] }
  }

  const wip = isDirty(worktree, env) ? wipCommit(worktree, { message: 'pre-integrate snapshot', env }) : { committed: false, sha: null }

  // core.editor=true so a merge that wants a message never blocks on an editor
  // the engine does not have — the same guard the rebase path used in tier 3.
  const m = runGitProbe(['-c', 'core.editor=true', 'merge', '--no-edit', base], { cwd: worktree, env })
  const conflicted = isIntegrating(worktree, env)

  if (m.status !== 0 && !conflicted) {
    return { integrated: false, conflicted: false, reason: 'merge-failed', message: m.stderr.trim(), behind, onto, wip, files: [] }
  }

  const files = conflicted ? unmergedPaths(worktree, env) : []
  recordStage(repoPath, session.id, {
    stage: 'integrated',
    author,
    collaborator,
    result: conflicted ? 'conflicted' : 'clean',
    sha: conflicted ? null : runGit(['rev-parse', '--short', 'HEAD'], { cwd: worktree, env, allowFail: true }),
    detail: conflicted ? `onto ${onto} · ${files.length} file(s) to resolve: ${files.join(', ')}` : `onto ${onto}`,
  }, env)

  return { integrated: !conflicted, conflicted, behind, onto, wip, fetched, sync, files }
}

/**
 * Conclude a merge whose conflicts have been resolved.
 *
 * Refuses while any tracked file still carries a marker. Git alone will not
 * catch this: it blocks a commit with UNMERGED PATHS, but a file that was
 * `git add`ed while still containing `<<<<<<<` is, as far as git is concerned,
 * resolved — it commits happily and the breakage surfaces later as a
 * bewildering gate failure. One grep here turns that into a plain sentence.
 */
export function finishIntegrate(session, { author, collaborator, env = process.env } = {}) {
  const worktree = session.worktree
  const repoPath = session.repoPath ?? worktree
  if (!isIntegrating(worktree, env)) return { finished: false, reason: 'not-integrating' }

  const stillUnmerged = unmergedPaths(worktree, env)
  const stillMarked = conflictMarkerFiles(worktree, env)
  const blocked = [...new Set([...stillUnmerged, ...stillMarked])]
  if (blocked.length > 0) {
    return { finished: false, reason: 'markers-remain', files: blocked, unmerged: stillUnmerged, marked: stillMarked }
  }

  runGit(['add', '-A'], { cwd: worktree, env })
  const c = runGitProbe(['-c', 'core.editor=true', 'commit', '--no-edit'], { cwd: worktree, env })
  if (c.status !== 0) return { finished: false, reason: 'commit-failed', message: c.stderr.trim() }

  const sha = runGit(['rev-parse', '--short', 'HEAD'], { cwd: worktree, env, allowFail: true })
  const onto = runGit(['rev-parse', '--short', 'main'], { cwd: worktree, env, allowFail: true })
  recordStage(repoPath, session.id, {
    stage: 'integrated',
    author,
    collaborator,
    result: 'resolved',
    sha,
    detail: `onto ${onto}`,
  }, env)
  return { finished: true, sha, onto }
}
