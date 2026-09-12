#!/usr/bin/env node
/**
 * arxa-sidebar selftest: org.trash stops live sessions first (Bug B,
 * docs/plans/org-trash-unreachable.md). Real Phase A lifecycle + the real
 * action route, fake dsh engine services in ctx (sessions store, agents
 * factory, sessionPersistence). The fake agents run a WRITER that keeps
 * writing into the session worktree — the recreator that rebuilt the
 * org's leading directories after the move (the husk) and blocked restore.
 * Exit 0 = every assertion held.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const sandbox = mkdtempSync(path.join(tmpdir(), 'arxa-trash-live-'))
process.env.ARXA_HOME = path.join(sandbox, 'home')
const root = path.join(sandbox, 'ws')
mkdirSync(root, { recursive: true })
mkdirSync(process.env.ARXA_HOME, { recursive: true })

const here = path.dirname(new URL(import.meta.url).pathname)
const shell = await import(path.join(here, '..', 'file-org-shell', 'lib', 'index.js'))
shell.saveWorkspaceRoot(root)

const routes = {}
const host = await import(path.join(here, 'lib', 'index.js'))
const fakeGh = {
  prListForHead: async () => [],
  prChecks: async () => ({ state: 'unknown', asleep: false, runs: [] }),
  prMerge: async () => ({ merged: false }),
  ensureRunner: async () => ({ ok: false, reason: 'not-wired' }),
}

// ---- fake dsh engine: what quiesce consumes ----
// Persistence rows mirror what the real engine writes at spawn: one dir per
// session, header { id, cwd } in session.jsonl.zstd.
const sessRoot = path.join(sandbox, 'sessions')
const headers = []
const seedHeader = (id, cwd) => {
  const dir = path.join(sessRoot, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'session.jsonl.zstd'), JSON.stringify({ id, cwd }))
  headers.push(dir)
}
const persistence = {
  root: sessRoot, compression: 'zstd',
  async listProjectDirs() { return existsSync(sessRoot) ? [sessRoot] : [] },
  async listSessionDirs(p) { return readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(p, e.name)) },
  async readFirstZstdLine(file) { return readFileSync(file, 'utf8') },
}
// The agents factory: create() returns the REAL handle shape ({ agent,
// dispose } — the store has no stop-by-id; the handle's dispose IS the stop).
// The writer interval is the recreator: a live session keeps writing into
// its cwd, so an org moved while the writer lives gets its skeleton back.
const agents = { live: new Map(), created: [], hangNext: false }
const fakeAgents = {
  async create({ sessionId, meta } = {}) {
    const id = typeof sessionId === 'string' && sessionId !== '' ? sessionId : 'sess-' + (agents.created.length + 1)
    const cwd = meta?.cwd
    const rec = { id, cwd, disposed: false }
    if (agents.hangNext) {
      agents.hangNext = false
      rec.dispose = () => new Promise(() => {}) // never settles — the timeout case
    } else {
      rec.writer = setInterval(() => {
        try { mkdirSync(cwd, { recursive: true }); writeFileSync(path.join(cwd, 'beat.txt'), String(Date.now())) } catch { /* cwd gone with the org */ }
      }, 4)
      rec.writer.unref?.()
      rec.dispose = async () => { clearInterval(rec.writer); agents.live.delete(id); rec.disposed = true }
    }
    agents.live.set(id, rec)
    agents.created.push(rec)
    return { agent: rec, dispose: rec.dispose }
  },
  get: (id) => (agents.live.has(id) ? { id, cancel() {}, whenIdle: async () => {} } : undefined),
}
const sessionsStore = {
  create: (id) => ({ id }),
  get: (id) => (agents.live.has(id) ? { id } : undefined),
  list: () => [...agents.live.values()].map((r) => ({ id: r.id, cwd: r.cwd })),
}
host.apply({
  webServer: { register: (r) => { routes[r.path] = r.handler } },
  sessions: sessionsStore,
  agents: fakeAgents,
  get: (key) => (key === 'sessionPersistence' ? persistence : null),
}, { github: fakeGh })

const call = (p, { method = 'GET', body, url = p } = {}) => new Promise((res) => {
  const req = { url, method, _h: {}, on(ev, fn) { this._h[ev] = fn } }
  routes[p](req, { writeHead() {}, end: (s) => res(JSON.parse(s)) })
  queueMicrotask(() => {
    if (body && req._h.data) req._h.data(JSON.stringify(body))
    if (req._h.end) req._h.end()
  })
})
const act = (action, arg) => call('/__arxa/sidebar/action', { method: 'POST', body: { action, arg } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}

/** Fresh org (unlinked at birth — no repoOwner/repoName), auto-open. */
async function makeOrg(name) {
  const r = await act('org.create', { name, link: false })
  if (!r.ok) throw new Error('org.create failed: ' + r.error)
  const s = await call('/__arxa/sidebar/state')
  const org = s.orgs.find((o) => o.open)
  return { id: org.id, path: org.path, name }
}

// ============================================================
// T1 — live session inside the org: stop first, no husk, restore ok
// ============================================================
{
  const org = await makeOrg('Live Husk Co')
  const s = await act('workspace.new-session', { orgId: org.id, workspace: 'notes' })
  if (!s.ok) throw new Error('new-session failed: ' + s.error)
  // The spawn went through the REAL face (handle retained host-side);
  // mirror what the engine persists for it, plus one under-org row that is
  // not live (the already-stopped case).
  const spawned = agents.created[agents.created.length - 1]
  seedHeader(spawned.id, spawned.cwd)
  seedHeader('arxa-gone-row', path.join(org.path, '.arxa', 'worktrees', 'gone'))
  check('T1 fixture: spawned session cwd sits inside the org',
    typeof spawned.cwd === 'string' && spawned.cwd.startsWith(org.path + path.sep), String(spawned.cwd))

  const t = await act('org.trash', { orgId: org.id })
  check('T1: trash succeeds with a live session inside', t.ok === true, JSON.stringify(t).slice(0, 300))
  check('T1: stopped/alreadyStopped reported as session ids',
    t.ok === true && t.result.sessions && t.result.sessions.stopped.includes(spawned.id) && t.result.sessions.alreadyStopped.includes('arxa-gone-row'),
    JSON.stringify(t.result?.sessions))

  await sleep(60) // let any surviving writer fire — the husk recreator
  check('T1: original path stays absent (no husk)', !existsSync(org.path), org.path)

  const st = await call('/__arxa/sidebar/state')
  const idx = (() => { try { return JSON.parse(readFileSync(path.join(process.env.ARXA_HOME, 'org-trash.json'), 'utf8')) } catch { return [] } })()
    .find((e) => e.name === 'Live-Husk-Co')
  const row = (st.orgTrash || []).find((e) => e.entryId === idx?.entryId)
  check('T1: trash row renders the display name', !!idx && !!row && row.name === 'Live Husk Co',
    JSON.stringify({ index: idx, rows: st.orgTrash }))
  const r2 = await act('orgtrash.restore', { entryId: idx?.entryId })
  check('T1: restore succeeds (no occupied-path refusal)',
    r2.ok === true && existsSync(r2.result?.restoredPath) && path.basename(r2.result.restoredPath) === 'Live-Husk-Co',
    JSON.stringify(r2).slice(0, 300))
}

// ============================================================
// T2 — a stop that never settles: trash fails closed, org untouched
// ============================================================
{
  const org = await makeOrg('Hung Stop Co')
  agents.hangNext = true
  const s = await act('workspace.new-session', { orgId: org.id, workspace: 'notes' })
  if (!s.ok) throw new Error('new-session failed: ' + s.error)
  const spawned = agents.created[agents.created.length - 1]
  seedHeader(spawned.id, spawned.cwd)
  process.env.ARXA_SESSION_STOP_BUDGET_MS = '40'
  const t = await act('org.trash', { orgId: org.id })
  delete process.env.ARXA_SESSION_STOP_BUDGET_MS
  check('T2: trash fails closed on an unstoppable session', t.ok === false, JSON.stringify(t).slice(0, 300))
  check('T2: error names the session id and nothing else (no paths)',
    t.ok === false && t.error.includes(spawned.id) && !t.error.includes('/'), String(t.error))
  check('T2: org still on disk', existsSync(org.path), org.path)
  const st = await call('/__arxa/sidebar/state')
  check('T2: no trash entry was written', (st.orgTrash || []).length === 0, JSON.stringify(st.orgTrash))
  check('T2: org still in the switcher', (st.orgs || []).some((o) => o.id === org.id))
}

// ============================================================
// T3 — a live session OUTSIDE the org is untouched by the trash
// ============================================================
{
  const org = await makeOrg('Outside Co')
  const outsideDir = path.join(sandbox, 'elsewhere', 'ws')
  const outside = await fakeAgents.create({ sessionId: 'arxa-outside', meta: { cwd: outsideDir } })
  seedHeader('arxa-outside', outsideDir)
  const t = await act('org.trash', { orgId: org.id })
  check('T3: trash succeeds', t.ok === true, JSON.stringify(t).slice(0, 300))
  const rec = agents.created.find((r) => r.id === 'arxa-outside')
  check('T3: outside session still live, never stopped', agents.live.has('arxa-outside') && rec.disposed === false)
  await outside.dispose() // suite hygiene: stop the writer
}

// ============================================================
console.log(failures === 0 ? '\narxa-sidebar selftest.trash-live-sessions: ALL GREEN' : `\narxa-sidebar selftest.trash-live-sessions: ${failures} FAILURE(S)`)
rmSync(sandbox, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
