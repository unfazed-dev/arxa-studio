You are implementing the approved native-speaker corrections for Task 8 (arxa-studio closeout; Step 3 implementation half). Work in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout (git worktree, branch closeout-2026-09-12, HEAD d3a7c47). NO browsers.

## Inputs

- Polish review: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-8-pl-review.md (2 must-fix, 12 nice-to-fix)
- French review: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-8-fr-review.md (3 must-fix, 13 nice-to-fix)

## Rules (from the plan, Step 3)

Implement ONLY corrections that preserve the source meaning and UI length constraints. All MUST-FIX corrections land. For NICE-TO-FIX: land the ones that are pure consistency/agreement/typography corrections with zero meaning change (e.g. terminology unification, plural agreement, diacritics); skip any that alter tone/meaning or risk overflow, and say which you skipped and why in the report.

Notable must-fixes (shared + per-language):
1. artifact-viewer install strip ships hardcoded English literals with NO locale keys (`plugins/artifact-viewer/lib/client.js` ~:888-897) — BOTH reviews flagged it. Convert to proper keys in the owning dictionary with en/pl/fr values (follow the plugin's existing key pipeline so drift checks apply), preserving the exact strip copy semantics.
2. pl: `git.wakeStarted` "kontrole" → unify with the other 14 checks keys ("testy" per the reviewer's proposal).
3. fr: `git.parked` «Porte rouge» → «Gate rouge» (Gate is a protected product term — check CONTEXT.md); `git.wakeStarted` «contrôles» → «vérifications».
Regenerate whatever generated clients your dictionary edits require (the owning plugins' gen --write), run their drift --check, then the focused locale/parity suites + the touched plugins' selftests.

## Verification

`node plugins/locale/selftest.parity.mjs` + each touched plugin's selftest + gen --check drift gates + `npm test` ONCE (exit 0, ALL GREEN, record suite count). One suite at a time; RAM-constrained.

## Commit

`fix: apply native-review locale corrections` (blank line, trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`). `package-lock.json` dirt stays out.

## Report

Append `## Step 3 — native-review corrections` to /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-8-report.md: must-fixes landed (per language), nice-to-fixes landed vs skipped with reasons. Reply ONLY (under 10 lines): Status; commit; counts (must-fix landed, nice-to-fix landed/skipped); test one-liner; concerns.

## Constraints

Never translate IDs/paths/branch names/model IDs/commands; preserve protected terms; scratch state only; never print secrets; no push/merge/tag; no subagents ever; findings → ledger append.
