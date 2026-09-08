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
 *   node scripts/card-cicd-smoke.mjs --yes [--keep] [--project]
 *
 * --project runs the OTHER half of the model. An arxa org and an arxa project
 * each get their OWN GitHub repo, and a session's PR goes to whichever repo
 * its workspace routes to — card.pr.* read project.json for a project seat and
 * org.json otherwise (repoFor). Without --project this exercises the org path
 * only, which is half the code. --project also uses arxa's REAL publish and
 * REAL naming (repo = the org/project slug) instead of a throwaway name, so
 * the result looks like what a user would actually get.
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
const projectMode = argv.includes('--project')
const ORG_NAME = 'Arxa Smoke Org'
const PROJECT_NAME = 'Arxa Smoke Project'

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
// createPrivateRepoApi lives in auth.js, not frame.js — the first --project
// run failed with "createPrivateRepoApi missing" for exactly this reason.
const auth = await import(P('github-link', 'lib', 'auth.js'))
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
  // --project drives arxa's REAL publish, which needs these three.
  createPrivateRepo: (name) => wrap(auth.createPrivateRepoApi)({ name }),
  repoNameTaken: async (name) => {
    const r = await fetch(`${apiBase}/repos/${owner}/${name}`, { headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + accessToken, 'user-agent': 'arxa-studio' } })
    return r.status === 200
  },
  // Settings matter (they decide which merge methods GitHub allows, and
  // card.pr.merge once 405'd on a squash-only repo). Protection needs a paid
  // plan on private repos, so it is allowed to fail without failing publish —
  // which is exactly how the real bridge treats it.
  wireFrame: async (o, n, payload) => {
    try { await wrap(frame.settingsApi)({ owner: o, name: n, ...(payload?.settings ?? {}) }) } catch { /* best effort */ }
    try {
      const protection = await wrap(frame.protectionApi)({ owner: o, name: n, ...(payload?.protection ?? {}) })
      return { ok: true, protection }
    } catch (e) { return { ok: true, protection: 'unavailable: ' + String(e?.message ?? e).slice(0, 80) } }
  },
  // NEVER actually register a runner: that would install a self-hosted runner
  // on this machine as a side effect of a smoke test. A clean refusal is
  // recorded in the manifest (frameRunner) and publish continues, which is
  // also the state card.runner.wake is asserted against below.
  ensureRunner: async () => ({ ok: false, reason: 'skipped-by-smoke' }),
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
let seatOwner = owner
let seatRepo = repoName
try {
  // ---- 1. the throwaway remote --------------------------------------------
  // No --add-readme: an initial commit on the remote shares no history with
  // the org repo and every PR then 422s.
  if (!projectMode) {
    sh('gh', ['repo', 'create', `${owner}/${repoName}`, '--private'])
    created = true
    check('a throwaway private repo exists on GitHub', true)
  }

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

  // The repo the SESSION's PR will land in. For an org seat that is the org
  // repo; for a project seat it is the project's own, which is the whole
  // point of --project (repoFor picks project.json over org.json).
  let workspace = 'notes'
  let org

  if (projectMode) {
    // arxa's REAL publish: it names the repo after the slug and pushes the
    // org's own history into it. No hand-written manifest anywhere.
    await act('org.create', { name: ORG_NAME, link: true })
    org = (await call('/__arxa/sidebar/state', {})).orgs.find((o) => o.open)
    // org.create with link:true only GATES on a linked account — it does not
    // publish. github.publish is the separate action that creates the repo.
    const publishedOrg = await act('github.publish', { orgId: org.id })
    const orgM = JSON.parse(fs.readFileSync(path.join(org.path, 'org.json'), 'utf8'))
    check('the ORG published to a repo arxa named after it',
      orgM.repoOwner === owner && typeof orgM.repoName === 'string' && orgM.repoName !== '',
      JSON.stringify({ repoOwner: orgM.repoOwner, repoName: orgM.repoName, publish: JSON.stringify(publishedOrg).slice(0, 140) }))
    created = true

    const made = await act('project.create', { orgId: org.id, name: PROJECT_NAME })
    const projectSlug = val(made)?.slug ?? val(made)?.project?.slug
    check('a project was created inside the org', typeof projectSlug === 'string' && projectSlug !== '',
      JSON.stringify(made).slice(0, 260))
    const connected = await act('project.connect', { orgId: org.id, projectSlug })
    const projPath = path.join(org.path, 'projects', projectSlug)
    const projM = JSON.parse(fs.readFileSync(path.join(projPath, 'project.json'), 'utf8'))
    check('the PROJECT published to its OWN repo, separate from the org\'s',
      projM.repoOwner === owner && typeof projM.repoName === 'string'
      && projM.repoName !== '' && projM.repoName !== orgM.repoName,
      JSON.stringify({ org: orgM.repoName, project: projM.repoName, connected: JSON.stringify(connected).slice(0, 120) }))
    seatOwner = projM.repoOwner
    seatRepo = projM.repoName

    // The workflow goes on the PROJECT repo's base branch — that is where a
    // project session's PR is opened, not the org repo.
    const projRemote = `https://${owner}:${accessToken}@github.com/${seatOwner}/${seatRepo}.git`
    fs.mkdirSync(path.join(projPath, '.github', 'workflows'), { recursive: true })
    fs.writeFileSync(path.join(projPath, '.github', 'workflows', 'ci.yml'), WORKFLOW)
    sh('git', ['-C', projPath, 'add', '.github'])
    sh('git', ['-C', projPath, 'commit', '-m', 'ci: add the workflow the card checks read'])
    sh('git', ['-C', projPath, 'push', projRemote, 'main:refs/heads/main'])

    // Read a real container off disk rather than hard-coding one: the fixed
    // project vocabulary has changed twice (v2 -> v3 -> v4), so a literal
    // would rot. (workspacesView is a CLIENT store, not host state — asking
    // the host for it returns nothing, which is how the first pass here
    // silently fell back.)
    const prefix = 'projects/' + projectSlug + '/'
    const containers = fs.readdirSync(projPath, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name).sort()
    check('the project scaffolded its fixed containers, which are its workspaces',
      containers.length > 0, 'containers: ' + JSON.stringify(containers))
    workspace = prefix + (containers.includes('notes') ? 'notes' : containers[0])
    console.log('  project workspace for the session: ' + workspace +
      '   (of ' + containers.length + ': ' + containers.join(', ') + ')')
  } else {
    await act('org.create', { name: 'Card Smoke Co', link: false })
    org = (await call('/__arxa/sidebar/state', {})).orgs.find((o) => o.open)
    const manifestPath = path.join(org.path, 'org.json')
    fs.writeFileSync(manifestPath, JSON.stringify({
      ...JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
      repoOwner: owner, repoName, localOnly: false,
    }, null, 2))
    const authRemote = `https://${owner}:${accessToken}@github.com/${owner}/${repoName}.git`
    sh('git', ['-C', org.path, 'remote', 'add', 'origin', `${repoUrl}.git`])
    fs.mkdirSync(path.join(org.path, '.github', 'workflows'), { recursive: true })
    fs.writeFileSync(path.join(org.path, '.github', 'workflows', 'ci.yml'), WORKFLOW)
    sh('git', ['-C', org.path, 'add', '.github'])
    sh('git', ['-C', org.path, 'commit', '-m', 'ci: add the workflow the card checks read'])
    sh('git', ['-C', org.path, 'push', authRemote, 'main:refs/heads/main'])
  }
  check('the base branch and its workflow are on the remote',
    ghJson(['api', `repos/${seatOwner}/${seatRepo}/branches/main`, '--jq', '{n:.name}'])?.n === 'main')

  // ---- 3. card.status on a fresh seat --------------------------------------
  const sess = await act('workspace.new-session', { orgId: org.id, workspace })
  const sid = sess.result?.id
  check('a new session/worktree was minted with an org-led path identity',
    sess.ok === true && String(sid ?? '').includes('/' + workspace.split('/')[0] + '/'),
    'workspace=' + workspace + ' ' + JSON.stringify(sess).slice(0, 200))
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
  const seatUrl = `https://github.com/${seatOwner}/${seatRepo}`
  console.log(`\n  → PR: ${seatUrl}/pull/${prNumber}\n`)

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
  // The seat's repo, not the org's: a project session's main lives in the
  // project checkout. row.repoPath is whatever repo the seat actually routes
  // to, which is the same thing repoFor() resolves on the host.
  const seatRepoPath = row.repoPath ?? org.path
  const seatRemote = `https://${owner}:${accessToken}@github.com/${seatOwner}/${seatRepo}.git`
  sh('git', ['-C', seatRepoPath, 'commit', '--allow-empty', '-m', 'chore: move main under the session'])
  sh('git', ['-C', seatRepoPath, 'push', seatRemote, 'main:refs/heads/main'])
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
  const prAfter = ghJson(['api', `repos/${seatOwner}/${seatRepo}/pulls/${prNumber}`, '--jq', '{state:.state,merged:.merged,sha:.merge_commit_sha}'])
  check('GitHub itself reports the PR merged, not just arxa',
    prAfter?.merged === true && prAfter?.state === 'closed', JSON.stringify(prAfter))
  check('the work is on main at the remote',
    (ghJson(['api', `repos/${seatOwner}/${seatRepo}/contents/note.md?ref=main`, '--jq', '{n:.name}'])?.n) === 'note.md')

  // ---- 10. cleanup ---------------------------------------------------------
  await github.deleteBranch(seatOwner, seatRepo, row.branch)
  const branchGone = ghJson(['api', `repos/${seatOwner}/${seatRepo}/branches/${row.branch}`, '--jq', '{n:.name}'])
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
  if (projectMode) console.log('org repo : https://github.com/' + owner + '/' + ORG_NAME.replace(/ /g, '-') + '   (the org\'s own repo)')
  console.log('repo     : ' + seatUrl + (projectMode ? '   (the PROJECT repo — its own, not the org\'s)' : ''))
  console.log('the PR   : ' + seatUrl + '/pull/' + prNumber)
  console.log('commits  : ' + seatUrl + '/commits/main')
  console.log('actions  : ' + seatUrl + '/actions')
  console.log('\nactions driven LIVE through the card route (' + covered.length + '):')
  console.log('  ' + covered.join('\n  '))
} catch (err) {
  check('the smoke ran to completion', false, String(err?.stack ?? err).slice(0, 900))
} finally {
  /* --project mode does NOT use `repoName`. It drives arxa's REAL publish,
   * which names each repo after its slug (Arxa-Smoke-Org, Arxa-Smoke-Project),
   * so deleting only the throwaway left BOTH real-named repos on the account
   * after every project run — found 2026-09-08, twelve minutes after a green
   * one. `created` was already true for them (set at :204/:206), so the flag
   * said "clean me up" while the cleanup could not name them.
   *
   * Names are derived from the same constants publish uses, never from what is
   * on the account, so this can only ever reach repos this run made. */
  if (created && !keep) {
    const slug = (n) => n.trim().replace(/\s+/g, '-')
    const mine = projectMode ? [slug(ORG_NAME), slug(PROJECT_NAME)] : [repoName]
    for (const r of mine) {
      sh('gh', ['repo', 'delete', `${owner}/${r}`, '--yes'], { allowFail: true })
      console.log(`\ncleaned up ${owner}/${r}`)
    }
  }
}

console.log(failures === 0 ? '\ncard cicd smoke: ALL GREEN' : `\ncard cicd smoke: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
