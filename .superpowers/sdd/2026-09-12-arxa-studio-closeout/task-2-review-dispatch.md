You are reviewing one task's implementation: first whether it matches its requirements, then whether it is well-built. This is a task-scoped gate, not a merge review — a broad whole-branch review happens separately after all tasks are complete. You are a FRESH independent reviewer; the implementer is a different agent you never talk to.

## What Was Requested

Read the task brief: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-2-brief.md

Global constraints from the plan that bind this task (verbatim):
- Produces: a retained handle/controller map beside `ctx.agents.create` in `arxa-sidebar/lib/index.js`; `makeDshFaces` exposes only `stopAgentIds(ids, { timeoutMs })` through `dsh-bridge.js`.
- Produces: `quiesceSessionsUnder({ sessions, sessionPersistence, agentControl }, orgPath, { timeoutMs }) -> Promise<{ stopped: string[], alreadyStopped: string[] }>` in `session-sweep.js`.
- Changes: `trashOrg(orgPath, { displayName? } = {})`; its trash index stores manifest display name and retains the original folder slug separately for restore.
- Program ruling 1: organisation trash fails closed — stop/quiesce every live session whose canonical cwd is inside the organisation before moving it; if any session cannot be stopped within the bounded close operation, leave the organisation in place and return a loud error naming only session IDs, never paths outside the org.
- Every behavior change follows RED -> verify the expected failure -> minimal GREEN -> focused tests -> full `npm test` -> commit.
- Preserve root confinement and path identity: resolve and realpath paths before mutation; reject symlink escape and reserved `.git`/`.arxa` paths.
- Use scratch ARXA_HOME directories for smoke tests; never mutate the operator's real state.
- Never edit installed @deepseek-ai/dsh package bytes; extend through Cordis rows, generated snippets, or existing public service seams.
- Commit message fixed: `fix: stop organisation sessions before trash`.

Implementation history you should know (does not soften any finding): a first implementer was OOM-killed mid-run leaving uncommitted WIP; the current diff was finished by a second implementer that verified the WIP seam-by-seam and reconstructed RED evidence via a tagged stash. Judge only the diff.

## What the Implementer Claims They Built

Read the implementer's report: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-2-report.md

## Diff Under Review

**Base:** 7334ddb
**Head:** 8f10a08
**Diff file:** /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-2-review-package.txt

Read the diff file once — commit list, stat, full diff with context, `git diff --check` result. Do not re-derive with git commands; do not crawl the codebase. Inspect code outside the diff only for a concrete named risk (e.g., call sites of a changed signature like `trashOrg` or the narrowed `makeDshFaces` face) — one focused check per named risk, named in your report. Your review does not mutate git state: no commits, no staging, no branch changes. Running the verification commands below may create build/test artifacts; expected.

## You Do Not Dispatch Subagents

Do all of this review yourself. Never spawn claude, agents, helpers, or other reviewers.

## Do Not Trust the Report

Treat the implementer's report as unverified claims; verify against the diff. Rationales are claims; they never downgrade severity.

## Independent Verification (this plan OVERRIDES the usual do-not-rerun rule)

Independently run, in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout:
1. The four focused suites named by the brief: `node plugins/file-org-shell/selftest.mjs`, `node plugins/arxa-sidebar/selftest.actions.mjs`, `node plugins/arxa-sidebar/selftest.session-sweep.mjs`, `node plugins/arxa-sidebar/selftest.trash-live-sessions.mjs` — all must pass.
2. The smoke: `node scripts/org-purge-smoke.mjs` (must use scratch paths, self-clean).
3. The full gate: `npm test` — require exit 0 and `arxa-studio CI: ALL GREEN`.

Record commands, exit codes, key lines in your report. If a hook refuses a compound command, split into simple single commands.

## Part 1: Spec Compliance

Compare diff vs brief — Missing / Extra / Misunderstood with file:line. Brief-listed files with no corresponding hunk = Missing. Step-by-step: do the tests cover the brief's named cases (two inside, one outside, already-stopped, stop timeout, textual-prefix cwd; husk regression; timeout prevents softDelete; restore-to-original-slug; displayName preservation)? Does the stop path honor the 5-second total bound and never delete session history? Is the narrow face really narrow (`stopAgentIds` only, nothing else leaked through dsh-bridge)? Requirements outside the diff → ⚠️ items.

## Part 2: Code Quality

Error handling on the fail-closed path (org untouched on failure; stopped-session IDs reported, no fake live-state rollback claims), canonical-path semantics (realpath before comparison; prefix attack covered), DRY vs the existing sweep code, test quality (real behavior not mocks asserting mocks), no stray debug output, test output pristine.

## Calibration

Important = task cannot be trusted until fixed. Polish = Minor. Acknowledge genuine strengths first. Every finding carries file:line.

## Output Format

### Spec Compliance
- ✅ Spec compliant | ❌ Issues found | ⚠️ Cannot verify from diff: [items]

### Independent Verification Results
[commands, exit codes, key lines]

### Strengths
### Issues
#### Critical (Must Fix)
#### Important (Should Fix)
#### Minor (Nice to Have)

### Assessment
**Task quality:** Approved | Needs fixes
**Reasoning:** [1-2 sentences]

Your final message is the report itself — begin directly with the spec-compliance verdict, no preamble.
