# Task 17 brief — Final documentation, vocabulary, and zero-open-items closeout

Plan section: docs/superpowers/plans/2026-09-12-arxa-studio-closeout.md ### Task 17 (lines 489–511) — its Steps 1–6, 8, 9 are yours. Step 7 (whole-program review) is dispatched separately by the controller after you finish. Governing sources: the plan + every doc it cites, README.md, CONTEXT.md, CLAUDE.md, the SDD ledger, the T16 evidence matrix.

## Inputs (read all; they are your map)

- SDD ledger: .superpowers/sdd/2026-09-12-arxa-studio-closeout/progress.md — every ruling, deferred minor, parked item, escalated finding, and per-task completion. First source of truth.
- T16 matrix: docs/plans/closeout-evidence-2026-09-12.md — the Part B legs the operator has NOT authorized stay EXTERNAL with owner + prepared command; copy their disposition into the final inventory verbatim-class (do not soften).
- Inventory: docs/plans/open-work-inventory-2026-09-12.md (AXS-001…AXS-043).
- T15 deferred minor: installer-channel vs in-app ARXA_UPDATE_CHANNEL divergence — MUST become a tracked inventory row here (with trigger: first src-tauri channel-file read change).

## Deliverables (plan steps, concretized)

1. **Final matrix (Step 1):** in `docs/plans/open-work-inventory-2026-09-12.md` (or the new closeout doc if cleaner — say which), every `AXS-*` item ends `CLOSED` (commit + evidence pointer), `DEFERRED` (concrete trigger), or `EXTERNAL` (owner + verbatim prepared command). Zero ambiguous rows. Carry in: T16 Part B legs (unauthorized → EXTERNAL), G12/G12c PREPARED rows, installer-channel row (new), the `arxa gate --all` inherited debt (external owner outside this program), branch-protection-after-first-green.
2. **Vocabulary (Step 2):** remove any claim that studio lacks `changes-requested` or version minting (D98/D99, mintVersion evidence). Record the `supersededBy` decision ONLY if an arxa-side design/version contract accepts it during YOUR read — else record "not accepted, not added" with the pointer. Do not add unconsumed fields.
3. **Stale checklists (Step 3):** mobile, project routing, Claude implementation, artifact viewer, Git decorations, GitHub sign-in, sbx research, Freestyle, dashboard, palette — mark per current evidence with dated outcome notes; preserve history.
4. **Deferrals with triggers (Step 4):** Freestyle multi-select/clipboard/compact-folders/file-nesting/sort, viewer edit-with-agent, dashboard-inside-open-chat, biometric approvals, dsh cold-boot work — each gets a concrete trigger, none left as an unchecked box.
5. **Consistency searches (Step 5):** grep the cited plans for "PLAN ONLY", "nothing built", "still open", unchecked acceptance boxes — every match must be historical context, an inventory row, or carry a dated resolution pointer. Record the search + match dispositions in the closeout doc.
6. **Final verification (Step 6):** studio `npm test` ONCE (expect 130 suites ALL GREEN — engine-boot-smoke included). Arxa worktree: `fvm flutter analyze` + focused `flutter test test/android_release_signing_contract_test.dart` (4/4) + `bash scripts/check.sh` (red only at inherited `gates` area) + actionlint ×4 — ONE at a time. RULING (controller, cite it): full arxa `dart test` + full `flutter test` + `cargo test` ACCEPTED on their 2026-09-13/14 review-clean runs (T15 ALL-PASS; T12 re-review 108/108 + 11/11) because NO arxa/lib, mobile_flutter/lib, or kit Dart source changed after those runs — verify that claim with per-path `git log` before relying on it; if any such path moved, re-run the affected suite instead.
7. **Closeout report (Step 8):** create `docs/plans/arxa-studio-closeout-2026-09-12.md` — commits by repository (studio 4d1b924..HEAD list; arxa 5749402b..HEAD list), tests, visual/physical evidence pointers, retained deferrals, external gates with owners, rollback notes (revert commits per repo; migration reversal SQL pointer from T14; no remote ever moved).
8. **README.md / CONTEXT.md** — only where shipped behavior changed (A0–A5 confinement + sandbox/docker/sbx, workspace-provider wire v1 + supabase, git-card checks row + ledger strip, trash quiesce, repair-repo, locale en/pl/fr, evidence gates, mobile CI frame, linux distribution prep). One dated section each, no marketing prose.
9. **Commit (Step 9):** `docs: close the arxa studio implementation program` (studio; arxa-side files if any commit separately same message), trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`. No push/merge/tag.

## Constraints

Global constraints verbatim (plan). RAM: one gate at a time; no browsers (evidence already captured — point, don't re-capture). Disk: system ~2 GiB. Canonical checkouts READ-ONLY. Findings → ledger "New finding:". No subagents. Never print secrets. Do not resolve whole-branch-review-owned items yourself (cell-launcher danger-full-access seed, L1/L2 viewer-LSP external row, dock-dead RIDE) — those rows state their owner and await Step 7 adjudication.

## Report

Full report → .superpowers/sdd/2026-09-12-arxa-studio-closeout/task-17-report.md: per-step evidence, matrix row counts (CLOSED/DEFERRED/EXTERNAL), consistency-search dispositions, verification results, commits, self-review, concerns. Reply ONLY (under 15 lines): status; matrix counts; vocabulary decision; verification one-liner; commits; concerns; report path.
