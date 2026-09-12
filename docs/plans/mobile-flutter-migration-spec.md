# Mobile Flutter migration spec (Tauri v2 scaffold → Flutter)

> **Status 2026-09-12: parity audit complete.** All twelve §a boxes were verified against current
> `mobile_flutter` at arxa `5749402b`: `flutter analyze` — *No issues found*; `flutter test` —
> *All tests passed!* (+104). The boxes stay unchecked below as historical narrative; the evidence
> mapping and the genuine residuals (Android release signing, CI frame, release automation,
> physical-device gates) are rows AXS-011/AXS-018/AXS-031 in
> [`open-work-inventory-2026-09-12.md`](open-work-inventory-2026-09-12.md), owned by Tasks 12/16.

Sources: `arxa-studio/docs/plans/shell-language-decision.md`, `arxa/mobile/` (Tauri scaffold, arxa commit `ca2eff33`),
`arxa/docs/plans/mobile-pairing-transport.md`, `arxa-studio/docs/plans/mobile-grill-decisions.md`,
`arxa/docs/plans/arxa-kit-cairn.md` (ADR-0037). Date: 2026-08-29.

## a) Feature parity checklist (Tauri scaffold → Flutter must reproduce)

The scaffold is a **single-screen pairing shell + webview handoff**. Everything below is verified in code.

- [ ] **Pairing screen** — states mirror `ConnectionStatus`: not-paired → scanning → pairing → connecting → connected (`mobile/src/index.html`, `mobile/src/main.js`).
- [ ] **QR scan** — `tauri-plugin-barcode-scanner 2.4`: `requestPermissions()` then `scan({ windowed: false, formats: ["QR_CODE"] })` (`mobile/src/main.js:71-76`). Flutter: camera QR scanner with same UX.
- [ ] **Manual ticket paste** (dev fallback) — paste `arxa-pair:...` string instead of scanning (`mobile-pairing-transport.md:36-37`).
- [ ] **Pairing flow contract** — `begin_pairing(ticket) -> Result<(), String>`; poll `connection_status()` every 2s; on `state == "connected" && studio_url` → navigate webview to `studio_url` (`mobile/src/main.js:2-5, 41-45`; invoke names + JSON shapes pinned at `mobile-pairing-transport.md:6-12`).
- [ ] **iroh transport client** — dial stored/ticket `NodeAddr`, ALPN `arxa/studio/0` (`connection.rs:44`), constants: `AUTH_TIMEOUT` 15s, `RECONNECT_BACKOFF` 3s, `FRESH_DIAL_ATTEMPTS` 2, `RECONNECT_DIAL_ATTEMPTS` 5 (`connection.rs:46-50`).
- [ ] **Loopback HTTP proxy** — phone-local TCP proxy on a random port forwarding raw HTTP/1.1 over iroh streams; `studio_url = http://127.0.0.1:<proxy-port>/` (`connection.rs:307`, `mobile-pairing-transport.md:21-24`).
- [ ] **Persistence / reconnect** — after first pairing store peer `NodeId` + long-lived session token in app data dir; reconnect skips QR (`mobile-pairing-transport.md:25-28`).
- [ ] **Revocation semantics** — only an AUTH-stream close signals revocation; a PUSH-stream close is NEVER the revocation signal (`connection.rs:304-305`).
- [ ] **Push token relay** — `set_push_token(platform, token)` invoke (`connection.rs:347`); on session, send `PUSH <session_token> <platform> <token>\n`, expect `OK\n`; failures logged and swallowed (`connection.rs:354-370`). Scaffold used `tauri-plugin-mobile-push 0.1.4` with `ForegroundPresentationOptions::silent()` (`lib.rs:23-31`).
- [ ] **Device name in AUTH** — self-reported device name via `gethostname` sent in the AUTH frame (`Cargo.toml` libc comment; `connection.rs:399`).
- [ ] **App identity/config** — productName `Arxa Studio`, version `0.1.0`, identifier `solutions.arxadigital.arxa.mobile`, window title `Arxa Studio`, webview userAgent `Mozilla/5.0 (Mobile) ArxaShell/0.1`, iOS `developmentTeam: 43GNRCGQXQ`, no Android signing config (`src-tauri/tauri.conf.json`). Brand logo `src/arxa-brand-logo.svg` reused.
- [ ] **Build facts to match** — `tauri android init` succeeded with NDK `29.0.14206865`; iOS project generated (grill build status, `mobile-grill-decisions.md:53-66`).

## b) Pairing/push contract (exact — the Dart client implements these)

**Ticket (QR payload)** — `mobile-pairing-transport.md:16-18`:
- Single string: `arxa-pair:<base32(json)>` (base32 = `data-encoding` `BASE32_NOPAD`, RFC 4648).
- json = `{ "node": <iroh NodeAddr ticket>, "token": <32-byte hex auth token> }`.
- Token is single-use, minted per QR display, expires after 10 min.

**Transport** — `mobile-pairing-transport.md:19-24`, `connection.rs:9-12`:
- iroh bidirectional streams, ALPN `arxa/studio/0`.
- First frame from phone on EVERY stream: `AUTH <token> <device-name>\n`; desktop replies `OK\n` or closes.
- After auth, streams carry raw HTTP/1.1; desktop bridges each authed stream to the local engine HTTP server; phone runs the loopback proxy (above).

**Invoke-surface (fixed, port as Dart API)**: `connection_status() -> ConnectionStatus`, `begin_pairing(ticket)`, `set_push_token(platform, token)` (`lib.rs:7-10`).

**Push registration over the session** — `connection.rs:354-370`:
- Frame: `PUSH <session_token> <platform> <token>\n` → `OK\n`. Best-effort; re-sent on reconnect once OS token known.

**Cairn push (ADR-0037)** — `arxa/docs/plans/arxa-kit-cairn.md:89-93`:
- `registerPushToken(platform ∈ {fcm, apns, webpush}, token)` → `POST /push-tokens` (204 or `CairnPushTokenException`).
- `deregisterPushToken(token)` → `DELETE /push-tokens/{token}`.
- Exactly one 401 → refresh → retry; registered tokens held in-memory only across process restarts (server prune covers); sign-out hook auto-deregisters (`registerSignOutHook`).
- Server side: standalone `cairn-pushd`, engine-supervised sidecar, SQLite token registry, APNs/FCM credentials in engine-local config (M7).
- The deeper Flutter/Tauri push client plan lives in the **cairn repo** (`cairn:docs/plans/cairn-integration-tauri-flutter-push.md`, referenced from `arxa-kit-cairn.md:128`) — not present in the arxa/arxa-studio trees.

**Reconnect/heartbeat semantics**: no explicit heartbeat frame exists; liveness is stream-level. Backoff `RECONNECT_BACKOFF` = 3s; fresh pairing gets 2 dial attempts, reconnect gets 5 (`connection.rs:47-50`).

## c) Settled decisions constraining the app

From `mobile-grill-decisions.md:7-51` (grill closed through M8, `:69`):
- **M1** — Transport: iroh, embedded. Phone ↔ Mac engine over iroh P2P.
- **M2** — Pairing: QR minted by the desktop app.
- **M3** — Device count: unlimited phones per engine.
- **M4** — Surface: full studio (the mobile app is the full studio via webview, not a companion subset).
- **M5** — Distribution: TestFlight + APK sideload for now; store release later.
- **M6** — Fallback + no-database users: Supabase DB belongs to Arxa Digital Solutions; arxa studio does NOT provide database hosting; free users must get the exact same experience via local secure storage on the engine side; D32–D35 BYO-provider abstraction applies unchanged.
- **M7** — Push: standalone `cairn-pushd` studio-managed sidecar (settled 2026-08-26); client half done in `cairn_tauri` (`register_push_token`/`deregister_push_token` + sign-out cleanup, ADR-0037, on cairn `e50f791`).
- **M8** — Offline data: online-only v1 (iroh relay covers most gaps); no bespoke cache/queue; offline-first arrives with the cairn-side `cairn-integration-tauri-flutter-push.md` work.

From `shell-language-decision.md`:
- Desktop stays Tauri; **mobile goes Flutter** (native pairing/QR, push, biometric approvals, share sheet cited at `:14`).
- **Screen-level split rule**: whole screens are either native or web; no interleaving within a screen (`:16`).

Newly settled (user, 2026-08-29):
- **Cairn in v1**: consumed via the implemented **`arxa kit cairn`** package — no stubbing. The app assumes a real cairn-backed data layer.
- **Dogfooding**: the Flutter app is generated with **arxa's own scaffolder** and must follow the scaffolder's emitted structure (per-surface file sets; ios/android = 4 files/surface).

## d) Proposed Flutter screen map

| Screen | Kind | Notes |
|---|---|---|
| Pairing / QR scan | **Native** | Camera scan + manual ticket entry; states mirror `ConnectionStatus` |
| Connecting / reconnecting | **Native** | Status + error surface; retry per dial-attempt constants |
| Studio session | **Webview** | Navigates to `studio_url` (loopback proxy); UA parity with `ArxaShell/0.1` TBD (open Q8) |
| Push permission prompt | **Native** | OS permission + `set_push_token` equivalent → PUSH frame + cairn `registerPushToken` |
| Approvals (push-tapped) | **Native** | Notification-driven; data via arxa kit cairn (real, per settled decision) |
| Settings / unpair / devices | **Native** | Unpair = drop stored NodeId + session token; triggers sign-out hook (auto-deregisters push token) |

Scaffolder constraint: each surface above enters the arxa registry so the scaffolder emits its 4-file ios/android set; the webview session surface is one scaffolded surface whose View hosts the webview.

## e) Open questions (need a human decision)

1. **iroh in Dart** — no first-class Dart iroh binding. Options: flutter_rust_bridge/FFI around the existing `connection.rs` logic (reuse `arxa_mobile_lib`?), or a fresh Rust core crate shared by both shells. Who owns the loopback proxy — Dart or the Rust FFI layer?
2. **Cairn-side push doc access** — `cairn:docs/plans/cairn-integration-tauri-flutter-push.md` is in the cairn repo, unreadable from here; needed to confirm Flutter push client details beyond the ADR-0037 summary (e.g. `cairnDoorbellBackgroundHandler`, `CAIRN_WS_PATH`, `CAIRN_SYNC_AUTH` semantics).
3. **Android push token source** — replacing `tauri-plugin-mobile-push`: does taking `firebase_messaging` (FCM SDK dependency) conflict with the M6 "no hosted infra for free users" posture, or is FCM purely a token source with credentials living engine-side (M7)?
4. **Webview package** — `webview_flutter 4.14.1` was verified for the desktop ADR; confirm it (vs alternatives) for the iOS/Android session surface, incl. cleartext `http://127.0.0.1` allowances on both platforms.
5. **Signing** — carry iOS `developmentTeam 43GNRCGQXQ` into the Flutter project? Android has no signing config yet (needed for M5 APK sideload).
6. **Biometric approvals** — cited in the ADR (`shell-language-decision.md:14`) but no contract exists in any doc; in-scope for v1 or deferred?
7. **Tauri scaffold retirement** — keep `arxa/mobile` as reference/parallel build, or delete after Flutter reaches parity?
8. **User-agent parity** — must the Flutter webview send `Mozilla/5.0 (Mobile) ArxaShell/0.1` (does the engine key on it anywhere)?
