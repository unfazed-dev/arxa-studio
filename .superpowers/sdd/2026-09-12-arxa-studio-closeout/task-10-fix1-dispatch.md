You are FIXING Task 10 (Docker/devcontainer isolation) after its review found defects. A prior implementer completed the task (commit 62ee8d5, on BASE fd6fd5f); an independent reviewer found one Critical and five Important issues. You own the fixes now. Work in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout (git worktree, branch closeout-2026-09-12).

## Inputs

- Requirements (unchanged): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-10-brief.md
- Prior implementer's report: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-10-report.md
- Full review (verdicts + evidence): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-10-review.md

## Findings to fix (verbatim from the reviewer)

CRITICAL:
1. `devcontainer.js:424-427` — `stopContainer` ignores `docker rm`/`volume rm` exit codes, then unconditionally deletes the registry row and returns `{stopped:true}`. With the daemon down (this machine's normal state): row deleted, container+volume leak, and `unrecoveredContainerCommits` now returns 0 → `finishSession`/`dropSession` will delete the branch while container-only commits sit in an orphaned volume. Combined with the stale `row.head` fallback (`:413-418`, misses commits made after the last fetch), this disarms the exact guard the task exists to enforce. Fix: treat non-zero rm as refusal (or verify container absence), keep the row on failure.

IMPORTANT:
2. Report overclaim — "real-container leg exists behind `ARXA_A4_REAL_SMOKE=1`": `selftest.devcontainer.mjs:515-516` use `real` only in a log string; every runner is `hybridRunner` unconditionally. Setting the flag with a live daemon prints "REAL containers" while still running doubles. Task 16 has no leg to enable; fix the code or the claim (code fix preferred: make the flag genuinely select a real-runner leg that skips when daemon is down, OR remove the flag and correct the report — your call, state it).
3. `project-database.js:189-198` — `startProjectDatabase` reads the registry BEFORE `allocatePortBlock` persists it; first start of a new project id throws `TypeError` on `reg.projects[projectId].active` (stale copy), and the stale whole-file write clobbers rows allocated in between. Hidden because the selftest pre-allocates. Fix + a regression test that starts a brand-new project id without pre-allocation.
4. `project-database.js:161` — `deps.docker ?? {available: true}` violates detect-never-assume on the exported default (supabase is detected by default; docker isn't); the no-deps path then throws via the default runner instead of degrading to the sqlite floor. Use `detectDocker()`.
5. `startContainer` not idempotent (brief Step 3 demands it): an existing session re-start errors (clone into non-empty volume / name conflict) instead of returning the live handle from the registry row. Fix + test.
6. No signal-path cleanup for the plaintext temp dir (constraint says "every exit path"): SIGINT between `prepareSecretMount` and registry write leaves plaintext in tmpdir. Registry-recorded `secretDir` + later `stopContainer` covers most paths; add a boot sweep of stale `arxa-secret-*` dirs. Fix + test.

Each fix gets its own covering regression test (RED where the product path is wrong, per program TDD rules). Minor findings 7–10 in the review are DEFERRED — do not fix them unless a one-line change rides along naturally with the above.

## Constraints (unchanged, binding)

Same Global Constraints as the original dispatch (verbatim in the prior dispatch file): TDD, local-first, root confinement, no secret printing, scratch-only Docker state, detect-never-install, no push/merge/tag, `package-lock.json` dirt stays out of commits.

## Verification before you report

Re-run: `node plugins/sandbox/selftest.devcontainer.mjs`, `node plugins/sandbox/selftest.project-database.mjs`, `node plugins/sandbox/selftest.mjs`, then full `npm test` (exit 0, ALL GREEN; capture the suite count). One suite at a time — RAM-constrained machine.

## Commit + report

Commit as `fix: harden docker isolation teardown and registry` (blank line, trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`). APPEND your fix report (what changed per finding, covering tests, commands, output excerpts) to the END of task-10-report.md under a `## Fix round 1` heading.

Then report back with ONLY (under 15 lines):
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Commit (short SHA + subject)
- One-line test summary (focused + npm test with suite count)
- Per-finding one-liner: addressed / addressed-differently (how) / not addressed (why)
- The report file path

Never spawn claude/agents/reviewers. If a finding seems wrong, fix the others and flag it — do not silently skip.
