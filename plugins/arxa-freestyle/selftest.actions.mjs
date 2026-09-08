#!/usr/bin/env node
/**
 * arxa-freestyle action selftest (Task 6, docs/plans/freestyle-section.md).
 * Fake webServer (same fake-req/fake-res harness as arxa-git-card's own
 * selftest.actions.mjs), real roots/files/sessions libraries underneath,
 * sandboxed ARXA_HOME + a scratch root folder. The dsh services are small
 * in-memory fakes so apply() must exercise its production bridge wiring;
 * no opts.dshBridge test seam is supplied.
 * Exit 0 = every assertion held.
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const sandbox = mkdtempSync(path.join(tmpdir(), 'arxa-freestyle-actions-'))
process.env.ARXA_HOME = path.join(sandbox, 'home')
const folder = path.join(sandbox, 'my-notes')
mkdirSync(folder, { recursive: true })
const sameNameA = path.join(sandbox, 'left', 'notes')
const sameNameB = path.join(sandbox, 'right', 'notes')
mkdirSync(sameNameA, { recursive: true })
mkdirSync(sameNameB, { recursive: true })
mkdirSync(process.env.ARXA_HOME, { recursive: true })

const here = path.dirname(new URL(import.meta.url).pathname)
const routes = {}
const freestyle = await import(path.join(here, 'lib', 'index.js'))
const live = new Map()
const created = []
const attached = []
const renamed = []
const sessions = {
  get: (id) => live.get(id),
  list: () => [...live.values()],
  create: (id, { meta }) => { const row = { id, header: { id }, meta }; live.set(id, row); return row },
}
const agents = {
  create: async ({ sessionId, meta }) => {
    const row = { id: sessionId, header: { id: sessionId }, meta }
    live.set(sessionId, row)
    created.push({ sessionId, meta })
    return { id: sessionId }
  },
  get: (id) => live.has(id),
}
const workspace = { attachSession: async (id) => { attached.push(id) } }
freestyle.apply({
  webServer: { register: (r) => { routes[r.path] = r.handler } },
  sessions,
  agents,
  sessionTitle: { rename: (row, title) => { renamed.push({ id: row.id, title }) } },
  workspaceRegistry: {
    resolveByPath: async () => workspace,
    createCanonical: async () => workspace,
  },
  get: () => null,
  on: () => {},
})

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

// 5. session.new through the production dsh service bridge.
{
  const r = await act('session.new', { rootId, relDir: '', name: 'test session' })
  check('session.new: ok with a live dsh conversation', r.ok === true && r.dshStatus === 'live' && r.dshLive === true && live.has(r.dshSessionId), JSON.stringify(r))
  check('session.new: uses the agent factory with the session cwd',
    created.length === 1 && created[0].sessionId === r.dshSessionId && created[0].meta?.cwd === r.cwd,
    JSON.stringify(created))
  check('session.new: seats and titles the conversation',
    attached.includes(r.dshSessionId) && renamed.some((x) => x.id === r.dshSessionId && x.title === r.name),
    JSON.stringify({ attached, renamed }))
  const s = await state()
  check('state.roots[0].sessions.active has the new session',
    s.roots[0].sessions?.active?.length === 1, JSON.stringify(s.roots[0].sessions))
}

// 6. Root UUID scopes the global dsh identity. Human-readable git session
// ids may collide for same-basename roots; their conversations/cwds may not.
{
  const a = await act('root.add', { path: sameNameA })
  const b = await act('root.add', { path: sameNameB })
  const sa = await act('session.new', { rootId: a.root.id, relDir: '', name: 'same title' })
  const sb = await act('session.new', { rootId: b.root.id, relDir: '', name: 'same title' })
  check('same-basename roots retain the same human-readable git session identity',
    sa.ok === true && sb.ok === true && sa.id === sb.id, JSON.stringify({ a: sa.id, b: sb.id }))
  check('same-basename roots get distinct live dsh conversations',
    sa.dshLive === true && sb.dshLive === true && sa.dshSessionId !== sb.dshSessionId,
    JSON.stringify({ a: sa.dshSessionId, b: sb.dshSessionId }))
  check('the two live conversations retain their own cwd',
    live.get(sa.dshSessionId)?.meta?.cwd === sa.cwd
      && live.get(sb.dshSessionId)?.meta?.cwd === sb.cwd
      && sa.cwd !== sb.cwd,
    JSON.stringify({ a: live.get(sa.dshSessionId)?.meta, b: live.get(sb.dshSessionId)?.meta }))
}

console.log(failures === 0 ? '\narxa-freestyle selftest.actions: ALL GREEN' : `\narxa-freestyle selftest.actions: ${failures} FAILURE(S)`)
rmSync(sandbox, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
