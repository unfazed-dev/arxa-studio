# iroh from Flutter (iOS + Android) — 2026 strategy

Research date: 2026-08-29. Goal: replicate the Tauri app's iroh usage (dial NodeAddr from ticket, bidi stream on ALPN `arxa/studio/0`, line-based AUTH handshake, loopback HTTP/1.1 proxy on 127.0.0.1) in Flutter.

## 1. Official iroh FFI story

- iroh **1.0 released 2026-06-15** — first stable after 65 pre-releases. Blog: https://www.iroh.computer/blog/v1 · releases: https://github.com/n0-computer/iroh/releases
- [n0-computer/iroh-ffi](https://github.com/n0-computer/iroh-ffi): went community-maintained in early 2025 ([blog: "Update On FFI Bindings"](https://www.iroh.computer/blog/ffi-updates)), then **revived around iroh 1.0**: official minimal FFI mirroring the 1.0 API for **Swift, Kotlin, Python, JS** (UniFFI-based; docs: https://n0-computer.github.io/iroh-ffi/). Mobile distribution: SwiftPM (xcframework via `cargo make swift-xcframework`) + Maven Central; demo: https://github.com/n0-computer/hello-iroh-ffi
- **No official Dart/Flutter binding** from n0. Higher-level protocols (blobs/docs/gossip) out of FFI scope — irrelevant here; we only need endpoint/connect/streams.

## 2. Dart/Flutter packages (pub.dev)

- **[iroh_flutter 1.0.3](https://pub.dev/packages/iroh_flutter)** (publisher snowpine.io, verified; Apache-2.0; published ~2026-08-09): Flutter plugin for iroh 1.0 — endpoints, connections, streams, relays. Builds Rust core (`irohdart_ffi`) at build time via [cargokit](https://github.com/irondash/cargokit); re-exports the pure-Dart [`iroh_quic`](https://pub.dev/packages/iroh_quic) API. Platforms: Android/iOS/macOS/Linux/Windows. Android: cargo-ndk per-ABI cdylib, NDK r28+ (16 KB page alignment), minSdk 24.
- Health signals: 1 like, 140 pub points, 261 downloads — **very young, effectively single-maintainer**. Promising but not yet a foundation to bet on alone.

## 3. flutter_rust_bridge (FRB)

- [fzyzcjy/flutter_rust_bridge](https://github.com/fzyzcjy/flutter_rust_bridge) — **v2.13.0 current** ([docs.rs](https://docs.rs/crate/flutter_rust_bridge/latest)); active cadence through 2026 (2.12.0 → 2026-03-29; 2.13.0 betas Jun–Aug 2026). Flutter Favorite. [Changelog](https://pub.dev/packages/flutter_rust_bridge/changelog).
- Build integration: [Cargokit](https://cjycode.com/flutter_rust_bridge/manual/integrate/cargokit) hooks cargo into Gradle (Android, auto-installs NDK targets) and CocoaPods (iOS, builds static lib/XCFramework). Known Android gotcha: emit `cargo:rustc-link-lib=c++_shared` + bundle `libc++_shared.so` per ABI ([troubleshooting](https://cjycode.com/flutter_rust_bridge/manual/troubleshooting)).
- Well suited to wrapping a small custom crate exposing `connect(ticket)`, `open_authed_stream()`, `start_loopback_proxy() -> port`, with async via tokio + RustStreamSink for events.

## 4. Process-spawn alternative — ruled out on iOS

- iOS has **no public API to spawn processes**: `Process`/`NSTask` availability is macOS-only (https://developer.apple.com/documentation/foundation/process — availability: macOS; not iOS), and `fork`/`exec` are blocked by the app sandbox. App Review Guideline 2.5.2 prohibits downloading/launching external executable code.
- Android technically can exec a bundled binary from `nativeLibraryDir`, but it's fragile (W^X restrictions tightened since API 29) and pointless given FFI works on both.
- → **Link Rust as a library (static on iOS, cdylib in jniLibs on Android), call via FFI.** The loopback-proxy *pattern* survives unchanged — the proxy just runs on a tokio runtime inside the app process; Flutter's HTTP client talks to 127.0.0.1:<port> exactly as with Tauri.

## 5. Precedent

- **[futpib/iroh-ssh-android](https://github.com/futpib/iroh-ssh-android)** — Flutter app, Rust iroh core, bridged via flutter_rust_bridge. Direct precedent.
- **Telepathy** — Flutter + iroh cross-platform RTC, listed in [awesome-iroh](https://github.com/n0-computer/awesome-iroh).
- iroh_quic / iroh_flutter themselves (Dart-native surface over the Rust core).

## Recommended architecture

**Primary: small custom Rust crate (embedding iroh 1.0) behind FRB v2 + cargokit.**

- Crate `arxa_p2p`: `connect(ticket) -> Connection`, AUTH handshake, `start_proxy() -> u16` (loopback listener pumping HTTP/1.1 bytes over iroh bidi streams). This is largely a **port of the existing Tauri Rust code** — highest reuse, lowest behavioral drift.
- Flutter side is thin: init, call `startProxy()`, point Dio/http at `http://127.0.0.1:<port>`.
- Why not iroh_flutter as foundation: 3-week-old package, 261 downloads, one maintainer — adopt later if it matures; its existence validates the cargokit approach.
- Why not iroh-ffi (Swift/Kotlin): would require writing platform channels *twice* (Swift + Kotlin) plus glue; FRB gives one Rust surface, one Dart binding.

## Per-platform caveats

- **iOS**: static lib via cargokit/CocoaPods (or XCFramework); targets `aarch64-apple-ios` (+ sim). App Store: fine — compiled-in Rust is ordinary native code; no JIT, no dylib loading. Sockets suspended on backgrounding → reconnect-on-resume logic required (same as Tauri mobile).
- **Android**: NDK r26+ (r28 for 16 KB pages / Play 2025+ requirement); targets arm64-v8a, armeabi-v7a, x86_64; `c++_shared` linking gotcha; minSdk ≥ 24 realistic.

## Top 3 risks

1. **FRB codegen/toolchain churn** — 2.x moves fast; pin versions; https://pub.dev/packages/flutter_rust_bridge/changelog
2. **Cargokit maintenance** — separate irondash project, occasional Xcode/Gradle breakage on new toolchains; https://github.com/irondash/cargokit
3. **Mobile lifecycle vs long-lived QUIC** — iOS suspend kills the proxy's connections; needs resumption design (iroh handles path migration, not app suspension); https://github.com/n0-computer/iroh

## Rust kept in stack

~**500–1,000 LOC** custom Rust (connect + auth + proxy pump — mostly ported from the Tauri app) + iroh as a dependency. Everything else is Dart.
