You are WRITING (not running) a self-contained evidence-capture script for Task 8's remaining narrow-width ladder (arxa-studio closeout). Prior workers keep getting OOM-killed during live browser sessions, so the controller will run your script DIRECTLY — it must therefore be complete, deterministic, and self-cleaning with zero agent interaction. Do NOT launch any browser and do NOT run npm test.

Work in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout (git worktree, branch closeout-2026-09-12, HEAD 5c2f83a).

## What to build

`scripts/evidence-capture-narrow.mjs` — a single Node script that, when run with plain `node scripts/evidence-capture-narrow.mjs`:

1. Boots the studio against a SCRATCH ARXA_HOME (mkdtemp; teardown guaranteed via exit handlers + SIGINT/SIGTERM), seeds a scratch org + repo-less project + a session-shaped repo as needed for each surface.
2. For EACH (width, surface) pair in this exact order — 390 then 744; per width: finish, sweep-modal, checks-red-disclosure, project-preparation, trash-confirm, trash-recover, viewer-install-strip, confinement-configured-effective, workspace-backend-local, workspace-signin, personalisation-tab, viewer-langstrip, viewer-dart-absent; light and dark where the component differs (the repo's theme toggle / dsh token mechanism — reuse what the T7/T8A capture harness already does; check existing scripts and the 1280 PNG provenance) — it:
   a. launches ONE headless Chromium/WebKit at the real window size (no emulated resize),
   b. navigates/drives to the surface using the same selectors/flows the existing evidence tooling uses,
   c. captures the PNG into `designs/evidence/studio-closeout/<width>/<surface>[-theme].png`,
   d. collects console/page errors and applies the `scripts/evidence-gate.mjs` filter list (import/reuse it — do not duplicate),
   e. KILLS the browser process tree completely, waits for exit, then proceeds to the next pair. If a surface fails to mount at that width, capture the failure state + record a structured row (surface, width, error, suspected cause) into a JSON log — never abort the whole run.
3. Prints a per-shot table at the end (shot, ok/failed, console-errors-after-filter) and exits nonzero only if a shot that PREVIOUSLY succeeded (1280 set) now hard-fails; missing-at-width is a recorded row, not a failure.
4. Reuses existing repo helpers (boot smoke path in scripts/, the check.mjs CDP/webdriver patterns under plugins/artifact-viewer/lib/monaco-build, evidence-gate.mjs). Match the repo's conventions; keep the script under ~400 lines if possible.

## Verification you MAY run (no browsers)

`node --check scripts/evidence-capture-narrow.mjs`, plus any pure-logic unit checks (e.g. your surface-list builder) via `node -e`. You may boot NOTHING.

## Commit

`feat: add the narrow-width evidence capture script` (blank line, trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`). `package-lock.json` dirt stays out.

## Report

Append `## Part B — capture script` to .superpowers/sdd/2026-09-12-arxa-studio-closeout/task-8-report.md: design, surface list source, how each surface is driven, gate reuse, failure-row semantics, cleanup paths. Then reply ONLY (under 10 lines): Status; commit; script path + line count; surfaces count; concerns.

## Constraints

Scratch state only; never print secrets; never push/merge/tag; no subagents ever; no browser launches by you.
