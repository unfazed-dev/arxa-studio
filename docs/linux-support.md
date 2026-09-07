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
npm run smoke               # boots the real engine, expects 200 HTML
node scripts/ci.mjs         # the plugin suites
```

## What differs from macOS

| Surface | macOS | Linux |
|---|---|---|
| GitHub token | `/usr/bin/security` (Keychain) | `secret-tool` (libsecret/Secret Service) |
| Folder picker | `osascript choose folder` | `zenity --file-selection --directory`, then `kdialog` |
| Engine supervision | launchd agent (`solutions.arxadigital.arxa.engine`) | `systemd --user` unit `arxa-engine.service` |
| Self-hosted runner service | the runner tarball's `svc.sh` (LaunchAgent) | our own `systemd --user` unit — `svc.sh install` needs sudo on Linux |
| Runner labels | `macOS,ARM64,arxa` | `Linux,X64,arxa` (from the real platform) |
| Packaging | `app` + `dmg` | `appimage` (updater-compatible) + `packaging/PKGBUILD` in the arxa repo |

Both keyring paths keep the loud in-memory fallback: no Secret Service running
means the GitHub token lives for the session only, and the log says so.

The XDG portal is deliberately **not** used for the picker: the portal answers
asynchronously on a Request object path derived from the caller's own bus name,
so a `gdbus call` that exits cannot receive the reply. Driving it properly needs
an in-process D-Bus client — a dependency for one dialog.

## The container harness

`scripts/linux/run-container.sh` builds and runs `scripts/linux/Dockerfile.arch`
(Arch Linux ARM on arm64; the official `archlinux:*` images are amd64-only) and
executes `scripts/linux/bringup.sh`, which prints a PASS/FAIL table for the
toolchain, `npm ci`, the plugin suites, the boot smoke, a real `secret-tool`
round-trip, both sidecar builds, `cargo build`, and a best-effort Xvfb window run.

```sh
scripts/linux/run-container.sh            # everything
scripts/linux/run-container.sh engine     # one layer
scripts/linux/run-container.sh --fresh    # discard the work volume first
scripts/linux/run-container.sh -- bash    # a shell in the container
```

The host repos are mounted **read-only** at `/src`; the container rsyncs them
into its own volume. That is deliberate: a writable bind mount let a container
`npm ci` replace the host's darwin `node_modules` with Linux binaries, and an
npm install onto a volume nested inside the bind mount failed intermittently
with `ENOTDIR`.

Two container-only limits, neither a code fault: unprivileged user namespaces
are unavailable, so the `bwrap` probe is skipped, and there is no Secret Service
unless one is started inside the run.
