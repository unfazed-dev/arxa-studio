# Task 12 review — Reconcile and finish the Flutter mobile deliverable

Fresh independent reviewer, 2026-09-14. No part in implementation. Review only — nothing fixed, committed, pushed, or tagged. Canonical checkouts untouched (read-only reasoning for gate--all; no heavy gate ran outside the arxa-closeout worktree).

## Verdicts

- **Spec compliance: ✅** (Steps 1–4, 6, 7, 10, 11 delivered and independently verified; Step 5/8 execution disclosed-deferred per rulings; Step 9's doc deliverable missing — Important finding 1)
- **Quality: Needs-fixes (doc-level only)** — two Important findings, both documentation/report accuracy; zero code defects found; every gate reproduced green exactly as reported.

## Packages audited

**Studio (pre-built package, verified against the live worktree):** `.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-12-review-package.txt` = range `2c74ab0..8e3bc01`. Independently confirmed: studio HEAD `8e3bc01`, branch `closeout-2026-09-12`, diff = `docs/plans/mobile-flutter-migration-spec.md` only, +23/−18 (matches package verbatim). Tree residue = the known pre-existing `M package-lock.json` + untracked `.cache/` — nothing else, before and after my `npm test` re-run. All twelve §a boxes checked `[x]` with dated (2026-09-14) closures and per-row evidence pointers to `arxa/mobile_flutter/evidence/parity-2026-09-14.md`; status banner honestly retains the external rows (AXS-018/019/031). Zero OTA rows in the spec (only the new banner's "dormant Shorebird extension point" mention) — dormant judgment's premise verified.

**Arxa (package built by me, from `/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-closeout`):**

- `git log --oneline fff96bee..HEAD` → **3 commits**, not 2: `27878bcb` (prior attempt's Step-1 hygiene: tall-format sweep of 92 files, sdk bound ^3.12.0, lint clears — disclosed in Part A report item (2)) + the expected `132f9003` + `458f97e8`.
- `git diff --stat fff96bee..HEAD` → 98 files, +4059/−1858 (the bulk is 27878bcb's format reflow; `132f9003` alone = 15 files +1261/−3 exactly as reported; `458f97e8` alone = 2 files +49/−28 exactly as reported).
- Full `-U10` diff dumped for the record at `.worktrees/arxa-studio-closeout/.cache/t12-arxa-review.diff` (11,834 lines).
- `git diff --check fff96bee..HEAD` → **exit 2, NOT clean**: `mobile_flutter/deploy/README.md:39: new blank line at EOF` (Minor finding 3).
- Worktree state after my gates: clean except untracked `.cache/` (scratch). Branch `closeout-2026-09-12`, HEAD `458f97e8`.
- **No push/tag/release:** no `origin/closeout-2026-09-12` ref exists (arxa or studio); remotes show only `origin/main`/`origin/HEAD` (+ studio's pre-existing `origin/bump/dsh-0.1.2-rc.1`); `git tag --points-at HEAD` empty both repos; studio is 8 commits ahead of origin/main, unpushed. No remote ref moved.
- Commit trailers: `Co-Authored-By: Claude Code <noreply@anthropic.com>` present on all three commits (both Part A/B commits verified).

## Checklist results

### 1. Spec compliance vs brief

- **CI frame (arxa-cicd):** `scripts/check.sh` = one-root, six areas (commits/pr-title/gates/mobile/mobile-signing/transport), green-by-absence, `arxa gate --all` wrapped not duplicated (exit 2 = skip contract). `ci.yml` = six job-per-area lanes, hosted Ubuntu, per-job `timeout-minutes`, `concurrency` + `cancel-in-progress`, flutter pinned 3.44.9 = `.fvmrc` SSOT. PR template = `[arxa-<skill>]` stage field + SSOT tag-map footer (13 tags, consistent across template/check.sh allowlist/decisions.md). `docs/ci/decisions.md` (dated 2026-09-14) records every brief-mandated decision: private monorepo, main trunk, hosted-Ubuntu mobile lanes (recorded exception to self-hosted-runners.md, with why), iOS on `[self-hosted, macOS, ARM64, arxa]`, per-job timeouts, concurrency cancellation (release lane deliberately not), gates = `arxa gate --all` + flutter format/analyze/test, deploy prepare-then-halt (HUMAN GATE 3), plus pr-title warn-not-fail, no paths filters, signing custody, OTA dormant. `setup.md` = runner recipe + branch-protection-after-first-green (`gh api` PUT with the six contexts). `explainer.html` = template contract honored (ONE doc, TWO readings via native checkbox, ZERO JavaScript; no unfilled template tokens — the one `{{`-ish grep hit is CSS `@page` braces). Template conformance cross-checked against `~/.claude/skills/arxa-cicd/references/generation-templates.md` markers (green-by-absence, one-root/check.sh, timeout-minutes, concurrency) and `ci-explainer.html` contract.
- **Release automation (arxa-deployer):** `mobile-release.yml` = prepare-then-halt, never uploads, disposable TEST-SIGNED keystore when secrets absent (stamped + checksummed), iOS unsigned archive + identity doctor on the self-hosted macOS labels, secrets presence-only never printed, `environment: mobile-release` custody. Fastlane trio: Appfile (ids only), Matchfile (env-supplied git URL), Fastfile (android beta=Play internal / production; ios beta=TestFlight / release=App Store; credential-presence `UI.user_error!` guards; export options carried in Fastfile; no checked-in secrets — secret scan over all new files: zero hits). Conforms to the deployer skill's HUMAN GATE 3 law.
- **Shorebird:** `shorebird.yaml` DORMANT (empty `app_id`), activation documented as operator action; spec OTA rows = zero (verified by grep — only the new banner mentions it).
- **Signing (Step 4):** `applicationId = "solutions.arxadigital.arxa.mobile"` unchanged; release signing from gitignored `android/key.properties` (gitignore line 12 verified) with all-four-inputs `releaseSigningReady` guard; clear `GradleException` on package/bundle Release tasks when inputs absent (execution-scoped — `gradle help`/debug unaffected); debug key no longer reachable from the release buildType (`getByName("debug")` gone — asserted by both the contract test and `check.sh mobile-signing`). iOS team `43GNRCGQXQ` + bundle id asserted against `project.pbxproj` by `check.sh mobile-signing` (ran green); `aps-environment: development` flip documented in Fastfile/decisions.
- **Studio checklist:** twelve boxes closed, dated 2026-09-14, each with parity-table row pointer; residuals honestly kept external (AXS-018/019/031).

### 2. WIP adjudication (lib/data→lib/services revert) — **CORRECT, independently verified**

- (a) Committed tree self-consistency: every `package:arxa_studio_mobile|arxa_kit_*` import of `data|services` paths resolves to an existing file ( exhaustive resolver run over mobile_flutter + kit); zero references anywhere to the moved destinations (`services/{approvals,conversation,tasks}/` — grep exit 1). Note: the dispatch's literal "zero committed files import lib/data" is unsatisfiable as worded (lib/data is the canonical restored layout); the meaningful invariant — nothing imports a WIP-only path — holds.
- (b) Migration spec: zero `lib/data`/`lib/services` rows (grep exit 1).
- (c) Part A artifacts: the only `lib/services` mentions in the parity table point at canonical files (`transport_service.dart`, `push_token_service.dart`) that exist; check.sh/workflows/README/docs never mention the refactor.
- (d) Transport sources byte-identical to `fff96bee`: `git diff fff96bee..HEAD -- kit/` = `kit/studio_transport/analysis_options.yaml` +4 ONLY.

### 3. Gates — independently re-run (RAM-disciplined, one at a time, toolchains killed between; GRADLE_USER_HOME/CARGO_TARGET_DIR in worktree `.cache/`; `build/ios/SourcePackages` mkdir applied per Task 1 lore)

| Gate | Result | Report claim |
|---|---|---|
| `fvm flutter analyze` | exit 0, "No issues found!" | ✅ matches |
| contract test focused | **4/4**, all four brief demands asserted & passing | ✅ matches |
| `fvm flutter test` (full) | exit 0, **+108 All tests passed!**, contract test present in-suite log | ✅ matches (104 Task-1 baseline + 4 contract) |
| kit dart tests | exit 0, **+7 All tests passed!** | ✅ matches |
| `cargo test --lib` | **11 passed; 0 failed** | ✅ matches |
| actionlint ×4 (ci, mobile-release, desktop-gate, desktop-release) | all exit 0 clean; `sh -n` OK; `ruby -c` OK ×3 | ✅ — **3-vs-4 reconciled**: Part A's run covered the workflows it created/touched; Part B extended to all four incl. the pre-existing desktop pair. 4/4 is the true current state. |
| `bash scripts/check.sh` (end-to-end, once) | exit 1; commits ok · pr-title skip (by design) · **gates FAIL (inherited)** · mobile ok · mobile-signing ok · transport ok (dart+rust) — RED only at gates | ✅ matches exactly |
| studio `npm test` (once) | **exit 0, "arxa-studio CI: ALL GREEN", 130 suites, zero fail-string matches** | ✅ matches |

### 4. `arxa gate --all` exit 1 — classification: **INHERITED, pre-branch, external. Not branch-caused.**

Reproduced inside check.sh: "8 passed, 4 failed, 2 skipped". Failing taxonomy identical to the report:

- `intake` FAIL 42 — studio registry↔brief surface drift (orphan answers `projects.home`/`projects.new`; unanswered surfaces `app.*`, `build.*`, `design.*`, `intake.*`…) — studio-design inputs, untouched by this branch.
- `coverage` FAIL 1 — design producer input missing — untouched.
- `advertise` FAIL — tier-suite digest drift on `arxa/lib/tier1.dart` + `arxa/lib/deploy.dart` ("re-run the suite to re-record"). Both files untouched by `fff96bee..HEAD`; the H7 rename `73bae180` ("engine and all surfaces renamed to arxa") **is an ancestor of the dispatched base `fff96bee`** (merge-base verified) — the stale-since-pre-branch claim is arithmetically sound.
- `deploy` FAIL 2 — `approvalTokens.deploy` version/account unconfirmed = the deliberate human release gate.
- `review`/`lens` — env/not-applicable skips surfaced as non-pass.

(a) Zero failing rows are mobile/CI-frame rows — none reference mobile_flutter, the CI frame files, or anything in the branch diff. (b) Branch-diff ∩ gate inputs = ∅ (the only regex hits were the CI workflows themselves, which merely mention checksums). Reported-not-fixed is the right call under Ruling 10 + brief scope.

### 5. Part B commit `458f97e8`

Diff = exactly two files: dart-format reflow of `android_release_signing_contract_test.dart` (53→70 lines) + flutter-recorded analyzer excludes in `kit/studio_transport/analysis_options.yaml` (+4). **`pubspec.lock` untouched between `132f9003` and `458f97e8`** (empty diff) — the "re-pin did not recur" claim verified. Kit lock also untouched vs base (see 2d).

### 6. Commit discipline

Trailers present on both (all three) arxa commits. No push (no `origin/closeout-2026-09-12` anywhere; studio 8-ahead unpushed), no tags at either HEAD, no release. Studio Part B = report append only, uncommitted, per SDD convention.

### 7. Report accuracy

Every reproduced claim matched: suite counts (108 / 7 / 11 / 130), "green" wording, check.sh area-by-area outcome, gate--all taxonomy, WIP-revert completeness, lock stability, actionlint cleanliness, no-push. Two accuracy gaps found → findings 1 and 2 below. Part A disclosure (2) — worktree HEAD `27878bcb` above dispatched base — explains the third commit in range; harmless but reviewers building packages from `fff96bee` should expect it.

## Findings

**Critical: 0**

**Important: 2**

1. **Brief Step 9 deliverable missing and undisclosed.** `mobile_flutter/deploy/physical-gates.md` does not exist (only `README.md` in `deploy/`; repo-wide find for `*physical*` = none). The brief's Step 9 ("Write `mobile_flutter/deploy/physical-gates.md` with exact iPhone/APNs and Android/FCM/APK commands and redaction rules. Execute only if…") makes the *writing* unconditional — only execution is device-gated. Part A's own "Part B must run" list includes "Step 9 `deploy/physical-gates.md`"; Part B claims "Status — complete" and its concerns list discloses Steps 5/8/self-test/branch-protection but **silently drops Step 9**. `deploy/README.md:37-38` dangles on it ("a separate step writes `physical-gates.md`…"). Fix: write the doc (or record an explicit dated deferral in report + ledger).
2. **Phantom evidence citation in a committed test.** `mobile_flutter/test/android_release_signing_contract_test.dart` (header comment, the "see evidence/release-smoke-2026-09-14.md" line) cites a **nonexistent** file as the place the live signing behavior "is exercised by the release smoke" — dated as if produced. `evidence/` contains only `lens-smoke-2026-08-29/` and `parity-2026-09-14.md`; Part B explicitly did not run the Step 8 smoke (disclosed). Contradicts the honest "smoke pending" markers in parity row 12 and spec box 12. Fix: reword to name the smoke as pending (Part B follow-up / Task 16) or create the file when the smoke actually runs.

**Minor: 3**

3. `mobile_flutter/deploy/README.md:39` — trailing blank line at EOF; the only `git diff --check` hit in `fff96bee..HEAD` (exit 2). One-line fix.
4. `.github/workflows/mobile-release.yml` (android-release "Signing inputs" step) — disposable test-only keystore dname hardcodes `C=AU`. Ruling 11 (no Australia/Mauritius specifics) was aimed at product behavior and this cert is workspace-destroyed test material, but it is a committed AU-specific; controller may want it neutralized (`C=XX`/omitted).
5. `mobile_flutter/fastlane/Fastfile` ios `doctor` lane — variable `match_cert_count` counts provisioning profiles (message text is correct; only the name lies). Cosmetic.

## What I ran vs reasoned

Ran (arxa-closeout worktree + studio worktree): all gates in the table above, plus the import-resolver, greps, per-commit stat/lock diffs, tag/remote-ref checks, secret scan, template-marker checks, post-gate cleanliness checks. Reasoned read-only (per instructions): gate--all inheritance (input-intersection + ancestor check, no heavy gate against canonical checkouts); skill-template conformance (marker-level, not line-diffed — deployer skill carries its shapes in SKILL.md/DEPLOYER_playbook.mdx, both consistent with the shipped lanes).

Ledger note: the ledger records rulings unnumbered; "Ruling 10/11" as cited in the dispatch correspond in substance to the Task 1 Step 4 mobile-audit rows (migration presumed implemented — honored: nothing rebuilt, only signing/CI/release rows added) and the no-AU/MU-specifics rule (honored in product code; see minor 4 for the one borderline committed artifact).
