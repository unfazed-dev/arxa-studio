You are implementing Task 16 PART A — ATTEMPT 2. Attempt 1 was OOM-killed mid-task; its uncommitted WIP is yours to inherit, verify, and complete. Requirements doc (read FIRST): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-16-brief.md. Original dispatch notes also apply: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-16-dispatch.md (brief-notes + report contract sections).

## Inherited WIP (studio worktree, uncommitted — judge it, then complete)

- `docs/plans/closeout-evidence-2026-09-12.md` — matrix G1–G13 largely built (G3a SBX_PIN measurement DONE, G5a skill-pack policy test DONE; §G7-notes / §Escalated sections referenced but likely unwritten). VERIFY every claimed-DONE row against reality; finish missing sections/rows.
- `plugins/sandbox/lib/sbx-install.js` + `selftest.sbx-install.mjs` (M) — SBX_PIN filled with measured v0.42.1 checksums. Verify pins match the matrix §G3-notes evidence, run the selftest (11 checks expected green incl. fail-closed pin rows), keep.
- `plugins/claude-code/selftest.skill-packs.mjs` (M) — bundled-root-empty policy row (G5a). Verify it runs green (asserting the bundled skill-pack set IS empty), keep.
- `designs/evidence/studio-closeout-2026-09-12/` — new evidence dir; keep what's real.
- Arxa worktree: `mobile_flutter/deploy/evidence/closeout-2026-09-12/` dir created; physical-gates.md at 5930302d.

## ORDER (heavy-first — the OOM driver is the browser probe + toolchains; do heavies while RAM is freshest)

1. **FIRST: the single dock-dead fresh-boot probe** (deliverable 5, headless CDP, scratch ARXA_HOME, free port, 480 s budget) + the L1/L2 viewer LSP-chain probe and L3 wp.info probe — one boot can serve all three if the driver supports it; else sequential single-Chrome pairs. Record close-or-keep verdicts into §Escalated.
2. Run/verify the two inherited selftests (sbx-install, skill-packs) — light.
3. Finish matrix sections (§G7-notes, §Escalated, G9–G13 rows), physical-gates.md PHASE=phone gap + line-cite drift, G13 decision row.
4. One full studio `npm test` (expect 130 suites ALL GREEN + your new/modified suites green).
5. **G12 (simulator smoke + release-automation legs) — ONLY if `memory_pressure` reports the system not critical and nothing else heavy ran in the last minutes; else PREPARED rows with exact commands.** Two OOM kills today say: default to PREPARED.
6. Ledger any new findings; commit(s) per brief deliverable 7 (matrix + prep under `test: record authenticated and physical closeout evidence`; product fixes separate). Trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## Law (unchanged, binding)

Never run authenticated/paid/credential-bearing/operator-state-mutating gates. Never start the operator's Docker daemon/VM. Never push/merge/tag/publish. Never print secrets/tokens/.env values. Canonical checkouts read-only. Scratch ARXA_HOME only. No subagents. RAM: one thing at a time, kill toolchains/Chrome between.

## Report

Full report → .superpowers/sdd/2026-09-12-arxa-studio-closeout/task-16-report.md (## Part A). Reply ONLY (under 15 lines): status; adjudication one-liners (L1/L2, dock-dead, L3); WIP verdict one-liner; scratch-safe legs run (incl. G12 verdict); matrix counts DONE/PREPARED/EXTERNAL; commits (repo+SHA+subject); authorization request list (gate ids, one-line cost/mutation each); concerns.
