You are FIXING Task 14 (Supabase provider, head 75d090f on BASE 4cc0380) after review found two Important defects. Work in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout (git worktree, branch closeout-2026-09-12).

## Inputs

- Review: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-14-review.md
- Prior report (+ your future `## Fix round 1`): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-14-report.md

## Findings to fix (verbatim)

IMPORTANT 1 — Prefer-header semantics unverified against real PostgREST; the fake is blind to them:
(a) `scripts/workspace-provider-supabase-smoke.mjs:158` — mkOrg POSTs a table insert with NO `Prefer: return=representation` then reads `r.body[0].id`. PostgREST's table-insert default is minimal (no body) — the real leg likely dies at the first org create.
(b) `plugins/workspace-provider/lib/supabase.js:108` — blanket `return=minimal` rides every body-carrying call without explicit prefer, including all six `/rpc/*` calls that consume their response (`out.id` at :273 would TypeError on a 204).
Fix: send `Prefer: return=representation` on RPC calls and wherever a response body is consumed (mkOrg and equivalents); keep minimal only where nothing is read. Extend the protocol FAKE to assert prefer-header presence/absence per call (so the fake is no longer blind to this class) and add regression rows.

IMPORTANT 2 — `npm test` is machine-state-dependent: `scripts/ci.mjs:100` wires the smoke into npm test; `scripts/workspace-provider-supabase-smoke.mjs:265-269` runs the REAL stack whenever daemon+CLI-pin exist — a runner with the CLI (required by the CI job) would spin the real stack in ordinary npm test, contradicting ci.mjs's own comment and the brief ("ordinary offline npm test uses the injected protocol fake"). Fix: the npm-test-discovered leg is deterministically OFFLINE (fake); the real leg runs ONLY when explicitly requested (env var like ARXA_SUPABASE_REAL=1 or a `--real` flag — mirror the repo's existing gated-leg conventions, e.g. ARXA_A5_REAL_SMOKE); CI's supabase-conformance job invokes the real leg explicitly.

Minors 3–5 (org-delete role gating, volume cleanup, badgeDegraded/audit idempotency) are DEFERRED — do not fix.

## Requirements

Covering regression tests for both fixes (the fake now asserts prefer semantics per call). Re-run: `node plugins/workspace-provider/selftest.supabase.mjs`, `node scripts/workspace-provider-supabase-smoke.mjs` (offline leg, honest banner), `npm test` (exit 0, ALL GREEN, record suite count — MUST be green on a machine WITH the CLI installed and daemon down; ideally also reason through daemon-up case: ordinary npm test must not attempt real stack). One suite at a time; RAM-constrained. WIRE FREEZE untouched (no changes to contract.js/wire.js/errors.js — if needed, STOP + BLOCKED). No secret printing; daemon stays down; no push/merge/tag; lockfile dirt out of commits.

## Commit + report

Commit as `fix: correct prefer semantics and make the supabase smoke deterministic` (blank line, trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`). APPEND `## Fix round 1` to task-14-report.md: per-finding change, covering test, command, output excerpt.

Report back ONLY (under 12 lines): Status; commit; one-line test summary; per-finding one-liner (addressed / differently / not); report path. Never spawn claude/agents/reviewers.
