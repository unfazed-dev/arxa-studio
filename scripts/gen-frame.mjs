// gen-frame — regenerate plugins/arxa-frame/lib/client.js from the stock
// @deepseek-ai/dsh-client-ui-layout lib/client.js (dsh 0.1.1-rc.2).
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
//   3. store: + viewer key + setViewer/openViewer/closeViewer (min 320)
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
  ".aXa_fr_sheetBody{flex:1;min-height:0;display:flex}"
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
    I + "d.viewer = clampWidth(px, 320, 100000);",
    K + "},",
    K + "openViewer: (d) => {",
    I + "if (d.viewer === 0) d.viewer = 420;",
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
    "function computeColumns(viewport, sidebar, details, viewer) {",
    b + "const s = sidebar === 0 ? 56 : clampWidth(sidebar, 264, 420);",
    b + "const d0 = details === 0 ? 0 : clampWidth(details, 300, 520);",
    b + "const v0 = viewer === 0 ? 0 : clampWidth(viewer, 320, 100000);",
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
    b + "const v1 = Math.min(v0, Math.max(320, viewport - s - 640));",
    b + "if (s + v1 + 640 <= viewport) return {",
    c + "sidebar: s,",
    c + "center: 640,",
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
  "detailsSession === void 0 ? 0 : panels.details, panels.viewer);", "5a cols call site")
{
  const a = "const onDetailsDrag"
  const i = s.indexOf(a)
  const end = s.indexOf(", [actions]);", i)
  if (i < 0 || end < 0) dies("5b: onDetailsDrag anchor not found")
  const stop = end + ", [actions]);".length
  const b = T(3), c = T(4), d = T(5)
  const add = LF + b + "const viewerBase = (0, react.useRef)(0);" + LF
    + b + "const onViewerStart = (0, react.useCallback)(() => {" + LF
    + c + "viewerBase.current = colsRef.current.viewer;" + LF
    + c + "setDragging(true);" + LF
    + b + "}, []);" + LF
    + b + "const onViewerDrag = (0, react.useCallback)((dx) => {" + LF
    + c + "actions.setViewer(viewerBase.current + dx);" + LF
    + b + "}, [actions]);" + LF
    + b + "const requestViewerMax = (0, react.useCallback)(() => {" + LF
    + c + "const c2 = colsRef.current;" + LF
    + c + "let room = viewport - c2.sidebar - (c2.details > 0 ? c2.details : 0) - 640;" + LF
    + c + "if (room < 320 && c2.details > 0) {" + LF
    + d + "actions.closeDetails();" + LF
    + d + "room = viewport - c2.sidebar - 640;" + LF
    + c + "}" + LF
    + c + "actions.setViewer(Math.max(320, room));" + LF
    + b + "}, [actions, viewport]);"
  s = s.slice(0, stop) + add + s.slice(stop)
  log.push("5b viewer callbacks + maximize")
}
repString("style: { gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px` },",
  "style: { gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px ${cols.viewer}px` },", "5c grid columns")
repString("\"data-details-collapsed\": cols.details === 0 || void 0,",
  "\"data-details-collapsed\": cols.details === 0 || void 0," + LF + T(4) + "\"data-viewer-collapsed\": cols.viewer === 0 || void 0,", "5d data attr")
{
  const frag = "(0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(CenterColumn, { children: renderSlot(\"conversation\", {}) }), (0, react_jsx_runtime.jsx)(DetailsColumn, { children: renderSlot(\"details\", {}) })] }),"
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
    + c + "onEnd: onDragEnd" + LF
    + b + "})"
  s = s.slice(0, stop) + add + s.slice(stop)
  log.push("5f viewer drag handle")
}

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
