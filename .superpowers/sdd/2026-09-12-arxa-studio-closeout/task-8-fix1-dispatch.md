You are FIXING Task 8's Step-4 gaps (review verdict: Needs fixes). Work in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout (git worktree, branch closeout-2026-09-12, HEAD 4347f07).

## Inputs

- Review: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-8-review.md (read the Ladder + Findings Adjudication section — it is your worklist)
- Prior report (+ your future `## Fix round 1`): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-8-report.md

## Findings to fix

IMPORTANT 1 (L4 bucket) — five surfaces have ZERO evidence at any width: **Finish, Checks-red disclosure, project preparation, confinement configured/effective, Workspace backend** (+ signin already accepted as a genuine scope limitation; trash 744 missing, trash 390 has one view shot). The reviewer ruled these are NOT acceptable as recorded limitations because no 1280 control exists and the stated cause ("conversation pane never mounts") is symptom-shaped — this task's own drivers already had two trigger-discovery bugs. For EACH of the five surfaces:
  a. Capture a 1280 CONTROL first (extend `scripts/evidence-capture-narrow.mjs`/`evidence-gate.mjs` to run the ladder at 1280 too, or a --width flag).
  b. If the 1280 control works: fix the narrow-lane trigger for that surface (find the REAL mount trigger from product code — the previous trigger discoveries were `button[aria-haspopup="dialog"]`-class fixes) and capture at 390+744; if after genuine trigger work a surface still cannot mount at a narrow width, the limitation row may stand ONLY with the 1280 control attached as evidence.
  c. If the 1280 control ALSO fails: that is a defect — diagnose briefly; if it's a driver bug, fix the driver; if it's a product bug in code this program touched, fix it test-first (TDD constraint); if it's a pre-existing product bug outside touched code, record it as a New finding (severity + follow-up) and capture the failure state as the honest evidence.
  Also: trash confirmation/recovery at 744 (and the 390 trash pair that hard-failed — retry once after the trigger fixes; the earlier wedge was a 480s budget kill).

IMPORTANT 2 — formalize the escalations in the ledger as explicit `New finding:` entries (they exist but scattered): L1/L2 viewer LSP chain dead on fresh boots (code ref `plugins/artifact-viewer/lib/index.js:183-191` — lsp token 403s without `selectedOpenRoot`; committed 1280 squiggle evidence from 78c1654 unreproducible on fresh boots) — tag for whole-branch review + Task 16; L3 `wp.info()` invalid server response at all widths — New finding, and DELETE the unsupported "regression vs T8-era committed backend evidence" claim from the report (no backend PNG exists anywhere; the reviewer verified).

MINOR 3 — reconcile the ladder summary counts with `narrow-capture-log.json` (the log is authoritative; report's counts were muddled). MINOR 4 is noted-only (commit-type deviation on an already-landed commit — do not rewrite history).

## Method + RAM discipline

Work exactly like the successful narrow-lane fixer: driver code changes from product-code reading; browser runs ONE at a time via the script; kill browser process trees between runs; if memory pressure drops below ~20% free, pause and clean up your own headless processes. Re-run the full ladder script END-TO-END at the end (now including 1280 controls); verify the log's counts; `npm test` ONCE at the very end only if you changed product code (otherwise the touched selftests suffice — say which you ran).

## Commit

`fix: complete the surface evidence ladder with controls` (blank line, trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`). `package-lock.json` dirt stays out. Evidence PNGs + logs + report/ledger edits ride the commit (ledger/`report` are gitignored — they update on disk, not in the commit; PNGs/logs commit).

## Report back ONLY (under 12 lines)

Status; commit; per-surface one-liners (5 surfaces + trash: captured@widths / limitation-with-control / finding#); ledger escalations recorded (L1/L2/L3); test one-liner; concerns. Never spawn claude/agents/reviewers; scratch state only; never print secrets; no push/merge/tag.
