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
  verified via `--help`). DEVIATION for the engine:
  `arxa-studio-aarch64-apple-darwin` is a **wrapper script** (dev-grade), not a
  bun single-executable — `bun build --compile` produced a broken artifact for
  dsh (documented in `desktop/README.md` as a release-CI debt). `.app` + DMG
  built, installed to /Applications, launch-verified.

## Remaining

- **Engine sidecar as real single executable** — replace the dev-grade wrapper
  script with a working single-binary package of `bin/arxa-studio.mjs` in
  release CI (bun SEA currently broken for dsh; see `desktop/README.md`)
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
- **Auto-update** — tauri-plugin-updater + update endpoint
- **Code signing / notarization** — Apple Developer ID under Arxa Digital
  Solutions; Windows signing if/when a Windows target is added
