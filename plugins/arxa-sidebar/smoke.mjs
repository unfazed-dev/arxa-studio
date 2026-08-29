#!/usr/bin/env node
/**
 * arxa-sidebar wiring smoke — ROWS WORLD (docs/plans/sidebar-org-rethink.md).
 * Real Phase A lifecycle, fake webServer, fully sandboxed (temp ARXA_HOME +
 * workspace). Exercises the wired route pair end to end:
 *   boot (root, no orgs) → org.create (auto-open) → rename (D41 manifest-only)
 *   → project fixture → org.new-session (row appears) → park → session.open
 *   → session.archive (hidden per D39) → second org auto-switch → rows served
 *   for BOTH orgs read-only → trash surface + restore / restore-all.
 * Exit 0 = every assertion held.
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const sandbox = mkdtempSync(path.join(tmpdir(), 'arxa-sidebar-smoke-'))
process.env.ARXA_HOME = path.join(sandbox, 'home')
const root = path.join(sandbox, 'ws')
mkdirSync(root, { recursive: true })
mkdirSync(process.env.ARXA_HOME, { recursive: true })

const here = path.dirname(new URL(import.meta.url).pathname)
const shell = await import(path.join(here, '..', 'file-org-shell', 'lib', 'index.js'))
shell.saveWorkspaceRoot(root)
// Filesystem-level fixtures only: the host holds ITS lifecycle instance on
// this root — a second lifecycle here would be a different single-handle world.
const ws = await import(path.join(here, '..', 'workspace', 'lib', 'index.js'))

const routes = {}
const host = await import(path.join(here, 'lib', 'index.js'))
// Mutable fake github (W3 gate): starts linked so the existing flow holds;
// the gate section below unlinks and re-links through the real acts.
const fakeGh = {
  linked: true,
  status: async () => ({ linked: fakeGh.linked, login: fakeGh.linked ? 'acme-owner' : undefined }),
  link: async () => { fakeGh.linked = true; return { linked: true, login: 'acme-owner' } },
  unlink: async () => { fakeGh.linked = false; return { unlinked: true } },
}
host.apply({ webServer: { register: (r) => { routes[r.path] = r.handler } }, github: fakeGh })

const call = (p, { method = 'GET', body, url = p } = {}) => new Promise((res) => {
  const req = { url, method, _h: {}, on(ev, fn) { this._h[ev] = fn } }
  routes[p](req, { writeHead() {}, end: (s) => res(JSON.parse(s)) })
  queueMicrotask(() => {
    if (body && req._h.data) req._h.data(JSON.stringify(body))
    if (req._h.end) req._h.end()
  })
})
const state = (q = '') => call('/__arxa/sidebar/state', { url: '/__arxa/sidebar/state' + q })
const act = (action, arg) => call('/__arxa/sidebar/action', { method: 'POST', body: { action, arg } })

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}

let s = await state()
check('boot: root chosen, no orgs yet, empty trash',
  s.seam === false && s.root === true && s.orgs.length === 0 && s.trashCount === 0 && s.trash.length === 0,
  JSON.stringify(s))

let r = await act('org.create', { name: 'Acme Labs' })
check('org.create ok (auto-open)', r.ok === true, r.error)
s = await state()
const acme = s.orgs[0]
check('org row served: open + no sessions yet',
  s.orgs.length === 1 && acme.open === true && Array.isArray(acme.sessions) && acme.sessions.length === 0,
  JSON.stringify(s))

// rename (D41): display name only — slug/path stable, open handle refreshes
r = await act('org.rename', { orgId: acme.id, name: 'Acme Labs Renamed' })
check('org.rename ok', r.ok === true, r.error)
s = await state()
check('rename served (open handle refreshed in place)',
  s.orgs[0].name === 'Acme Labs Renamed' && s.orgs[0].slug === acme.slug && s.orgs[0].open === true,
  JSON.stringify({ name: s.orgs[0].name, slug: s.orgs[0].slug }))

// project fixture (v1: no project-create UI — the rows face serves what the
// filesystem + manifests declare; scaffoldProject stays the CLI/host verb).
const orgPath = s.orgs[0].path
const proj = ws.scaffoldProject(orgPath, 'Rocket')
check('project fixture scaffolded', !!proj?.path, JSON.stringify(proj))

r = await act('org.new-session', { orgId: acme.id })
check('org.new-session ok', r.ok === true, r.error)
s = await state()
check('session row served on its org', s.orgs[0].sessions.length === 1 && s.orgs[0].sessions[0].state === 'open',
  JSON.stringify(s.orgs[0].sessions))

// park it, then open it back through the rows action
const gw = await import(path.join(here, '..', 'git-workspace', 'lib', 'index.js'))
const sid = s.orgs[0].sessions[0].id
gw.holdSession(orgPath, sid)
s = await state()
const parked = s.orgs[0].sessions[0]
check('parked row keeps state + reason fields',
  parked.state === 'parked' && 'parkedReason' in parked && parked.project === null,
  JSON.stringify(parked))
r = await act('session.open', { orgId: acme.id, sessionId: sid })
check('session.open (row click resume) ok', r.ok === true, r.error)
s = await state()
check('row back to open', s.orgs[0].sessions[0].state === 'open', JSON.stringify(s.orgs[0].sessions[0]))

// archive: D39 — the row disappears from the served rows entirely
gw.holdSession(orgPath, sid) // re-park so archive starts from a parked state
r = await act('session.archive', { orgId: acme.id, sessionId: sid })
check('session.archive ok', r.ok === true, r.error)
s = await state()
check('archived row held back from active views', s.orgs[0].sessions.length === 0, JSON.stringify(s.orgs[0].sessions))

// second org: create auto-SWITCHES (single-handle lifecycle), and the first
// org's rows are still served read-only — no open cycle needed to LIST.
r = await act('org.create', { name: 'Beta LLC' })
check('second org.create ok', r.ok === true, r.error)
s = await state()
check('auto-switch: exactly one open org, the new one',
  s.orgs.length === 2 && s.orgs.filter((o) => o.open).length === 1 && s.orgs.find((o) => o.open).name === 'Beta LLC',
  JSON.stringify(s.orgs.map((o) => ({ name: o.name, open: o.open }))))
check('first org rows still served while closed', s.orgs.find((o) => o.id === acme.id).sessions.length === 0)

r = await act('org.close', {})
s = await state()
check('org.close ok, back to zero open', r.ok === true && s.orgs.every((o) => !o.open), r.error)
r = await act('org.new-session', {})
check('new-session without any open org fails loud', r.ok === false && r.error === 'no-org-open', JSON.stringify(r))

// reopen acme by row id (the Q2 click-to-open path)
r = await act('org.open', { orgId: acme.id })
check('org.open by id ok', r.ok === true, r.error)
s = await state()
check('acme open again', s.orgs.find((o) => o.id === acme.id).open === true, JSON.stringify(s.orgs.map((o) => o.open)))

// ---- trash surface (Q6): entries served on the open org, restore / restore-all
const doomed = ws.scaffoldProject(orgPath, 'Doomed')
ws.softDelete(orgPath, doomed.path) // D69: trash is org-local
s = await state()
check('trash entry served with a display name', s.trash.length === 1 && s.trash[0].name === 'doomed' && s.trashCount === 1,
  JSON.stringify(s.trash))
r = await act('trash.restore', { entryId: s.trash[0].entryId })
check('trash.restore (single entry) ok', r.ok === true, r.error)
s = await state()
check('trash empty after single restore', s.trash.length === 0 && s.trashCount === 0, JSON.stringify(s.trash))

// restore-all: park two entries, restore with no id
const doomed2 = ws.scaffoldProject(orgPath, 'Doomed 2')
ws.softDelete(orgPath, doomed2.path)
const doomed3 = ws.scaffoldProject(orgPath, 'Doomed 3')
ws.softDelete(orgPath, doomed3.path)
s = await state()
check('two trash entries served', s.trash.length === 2, JSON.stringify(s.trash))
r = await act('trash.restore', { entryId: null })
check('trash.restore (restore-all) ok', r.ok === true, r.error)
s = await state()
check('trash empty after restore-all', s.trash.length === 0 && s.trashCount === 0, JSON.stringify(s.trash))

// unknown action + project-scope resolution still loud/precise
r = await act('ci.run', {})
check('ci.run stays reserved (unknown-action)', r.ok === false && r.error === 'unknown-action', JSON.stringify(r))
s = await state('?project=' + proj.manifest.id)
check('project scope resolves by id', s.selectedProject === 'rocket', JSON.stringify(s.selectedProject))
s = await state('?project=nonexistent')
check('unknown scope renders as none (mutations throw instead)', s.selectedProject === null, JSON.stringify(s.selectedProject))

// ---- workspace rows (org-model-v2 Phase C: D70/D71) — fresh org so the
// count assertions above stay untouched. Rows ARE the tree now: five
// category workspaces + projects; selection-scoped session creation.
r = await act('org.create', { name: 'Rows Co' })
check('rows-c: org.create ok', r.ok === true, r.error)
s = await state()
check('rows-c: five category rows served, no projects yet',
  Array.isArray(s.rows) && s.rows.length === 5 && s.rows.every((x) => x.kind === 'category' && x.sessionCount === null)
  && s.rows[0].rowId === 'category:' + s.rows[0].slug,
  JSON.stringify(s.rows))
r = await act('workspace.new-session', { rowId: 'category:notes' })
check('rows-c: category row session ok (result carries the row)', r.ok === true && typeof r.result?.id === 'string' && r.result.project === null, JSON.stringify(r))
s = await state()
check('rows-c: category session registered on the org', s.orgs.find((o) => o.open).sessions.length === 1, JSON.stringify(s.orgs.find((o) => o.open).sessions))
const rcPath = s.orgs.find((o) => o.open).path
const rcProj = ws.scaffoldProject(rcPath, 'Rocket')
check('rows-c: project fixture scaffolded', !!rcProj?.path, JSON.stringify(rcProj))
s = await state()
const projRow = s.rows.find((x) => x.kind === 'project')
check('rows-c: project row served indented data + zero count',
  s.rows.length === 6 && projRow && projRow.rowId === 'project:rocket' && projRow.sessionCount === 0,
  JSON.stringify(s.rows))
r = await act('workspace.new-session', { rowId: 'project:rocket' })
check('rows-c: project row session ok (slug-scoped)', r.ok === true && r.result?.project === 'rocket', JSON.stringify(r))
s = await state()
const rcSessions = s.orgs.find((o) => o.open).sessions
check('rows-c: project session registered + count pill honest',
  rcSessions.length === 2 && s.rows.find((x) => x.rowId === 'project:rocket').sessionCount === 1,
  JSON.stringify({ sessions: rcSessions, rows: s.rows }))
r = await act('workspace.new-session', { rowId: 'category:nope' })
check('rows-c: unknown category is loud', r.ok === false && String(r.error).startsWith('unknown-row'), JSON.stringify(r))
r = await act('workspace.new-session', { rowId: 'garbage' })
check('rows-c: malformed rowId is loud', r.ok === false && String(r.error).startsWith('unknown-row'), JSON.stringify(r))

// ---- github gate (org-model-v2 W3: D69 gate half) — fake github above
r = await act('github.status', {})
check('gh: status act serves linked state', r.ok === true && r.result?.linked === true && r.result?.login === 'acme-owner', JSON.stringify(r))
r = await act('github.unlink', {})
check('gh: unlink ok', r.ok === true, r.error)
r = await act('org.create', { name: 'Blocked Co' })
check('gh: org.create blocked while unlinked (D69 requirement)', r.ok === false && r.error === 'linked-required', JSON.stringify(r))
r = await act('github.link', {})
check('gh: link ok', r.ok === true && r.result?.linked === true, JSON.stringify(r))
r = await act('org.create', { name: 'Admitted Co' })
check('gh: org.create allowed once linked', r.ok === true, r.error)
s = await state()
check('gh: the admitted org exists and is open', s.orgs.some((o) => o.name === 'Admitted Co' && o.open), JSON.stringify(s.orgs.map((o) => o.name)))

console.log(failures === 0 ? '\narxa-sidebar smoke: ALL GREEN' : `\narxa-sidebar smoke: ${failures} FAILURE(S)`)
rmSync(sandbox, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
