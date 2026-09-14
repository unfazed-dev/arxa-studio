# Task 1 report — truthful baseline + stale-work retirement

**Status: DONE_WITH_CONCERNS** (one tooling finding for Task 12, see Concerns; all steps complete).
**Commit:** `7334ddb` `docs: reconcile the arxa studio closeout inventory` (7 files, +133, docs only).

## What was implemented

- `docs/plans/open-work-inventory-2026-09-12.md` created: 51 `AXS-*` rows — 14 `OPEN` (bijectively mapped
  to Tasks 2–15), 8 `EXTERNAL` (5 gates on Task 16; 3 upstream/sibling-owned), 10 `DEFERRED` with dated
  triggers, 19 `CLOSED` with 2026-09-12 source+test evidence.
- Dated supersession banners added to the six governing sources (status/front-matter only; no narrative
  rewritten).
- SDD ledger appended with the Step 1 immutable facts, the Step 2–4 evidence, and two `New finding:` entries.

## Evidence per step

**Step 1 — starting facts** (recorded in `progress.md` §"Task 1 — evidence log"):
- studio worktree HEAD `4d1b9241f9a176e737714826ddc31f51181dd679`, `## closeout-2026-09-12` + ` M package-lock.json`
  (pre-existing at dispatch: lock catching up 2 root pins `@deepseek-ai/dsh-agent-presets 0.1.2-rc.1`, `ws ^8.21.3`;
  left uncleaned and NOT committed).
- node `v24.19.0`; pins: claude-agent-sdk `0.3.259`, dsh family `0.1.2-rc.1`, MCP SDK `1.30.0`, zod `4.4.3`.
- sibling canonical `5749402b4e55181c4269510803698e2b1308c83d` (main ahead 2, dirty — untouched);
  sibling worktree `.worktrees/arxa-closeout` `5749402b`, clean.

**Step 2 — studio baseline:** `npm test` → exit 0, `arxa-studio CI — 110 suites` / `arxa-studio CI: ALL GREEN`
(110 GREEN, 0 RED). Log `/tmp/arxa-studio-task1-npmtest.log`.

**Step 3 — closures proven (focused runs, 2026-09-12):**
- routing `selftest.routing: 19/19 passed`; versions `selftest.versions: 14/14 passed`;
  decorations `selftest.decorations: ALL GREEN`; github-link `selftest.auth-flow: 7 ok`
  ("authorization seam is mounted by a profile row"); claude surface `4 ok`; `pack-list-check: 10 ok`.
- Source citations: `routing.js` DOCK_ROUTES (D98/D99), `versions.js` `VERSION_STATES` incl. `changes-requested`,
  stamp removal commit `a003287` (+ `manifest.js:26`), sbx commits `9119642`/`fd6c137`/`30a7863`,
  Freestyle/dashboard/palette suites GREEN in the CI log (`967b2cc`, `82681e1`, `10ea9df`).
- Top-level Projects/project/stage decoration rollups kept OPEN under Task 4 (AXS-003).

**Step 4 — mobile audit (isolated arxa worktree):** `flutter analyze` → `No issues found! (ran in 9.9s)` exit 0;
`flutter test` → `All tests passed!` (+104) exit 0. All 12 §a parity boxes mapped to code/tests
(pairing shell + mobile_scanner, `kit/studio_transport/rust/src/transport.rs` AUTH/ALPN/loopback/PUSH/revocation,
`transport_service.dart` persistence/reconnect/`setPushToken`, identity `solutions.arxadigital.arxa.mobile`,
UA `ArxaShell/0.1`). Genuine residuals only: Android release signing (debug-only `signingConfig`,
`android/app/build.gradle.kts:32`), CI frame, release automation, physical gates → AXS-011/AXS-018/AXS-031.

**Step 5 — inventory + banners:** as above; every OPEN row carries ID, owner repo, source plan, current
evidence, remaining deliverable, dependency, closure command, and owning task number.

**Step 6 — verification:** `TBD` 0 / `TODO` 0 / `maybe` 0 (case-insensitive); 51 unique sequential IDs;
uniform table shapes (14×10, 8×8, 10×6, 19×5 fields); every OPEN row's task column is exactly one of 2–15;
links resolve. Fixed one defect found here: a raw `|` inside AXS-012's backticks split a table cell.
Reviewer cross-check of every row against source is the controller's scheduled review.

**Step 7 — commit:** `7334ddb`, docs only; `package-lock.json` left dirty per "do not clean" and "commit only
documentation".

## Files changed

- Created: `docs/plans/open-work-inventory-2026-09-12.md`
- Banners: the six governing sources under `docs/plans/`
- Ledger (git-ignored, local): `.superpowers/sdd/2026-09-12-arxa-studio-closeout/progress.md`
- Sibling worktree: restored clean after the audit (flutter's auto-edits to `analysis_options.yaml` and
  `pubspec.lock` reverted; gitignored `build/ios/SourcePackages` scratch dir created).

## Inventory row count by state

`OPEN` 14 · `EXTERNAL` 8 · `DEFERRED` 10 · `CLOSED` 19 — total 51.

## Self-review findings

- Wrote only what the plan names: one new inventory, banners on exactly the six sources, ledger append.
  No code, no extra docs, no sibling-repo commits.
- Cross-checked each 2026-09-07 "open" claim against current source before assigning a state; three were
  stale-closed (zai handoff, cicd-card live smoke, Claude sign-in surface) and are CLOSED rows with pointers.
- The three arxa-repo non-program backlogs are EXTERNAL rows (—), not OPEN, so the no-orphan rule holds:
  every OPEN row maps to exactly one Task 2–16.

## Concerns

1. **Tooling (New finding 1, severity low):** fresh worktrees fail `flutter analyze/test` in the SPM
   plugin-copy step (rsync 3.5.0 cannot create `build/ios/SourcePackages/<plugin>`); workaround
   `mkdir -p mobile_flutter/build/ios/SourcePackages`. The flutter tool also auto-edits
   `analysis_options.yaml` and re-pins 5 lock entries. Task 12 Step 1 must expect both.
2. EXTERNAL rows AXS-020–022 (upstream dsh, sibling commerce backlog, sibling design-tool backlog) carry no
   program task by design — they are outside the 17-task scope; flagged so the reviewer can confirm the
   scoping call.
3. `package-lock.json` remains dirty in the worktree (pre-existing at dispatch, deliberately untouched).
