You are the FRESH WHOLE-PROGRAM REVIEWER for the arxa-studio closeout program (plan Step 7 of Task 17) — the final gate before branch finish. You had no part in any implementation. Review/adjudicate only: no fixes, no commits, no agents, no push/tag, never print secrets, never start the operator's Docker daemon/VM, never run authenticated/paid gates, canonical checkouts READ-ONLY, scratch state only.

## Inputs (all under /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout unless absolute)

- Plan: docs/superpowers/plans/2026-09-12-arxa-studio-closeout.md (final definition of done at the end)
- SDD ledger: .superpowers/sdd/2026-09-12-arxa-studio-closeout/progress.md — every ruling, deferred minor, parked item, escalated finding, per-task completion. YOUR ADJUDICATION LIST.
- Final inventory: docs/plans/open-work-inventory-2026-09-12.md (68 rows)
- Evidence matrix: docs/plans/closeout-evidence-2026-09-12.md
- Closeout doc: docs/plans/arxa-studio-closeout-2026-09-12.md
- Per-task reports: .superpowers/sdd/2026-09-12-arxa-studio-closeout/task-*-report.md (and *-review*.md) — consult as needed, don't read wholesale.

## Diffs (build yourself — controller is hook-blocked; keep reads targeted, this branch is large)

- STUDIO (cwd here): `git log --oneline 4d1b924..HEAD` (~36 commits), `git diff --stat 4d1b924..HEAD`, then per-area targeted `git diff -U5 4d1b924..HEAD -- <path>` — do NOT dump the whole diff; generated files (client.js regen) verified via the drift --check suites instead.
- ARXA (/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-closeout): `git log --oneline 5749402b..HEAD`, `--stat`; commit 27878bcb (92-file format sweep) via --stat + spot-reads only.

## Charge

1. **Final-matrix audit:** every one of the 68 rows — CLOSED rows carry a resolvable commit + evidence pointer (sample ≥10 across tasks incl. every CLOSED row claimed from visual evidence); DEFERRED rows carry a concrete trigger; EXTERNAL rows carry owner + verbatim prepared command. Zero ambiguous. Verify the T16 Part B legs are still EXTERNAL (operator declined authorization 2026-09-14 — nothing may have softened them to DONE).
2. **Parked-item adjudications (decide each, record rationale):**
   - `bin/.arxa-cell-launcher.mjs:210` seeds `danger-full-access` (T9 ruling parked HERE). Decide: flip to workspace-write via fix round, or accept-and-document (is the cell launcher a live shipped path? Is it in BIN_FILES/packed payload?). State which and why.
   - L1/L2 viewer-LSP chain dead on fresh boots (pre-existing at BASE 4d1b924) + fresh-session dock-dead (RIDE + condition honored) + AXS-063/064 (wp.info FIXED 7351ddf; what remains?) — verify each disposition names owner + trigger; accept or demand fix.
   - AXS-066: no plugin version D77-bumped despite branch behavior changes (artifact-viewer still 0.3.5 etc.). Decide: version-bump fix round before finish (first-pack hazard) or recorded trigger. Read what D77 actually demands in the repo's own docs before deciding.
   - `arxa gate --all` inherited debt (AXS-059) stays external — confirm no branch-caused component hid inside.
3. **Ledger sweep:** every "minor (deferred)" line and every "New finding:" line in the ledger gets one of: ACCEPTED-AS-IS (rationale), FOLLOW-UP-OWNED (existing row/owner — name it), or NEEDS-FIX-NOW (high/medium only; these must resolve in a fix round, deferral is not allowed per plan Step 7).
4. **Invariant spot-checks (run, don't reason):** (a) one full studio `npm test` — expect 130 suites ALL GREEN; (b) WIRE FREEZE: `git diff 3597a40..HEAD -- plugins/workspace-provider/lib/contract.js plugins/workspace-provider/lib/wire.js plugins/workspace-provider/lib/errors.js` → must be 0-diff (adjust to actual frozen filenames); (c) 2 focused suites of your choice from the riskiest areas (suggest: selftest.land-race.mjs, one sandbox suite); (d) `git status` both worktrees — only known residue (studio: `M package-lock.json` +2 environmental, `.cache/`; arxa: scratch only); (e) no remote ever moved: no `origin/closeout-2026-09-12` anywhere, no tags at HEADs.
5. **Definition-of-done read:** check the plan's "Final definition of done" clause by clause against the record; anything unmet = finding.
6. **Process-integrity sample:** pick 2 tasks at random and confirm their review→fix→re-review chain in the ledger is internally consistent with the commits.

RAM: one suite at a time, kill toolchains between. If npm test OOM-kills you, retry once; if it dies again, record the last review-clean run as evidence with a caveat.

## Output

Write .superpowers/sdd/2026-09-12-arxa-studio-closeout/whole-branch-review.md: program verdict (READY-TO-FINISH | NEEDS-FIXES), findings Critical/Important/Minor with file:line, the adjudication table (parked items + ledger sweep outcome counts), what you ran. Reply ONLY (under 15 lines): verdict; matrix audit one-liner; adjudication one-liners (cell-launcher, AXS-066, trio); findings by severity + which demand fix rounds; spot-check results; report path.
