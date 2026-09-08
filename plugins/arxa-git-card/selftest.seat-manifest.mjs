#!/usr/bin/env node
/**
 * seatManifest() selftest (freestyle-section Task 7 — docs/plans, D91/D98/D99
 * unchanged). Two halves:
 *
 *  A. Pure unit checks on plugins/git-workspace/lib/manifest-seat.js: the
 *     four candidate files in isolation, freestyle.json's precedence over a
 *     stray project.json in the same directory (a project inside a
 *     Freestyle root is still a Freestyle seat), and the fallbackOrgPath
 *     step.
 *  B. A live card.status check, using the SAME fake-webServer + fake-github
 *     harness as selftest.actions.mjs (real Phase A lifecycle, sandboxed
 *     ARXA_HOME + workspace): an org whose own directory carries
 *     `.arxa/freestyle.json` instead of `org.json` — the shape a Freestyle
 *     root takes once opened as the current handle — reports
 *     linked:false, localOnly:true, kind:'freestyle' from card.status, with
 *     the same seat.branch shape as any other org ('main', no session).
 *
 * Run: node plugins/arxa-git-card/selftest.seat-manifest.mjs
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}

const here = path.dirname(new URL(import.meta.url).pathname)
const { seatManifest } = await import(path.join(here, '..', 'git-workspace', 'lib', 'manifest-seat.js'))

// ============================================================
// A. seatManifest() unit checks
// ============================================================
const tmp = mkdtempSync(path.join(tmpdir(), 'arxa-seat-manifest-'))
const dir = (name) => { const p = path.join(tmp, name); mkdirSync(p, { recursive: true }); return p }

{
  const freestyleDir = dir('freestyle-only')
  mkdirSync(path.join(freestyleDir, '.arxa'), { recursive: true })
  writeFileSync(path.join(freestyleDir, '.arxa', 'freestyle.json'), JSON.stringify({ tag: 'fs' }))
  const r = seatManifest(freestyleDir)
  check('unit: a bare Freestyle root resolves kind freestyle',
    r.kind === 'freestyle' && r.manifest.tag === 'fs' && r.file === path.join(freestyleDir, '.arxa', 'freestyle.json'),
    JSON.stringify(r))
}

{
  const projectDir = dir('project-only')
  writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({ tag: 'proj' }))
  const r = seatManifest(projectDir)
  check('unit: a bare project resolves kind project',
    r.kind === 'project' && r.manifest.tag === 'proj', JSON.stringify(r))
}

{
  const orgDir = dir('org-only')
  writeFileSync(path.join(orgDir, 'org.json'), JSON.stringify({ tag: 'org' }))
  const r = seatManifest(orgDir)
  check('unit: a bare org resolves kind org',
    r.kind === 'org' && r.manifest.tag === 'org', JSON.stringify(r))
}

{
  const emptyDir = dir('nothing')
  const r = seatManifest(emptyDir)
  check('unit: no manifest anywhere resolves null/null/null',
    r.manifest === null && r.kind === null && r.file === null, JSON.stringify(r))
}

{
  // A project inside a Freestyle root is still a Freestyle seat: both files
  // present in the SAME directory, freestyle.json must win.
  const bothDir = dir('freestyle-and-stray-project')
  mkdirSync(path.join(bothDir, '.arxa'), { recursive: true })
  writeFileSync(path.join(bothDir, '.arxa', 'freestyle.json'), JSON.stringify({ tag: 'fs' }))
  writeFileSync(path.join(bothDir, 'project.json'), JSON.stringify({ tag: 'proj' }))
  const r = seatManifest(bothDir)
  check('unit: freestyle.json wins over a stray project.json in the same dir',
    r.kind === 'freestyle' && r.manifest.tag === 'fs', JSON.stringify(r))
}

{
  const seatDir = dir('seat-with-nothing')
  const fallbackDir = dir('fallback-org')
  writeFileSync(path.join(fallbackDir, 'org.json'), JSON.stringify({ tag: 'fallback-org' }))
  const withFallback = seatManifest(seatDir, fallbackDir)
  check('unit: an empty seat falls back to fallbackOrgPath/org.json when given',
    withFallback.kind === 'org' && withFallback.manifest.tag === 'fallback-org', JSON.stringify(withFallback))
  const withoutFallback = seatManifest(seatDir)
  check('unit: the same empty seat with no fallbackOrgPath still resolves null',
    withoutFallback.manifest === null && withoutFallback.kind === null, JSON.stringify(withoutFallback))
}

rmSync(tmp, { recursive: true, force: true })

// ============================================================
// B. card.status recognises a Freestyle root (fake webServer + fake github,
//    same harness as selftest.actions.mjs)
// ============================================================
{
  const sandbox = mkdtempSync(path.join(tmpdir(), 'arxa-git-card-seat-'))
  process.env.ARXA_HOME = path.join(sandbox, 'home')
  const root = path.join(sandbox, 'ws')
  mkdirSync(root, { recursive: true })
  mkdirSync(process.env.ARXA_HOME, { recursive: true })

  const shell = await import(path.join(here, '..', 'file-org-shell', 'lib', 'index.js'))
  shell.saveWorkspaceRoot(root)

  const routes = {}
  const host = await import(path.join(here, '..', 'arxa-sidebar', 'lib', 'index.js'))
  const card = await import(path.join(here, 'lib', 'index.js'))
  const fakeGh = {
    status: async () => ({ login: 'evan-dev' }),
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
  const act = (action, arg) => call(/^(card|insight|version)\./.test(action) ? '/__arxa/git-card/action' : '/__arxa/sidebar/action', { method: 'POST', body: { action, arg } })

  const r = await act('org.create', { name: 'Freestyle Co', link: false })
  if (!r.ok) throw new Error('org.create failed: ' + r.error)
  const s = await call('/__arxa/sidebar/state')
  const org = s.orgs.find((o) => o.open)

  // Simulate the shape a Freestyle root takes once opened as the current
  // handle: its OWN directory carries .arxa/freestyle.json instead of
  // org.json (org.json from org.create is left in place untouched — this
  // is the "stray file at the same path" precedence case again, this time
  // through the live route rather than the unit call above).
  const fs = await import('node:fs')
  mkdirSync(path.join(org.path, '.arxa'), { recursive: true })
  fs.writeFileSync(path.join(org.path, '.arxa', 'freestyle.json'), JSON.stringify({ localOnly: true }))

  const status = await act('card.status', {})
  check('card.status: a Freestyle root reports kind freestyle, unlinked, local-only',
    status.ok === true && status.result.kind === 'freestyle' && status.result.linked === false && status.result.localOnly === true,
    JSON.stringify(status).slice(0, 300))
  check('card.status: seat.branch keeps its ordinary no-session shape (unchanged by this task)',
    status.ok === true && status.result.seat && status.result.seat.kind === 'org' && status.result.seat.branch === 'main' && status.result.seat.sessionId === null,
    JSON.stringify(status.result?.seat))

  rmSync(sandbox, { recursive: true, force: true })
}

console.log(failures === 0 ? '\narxa-git-card selftest.seat-manifest: ALL GREEN' : `\narxa-git-card selftest.seat-manifest: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
