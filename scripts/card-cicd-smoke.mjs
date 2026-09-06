#!/usr/bin/env node
/**
 * LIVE end-to-end CI/CD through the GIT CARD — real GitHub, real repo, real
 * PR, real GitHub Actions run, real merge, real cleanup.
 *
 * How this differs from scripts/cicd-smoke.mjs: that one drives arxa's GitHub
 * helpers directly. This one drives the CARD — every step goes through the
 * card's own route (/__arxa/git-card/action), the same wire the buttons in
 * the composer dock use. If a card action is broken, this run finds it; the
 * helper-level smoke would not.
 *
 * It also gives the CI actions something real to act on: a workflow is
 * committed to the base branch, so PRs trigger an actual Actions run, which
 * means cancel, re-run and the merge-only-when-green gate are exercised
 * against live state instead of a fake that always says 'green'.
 *
 * Blast radius is bounded by construction: its OWN throwaway private repo
 * (arxa-cicd-card-<timestamp>), a temp ARXA_HOME and a temp workspace root.
 * It never touches an existing repository or the user's real orgs.
 *
 *   node scripts/card-cicd-smoke.mjs --yes [--keep]
 *
 * --keep leaves the repo on GitHub so the whole history can be read back.
 * Exit 0 = every assertion held.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const argv = process.argv.slice(2)
if (!argv.includes('--yes')) {
  console.error('card-cicd-smoke: this writes to REAL GitHub (creates a throwaway repo, opens a PR, merges it).')
  console.error('Re-run with --yes to confirm.')
  process.exit(2)
}
const keep = argv.includes('--keep')

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const P = (...p) => path.join(root, 'plugins', ...p)

let failures = 0
const covered = []
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '\n      ' + extra}`)
  if (!ok) failures++
}
/** Mark a card action as exercised live, so the summary can be honest about
 * what was actually covered rather than implying everything was. */
const live = (action) => { if (!covered.includes(action)) covered.push(action) }
const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').slice(0, 300)}`)
  }
  return (r.stdout || '').trim()
}
const ghJson = (args) => JSON.parse(sh('gh', args, { allowFail: true }) || 'null')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- credential + identity -------------------------------------------------
const accessToken = sh('gh', ['auth', 'token'])
const owner = ghJson(['api', 'user', '--jq', '{login:.login}']).login
const repoName = 'arxa-cicd-card-' + Date.now()
const repoUrl = `https://github.com/${owner}/${repoName}`
console.log(`\ncard CI/CD smoke\nrepo: ${repoUrl}  (private${keep ? ', KEPT for inspection' : ', deleted at the end'})\n`)

// ---- the github service, over arxa's OWN transport -------------------------
const frame = await import(P('github-link', 'lib', 'frame.js'))
const apiBase = 'https://api.github.com'
const wrap = (fn) => (args) => fn({ ...args, accessToken, fetch: globalThis.fetch, apiBase })
const github = {
  status: async () => ({ ok: true, linked: true, login: owner }),
  gitCredentials: async () => ({ login: owner, token: accessToken }),
  prCreate: (o, n, { title, body, head, base }) => wrap(frame.prCreateApi)({ owner: o, name: n, title, body, head, base }),
  prListForHead: (o, n, head, state = 'open') => wrap(frame.prListForHeadApi)({ owner: o, name: n, head, state }),
  prChecks: (o, n, ref) => wrap(frame.prChecksApi)({ owner: o, name: n, ref }),
  prComment: (o, n, { number, body }) => wrap(frame.prCommentApi)({ owner: o, name: n, number, body }),
  prMerge: (o, n, a) => wrap(frame.prMergeApi)({ owner: o, name: n, ...a }),
  prSquashMerge: (o, n, a) => wrap(frame.prSquashMergeApi)({ owner: o, name: n, ...a }),
  prUpdate: (a) => wrap(frame.prUpdateApi)(a),
  prState: (a) => wrap(frame.prStateApi)(a),
  prConversation: (a) => wrap(frame.prConversationApi)(a),
  workflowRuns: (a) => wrap(frame.workflowRunsApi)(a),
  runJobs: (a) => wrap(frame.runJobsApi)(a),
  rerunRun: (a) => wrap(frame.rerunRunApi)(a),
  cancelRun: (a) => wrap(frame.cancelRunApi)(a),
  deleteBranch: (o, n, branch) => wrap(frame.prUpdateApi) && fetch(
    `${apiBase}/repos/${o}/${n}/git/refs/heads/${branch}`,
    { method: 'DELETE', headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + accessToken, 'user-agent': 'arxa-studio' } },
  ).then((r) => ({ ok: r.status === 204 || r.status === 422 })),
  // No self-hosted runner exists for a fresh throwaway repo, so this is what
  // the real service reports when the runner has never registered. The wake
  // path is asserted on its REFUSAL rather than pretended green.
  ensureRunner: async () => { throw new Error('no self-hosted runner registered for this repo') },
}

// The workflow the PR will actually run. `quick` proves green; `hold` runs
// long enough that cancel and re-run have something live to act on — a
// workflow that finishes in five seconds cannot test cancellation.
const WORKFLOW = `name: ci
on:
  pull_request:
  push:
    branches: [main]
jobs:
  quick:
    runs-on: ubuntu-latest
    steps:
      - run: echo "arxa card smoke — quick check"
  hold:
    runs-on: ubuntu-latest
    steps:
      - run: sleep 45
`

let created = false
try {
  // ---- 1. the throwaway remote --------------------------------------------
  // No --add-readme: an initial commit on the remote shares no history with
  // the org repo and every PR then 422s.
  sh('gh', ['repo', 'create', `${owner}/${repoName}`, '--private'])
  created = true
  check('a throwaway private repo exists on GitHub', true)

  // ---- 2. a real org + a real session, wired to that remote ----------------
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-card-home-'))
  const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-card-ws-'))
  process.env.ARXA_HOME = home
  const shell = await import(P('file-org-shell', 'lib', 'index.js'))
  shell.saveWorkspaceRoot(wsRoot)
  const routes = {}
  const reg = { webServer: { register: (r) => { routes[r.path] = r.handler } } }
  const sidebar = await import(P('arxa-sidebar', 'lib', 'index.js'))
  const cardMod = await import(P('arxa-git-card', 'lib', 'index.js'))
  sidebar.apply(reg, { github })
  cardMod.apply(reg)
  const call = (p, body) => new Promise((res) => {
    const req = { url: p, method: 'POST', _h: {}, on (e, fn) { this._h[e] = fn } }
    routes[p](req, { writeHead () {}, end: (s) => res(JSON.parse(s)) })
    queueMicrotask(() => { req._h.data?.(JSON.stringify(body)); req._h.end?.() })
  })
  /** Every card action goes through the card's OWN route — the wire the
   * buttons use. That is the point of this script. */
  const act = (action, arg) => call(
    /^(card|insight|version)\./.test(action) ? '/__arxa/git-card/action' : '/__arxa/sidebar/action',
    { action, arg })
  const val = (r) => r?.result ?? r

  await act('org.create', { name: 'Card Smoke Co', link: false })
  const org = (await call('/__arxa/sidebar/state', {})).orgs.find((o) => o.open)
  const manifestPath = path.join(org.path, 'org.json')
  fs.writeFileSync(manifestPath, JSON.stringify({
    ...JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
    repoOwner: owner, repoName, localOnly: false,
  }, null, 2))
  const authRemote = `https://${owner}:${accessToken}@github.com/${owner}/${repoName}.git`
  sh('git', ['-C', org.path, 'remote', 'add', 'origin', `${repoUrl}.git`])

  // The workflow must be on the BASE branch for pull_request to trigger it.
  fs.mkdirSync(path.join(org.path, '.github', 'workflows'), { recursive: true })
  fs.writeFileSync(path.join(org.path, '.github', 'workflows', 'ci.yml'), WORKFLOW)
  sh('git', ['-C', org.path, 'add', '.github'])
  sh('git', ['-C', org.path, 'commit', '-m', 'ci: add the workflow the card checks read'])
  sh('git', ['-C', org.path, 'push', authRemote, 'main:refs/heads/main'])
  check('the base branch and its workflow are on the remote',
    ghJson(['api', `repos/${owner}/${repoName}/branches/main`, '--jq', '{n:.name}'])?.n === 'main')

  // ---- 3. card.status on a fresh seat --------------------------------------
  const sess = await act('workspace.new-session', { orgId: org.id, workspace: 'notes' })
  const sid = sess.result?.id
  check('a new session/worktree was minted with an org-led path identity',
    sess.ok === true && String(sid ?? '').includes('/notes/'), JSON.stringify(sess).slice(0, 200))
  const gwlib = await import(P('git-workspace', 'lib', 'sessions.js'))
  const row = gwlib.parkedSessions(org.path, process.env).find((s) => s.id === sid)
  const wt = row?.worktree
  check('the session worktree is a real directory on disk', Boolean(wt) && fs.existsSync(wt), 'worktree=' + String(wt))

  const st0 = await act('card.status', { sessionId: sid }); live('card.status')
  check('card.status reads the seat and reports its branch',
    st0.ok === true && val(st0)?.seat?.kind === 'session' && typeof val(st0)?.seat?.branch === 'string',
    JSON.stringify(st0).slice(0, 240))

  // ---- 4. draft → commit → push (D6 opens the PR by itself) ----------------
  fs.writeFileSync(path.join(wt, 'note.md'), '# card smoke\n\nfirst change\n')
  const draft = await act('card.commit.draft', { sessionId: sid }); live('card.commit.draft')
  check('card.commit.draft returns evidence for the model to write a subject from',
    draft.ok === true, JSON.stringify(draft).slice(0, 240))
  const committed = await act('card.commit', { sessionId: sid, subject: 'feat: add the card smoke note' }); live('card.commit')
  check('card.commit lands a commit ahead of main',
    committed.ok === true && sh('git', ['-C', wt, 'rev-list', '--count', 'main..HEAD']) !== '0',
    JSON.stringify(committed).slice(0, 240))
  const pushed = await act('card.push', { sessionId: sid }); live('card.push')
  const pb = val(pushed)
  check('card.push lands the branch on the remote', pushed.ok === true && pb?.ok === true, JSON.stringify(pushed).slice(0, 300))
  check('D6: that first push opened the PR with no second click',
    Boolean(pb?.pr?.number), 'pr=' + JSON.stringify(pb?.pr) + ' reason=' + String(pb?.prReason))
  const prNumber = pb?.pr?.number
  if (!prNumber) throw new Error('no PR opened — the CI assertions all need one')
  console.log(`\n  → PR: ${repoUrl}/pull/${prNumber}\n`)

  // ---- 5. the checks the card reads are a REAL Actions run ------------------
  const statusUntil = async (want, timeoutMs) => {
    const t0 = Date.now()
    let last
    while (Date.now() - t0 < timeoutMs) {
      last = val(await act('card.pr.status', { sessionId: sid }))
      if (want(last)) return last
      await sleep(5000)
    }
    return last
  }
  live('card.pr.status')
  const running = await statusUntil((s) => (s?.runs ?? []).length > 0 && s?.checks?.state !== 'none', 180000)
  check('card.pr.status sees a real GitHub Actions run against the PR head',
    (running?.runs ?? []).length > 0, JSON.stringify(running?.checks ?? running).slice(0, 300))
  const runId = (running?.runs ?? [])[0]?.id
  check('the run carries the id the card needs for run control', Boolean(runId), 'runs=' + JSON.stringify(running?.runs ?? []).slice(0, 200))

  // Merge must REFUSE while the run is not green. This is the gate that keeps
  // an unreviewed red branch out of main, so it is asserted live, not faked.
  const early = await act('card.pr.merge', { sessionId: sid }); live('card.pr.merge')
  check('card.pr.merge REFUSES while the checks are not green, with a reason that names the state',
    val(early)?.ok === false && String(val(early)?.reason ?? '').startsWith('checks-'),
    JSON.stringify(early).slice(0, 260))

  // ---- 6. cancel, then re-run ---------------------------------------------
  if (runId) {
    const cancelled = await act('card.ci.cancel', { sessionId: sid, runId }); live('card.ci.cancel')
    check('card.ci.cancel stops the live run', cancelled.ok === true, JSON.stringify(cancelled).slice(0, 260))
    await sleep(8000)
    const afterCancel = val(await act('card.pr.status', { sessionId: sid }))
    check('the cancellation is visible in what the card reads back',
      afterCancel?.checks?.state !== 'green', JSON.stringify(afterCancel?.checks ?? {}).slice(0, 200))
    // GitHub refuses to re-run a run that has not settled (403). The card
    // already disables the button while the run is live, so the UI does not
    // normally reach this — but a stale status can, and the message used to
    // be a bare "403", which reads like a dead grant.
    const tooEarly = await act('card.ci.rerun', { sessionId: sid, runId }); live('card.ci.rerun')
    if (tooEarly.ok === false) {
      check('a too-early re-run explains the STATE instead of relaying a bare 403',
        /cannot be re-run until it finishes/.test(String(tooEarly.error ?? '')),
        JSON.stringify(tooEarly).slice(0, 260))
    } else {
      check('the re-run was accepted (the run had already settled)', tooEarly.ok === true)
    }
    // Now wait for it to settle, exactly as the disabled button makes a user
    // wait, and re-run for real.
    const settled = await statusUntil((s) => {
      const r = (s?.runs ?? []).find((x) => String(x.id) === String(runId))
      return r === undefined || r.status === 'completed'
    }, 180000)
    const rerun = await act('card.ci.rerun', { sessionId: sid, runId })
    check('card.ci.rerun restarts a settled run', rerun.ok === true,
      JSON.stringify(rerun).slice(0, 260) + ' | run state: ' + JSON.stringify((settled?.runs ?? []).find((x) => String(x.id) === String(runId)) ?? {}).slice(0, 160))
  }

  // ---- 7. a comment on the PR from the card --------------------------------
  // The action builds the comment body from the STAGE (author, result, sha,
  // timestamp) — it does not take a raw body. Omitting stage throws
  // 'stage-required', which is how the first run of this smoke found out.
  const commented = await act('card.pr.comment', {
    sessionId: sid, stage: 'checks', result: 'green',
    detail: 'cancel + re-run driven from the card by scripts/card-cicd-smoke.mjs',
  })
  live('card.pr.comment')
  check('card.pr.comment posts to the real PR conversation',
    commented.ok === true && Boolean(val(commented)?.comment), JSON.stringify(commented).slice(0, 260))

  // ---- 8. integrate main into the session branch ---------------------------
  // Give main something to integrate, or the action is a no-op and proves
  // nothing about the path the user actually hits after someone else merges.
  sh('git', ['-C', org.path, 'commit', '--allow-empty', '-m', 'chore: move main under the session'])
  sh('git', ['-C', org.path, 'push', authRemote, 'main:refs/heads/main'])
  const integrated = await act('card.integrate', { sessionId: sid }); live('card.integrate')
  check('card.integrate brings main into the session worktree',
    integrated.ok === true, JSON.stringify(integrated).slice(0, 300))
  const iv = val(integrated)
  if (iv?.conflicts?.length) {
    const finished = await act('card.integrate.finish', { sessionId: sid }); live('card.integrate.finish')
    check('card.integrate.finish concludes the resolved merge', finished.ok === true, JSON.stringify(finished).slice(0, 260))
  } else {
    // Nothing conflicted, so finish has nothing to conclude. Assert it says
    // so rather than skipping — a silent skip hides a broken action.
    const finished = await act('card.integrate.finish', { sessionId: sid }); live('card.integrate.finish')
    check('card.integrate.finish is reached and answers rather than hanging',
      finished !== undefined && (finished.ok === true || typeof finished.reason === 'string' || typeof val(finished)?.reason === 'string'),
      JSON.stringify(finished).slice(0, 260))
  }
  await act('card.push', { sessionId: sid })

  // ---- 9. wait for green, then merge --------------------------------------
  const green = await statusUntil((s) => s?.checks?.state === 'green', 420000)
  check('the checks the card reads actually go GREEN on a real run',
    green?.checks?.state === 'green', 'final state: ' + JSON.stringify(green?.checks ?? {}).slice(0, 240))

  const merged = await act('card.pr.merge', { sessionId: sid })
  check('card.pr.merge merges once — and only once — the run is green',
    merged.ok === true && val(merged)?.ok !== false, JSON.stringify(merged).slice(0, 300))
  const prAfter = ghJson(['api', `repos/${owner}/${repoName}/pulls/${prNumber}`, '--jq', '{state:.state,merged:.merged,sha:.merge_commit_sha}'])
  check('GitHub itself reports the PR merged, not just arxa',
    prAfter?.merged === true && prAfter?.state === 'closed', JSON.stringify(prAfter))
  check('the work is on main at the remote',
    (ghJson(['api', `repos/${owner}/${repoName}/contents/note.md?ref=main`, '--jq', '{n:.name}'])?.n) === 'note.md')

  // ---- 10. cleanup ---------------------------------------------------------
  await github.deleteBranch(owner, repoName, row.branch)
  const branchGone = ghJson(['api', `repos/${owner}/${repoName}/branches/${row.branch}`, '--jq', '{n:.name}'])
  check('the session branch is cleaned off the remote after the merge', branchGone?.n === undefined, JSON.stringify(branchGone))

  // ---- 11. the actions a throwaway repo CANNOT exercise --------------------
  // Said out loud rather than skipped: wake needs a self-hosted runner
  // registered to the repo, which a fresh throwaway has never had. Assert the
  // refusal is clean, because a confusing failure here is what the user meets.
  const woke = await act('card.runner.wake', { sessionId: sid })
  check('card.runner.wake refuses cleanly with no runner, rather than hanging or throwing raw',
    woke !== undefined && (woke.ok === false || typeof val(woke)?.reason === 'string' || typeof woke.reason === 'string'),
    JSON.stringify(woke).slice(0, 260))

  // ---- 12. the insight surfaces the card links to --------------------------
  for (const view of ['insight.streak', 'insight.ci', 'insight.sessions']) {
    const r = await act(view, { sessionId: sid }); live(view)
    check(`${view} answers with a shape instead of throwing`, r !== undefined && r.ok !== undefined, JSON.stringify(r).slice(0, 200))
  }

  // ---- 13. the ledger the PR body and comments are built from --------------
  const finalStatus = val(await act('card.pr.status', { sessionId: sid }))
  check('the card can still SEE the PR after merging it (it used to go blank)',
    finalStatus?.pr?.number === prNumber, JSON.stringify(finalStatus?.pr ?? {}).slice(0, 200))
  // The approve row is prOpen -> Merge, prMerged -> Mint, else -> Create PR.
  // Without a merged flag the row fell through to "Create PR" and the Mint
  // action was unreachable from the card at all.
  check('and reports it MERGED, which is the only thing that makes Mint reachable',
    finalStatus?.merged === true, JSON.stringify({ merged: finalStatus?.merged, state: finalStatus?.pr?.state }))
  const minted = await act('version.mint', { sessionId: sid }); live('version.mint')
  check('version.mint — the action that row leads to — answers rather than throwing',
    minted !== undefined && minted.ok !== undefined, JSON.stringify(minted).slice(0, 240))

  console.log('\n--- what to look at on GitHub ---')
  console.log('repo     : ' + repoUrl)
  console.log('the PR   : ' + repoUrl + '/pull/' + prNumber)
  console.log('commits  : ' + repoUrl + '/commits/main')
  console.log('actions  : ' + repoUrl + '/actions')
  console.log('\nactions driven LIVE through the card route (' + covered.length + '):')
  console.log('  ' + covered.join('\n  '))
} catch (err) {
  check('the smoke ran to completion', false, String(err?.stack ?? err).slice(0, 900))
} finally {
  if (created && !keep) {
    sh('gh', ['repo', 'delete', `${owner}/${repoName}`, '--yes'], { allowFail: true })
    console.log(`\ncleaned up ${owner}/${repoName}`)
  }
}

console.log(failures === 0 ? '\ncard cicd smoke: ALL GREEN' : `\ncard cicd smoke: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
