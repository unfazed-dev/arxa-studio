You are implementing Task 12: Reconcile and finish the Flutter mobile deliverable (arxa-studio closeout program, wave 6 — existing release surfaces). This is the arxa-repo-heavy task; you work in the sibling arxa worktree plus one studio-side doc commit.

## Task Description

Read your task brief FIRST — it is your requirements, with the exact values to use verbatim:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-12-brief.md

## Worktrees + machine constraints

- Sibling arxa worktree: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-closeout (branch closeout-2026-09-12, base fff96bee after Task 15). Your work lands here.
- Studio worktree: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout (branch closeout-2026-09-12, HEAD 2c74ab0) — ONLY `docs/plans/mobile-flutter-migration-spec.md` changes land there.
- CANONICAL arxa checkout is READ-ONLY and DIRTY — never touch it. The operator's ~/.arxa is never touched (scratch only).
- Brief-required task skills `arxa-cicd` and `arxa-deployer`: their authoritative skill files live in the sibling repo — find and READ them as your templates (look under /Volumes/business_ssd/arxa_digital_solutions/arxa/.claude/skills/ or wherever the repo keeps its skills; the child session may not auto-load them). Do NOT re-grill the operator on CI decisions — the brief records them (private monorepo, main trunk, hosted Ubuntu Android lane, self-hosted macOS/ARM64 iOS labels, per-job timeouts, concurrency cancellation, `arxa gate --all` + flutter format/analyze/test, deploy jobs prepare-then-halt at human approval).
- Flutter via fvm (`command -v flutter` first, else `fvm flutter`). New-finding-1 lore from Task 1: fresh worktrees may need `mkdir -p mobile_flutter/build/ios/SourcePackages` before the SPM plugin-copy step succeeds; flutter auto-edits `analysis_options.yaml` and re-pins five pub lock entries — Step 1 must EXPECT both and decide (evidence) whether to commit the tool's edits or restore them.
- DISK: the SYSTEM disk has only ~2 GiB free; the worktree volume has 62 GiB. For anything heavy (gradle, pod/SPM, derived data), export GRADLE_USER_HOME and any caches into the worktree volume or TMPDIR-on-business_ssd; keep system-disk writes minimal.
- RAM: one build/test at a time; no browsers; kill toolchains between phases.
- If a hook refuses a compound shell command, split it. No subagents ever. Findings → ledger append (.superpowers/sdd/2026-09-12-arxa-studio-closeout/progress.md).

## Key rulings already made (binding)

- Program ruling 10: mobile migration is PRESUMED IMPLEMENTED — audit and close the stale checklist; do NOT rebuild existing transport/push/approvals/conversations work. Fix only failed parity rows, test-first. Preserve the Rust-owned iroh/loopback seam.
- Program ruling 11: commercial entity remains external legal — code accepts product/price/seller config, encodes no Australia/Mauritius specifics.
- The brief's Steps 1–7 are your order. Step 4 keeps application ID `solutions.arxadigital.arxa.mobile`, release signing from gitignored `key.properties`/CI secrets with clear failure when absent (debug key only for debug builds); confirm iOS team/bundle/entitlements vs release config.
- Commits: arxa-side `feat: reconcile mobile ci and release readiness` (CI frame + fastlane + signing + parity fixes may split into logical commits if you prefer — say what you did); studio-side `docs: close the mobile migration checklist`. All commits end with a blank line + `Co-Authored-By: Claude Code <noreply@anthropic.com>`. NO push, NO store submission, NO release upload — external gates belong to Task 16.

## Global Constraints (binding, verbatim from the plan)

- Every behavior change RED → verify → minimal GREEN → focused tests → gate → commit (sibling repo law: behavior-TDD, test names cite story-IDs from map.json / kit.<package>.<capability>).
- Never print tokens, API keys, OAuth codes, signing material, .env values, or credential-store contents.
- Scratch state only. Never mutate the operator's real organisations, credentials, sessions, Docker state, or GitHub repositories.
- No Windows work (D23 deferral). No push/merge/tag/publish.
- Do not carry newly found unrelated work into this program — record it under "New finding:" in the ledger with severity and a follow-up path.

## Report

Write your full report to:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-12-report.md
covering: per-step evidence (commands + key output), the twelve-box parity map result, what was fixed test-first vs already-present, CI frame files created via the skill templates, signing-validation evidence, the analysis_options/lock decision, gates run, commits per repo, self-review, concerns.

Then report back with ONLY (under 15 lines):
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Commits (repo + short SHA + subject)
- One-line gate summary (flutter analyze/test + transport tests + arxa gate + workflow syntax)
- Parity boxes one-liner (12/12 closed? fixes made?)
- Your concerns, if any
- The report file path

Never silently produce work you are unsure about.
