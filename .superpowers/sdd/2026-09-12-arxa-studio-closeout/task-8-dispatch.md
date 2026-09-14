You are implementing Task 8: Finish localization and visual acceptance for touched desktop surfaces (arxa-studio closeout program, wave 5 — after every UI-producing task). Steps 1–2, 4–6 are yours; Step 3 (native-speaker reviews) is the CONTROLLER's — dispatch separate reviewers after you report; do not attempt it.

## Predecessor WIP (important)

A prior implementer was OOM-killed early (RAM-constrained machine). Uncommitted WIP: `plugins/locale/selftest.parity.mjs` (new), `plugins/personalisation/lib/client.js` and `plugins/theme-accent/lib/client.js` (modified) — inspect, keep what is correct, fix what is not; you own the final diff. No report exists yet; re-verify RED for the parity test yourself if needed (it may or may not have been run). RAM discipline: ONE browser width at a time with processes killed between runs; one suite at a time; commit as soon as a coherent state is green rather than batching everything.

## Task Description

Read your task brief FIRST — it is your requirements, with the exact values to use verbatim:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-8-brief.md

## Context

- Working directory (deps installed; do NOT re-run npm install): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout — git worktree, branch closeout-2026-09-12, BASE ce5e82e. All commits land here.
- Surfaces touched by Tasks 2–14 that need key parity (from the ledger): arxa-sidebar (repair CTA, trash/restore names, checks strip), arxa-git-card (gate row + ledger strip), sandbox (effective-tier card configured/effective), workspace-provider (backend settings, sign-in states, degraded badges — incl. the never-emitted badgeDegraded key already present in dictionaries), artifact-viewer (install strip copy), plus the full Personalisation tab. Dictionaries/generators live under the owning plugins (`plugins/locale`, `plugins/personalisation`, etc. per the brief's Files list).
- Product terms: read `docs/CONTEXT.md` (or the repo's CONTEXT.md equivalent) for the protected vocabulary; never translate IDs, paths, branch names, model IDs, commands.
- MANDATORY CONDITIONS from Task 7's review (binding on you):
  (a) The viewer evidence ladder is INCOMPLETE — `designs/evidence/studio-closeout/` has 1280 fully captured but 390 is EMPTY and 744 has only the dart strip. Your Step 4 must capture the viewer surfaces at 390/744 in the same tree.
  (b) The console-error filter list currently lives in an out-of-repo driver (`/tmp/arxa-task7`) — LAND the driver and its filter patterns IN-REPO (a small script under scripts/ or the evidence tree) so the zero-console-error gate is reviewable.
- T7's capture harness FAILED at narrow widths (sheet won't mount on emulated resize; no headless file entry at 390/744). Do NOT repeat that method: use real per-width browser launches (headless Chrome/WebKit with --window-size / viewport flags per run) or CDP device-metrics override — one capture session per width, sequential.
- Step 4 surface list (from the brief, plus confinement/provider surfaces from T9–T14): Finish, Sweep, Checks red disclosure, project preparation, trash confirmation/recovery, viewer install strip, configured/effective confinement, Workspace backend/sign-in states, Personalisation — at 390/744/1280, light AND dark where the component differs.
- RAM-constrained machine: run captures ONE WIDTH AT A TIME, kill browser processes between runs, write files as you go; full `npm test` once at the end; one suite at a time.
- Pre-existing uncommitted dirt: `package-lock.json`. Leave it untouched and out of your commits.
- If a hook refuses a compound shell command, split it into simple single commands.
- Machine: macOS (Apple Silicon), Node v24.19.0 via nvm.

## Global Constraints (binding, verbatim from the plan)

- UI uses shipped dsh primitives and real `--dsw-*` tokens. Add every user-facing key in English, Polish, and French.
- Every behavior change follows RED -> verify the expected failure -> minimal GREEN -> focused tests -> full `npm test` -> commit. (Step 1's parity test is the RED.)
- Evidence shots must show zero console/page errors (use the now-in-repo filtered gate; the filter list must be named and justified in the report).
- Never print tokens, API keys, OAuth codes, signing material, .env values, or credential-store contents.
- Use scratch ARXA_HOME/orgs for every capture; never mutate operator state.
- Never edit installed @deepseek-ai/dsh package bytes; generated clients never edited directly (locale dictionaries regenerate through their generators).
- Never push, merge, tag, or publish. Commit only inside your worktree.
- Do not carry newly found unrelated work into this program — record it under "New finding:" in the ledger with severity and a follow-up path.
- Commit message is fixed by the plan: `feat: complete studio locale and visual acceptance`, then a blank line and the trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## You Do Not Dispatch Subagents

Do all of this task's work yourself. Never spawn claude, agents, helpers, or reviewers — the controller separately dispatches the PL and FR native-speaker reviews after you report, and their approved corrections land in a controller-directed fix round. Report instead.

## Before You Begin

If anything is unclear or contradictory, STOP and return NEEDS_CONTEXT — do not guess.

## Report Format

Write your full report to:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-8-report.md
covering: parity-test result + keys added per plugin, capture method per width + evidence inventory (file list per width/surface, light/dark), console-error gate driver location + filter list with justifications, files changed, self-review, concerns. Append any "New finding:" entries to the ledger .superpowers/sdd/2026-09-12-arxa-studio-closeout/progress.md (append only).

Then report back with ONLY (under 15 lines):
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Commits created (short SHA + subject)
- One-line test summary (locale suites + drift + npm test with suite count)
- Evidence coverage one-liner (widths × surfaces, any gaps + why)
- Your concerns, if any
- The report file path

Never silently produce work you are unsure about.
