You are fixing the narrow-lane capture path for Task 8 (arxa-studio closeout). Work in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout (git worktree, branch closeout-2026-09-12, HEAD f5e90d4). BOUNDED scope — do exactly this, nothing more.

## Current state (just reproduced by the controller)

`node scripts/evidence-capture-narrow.mjs` boots the studio fine now (a leftover T7 studio held port 7897; killed), but EVERY gate run exits 1 with the identical message `EVIDENCE FAIL: settings dialog never showed the Personalisation nav` — even surfaces unrelated to settings (finish, sweep, langstrip). The narrow-lane diff inside `scripts/evidence-gate.mjs` (committed in f5e90d4 from a killed worker's WIP) apparently runs a settings-dialog prelude for every surface, and that prelude fails to mount the sheet at narrow widths — the same class of failure Task 7 hit ("sheet won't mount on emulated resize").

## Your job

1. Read `scripts/evidence-gate.mjs`'s narrow lane. Make the settings prelude run ONLY for surfaces that need it (personalisation; anything else that genuinely opens settings). Every other surface must capture WITHOUT any settings interaction.
2. Diagnose the Personalisation dialog at 390 and 744: can the settings sheet mount at all at those widths? (Try the REAL mount paths: the sidebar rail trigger, header/settings affordances — read the product code for the actual dialog mechanics; the T8B WIP added a "rail trigger" that apparently doesn't work.) If it mounts: capture personalisation light+dark at both widths. If it genuinely cannot mount at a width in this product (e.g. the dialog is desktop-width-gated by design), record a structured limitation row (surface, width, product evidence file:line) — a named, reproduced limitation is acceptable evidence per program precedent; do NOT fake or stretch a shot.
3. Fix the summary-table crash in `scripts/evidence-capture-narrow.mjs` (line ~316, `.padEnd` on undefined when a run result is error-shaped).
4. Re-run `node scripts/evidence-capture-narrow.mjs` END-TO-END once. Expect: boot OK; each non-settings surface captured (or an honest failure row with a per-surface DISTINCT reason); personalisation captured or limitation rows; summary table prints; exit code per the script's contract (nonzero only if a 1280-proven surface hard-fails for a NON-limitation reason).
5. RAM discipline: the script already runs one browser per surface sequentially — keep it that way; do not run npm test; you may run `node --check` and the script itself. If the full ladder run takes >25 min, that is fine — let it finish.
6. Commit everything (script fixes + evidence PNGs + logs + updated task-8-report.md `## Part B — narrow ladder results` section with the file inventory and any limitation rows) as: `docs: complete the narrow-width evidence ladder` (blank line, trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`). `package-lock.json` dirt stays out.

## Constraints (binding)

Scratch state only (the script handles this); never print tokens (redact any boot URL token in logs); no push/merge/tag; no subagents ever; NO product-code changes (if the diagnosis finds a product bug blocking mount, record it as a New finding in the ledger and capture the limitation row — do not fix product code in this dispatch); one browser at a time; findings → ledger append.

## Report back ONLY (under 12 lines)

Status; commit; ladder result one-liner (ok/limitation/fail counts per width); personalisation outcome (captured at which widths / limitation evidence); concerns.
