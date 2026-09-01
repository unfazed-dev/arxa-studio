# Plan — Artifact viewer: docked session-bound column (D88–D93)

Grill 2026-08-31 (this session) confirmed Q1–Q7. Decisions live in
docs/plans/arxa-studio-grill-decisions.md as D88–D93. Context:
docs/research/claude-artifacts-panel-ux.md,
designs/artifact-viewer/layout-options.html.

## Goal

The artifact viewer stops being a `shell.overlay` float (which blocked all
UI interaction) and becomes a **docked, draggable, session-bound column**
with **org-wide reach** — view/edit anything in the org, entered from
conversation deliverable cards and the arxa sidebar file tree.

## Decisions (confirmed)

- **D88** docked column; generated, drift-gated patch of ui-layout; details
  seat untouched; overlay registration retired. Session-bound presence
  (mirrors details: only while a non-blank session is current; closes on
  session switch), org-bound scope.
- **D89** worktree read lane `GET /__arxa/artifacts/wt` — read token bound
  to worktreeId. Org origin unchanged.
- **D90** org file tree lives in the arxa sidebar; lazy per-dir listing
  `GET /__arxa/artifacts/tree?dir=…` (excludes .arxa/, .git/, dotfiles;
  account/ viewable). Sidebar navigates, column views/edits.
- **D91** artifact cards = stock deliverables chips + file-mentions; click
  opens the column (worktree lane first, org fallback). Never auto-open.
  gen-ui untouched.
- **D92** below AppFrame's own narrow flag (< 1024 px) the viewer is a
  full-frame sheet with back arrow; same component, one container branch.
- **D93** layout store gains `viewer` + set/open/close (clamp min 320);
  ⤢ maximize = viewport − sidebar − details(if open) − 640 floor, details
  yields first; maximized ephemeral, width persists. Entry points: card,
  sidebar file, path input, "Artifacts" header toggle. Session switch
  while open: follow + reset artifact to empty state.

## Tasks

- **T0 — Mechanism spike (blocking).** Establish exactly how a patched
  AppFrame takes over: read dsh-client-modules manifest composition,
  SlotCore root-seat shadowing (single slot: dynamic entry wins), store
  seats, and whether other clients' `require('@deepseek-ai/dsh-client-
  ui-layout')` survives a profile-disabled row. Pick between:
  (i) full transformed copy + profile disable (arxa-sidebar precedent),
  (ii) root-shadow registration reusing stock store/providers,
  (iii) hybrid (copy provides store+controller under the SAME service
  contract; stock row disabled only if requires allow). Write the verdict
  into scripts/gen-frame.mjs's header before generating anything.
- **T1 — DONE 2026-08-31 (13 deltas, drift gate in selftest).** **T1 — scripts/gen-frame.mjs**: transform stock ui-layout client with
  deltas: `viewer` store key + set/open/close/toggle actions (clamp
  min 320), viewer column in computeColumns + grid, DragHandle clone,
  session-bound presence (detailsSession source), narrow→sheet branch,
  maximize helper, module id/tag. Drift gate in artifact-viewer selftest.
- **T2 — DONE 2026-08-31 (viewer-seat column, wt lane, changes list, av-open bridge, 4s rebind).** **T2 — plugins/artifact-viewer/lib/client.js rebuild**: drop
  shell.overlay registration (guard in selftest); column citizen UI
  (header: tabs preview/code, ⤢, ✕; path input; session-changes list;
  D85 badge); sheet branch at narrow; session-switch rebind; consume wt
  lane for worktree files.
- **T3 — DONE 2026-08-31 (wt/tree/session-changes routes + token classes).** **T3 — tokens.js + routes**: worktree-bound read token kind;
  `/__arxa/artifacts/wt` (escape-proof, worktree-scoped, Range-aware);
  `/__arxa/artifacts/tree?dir=…` (lazy listing, exclusions, bounded).
- **T4 — PENDING (anchor: workspace-section half at arxa-sidebar client.js line ~344; slot name sidebar.workspaces).** **T4 — arxa-sidebar files section**: Files rows under the open org from
  the tree route (lazy per-expand); click → open viewer column via the
  existing window-event bridge pattern (`arxa-av-open`).
- **T5 — Deliverables card routing**: produced-file chips + file-mentions
  open the viewer (worktree path resolution via session cwd); gen-ui
  untouched; never auto-open.
- **T6 — Gates.** Selftests: gen-frame drift, wt lane (token-bound,
  escape-proof, .arxa-reserved), tree route (exclusions, paging),
  no-overlay guard; scripts/ci.mjs ALL GREEN. Lens: 1280 = column,
  744/390 = sheet, console-clean; blocking regression (elementFromPoint
  + composer focus with viewer open); CDP drag = width follows + clamps
  + survives reload; ⤢ = computed max; card-click and sidebar-click open
  flows. Docs: demo runbook updated; CONTEXT.md glossary touch-up.

## Acceptance (Q7)

All six gate families green; the original defect — viewer blocking UI —
proven impossible by gate 1; drag persistence proven by gate 2.

## Notes

- bin/arxa-studio.mjs stays uncommitted (operator D90 work in flight);
  profile rows for arxa-frame land additively.
- dsh packages stay byte-identical (house rule); every stock-module delta
  goes through scripts/gen-*.mjs with recorded rc + anchors.

## Addendum 2026-09-01 — VS Code sash semantics (user directive, shipped arxa-frame 0.1.3)

- **Inverted drag sign fixed (0.1.2)**: the viewer is a right-edge panel — its
  drag subtracts dx (`viewerBase.current - dx`), same convention as details.
- **Viewer tier center floor = 220** (`CENTER_VIEWER_MIN`), VS Code's editor
  part sash minimum (`DEFAULT_EDITOR_MIN_DIMENSIONS = 220x70`, editor.ts:29).
  The 640 comfort floor now governs only the DETAILS concession (a secondary
  pane closes rather than cramp the chat); the viewer is a primary surface.
- **Full takeover**: at/within 40px of the sidebar edge the viewer snaps to
  center-hidden (`v0 >= viewport - s - 40`) — the sash twin of VS Code's
  `toggleMaximizedPanel` (layout.ts: `setEditorHidden(true)`).
- **⤢ maximize toggles**: full takeover (viewer = viewport − sidebar,
  collapsed or expanded) ⇄ restore the pre-max width (`viewerPreMax`),
  mirroring VS Code's lastNonMaximized restore. The details PREFERENCE
  survives maximized state (solver hides the lane; exit restores it).
- Delivery lesson: the packaged app runs ~/.arxa/engine/<sha> — repo fixes
  reach it via `node bin/arxa-engine-sync.mjs` (version-keyed: bump the
  plugin version or the sync skips it) + sidecar bounce (watchdog respawns).
  dsh serves plugin bundles from in-memory boot reads — a process restart is
  required, page reloads alone don't pick up plugin changes.
- Sash double-click reset (0.1.4): dblclick any frame handle resets the
  adjacent pane to its preferred width (sidebar 280 / details 360 / viewer
  420) — VS Code onDidReset semantics (sash.ts L451, grid.ts L710-741).
  Deliberate deviation: the 40px snap-to-full on the viewer sash is NOT VS
  Code (workbench parts never snap) — it is the explicit 2026-09-01 user
  directive ("the handle must drag to the max").
- Gates: plugins/arxa-frame/selftest.mjs (32 checks) + live trusted-drag
  evidence via arxa/tool/lens_frame_drag.dart (13 assertions, zero console
  errors; designs/artifact-viewer/evidence/lens/frame-drag-*-1600.png).
- Full VS Code research: docs/research/vscode-workbench-pane-resizing.md.

## Addendum 2026-09-01b — no-hardcode refactor + slow-drag dead-zone fix (0.1.5)

- ROOT CAUSE of the slow-drag stall: the rendered viewer tier capped at
  center=220 while the full-takeover branch fired 180px of preference later
  — 180px of dead handle travel. Fixed by making the resting center floor a
  SOLVER PARAM (centerMin): 0 while any handle drag is live (the chat then
  shrinks continuously 220→0, handle under the pointer all the way),
  CENTER_VIEWER_MIN at rest (reasserts on render, no pref churn).
- Release snap: a drop leaving the chat under floor(CENTER_VIEWER_MIN/2)
  snaps to full takeover (setViewer(viewport)) — VS Code's own snap
  threshold formula, applied by directive (workbench parts skip snap).
- NO-HARDCODE REFACTOR (user directive): every arxa pixel lives in ONE named
  spec block (VIEWER_MIN 320, VIEWER_MAX 560, VIEWER_PREF_CAP,
  CENTER_VIEWER_MIN 220, VIEWER_SNAP derived = CENTER_VIEWER_MIN>>1); the
  default width is viewport-derived (viewerDefault = clamp(W/3, MIN, MAX) —
  VS Code first-run sizing pattern); stock contract values (264/280/420/56,
  300/360/520, 640) stay inline in the stock paths they govern.
- Gates: selftest 34 checks (incl. no-loose-pixels guard) + relationship-
  based live evidence: 21 assertions in arxa/tool/lens_frame_drag.dart
  (delta-exact strokes, monotonic no-stall slow drag, resting floor, snap,
  toggle, derived reset — zero absolute layout literals in the driver).

## Addendum 2026-09-01c — first-open "Load failed" (0.2.5) + file-row alignment (sidebar 0.2.6)

- REPORT: every first open of a file (AGENTS.md in the report) in the desktop
  app errored "Failed to load <file>: Load failed"; opening any other file
  and coming back worked. The raw reason text is the WebKit fetch TypeError
  (desktop = WKWebView), i.e. the network layer, not a 4xx.
- ROOT CAUSE (evidence-driven): the per-org server listened on 127.0.0.1
  ONLY, but macOS answers every *.localhost name with synthesized loopback
  for BOTH families — ::1 FIRST (dscacheutil, 5ms, even for fresh names).
  The desktop WKWebView's first-ever cross-origin fetch to
  org-<slug>.localhost:<ephemeral> tried the refused v6 address and surfaced
  raw "Load failed"; every later fetch reused the warmed pool and worked —
  exactly the user's switch-away-and-back workaround. Chrome never
  reproduces (native *.localhost→loopback mapping + fallback), and the
  same-origin studio lanes are warm from page navigation — only the org
  lane's bare first fetch() died. Probes: curl -6 → refused pre-fix;
  Chrome rig driver arxa/tool/lens_av_firstopen.dart → clean first open.
- FIX (org-server.js): dual-stack listen — start('::') (ipv6Only defaults
  false, accepts both families), fallback to '127.0.0.1' for v6-less hosts.
  Origin string, host allowlist, and client code unchanged. Selftest gained
  the ::1 healthz assertion (red first, then green).
- SIDEBAR ALIGNMENT (same report): file rows carried the org-subtree
  container indent (~18px, measured rowX 48 vs dock 30) PLUS their own
  depth-1 margin, and a blank 24px spacer instead of the tree's 16px icon
  slot — names floated ~22px past every sibling row with an empty gap.
  Fixed in the region snippet (childStyle compensates the container:
  max(0,d−1)*14 — the 3266 pseudo-group doctrine) and the spacer is now a
  hard 16px slot carrying IconBrowseOutline16 (hard box retained per the
  WKWebView focused-row slot-collapse lesson). Measured post-fix: file rows
  rowX 30 / textX 60 — pixel-identical to dock rows; screenshot
  /tmp/arxa-avfix1/shots7/m1-sidebar.png.
- Gates: arxa-artifact-viewer 0.2.5 + arxa-sidebar 0.2.6 synced to the
  engine and verified in the profile; live org server answers v4+v6
  (v6 403 host-allowlist on the raw-IP probe = TCP connect OK); CI 18/18.

## Addendum 2026-09-01d — session-scoped close (0.2.6) + maximize glyph + toolbar tooltips

- REPORT (2026-09-01): (1) opening a session left the viewer showing a file
  that was not in that session; (2) the maximize button carried the wrong
  glyph; (3) the viewer header tooltips covered each other.
- ROOT CAUSES: (1) the D93 reset only fired on session->session transitions
  (over-guard `prev && id`) — the common null->X case (browse an org file,
  THEN open a session) skipped it, and even when it ran it only reset PANEL
  state while the frame kept the column open; the seat's session gate also
  REMOUNTS the panel on every transition (measured live: dataset probe),
  so any in-panel close races the remount and loses. (2) maximize used
  IconBrowseOutline16. (3) the stock Tooltip's default side is "right" —
  vertically centered beside the trigger, i.e. over the sibling buttons.
- FIXES: (1) the session tracker records every id (incl. null); a shown
  file survives only when it IS the new current session's worktree file;
  the reset now ALSO calls the layout face, and the mirror enforces
  ctx.layout.closeViewer() one tick after the transition — outside React,
  so the seat remount cannot swallow it. (2) IconFullscreenOutline16.
  (3) every viewer tooltip pins side:'bottom' (centered below the trigger,
  viewport-flip retained) — the industry toolbar pattern.
- Evidence: arxa/tool/lens_av_firstopen.dart — T4b close collapses the
  column to 0; T5 hover tooltip renders below (tip.top 42 >= btn.bottom 34);
  selftest contracts pin all three; CI ALL GREEN. Rig limitation noted: the
  web rig's session-open gesture does not complete a dsh conversation focus
  (desktop-shell path), so the emit->close chain is verified by contract +
  close-path equivalence rather than a full live transition.

## Addendum 2026-09-03 — VS Code-grade editor (grilled, user-resolved)

- DECISIONS (user, grilled one-by-one): 2026 Dark/Light palette applies to
  the EDITOR SURFACES only (code + md edit panes; md preview adopts the
  chrome too); studio chrome keeps --dsw-* tokens. Palette follows the dsh
  dark flag (body[data-ds-dark-theme]); the token/font color palette is the
  fidelity target. Full language coverage + .dart joins the code lane.
  Prettier format-on-demand (button + Shift-Alt-F) + detect-indentation on
  open (fallback 2 spaces); native parsers only (js/ts/tsx/jsx, css/scss,
  json/jsonc, md, yaml) — py/go/rs/sh/sql/toml get indentation only.
  Material Icon Theme (npm 5.38.1, MIT), FULL COLOR, sidebar tree + viewer
  title, curated 136-SVG vendored subset. Font: dsh mono token default,
  Fira Code (OFL, vendored variable woff2 latin+latin-ext) selectable via a
  new "Editor font" row in the general settings modal (arxa-theme-accent,
  settings.general.item order 41, body-inline --arxa-editor-font,
  localStorage-backed — engine-file cross-device sync NOT extended to it).
- SOURCES: VS Code 2026 themes vendored verbatim (microsoft/vscode MIT,
  theme-defaults/themes/2026-{dark,light}.json, sha256-16 pinned in the
  vendor banner); the 53-rule tokenColors compile at BUILD time through a
  curated TextMate-fragment -> CM6-tag table (87 fragments enumerated from
  the files; support.type.property-name.json -> propertyName added after a
  first-pass gap). No TextMate engine at runtime.
- ROOT CAUSE (measured live): a separate themes.js IIFE duplicated
  @codemirror/state — every Compartment/theme extension failed EditorView's
  instanceof check ("Unrecognized extension value in extension set").
  ArxaTheme now builds INSIDE the codemirror bundle (one module instance).
  Also: legacy-modes clike exports `dart` as a sibling export, not a
  property of the `clike` factory.
- EVIDENCE: lens_av_firstopen.dart T6 — python bg rgb(18,19,20) == #121314
  and keyword rgb(255,123,114) == #ff7b72 (exact 2026 Dark values); dart
  lane highlights via the clike StreamLanguage port; format button hidden
  for .py / present for .ts; pressing it reformats sample.ts through real
  Prettier (name: string spacing, brace-per-line, 2-space indent —
  detectIndent-fed); material icons in viewer title + 37 tree rows; md
  preview on the palette surface; T1/T4b/T5/M1 regression gates all green;
  zero console errors.
- SHIPPED: arxa-artifact-viewer 0.3.0 (theme port, 8 new lang routes incl.
  dart, prettier lazy bundle, icons bundle, fira woff2, format action,
  palette compartments), arxa-sidebar 0.2.7 (material file+folder glyphs in
  the org tree, dsh glyphs as fallback), arxa-theme-accent 0.2.0 (editor
  font row + @font-face injection).

### Sweep fixes (2026-09-03, same day — driver-found + audited)

- FOUND BY DRIVER: the md preview highlighter never fired — two gaps: (1)
  the client wired setParsers but never setTheme (tags array stayed empty);
  (2) the previewHtml effect lacked the palette dependency, so a fast first
  render froze token-less fences. Both wired; T6a now shows tokSpans with
  the exact palette color (rgb(207,34,46) in light).
- ROOT CAUSE CLASS (again): a second IIFE copy of @lezer/highlight in the
  markdown bundle broke tag identity against the CM parsers — the md bundle
  now receives the engine from ArxaCM (parsers + resolveTag + highlightTree),
  shaving it to 146KB.
- LEAK: the panel's palette subscription never unsubscribed — the seat
  remounts on every session transition and grew one stale closure each.
- DiffView now colors by language (relPath rides the props).
- icons.js loads once per page: the viewer tags its script and the sidebar
  loader reuses it.
- T6f: light/dark flip is driver-proven — the rig boots LIGHT (2026 Light
  bg #FFFFFF / keyword #cf222e exact), flipping body[data-ds-dark-theme]
  live-reconfigures the editor to 2026 Dark (#121314) without a rebuild.
- T6g: settings modal shows Accent AND Editor font; picking Fira Code sets
  --arxa-editor-font on <body> (driver-verified).
- Shipped: arxa-artifact-viewer 0.3.1, arxa-sidebar 0.2.8.

### Prettier viewer toggle (2026-09-03, later — user request)

- The top bar gains a Prettier toggle where the other viewer controls live
  (copy/download/source/**prettier**/format/diff/max/close), shown on every
  editable lane. ON BY DEFAULT; the choice persists per browser in
  localStorage `arxa.av.prettier` (same storage class as the editor font —
  no engine sync, deliberately).
- The toggle is authoritative over EVERY format path: `canFormat` now ends
  `&& prettierOn`, so toggling off removes the Format button AND dead-ends
  Shift-Alt-F (the keymap rides formatActionRef, which nulls via the same
  gate). No new state machine — one boolean in front of the existing one.
- Icon: the OFFICIAL Prettier mark (prettier/prettier `website/static/
  icon.png`, 256², 1.4KB, MIT) vendored at `lib/vendor/prettier.png` and
  served through the existing basename-pinned vendor route (content-type map
  gained `image/png`). Rendered as a 14px rounded chip: full color when on,
  `grayscale(1)` + 45% opacity when off, plus the existing `data-on` pressed
  ring. A hand-traced SVG was rejected — approximating brand geometry is the
  same sin as approximating theme hexes.
- Locales: `action.prettier.on/off` in en/pl/fr; tooltip reads
  "Prettier: on/off" and the button carries aria-pressed.
- Driver T7 (new): default ON + format visible; toggle off removes the
  format button; the off choice survives a page reload (org + file are
  re-opened after reload to re-mount the viewer); ON restored for evidence.
  RESULT: PASS, zero console errors — alongside all T1–T6g/M1 probes.
- Shipped: arxa-artifact-viewer 0.3.2.

### Composer gutter symmetry (2026-09-03, later — user request)

User report with screenshot: the sidebar→composer gap and the composer→
artifact-viewer gap differed (their env: 16px vs 32px) — "they must be equal
at all times".

- Root cause (measured, not guessed — `arxa/tool/lens_av_gutters.dart`):
  the stock `scrollBody` inside the center column reserves
  `scrollbar-gutter: stable` — a permanently reserved scrollbar lane on the
  RIGHT only (8px in headless Chrome, 15–16px with classic scrollbars on
  macOS, 0px with overlay scrollbars). The composer seat lives inside that
  scroll body, so the right gap = left gap + gutter width, at every
  viewport, with the viewer open OR closed (closed just swaps the viewer
  edge for the window edge).
- Fix: the frame generator (`scripts/gen-frame.mjs`, the drift-gated owner
  of the three-column shell) appends
  `.aXa_fr_centerCol [class*="scrollBody"]{scrollbar-gutter:auto}` to the
  frame css module — the reservation is dropped only inside the center
  column. The composer is now equidistant from its neighbours in every
  state: the hero padding (16px) is the only remaining inset.
- Honest trade-off: on classic-scrollbar systems, when the transcript
  actually overflows, the visible scrollbar band now overlays the right
  edge instead of being pre-reserved (content width shifts by the
  scrollbar width when scrollability flips). The stock reservation bought
  that stability by permanently biasing the composer; symmetry wins per
  the user's directive. Overlay-scrollbar systems (macOS default) never
  saw either effect.
- Evidence (`designs/artifact-viewer/evidence/lens/2026-gutters/`, dark
  shell, testing-notice modal dismissed before shots): viewer open @1280 →
  16/16, open @1600 → 56.5/56.5, viewer closed @1280 → 110/110 — all
  diff=0. Gutter probe reads `reserved:0, css:auto` in all three states.
  Driver asserts |left−right| ≤ 0.5px; RESULT: PASS. The full
  lens_av_firstopen suite (T1–T7/M1) re-ran PASS on the modified frame.
- Selftest: two new arxa-frame contracts (rule present in the generated
  client; rule adjacent to the sheetBody rule inside the css module
  string). CI ALL GREEN.
- Shipped: arxa-frame 0.1.6 (generator delta 2b gained one rule; drift
  gate green).

### Editor-font fix: the phantom `--dsw-font-mono` token (2026-09-03, later —
### user report "Fira Code is not wired up")

Systematic-debugging run (`arxa/tool/lens_av_font.dart`, per-layer probes):
storage ✓, body var ✓, @font-face registered ✓, both woff2 subsets 200 ✓, face
loads ✓ — but `.cm-content` computed font stayed `monospace`. Cascade
enumeration (element.matches over every rule; note: CSS Nesting makes every
CSSStyleRule carry cssRules, so naive walks silently skip them) found the two
competing declarations:

- `.ͼ1 .cm-scroller{font-family:monospace}` — CodeMirror's built-in theme.
- `.aXa_av_editorWrap .cm-content{font-family:var(--arxa-editor-font,var(--dsw-font-mono))}` — ours.

Root cause: **`--dsw-font-mono` never existed in dsh.** The real mono token is
`--ds-font-family-code` ("SF Mono", "JetBrains Mono", "Fira Code", …). A
var() chain ending in an undefined token is *invalid at computed-value time*:
the whole declaration dies and the element falls back to INHERITED value —
CM's monospace from the scroller. This killed both paths at once (Fira stack
AND the default fallback), and was invisible because the degraded rendering
looks identical to the intended default. Proven by experiment: a literal stack
on the same body property computes Fira instantly; `var(--dsw-font-mono)`
collapses back to `monospace`.

Fix (all five uses of the phantom token, one sweep):
- `theme-accent` 0.2.1: fira stack → `'Fira Code Variable',
  var(--ds-font-family-code)`; fontPill css likewise.
- `artifact-viewer` 0.3.3: cm-content rule fallback and `.aXa_av_md code` →
  `var(--ds-font-family-code)`.
- `prism` 0.1.1: slider value readout → same token.

Selftests now pin the invariant (no phantom token; the real token present) in
theme-accent and artifact-viewer. Driver re-run: RESULT: PASS — computed font
`'Fira Code Variable', 'SF Mono', 'JetBrains Mono', 'Fira Code', …`, face
loaded, all lens_av_firstopen probes (T1–T7/M1) still PASS, CI ALL GREEN.
Evidence: `designs/artifact-viewer/evidence/lens/2026-editor-font/
font-after-fira.png` (Fira pill selected and rendering in Fira).

## Addendum 6 — editor font, part 3: the desktop webview never re-renders lazily-loaded webfonts (2026-09-01)

User report after addendum 5 shipped (theme-accent 0.2.1 / artifact-viewer
0.3.3): "the fira font is still not being applied to the viewer" — in the
DESKTOP app. Chrome smokes against the identical engine payload passed the
full user flow (live switch, reload persistence, ligature metrics), so the
wiring was provably correct in Chromium. What follows is the elimination
chain that isolated the desktop-only failure (each step evidence-first):

- **Delivery verified end-to-end**: engine tree, re-materialized profile
  node_modules, and the wire (`/plugins/arxa-theme-accent/client.js`,
  woff2 routes) all served the fixed code/bytes — 200 `font/woff2 no-store`
  on every Host variant. The app webview held 5 live sockets to the engine.
- **In-page state verified by diagnostic beacons** (temporarily appended to
  the served plugin; removed after): body `--arxa-editor-font` IS set,
  `.cm-content` computed font-family leads with `"Fira Code Variable"`,
  `document.fonts.check()` true, and an in-page `fetch()` of the woff2
  returned byte-identical data (hash-verified against disk).
- **Fresh WKWebViews render the same file fine** — both via `data:` and via
  same-origin http, on `127.0.0.1` and on a `.localhost` origin: ligature
  metrics diverge from monospace exactly as Fira should.
- **Not the cause**: stale engines/orphans (content-checked every time),
  WKWebView network cache (empty), the app's persistent WebsiteDataStore
  (fully wiped + restored — no change), CSP (none anywhere), sandbox
  entitlements (hardened runtime only), MDM font profiles (none), global
  font forcing (five exotic families rendered five distinct fonts in-app).

Root cause: **timing**. The CSS `@font-face` lazy-loads at first use — the
exact moment the viewer's CodeMirror first paints. macOS 26 (Tahoe) app
webviews carry a WebKit regression in that window (Apple FB18869578 class:
"WebView fails to render fonts…"; forum thread 796304): text already laid
out with the fallback never re-renders when the webfont resolves. Chrome
swaps late fonts fine, which is why every Chromium smoke passed while the
desktop app kept painting Menlo (the dsh mono stack resolves "SF Mono" →
unmatchable for web content → … → Menlo; note macOS does not expose SF Mono
to web font matching at all).

Fix (theme-accent 0.2.2): `preloadEditorFont()` at plugin `apply()` —
fetch both woff2 subsets and register them through the FontFace API
(`f.load()` awaited) at page load, so any editor created later measures and
paints with the real font from the first frame; the CSS `@font-face` stays
as the secondary path. artifact-viewer 0.3.4 rides along (selftest lane),
prism 0.3.1 fixes the last phantom `--dsw-font-mono` (the settings
breathing-rate value label — found by grep during this round, same IACVT
class as addendum 5, cosmetic). Engine-synced; desktop app rebuilt with the
new sidecar payload (sha12 6cd810205d1a).

Standing caveats from this round, for the next debugger:

- The artifact-viewer/org servers churn (open/close) during normal app use;
  the app also recycles its sidecar engine occasionally (observed 15:01) —
  an engine dir named by content-sha appears per distinct tree; content
  checks, never dir names, are authoritative.
- The app reuses any engine already listening on :7891 (probe → reachable
  → no sidecar): a directly-booted engine (bin/arxa-studio.mjs --no-open)
  takes precedence over the bundled payload — handy for debugging, a hazard
  for "which code is the app actually running".
- The plugin client route serves from the re-materialized profile
  node_modules; cold app launches re-extract and can re-copy (wiping live
  edits) while supervisor respawns do not.

### Addendum 7 — the "toggling does nothing" report, closed (2026-09-01, later)

Four-phase pass on "toggling between default and fira shows no changes in
the artifact viewer", with in-page beacon diagnostics + in-app experiment
overlay, closed by a user-verified A/B.

**What the mechanism actually does (all verified live in the running app):**
pill click → `applyFont()` sets body `--arxa-editor-font` instantly (same-tab
path is direct, not the storage event); `.cm-content`/`.cm-line`/text spans
all compute `"Fira Code Variable", …` as family with
`font-variant-ligatures: normal`, `font-feature-settings: normal`;
`document.fonts.check()` true. An in-app overlay force-button A/B
(`.cm-content,.cm-line,span{font-family:…!important}`) visibly changed the
editor — and **the user confirmed UNFORCE (var-driven) == FORCE-FIRA**:
the paint path honors the var chain. The earlier "editor renders Menlo"
verdicts were small-size vision misreads; `screencapture -l` also produced
black-tile captures of a live, correct editor (WebKit compositing artifacts
— trust full-screen region captures, or the user's eyes, over window-id
captures).

**Root cause of the perception (both halves proven):**
1. The Settings modal UNMOUNTS the docked viewer — beacon diag fired
   `nocomm` (no `.cm-content` in the document) while the modal was open.
   Toggling therefore happens with no editor on screen, and the column does
   not reappear when the modal closes (must re-open the artifact).
2. The user's test artifacts (check.sh & co.) contain zero Fira ligature
   pairs (`>&` `2>&1` are not ligatures), so Fira-vs-default at 13–14px is
   a subtle letterform delta with no ligature signal.

The macOS 26 Tahoe webfont regression theory (Addendum 6) is RETIRED for
this case: Fira (webfont + local) renders and ligates in the app webview,
including inside `contenteditable`, and the editor paints family changes.

Fix (theme-accent 0.2.3): the Editor font row ships a live ligature battery
preview (`a => b >= c != d |> 0OoIl1 :: -> =>`) that re-renders on pick —
the feedback the toggle flow was missing, visible exactly where the choice
is made. Rebuilt sidecar payload `75c2e59c841b`, app re-signed/installed,
cold launch verified serving `FONT_PREVIEW` + preload with zero
diagnostics.

Known open UX (web-shell, not plugin-side): the settings route unmounting
the docked column; also Cmd+R/Cmd+, are focus-fragile in the release
webview. AX note for future debugging: the tree enumerates unstably —
list-and-click must happen in ONE AppleScript call with retries.

### Addendum 8 — "Default" rendered Fira Code too: the dsh mono token contains it (2026-09-01, later still)

User report after 0.2.3: "switched font to default and nothing happens in
the editor — is the default properly wired to another font other than fira
code?" It was not.

**Root cause (render-truthed, not inferred):** the Default pill cleared
`--arxa-editor-font`, so `.cm-content` fell back to
`var(--ds-font-family-code)`. That dsh token is
`"SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, …`
— **"Fira Code" is its third entry**. In the desktop WKWebView:

- `"SF Mono"` is unresolvable by name (Apple restricts system-font family
  names in non-Safari webviews; `document.fonts.check()` returns true but
  text renders in the inherited proportional font — check() lies here),
- `"JetBrains Mono"` was not installed (check() also returned true — same lie),
- `"Fira Code"` matched the user-installed `~/Library/Fonts/FiraCode-VariableFont_wght.ttf`.

So Default rendered the system Fira Code — the SAME design and ligatures as
the Fira pill. The toggle flipped the variable correctly (Addendum 7); both
sides simply resolved to Fira. Evidence: in-app width probe over a 47-char
ligature battery — token stack == explicit `"Fira Code"` at **366.61px**,
Menlo 367.86px, unmatched names 242.31px (proportional fallback).

**Fix (theme-accent 0.2.4 + artifact-viewer 0.3.5):** the editor default is
now an explicit Fira-free stack in both the pill wiring and the viewer CSS
fallback:
`"SF Mono", ui-monospace, "JetBrains Mono", Consolas, "Liberation Mono", Menlo, monospace`
(lands on Menlo on macOS, Consolas on Windows, Liberation Mono on Linux).
The fira stack is `'Fira Code Variable', 'Fira Code', <default stack>` —
Fira names first, graceful degradation after. Selftests pin: default const
contains no Fira name; viewer fallback no longer rides the token; preview
shares the two canonical stacks.

**Open observation (not chased, out of scope):** the width probe also showed
`"Fira Code Variable"` measuring as proportional fallback even after
`document.fonts.load()` resolved and `check()` flipped true — the preloaded
webfont may not rasterize in this WebKit build (name-match caching from a
pre-load failed match is the prime suspect). What renders as "Fira" in the
app is likely the user's system Fira Code either way — same design, same
ligatures, harmless; worth one probe round if the webfont ever matters
(e.g. users without system Fira would fall back to Menlo-as-fira).

Sidecar payload `8f41f445e183`; CI 18/18 GREEN; probe instrumentation
removed from the served profile copy and the beacon listener killed before
shipping.
