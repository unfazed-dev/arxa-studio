/**
 * Pull-request flow for published repos (Phase 2, D102 as revised by
 * D107/D106/D109). Replaces the local `merge --ff-only` + `push origin
 * main` inside `sessionStageBoundary` for any repo that HAS an origin.
 *
 * The D107 shape, and why it is not a squash-merge:
 *
 *   ready  → gate locally, collapse the branch to ONE commit, force-push
 *   open   → one PR for that exact commit (dedupe against an open one)
 *   merge  → PUT .../merge with `merge_method: 'merge'` (i.e. --no-ff)
 *            pinned to the reviewed sha, then fast-forward local main
 *
 * GitHub's squash-merge writes a commit to main whose CONTENT is the
 * branch's but whose ANCESTRY is not. Measured consequences: `branch -d`
 * refuses forever, `merge-base --is-ancestor` is false forever,
 * ahead/behind counts lie in both directions, and a revived session
 * re-proposes its own landed work and conflicts against itself. Collapsing
 * on the branch first and then merging with a real merge commit gets the
 * clean single-commit history AND true ancestry — `log --no-merges` (what
 * bisect walks) never lands on a `wip:` checkpoint, and `log
 * --first-parent` hides the merge commits.
 *
 * The collapse REWRITES the branch, so it must happen BEFORE the human
 * reviews: they read the exact commit that lands. That is also why the
 * push is a lease-guarded force.
 *
 * This module is orchestration only — every git call goes through
 * `runGit` and every GitHub call through an injected `api` object shaped
 * like the github-link service (`prCreate` / `prListForHead` / `prMerge`).
 * It deliberately does NOT import or mutate `sessions.js` state beyond
 * reading the registry and advancing the session's own squash base.
 */

import { runGit } from './run.js'
import { stageBoundarySquash, isDirty } from './commits.js'
import { listSessions, runGate, SESSION_BRANCH_PREFIX, SESSION_BASE_PREFIX } from './sessions.js'
import { getOrigin, fetchRepoAsync, ffMergeMain, mainSyncState } from './repos.js'
import { SUBJECT_RE } from './frame.js'
import { sessionTrailers } from './ledger.js'
import { integrateMain, isIntegrating } from './integrate.js'

/**
 * Per-session ref holding the base the PR collapse commits against — the
 * merge-base with main, NOT the last stage boundary. `stageBoundarySquash`
 * collapses everything since the ref it is given; pointing it at the
 * session's own boundary ref would leave 2+ commits on the branch for any
 * session that already hit a local boundary. The invariant this ref exists
 * to hold: exactly ONE commit between main and the branch tip.
 */
export const PRFLOW_BASE_PREFIX = 'refs/arxa/prflow-base/'

/**
 * The trailer that marks a collapsed session commit.
 *
 * Q14: `Arxa-Session:` replaces `Arxa-Stage: session <id>`. The old key was
 * doing three jobs — session, org boundary, version mint — so reading it back
 * told you nothing without also parsing its value. Nothing consumed it
 * (verified 2026-09-03), so the rename costs nothing.
 */
export function stageTrailer(id) {
  return `Arxa-Session: ${id}`
}

function session(repoPath, id, env) {
  const found = listSessions(repoPath, env).find((s) => s.id === id)
  if (!found) throw new Error(`unknown session "${id}"`)
  return found
}

/**
 * The commit body: attribution above, trailer as the LAST paragraph so
 * `git interpret-trailers` (and any log --format=%(trailers) consumer)
 * parses it. D107 moved attribution here from the PR body — the
 * `squash_merge_commit_message: 'PR_BODY'` workaround is dead with the
 * squash merge that needed it.
 */
export function collapseMessage(id, { attribution, container, author, actor, collaborator } = {}) {
  const lines = []
  if (attribution) lines.push(attribution, '')
  // One trailer paragraph: identity (session + container) and attribution
  // (author + collaborator) travel with the commit into git, where they
  // survive GitHub, the PR, and this tool entirely.
  lines.push(sessionTrailers({ id, container, author, actor, collaborator }))
  return lines.join('\n')
}

/**
 * Ready a session for review (D107 step 1-3).
 *
 * 1. Local gate as PRE-FLIGHT — a red gate NEVER pushes and never opens a
 *    PR. The same check.sh runs again on the runner against the pushed
 *    commit; this is the fast local half, not a replacement for it.
 * 2. Collapse the branch to ONE commit carrying the human's subject.
 * 3. Publish the branch with a lease-guarded force push.
 *
 * @param {string} repoPath primary worktree (main checked out)
 * @param {string} id session id
 * @param {{ subject: string, attribution?: string, env?: object,
 *           gate?: Function, origin?: string|null }} opts
 * @returns {{ sha: string|null, pushed: boolean, gate: object, branch: string,
 *             collapsed: boolean, reason?: string, origin?: string|null }}
 */
export function readySession(repoPath, id, { subject, attribution, author, actor, collaborator, env = process.env, gate = runGate, origin, integrate = true } = {}) {
  const s = session(repoPath, id, env)
  if (s.state !== 'open') {
    throw new Error(`session "${id}" is ${s.state} — revive it before readying a PR`)
  }
  // Q7: the subject IS the commit subject and the PR title. Validate before
  // anything mutates — a bad subject must not leave a rewritten branch.
  if (typeof subject !== 'string' || !SUBJECT_RE.test(subject)) {
    throw new TypeError(`readySession: subject must be a conventional commit subject, got ${JSON.stringify(subject)}`)
  }
  if (subject.includes('\n')) throw new TypeError('readySession: subject must be a single line')

  // ---- 0. integrate main FIRST (grilled 2026-09-03) -----------------------
  // Every commit is therefore gated against current main, which is what
  // continuous integration actually means — and it happens at a moment the
  // user started, so nothing is ever rewritten under a working agent.
  //
  // The position is load-bearing, not incidental. It must precede the reads
  // below: integrating changes what `merge-base` is, so `mergeBase`, the
  // `nothing-to-propose` check and `alreadyCollapsed` all have to see the
  // post-integrate world. An integrate necessarily makes `alreadyCollapsed`
  // false and the branch re-collapses onto the new base — correct, because the
  // branch genuinely has new content in it.
  //
  // A conflict returns HERE, before the collapse touches anything: the branch
  // is left mid-merge for the agent to resolve, and the next call is refused
  // by the guard above it until that is done.
  if (isIntegrating(s.worktree, env)) {
    return { sha: null, pushed: false, gate: { green: false, reason: 'integrating' }, branch: s.branch, collapsed: false, reason: 'integrate-conflict', files: [] }
  }
  if (integrate) {
    const done = integrateMain(s, { author: author ?? actor, collaborator, env, origin })
    if (done.conflicted) {
      return {
        sha: null, pushed: false, gate: { green: false, reason: 'integrating' }, branch: s.branch,
        collapsed: false, reason: 'integrate-conflict', files: done.files, onto: done.onto,
      }
    }
  }

  // ---- 1. collapse to one commit above the merge-base with main -----------
  // Collapse BEFORE gating, same order as sessionStageBoundary: the squash
  // absorbs the uncommitted WIP (commit-tree of the working tree), and the
  // gate then runs on that clean, collapsed tree. Gating first was wrong
  // for the default "light" gate (= clean tree + resolvable HEAD): every
  // real edit sat uncommitted in the worktree, so the gate read red, the
  // session parked, and the branch went out unchanged (2026-09-03, RESTO
  // smoke: "No commits between main and arxa/session/<id>" ×3, second
  // cause). A red gate after the collapse still never publishes — and
  // the collapsed commit stays on the branch, so nothing is lost (D40).
  const dirty = isDirty(s.worktree, env)
  const tip = runGit(['rev-parse', 'HEAD'], { cwd: s.worktree, env })
  const mergeBase = runGit(['merge-base', 'main', s.branch], { cwd: s.worktree, env })
  if (mergeBase === tip && !dirty) {
    const gateResult = gate(s.worktree, env)
    return { sha: null, pushed: false, gate: gateResult, branch: s.branch, collapsed: false, reason: 'nothing-to-propose' }
  }

  // Already collapsed? A clean tree with exactly one commit above the
  // merge-base carrying this subject is re-ready with nothing new — skip
  // the rewrite so the reviewed sha (and the open PR) survive untouched.
  const aheadCount = Number(runGit(['rev-list', '--count', `${mergeBase}..${tip}`], { cwd: s.worktree, env })) || 0
  const tipSubject = runGit(['log', '-1', '--format=%s', tip], { cwd: s.worktree, env })
  const alreadyCollapsed = !isDirty(s.worktree, env) && aheadCount === 1 && tipSubject === subject

  let sha = tip
  let collapsed = false
  if (!alreadyCollapsed) {
    const baseRef = `${PRFLOW_BASE_PREFIX}${id}`
    runGit(['update-ref', baseRef, mergeBase], { cwd: s.worktree, env })
    const squash = stageBoundarySquash(s.worktree, {
      message: subject,
      // The session row knows its own container; the caller supplies who acted.
      trailer: collapseMessage(id, { attribution, container: s.workspace, author: author ?? actor, collaborator }),
      env,
      baseRef,
    })
    // squashed:false can only mean the pre-squash WIP snapshot found the
    // branch already sitting on the base — treated as nothing to propose.
    if (!squash.squashed) {
      return { sha: null, pushed: false, gate: gate(s.worktree, env), branch: s.branch, collapsed: false, reason: 'nothing-to-propose' }
    }
    sha = squash.sha
    collapsed = true
    // Keep the session's own squash base on the collapsed commit, or the
    // next LOCAL stage boundary would re-collapse the already-published
    // commit and silently rewrite the sha under review.
    runGit(['update-ref', `${SESSION_BASE_PREFIX}${id}`, sha], { cwd: s.worktree, env })
  }

  // ---- 2. gate on the collapsed tree; red never publishes -----------------
  const gateResult = gate(s.worktree, env)
  if (!gateResult.green) {
    return { sha, pushed: false, gate: gateResult, branch: s.branch, collapsed, reason: 'gate-red' }
  }

  // ---- 3. publish the branch ---------------------------------------------
  const url = origin !== undefined ? origin : getOrigin(repoPath, env)
  if (url === null || url === undefined) {
    return { sha, pushed: false, gate: gateResult, branch: s.branch, collapsed, reason: 'no-origin', origin: null }
  }
  const pushed = pushSessionBranch(repoPath, s.branch, url, env)
  return { sha, pushed: pushed.pushed, gate: gateResult, branch: s.branch, collapsed, origin: url, push: pushed }
}

/**
 * Force-push a session branch under a lease.
 *
 * `--force-with-lease` with no expected value reads the remote-TRACKING
 * ref, which does not exist on a branch's first push — git then refuses
 * with "stale info" for the one case that needs no force at all. So the
 * expectation is resolved explicitly from the remote: absent → a plain
 * create; present → a lease pinned to the sha actually out there.
 */
export function pushSessionBranch(dir, branch, url, env = process.env) {
  const pushEnv = { ...env, GIT_TERMINAL_PROMPT: '0' }
  const remoteLine = runGit(['ls-remote', url, `refs/heads/${branch}`], { cwd: dir, env: pushEnv, allowFail: true })
  const remoteSha = remoteLine ? remoteLine.split(/\s+/)[0] : null
  const refspec = `refs/heads/${branch}:refs/heads/${branch}`
  const args = remoteSha === null
    ? ['push', url, refspec]
    : ['push', `--force-with-lease=refs/heads/${branch}:${remoteSha}`, '--force-if-includes', url, refspec]
  const out = runGit(args, { cwd: dir, env: pushEnv, allowFail: true })
  if (out === null) return { pushed: false, reason: remoteSha === null ? 'push-failed' : 'lease-stale', remoteSha }
  // Mirror the published tip locally so ahead/behind reads on the session
  // branch are honest without a second network round trip.
  runGit(['update-ref', `refs/remotes/origin/${branch}`, runGit(['rev-parse', branch], { cwd: dir, env })], {
    cwd: dir, env, allowFail: true,
  })
  return { pushed: true, remoteSha }
}

/**
 * Open the review PR, deduping against an already-open PR for this head
 * (file-pr rule 1 — readying twice must never open a second PR).
 *
 * @returns {Promise<{ number: number|null, url: string|null, created: boolean, headSha?: string|null }>}
 */
export async function openSessionPr(repoPath, id, {
  owner, name, subject, body, base = 'main', env = process.env, api,
} = {}) {
  if (!api || typeof api.prCreate !== 'function' || typeof api.prListForHead !== 'function') {
    throw new TypeError('openSessionPr: api must provide prCreate and prListForHead')
  }
  const branch = `${SESSION_BRANCH_PREFIX}${id}`
  const open = await api.prListForHead(owner, name, branch)
  const existing = Array.isArray(open) ? open[0] : null
  if (existing) {
    return {
      number: existing.number ?? null,
      url: existing.html_url ?? null,
      created: false,
      headSha: existing.head?.sha ?? null,
    }
  }
  const pr = await api.prCreate(owner, name, { title: subject, body: body ?? '', head: branch, base })
  return {
    number: pr?.number ?? null,
    url: pr?.html_url ?? null,
    created: true,
    headSha: pr?.head?.sha ?? null,
  }
}

/**
 * Merge the reviewed PR and reconcile local main (D107 step 4-6).
 *
 * `sha` is the commit the human reviewed. GitHub refuses the merge (409)
 * if the branch head moved since — that refusal is the point, not an
 * inconvenience: it is what stops a merge of work nobody read.
 *
 * @returns {Promise<{ merged: boolean, mergeSha: string|null, localMainSha: string|null, reconcile: object }>}
 */
export async function mergeSessionPr(repoPath, id, {
  owner, name, number, sha, subject, message, env = process.env, api, origin,
} = {}) {
  if (!api || typeof api.prMerge !== 'function') {
    throw new TypeError('mergeSessionPr: api must provide prMerge')
  }
  if (!sha) throw new TypeError('mergeSessionPr: the reviewed sha is required — an unpinned merge can land unreviewed work')
  const result = await api.prMerge(owner, name, { number, sha, subject, message })
  if (!result || result.merged !== true) {
    // Keep the API's own reason when it gave one ('not-mergeable' = GitHub
    // says this branch conflicts with main). Flattening every refusal to
    // 'not-merged' told the caller nothing it could act on.
    const reason = result?.reason ?? 'not-merged'
    return { merged: false, mergeSha: result?.sha ?? null, localMainSha: null, reason, message: result?.message ?? '', reconcile: { reason } }
  }
  const reconcile = await reconcileLocalMain(repoPath, { env, origin })
  return { merged: true, mergeSha: result.sha ?? null, localMainSha: reconcile.localMainSha, reconcile }
}

/**
 * Fetch origin and fast-forward local main onto it (D107 step 6). Until
 * this runs, local main is behind the merge and `card.status` mis-reports
 * ahead/behind in both directions.
 *
 * Strictly `--ff-only` (via ffMergeMain): a DIVERGED main is never
 * auto-merged — it comes back `diverged: true` for the caller to surface.
 *
 * @returns {{ fetched: boolean, advanced: boolean, localMainSha: string|null, sync: object, reason?: string }}
 */
export async function reconcileLocalMain(repoPath, { env = process.env, origin, timeout } = {}) {
  const url = origin !== undefined ? origin : getOrigin(repoPath, env)
  const localSha = () => runGit(['rev-parse', 'main'], { cwd: repoPath, env, allowFail: true })
  if (url === null || url === undefined) {
    return { fetched: false, advanced: false, localMainSha: localSha(), sync: mainSyncState(repoPath, env), reason: 'no-origin' }
  }
  // Async: `card.status` runs this on every status poll, and a sync fetch to
  // GitHub froze the host for ~0.35s each time (measured 2026-09-07).
  const fetched = await fetchRepoAsync(repoPath, url, env, { timeout })
  const advanced = ffMergeMain(repoPath, env)
  const sync = mainSyncState(repoPath, env)
  return {
    fetched,
    advanced,
    localMainSha: localSha(),
    sync,
    ...(sync.diverged ? { reason: 'diverged' } : {}),
  }
}
