You are implementing Task 12 PART B (of two): the gates + adjudication half of "Reconcile and finish the Flutter mobile deliverable". Part A (files-only) landed: arxa worktree commit 132f9003 (CI frame, fastlane trio, shorebird dormant, signing contract test, deploy/README, build.gradle.kts) + studio commit 8e3bc01 (checklist closed). You run the gates, resolve leftover WIP, and finish the task.

Work in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-closeout (branch closeout-2026-09-12) + the studio worktree for any residual doc fix. Report file: .superpowers/sdd/2026-09-12-arxa-studio-closeout/task-12-report.md (append `## Part B`). Brief: .superpowers/sdd/2026-09-12-arxa-studio-closeout/task-12-brief.md.

## 0. Adjudicate the inherited WIP FIRST

The worktree holds an UNCOMMITTED refactor from a killed implementer: `lib/data` → `lib/services` (31 entries, mobile_flutter). Inspect it (git status/diff). Decide:
- If it is a genuine parity fix the migration-spec demands (or Part A's report/import map references it): COMPLETE it properly — behavior-TDD per sibling law (test names cite story-IDs), run the focused tests, commit as its own commit `refactor: move mobile data sources under services` (or fitting), trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- If it is NOT required by the brief/spec (speculative): REVERT it cleanly (checkout the paths; the uncommitted state is yours to discard — nothing committed depends on it: verify with a grep that no committed file imports lib/data).
State which and why in the report.

## 1. Run the gates (RAM discipline: ONE at a time; kill toolchains between; system disk has ~2 GiB free — export GRADLE_USER_HOME and any caches into the worktree volume; fvm flutter via `command -v flutter` first)

Expected per brief + Part A, in this order:
1. `mkdir -p mobile_flutter/build/ios/SourcePackages` (fresh-worktree SPM quirk, Task 1 lore).
2. Formatting check, `flutter analyze`, `flutter test` under mobile_flutter (expect the Part A contract test `android_release_signing_contract_test.dart` to run; if it fails RED for a real signing gap, fix per brief Step 4 test-first).
3. Transport package tests: `kit/studio_transport/**` (dart test).
4. `arxa gate --all` (the AOT wrapper — canonical checkout's install; `command -v arxa`; if it must run from the sibling repo, `dart run` from the worktree per AGENTS.md, else the wrapper — use whichever AGENTS.md prescribes).
5. `bash scripts/check.sh` end-to-end once (the one-root gate Part A wrote).
6. actionlint on all three workflows.
Expect flutter to auto-edit `analysis_options.yaml` + re-pin 5 pub lock entries (Task 1 lore): make the evidence-based call (commit the tool's edits if they are the tool's canonical output, else restore) and say which.
7. Studio-side: `npm test` ONCE (exit 0, ALL GREEN, suite count).

## 2. Fix failures test-first; keep scope to the brief

Ruling 10: do NOT rebuild transport/push/approvals; fix only failed parity rows. Ruling 11: no Australia/Mauritius encoding. No Windows. NO push/tag/release/store submission.

## 3. Commit(s)

Any fixes as their own commits (trailer as above). If everything was already green, Part B may commit nothing — say so.

## Report back ONLY (under 12 lines)

Status; WIP adjudication one-liner; gate results one-liner (analyze/test counts, transport, arxa gate, check.sh, actionlint, studio npm test); lockfile/analysis_options decision; commits; concerns. Never spawn claude/agents/reviewers; never print secrets; scratch state only.
