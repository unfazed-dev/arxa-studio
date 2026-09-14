# Task 14 — RED/GREEN evidence (raw command outputs)

## Step 1 RED — adapter contract tests, module absent (2026-09-13)

```
$ node plugins/workspace-provider/selftest.supabase.mjs
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/plugins/workspace-provider/lib/supabase.js'
  imported from .../plugins/workspace-provider/selftest.supabase.mjs
```

Expected failure: the feature (lib/supabase.js) does not exist. The fake harness
itself compiled and loaded — the failure is the missing adapter, not a typo in
the suite.

## Step 5 RED — settings section missing (client.js carries no locale NS / section builder)

```
$ node plugins/workspace-provider/selftest.settings.mjs
SyntaxError: The requested module './lib/index.js' does not provide an export named 'capabilitiesFor'
```

Expected failure: the settings-section surface (host capabilitiesFor + RPC
supabase badges + client locale dictionary + ./supabase export) does not exist.

## Step 5 RED — CLI: supabase still refused as unimplemented (§9 flip)

```
$ node bin/selftest.provider-cli.mjs
AssertionError: supabase is implemented — no refusal message
  at bin/selftest.provider-cli.mjs:167:12
```

Expected failure: the new §9 expectations (real network truth, no "not
implemented") contradict the old refusal branch — exactly the behavior change.

## Step 5 GREEN

```
$ node bin/selftest.provider-cli.mjs
  ok supabase config: verify/export/diagnose report real network truth; typed config rejection; refusal guard kept
workspace-provider CLI: 10 checks green
```

## Steps 2+6 RED — smoke script missing

(filled below after the run)
