/**
 * prflow selftest (Phase 2, D107) — FULLY OFFLINE, real git throughout.
 *
 * "Origin" is a local bare repo. GitHub is a fake `fetch` that records every
 * call — but crucially it does NOT just rubber-stamp the merge: it keeps a
 * second non-bare clone as the server's working copy and performs a REAL
 * `merge --no-ff` there, then pushes. Without that, `reconcileLocalMain`
 * would fetch an unchanged origin, local main would never move, and every
 * ancestry assertion below would pass vacuously — which is the exact
 * property (D107) this file exists to prove.
 *
 * Plain node assert; exit 0 on green.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { runGit } from './lib/run.js'
import { wipCommit } from './lib/commits.js'
import { openSession } from './lib/sessions.js'
import { setOrigin } from './lib/repos.js'
import { readySession, openSessionPr, mergeSessionPr, reconcileLocalMain, stageTrailer } from './lib/prflow.js'
import { prCreateApi, prListForHeadApi, prMergeApi, prStateApi } from '../github-link/lib/frame.js'

let passed = 0
function ok(cond, label) {
  assert.ok(cond, label)
  passed++
  console.log('  ✓ ' + label)
}

const g = (cwd, args, allowFail = false) => runGit(args, { cwd, allowFail })

// ---- world ------------------------------------------------------------------

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-prflow-'))
const originPath = path.join(root, 'origin.git')
const repoPath = path.join(root, 'repo')
const serverPath = path.join(root, 'server')

function buildWorld() {
  fs.mkdirSync(repoPath, { recursive: true })
  g(root, ['init', '--bare', '--initial-branch=main', originPath])
  g(repoPath, ['init', '--initial-branch=main'])
  fs.writeFileSync(path.join(repoPath, 'README.md'), '# base\n')
  g(repoPath, ['add', '-A'])
  g(repoPath, ['commit', '-m', 'chore: base'])
  setOrigin(repoPath, originPath)
  g(repoPath, ['push', originPath, 'refs/heads/main:refs/heads/main'])
  // The server's working copy — the fake GitHub merges here for real.
  g(root, ['clone', originPath, serverPath])
}

// ---- the fake GitHub --------------------------------------------------------

const apiBase = 'https://api.github.com'
const calls = []
const prs = [] // server-side PR table
let nextNumber = 1

/**
 * A REAL merge in the server clone, then push. Honours `merge_method`
 * faithfully — `squash` really does squash. That fidelity is what makes the
 * D107 ancestry assertions discriminating: if the caller ever regressed to
 * `merge_method: 'squash'`, `branch --merged` and `--is-ancestor` would go
 * red here exactly as they do against real GitHub. A fake that always
 * merged --no-ff would pass either way and prove nothing.
 */
function serverMerge(pr, commitTitle, mergeMethod) {
  g(serverPath, ['fetch', 'origin', '+refs/heads/*:refs/remotes/origin/*'])
  g(serverPath, ['checkout', '-B', 'main', 'origin/main'])
  const headSha = g(serverPath, ['rev-parse', `refs/remotes/origin/${pr.head}`])
  if (mergeMethod === 'squash') {
    g(serverPath, ['merge', '--squash', headSha])
    g(serverPath, ['commit', '-m', commitTitle])
  } else if (mergeMethod === 'rebase') {
    g(serverPath, ['cherry-pick', `${headSha}^..${headSha}`])
  } else {
    g(serverPath, ['merge', '--no-ff', '-m', commitTitle, headSha])
  }
  const mergeSha = g(serverPath, ['rev-parse', 'HEAD'])
  g(serverPath, ['push', 'origin', 'main'])
  return mergeSha
}

/** Head sha as origin currently has it — the "did the head move?" oracle. */
function remoteHeadSha(head) {
  const line = g(repoPath, ['ls-remote', originPath, `refs/heads/${head}`], true)
  return line ? line.split(/\s+/)[0] : null
}

const mockFetch = async (url, opts = {}) => {
  const u = new URL(String(url))
  const method = opts.method ?? 'GET'
  const body = opts.body ? JSON.parse(opts.body) : {}
  calls.push({ method, path: u.pathname, search: u.search, body, headers: opts.headers ?? {} })
  const json = (status, obj) => ({ ok: status >= 200 && status < 300, status, json: async () => obj })

  const mergeMatch = u.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/merge$/)
  const oneMatch = u.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/)

  if (method === 'POST' && /\/pulls$/.test(u.pathname)) {
    const pr = {
      number: nextNumber++,
      html_url: 'https://github.test/pr/' + (nextNumber - 1),
      title: body.title,
      body: body.body,
      head: body.head,
      base: body.base,
      state: 'open',
      merged: false,
    }
    prs.push(pr)
    return json(201, { ...pr, head: { ref: pr.head, sha: remoteHeadSha(pr.head) } })
  }

  if (method === 'GET' && /\/pulls$/.test(u.pathname)) {
    const wanted = (u.searchParams.get('head') ?? '').split(':').slice(1).join(':')
    const state = u.searchParams.get('state')
    const hits = prs
      .filter((p) => p.head === wanted && (state !== 'open' || p.state === 'open'))
      .map((p) => ({ ...p, head: { ref: p.head, sha: remoteHeadSha(p.head) } }))
    return json(200, hits)
  }

  if (method === 'PUT' && mergeMatch) {
    const pr = prs.find((p) => p.number === Number(mergeMatch[3]))
    if (!pr) return json(404, { message: 'no pr' })
    // The head-moved guard, exactly as GitHub implements it.
    if (body.sha && body.sha !== remoteHeadSha(pr.head)) {
      return json(409, { message: 'Head branch was modified. Review and try the merge again.' })
    }
    const mergeSha = serverMerge(pr, body.commit_title ?? ('Merge PR #' + pr.number), body.merge_method ?? 'merge')
    pr.merged = true
    pr.state = 'closed'
    pr.merge_commit_sha = mergeSha
    return json(200, { sha: mergeSha, merged: true, message: 'Pull Request successfully merged' })
  }

  if (method === 'GET' && oneMatch) {
    const pr = prs.find((p) => p.number === Number(oneMatch[3]))
    if (!pr) return json(404, { message: 'no pr' })
    return json(200, {
      number: pr.number,
      state: pr.state,
      merged: pr.merged,
      mergeable_state: pr.merged ? 'unknown' : 'clean',
      head: { ref: pr.head, sha: remoteHeadSha(pr.head) },
    })
  }

  return json(404, { message: 'no route: ' + u.pathname })
}

// The injected seam prflow sees — same shape github-link/lib/index.js exposes.
const tok = { accessToken: 'test-token', fetch: mockFetch, apiBase }
const api = {
  prCreate: (owner, name, fields) => prCreateApi({ owner, name, ...fields, ...tok }),
  prListForHead: (owner, name, head) => prListForHeadApi({ owner, name, head, ...tok }),
  prMerge: (owner, name, fields) => prMergeApi({ owner, name, ...fields, ...tok }),
  prState: (owner, name, number) => prStateApi({ owner, name, number, ...tok }),
}
const OWNER = 'octocat'
const NAME = 'framed'

/** Open a session, do some work, auto-commit it as WIP (the real flow). */
function work(id, files, { checkSh } = {}) {
  const s = openSession(repoPath, { id, name: id, workspace: 'notes' })
  for (const [rel, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(s.worktree, rel), content)
    wipCommit(s.worktree, { message: 'edit ' + rel })
  }
  if (checkSh) {
    fs.writeFileSync(path.join(s.worktree, 'check.sh'), checkSh)
    wipCommit(s.worktree, { message: 'gate' })
  }
  return s
}

// ---- tests ------------------------------------------------------------------

try {
  buildWorld()
  console.log('prflow selftest')

  // --- 1. a red gate never publishes -----------------------------------------
  {
    const s = work('red1', { 'a.txt': 'broken\n' }, { checkSh: '#!/bin/sh\necho "gate says no"\nexit 1\n' })
    const before = calls.length
    const r = readySession(repoPath, 'red1', { subject: 'feat: the thing' })
    ok(r.gate.green === false && r.gate.kind === 'check.sh', 'red gate: check.sh ran and failed')
    ok(r.pushed === false && r.reason === 'gate-red', 'red gate: readySession refuses to push')
    // 156a1ba: collapse runs BEFORE the gate (the light gate needs a clean
    // tree), so a red gate leaves the collapsed commit on the local branch
    // (D40, nothing lost) and still publishes nothing.
    ok(r.collapsed === true && /^[0-9a-f]{40}$/.test(r.sha ?? ''), 'red gate: collapsed locally, commit kept on the branch')
    ok(remoteHeadSha(s.branch) === null, 'red gate: the branch never reached origin')
    ok(calls.length === before, 'red gate: no GitHub call of any kind was made')
  }

  // --- 2. green: collapse to ONE commit, push, one PR -------------------------
  {
    work('g1', { 'b.txt': 'one\n', 'c.txt': 'two\n' })
    const subject = 'feat(core): the green thing'
    const r = readySession(repoPath, 'g1', { subject, attribution: 'Co-worked in arxa studio.' })
    ok(r.gate.green === true && r.pushed === true, 'green: gate passes and the branch is pushed')
    ok(r.collapsed === true && typeof r.sha === 'string', 'green: the branch collapsed')

    const remoteSha = remoteHeadSha(r.branch)
    ok(remoteSha === r.sha, 'green: origin holds exactly the collapsed sha')
    const ahead = g(repoPath, ['rev-list', '--count', `main..${r.branch}`])
    ok(ahead === '1', 'green: exactly ONE commit between main and the branch tip')
    ok(g(repoPath, ['log', '-1', '--format=%s', r.branch]) === subject, 'green: the subject is the human subject, verbatim')
    const full = g(repoPath, ['log', '-1', '--format=%B', r.branch])
    ok(full.includes('Co-worked in arxa studio.'), 'green: the attribution rides in the commit body')
    ok(full.trimEnd().endsWith(stageTrailer('g1')), 'green: Arxa-Stage trailer is the last paragraph')
    ok(g(repoPath, ['log', `main..${r.branch}`, '--format=%s']).split('\n').every((s) => !s.startsWith('wip:')),
      'green: no wip: checkpoint survives the collapse')

    // Subject validation is a hard gate, before anything mutates.
    assert.throws(() => readySession(repoPath, 'g1', { subject: 'just some words' }), /conventional commit subject/)
    passed++; console.log('  ✓ green: a non-conventional subject is refused (SUBJECT_RE)')

    // PR + dedupe
    const pr1 = await openSessionPr(repoPath, 'g1', { owner: OWNER, name: NAME, subject, api })
    ok(pr1.created === true && pr1.number === 1, 'green: one PR opened')
    const pr2 = await openSessionPr(repoPath, 'g1', { owner: OWNER, name: NAME, subject, api })
    ok(pr2.created === false && pr2.number === pr1.number, 'green: a second call dedupes to the same PR')
    ok(prs.length === 1, 'green: exactly one PR exists server-side')

    // Merge, pinned to the reviewed sha.
    const mergeCall = () => calls.filter((c) => c.method === 'PUT' && /\/merge$/.test(c.path)).at(-1)
    const m = await mergeSessionPr(repoPath, 'g1', {
      owner: OWNER, name: NAME, number: pr1.number, sha: r.sha, subject, api,
    })
    const sent = mergeCall()
    ok(sent.body.merge_method === 'merge', 'merge: merge_method is "merge" (--no-ff), NOT squash')
    ok(sent.body.sha === r.sha, 'merge: the reviewed sha is sent as the head guard')
    ok(sent.body.commit_title === subject, 'merge: commit_title is the human subject')
    ok(m.merged === true, 'merge: GitHub reports merged')

    // The D107 property — ancestry, not just content.
    const mainSha = g(repoPath, ['rev-parse', 'main'])
    ok(mainSha === m.mergeSha, 'reconcile: local main fast-forwarded to the merge commit')
    ok(m.reconcile.advanced === true && m.reconcile.sync.behind === 0 && m.reconcile.sync.ahead === 0,
      'reconcile: local main is level with origin/main')
    const merged = g(repoPath, ['branch', '--merged', 'main', '--format=%(refname:short)']).split('\n')
    ok(merged.includes(r.branch), 'D107: `branch --merged main` LISTS the session branch')
    ok(g(repoPath, ['merge-base', '--is-ancestor', r.sha, 'main'], true) !== null,
      'D107: the collapsed commit IS an ancestor of main')
    ok(g(repoPath, ['rev-list', '--count', '--first-parent', 'main']) === '2',
      'D107: main gained exactly one first-parent merge commit')
  }

  // --- 3. the head-moved guard actually fires --------------------------------
  {
    work('moved', { 'd.txt': 'first\n' })
    const r = readySession(repoPath, 'moved', { subject: 'fix: pinned merge' })
    const pr = await openSessionPr(repoPath, 'moved', { owner: OWNER, name: NAME, subject: 'fix: pinned merge', api })
    const staleSha = r.sha
    // The human reviewed staleSha; more work lands and is re-readied.
    fs.writeFileSync(path.join(repoPath, '.arxa/worktrees/moved/d.txt'), 'second\n')
    wipCommit(path.join(repoPath, '.arxa/worktrees/moved'), { message: 'more' })
    const r2 = readySession(repoPath, 'moved', { subject: 'fix: pinned merge' })
    ok(r2.sha !== staleSha && r2.pushed === true, 'moved: re-ready rewrites and force-pushes the branch')
    await assert.rejects(
      () => mergeSessionPr(repoPath, 'moved', { owner: OWNER, name: NAME, number: pr.number, sha: staleSha, subject: 'fix: pinned merge', api }),
      /head moved since review \(409\)/,
    )
    passed++; console.log('  ✓ moved: merging the STALE reviewed sha is refused (409), not merged blind')
    const m = await mergeSessionPr(repoPath, 'moved', { owner: OWNER, name: NAME, number: pr.number, sha: r2.sha, subject: 'fix: pinned merge', api })
    ok(m.merged === true, 'moved: merging the CURRENT reviewed sha succeeds')
  }

  // --- 4. prState reads through -----------------------------------------------
  {
    const st = await api.prState(OWNER, NAME, 1)
    ok(st.merged === true && st.state === 'closed' && typeof st.head_sha === 'string',
      'prState: merged/state/head_sha flattened from the PR payload')
  }

  // --- 5. no origin degrades, never throws ------------------------------------
  {
    const solo = path.join(root, 'solo')
    fs.mkdirSync(solo, { recursive: true })
    g(solo, ['init', '--initial-branch=main'])
    fs.writeFileSync(path.join(solo, 'x.txt'), 'x\n')
    g(solo, ['add', '-A']); g(solo, ['commit', '-m', 'chore: base'])
    const s = openSession(solo, { id: 'solo1', name: 'solo1', workspace: 'notes' })
    fs.writeFileSync(path.join(s.worktree, 'y.txt'), 'y\n')
    wipCommit(s.worktree, { message: 'edit' })
    const r = readySession(solo, 'solo1', { subject: 'chore: local only' })
    ok(r.reason === 'no-origin' && r.pushed === false && r.collapsed === true,
      'no-origin: the collapse still happens, the push reports no-origin')
    ok(reconcileLocalMain(solo).reason === 'no-origin', 'no-origin: reconcile degrades quietly')
  }

  // --- 6. PRESSURE: 10 sessions through the whole flow -------------------------
  {
    const firstParentBefore = Number(g(repoPath, ['rev-list', '--count', '--first-parent', 'main']))
    const mergesBefore = Number(g(repoPath, ['rev-list', '--count', '--merges', '--first-parent', 'main']))
    for (let i = 0; i < 10; i++) {
      const id = `p${i}`
      const subject = `feat(p${i}): pressure session ${i}`
      work(id, { [`p${i}.txt`]: `session ${i} line one\n` })
      // a second edit so there is a real wip run to collapse
      const wt = path.join(repoPath, '.arxa/worktrees', id)
      fs.appendFileSync(path.join(wt, `p${i}.txt`), 'line two\n')
      wipCommit(wt, { message: 'more' })

      const r = readySession(repoPath, id, { subject })
      assert.equal(r.pushed, true, `${id}: pushed`)
      assert.equal(g(repoPath, ['rev-list', '--count', `main..${r.branch}`]), '1', `${id}: one commit`)
      const pr = await openSessionPr(repoPath, id, { owner: OWNER, name: NAME, subject, api })
      assert.equal(pr.created, true, `${id}: PR opened`)
      const m = await mergeSessionPr(repoPath, id, { owner: OWNER, name: NAME, number: pr.number, sha: r.sha, subject, api })
      assert.equal(m.merged, true, `${id}: merged`)
      assert.equal(g(repoPath, ['rev-parse', 'main']), m.mergeSha, `${id}: local main reconciled`)
      assert.ok(g(repoPath, ['merge-base', '--is-ancestor', r.sha, 'main'], true) !== null, `${id}: ancestor of main`)
    }
    ok(true, 'pressure: 10 sessions readied, PR-ed and merged sequentially against one origin')

    const firstParent = Number(g(repoPath, ['rev-list', '--count', '--first-parent', 'main']))
    const merges = Number(g(repoPath, ['rev-list', '--count', '--merges', '--first-parent', 'main']))
    ok(merges - mergesBefore === 10, `pressure: --first-parent shows exactly 10 new merge commits (${mergesBefore} → ${merges})`)
    ok(firstParent - firstParentBefore === 10, 'pressure: main advanced by exactly 10 first-parent steps')

    const noMerges = g(repoPath, ['log', '--no-merges', '--format=%s', 'main']).split('\n')
    ok(noMerges.every((s) => !s.startsWith('wip:')), 'pressure: `log --no-merges` (what bisect walks) has NO wip: subjects')
    ok(noMerges.filter((s) => /^feat\(p\d\): pressure session/.test(s)).length === 10,
      'pressure: all 10 collapsed commits are on main, one each')

    const mergedBranches = g(repoPath, ['branch', '--merged', 'main', '--format=%(refname:short)']).split('\n')
    ok([...Array(10).keys()].every((i) => mergedBranches.includes(`arxa/session/p${i}`)),
      'pressure: `branch --merged main` lists all 10 session branches (D107)')
  }

  console.log(`\nprflow selftest: ${passed} checks passed`)
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
