# Linux port — arxa studio on Omarchy (Arch + Hyprland)

Grilled 2026-09-07. Decisions below are the user's, taken one at a time; the
facts under each were read out of the two repos, the installed dsh wave, and
`basecamp/omarchy@master`, not assumed.

Target: **Omarchy** (Arch Linux + Hyprland, x86_64), reached by first proving
everything in an Arch container on this machine.

---

## 1. Where the tree stands today (measured)

**Already Linux-clean**

| Surface | Evidence |
|---|---|
| Sandbox | `@deepseek-ai/dsh-sandbox-local/lib/index.js` — bwrap (`--ro-bind / /`, `--bind` workspace) then Landlock (`readOnly:['/']`). Reads unrestricted on every backend, so skill packs and payloads load with no extra grant. |
| Platform npm deps | lockfile carries `@anthropic-ai/claude-agent-sdk-linux-{x64,arm64}(-musl)` and `@deepseek-ai/node-addon-landlock-run-linux-{x64,arm64}`. `npm ci` on Arch resolves them. |
| Engine supervision fallback | `engine_agent.rs` shells `launchctl`; when it is absent `lib.rs` falls back to a detached spawn — the app still runs, just unsupervised. |
| Claude engine Linux rung | `claude-subscription-engine.md` §Linux — bwrap probed under `node:22-bookworm`, mechanics green, only token-dependent runs outstanding. |

**macOS-only, blocking or degrading**

| # | Surface | File | Effect on Linux |
|---|---|---|---|
| B1 | Bundle targets `["app","dmg"]`, `bundle.linux` empty | `arxa/desktop/src-tauri/tauri.conf.json` | no Linux artifact at all |
| B2 | Triple hardcoded `-apple-darwin`; embeds build-host node; needs `bun` | `scripts/pack-sidecar.mjs:39` | no Linux sidecar; `tauri dev/build` refuses (externalBin missing for host triple) |
| B3 | Only `arxa-aarch64-apple-darwin`, `arxa-studio-aarch64-apple-darwin` exist | `arxa/desktop/src-tauri/binaries/` | same |
| B4 | Token keyring ladder = Tauri bridge → `/usr/bin/security` → memory | `plugins/github-link/lib/keyring.js` | GitHub token held in memory only; lost on every engine restart |
| B5 | Runner teardown removes `~/Library/LaunchAgents/<label>.plist` via `launchctl bootout`; `svc.sh install` needs sudo on Linux | `plugins/github-link/lib/runner.js:104-126` | runner service install/removal wrong on Linux |
| B6 | Folder picker shells `/usr/bin/osascript` | `plugins/arxa-sidebar/lib/index.js:858` | first-run org-root selection broken |
| B7 | CI is `runs-on: [self-hosted, macOS, ARM64, arxa]` | `.github/workflows/ci.yml:20` | nothing catches a new macOS-only call |

**Omarchy facts that settle design choices** (`basecamp/omarchy@master`)

- `install/omarchy-base.packages` (210 pkgs) ships **gnome-keyring**, **libsecret**,
  **xdg-desktop-portal-gtk**, **xdg-desktop-portal-hyprland**, **polkit-gnome**, **rust**.
- `install/login/default-keyring.sh` pre-creates an **unlocked** default keyring
  (`lock-on-idle=false`, `lock-after=false`) — so a Secret Service answers on a fresh install.
- **No** zenity, kdialog, webkit2gtk or nodejs in the base package set.
- Node comes from **mise** (`bin/omarchy-npx-install`: `mise use -g node@latest`;
  `omarchy install dev-env node`). A packed build ships its own node and needs none.
- Official `archlinux:*` docker images are **amd64-only**; arm64 needs
  `menci/archlinuxarm:base-devel` (Arch Linux ARM).

---

## 2. Decisions (grilled)

| # | Question | Decision |
|---|---|---|
| D1 | Scope of the first pass | **Dev-mode run first** — the tree runs on Arch before any packaging polish |
| D2 | How we verify | **Docker container on this machine**, find the bugs there, real box afterwards |
| D3 | Container arch | **arm64 native** (`menci/archlinuxarm`) for the bug hunt; one emulated **x86_64 pass at the end** |
| D4 | Depth | Engine + CI suites + boot smoke, **plus `cargo build`** of the Tauri shell, **plus a best-effort Xvfb window smoke** (container compositing failures are reported, not chased) |
| D5 | The three macOS shells | **Fix all three now** |
| D6 | Keyring route | **`secret-tool` rung inside `keyring.js`**, mirroring the `security` rung: same service name, probe on first use, loud in-memory fallback |
| D7 | Folder picker | **XDG portal via `gdbus`** (`org.freedesktop.portal.FileChooser`), **zenity/kdialog fallback** |
| D8 | Supervision | **`systemd --user` units, no sudo** — one for the engine (mirrors the LaunchAgent), one per runner instead of `sudo ./svc.sh install`; `loginctl enable-linger` for reboot survival |
| D9 | Sidecars | **Port `pack-sidecar.mjs` first** — produce a real Linux sidecar, no dev shims |
| D10 | Release format | **Both** — AppImage (updater-compatible, keeps the minisign key and `{{target}}/{{arch}}` endpoint) **and** a PKGBUILD (native `pacman -U` on Arch/Omarchy) |
| D11 | CI | **Arch container job on the existing self-hosted runner** — same image as the dev loop |
| D12 | Commitment | **Second supported platform** — parity for the flows that matter, published artifacts, docs |

---

## 3. Plan

### Phase 0 — the Arch container (arm64)

- `scripts/linux/Dockerfile.arch` on `menci/archlinuxarm:base-devel`, pinned by digest:
  `nodejs npm git base-devel webkit2gtk-4.1 gtk3 libsoup3 librsvg openssl pkgconf
   rust bubblewrap libsecret gnome-keyring dbus xdg-desktop-portal-gtk xorg-server-xvfb`
  plus `bun` (official install script; `bun-bin` is AUR-only and AUR is not
  available in a rootless container build).
- `scripts/linux/bringup.sh` — one script, run inside the container, that reports a
  PASS/FAIL table: node+npm version, `npm ci`, `node scripts/ci.mjs`, `npm run smoke`,
  bwrap probe, `secret-tool` round-trip against a `dbus-run-session` + gnome-keyring,
  portal presence, `cargo build`, Xvfb window smoke.
- The image is the CI lane's image too (D11), so it is committed, not ad hoc.

### Phase 1 — the packer (B2, B3, D9)

- `scripts/pack-manifest.mjs` gains the triple map; `pack-sidecar.mjs` computes
  `<arch>-unknown-linux-gnu` on Linux and keeps `-apple-darwin` on macOS.
- `/usr/bin/tar` → resolve `tar` on PATH (Arch has it at `/usr/bin/tar`, but the
  hardcode is a macOS habit, not a fact).
- Payload node stays `process.execPath` — the packed sidecar therefore carries a
  **glibc** node built in the Arch container. Record the glibc floor in `packed.json`.
- `pack-sidecar --check` gains a triple line so a wrong-arch payload is loud.
- Gate: `scripts/pack-list-check.mjs` extended with the triple mapping.

### Phase 2 — the three shells (D5–D8)

1. **Keyring** — `makeSecretToolBackend()` beside `makeSecurityBackend()`; ladder becomes
   bridge → platform store (`security` on darwin, `secret-tool` on linux) → memory.
   Same usability probe (a throwaway write) so a locked/absent keyring routes to memory
   instead of failing the first real store. Selftest: both backends against an injected runner.
2. **Picker** — `pickFolder()` seam in `arxa-sidebar/lib/index.js`: osascript on darwin,
   `gdbus call org.freedesktop.portal.Desktop … FileChooser.OpenFile` with
   `directory=true` on linux, zenity/kdialog if no portal answers, typed-path error
   message if none of them exist. Selftest against an injected spawner.
3. **Supervision** — `engine_agent.rs` grows a systemd sibling (`engine_unit.rs`):
   render `~/.config/systemd/user/arxa-engine.service`, `systemctl --user daemon-reload`,
   `enable --now`, `restart` for the menu's Restart Engine. `loaded()`/`kickstart()`/
   `ensure()` keep their signatures so `lib.rs` is unchanged apart from the platform pick.
4. **Runner** — `installRunnerService()` writes a `--user` unit running `run.sh` instead of
   `sudo ./svc.sh install`; teardown stops/disables the unit and removes it, with the plist
   path kept behind a darwin guard.

### Phase 3 — the shell (B1, D10)

- `tauri.conf.json`: `targets` per platform, `bundle.linux` with the AppImage block and
  the webkit2gtk/gtk3 dependency list; icons already exist.
- Set `WEBKIT_DISABLE_DMABUF_RENDERER=1` defensively at launch on Linux when unset
  (the standard Nvidia/webkit blank-window fix) — measured on the real box, kept if it matters.
- `packaging/PKGBUILD` wrapping the built binary + sidecars, `depends=(webkit2gtk-4.1 gtk3 …)`.
- Updater: publish under the linux `{{target}}/{{arch}}` path; AppImage only (pacman has no
  updater path — the PKGBUILD's update story is the repo/AUR).

### Phase 4 — verification

- Container: the Phase 0 table, all green, on arm64.
- Container: one emulated `linux/amd64` pass (D3) for the arch-specific halves —
  the SDK's `linux-x64` binary, bun, node.
- Real box: `omarchy install dev-env node`, then dev-mode run and the packaged artifact.

### Phase 5 — keeping it (D11, D12)

- CI job: the Arch image, `npm ci` + `scripts/ci.mjs` + `npm run smoke`, on the self-hosted runner.
- `docs/` note on what Linux supports, what it does not, and the Omarchy dependency list.

---

## 4. Risks named up front

- **Container ≠ Hyprland.** The Xvfb smoke proves the shell spawns the engine and loads a
  page; it proves nothing about Wayland, GPU compositing, HiDPI or the tray. Those wait
  for the real box, and this plan says so rather than implying coverage.
- **Arch Linux ARM ≠ Arch.** Same package names, different build; the x86_64 pass exists
  because of that, and the real box is the arbiter.
- **glibc floor.** A payload packed in the Arch container will not run on an older-glibc
  distro. Fine for Omarchy, a documented limit for anyone else.
- **`svc.sh` divergence.** Replacing GitHub's own service installer with a user unit means
  we own that unit when the runner tarball changes shape.
- **The Windows question stays open.** Doing this properly opens the platform seams
  (keyring backend, picker, supervision) that a Windows port would need next; this plan
  does not build them.
