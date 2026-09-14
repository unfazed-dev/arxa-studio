You are implementing Task 16 PART A (preparation + scratch-safe legs) of "Execute authenticated and physical acceptance gates" (arxa-studio closeout program). PART B (authenticated/physical legs) runs later, per-leg, only after the operator explicitly authorizes — you NEVER decide an authenticated leg is fine to run.

Your requirements — read FIRST, verbatim values live there:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-16-brief.md

## Worktrees + machine constraints

- Studio worktree: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout (branch closeout-2026-09-12, HEAD 8e3bc01) — matrix + studio evidence.
- Sibling arxa worktree: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-closeout (branch closeout-2026-09-12, HEAD 5930302d) — physical-gates.md extension + mobile evidence + sbx feed fetch.
- Canonical checkouts READ-ONLY. Operator's ~/.arxa never touched (scratch ARXA_HOME only). Operator's Docker daemon/VM NEVER started by you.
- RAM: one suite/toolchain at a time, kill between. Browser use = ONLY the single dock-dead reproduction probe (headless CDP, 480 s budget). System disk ~2 GiB — caches into worktree volumes.
- Binding law: never run paid/authenticated/credential-bearing/operator-state-mutating gates; never print tokens/keys/.env values; no push/merge/tag/publish; no subagents; findings → ledger append (.superpowers/sdd/2026-09-12-arxa-studio-closeout/progress.md, "New finding:" lines).

## Notes that update the brief (newer than its text)

- Deliverable 2: physical-gates.md EXISTS (landed in T12 fix round, commit 5930302d). Known gap to close (T12 re-review minor): the integration test's 4th phase `PHASE=phone` (real-APNs doorbell leg + `ARXA_DOORBELL_PUSH` / `ARXA_APPROVALS_TEST_SEAM` / `CAIRN_APNS_SANDBOX` + `.p8` env) is undocumented; line-number cites `approvals_e2e_test.dart:312/316+` may have drifted — verify against the file.
- Row G12: T12's Steps 5/8 were ruled disclosed-deferred by the T12 review — they are YOURS under RAM discipline (simulator smoke + release-automation-no-publishing incl. `arxa deploy --self-test` and disposable-keystore AAB/APK; iOS stops at doctor). Run them if RAM/disk allow; if a leg is too heavy, PREPARED row with exact command — say so.
- The escalated findings (deliverable 5) carry conditions from earlier re-reviews: dock-dead was ruled RIDE on the operator's installed studio being daily counter-evidence — your job is the ONE fresh-boot probe at HEAD, then close-or-keep honestly.

## Order

Brief's deliverables 1–7 in order (matrix skeleton early so every later action records into it). End with ONE full studio `npm test` (expect 130 suites ALL GREEN) if you touched anything studio-side.

## Report

Full report → .superpowers/sdd/2026-09-12-arxa-studio-closeout/task-16-report.md (## Part A) per the brief's report contract. Reply ONLY (under 15 lines): status; adjudication one-liners (L1/L2, dock-dead, L3); scratch-safe legs run (incl. G12 verdict); matrix counts DONE/PREPARED/EXTERNAL; commits (repo+SHA+subject); authorization request list (gate ids, one-line cost/mutation each); concerns.
