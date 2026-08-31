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
- **T1 — scripts/gen-frame.mjs**: transform stock ui-layout client with
  deltas: `viewer` store key + set/open/close/toggle actions (clamp
  min 320), viewer column in computeColumns + grid, DragHandle clone,
  session-bound presence (detailsSession source), narrow→sheet branch,
  maximize helper, module id/tag. Drift gate in artifact-viewer selftest.
- **T2 — plugins/artifact-viewer/lib/client.js rebuild**: drop
  shell.overlay registration (guard in selftest); column citizen UI
  (header: tabs preview/code, ⤢, ✕; path input; session-changes list;
  D85 badge); sheet branch at narrow; session-switch rebind; consume wt
  lane for worktree files.
- **T3 — tokens.js + routes**: worktree-bound read token kind;
  `/__arxa/artifacts/wt` (escape-proof, worktree-scoped, Range-aware);
  `/__arxa/artifacts/tree?dir=…` (lazy listing, exclusions, bounded).
- **T4 — arxa-sidebar files section**: Files rows under the open org from
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
