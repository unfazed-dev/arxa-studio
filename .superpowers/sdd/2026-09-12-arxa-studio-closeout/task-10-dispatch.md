You are implementing Task 10: Implement A4 Docker/devcontainer isolation (arxa-studio closeout program, wave 3 — confinement; TDD mandated).

## Task Description

Read your task brief FIRST — it is your requirements, with the exact values to use verbatim:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-10-brief.md

## Context

- Working directory (deps installed; do NOT re-run npm install): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout — git worktree, branch closeout-2026-09-12, BASE fd6fd5f. All commits land here.
- Task 9 (landed, review-clean) built the foundation you extend: `plugins/sandbox/lib/effective-tier.js` (tier resolver — your A5-fallback degrade reason plugs in there), `provision.js`, `filesystem.js`, `project-secrets.js` (per-project keychain key + `.env.sops` — your Step 4 consumes the Task 9 project key), the launcher-owned preset migration, and `s1-sandbox-verify.mjs`. Governing narrative: `docs/plans/arxa-isolation-levels.md` L1/A4 + worktree corrections (read first). Inventory row: A4 row in `docs/plans/open-work-inventory-2026-09-12.md`.
- Interfaces you produce (from the brief): `detectDocker()`, `ensureDevcontainer(projectRepo, target)`, `startContainer({ repoPath, branch, sessionId })`, `execContainer(handle, argv)`, `fetchContainerCommits(handle)`, `stopContainer(handle)` + per-project `.devcontainer/devcontainer.json` and target-aware Dockerfile generated only through owned frame/scaffold functions + per-project Supabase lifecycle with stable project ID, separately allocated/persisted port block, one active local stack at a time, local file/SQLite as the zero-Docker floor.
- Safety invariants (binding): a session branch is cloned into a private named volume; results return to a host recovery ref through Git before teardown; the container NEVER runs on project `main` and NEVER mounts sibling projects, the organisation root, or a host worktree's pointer-style `.git` file. Refuse teardown until every container commit is reachable from a host recovery ref.
- Docker on this machine: `command -v docker` first; DETECT, never install. If the daemon is absent/unreachable, everything must degrade to A0–A3 with a truthful effective reason — your tests then run against an INJECTED runner (Step 3) and the real-container smoke (Step 6) degrades honestly (record which path ran). Supabase CLI likewise detect-only.
- RAM-constrained machine: one focused suite at a time; full `npm test` once at the end; no concurrent watchers.
- Pre-existing uncommitted dirt: `package-lock.json`. Leave it untouched and out of your commits.
- If a hook refuses a compound shell command, split it into simple single commands.
- Machine: macOS (Apple Silicon), Node v24.19.0 via nvm.

## Global Constraints (binding, verbatim from the plan)

- Every behavior change follows RED -> verify the expected failure -> minimal GREEN -> focused tests -> full `npm test` -> commit.
- Preserve local-first parity: Docker, a Docker account, or network must NEVER be required — the local floor is the fallback (A0–A3 from Task 9).
- Preserve root confinement and path identity: resolve and realpath before mutation; reject symlink escape and reserved `.git`/`.arxa` paths. Never mount sibling projects, the org root, or pointer-style `.git`.
- Never print tokens, API keys, OAuth codes, signing material, .env values, or credential-store contents. Step 4's negative tests: Docker inspect, process arguments, logs, and sibling projects must not leak the secret.
- Never mutate the operator's real Docker state outside namespaced scratch volumes/networks/containers created for tests, and clean them up. Never touch real Supabase projects (vendor project never linked).
- Never edit installed @deepseek-ai/dsh package bytes; generated clients are never edited directly.
- Never push, merge, tag, or publish. Commit only inside your worktree.
- Do not carry newly found unrelated work into this program — record it under "New finding:" in the ledger with severity and a follow-up path.
- Commit message is fixed by the plan: `feat: add automatic Docker project isolation`, then a blank line and the trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## You Do Not Dispatch Subagents

Do all of this task's work yourself. Never spawn claude, agents, helpers, or reviewers — the controller dispatches review after you report. Report instead.

## Before You Begin

If anything in the brief is unclear or contradictory, STOP and return status NEEDS_CONTEXT with your questions — do not guess.

## Your Job

1. Read the isolation-levels plan section first; execute the brief's Steps 1–8 in order (each names its RED checkpoint).
2. While iterating, run the focused suite for what you change; run full `npm test` once before committing.
3. Self-review before committing (completeness vs the brief, quality, YAGNI, pristine output).
4. Commit, then write your full report — explicitly stating whether Step 6 ran REAL containers or degraded (and why).

## Report Format

Write your full report to:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-10-report.md
covering: what you implemented per step, TDD evidence (RED command + failing output excerpt, GREEN command + passing output), the Step 6 smoke path taken (real vs degraded + reason), Docker/Supabase detection results, files changed, self-review findings, concerns. Append any "New finding:" entries to the ledger file .superpowers/sdd/2026-09-12-arxa-studio-closeout/progress.md (append only).

Then report back with ONLY (under 15 lines — detail lives in the report file):
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Commits created (short SHA + subject)
- One-line test summary (focused suites + smoke path + npm test)
- Your concerns, if any
- The report file path

Use DONE_WITH_CONCERNS if completed but doubtful; BLOCKED if you cannot complete; NEEDS_CONTEXT if information is missing. Never silently produce work you are unsure about.
