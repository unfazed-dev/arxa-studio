#!/usr/bin/env node
/**
 * arxa-freestyle action selftest (Task 6, docs/plans/freestyle-section.md).
 * Fake webServer (same fake-req/fake-res harness as arxa-git-card's own
 * selftest.actions.mjs), real roots/files/sessions libraries underneath,
 * sandboxed ARXA_HOME + a scratch root folder. The dsh bridge is stubbed —
 * this plugin's own default (`opts.dshBridge` unset) reports
 * `dsh-unavailable`, which is exercised separately; here we stub a bridge
 * that reports `ok: true` so session.new's happy path is covered too.
 * Exit 0 = every assertion held.
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const sandbox = mkdtempSync(path.join(tmpdir(), 'arxa-freestyle-actions-'))
process.env.ARXA_HOME = path.join(sandbox, 'home')
const folder = path.join(sandbox, 'my-notes')
mkdirSync(folder, { recursive: true })
mkdirSync(process.env.ARXA_HOME, { recursive: true })

const here = path.dirname(new URL(import.meta.url).pathname)
const routes = {}
const freestyle = await import(path.join(here, 'lib', 'index.js'))
const dshBridge = { spawn: async ({ id }) => ({ ok: true, id: 'stub-' + id }) }
freestyle.apply({ webServer: { register: (r) => { routes[r.path] = r.handler } } }, { dshBridge })

const call = (p, { method = 'GET', body, url = p } = {}) => new Promise((res) => {
  const req = { url, method, _h: {}, on(ev, fn) { this._h[ev] = fn } }
  routes[p](req, { writeHead() {}, end: (s) => res(JSON.parse(s)) })
  queueMicrotask(() => {
    if (body && req._h.data) req._h.data(JSON.stringify(body))
    if (req._h.end) req._h.end()
  })
})
const state = () => call('/__arxa/freestyle/state')
const act = (action, arg) => call('/__arxa/freestyle/action', { method: 'POST', body: { action, arg } })

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}

// 0. Routes present, state before any root.
{
  check('state route registered', typeof routes['/__arxa/freestyle/state'] === 'function')
  check('action route registered', typeof routes['/__arxa/freestyle/action'] === 'function')
  const s = await state()
  check('state before any root: empty roots/trash, org tab',
    Array.isArray(s.roots) && s.roots.length === 0 && Array.isArray(s.trash) && s.trash.length === 0 && s.ui?.activeTab === 'org',
    JSON.stringify(s))
}

// 1. root.add
let rootId
{
  const r = await act('root.add', { path: folder })
  check('root.add: ok with a root row', r.ok === true && !!r.root?.id, JSON.stringify(r))
  rootId = r.root?.id
  const s = await state()
  const row = s.roots[0]
  check('state after root.add: one root, isRepo/hasHead true',
    s.roots.length === 1 && row?.isRepo === true && row?.hasHead === true, JSON.stringify(row))
}

// 2. file.create / entry.trash / trash.restore
let entryId
{
  let r = await act('file.create', { rootId, relPath: 'a.md' })
  check('file.create: ok', r.ok === true, JSON.stringify(r))
  r = await act('entry.trash', { rootId, relPath: 'a.md' })
  check('entry.trash: ok', r.ok === true && !!r.entry?.id, JSON.stringify(r))
  entryId = r.entry?.id
  const s = await state()
  check('state after entry.trash: one trash row', s.trash.length === 1, JSON.stringify(s.trash))
  r = await act('trash.restore', { rootId, entryId })
  check('trash.restore: ok', r.ok === true, JSON.stringify(r))
}

// 3. ui.tab — valid and invalid
{
  let r = await act('ui.tab', { tab: 'freestyle' })
  check('ui.tab freestyle: ok', r.ok === true, JSON.stringify(r))
  const s = await state()
  check('state.ui.activeTab reflects ui.tab', s.ui?.activeTab === 'freestyle', JSON.stringify(s.ui))
  r = await act('ui.tab', { tab: 'nope' })
  check('ui.tab bad value: ok:false /bad-tab/', r.ok === false && /bad-tab/.test(r.error), JSON.stringify(r))
}

// 4. Fail closed — unknown action, unknown root.
{
  let r = await act('nope.verb', {})
  check('unknown action: ok:false /unknown action/', r.ok === false && /unknown action/.test(r.error), JSON.stringify(r))
  r = await act('entry.trash', { rootId: 'x', relPath: 'a.md' })
  check('unknown root: ok:false /unknown-root/', r.ok === false && /unknown-root/.test(r.error), JSON.stringify(r))
}

// 5. session.new with the stubbed dsh bridge.
{
  const r = await act('session.new', { rootId, relDir: '', name: 'test session' })
  check('session.new: ok', r.ok === true, JSON.stringify(r))
  const s = await state()
  check('state.roots[0].sessions.active has the new session',
    s.roots[0].sessions?.active?.length === 1, JSON.stringify(s.roots[0].sessions))
}

console.log(failures === 0 ? '\narxa-freestyle selftest.actions: ALL GREEN' : `\narxa-freestyle selftest.actions: ${failures} FAILURE(S)`)
rmSync(sandbox, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
