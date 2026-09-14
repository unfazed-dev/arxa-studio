You are implementing Task 6: Add the condensed Git-card delivery ledger (arxa-studio closeout program, wave 2; TDD mandated).

## Task Description

Read your task brief FIRST — it is your requirements, with the exact values to use verbatim:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-6-brief.md

## Context

- Working directory (deps installed; do NOT re-run npm install): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout — git worktree, branch closeout-2026-09-12, BASE 7d9e866. All commits land here.
- Interfaces landed by Task 4 in the files you touch (don't disturb): `card.gate.run` action + cached `gate` status field with fingerprint staleness in `plugins/arxa-git-card/lib/index.js`; the Checks row in `git-card.snippet.txt`/`client.js`. Your strip lands under the card frame summary beside them.
- Task 1 audit: `plugins/git-workspace/lib/ledger.js` and the linked-PR URL plumbing exist; the summary action does not. Governing narrative: `docs/plans/github-conversations-in-the-insight-panel.md` carried ledger strip; inventory row in `docs/plans/open-work-inventory-2026-09-12.md`.
- Generated clients regenerate (`gen-git-card.mjs --write`, drift `--check` enforces); never hand-edit `client.js`.
- UI keys: three locales (en/pl/fr) per Step 4.
- Smokes: `scripts/card-local-smoke.mjs` and `scripts/card-cicd-smoke.mjs` (brief's Test lines).
- Pre-existing uncommitted dirt: `package-lock.json`. Leave it untouched and out of your commits.
- If a hook refuses a compound shell command, split it into simple single commands.
- Machine: Node v24.19.0 via nvm.

## Global Constraints (binding, verbatim from the plan)

- Every behavior change follows RED -> verify the expected failure -> minimal GREEN -> focused tests -> full `npm test` -> commit.
- Produces action: `card.ledger.summary { sessionId } -> { lastStage, result, nextOwner, target, url } | null`; consumes the existing git-workspace ledger and linked PR URL; never refetches or duplicates the full ledger table.
- UI uses shipped dsh primitives and real `--dsw-*` tokens; user-facing keys in English, Polish, and French; escaped content.
- Use scratch ARXA_HOME directories for smoke tests. Never mutate the operator's real organisations, credentials, sessions, Docker state, or GitHub repositories. No real GitHub traffic: link only when a trusted GitHub URL already exists from the ledger.
- Never print tokens, API keys, OAuth codes, signing material, .env values, or credential-store contents.
- Never edit installed @deepseek-ai/dsh package bytes; extend through Cordis rows, generated snippets, or existing public service seams.
- Never push, merge, tag, or publish. Commit only inside your worktree.
- Do not carry newly found unrelated work into this program — record it under "New finding:" in the ledger with severity and a follow-up path.
- Commit message is fixed by the plan: `feat: show the latest delivery ledger on the git card`, then a blank line and the trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## You Do Not Dispatch Subagents

Do all of this task's work yourself. Never spawn claude, agents, helpers, or reviewers — the controller dispatches review after you report. Report instead.

## Before You Begin

If anything in the brief is unclear or contradictory, STOP and return status NEEDS_CONTEXT with your questions — do not guess.

## Your Job

1. Execute the brief's Steps 1–6 in order (TDD: the brief names its RED checkpoint).
2. While iterating, run the focused suite for what you change; run full `npm test` once before committing.
3. Self-review before committing (completeness vs the brief, quality, YAGNI, test output pristine).
4. Commit, then write your full report.

## Report Format

Write your full report to:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-6-report.md
covering: what you implemented, TDD evidence (RED command + failing output excerpt, GREEN command + passing output), files changed, self-review findings, concerns. Append any "New finding:" entries to the ledger file .superpowers/sdd/2026-09-12-arxa-studio-closeout/progress.md (append only).

Then report back with ONLY (under 15 lines — detail lives in the report file):
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Commits created (short SHA + subject)
- One-line test summary (focused suites + smokes + npm test)
- Your concerns, if any
- The report file path

Use DONE_WITH_CONCERNS if completed but doubtful; BLOCKED if you cannot complete; NEEDS_CONTEXT if information is missing. Never silently produce work you are unsure about.
