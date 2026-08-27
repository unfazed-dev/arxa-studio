# Desktop shell scaffold — status

Implements the locked desktop decision (option B in
`docs/plans/arxa-studio-grill-decisions.md`): Tauri v2 shell over the locally
served studio web UI, arxa CLI + studio engine as sidecars.

## What exists (arxa repo, commit `adc6d0f0`)

- `desktop/src-tauri/` — Rust shell (`tauri.conf.json`, `Cargo.toml`,
  `src/lib.rs`, `src/main.rs`, `capabilities/default.json`)
  - identifier `solutions.arxadigital.arxa`, product name "Arxa Studio"
  - loads `http://localhost:7891` by default; `ARXA_STUDIO_URL` env override,
    exposed to the frontend via a `studio_url` Tauri command
  - `bundle.externalBin`: `binaries/arxa-studio` (engine/server) and
    `binaries/arxa` (Dart CLI) — binaries NOT vendored
  - capability grants `shell:allow-execute` scoped to the two sidecars only
- `desktop/src/` — static "waiting for arxa studio server" screen; polls the
  server every 1 s, navigates to it once reachable (no build step, no bundler)
- `desktop/scripts/dev-stub-sidecars.sh` — creates gitignored stub sidecar
  binaries; needed because `tauri-build` validates `externalBin` paths at
  **compile** time, not just bundle time
- `desktop/README.md` — layout, sidecar injection contract for the release
  pipeline (target-triple suffixed binaries in `src-tauri/binaries/`), dev steps

## Verified

`cargo check` passes clean on aarch64-apple-darwin (after stub script +
placeholder icon). No full bundle attempted.

## Done since scaffold

- **Icon assets** — DONE (arxa commit `0f0528bc`): brand icon set generated
  from `arxa-brand-logo` source (svg preferred), `tauri icon` size set landed
- **Sidecar injection** — DONE for the Dart CLI (arxa commit `b1962349`):
  `arxa-aarch64-apple-darwin` is a real `dart compile exe` binary (~13M,
  verified via `--help`). DONE for the engine (2026-08-27):
  `arxa-studio-aarch64-apple-darwin` is now a real Mach-O arm64 single
  executable (~141 MB) built by `scripts/pack-sidecar.mjs` — a bun-compiled
  self-extracting entry embedding a tar.gz of the runtime tree (bin +
  node_modules + plugins + profile + pi + `arxa/harness/pi/arxa-gate.ts`) and
  a pinned Node v24.19.0; extracts once to `$ARXA_HOME/engine/<sha12>` and
  spawns the extracted node on the launcher. Naive `bun build --compile` of
  the launcher stays impossible (dsh resolves plugins by name at runtime;
  compiled `process.execPath` would recurse) — root cause and design in
  `arxa/desktop/README.md`. Launcher gained a packed mode (`bin/packed.json`
  → plugin dir copies instead of pnpm). Verified: binary run from `/tmp`
  with fresh `ARXA_HOME` serves HTTP 200 on `--port 7912`, clean shutdown.
  `.app` + DMG built, installed to /Applications, launch-verified.

## Remaining

- **Engine sidecar in release CI** — build step exists
  (`node scripts/pack-sidecar.mjs`, needs both repos + npm install); CI just
  needs to invoke it per target and re-sign/notarize
- ~~**Auto-spawn**~~ — RESOLVED (2026-08-27): launchd
  (`solutions.arxadigital.arxa.studio.plist`) stays the sole launcher; the
  .app does NOT spawn the sidecar. Desktop-app presence is instead signalled
  to web children via the `desktop-presence` dsh plugin: the Tauri shell
  heartbeats `POST /__arxa/desktop-heartbeat` every 2s; the injected client
  script polls `GET /__arxa/desktop-status` and swaps in the branded
  "Waiting for main app to start…" overlay (arxa-brand-logo.svg, pulse
  animation) when the heartbeat is >6s stale, auto-reloading the studio UI
  when the app returns. Verified full cycle: quit → overlay on all web
  children; relaunch → children recover without manual reload.
- ~~**Auto-update**~~ — WIRED (2026-08-27): `tauri-plugin-updater` v2
  (target-gated to desktop) init in `lib.rs` + `updater:default` capability;
  launch check is non-blocking and silent on failure (app always starts);
  D21 channels via `ARXA_UPDATE_CHANNEL` (stable default, beta override).
  `createUpdaterArtifacts: true`; update-signing keypair generated
  (`tauri signer generate`), private key OUTSIDE the repo at
  `~/.arxa/updater/arxa-updater.key` (600), pubkey committed in
  `tauri.conf.json > plugins.updater`. Static-JSON contract + generator:
  `desktop/scripts/make-update-manifest.mjs` (self-validating; layout
  `{BASE}/desktop/{channel}/{target}/{arch}/latest.json`). STILL OPEN
  (debt): endpoint hosting — base URL is the deliberate placeholder
  `https://updates.arxa.invalid`; picking real hosting is a release-CI
  decision (see `desktop/README.md`).
- **Code signing / notarization** — SIGNING RESOLVED (2026-08-27):
  `desktop/scripts/sign-and-notarize.sh` + `desktop/entitlements.plist`
  (allow-jit + allow-unsigned-executable-memory for node/bun sidecars, per
  nodejs osx-entitlements.plist). Dry-run verified on a /tmp copy of the
  installed .app: all sidecars + bundle signed with
  `Developer ID Application: EVAN F PIERRE LOUIS (43GNRCGQXQ)`, hardened
  runtime, `codesign --verify --deep --strict` passes, spctl reports
  "Unnotarized Developer ID". STILL OPEN: notarization credentials
  (`xcrun notarytool store-credentials arxa-notary`, needs the user's
  Apple ID app-specific password — setup in `desktop/README.md`), and the
  tauri.conf.json entitlements hookup
  (`bundle.macOS.entitlements: "../entitlements.plist"` — conf owned by
  another workstream, exact diff in README). Windows signing if/when a
  Windows target is added
