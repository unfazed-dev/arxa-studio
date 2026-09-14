You are implementing Task 11: Implement A5 Docker Sandbox isolation and safe teardown (arxa-studio closeout program, wave 3 finale — confinement; TDD mandated).

## Task Description

Read your task brief FIRST — it is your requirements, with the exact values to use verbatim:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-11-brief.md

## Context

- Working directory (deps installed; do NOT re-run npm install): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout — git worktree, branch closeout-2026-09-12, BASE f35389b. All commits land here.
- Tasks 9–10 (landed, review-clean) built the foundation: `effective-tier.js` (your A5 degrade path plugs in), filesystem/provision/project-secrets, devcontainer.js with the hardened teardown-refusal pattern (`objectGone()` inspect-verify, row-kept-on-failure — MIRROR that pattern for sbx teardown), and `smokeRunnerFor(real)` honest-skip pattern for gated real legs.
- Interfaces you produce: `sbxStatus`, `sbxLoginFlow`, `ensurePolicy`, `createSandbox`, `startSandbox`, `resolveGitEndpoint`, `fetchSandboxCommits`, `removeSandbox`.
- SAFETY INVARIANT (binding, plan-verbatim): never pass `sbx rm --force` until all sandbox commits are reachable from a host ref and verified; retain `refs/sandboxes/<name>/<branch>` as recovery evidence.
- Governing narrative: `docs/plans/arxa-isolation-levels.md` §§21–24/S3/S4 (read first). Inventory row: A5 row in `docs/plans/open-work-inventory-2026-09-12.md`.
- This machine: `command -v sbx` first — likely absent. All Step 1–7 tests run against injected runners/fake state roots. NO real sign-in, NO global policy change, NO operator Docker Sandbox mutation — the real gate belongs to Task 16 after explicit operator authorization.
- sbx packaging (Step 2): bundled or official checksum-pinned artifact per shipped platform + idempotent updater; do NOT assume Homebrew; unit tests inject downloader/filesystem and never touch the operator install.
- RAM-constrained machine: one focused suite at a time; full `npm test` once at the end.
- Pre-existing uncommitted dirt: `package-lock.json`. Leave it untouched and out of your commits.
- If a hook refuses a compound shell command, split it into simple single commands.
- Machine: macOS (Apple Silicon), Node v24.19.0 via nvm.

## Global Constraints (binding, verbatim from the plan)

- Every behavior change follows RED -> verify the expected failure -> minimal GREEN -> focused tests -> full `npm test` -> commit.
- Preserve local-first parity: A5 is the ONLY tier allowed to require a Docker account, and its absence must degrade cleanly (to A4, then A0–A3) without ever blocking a session.
- Preserve root confinement and path identity; never print tokens, API keys, OAuth codes, signing material, .env values, or credential-store contents.
- Never mutate the operator's real Docker/Sandbox state; fixtures use isolated fake state roots.
- Never edit installed @deepseek-ai/dsh package bytes; generated clients are never edited directly.
- Never push, merge, tag, or publish. Commit only inside your worktree.
- Do not carry newly found unrelated work into this program — record it under "New finding:" in the ledger with severity and a follow-up path.
- Commit message is fixed by the plan: `feat: add Docker Sandbox isolation with recoverable teardown`, then a blank line and the trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## You Do Not Dispatch Subagents

Do all of this task's work yourself. Never spawn claude, agents, helpers, or reviewers — the controller dispatches review after you report. Report instead.

## Before You Begin

If anything in the brief is unclear or contradictory, STOP and return status NEEDS_CONTEXT with your questions — do not guess.

## Your Job

1. Read the isolation-levels plan section first; execute the brief's Steps 1–8 in order (each names its RED checkpoint).
2. Step 7 output matters twice: your selftests run injected/fake-state ONLY, and you must write the exact disposable real-sbx command sequence + expected evidence into the report (Task 16 will execute it under authorization).
3. While iterating, run the focused suite for what you change; run full `npm test` once before committing.
4. Self-review, commit, write your full report.

## Report Format

Write your full report to:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-11-report.md
covering: what you implemented per step, TDD evidence (RED + GREEN per step), the Task-16 real-gate command plan, files changed, self-review findings, concerns. Append any "New finding:" entries to the ledger file .superpowers/sdd/2026-09-12-arxa-studio-closeout/progress.md (append only).

Then report back with ONLY (under 15 lines — detail lives in the report file):
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Commits created (short SHA + subject)
- One-line test summary (focused suites + npm test with suite count)
- Your concerns, if any
- The report file path

Use DONE_WITH_CONCERNS if completed but doubtful; BLOCKED if you cannot complete; NEEDS_CONTEXT if information is missing. Never silently produce work you are unsure about.
