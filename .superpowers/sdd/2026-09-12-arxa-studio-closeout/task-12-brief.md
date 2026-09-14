### Task 12: Reconcile and finish the Flutter mobile deliverable

**Governing sources:** `docs/plans/mobile-flutter-migration-spec.md`, `docs/plans/shell-language-decision.md`, current `../arxa/mobile_flutter`.

**Required task skills:** `arxa-cicd` for the one-root CI frame and `arxa-deployer` for Fastlane/Shorebird command shapes. The decisions below are already recorded for this product; do not ask the operator to repeat the generic bootstrap grill.

**Files:**
- Modify in isolated arxa worktree: `mobile_flutter/android/app/build.gradle.kts`, `mobile_flutter/ios/**` only where signing validation requires it, `mobile_flutter/deploy/**`, and mobile docs/tests demonstrated by Task 1
- Create through `arxa-cicd`: `scripts/check.sh`, `.github/workflows/ci.yml`, `.github/pull_request_template.md`, and `docs/ci/{decisions,setup}.md`; generate `docs/ci/explainer.html` from the skill template
- Create through `arxa-deployer`: `.github/workflows/mobile-release.yml`, `mobile_flutter/fastlane/{Appfile,Fastfile,Matchfile}`, and the accepted `mobile_flutter/shorebird.yaml` extension point if OTA remains in scope
- Modify in studio: `docs/plans/mobile-flutter-migration-spec.md`
- Test in arxa: `mobile_flutter/test/**`, `mobile_flutter/integration_test/approvals_e2e_test.dart`, `kit/studio_transport/**`

**Interfaces:**
- Consumes current `TransportService`/`IrohTransportService`, `arxa_kit_studio_transport`, push bridge, approvals/conversation repositories, and native runners.
- Produces a checked parity table mapping every legacy Tauri behavior to Flutter code plus automated or physical evidence.

- [ ] **Step 1: Prove the existing app before editing.** Run formatting check, `flutter analyze`, `flutter test`, and the transport package tests in the isolated arxa worktree.
- [ ] **Step 2: Map all twelve old migration boxes.** Pairing screen, QR, manual ticket, flow contract, iroh, loopback proxy, persistence, revocation, push, device name, identity/config, and build facts each need source and test evidence.
- [ ] **Step 3: Fix only failed parity rows test-first.** Do not recreate existing transport/push/approval work. Preserve the Rust-owned iroh/loopback seam already selected by current code.
- [ ] **Step 4: Close Android signing residue.** Keep the existing `solutions.arxadigital.arxa.mobile` application ID. Load release signing from gitignored `key.properties` or CI secrets and fail a release build clearly when signing inputs are absent; debug builds alone may use the debug key. Confirm the existing iOS team, bundle ID, and entitlements against the release configuration.
- [ ] **Step 5: Run simulator integration smoke.** Exercise pairing through the real pairhost/iroh route, reconnect, webview, push registration, approval decision, and conversation send.
- [ ] **Step 6: Bootstrap the canonical one-root CI frame.** Record the existing product decisions in `docs/ci/decisions.md`: private monorepo, `main` trunk, GitHub-hosted Ubuntu Android lane, existing self-hosted macOS/ARM64 labels for iOS, per-job timeouts, concurrency cancellation, `arxa gate --all` plus Flutter format/analyze/test, and deploy jobs that prepare then halt at the human approval gate. `scripts/check.sh` is the one local/CI root; do not duplicate arxa validators in YAML.
- [ ] **Step 7: Add release automation through `arxa-deployer`.** Prepare Fastlane lanes for TestFlight, App Store, Play internal, and Play production with credential presence checks and no checked-in secrets. Prepare Shorebird release/patch lanes if the current mobile release plan still requires OTA; otherwise record its dated deferral and trigger in the inventory.
- [ ] **Step 8: Exercise release automation without publishing.** Validate workflow syntax, `arxa deploy --self-test`, Fastlane configuration, unsigned debug artifacts, and a release-shaped Android AAB/APK signed with a disposable test-only keystore created and destroyed inside the smoke. With no Apple release identity, validate iOS archive/export configuration and stop at `doctor`; never substitute development signing for a release claim. Verify artifact names, checksums, and secret redaction.
- [ ] **Step 9: Prepare physical gates.** Write `mobile_flutter/deploy/physical-gates.md` with exact iPhone/APNs and Android/FCM/APK commands and redaction rules. Execute only if devices/credentials are available and authorized.
- [ ] **Step 10: Update the migration plan with checked evidence and retain the legacy Tauri scaffold through the first accepted iOS and Android releases.** Archive/remove it later in a separate reviewed cleanup.
- [ ] **Step 11: Commit arxa and studio changes separately.** Suggested messages: `fix(mobile): close Flutter release configuration`; `ci(mobile): add mobile gates and release lanes`; `docs: reconcile Flutter mobile migration`.

