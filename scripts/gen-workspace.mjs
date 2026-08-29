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
const DSH_VERSION = '0.1.1-rc.2'
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
out = out.replaceAll('qDHVXG_', 'aXa_wsb_')
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

// 6. org-row menu: add Trash on the open org row (Q6). The delete relabel to
//    Close organisation is locale-only (see the region snippet).
const MENU_TAIL = T(4) + 'danger: true' + '\n' + T(3) + '}];'
if (!out.includes(MENU_TAIL)) throw new Error('workspace menu tail anchor missing — stock shape moved?')
const MENU_NEW = [
  T(4) + 'danger: true',
  T(3) + '}, ...(active ? [{',
  T(4) + 'id: "trash",',
  T(4) + 'label: t("menu.trash"),',
  T(4) + 'icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, {})',
  T(3) + '}] : [])];',
].join('\n')
out = out.replace(MENU_TAIL, MENU_NEW)
// 6b. org row click = expand AND open/switch (Q2). onToggle alone only
//      expands; the lifecycle open rides the row actions object.
const ROW_TOGGLE = 'onClick: onToggle,'
if (!out.includes(ROW_TOGGLE)) throw new Error('row toggle anchor missing — stock shape moved?')
out = out.replace(ROW_TOGGLE, 'onClick: () => { onToggle(); if (actions !== void 0 && actions.open !== void 0) actions.open(); },')


// 7. menu routing: Trash toggles the inline section (client-side state).
const ROUTE_OLD = [
  T(8) + 'if (id !== "rename" && id !== "delete") return;',
  T(8) + 'if (id === "rename") actions.rename();',
  T(8) + 'else actions.delete();',
].join('\n')
if (!out.includes(ROUTE_OLD)) throw new Error('menu routing anchor missing — stock shape moved?')
const ROUTE_NEW = [
  T(8) + 'if (id !== "rename" && id !== "delete" && id !== "trash") return;',
  T(8) + 'if (id === "rename") actions.rename();',
  T(8) + 'else if (id === "delete") actions.delete();',
  T(8) + 'else if (id === "trash") actions.trash();',
].join('\n')
out = out.replace(ROUTE_OLD, ROUTE_NEW)

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
  T(3) + 'ctx.effect(() => ctx.locale.register(NS, { zh: { ...zh, ...zhOver }, en: { ...en, ...enOver } }), "arxa-sidebar-workspace: dictionaries");',
  T(3) + 'orgHostDescription = ctx.get("connection").hostDescription;',
  T(3) + 'const browserInjected = () => ({',
  T(4) + '// use* hooks are pinned in OrgBrowser — see the region snippet.',
  T(4) + 'startSession: (orgId) => {',
  T(5) + 'orgStore.mutate("org.new-session", { orgId }).catch(() => {});',
  T(4) + '},',
  T(4) + 'open: (sessionId) => {',
  T(5) + 'const orgId = orgOfSession(sessionId);',
  T(5) + 'if (orgId !== void 0) orgStore.mutate("session.open", { orgId, sessionId }).catch(() => {});',
  T(4) + '},',
  T(4) + '// Local derivation already matches session + org names (Q4); the content',
  T(4) + '// search fetch is an honest empty — we hold no transcript index.',
  T(4) + 'searchSessions: async () => ({ items: [], hasMore: false }),',
  T(4) + 'searchResultLimit: 20,',
  T(4) + 'renameSession: async () => {},',
  T(4) + 'forkSession: () => {},',
  T(4) + 'archiveSession: (sessionId) => {',
  T(5) + 'const orgId = orgOfSession(sessionId);',
  T(5) + 'if (orgId !== void 0) orgStore.mutate("session.archive", { orgId, sessionId }).catch(() => {});',
  T(4) + '},',
  T(4) + 'insertSessionBefore: async () => {},',
  T(4) + 'renameWorkspace: (orgId, title) => orgStore.mutate("org.rename", { orgId, name: title }),',
  T(4) + 'deleteWorkspace: (orgId) => {',
  T(5) + '// Relabelled Close-organisation: only meaningful on the open org.',
  T(5) + 'const o = orgStore.get().orgs.find((x) => x.id === orgId);',
  T(5) + 'if (o?.open) return orgStore.mutate("org.close", {});',
  T(5) + 'return Promise.resolve();',
  T(4) + '},',
  T(4) + 'insertWorkspaceBefore: async () => {},',
  T(4) + 'createWorkspace: async (input) => {',
  T(5) + 'await orgStore.mutate("org.create", { name: input?.name });',
  T(5) + 'const s = orgStore.get();',
  T(5) + 'return { workspaceId: (s.orgs.find((o) => o.open) || {}).id };',
  T(4) + '},',
  T(4) + 'trash: () => orgStore.toggleTrash(),',
  T(4) + 'hooks: { directoryFlow: orgNoFlow, hostDescription: orgHostDescription },',
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
  writeFileSync(join(root, 'plugins', 'arxa-sidebar', 'lib', 'client.js'), client)
  console.log('written', client.length, 'bytes (shell', shellPart.length, '+ workspace', out.length, ')')
} else {
  process.stdout.write(client)
}
