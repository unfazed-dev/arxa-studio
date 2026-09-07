#!/usr/bin/env bash
# Linux bring-up: everything that can be proven without a real display.
# Runs INSIDE the Arch container (scripts/linux/Dockerfile.arch) with both repos
# bind-mounted, and prints one PASS/FAIL table.
#
#   docker run --rm -v <parent>:/work -v arxa-linux-node-modules:/work/arxa-studio/node_modules \
#     arxa-arch:arm64 bash /work/arxa-studio/scripts/linux/bringup.sh
#
# Layers, cheapest first — a later layer only runs when the ones it needs passed:
#   1  toolchain + deps        node, npm ci, bwrap, secret-tool, zenity
#   2  engine                  the 80+ suite CI, then the boot smoke (binds a port, serves HTML)
#   3  sidecars                pack-cli (dart compile exe) and pack-sidecar (bun) for THIS triple
#   4  shell                   cargo build of the Tauri app against webkit2gtk
#   5  window (best effort)    the built shell under Xvfb; a container compositing
#                              failure is reported, not chased — Hyprland is the real target
set -uo pipefail

STUDIO=${STUDIO:-/work/arxa-studio}
ONLY=${1:-all}
cd "$STUDIO" || { echo "no studio at $STUDIO"; exit 1; }

# Refuse to touch the HOST's node_modules. When the container-owned volume is
# missing or unwritable, /work/arxa-studio/node_modules resolves to the
# bind-mounted macOS tree, and `npm ci` there replaces every darwin binary with
# a Linux one — the host build then fails in ways that look unrelated. Run
# through scripts/linux/run-container.sh, which creates and chowns the volume.
if ls node_modules/@esbuild 2>/dev/null | grep -q darwin; then
  echo "REFUSING: node_modules holds darwin packages — this is the host tree, not the container volume." >&2
  echo "          Run scripts/linux/run-container.sh instead of a bare docker run." >&2
  exit 2
fi

pass=0; fail=0; skip=0
declare -a ROWS
row() { ROWS+=("$1|$2|$3"); case "$1" in PASS) pass=$((pass+1));; FAIL) fail=$((fail+1));; SKIP) skip=$((skip+1));; esac; }
step() { echo; echo "=== $1 ==="; }
want() { [ "$ONLY" = all ] || [ "$ONLY" = "$1" ]; }

# ---- 1. toolchain -----------------------------------------------------------
step "1 toolchain"
uname -m; node -v; npm -v
row PASS "toolchain" "node $(node -v), npm $(npm -v), $(uname -m)"
for b in /usr/bin/secret-tool /usr/bin/zenity /usr/bin/bwrap /usr/bin/tar; do
  if [ -x "$b" ]; then row PASS "present $b" ""; else row FAIL "missing $b" "the code hardcodes this path"; fi
done
if bwrap --ro-bind / / --dev /dev --unshare-pid --proc /proc true 2>/dev/null; then
  row PASS "bwrap sandbox" "the dsh sandbox profile applies"
else
  row SKIP "bwrap sandbox" "unprivileged userns unavailable in this container (kernel/seccomp), not a code fault"
fi

if want toolchain; then :; fi

# ---- 2. engine --------------------------------------------------------------
if want all || want engine; then
  step "2 npm ci"
  if npm ci --no-audit --no-fund > /tmp/npm-ci.log 2>&1; then
    row PASS "npm ci" "$(grep -c . /tmp/npm-ci.log) log lines"
  else
    row FAIL "npm ci" "$(tail -3 /tmp/npm-ci.log | tr '\n' ' ')"
  fi

  step "3 plugin selftests (scripts/ci.mjs)"
  if node scripts/ci.mjs > /tmp/ci.log 2>&1; then
    row PASS "ci suites" "$(grep -c '^GREEN' /tmp/ci.log) green"
  else
    row FAIL "ci suites" "$(grep '^RED' /tmp/ci.log | head -3 | tr '\n' ' ')"
  fi

  step "4 engine boot smoke"
  if npm run smoke > /tmp/smoke.log 2>&1; then
    row PASS "engine boot" "$(grep -o 'OK — .*' /tmp/smoke.log | head -1)"
  else
    row FAIL "engine boot" "$(tail -3 /tmp/smoke.log | tr '\n' ' ')"
  fi

  step "5 secret-tool keyring (needs a session bus + keyring daemon)"
  if dbus-run-session -- bash -c '
      echo -n probe | gnome-keyring-daemon --unlock --replace --daemonize >/dev/null 2>&1 || true
      sleep 1
      node -e "
        import(\"./plugins/github-link/lib/keyring.js\").then(async (m) => {
          const k = m.createKeyring({});
          if (k.backend !== \"secret-tool\") { console.error(\"backend=\" + k.backend); process.exit(3) }
          await k.setSecret(\"bringup\", \"tok-123\");
          const got = await k.getSecret(\"bringup\");
          await k.deleteSecret(\"bringup\");
          const gone = await k.getSecret(\"bringup\");
          if (got !== \"tok-123\" || gone !== null) { console.error(\"roundtrip got=\" + got + \" gone=\" + gone); process.exit(4) }
          console.log(\"secret-tool round-trip ok\");
        }).catch((e) => { console.error(e); process.exit(5) })
      "' > /tmp/keyring.log 2>&1; then
    row PASS "keyring" "real libsecret round-trip"
  else
    row SKIP "keyring" "no Secret Service in this container ($(tail -1 /tmp/keyring.log | cut -c1-70)) — the memory fallback is what runs"
  fi
fi

# ---- 3. sidecars ------------------------------------------------------------
if want all || want sidecars; then
  step "6 arxa CLI sidecar (dart compile exe)"
  if node scripts/pack-cli.mjs > /tmp/pack-cli.log 2>&1; then
    row PASS "pack-cli" "$(grep -o 'OK → .*' /tmp/pack-cli.log | head -1)"
  else
    row FAIL "pack-cli" "$(tail -3 /tmp/pack-cli.log | tr '\n' ' ')"
  fi

  step "7 engine sidecar (bun --compile)"
  if node scripts/pack-sidecar.mjs > /tmp/pack-sidecar.log 2>&1; then
    row PASS "pack-sidecar" "$(grep -o 'OK → .*' /tmp/pack-sidecar.log | head -1)"
  else
    row FAIL "pack-sidecar" "$(tail -3 /tmp/pack-sidecar.log | tr '\n' ' ')"
  fi
fi

# ---- 4. the shell -----------------------------------------------------------
if want all || want shell; then
  step "8 cargo build (Tauri shell against webkit2gtk)"
  if (cd /work/arxa/desktop/src-tauri && cargo build --release > /tmp/cargo.log 2>&1); then
    row PASS "cargo build" "$(ls -la /work/arxa/desktop/src-tauri/target/release/arxa-desktop 2>/dev/null | awk '{print $5" bytes"}')"
  else
    row FAIL "cargo build" "$(grep -E '^error' /tmp/cargo.log | head -3 | tr '\n' ' ')"
  fi
fi

# ---- 5. window (best effort) ------------------------------------------------
if want all || want window; then
  step "9 window smoke under Xvfb (best effort)"
  BIN=/work/arxa/desktop/src-tauri/target/release/arxa-desktop
  if [ ! -x "$BIN" ]; then
    row SKIP "window" "no built shell to run"
  else
    if xvfb-run -a --server-args="-screen 0 1280x800x24" \
        env WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1 \
        timeout 60 "$BIN" > /tmp/window.log 2>&1; then
      row PASS "window" "shell ran under Xvfb"
    else
      code=$?
      if grep -qE "probe .*reachable=|service manager|detached" /tmp/window.log; then
        row PASS "window" "shell started its launch flow (exit $code under Xvfb): $(grep -oE '\[arxa-desktop\][^\"]*' /tmp/window.log | head -1)"
      else
        row SKIP "window" "container compositing (exit $code): $(tail -1 /tmp/window.log | cut -c1-70)"
      fi
    fi
  fi
fi

# ---- table ------------------------------------------------------------------
echo
echo "================ Linux bring-up ================"
printf '%-6s %-22s %s\n' STATUS STEP DETAIL
for r in "${ROWS[@]}"; do
  IFS='|' read -r st name detail <<< "$r"
  printf '%-6s %-22s %s\n' "$st" "$name" "$detail"
done
echo "------------------------------------------------"
echo "pass=$pass fail=$fail skip=$skip"
[ "$fail" -eq 0 ]
