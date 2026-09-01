#!/usr/bin/env node
// arxa-frame selftest — docked-viewer geometry gate
// (docs/plans/artifact-viewer-docked-column.md, D88–D93):
//   1. manifest shape (repo plugin convention, zero runtime dependencies)
//   2. client.js parses + provenance header names the generator
//   3. DRAG GEOMETRY (the 2026-09 regression: the viewer handle grew the
//      column on +dx, i.e. dragging RIGHT — inverted against every right-edge
//      panel): viewer drag must subtract dx exactly like details; sidebar
//      (left-edge) keeps +dx; the handle anchors at the column's left edge.
//   4. concession contract (D93): clamp min 320, center 640 floor, details
//      yields first, maximize = viewport − sidebar − details − 640
//   5. presence gates: viewerCol / sheet / DragHandle all keyed to
//      (detailsSession !== void 0 || panels.viewer > 0) — the org-lane fix
//   6. drift gate: scripts/gen-frame.mjs --check
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}

// ---- 1. manifest shape -------------------------------------------------------
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
check('manifest: name', pkg.name === 'arxa-frame')
check('manifest: server half', pkg.main === 'lib/index.js')
check('manifest: client half exported', pkg.exports?.['./client'] === './lib/client.js')
check('manifest: platform web', pkg.dsh?.client?.platform === 'web')
check('manifest: zero runtime dependencies', !pkg.dependencies)

// ---- 2. client parses + provenance -------------------------------------------
const client = readFileSync(join(here, 'lib', 'client.js'), 'utf8')
let parseErr = ''
try { new vm.Script(client, { filename: 'lib/client.js' }) } catch (e) { parseErr = String(e) }
check('client.js parses', !parseErr, parseErr)
check('provenance: names its generator', client.includes('gen-frame'))
check('provenance: module id repainted', client.includes('arxa-frame') && !client.includes('id: "@deepseek-ai/dsh-client-ui-layout"'))

// ---- 3. drag geometry (right-edge panels subtract dx) ------------------------
check('viewer drag: width follows the drag (base − dx, right-edge panel)',
  client.includes('actions.setViewer(viewerBase.current - dx)'),
  'inverted sign grows the viewer while dragging RIGHT and clamps at 320 while dragging LEFT')
check('viewer drag: no inverted sign remains',
  !client.includes('actions.setViewer(viewerBase.current + dx)'))
check('details reference intact (base − dx)', client.includes('actions.setDetails(detailsBase.current - dx)'))
check('sidebar reference intact (base + dx, left-edge panel)', client.includes('actions.setSidebar(sidebarBase.current + dx)'))
check('viewer base from the SOLVED columns (concession-aware)', client.includes('viewerBase.current = colsRef.current.viewer'))
check('viewer handle anchors at the column left edge', client.includes('left: viewport - cols.viewer'))

// ---- 4. concession contract (D93 + 2026-09-01 VS Code alignment, ----------
//      no-hardcode directive): every arxa pixel lives in ONE named spec
//      block; thresholds are DERIVED (snap = floor(min/2), VS Code's
//      formula); the default width is viewport-derived (W/3 clamped); the
//      drag is continuous (centerMin 0 while dragging) with a release settle
check('spec block: viewer lane minimum named', client.includes('const VIEWER_MIN = 320;'))
check('spec block: VS Code editor minimum named (220)', client.includes('const CENTER_VIEWER_MIN = 220;'))
check('spec block: snap threshold DERIVED (floor(min/2), VS Code formula)', client.includes('const VIEWER_SNAP = CENTER_VIEWER_MIN >> 1;'))
check('spec block: default width is viewport-derived (W/3 clamped, VS Code first-run pattern)',
  client.includes('const viewerDefault = (vp) => clampWidth(Math.round(vp / 3), VIEWER_MIN, VIEWER_MAX);'))
check('computeColumns: centerMin is a PARAM (0 while dragging, CENTER_VIEWER_MIN at rest)',
  client.includes('function computeColumns(viewport, sidebar, details, viewer, centerMin) {'))
check('computeColumns: center floor 640 in the open path', client.includes('s + d0 + v0 + 640 <= viewport'))
check('computeColumns: details yields before the viewer clamps',
  client.indexOf('const d1 = d0 === 0') > -1 && client.indexOf('const d1 = d0 === 0') < client.indexOf('const v1 = Math.min(v0'))
check('computeColumns: full takeover within ONE derived snap threshold of the sidebar edge',
  client.includes('if (v0 >= viewport - s - VIEWER_SNAP) return {') && client.includes('center: 0,') && client.includes('viewer: Math.max(VIEWER_MIN, viewport - s)'))
check('computeColumns: viewer tier floors the center at centerMin (continuous while dragging)',
  client.includes('const v1 = Math.min(v0, Math.max(VIEWER_MIN, viewport - s - centerMin));')
  && client.includes('s + v1 + centerMin <= viewport') && client.includes('center: viewport - s - v1,'))
check('call site: centerMin is 0 while a handle drag is live', client.includes('panels.viewer, dragging ? 0 : CENTER_VIEWER_MIN);'))
check('call site: dragging hoisted above the solve (declaration directly precedes computeColumns)',
  client.includes('const [dragging, setDragging] = (0, react.useState)(false);\n\t\t\tconst cols = computeColumns(')
  && !client.includes('(0, react.useState)(false);\n\t\t\tconst onDragEnd'))
check('release snap: under half the minimum at rest means full takeover (viewport = as wide as the window)',
  client.includes('if (c2.center > 0 && c2.center < VIEWER_SNAP) actions.setViewer(viewport);'))
check('resting floor: no settle writes — the solver centerMin reasserts on render',
  !client.includes('c2.viewer + c2.center - CENTER_VIEWER_MIN'))
check('maximize: full takeover (VS Code toggleMaximizedPanel — center hidden)',
  client.includes('actions.setViewer(viewport - c2.sidebar);'))
check('maximize: toggle restores the pre-max width (derived default fallback)',
  client.includes('viewerPreMax.current = c2.viewer;') && client.includes('if (c2.center === 0) {') && client.includes('viewerDefault(viewport));'))
check('openViewer: default comes from the derived helper, restore honors the named lane minimum',
  client.includes('let w = viewerDefault(') && client.includes('saved >= VIEWER_MIN'))
check('setViewer clamps at the named lane minimum', client.includes('d.viewer = clampWidth(px, VIEWER_MIN, VIEWER_PREF_CAP);'))
check('no loose arxa pixels remain (40px zone, fixed 420/320 defaults gone)',
  !client.includes('viewport - s - 40') && !client.includes('let w = 420') && !client.includes('actions.setViewer(420)') && !client.includes('viewport - s - 640)'))
check('sash double-click reset: DragHandle forwards onReset as onDoubleClick (VS Code onDidReset)',
  client.includes('onDoubleClick: props.onReset,'))
check('sash double-click reset: viewer -> derived preferred width', client.includes('onReset: () => actions.setViewer(viewerDefault(viewport)),'))
check('sash double-click reset: sidebar -> 280 preferred', client.includes('onReset: () => actions.setSidebar(280),'))
check('sash double-click reset: details -> 360 preferred', client.includes('onReset: () => actions.setDetails(360),'))

// ---- 5. presence gates (org-lane fix, delta 9) ---------------------------------
const gate = '(detailsSession !== void 0 || panels.viewer > 0)'
check('viewerCol gate keeps the org-lane open', client.includes('!narrow && ' + gate + ' && cols.viewer > 0'))
check('sheet gate keeps the org-lane open (narrow)', client.includes('narrow && ' + gate + ' && panels.viewer > 0'))
check('handle gate keeps the org-lane open', client.includes(gate) && client.includes('side: "viewer"'))

// ---- 5b. gutter symmetry (2026-09-03 user report): the stock scrollBody
// reserves scrollbar-gutter stable on the right only, so the hero composer sat
// gutter px farther from the viewer col than from the sidebar col at every
// width, viewer open or closed. The frame must drop the reservation inside the
// center column.
check('gutter symmetry: center-col scrollBody drops the stable reservation',
  client.includes('.aXa_fr_centerCol [class*=\\"scrollBody\\"]{scrollbar-gutter:auto}'))
check('gutter symmetry: rule lives in the frame css module string',
  /aXa_fr_sheetBody\{flex:1;min-height:0;display:flex\}\.aXa_fr_centerCol/.test(client))

// ---- 6. drift gate -------------------------------------------------------------
let drift = ''
try {
  drift = String(execFileSync(process.execPath, [join(root, 'scripts', 'gen-frame.mjs'), '--check'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }))
} catch (e) { drift = String(e.stderr || e.message) }
check('drift gate: generated client matches gen-frame.mjs', /--check OK/.test(drift), drift.trim().split('\n').pop())

console.log(failures === 0 ? 'arxa-frame selftest: ALL GREEN' : `arxa-frame selftest: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
