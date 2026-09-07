#!/usr/bin/env bash
# Run the Linux bring-up (or any command) inside the Arch container.
#
#   scripts/linux/run-container.sh                # full bring-up
#   scripts/linux/run-container.sh engine         # one layer
#   scripts/linux/run-container.sh -- bash        # a shell in the container
#
# The host repos are mounted READ-ONLY at /src and the container works on its own
# copy in a volume (rsync'd by bringup.sh). Two failures forced that shape:
#   * a writable bind mount let `npm ci` replace the macOS node_modules with
#     Linux binaries, breaking the host build;
#   * npm ci onto a docker volume mounted INSIDE the bind mount failed
#     intermittently with ENOTDIR halfway through the install.
# A read-only source mount makes the first impossible and the second moot.
set -euo pipefail

# ARCH selects both the image and the volume set, so the emulated x86_64 pass
# never shares a work tree (or a cargo target) with the native arm64 one.
ARCH=${ARCH:-arm64}
IMAGE=${IMAGE:-arxa-arch:$ARCH}
VOLUME=${VOLUME:-arxa-linux-work-$ARCH}
CARGO_VOL=arxa-linux-cargo-$ARCH
PNPM_VOL=arxa-linux-pnpm-store-$ARCH
NPM_VOL=arxa-linux-npm-cache-$ARCH
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
STUDIO=$(cd "$HERE/../.." && pwd)
PARENT=$(dirname "$STUDIO")

# `--fresh` throws the work volume away first: an interrupted npm ci
# leaves a half-written tree that then fails with ENOTDIR on the next attempt.
if [ "${1:-}" = "--fresh" ]; then
  shift
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
fi
docker volume inspect "$VOLUME" >/dev/null 2>&1 || docker volume create "$VOLUME" >/dev/null
# Idempotent, and cheap: a wrong owner here is the whole failure mode above.
docker run --rm --user root -v "$VOLUME":/mnt "$IMAGE" chown -R builder:builder /mnt

args=(
  --rm
  # bwrap needs unprivileged user namespaces; docker's default seccomp profile
  # blocks the syscalls. This is the container being permissive, not the app.
  --security-opt seccomp=unconfined
  -v "$PARENT":/src:ro
  -v "$VOLUME":/work
  -v "$CARGO_VOL":/home/builder/.cargo
  # Warm package caches. Cold ones are not just slow: dsh's profile bootstrap
  # installs its own dependencies and starts loading plugins, so a store that
  # has to download ~190 packages first loses the race and the engine dies on
  # ERR_MODULE_NOT_FOUND for a stock row.
  -v "$PNPM_VOL":/home/builder/.local/share/pnpm
  -v "$NPM_VOL":/home/builder/.npm
  -w /work/arxa-studio
)

ensure_volumes() {
  for v in "$@"; do
    docker volume inspect "$v" >/dev/null 2>&1 || docker volume create "$v" >/dev/null
    docker run --rm --user root -v "$v":/mnt "$IMAGE" chown -R builder:builder /mnt
  done
}

if [ "${1:-}" = "--" ]; then
  shift
  ensure_volumes "$CARGO_VOL" "$PNPM_VOL" "$NPM_VOL"
  # -t only when this really is a terminal; a piped invocation must not fail.
  [ -t 0 ] && args+=(-it)
  exec docker run "${args[@]}" "$IMAGE" "$@"
fi

# cargo's registry/target volumes are created on demand by docker; chown them
# the same way so a release build is not denied halfway through.
ensure_volumes arxa-linux-cargo arxa-linux-target arxa-linux-pnpm-store arxa-linux-npm-cache

exec docker run "${args[@]}" "$IMAGE" bash /src/arxa-studio/scripts/linux/bringup.sh "${1:-all}"
