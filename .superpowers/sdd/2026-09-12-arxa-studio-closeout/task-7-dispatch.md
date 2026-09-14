You are implementing Task 7: Close the artifact-viewer security and runtime verification items (arxa-studio closeout program, wave 2 finale; part docs/verification, part test-first hardening).

## Predecessor WIP (important — two killed attempts)

TWO prior implementers were OOM-killed mid-run (this machine is memory-constrained; the monaco clean-build/browser gate is the likely RAM spike). Uncommitted WIP in the tree: 15 modified files (docs/plans/artifact-viewer-*, plugins/artifact-viewer/lib/{client,index,watcher}.js, monaco-build/src/{entry.mjs,spike.html}, selftest*.mjs ×5, plugins/gen-ui/lib/client.js), untracked designs/evidence/studio-closeout/{390,744,1280}/ (attempt 2 captured evidence), plus pre-existing package-lock.json dirt (not yours, leave it). No report, no RED evidence captured yet.
1. Inspect the WIP (`git diff` + evidence tree). Judge each piece against the brief; keep what is correct, fix what is not — you own the final diff.
2. Reconstruct RED evidence for CODE changes (not docs): scratch-copy BASE files (`git show 82296f8:<file>` into a temp dir) and prove the new tests fail there, or use a tagged stash (never bare pop).
3. ORDER YOUR WORK HEAVY-FIRST (controller ruling for memory survival): run the monaco-build clean-build gate FIRST — `cd plugins/artifact-viewer/lib/monaco-build` then `npm ci`, `npm run build`, `node check.mjs`, `node check.mjs --webkit` — while your context is still small. Then the selftests, then root `npm test`, then write the report and COMMIT IMMEDIATELY. Do not interleave exploration between gates and commit.
4. Check which steps the WIP already covers; finish the rest per the brief.

## Task Description

Read your task brief FIRST — it is your requirements, with the exact values to use verbatim:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-7-brief.md

## Context

- Working directory (root deps installed; do NOT re-run root npm install): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout — git worktree, branch closeout-2026-09-12, BASE 82296f8. All commits land here.
- The monaco-build workspace (`plugins/artifact-viewer/lib/monaco-build`) has its OWN package.json — Step 9 runs `npm ci` there (that install is expected and allowed).
- Governing narratives: `docs/plans/artifact-viewer-vscode-monaco.md`, `docs/plans/artifact-viewer-demo-runbook.md`, `docs/plans/artifact-viewer-implementation.md` (modify the first two per Files list). Inventory rows in `docs/plans/open-work-inventory-2026-09-12.md`.
- Program rulings binding here: #3 Prettier and pdf.js REMAIN (no removal, no PDF extension experiment, no allowlist widening); #4 the tested 1.5-second viewer debounce REMAINS autosave owner — change only a probe-proven competing save path + save-race suite.
- Evidence shots (Step 4): store under `designs/evidence/studio-closeout/{390,744,1280}/` — this is the artifact-viewer subset of the evidence tree Task 8 completes.
- Browser gate: `plugins/artifact-viewer/lib/monaco-build/check.mjs` (+ `--webkit`). If the harness needs the arxa lens (arxa/lib/lens.dart port), `command -v` first; the repo's own check.mjs is the primary gate named by the brief.
- Pre-existing uncommitted dirt: `package-lock.json` (root). Leave it untouched and out of your commits. The monaco-build workspace's own lockfile changes BELONG to your commit if Step 9 legitimately updates it.
- If a hook refuses a compound shell command, split it into simple single commands.
- Machine: Node v24.19.0 via nvm; local binds and native watchers permitted.

## Global Constraints (binding, verbatim from the plan)

- Security invariant: extension/webview execution receives NO ambient studio cookies, credentials, host bridges, or mutation token; file access remains explicit, scoped, short-lived, and root-bound.
- Every behavior change follows RED -> verify the expected failure -> minimal GREEN -> focused tests -> full `npm test` -> commit.
- Preserve root confinement and path identity: resolve and realpath before mutation; reject symlink escape and reserved `.git`/`.arxa` paths.
- Use scratch files/ARXA_HOME dirs for all probes and evidence. Never mutate the operator's real state. No marketplace/VSIX loading, no new network fetch paths, no automatic Dart download.
- Never print tokens, API keys, OAuth codes, signing material, .env values, or credential-store contents.
- Never edit installed @deepseek-ai/dsh package bytes; generated clients are never edited directly.
- Never push, merge, tag, or publish. Commit only inside your worktree.
- Do not carry newly found unrelated work into this program — record it under "New finding:" in the ledger with severity and a follow-up path.
- Commit message is fixed by the plan: `fix: close artifact viewer runtime and trust boundaries`, then a blank line and the trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## You Do Not Dispatch Subagents

Do all of this task's work yourself. Never spawn claude, agents, helpers, or reviewers — the controller dispatches review after you report. Report instead.

## Before You Begin

If anything in the brief is unclear or contradictory, STOP and return status NEEDS_CONTEXT with your questions — do not guess.

## Your Job

1. Execute the brief's Steps 1–10 in order. Step 8 branches on what gen-ui currently receives — investigate first, then follow the matching branch exactly (deferred-marker OR bounded renderer with the full named coverage list).
2. While iterating, run the focused selftests you touch; run the full gate set in Step 9 once before committing.
3. Self-review before committing (completeness vs the brief, quality, YAGNI, pristine output).
4. Commit, then write your full report.

## Report Format

Write your full report to:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-7-report.md
covering: what you implemented per step, the threat-model table location, RED/GREEN evidence for code changes, the Step 8 branch decision and its evidence, files changed, self-review findings, concerns. Append any "New finding:" entries to the ledger file .superpowers/sdd/2026-09-12-arxa-studio-closeout/progress.md (append only).

Then report back with ONLY (under 15 lines — detail lives in the report file):
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Commits created (short SHA + subject)
- One-line test summary (clean-build gate + webkit + selftests + npm test + runbook)
- Your concerns, if any
- The report file path

Use DONE_WITH_CONCERNS if completed but doubtful; BLOCKED if you cannot complete; NEEDS_CONTEXT if information is missing. Never silently produce work you are unsure about.
