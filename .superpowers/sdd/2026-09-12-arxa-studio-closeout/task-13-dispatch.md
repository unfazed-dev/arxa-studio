You are implementing Task 13 PART A (of two): the contract-freeze half of "Implement the fixed WorkspaceProvider wire contract, local provider, and generic REST adapter" (arxa-studio closeout program, wave 4 — agency data plane; TDD mandated). You implement Steps 1–3 ONLY, then STOP for a checkpoint review before either adapter is written — the plan mandates this stop.

## Task Description

Read your task brief FIRST — it is your requirements, with the exact values to use verbatim (including the Wire v1 table — freeze it EXACTLY):
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-13-brief.md

## Your scope (Part A = brief Steps 1–3, STOP before Step 4)

- Step 1: rewrite the stale source-plan status + config examples in `docs/plans/agency-backend-provider-abstraction.md` (D32–D35 authority; local zero-config; remote = generic-rest|supabase; custom.adapter + ARXA_WORKSPACE_ADAPTER invalid; support bundle-only; identity token-opaque; polling 3s/30s/120s + immediate-after-write).
- Step 2: freeze the Wire v1 table in failing golden tests (exact routes, verbs, headers, media types, envelopes, bounds, pagination, token lifecycle, capability-driven sign-in dispatch, error taxonomy, abort signals, request IDs; config cannot name executable code).
- Step 3: verify RED, then implement contract/types/errors + protocol codecs (bounded JSON singletons; JSONL for records/audit/export; reject unknown versions and collections BEFORE I/O).

Create the plugin skeleton files you need for these steps (package.json, contract.js, errors.js, wire.js, types as needed, selftest.contract.mjs). Do NOT write the conformance kit, local provider, REST adapter, CLI, export/import, or diagnose — Part B (a later dispatch) owns Steps 4–9. Do NOT wire the plugin into bin/arxa-studio.mjs or profile/cordis.patch.yml yet beyond what Step 1–3 tests require — but DO make sure your new suite is discovered by `npm test` (scripts/ci.mjs auto-discovery picks up plugin selftests; verify).

## Context

- Working directory (deps installed; do NOT re-run npm install): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout — git worktree, branch closeout-2026-09-12, BASE e800fe9. All commits land here.
- Program ruling 6 (binding): provider v1 uses the locked HTTP/JSONL wire contract; first-party in-repo implementations only; NO arbitrary local JavaScript adapters; NO public npm package in this closeout.
- Program ruling 8: provider identity is token-opaque (issue/refresh/revoke/introspect); email/password is NOT part of the wire contract.
- Program ruling 9: adaptive polling 3s active / 30s idle / 120s background + immediate after local write — encode as contract constants.
- Project law (checked-in CLAUDE.md): arxa studio is distributed software — every database-capable feature must have a local-only fallback with equivalent capability; Supabase is for users who bring their OWN database. Your contract design must keep LocalWorkspaceProvider (Part B) a first-class zero-config citizen.
- RAM-constrained machine: one focused suite at a time; full `npm test` once at the end.
- Pre-existing uncommitted dirt: `package-lock.json`. Leave it untouched and out of your commits.
- If a hook refuses a compound shell command, split it into simple single commands.
- Machine: macOS (Apple Silicon), Node v24.19.0 via nvm.

## Global Constraints (binding, verbatim from the plan)

- Every behavior change follows RED -> verify the expected failure -> minimal GREEN -> focused tests -> full `npm test` -> commit.
- Local-first parity: no network/account/database/env required for local operation.
- Never print tokens, API keys, OAuth codes, signing material, .env values, or credential-store contents. Error messages never contain tokens or cross-org data (Wire table).
- Never edit installed @deepseek-ai/dsh package bytes; generated clients are never edited directly.
- Never push, merge, tag, or publish. Commit only inside your worktree.
- Do not carry newly found unrelated work into this program — record it under "New finding:" in the ledger with severity and a follow-up path.
- Commit (Part A) message: `feat: freeze the workspace provider wire contract` (blank line, trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`). This splits the plan's single Step-10 message across the two parts by controller ruling — Part B will commit as `feat: add fixed workspace providers and local storage` when the task completes.

## You Do Not Dispatch Subagents

Do all of this task's work yourself. Never spawn claude, agents, helpers, or reviewers — the controller dispatches the checkpoint review after you report. Report instead.

## Before You Begin

If anything in the brief is unclear or contradictory, STOP and return status NEEDS_CONTEXT with your questions — do not guess. This is a protocol FREEZE: exactness is the deliverable; ambiguity must be surfaced, not smoothed.

## Report Format

Write your full report to:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-13-report.md
covering: Step 1 doc rewrite summary, Step 2 golden-test inventory (what is pinned), Step 3 RED→GREEN evidence, files created/changed, any wire-table ambiguities you resolved (list them explicitly — the checkpoint reviewer judges each), self-review, concerns. Append any "New finding:" entries to the ledger file .superpowers/sdd/2026-09-12-arxa-studio-closeout/progress.md (append only).

Then report back with ONLY (under 15 lines):
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Commits created (short SHA + subject)
- One-line test summary (focused suite + npm test with suite count)
- Ambiguities resolved (one-liners, if any)
- Your concerns, if any
- The report file path

Never silently produce work you are unsure about.
