# VS Code workbench pane resizing & panel maximize — source-verified behaviors

Research date: 2026-09-01. Source: `microsoft/vscode@main` (raw.githubusercontent.com), files mirrored to `/tmp/vscode-research/*.ts` with upstream-exact line numbers. For mirroring in a 4-column web layout (sidebar | center-editor | details | viewer-panel).

## 1. Sash drag minimums (exact px)

| Part | min width | max width | min height | max height | Source |
|---|---|---|---|---|---|
| Side bar | **170** | ∞ | 0 | ∞ | `sidebarPart.ts` L48–51 |
| Panel (bottom) | **300** | ∞ | **77** | ∞ | `panelPart.ts` L40–43 |
| Auxiliary bar (2nd sidebar) | **170** | ∞ | 0 | ∞ | `auxiliaryBarPart.ts` L53–56 ("Use the side bar dimensions") |
| Editor part / group / pane | **220** | ∞ | **70** | ∞ | `editor.ts` L29–30, `editorPane.ts` L62–65 |
| Part title/header/footer | — | — | **35** (**32** "Modern UI") | — | `part.ts` L218–222 |

- `part.ts` L197–200 declares the abstracts; every part overrides them. Max is literally `Number.POSITIVE_INFINITY` everywhere — **no max cap on any part**.
- Editor min chain: `DEFAULT_EDITOR_MIN_DIMENSIONS = new Dimension(220, 70)` (editor.ts L29, max = ∞ L30) → `EditorPane` getters return it (editorPane.ts L62–65) → `EditorGroupView` delegates to the pane (editorGroupView.ts L2216–2219) → `EditorPart` min = `Math.min(centeredLayoutWidget.minimumWidth, maxEditorDimensions)` (editorPart.ts L1038–1041). **Effective editor-area floor: 220×70 px.**
- **Drag clamping is global, not pairwise**: `splitview.ts` `resize()` L1273–1278 sums min/max headroom of *all* views on both sides of the sash, then L1300 `delta = clamp(delta, minDelta, maxDelta)`. So dragging sidebar sash stops when the sidebar hits 170px **or** the editor hits its minimum — whichever comes first.
- Preferred/default sizes (used on first open & sash double-click): sidebar `preferredWidth` = `Math.max(viewlet.getOptimalWidth(), 300)` (sidebarPart.ts L56–68); panel `preferredHeight` = `mainContainerDimension.height * 0.4` (panelPart.ts L45–49); aux bar same 0.4 height + 300px width floor (auxiliaryBarPart.ts L58–75).
- First-run defaults: sidebar/auxbar = `Math.min(300, windowWidth/4)`, bottom panel = `windowHeight/3`, side panel = `windowWidth/4` (layout.ts L3026–3028, 3066; static 300 fallbacks L2879–2885).

## 2. Panel maximize — editor is hidden ENTIRELY (no minimum kept)

Command `workbench.action.toggleMaximizedPanel` → `panelActions.ts` L280, run L299–317 → `layoutService.toggleMaximizedPanel()` (`layout.ts` L2253–2277). (`workbench.action.toggleEditorVisibility` is an alias, `layoutActions.ts` L270–272.)

- Maximize: caches panel's current height/width (`PANEL_LAST_NON_MAXIMIZED_*`), then `setEditorHidden(true)` (L2266) → CSS class `nomaineditorarea` + `workbenchGrid.setViewVisible(editorPartView, false)` (layout.ts L1903–1918) → splitview sets editor size **0**, removes `visible` class (display:none), caches its size (splitview.ts L228–239). **The editor keeps no minimum — it is gone. The panel takes the entire editor area.** Side bar, aux bar, activity bar, status bar stay visible.
- Un-maximize: `setEditorHidden(false)` + `resizeView(panel, lastNonMaximized size)` (L2268–2273).
- Constraint: `isPanelMaximized()` (L2246–2251) is only possible when panel alignment is `center` **or** panel position is left/right; non-center bottom panels can't maximize (command shows a warning, panelActions.ts L299–317).
- Guard: editor and panel can never both be hidden (unless aux bar maximized) — hiding editor force-shows panel (layout.ts L1920–1924).
- **Auxiliary bar maximize** (`toggleMaximizedAuxiliaryBar`/`setAuxiliaryBarMaximized`, layout.ts L2175–2244): snapshots visibility of all parts, then hides **sidebar + panel + editor** — the aux bar takes the *entire* workbench middle area. Restore order editor→panel→sidebar (comment: preserves previous sizes), aux bar resized back to `AUXILIARYBAR_LAST_NON_MAXIMIZED_SIZE`. Re-entrance guard `inMaximizedAuxiliaryBarTransition`.
- GridView-level equivalent for editor groups: `GridView.maximizeView` (gridview.ts L1236–1263) hides *all other leaf views* via `setChildVisible(i, false)`; `exitMaximizedView` re-shows in reverse order (cached sizes).

## 3. Double-click on sash — yes: reset to preferred size, else equalize

Wiring chain: `Sash` dblclick → `onPointerDoublePress` → fires `onDidReset` (sash.ts L451, L615–626; touch double-tap within **250ms**, L459–469) → SplitView re-fires `_onDidSashReset(index)` only (no auto-resize; splitview.ts L1180–1195) → GridView relays location up (gridview.ts L462–463, L663–665, L1083) → **`Grid` base class subscribes itself** (grid.ts L312) and handles it in `Grid.onDidSashReset` (grid.ts L710–741):

1. Resize the view *before* the sash to its `preferredWidth`/`preferredHeight` if it defines one (grid.ts L42/L48; workbench parts do — see §1).
2. Else resize the view *after* the sash to its preferred size.
3. Else `distributeViewSizes(parentLocation)` — equalize the flexible views in that splitview (splitview.ts L1077–1099: `Math.floor(flexibleSize / count)`, clamped to min/max; only views with `maximumSize - minimumSize > 0`).

Consequences for the workbench (both grids are `SerializableGrid extends Grid`):
- **Sidebar sash double-click → sidebar resets to preferred width** (`Math.max(optimal, 300)`).
- **Editor↔panel sash double-click → panel resets to preferred height** (40% of container).
- **Editor-group sash double-click → equalizes group sizes** (EditorGroupView defines no preferred size; `editorGroupView.ts` has no `preferredWidth/preferredHeight`).
- Note: `layout.ts` itself contains zero sash handlers — this behavior is inherited from the `Grid` base class.

## 4. Window resize behavior — fixed pixels, last view absorbs, min-clamped cascade

- Workbench grid is created with **`{ proportionalLayout: false }`** (layout.ts L1676–1680). `layout()` (layout.ts L1753–1772) just calls `workbenchGrid.layout(windowW, windowH)` — no layout-level clamping or proportional math.
- With `proportionalLayout: false`, `SplitView.layout(size)` (splitview.ts L841–851) applies the whole delta (`size - previousSize`) to the **last view** in the branch via `resize()`; the cascade shrinks/grows that view within its min/max, then overflows to the next views (each clamped). `distributeEmptySpace()` soaks any remainder. Net effect: **parts keep fixed pixel sizes; the rightmost/bottom-most flexible part (in practice the editor area) absorbs window resize; when it bottoms out at its minimum, other parts get squeezed down to their minimums in turn.** Nothing ever goes below its part minimum — clamped inside splitview (splitview.ts L234, L1300).
- Contrast: `proportionalLayout: true` (the SplitView/GridView default, splitview.ts L573, gridview.ts L1174) scales every view by saved proportions, clamped to min/max (splitview.ts L866–873, `saveProportions` L880–884). Editor groups opt back into proportional behavior individually: `editorGroupView.ts` L2221–2227 (`proportionalLayout` true unless already at min size) — so editor *groups* scale proportionally with the editor part, while workbench *parts* stay fixed-pixel.
- `edgeSnapping` is set to `isMainWindowFullscreen` (layout.ts L1685); it enables start/end snap on boundary sashes (gridview.ts L731–732).

## 5. Sash UX details

| Detail | Value | Source |
|---|---|---|
| Sash size (hit target = the element itself) | **4 px** default (`globalSize = 4`), live-set via `setGlobalSashSize` | sash.ts L147, L481 |
| Hit target placement | centered on the boundary: `left = boundary − size/2` → **2 px on each side** | sash.ts L667, L678 |
| Hover delay | **300 ms** (`globalHoverDelay = 300`) → `.hover` class added via per-sash `Delayer`; instant if sash already `.active`; removed instantly on mouse-leave | sash.ts L154, L257–258, L629–647 |
| Touch | same 4 px target, no multiplier; double-tap window 250 ms | sash.ts L455–469 |
| Drag cursor | global `* { cursor: ew/ns-resize !important }` stylesheet during drag; `n/s/e/w-resize` at min/max edge; `all-scroll` on corner multi-sash | sash.ts L573–593 |
| State classes | `.active` during drag, `.minimum`/`.maximum`/`.disabled` state classes | sash.ts L289–291, L549 |
| User settings | `workbench.sash.size` (default 4), `workbench.sash.hoverDelay` (default 300) feed the global setters | sash.ts L149–159; VS Code settings docs |
| Snapping | opt-in per view (`IView.snap`, default false): view collapses when dragged past min-size threshold = `Math.floor(minimumSize / 2)` (splitview.ts L84, L944–957, L1280–1298). Workbench parts don't enable it; boundary-sash edge snapping enabled only in fullscreen (layout.ts L1685, gridview.ts L731–732) | splitview.ts L79–84 |
| Orthogonal/corner sashes | perpendicular sashes are linked at corners (`updateBoundarySashes`, gridview.ts L641–649); 2×2 editor grids lock parallel sashes via `linkedSash` (gridview.ts L700–709) | gridview.ts |

## Mirroring cheat-sheet for the 4-column layout

1. Min widths: sidebar 170px; details (auxbar analog) 170px; viewer-panel 300px min width / 77px min height if horizontal; editor 220×70px floor. No max caps.
2. Drag: clamp delta against cumulative min/max headroom of all parts on both sides of the sash (splitview.ts L1273–1300 algorithm).
3. Maximize panel = hide the editor column entirely (size 0, display:none, cache size); maximize details column = hide all other columns. Never leave victims at a minimum.
4. Sash double-click: reset adjacent view to its preferred size; if neither has one, equalize.
5. Window resize: fixed pixel parts, editor absorbs (`proportionalLayout: false` semantics), cascade through minimums.
6. Sash: 4px target centered on the boundary (2px each side), `.hover` highlight after 300ms, global resize cursor during drag.

## Primary sources

- https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/layout.ts
- https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/part.ts
- https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/sidebar/sidebarPart.ts
- https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/panel/panelPart.ts (+ panelActions.ts)
- https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/auxiliarybar/auxiliaryBarPart.ts
- https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorPart.ts (+ editorGroupView.ts)
- https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/actions/layoutActions.ts
- https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/sash/sash.ts
- https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/splitview/splitview.ts
- https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/grid/gridview.ts (+ grid.ts)
