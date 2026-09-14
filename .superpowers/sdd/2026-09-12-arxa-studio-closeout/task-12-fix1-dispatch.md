You are the implementer for Task 12 FIX ROUND 1 (doc-only, five small fixes from the task review). Work in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-closeout (branch closeout-2026-09-12, HEAD 458f97e8). Review: .superpowers/sdd/2026-09-12-arxa-studio-closeout/task-12-review.md (findings section). Report: append `## Fix round 1` to .superpowers/sdd/2026-09-12-arxa-studio-closeout/task-12-report.md.

No subagents. No push/tag/release. Never print secrets. Canonical checkouts read-only.

## Fixes (all five)

1. **Important 1 — create `mobile_flutter/deploy/physical-gates.md`.** The T12 brief Step 9 made WRITING it unconditional (only execution is device-gated); deploy/README.md:37-38 dangles on it. Content: physical-device prerequisites (iPhone + Apple ID/APNs entitlement state checks, Android device + FCM config), EXACT commands for each leg — pair via real pairhost/iroh route, reconnect, push registration, notification presentation + tap-through, approval decision, conversation send, unpair/revocation — plus `mobile_flutter/integration_test/approvals_e2e_test.dart` invocation shapes, iOS/APNs and Android/FCM/APK legs, evidence capture + redaction rules (no tokens/device ids in logs), and an explicit "execution gated on devices + credentials; owner: Task 16" banner. Point at deploy/README.md where it already covers ground instead of duplicating.
2. **Important 2 — phantom citation.** `mobile_flutter/test/android_release_signing_contract_test.dart` header cites nonexistent `evidence/release-smoke-2026-09-14.md` as if produced. Reword: the live signing smoke is PENDING (external, Task 16); the contract test pins the static contract meanwhile. Comment-only edit.
3. **Minor 3 — EOF blank line.** `mobile_flutter/deploy/README.md:39` trailing blank line (the range's only `git diff --check` hit). Remove.
4. **Minor 4 — neutralize `C=AU`.** `.github/workflows/mobile-release.yml` android-release signing-inputs step hardcodes `C=AU` in the disposable test keystore dname (controller ruling: neutralize per Ruling 11 spirit — committed artifact). Use a neutral value or omit the C component.
5. **Minor 5 — misnomer.** `mobile_flutter/fastlane/Fastfile` ios `doctor` lane: variable `match_cert_count` counts provisioning profiles. Rename to what it counts.

## Verify (RAM: one toolchain at a time; caches into the worktree `.cache/`; `mkdir -p mobile_flutter/build/ios/SourcePackages` first if flutter runs)

- `git diff --check` on your new commit → clean.
- One `fvm flutter analyze` (or `command -v flutter` path) → 0 issues; one focused run `flutter test test/android_release_signing_contract_test.dart` → 4/4 (comment edit cannot break it; run anyway).
- `actionlint .github/workflows/mobile-release.yml` (if installed) after the yml edit; `ruby -c mobile_flutter/fastlane/Fastfile` after the rename.

## Commit

Single commit, subject `fix: close the mobile release documentation gaps`, blank line + trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## Reply (under 8 lines)

Status; per-fix one-liners; verification one-liner; commit SHA; concerns.
