You are reviewing one task's implementation: first whether it matches its requirements, then whether it is well-built. This is a task-scoped gate, not a merge review — a broad whole-branch review happens separately after all tasks are complete. You are a FRESH independent reviewer; the implementer is a different agent you never talk to.

## What Was Requested

Read the task brief: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-3-brief.md

Global constraints from the plan that bind this task (verbatim):
- Produces: `prepareProjectRepo(projectSlug) -> { ok: true, repoPath, head, frame }` on the open lifecycle.
- Produces action: `project.repair-repo { orgId, projectSlug }`.
- Consumes: `initProjectRepo`, `writeFrameFiles`, `hasHead`, `runGit`, the project manifest, and existing project path confinement.
- Program ruling 2: hand-created project repair is explicit — offer `Initialize Git repository`; never silently attach Git while opening an org or starting a session.
- Modify `scripts/gen-workspace.mjs` only if a new transform anchor is required; regenerate `plugins/arxa-sidebar/lib/client.js`; generated clients are never edited directly and a byte-drift check enforces it.
- Every behavior change follows RED -> verify the expected failure -> minimal GREEN -> focused tests -> full `npm test` -> commit.
- Preserve root confinement and path identity: resolve and realpath before mutation; reject symlink escape and reserved .git/.arxa paths; a missing/escaped/symlinked project REFUSES.
- Commit message fixed: `feat: prepare imported projects for sessions`.

## What the Implementer Claims They Built

Read the implementer's report: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-3-report.md

The implementer flagged one concern for your judgment: via one entry path (shell-CTA refusal) an unborn project repo (interrupted init) shows a text notice but no clickable `Initialize Git repository` offer, because the offer arm is proactive (`hasRepo`); fixing it needs a `gen-sidebar.mjs` splice outside the brief's file list. They recorded it as a New finding. Rule whether the brief's Step 4 ("When session creation returns `initial-snapshot-pending` or the routed project has no repo, show an `Initialize Git repository` action") is satisfied.

## Diff Under Review

**Base:** 8f10a08
**Head:** db6de5f
**Diff file:** /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-3-review-package.txt

Read the diff file once — commit list, stat, full diff with context, `git diff --check` result. Do not re-derive with git commands; do not crawl the codebase. Inspect code outside the diff only for a concrete named risk (e.g., call sites of changed signatures, the `initProjectRepo`/`writeFrameFiles` contracts the new method consumes) — one focused check per named risk, named in your report. No git-state mutation; verification runs may create build/test artifacts.

## You Do Not Dispatch Subagents

Do all of this review yourself. Never spawn claude, agents, helpers, or other reviewers.

## Do Not Trust the Report

Treat the implementer's report as unverified claims; verify against the diff. Rationales never downgrade severity.

## Independent Verification (this plan OVERRIDES the usual do-not-rerun rule)

Independently run, in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout:
1. `node plugins/file-org-shell/selftest.mjs` — must pass (lifecycle suite incl. the new repair checks).
2. `node plugins/arxa-sidebar/selftest.mjs` — must pass, including the generated-client drift check.
3. `node plugins/arxa-sidebar/selftest.actions.mjs` — must pass (the new `project.repair-repo` action).
4. `node plugins/arxa-sidebar/smoke.mjs` — must pass (Step 6 user-flow smoke; scratch paths, self-cleaned).
5. `npm test` — exit 0, `arxa-studio CI: ALL GREEN`.

Record commands, exit codes, key lines. If a hook refuses a compound command, split into simple single commands.

## Part 1: Spec Compliance

Compare diff vs brief — Missing / Extra / Misunderstood with file:line. Check: does the lifecycle test cover the brief's cases (repo-less project becomes repo with branch `main`, exactly ONE initial commit, inherited `localOnly`, frame files; existing repo idempotent no-op; missing/escaped/symlinked refuses; user files AND customized frame files byte-identical after repair)? Does `prepareProjectRepo` resolve only a scanned project of the open org? Is repair offered (not silent)? Success retries the original new-session action exactly once? `gen-workspace.mjs` only touched if a new anchor was required? client.js regenerated not hand-edited? Brief-listed files all present in the diff? Requirements outside the diff → ⚠️ items.

## Part 2: Code Quality

Path confinement correctness (realpath before mutation; refusal paths actually refuse), single-commit guarantee (contents + frame in one initial commit, not two), no history deletion, DRY vs existing lifecycle helpers, test quality (behavior not mock-asserting-mock; byte-identity actually compared), pristine test output.

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
