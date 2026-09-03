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

  // Cross-process: N processes each read the SAME registry state and mint.
  // If the mint were the uniqueness mechanism they would differ; they do not,
  // which is the point — uniqueness comes from the org segment, and the
  // counter is only a per-day convenience.
  const script = path.join(tmp('script'), 'mint.mjs')
  fs.writeFileSync(script, `
import path from 'node:path'
const { mintSessionPath, parkedSessions } = await import(${JSON.stringify(P('git-workspace', 'lib', 'sessions.js'))})
const orgPath = process.argv[2]
const sessions = parkedSessions(orgPath, process.env)
process.stdout.write(mintSessionPath({ org: path.basename(orgPath), workspace: 'notes', name: 'note', sessions }))
`)
  const ids = []
  for (let i = 0; i < 6; i++) {
    const r = spawnSync(process.execPath, [script, org.path], { env, encoding: 'utf8' })
    if (r.status === 0) ids.push(r.stdout.trim())
  }
  const distinct = new Set(ids)
  check('6 processes minting against one unwritten registry all reach the same id',
    ids.length === 6 && distinct.size === 1, JSON.stringify(ids))
  // THE VERDICT. Concurrent creates rely on each committing before the next
  // reads. Nothing enforces that, so the counter is not a uniqueness
  // guarantee — it is a readability feature. Recorded, not silently assumed.
  check('VERDICT: the day counter is NOT a uniqueness mechanism (org segment is)',
    [...distinct][0].startsWith(path.basename(org.path) + '/notes/'))
}

// ===========================================================================
// S3 — PARTIAL FAILURE
// The push lands on the remote but opening the PR fails. The branch now exists
// with no PR: the user must be TOLD, not silently left half-done, and a retry
// must open the PR rather than push twice or wedge.
// ===========================================================================
console.log('\n=== S3  partial failure: push lands, PR open fails ===')
{
  const host = await import(P('arxa-git-card', 'lib', 'index.js'))
  const routes = {}
  const calls = { push: 0, prCreate: 0 }
  let prFails = true

  const gw = {
    status: async () => ({ ok: true, branch: 'arxa/session/s1', dirty: false }),
    commit: async () => ({ ok: true }),
    push: async () => { calls.push++; return { ok: true, branch: 'arxa/session/s1' } },
    sessions: () => [{ id: 's1', branch: 'arxa/session/s1', name: 'note' }],
  }
  const github = {
    status: async () => ({ ok: true, linked: true, login: 'tester' }),
    prListForHead: async () => [],
    prCreate: async () => {
      calls.prCreate++
      if (prFails) throw new Error('HTTP 422: no commits between master and arxa/session/s1')
      return { number: 7, url: 'https://github.com/o/r/pull/7' }
    },
  }
  const ctx = { webServer: { register: (r) => { routes[r.path] = r.handler } } }
  host.apply(ctx, { github, gitWorkspace: gw })
  const act = (action, arg) => new Promise((res) => {
    const req = { url: '/__arxa/git-card/action', method: 'POST', _h: {}, on(e, f) { this._h[e] = f } }
    routes['/__arxa/git-card/action'](req, { writeHead() {}, end: (s) => res(JSON.parse(s)) })
    queueMicrotask(() => { req._h.data?.(JSON.stringify({ action, arg })); req._h.end?.() })
  })

  const first = await act('card.push', { sessionId: 's1' })
  const body = first.result ?? first
  check('the push itself is still reported as having SUCCEEDED', body?.ok === true, JSON.stringify(first).slice(0, 200))
  check('the failed PR is surfaced with a reason, never swallowed',
    body?.pr === null && typeof body?.prReason === 'string' && body.prReason !== '',
    JSON.stringify(body).slice(0, 200))
  check('the push was attempted exactly once — no retry storm', calls.push === 1)

  // The retry: the branch is already pushed, so a second attempt must open the
  // PR without a second push being required for correctness.
  prFails = false
  const second = await act('card.push', { sessionId: 's1' })
  const body2 = second.result ?? second
  check('a retry after the outage opens the PR', body2?.pr?.number === 7, JSON.stringify(body2).slice(0, 200))
  check('the PR creation was retried, not skipped as already-done', calls.prCreate === 2)
}

console.log(failures === 0 ? '\ncicd stress: ALL GREEN' : `\ncicd stress: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
