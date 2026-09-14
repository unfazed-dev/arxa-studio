You are FINISHING the no-browser half of Task 8 (locale + visual acceptance; arxa-studio closeout, wave 5). Three prior implementers were OOM-killed on this RAM-constrained machine; you inherit their WIP and complete everything EXCEPT narrow-width evidence captures (a separate later dispatch owns 390/744 captures — do NOT launch any browser).

Work in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout (git worktree, branch closeout-2026-09-12, BASE ce5e82e).

## Inherited WIP (inspect, verify, own it)

- `plugins/locale/selftest.parity.mjs` (new, untracked) — the Step 1 parity test.
- `plugins/personalisation/lib/client.js`, `plugins/theme-accent/lib/client.js` (modified) — locale dictionary changes.
- `scripts/evidence-gate.mjs` (new, untracked) — the in-repo console-error gate driver (a Task 7 review condition; verify it carries a named, justified filter list).
- `designs/evidence/studio-closeout/1280/` — 6 NEW PNGs (gitcard light/dark, personalisation-tab light/dark, sweep-modal light/dark, carddump) beside the Task 7 set.
- Pre-existing `package-lock.json` dirt — leave out of commits.

## Your scope

1. Read the brief: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-8-brief.md — Steps 1–2 (parity test RED→GREEN, translations en/pl/fr for the full Personalisation tab + every surface touched by Tasks 2–14), and the no-browser parts of Steps 5–6.
2. Verify the parity test runs and is green (re-verify RED honestly in your report via git-show of BASE dictionaries if needed — scratch copy, never alter the worktree).
3. Sweep for missed keys: every user-facing key added by T2–T14 across arxa-sidebar, arxa-git-card, sandbox, workspace-provider, artifact-viewer, personalisation, theme-accent — en source set, pl/fr complete; preserve product terms (CONTEXT.md); never translate IDs/paths/branch names/model IDs/commands.
4. Commit the coherent no-browser state: parity test + dictionaries + `scripts/evidence-gate.mjs` + the 6 new 1280 PNGs. Commit message: `feat: complete studio locale and visual acceptance` (blank line, trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`) — the capture-only follow-up will land as a second commit `docs: complete the narrow-width evidence ladder` (controller ruling; the plan's single message splits across the two dispatches).
5. Run the locale/plugin suites named by the brief + `npm test` ONCE (exit 0, ALL GREEN, record suite count). One suite at a time; NO browser launches; kill nothing.

## Constraints (binding)

Same Global Constraints as the original task-8 dispatch: dsh primitives + --dsw-* tokens; every user-facing key in en/pl/fr; scratch ARXA_HOME only; never print secrets; never push/merge/tag; no subagents ever; if a hook refuses a compound command, split it. New findings → ledger append only (.superpowers/sdd/2026-09-12-arxa-studio-closeout/progress.md).

## Report

Write your full report to:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-8-report.md
covering: parity-test verification (RED evidence method), keys added per plugin, evidence-gate driver contents + filter justification, files changed, self-review, concerns; explicitly listing what remains for the capture dispatch (390/744 surfaces incl. viewer ladder — the Task 7 condition).

Then report back with ONLY (under 12 lines): Status (DONE/DONE_WITH_CONCERNS/BLOCKED/NEEDS_CONTEXT); commit (short SHA + subject); one-line test summary (locale suites + npm test + suite count); keys-added one-liner; concerns; report path. Never silently produce work you are unsure about.
