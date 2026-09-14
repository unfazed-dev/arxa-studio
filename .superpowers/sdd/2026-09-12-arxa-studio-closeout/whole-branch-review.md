# Whole-branch review — arxa-studio closeout program (plan Step 7, Task 17)

Reviewer: fresh whole-program reviewer (no part in any implementation). Date 2026-09-14.
Scope: studio `4d1b924..02260f5` (28 commits, 231 files, +16816/−308) and arxa `5749402b..3b6e08ea` (6 commits) + 27878bcb spot-reads. Review/adjudicate only: no fixes, no commits, no agents, no authenticated/paid gates, canonical checkouts untouched.

## Program verdict: **READY-TO-FINISH**

No Critical findings. No Important findings. Four Minor findings (documentation-level); none demand a fix round — all may ride the finish commit if convenient. Every high/medium ledger finding is resolved in-branch, externally owned with verbatim command, or adjudicated below with owner + trigger.

## 1. Final-matrix audit (68 rows)

Row count verified programmatically: 68 total = 14 CLOSED program (AXS-001–014) + 19 CLOSED pre-program (AXS-033–051) + **18 EXTERNAL** + 17 DEFERRED.

- **CLOSED (33):** every cited commit resolved via `git cat-file -e <sha>^{commit}` in the owning repo — **two exceptions, see Minor F1/F2** (`m6ed5e27` in AXS-034, `3077863` in AXS-041; both also absent from the arxa repo). Both rows carry other resolvable commits + live evidence (d92a418; 9119642/fd6c137; suites green in my fresh run). Sampled far more than 10 rows; every visual-evidence CLOSED row verified on disk: AXS-006/AXS-007 → `designs/evidence/studio-closeout/{390,744,1280}` = 19/24/30 PNGs + `narrow-capture-logs/` pair logs; AXS-014 → arxa tree artifacts + fff96bee.
- **DEFERRED (17):** every row carries a concrete trigger (verified line-by-line; e.g. AXS-052 D23 demand-signal, AXS-054 first src-tauri channel-read change, AXS-060/061 idle-machine RAM window with verbatim commands, AXS-066 first release/pack).
- **EXTERNAL (18):** every row names owner + verbatim prepared command or trigger. Zero ambiguity.
- **T16 Part B legs NOT softened:** matrix DONE rows are scratch/adjudication only (G3a, G5a, G7, G12b, G13, E1, E2, E3). Every authenticated/physical/operator leg remains PREPARED or EXTERNAL (G1, G2, G4, G5, G6, G8 PREPARED; G3, G9, G10, G11 EXTERNAL), matching the operator's 2026-09-14 declined authorization. Their inventory twins (AXS-015/016/017/018/019/053/055/056/057/058) are all EXTERNAL.

## 2. Parked-item adjudications

| Item | Ruling | Rationale |
|---|---|---|
| **AXS-062** cell launcher seeds `danger-full-access` (`bin/.arxa-cell-launcher.mjs:210`) | **ACCEPT-AND-DOCUMENT** (keep EXTERNAL row + trigger; no fix round) | Not a live shipped path: absent from `BIN_FILES` (`scripts/pack-manifest.mjs:48` lists 5 files, no cell launcher), zero references anywhere in `bin/ scripts/ plugins/` (grep), untouched by the branch (`git log 4d1b924..HEAD -- <file>` empty). Not in the packed payload → no shipping hazard. Trigger stands: next launcher/cell touch routes through `bin/seed-settings.mjs` `seedPermissionPreset`, or delete the dead variant. |
| **AXS-063** (T16 E1) L1/L2 viewer-LSP dead on fresh boots | **ACCEPT** — pre-existing defect, owner + trigger recorded | I byte-verified the claim myself: `git show 4d1b924:plugins/artifact-viewer/lib/index.js` lines ~181–191 carry the `lsp`-scope `selectedOpenRoot` 403 verbatim, identical at HEAD. Fixing it is product work outside closeout scope. Owner (artifact-viewer owner) + trigger (any fresh scratch boot) named in the row; honest limitation rows + env-coupled marking stand. |
| **AXS-064** (T16 E2) fresh-session dock dead | **ACCEPT** — RIDE-honored limitation, owners + trigger recorded | Reproduced at HEAD with a probe chain localizing past every T8-owned layer (create→bind→composer ✓, `conversation.input.dock` never renders); counter-evidence (operator's installed studio mounts docks daily) recorded; FAILURE-STATE rows kept honest. Owners (arxa-git-card + dsh conversation-input) + trigger named. Demanding a fix here = new product work at the finish gate on code the branch only touched with `t()` literals. |
| **E3 / wp.info residue (AXS-063/064 companion)** | **RESOLVED** | Fixed in-branch `7351ddf` (dsh result envelope; RED-first re-pin); my wire-freeze check (0-diff vs 3597a40) and 130/130 fresh run confirm nothing regressed. Limitation/external rows withdrawn. What remains of the trio = exactly AXS-063 + AXS-064 above. |
| **AXS-066** no D77 plugin version bumps | **RECORDED TRIGGER SUFFICIENT — no pre-finish bump** | Read D77 in-repo (`docs/plans/arxa-studio-grill-decisions.md:819-825`): the lesson is "bump the plugin version on every **shipped** plugin change" because pnpm may not re-copy an unchanged version string. Nothing has shipped or packed: no tags exist (verified), releases are operator-gated (AXS-019/053), and the first-pack hazard cannot fire before a pack exists. Bumping now would widen the finish-gate diff and age before the real pack. The AXS-066 trigger is exactly right: first release/pack of this branch bumps every touched plugin + re-runs `npm test` + pack checks (owner: release owner). |
| **AXS-059** `arxa gate --all` inherited debt | **CONFIRMED external; no branch-caused component** | Branch-changed arxa areas: mobile_flutter (91 files), .github (5), docs (4), desktop (3), scripts (1), kit (1). Gate-debt areas (intake/coverage studio-design drift, advertise digests stale since pre-branch 73bae180, deploy approvalTokens) are disjoint from all of them; T12's "branch diff ∩ gate inputs = ∅" verified at area level; T17's check.sh run red only at `gates`. Stays EXTERNAL, owner arxa maintainers. |

## 3. Ledger sweep — 41 "minor (deferred)" lines (~60 items incl. ×6/×3 aggregates) + 45 "New finding" entries

Disposition of every line: **NEEDS-FIX-NOW: 0** (no high/medium remains unresolved). Breakdown:

- **RESOLVED in-branch (verified):** T13 engine-boot fiveLibs break (fixed `4cc0380`; `engine-boot-smoke` GREEN in my fresh run) · E3 wp.info (fixed `7351ddf`) · SBX_PIN unmeasured (T16 G3a DONE, digests in matrix §G3-notes) · T16's three minors (fix round 1: json pointer, artifact paths, lockfile) · T17's ID-collision finding (fixed in-task) · T12's PHASE=phone gap (T16 delivered).
- **FOLLOW-UP-OWNED (existing row named):** T6 quota blocker/high → AXS-055 (external, verbatim command) · T7 emulated-viewport sheet (medium; ladder resolved by d1771af controls; person-driven legs → AXS-068) · T15 installer-channel → AXS-054 · T15 beta-lane spctl skip → AXS-053 backstop · T10 row.head watch → AXS-056/G2 · tree-404 mask → G13 keep-decision (DONE) · sbx field-shape → AXS-015 · Supabase `status -o env` key names → AXS-057.
- **ACCEPTED-AS-IS (rationale):** all remaining low-severity minors/info — each is disclosed, fail-closed, cosmetic, or pinned by a test; they are recorded in this ledger with their own follow-up paths, which is what the program requires of lows. One called out for attention: T14's member-gated org DELETE (lowest-role member can cascade-delete) — accepted because the migration has never been applied to any database outside disposable local stacks and no studio user gets a database (program law), but the **AXS-057 first real-stack leg must verify that DELETE policy** before any user DB exists.

## 4. Invariant spot-checks (all run fresh by me, 2026-09-14)

| check | result |
|---|---|
| (a) studio `npm test` (full, twice) | **exit 0, `arxa-studio CI: ALL GREEN`, 130 GREEN / 0 RED**, `engine-boot-smoke` GREEN — first run captured green tail but not exit code (pipestatus quirk), second run captured both; no OOM |
| (b) WIRE FREEZE `git diff 3597a40..HEAD -- plugins/workspace-provider/lib/{contract,wire,errors}.js` | **0 lines** (byte-identical) |
| (c) focused suites | `selftest.land-race.mjs`: **GREEN, 12 checks, exit 0** · `selftest.devcontainer.mjs`: **39 green + 1 honest skip, exit 0** |
| (d) `git status` both worktrees | studio: `?? .cache/` only · arxa: `?? .cache/` only — subset of known residue (the T1 environmental `M package-lock.json` was properly reverted; lockfile now matches BASE, verified 0-diff) |
| (e) remotes/tags | no `origin/closeout-2026-09-12` in either repo; **no tags at either HEAD**; only pre-existing unrelated remote branches (`origin/bump/dsh-0.1.2-rc.1`) |
| commits resolve | 46 studio + 8 arxa cited SHAs checked; all resolve except the two in F1/F2 |

## 5. Definition-of-done clause check (plan :513-527)

All 14 clauses met. Clause notes: full-suite clause — studio proven by my fresh run; arxa mobile/desktop full suites rest on the controller's per-path acceptance ruling (no `arxa/lib`, `mobile_flutter/lib`, or kit Dart source moved after the review-clean runs; only commit after 5930302d is 3b6e08ea touching one doc — `git show --name-status` verified by T17, consistent with my diffstat area counts). Vocabulary clause — `supersededBy` grep at `3b6e08ea` in the arxa worktree: zero matches (re-verified); AXS-032 not-accepted stands. "No unresolved high/medium" — satisfied by §2/§3 dispositions.

## 6. Process-integrity sample (2 tasks, chosen at random: T10, T14)

Both chains internally consistent with the commits: T10 review NEEDS FIXES (1C/5I) → fix `f35389b` touches exactly `devcontainer.js`/`project-database.js` + their selftests (stat verified) → re-review clean. T14 review Needs-fixes (2I) → fix `ce5e82e` touches exactly `supabase.js`/`selftest.supabase.mjs`/smoke script → re-review clean, wire freeze held. Ledger claims match commit contents.

## 7. Findings

**Critical:** none. **Important:** none.

**Minor** (none demands a fix round; F1–F3 may ride the finish commit):

- **F1** `docs/plans/open-work-inventory-2026-09-12.md:51` (AXS-034): cites `m6ed5e27` — unresolvable in both repos (`git cat-file` fatal). Row is not ambiguous (d92a418 + live suites hold) but the citation is broken.
- **F2** `docs/plans/open-work-inventory-2026-09-12.md:58` (AXS-041): cites `3077863` — unresolvable in both repos. Same class; 9119642/fd6c137 resolve.
- **F3** `docs/plans/arxa-studio-closeout-2026-09-12.md:16` and ledger `progress.md:389`: claim "EXTERNAL **14**"; actual EXTERNAL rows = **18** (14+18+17=68; the stated counts sum to 64). Operative matrix table is correct; the prose count is wrong.
- **F4** `docs/plans/arxa-studio-closeout-2026-09-12.md:28`: "25 commits" for `4d1b924..902551d`; actual 27 (`git rev-list --count`), 28 to HEAD.
- **F5 (recommendation, not a defect)** T14 ledger minor "member-gated org DELETE" has no inventory row; see §3 — fold its verification into the AXS-057 leg's checklist when that authorized run happens.

## 8. What I ran

`git log/diff --stat 4d1b924..HEAD` (studio), `5749402b..HEAD` + `27878bcb --stat` (arxa); `git status --porcelain` both; remote/tag checks both; full matrix read + row counts; `git cat-file -e` on 54 cited SHAs across both repos; wire-freeze diff vs `3597a40`; `git show` BASE-vs-HEAD viewer LSP block; BIN_FILES/cell-launcher greps; D77 source read; supersededBy grep at `3b6e08ea`; evidence-dir PNG counts (390/744/1280 = 19/24/30) + mobile evidence dir; `npm test` full ×2; `selftest.land-race.mjs`; `selftest.devcontainer.mjs`; ledger/DoD/inventory/closeout-doc full reads; fix-round commit stats (f35389b, ce5e82e).
