#!/usr/bin/env node
/**
 * arxa-sidebar action-table selftest — D116 phase 4 additions
 * (docs/plans/git-card-phase-4-card-rebuild.md §3 A1/A3). Real Phase A
 * lifecycle, fake webServer + fake github (same harness as smoke.mjs),
 * fully sandboxed (temp ARXA_HOME + workspace). Covers the eight things
 * added to the action dispatch table in lib/index.js:
 *   card.pr.merge (refuse non-green / merge on green), version.mint,
 *   card.runner.wake (unlinked / linked), workspace.new-session D111 gate
 *   (red / asleep / pending / unlinked), insight.streak / insight.ci
 *   (unavailable + real shape), insight.sessions.
 * Exit 0 = every assertion held.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const sandbox = mkdtempSync(path.join(tmpdir(), 'arxa-sidebar-actions-'))
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
const host = await import(path.join(here, 'lib', 'index.js'))
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

const call = (p, { method = 'GET', body, url = p } = {}) => new Promise((res) => {
  const req = { url, method, _h: {}, on(ev, fn) { this._h[ev] = fn } }
  routes[p](req, { writeHead() {}, end: (s) => res(JSON.parse(s)) })
  queueMicrotask(() => {
    if (body && req._h.data) req._h.data(JSON.stringify(body))
    if (req._h.end) req._h.end()
  })
})
const act = (action, arg) => call('/__arxa/sidebar/action', { method: 'POST', body: { action, arg } })

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
// D. workspace.new-session D111 gate — red / asleep / pending / unlinked
// ============================================================
{
  // D1: unlinked (no repoOwner at all) — proceeds, notice null.
  const org = await makeOrg('Gate Unlinked Co')
  const r = await act('workspace.new-session', { orgId: org.id, workspace: 'notes' })
  check('D111: unlinked repo proceeds with notice null',
    r.ok === true && r.result.notice === null, JSON.stringify(r))
}
{
  // D2: red main — throws 'main-red', session never created.
  const org = await makeOrg('Gate Red Co')
  await patchManifest(org.path, { repoOwner: 'acme', repoName: 'widgets', localOnly: false })
  fakeGh.prChecks = async () => ({ state: 'red', asleep: false, runs: [] })
  const r = await act('workspace.new-session', { orgId: org.id, workspace: 'notes' })
  check('D111: red main throws main-red', r.ok === false && r.error === 'main-red', JSON.stringify(r))
}
{
  // D3: asleep runner (pending + asleep) — proceeds, notice runner-asleep.
  const org = await makeOrg('Gate Asleep Co')
  await patchManifest(org.path, { repoOwner: 'acme', repoName: 'widgets', localOnly: false })
  fakeGh.prChecks = async () => ({ state: 'pending', asleep: true, runs: [{ status: 'queued', asleep: true }] })
  const r = await act('workspace.new-session', { orgId: org.id, workspace: 'notes' })
  check('D111: asleep runner proceeds with notice runner-asleep',
    r.ok === true && r.result.notice === 'runner-asleep', JSON.stringify(r))
}
{
  // D4: plain pending (not asleep) — proceeds, notice checks-pending.
  const org = await makeOrg('Gate Pending Co')
  await patchManifest(org.path, { repoOwner: 'acme', repoName: 'widgets', localOnly: false })
  fakeGh.prChecks = async () => ({ state: 'pending', asleep: false, runs: [{ status: 'in_progress', asleep: false }] })
  const r = await act('workspace.new-session', { orgId: org.id, workspace: 'notes' })
  check('D111: pending (not asleep) proceeds with notice checks-pending',
    r.ok === true && r.result.notice === 'checks-pending', JSON.stringify(r))
}
{
  // D5: project-routed workspace — the gate must check the PROJECT's own
  // repo/manifest, not the org's. Org repo is green; project repo is red.
  // A session on 'notes' (org route) must sail through while a session on
  // the project's own container must throw main-red — proving the checks
  // call actually targeted the project repo, not the org's.
  const org = await makeOrg('Gate Project Co')
  await patchManifest(org.path, { repoOwner: 'acme', repoName: 'org-repo', localOnly: false })
  const proj = await makeProject(org, 'rocket')
  await patchProjectManifest(proj.path, { repoOwner: 'acme', repoName: 'project-repo', localOnly: false })
  fakeGh.prChecks = async (owner, name) =>
    name === 'project-repo' ? { state: 'red', asleep: false, runs: [] } : { state: 'green', asleep: false, runs: [] }

  const orgSession = await act('workspace.new-session', { orgId: org.id, workspace: 'notes' })
  check('D111 (project-routed): org-repo session unaffected by the project repo being red',
    orgSession.ok === true && orgSession.result.notice === null, JSON.stringify(orgSession))

  const projSession = await act('workspace.new-session', { orgId: org.id, workspace: 'projects/rocket/02-design' })
  check('D111 (project-routed): project-repo session gated on the PROJECT manifest, not the org\'s',
    projSession.ok === false && projSession.error === 'main-red', JSON.stringify(projSession))
}
{
  // D6: project repo unlinked (no repoOwner on project.json) while the ORG
  // itself is linked and green — must proceed with notice null, not fall
  // back to reading the org's linked/green state for a project session.
  const org = await makeOrg('Gate Project Unlinked Co')
  await patchManifest(org.path, { repoOwner: 'acme', repoName: 'org-repo', localOnly: false })
  await makeProject(org, 'rocket')
  fakeGh.prChecks = async () => ({ state: 'red', asleep: false, runs: [] }) // org would be red if (wrongly) consulted
  const r = await act('workspace.new-session', { orgId: org.id, workspace: 'projects/rocket/02-design' })
  check('D111 (project-routed): unlinked project proceeds with notice null (does not fall back to org)',
    r.ok === true && r.result.notice === null, JSON.stringify(r))
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

console.log(failures === 0 ? '\narxa-sidebar selftest.actions: ALL GREEN' : `\narxa-sidebar selftest.actions: ${failures} FAILURE(S)`)
rmSync(sandbox, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
