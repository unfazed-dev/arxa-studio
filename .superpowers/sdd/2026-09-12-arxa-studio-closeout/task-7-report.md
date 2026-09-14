# Task 7 report — close artifact-viewer security and runtime verification

Commit: **78c1654** `fix: close artifact viewer runtime and trust boundaries`
(26 files, +717/−87; root `package-lock.json` dirt left untouched/unstaged.)

## Predecessor WIP judgment

Two implementers were OOM-killed; their uncommitted WIP (15 files + 2 PNGs)
was inspected against the brief and **kept almost entirely** — it was correct
and nearly complete. What it lacked: any RED evidence, the live runbook §7
run, most evidence shots, and two defects it introduced or missed (below).
The WIP's monaco-build lockfile was byte-reproduced by my `npm ci`, so the
monaco-build workspace contributed no lockfile change to the commit.

## Per step

- **S1 threat table** — `docs/plans/artifact-viewer-vscode-monaco.md`, §
  "Threat model (Task 7)" (~line 870): ten rows (ext-host origin, sandbox,
  CSP, cookies, localStorage, parent DOM, fetch reach, token exposure,
  navigation, extension provenance), every row MEASURED by the spike's
  `threat` step, asserted by `check.mjs` on every build (Chrome AND WebKit).
- **S2 allowlist freeze** — `selftest.mjs` Task 7 block: `entry.mjs` must
  import exactly the 14 vendored built-ins, each exact-pinned `36.2.7` in the
  monaco-build manifest; no vsix plugin wired, `iframeAlternateDomain` unset,
  no runtime `registerExtension`. Marketplace/VSIX loading stays off.
- **S3 unsafe ambient capabilities** — the SSE push route
  (`/__arxa/artifacts/events`) was an unauthenticated org-wide file-change
  channel any same-origin frame could subscribe to. Now token-gated
  deny-default (`watcher.js` verify, `index.js` binds `changes-read` per
  session / `tree-read` per root-org, client mints and re-mints on error).
  **Defect the WIP introduced, caught and fixed here**: the SIDEBAR's own
  D117 live tree stream opened the same route with no token — the gate would
  have silently killed sidebar live refresh and failed the zero-console-error
  run. Fixed in the SOURCE of truth (`freestyle-region.snippet.txt`), client
  regenerated via `scripts/gen-workspace.mjs --write`, pins in
  `selftest.freestyle.mjs`, drift gate green.
- **S4 language strip on screen** — scratch files with deterministic
  diagnostics; live headless-Chrome+CDP run (driver: `/tmp/arxa-task7/capture.mjs`,
  kept outside the repo): squiggles verified and shot at 1280 for
  `.ts`/`.css`/`.json` (the css shot live-proves the WIP's
  workspace/configuration middleware), `.html` = designed PREVIEW lane
  (org-origin sandboxed iframe; measured host ≠ studio origin, shot).
  Evidence: `designs/evidence/studio-closeout/1280/*` + the 744 dart strip.
  **Scope limits, honestly recorded** (details under Concerns): narrow rungs
  blocked headless; html squiggle N/A by design.
- **S5 autosave** — spike `autoSaveProbe`: monaco-vscode-api defaults
  `files.autoSave: afterDelay` and flushes into the IN-MEMORY overlay
  ~1.0–1.3 s after a keystroke — NOT a disk save. The worktree write stays
  the tested 1.5 s debounce's alone (ruling 4 holds, probe on record).
  Debounce-coalescing pin (one save per settled edit) in selftest.mjs +
  save-race suite + LIVE: one typed burst → exactly one
  "Saved · WIP committed" note transition (`autosave-one-per-settled-edit-1280.png`).
- **S6 Dart** — `selftest.lsp.mjs` Dart block (present via login-shell PATH /
  absent under launchd PATH, `installable:false`, no npm row) + LIVE both
  ways: dart-present = editor, no strip; `ARXA_LSP_DART=/nonexistent` boot =
  strip says "install its SDK", no download button. Shots at 1280 + 744.
  LSP status route answered `available:true` for ts/html/css/json (live).
- **S7 pdf.js + Prettier** — REMAIN (ruling 3), recorded in the plan doc +
  pins: pdf lane on the vendored bundle, prettier keeps md/yaml/yml, neither
  in the extension allowlist, no PDF experiment, no widening.
- **S8 gen-ui** — branch: **DEFERRED UNTIL REAL FILE DIFF INPUT** (correct
  branch). Evidence: `plugins/gen-ui/lib/index.js`'s single `gen_ui` tool
  takes a model-authored `components` array (validated, mapped to a2ui
  messages); the host reads no file bytes. Marker comment at the positional
  comparison in `plugins/gen-ui/lib/client.js`; TRIGGER test in selftest.mjs
  (any file-read API in gen-ui's host breaks the pin). The artifact viewer's
  movable singleton is not mounted into inline cards (N/A — nothing changed).
- **S9 gates** — `npm ci` + `vite build` + `node check.mjs` +
  `node check.mjs --webkit` GREEN (run twice: first thing per the controller
  ruling, and once more on the final tree); all 7 artifact-viewer selftests,
  sidebar suites (incl. byte drift gate), and root `npm test`
  (`scripts/ci.mjs`) ALL GREEN; live runbook §7 executed and its checkboxes
  closed with evidence names (amended where reality differed — see below).
- **S10** — committed.

## Runtime defect found and fixed during S4 (in scope: `lib/lsp.js` is a listed file)

The live run exposed a deterministic wedge: a language server kept alive
after its last socket left answered NOTHING ever again — every `.ts` reopen
past the first lost diagnostics permanently (tsserver; first open fine,
remount/reopen dead). Bridge fix: server lifetime is last-socket-scoped
(`stopEntry` when the last consumer disconnects) so a reconnect gets a FRESH
process. TDD: LIVE reconnect block added to `selftest.lsp.mjs` — RED on BASE
(initialize never answered, 20 s), GREEN after (fresh spawn, `spawned === 2`).
This reverses an old deliberate comment (warm rust-analyzer reuse) — the
recorded rationale: a fresh spawn costs a cold start; a warm corpse costs the
feature.

## RED/GREEN evidence

- SSE trust gate: BASE swap → `AssertionError: no token -> 403 (deny-default,
  Task 7 trust boundary)` (selftest.mjs) and `the root-filtered stream is
  opened with a tree-read token minted for that root` (selftest.client-events).
  Restored → GREEN.
- Spike threat pins + gen-ui DEFERRED marker: 0 occurrences at BASE
  (grep-counted during the BASE swap) → present after.
- Sidebar events pin: RED on pre-fix client (`AssertionError: the Freestyle
  push stream opens with a minted tree-read token`) → snippet fix + regen →
  GREEN (freestyle + drift + full sidebar suite).
- lsp reconnect: RED `reconnect did not answer initialize in 20s — the reused
  server is wedged` → GREEN `55 ok` (fresh spawn asserted).

## Files changed (commit 78c1654)

`docs/plans/artifact-viewer-demo-runbook.md`, `docs/plans/artifact-viewer-vscode-monaco.md`;
`plugins/artifact-viewer/lib/{client,index,watcher,lsp}.js`;
`lib/monaco-build/src/{entry.mjs,spike.html}`;
`plugins/artifact-viewer/selftest.{mjs,lsp.mjs,client-events.mjs,root-open.mjs,roots.mjs}`;
`plugins/arxa-sidebar/lib/{client.js (regenerated),freestyle-region.snippet.txt}`,
`plugins/arxa-sidebar/selftest.{mjs,freestyle.mjs}`;
`plugins/gen-ui/lib/client.js`;
`designs/evidence/studio-closeout/{1280×7,744×1}.png`.

## Self-review findings

- Double-stopEntry on ws error+close both firing — guarded after review.
- Allowlist freeze test is a FREEZE (passes on BASE entry.mjs — the 14
  imports predate this task); its job is future-proofing, the suite-wide RED
  came from the deny-default assert. Noted, not changed.
- The studio was rebooted between evidence phases; every shot comes from the
  FINAL code (post sidebar/lsp fixes) except the kept 744 dart strip
  (attempt 2, strip copy unchanged and pinned by selftest).

## Concerns

1. **Narrow-rung evidence (390/744) is blocked, not delivered**: the sheet
   does not mount on emulated resize and the wide-only sidebar is the only
   headless file entry — no driver-reachable narrow-mode artifact open. 744
   keeps the dart strip; 390 has nothing. Recorded as a medium ledger finding
   with the follow-up path. The brief's "capture 390/744/1280" is met at
   1280 only.
2. **The brief's ".html squiggle on screen" is unsatisfiable by design**:
   `.html` routes to the org-origin preview iframe (implementation plan line
   111), and vscode-html-language-server publishes no diagnostics for classic
   error inputs by default (measured at the bridge; css server as positive
   control). Documented in the amended runbook + ledger instead of forcing a
   product change (out of scope).
3. **Zero-console-error gate is scoped**: pre-existing/unrelated noise
   (design-panel `__dial/events` refused connections; tsserver "No Project"
   warmup errors, proven pre-existing on the untouched org file) is filtered
   WITH the filter list in the driver and named in the ledger; anything
   artifact-viewer-originated fails the run. All delivered shots are clean
   under that scoping.
4. Two predecessor OOMs came from this same evidence phase; the capture
   driver + scratch org (`/tmp/arxa-task7`) are reusable for Task 8's
   evidence completion once the narrow-entry gap is fixed.
