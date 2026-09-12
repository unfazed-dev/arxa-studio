#!/usr/bin/env node
/**
 * CI/CD stress harness — five scenarios, five DIFFERENT failure modes.
 *
 * Not five variations of one test: each scenario attacks a different way the
 * session/CI-CD machinery breaks, chosen from the root-cause work recorded in
 * docs/plans/session-id-collision-and-cicd-stress.md and the stress tiers of
 * docs/plans/local-only-git-parity-and-sidebar-decorations.md (S4/S5).
 *
 *   S1 identity pressure    — can two orgs end up minting the same session id?
 *   S2 concurrency          — do simultaneous creates collide on one counter?
 *   S3 partial failure      — push lands, PR open fails: what does the user get?
 *   S4 race for main        — two sessions land at once: ff-only must degrade
 *                             to --no-ff cleanly, conflicts park loudly, zero
 *                             commits lost (real child processes + barrier).
 *   S5 auto-commit storm    — rapid viewer saves through the REAL 1.5 s save
 *                             debounce while WIP auto-commits and decoration
 *                             reads race: no dropped write, no duplicate WIP
 *                             boundary, every concurrent read stays parseable.
 *
 * Offline by construction: real arxa code throughout, fakes only at the GitHub
 * boundary. Safe to run anywhere, any number of times. The LIVE end-to-end
 * (real repo, real PR) is scripts/cicd-smoke.mjs and is hand-run only.
 *
 * Exit 0 = every assertion held.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const P = (...p) => path.join(root, 'plugins', ...p)

const { createOrgLifecycle } = await import(P('file-org-shell', 'lib', 'index.js'))
const { mintSessionPath, parkedSessions } = await import(P('git-workspace', 'lib', 'sessions.js'))
const { healWorkspaceStore } = await import(P('workspace', 'lib', 'store-heal.js'))

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '\n      ' + extra}`)
  if (!ok) failures++
}
const refusesAsync = async (fn, wanted, label) => {
  try { await fn(); check(label, false, 'expected a refusal, got none') } catch (err) {
    check(label, String(err.message).includes(wanted), `message was: ${err.message}`)
  }
}
const refuses = (fn, wanted, label) => {
  try { fn(); check(label, false, 'expected a refusal, got none') } catch (err) {
    check(label, String(err.message).includes(wanted), `message was: ${err.message}`)
  }
}

const tmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-stress-' + tag + '-'))
const home = tmp('home')
const env = { ...process.env, ARXA_HOME: home }

// ===========================================================================
// S1 — IDENTITY PRESSURE
// A session id begins with the org FOLDER NAME, and the dsh conversation store
// is global, so two orgs sharing a name mint colliding conversation keys and
// dsh refuses to boot. Every route to a duplicate name is attacked here.
// ===========================================================================
console.log('\n=== S1  identity pressure ===')
{
  const rootA = tmp('a')
  const rootB = tmp('b')
  const svcA = createOrgLifecycle({ workspaceRoot: rootA, env })
  const svcB = createOrgLifecycle({ workspaceRoot: rootB, env })

  const alpha = svcA.createOrg('Stressco')
  check('a first org takes its folder name', path.basename(alpha.path).toLowerCase() === 'stressco',
    'basename was: ' + path.basename(alpha.path))

  // 1. the same name, different parent directory, different case.
  refuses(() => svcB.createOrg('STRESSCO'), 'org-name-taken',
    'a second org cannot take the same folder name in another directory (case-insensitively)')

  // 2. RENAME into a taken name (H1). Before the fix this passed, because
  //    renameOrg only tested fs.existsSync in its OWN directory.
  // NOTE: the refused createOrg above deliberately leaves its scaffolded
  // folder on disk (lifecycle.js: "renaming it and adding it is the
  // recovery"), so rootB now contains a stray `stressco`. Rename into a name
  // held ONLY in another root, or the pre-existing same-directory existsSync
  // check fires first and H1's guard is never reached.
  const gamma = svcA.createOrg('Gammaco')
  const beta = svcB.createOrg('Betaco')
  check('the H1 target name is free in this org\'s own directory',
    !fs.existsSync(path.join(rootB, 'gammaco')) && fs.existsSync(gamma.path))
  await refusesAsync(() => svcB.renameOrg(beta.path, 'Gammaco'), 'org-name-taken',
    'H1: renaming an org into a name another org already holds is refused')

  // 3. the case-only rename must still WORK — the guard must not collide the
  //    org with itself when only the letter case moves (D80 temp-name hop).
  let caseOnly = null
  try { caseOnly = await svcB.renameOrg(beta.path, 'BETACO') } catch (err) { caseOnly = err }
  check('a case-only rename is still allowed (the guard excludes the org itself)',
    caseOnly !== null && !(caseOnly instanceof Error), String(caseOnly?.message ?? ''))

  // 4. RECENTS CAP (H2). Recents holds 10; push past it so the first org
  //    falls out of listOrgs(), then try to reuse its name. The org is still
  //    on disk and its sessions still live in the dsh store, so this MUST be
  //    refused — but the pre-ledger guard could no longer see it.
  const rootC = tmp('c')
  const svcC = createOrgLifecycle({ workspaceRoot: rootC, env })
  for (let i = 0; i < 12; i++) svcC.createOrg('Filler ' + i)
  const stillListed = svcC.listOrgs().some((o) => path.resolve(o.path) === path.resolve(alpha.path))
  check('the first org has genuinely fallen off the capped recents list', !stillListed)
  refuses(() => createOrgLifecycle({ workspaceRoot: tmp('d'), env }).createOrg('Stressco'), 'org-name-taken',
    'H2: a name is still defended after its org drops off the 10-entry recents list')

  // 5. a name whose folder is GONE may be reused — refusing forever would
  //    strand every name the user has ever deleted.
  const doomed = createOrgLifecycle({ workspaceRoot: tmp('e'), env }).createOrg('Doomedco')
  fs.rmSync(doomed.path, { recursive: true, force: true })
  let reuse = null
  try { reuse = createOrgLifecycle({ workspaceRoot: tmp('f'), env }).createOrg('Doomedco') } catch (err) { reuse = err }
  check('a deleted org\'s name can be claimed again', reuse !== null && !(reuse instanceof Error),
    String(reuse?.message ?? ''))

  // 6. and whatever slips through must still not kill the engine: the exact
  //    legacy shape that did, healed by the boot preflight.
  const legacy = {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['w1', 'w2'], archivedSessionIds: [] },
    tables: { workspaces: {
      w1: { path: alpha.path, sessionIds: ['arxa-note-wt-260903-001'] },
      w2: { path: '/gone/elsewhere', sessionIds: ['arxa-note-wt-260903-001'] },
    } },
  }
  const { store, changes } = healWorkspaceStore(legacy)
  const holders = Object.values(store.tables.workspaces).filter((w) => w.sessionIds.includes('arxa-note-wt-260903-001'))
  check('a duplicate that slips through is healed at boot rather than bricking it',
    holders.length === 1 && changes.length === 1)
  check('the heal keeps the claim on the workspace that still exists on disk',
    store.tables.workspaces.w1.sessionIds.includes('arxa-note-wt-260903-001'))
}

// ===========================================================================
// S2 — CONCURRENCY
// mintSessionPath reads every registry, computes max+1, and writeRegistry is a
// bare writeFileSync. No lockfile exists anywhere in git-workspace or
// file-org-shell. Within one process there is no await between read and write,
// so it is atomic by accident; ACROSS processes nothing serialises it.
// This scenario measures which of those is true rather than assuming.
// ===========================================================================
console.log('\n=== S2  concurrency ===')
{
  const rootX = tmp('x')
  const svc = createOrgLifecycle({ workspaceRoot: rootX, env })
  const org = svc.createOrg('Raceco')

  // In-process burst: mint repeatedly WITHOUT writing between mints — this is
  // what two requests interleaving before either commits would see.
  const sessions = parkedSessions(org.path, env)
  const burst = new Set()
  for (let i = 0; i < 25; i++) {
    burst.add(mintSessionPath({ org: path.basename(org.path), workspace: 'notes', name: 'note', sessions }))
  }
  check('mint is a pure function of the registry it is shown (25 mints, same input, one id)',
    burst.size === 1, `got ${burst.size} distinct ids`)

  // THE ACTUAL RACE. The block above only shows the mint is deterministic
  // given fixed input — it proves nothing about concurrency, because nothing
  // was written between mints. This spawns real processes that each run the
  // FULL create path (openOrg → newSession: mint, branch, worktree, registry
  // write) against one org at the same time, which is the only way to find
  // out whether two simultaneous creates can land on one id.
  const child = path.join(tmp('script'), 'create.mjs')
  fs.writeFileSync(child, `
const { createOrgLifecycle } = await import(${JSON.stringify(P('file-org-shell', 'lib', 'index.js'))})
const svc = createOrgLifecycle({ workspaceRoot: process.argv[2], env: process.env })
try {
  const opened = await svc.openOrg(process.argv[3])
  const r = await opened.newSession('note', 'notes')
  process.stdout.write('OK ' + r.id)
} catch (err) {
  // The NAME is the contract (OrgLockedError); the message is prose and gets
  // truncated. Assert on the name.
  process.stdout.write('ERR ' + (err && err.name) + ' | cause=' + (err && err.cause && err.cause.name) + ' | ' + String(err && err.message).replace(/\s+/g, ' ').slice(0, 200))
}
// openOrg leaves a handle open (the org lock), so the child would never exit
// on its own and the parent's 'close' would never fire. Exit explicitly —
// what is being measured is concurrent CREATES, not process teardown.
process.exit(0)
`)
  const { spawn } = await import('node:child_process')
  const runs = await Promise.all([0, 1, 2, 3].map(() => new Promise((res) => {
    const p = spawn(process.execPath, [child, rootX, org.path], { env })
    let out = ''
    p.stdout.on('data', (d) => { out += d })
    p.on('close', () => res(out.trim()))
  })))
  const madeIds = runs.filter((r) => r.startsWith('OK ')).map((r) => r.slice(3))
  const refused = runs.filter((r) => r.startsWith('ERR '))
  console.log('      concurrent creates: ' + madeIds.length + ' made, ' + refused.length + ' refused')
  check('every session a concurrent create actually produced has a DISTINCT id',
    new Set(madeIds).size === madeIds.length,
    JSON.stringify(runs))
  check('at least one concurrent create got through (the test really ran)',
    madeIds.length >= 1, JSON.stringify(runs))
  // THE H3 VERDICT, measured rather than argued. The losers do not race and
  // do not crash — they are turned away by the ORG LOCK, which is what makes
  // the read-modify-write mint safe across processes despite writeRegistry
  // being a bare writeFileSync with no lockfile of its own. If this ever goes
  // green with 4 made and 0 refused, the lock has stopped serialising and the
  // counter really can collide.
  check('H3: the losers are refused by the org lock, not left to race or crash',
    refused.length === 0 || refused.every((r) => /ShellLockError/.test(r)),
    JSON.stringify(refused))
  // Whatever ids were produced must also be distinct in the REGISTRY, not
  // just in the processes' return values — a lost write would show up here.
  const persisted = parkedSessions(org.path, env).map((s) => s.id)
  check('the registry persisted every created id, none lost to a clobbering write',
    madeIds.every((id) => persisted.includes(id))
    && new Set(persisted).size === persisted.length,
    'made=' + JSON.stringify(madeIds) + ' persisted=' + JSON.stringify(persisted))

}
// ===========================================================================
console.log('\n=== S3  partial failure: push lands, PR open fails ===')
{
  // The REAL two-host harness (same shape as arxa-git-card/selftest.actions.mjs):
  // real org, real git session, real push to a real local bare remote. Only
  // GitHub itself is faked — which is exactly the boundary that fails here.
  const s3home = tmp('s3home')
  const s3ws = tmp('s3ws')
  process.env.ARXA_HOME = s3home
  const shell = await import(P('file-org-shell', 'lib', 'index.js'))
  shell.saveWorkspaceRoot(s3ws)
  const routes = {}
  const reg = { webServer: { register: (r) => { routes[r.path] = r.handler } } }
  const calls = { prCreate: 0 }
  let prFails = true
  // A VALIDATING fake, not a permissive one.
  //
  // On 2026-09-03 the live smoke caught three call-shape errors in one run —
  // `message` for `subject`, `body` for `text`, `replyTo` for `commentId` —
  // and CI had stayed green through all of them, because every fake in the
  // suite accepted whatever it was handed. A fake that asserts its inputs is
  // the difference between a green suite and a meaningful one, so each method
  // below refuses a malformed call the way real GitHub would.
  const seen = {}
  const need = (cond, what) => { if (!cond) throw new Error('fake-github: ' + what) }
  const fakeGh = {
    status: async () => ({ ok: true, linked: true, login: 'tester' }),
    // The push embeds credentials into the origin URL. The origin here is a
    // local bare repo, so urlFor() leaves it untouched and the push is real.
    gitCredentials: async () => ({ login: 'tester', token: 'x' }),
    prUpdate: async () => ({}),
    // NB prComment is POSITIONAL (owner, name, {number, body}) while the newer
    // prThreadReply is a single options object — github-link ships both shapes
    // and a caller that confuses them must fail here, not in production.
    prComment: async (o, n, opts) => {
      need(typeof o === 'string' && o !== '', 'prComment: owner must be positional arg 1')
      need(typeof n === 'string' && n !== '', 'prComment: name must be positional arg 2')
      need(Number.isFinite(Number(opts?.number)), 'prComment: number is required')
      need(typeof opts?.body === 'string' && opts.body.trim() !== '', 'prComment: body is required')
      seen.prComment = { owner: o, name: n, ...opts }
      return { id: 1 }
    },
    prThreadReply: async (a) => {
      need(typeof a?.owner === 'string' && a.owner !== '', 'prThreadReply: owner is required')
      need(typeof a?.name === 'string' && a.name !== '', 'prThreadReply: name is required')
      need(Number.isFinite(Number(a?.number)), 'prThreadReply: number is required')
      need(a?.commentId !== undefined && a.commentId !== null, 'prThreadReply: commentId is required')
      need(typeof a?.body === 'string' && a.body.trim() !== '', 'prThreadReply: body is required')
      seen.prThreadReply = { ...a }
      return { id: 2 }
    },
    setThreadResolved: async (a) => {
      need(typeof a?.threadId === 'string' && a.threadId !== '', 'setThreadResolved: threadId is required')
      need(typeof a?.resolved === 'boolean', 'setThreadResolved: resolved must be a boolean')
      seen.setThreadResolved = { ...a }
      return { id: a.threadId, resolved: a.resolved }
    },
    prListForHead: async () => [],
    prChecks: async () => ({ state: 'unknown', asleep: false, runs: [] }),
    prCreate: async (o, n, a) => {
      calls.prCreate++
      need(typeof o === 'string' && o !== '', 'prCreate: owner must be positional arg 1')
      need(typeof n === 'string' && n !== '', 'prCreate: name must be positional arg 2')
      need(typeof a?.head === 'string' && a.head !== '', 'prCreate: head branch is required')
      need(typeof a?.base === 'string' && a.base !== '', 'prCreate: base branch is required')
      need(typeof a?.title === 'string' && a.title !== '', 'prCreate: title is required')
      seen.prCreate = { owner: o, name: n, ...a }
      // The real 422 GitHub returns when the head branch is not yet visible.
      if (prFails) throw new Error('HTTP 422: no commits between master and the head branch')
      return { number: 7, url: 'https://github.com/acme/widgets/pull/7', html_url: 'https://github.com/acme/widgets/pull/7' }
    },
  }
  const sidebar = await import(P('arxa-sidebar', 'lib', 'index.js'))
  const card = await import(P('arxa-git-card', 'lib', 'index.js'))
  sidebar.apply(reg, { github: fakeGh })
  card.apply(reg)
  const call = (p, body) => new Promise((res) => {
    const req = { url: p, method: 'POST', _h: {}, on(e, fn) { this._h[e] = fn } }
    routes[p](req, { writeHead() {}, end: (s) => res(JSON.parse(s)) })
    queueMicrotask(() => { req._h.data?.(JSON.stringify(body)); req._h.end?.() })
  })
  const act = (action, arg) => call(
    /^(card|insight|version)\./.test(action) ? '/__arxa/git-card/action' : '/__arxa/sidebar/action',
    { action, arg })

  const created = await act('org.create', { name: 'Partial Co', link: false })
  check('S3 fixture: org created', created.ok === true, JSON.stringify(created).slice(0, 160))
  const state = await call('/__arxa/sidebar/state', {})
  const org = state.orgs.find((o) => o.open)
  const sess = await act('workspace.new-session', { orgId: org.id, workspace: 'notes' })
  check('S3 fixture: a real session with a real branch exists', sess.ok === true, JSON.stringify(sess).slice(0, 200))
  const sid = sess.result?.id

  // Make the org look published, and give it a REAL remote so the push half
  // genuinely succeeds — the whole point is that push works and PR does not.
  const bare = tmp('remote')
  spawnSync('git', ['init', '--bare', '-b', 'master', bare], { encoding: 'utf8' })
  spawnSync('git', ['-C', org.path, 'remote', 'add', 'origin', bare], { encoding: 'utf8' })
  const manifest = path.join(org.path, 'org.json')
  fs.writeFileSync(manifest, JSON.stringify({
    ...JSON.parse(fs.readFileSync(manifest, 'utf8')),
    repoOwner: 'acme', repoName: 'widgets', localOnly: false,
  }, null, 2))

  const first = await act('card.push', { sessionId: sid })
  const body = first.result ?? first
  check('the push itself is still reported as having SUCCEEDED',
    first.ok === true && body?.ok === true, JSON.stringify(first).slice(0, 240))
  check('the failed PR is surfaced with a reason, never silently swallowed',
    body?.pr === null || body?.pr === undefined
      ? typeof body?.prReason === 'string' && body.prReason !== ''
      : false,
    JSON.stringify(body).slice(0, 240))
  check('the PR open was actually attempted', calls.prCreate >= 1, 'prCreate calls: ' + calls.prCreate)

  // The retry. The branch is already on the remote, so this must open the PR
  // rather than wedge on "already pushed" or need the work redone.
  prFails = false
  const before = calls.prCreate
  const second = await act('card.push', { sessionId: sid })
  const body2 = second.result ?? second
  check('a retry after the outage opens the PR',
    Boolean(body2?.pr) && body2.pr.number === 7, JSON.stringify(body2).slice(0, 240))
  check('the retry re-attempted PR creation rather than assuming it was done',
    calls.prCreate === before + 1, 'prCreate calls: ' + calls.prCreate)

  // ---- the WRITE-VERB CONTRACTS, pinned offline ---------------------------
  // These are the exact shapes the live smoke found wrong on 2026-09-03. The
  // handler reads `text` / `number` / `commentId` (index.js:995-1017); an
  // earlier draft of the smoke sent `body` / `replyTo` and CI never noticed,
  // because the fakes accepted anything. Now they do not.
  const replyOk = await act('insight.reply', {
    sessionId: 's1-does-not-matter', number: 7, commentId: 42, text: 'answered inside arxa',
  })
  // The session id above is deliberately unknown: the handler must refuse on
  // the SESSION before it ever reaches GitHub.
  check('reply: an unknown session is refused before the service is touched',
    (replyOk.result ?? replyOk)?.reason === 'session-not-found' && seen.prThreadReply === undefined,
    JSON.stringify(replyOk).slice(0, 200))

  const realSid = (await act('card.status', { sessionId: sid }))?.result ? sid : sid
  const threaded = await act('insight.reply', {
    sessionId: realSid, number: 7, commentId: 42, text: 'answered inside arxa',
  })
  check('reply WITH a commentId reaches prThreadReply in its single-object shape',
    seen.prThreadReply?.commentId === 42
    && String(seen.prThreadReply?.body ?? '').includes('answered inside arxa')
    && seen.prThreadReply?.number === 7,
    JSON.stringify(seen.prThreadReply ?? threaded).slice(0, 240))
  check('reply carries the hidden session marker so the PR stays attributable',
    String(seen.prThreadReply?.body ?? '').includes(realSid),
    String(seen.prThreadReply?.body ?? '').slice(0, 160))

  const bareComment = await act('insight.reply', { sessionId: realSid, number: 7, text: 'a bare pr comment' })
  check('reply WITHOUT a commentId reaches prComment in its POSITIONAL shape',
    seen.prComment?.owner === 'acme' && seen.prComment?.name === 'widgets'
    && String(seen.prComment?.body ?? '').includes('a bare pr comment'),
    JSON.stringify(seen.prComment ?? bareComment).slice(0, 240))

  const empty = await act('insight.reply', { sessionId: realSid, number: 7, commentId: 42, text: '   ' })
  check('reply: an empty message is refused before the service, never sent',
    (empty.result ?? empty)?.reason === 'message-required'
    && seen.prThreadReply?.body?.includes('a bare pr comment') !== true,
    JSON.stringify(empty).slice(0, 200))

  const res = await act('insight.resolve', { sessionId: realSid, threadId: 'THREAD_1', resolved: true })
  check('resolve passes threadId and a BOOLEAN resolved through to the service',
    seen.setThreadResolved?.threadId === 'THREAD_1' && seen.setThreadResolved?.resolved === true,
    JSON.stringify(seen.setThreadResolved ?? res).slice(0, 200))
}

// ===========================================================================
// S4 — RACE FOR MAIN (plan Tier 5, local-only-git-parity §4).
// Two sessions integrate and land against ONE scratch repo + local bare
// remote at the same moment, from REAL child processes released by a
// parent-controlled barrier — concurrency is never simulated in this process.
// The contract under attack (the sessionStageBoundary docblock): a land race
// ends with one session first on main and the other EITHER merged through the
// --ff-only → --no-ff degradation OR loud (SessionMergeError parked / a
// mid-merge integrate conflict), never silent, never losing a commit.
// ARXA_STRESS_GW_LIB lets a negative-control fixture be injected without
// touching this worktree.
// ===========================================================================
console.log('\n=== S4  race for main ===')
{
  const gwLib = process.env.ARXA_STRESS_GW_LIB || P('git-workspace', 'lib')
  const { runGit } = await import(path.join(gwLib, 'run.js'))
  const { openSession, reviveSession, listSessions, sessionStageBoundary } = await import(path.join(gwLib, 'sessions.js'))
  const { readySession } = await import(path.join(gwLib, 'prflow.js'))
  const { isIntegrating } = await import(path.join(gwLib, 'integrate.js'))
  const { spawn } = await import('node:child_process')

  // The child runs the REAL product land flow — readySession (integrate main
  // first) then sessionStageBoundary (ff-only degrading to --no-ff) — only
  // after the barrier file appears, so both merge attempts are simultaneous.
  const child = path.join(tmp('s4scripts'), 'land.mjs')
  fs.writeFileSync(child, `
const [repo, id, readyFile, releaseFile, outFile] = process.argv.slice(2)
const fs = await import('node:fs')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const report = (s) => { fs.writeFileSync(outFile, s); process.exit(0) }
const lib = process.env.ARXA_STRESS_GW_LIB
const { readySession } = await import(lib + '/prflow.js')
const { sessionStageBoundary } = await import(lib + '/sessions.js')
fs.writeFileSync(readyFile, 'ready')
for (let i = 0; i < 1000 && !fs.existsSync(releaseFile); i++) await sleep(20)
if (!fs.existsSync(releaseFile)) report('TIMEOUT')
try {
  const rd = readySession(repo, id, { subject: 'feat: ' + id, env: process.env })
  if (rd.reason === 'integrate-conflict') report('INTEGRATE-CONFLICT ' + JSON.stringify(rd.files || []))
  const b = sessionStageBoundary(repo, id, { env: process.env })
  report('BOUNDARY ' + JSON.stringify({ merged: b.merged, parked: b.parked, gate: b.gate.green }))
} catch (err) {
  report('THREW ' + err.name + ' | ' + String(err.message).replace(/\\s+/g, ' ').slice(0, 200))
}
`)

  // One round = one scratch repo + bare remote + two sessions one commit each.
  // `conflict` makes both commits rewrite the SAME line of shared.md.
  const round = async (tag, conflict) => {
    const dir = tmp('s4-' + tag)
    const repo = path.join(dir, 'repo')
    const bare = path.join(dir, 'remote.git')
    runGit(['init', '--initial-branch=main', repo], { env })
    runGit(['init', '--bare', '--initial-branch=main', bare], { env })
    runGit(['remote', 'add', 'origin', bare], { cwd: repo, env })
    fs.writeFileSync(path.join(repo, 'shared.md'), 'base line\n')
    runGit(['add', '-A'], { cwd: repo, env })
    runGit(['commit', '-m', 'chore: base'], { cwd: repo, env })
    runGit(['push', '-u', 'origin', 'main'], { cwd: repo, env: { ...env, GIT_TERMINAL_PROMPT: '0' } })

    const mkSession = (id, file, text) => {
      const s = openSession(repo, { id, name: id, workspace: 'notes', env })
      fs.writeFileSync(path.join(s.worktree, file), text)
      runGit(['add', '-A'], { cwd: s.worktree, env })
      runGit(['commit', '-m', 'feat: ' + id], { cwd: s.worktree, env })
      return s
    }
    mkSession('race-a', conflict ? 'shared.md' : 'a.md', conflict ? 'settled by race-a\n' : 'content a\n')
    mkSession('race-b', conflict ? 'shared.md' : 'b.md', conflict ? 'settled by race-b\n' : 'content b\n')

    // The barrier: both children arm, the PARENT releases, both land at once.
    const bar = tmp('s4-bar-' + tag)
    const launch = (id) => new Promise((res) => {
      const p = spawn(process.execPath,
        [child, repo, id, path.join(bar, id + '.ready'), path.join(bar, 'release'), path.join(bar, id + '.out')],
        { env: { ...env, ARXA_STRESS_GW_LIB: gwLib } })
      let stderr = ''
      p.stderr.on('data', (d) => { stderr += d })
      p.on('error', () => res({ id, stderr }))
      p.on('close', () => res({ id, stderr }))
    })
    const jobs = [launch('race-a'), launch('race-b')]
    const deadline = Date.now() + 20000
    while (Date.now() < deadline
      && !(fs.existsSync(path.join(bar, 'race-a.ready')) && fs.existsSync(path.join(bar, 'race-b.ready')))) {
      await new Promise((r) => setTimeout(r, 10))
    }
    const armed = fs.existsSync(path.join(bar, 'race-a.ready')) && fs.existsSync(path.join(bar, 'race-b.ready'))
    check('S4/' + tag + ': both children were armed before the barrier released', armed)
    fs.writeFileSync(path.join(bar, 'release'), 'go')
    await Promise.all(jobs)

    const outcome = {}
    for (const id of ['race-a', 'race-b']) {
      const raw = fs.existsSync(path.join(bar, id + '.out'))
        ? fs.readFileSync(path.join(bar, id + '.out'), 'utf8').trim() : 'NO-OUTPUT'
      outcome[id] = raw.startsWith('BOUNDARY')
        ? { kind: 'boundary', merged: JSON.parse(raw.slice(9)).merged }
        : raw.startsWith('INTEGRATE-CONFLICT') ? { kind: 'integrate-conflict' }
        : raw.startsWith('THREW SessionMergeError') ? { kind: 'merge-parked' }
        : { kind: 'unexpected', raw }
    }
    return { repo, outcome }
  }

  // ---- round 1: different files — the second land degrades --no-ff and lands
  {
    const { repo, outcome } = await round('clean', false)
    check('S4/clean: every child ended in a classified outcome (no crash, no hang)',
      Object.values(outcome).every((o) => ['boundary', 'merge-parked'].includes(o.kind)), JSON.stringify(outcome))
    check('S4/clean: at least one session landed on main first',
      Object.values(outcome).some((o) => o.kind === 'boundary' && o.merged), JSON.stringify(outcome))

    // A land lost to a ref/index lock parks loudly — prove the parked loser
    // still lands through the product verbs (revive → ready → boundary).
    let retried = 0
    for (const [id, o] of Object.entries(outcome)) {
      if (o.kind !== 'merge-parked') continue
      retried++
      reviveSession(repo, id, env)
      readySession(repo, id, { subject: 'feat: ' + id, env })
      const retry = sessionStageBoundary(repo, id, { env })
      check('S4/clean: a race-parked loser lands cleanly on retry (nothing lost)',
        retry.merged === true, 'retry=' + JSON.stringify({ merged: retry.merged, parked: retry.parked }))
    }

    const log = runGit(['log', '--format=%s', 'main'], { cwd: repo, env })
    check('S4/clean: BOTH sessions\' content survived onto main',
      runGit(['show', 'main:a.md'], { cwd: repo, env, allowFail: true }) === 'content a'
      && runGit(['show', 'main:b.md'], { cwd: repo, env, allowFail: true }) === 'content b', log)
    // The second lander always degrades: either it merged --no-ff on the spot
    // (merge commit on main) or it parked on the lost race and landed through
    // the retry above (integrate + land). Both are the clean degradation.
    check('S4/clean: the simultaneous second land degraded cleanly (--no-ff merge or park-and-retry)',
      /chore\(session\): merge /.test(log) || retried > 0, log)
    check('S4/clean: main is clean after the race (no half merge, no markers)',
      runGit(['status', '--porcelain'], { cwd: repo, env, allowFail: true }) === ''
      && runGit(['grep', '-lE', '^(<<<<<<<|>>>>>>>) ', 'main'], { cwd: repo, env, allowFail: true }) === null, '')
  }

  // ---- round 2: the same line — the loser conflicts LOUDLY, commit intact
  {
    const { repo, outcome } = await round('conflict', true)
    check('S4/conflict: every child ended in a classified outcome',
      Object.values(outcome).every((o) => ['boundary', 'merge-parked', 'integrate-conflict'].includes(o.kind)),
      JSON.stringify(outcome))

    let landed = Object.entries(outcome).filter(([, o]) => o.kind === 'boundary' && o.merged).map(([id]) => id)
    if (landed.length === 0) {
      // Both loud (lock race both ways): land one through the product verbs so
      // "exactly one lands first" is established, then the other stays loud.
      const pick = (Object.entries(outcome).find(([, o]) => o.kind === 'merge-parked') || [])[0] ?? 'race-a'
      const row = listSessions(repo, env).find((s) => s.id === pick)
      runGit(['merge', '--abort'], { cwd: row.worktree, env, allowFail: true })
      if (row.state !== 'open') reviveSession(repo, pick, env)
      readySession(repo, pick, { subject: 'feat: ' + pick, env })
      sessionStageBoundary(repo, pick, { env })
      landed = [pick]
    }
    const loser = landed[0] === 'race-a' ? 'race-b' : 'race-a'
    check('S4/conflict: exactly one session landed first', landed.length === 1, JSON.stringify(outcome))

    check('S4/conflict: main holds the winner\'s content and none of the loser\'s',
      runGit(['show', 'main:shared.md'], { cwd: repo, env }) === 'settled by ' + landed[0], '')
    check('S4/conflict: the loser conflicts LOUDLY — parked or left mid-merge',
      ['merge-parked', 'integrate-conflict'].includes(outcome[loser].kind)
      || (outcome[loser].kind === 'boundary' && outcome[loser].merged === false), JSON.stringify(outcome))
    check('S4/conflict: the loser\'s commit survived on its branch (zero commits lost)',
      runGit(['show', 'arxa/' + loser + ':shared.md'], { cwd: repo, env, allowFail: true }) === 'settled by ' + loser, '')
    const row = listSessions(repo, env).find((s) => s.id === loser)
    check('S4/conflict: the loser is parked in the registry or parked mid-merge',
      row.state === 'parked' || isIntegrating(row.worktree, env),
      JSON.stringify({ state: row.state, reason: row.parkedReason }))
    check('S4/conflict: main is clean — no markers, no half merge',
      runGit(['status', '--porcelain'], { cwd: repo, env, allowFail: true }) === ''
      && runGit(['grep', '-lE', '^(<<<<<<<|>>>>>>>) ', 'main'], { cwd: repo, env, allowFail: true }) === null, '')
  }
}

// ===========================================================================
// S5 — AUTO-COMMIT STORM (plan Tier 5).
// Rapid viewer saves across three files through the REAL production save
// coordinator — sliced verbatim out of the viewer source (client.js, the same
// extraction technique as selftest.client-save-race.mjs) and run with its own
// 1.5 s debounce intact (program ruling 4: that debounce IS the autosave
// owner) — driving the REAL write API, whose every save lands an atomic write
// plus a WIP auto-commit. A second PROCESS polls decorations and the index
// throughout: a synchronous wipCommit blocks this event loop, so only another
// process can observe the half-written moments. ARXA_STRESS_AV_LIB /
// ARXA_STRESS_GW_LIB allow negative-control fixture injection.
// ===========================================================================
console.log('\n=== S5  auto-commit storm ===')
{
  const gwLib = process.env.ARXA_STRESS_GW_LIB || P('git-workspace', 'lib')
  const avLib = process.env.ARXA_STRESS_AV_LIB || P('artifact-viewer', 'lib')
  const { runGit } = await import(path.join(gwLib, 'run.js'))
  const { openSession } = await import(path.join(gwLib, 'sessions.js'))
  const { decorate } = await import(path.join(gwLib, 'decorations.js'))
  const { createWriteApi } = await import(path.join(avLib, 'write-api.js'))
  const { issueToken } = await import(path.join(avLib, 'tokens.js'))
  const { spawn } = await import('node:child_process')

  const home5 = tmp('s5home')
  const env5 = { ...process.env, ARXA_HOME: home5 }
  const repo = path.join(tmp('s5repo'), 'repo')
  runGit(['init', '--initial-branch=main', repo], { env: env5 })
  fs.writeFileSync(path.join(repo, 'readme.md'), 'storm fixture\n')
  runGit(['add', '-A'], { cwd: repo, env: env5 })
  runGit(['commit', '-m', 'chore: base'], { cwd: repo, env: env5 })
  const SID = 'storm-s1'
  const wt = openSession(repo, { id: SID, name: 'storm', workspace: 'notes', env: env5 }).worktree

  // The write API resolves the session through the open-org truth (D80) — the
  // same organisation.json + live lock trick the shipped selftest uses.
  fs.mkdirSync(path.join(repo, '.arxa', 'locks'), { recursive: true })
  fs.writeFileSync(path.join(repo, '.arxa', 'locks', path.basename(repo) + '.lock'),
    JSON.stringify({ pid: process.pid, orgPath: repo }))
  fs.writeFileSync(path.join(home5, 'organisation.json'), JSON.stringify({ orgs: [repo] }))

  const secret = 'stress-secret'
  const writeApi = createWriteApi({ env: env5, secret, getSettings: () => ({}) })
  const wtok = issueToken({ secret, scope: 'write', worktreeId: SID, ttlSeconds: 600 })

  // THE PRODUCTION COORDINATOR. Slice save() and onDirty out of the real
  // viewer source and run them verbatim — no reimplementation, and no sleep
  // fakes the debounce: the coordinator's own 1500 ms timer fires the saves.
  const clientSrc = fs.readFileSync(path.join(avLib, 'client.js'), 'utf8')
  const saveStart = clientSrc.indexOf('const save = async (force = false) =>')
  const dirtyStart = clientSrc.indexOf('/** Auto-save: 1.5 s after the last keystroke', saveStart)
  const dirtyEnd = clientSrc.indexOf('React.useEffect(() => () =>', dirtyStart)
  const found = saveStart >= 0 && dirtyStart > saveStart && dirtyEnd > dirtyStart
  check('S5: the production save coordinator is where the viewer ships it', found)
  if (found) {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    const buildSave = new AsyncFunction(
      'session', 'state', 'docRef', 'saveTimer', 'openRequestRef', 'mtimeRef',
      'setSavePhase', 'setSaveNote', 'fetchToken', 'fetch', 'WRITE_ROUTE', 'setDirty', 't',
      clientSrc.slice(saveStart, dirtyStart) + '\nreturn save')
    const buildDirty = new Function(
      'setDirty', 'savePhase', 'setSavePhase', 'saveTimer', 'save', 'AUTOSAVE_MS', 'setTimeout', 'clearTimeout',
      clientSrc.slice(dirtyStart, dirtyEnd) + '\nreturn onDirty')

    const callWrite = (payload, headers) => new Promise((resolve, reject) => {
      const res = { statusCode: 0, body: '',
        writeHead(s) { this.statusCode = s },
        end(b) { this.body = b || ''; resolve(this) } }
      const req = { method: 'POST', headers,
        on(ev, fn) {
          if (ev === 'data') queueMicrotask(() => fn(Buffer.from(JSON.stringify(payload))))
          if (ev === 'end') queueMicrotask(() => fn())
        } }
      writeApi.handle(req, res).then(() => resolve(res), reject)
    })

    const editors = await Promise.all(['notes/a.md', 'notes/b.md', 'notes/c.md'].map(async (rel) => {
      const doc = { text: 'storm seed\n' }
      const ed = { rel, doc, posts: 0, oks: 0 }
      const saveTimer = { current: null } // shared: save clears what onDirty arms
      const mtimeRef = { current: null }
      const fetchViaApi = async (url, options) => {
        ed.posts++
        const res = await callWrite(JSON.parse(options.body), options.headers)
        const body = JSON.parse(res.body || '{}')
        if (res.statusCode === 200) ed.oks++
        return { ok: res.statusCode === 200, status: res.statusCode, json: async () => body }
      }
      const save = await buildSave(
        { id: SID }, { relPath: rel },
        { current: { getText: () => doc.text } }, saveTimer, { current: 1 }, mtimeRef,
        () => {}, () => {}, async () => ({ token: wtok }), fetchViaApi,
        '/__arxa/artifacts/write', () => {}, (k) => k)
      const onDirty = buildDirty(() => {}, 'idle', () => {}, saveTimer, save, 1500, setTimeout, clearTimeout)
      return { ed, onDirty }
    }))

    // The concurrent reader: a real second process, polling the REAL decorate
    // plus a bare index read for as long as the storm runs.
    const scripts = tmp('s5scripts')
    const stopFile = path.join(scripts, 'stop')
    const pollOut = path.join(scripts, 'poll.json')
    const poller = path.join(scripts, 'poll.mjs')
    fs.writeFileSync(poller, `
const fs = await import('node:fs')
const { spawnSync } = await import('node:child_process')
const { decorate } = await import(process.env.ARXA_STRESS_GW_LIB + '/decorations.js')
const wt = process.env.ARXA_S5_WT
const [stopFile, outFile] = process.argv.slice(2)
let reads = 0, indexFails = 0, badMaps = 0
const failures = []
const wall = Date.now() + 30000 // never orphan: die even if the parent crashed
while (!fs.existsSync(stopFile) && Date.now() < wall) {
  try {
    const d = decorate(wt, { env: process.env })
    reads++
    if (!d.ok) failures.push('decorate not ok: ' + d.reason)
    else for (const l of Object.values(d.files)) if (!'MADR'.includes(l)) badMaps++
  } catch (e) { reads++; failures.push('decorate threw: ' + String(e && e.message).slice(0, 100)) }
  const r = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: wt, encoding: 'utf8' })
  if (r.status !== 0) indexFails++
  await new Promise((res) => setTimeout(res, 5))
}
fs.writeFileSync(outFile, JSON.stringify({ reads, indexFails, badMaps, failureCount: failures.length, first: failures.slice(0, 3) }))
process.exit(0)
`)
    const poll = spawn(process.execPath, [poller, stopFile, pollOut],
      { env: { ...env5, ARXA_STRESS_GW_LIB: gwLib, ARXA_S5_WT: wt } })

    // The storm: 2 typing bursts × 10 keystrokes × 3 files = 60 dirty marks.
    for (let round = 1; round <= 2; round++) {
      for (let i = 0; i < 10; i++) {
        for (const { ed, onDirty } of editors) { ed.doc.text += 'line ' + round + '.' + i + '\n'; onDirty() }
      }
      await new Promise((r) => setTimeout(r, 1500 + 800)) // the coordinator's own timer fires in here
    }
    await new Promise((r) => setTimeout(r, 500))
    fs.writeFileSync(stopFile, 'stop')
    await new Promise((res) => { poll.on('close', res); setTimeout(() => { poll.kill(); res() }, 5000) })
    const pollStats = fs.existsSync(pollOut) ? JSON.parse(fs.readFileSync(pollOut, 'utf8'))
      : { reads: 0, indexFails: -1, badMaps: -1, failureCount: -1, first: ['poller crashed'] }

    const totalPosts = editors.reduce((n, { ed }) => n + ed.posts, 0)
    const totalOks = editors.reduce((n, { ed }) => n + ed.oks, 0)
    console.log('      storm: 60 dirty marks -> ' + totalPosts + ' coalesced saves; concurrent decorate reads: '
      + pollStats.reads)

    check('S5: the debounce coalesced the bursts (60 marks -> exactly 2 saves per file)',
      editors.every(({ ed }) => ed.posts === 2), JSON.stringify(editors.map(({ ed }) => ed.posts)))
    check('S5: every fired save reached the write API and succeeded',
      totalOks === totalPosts && totalPosts === 6, totalOks + '/' + totalPosts)
    check('S5: no dropped final write — disk equals every document\'s final bytes',
      editors.every(({ ed }) => fs.readFileSync(path.join(wt, ed.rel), 'utf8') === ed.doc.text), '')
    check('S5: the tree is clean after quiet (the last save\'s WIP commit landed)',
      runGit(['status', '--porcelain'], { cwd: wt, env: env5, allowFail: true }) === '', '')
    // WIP boundaries: one continuous tier — every save is committed, and
    // simultaneous saves may legitimately share one commit (a commit sweeps
    // the whole tree), but no boundary may repeat the previous tree.
    const wipRows = runGit(['log', '--format=%T|%ce', 'main..HEAD'], { cwd: wt, env: env5 })
      .split('\n').filter(Boolean).map((l) => l.split('|'))
    const wipCount = wipRows.filter((r) => r[1] === 'wip@arxa.invalid').length
    const dupBoundary = wipRows.some((r, i) => i > 0 && r[0] === wipRows[i - 1][0])
    check('S5: the WIP tier converged — every save committed, no duplicate boundary',
      wipCount >= 1 && wipCount <= 6 && !dupBoundary, JSON.stringify({ wipCount, dupBoundary }))
    const final = decorate(wt, { env: env5 })
    check('S5: the decoration map converged on all three files (new files decorate as A)',
      final.ok && ['notes/a.md', 'notes/b.md', 'notes/c.md'].every((f) => final.files[f] === 'A'),
      JSON.stringify(final.files))
    check('S5: every concurrent read saw a parseable, complete index and decoration map',
      pollStats.reads >= 60 && pollStats.indexFails === 0 && pollStats.badMaps === 0 && pollStats.failureCount === 0,
      JSON.stringify(pollStats))
  }
}

console.log(failures === 0 ? '\ncicd stress: ALL GREEN' : `\ncicd stress: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
