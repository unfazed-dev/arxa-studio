You are implementing Task 5: Add the two missing CI/CD stress scenarios (arxa-studio closeout program, wave 2; the brief IS the TDD plan — these scenarios are written to fail/pass against real product behavior).

## Task Description

Read your task brief FIRST — it is your requirements, with the exact values to use verbatim:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-5-brief.md

## Context

- Working directory (deps installed; do NOT re-run npm install): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout — git worktree, branch closeout-2026-09-12, BASE bd14065. All commits land here.
- You extend `scripts/cicd-stress.mjs` with scenarios S4 (two sessions integrating against moving `main` from real child processes released by a parent-controlled barrier) and S5 (rapid viewer saves vs WIP auto-commit + decoration refresh). Task 1's audit noted the existing "race" text in cicd-stress.mjs is a version-mint race — your S4/S5 are genuinely new.
- If product defects surface, fix ONLY the owning `plugins/git-workspace/lib/*.js` or viewer/watcher module, each fix with its own NEW failing focused test first (Step 4).
- S5's save coordinator: drive the actual Monaco save/debounce coordinator, or extract that production coordinator for direct use — do not fake it with a sleep.
- Program ruling 4 (binding): the viewer's tested 1.5-second save debounce REMAINS the autosave owner — do not remove or disable it.
- Pre-existing uncommitted dirt: `package-lock.json`. Leave it untouched and out of your commits.
- If a hook refuses a compound shell command, split it into simple single commands.
- Machine: Node v24.19.0 via nvm. Run socket/watcher tests natively (localhost binds + native watchers permitted here).

## Global Constraints (binding, verbatim from the plan)

- Every behavior change follows RED -> verify the expected failure -> minimal GREEN -> focused tests -> full `npm test` -> commit.
- Run socket/watcher tests in an environment that permits localhost binds and native filesystem watchers; a sandbox EPERM is an environment failure, not a product failure.
- Use scratch repositories/ARXA_HOME dirs for everything stateful. Never mutate the operator's real organisations, credentials, registries, sessions, Docker state, or GitHub repositories. These scenarios are LOCAL — no GitHub traffic, no network remotes beyond the scratch bare remote.
- Never print tokens, API keys, OAuth codes, signing material, .env values, or credential-store contents.
- Never edit installed @deepseek-ai/dsh package bytes; extend through Cordis rows, generated snippets, or existing public service seams.
- Never push, merge, tag, or publish. Commit only inside your worktree.
- Do not carry newly found unrelated work into this program — record it under "New finding:" in the ledger with severity and a follow-up path.
- Commit message is fixed by the plan: `test: cover main races and auto-commit storms`, then a blank line and the trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## You Do Not Dispatch Subagents

Do all of this task's work yourself. Never spawn claude, agents, helpers, or reviewers — the controller dispatches review after you report. Report instead.

## Before You Begin

If anything in the brief is unclear or contradictory, STOP and return status NEEDS_CONTEXT with your questions — do not guess.

## Your Job

1. Execute the brief's Steps 1–6 in order.
2. While iterating, run the focused scenario you are changing; run the five consecutive cicd-stress passes then `npm test` once before committing (Step 5).
3. Self-review before committing (completeness vs the brief, quality, YAGNI, test output pristine).
4. Commit, then write your full report.

## Report Format

Write your full report to:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-5-report.md
covering: what you implemented, RED evidence per scenario (command + failing output excerpt; mutation-test negative control if a scenario passed immediately), any product fixes with their focused regressions, files changed, self-review findings, concerns. Append any "New finding:" entries to the ledger file .superpowers/sdd/2026-09-12-arxa-studio-closeout/progress.md (append only).

Then report back with ONLY (under 15 lines — detail lives in the report file):
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Commits created (short SHA + subject)
- One-line test summary (5× cicd-stress + npm test)
- Your concerns, if any
- The report file path

Use DONE_WITH_CONCERNS if completed but doubtful; BLOCKED if you cannot complete; NEEDS_CONTEXT if information is missing. Never silently produce work you are unsure about.
