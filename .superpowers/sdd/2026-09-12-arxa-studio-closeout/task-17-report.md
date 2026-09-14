# Task 17 report — final documentation, vocabulary, zero-open-items closeout

2026-09-14. Steps 1–6 + 8 + 9 mine; Step 7 (whole-program review) dispatched separately by the
controller. Full narrative in the ledger `progress.md` §Task 17; product-facing closeout doc:
`docs/plans/arxa-studio-closeout-2026-09-12.md`.

## Per-step evidence

**Step 1 (final matrix).** `docs/plans/open-work-inventory-2026-09-12.md` rewritten as the final
matrix (chosen over a new doc: every AXS row already lived there; the new closeout doc links it).
Counts: **CLOSED 33** (AXS-001–014 program outcomes with commits/evidence + AXS-033–051
pre-program) · **EXTERNAL 14** (AXS-015–022, 053, 055–059, 062–064, 067) · **DEFERRED 17**
(AXS-023–032, 052, 054, 060, 061, 065, 066, 068). Zero ambiguous rows. Carry-ins: T16 Part B legs
EXTERNAL verbatim-class (commands copied unsoftened); G12/G12c PREPARED → AXS-060/061 (RAM
discipline, scratch-safe class); installer-channel divergence → AXS-054 (trigger: first src-tauri
channel-file read change); `arxa gate --all` inherited debt → AXS-059 (owner outside program);
branch-protection-after-first-green → inside AXS-053 (G11); the three whole-branch-review rows →
AXS-062/063/064, owners named, explicitly awaiting Step 7 adjudication (not resolved here).

**Step 2 (vocabulary).** All "studio lacks `changes-requested`/version minting" claims resolved
with dated notes preserving history: `arxa-studio-vocabulary-collisions.md` (final-outcome banner
+ agreed-list note), `arxa-isolation-levels.md` (B12 note, §28a note, status banner), 
`session-execution-log.md` (snapshot note). `supersededBy` decision: **NOT ACCEPTED, NOT ADDED** —
no arxa-side design/version contract carries the field (grep of arxa worktree at `3b6e08ea`: zero
matches); recorded in AXS-032 + the plan doc; no unconsumed field added on either side.

**Step 3 (stale checklists).** Dated outcome notes added: artifact-viewer-implementation,
artifact-viewer-demo-runbook, local-only-git-parity-and-sidebar-decorations, arxa-isolation-levels,
freestyle-section, org-row-dashboard, palette-personalisation, claude-subscription-engine-implementation
(addendum), session-naming-agent-controls-and-cicd-card, mobile-grill-decisions. Already bannered
(verified, untouched): mobile-flutter-migration-spec (2026-09-14), project-sessions-physical,
github-conversations-in-the-insight-panel, agency-backend-provider-abstraction,
open-work-inventory-2026-09-07.

**Step 4 (deferral triggers).** Each named deferral sharpened to a concrete trigger in the matrix:
Freestyle verbs (AXS-028), viewer edit-with-agent (AXS-029), dashboard-inside-open-chat (AXS-030),
biometric approvals (AXS-027), dsh cold-boot (AXS-020). None remains an ambiguous unchecked box.

**Step 5 (consistency searches).** `PLAN ONLY` / `nothing built` / `still open` / unchecked boxes
over `docs/plans/*.md` — every match dispositioned (historical context, inventory row, or dated
resolution pointer). Full match-by-match list in the closeout doc §Documentation consistency
searches. Unchecked boxes (110 across 3 files) all carry dated banners.

**Step 6 (verification).** One gate at a time:
- studio `npm test` → **130 suites ALL GREEN** (`arxa-studio CI: ALL GREEN`, engine-boot-smoke
  GREEN). Ran twice (second only to count GREEN lines = 130) — both fully green; disclosed.
- arxa `fvm flutter analyze` → **No issues found!** (4.6 s).
- arxa focused `flutter test test/android_release_signing_contract_test.dart` → **4/4 All tests
  passed**.
- arxa `bash scripts/check.sh` → RED only at `FAIL [gates] arxa gate --all exit 1` (inherited
  pre-branch debt, AXS-059; branch diff ∩ gate inputs = ∅); rust transport 11/11 green visible.
- arxa `actionlint` ×4 → all OK (ci, desktop-gate, desktop-release, mobile-release).
- Controller ruling precondition VERIFIED per-path: `git show --name-status 3b6e08ea` (the only
  commit after `5930302d`, the T12 re-review base) touches only
  `mobile_flutter/deploy/physical-gates.md` — no `arxa/lib`, `mobile_flutter/lib`, or `kit` Dart
  source changed after the accepted 2026-09-13/14 runs → full arxa `dart test` + `flutter test` +
  `cargo test` stay ACCEPTED, no re-run needed.

**Step 8 (closeout report doc).** `docs/plans/arxa-studio-closeout-2026-09-12.md` — commits per
repo (studio `4d1b924..902551d` 25 listed + BASE/plan; arxa `5749402b..3b6e08ea` 6),
verification table, evidence pointers (T16 matrix, evidence ladder, mobile evidence dirs, SDD
ledger), retained deferrals, external gates with owners, rollback notes (revert ranges per repo;
Supabase migration reversal SQL pointer — inverse in-file, `supabase migration down --last N`;
no remote ever moved).

**Step 8b (README/CONTEXT).** One dated section each, shipped behavior only: README
"Shipped 2026-09-14 (closeout program)" (A0–A5 + sandbox/docker/sbx, workspace-provider Wire v1 +
supabase, git-card checks row + ledger strip, trash quiesce, repair-repo, locales, evidence
gates, mobile CI frame, linux distribution prep); CONTEXT "Added 2026-09-14" (Workspace provider,
Confinement tier, Local Checks row, Delivery ledger strip, Trash quiesce, Repair repo).

**Step 9 (commit).** Studio: `docs: close the arxa studio implementation program` — 16 modified
docs + the new closeout doc; the SDD ledger/report under `.superpowers/` are untracked scratch by
repo convention and stay out of the commit. Arxa: one-file commit (docs/linux-support.md AXS-053
renumber), same message. No push/merge/tag. `git diff --check` clean. `package-lock.json` residue
already absent (T16 fix round restored it).

## Self-review

- Every brief deliverable mapped; the three Step-7-owned items deliberately untouched.
- Claims in banners are commit/row-cited; no blanket "pre-existing" sentence carried (T16's
  Important-1 lesson honored — each row carries its own basis).
- Weakness: `npm test` and `check.sh` each ran more than once (disclosed above); RAM discipline
  (sequential gates) was honored.
- Weakness: my session-execution-log snapshot note leans on the 2026-09-12 inventory's exhaustive
  re-verification for B7 rather than a fresh B7-specific probe — recorded as such in the note.

## Concerns (for the Step 7 reviewer)

1. AXS-066 (no D77 version bumps on the branch) is a real first-pack hazard, not just a checkbox.
2. AXS-063/064 (viewer-LSP, dock-dead) remain live product defects with external owners — the
   branch records honest limitations; do not let the closeout read as "no known defects".
3. The renumbering AXS-052/053 touched an arxa-side doc (linux-support.md) — verified the only
   two stale references (G10 matrix row, linux-support) were fixed; SDD scratch files still say
   042/043 in historical entries (left as history).

## Report path

This file. Product closeout doc: `docs/plans/arxa-studio-closeout-2026-09-12.md`.
