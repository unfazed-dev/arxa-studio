# Running arxa studio on Linux (Omarchy / Arch)

Status: **engine + plugin suites run on Arch**; the desktop shell builds and is
verified only headlessly. Hyprland, GPU compositing and HiDPI are unproven —
they need the real machine. Plan and decisions: `docs/plans/linux-omarchy-port.md`.

## What a machine needs

Omarchy already ships **gnome-keyring**, **libsecret**, **xdg-desktop-portal-gtk**,
**xdg-desktop-portal-hyprland**, **polkit-gnome** and **rust**, and its installer
creates an unlocked default keyring. What it does not ship, and arxa needs:

| Package | Why |
|---|---|
| `nodejs` `npm` (Omarchy: `omarchy install dev-env node`, i.e. mise) | the engine is node; a PACKAGED build ships its own node and needs none |
| `pnpm` (`npm i -g pnpm`, version pinned in package.json) | checkout mode installs the profile's `file:` plugins with it; without it the engine cannot start |
| `webkit2gtk-4.1` `gtk3` `libsoup3` `librsvg` | the Tauri shell's runtime |
| `zenity` | the "choose a folder" dialog (first run picks the org root) |
| `bubblewrap` | the sandbox around every agent tool call |
| `base-devel` `python` | native modules (`node-pty`, `koffi`) when no prebuilt matches |

## Dev-mode run

```sh
npm ci                      # needs the allowScripts entries in package.json
(cd plugins/artifact-viewer/lib/monaco-build && npm ci && npm run build)
                            # gitignored bundle; pack-sidecar REFUSES without it
npm run smoke               # boots the real engine, expects 200 HTML
node scripts/ci.mjs         # the plugin suites

# the same gate against the artifact that actually ships:
ARXA_SMOKE_LAUNCHER=../arxa/desktop/src-tauri/binaries/arxa-studio-$(uname -m)-unknown-linux-gnu \
  npm run smoke
```

## Installing it

Two proven routes: the **AppImage** (any distro with glibc ≥ 2.35 — Ubuntu
22.04+, Debian 12+, Fedora 36+, Arch/Omarchy) and the **Arch package**.

**AppImage.** Build it on the Ubuntu 22.04 image, never on Arch (see below):

```sh
docker build -f scripts/linux/Dockerfile.ubuntu -t arxa-ubuntu:arm64 scripts/linux
DISTRO=ubuntu scripts/linux/run-container.sh        # → …/bundle/appimage/Arxa Studio_0.1.1_aarch64.AppImage
chmod +x "Arxa Studio_0.1.1_aarch64.AppImage" && ./"Arxa Studio_0.1.1_aarch64.AppImage"
```

Needs `fuse2` on the host (Arch/Omarchy: `pacman -S fuse2`), or run it with
`--appimage-extract-and-run`. **Proven in the arm64 Ubuntu container,
2026-09-07:** 320 MB image; the engine inside it is byte-identical to the
packed input and boots through the same smoke gate as the checkout engine; the
image itself under Xvfb spawns that engine and extracts it to
`$ARXA_HOME/engine/<sha>`.

**Arch package.** It packages an already-built tree, so build first on the
machine and arch you are packaging for — the engine sidecar embeds the build
host's node:

```sh
cd arxa-studio && npm ci
(cd plugins/artifact-viewer/lib/monaco-build && npm ci && npm run build)
node scripts/pack-cli.mjs && node scripts/pack-sidecar.mjs
cd ../arxa/desktop/src-tauri && cargo build --release
cd ../packaging && makepkg -si
```

**Proven in the arm64 Arch container, 2026-09-07:** `makepkg` produces
`arxa-studio-0.1.1-1-aarch64.pkg.tar.xz` (212 MB), `pacman -U` installs it, and
the installed `/usr/bin/arxa-studio` under Xvfb spawns its engine, extracts the
payload to `~/.arxa/engine/<sha>`, publishes `desktop-session.json`, and loads
the studio UI in WebKit (the artifact viewer's 10 MB monaco bundle included).

**The layout is load-bearing.** On Linux the engine lives at
`/usr/libexec/arxa-studio/arxa-studio` in all three formats (AppImage, deb,
PKGBUILD); `src/lib.rs::sidecar_path()` looks there first
(`dirname(current_exe())/../libexec/arxa-studio/`), then beside the executable
under the plain name (macOS, `tauri dev`). Why libexec: linuxdeploy patchelfs
every ELF under `usr/bin` and `usr/lib` while building the AppImage and the
self-extracting engine does not survive that (below). The shell binary must
also NOT be `/usr/bin/arxa-studio`, or it resolves its own path as its engine
and spawns itself: the shell and the CLI live in `/usr/lib/arxa-studio/`,
`/usr/bin/arxa-studio` is a symlink (safe: `current_exe()` reads
`/proc/self/exe`). `scripts/linux/run-container.sh package` asserts that layout
from the package's own file list; the `appimage` layer asserts the AppDir's.

**AppImage: what broke on the first attempt, and the two rules that fix it.**

1. linuxdeploy runs `patchelf --set-rpath` on every dynamically-linked ELF in
   `usr/bin` and (recursively) `usr/lib`, whether or not it deployed the file
   (`linuxdeploy/src/core/appdir.cpp`, `listExecutables` / `listSharedLibraries`;
   no exclude flag, `NO_STRIP` does not cover it). Tauri copies every
   `externalBin` into `usr/bin` first. The bun-compiled engine does not survive
   the rewrite: patchelf prepends a 64 KB PT_LOAD to hold the grown `.dynamic`
   and shifts every later file offset by 0x10000; bun (1.4.2 here, ≥ 1.3.12 maps
   its payload via a PT_LOAD converted from PT_GNU_STACK) then reads the wrong
   bytes and segfaults. Reproduced with a bare `patchelf --set-rpath` on a
   clean copy; `strip` is harmless; `--remove-rpath` does not recover it;
   oven-sh/bun#4103 is the same class, closed unfixed. The Dart CLI takes the
   same patch and runs. **Rule: the engine ships via
   `src-tauri/tauri.linux.conf.json` (`appimage.files` + `deb.files`) at
   `/usr/libexec/arxa-studio/`, and is NOT an `externalBin` on Linux.**
   `scripts/pack-sidecar.mjs` writes the plain-named copy that map needs.
2. `linuxdeploy-plugin-gtk.sh` copies the gdk-pixbuf loaders dir pkg-config
   names; Arch builds the loaders into the library and has no such dir, so the
   plugin exits 1. Tauri's guidance is to build AppImages on the oldest base you
   support anyway, because the build host's glibc is the floor for every user
   (`v2.tauri.app/distribute/appimage`, "Limitations"). **Rule: AppImages are
   built on `scripts/linux/Dockerfile.ubuntu` (22.04, glibc 2.35).** The Arch
   image reports the `appimage` layer as SKIP by design.

`.deb` shares the same `files` map and the same layout, but has not been
tested. The updater stays AppImage-only (D10); note Tauri's CLI does sign
`.deb`/`.rpm` too (`tauri-cli/src/bundle.rs`, `sign_updaters`) if that ever
changes.

## What differs from macOS

| Surface | macOS | Linux |
|---|---|---|
| GitHub token | `/usr/bin/security` (Keychain) | `secret-tool` (libsecret/Secret Service) |
| Folder picker | `osascript choose folder` | `zenity --file-selection --directory`, then `kdialog` |
| Engine supervision | launchd agent (`solutions.arxadigital.arxa.engine`) | `systemd --user` unit `arxa-engine.service` |
| Self-hosted runner service | the runner tarball's `svc.sh` (LaunchAgent) | our own `systemd --user` unit — `svc.sh install` needs sudo on Linux |
| Runner labels | `macOS,ARM64,arxa` | `Linux,X64,arxa` (from the real platform) |
| Packaging | `app` + `dmg` | `packaging/PKGBUILD` (proven). `appimage` is configured but BROKEN — see below |

Both keyring paths keep the loud in-memory fallback: no Secret Service running
means the GitHub token lives for the session only, and the log says so.

The XDG portal is deliberately **not** used for the picker: the portal answers
asynchronously on a Request object path derived from the caller's own bus name,
so a `gdbus call` that exits cannot receive the reply. Driving it properly needs
an in-process D-Bus client — a dependency for one dialog.

## The container harness

`scripts/linux/run-container.sh` runs `scripts/linux/bringup.sh` inside one of
two images and prints a PASS/FAIL table for the toolchain, `npm ci`, the plugin
suites, the boot smoke, a real `secret-tool` round-trip, both sidecar builds,
the **same boot smoke driven through the packed sidecar**, `cargo build`,
`cargo test` of the systemd unit renderer (that module is
`#[cfg(target_os = "linux")]`, so macOS can never run its tests), a best-effort
Xvfb window run, and then the packaging layer the image is for:

| image | `DISTRO` | lane | packaging layer |
|---|---|---|---|
| `Dockerfile.arch` (Arch Linux ARM; the official `archlinux:*` images are amd64-only) | `arch` (default) | dev loop, what Omarchy runs | `package`: makepkg + layout assertion |
| `Dockerfile.ubuntu` (Ubuntu 22.04, glibc 2.35) | `ubuntu` | release artifacts | `appimage`: tauri build, AppDir assertions, engine boot from the extracted image, the image under Xvfb |

Each lane has its own work and cargo volumes (different glibc, never shared).

```sh
scripts/linux/run-container.sh            # everything on Arch (arm64, native)
DISTRO=ubuntu scripts/linux/run-container.sh          # everything on Ubuntu, incl. the AppImage
DISTRO=ubuntu scripts/linux/run-container.sh appimage # just the AppImage layer
ARCH=amd64 scripts/linux/run-container.sh engine   # x86_64 under qemu (slow)
scripts/linux/run-container.sh engine     # one layer
scripts/linux/run-container.sh --fresh    # discard the work volume first
scripts/linux/run-container.sh -- bash    # a shell in the container
```

The host repos are mounted **read-only** at `/src`; the container rsyncs them
into its own volume. That is deliberate: a writable bind mount let a container
`npm ci` replace the host's darwin `node_modules` with Linux binaries, and an
npm install onto a volume nested inside the bind mount failed intermittently
with `ENOTDIR`.

Three workflows split the gates by where the artifact lives:

| Gate | Runs in | On |
|---|---|---|
| engine layer on Arch (`npm ci`, suites, boot smoke, keyring) | arxa-studio `ci.yml` | every push / PR |
| `cargo build` + `cargo test engine_unit` (the systemd unit renderer) | arxa `desktop-gate.yml`, job `linux-engine-unit` | PRs touching `desktop/**` |
| packed-sidecar boot smoke — the binary that actually ships | arxa `desktop-release.yml` | release tags |

The Rust gates live in the arxa repo because the Rust does; that repo already
holds the `ARXA_STUDIO_CHECKOUT_TOKEN` needed to put both repos side by side
the way `run-container.sh` expects. Sidecars are **stubbed** in that job
(`desktop/scripts/dev-stub-sidecars.sh`): cargo needs files at the `externalBin`
paths, not working engines, and a CI checkout has no monaco `dist/`.

Being plain about the last row: the packed smoke gates a **release**, not a
branch. A push that breaks the packed artifact goes red at tag time or on a
manual `scripts/linux/run-container.sh all`, not on the PR.

Two container-only limits, neither a code fault: unprivileged user namespaces
are unavailable, so the `bwrap` probe is skipped, and there is no Secret Service
unless one is started inside the run.
