// gen-frame — regenerate plugins/arxa-frame/lib/client.js from the stock
// @deepseek-ai/dsh-client-ui-layout lib/client.js (dsh 0.1.2-rc.1;
// reconciled 2026-09-05 from 0.1.1-rc.2 — delta 5e anchor only).
//
// T0 verdict (docs/plans/artifact-viewer-docked-column.md): no client bundle
// statically requires ui-layout — every consumer reaches it through the
// ctx.layout SERVICE — and AppFrame/createLayoutStore are not exported, so
// partial reuse is impossible. The takeover is therefore the arxa-sidebar
// precedent: a FULL transformed copy under a new module id (arxa-frame) with
// the profile disabling the stock ui-layout row. dsh stays byte-identical.
//
// Deltas (grill D88-D93, 2026-08-31):
//   1. module id: @deepseek-ai/dsh-client-ui-layout -> arxa-frame
//   2. css prefix pI_x6G_ -> aXa_fr_ + viewer column/handle/sheet rules
//   3. store: + viewer key + setViewer/openViewer/closeViewer (min 320);
//       dragged width persists through localStorage (D93 'width persists')
//   4. computeColumns: 4th column viewer; center 640 floor; details yields first
//   5. AppFrame: viewerCol + drag handle + maximize + narrow full-frame sheet
//   6. child seat "viewer" (single, session-maybe)
//
// Hand-edits to the generated file are caught by: node scripts/gen-frame.mjs --check
// Usage: node scripts/gen-frame.mjs [--check]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const stockPath = join(root, "node_modules", "@deepseek-ai", "dsh-client-ui-layout", "lib", "client.js")
const outPath = join(root, "plugins", "arxa-frame", "lib", "client.js")
const LF = String.fromCharCode(10)
const TAB = String.fromCharCode(9)
const T = (n) => TAB.repeat(n)

const stock = readFileSync(stockPath, "utf8")
let s = stock
const log = []
const dies = (msg) => { console.error("gen-frame: " + msg); process.exit(1) }

function repString(from, to, label) {
  const n = s.split(from).length - 1
  if (n !== 1) dies(label + ": anchor matched " + n + " times (expected 1)")
  s = s.replace(from, to)
  log.push(label)
}

// 1. module id
repString("id: \"@deepseek-ai/dsh-client-ui-layout\",", "id: \"arxa-frame\",", "1 module id")

// 2a. css prefix
{
  const n = s.split("pI_x6G_").length - 1
  if (n < 10) dies("2 css prefix: only " + n + " occurrences — stock shape moved?")
  s = s.replaceAll("pI_x6G_", "aXa_fr_")
  log.push("2a css prefix (" + n + " classes)")
}
// 2b. viewer css appended inside the css-module string
const VW = [
  ".aXa_fr_viewerCol{border-left:1px solid var(--dsw-alias-border-l2);min-width:0;overflow:hidden}",
  ".aXa_fr_frame[data-viewer-collapsed] .aXa_fr_viewerCol{border-left:none}",
  ".aXa_fr_handle[data-side=viewer]:after{content:\"\";box-sizing:border-box;background:var(--dsw-alias-button-floating-fill);border:1px solid var(--dsw-alias-border-l2-darkmode-thin);opacity:0;width:12px;height:32px;transition:opacity var(--ds-transition-duration-slow) var(--ds-ease-in-out),background var(--ds-transition-duration-slow) var(--ds-ease-in-out);border-radius:10px;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)}",
  ".aXa_fr_viewerCol:hover~.aXa_fr_handle[data-side=viewer]:after,.aXa_fr_handle[data-side=viewer]:hover:after,.aXa_fr_handle[data-side=viewer][data-dragging=true]:after{opacity:1}",
  ".aXa_fr_handle[data-side=viewer]:hover:after,.aXa_fr_handle[data-side=viewer][data-dragging=true]:after{background:var(--dsw-alias-button-floating-hover);border-color:var(--dsw-alias-border-l3)}",
  ".aXa_fr_sheetLayer{position:absolute;inset:0;z-index:15;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base)}",
  ".aXa_fr_sheetHead{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2)}",
  ".aXa_fr_sheetBack{cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 10px;font-size:12px}",
  ".aXa_fr_sheetBody{flex:1;min-height:0;display:flex}",
  // gutter symmetry (2026-09-03): the stock scrollBody reserves scrollbar-gutter
  // stable on the right only, so the hero composer sat gutter px (8 headless,
  // 15-16 classic scrollbars) farther from the viewer col than from the
  // sidebar col, at every width, viewer open or closed. Dropping the
  // reservation inside the center col makes the composer equidistant from its
  // neighbours in every state; on classic systems the visible scrollbar band
  // explains the right edge only while the transcript actually overflows.
  ".aXa_fr_centerCol [class*=\"scrollBody\"]{scrollbar-gutter:auto}"
].join("")
const VWq = VW.replaceAll("\"", String.fromCharCode(92) + "\"")
repString(".aXa_fr_overlayLayer>*{pointer-events:auto}\"", ".aXa_fr_overlayLayer>*{pointer-events:auto}" + VWq + "\"", "2b viewer css")

// 3. store: viewer key + actions
repString("sidebar: 280," + LF + T(5) + "details: 0,",
  "sidebar: 280," + LF + T(5) + "viewer: 0," + LF + T(5) + "details: 0,", "3a store init")
{
  const a = "closeDetails: (d) => {"
  const i = s.indexOf(a)
  if (i < 0 || s.indexOf(a, i + 1) >= 0) dies("3b: closeDetails anchor not unique")
  const close = s.indexOf("}", i)
  const ls = s.lastIndexOf(LF, i) + 1
  let k = ls; while (s[k] === TAB) k++
  const K = s.slice(ls, k), I = K + TAB
  const next = [
    "closeDetails: (d) => {",
    I + "d.details = 0;",
    K + "},",
    K + "setViewer: (d, px) => {",
    I + "d.viewer = clampWidth(px, VIEWER_MIN, VIEWER_PREF_CAP);",
    I + "try { localStorage.setItem('arxa.frame.viewer', String(d.viewer)); } catch { }",
    K + "},",
    K + "openViewer: (d) => {",
    I + "if (d.viewer === 0) {",
    I + I + "let w = viewerDefault(typeof window !== \"undefined\" ? window.innerWidth : 0);",
    I + I + "try { const saved = Number(localStorage.getItem('arxa.frame.viewer')); if (saved >= VIEWER_MIN) w = saved; } catch { }",
    I + I + "d.viewer = w;",
    I + "}",
    K + "},",
    K + "closeViewer: (d) => {",
    I + "d.viewer = 0;",
    K + "}"
  ].join(LF)
  s = s.slice(0, i) + next + s.slice(close + 1)
  log.push("3b viewer actions")
}

// 4. computeColumns — index-based block replace (no regex)
{
  const a = "function computeColumns(viewport, sidebar, details) {"
  const i = s.indexOf(a)
  if (i < 0 || s.indexOf(a, i + 1) >= 0) dies("4: computeColumns anchor not unique")
  const closeAt = s.indexOf(LF + T(2) + "}", i)
  if (closeAt < 0) dies("4: computeColumns close not found")
  const b = T(3), c = T(4)
  const next = [
    "// arxa frame layout spec — the ONLY place arxa pixel values live (the",
    "// 2026-09-01 no-hardcode directive; stock contract values — sidebar",
    "// 264/280/420/56, details 300/360/520, the 640 comfort floor — stay",
    "// inline in the stock paths they govern). VS Code sash semantics,",
    "// researched in docs/research/vscode-workbench-pane-resizing.md.",
    "const VIEWER_MIN = 320; // narrowest usable artifact lane",
    "const VIEWER_MAX = 560; // ceiling for the ratio-derived DEFAULT below",
    "const VIEWER_PREF_CAP = 100000; // persisted-preference ceiling (serialization guard)",
    "const CENTER_VIEWER_MIN = 220; // VS Code editor-part sash minimum (DEFAULT_EDITOR_MIN_DIMENSIONS)",
    "const VIEWER_SNAP = CENTER_VIEWER_MIN >> 1; // VS Code snap threshold formula floor(min/2) = 110",
    "// VS Code first-run sizing pattern (min(300, W/4)): the preferred viewer",
    "// width is viewport-derived — a 4K monitor and a laptop get proportional",
    "// defaults, clamped into the usable lane.",
    "const viewerDefault = (vp) => clampWidth(Math.round(vp / 3), VIEWER_MIN, VIEWER_MAX);",
    "// centerMin is the floor the chat keeps AGAINST THE VIEWER: 0 while a",
    "// handle drag is live (continuous all the way — the 2026-09-01 slow-drag",
    "// dead-zone fix), CENTER_VIEWER_MIN at rest. The 640 comfort floor keeps",
    "// governing only the DETAILS concession (a secondary pane closes rather",
    "// than cramp the chat); the viewer is a primary work surface. Within one",
    "// snap threshold of the sidebar edge the viewer takes over fully (center",
    "// hidden) — the sash twin of VS Code's toggleMaximizedPanel.",
    "function computeColumns(viewport, sidebar, details, viewer, centerMin) {",
    b + "const s = sidebar === 0 ? 56 : clampWidth(sidebar, 264, 420);",
    b + "const d0 = details === 0 ? 0 : clampWidth(details, 300, 520);",
    b + "const v0 = viewer === 0 ? 0 : clampWidth(viewer, VIEWER_MIN, VIEWER_PREF_CAP);",
    b + "if (s + d0 + v0 + 640 <= viewport) return {",
    c + "sidebar: s,",
    c + "center: viewport - s - d0 - v0,",
    c + "details: d0,",
    c + "viewer: v0",
    b + "};",
    b + "const d1 = d0 === 0 ? 0 : Math.min(d0, Math.max(300, viewport - s - v0 - 640));",
    b + "if (s + d1 + v0 + 640 <= viewport) return {",
    c + "sidebar: s,",
    c + "center: 640,",
    c + "details: d1,",
    c + "viewer: v0",
    b + "};",
    b + "if (v0 >= viewport - s - VIEWER_SNAP) return {",
    c + "sidebar: s,",
    c + "center: 0,",
    c + "details: 0,",
    c + "viewer: Math.max(VIEWER_MIN, viewport - s)",
    b + "};",
    b + "const v1 = Math.min(v0, Math.max(VIEWER_MIN, viewport - s - centerMin));",
    b + "if (s + v1 + centerMin <= viewport) return {",
    c + "sidebar: s,",
    c + "center: viewport - s - v1,",
    c + "details: 0,",
    c + "viewer: v1",
    b + "};",
    b + "return {",
    c + "sidebar: s,",
    c + "center: Math.max(0, viewport - s),",
    c + "details: 0,",
    c + "viewer: 0",
    b + "};",
    T(2) + "}"
  ].join(LF)
  s = s.slice(0, i) + next + s.slice(closeAt + (LF + T(2) + "}").length)
  log.push("4 computeColumns")
}

// 5. AppFrame deltas
repString("detailsSession === void 0 ? 0 : panels.details);",
  "detailsSession === void 0 ? 0 : panels.details, panels.viewer, dragging ? 0 : CENTER_VIEWER_MIN);", "5a cols call site")
repString("const cols = computeColumns(viewport,",
  "const [dragging, setDragging] = (0, react.useState)(false);" + LF + T(3) + "const cols = computeColumns(viewport,", "5a hoist dragging above the solve")
repString(LF + T(3) + "const [dragging, setDragging] = (0, react.useState)(false);" + LF + T(3) + "const onDragEnd",
  LF + T(3) + "const onDragEnd", "5a drop the stock dragging decl (hoisted)")
{
  const a = "const onDetailsDrag"
  const i = s.indexOf(a)
  const end = s.indexOf(", [actions]);", i)
  if (i < 0 || end < 0) dies("5b: onDetailsDrag anchor not found")
  const stop = end + ", [actions]);".length
  const b = T(3), c = T(4), d = T(5)
  // Sign convention (2026-09 regression): the viewer is a RIGHT-edge panel —
  // its handle sits at the column's left edge, so dragging LEFT (dx < 0) must
  // GROW it: width follows base − dx, exactly like details. +dx inverted the
  // drag (grew toward the window edge, clamped at 320 toward the center).
  const add = LF + b + "const viewerBase = (0, react.useRef)(0);" + LF
    + b + "const onViewerStart = (0, react.useCallback)(() => {" + LF
    + c + "viewerBase.current = colsRef.current.viewer;" + LF
    + c + "setDragging(true);" + LF
    + b + "}, []);" + LF
    + b + "const onViewerDrag = (0, react.useCallback)((dx) => {" + LF
    + c + "actions.setViewer(viewerBase.current - dx);" + LF
    + b + "}, [actions]);" + LF
    + b + "// Release snap (threshold = floor(min/2), VS Code's snap formula;" + LF
    + b + "// workbench parts skip snap — the 2026-09-01 directive applies it):" + LF
    + b + "// a drop leaving the chat under half its minimum means 'basically" + LF
    + b + "// full' — magnetically take over (persists). Otherwise the resting" + LF
    + b + "// solver floor (centerMin 220) reasserts itself on render — no pref" + LF
    + b + "// churn. During the drag itself centerMin is 0, so the handle" + LF
    + b + "// follows the pointer continuously all the way — no dead zone." + LF
    + b + "const onViewerEnd = (0, react.useCallback)(() => {" + LF
    + c + "const c2 = colsRef.current;" + LF
    + c + "if (c2.center > 0 && c2.center < VIEWER_SNAP) actions.setViewer(viewport);" + LF
    + c + "setDragging(false);" + LF
    + b + "}, [actions, viewport]);" + LF
    + b + "const viewerPreMax = (0, react.useRef)(0);" + LF
    + b + "const requestViewerMax = (0, react.useCallback)(() => {" + LF
    + c + "const c2 = colsRef.current;" + LF
    + c + "if (c2.center === 0) {" + LF
    + d + "actions.setViewer(viewerPreMax.current >= VIEWER_MIN ? viewerPreMax.current : viewerDefault(viewport));" + LF
    + d + "return;" + LF
    + c + "}" + LF
    + c + "viewerPreMax.current = c2.viewer;" + LF
    + c + "actions.setViewer(viewport - c2.sidebar);" + LF
    + b + "}, [actions, viewport]);"
  s = s.slice(0, stop) + add + s.slice(stop)
  log.push("5b viewer callbacks + maximize")
}
repString("style: { gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px` },",
  "style: { gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px ${cols.viewer}px` },", "5c grid columns")
repString("\"data-details-collapsed\": cols.details === 0 || void 0,",
  "\"data-details-collapsed\": cols.details === 0 || void 0," + LF + T(4) + "\"data-viewer-collapsed\": cols.viewer === 0 || void 0,", "5d data attr")
{
  // Amendment (2026-09-05, dsh 0.1.1-rc.2 → 0.1.2-rc.1): upstream wrapped the
  // details slot in SessionProvider — DetailsColumn's children became
  // jsx(SessionProvider, { children: renderSlot("details", {}) }) — so the
  // 0.1.1-rc.2 anchor stopped matching. The anchor now pins the wrapped
  // form; splice intent unchanged: the viewerCol div and the narrow sheet
  // are inserted as the Fragment's FOLLOWING siblings in the frame children.
  const frag = "(0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(CenterColumn, { children: renderSlot(\"conversation\", {}) }), (0, react_jsx_runtime.jsx)(DetailsColumn, { children: (0, react_jsx_runtime.jsx)(SessionProvider, { children: renderSlot(\"details\", {}) }) })] }),"
  if (s.split(frag).length - 1 !== 1) dies("5e: Fragment anchor not unique")
  const b = T(5), c = T(6), d = T(7)
  const add = frag + LF + b + "!narrow && detailsSession !== void 0 && cols.viewer > 0 && (0, react_jsx_runtime.jsx)(\"div\", {" + LF
    + c + "className: AppFrame_module_css_default.viewerCol," + LF
    + c + "children: renderSlot(\"viewer\", { close: actions.closeViewer, maximize: requestViewerMax, width: cols.viewer })" + LF
    + b + "})," + LF
    + b + "narrow && detailsSession !== void 0 && panels.viewer > 0 && (0, react_jsx_runtime.jsxs)(\"div\", {" + LF
    + c + "className: AppFrame_module_css_default.sheetLayer," + LF
    + c + "children: [(0, react_jsx_runtime.jsx)(\"div\", {" + LF
    + d + "className: AppFrame_module_css_default.sheetHead," + LF
    + d + "children: (0, react_jsx_runtime.jsx)(\"button\", { className: AppFrame_module_css_default.sheetBack, onClick: () => actions.closeViewer(), children: \"\u2190 artifacts\" })" + LF
    + c + "}), (0, react_jsx_runtime.jsx)(\"div\", {" + LF
    + d + "className: AppFrame_module_css_default.sheetBody," + LF
    + d + "children: renderSlot(\"viewer\", { close: actions.closeViewer, maximize: null, sheet: true })" + LF
    + c + "})]" + LF + b + "}),"
  s = s.replace(frag, add)
  log.push("5e viewerCol + sheet jsx")
}
{
  const a = "cols.details > 0 && (0, react_jsx_runtime.jsx)(DragHandle, {"
  const i = s.indexOf(a)
  const end = s.indexOf("})", i)
  if (i < 0 || end < 0) dies("5f: details handle anchor not found")
  const stop = end + 2
  const b = T(5), c = T(6)
  const add = "," + LF + b + "!narrow && detailsSession !== void 0 && cols.viewer > 0 && (0, react_jsx_runtime.jsx)(DragHandle, {" + LF
    + c + "side: \"viewer\"," + LF
    + c + "left: viewport - cols.viewer," + LF
    + c + "onStart: onViewerStart," + LF
    + c + "onDrag: onViewerDrag," + LF
    + c + "onReset: () => actions.setViewer(viewerDefault(viewport))," + LF
    + c + "onEnd: onViewerEnd" + LF
    + b + "})"
  s = s.slice(0, stop) + add + s.slice(stop)
  log.push("5f viewer drag handle")
}

// 5g. Sash double-click reset (VS Code: sash dblclick → onDidReset → the
// adjacent view returns to its preferred size). DragHandle forwards
// props.onReset as onDoubleClick; each handle resets to its contract default
// (sidebar 280 / details 360 / viewer 420 — the arxa preferred sizes).
repString(T(4) + "\"data-dragging\": dragging || void 0," + LF + T(4) + "onPointerDown,",
  T(4) + "\"data-dragging\": dragging || void 0," + LF + T(4) + "onDoubleClick: props.onReset," + LF + T(4) + "onPointerDown,", "5g DragHandle dblclick forward")
repString("onDrag: onSidebarDrag," + LF + T(6) + "onEnd: onDragEnd",
  "onDrag: onSidebarDrag," + LF + T(6) + "onReset: () => actions.setSidebar(280)," + LF + T(6) + "onEnd: onDragEnd", "5g sidebar dblclick reset 280")
repString("onDrag: onDetailsDrag," + LF + T(6) + "onEnd: onDragEnd",
  "onDrag: onDetailsDrag," + LF + T(6) + "onReset: () => actions.setDetails(360)," + LF + T(6) + "onEnd: onDragEnd", "5g details dblclick reset 360")

// 6. child seat declaration
{
  const a = "\"shell.overlay\": {"
  const i = s.indexOf(a)
  if (i < 0 || s.indexOf(a, i + 1) >= 0) dies("6: shell.overlay decl anchor not unique")
  const ls = s.lastIndexOf(LF, i) + 1
  let k = ls; while (s[k] === TAB) k++
  const K = s.slice(ls, k), I = K + TAB
  const block = K + "\"viewer\": {" + LF
    + I + "kind: \"single\"," + LF
    + I + "scope: \"session-maybe\"" + LF
    + K + "}," + LF
  s = s.slice(0, ls) + block + s.slice(ls)
  log.push("6 viewer seat")
}

// 7. LayoutController face: viewer passthroughs — the cross-plugin
// ctx.layout face must carry the D93 viewer actions so entry points
// (deliverable cards, sidebar files, the details-header toggle) can
// open the column from OUTSIDE the frame module (grill D93).
{
  const a = "closeDetails() {"
  const i = s.indexOf(a)
  if (i < 0 || s.indexOf(a, i + 1) >= 0) dies("7: face closeDetails anchor not unique")
  const close = s.indexOf("}", i)
  const ls = s.lastIndexOf(LF, i) + 1
  let k = ls; while (s[k] === TAB) k++
  const K = s.slice(ls, k), I = K + TAB
  const next = [
    "closeDetails() {",
    I + "this.#require().closeDetails();",
    K + "}",
    K + "/** Open the viewer column (D93 artifacts dock; no-op when open). */",
    K + "openViewer() {",
    I + "this.#require().openViewer();",
    K + "}",
    K + "/** Close the viewer column. */",
    K + "closeViewer() {",
    I + "this.#require().closeViewer();",
    K + "}",
    K + "/** Set the viewer column width (px, clamped). */",
    K + "setViewer(px) {",
    I + "this.#require().setViewer(px);",
    K + "}"
  ].join(LF)
  s = s.slice(0, i) + next + s.slice(close + 1)
  log.push("7 layout face viewer")
}

// 8. T6/D92 fix: the sheet + viewerCol class keys were missing from the
// AppFrame css map — the CSS rules existed (2b) but className lookups
// returned undefined, so the narrow sheet rendered classless (invisible,
// zero-size) and the docked viewer column lost its border. Register the
// keys alongside the stock ones.
{
  const a = '"sidebarCol": "aXa_fr_sidebarCol"' + LF + T(2) + "};"
  if (!s.includes(a) || s.indexOf(a) !== s.lastIndexOf(a)) dies("8: AppFrame css map tail anchor not unique")
  const next = [
    '"sidebarCol": "aXa_fr_sidebarCol",',
    T(3) + '"viewerCol": "aXa_fr_viewerCol",',
    T(3) + '"sheetLayer": "aXa_fr_sheetLayer",',
    T(3) + '"sheetHead": "aXa_fr_sheetHead",',
    T(3) + '"sheetBody": "aXa_fr_sheetBody",',
    T(3) + '"sheetBack": "aXa_fr_sheetBack"',
    T(2) + "};"
  ].join(LF)
  s = s.replace(a, next)
  log.push("8 sheet + viewerCol css map keys")
}

// 9. T4 v2 org-lane gate (2026-09-01, found live): the viewer column gated
// ONLY on detailsSession (a current NON-BLANK session) — a sidebar file click
// is an ORG-lane open with no session semantics at all, so with a blank or no
// session the layout flag flipped, the gate refused, and the user saw an
// empty dark strip. The column now renders when the session gate OR the
// explicit layout flag (openViewer → panels.viewer > 0) is live.
// Order matters: the DragHandle anchor CONTAINS the viewerCol anchor as a
// prefix — the specific one must run first or repString counts 2 matches.
repString("!narrow && detailsSession !== void 0 && cols.viewer > 0 && (0, react_jsx_runtime.jsx)(DragHandle, {",
  "!narrow && (detailsSession !== void 0 || panels.viewer > 0) && cols.viewer > 0 && (0, react_jsx_runtime.jsx)(DragHandle, {", "9a viewer handle gate");
repString("narrow && detailsSession !== void 0 && panels.viewer > 0",
  "narrow && (detailsSession !== void 0 || panels.viewer > 0) && panels.viewer > 0", "9b sheet gate");
repString("!narrow && detailsSession !== void 0 && cols.viewer > 0",
  "!narrow && (detailsSession !== void 0 || panels.viewer > 0) && cols.viewer > 0", "9c viewerCol gate");

// Provenance header — every arxa generated bundle names its generator + dsh
// pin (gen-sidebar/gen-workspace/gen-locale convention; the selftest gates it).
s = "// GENERATED by scripts/gen-frame.mjs from @deepseek-ai/dsh-client-ui-layout (dsh 0.1.2-rc.1) — do not hand-edit (drift gate: node scripts/gen-frame.mjs --check)." + LF + s

mkdirSync(dirname(outPath), { recursive: true })
if (process.argv.includes("--check")) {
  let cur = null
  try { cur = readFileSync(outPath, "utf8") } catch {}
  if (cur !== s) { console.error("gen-frame: DRIFT — generated output differs; run node scripts/gen-frame.mjs"); process.exit(1) }
  console.log("gen-frame: --check OK (" + log.length + " deltas)")
} else {
  writeFileSync(outPath, s)
  try { execFileSync(process.execPath, ["--check", outPath]) } catch (e) { dies("generated file fails node --check: " + e.message) }
  console.log("gen-frame: wrote " + outPath.replace(root + "/", "") + " (" + log.length + " deltas: " + log.join("; ") + ")")
}
