#!/usr/bin/env node
/**
 * arxa-sidebar wiring smoke — real Phase A lifecycle, fake webServer, fully
 * sandboxed (temp ARXA_HOME + workspace). Exercises the wired route pair:
 * boot (no org) → org.new → org.open → project.new → session.new → park →
 * session.resume → org.close, asserting CTA transitions at each step.
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

const routes = {}
const host = await import(path.join(here, 'lib', 'index.js'))
host.apply({ webServer: { register: (r) => { routes[r.path] = r.handler } } })

const call = (p, { method = 'GET', body, url = p } = {}) => new Promise((res) => {
  const req = { url, method, _h: {}, on(ev, fn) { this._h[ev] = fn } }
  routes[p](req, { writeHead() {}, end: (s) => res(JSON.parse(s)) })
  queueMicrotask(() => {
    if (body && req._h.data) req._h.data(JSON.stringify(body))
    if (req._h.end) req._h.end()
  })
})
const state = (q = '') => call('/__arxa/sidebar/state', { url: '/__arxa/sidebar/state' + q })
const act = (action, arg, project) => call('/__arxa/sidebar/action', { method: 'POST', body: { action, arg, project } })

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}
const ids = (s) => s.cta.map((c) => c.id).join(',')

let s = await state()
check('boot: seam flipped, no org, org CTAs', s.seam === false && s.org === null && ids(s).includes('org-new') && ids(s).includes('org-open'), JSON.stringify(s))

let r = await act('org.new', 'Acme Labs')
check('org.new ok', r.ok === true, r.error)
s = await state()
const orgId = s.orgs[0]?.id
check('org discovered', s.orgs.length === 1 && !!orgId)

r = await act('org.open', orgId)
check('org.open by id ok', r.ok === true, r.error)
s = await state()
check('org open: name + project-new CTA', s.org?.name === 'Acme Labs' && ids(s).includes('project-new'), JSON.stringify({ org: s.org, ctas: ids(s) }))

r = await act('project.new', 'Rocket')
check('project.new ok', r.ok === true, r.error)
s = await state()
const projId = s.projects[0]?.id
check('project listed', s.projects.length === 1 && s.projects[0].name === 'Rocket')

s = await state('?project=' + projId)
check('project selected → session-new CTA', ids(s).includes('session-new'), ids(s))

r = await act('session.new', 'feat-x', projId)
check('session.new ok', r.ok === true, r.error)

const gw = await import(path.join(here, '..', 'git-workspace', 'lib', 'index.js'))
const orgPath = s.orgs[0].path
const sid = gw.listSessions(orgPath).find((x) => x.state === 'open')?.id
gw.holdSession(orgPath, sid)
s = await state('?project=' + projId)
check('parked project session tagged + resume/merge CTAs', s.parkedSessions.length === 1 && s.parkedSessions[0].project === 'rocket' && ids(s).includes('session-resume') && ids(s).includes('session-merge'), JSON.stringify({ parked: s.parkedSessions, ctas: ids(s) }))

r = await act('session.resume', null, projId)
check('session.resume (project scope) ok', r.ok === true, r.error)
s = await state('?project=' + projId)
check('resumed: no parked, session-new back', s.parkedSessions.length === 0 && ids(s).includes('session-new'), ids(s))

r = await act('org.close')
check('org.close ok', r.ok === true, r.error)
s = await state()
check('closed: back to org rows, open CTA', s.org === null && s.orgs.length === 1 && ids(s).includes('org-open'), JSON.stringify({ ctas: ids(s) }))

r = await act('project.new', 'Nope')
check('verb on closed org fails loud', r.ok === false && r.error === 'no-org-open', JSON.stringify(r))

// ---- project-scope semantics: tagged sessions, sole-org open, scope ladder ----
r = await act('org.open')
check('org.open with no arg (sole-org fallback) ok', r.ok === true, r.error)
r = await act('session.new', 'feat-y', projId)
check('session.new with project body ok', r.ok === true, r.error)
const featY = gw.listSessions(orgPath).find((x) => x.name === 'feat-y')
check('project session tagged with slug', featY?.project === 'rocket', JSON.stringify(featY))
gw.holdSession(orgPath, featY.id)
s = await state('?project=' + projId)
check('tagged session parked under its project', s.parkedSessions.some((x) => x.id === featY.id && x.project === 'rocket'), JSON.stringify(s.parkedSessions))

r = await act('project.new', 'Rocket2')
check('second project ok', r.ok === true, r.error)
s = await state()
const proj2 = s.projects.find((p) => p.name === 'Rocket2')
s = await state('?project=' + proj2.id)
check('other project scoped out → session-new only', ids(s).includes('session-new') && !ids(s).includes('session-resume'), ids(s))

r = await act('session.new', 'org-x')
check('org-level session ok', r.ok === true, r.error)
const orgX = gw.listSessions(orgPath).find((x) => x.name === 'org-x')
check('org-level session untagged', orgX?.project === null, JSON.stringify(orgX))
gw.holdSession(orgPath, orgX.id)
s = await state('?project=' + proj2.id)
check('org-level surfaces from any selection', s.parkedSessions.some((x) => x.id === orgX.id) && ids(s).includes('session-resume'), JSON.stringify({ parked: s.parkedSessions, ctas: ids(s) }))
r = await act('session.resume', null, proj2.id)
check('org-level resume resolves in foreign scope', r.ok === true, r.error)

r = await act('session.new', 'org-z')
const orgZ = gw.listSessions(orgPath).find((x) => x.name === 'org-z')
gw.holdSession(orgPath, orgZ.id)
gw.holdSession(orgPath, orgX.id) // re-park: the foreign-scope resume above reopened it
r = await act('session.resume')
check('two org-level parked, no scope → ambiguous', r.ok === false && r.error === 'ambiguous-parked-session', JSON.stringify(r))
r = await act('session.resume', orgX.id)
check('exact id beats ambiguity', r.ok === true, r.error)

// ---- trash restore-all through the action route ----
r = await act('project.new', 'Doomed')
check('trash fixture project ok', r.ok === true, r.error)
s = await state()
const doomedPath = s.projects.find((p) => p.name === 'Doomed')?.path
const ws = await import(path.join(here, '..', 'workspace', 'lib', 'index.js'))
ws.softDelete(path.dirname(s.orgs[0].path), doomedPath) // orgs sit one level under the workspace root
s = await state()
check('trash CTA appears when trash non-empty', ids(s).includes('trash-restore') && s.trashCount === 1, JSON.stringify({ cta: ids(s), trash: s.trashCount }))
r = await act('trash.restore')
check('trash.restore (restore-all) ok', r.ok === true, r.error)
s = await state()
check('trash empty after restore-all', s.trashCount === 0 && !ids(s).includes('trash-restore'), JSON.stringify(s.trashCount))

console.log(failures === 0 ? '\narxa-sidebar smoke: ALL GREEN' : `\narxa-sidebar smoke: ${failures} FAILURE(S)`)
rmSync(sandbox, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
