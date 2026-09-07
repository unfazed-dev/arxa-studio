# Linux install script and `curl | sh` distribution

Date: 2026-09-08. Follows `linux-omarchy-port.md` (AppImage and `.deb` proven
in the container harness on both arches; no Linux release published yet).

## Problem

Getting the AppImage onto a real machine meant extracting it from a Docker
volume and scp-ing it, then hand-installing packages. Too many steps, and
none of them is the path a user will ever take.

## Decisions

| # | Decision | Why |
|---|----------|-----|
| 1 | Installer is a POSIX `sh` script, source of truth `arxa/desktop/scripts/install.sh` | Lives beside the release pipeline that publishes it. dash-compatible so `curl … \| sh` works on Debian. |
| 2 | Published copy at the root of the public `unfazed-dev/arxa-releases` repo | arxa-studio is private, so nothing can be curled from it. arxa-releases already serves `latest.json`. One-liner: `curl -fsSL https://raw.githubusercontent.com/unfazed-dev/arxa-releases/main/install.sh \| sh` |
| 3 | The script reads the updater manifest `desktop/<channel>/linux/<arch>/latest.json` for the AppImage URL | Installer and in-app updater agree on what "latest" is. `ARXA_CHANNEL=beta` switches feed. |
| 4 | Every Linux release asset gets a sibling `<asset>.sha256`; the installer verifies it | Cheap integrity check with only `sha256sum`. The minisign `.sig` stays for the updater. |
| 5 | Per-user install: `~/.local/share/arxa-studio/arxa-studio.AppImage`, `~/.local/bin/arxa-studio`, `.desktop` + icon under `~/.local/share` | No root for the app itself; user-writable so the in-app updater can replace the file. |
| 6 | Root only for distro packages: Arch `fuse2 zenity gnome-keyring libsecret bubblewrap`; Debian `libfuse2(t64) zenity gnome-keyring libsecret-tools bubblewrap`; Fedora, openSUSE equivalents | These are what the engine shells out to (`secret-tool`, `zenity`, `bwrap`) plus the FUSE 2 the AppImage runtime mounts with. `ARXA_SKIP_DEPS=1` opts out. |
| 7 | AppImage everywhere, no `.deb` branch in the installer | One code path; the updater only works on the AppImage anyway. |
| 8 | `ARXA_STUDIO_APPIMAGE=<file\|url>` override | Lets the harness and the Omarchy box test the script before a release exists. |
| 9 | Hand-published Linux preview release `linux-preview-0.1.1` on arxa-releases with the container-built images, both arches, and a `beta` manifest with a placeholder signature | Gives the box something to install today. The next `studio-*` tag's `release-linux` run replaces it with a signed x86_64 image. arm64 stays local-build only. |

## Work

1. `arxa/desktop/scripts/install.sh` (new).
2. `arxa/.github/workflows/desktop-release.yml`: `release-linux` writes
   `<asset>.sha256` for the AppImage and `.deb`, uploads them, and copies
   `install.sh` to the arxa-releases root in the manifest push.
3. Publish the preview release and the `desktop/beta/linux/{x86_64,aarch64}/latest.json`
   manifests plus `install.sh` and a README one-liner on arxa-releases `main`.
4. Test: `sh -n` under dash; full run as root in a fresh `ubuntu:22.04`
   container (apt path, local-file override, then the real network path
   against the preview release); `--uninstall`.
5. `docs/linux-support.md`: "Installing it" leads with the one-liner.

## Still to do

- Run the one-liner on the Omarchy box (`ARXA_CHANNEL=beta` until a stable
  Linux release exists) and send the log.
- First live `release-linux` pass on the next `studio-v*` tag, which also
  publishes the first signed stable Linux manifest.
- macOS variant of the script; Windows needs a PowerShell twin.
