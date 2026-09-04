// gen-workspace — compose plugins/arxa-sidebar/lib/client.js (the WHOLE
// sidebar browser half) from two stock dsh bundles: the shell part from
// scripts/gen-sidebar.mjs plus @deepseek-ai/dsh-client-ui-workspace
// lib/client.js transformed into the ORGANISATIONS rows world
// (docs/plans/sidebar-org-rethink.md). Deltas, stock tree kept whole:
//   1. identity: id/tag arxa-sidebar-workspace; class prefixes qDHVXG_/
//      YDXeBa_/_G5b-a_ become aXa_wsb_/aXa_wsr_/aXa_wsp_
//   2. rows data faces: the arxa region snippet (stores, hooks, Trash,
//      locale relabels) spliced before the last region; stock apply()
//      tail REPLACED by the org-backed one
//   3. the + affordance: header gate + add entry unconditional; the
//      directory-picker flow opens the in-bundle create-organisation modal
//      (Q3) — window.prompt is unusable in the Tauri WKWebView
//   4. the org-row menu gains Trash on the open org row (Q6)
//   4b. T4 v2 (2026-09-01, user direction): files live INSIDE the tree —
//       ARXA_LEAF_FILES mounts the region's ArxaDirRows under each leaf
//       row (full listing) and OrgContainerRow carries its own files-only
//       listing; the separate tail section is gone.
// rc-bump policy: a dsh bump is an explicit re-transform — update
// DSH_VERSION here and in gen-sidebar.mjs, refresh anchors/snippets if the
// stock shape moved, run this script, then the lens gate before committing.
//
// Usage: node scripts/gen-workspace.mjs [--write]   (default: stdout)
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const DSH_VERSION = '0.1.2-rc.1'
const T = (n) => '\t'.repeat(n)
const stockPath = join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js')
const regionPath = join(root, 'plugins', 'arxa-sidebar', 'lib', 'workspace-region.snippet.txt')

// ---- shell part (gen-sidebar prints it to stdout) -------------------------
const shellPart = execFileSync(process.execPath, [join(root, 'scripts', 'gen-sidebar.mjs')], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})

// ---- workspace part --------------------------------------------------------
let out = readFileSync(stockPath, 'utf8')

// 1. drop sourcemap pointer
out = out.replace(/[\/][\/]#[ ]sourceMappingURL=client[.]js[.]map\s*$/m, '')

// 2. identity renames
out = out.replace('id: "@deepseek-ai/dsh-client-ui-workspace",', 'id: "arxa-sidebar-workspace",')
out = out.replaceAll('bhn1Oq_', 'aXa_wsb_')
out = out.replaceAll('YDXeBa_', 'aXa_wsr_')
out = out.replaceAll('_G5b-a_', 'aXa_wsp_')
for (const mod of ['Rows', 'WorkspacePicker', 'WorkspaceBrowser']) {
  out = out.replaceAll('"@deepseek-ai/dsh-client-ui-workspace/' + mod + '.module.css"', '"arxa-sidebar-workspace/' + mod + '.module.css"')
}
out = out.replaceAll('tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-workspace";', 'tag.dataset.plugin = "arxa-sidebar-workspace";')

// 3. header +: unconditional (was gated on the native directory flow).
const HEADER_GATE = 'directoryFlowAvailable && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {'
if (!out.includes(HEADER_GATE)) throw new Error('header gate anchor missing — stock shape moved?')
out = out.replace(HEADER_GATE, 'true && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {')

// 4. add-menu entry: unconditional (the prompt splice below owns the flow).
out = out.replace('const addEntries = flowAvailable ? [{', 'const addEntries = [{')
const ADD_END = T(3) + '}] : [];'
if (!out.includes(ADD_END)) throw new Error('addEntries tail anchor missing — stock shape moved?')
out = out.replace(ADD_END, T(3) + '}];')

// 5. adopt-directory flow becomes a name prompt (orgs are created, not adopted; Q3).
const FLOW_ANCHOR = [
  'const openDirectoryFlow = (0, react.useCallback)(() => {',
  T(4) + 'onClose();',
  T(4) + 'setErrorOpen(false);',
  T(4) + 'setModalError(null);',
  T(4) + 'setFlowOpen(true);',
  T(3) + '}, [onClose]);',
].join('\n')
if (!out.includes(FLOW_ANCHOR)) throw new Error('openDirectoryFlow anchor missing — stock shape moved?')
const FLOW_SPLICED = [
  'const openDirectoryFlow = (0, react.useCallback)(() => {',
  T(4) + 'onClose();',
  T(4) + '// Organisations world (Q3): scaffold-by-name runs in the in-bundle',
  T(4) + '// create-organisation modal (org region). window.prompt is a silent',
  T(4) + '// no-op in WKWebView (the Tauri shell) — never prompt. The event, not',
  T(4) + '// a store emit: emits here tick the shell into re-firing this very',
  T(4) + '// auto-open effect — an emit loop ending in React #185.',
  T(4) + 'window.dispatchEvent(new Event("arxa-create-org"));',
  T(3) + '}, [onClose]);',
].join('\n')
out = out.replace(FLOW_ANCHOR, FLOW_SPLICED)

// 6. v2 leaf rows (grilled 2026-08-30): the stock group div gains an
//    indent-by-depth style and hides entirely when an ancestor
//    container is collapsed (display gating — identity never churns).
const GROUP_OPEN = [
  T(7) + 'return (0, react_jsx_runtime.jsxs)("div", {',
  T(8) + 'className: clsx(WorkspaceBrowser_module_css_default.groupSection, workspaceMarker === "before" && WorkspaceBrowser_module_css_default.workspaceDropBefore, workspaceMarker === "after" && WorkspaceBrowser_module_css_default.workspaceDropAfter),',
].join('\n')
if (!out.includes(GROUP_OPEN) || out.indexOf(GROUP_OPEN) !== out.lastIndexOf(GROUP_OPEN)) throw new Error('group open anchor missing/dup — stock shape moved?')
out = out.replace(GROUP_OPEN, [
  T(7) + 'return (0, react_jsx_runtime.jsxs)("div", {',
  T(8) + 'style: { paddingLeft: ARXA_WS_INDENT(group.workspaceId), display: ARXA_WS_HIDDEN(group.workspaceId) ? "none" : void 0 },',
  T(8) + 'className: clsx(WorkspaceBrowser_module_css_default.groupSection, workspaceMarker === "before" && WorkspaceBrowser_module_css_default.workspaceDropBefore, workspaceMarker === "after" && WorkspaceBrowser_module_css_default.workspaceDropAfter),',
].join('\n'))

// 6b. (v2 collapse fix, 2026-08-30): container rows (org / dock /
//     project) render inside their OWN pseudo group (region: orgItems
//     pushes one pseudo workspace per container; buildEmit keys each
//     row there) and the stock folder row is SUPPRESSED on those groups
//     — the OrgContainerRow is the row. v2 anchored container rows at
//     their first LEAF's group; collapsing the container hid that group
//     (leafHidden) and the row vanished with it — tapping an org
//     removed it from the tree entirely, org by org.
const GROUP_KIDS = [
  T(8) + 'children: [',
  T(9) + '(0, react_jsx_runtime.jsx)(ProjectRowItem, {',
].join('\n')
if (!out.includes(GROUP_KIDS) || out.indexOf(GROUP_KIDS) !== out.lastIndexOf(GROUP_KIDS)) throw new Error('group children anchor missing/dup — stock shape moved?')
out = out.replace(GROUP_KIDS, [
  T(8) + 'children: [',
  T(9) + '...ARXA_CONTAINER_ROWS(group.workspaceId),',
  T(9) + '...(ARXA_IS_CONTAINER_GROUP(group.workspaceId) ? [] : [(0, react_jsx_runtime.jsx)(ProjectRowItem, {',
].join('\n'))
// …and close the conditional spread after the item expression — the
// sessions map line is the unique witness that the item just ended.
// dsh 0.1.2-rc.1 (2026-09-05): the map line changed shape — the stock
// overflow control became collapsedSessionRows() (blank sessions ride
// free of COLLAPSED_SESSION_LIMIT), so the witness is the new
// sessionsExpanded/collapsed.rows select. Uniqueness re-verified.
const GROUP_ITEM_END = [
  T(9) + '}),',
  T(9) + '(sessionsExpanded ? group.sessions : collapsed.rows).map((node) => {',
].join('\n')
if (!out.includes(GROUP_ITEM_END) || out.indexOf(GROUP_ITEM_END) !== out.lastIndexOf(GROUP_ITEM_END)) throw new Error('group item end anchor missing/dup — stock shape moved?')
out = out.replace(GROUP_ITEM_END, [
  T(9) + '})]),',
  T(9) + 'ARXA_LEAF_FILES(group),',
  T(9) + '(sessionsExpanded ? group.sessions : collapsed.rows).map((node) => {',
].join('\n'))

// 6c. leaf row click = stock expand/collapse AND selection (the New
//     Session CTA targets the selected workspace row; region helper
//     parses the composite id). The org-row open/switch rider is GONE —
//     org rows are containers now (click = collapse, grilled decision).
const ROW_TOGGLE = 'onClick: onToggle,'
if (!out.includes(ROW_TOGGLE) || out.indexOf(ROW_TOGGLE) !== out.lastIndexOf(ROW_TOGGLE)) throw new Error('row toggle anchor missing/dup — stock shape moved?')
out = out.replace(ROW_TOGGLE, 'onClick: () => { onToggle(); ARXA_SELECT_WS(row.workspaceId); },')

// 6d. hide the stock workspace-row ellipsis menu on leaf rows: fixed
//     folders are neither renamable nor deletable; org actions live on
//     the org container row's own menu (region OrgContainerRow).
const MENU_ANCHOR = 'actions !== void 0 && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {'
if (!out.includes(MENU_ANCHOR) || out.indexOf(MENU_ANCHOR) !== out.lastIndexOf(MENU_ANCHOR)) throw new Error('menu anchor missing/dup — stock shape moved?')
out = out.replace(MENU_ANCHOR, 'false && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {')

// 6e. (Q6, grilled 2026-09-02) the browser stashes the view store's
//     actions in the region's `arxaViewActions` so orgStore.revealSession
//     can open the stock leaf group (setGroupExpanded) from outside React.
const VIEW_ACTIONS = 'const groupExpansion = useStore((s) => s.groupExpansion);'
if (!out.includes(VIEW_ACTIONS) || out.indexOf(VIEW_ACTIONS) !== out.lastIndexOf(VIEW_ACTIONS)) throw new Error('view actions anchor missing/dup — stock shape moved?')
out = out.replace(VIEW_ACTIONS, VIEW_ACTIONS + '\n' + T(3) + 'arxaViewActions = actions;')

// 6f. (Q6) every session row carries its id in the DOM so revealSession can
//     scrollIntoView the resumed/opened row once the tree has mounted it.
const SESSION_ROW = 'className: clsx(Rows_module_css_default.sessionRow, selected && Rows_module_css_default.selected, menuOpen && Rows_module_css_default.menuOpen,'
if (!out.includes(SESSION_ROW) || out.indexOf(SESSION_ROW) !== out.lastIndexOf(SESSION_ROW)) throw new Error('session row anchor missing/dup — stock shape moved?')
out = out.replace(SESSION_ROW, '"data-session-id": node.id, ' + SESSION_ROW)

// 6z. (D83) the trash surface rides the GROUPED tree's tail: injected as
//      the last child of the treeBody (after the org-groups list, before
//      the fade) so it sits DIRECTLY under the last org row always —
//      mounting it after the whole stock browser left it stranded below
//      the sessions region once an org is open. Flat "In one list" mode
//      has no org rows — no trash there.
const TREE_TAIL = [
	T(7) + '}, group.key);',
	T(6) + '})]',
	T(5) + '}),',
	T(5) + '(0, react_jsx_runtime.jsx)("span", { className: WorkspaceBrowser_module_css_default.fade })',
].join('\n')
if (!out.includes(TREE_TAIL) || out.indexOf(TREE_TAIL) !== out.lastIndexOf(TREE_TAIL)) throw new Error('tree tail anchor missing/dup — stock shape moved?')
out = out.replace(TREE_TAIL, [
	T(7) + '}, group.key);',
	T(6) + '}), ARXA_TRASH_AFTER_ORGS()]',
	T(5) + '}),',
	T(5) + '(0, react_jsx_runtime.jsx)("span", { className: WorkspaceBrowser_module_css_default.fade })',
].join('\n'))

// 6e. (default-collapsed, 2026-08-30): v2 auto-expanded every workspace
//     row WITH sessions on mount. Removed — all folders start collapsed
//     and open only where the user opens them; a pre-expanded session
//     group would ambush the drill-down (open a dock and sessions pop
//     open unbidden). Stock groupExpansion is untouched.


// 7. (menu routing) — gone with the hidden ellipsis menu (see 6d).

// 8. row actions gain the trash toggle.
const DEL_ACT = [
  T(11) + 'delete: () => {',
  T(12) + '/* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */',
  T(12) + 'if (group.workspaceId !== void 0) onDeleteRequest(group.workspaceId, group.label);',
  T(11) + '}',
].join('\n')
out = out.replace(DEL_ACT, DEL_ACT + ',\n' + T(10) + 'trash: () => orgStore.toggleTrash()' + ',\n' + T(10) + 'open: () => { orgStore.mutate("org.open", { orgId: group.workspaceId }).catch(() => {}); }')

// 9. the arxa region before the last stock region (stores, hooks, trash,
//    relabels) — references react/clsx/Rows css/WorkspaceBrowser, all in scope.
const LAST_REGION = T(2) + '//#region lib/types/client/index.js'
if (!out.includes(LAST_REGION)) throw new Error('last region anchor missing — stock shape moved?')
const region = readFileSync(regionPath, 'utf8').replace(/\n$/, '')
out = out.replace(LAST_REGION, region + '\n' + LAST_REGION)

// 10. replace the stock apply tail with the org-backed one. The stock
//     WorkspacePicker (conversation hero) registration dies with it — a
//     session lives in exactly one org; cross-org move is not a model concept.
const APPLY_HEAD = T(2) + 'function apply(ctx) {'
const EXPORTS = T(2) + 'exports.apply = apply;'
const headAt = out.indexOf(APPLY_HEAD)
const expAt = out.indexOf(EXPORTS)
if (headAt < 0 || expAt < 0 || expAt < headAt) throw new Error('apply tail anchors missing — stock shape moved?')
const ourApply = [
  T(2) + 'function apply(ctx) {',
  T(3) + '// Locale world (Phase 0/2, conformance plan): arxa ships en/pl/fr —',
  T(3) + '// zhOver is DELETED (the stock zh dicts ride along as dead weight',
  T(3) + '// and are never selected); plOver/frOver are sparse override dicts',
  T(3) + '// — the lookup chain falls back per-key to en (enOver merged), so a',
  T(3) + '// missing translation shows English, never a raw key.',
  T(3) + 'ctx.effect(() => ctx.locale.register(NS, { zh, en: { ...en, ...enOver }, pl: plOver, fr: frOver }), "arxa-sidebar-workspace: dictionaries");',
  T(3) + 'orgHostInfo = {',
  T(4) + '// dsh 0.1.2-rc.1: connection.hostDescription is gone — the host-info',
  T(4) + '// face is now the remote $host snapshot, re-read on connection/reset',
  T(4) + '// (mirrors the stock ui-workspace apply).',
  T(4) + 'getSnapshot: () => ctx.remote?.$host,',
  T(4) + 'subscribe: (listener) => ctx.on("connection/reset", listener)',
  T(3) + '};',
  T(3) + '// dsh 0.1.2-rc.1: the stock apply provideRoot\'s the workspaces hook —',
  T(3) + '// mirror it so framework-owned consumers of the root hook (and the',
  T(3) + '// slot runtime\'s standard useWorkspaces) still see a live store.',
  T(3) + 'try { ctx.slots.provideRoot({ hooks: { workspaces: ctx.get("workspaces").list } }) } catch { /* degrade */ }',
  T(3) + '// Client runtime sessions service (2026-08-30): open(id) focuses a',
  T(3) + '// conversation into the content area; clear() empties it and wipes',
  T(3) + '// the persisted selection. arxa drives the content area — resume',
  T(3) + '// opens the org session conversation like dsh; a boot with nothing',
  T(3) + '// to resume clears (stranding pre-arxa sessions stop riding along).',
  T(3) + 'try { arxaClientSessions = ctx.get("sessions") } catch { arxaClientSessions = null }',
  T(3) + '// Live cross-client propagation (2026-08-30): dsh pushes registry',
  T(3) + '// changes (archive/rename/open from ANY client) into the runtime',
  T(3) + '// stores over the live connection; the org view used to learn of',
  T(3) + '// them only on the 5s poll. Refresh on every store bump — the',
  T(3) + '// trailing debounce coalesces bursts and refresh() is sig-gated,',
  T(3) + '// so an unchanged snapshot is a no-op. The poll stays as the',
  T(3) + '// backstop for arxa-only mutations that never touch a dsh store.',
  T(3) + 'let liveRefreshTimer = 0;',
  T(3) + '// Once and for all (2026-08-30): dsh startup policy re-opens the recent',
  T(3) + '// workspace resident blank session on slow boots AFTER the bounded',
  T(3) + '// re-assert window — the rider must lose every race, not just fast',
  T(3) + '// ones. Invariant: with no user/resume open (currentSessionId null)',
  T(3) + '// the only legal bound session is an OPEN org one. Enforced on every',
  T(3) + '// store bump, forever; org/user opens win via the same guards.',
  T(3) + 'const orgDshIds = () => {',
  T(4) + 'const ids = new Set();',
  T(4) + 'const st = orgStore.get();',
  T(4) + 'for (const o of st.orgs || []) for (const x of o.sessions || []) if (x.dshSessionId && x.state === "open") ids.add(x.dshSessionId);',
  T(4) + 'return ids;',
  T(3) + '};',
  T(3) + 'const enforceNoRiders = () => {',
  T(4) + 'if (orgStore.get().currentSessionId) return;',
  T(4) + 'const snap = arxaClientSessions && arxaClientSessions.list && typeof arxaClientSessions.list.getSnapshot === "function" ? arxaClientSessions.list.getSnapshot() : null;',
  T(4) + 'const cur = snap ? snap.current : void 0;',
  T(4) + 'if (cur === void 0 || cur === null) return;',
  T(4) + 'if (orgDshIds().has(cur)) return;',
  T(4) + 'try { arxaClientSessions.clear() } catch { /* degrade */ }',
  T(3) + '};',
  T(3) + 'const liveRefresh = () => {',
  T(4) + 'if (liveRefreshTimer) return;',
  T(4) + 'liveRefreshTimer = window.setTimeout(() => { liveRefreshTimer = 0; orgStore.refresh().then(enforceNoRiders).catch(() => {}); }, 250);',
  T(3) + '};',
  T(3) + 'try { ctx.get("workspaces").list.subscribe(() => { enforceNoRiders(); liveRefresh(); }) } catch { /* degrade */ }',
  T(3) + 'try { if (arxaClientSessions && typeof arxaClientSessions.list.subscribe === "function") arxaClientSessions.list.subscribe(() => { enforceNoRiders(); liveRefresh(); }) } catch { /* degrade */ }',
  T(3) + 'const browserInjected = () => ({',
  T(4) + '// use* hooks are pinned in OrgBrowser — see the region snippet.',
  T(4) + 'startSession: (workspaceId) => {',
  T(5) + '// v2 (grilled 2026-08-30): the ONLY creation path is a workspace',
  T(5) + '// row own + — the composite id encodes org + workspace path. The',
  T(5) + '// legacy org-level fallback is GONE (it created org-root worktrees).',
  T(5) + 'const s = String(workspaceId ?? "");',
  T(5) + 'const i = s.indexOf("|");',
  T(5) + '// Close the loop like the shell CTA (found live 2026-09-02): create',
  T(5) + '// alone left the composer dead — the row landed in the tree but the',
  T(5) + '// conversation never opened until a second, manual open. Same chain',
  T(5) + '// as the `open` lever below: session.open → reveal → conversation focus.',
  T(5) + 'if (i > 0 && i < s.length - 1) orgStore.mutate("workspace.new-session", { orgId: s.slice(0, i), workspace: s.slice(i + 1) }).then((row) => {',
  T(6) + 'if (!row || typeof row.id !== "string") return;',
  T(6) + 'return orgStore.mutate("session.open", { orgId: s.slice(0, i), sessionId: row.id }).then(() => { try { orgStore.revealSession(row.id) } catch { /* presentation */ } return arxaOpenConversation(row.id); });',
  T(5) + '}).catch(() => {});',
  T(4) + '},',
  T(4) + 'open: (sessionId) => {',
  T(5) + 'const orgId = orgOfSession(sessionId);',
  T(5) + '// Host revive first (spawns the engine conversation when the row',
  T(5) + '// lacks one), then the mutate-carried refresh lands the fresh',
  T(5) + '// dshSessionId, THEN focus the conversation — dsh own row-open call.',
  T(5) + 'if (orgId !== void 0) orgStore.mutate("session.open", { orgId, sessionId }).then(() => { try { orgStore.revealSession(sessionId) } catch { /* presentation */ } return arxaOpenConversation(sessionId); }).catch(() => {});',
  T(4) + '},',
  T(4) + '// Local derivation already matches session + org names (Q4); the content',
  T(4) + '// search fetch is an honest empty — we hold no transcript index.',
  T(4) + 'searchSessions: async () => ({ items: [], hasMore: false }),',
  T(4) + 'searchResultLimit: 20,',
  T(4) + 'renameSession: (sessionId, title) => {',
  T(5) + '// One rename, every surface: the registry name is the display truth;',
  T(5) + '// git stays keyed by the session id (grilled 2026-08-30).',
  T(5) + 'const orgId = orgOfSession(sessionId);',
  T(5) + 'if (orgId !== void 0 && typeof title === "string" && title.trim() !== "") orgStore.mutate("session.rename", { orgId, sessionId, name: title.trim() }).catch(() => {});',
  T(4) + '},',
  T(4) + 'forkSession: () => {},',
  T(4) + 'archiveSession: (sessionId) => {',
  T(5) + 'const orgId = orgOfSession(sessionId);',
  T(5) + 'if (orgId !== void 0) orgStore.mutate("session.archive", { orgId, sessionId }).catch(() => {});',
  T(4) + '},',
  T(4) + 'insertSessionBefore: async () => {},',
  T(4) + 'renameWorkspace: async () => {}, // fixed folders are not renamable (v2)',
  T(4) + 'deleteWorkspace: async () => {}, // leaf rows never delete; org close lives on the org row menu (v2)',
  T(4) + 'insertWorkspaceBefore: async () => {},',
  T(4) + 'createWorkspace: async (input) => {',
  T(5) + 'await orgStore.mutate("org.create", { name: input?.name });',
  T(5) + 'const s = orgStore.get();',
  T(5) + 'return { workspaceId: (s.orgs.find((o) => o.open) || {}).id };',
  T(4) + '},',
  T(4) + 'trash: () => orgStore.toggleTrash(),',
  T(4) + 'hooks: { directoryFlow: orgNoFlow, hostInfo: orgHostInfo },',
  T(3) + '});',
  T(3) + 'ctx.slots.inject("sidebar.workspaces", () => ctx.slots.register({',
  T(4) + 'name: "sidebar.workspaces",',
  T(4) + 'children: { "sidebar.workspaces.directoryFlow": {',
  T(5) + 'kind: "single",',
  T(5) + 'scope: "root"',
  T(4) + '} },',
  T(4) + 'store: createWorkspaceViewStore(),',
  T(4) + 'inject: browserInjected,',
  T(4) + 'locale: NS',
  T(3) + '}, OrgBrowser));',
  T(3) + '// Empty-state guidance (2026-08-30): the stock hero workspace picker',
  T(3) + '// is gone from this build — its menu fed dsh own workspace registry',
  T(3) + '// and submitting created raw engine sessions outside the org model',
  T(3) + '// (the stranding-session factory). Occupy the slot with the arxa way',
  T(3) + '// instead; without a picked workspace the hero composer stays inert.',
  T(3) + 'ctx.slots.inject("conversation.hero.workspace", () => ctx.slots.register({',
  T(4) + 'name: "conversation.hero.workspace",',
  T(4) + 'locale: NS',
  T(3) + '}, ArxaHeroGuide));',
  T(3) + '// Composer breadcrumb (found live 2026-09-02): dsh unmounts the hero slot once a',
  T(3) + '// conversation is open, so the path chip must live in the composer left zone',
  T(3) + '// (conversation.input.left, kind:list, scope:session, nothing stock registers there).',
  T(3) + 'ctx.slots.inject("conversation.input.left", () => ctx.slots.register({',
  T(4) + 'name: "conversation.input.left",',
  T(4) + 'id: "arxa-crumbs",',
  T(4) + 'order: 0,',
  T(4) + 'locale: NS,',
  T(4) + 'inject: (sessionId) => ({ sessionId })',
  T(3) + '}, ArxaCrumbBar));',
  T(3) + '// Preset chip corner (2026-09-03): the stock seat lives on the hero row',
  T(3) + '// ABOVE the card; the product wants it inside the card, top-right.',
  T(3) + '// conversation.input.overlay (kind:list, scope:session) is the card-top',
  T(3) + '// anchor — ArxaPresetCorner re-renders the stock entry there and the',
  T(3) + '// hero-row copy is CSS-hidden. Locale is the seat namespace so `t`',
  T(3) + '// resolves the stock labels.',
  T(3) + 'ctx.slots.inject("conversation.input.overlay", () => ctx.slots.register({',
  T(4) + 'name: "conversation.input.overlay",',
  T(4) + 'id: "arxa-preset-corner",',
  T(4) + 'order: 0,',
  T(4) + 'locale: "settings.agentPreset",',
  T(4) + 'inject: () => ({ slots: ctx.slots })',
  T(3) + '}, ArxaPresetCorner));',
  T(3) + '// Agent-capability placeholders (2026-09-03, Q4): header.actions is',
  T(3) + '// kind:list / replaceRisk:none, so these sit BESIDE the stock',
  T(3) + '// agent-preset (order -10) and job-list (order 20) entries. Orders',
  T(3) + '// bracket the stock job chip so the empty and live states occupy the',
  T(3) + '// same place in the row. NOT header.lineage: that is kind:single and',
  T(3) + '// already held by the subagent catalog we are trying to surface.',
  T(3) + 'ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({',
  T(4) + 'name: "conversation.session.header.actions",',
  T(4) + 'id: "arxa-jobs-empty",',
  T(4) + 'order: 19,',
  T(4) + 'locale: NS',
  T(3) + '}, ArxaJobsPlaceholder));',
  T(3) + 'ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({',
  T(4) + 'name: "conversation.session.header.actions",',
  T(4) + 'id: "arxa-subagents-empty",',
  T(4) + 'order: 21,',
  T(4) + 'locale: NS',
  T(3) + '}, ArxaSubagentsPlaceholder));',
  T(3) + '// Welcome gate (Phase 2, conformance plan): the frame declares',
  T(3) + '// shell.overlay (kind:list, scope:root) — the gate registers THERE',
  T(3) + '// instead of fighting the shell with position:fixed + z-index',
  T(3) + '// 2147483000. The overlay layer owns positioning, z-order and',
  T(3) + '// pointer events; the gate renders null once an org exists.',
  T(3) + 'ctx.slots.inject("shell.overlay", () => ctx.slots.register({',
  T(4) + 'name: "shell.overlay",',
  T(4) + 'id: "arxa-welcome-gate",',
  T(4) + 'order: 100,',
  T(4) + 'locale: NS',
  T(3) + '}, WelcomeGate));',
  T(2) + '}',
  T(2) + 'exports.apply = apply;',
].join('\n')
out = out.slice(0, headAt) + ourApply + out.slice(expAt + EXPORTS.length)

// 11. provenance header
const HEADER = [
  '// Browser half of arxa-sidebar (workspace-section part). GENERATED by',
  '// scripts/gen-workspace.mjs from @deepseek-ai/dsh-client-ui-workspace',
  '// lib/client.js (dsh ' + DSH_VERSION + ') + lib/workspace-region.snippet.txt +',
  '// the deltas listed in that script; composed after the shell part from',
  '// scripts/gen-sidebar.mjs into lib/client.js. Do not hand-edit: regenerate',
  '// and let the selftest drift gate compare bytes. The stock component tree',
  '// (groups, rows, search, view options, menus, pills, animations) is kept',
  '// whole; only the data faces, the add flow and the menu routing moved.',
  '// The original package stays untouched in node_modules as reference.',
  '',
].join('\n')
out = HEADER + out

// ---- compose: NEST the workspace half inside the shell module -------------
// Two sibling __ModuleLoader__.load ids do not work: the runtime only
// requires plugin client ids it knows from the boot manifest (the package
// name, "arxa-sidebar"), so a second id would never be pulled and its
// slots.inject would never run. Instead the workspace factory body runs in
// its own function scope INSIDE the shell factory (its module/exports/r/
// clsx/en/zh/NS names shadow nothing of the shell's), and its apply() is
// chained onto the shell's so one ctx drives both registrations.
const WS_HEAD = 'window.__ModuleLoader__.load({';
const WS_FACTORY_TAIL = T(2) + 'return module.exports;' + '\n' + T(1) + '}' + '\n});';
const headSplit = out.indexOf(WS_HEAD);
const headerComments = out.slice(0, headSplit);
let ws = out.slice(headSplit);
const headEndMarker = T(1) + 'factory: (require) => {';
const headEnd = ws.indexOf(headEndMarker);
if (headSplit < 0 || headEnd < 0) throw new Error('workspace module head markers missing — stock shape moved?');
ws = ws.slice(headEnd + headEndMarker.length).replace(/\s+$/, '');
const tailAt = ws.lastIndexOf(WS_FACTORY_TAIL);
if (tailAt < 0 || tailAt !== ws.length - WS_FACTORY_TAIL.length) throw new Error('workspace module tail markers missing — stock shape moved?');
ws = ws.slice(0, tailAt);
const SHELL_RETURN = T(2) + 'return module.exports;';
const shellReturnAt = shellPart.indexOf(SHELL_RETURN);
if (shellReturnAt < 0) throw new Error('shell return anchor missing — stock shape moved?');
const nestBlock = [
  T(2) + '{ // workspace section half (org rows world) — nested module scope',
  headerComments.trimEnd(),
  T(2) + '  const wsExports = (function (require) {',
  ws,
  T(3) + 'return module.exports;',
  T(2) + '  })(require);',
  T(2) + '  const wsApply = wsExports.apply;',
  T(2) + '  const shellApply = exports.apply;',
  T(2) + '  exports.apply = (ctx) => { shellApply(ctx); wsApply(ctx); };',
  T(2) + '}',
].join('\n');
const client = shellPart.slice(0, shellReturnAt) + nestBlock + '\n' + shellPart.slice(shellReturnAt);

if (process.argv.includes('--write')) {
  const { writeFileSync } = await import('node:fs')
  // D86 fail-fast: refuse to write a bundle that does not parse — a syntax
  // error ships an unloadable sidebar (the app loads client.js as a <script>).
  const vm = await import('node:vm')
  try { new vm.Script(client, { filename: 'lib/client.js' }) } catch (e) {
    throw new Error('gen-workspace: generated client.js does not parse — not writing: ' + e)
  }
  writeFileSync(join(root, 'plugins', 'arxa-sidebar', 'lib', 'client.js'), client)
  console.log('written', client.length, 'bytes (shell', shellPart.length, '+ workspace', out.length, ') — parse-checked')
} else {
  process.stdout.write(client)
}
