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


---

## 5. Execution log — 2026-09-07

### What the port found (product bugs, not container quirks)

| # | Bug | Where | Why it mattered |
|---|---|---|---|
| B1 | **Unbounded keychain probe hung the engine at boot.** `security add-generic-password` blocks forever when the HOME it is given has no login keychain; the probe is a `spawnSync` on the boot path. Caught with a 70-second-old `security` child and nothing on the port. | `plugins/github-link/lib/keyring.js` | macOS too — any user whose login keychain is locked or absent gets an app that never starts. Now bounded (`PROBE_TIMEOUT_MS = 2000`) and falls back to memory. |
| B2 | **A developer's absolute `/Volumes/...` path in the shipped profile.** The arxa-gate row named the harness by hand. | `profile/cordis.patch.yml` | The engine dies with `ERR_MODULE_NOT_FOUND` on every machine that is not this one — including a packed build on another Mac. Now `__ARXA_REPO__`, resolved by the launcher, and pack-sidecar ships the harness files. |
| B3 | **`svc.sh install` needs sudo on Linux** and the teardown removed a LaunchAgent plist unconditionally; runner labels were hardcoded `macOS,ARM64`. | `plugins/github-link/lib/runner.js` | A Linux runner advertised itself as a Mac and its service install prompted for root out of a GUI app. Now a `systemd --user` unit and real labels. |
| B4 | **A test that only passed because APFS is case-insensitive.** `softDelete(orgA.path, 'projects/doomed')` while D79 slugging produces `Doomed`. | `plugins/file-org-shell/selftest.mjs` | Green on macOS, red on ext4. The fixture now takes the path from `newProject`. |
| B5 | **The locale package gate hashed filenames in ICU collation order** (`localeCompare`), so the same package hashed differently per node build; and the pin itself had been taken against a damaged tree missing a file. | `plugins/locale/selftest.mjs` | Byte-stable order now, pinned to the complete 16-file published tree — verified identical on macOS and Arch. |
| B6 | **Nothing pinned pnpm**, and dsh resolves its stock rows against the layout pnpm produces. pnpm 10 vs 11 hoists differently and the engine died on `ERR_MODULE_NOT_FOUND` for `@deepseek-ai/dsh-commands`. | `package.json` | `packageManager: pnpm@11.21.0`, and the container matches. |
| B7 | **npm 12 blocks install scripts by default**, so `node-pty`, `koffi`, `esbuild`, `protobufjs` and dsh's spawn helper silently never built. | `package.json` `allowScripts` | A fresh clone on any npm-12 machine (Omarchy gets node from mise, so npm 12 is likely) had no working pty. The five are approved by name; `edgedriver`/`geckodriver` deliberately are not. |
| B8 | **The boot smoke could not tell a dead launcher from a slow one** — every failure read "never printed its token URL". | `scripts/engine-boot-smoke.mjs` | It now reports the exit code and the child's last words, and `ARXA_SMOKE_LAUNCHER` points the same gate at the packed sidecar. |
| B9 | **The packed sidecar's first boot was never logged.** Packed mode opens `<DSH_HOME>/engine.log` before anything creates `<DSH_HOME>`, so `openSync` threw ENOENT into a silent catch. | `bin/arxa-studio.mjs` | Every installed app's FIRST run — the one users report — produced no log at all, on both platforms. Found by pointing the boot smoke at the packed binary. Now `mkdirSync` first. |
| B10 | **`allowScripts` pins by exact version**, so the next dsh wave bump leaves keys matching nothing and `node-pty`/`koffi` silently stop being built while `npm ci` exits 0. | `scripts/dsh-contract-check.mjs` | Not yet bitten; the gate now asserts every `allowScripts` key names the version actually installed. |
| B11 | **One 2-second probe decided the keyring backend for the whole session.** A login keychain still locked at boot, or a Secret Service that starts after the engine, pinned the GitHub token to memory until the app was restarted. | `plugins/github-link/lib/keyring.js` | A working store is still cached for the process; a FAILED probe now expires after 60s and is retried. |

### Harness lessons (container, not product)

- Arch's official image is amd64-only → `menci/archlinuxarm:base-devel` on arm64.
- pacman 7 fences downloads with Landlock, which a container build cannot apply — `DisableSandbox` in `pacman.conf`, or every install reads as "failed to synchronize databases".
- **The host tree must be read-only.** A writable bind mount let a container `npm ci` (which starts by deleting `node_modules`) wipe and then replace the macOS install with Linux binaries — twice, the second time while the first was still being diagnosed. The harness now mounts the repos at `/src:ro` and rsyncs into a container volume.
- bun installs through npm need `--allow-scripts=bun` (its postinstall IS the binary download).
- **Never run the harness script straight off the host mount.** bash reads a
  script incrementally by byte offset, so editing `bringup.sh` while a pass was
  running dropped the container into the middle of a line ("syntax error near
  unexpected token" at step 9) and cost the whole result table.
  `run-container.sh` now copies it to `/tmp` and runs the copy.

### Where it stands

`scripts/linux/run-container.sh all`, arm64 Arch — **15 PASS, 0 FAIL, 1 SKIP**:

| Layer | Result |
|---|---|
| toolchain, `/usr/bin/{secret-tool,zenity,bwrap,tar}` | PASS |
| `npm ci` (890 packages, native modules built) | PASS |
| plugin suites (`scripts/ci.mjs`) | PASS — 83 green |
| **engine boot smoke — 200 HTML from the real engine** | **PASS (2s)** |
| `secret-tool` round-trip against gnome-keyring | PASS — real libsecret |
| `pack-cli` → `arxa-aarch64-unknown-linux-gnu` | PASS — 12.8 MB |
| `pack-sidecar` → `arxa-studio-aarch64-unknown-linux-gnu` | PASS — 276 MB |
| **packed sidecar boot smoke — the shipped binary, same 200 HTML gate** | **PASS (4s)** |
| `cargo build` of the Tauri shell against webkit2gtk 2.52 | PASS — 42 MB |
| `cargo test engine_unit` — the systemd unit renderer | PASS — 3 tests (macOS can never run these) |
| **shell under Xvfb: full launch flow** | **PASS** — probe → systemd attempt → detached fallback → `engine sidecar spawned (pid 121)` → keyring `secret-tool store` |
| bwrap sandbox | SKIP — no unprivileged user namespaces in the container |

macOS after every change: 83 suites ALL GREEN, boot smoke OK.

### Fixed 2026-09-07: the payload no longer ships devDependencies

Extracting both darwin payloads (2026-09-07) put the shipped tree at 753 MB, up
from 609 MB. Two causes, only one of them wanted:

- `plugins/artifact-viewer/lib/monaco-build/dist` — **+32 MB, wanted.** That
  bundle is gitignored and built by `npm run build` in `monaco-build`, so it is
  host state — but `scripts/pack-sidecar.mjs` refuses to pack without
  `dist/arxa-monaco.js`, so a payload can never ship without it. What the two
  payloads show is a fuller bundle than the earlier one, not a fixed break.
- `node_modules` — **every devDependency.** `pack-sidecar.mjs` tarred the whole
  tree, so every test tool rode along into every install and every update.

Measured, then removed: **290 top-most dev-only dirs, 87.3 MB uncompressed**
(esbuild 10.2, `@esbuild/darwin-arm64` 10.1, `@zip.js/zip.js` 7.3, rxjs 4.3,
webdriver 3.8, webdriverio 3.8, cheerio 2.5 …). The darwin sidecar went
**263.9 MB → 241.0 MB** — the payload is gzipped, so the binary shrinks by less
than the raw total.

The mechanism is three lines of tar; the care is all in the two questions
around it.

**"What is dev-only?"** — `devOnlyDirs()` in `scripts/pack-manifest.mjs` diffs
`npm ls --parseable --all` against the same with `--omit=dev` and keeps the
top-most dirs (excluding a dir takes its children). The hazard is not a
non-zero exit (npm ls reports extraneous deps that way, routinely) but
**truncated stdout**: a short keep set makes the complement swallow production
trees. So every direct `dependencies` key plus `@deepseek-ai/dsh` must appear
in the keep set or it throws rather than computing an exclude list.

**"Does anything actually load it?"** — this is the one that could ship a
broken app. cordis resolves plugins BY NAME from the profile at boot, so a
dropped-but-referenced package is not a build error; it is a stock row that
dies on `ERR_MODULE_NOT_FOUND` after the user installs. `devOnlyImports()`
scans bare specifiers in `bin/ plugins/ pi/ profile/` **and `- id:` rows in the
profile YAML** — the YAML half matters, and a first cut that scanned every
lowercase word in the YAML produced two false positives (the words "process"
and "events" are both npm packages in the dev-only tree). Live answer today: 0
references. It runs in `pack-sidecar` (fatal), in `--check`, and as CI suite
`scripts/pack-list-check.mjs` — where it goes red the day a plugin imports
something only `@wdio/cli` installs.

**The tar flags are never trusted.** macOS is bsdtar, the container is GNU tar,
and both failure directions are silent: a no-op exclude (nothing saved, and we
would report a saving that did not happen) and an over-broad one (a payload
missing a prod tree). So the packer lists the tarball it just wrote and asserts
zero members under any dropped dir plus the presence of
`arxa-studio/node_modules/@deepseek-ai/dsh/lib/bin.js`. Live: 30 466 members,
0 leaked.

Then the live half: packed boot smoke on the trimmed binary, macOS 11s.

### Fixed 2026-09-07: the new gates are wired to CI, by repo

Both gates added on 2026-09-06 (packed boot smoke, `cargo test engine_unit`)
ran only on a manual `run-container.sh all`. They now have homes, chosen by
where the artifact lives rather than by which repo the harness sits in:

- **`cargo build` + `cargo test engine_unit`** → arxa `desktop-gate.yml`, new
  job `linux-engine-unit`. The Rust is in arxa, so an `engine_unit.rs` change
  is an arxa commit; that repo already holds `ARXA_STUDIO_CHECKOUT_TOKEN`, so
  it can check both repos out as siblings the way `run-container.sh` expects.
  It runs the `shell` layer only, on its own work volume (`VOLUME=
  arxa-ci-work-arm64`) so a CI rsync can never land inside a local bring-up.
- **Packed boot smoke** → arxa `desktop-release.yml`, straight after
  `pack-sidecar`. The binary is already built there, so the gate costs ~15 s
  and covers exactly the artifact that ships. On port **7931**, not the 7919
  default: the self-hosted runner is also the operator's dev machine.
- arxa-studio's own `ci.yml` stays **engine-only**. Nothing there needs the
  sibling repo or a token.

Say it plainly: this makes the packed smoke a **release** gate, not a branch
gate. A push that breaks the packed artifact still goes red at tag time or on a
manual `all` pass, not on the PR.

Two things the wiring exposed:

- **`desktop-release.yml` would have failed on the next tag.** It runs
  `npm install` then `pack-sidecar.mjs`, and nothing built the monaco bundle —
  which `pack-sidecar` has refused to pack without since the guard landed. A
  build step in `monaco-build` now precedes the sidecar build.
- **The `shell` layer could not run without a monaco `dist/`.** It pre-builds
  any missing sidecar by calling `pack-sidecar`, which refuses. But cargo only
  needs FILES at the `externalBin` paths — it never runs them — so when the
  dist is absent, `bringup.sh` now calls arxa's own
  `desktop/scripts/dev-stub-sidecars.sh` instead. Step 7b skips anything under
  1 MB so a stub can never be mistaken for a packed artifact.

Two container-only obstacles were traced and fixed in the harness, not the app:
the shell needs a **session bus** (it talks to the a11y bus and the XDG portal
before its own first log line), and Docker created `~/.local/share` as root to
host a cache volume, so Tauri could not create its app data dir — traced with
`strace` to `mkdirat(".../solutions.arxadigital.arxa") = EACCES`.

### Fixed 2026-09-07: the PKGBUILD installed an app that would spawn itself

Nobody had ever run `makepkg`. Doing so found a real break, not a rough edge.

`src/lib.rs::sidecar_path()` is `dirname(current_exe()) / "arxa-studio"` —
beside the executable, under the plain name Tauri gives an `externalBin`. The
PKGBUILD installed the **shell** as `/usr/bin/arxa-studio` and the sidecars as
`/usr/lib/arxa-studio/arxa-studio-<triple>`. So the installed app computed its
engine path as `/usr/bin/arxa-studio` — itself. Two bugs in one destination:
wrong directory, and the target triple kept in a filename Tauri strips.

Now: shell at `/usr/lib/arxa-studio/arxa-desktop`, both sidecars beside it
under their plain names, `/usr/bin/arxa-studio` a symlink into that dir (safe:
`current_exe()` reads `/proc/self/exe`, so it resolves to the real file).

Proven end to end in the container rather than argued:

| Step | Result |
|---|---|
| `makepkg -f --nodeps` | `arxa-studio-0.1.1-1-aarch64.pkg.tar.xz`, 212 MB |
| `pacman -U` | installs; `/usr/bin/arxa-studio → /usr/lib/arxa-studio/arxa-desktop` |
| run the INSTALLED binary under Xvfb, as a normal user | `spawning engine sidecar` → `engine sidecar spawned (pid 119)` |
| the payload | extracted to `~/.arxa/engine/15725d73bc0f` — the same sha the container's own pack-sidecar wrote |
| the engine | published `desktop-session.json`, `[arxa-boot] state first served in 1ms` |
| the UI | artifact-viewer trace: monaco 10.2 MB loaded, DCL 95 ms, load 1083 ms — the studio rendered in WebKit |

`systemctl --user daemon-reload` failed (no systemd in a container) and the
shell took its detached fallback, exactly as designed.

New harness layer `scripts/linux/run-container.sh package`: runs `makepkg` and
asserts the layout from the package's own file list — the shell and both
sidecars in one dir, sidecars under plain names, `/usr/bin` a symlink and never
the shell. That assertion is what would have caught this on day one.

Still untested: **AppImage**. It is in `bundle.targets` and nothing has ever run
`tauri build --bundles appimage`; Tauri's bundler downloads `linuxdeploy` at
build time, so it needs network and has never been exercised.

### Tried 2026-09-07: the AppImage does not work, for two proven reasons

`npx @tauri-apps/cli@^2 build --bundles appimage` in the arm64 Arch container.
arm64 is NOT the problem — `AppRun-aarch64` and `linuxdeploy-aarch64.AppImage`
both exist and downloaded fine, and the AppDir was assembled with every webkit
library and both sidecars in place. Two things stop it, and the second is the
one that matters.

**1. Tauri's GTK plugin is broken on current Arch.** `linuxdeploy-plugin-gtk.sh`
unconditionally copies `/usr/lib/gdk-pixbuf-2.0/2.10.0`. Arch's
`gdk-pixbuf2 2.44.6-2` has no `/usr/lib/gdk-pixbuf-2.0` directory at all, so the
`cp` fails, the plugin exits 1, linuxdeploy fails, and no AppImage is produced:

```
[gtk/stderr] cp: cannot stat '/usr/lib/gdk-pixbuf-2.0/2.10.0': No such file or directory
ERROR: Failed to run plugin: gtk (exit code: 1)
failed to bundle project: `failed to run …/linuxdeploy-aarch64.AppImage`
```

Distro-specific, and Omarchy is Arch, so the real box hits it too.

**2. linuxdeploy patchelfs the engine sidecar, and that kills it.** This one is
fatal regardless of distro. linuxdeploy rewrites the RUNPATH of every ELF it
finds in the AppDir, including our 266 MB bun-compiled self-extracting sidecar:

| | original | after linuxdeploy |
|---|---|---|
| size | 266 455 336 | 266 520 872 (+64 KB exactly) |
| RUNPATH | none | `$ORIGIN/../lib` |
| first differing byte | — | 43 (the ELF header) |
| `--no-open` | prints its URL, serves | **exit 139 (SIGSEGV), silently** |

The sidecar finds its embedded tar payload by file offset. patchelf grows the
headers, every offset moves, and the binary segfaults before printing anything.
`options=('!strip')` in the PKGBUILD protects the pacman path from the same
class of damage; nothing protects the AppImage path, because the damage is not
strip.

**So the AppImage lane needs a decision, not a fix** (D10 is worth revisiting):

- Drop AppImage, ship the PKGBUILD (proven) and optionally `.deb` (Tauri's deb
  bundler copies files; it does not run linuxdeploy, so it is not exposed to
  either problem). Cost: Tauri's Linux updater only understands AppImage, so
  Linux loses auto-update and updates become "pacman -U the new package".
- Keep AppImage and stop shipping the engine as an `externalBin` on Linux —
  fetch or extract it at first run instead. Large change to the packed-sidecar
  design, and the packed smoke would need a new shape.
- Keep AppImage and stop using a self-extracting binary on Linux (plain payload
  dir + the pinned node). Also large, and it gives up the one-file property the
  packer exists for.

Not attempted: hand-assembling an AppImage around linuxdeploy, or `mkdir`-ing
the missing gdk-pixbuf path to get past problem 1. Both produce a green that
does not mean anything while problem 2 stands.

### x86_64 pass (D3) — done, emulated

`ARCH=amd64 scripts/linux/run-container.sh --fresh engine` on `archlinux:base-devel`
under qemu: toolchain, `/usr/bin/{secret-tool,zenity,bwrap,tar}`, `npm ci`, the
**engine boot smoke (200 HTML, 20s under emulation)** and a real libsecret
round-trip all PASS. One RED, `plugins/sandbox/selftest.mjs`, is the container
limit already recorded: with no unprivileged user namespaces there is no usable
bwrap/Landlock backend, and the sandbox **refuses to run the command unconfined**
(`SandboxUnavailableError`) — the designed behaviour, and the same reason the
bwrap probe is skipped. Nothing arch-specific broke.

### Still to do
- The real machine: Hyprland, GPU compositing, HiDPI, the tray, and a genuine
  `systemd --user` engine unit (the container has no systemd, so the fallback
  path is what ran). The PKGBUILD install itself is now proven in the container.
- **AppImage: a D10 decision, not a task.** Built and tested 2026-09-07; it is
  blocked by linuxdeploy patchelfing the engine sidecar into a segfault (and, on
  Arch, by the gtk plugin). Three ways out are listed above; none is a small fix.
- The two new arxa-repo CI steps (monaco build + packed smoke in
  `desktop-release.yml`, `linux-engine-unit` in `desktop-gate.yml`) are wired but
  have not yet run on the runner — the first release tag and the first
  `desktop/**` PR are their first live pass.
- `arxa/desktop` has no `.desktop`-file or icon story beyond the PKGBUILD entry.
