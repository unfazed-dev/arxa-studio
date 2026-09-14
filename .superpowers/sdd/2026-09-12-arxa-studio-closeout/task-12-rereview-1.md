# Task 12 — re-review, fix round 1

Reviewer: fresh scoped re-reviewer, 2026-09-14. Scope: exactly commit `5930302d`
(`fix: close the mobile release documentation gaps`) in worktree `arxa-closeout`,
branch `closeout-2026-09-12`, base `458f97e8`. Review only — no fixes, no commits,
no push/tag.

## Package integrity (rebuilt from scratch)

- `git log --oneline 458f97e8..HEAD` → exactly `5930302d` (single commit) ✓
- `git diff 458f97e8..HEAD --stat` → 5 files, +126/−8 — exactly the five files
  from the findings, nothing else changed ✓
- `git diff 458f97e8..HEAD --check` → clean ✓
- `git status --porcelain` → only untracked `.cache/` (scratch) ✓
- `git tag --points-at HEAD` → none ✓
- Commit message ends `Co-Authored-By: Claude Code <noreply@anthropic.com>` ✓

## Verdict per finding

### Important 1 — missing `mobile_flutter/deploy/physical-gates.md` → ADDRESSED

File exists (117 lines, new). Verified content against every criterion:

- Execution-gated banner at top (physical devices + credentials, owner Task 16) ✓
- Device prereqs: iOS/APNs (physical iPhone, `devicectl`/`flutter devices`, team
  `43GNRCGQXQ` dev profile, `security cms -D` aps-environment check, fastlane
  `ios doctor` presence-only) and Android/FCM (Play-services device, `adb devices`,
  bring-your-own `google-services.json`, never committed) ✓
- Harness: real pairhost/iroh route — `cargo run --example pairhost` (LAN default),
  `ARXA_PAIRHOST_RELAY=1` (cellular/relay), single-use ticket re-mint,
  `python3 -m http.server 8899` ticket server ✓
- Per-leg table: pair, reconnect (airplane mode + `CELLULAR`), push registration,
  notification presentation + tap-through, approval decision, conversation send,
  unpair/revocation ✓
- `approvals_e2e_test.dart` invocation shapes: `PHASE=smoke|e2e|pressure`,
  `TICKET_URL` vs `PAIR_TICKET` ✓
- APK leg: `flutter build apk --release` + `adb install -r` + logcat tee ✓
- Redaction rules: sed strips `arxa-pair:` tickets, 64-hex tokens, UDID pattern;
  presence-only credential checks; no QR payload in screenshots ✓

Cross-references verified against the tree (no phantom commands introduced):
`desktop/src-tauri/examples/pairhost.rs` exists with matching `ARXA_PAIRHOST_RELAY`
semantics and `TICKET <arxa-pair:...>` boot print + stdin re-mint;
`evidence/lens-smoke-2026-08-29/` exists; `approvals_e2e_test.dart:312`/`:316+`
citations land inside the reconnect/push blocks; env-var names match the test's
actual `String.fromEnvironment` reads.

### Important 2 — phantom `evidence/release-smoke-2026-09-14.md` citation → ADDRESSED

Contract-test header now names the live signing smoke as PENDING — external,
credential-gated, owned by Task 16, contract test named as the interim guard.
Repo-wide grep for `release-smoke-2026-09-14`: zero hits. Comment-only change. ✓

### Minor 3 — `deploy/README.md:39` EOF blank line → ADDRESSED

`od` on the last bytes: file ends `(Task 16).\n` — single trailing newline, no
blank line. The same edit replaced the dangling "a separate step writes
physical-gates.md" line with a real pointer + device-gated note. ✓

### Minor 4 — `C=AU` dname in `.github/workflows/mobile-release.yml` → ADDRESSED

Line 76 now `-dname "CN=arxa disposable test,O=Arxa Digital Solutions"` — no AU
component. ✓

### Minor 5 — `match_cert_count` misnomer in Fastfile → ADDRESSED

Renamed `provisioning_profile_count` (accurate: counts `*.mobileprovision` files);
message text unchanged (was already correct). Repo-wide grep for
`match_cert_count`: zero hits. ✓

## Regressions / new findings

None blocking. One new **Minor** observation for a future round (not a fix-round
failure — outside the five findings' scope, surfaced by cross-checking the doc
against the test): `integration_test/approvals_e2e_test.dart` has a fourth phase,
`PHASE=phone` (line ~269: "the one thing no simulator can prove" — real APNs
doorbell leg), gated on engine env `ARXA_DOORBELL_PUSH=true`,
`ARXA_APPROVALS_TEST_SEAM=true`, a real pushd holding the operator's `.p8`, and
`CAIRN_APNS_SANDBOX=1`. `physical-gates.md` lists only smoke/e2e/pressure
(mirroring the test's own header docstring, which also omits it) and its
notification leg says "raise an approval engine-side" generically. Suggest adding
the phone phase + those env vars to the doc when Task 16 picks it up.

## Verification (run fresh by this reviewer, one toolchain at a time)

Pre-step: `mkdir -p mobile_flutter/build/ios/SourcePackages`.

- `fvm flutter analyze` (mobile_flutter) → `No issues found! (ran in 5.2s)`
- `fvm flutter test test/android_release_signing_contract_test.dart` → `+4: All tests passed!` (4/4)
- `actionlint .github/workflows/mobile-release.yml` → clean (exit 0)
- `ruby -c mobile_flutter/fastlane/Fastfile` → `Syntax OK`

## Verdict

**ALL-ADDRESSED (5/5).** No regressions. Suite green. One new minor doc-completeness
note (`PHASE=phone` leg) deferred to Task 16.
