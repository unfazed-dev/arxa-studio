You are reviewing Task 8 as a whole (localization + visual acceptance; base ce5e82e → head 4347f07, commits 5c2f83a + f5e90d4 + d3a7c47 + 4347f07). You are a FRESH independent reviewer; the implementers are different agents you never talk to.

## What Was Requested

Read the task brief: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-8-brief.md

Binding requirements:
- Step 1: failing key-set parity test (en source; pl/fr same keys) for the full Personalisation tab + every surface touched by Tasks 2–14.
- Step 2: translations preserve CONTEXT.md product terms; never translate IDs/paths/branch names/model IDs/commands.
- Step 3: separate native-speaker reviews (PL, FR); implement only corrections preserving source meaning + UI length.
- Step 4: evidence at 390/744/1280 for: Finish, Sweep, Checks red disclosure, project preparation, trash confirmation/recovery, viewer install strip, configured/effective confinement, Workspace backend/sign-in states, Personalisation; light+dark where the component differs; zero console/page errors modulo a named, justified filter list.
- Task 7 review conditions carried in: viewer ladder at 390/744; console-gate driver landed in-repo.
- Commit messages per plan (controller split the single message across the two-part dispatch: `feat: complete studio locale and visual acceptance` + `docs: complete the narrow-width evidence ladder`, plus `fix:` commits for the capture script and locale corrections — a recorded controller ruling).

## Implementation history you should know

Three implementer attempts OOM-died (RAM-constrained machine); the work completed as: Part A (locale parity + translations + in-repo gate driver + 1280 additions), capture-script writer, narrow-lane fixer (settings-prelude scoping + trigger-discovery fix), PL/FR native reviews (controller-dispatched), correction round. A controller-run of the capture script initially hard-failed 26/26 due to a leftover T7 studio holding port 7897 (environmental — killed; diagnosis proved NO product regression; org-registered boot passes at HEAD).

## What the Implementers Claim

Read the report: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-8-report.md (Parts A, B, boot-regression diagnosis, capture script, narrow-ladder results, Step 3 corrections). Also: task-8-pl-review.md and task-8-fr-review.md (native reviews) in the same directory.

Key claims to adjudicate:
1. Narrow ladder result: 390 → 3 ok / 10 limitation rows / 2 hard (trash pair wedged→480s budget kill, claimed non-1280-proven); 744 → 2 ok / 11 limitation / 0 hard. Limitation rows L1–L4 include: LSP chain dead on FRESH boots at ALL widths (probe-claimed identical at 1280); `wp.info()` connection error at all widths (flagged "regression vs T8-era evidence"); conversation pane never mounts at narrow. Judge each: genuine product limitation acceptable as recorded evidence, or a fixable defect this task should have closed, or a real regression needing its own fix?
2. Personalisation captured light+dark at BOTH widths (dialog mounts via real trigger).
3. The ladder surfaces NOT ok at narrow: verify the limitation rows carry reproduced causes, not excuses.
4. Step 3: 5/5 must-fixes landed; 10 nice-to-fix landed / 15 skipped with reasons.

## Diff Under Review

**Base:** ce5e82e **Head:** 4347f07
**Diff file:** /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-8-review-package.txt (code/text hunks only; PNGs excluded — inspect the evidence tree directly for image inventory).

## You Do Not Dispatch Subagents

Do all of this yourself. Never spawn claude/agents/reviewers.

## Do Not Trust the Report

Verify claims. Rationales never downgrade severity.

## Independent Verification (plan overrides do-not-rerun; RAM discipline — one suite at a time, NO browsers)

1. `node plugins/locale/selftest.parity.mjs` — green; then BREAK-CHECK it: scratch-copy one dictionary, delete a key, confirm the test FAILS (proves non-vacuity), discard the scratch.
2. Touched-plugin selftests: personalisation, theme-accent, arxa-sidebar, arxa-git-card, artifact-viewer, locale; gen --check drift gates for regenerated clients.
3. Protected-terms audit: grep the pl/fr hunks in the package for translated IDs/paths/model IDs (spot-check the reviewers' must-fix keys are actually fixed: av install strip keyed en/pl/fr; pl wakeStarted; fr parked "Gate rouge" + wakeStarted).
4. Evidence tree inventory: `find designs/evidence/studio-closeout -name '*.png'` — verify claimed widths/surfaces exist; read `narrow-capture-log.json` — verify the ok/limitation/hard counts match the report and each limitation row names a cause; spot-open 2–3 PNGs (390 + 744) to confirm they are real renders at plausible widths, not blank/error pages.
5. `npm test` ONCE — exit 0, ALL GREEN, record suite count (130 expected).
6. The L1/L2/L3 findings: judge from the ledger + report evidence whether they need to block T8 or ride as New findings to the whole-branch review / Task 16. You may NOT boot browsers; reasoning + the recorded probe evidence only.

## Output Format

### Spec Compliance
- ✅ / ❌ / ⚠️ items (per brief step + the two T7 conditions)
### Ladder + Findings Adjudication
[L1–L4 + wp.info: limitation / fixable / regression-to-escalate, each with a ruling]
### Independent Verification Results
[commands, exits, key lines; PNG inventory summary]
### Strengths
### Issues
#### Critical (Must Fix)
#### Important (Should Fix)
#### Minor (Nice to Have)
### Assessment
**Task quality:** Approved | Needs fixes
**Reasoning:** [1-2 sentences]

Final message IS the report — begin with the spec verdict, no preamble.
