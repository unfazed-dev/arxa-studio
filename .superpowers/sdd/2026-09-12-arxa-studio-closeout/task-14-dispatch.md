You are implementing Task 14: Implement the first-party Supabase/Postgres provider (arxa-studio closeout program, wave 4 finale — agency data plane; TDD mandated).

## Task Description

Read your task brief FIRST — it is your requirements, with the exact values to use verbatim:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-14-brief.md

## Context

- Working directory (deps installed; do NOT re-run npm install): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout — git worktree, branch closeout-2026-09-12, BASE 4cc0380. All commits land here.
- Task 13 (landed, review-clean, commit 4cc0380) gives you: the FROZEN Wire v1 contract + `WorkspaceProvider` interface (`plugins/workspace-provider/lib/contract.js`), the conformance kit (`lib/conformance.js` — run ALL providers through it, incl. the cross-org/IDOR section that must be GREEN for network providers), `LocalWorkspaceProvider`, `GenericRestWorkspaceProvider`, the credential-service handle pattern, `bin/arxa-studio-provider.mjs` (which currently REFUSES `supabase` as unimplemented — your task makes it real; keep the refusal for any OTHER unimplemented name), and the provider-verify/diagnose/export/import CLI paths.
- WIRE FREEZE: implement the adapter AGAINST the frozen contract; any wire change requires a new protocol version — if you believe one is needed, STOP and return BLOCKED with specifics. Supabase-specific row shapes stay INSIDE `lib/supabase.js`; callers see only contract objects.
- Ruling 8: Supabase Auth supplies the reference email/password UX, but callers consume ONLY the opaque-token session surface. Ruling 9: realtime absence/failure degrades to adaptive polling. NO staff/support-access capability; diagnostics operator-exported only.
- Project law (checked-in CLAUDE.md): the Arxa Digital Solutions database is NOT a dependency of arxa studio — Supabase support is for users who bring their OWN database. Local stays the zero-config default. Never hardcode or depend on any Arxa-owned project URL/keys.
- Step 2 harness: Docker daemon is DOWN on this machine (docker CLI present, daemon unreachable — confirmed earlier). So: the disposable local-Supabase harness script MUST exist and be correct (pin CLI version, scratch state dir, reserved ports, two users/two orgs, guaranteed stop/volume cleanup on success/failure/signal), but your RUNS use the injected protocol fake path; record honestly that the real-stack leg is daemon-gated (Task 16 / operator-started daemon). The dedicated CI job (`.github/workflows/ci.yml`, separate disposable local-Supabase conformance job) will exercise the real stack on CI runners — write the workflow job so it is correct by inspection.
- Supabase CLI: `command -v supabase` — 2.67.1 detected earlier; DETECT only, never install.
- RAM-constrained machine: one focused suite at a time; full `npm test` once at the end; the injected fake must not bind extra ports when avoidable.
- Pre-existing uncommitted dirt: `package-lock.json`. Leave it untouched and out of your commits.
- If a hook refuses a compound shell command, split it into simple single commands.
- Machine: macOS (Apple Silicon), Node v24.19.0 via nvm.

## Global Constraints (binding, verbatim from the plan)

- Every behavior change follows RED -> verify the expected failure -> minimal GREEN -> focused tests -> full `npm test` -> commit.
- Local-first parity: local remains zero-config default; settings may select only `local`, `generic-rest`, `supabase`; truthful live/degraded capability badges.
- Credentials through the existing credential service, NEVER environment files. Never print tokens/API keys/secrets (tests assert shape, not values).
- Never mutate the operator's real Docker state; the harness cleans up on all paths; the disposable database is the only thing reset.
- Never edit installed @deepseek-ai/dsh package bytes; generated clients never edited directly.
- Never push, merge, tag, or publish. Commit only inside your worktree.
- Do not carry newly found unrelated work into this program — record it under "New finding:" in the ledger with severity and a follow-up path.
- Commit message is fixed by the plan: `feat: add the first-party Supabase workspace provider`, then a blank line and the trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## You Do Not Dispatch Subagents

Do all of this task's work yourself. Never spawn claude, agents, helpers, or reviewers. Report instead.

## Before You Begin

If anything is unclear or contradictory, STOP and return NEEDS_CONTEXT — do not guess.

## Report Format

Write your full report to:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-14-report.md
covering: what you implemented per step, TDD evidence (RED + GREEN per step), the harness/daemon-gated honest record, migration list + local reversibility evidence path, conformance results for all three providers, the export local→Supabase→local hash-equivalence result, files changed, self-review, concerns. Append any "New finding:" entries to the ledger .superpowers/sdd/2026-09-12-arxa-studio-closeout/progress.md (append only).

Then report back with ONLY (under 15 lines):
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Commits created (short SHA + subject)
- One-line test summary (focused suites + smoke path taken + npm test with suite count)
- Your concerns, if any
- The report file path

Never silently produce work you are unsure about.
