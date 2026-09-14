### Task 15: Close macOS/Linux distribution and preserve the Windows deferral

**Governing sources:** `docs/plans/desktop-shell-scaffold.md`, `docs/plans/linux-install-script.md`, `docs/plans/linux-omarchy-port.md`, and `../arxa/desktop/README.md`.

**Files:**
- Modify in isolated arxa worktree: `.github/workflows/desktop-release.yml`, `.github/workflows/desktop-gate.yml`, `desktop/scripts/**`, and `desktop/README.md`
- Create in isolated arxa worktree: `desktop/scripts/install-macos.sh` and its focused shell test
- Create in isolated arxa worktree: `docs/linux-support.md`
- Modify in studio: Linux harness/tests/docs only where the engine payload owns them

**Interfaces:**
- Produces locally validated macOS and Linux artifacts plus release workflows that refuse an unsigned or unnotarized stable release.
- External release remains gated on credentials and explicit authorization.
- Windows remains `DEFERRED` under D23 until its recorded demand/customer trigger fires; research is evidence, not authorization to build it.

- [ ] **Step 1: Close already-built rows by evidence.** Verify macOS entitlements and branded icons, Linux AppImage/deb/PKGBUILD, `/usr/libexec` engine layout, systemd user unit, Wayland/HiDPI fixes, `.desktop`/icon install and uninstall, and checksum/updater manifest generation. Correct the stale plan line claiming no `.desktop` story.
- [ ] **Step 2: Make stable releases fail closed.** In `desktop-release.yml`, a `studio-v*` job must fail before publication unless Developer ID signing, notarization, Tauri updater signing, and required release credentials all succeed. A `studio-beta-v*` job may produce a clearly labelled unnotarized beta with a workflow warning and matching manifest metadata; never label it stable.
- [ ] **Step 3: Add the macOS installer twin.** Fetch the channel manifest, verify the updater signature/checksum, install per-user, preserve channel choice, and support uninstall. Test syntax, local-file override, tampered artifact refusal, idempotent upgrade, and clean uninstall without network publication.
- [ ] **Step 4: Retry the Omarchy user path.** In a disposable Omarchy VM and disposable user/home, run `ARXA_CHANNEL=beta curl -fsSL https://raw.githubusercontent.com/unfazed-dev/arxa-releases/main/install.sh | sh` rather than `ARXA_STUDIO_APPIMAGE`; assert Wayland/X11 choice, stable copied engine path, systemd restart, tray, session composer, logs, and the previously observed `cannot prepare session while it is live` resume flow. Fix a reproduced product fault test-first.
- [ ] **Step 5: Run workflow logic without publishing.** Use actionlint, manifest generators/check modes, the Arch and Ubuntu container lanes, AppImage/deb extraction, installed layout checks, and packed-engine boot. Record the still-external first `desktop/**` PR runner pass and first signed `studio-v*` `release-linux` pass.
- [ ] **Step 6: Prepare notarization.** Validate signing identities, entitlements, hardened runtime, updater signatures, and `notarytool` command shape using a non-secret profile reference. Do not read or create the operator's app-specific password.
- [ ] **Step 7: Preserve the Windows decision.** Update the inventory with `DEFERRED (D23)` plus the exact demand/Scale-customer revisit trigger and link `../arxa/docs/research/windows-packaging.md`. Do not add Windows sidecars, Credential Manager, picker, service, installer, workflow, or PowerShell installer in this program.
- [ ] **Step 8: Run both repositories' full local gates and commit separately.** No tag, release upload, or store submission in this task.

