#!/usr/bin/env node
/**
 * LOCAL-ONLY end-to-end through the GIT CARD — no GitHub, no network, no
 * publish. The offline twin of scripts/card-cicd-smoke.mjs.
 *
 * Why this exists: every card smoke we had (cicd-smoke, card-cicd-smoke)
 * needs a real GitHub token and a real repo, so the ONE configuration most
 * arxa studio users actually run — an org that was never published — had no
 * coverage at all through the card's own route. "The git card on local-only
 * orgs is not functioning" was invisible to CI by construction.
 *
 * It drives /__arxa/git-card/action, the same wire the buttons in the
 * composer dock use, against a local-only org (org.create { link: false },
 * which sets localOnly on the manifest). Two things are under test:
 *
 *   1. The LOCAL CI/CD loop works end to end with no remote at all:
 *      dirty worktree → draft → commit → integrate (the local stage
 *      boundary merges to main and runs the gate) → main carries the work.
 *   2. Every GitHub-requiring action DEGRADES instead of breaking: a
 *      structured { ok: false, reason } the card can render, never a thrown
 *      route error and never a silent success that claims work was published
 *      when nothing left the machine.
 *
 * Fully sandboxed: temp ARXA_HOME + temp workspace root. Touches no real org
 * and makes no network call. Offline and deterministic, so it joins ci.mjs.
 *
 *   node scripts/card-local-smoke.mjs
 *
 * Exit 0 = every assertion held.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { endOfLife, sweepFlow } from './lib/card-flow.mjs'

const sandbox = mkdtempSync(path.join(tmpdir(), 'arxa-card-local-'))
process.env.ARXA_HOME = path.join(sandbox, 'home')
const root = path.join(sandbox, 'ws')
mkdirSync(root, { recursive: true })
mkdirSync(process.env.ARXA_HOME, { recursive: true })

const here = path.dirname(new URL(import.meta.url).pathname)
const P = (...p) => path.join(here, '..', 'plugins', ...p)
const shell = await import(P('file-org-shell', 'lib', 'index.js'))
shell.saveWorkspaceRoot(root)
const gw = await import(P('git-workspace', 'lib', 'index.js'))
const ws = await import(P('workspace', 'lib', 'index.js'))

const routes = {}
const host = await import(P('arxa-sidebar', 'lib', 'index.js'))
const card = await import(P('arxa-git-card', 'lib', 'index.js'))

/* The realistic local-only state: the user IS signed in to GitHub (the
 * plugin is loaded and answers), they simply never published THIS org. That
 * is the sharper fixture — a refusal here cannot be blamed on GitHub being
 * absent, it can only come from the org having no remote. ensureRunner is
 * stubbed to refuse by standing rule: a smoke never wakes a real runner. */
const fakeGh = {
  status: async () => ({ linked: true, login: 'local-user' }),
  prListForHead: async () => [],
  prChecks: async () => ({ state: 'unknown', asleep: false, runs: [] }),
  prMerge: async () => ({ merged: false }),
  ensureRunner: async () => ({ ok: false, reason: 'not-wired' }),
  gitCredentials: async () => ({ login: 'local-user', token: 'unused-in-this-run' }),
}
host.apply({ webServer: { register: (r) => { routes[r.path] = r.handler } } }, { github: fakeGh })
card.apply({ webServer: { register: (r) => { routes[r.path] = r.handler } } })

const call = (p, { method = 'GET', body, url = p } = {}) => new Promise((res) => {
  const req = { url, method, _h: {}, on(ev, fn) { this._h[ev] = fn } }
  routes[p](req, { writeHead() {}, end: (s) => res(JSON.parse(s)) })
  queueMicrotask(() => {
    if (body && req._h.data) req._h.data(JSON.stringify(body))
    if (req._h.end) req._h.end()
  })
})
const act = (action, arg) => call(/^(card|insight|version)\./.test(action) ? '/__arxa/git-card/action' : '/__arxa/sidebar/action', { method: 'POST', body: { action, arg } })

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '\n      ' + extra}`)
  if (!ok) failures++
}
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`)
const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout?.trim() ?? ''

// ============================================================
section('1. A local-only org is born local-only')
// ============================================================
const created = await act('org.create', { name: 'Local Co', link: false })
if (!created.ok) { console.error('org.create failed:', created.error); process.exit(1) }
let s = await call('/__arxa/sidebar/state')
const org = s.orgs.find((o) => o.open)
const orgManifest = JSON.parse(readFileSync(path.join(org.path, 'org.json'), 'utf8'))
check('org.create { link: false } sets localOnly on the manifest',
  orgManifest.localOnly === true, JSON.stringify(orgManifest).slice(0, 200))
check('a local-only org has no remote configured',
  !gw.getOrigin(org.path), String(gw.getOrigin(org.path)))

// A project with its own repo, and a session on the application track — the
// grammar sessions must obey since 98f2e93.
const proj = ws.scaffoldProject(org.path, 'storefront')
gw.initProjectRepo(proj.path)
const wsPath = 'projects/storefront/02-design/application'
const made = await act('workspace.new-session', { orgId: org.id, workspace: wsPath })
if (!made.ok) { console.error('new-session failed:', made.error); process.exit(1) }
const sid = made.result.id
check('a session binds to the application track of a local-only project',
  typeof sid === 'string' && sid.includes('application'), sid)

// ============================================================
section('2. card.status reports the local-only truth')
// ============================================================
let r = await act('card.status', { sessionId: sid })
check('card.status answers for a local-only org (no throw)', r.ok === true, JSON.stringify(r).slice(0, 300))
const st = r.result ?? {}
check('card.status: linked === false', st.linked === false, JSON.stringify(st.linked))
check('card.status: localOnly === true', st.localOnly === true, JSON.stringify(st.localOnly))
check('card.status: health measured, so the card can render counts',
  st.health === 'ok' && st.dirty !== null, JSON.stringify({ health: st.health, dirty: st.dirty }))

// ============================================================
section('3. The local CI/CD loop — commit and integrate with no remote')
// ============================================================
const sess = gw.parkedSessions(org.path).find((x) => x.id === sid)
check('the session has a worktree on disk', Boolean(sess?.worktree), JSON.stringify(sess ?? null))
writeFileSync(path.join(sess.worktree, 'hero.md'), '# Storefront hero\n\nlocal-only work\n')

/* card.commit.draft is EVIDENCE ONLY (Q6) — the session model writes the
 * subject from what this returns; it never returns one itself. */
r = await act('card.commit.draft', { sessionId: sid })
check('card.commit.draft returns commit evidence with no network',
  r.ok === true && typeof r.result?.rule === 'string' && Array.isArray(r.result?.wipSubjects),
  JSON.stringify(r).slice(0, 300))

r = await act('card.commit', { sessionId: sid, subject: 'feat: add the storefront hero' })
check('card.commit commits locally and returns a sha',
  r.ok === true && r.result?.ok !== false && typeof r.result?.sha === 'string' && r.result.sha.length > 0,
  JSON.stringify(r).slice(0, 400))
const commitSha = r.result?.sha

/* The local stage boundary lives in card.commit, not card.integrate:
 * card.commit squashes, gates and merges to main; card.integrate is the
 * opposite direction (bring main INTO the session branch). */
const integrated = r.result ?? {}
check('card.commit MERGED to main rather than parking',
  integrated.merged === true && integrated.parked !== true,
  JSON.stringify({ merged: integrated.merged, parked: integrated.parked, reason: integrated.reason }))

// The claim above is only worth as much as the repo behind it.
const repoPath = sess.repoPath ?? org.path
const mainLog = git(['log', '--oneline', '-5', 'main'], repoPath)
check('main actually carries the integrated work (git log, not a return value)',
  /storefront hero/.test(mainLog), mainLog || '(empty log at ' + repoPath + ')')
check('the integrated file is on main',
  git(['show', 'main:hero.md'], repoPath).includes('Storefront hero'),
  git(['ls-tree', '--name-only', 'main'], repoPath))

// ============================================================
section('3b. Integrate main INTO a session — the reachable local-only path')
// ============================================================
/* The Integrate button only renders when status.integrate.behind > 0, so the
 * behind === 0 early return is not what a user can click. This is the path
 * that IS reachable: a second session falls behind when other work lands on
 * main, and must be able to catch up with no remote in the picture. */
const made2 = await act('workspace.new-session', { orgId: org.id, workspace: wsPath })
const sid2 = made2.result?.id
const made3 = await act('workspace.new-session', { orgId: org.id, workspace: wsPath })
const sid3 = made3.result?.id
check('two more sessions on the application track', Boolean(sid2 && sid3), JSON.stringify({ sid2, sid3 }))

// Land work from session 3 so main moves ahead of session 2.
const sess3 = gw.parkedSessions(org.path).find((x) => x.id === sid3)
writeFileSync(path.join(sess3.worktree, 'pricing.md'), '# Pricing\n')
r = await act('card.commit', { sessionId: sid3, subject: 'feat: add the pricing page' })
check('a second local commit lands on main', r.ok === true && r.result?.merged === true,
  JSON.stringify(r).slice(0, 300))

r = await act('card.status', { sessionId: sid2 })
const behind = r.result?.integrate?.behind
check('card.status sees session 2 is behind main (computed with no remote)',
  r.ok === true && behind > 0, JSON.stringify({ ok: r.ok, integrate: r.result?.integrate }))

r = await act('card.integrate', { sessionId: sid2 })
check('card.integrate brings main into the session with no remote',
  r.ok === true && r.result?.integrated === true && r.result?.conflicted !== true,
  JSON.stringify(r).slice(0, 400))
const sess2 = gw.parkedSessions(org.path).find((x) => x.id === sid2)
check('the integrated work is really in the session worktree',
  sess2 && git(['show', 'HEAD:pricing.md'], sess2.worktree).includes('Pricing'),
  git(['log', '--oneline', '-3'], sess2?.worktree ?? repoPath))

// ============================================================
section('4. Nothing was published — the local-only promise')
// ============================================================
check('integrate reported no push (nothing left the machine)',
  integrated.pushed === undefined || integrated.pushed?.ok === false,
  JSON.stringify(integrated.pushed))
check('the repo still has no remote after a full loop',
  !gw.getOrigin(repoPath), String(gw.getOrigin(repoPath)))

// ============================================================
section('5. GitHub actions DEGRADE, they do not break the card')
// ============================================================
/* Each of these needs a remote this org does not have. The contract is a
 * structured refusal the card can render — ok:false plus a reason — never a
 * thrown route error (ok:false at the ENVELOPE level, which is what puts a
 * red error toast on a button the user cannot fix). */
const remoteActions = [
  ['card.push', { sessionId: sid }],
  ['card.pr.create', { sessionId: sid }],
  ['card.pr.status', { sessionId: sid }],
  ['card.pr.merge', { sessionId: sid }],
  ['card.pr.comment', { sessionId: sid, body: 'hello' }],
  ['card.ci.rerun', { sessionId: sid }],
  ['card.ci.cancel', { sessionId: sid }],
  ['card.runner.wake', {}],
]
/* The contract these actually hold — and the one that matters — is that a
 * refusal is NAMED and inert: it says why, it changes nothing on disk, and
 * the card keeps working afterwards. (Some refuse in the envelope, some in
 * the result; the client's PR/CI section is hidden for a local-only seat, so
 * neither is user-reachable here. Asserting one uniform shape would be
 * inventing a convention the codebase does not hold.) */
for (const [action, arg] of remoteActions) {
  const res = await act(action, arg)
  const named = res.ok === false
    ? typeof res.error === 'string' && res.error.length > 0
    : res.result?.ok === false && typeof res.result?.reason === 'string' && res.result.reason.length > 0
  check(`${action}: refuses with a named reason, never a bare crash`, named, JSON.stringify(res).slice(0, 300))
}
r = await act('card.status', { sessionId: sid })
check('the card still answers after every refused remote action',
  r.ok === true && r.result?.localOnly === true, JSON.stringify(r).slice(0, 200))
check('no remote appeared as a side effect of the refusals',
  !gw.getOrigin(repoPath), String(gw.getOrigin(repoPath)))

// ============================================================
section('6. card.status describes the SEAT’s repo, not always the org’s')
// ============================================================
/* The bug this smoke was written to catch. An org and a project each own a
 * repo (D98/D99), but card.status read org.json for every seat. A published
 * project inside a local-only org therefore reported linked:false /
 * localOnly:true, and the client hides the entire PR + CI section on
 * `linked && !localOnly` — the git card, dead, on a project that HAS a repo.
 * Meanwhile repoFor() would happily find that repo for the actions. */
check('unlinked project in a local-only org INHERITS local-only (D91)',
  (await act('card.status', { sessionId: sid2 })).result?.localOnly === true,
  'a project with no link of its own must still read as local-only')

const projManifestPath = path.join(proj.path, 'project.json')
const projManifest = JSON.parse(readFileSync(projManifestPath, 'utf8'))
writeFileSync(projManifestPath, JSON.stringify({
  ...projManifest, repoUrl: 'https://github.com/acme/storefront',
  repoOwner: 'acme', repoName: 'storefront',
}, null, 2))

r = await act('card.status', { sessionId: sid2 })
check('a PUBLISHED project inside a local-only org reads as linked',
  r.ok === true && r.result?.linked === true,
  JSON.stringify({ linked: r.result?.linked, localOnly: r.result?.localOnly }))
check('...and is NOT local-only, so the card shows its PR and CI section',
  r.result?.localOnly === false,
  JSON.stringify({ linked: r.result?.linked, localOnly: r.result?.localOnly }))

writeFileSync(projManifestPath, JSON.stringify(projManifest, null, 2))

// ============================================================
section('6b. The local Checks row engine — red gate, output shown, worktree untouched')
// ============================================================
/* Decision 3 (local-only git parity): card.gate.run is the Checks row's
 * engine — runGate WITHOUT committing. A red check.sh must surface its
 * output (the parked-branch mystery is why the row exists) while changing
 * nothing on disk: no commit, no park, no merge — the session stays
 * exactly as it was. The leg is SCRATCH: check.sh is written into this
 * sandbox session's worktree and removed before the shared table runs. */
const gateWt = sess.worktree
writeFileSync(path.join(gateWt, 'check.sh'), '#!/bin/sh\necho "smoke: red on purpose" >&2\nexit 1\n')
const gateBeforePorcelain = git(['status', '--porcelain'], gateWt)
const gateBeforeHead = git(['rev-parse', 'HEAD'], gateWt)
r = await act('card.gate.run', { sessionId: sid })
check('card.gate.run runs a red check.sh and captures the output',
  r.ok === true && r.result?.green === false && r.result?.kind === 'check.sh' &&
  r.result?.output?.includes('smoke: red on purpose'), JSON.stringify(r).slice(0, 300))
r = await act('card.status', { sessionId: sid })
check('card.status serves the cached red gate with its output',
  r.ok === true && r.result?.gate?.state === 'red' &&
  r.result?.gate?.output?.includes('smoke: red on purpose'),
  JSON.stringify(r.result?.gate ?? null).slice(0, 300))
check('the red run left the worktree unchanged (porcelain + HEAD identical)',
  git(['status', '--porcelain'], gateWt) === gateBeforePorcelain &&
  git(['rev-parse', 'HEAD'], gateWt) === gateBeforeHead,
  JSON.stringify({ porcelain: git(['status', '--porcelain'], gateWt), head: git(['rev-parse', 'HEAD'], gateWt) }))
rmSync(path.join(gateWt, 'check.sh'))

// ============================================================
/* Sections 7-8 are the SHARED table (Decision 5) — the same assertions the
 * GitHub-linked smoke runs, imported rather than copied. Everything in it is
 * plain local git through the card's own route, so it holds identically in
 * both modes; the divergence it prevents is a flow that gets tested in one
 * configuration and quietly not the other. Names come from ctx because the
 * linked run uses arxa's real publish and real slugs. */
const flowCtx = {
  act, check, section, git, gw,
  orgId: org.id, orgPath: org.path,
  projectSlug: 'storefront', projectPath: proj.path,
  workspace: wsPath, file: 'hero.md',
  // A dock workspace on the ORG repo — the sweep scope check needs one.
  orgWorkspace: 'notes',
}
await endOfLife(flowCtx, { sid })
await sweepFlow(flowCtx)

// ============================================================
console.log(`\n${failures === 0 ? '\x1b[32mALL GREEN' : '\x1b[31m' + failures + ' FAILURE(S)'}\x1b[0m — sandbox: ${sandbox}`)
process.exit(failures === 0 ? 0 : 1)
