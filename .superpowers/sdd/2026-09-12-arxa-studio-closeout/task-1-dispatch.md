You are implementing Task 1: Establish the truthful baseline and retire stale work (arxa-studio closeout program, wave 1 — truth).

## Task Description

Read your task brief FIRST — it is your requirements, with the exact values to use verbatim:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-1-brief.md

## Context

- This is the first task of a 17-task closeout program. Your inventory (AXS-* rows) becomes the map every later task is verified against; every genuinely open row must map to exactly one Task 2–16.
- Your working directory (already installed — do NOT re-run npm install): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout — a git worktree on branch closeout-2026-09-12, BASE 4d1b924. All studio commits land here.
- Sibling arxa repo: canonical /Volumes/business_ssd/arxa_digital_solutions/arxa (HEAD 5749402b, branch main, ahead 2 of origin — READ ONLY, do not modify). For Step 4 use the isolated worktree /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-closeout (fresh checkout of 5749402b, branch closeout-2026-09-12). If a hook refuses a `git -C <sibling>` command, read the sibling's `.git/HEAD` + refs files directly instead of retrying.
- Sibling repo law (arxa/AGENTS.md, binding for any work there): behavior-TDD mandated; never hand-edit generated outputs; user projects live in ~/.arxa — never mutate the operator's real ~/.arxa, organisations, credentials, or sessions.
- Machine: Node via nvm, Flutter via fvm. Run `command -v flutter` first; if absent use `fvm flutter`. `flutter pub get` in mobile_flutter is allowed if needed.
- Facts you may cite as controller-recorded (still re-verify what your steps demand): studio worktree HEAD 4d1b924 contains the plan (commit 1781083); plan-creation baseline was arxa-studio 967b2cc with main == origin/main and npm test "arxa-studio CI: ALL GREEN" over 110 suites — Step 2 requires you to re-run and show it, not trust it.
- The SDD ledger you append Step-1 facts to: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/progress.md (append only; do not rewrite existing content).

## Global Constraints (binding, verbatim from the plan)

- Never push, merge, tag, publish a release, delete a remote, or run paid/authenticated smokes. Commit only inside your worktree(s).
- Never mutate the operator's real organisations, credentials, registries, sessions, Docker state, or GitHub repositories. Use scratch ARXA_HOME directories for anything stateful.
- Never print tokens, API keys, OAuth codes, signing material, .env values, or credential-store contents.
- Never edit installed @deepseek-ai/dsh package bytes; generated clients are never edited directly.
- Do not carry newly found unrelated work into this program — record it under "New finding:" with severity and a follow-up path.
- Commit message is fixed by the plan: `docs: reconcile the arxa studio closeout inventory`, followed by a blank line and the trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## You Do Not Dispatch Subagents

Do all of this task's work yourself. Never spawn claude, agents, helpers, or reviewers — the controller dispatches review after you report. If you think an independent review would help, it is already scheduled: report instead.

## Before You Begin

If anything in the brief is unclear or contradictory, STOP now and return status NEEDS_CONTEXT with your questions — do not guess.

## Your Job

1. Execute the brief's Steps 1–7 in order, checking off each requirement.
2. Step 5's orphan-row rule is real: if a genuine open row maps to no Task 2–16, report it (BLOCKED with specifics) rather than inventing a mapping.
3. Before committing: self-review (completeness, quality, discipline — did I write only what the plan specifies?).
4. Commit, then write your full report.

## Report Format

Write your full report to:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-1-report.md
covering: what you implemented, evidence per step (commands + key output lines), files changed, the inventory row count by state, self-review findings, concerns.

Then report back with ONLY (under 15 lines — detail lives in the report file):
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Commits created (short SHA + subject)
- One-line test summary (npm test result line + flutter analyze/test results)
- Your concerns, if any
- The report file path

Use DONE_WITH_CONCERNS if completed but doubtful; BLOCKED if you cannot complete; NEEDS_CONTEXT if information is missing. Never silently produce work you are unsure about.
