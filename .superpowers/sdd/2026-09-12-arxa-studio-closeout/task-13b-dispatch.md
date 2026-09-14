You are implementing Task 13 PART B (of two): the adapters/CLI half of "Implement the fixed WorkspaceProvider wire contract, local provider, and generic REST adapter" (arxa-studio closeout program, wave 4; TDD mandated). The Wire v1 contract is FROZEN at commit `3597a40` and survived its checkpoint review unchanged — you build AGAINST it, never modify it.

## Task Description

Read your task brief FIRST — Steps 4–10 are yours (Steps 1–3 are done, Part A, commit 3597a40):
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-13-brief.md

## Part A interfaces you consume (already landed, review-clean)

- `plugins/workspace-provider/` exists with package.json, lib/contract.js (Wire v1 constants, 25-route table, bounds, D32 config guard), errors.js, wire.js (codecs), selftest.contract.mjs (12 golden checks).
- Checkpoint obligations YOU must satisfy (freeze discipline — pin, don't change): (1) golden-test the opaque token/session RESPONSE envelope shape (routes were pinned; the response decode wasn't); (2) golden-pin X-Arxa-Cursor-Next consume semantics.

## Your scope (brief Steps 4–9, then commit)

- Step 4: reusable conformance kit (CRUD, watch/poll degradation, adaptive polling transitions, optimistic conflict, pagination, audit immutability, blob hashes, member roles, idempotent replay, migration round-trip; network providers also pass cross-org raw-request/IDOR tests; local reports that section `n/a (single-user local store)`).
- Step 5: LocalWorkspaceProvider — atomic JSON docs + append-only JSONL under `<ARXA_HOME>/workspace/<orgId>/`, mode 0700 workspace root, passes applicable conformance with ZERO network/account/database/env.
- Step 6: GenericRestWorkspaceProvider — injected `fetch`, opaque credential handle via the credential service, renders only the declared email/browser/device-code/token flow, timeouts + bounded retries, maps only Wire v1, plus a hostile fixture server proving tenant/IDOR failures turn conformance red.
- Step 7: export/import + canonical CLI: `arxa-studio workspace export|import`, `arxa-studio provider verify`, `arxa-studio diagnose` are the ONLY spellings. JSONL streaming, hash-verify before mutation, preserve IDs where accepted / ID map otherwise, re-invite members via provider ops, audit imported read-only. `provider verify` prints every conformance section, nonzero exit on any required red row.
- Step 8: `arxa-studio diagnose` — user-inspectable bundle: versions, redacted config shape, provider-verify results, bounded error logs; NO tokens/secrets/client records.
- Step 9: runtime + package proof — scratch profile materialization, host/client settings boot, sidecar pack + manifest inspection for `arxa-workspace-provider`, packed-engine boot, focused conformance + migration pressure + CLI smokes + full `npm test`.
- Wire bin/arxa-studio.mjs (plugin registration, PROFILE_PLUGINS/BY_NAME_PLUGINS, subcommand dispatch BEFORE normal studio boot) and profile/cordis.patch.yml (host/client service row) as the brief's Files list requires; add suites to scripts/ci.mjs only if auto-discovery misses any.

## Context

- Working directory (deps installed; do NOT re-run npm install): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout — git worktree, branch closeout-2026-09-12. Part A landed on BASE e800fe9; your BASE is current HEAD (3597a40). All commits land here.
- Program rulings 6/7/8/9 (binding): locked HTTP/JSONL wire contract; first-party in-repo implementations only (no arbitrary JS adapters, no npm package); BYO support export-mediated (no staff backdoor — the contract exposes NO support-access capability); token-opaque identity; polling 3s/30s/120s+immediate.
- Project law (checked-in CLAUDE.md): local-only fallback with equivalent capability is FIRST-CLASS — a user with no database gets LocalWorkspaceProvider with identical UX. Supabase (Task 14, later) is for users who bring their own.
- UI keys: any user-facing strings from the CLI/diagnose go en/pl/fr through the existing arxa-locale service (T8 will sweep; add all three now).
- RAM-constrained machine: one focused suite at a time; full `npm test` once at the end; hostile fixture server tests must bind localhost only and clean up.
- Pre-existing uncommitted dirt: `package-lock.json`. Leave it untouched and out of your commits.
- If a hook refuses a compound shell command, split it into simple single commands.
- Machine: macOS (Apple Silicon), Node v24.19.0 via nvm.

## Global Constraints (binding, verbatim from the plan)

- Every behavior change follows RED -> verify the expected failure -> minimal GREEN -> focused tests -> full `npm test` -> commit.
- Local-first parity: no network/account/database/env required for local operation.
- Never print tokens, API keys, OAuth codes, signing material, .env values, or credential-store contents. Diagnose bundles and provider-verify output must be redacted.
- Never edit installed @deepseek-ai/dsh package bytes; generated clients are never edited directly.
- Never push, merge, tag, or publish. Commit only inside your worktree.
- Do not carry newly found unrelated work into this program — record it under "New finding:" in the ledger with severity and a follow-up path.
- Commit (Part B, completing the task) message: `feat: add fixed workspace providers and local storage` (blank line, trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`).
- WIRE FREEZE: any wire change requires a new protocol version. If you believe one is needed, STOP and return BLOCKED with the specific change — do not edit contract/wire silently.

## You Do Not Dispatch Subagents

Do all of this task's work yourself. Never spawn claude, agents, helpers, or reviewers. Report instead.

## Before You Begin

If anything is unclear or contradictory, STOP and return NEEDS_CONTEXT — do not guess.

## Report Format

APPEND your Part B report to the EXISTING report (do not overwrite Part A content):
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-13-report.md
under a `## Part B` heading: what you implemented per step, TDD evidence (RED + GREEN per step), the two checkpoint obligations' golden pins, hostile-fixture results, pack/manifest proof, files changed, self-review, concerns. Append any "New finding:" entries to the ledger .superpowers/sdd/2026-09-12-arxa-studio-closeout/progress.md (append only).

Then report back with ONLY (under 15 lines):
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Commits created (short SHA + subject)
- One-line test summary (focused suites + smokes + npm test with suite count)
- Checkpoint obligations: pinned/not
- Your concerns, if any
- The report file path

Never silently produce work you are unsure about.
