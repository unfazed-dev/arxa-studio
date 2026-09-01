# Flutter Desktop Embedded Webview — State of Play (researched 2026-08-29)

Context: can a Flutter desktop shell host a localhost-served web UI as the **primary window surface** (Tauri-style)? Evidence from pub.dev API, GitHub API, package READMEs/docs. All versions/dates verified against primary sources on 2026-08-29.

## Platform verdicts

| Platform | Embedded webview viable? | Route |
|---|---|---|
| **macOS** | **YES** | Official `webview_flutter` (WKWebView, real embedded widget) |
| **Windows** | **WITH CAVEATS** | No official path; `flutter_inappwebview` (WebView2) or `webview_flutter_windows` fork or `webview_cef` |
| **Linux** | **WITH CAVEATS (weak)** | Only `webview_cef` (CEF texture, software rendering path) — everything else is separate-window or stale |

## 1. webview_flutter (official)

- v4.14.1, published 2026-07-07. Platform tags: **android, ios, macos** — no Windows/Linux. 3.09M downloads/30d. Repo: `flutter/packages`.
- macOS backend: `webview_flutter_wkwebview` v3.26.1 (published 2026-08-28, publisher flutter.dev, tags ios+macos). Embedded `WebViewWidget`, JS channels, cookie manager, loads localhost fine (WKWebView; add App Transport Security / network client entitlement in sandbox).
- Windows/Linux: still unsupported. Old tracking issue flutter#106338 closed 2022 (folded into platform-views work).

## 2. flutter_inappwebview

- v6.1.5 stable, published **2024-10-08** (~22 months stale on pub). Repo active though: last push 2026-02-10, 3,762 stars, **215 open issues**.
- Platform tags: android, ios, **windows, macos**, web. Linux only as prerelease badge on master (`flutter_inappwebview_linux`, WebKitGTK 4.0/4.1) — not shipped stable.
- Backends: macOS WKWebView (10.14+, Xcode ≥15), Windows WebView2 (NuGet CLI required at build).
- Windows-specific issues (all confirmed in repo): blank content in packaged/installed builds unless custom `userDataFolder` set — [#2626](https://github.com/pichillilorenzo/flutter_inappwebview/issues/2626); machine-specific crashes in WebView2 layer — [#2752](https://github.com/pichillilorenzo/flutter_inappwebview/issues/2752); VC++ redistributable crash — [#2655](https://github.com/pichillilorenzo/flutter_inappwebview/issues/2655); high GPU on static pages — [#2387](https://github.com/pichillilorenzo/flutter_inappwebview/issues/2387).

## 3. Other packages — embedded vs separate window

| Package | Version / published | Platforms | Embedded or separate window? |
|---|---|---|---|
| `desktop_webview_window` (MixinNetwork) | v0.3.0, 2026-05-27; repo pushed 2026-08-26 | win/linux/macos | **SEPARATE OS window** ("Show a webview window on your flutter desktop application"). WebView2 on Windows, WebKitGTK on Linux. Not usable as primary in-window surface. |
| `webview_windows` (jnschulze) | v0.4.0, **2024-02-17**; last push 2025-06-26, 112 open issues | windows | Embedded (texture). Effectively unmaintained. Known focus-loss bug [#230](https://github.com/jnschulze/flutter-webview-windows/issues/230). |
| `webview_flutter_windows` (omar-hanafy, publisher tomars.tech) | v1.1.1, 2026-07-18 | windows | Embedded WebView2 with "seamless composition, keyboard focus integration" — explicitly fixes upstream webview_windows #230. Young: ~3k downloads/30d. |
| `webview_cef` (hlwhl) | v0.6.2, **2026-08-25** (active); 242 stars, 49 open issues | win/macos/linux (+eLinux) | **Embedded via Flutter `Texture`**, CEF 149/Chromium 149. GPU zero-copy on Win (D3D11) + macOS (IOSurface); **Linux = software path**. JS bridge, cookies, DevTools, user scripts, CJK/IME composition pipeline, multi-instance. Requires Flutter ≥3.27, C++20; ships a Chromium runtime (heavy binary). Low adoption (~1k downloads/30d). |
| `flutter_linux_webview` (ACCESS) | v0.1.3, 2024-08-09 | linux | Embedded (CEF) but stale ~2 years. Not recommended. |
| `webf` (OpenWebF) | v0.24.27, 2026-04-13 | all | Not a webview — its own HTML/CSS renderer on Flutter; subset of web platform. Not suitable for hosting an arbitrary localhost web app. |

## 4. Capability checklist (viable options)

| Capability | webview_flutter (macOS) | flutter_inappwebview (macOS/Win) | webview_cef (all 3) | desktop_webview_window |
|---|---|---|---|---|
| (a) Embedded widget | ✅ WebViewWidget | ✅ InAppWebView widget | ✅ Texture | ❌ separate window |
| (b) JS bridge two-way | ✅ JavaScriptChannel + runJavaScript | ✅ handlers + evaluateJavascript | ✅ ("call into Dart from JS and evaluate JS from Dart") | ✅ but limited API |
| (c) Cookie/localStorage persistence | ✅ WebViewCookieManager / WKWebsiteDataStore | ✅ CookieManager | ✅ cookie read/set/delete | partial |
| (d) http://localhost | ✅ (macOS: needs `com.apple.security.network.client` entitlement; ATS local exception) | ✅ (docs even ship `InAppLocalhostServer`) | ✅ Chromium | ✅ |
| (e) DevTools | ✅ Safari Web Inspector (inspectable) | ✅ | ✅ built-in DevTools | via backend |
| (f) Keyboard/IME/scroll | Good (native WKWebView NSView); flutter#147844 "Webview does not take the keyboard focus" still **open** (updated 2026-08-18) | Windows focus/keyboard issues (see above) | Explicit real-time CJK/IME support claimed; input synthesized — trackpad/scroll fidelity is the risk area | native window, fine |

## 5. Production precedent

- **Mixin Messenger desktop** (Flutter) — authors of `desktop_webview_window`, but uses it as an *auxiliary* window, not primary surface.
- **No confirmed production Flutter desktop app shipping an embedded webview as the primary app surface was found.** Flag: this is the weakest evidence area — the pattern is essentially unprecedented in public apps. (If web-as-primary-surface is the goal, Tauri/Electron remain the proven category.)

## 6. Flutter platform-views-on-desktop status

- macOS platform views: [flutter#41722](https://github.com/flutter/flutter/issues/41722) "Implement PlatformView support on macOS" — still **open**, P2, 674 reactions (webview_flutter macOS works via plugin-specific native-view embedding, not general platform views).
- Windows/Linux: new umbrella [flutter#188375](https://github.com/flutter/flutter/issues/188375) "[Umbrella] Desktop platform views design/prototype tracks" — **open, P2, design-doc stage** (3 linked design docs), owned by team-windows. i.e. Windows/Linux platform views are being designed in 2026, not shipped.
- Multi-window: [flutter#30701](https://github.com/flutter/flutter/issues/30701) still open (721 reactions).

## Recommendation

- **Single best choice:** platform-split — official **`webview_flutter` on macOS**, **`flutter_inappwebview` 6.1.5 on Windows** (fallback: `webview_flutter_windows` v1.1.1 if focus quality is unacceptable), **`webview_cef` on Linux** if Linux is a hard requirement. If one cross-platform package is mandatory, **`webview_cef`** is the only embedded all-three option — actively maintained (Aug 2026) but low-adoption and ships Chromium (~100MB+ payload, defeating the Tauri-style lightweight goal).

## Top 3 risks

1. **Keyboard focus in embedded webviews is a known open Flutter-level bug** — [flutter/flutter#147844](https://github.com/flutter/flutter/issues/147844) (open, P2, updated 2026-08-18). For a primary surface where users type constantly, this is the top UX risk.
2. **Windows has no official/first-party path** — you depend on either a package stale on pub since Oct 2024 with 215 open issues ([flutter_inappwebview](https://github.com/pichillilorenzo/flutter_inappwebview/issues), packaged-build blank-screen [#2626](https://github.com/pichillilorenzo/flutter_inappwebview/issues/2626)) or a young one-maintainer fork. Windows/Linux platform views are only at design-doc stage upstream ([flutter#188375](https://github.com/flutter/flutter/issues/188375)).
3. **No production precedent** for webview-as-primary-surface in Flutter desktop; on Linux the only embedded option (`webview_cef`, [repo](https://github.com/hlwhl/webview_cef)) uses a software rendering path and has ~1k downloads/month — you would be the pathfinder on at least one platform.

## Unconfirmed / flagged

- flutter_inappwebview macOS: whether every InAppWebView widget feature works embedded on macOS identically to iOS — docs list macOS WKWebView as supported but per-feature parity not audited.
- AppFlowy appeared in search results near webview topics; could not confirm it embeds a webview as any primary surface.
- webview_cef IME/trackpad quality claims are from its own README — not independently verified.
