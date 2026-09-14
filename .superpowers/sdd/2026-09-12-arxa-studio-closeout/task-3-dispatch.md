You are implementing Task 3: Add an explicit repair path for repo-less projects (arxa-studio closeout program, wave 2 — core correctness and Git flow; TDD mandated).

## Task Description

Read your task brief FIRST — it is your requirements, with the exact values to use verbatim:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-3-brief.md

## Context

- Working directory (deps installed; do NOT re-run npm install): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout — git worktree, branch closeout-2026-09-12, BASE 8f10a08. All commits land here.
- Interfaces landed by Task 2 (same files you touch — non-overlapping seams, don't disturb them): a retained agent-handle map beside `ctx.agents.create` and `stopAgentIds(ids, { timeoutMs })` in `plugins/arxa-sidebar/lib/index.js` + `plugins/file-org-shell/lib/dsh-bridge.js`; `trashOrg(orgPath, { displayName? })` and `quiesceSessionsUnder` in `session-sweep.js`.
- Task 1's audit confirmed the gap you close: `prepareProjectRepo` does not exist yet; `initProjectRepo`, `writeFrameFiles`, `hasHead`, `runGit` do (consuming seam per brief). Inventory row: AXS-003-adjacent repo-repair row in `docs/plans/open-work-inventory-2026-09-12.md`; governing narrative `docs/plans/git-card-sessions-worktree-rewire.md` D115.
- Program ruling 2 (binding): hand-created project repair is EXPLICIT — offer `Initialize Git repository`; never silently attach Git while opening an org or starting a session.
- Generated clients are never edited directly: `plugins/arxa-sidebar/lib/client.js` regenerates from `workspace-region.snippet.txt` via `node scripts/gen-workspace.mjs --write` (Step 5), and a byte-drift check enforces it.
- Pre-existing uncommitted dirt: `package-lock.json`. Leave it untouched and out of your commits.
- If a hook refuses a compound shell command, split it into simple single commands.
- Machine: Node v24.19.0 via nvm.

## Global Constraints (binding, verbatim from the plan)

- Every behavior change follows RED -> verify the expected failure -> minimal GREEN -> focused tests -> full `npm test` -> commit.
- Preserve root confinement and path identity: resolve and realpath paths before mutation; reject symlink escape and reserved `.git`/`.arxa` paths. A missing/escaped/symlinked project REFUSES (brief Step 1).
- Use scratch ARXA_HOME directories for smoke tests. Never mutate the operator's real organisations, credentials, registries, sessions, Docker state, or GitHub repositories.
- Never print tokens, API keys, OAuth codes, signing material, .env values, or credential-store contents.
- Never edit installed @deepseek-ai/dsh package bytes; extend through Cordis rows, generated snippets, or existing public service seams.
- Never push, merge, tag, or publish. Commit only inside your worktree.
- Do not carry newly found unrelated work into this program — record it under "New finding:" in the ledger with severity and a follow-up path.
- Commit message is fixed by the plan: `feat: prepare imported projects for sessions`, then a blank line and the trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## You Do Not Dispatch Subagents

Do all of this task's work yourself. Never spawn claude, agents, helpers, or reviewers — the controller dispatches review after you report. Report instead.

## Before You Begin

If anything in the brief is unclear or contradictory, STOP and return status NEEDS_CONTEXT with your questions — do not guess.

## Your Job

1. Execute the brief's Steps 1–7 in order (TDD: the brief names its RED checkpoints).
2. While iterating, run the focused suite for what you change; run full `npm test` once before committing.
3. Self-review before committing (completeness vs the brief, quality, YAGNI, test output pristine).
4. Commit, then write your full report.

## Report Format

Write your full report to:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-3-report.md
covering: what you implemented, TDD evidence (RED command + failing output excerpt, GREEN command + passing output), files changed, self-review findings, concerns. Append any "New finding:" entries to the ledger file .superpowers/sdd/2026-09-12-arxa-studio-closeout/progress.md (append only).

Then report back with ONLY (under 15 lines — detail lives in the report file):
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Commits created (short SHA + subject)
- One-line test summary (focused suites + smoke + npm test)
- Your concerns, if any
- The report file path

Use DONE_WITH_CONCERNS if completed but doubtful; BLOCKED if you cannot complete; NEEDS_CONTEXT if information is missing. Never silently produce work you are unsure about.
