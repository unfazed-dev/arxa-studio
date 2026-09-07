#!/usr/bin/env bash
# Run the Linux bring-up (or any command) inside the Arch container.
#
#   scripts/linux/run-container.sh                # full bring-up
#   scripts/linux/run-container.sh engine         # one layer
#   scripts/linux/run-container.sh -- bash        # a shell in the container
#
# The one thing this script exists to get right: node_modules must be a
# CONTAINER-OWNED volume, not the host's tree. A docker-created volume mounts
# root-owned, the container user cannot write it, and the write then lands on
# the bind-mounted host tree instead — which replaces the macOS install with
# Linux binaries and breaks the host build. So the volume is created and chowned
# here before anything runs, and bringup.sh refuses a tree that looks like the
# host's.
set -euo pipefail

IMAGE=${IMAGE:-arxa-arch:arm64}
VOLUME=${VOLUME:-arxa-linux-node-modules}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
STUDIO=$(cd "$HERE/../.." && pwd)
PARENT=$(dirname "$STUDIO")

# `--fresh` throws the node_modules volume away first: an interrupted npm ci
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
  -v "$PARENT":/work
  -v "$VOLUME":/work/arxa-studio/node_modules
  -v arxa-linux-cargo:/home/builder/.cargo
  -v arxa-linux-target:/work/arxa/desktop/src-tauri/target
  # Warm package caches. Cold ones are not just slow: dsh's profile bootstrap
  # installs its own dependencies and starts loading plugins, so a store that
  # has to download ~190 packages first loses the race and the engine dies on
  # ERR_MODULE_NOT_FOUND for a stock row.
  -v arxa-linux-pnpm-store:/home/builder/.local/share/pnpm
  -v arxa-linux-npm-cache:/home/builder/.npm
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
  ensure_volumes arxa-linux-cargo arxa-linux-target arxa-linux-pnpm-store arxa-linux-npm-cache
  # -t only when this really is a terminal; a piped invocation must not fail.
  [ -t 0 ] && args+=(-it)
  exec docker run "${args[@]}" "$IMAGE" "$@"
fi

# cargo's registry/target volumes are created on demand by docker; chown them
# the same way so a release build is not denied halfway through.
ensure_volumes arxa-linux-cargo arxa-linux-target arxa-linux-pnpm-store arxa-linux-npm-cache

exec docker run "${args[@]}" "$IMAGE" bash /work/arxa-studio/scripts/linux/bringup.sh "${1:-all}"
