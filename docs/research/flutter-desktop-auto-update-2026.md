# Flutter Desktop Auto-Update & Distribution — 2026 State (research, 2026-08-29)

Context: evaluating a move off Tauri v2 (`tauri-plugin-updater`) to Flutter desktop. Priority: macOS → Windows → Linux. All version/date claims below verified against pub.dev API and GitHub API on 2026-08-29 unless flagged.

## 1. `auto_updater` (leanflutter/auto_updater)

- pub.dev: **v1.0.0, published 2024-10-27** — no release in ~22 months. https://pub.dev/packages/auto_updater
- GitHub: 345 stars, 30 open issues, **last commit 2025-03-29** (a README refactor). Not archived. https://github.com/leanflutter/auto_updater
- Open issue **#83 "is the project dead?"** (2026-03-19). Other notable open issues: #86 SwiftPM support missing (CocoaPods-only on macOS), #79 download failures on both platforms, #68 platform-thread messaging bug, #75/#74 no `sparkle:channel` support, #70 no critical-update flag.
- **Sparkle version:** the macOS podspec declares an *unpinned* `s.dependency 'Sparkle'` — CocoaPods resolves latest Sparkle 2.x at build time (upstream Sparkle is healthy: **2.9.6, 2026-08-17**, 9,581 stars, pushed 2026-08-28). So EdDSA (ed25519) signatures ARE supported — that's Sparkle 2's native scheme (`sparkle:edSignature` in the appcast). Workflow: `generate_keys` → `sign_update` → serve `appcast.xml`; `setFeedURL` + `checkForUpdates` from Dart. Same appcast model as Tauri's updater conceptually, but appcast XML instead of Tauri's JSON manifest.
- **Windows:** vendors **WinSparkle 0.8.1** in-tree (`packages/auto_updater_windows/windows/WinSparkle-0.8.1`); upstream WinSparkle is at **0.9.4 (2026-07-21)** — vendored copy is 3 releases behind. WinSparkle verifies **DSA/Ed25519 signatures depending on version**; the 0.8.x line's EdDSA support should be verified in a spike (UNCONFIRMED here).
- **Linux: none.** Confirmed — plugin is macOS+Windows only.

Verdict on the package: functional and widely used, but **maintenance-stale**. The heavy lifting is done by Sparkle (very healthy) and the wrapper is thin, which limits the risk — but the vendored WinSparkle is aging and issues go unanswered.

## 2. Alternatives

- **`desktop_updater`** (MarlonJD/flutter_desktop_updater): **v3.1.6, 2026-08-14** — actively maintained, cross-platform incl. Linux, does delta-style file replacement from a self-hosted manifest. Younger/smaller (52 stars) but alive. https://pub.dev/packages/desktop_updater
- **`updat`**: v1.4.0, 2025-07-31. UI-level "download the new installer and run it" flow — no signature verification; not a Sparkle-class updater.
- **Custom Sparkle integration**: fully viable — add Sparkle via SPM/CocoaPods in `macos/Runner`, drive it from Swift with a thin MethodChannel. Removes the stale-wrapper risk at the cost of ~a day of platform code. Sparkle itself is the industry standard for non-MAS macOS updates.
- **Windows MSIX/Store**: `msix` pub package is very healthy (**v3.18.0, 2026-06-27**). Store distribution gives free auto-update; sideloaded MSIX supports `.appinstaller`-based auto-update without the Store (requires code-signing cert).
- **Linux**: Snap/Flatpak auto-update themselves (store-mediated); AppImage can pair with AppImageUpdate (zsync). No in-app updater needed if you lean on the packaging format.

## 3. macOS signing + notarization (Flutter-specific)

- Standard mac app rules apply: Developer ID cert, hardened runtime, `notarytool`, staple. Flutter gotchas:
  - `flutter build macos` does NOT produce a distributable signed/notarized artifact by itself (flutter/flutter#148669, closed as workflow question) — you script `codesign`/`xcrun notarytool` yourself or via CI (fastlane / GitHub Actions). `flutter_distributor` (leanflutter, **v0.6.10, 2026-07-19**, 1,137 stars, active) automates dmg creation.
  - Flutter's release entitlements (`Release.entitlements`) default to sandbox on; **disable App Sandbox** (or add temporary-exception entitlements) if the app spawns sidecar binaries and self-updates — Sparkle in a sandboxed app requires the XPC installer setup (documented by Sparkle, extra work). Non-MAS + no sandbox is the simple path.
  - Embedded Flutter frameworks (`FlutterMacOS.framework`, plugin dylibs) must be signed — inside-out signing; `codesign --deep` is discouraged by Apple; sign nested code explicitly with `--options runtime --timestamp`.

## 4. Sidecar binaries

- Placement: `Contents/Helpers/` or `Contents/Resources/` in the .app (Helpers is the Apple-sanctioned spot for executables); locate at runtime relative to `Platform.resolvedExecutable` (`../Helpers/mybin`). Windows: install dir next to the exe; Inno Setup/MSIX both handle extra files trivially.
- `Process.start` from Dart is reliable and widely used on desktop.
- **Notarization: yes, every Mach-O in the bundle must be individually signed with hardened runtime + timestamp** — notarization rejects unsigned nested executables. Sidecars that JIT (e.g. bundled node/deno) need `com.apple.security.cs.allow-jit` etc. on the *sidecar's* signature.
- Precedent exists but is thinner than Electron/Tauri: AppFlowy bundles native libraries (FFI rather than sidecar); various Flutter apps ship ffmpeg/CLI helpers. This is standard macOS mechanics, not Flutter-specific — Flutter neither helps nor hinders. Xcode won't auto-sign loose binaries you copy in via a build phase; add explicit codesign steps.

## 5. Installer tooling (what production apps use)

- **`flutter_distributor`** (active, 2026) is the de-facto meta-tool: dmg/pkg (macOS), exe via Inno Setup + msix (Windows), deb/rpm/AppImage (Linux).
- macOS: `create-dmg`/appdmg under the hood. Windows: Inno Setup dominant for non-Store; `msix` package for Store/sideload. Linux: deb + AppImage + Flathub/Snapcraft.

## 6. Production precedent (outside app stores)

- **LocalSend** (~60k stars, Flutter): distributed via GitHub Releases + every store; **deliberately has no in-app auto-updater** — relies on package managers. Counter-example.
- **AppFlowy** (Flutter): GitHub Releases distribution; has an `auto_update.yaml` workflow in AppFlowy-Builder; in-app update behavior is notify-and-download rather than Sparkle-style in-place (UNCONFIRMED in detail).
- **Ente Auth** (Flutter): GitHub Releases outside stores; in-app update prompts.
- Net: precedent for *distribution* outside stores is strong; precedent for *Sparkle-style silent in-place auto-update* in Flutter apps is **weak** — most named apps punt to "download the new installer". This is the single biggest gap vs Tauri.

## Verdicts

| Platform | Self-hosted auto-update viable? | Path |
|---|---|---|
| macOS | **Yes** | Sparkle 2 (via `auto_updater` for speed, or thin custom Swift wrapper for durability) + EdDSA appcast; Developer ID + notarization required |
| Windows | **With caveats** | `auto_updater`/WinSparkle (vendored 0.8.1 is stale) or MSIX + `.appinstaller`; code-signing cert needed either way |
| Linux | **With caveats** | No in-app updater; ship AppImage(+AppImageUpdate)/Flatpak/Snap and let the format update |

**Recommended stack:** `flutter_distributor` for packaging; macOS = Sparkle 2 + EdDSA appcast + notarized DMG; Windows = Inno Setup + WinSparkle now, MSIX/.appinstaller as the strategic path; Linux = AppImage + Flathub. Budget a spike to fork/vendor `auto_updater` or write a ~200-line custom Sparkle bridge.

## Top 3 risks

1. **`auto_updater` abandonment** — last commit 2025-03-29, open "is the project dead?" issue; plan to fork or go custom-Sparkle. https://github.com/leanflutter/auto_updater/issues/83
2. **Vendored WinSparkle 0.8.1 vs upstream 0.9.4** — stale security-sensitive update code on Windows; EdDSA support on 0.8.1 unconfirmed. https://github.com/vslavik/winsparkle/releases
3. **Sidecar + notarization + (non)sandbox interplay** — every nested binary must be individually hardened-runtime-signed; Sparkle-in-sandbox needs XPC installer; Flutter templates default entitlements need auditing. https://developer.apple.com/forums/thread/721791
