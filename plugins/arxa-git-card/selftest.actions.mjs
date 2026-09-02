#!/usr/bin/env node
/**
 * arxa-git-card action selftest (docs/plans/git-card-stock-dock-rebuild.md
 * A2; cases from the D116 phase-4 suite, moved with their actions out of
 * arxa-sidebar on 2026-09-02). Real Phase A lifecycle, fake webServer +
 * fake github (same harness as the sidebar's smoke.mjs), fully sandboxed
 * (temp ARXA_HOME + workspace). Applies BOTH host halves on one fake
 * webServer — the sidebar publishes the org shell, this plugin's route
 * runs over it — and covers: the route itself, card.pr.merge (refuse
 * non-green / merge on green), version.mint, card.runner.wake (unlinked /
 * linked), insight.streak / insight.ci (unavailable + real shape),
 * insight.sessions.
 * Exit 0 = every assertion held.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const sandbox = mkdtempSync(path.join(tmpdir(), 'arxa-git-card-actions-'))
process.env.ARXA_HOME = path.join(sandbox, 'home')
const root = path.join(sandbox, 'ws')
mkdirSync(root, { recursive: true })
mkdirSync(process.env.ARXA_HOME, { recursive: true })

const here = path.dirname(new URL(import.meta.url).pathname)
const shell = await import(path.join(here, '..', 'file-org-shell', 'lib', 'index.js'))
shell.saveWorkspaceRoot(root)
const gw = await import(path.join(here, '..', 'git-workspace', 'lib', 'index.js'))
const ws = await import(path.join(here, '..', 'workspace', 'lib', 'index.js'))

const routes = {}
const host = await import(path.join(here, '..', 'arxa-sidebar', 'lib', 'index.js'))
const card = await import(path.join(here, 'lib', 'index.js'))
// Mutable fake github: swapped per-scenario. Every org below is created
// with `link: false` (skips the D69 gate entirely), so `status`/`link` are
// never exercised here — smoke.mjs already covers that gate.
const fakeGh = {
  prListForHead: async () => [],
  prChecks: async () => ({ state: 'unknown', asleep: false, runs: [] }),
  prMerge: async () => ({ merged: false }),
  ensureRunner: async () => ({ ok: false, reason: 'not-wired' }),
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
/** card.* / insight.* / version.* → the git-card route; org/session setup → the sidebar route. */
const act = (action, arg) => call(/^(card|insight|version)\./.test(action) ? '/__arxa/git-card/action' : '/__arxa/sidebar/action', { method: 'POST', body: { action, arg } })

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}

/** Fresh org (unlinked at birth — no repoOwner/repoName), auto-open. */
async function makeOrg(name) {
  const r = await act('org.create', { name, link: false })
  if (!r.ok) throw new Error('org.create failed: ' + r.error)
  // The just-created org is the open handle — read its path off state.
  const s = await call('/__arxa/sidebar/state')
  const org = s.orgs.find((o) => o.open)
  return { id: org.id, path: org.path }
}

/** Directly patch org.json the way the action table itself reads it — the
  * only way to simulate a "published/linked" repo without a real GitHub
  * round trip. */
async function patchManifest(orgPath, patch) {
  const fs = await import('node:fs')
  const p = path.join(orgPath, 'org.json')
  const cur = JSON.parse(fs.readFileSync(p, 'utf8'))
  fs.writeFileSync(p, JSON.stringify({ ...cur, ...patch }, null, 2))
}

async function makeSession(org, workspace = 'notes') {
  const r = await act('workspace.new-session', { orgId: org.id, workspace })
  if (!r.ok) throw new Error('workspace.new-session failed: ' + r.error)
  return r.result.id
}

/** Scaffold a project WITH its own repo (D98/D99) — the same fixture shape
  * smoke.mjs uses for 'projects/<slug>/<container>' sessions. */
async function makeProject(org, slug) {
  const proj = ws.scaffoldProject(org.path, slug)
  if (!proj?.path) throw new Error('scaffoldProject failed for ' + slug)
  gw.initProjectRepo(proj.path)
  return proj
}

/** Same idea as patchManifest but for a PROJECT's own project.json — a
  * project repo has its own repoOwner/repoName, independent of its org's. */
async function patchProjectManifest(projPath, patch) {
  const fs = await import('node:fs')
  const p = path.join(projPath, 'project.json')
  const cur = JSON.parse(fs.readFileSync(p, 'utf8'))
  fs.writeFileSync(p, JSON.stringify({ ...cur, ...patch }, null, 2))
}

// ============================================================

// 0. Route present + reaches the sidebar's org shell (plan §6: the one test
//    that fails if the route or the published host object is missing).
{
  check('git-card: route /__arxa/git-card/action registered', typeof routes['/__arxa/git-card/action'] === 'function')
  const r = await act('card.nope', {})
  check('git-card: unknown action is loud through the shared org shell', r.ok === false && r.error === 'unknown-action', JSON.stringify(r))
}

// A. card.pr.merge — refuse on non-green, merge on green
// ============================================================
{
  const org = await makeOrg('PR Co')
  const sid = await makeSession(org)
  await patchManifest(org.path, { repoOwner: 'acme', repoName: 'widgets', localOnly: false })

  fakeGh.prListForHead = async () => [{ number: 7, title: 'feat: land the thing', head: { sha: 'deadbeef' }, html_url: 'https://x/7' }]
  fakeGh.prChecks = async () => ({ state: 'pending', asleep: false, runs: [] })
  let r = await act('card.pr.merge', { sessionId: sid })
  check('card.pr.merge refuses on non-green checks (reason string)',
    r.ok === true && r.result.ok === false && r.result.reason === 'checks-pending', JSON.stringify(r))

  fakeGh.prChecks = async () => ({ state: 'green', asleep: false, runs: [] })
  fakeGh.prMerge = async (owner, name, { number, sha, subject }) =>
    ({ merged: true, sha: 'merged-sha-123', number, owner, name, subject })
  r = await act('card.pr.merge', { sessionId: sid })
  check('card.pr.merge merges on green (merged true, mergeSha, reconcile present)',
    r.ok === true && r.result.ok === true && r.result.merged === true &&
    r.result.mergeSha === 'merged-sha-123' && r.result.reconcile && typeof r.result.reconcile === 'object',
    JSON.stringify(r))
}

// ============================================================
// B. version.mint — returns a chip
// ============================================================
{
  const org = await makeOrg('Version Co')
  const sid = await makeSession(org)
  const s = gw.parkedSessions(org.path).find((x) => x.id === sid)
  writeFileSync(path.join(s.worktree, 'notes.txt'), 'first draft\n')

  const r = await act('version.mint', { sessionId: sid, name: 'Widgets', state: 'Draft' })
  check('version.mint squashes the dirty worktree and returns a chip',
    r.ok === true && r.result.ok === true && r.result.squashed === true &&
    typeof r.result.sha === 'string' && r.result.chip && r.result.chip.name === 'Widgets' && r.result.chip.state === 'Draft',
    JSON.stringify(r))
}

// ============================================================
// C. card.runner.wake — unlinked path, then linked path with a fake api
// ============================================================
{
  const org = await makeOrg('Runner Co')
  let r = await act('card.runner.wake', {})
  check('card.runner.wake: unlinked repo refuses loud (no throw)',
    r.ok === true && r.result.ok === false && r.result.reason === 'unlinked', JSON.stringify(r))

  await patchManifest(org.path, { repoOwner: 'acme', repoName: 'widgets', localOnly: false })
  fakeGh.ensureRunner = async (owner, name) => ({ ok: true, woke: true, owner, name })
  r = await act('card.runner.wake', {})
  check('card.runner.wake: linked repo returns the api result verbatim',
    r.ok === true && r.result.ok === true && r.result.woke === true &&
    r.result.owner === 'acme' && r.result.name === 'widgets', JSON.stringify(r))
}

// ============================================================
// E. insight.streak / insight.ci / insight.sessions
// ============================================================
{
  const org = await makeOrg('Insight Co')
  const sid = await makeSession(org)

  // insight.streak: shape depends on whether gw.commitDays has landed
  // (another agent's concurrent addition) — check both branches live
  // rather than assuming either state.
  let r = await act('insight.streak', { sessionId: sid })
  if (typeof gw.commitDays === 'function') {
    check('insight.streak: commitDays landed — real shape served',
      r.ok === true && Array.isArray(r.result.days) && typeof r.result.current === 'number' && typeof r.result.longest === 'number',
      JSON.stringify(r))
  } else {
    check('insight.streak: commitDays not yet landed — unavailable shape',
      r.ok === true && r.result.reason === 'unavailable' &&
      Array.isArray(r.result.days) && r.result.days.length === 0 &&
      r.result.current === 0 && r.result.longest === 0,
      JSON.stringify(r))
  }

  // insight.ci: fakeGh has no workflowRuns yet — unavailable shape.
  r = await act('insight.ci', { sessionId: sid })
  check('insight.ci: missing workflowRuns export — unavailable shape',
    r.ok === true && r.result.reason === 'unavailable' && Array.isArray(r.result.runs) && r.result.runs.length === 0,
    JSON.stringify(r))

  // insight.ci: now with a fake workflowRuns + a published manifest — real shape.
  await patchManifest(org.path, { repoOwner: 'acme', repoName: 'widgets', localOnly: false })
  fakeGh.workflowRuns = async ({ owner, name, branch, perPage }) => ([{ id: 1, owner, name, branch, perPage, status: 'completed', conclusion: 'success' }])
  r = await act('insight.ci', { sessionId: sid })
  check('insight.ci: workflowRuns present — real shape served',
    r.ok === true && Array.isArray(r.result) && r.result.length === 1 && r.result[0].owner === 'acme',
    JSON.stringify(r))

  r = await act('insight.sessions', { orgId: org.id })
  check('insight.sessions: rows include the created session',
    r.ok === true && Array.isArray(r.result.rows) && r.result.rows.some((x) => x.id === sid),
    JSON.stringify(r))
}

console.log(failures === 0 ? '\narxa-git-card selftest.actions: ALL GREEN' : `\narxa-git-card selftest.actions: ${failures} FAILURE(S)`)
rmSync(sandbox, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
