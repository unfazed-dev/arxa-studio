You are the implementer for Task 16 FIX ROUND 1 (studio worktree /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout, branch closeout-2026-09-12, HEAD 4e7f552). Review findings: .superpowers/sdd/2026-09-12-arxa-studio-closeout/task-16-review.md. Report: append `## Fix round 1` to task-16-report.md. No subagents; no push/tag; never print secrets; canonical checkouts read-only; scratch ARXA_HOME only; never start the operator's Docker daemon/VM; RAM one-thing-at-a-time, kill toolchains/Chrome between.

## Fix 1 (Critical — E3/L3 wp.info fix loop; do this FIRST, heavy-first)

The implementer ruled `window.__arxaWorkspaceProvider.info()` → `connection: invalid server-response result` on fresh scratch boots "pre-existing at BASE". The reviewer proved that impossible: workspace-provider is BRANCH-BORN (absent at program BASE 4d1b924, created T13), wired into the probe boot path, and transport is exculpated (same-boot `arxa-provider-status` RPC answered). A fix loop was owed.

1. Reproduce RED: fresh scratch-home studio boot on a free port (existing probe tooling — scripts/evidence-capture-narrow.mjs lane or a minimal one-shot driver), call `wp.info()`, capture the exact failing response. Localize: branch-owned candidates are the host-side provider bridge wiring (bin/arxa-studio-provider.mjs, bin/arxa-studio.mjs provider row/fiveLibs from T13 4cc0380, engine sidecar hand-off, and the wire response the client parses). Read the actual bytes the host returns for the failing call vs what client.js expects.
2. Write the failing focused test first (wire-level or boot-level — wherever it pins cheapest; the existing engine-boot-smoke and workspace-provider suites are your templates; test names cite story-IDs per repo law).
3. Minimal GREEN fix. **WIRE FREEZE LAW: plugins/workspace-provider contract/wire/errors must stay byte-identical to 3597a40 — if your diagnosis says the fix requires touching them, STOP and report NEEDS_CONTEXT instead (that would be a protocol-version decision for the controller).**
4. Focused suites for every touched module + engine-boot-smoke green; ONE full `npm test` at the very end (expect ≥130 suites ALL GREEN; +1 if you added a suite).
5. Update matrix E3/L3 row + §Escalated: outcome either DONE-fixed (artifact path, commit) or a downgrade backed by the hard evidence you actually measured (name it: exact bytes, exact line). Re-capture the failure-state evidence shot only if it remains a failure.

## Fix 2 (Important — §Escalated wording)

"each measured pre-existing at BASE" is true for E1 ONLY. Correct the section: E1 = pre-existing at BASE (verbatim 403 gate); E2 = dock-dead RIDE condition honored (fresh HEAD probe reproduced + external row + operator-installed-studio counter-evidence); E3 = outcome of Fix 1. Never let the blanket claim propagate to T17.

## Fix 3 (Minors)

- `designs/evidence/studio-closeout/narrow-capture-log.json` was overwritten by the Part A run — the matrix §Escalated pointer to it is stale; restore coherence (point at the current log's actual path/content or the T8-era copy in git history, whichever is truthful).
- Matrix E-row artifact paths point at `designs/evidence/studio-closeout-2026-09-12/…` while files live under `designs/evidence/studio-closeout/` — align column to reality (no file moves needed; fix the paths, or move files if that is cleaner — your call, say which).
- `package-lock.json` (+2) was committed under `4e7f552` contrary to the residue contract (lockfile churn stays uncommitted). Restore: `git checkout 8e3bc01 -- package-lock.json`, include in your docs commit.

## Commits

Product fix (if any) = its own `fix:` commit with RED evidence in the report. Matrix/doc/minor fixes = `test: correct the closeout evidence matrix` (or fitting). Trailers `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## Reply (under 10 lines)

Status; E3 outcome (fixed-with-SHA | downgraded-with-evidence | NEEDS_CONTEXT); wire-freeze status; suites one-liner; commits; remaining concerns.
