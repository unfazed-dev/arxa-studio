#!/usr/bin/env node
/**
 * arxa-dashboard selftest (static + resolveRow behaviour) —
 * docs/plans/org-row-dashboard.md §4 step 2. Source-shape checks over the
 * host and client halves, the two sidebar seams the dashboard depends on,
 * and the registration rows. Projections live in selftest.projections.mjs.
 * Run: node plugins/arxa-dashboard/selftest.mjs
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveRow, scopeSessions } from './lib/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const host = readFileSync(join(here, 'lib', 'index.js'), 'utf8')
const client = readFileSync(join(here, 'lib', 'client.js'), 'utf8')
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
const snippet = readFileSync(join(root, 'plugins', 'arxa-sidebar', 'lib', 'workspace-region.snippet.txt'), 'utf8')
const sidebarClient = readFileSync(join(root, 'plugins', 'arxa-sidebar', 'lib', 'client.js'), 'utf8')
const patch = readFileSync(join(root, 'profile', 'cordis.patch.yml'), 'utf8')
const launcher = readFileSync(join(root, 'bin', 'arxa-studio.mjs'), 'utf8')

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}

// ---- host half ------------------------------------------------------------
check('host: one exact route POST /__arxa/dashboard/action on the webServer pattern',
  host.includes("path: '/__arxa/dashboard/action'") && host.includes("kind: 'exact'") && host.includes("export const inject = ['webServer']"))
check('host: reads the sidebar seam Symbol.for(\'arxa.sidebar.host\') and refuses before ready',
  host.includes("Symbol.for('arxa.sidebar.host')") && host.includes("error: 'sidebar-not-ready'"))
check('host: verbs ping + row.stats, unknown-action refused',
  host.includes("action === 'ping'") && host.includes("'row.stats': async") && host.includes("error: 'unknown-action'"))
check('host: orgs resolved through lifecycle.listOrgs — never a browser path',
  host.includes('oc.l.listOrgs()') && !/arg\??\.(path|orgPath|dir)/.test(host))

// ---- resolveRow behaviour --------------------------------------------------
const orgs = [{ id: 'org-1', name: 'TERRA', path: '/tmp/TERRA' }]
check('resolveRow: org row (rowId "") → kind org, org path',
  (() => { const r = resolveRow(orgs, { orgId: 'org-1', rowId: '' }); return r.kind === 'org' && r.path === '/tmp/TERRA' && r.name === 'TERRA' })())
check('resolveRow: category row → kind category under the org',
  (() => { const r = resolveRow(orgs, { orgId: 'org-1', rowId: 'notes' }); return r.kind === 'category' && r.path === '/tmp/TERRA/notes' })())
check('resolveRow: project row → kind project under projects/',
  (() => { const r = resolveRow(orgs, { orgId: 'org-1', rowId: 'projects/totem-labs' }); return r.kind === 'project' && r.path === '/tmp/TERRA/projects/totem-labs' && r.name === 'totem-labs' })())
const refused = (arg) => { try { resolveRow(orgs, arg); return false } catch (e) { return e.message } }
check('resolveRow: unknown org refused', refused({ orgId: 'nope', rowId: '' }) === 'org-not-found')
check('resolveRow: traversal / free-form rows refused',
  refused({ orgId: 'org-1', rowId: '../etc' }) === 'row-refused' && refused({ orgId: 'org-1', rowId: 'projects/../../x' }) === 'row-refused' && refused({ orgId: 'org-1', rowId: 'random' }) === 'row-refused' && refused({ orgId: 'org-1', rowId: 'projects/a/b' }) === 'row-refused')
check('resolveRow: non-string ids refused, not coerced', refused({ orgId: 5, rowId: {} }) === 'org-not-found')

// ---- client half -----------------------------------------------------------
check('client: loader id arxa-dashboard, React via require, no JSX/import/TypeScript',
  client.includes("id: 'arxa-dashboard'") && client.includes("require('react')") && !/<[A-Za-z][^>]*>\s*\)?/.test(client.replace(/'[^']*'|"[^"]*"/g, '')) && !/^\s*import\s/m.test(client))
check('client: publishes window.__ARXA_DASHBOARD__ = { Root } inside ctx.effect and withdraws it on dispose',
  client.includes('window.__ARXA_DASHBOARD__ = { Root') && client.includes('delete window.__ARXA_DASHBOARD__') && client.includes("'arxa-dashboard: root seam'"))
check('client: announces arxa-dashboard-ready (the hero guide re-renders on it)',
  client.includes("new Event('arxa-dashboard-ready')") && snippet.includes('"arxa-dashboard-ready"'))
check('client: owns NO slot (the hero slot is arxa-sidebar\'s, kind:single)',
  !client.includes('slots.register') && !client.includes('slots.inject'))
check('client: CSS uses data-* hooks + aXa_db_ classes only, and is removed on dispose',
  client.includes("[data-conversation-scroll]:has([data-arxa-dashboard])") && !/\.wSkVaW_/.test(client) && client.includes("'arxa-dashboard: css'"))
check('client: no global timers or polling', !/\bsetTimeout\(|\bsetInterval\(/.test(client))
check('client: CTA posts the SAME workspace.new-session the shell button posts, then openCreated',
  client.includes("action: 'workspace.new-session'") && client.includes("SIDEBAR_ROUTE = '/__arxa/sidebar/action'") && client.includes('bridge.openCreated(') && client.includes('bridge.ctaReady === true'))
check('client: org rows get no CTA (org-level creation stays removed)',
  client.includes('const isOrg = !sel.rowId') && client.includes("isOrg ? null : h('button'"))
check('client: every key present in en, pl and fr',
  (() => {
    const dict = (name) => { const m = client.match(new RegExp('const ' + name + ' = \\{([\\s\\S]*?)\\n    \\}')); return m ? [...m[1].matchAll(/'([a-z.A-Z]+)':/g)].map((x) => x[1]).sort().join(',') : name }
    return dict('en') === dict('pl') && dict('en') === dict('fr') && dict('en').includes('cta.newSession')
  })())
check('package: dsh.client inject list mirrors the git card, ./client export present',
  Array.isArray(pkg.dsh?.client?.inject) && pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale') && pkg.exports['./client'] === './lib/client.js')

// ---- sidebar seams (snippet + generated client must agree) ----------------
check('seam: container-row click selects { orgId, rowId, kind, label } (org rowId "")',
  snippet.includes('orgStore.selectRow({ orgId: d.orgId, rowId: isOrg ? "" : d.kind === "dock" ? d.slug : "projects/" + d.slug, kind: d.kind, label:') && sidebarClient.includes('kind: d.kind, label: d.label || d.slug || d.orgId'))
check('seam: a workspace dock click (stock row → ARXA_SELECT_WS) is tagged kind dock so Notes/Meetings/Account/Communications show their dashboard; deeper workspaces stay leaf picks',
  snippet.includes('orgStore.selectRow({ orgId, rowId: ws, kind: "dock", label });') && snippet.includes('if (ws.includes("/")) { orgStore.selectRow({ orgId, rowId: ws }); return; }'))
check('seam: CTA levers refuse an empty rowId (org selection never enables New Session)',
  snippet.includes('if (!sel || !sel.rowId) return false;') && snippet.includes('if (!sel || !sel.rowId) return orgT("newSession.selectFirst");'))
check('seam: hero guide renders window.__ARXA_DASHBOARD__.Root for org|dock|project while unbound, guide otherwise',
  snippet.includes('const showDash = unbound && freestyle.ui.activeTab !== "freestyle" && !!sel && (sel.kind === "org" || sel.kind === "dock" || sel.kind === "project") && !!(dash && typeof dash.Root === "function");') && snippet.includes('"data-arxa-dashboard-seat": ""') && snippet.includes('if (unbound) return (0, react_jsx_runtime.jsxs)("div", {'))
check('seam: hero guide marks the stack data-arxa-dashboard and clears both marks on unmount',
  snippet.includes('if (showDash) stack.setAttribute("data-arxa-dashboard", "");') && snippet.includes('stack.removeAttribute("data-arxa-dashboard"); };'))
check('seam: generated client carries the seam (regen ran)', sidebarClient.includes('data-arxa-dashboard-seat') && sidebarClient.includes('showDash'))

// ---- sessions (D13, 2026-09-09) ------------------------------------------
check('host: verbs row.sessions + session.summary ride the sidebar host\'s sessionsOf lister (registry ⋈ dsh live), and degrade with a reason',
  host.includes("'row.sessions': async") && host.includes("'session.summary': async") && host.includes('sb.sessionsOf(oc.l, org)')
  && host.includes("reason: 'unavailable'") && host.includes("reason: 'no-conversation'") && host.includes("reason: 'no-projection'") && host.includes("throw new Error('session-not-found')"))
check('host: dsh faces are optional ctx.get reads (sessions, sessionProjections, sessionPersistence) — never inject, never a boot blocker',
  host.includes("face('sessions')") && host.includes("face('sessionProjections')") && host.includes("face('sessionPersistence')") && host.includes("export const inject = ['webServer']"))
check('host: summary = FACTS (goal/todos units + tool/call surface events via sessionQuery.readSurface), never transcript text, log never decoded',
  host.includes('summaryFromValues(v.values)') && host.includes('activityFromEvents(surface && surface.events)') && host.includes("face('sessionQuery')") && !host.includes('zstd') && !host.includes('listEvents'))
{
  const rows = [
    { id: 'a', project: null, workspace: 'notes' },
    { id: 'b', project: null, workspace: 'notes/deep' },
    { id: 'c', project: 'topo', workspace: 'projects/topo/design' },
    { id: 'd', project: null, workspace: 'meetings' },
    { id: 'e', project: null, workspace: null },
  ]
  const ids = (r) => r.map((x) => x.id).join('')
  check('scopeSessions: org row → every row', ids(scopeSessions(rows, { kind: 'org', name: 'X' })) === 'abcde')
  check('scopeSessions: category row → its workspace and sub-workspaces only', ids(scopeSessions(rows, { kind: 'category', name: 'notes' })) === 'ab')
  check('scopeSessions: projects category → project-scoped rows only', ids(scopeSessions(rows, { kind: 'category', name: 'projects' })) === 'c')
  check('scopeSessions: project row → that project only', ids(scopeSessions(rows, { kind: 'project', name: 'topo' })) === 'c' && ids(scopeSessions(rows, { kind: 'project', name: 'other' })) === '')
  check('scopeSessions: junk input → empty, never throws', ids(scopeSessions(null, { kind: 'category', name: 'notes' })) === '' && ids(scopeSessions([null, 1], { kind: 'category', name: 'notes' })) === '')
}
check('client (step 4.5): the Sessions band spans the whole bento and renders one REAL button per row, with the name on the spine and the full name still in aria-label/title',
  client.includes("h(Card, { span: '12', hook: 'sessions'") && client.includes("'data-arxa-dashboard-session': row.id") && client.includes("'aria-expanded': selected ? 'true' : 'false'")
  && client.includes("'aria-label': row.name,") && client.includes("className: 'aXa_db_bankName'"))
check('client: click = expand → session.summary fetched once per expand, a facts grid (goal, last done, next, files, commands, tools) + Open button — no prompt/response text',
  client.includes("postAction(ROUTE, 'session.summary', { orgId, sessionId: row.id })") && client.includes("'data-arxa-dashboard-summary': row.id") && client.includes("'data-arxa-dashboard-open': row.id") && client.includes("'data-arxa-dashboard-facts': ''")
  && client.includes("fact('facts.files'") && client.includes("fact('facts.lastCommand'") && !client.includes('turn.prompt') && !client.includes('turn.response'))
check('client: layered surfaces — stat card layer-1, session card layer-2, expanded/hover layer-3 (operator ask 2026-09-09: contrast step)',
  client.includes('background:var(--dsw-alias-bg-layer-1)') && client.includes('background:var(--dsw-alias-bg-layer-2)') && client.includes("[aria-expanded='true']{grid-column:1/-1;background:var(--dsw-alias-bg-layer-3)"))
check('client: Open runs the sidebar\'s openCreated flow (server session.open → reveal → focus) — no private open path',
  client.includes('bridge.openCreated(sel.orgId, id)') && !client.includes("action: 'session.open'"))
check('client: absent metrics render as nothing, never as zero (zero is a claim) — the card face shows an em dash where there is no token figure',
  client.includes("if (stats) meta.push(t('sessions.turns'") && client.includes("typeof fig.tokens === 'number' ? fmtNum(fig.tokens) : '—'") && !client.includes("stats ? stats.turns : 0"))
check('seam: the sidebar host publishes sessionsOf for the dashboard (registry ⋈ dsh live, the tree\'s own lister)',
  readFileSync(join(root, 'plugins', 'arxa-sidebar', 'lib', 'index.js'), 'utf8').includes('sessionsOf: (l, org) => orgSessions(l, org),'))
check('seam (D12): boot lands on the last-selected dashboard — snippet persists selectRow, restores after the org list settles, no session resume',
  snippet.includes('const LAST_ROW_KEY = "arxa.dashboard.last";') && snippet.includes('window.localStorage.getItem(LAST_ROW_KEY)') && !snippet.includes('dropIfEmpty: true')
  && sidebarClient.includes('window.localStorage.setItem(LAST_ROW_KEY'))
check('client: an empty row shows SAMPLE cards (client-only, inline summary, Open disabled) so the flow is visible before real sessions exist',
  client.includes('const sampleRows = () =>') && client.includes("if (row.sample) { setSum({ summary: row.summary, activity: row.activity }); return undefined }") && client.includes('disabled: !!row.sample') && client.includes("'data-arxa-dashboard-samples': ''") && client.includes('showSamples ? sampleRows() : realRows'))
check('seam: NO dashboard while the Freestyle tab is active (org dashboard stayed up after switching tabs, found live 2026-09-09)',
  snippet.includes('const showDash = unbound && freestyle.ui.activeTab !== "freestyle" && !!sel'))

// ---- registration ----------------------------------------------------------
// ---- step 3: tier-1 Activity + Repository cards (plan §4) ----
const repo = readFileSync(join(here, 'lib', 'repo.js'), 'utf8')
check('host (step 3): row.stats carries activity + repository from lib/repo.js through the sidebar\'s git-workspace import (allowFail, timeout), range from arg, unavailable shape without git',
  host.includes("from './repo.js'") && host.includes('sb.importGitWorkspace()') && host.includes('allowFail: true, timeout: 8000') && host.includes('sinceFor(arg?.range)') && host.includes("activity: { reason: 'unavailable' }, repository: { reason: 'unavailable' }"))
check('repo.js: pure over an injected runner — no child_process, no git binary lookup, degrades on null output',
  !repo.includes('child_process') && !repo.includes('execFile') && repo.includes('if (!out) continue') && repo.includes('--exclude-standard') && repo.includes('--untracked-files=all'))
check('repo.js: org rolls up projects/<x>/.git, category = pathspec on the org repo, project = own repo',
  repo.includes("existsSync(join(projects, n, '.git'))") && repo.includes("pathspec: row.name") && repo.includes("r.pathspec ? ['--', r.pathspec] : []"))
check('client (step 3): Activity = streak numbers + 13-week heatmap + weekly bars as inline SVG with theme tokens and native title tooltips (D6), no chart library',
  client.includes("'data-arxa-dashboard-heatmap': ''") && client.includes("'data-arxa-dashboard-bars': ''") && client.includes("h('title', null, t('activity.cell'") && client.includes('fill:var(--dsw-alias-state-business-primary)') && !/uplot|chart\.js|d3/i.test(client))
check('client (step 3): Repository = facts grid (files, folders, branches, contributors, last commit, uncommitted), org roll-up count only when > 1 repo',
  client.includes("'data-arxa-dashboard-repo': ''") && client.includes("['repo.files', fmtNum(r.files)]") && client.includes("['repo.repos', r.repos > 1 ? String(r.repos) : null]"))
check('client (step 3): header shows created / updated; range toggle 30/90/365/all refetches row.stats',
  client.includes("'data-arxa-dashboard-times': ''") && client.includes("'data-arxa-dashboard-range': String(range)") && client.includes("postAction(ROUTE, 'row.stats', { ...arg, range })") && client.includes("}, [sel.orgId, sel.rowId, tick, range])"))
// Steps 5 and 6 filled the last two placeholders. Nothing in the bento may say
// "soon" any more — six cards, six bodies. (Deeper pins: selftest.delivery.mjs,
// selftest.engine.mjs.)
check('client (steps 5+6): every bento card renders a body — the "soon" placeholder is gone from the whole client',
  !client.includes("t('group.soon')") && client.includes('h(DeliveryBody, { d: delivery })') && client.includes('h(EngineBody, { e: engine })'))
check('client (step 3): unavailable / error → a muted line, never zeros claimed',
  client.includes("if (a.reason) return h('div', { className: 'aXa_db_muted' }, t('activity.unavailable'))") && client.includes("if (r.reason) return h('div', { className: 'aXa_db_muted' }, t('activity.unavailable'))"))

// ---- step 4: tier-2 figures + focus heartbeat (plan §4, D10) --------------
const sidebarHostSrc = readFileSync(join(root, 'plugins', 'arxa-sidebar', 'lib', 'index.js'), 'utf8')
check('host (step 4): session.focus proves the id in THIS org\'s registry, then writes focusMs through git-workspace\'s own annotateSession — never a browser path',
  host.includes("'session.focus': async") && host.includes("resolveRow(orgs, { orgId: arg?.orgId, rowId: '' })") && host.includes('gw.annotateSession(row.orgPath, sessionId, { focusMs })')
  && host.includes("throw new Error('session-not-found')") && host.includes("if (!gw || typeof gw.annotateSession !== 'function') return { reason: 'unavailable' }"))
check('host (step 4): the delta is validated by the exported focusTotal (refused over the cap, never clamped) and rows carry focusMs as null when absent',
  host.includes('export function focusTotal(prev, deltaMs)') && host.includes("throw new Error('focus-delta-refused')") && !host.includes('Math.min(deltaMs')
  && host.includes('focusMs: typeof s.focusMs === \'number\' && Number.isFinite(s.focusMs) && s.focusMs > 0 ? s.focusMs : null'))
check('seam (step 4): the sidebar\'s session shape carries focusMs (a picked-field shape, so an unlisted field never reaches the dashboard)',
  sidebarHostSrc.includes("focusMs: typeof s.focusMs === 'number' && Number.isFinite(s.focusMs) ? s.focusMs : null,"))
check('seam (step 4): the bridge publishes boundSession() — the dashboard is never up while a session is bound, so the heartbeat has no other way to know',
  snippet.includes('boundSession() {') && snippet.includes('const snap = arxaListGet();') && snippet.includes('(x.id === cur || x.dshSessionId === cur)') && sidebarClient.includes('boundSession()'))
check('seam (step 4.5): the bridge publishes orgRows() — the nav pills read the org plus its five FIXED docks, and a failed tree degrades to [] rather than breaking the dashboard',
  snippet.includes('orgRows(orgId) {') && snippet.includes('if (!o) return [];') && snippet.includes('{ rowId: "", kind: "org", label: o.name }')
  && snippet.includes('label: orgT("tree.dock." + d.slug),') && sidebarClient.includes('orgRows('))
check('seam (step 4.5): the bridge publishes selectRow(), delegating to the store so highlight, CTA target and boot landing move together — and a caller-shaped selection is REFUSED, not stored',
  snippet.includes('selectRow(sel) {') && snippet.includes('if (!sel || typeof sel.orgId !== "string" || sel.orgId === "") return false;')
  && snippet.includes('if (typeof sel.rowId !== "string") return false;')
  && snippet.includes('if (!orgStore.get().orgs.some((o) => o && o.id === sel.orgId)) return false;')
  && snippet.includes('orgStore.selectRow({ orgId: sel.orgId, rowId: sel.rowId, kind: sel.kind, label: sel.label });') && sidebarClient.includes('selectRow(sel)'))
check('client (step 4): the heartbeat rides the sidebar\'s own state event + visibilitychange (the client cordis runtime has no timer service), posts session.focus, and both listeners come off on dispose',
  client.includes("window.addEventListener('arxa-sidebar-state', sample)") && client.includes("document.addEventListener('visibilitychange', sample)")
  && client.includes("postAction(ROUTE, 'session.focus'") && client.includes("window.removeEventListener('arxa-sidebar-state', sample)") && client.includes("'arxa-dashboard: focus heartbeat'"))
check('client (step 4): hidden time and slept-machine gaps are never claimed (sub-second and over-cap slices dropped)',
  client.includes("document.visibilityState === 'visible' ? bound() : null") && client.includes('if (ms < 1000 || ms > FOCUS_MAX_MS) return'))
check('client (step 4): tier-2 figures are per session — tokens, model, tool, wall span, focus — and absent units stay null',
  client.includes('const figuresOf = (row) =>') && client.includes('engine: st ? st.llmMs + st.toolMs : null') && client.includes('wall: Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : null')
  && client.includes("focus: typeof row.focusMs === 'number' && row.focusMs > 0 ? row.focusMs : null"))
check('client (step 4): each card draws tokens / engine / focus bars scaled across the card, and the expanded facts add model, tool, wall and token split',
  client.includes("fact('facts.model'") && client.includes("fact('facts.tool'") && client.includes("fact('facts.model', fmtMs(fig.model))")
  && client.includes("fact('facts.wall', fmtMs(fig.wall))") && client.includes("fact('facts.tokensCache'"))
check('client (step 4.5): the Sessions band heads with state CHIPS + row totals — three integers never earned a chart (Q6), and the ring moved to Time',
  /function SessionsHead\(\{ rows[,}]/.test(client) && client.includes("'data-arxa-dashboard-states': String(total)") && client.includes("'data-arxa-dashboard-totals': ''")
  && !client.includes("'data-arxa-dashboard-donut': String(total)"))
check('client: no fact labels itself with a PARAMETERISED template — the key column renders t(key) with no params, so a "{done} done" label is a raw template on screen (seen through the lens 2026-09-10)',
  (() => {
    const keys = [...client.matchAll(/fact\('([^']+)'/g)].map((m) => m[1])
    const tmpl = [...client.matchAll(/'(facts\.[^']+)': '([^']*\{[^']*)'/g)].map((m) => m[1])
    return keys.every((k) => !tmpl.includes(k))
  })())
check('client (step 4.5): ONE rail primitive serves the pills, the hand and card content on either axis, and it contains its own overscroll (a trackpad swipe must not fire the shell\'s back-navigation)',
  /const Rail = \(\{ axis, hook, label, extra[,)]/.test(client) && client.includes(".aXa_db_rail{display:flex;gap:10px;min-width:0;overscroll-behavior-x:contain")
  && client.includes('overscroll-behavior-y:contain') && client.includes("scroll-snap-type:x proximity") && client.includes("scroll-snap-type:y proximity")
  && client.includes("h(Rail, { axis: scroll,") && /h\(Rail, \{\s*\n?\s*axis: 'x', hook: 'hand'/.test(client) && client.includes("h(Rail, { axis: 'x', hook: 'nav'"))
check('client (step 4.5): the bento is 12 columns and every rung sums to 12 — no rule leaves a hole, and rows stretch to one height with the last block filling',
  client.includes('.aXa_db_bento{display:grid;grid-template-columns:repeat(12,1fr)') && client.includes('align-items:stretch')
  && client.includes('.aXa_db_span5{grid-column:span 5}.aXa_db_span4{grid-column:span 4}.aXa_db_span3{grid-column:span 3}')
  && client.includes('@media (max-width:699px){.aXa_db_span5,.aXa_db_span4,.aXa_db_span3,.aXa_db_span6,.aXa_db_span6Wide{grid-column:span 12}}')
  && client.includes('.aXa_db_bentoBody>:last-child:not(:first-child){margin-top:auto}'))
check('client (step 4.5, revised): the session rail is a PLAIN carousel — cards sit side by side on the rail gap, nothing overlaps, and no card is drawn as a peek',
  !client.includes('margin-left:-28px') && !client.includes('aXa_db_spine') && !client.includes('writing-mode:vertical-rl')
  && client.includes('.aXa_db_hand{gap:12px') && client.includes('.aXa_db_bank{position:relative;flex:none;display:flex;flex-direction:column;width:min(264px,100%)'))
check('client (step 4.5, revised): the front card is a SELECTION fact, not a scroll fact — no view() timeline is left to vanish on the shipping WebKit',
  client.includes('.aXa_db_bankOn{outline:2px solid var(--dsw-alias-state-business-primary)') && client.includes('.aXa_db_bank:hover{transform:translateY(-2px)')
  && !client.includes('animation-timeline:view(inline)') && !client.includes('aXa_db_bank-lift'))
check('client (step 4.5, revised twice): the card face is name, chips and the tokens figure — the bottom bars are GONE (operator, 2026-09-10), and the engine/wall/focus figures live in the panel instead of on the face',
  client.includes("className: 'aXa_db_bankName'") && client.includes("className: 'aXa_db_bankChips'") && client.includes("className: 'aXa_db_bankFig'")
  && !/stripe|sessionbars|scaleOf/.test(client)
  && client.includes("fact('facts.model'") && client.includes("fact('facts.tool'") && client.includes("fact('facts.wall'") && client.includes("fact('facts.focus'"))
check('seam (step 4.5): the sidebar tree MARKS the selected row with the accent — selectedRowId existed since D2 and nothing read it, so navigation left every row unselected',
  snippet.includes('const selfRowId = isOrg ? "" : d.kind === "dock" ? d.slug : "projects/" + d.slug;')
  && snippet.includes('sel.orgId === d.orgId && (sel.rowId ?? "") === selfRowId')
  && snippet.includes('"data-arxa-row-selected": isSelected ? "" : void 0,') && snippet.includes('"aria-current": isSelected ? "true" : void 0,')
  && snippet.includes('color: isSelected ? "var(--dsw-alias-state-business-primary)" : void 0,')
  && sidebarClient.includes('data-arxa-row-selected'))
check('client (step 4.5): motion is the house grammar, every move is killed under prefers-reduced-motion, and nothing rides a timeline the shipping WebKit might not have',
  client.includes('@media (prefers-reduced-motion:reduce){.aXa_db_bentoCard,.aXa_db_navPill,.aXa_db_bank,.aXa_db_panel{animation:none;transition:none}.aXa_db_bentoCard:hover,.aXa_db_bank:hover{transform:none}}')
  && client.includes('.aXa_db_bento>:nth-child(2){animation-delay:30ms}') && !/requestAnimationFrame|setInterval\(/.test(client)
  && !client.includes('animation-timeline'))
check('client (step 4.5): the Time gauge rings MODEL vs TOOL only — focus is a different clock and adding it in would total two overlapping axes',
  client.includes('function TimeBody({ rows })') && client.includes("const engine = model + tool") && client.includes("[['model', model], ['tool', tool]]")
  && client.includes("'data-arxa-dashboard-donut': String(engine)") && client.includes("'data-arxa-dashboard-focus': String(focus)")
  && client.includes("className: 'aXa_db_arc'") && client.includes('.aXa_db_arc{fill:none;stroke:var(--dsw-alias-state-business-primary)}'))
check('client (step 4.5): the delta chip compares this window with the PREVIOUS EQUAL window, and reads nothing when there is no baseline to divide by',
  client.includes('const prev = typeof a.prevCommits === \'number\' ? a.prevCommits : null') && client.includes('prev !== null && prev > 0 ? Math.round(100 * (a.commits - prev) / prev) : null')
  && host.includes('previousWindow') === false && readFileSync(join(here, 'lib', 'repo.js'), 'utf8').includes('if (!since || !Number.isFinite(n) || n <= 0) return null'))
check('client (step 4.5): the weekly series is drawn as the reference area line with ONE label pill on the peak week — same data, no invented points',
  client.includes("className: 'aXa_db_area'") && client.includes("className: 'aXa_db_line'") && client.includes("const peak = weeks.length ? weeks.indexOf(Math.max(...weeks)) : -1")
  && client.includes("'data-arxa-dashboard-line': String(weeks.length)"))

check('registration: cordis.patch.yml inserts arxa-dashboard AFTER arxa-git-card',
  patch.indexOf('id: arxa-dashboard') > patch.indexOf('id: arxa-git-card') && patch.includes('name: arxa-dashboard'))
check('registration: bin/arxa-studio.mjs copies the plugin and lists it BY NAME',
  launcher.includes("['arxa-dashboard', dashboardDir]") && /BY_NAME_PLUGINS = \[[^\]]*'arxa-dashboard'/.test(launcher))

// ---- step 7: filters, drill-downs, tooltips, keyboard focus order ----------
check('step 7: the state counts ARE the filter — a chip is a pressed-state button, not decoration',
  client.includes("'data-arxa-dashboard-filter': k") && client.includes("'aria-pressed': state === k ? 'true' : 'false'") && client.includes('onClick: () => onState(state === k ? null : k)'))
check('step 7: the head keeps counting EVERY session while only the carousel is filtered — a filtered view still says what it is hiding',
  client.includes('const shown = stateFilter ? rows.filter((x) => x.state === stateFilter) : rows') && client.includes('h(SessionsHead, { rows, state: stateFilter, onState: setStateFilter })'))
check('step 7: a filter that matches nothing says so rather than drawing an empty rail',
  client.includes("t('sessions.noneInState'"))
check('step 7: the filter and the open panel are cleared when the row changes — a filter belongs to the row it was set on',
  /setStateFilter\(null\)\s*\n\s*setOpenId\(null\)/.test(client))
check('step 7: keyboard focus order — the rail is one tab stop, arrows walk the cards, Home/End jump, Escape closes the summary',
  /ArrowRight: 1, ArrowLeft: -1/.test(client) && client.includes("ev.key === 'Escape'") && client.includes("ev.key === 'Home' ? 0 : ev.key === 'End'") && client.includes('els[next].focus()'))
check('step 7: the Rail primitive forwards the handler rather than the carousel growing its own scroller',
  /const Rail = \(\{ axis, hook, label, extra, onKeyDown, children \}\)/.test(client))
check('step 7: every interactive chip carries a tooltip naming what clicking does',
  client.includes("title: t('sessions.filterNote')"))
check('step 7: the new keys exist in all three dictionaries',
  ['sessions.filterNote', 'sessions.noneInState'].every((k) => (client.match(new RegExp("'" + k.replace(/\./g, '\\.') + "':", 'g')) || []).length === 3))

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
