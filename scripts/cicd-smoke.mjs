#!/usr/bin/env node
/**
 * LIVE end-to-end CI/CD smoke — real GitHub, real repo, real PR.
 *
 * This is the run that closes the items the offline suites cannot: the
 * conversation READ path against a real PR, the two WRITE verbs (reply,
 * resolve), and D6's auto-open-on-first-push. Everything here talks to
 * github.com, so it is HAND-RUN ONLY and never joins scripts/ci.mjs.
 *
 * Blast radius is bounded by construction: it creates its OWN throwaway
 * private repo (arxa-cicd-smoke-<timestamp>) and deletes it at the end. It
 * never touches an existing repository. Pass --keep to leave the repo behind
 * for inspection.
 *
 * The GitHub calls go through arxa's OWN helpers (github-link/lib/frame.js) —
 * that transport is the thing under test. Only the credential comes from
 * elsewhere (`gh auth token`), so the run needs no keychain prompt.
 *
 *   node scripts/cicd-smoke.mjs --yes [--keep]
 *
 * Exit 0 = every assertion held.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const argv = process.argv.slice(2)
if (!argv.includes('--yes')) {
  console.error('cicd-smoke: this writes to REAL GitHub (creates and deletes a throwaway repo).')
  console.error('Re-run with --yes to confirm.')
  process.exit(2)
}
const keep = argv.includes('--keep')

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const P = (...p) => path.join(root, 'plugins', ...p)

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '\n      ' + extra}`)
  if (!ok) failures++
}
const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').slice(0, 300)}`)
  }
  return (r.stdout || '').trim()
}
const ghJson = (args) => JSON.parse(sh('gh', args) || 'null')

// ---- credential + identity -------------------------------------------------
const accessToken = sh('gh', ['auth', 'token'])
const owner = ghJson(['api', 'user', '--jq', '{login:.login}']).login
const repoName = 'arxa-cicd-smoke-' + Date.now()
console.log(`\nsmoke repo: ${owner}/${repoName} (private, deleted at the end${keep ? ' — SUPPRESSED by --keep' : ''})\n`)

// ---- the github service, over arxa's OWN transport -------------------------
const frame = await import(P('github-link', 'lib', 'frame.js'))
const apiBase = 'https://api.github.com'
const wrap = (fn) => (args) => fn({ ...args, accessToken, fetch: globalThis.fetch, apiBase })
const github = {
  status: async () => ({ ok: true, linked: true, login: owner }),
  gitCredentials: async () => ({ login: owner, token: accessToken }),
  prCreate: (o, n, { title, body, head, base }) =>
    wrap(frame.prCreateApi)({ owner: o, name: n, title, body, head, base }),
  prListForHead: (o, n, head, state = 'open') =>
    wrap(frame.prListForHeadApi)({ owner: o, name: n, head, state }),
  prChecks: (args) => wrap(frame.prChecksApi)(args),
  workflowRuns: (args) => wrap(frame.workflowRunsApi)(args),
  prConversation: (args) => wrap(frame.prConversationApi)(args),
  setThreadResolved: (args) => wrap(frame.setThreadResolvedApi)(args),
  prThreadReply: (args) => wrap(frame.prThreadReplyApi)(args),
  prComment: (o, n, { number, body }) => wrap(frame.prCommentApi)({ owner: o, name: n, number, body }),
  prUpdate: (args) => wrap(frame.prUpdateApi)(args),
  runJobs: (args) => wrap(frame.runJobsApi)(args),
}

let created = false
try {
  // ---- 1. the throwaway remote --------------------------------------------
  // NO --add-readme: that would give the remote its own initial commit, with
  // no history in common with the org repo, and every PR would 422. The real
  // link flow pushes the org's OWN history into an empty repo; mirror it.
  sh('gh', ['repo', 'create', `${owner}/${repoName}`, '--private'])
  created = true
  check('a throwaway private repo exists on GitHub', true)

  // ---- 2. a real org + session, wired to that remote ----------------------
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-smoke-home-'))
  const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-smoke-ws-'))
  process.env.ARXA_HOME = home
  const shell = await import(P('file-org-shell', 'lib', 'index.js'))
  shell.saveWorkspaceRoot(wsRoot)
  const routes = {}
  const reg = { webServer: { register: (r) => { routes[r.path] = r.handler } } }
  const sidebar = await import(P('arxa-sidebar', 'lib', 'index.js'))
  const card = await import(P('arxa-git-card', 'lib', 'index.js'))
  sidebar.apply(reg, { github })
  card.apply(reg)
  const call = (p, body) => new Promise((res) => {
    const req = { url: p, method: 'POST', _h: {}, on(e, fn) { this._h[e] = fn } }
    routes[p](req, { writeHead() {}, end: (s) => res(JSON.parse(s)) })
    queueMicrotask(() => { req._h.data?.(JSON.stringify(body)); req._h.end?.() })
  })
  const act = (action, arg) => call(
    /^(card|insight|version)\./.test(action) ? '/__arxa/git-card/action' : '/__arxa/sidebar/action',
    { action, arg })

  await act('org.create', { name: 'Smoke Co', link: false })
  const org = (await call('/__arxa/sidebar/state', {})).orgs.find((o) => o.open)
  const manifest = path.join(org.path, 'org.json')
  fs.writeFileSync(manifest, JSON.stringify({
    ...JSON.parse(fs.readFileSync(manifest, 'utf8')),
    repoOwner: owner, repoName, localOnly: false,
  }, null, 2))
  const authRemote = `https://${owner}:${accessToken}@github.com/${owner}/${repoName}.git`
  sh('git', ['-C', org.path, 'remote', 'add', 'origin', `https://github.com/${owner}/${repoName}.git`])
  // Establish the BASE. arxa pins init.defaultBranch=main (git-workspace
  // run.js PINNED), so the org repo is on main and openPr's base:'main' is
  // correct — but the branch has to exist on the remote before a PR can
  // target it.
  const orgBranch = sh('git', ['-C', org.path, 'symbolic-ref', '--short', 'HEAD'])
  check('the org repo is on main (arxa pins init.defaultBranch)', orgBranch === 'main', 'branch was: ' + orgBranch)
  sh('git', ['-C', org.path, 'push', authRemote, `${orgBranch}:refs/heads/main`])
  check('the base branch exists on the remote', 
    ghJson(['api', `repos/${owner}/${repoName}/branches/main`, '--jq', '{n:.name}'])?.n === 'main')

  const sess = await act('workspace.new-session', { orgId: org.id, workspace: 'notes' })
  check('a real session was minted with an org-led path identity',
    sess.ok === true && String(sess.result?.id ?? '').includes('/notes/'), JSON.stringify(sess).slice(0, 200))
  const sid = sess.result.id

  // ---- 3. commit + push → D6 opens the PR by itself -----------------------
  // Resolve the worktree from the REGISTRY rather than trusting the action's
  // result shape — an undefined path here would silently produce an empty
  // commit and the PR would fail for a different reason entirely.
  const gwlib = await import(P('git-workspace', 'lib', 'sessions.js'))
  const row = gwlib.parkedSessions(org.path, process.env).find((s) => s.id === sid)
  const wt = row?.worktree
  check('the session worktree exists on disk', Boolean(wt) && fs.existsSync(wt), 'worktree=' + String(wt))
  fs.writeFileSync(path.join(wt, 'smoke.md'), '# smoke\n')
  // The arg is `subject`, and it must be CONVENTIONAL — card.commit refuses
  // anything else (SUBJECT_RE). With a linked+credentialed origin this is the
  // prflow shape: collapse the WIP run on the BRANCH, gate, push the branch.
  // main is deliberately NOT touched until card.pr.merge — the old shape
  // ff-merged to main here and every PR then 422'd with "No commits between
  // main and arxa/<identity>" (RESTO #1-#3).
  const committed = await act('card.commit', { sessionId: sid, subject: 'feat: add the smoke note' })
  check('the commit was made', (committed.result ?? committed)?.ok !== false, JSON.stringify(committed).slice(0, 200))
  check('the branch really carries a commit ahead of main',
    sh('git', ['-C', wt, 'rev-list', '--count', 'main..HEAD']) !== '0',
    'ahead count: ' + sh('git', ['-C', wt, 'rev-list', '--count', 'main..HEAD'], { allowFail: true }))
  const pushed = await act('card.push', { sessionId: sid })
  const pb = pushed.result ?? pushed
  check('the push landed', pushed.ok === true && pb?.ok === true, JSON.stringify(pushed).slice(0, 300))
  check('D6: the first push opened a real PR with no second click',
    Boolean(pb?.pr?.number), 'pr=' + JSON.stringify(pb?.pr) + ' reason=' + String(pb?.prReason))
  const prNumber = pb?.pr?.number
  if (!prNumber) throw new Error('no PR opened — the remaining assertions need one')
  check('the PR is real on GitHub, not just in arxa\'s response',
    ghJson(['api', `repos/${owner}/${repoName}/pulls/${prNumber}`, '--jq', '{n:.number}']).n === prNumber)

  // ---- 4. a REVIEW THREAD to answer --------------------------------------
  // Nothing in the product creates one of these, which is exactly why the
  // read/reply/resolve path has never been proven live.
  const files = ghJson(['api', `repos/${owner}/${repoName}/pulls/${prNumber}/files`, '--jq', '[.[].filename]'])
  const target = files[0]
  sh('gh', ['api', `repos/${owner}/${repoName}/pulls/${prNumber}/comments`, '-X', 'POST',
    '-f', `body=please explain this line`, '-f', `path=${target}`, '-F', 'line=1', '-f', 'side=RIGHT',
    '-f', `commit_id=${ghJson(['api', `repos/${owner}/${repoName}/pulls/${prNumber}`, '--jq', '{s:.head.sha}']).s}`])
  check('a review thread exists on the PR to answer', true)

  // ---- 5. READ: the conversation comes back through arxa ------------------
  const review = await act('insight.review', { sessionId: sid, fresh: true })
  const rv = review.result ?? review
  check('insight.review reads the live PR conversation',
    review.ok === true && rv?.available !== false, JSON.stringify(review).slice(0, 300))
  const thread = (rv?.threads ?? [])[0]
  check('the review thread arrives with a replyable comment id',
    Boolean(thread?.id) && Boolean(thread?.replyTo),
    JSON.stringify(rv?.threads ?? []).slice(0, 300))
  if (!thread) throw new Error('no thread returned — reply/resolve cannot be proven')

  // ---- 6. WRITE: reply, and confirm it on GitHub -------------------------
  const replyText = 'answered from inside arxa studio'
  // Args are text / number / commentId (index.js:995-1017) — NOT body/replyTo.
  // `commentId` is the thread's FIRST comment: GitHub threads a reply by its
  // parent comment id, which is what the review shape carries as `replyTo`.
  const replied = await act('insight.reply', {
    sessionId: sid, number: prNumber, commentId: thread.replyTo, text: replyText,
  })
  check('insight.reply is accepted', (replied.result ?? replied)?.ok !== false, JSON.stringify(replied).slice(0, 260))
  const bodies = ghJson(['api', `repos/${owner}/${repoName}/pulls/${prNumber}/comments`, '--jq', '[.[].body]'])
  check('the reply is really on GitHub', bodies.some((b) => String(b).includes(replyText)),
    JSON.stringify(bodies).slice(0, 260))

  // ---- 7. WRITE: resolve, and confirm it on GitHub -----------------------
  const resolved = await act('insight.resolve', { sessionId: sid, threadId: thread.id, resolved: true })
  check('insight.resolve is accepted', (resolved.result ?? resolved)?.ok !== false, JSON.stringify(resolved).slice(0, 260))
  const isResolved = ghJson(['api', 'graphql', '-f', `query=query{repository(owner:"${owner}",name:"${repoName}"){pullRequest(number:${prNumber}){reviewThreads(last:5){nodes{isResolved}}}}}`,
    '--jq', '[.data.repository.pullRequest.reviewThreads.nodes[].isResolved]'])
  check('the thread is really resolved on GitHub', isResolved.includes(true), JSON.stringify(isResolved))
} catch (err) {
  check('the smoke ran to completion', false, String(err?.stack ?? err).slice(0, 700))
} finally {
  if (created && !keep) {
    sh('gh', ['repo', 'delete', `${owner}/${repoName}`, '--yes'], { allowFail: true })
    console.log(`\ncleaned up ${owner}/${repoName}`)
  }
}

console.log(failures === 0 ? '\ncicd smoke: ALL GREEN' : `\ncicd smoke: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
