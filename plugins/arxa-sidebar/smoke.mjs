#!/usr/bin/env node
/**
 * arxa-sidebar wiring smoke — ROWS WORLD (docs/plans/sidebar-org-rethink.md).
 * Real Phase A lifecycle, fake webServer, fully sandboxed (temp ARXA_HOME +
 * workspace). Exercises the wired route pair end to end:
 *   boot (root, no orgs) → org.create (auto-open) → rename (D41 manifest-only)
 *   → project fixture → org.new-session (row appears) → park → session.open
 *   → session.archive (hidden per D39) → archives surface (D117: face,
 *   revive, not-archived guard, trash round-trip, precheck, local-only
 *   purge) → second org auto-switch → rows served
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
// D98/D99: a project session routes to the PROJECT repo, so a scaffolded
// project fixture must also be attached as a repo (what `project.create`
// does at lifecycle.js:925) — a bare folder is refused as no-HEAD.
// (`gw` further down is the same module; this early handle precedes line 83.)
const gitws = await import(path.join(here, '..', 'git-workspace', 'lib', 'index.js'))

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
host.apply({ webServer: { register: (r) => { routes[r.path] = r.handler } } }, { github: fakeGh })

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

// rename (D72): display name + folder move as one operation — the open
// handle is re-opened on the new path; the manifest id stays stable
r = await act('org.rename', { orgId: acme.id, name: 'Acme Labs Renamed' })
check('org.rename ok', r.ok === true, r.error)
s = await state()
check('rename served (D72: moved folder, new slug, still open)',
  s.orgs[0].name === 'Acme Labs Renamed' && s.orgs[0].slug === 'Acme-Labs-Renamed' && s.orgs[0].open === true && s.orgs[0].path !== acme.path,
  JSON.stringify({ name: s.orgs[0].name, slug: s.orgs[0].slug, path: s.orgs[0].path }))

// project fixture (v1: no project-create UI — the rows face serves what the
// filesystem + manifests declare; scaffoldProject stays the CLI/host verb).
const orgPath = s.orgs[0].path
const proj = ws.scaffoldProject(orgPath, 'rocket') // lowercase literal: smoke pins hardcode projects/rocket/… keys (D79 slugs keep case)
if (proj?.path) gitws.initProjectRepo(proj.path)
check('project fixture scaffolded', !!proj?.path, JSON.stringify(proj))

// v2 (grilled 2026-08-30): sessions are born in a WORKSPACE row —
// org-level creation is gone (unknown-action is the loud default).
r = await act('org.new-session', { orgId: acme.id })
check('org-level creation refused (v2)', r.ok === false && r.error === 'unknown-action', JSON.stringify(r))
r = await act('workspace.new-session', { orgId: acme.id, workspace: 'notes' })
check('workspace.new-session ok', r.ok === true, r.error)
s = await state()
// The id IS the relative disk path (2026-09-03): <org folder>/<workspace>/<leaf>.
// The row LABEL is the leaf alone — the breadcrumb already carries the folders
// (Q9), so a row does not repeat them.
const SESSION_ID = /^[^/]+\/notes\/[a-z0-9-]+-wt-\d{6}-\d{3}$/
const row = s.orgs[0].sessions[0]
check('session row served on its org with workspace + leaf label', s.orgs[0].sessions.length === 1 && row.state === 'open'
  && row.workspace === 'notes' && SESSION_ID.test(row.id)
  && row.name === row.id.split('/').pop()
  && row.id.startsWith(path.basename(orgPath) + '/'),
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

// ---- archives surface (2026-09-05 grill) ----------------------------------
// The Archives section lists every org's archived sessions (D39 browse
// face); Restore revives; Move to Trash parks a logical entry; the trash
// owns restore-back and the one destructive door (local-only purge here —
// the org has no origin).
check('archives face lists the archived session, org-tagged',
  Array.isArray(s.archives) && s.archives.length === 1 && s.archives[0].sessionId === sid
  && s.archives[0].orgId === acme.id && s.archives[0].name === row.name,
  JSON.stringify(s.archives))
// Guard: Move-to-Trash refuses a session that is not archived (the door
// opens only from the archives tier, D47).
r = await act('session.trash', { orgId: acme.id, sessionId: 'not-a-real-id' })
check('session.trash of an unknown session fails loud', r.ok === false && /unknown-session/.test(r.error), JSON.stringify(r))
r = await act('session.revive', { orgId: acme.id, sessionId: sid })
check('session.revive (archives restore) ok', r.ok === true, r.error)
s = await state()
check('revived row back under its workspace, archives empty',
  s.orgs[0].sessions.length === 1 && s.orgs[0].sessions[0].id === sid && s.orgs[0].sessions[0].state === 'open'
  && s.archives.length === 0,
  JSON.stringify({ sessions: s.orgs[0].sessions, archives: s.archives }))
r = await act('session.trash', { orgId: acme.id, sessionId: sid })
check('session.trash of an OPEN session refused (not-archived)', r.ok === false && /not-archived/.test(r.error), JSON.stringify(r))
// Archive again, then the full trash round-trip.
r = await act('session.archive', { orgId: acme.id, sessionId: sid })
check('re-archive ok', r.ok === true, r.error)
r = await act('session.trash', { orgId: acme.id, sessionId: sid })
check('session.trash ok (entry minted)', r.ok === true && /^2\d{7}T.+Z-session-/.test(r.result.entryId), r.error || JSON.stringify(r.result))
s = await state()
check('sessionTrash face lists the entry; trash face stays folders-only',
  s.sessionTrash.length === 1 && s.sessionTrash[0].sessionId === sid && s.sessionTrash[0].orgId === acme.id
  && s.archives.length === 0 && s.trash.length === 0 && s.trashCount === 1,
  JSON.stringify({ sessionTrash: s.sessionTrash, archives: s.archives, trash: s.trash, trashCount: s.trashCount }))
r = await act('sessiontrash.restore', { orgId: acme.id, entryId: s.sessionTrash[0].entryId })
check('sessiontrash.restore ok (back to archives)', r.ok === true && r.result.sessionId === sid && r.result.state === 'archived', r.error || JSON.stringify(r.result))
s = await state()
check('archives face re-lists the restored session',
  s.archives.length === 1 && s.archives[0].sessionId === sid && s.sessionTrash.length === 0, JSON.stringify(s.archives))
// Purge: precheck (local-only org → no repo, no open PR) then the door.
r = await act('session.trash', { orgId: acme.id, sessionId: sid })
check('trash again for purge', r.ok === true, r.error)
s = await state()
const purgeEntry = s.sessionTrash[0]
r = await act('sessiontrash.precheck', { orgId: acme.id, entryId: purgeEntry.entryId })
check('sessiontrash.precheck: local-only picture (no repo, no PR, branch named)',
  r.ok === true && r.result.repo === null && r.result.openPr === null && r.result.branch === purgeEntry.branch,
  r.error || JSON.stringify(r.result))
const branchBefore = purgeEntry.branch
r = await act('sessiontrash.purge', { orgId: acme.id, entryId: purgeEntry.entryId })
check('sessiontrash.purge ok: local-only (no-origin) — refs dropped, entry deleted',
  r.ok === true && r.result.remoteBranch === 'no-origin' && r.result.refs.branchDropped === true && r.result.deleted != null,
  r.error || JSON.stringify(r.result))
s = await state()
const branchGone = gw.runGit(['rev-parse', '--verify', branchBefore], { cwd: orgPath, allowFail: true }) === null
check('parked branch really gone; both faces empty; count 0',
  branchGone && s.sessionTrash.length === 0 && s.archives.length === 0 && s.trashCount === 0,
  JSON.stringify({ sessionTrash: s.sessionTrash, archives: s.archives, trashCount: s.trashCount }))
r = await act('sessiontrash.restore', { orgId: acme.id, entryId: purgeEntry.entryId })
check('restore of a purged entry fails loud (no-trash-entry)', r.ok === false && /no-trash-entry/.test(r.error), JSON.stringify(r))

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
r = await act('workspace.new-session', {})
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
check('trash entry served with a display name', s.trash.length === 1 && s.trash[0].name === 'Doomed' && s.trashCount === 1, // D79: slug keeps the fixture's case
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
// v2: wait for the initial snapshot (session creation gates on HEAD)
let snapTries = 0
while (snapTries++ < 200) {
  s = await state()
  if (!s.orgs.find((o) => o.open).snapshotPending) break
  await new Promise((res) => setTimeout(res, 100))
}
const rc = s.orgs.find((o) => o.open)
const rcTree = rc.tree
check('rows-c: tree face — five docks, notes a workspace, fixed containers',
  rcTree.docks.length === 5
  && rcTree.docks.find((d) => d.slug === 'notes').workspace === true
  && rcTree.docks.find((d) => d.slug === 'meetings').containers.join('+') === 'scheduler+notes'
  && rcTree.docks.find((d) => d.slug === 'communications').containers.length === 3
  && rcTree.projects.length === 0,
  JSON.stringify(rcTree))
r = await act('workspace.new-session', { orgId: rc.id, workspace: 'notes' })
// One string, three surfaces: the id IS the relative disk path, the branch is
// it under `arxa/`, the worktree is it under the org's `.arxa/worktrees/`, and
// the row label is its leaf. Asserting them together is what would have caught
// the `arxa/session/s-mtkul0al-7uwie9` drift.
check('rows-c: dock session ok (path identity, leaf label, workspace-scoped)',
  r.ok === true && /^[^/]+\/notes\/note-wt-\d{6}-\d{3}$/.test(r.result?.id ?? '')
  && r.result?.name === r.result?.id.split('/').pop()
  && r.result?.branch === 'arxa/' + r.result?.id
  && r.result?.worktree.endsWith('/.arxa/worktrees/' + r.result?.id)
  && r.result?.workspace === 'notes' && r.result?.project === null, JSON.stringify(r))
const rcPath = rc.path
const rcProj = ws.scaffoldProject(rcPath, 'rocket')
if (rcProj?.path) gitws.initProjectRepo(rcProj.path)
check('rows-c: project fixture scaffolded (repo-attached, D98)', !!rcProj?.path && gitws.hasHead(rcProj.path), JSON.stringify(rcProj))
s = await state()
const rcTree2 = s.orgs.find((o) => o.open).tree
check('rows-c: project served with its 10 fixed containers',
  rcTree2.projects.length === 1 && rcTree2.projects[0].containers.length === 10,
  JSON.stringify(rcTree2.projects))
r = await act('workspace.new-session', { orgId: rc.id, workspace: 'projects/rocket/02-design/application' })
// A project session's identity mirrors disk exactly — `projects/` kept, the
// numeric container kept — and its CHECKOUT sits under the ORG's single
// worktrees root even though its branch and registry live in the project repo.
// Track binding (2026-09-08): the session hangs off the stage's application
// track, and the auto-name takes the LAST segment (Q6 — unchanged mint rule).
check('rows-c: project-track session ok (full path identity)',
  r.ok === true && r.result?.project === 'rocket'
  && r.result?.workspace === 'projects/rocket/02-design/application'
  && /^[^/]+\/projects\/rocket\/02-design\/application\/application-wt-\d{6}-\d{3}$/.test(r.result?.id ?? '')
  && r.result?.name === r.result?.id.split('/').pop()
  && r.result?.branch === 'arxa/' + r.result?.id
  && r.result?.worktree.endsWith('/.arxa/worktrees/' + r.result?.id), JSON.stringify(r))
s = await state()
const rcSessions = s.orgs.find((o) => o.open).sessions
check('rows-c: both sessions registered under their workspaces with real timestamps',
  rcSessions.length === 2 && rcSessions.every((x) => typeof x.createdAt === 'number' && typeof x.updatedAt === 'number'),
  JSON.stringify(rcSessions))
r = await act('workspace.new-session', { orgId: rc.id, workspace: 'notes/nope' })
check('rows-c: unknown workspace is loud', r.ok === false && String(r.error).startsWith('unknown-workspace'), JSON.stringify(r))
// Track binding (2026-09-08): a bare stage is refused through the ACTION too —
// the HTTP surface has no auth, so this is where the rule actually holds.
r = await act('workspace.new-session', { orgId: rc.id, workspace: 'projects/rocket/02-design' })
check('rows-c: a bare stage container is refused and names the two paths that work',
  r.ok === false && String(r.error).startsWith('workspace-needs-track')
  && String(r.error).includes('02-design/application') && String(r.error).includes('02-design/website'),
  JSON.stringify(r))

// D80: full-move rename through the action — folder + manifest + rekey;
// session workspaces rekey to the new slug.
r = await act('project.rename', { orgId: rc.id, projectSlug: 'rocket', name: 'Rocket Pool' })
check('rows-c: project.rename ok (D80 full move, case preserved)', r.ok === true && r.result?.slug === 'Rocket-Pool', JSON.stringify(r))
s = await state()
const renamedTree = s.orgs.find((o) => o.open).tree
check('rows-c: renamed project serves under the new slug with its containers',
  renamedTree.projects.some((p) => p.slug === 'Rocket-Pool' && p.containers.length === 10), JSON.stringify(renamedTree.projects))
r = await act('workspace.new-session', { orgId: rc.id, workspace: 'projects/Rocket-Pool/01-intake/website' })
check('rows-c: session under the renamed slug parses (D79 keys)', r.ok === true && r.result?.project === 'Rocket-Pool', JSON.stringify(r))
// D80: project.trash parks the renamed project in the org trash (local-only).
r = await act('project.trash', { orgId: rc.id, projectSlug: 'Rocket-Pool' })
check('rows-c: project.trash ok', r.ok === true, JSON.stringify(r))
s = await state()
check('rows-c: trash row data served after park', s.trash.length === 1 && s.trash[0].name === 'Rocket-Pool', JSON.stringify(s.trash))
r = await act('trash.restore', { entryId: null })
check('rows-c: restore-all brings the project back', r.ok === true, r.error)
s = await state()
check('rows-c: trash empty after restore-all', s.trash.length === 0 && s.trashCount === 0, JSON.stringify(s.trash))
r = await act('workspace.new-session', { orgId: rc.id })
check('rows-c: missing workspace is loud', r.ok === false && r.error === 'workspace-required', JSON.stringify(r))

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

// ---------------------------------------------------------------------------
// Zero-org rescue (2026-09-08, docs/plans/org-trash-unreachable.md).
// trashOrg() drops the org from the recents; loadWorkspaceRoot() answers the
// first valid recent; getLifecycle() returns null without one. So trashing the
// LAST org took the whole lifecycle seam down WITH the trash entry it had just
// written: no orgTrash in the state, orgtrash.restore answered no-workspace,
// and the app showed a welcome gate over the only door back. Measured live on
// Omarchy (org PROTONFEW parked intact while the UI showed nothing).
// This drives the real thing: empty the orgs, then get one back.
{
  const before = await state()
  for (const o of before.orgs) await act('org.trash', { orgId: o.id })
  const empty = await state()
  check('zero-org: every org is gone from the state', empty.orgs.length === 0, JSON.stringify(empty.orgs.map((o) => o.name)))
  check('zero-org: the trash is STILL listed with no workspace root',
    Array.isArray(empty.orgTrash) && empty.orgTrash.length === before.orgs.length,
    JSON.stringify({ orgTrash: empty.orgTrash, trashed: before.orgs.length }))

  const entry = (empty.orgTrash || [])[0]
  const back = await act('orgtrash.restore', { entryId: entry?.entryId })
  check('zero-org: restore works with no lifecycle at all', back.ok === true, JSON.stringify(back))
  const after = await state()
  // The trash row carries the FOLDER name (path.basename) while the org row
  // carries its display name — "Admitted-Co" vs "Admitted Co" — so identity is
  // checked against the restored path, not the label.
  check('zero-org: the restored org is live again, and it is the one we restored',
    after.orgs.length === 1 && String(back.result?.restoredPath || '').endsWith(entry?.name),
    JSON.stringify({ want: entry?.name, restoredPath: back.result?.restoredPath, got: after.orgs.map((o) => o.name) }))
  check('zero-org: the restored entry left the trash',
    !(after.orgTrash || []).some((e) => e.entryId === entry?.entryId), JSON.stringify(after.orgTrash))
}

console.log(failures === 0 ? '\narxa-sidebar smoke: ALL GREEN' : `\narxa-sidebar smoke: ${failures} FAILURE(S)`)
rmSync(sandbox, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
