You are implementing Task 4: Add the local Checks row and complete tree-level decorations (arxa-studio closeout program, wave 2; TDD mandated).

## Task Description

Read your task brief FIRST — it is your requirements, with the exact values to use verbatim:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-4-brief.md

## Context

- Working directory (deps installed; do NOT re-run npm install): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout — git worktree, branch closeout-2026-09-12, BASE db6de5f. All commits land here.
- Interfaces landed by Tasks 2–3 in files you touch (don't disturb): sidebar `index.js` agent-handle map/`stopAgentIds` + `project.repair-repo` action (reactive/proactive arms); `lifecycle.js` `prepareProjectRepo`/`trashOrg(displayName)`.
- Task 1's audit: the top-level Projects/project/stage decoration rollups are the OPEN row AXS-003 you partially close (Step 5); leaf/session/lister decorations already shipped. Governing narrative: `docs/plans/local-only-git-parity-and-sidebar-decorations.md` Decisions 3, 6, 7.
- `git-workspace.runGate(session.worktree)` exists and is the gate runner Commit already uses — consume, don't duplicate.
- Generated clients regenerate via `node scripts/gen-git-card.mjs --write/--check` and `node scripts/gen-workspace.mjs --write/--check` (Step 7); byte-drift gates enforce. Generated clients are never hand-edited.
- UI keys: add every user-facing key in English, Polish, and French (this surface is not deferred to the localization task — Step 6 pins all three locales).
- Pre-existing uncommitted dirt: `package-lock.json`. Leave it untouched and out of your commits.
- If a hook refuses a compound shell command, split it into simple single commands.
- Machine: Node v24.19.0 via nvm.

## Global Constraints (binding, verbatim from the plan)

- Every behavior change follows RED -> verify the expected failure -> minimal GREEN -> focused tests -> full `npm test` -> commit.
- UI uses shipped dsh primitives and real `--dsw-*` tokens. Add every user-facing key in English, Polish, and French unless the whole owning surface is explicitly queued for the localization task (this one is pinned to all three locales by Step 6).
- Use scratch ARXA_HOME directories for smoke tests. Never mutate the operator's real organisations, credentials, registries, sessions, Docker state, or GitHub repositories. The smoke's red `check.sh` leg must leave the worktree unchanged.
- Never print tokens, API keys, OAuth codes, signing material, .env values, or credential-store contents.
- Never edit installed @deepseek-ai/dsh package bytes; extend through Cordis rows, generated snippets, or existing public service seams.
- Never push, merge, tag, or publish. Commit only inside your worktree.
- Do not carry newly found unrelated work into this program — record it under "New finding:" in the ledger with severity and a follow-up path.
- Commit message is fixed by the plan: `feat: surface local checks and complete tree decorations`, then a blank line and the trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

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
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-4-report.md
covering: what you implemented, TDD evidence (RED command + failing output excerpt, GREEN command + passing output), files changed, self-review findings, concerns. Append any "New finding:" entries to the ledger file .superpowers/sdd/2026-09-12-arxa-studio-closeout/progress.md (append only).

Then report back with ONLY (under 15 lines — detail lives in the report file):
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Commits created (short SHA + subject)
- One-line test summary (focused suites + smoke + npm test)
- Your concerns, if any
- The report file path

Use DONE_WITH_CONCERNS if completed but doubtful; BLOCKED if you cannot complete; NEEDS_CONTEXT if information is missing. Never silently produce work you are unsure about.
