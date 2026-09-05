# arxa-sidebar: uiWorkspace self-inject deadlock after dsh 0.1.2-rc.1

Date: 2026-09-05

## Problem

After the (uncommitted) dsh bump 0.1.1-rc.2 → 0.1.2-rc.1, the desktop boot reports
"web boot: 8 entries did not activate": arxa-sidebar and directory-picker-native are
`pending (waiting for service: uiWorkspace)`; conversation/chat/workflow-run/
deliverables/goal/trajectory wait on `uiConversation` behind them.

## Root cause (evidence)

- Stock `@deepseek-ai/dsh-client-ui-sidebar` 0.1.2-rc.1 `inject = ["slots","layout","uiWorkspace","locale"]`
  (0.1.1 injected `sessions` instead) and calls `ctx.get("uiWorkspace")` on the first line of `apply`.
- `profile/cordis.patch.yml` disables the stock `ui-workspace` (the only provider) and
  `ui-sidebar`/`ui-layout`; arxa-sidebar composes shell + workspace half into ONE plugin.
- `scripts/gen-workspace.mjs` replaces the stock workspace `apply` with `ourApply`, which never
  ran `new UiWorkspaceService(...)` (cordis `Service` ctor is what calls `ctx.reflect.provide`).
- Composed `exports.inject` was the shell's list → the plugin waits on a service only it can
  provide → never applies. Served registry (54 entries) has no ui-workspace/layout/sidebar.

## Fix (generator, not the generated file)

`scripts/gen-workspace.mjs`:
1. `ourApply` constructs `new UiWorkspaceService(ctx, ctx.remote.directoryPicker, ctx.get("workspaces"), ctx.get("sessions"))` first.
2. Composition block: `exports.inject` = shell inject minus `uiWorkspace` plus
   `sessions, workspaces, remote, remote.directoryPicker` (stock ui-workspace list);
   `exports.apply` runs the workspace half BEFORE the shell (stock order).

## Verification

- `node scripts/gen-workspace.mjs --write` (parses via vm.Script fail-fast).
- `node plugins/arxa-sidebar/selftest.mjs`, `node scripts/gen-frame.mjs --check`.
- Restart engine, wdio boot: no "did not activate" entries, sidebar renders workspaces.

## Notes

- Advisor consult skipped: `consult.sh` returned `over_budget` (session 23/20).
- `gen-workspace.mjs --check` prints the generated bundle to stdout instead of a verdict
  (exit 0 always) — separate follow-up.
