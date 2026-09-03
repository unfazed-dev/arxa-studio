#!/usr/bin/env node
/**
 * CI/CD stress harness — three scenarios, three DIFFERENT failure modes.
 *
 * Not three variations of one test: each scenario attacks a different way the
 * session/CI-CD machinery breaks, chosen from the root-cause work recorded in
 * docs/plans/session-id-collision-and-cicd-stress.md.
 *
 *   S1 identity pressure    — can two orgs end up minting the same session id?
 *   S2 concurrency          — do simultaneous creates collide on one counter?
 *   S3 partial failure      — push lands, PR open fails: what does the user get?
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
  const fakeGh = {
    status: async () => ({ ok: true, linked: true, login: 'tester' }),
    // The push embeds credentials into the origin URL. The origin here is a
    // local bare repo, so urlFor() leaves it untouched and the push is real.
    gitCredentials: async () => ({ login: 'tester', token: 'x' }),
    prUpdate: async () => ({}),
    prComment: async () => ({}),
    prListForHead: async () => [],
    prChecks: async () => ({ state: 'unknown', asleep: false, runs: [] }),
    prCreate: async () => {
      calls.prCreate++
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
}

console.log(failures === 0 ? '\ncicd stress: ALL GREEN' : `\ncicd stress: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
