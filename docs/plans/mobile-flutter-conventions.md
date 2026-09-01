# Mobile Flutter App — arxa Repo Conventions Inventory

Inventory of `/Volumes/developer_ssd/Developer/totem_labs/arxa` (2026-08-29), to guide scaffolding a new Flutter mobile app that follows house conventions. Two binding decisions from the user: (1) the app **must be generated with arxa's own scaffolder** (dogfooding), (2) **cairn is consumed in v1**, not stubbed.

---

## 1. PRIORITY — The arxa scaffolder (how the app must be created)

There is no standalone `/arxa-scaffolder` binary. The scaffolder is a subcommand of the **arxa CLI**, a pure-Dart package at:

- CLI package: `/Volumes/developer_ssd/Developer/totem_labs/arxa/arxa` (pubspec `name: arxa`)
- Entry point: `arxa/bin/arxa.dart` (subcommands: `gate`, `lens`, `design`, `deploy`, `intake`, `project`, `moodboard`, `memory`, `credentials`, `emit`, `crud`, `serve`, `entitlement`, `login`, `lint`, `docs`, `kb`)
- Scaffold implementation: `arxa/lib/scaffold.dart` (`scaffoldMain`), CLI wrapper `arxa/lib/scaffold_cli.dart`, gate in `arxa/gate_scaffold.dart`
- Project bootstrap: `arxa/lib/project.dart` + `arxa/lib/project_cli.dart`

An agent-facing skill wraps each stage: `arxa-orchestrator` (front door), `arxa-intake`, `arxa-story-mapper`, `arxa-designer`, `arxa-scaffolder`, `arxa-builder`, `arxa-tester`, `arxa-reviewer`, `arxa-deployer`, `arxa-cicd`.

### Invocation (pipeline order — the FSM/gates enforce ordering)

1. `arxa project init <name> --targets ios,android --locales en` — creates the project **under `ARXA_HOME` (default `~/.arxa`)**, writing `settings/project.json` (`targets`, `locales`). `init --repo` binds a repo behind it. All commands honor `ARXA_HOME`.
2. Optional: `arxa intake` → `arxa emit story-map` (emits `docs/intake/brief.md`).
3. Design stage (arxa-designer skill) produces a **frozen** design: `structure.json` + a derived `registry.json`; targets derivation lands in `pipeline/state/targets.derivation.json`.
4. `arxa emit scaffold` — turns the FROZEN design into the per-surface Flutter file set. Flags seen in `scaffold_cli.dart`: `--app-root <path>`, `--targets`, `--check` (drift-check, no writes), `--apply`, `--self-test`. Config read from `config/arxa.config.json`.
5. `arxa gate --all` validates (coverage gate asserts `lib/ui/views` exists and matches the design; `arch_guard` + manifest hash at review stage).

### What the scaffolder emits

- Per-surface files under `lib/ui/views/<surface>/…` — **form factors follow targets**: `ios`/`android` → 4 files per surface, `macos` → 3. Never empty stubs-only.
- Extension-point View/ViewModel bodies are then filled by the **arxa-builder** stage; views compose the adaptive primitive layer at `lib/ui/primitives.dart` (per-platform native family — glass/expressive/shadcn — lives in the primitives, not the views).
- Output is **structurally isomorphic to `kit/showcase_app/lib`** (the designer skill states this explicitly: "output is structurally isomorphic to kit/showcase_app/lib so the scaffolder transliterates rather than interprets").

### Recommended location (per scaffolder conventions, not judgment)

The new mobile app is a **generated project under `ARXA_HOME` (`~/.arxa/<name>`)** via `arxa project init` — NOT a new directory inside the arxa repo. The repo has no `apps/` dir; the only in-repo Flutter app is the template `kit/showcase_app`. (Top-level `mobile/` is a Tauri/JS package — `src`, `src-tauri`, `package.json` — not Flutter; do not mirror it.) If the user insists on an in-repo location, the precedent is a sibling of `kit/showcase_app` consuming kit via path deps — but the scaffolder pipeline's own convention is `ARXA_HOME`.

---

## 2. PRIORITY — cairn (consume in v1)

**cairn is a CRDT/sync data engine (Rust core, SQLite storage) by unfazed-dev, with a Flutter SDK.** The recently implemented kit wrapper is:

- **Package name:** `arxa_kit_cairn`, version 0.1.0, at `/Volumes/developer_ssd/Developer/totem_labs/arxa/kit/cairn`
- **Import paths:**
  - `package:arxa_kit_cairn/arxa_kit_cairn.dart` — app-facing barrel
  - `package:arxa_kit_cairn/arxa_kit_cairn_backend.dart` — backend-plugin barrel
  - `package:arxa_kit_cairn/arxa_kit_cairn_testing.dart` — test helpers
- **Design rule:** the kit "owns the cairn_flutter import so apps never touch cairn directly." Underlying dep: `cairn_flutter` via git `https://github.com/unfazed-dev/cairn.git` ref `ed5205f5abfcdeae20401da6e6d30cf0ed45f881`, path `sdk/cairn_flutter`.
- **Wiring:** plugs into `kit/data` through `ArxaKitBackendPlugin`. Mode selected at boot via `--dart-define=ARXA_CAIRN_MODE=…` — modes **`localOnly` / `sync` / `supabaseBridge`** (see `AppData.defaultConfig` in showcase_app). `localOnly` satisfies the arxa-studio "local-only fallback" database boundary; `supabaseBridge` is for users bringing their own Supabase.

### API surface relevant to a mobile client

| Area | File | Types |
|---|---|---|
| Backend plugin | `lib/arxa_kit_cairn_backend.dart` | `ArxaKitCairnBackend`, `ArxaKitPluginSeeder` |
| Config | `lib/config/arxa_kit_cairn_config.dart` | `ArxaKitCairnConfig`, `ArxaKitCairnMode` (localOnly/sync/supabaseBridge); knobs incl. `sqliteDir`, `pauseSync` |
| Repositories | `lib/repositories/cairn_kit_repository.dart`, `lib/repositories/arxa_kit_crdt_capable.dart` | `CairnKitRepository` (implements the `ArxaKitRepository` port: `get/getAll/watchById/watchAll/upsert/upsertMany/…`), `ArxaKitCrdtCapable` |
| Push hooks | `lib/push/arxa_kit_cairn_push_bridge.dart` | `ArxaKitCairnPushBridge` (pairs with `arxa_kit_notifications`; real-rail FCM smoke test lives in showcase `integration_test/push_smoke_test.dart`) |
| Auth | `lib/auth/arxa_kit_cairn_auth_service.dart` | `ArxaKitCairnAuthService` (implements `ArxaKitAuthService`) |
| Storage/attachments | `lib/storage/arxa_kit_cairn_storage_service.dart` | `ArxaKitCairnStorageService`, `AttachmentStorageAdapter`, `ArxaKitCairnLocalOnlyAdapter`, `ArxaKitCairnSupabaseBucketAdapter` |
| Schema | `lib/emitters/cairn_schema_emitter.dart` | `CairnSchemaEmitter` |

Plan doc: `/Volumes/developer_ssd/Developer/totem_labs/arxa/docs/plans/arxa-kit-cairn.md` (grilling session 2026-08-27; upgrade path documented as "same SQLite file + a URL; zero data migration").

### Maturity caveats

- **Rust toolchain required today** (kit/cairn/README.md "INTERIM prerequisite (D3)"): `hook/prebuilt.json` artifact URLs are all empty placeholders at the pinned ref, so the cargo fallback builds on every platform. All platforms need `rustup` (stable); **Android additionally needs `cargo-ndk` + Android NDK, API level 24**. A "zero-toolchain flip" is planned once cairn CI publishes sha256-verified prebuilts (candidate: pub `native_prebuilt`) — tracked, non-blocking.
- Dart SDK floor `^3.12.0`; pairing verified on **Flutter 3.44.9** (matches the fvm install at `/Users/unfazed-mac/fvm/default/bin/flutter`).
- Version 0.1.0, `publish_to: 'none'`, consumed by path dep only. showcase_app already consumes it (`arxa_kit_cairn: path: ../cairn`) — the mobile app **can consume cairn today** via the same pattern; no stub needed.

---

## 3. Repo layout & package organization

- Monorepo root: `/Volumes/developer_ssd/Developer/totem_labs/arxa`. Top level: `arxa` (Dart CLI), `kit` (shared Dart/Flutter packages), `desktop` (Tauri), `mobile` (Tauri/JS, not Flutter), `docs`, `designs`, `pipeline`, `gates`, `harness`, `archives`, `scripts`, `tools`, `supabase`, `deploy`, `config`, `hooks`, `skills`, `memory`.
- **No melos, no pub workspace** — packages resolve via **sibling path dependencies** (e.g. `arxa_kit_core: path: ../core`). There is no root `pubspec.yaml`.
- All kit packages are `publish_to: 'none'`.

## 4. kit packages (exact names; dir = `kit/<dir>`, name = `arxa_kit_<dir>`)

`arxa_kit_analytics`, `arxa_kit_auth`, `arxa_kit_bluetooth`, `arxa_kit_branding`, `arxa_kit_cairn`, `arxa_kit_compliance`, `arxa_kit_core`, `arxa_kit_data`, `arxa_kit_deploy`, `arxa_kit_documents`, `arxa_kit_forms`, `arxa_kit_genui_bridge`, `arxa_kit_haptics`, `arxa_kit_i18n`, `arxa_kit_maps`, `arxa_kit_media`, `arxa_kit_motion`, `arxa_kit_notifications`, `arxa_kit_payments`, `arxa_kit_permissions`, `arxa_kit_security`, `arxa_kit_showcase_app`, `arxa_kit_state`, `arxa_kit_support`, `arxa_kit_ui_library` (+ `kit/tools`, `kit/wifi`, `kit/assets_default` for fonts/brand-icons).

Mobile-app core set (what showcase_app consumes): `arxa_kit_core`, `arxa_kit_ui_library`, `arxa_kit_data`, `arxa_kit_cairn`, `arxa_kit_haptics`, plus direct `firebase_core ^4.13.0` / `firebase_messaging ^16.5.0` (push), `uuid ^4.5.3`, `m3e_collection ^0.3.7`, `lucide_flutter ^1.25.0`, `url_strategy ^0.3.0`, `responsive_builder ^0.7.1`.

**Key convention:** `stacked` / `stacked_services` / `rxdart` / `talker_flutter` come via the kit barrel — **`arxa_kit_ui_library` re-exports them; never declare them directly** in the app pubspec. Theming (`ThemeData`, `arxa_kit_colors.dart`, lucide glyph map) comes from core/ui_library; branding via `arxa_kit_branding` + `tools/generate_branding.sh` → `generated/brand_colors.dart`.

## 5. House conventions

- **State management / architecture:** **Stacked (MVVM)** — Views + ViewModels, `StackedLocator`/`arxaKitLocator` for DI. NOT riverpod/bloc.
- **Routing:** Stacked router codegen — `lib/app/app.dart` (@StackedApp), generated `lib/app/app.router.dart` + `lib/app/app.locator.dart`, plus a `kit_platform_router.dart` pattern. Regenerate with `build_runner` + `stacked_generator`.
- **Code-gen:** `build_runner ^2.15.0` + `stacked_generator ^2.0.4` only. **No freezed / json_serializable** in the template.
- **Lints:** Flutter packages: `include: package:flutter_lints/flutter.yaml` (dep `flutter_lints ^6.0.0`); app additionally excludes `build/**` and `lib/app/app.router.dart` from analysis. Pure-Dart packages use `lints/recommended.yaml`.
- **Tests:** `flutter_test` + `mocktail ^1.0.4` (mock the repository Ports) for unit; `integration_test` for device rails (e.g. `push_smoke_test.dart`); arxa lens (`arxa/lib/lens.dart`) for visual/smoke at viewport ladder 390/744/1280; Patrol for native E2E. Test naming: `*_test.dart` incl. `*_viewmodel_test.dart`, wiring tests like `showcase_app_keyboard_dismiss_wiring_test.dart`.
- **fvm:** no `.fvmrc`/`fvm_config.json` anywhere in the repo — the house toolchain is the fvm **default** alias: `/Users/unfazed-mac/fvm/default/bin/flutter` (3.44.9). The new app should either rely on `fvm default` or add its own `.fvmrc` pinning `3.44.9`.
- **CI:** repo has only `.github/workflows/desktop-release.yml` (Tauri desktop release; 6 job refs, self-hosted macOS/ARM64 + targets). Dart CI is NOT in-repo per-package; per-project CI is bootstrapped by the **arxa-cicd** skill (one-root check script wiring `arxa gate --all`). Expect the new app's CI to come from arxa-cicd day-zero bootstrap, not hand-rolled workflows.

## 6. Template app to mirror

`kit/showcase_app` (`arxa_kit_showcase_app`, "Template Stacked app built the opinionated way on the arxa_kit core/ui_library/data kits"). Structure:

```
lib/
  main.dart
  app/        # app.dart, app.router.dart (generated), app.locator.dart (generated),
              # app_data.dart (AppData.defaultConfig — cairn mode), kit_platform_router.dart
  data/       # Notes data slice — Repository/Facade over the seeded data layer
  enums/  extensions/  services/
  ui/
    common/  snackbars/  widgets/
    views/<surface_shell>/<surface>/  # e.g. showcase_notes_shell/showcase_notes/…_view.dart
```

Web/desktop/tablet responsive stubs are intentionally unimplemented (form-factor showcase); mobile shells (home/search/profile/notes/startup/unknown) are the parts to mirror.

## 7. Reuse vs build fresh

- **Reuse:** everything in §4's core set; cairn via `arxa_kit_cairn` (v1, real — §2); push via `arxa_kit_notifications` + `ArxaKitCairnPushBridge` + Firebase pins; theming/branding/haptics/i18n/permissions kits as needed. Structure, DI, routing, lints all come from the scaffolder + showcase conventions.
- **Build fresh:** only the app's own surfaces (View/ViewModel bodies via arxa-builder), its data slice (Repository/Facade over `ArxaKitRepository` ports backed by `CairnKitRepository`), branding assets, and app-specific services.
- **Do not:** declare stacked/rxdart/talker directly; import `cairn_flutter` directly; add riverpod/go_router/freezed; design features that require the Arxa Digital Solutions Supabase (ship `ARXA_CAIRN_MODE=localOnly` as the default; `supabaseBridge` only for bring-your-own-DB users).
