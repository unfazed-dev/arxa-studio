#!/usr/bin/env node
/**
 * arxa-sidebar action-table selftest — the D111 new-session gate. Real
 * Phase A lifecycle, fake webServer + fake github (same harness as
 * smoke.mjs), fully sandboxed (temp ARXA_HOME + workspace). Covers
 * workspace.new-session's main-checks gate (red / asleep / pending /
 * unlinked). The card.* / version.mint / insight.* cases moved with their
 * actions to plugins/arxa-git-card/selftest.actions.mjs on 2026-09-02
 * (docs/plans/git-card-stock-dock-rebuild.md A2).
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
console.log(failures === 0 ? '\narxa-sidebar selftest.actions: ALL GREEN' : `\narxa-sidebar selftest.actions: ${failures} FAILURE(S)`)
rmSync(sandbox, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
