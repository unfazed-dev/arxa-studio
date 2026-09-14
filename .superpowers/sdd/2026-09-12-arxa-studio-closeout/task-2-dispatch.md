You are implementing Task 2: Stop live sessions before organisation trash and preserve display names (arxa-studio closeout program, wave 2 — core correctness; this is the first code task, TDD mandated).

## Predecessor WIP (important)

A prior implementer was killed mid-run by a system OOM after writing but NOT committing its work. Uncommitted WIP is in the tree right now: 10 modified files under plugins/arxa-sidebar and plugins/file-org-shell, plus untracked plugins/arxa-sidebar/selftest.trash-live-sessions.mjs, and pre-existing package-lock.json dirt (not yours, leave it). There is no report and no RED evidence.
1. Inspect the WIP first (git diff). Keep what is correct, fix what is not — you own the final diff.
2. Reconstruct RED evidence for your report: set the WIP aside safely, prove the focused selftests fail on clean BASE, then restore. Safe pattern (never bare `git stash pop` — shared stash): `cp` the untracked file aside, `git stash push -u -m task2-red-verify`, run the new focused selftest and capture the failure, then `git stash list --format='%H %gs'` to find your entry's SHA, `git stash apply <sha>`, restore the copied file, and later `git stash drop <sha>`.
3. Then finish any missing steps of the brief and proceed normally.

## Task Description

Read your task brief FIRST — it is your requirements, with the exact values to use verbatim:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-2-brief.md

## Context

- Working directory (deps installed; do NOT re-run npm install): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout — git worktree, branch closeout-2026-09-12, BASE 7334ddb. All commits land here.
- Interfaces and evidence from Task 1's fresh source audit (2026-09-12), so you don't re-derive them:
  - `lifecycle.trashOrg` lives at `plugins/file-org-shell/lib/lifecycle.js:2100`; it currently stores no `displayName` (13 other displayName refs exist elsewhere in the file — do not conflate).
  - The discarded `AgentHandle` is created beside `ctx.agents.create` around `plugins/arxa-sidebar/lib/index.js:386-429`.
  - `session-sweep.js` already has `sweepSessionsUnder`/`sweepDeadTmpSessions` — extend, don't duplicate.
  - This task closes inventory row AXS-002 (`docs/plans/open-work-inventory-2026-09-12.md`); governing narrative in `docs/plans/org-trash-unreachable.md` Bug B.
- Program ruling 1 (binding): trash fails closed — if any session cannot be stopped within the bounded close operation, leave the org in place and return a loud error naming only session IDs, never paths outside the org.
- Pre-existing uncommitted dirt: `package-lock.json` (two root pin entries). Leave it untouched and out of your commits.
- If a hook refuses a compound shell command, split it into simple single commands.
- Machine: Node v24.19.0 via nvm.

## Global Constraints (binding, verbatim from the plan)

- Every behavior change follows RED -> verify the expected failure -> minimal GREEN -> focused tests -> full `npm test` -> commit.
- Run socket/watcher tests in an environment that permits localhost binds and native filesystem watchers; a sandbox EPERM is an environment failure, not a product failure.
- Use scratch ARXA_HOME directories for smoke tests. Never mutate the operator's real organisations, credentials, registries, sessions, Docker state, or GitHub repositories.
- Never print tokens, API keys, OAuth codes, signing material, .env values, or credential-store contents.
- Preserve root confinement and path identity: resolve and realpath paths before mutation; reject symlink escape and reserved .git/.arxa paths.
- Never edit installed @deepseek-ai/dsh package bytes; extend through Cordis rows, generated snippets, or existing public service seams. Generated clients are never edited directly — change the generator/snippet and regenerate.
- Never push, merge, tag, or publish. Commit only inside your worktree.
- Do not carry newly found unrelated work into this program — record it under "New finding:" in the ledger with severity and a follow-up path.
- Commit message is fixed by the plan: `fix: stop organisation sessions before trash`, then a blank line and the trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## You Do Not Dispatch Subagents

Do all of this task's work yourself. Never spawn claude, agents, helpers, or reviewers — the controller dispatches review after you report. Report instead.

## Before You Begin

If anything in the brief is unclear or contradictory, STOP and return status NEEDS_CONTEXT with your questions — do not guess.

## Your Job

1. Execute the brief's Steps 1–8 in order (TDD: the brief names its RED checkpoints).
2. While iterating, run the focused suite for what you change; run full `npm test` once before committing.
3. Self-review before committing (completeness vs the brief, quality, YAGNI, test output pristine).
4. Commit, then write your full report.

## Report Format

Write your full report to:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-2-report.md
covering: what you implemented, TDD evidence (RED command + failing output excerpt, GREEN command + passing output), files changed, self-review findings, concerns. Append any "New finding:" entries you discovered to the ledger file .superpowers/sdd/2026-09-12-arxa-studio-closeout/progress.md (append only).

Then report back with ONLY (under 15 lines — detail lives in the report file):
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Commits created (short SHA + subject)
- One-line test summary (focused suites + smoke + npm test)
- Your concerns, if any
- The report file path

Use DONE_WITH_CONCERNS if completed but doubtful; BLOCKED if you cannot complete; NEEDS_CONTEXT if information is missing. Never silently produce work you are unsure about.
