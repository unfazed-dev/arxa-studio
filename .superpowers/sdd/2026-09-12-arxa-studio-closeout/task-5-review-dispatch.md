You are reviewing one task's implementation: first whether it matches its requirements, then whether it is well-built. This is a task-scoped gate, not a merge review — a broad whole-branch review happens separately after all tasks are complete. You are a FRESH independent reviewer; the implementer is a different agent you never talk to.

## What Was Requested

Read the task brief: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-5-brief.md

Global constraints from the plan that bind this task (verbatim):
- S4: two sessions integrate against moving `main`; exactly one lands first and the second must integrate or conflict loudly WITHOUT LOSING ITS COMMIT. Real child processes, parent-controlled barrier — never simulated concurrency in one process.
- S5: rapid viewer saves across at least three files while WIP auto-commit and decoration refresh run; final files, WIP history, and decoration map converge. Drive the ACTUAL Monaco save/debounce coordinator (or extract that production coordinator); count coalesced saves and WIP boundaries; assert no dropped final write, no dirty tree after quiet, no duplicate WIP boundary, every concurrent read sees a parseable complete Git index and decoration map.
- Step 2 mutation rule: if current behavior passes immediately, mutation-test only an injected temporary fixture with the guard disabled; never alter the implementation worktree for the negative control.
- Step 4: fix ONLY demonstrated product defects, each fix with its own NEW failing focused test first. If defects surface, only `plugins/git-workspace/lib/*.js` or viewer/watcher modules change.
- Program ruling 4: the viewer's tested 1.5-second save debounce REMAINS the autosave owner.
- Step 5: `node scripts/cicd-stress.mjs` five consecutive times, then `npm test` once.
- Commit message fixed: `test: cover main races and auto-commit storms`.

## What the Implementer Claims They Built

Read the implementer's report: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-5-report.md

Claims needing your judgment: (1) S4 surfaced a real defect — raced `--no-ff` left its result staged in main's index so every later land refused, mislabeled "merge conflict" — fixed in `sessions.js` via retry + index-heal, with focused regression `selftest.land-race.mjs` RED on BASE; (2) S5 found no product defect (negative control via dropped-rename mutation went red); (3) tradeoffs: `reset -q` retry unstages user-staged files in the org root (byte-intact), raced-out park carries generic `parkedReason: 'merge-conflict'`; (4) two low-severity New findings ledgered.

## Diff Under Review

**Base:** bd14065
**Head:** 82296f8
**Diff file:** /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-5-review-package.txt

Read the diff file once — commit list, stat, full diff with context, `git diff --check`. Do not re-derive with git commands; do not crawl the codebase. Inspect code outside the diff only for a concrete named risk (e.g., the `sessions.js` land path the fix touches, the save coordinator the S5 harness slices) — one focused check per named risk, named in your report. No git-state mutation; verification runs may create build/test artifacts.

## You Do Not Dispatch Subagents

Do all of this review yourself. Never spawn claude, agents, helpers, or other reviewers.

## Do Not Trust the Report

Treat the report as unverified claims; verify against the diff. Rationales never downgrade severity.

## Independent Verification (this plan OVERRIDES the usual do-not-rerun rule)

Independently run, in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout:
1. `node scripts/cicd-stress.mjs` — FIVE consecutive times (repeatability is the brief's requirement); each must exit 0 with all scenarios PASS. Report per-run PASS counts.
2. The new focused regression for the sessions.js fix (the report names it; `plugins/git-workspace/selftest.land-race.mjs` or equivalent) — must pass.
3. `npm test` — exit 0, `arxa-studio CI: ALL GREEN`.

Everything stays LOCAL (scratch repos/remotes only; no GitHub, no network). Record commands, exit codes, key lines. If a hook refuses a compound command, split into simple single commands. These scenarios spawn child processes and watchers — that is expected; native environment permits it.

## Part 1: Spec Compliance

Compare diff vs brief — Missing / Extra / Misunderstood with file:line. Check: S4 really uses two child processes + barrier (not simulated); clean AND conflict rounds; commit-loss assertion present; S5 uses the real coordinator (verbatim slice or extraction — not a sleep fake), ≥3 files, coalesce/boundary counting, the four S5 assertions (no dropped final write; clean tree after quiet; no duplicate WIP boundary; concurrent reads parse complete index + decoration map); negative controls implemented as scratch fixtures WITHOUT altering the implementation worktree; the sessions.js fix has its own failing-first regression; only permitted files changed. Requirements outside the diff → ⚠️ items.

## Part 2: Code Quality

The sessions.js fix: is retry + index-heal bounded (no infinite retry), does it distinguish genuine conflicts from healed races, does `reset -q` scoped narrowly (org root claim — is that actually narrow?), can the fix mask a real conflict as success? Scenario code: deterministic barriers (no sleep races), clear failure output, no leaked child processes/filesystem after runs. Test output pristine.

## Calibration

Important = task cannot be trusted until fixed (includes: scenarios that can silently pass, or a fix that can lose work). Polish = Minor. Acknowledge genuine strengths first. Every finding carries file:line.

## Output Format

### Spec Compliance
- ✅ Spec compliant | ❌ Issues found | ⚠️ Cannot verify from diff: [items]

### Independent Verification Results
[commands, exit codes, key lines — including all five stress runs]

### Strengths
### Issues
#### Critical (Must Fix)
#### Important (Should Fix)
#### Minor (Nice to Have)

### Assessment
**Task quality:** Approved | Needs fixes
**Reasoning:** [1-2 sentences]

Your final message is the report itself — begin directly with the spec-compliance verdict, no preamble.
