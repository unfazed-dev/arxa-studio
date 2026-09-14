You are implementing Task 9: Implement automatic A0–A3 confinement and B1–B2 integrity (arxa-studio closeout program, wave 3 — confinement; the largest task of the program; TDD mandated throughout).

## Task Description

Read your task brief FIRST — it is your requirements, with the exact values to use verbatim:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-9-brief.md

## Context

- Working directory (deps installed; do NOT re-run npm install): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout — git worktree, branch closeout-2026-09-12, BASE 78c1654. All commits land here.
- Task 1's audit confirmed the gap: none of the sandbox modules exist yet (`effective-tier`, `provision`, `filesystem`, `project-secrets`); `plugins/sandbox` currently has the existing ArxaSandboxProvider for subprocess writes (KEEP it — Step 5). Governing narrative: `docs/plans/arxa-isolation-levels.md` §§S1–S4 (read it first). Inventory row: sandbox A0–A3 row in `docs/plans/open-work-inventory-2026-09-12.md`.
- `profile/cordis.patch.yml` swaps the stock FileSystem provider for the arxa read/write-confined provider; `bin/arxa-studio.mjs` gains preset seeding with a launcher-owned settings-version marker and materialization tests already exist there (extend them).
- The "bounded platform keyring ladder" the brief says to reuse — locate it in the repo before building anything (grep for keyring/security ladder); if absent, build the minimal macOS-keychain + no-keyring-fallback ladder scoped by stable org/project ID. Any keychain access from TESTS must use a namespaced scratch service prefix and clean up after itself; never touch real operator credentials.
- age/SOPS: `command -v age sops` first (Homebrew machine); tests must skip honestly (not fail) when the binary is absent, matching the repo's existing skip patterns.
- OSM caution (memory): this machine is RAM-constrained. Run one focused suite at a time; run full `npm test` once at the end; avoid running multiple watchers concurrently.
- Pre-existing uncommitted dirt: `package-lock.json`. Leave it untouched and out of your commits.
- If a hook refuses a compound shell command, split it into simple single commands.
- Machine: macOS (Apple Silicon), Node v24.19.0 via nvm. Local binds and native watchers permitted.

## Global Constraints (binding, verbatim from the plan)

- Every behavior change follows RED -> verify the expected failure -> minimal GREEN -> focused tests -> full `npm test` -> commit.
- Preserve local-first parity: a database, GitHub account, Docker account, API key, or network connection must NEVER be required for core local operation. The zero-Docker/no-toolchain floor is A0–A3's whole point.
- Preserve root confinement and path identity: resolve and realpath paths before mutation; reject symlink escape and reserved `.git`/`.arxa` paths.
- Never print tokens, API keys, OAuth codes, signing material, .env values, or credential-store contents — including in tests (assert on presence/shape, never on secret values).
- No plaintext `.env`, shell-string keychain call, command-line secret, `-e`, `--env-file`, `--build-arg`, or ambient engine/agent environment for secrets (brief Interfaces).
- Never edit installed @deepseek-ai/dsh package bytes; extend through Cordis rows, generated snippets, or existing public service seams. Generated clients are never edited directly.
- Never push, merge, tag, or publish. Commit only inside your worktree.
- Do not carry newly found unrelated work into this program — record it under "New finding:" in the ledger with severity and a follow-up path.
- Commit message is fixed by the plan: `feat: provision local confinement and project integrity`, then a blank line and the trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## You Do Not Dispatch Subagents

Do all of this task's work yourself. Never spawn claude, agents, helpers, or reviewers — the controller dispatches review after you report. Report instead.

## Before You Begin

If anything in the brief is unclear or contradictory, STOP and return status NEEDS_CONTEXT with your questions — do not guess.

## Your Job

1. Read `docs/plans/arxa-isolation-levels.md` S1–S4 first; execute the brief's Steps 1–9 in order (each names its RED checkpoint).
2. While iterating, run the focused suite for what you change; run full `npm test` once before committing.
3. Self-review before committing (completeness vs the brief, quality, YAGNI, pristine output).
4. Commit, then write your full report.

## Report Format

Write your full report to:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-9-report.md
covering: what you implemented per step, TDD evidence (RED command + failing output excerpt, GREEN command + passing output) per step, the real confinement probe results (Step 8), files changed, self-review findings, concerns. Append any "New finding:" entries to the ledger file .superpowers/sdd/2026-09-12-arxa-studio-closeout/progress.md (append only).

Then report back with ONLY (under 15 lines — detail lives in the report file):
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Commits created (short SHA + subject)
- One-line test summary (focused suites + confinement probes + npm test)
- Your concerns, if any
- The report file path

Use DONE_WITH_CONCERNS if completed but doubtful; BLOCKED if you cannot complete; NEEDS_CONTEXT if information is missing. Never silently produce work you are unsure about.
