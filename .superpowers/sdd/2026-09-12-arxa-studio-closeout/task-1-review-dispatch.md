You are reviewing one task's implementation: first whether it matches its requirements, then whether it is well-built. This is a task-scoped gate, not a merge review — a broad whole-branch review happens separately after all tasks are complete. You are a FRESH independent reviewer; the implementer is a different agent you never talk to.

## What Was Requested

Read the task brief: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-1-brief.md

Global constraints from the plan that bind this task (verbatim):
- A task may be marked `CLOSED BY EVIDENCE` without code only when the controller records exact source locations, fresh verification output, and reviewer approval in the SDD ledger.
- Produces: one inventory with IDs `AXS-001` onward and states `OPEN`, `DEFERRED`, `EXTERNAL`, or `CLOSED`; every open row maps to exactly one Task 2–16 work package in the SDD ledger.
- Each inventory row must contain ID, owner repo, source plan, current evidence, remaining deliverable, dependency, closure command, and owning Task 2–16 number.
- Historical plans get a dated banner pointing to this inventory; do not rewrite their narrative history.
- Do not carry newly found unrelated work into this program. Record it under `New finding:` in the ledger with severity and a concrete follow-up path.
- Never mutate the operator's real organisations, credentials, registries, sessions, Docker state, or GitHub repositories. Use scratch paths for anything stateful.
- Never print tokens, API keys, OAuth codes, signing material, .env values, or credential-store contents.
- Commit only documentation, message `docs: reconcile the arxa studio closeout inventory`.

## What the Implementer Claims They Built

Read the implementer's report: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-1-report.md

The implementer flagged for your judgment: rows marked EXTERNAL for upstream-dsh/sibling-backlog work carry no Task 2–16 mapping "by design" — verify that against the brief's interface requirement and say whether it complies.

## Diff Under Review

**Base:** 4d1b924
**Head:** 7334ddb
**Diff file:** /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-1-review-package.txt

Read the diff file once — it contains the commit list, a stat summary, the full diff with context, and the `git diff --check` result. It is your view of the change; do not re-derive it with git commands and do not crawl the broader codebase. Inspect code outside the diff only to evaluate a concrete risk you can name — one focused check per named risk, named in your report. Your review does not mutate git state: no commits, no staging, no branch changes. (Running the verification commands below may create build/test artifacts; that is expected.)

## You Do Not Dispatch Subagents

Do all of this review yourself. Never spawn claude, agents, helpers, or other reviewers. If the diff feels too large for one pass, review it in passes yourself and say so in your report.

## Do Not Trust the Report

Treat the implementer's report as unverified claims. Verify against the diff and the repository. Design rationales in the report are claims too; a stated rationale never downgrades a finding's severity.

## Independent Verification (this plan OVERRIDES the usual do-not-rerun rule)

The plan's lead-controller contract requires you to independently run every focused test and gate this task names, and to cross-check every inventory row against source:
1. `npm test` in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout — require exit 0 and the final `arxa-studio CI: ALL GREEN` line (110 suites). (If your environment's Bash guard blocks long compound commands, run it plainly; it is a single command.)
2. In the sibling worktree /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-closeout under `mobile_flutter`: `flutter analyze` and `flutter test` (Flutter comes via fvm — `command -v flutter` first, else `fvm flutter`). NOTE implementer's logged New finding 1: fresh worktrees may need `mkdir -p build/ios/SourcePackages` before the SPM plugin-copy step succeeds, and flutter may auto-edit `analysis_options.yaml` and re-pin lock entries — do not commit or revert anything; leave the checkout as-is after your run.
3. Cross-check the new inventory `docs/plans/open-work-inventory-2026-09-12.md` row by row against actual source: spot-verify at minimum every CLOSED row's cited evidence (file/test/commit exists and says what the row claims) and every OPEN row's task mapping (bijective to Tasks 2–16, no orphan, no double-mapping). Sampling is acceptable for repetitive rows; say what you sampled.
4. Verify the six governing source plans carry dated banners, not rewritten history (`git diff` shows what changed in them).

Record the commands you ran and their key output lines in your report.

## Part 1: Spec Compliance

Compare the diff against What Was Requested — Missing / Extra / Misunderstood, with file:line references. A brief-listed file the diff never touches is a Missing finding. Requirements that live outside the diff are ⚠️ items.

## Part 2: Code Quality

For this documentation task: row field completeness, evidence precision (does "current evidence" cite real files/tests/commands), state-classification honesty (is anything OPEN masquerading as CLOSED, or vice versa), banner non-destructiveness, zero bare TBD/TODO/maybe.

## Calibration

Important = this task cannot be trusted until fixed. Polish suggestions are Minor. Acknowledge genuine strengths first. Every finding carries file:line.

## Output Format

### Spec Compliance
- ✅ Spec compliant | ❌ Issues found | ⚠️ Cannot verify from diff: [items + what the controller should check]

### Independent Verification Results
[commands run, exit codes, key output lines, row cross-check result]

### Strengths
### Issues
#### Critical (Must Fix)
#### Important (Should Fix)
#### Minor (Nice to Have)

### Assessment
**Task quality:** Approved | Needs fixes
**Reasoning:** [1-2 sentences]

Your final message is the report itself — begin directly with the spec-compliance verdict, no preamble.
