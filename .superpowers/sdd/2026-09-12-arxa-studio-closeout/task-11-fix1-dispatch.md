You are FIXING one Important finding from Task 11's review (Docker Sandbox isolation, commit 18c52cc on BASE f35389b). Work in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout (git worktree, branch closeout-2026-09-12).

## Inputs

- Review: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-11-review.md
- Prior report: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-11-report.md

## Finding to fix (verbatim)

IMPORTANT 1: Live probe in a "fake-state only" suite — `selftest.sbx.mjs:549` runs real `sbx version/status/ls` on every `npm test` when sbx is installed. The implementer's own ledger notes `sbx ls` auto-starts a stopped daemon — a real state mutation from a suite whose task's Step 7 constrains to injected-only. The comment calls it "read-only" (`selftest.sbx.mjs:541`) — contradicted by the measured side effect. It should sit behind `ARXA_A5_REAL_SMOKE` like the lifecycle leg, skipping honestly (printing the skip reason) when the env var is unset.

Also fold in the tied Minor 5: correct the `sbx.js:91` comment claim ("never starts the daemon itself") to name the measured `sbx ls` auto-start side effect honestly (one sentence).

## Requirements

1. Gate the live-probe block behind `ARXA_A5_REAL_SMOKE`; default path must run ZERO real sbx commands (assert no daemon interaction in the default path is impractical — instead assert the runner is the injected one / the probe block is skipped with a printed reason).
2. Keep an injected-only version of whatever the probe checked (version/parse shape) so coverage is not lost — the probe's assertions move behind the gate, and any pure-parse equivalents stay ungated.
3. Do NOT touch anything else in the diff. Minors 2–4 are deferred, not yours.
4. Re-run: `node plugins/sandbox/selftest.sbx.mjs` (expect green, with the honest skip line visible), `npm test` (exit 0, ALL GREEN, record suite count).
5. Commit as `fix: gate the live sbx probe behind the real-smoke flag` (blank line, trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`).
6. APPEND a `## Fix round 1` section to task-11-report.md: what changed, covering test, command, output excerpt.

## Constraints (binding)

Never mutate the operator's real Docker/Sandbox state (that is the point of this fix); no real sbx commands in your verification beyond what the now-gated block does UNSET; never print secrets; no push/merge/tag; `package-lock.json` dirt stays out of the commit. RAM-constrained: one suite at a time.

Then report back with ONLY (under 12 lines): Status (DONE/BLOCKED/NEEDS_CONTEXT), commit (short SHA + subject), one-line test summary, one-liner on the finding (addressed / addressed-differently), report path. Never spawn claude/agents/reviewers.
