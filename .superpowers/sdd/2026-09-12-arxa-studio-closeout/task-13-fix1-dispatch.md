You are FIXING Task 13 (WorkspaceProvider, head 72a2a83) after review found two Important defects, plus one confirmed cross-task regression the reviewer ruled must land now. Work in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout (git worktree, branch closeout-2026-09-12).

## Inputs

- Review: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-13-review.md
- Prior report (Part A + Part B + your future `## Fix round 1`): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-13-report.md
- Brief: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-13-brief.md

## Findings to fix

IMPORTANT 1 — `plugins/workspace-provider/lib/generic-rest.js:123`: the byte bound applied to ALL payloads is `MAX_RECORD_BYTES` (1 MiB); blobs up to 1 GiB are contract-legal but every blob >1 MiB is rejected client-side (reproduced: 2 MiB putBlob → `invalid_request`; the kit's tiny blobs masked it). Fix: bound bytes/blob payloads by `MAX_BLOB_BYTES`. Add a regression test with a >1 MiB blob through the adapter (injected fetch + fake server; do not allocate giant strings needlessly — 2 MiB is fine).

IMPORTANT 2 — `bin/arxa-studio-provider.mjs:137-146,160`: `provider: "supabase"` (a D32-sanctioned name) silently builds the LOCAL provider; `provider verify` prints all-green exit 0 (reproduced). A verify tool must not certify the wrong backend. Fix: for any configured-but-unimplemented provider name, `provider verify` reports a red row (`supabase adapter not implemented` — exact wording yours) and exits nonzero; the CLI must refuse to silently substitute local for a named remote provider (error out of export/verify/diagnose paths that need the named backend; a diagnostic message may still run).

IMPORTANT 3 (T11-rooted, reviewer-ruled) — engine web boot broken since Task 11: `plugins/git-workspace/lib/sessions.js:64-65` imports `sandbox/lib/devcontainer.js`, but `fiveLibs` (`bin/arxa-studio.mjs:452`) lacks the `sandbox` plugin → packed engine dies `ERR_MODULE_NOT_FOUND` (reproduced by reviewer via `node scripts/engine-boot-smoke.mjs`). Fix: (a) add `['sandbox', …]` to fiveLibs so packed boot resolves (all importers resolve to the same flat `<nm>/sandbox`); (b) close the blind spot so this class can't recur: add the engine-boot smoke to `npm test` discovery AND/OR extend the pack-list scanner to check fiveLibs/PROFILE_PLUGINS cross-imports — reviewer suggested either; do the cheapest that genuinely catches it (state which and why). Verify with `node scripts/engine-boot-smoke.mjs` green at HEAD.

Minor findings → deferred; do not fix (list in review).

## Requirements

Each fix gets a covering regression test (RED-first where the product path is wrong). Re-run after: the workspace-provider suites + CLI suite, `node scripts/engine-boot-smoke.mjs`, then full `npm test` (exit 0, ALL GREEN, record suite count — it should GROW if you wired the boot smoke into discovery). One suite at a time — RAM-constrained. No secret printing; no push/merge/tag; `package-lock.json` dirt stays out; WIRE FREEZE untouched (these fixes change no wire surface — if you think one does, STOP and return BLOCKED).

## Commit + report

Commit as `fix: bound blob payloads, refuse unimplemented providers, pack sandbox lib` (blank line, trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`). APPEND `## Fix round 1` to task-13-report.md: per-finding change, covering test, command, output excerpt.

Report back ONLY (under 12 lines): Status; commit; one-line test summary (suites + boot smoke); per-finding one-liner (addressed / differently / not); report path. Never spawn claude/agents/reviewers.
