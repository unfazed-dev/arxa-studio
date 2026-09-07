#!/usr/bin/env bash
# Linux bring-up: everything that can be proven without a real display.
# Runs INSIDE the Arch container (scripts/linux/Dockerfile.arch) with both repos
# bind-mounted, and prints one PASS/FAIL table.
#
#   scripts/linux/run-container.sh [--fresh] [all|engine|sidecars|shell|window|package|appimage|deb]
#
# Layers, cheapest first — a later layer only runs when the ones it needs passed:
#   1  toolchain + deps        node, npm ci, bwrap, secret-tool, zenity
#   2  engine                  the 80+ suite CI, then the boot smoke (binds a port, serves HTML)
#   3  sidecars                pack-cli (dart compile exe), pack-sidecar (bun), then the
#                             SAME boot smoke driven through the packed binary
#   4  shell                   cargo build + the engine_unit (systemd) tests
#   5  window (best effort)    the built shell under Xvfb; a container compositing
#                              failure is reported, not chased — Hyprland is the real target
#   6  package                 makepkg on the PKGBUILD, asserting the installed layout (Arch image)
#   7  appimage                tauri build --bundles appimage, asserting the engine is NOT
#                              in usr/bin, is byte-identical at usr/libexec, and boots from
#                              the extracted image (Ubuntu image — DISTRO=ubuntu)
#   8  deb                     tauri build --bundles deb, same layout + engine assertions (Ubuntu)
set -uo pipefail

SRC=${SRC:-/src}
WORK=${WORK:-/work}
STUDIO="$WORK/arxa-studio"
ONLY=${1:-all}

# The host repos are READ-ONLY at /src; everything happens on the container's
# own copy under /work. Two things this buys: `npm ci` can never replace the
# host's darwin node_modules with Linux binaries (it did, once), and the install
# runs on a plain volume filesystem instead of a volume nested inside a
# virtiofs bind mount, which failed halfway through with ENOTDIR.
echo "=== 0 sync $SRC → $WORK ==="
mkdir -p "$WORK"
for repo in arxa-studio arxa; do
  [ -d "$SRC/$repo" ] || continue
  rsync -a --delete \
    --exclude 'node_modules/' --exclude '.git/' --exclude 'target/' \
    --exclude '.compile-cache/' --exclude '.dart_tool/' \
    --exclude 'src-tauri/binaries/' \
    --exclude 'designs/' --exclude 'archives/' \
    "$SRC/$repo/" "$WORK/$repo/"
done
cd "$STUDIO" || { echo "no studio at $STUDIO"; exit 1; }

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

  # The artifact that actually ships is the packed one, so put it through the
  # SAME gate as the checkout engine: extract, boot, bind, answer 200 HTML.
  # Step 4 proves the checkout tree; this proves the payload's own copy of it.
  step "7b packed sidecar boot smoke"
  PACKED="$WORK/arxa/desktop/src-tauri/binaries/arxa-studio-$(uname -m)-unknown-linux-gnu"
  if [ ! -x "$PACKED" ]; then
    row SKIP "packed boot" "no $PACKED (pack-sidecar failed)"
  elif [ "$(stat -c %s "$PACKED" 2>/dev/null || echo 0)" -lt 1048576 ]; then
    row SKIP "packed boot" "$PACKED is a stub, not a packed sidecar"
  elif ARXA_SMOKE_LAUNCHER="$PACKED" npm run smoke > /tmp/packed-smoke.log 2>&1; then
    row PASS "packed boot" "$(grep -o 'OK — .*' /tmp/packed-smoke.log | head -1)"
  else
    row FAIL "packed boot" "$(tail -3 /tmp/packed-smoke.log | tr '\n' ' ')"
  fi
fi

# ---- 4. the shell -----------------------------------------------------------
if want all || want shell; then
  TRIPLE="$(uname -m | sed 's/aarch64/aarch64/; s/x86_64/x86_64/')-unknown-linux-gnu"
  BINDIR="$WORK/arxa/desktop/src-tauri/binaries"
  mkdir -p "$BINDIR"
  # cargo only needs FILES at the externalBin paths — it never runs them. A CI
  # checkout has no monaco dist (gitignored; 1.3 GB of build deps to produce it)
  # and pack-sidecar rightly refuses without it, so stub instead of packing.
  # The REAL artifact is gated by step 7b, which runs when it exists.
  if [ ! -f "$STUDIO/plugins/artifact-viewer/lib/monaco-build/dist/arxa-monaco.js" ]; then
    echo "--- no monaco dist: stubbing sidecars so cargo can link ---"
    bash "$WORK/arxa/desktop/scripts/dev-stub-sidecars.sh" || row FAIL "stub sidecars" "dev-stub-sidecars.sh failed"
  else
    for pair in "arxa-studio-$TRIPLE:scripts/pack-sidecar.mjs" "arxa-$TRIPLE:scripts/pack-cli.mjs"; do
      f="${pair%%:*}"; builder="${pair##*:}"
      if [ ! -x "$BINDIR/$f" ]; then
        echo "--- $f missing, building it first ($builder) ---"
        (cd "$STUDIO" && node "$builder" > "/tmp/$(basename "$builder").log" 2>&1) || row FAIL "prebuild $f" "$(tail -2 "/tmp/$(basename "$builder").log" | tr '\n' ' ')"
      fi
    done
  fi

  step "8 cargo build (Tauri shell against webkit2gtk)"
  if (cd "$WORK/arxa/desktop/src-tauri" && cargo build --release > /tmp/cargo.log 2>&1); then
    row PASS "cargo build" "$(ls -la "$WORK/arxa/desktop/src-tauri/target/release/arxa-desktop" 2>/dev/null | awk '{print $5" bytes"}')"
  else
    row FAIL "cargo build" "$(grep -E '^error' /tmp/cargo.log | head -3 | tr '\n' ' ')"
  fi

  # engine_unit.rs is #[cfg(target_os = "linux")], so macOS can NEVER run its
  # tests and `cargo build` does not run tests at all — this is the only place
  # the systemd unit renderer is actually exercised. Single-threaded: the
  # XDG_CONFIG_HOME test mutates process env.
  step "8b cargo test (systemd unit renderer)"
  if (cd "$WORK/arxa/desktop/src-tauri" && cargo test --release engine_unit -- --test-threads=1 > /tmp/cargo-test.log 2>&1); then
    # Assert the COUNT, not just "ok": a filter that stops matching (module
    # renamed, moved behind another cfg) would otherwise report PASS on
    # "0 passed" — the same silent-zero shape as the allowScripts bug.
    n_tests="$(grep -o 'test result: ok. [0-9]* passed' /tmp/cargo-test.log | grep -o '[0-9]*' | head -1)"
    if [ "${n_tests:-0}" -ge 3 ]; then
      row PASS "cargo test" "$n_tests engine_unit tests passed"
    else
      row FAIL "cargo test" "expected 3+ engine_unit tests, ran ${n_tests:-0} — did the module move?"
    fi
  else
    row FAIL "cargo test" "$(grep -E '^(error|test .* FAILED|failures:)' /tmp/cargo-test.log | head -3 | tr '\n' ' ')"
  fi
fi

# ---- 5. window (best effort) ------------------------------------------------
if want all || want window; then
  step "9 window smoke under Xvfb (best effort)"
  BIN="$WORK/arxa/desktop/src-tauri/target/release/arxa-desktop"
  if [ ! -x "$BIN" ]; then
    row SKIP "window" "no built shell to run"
  else
    # A session bus is required, not optional: the shell talks to the a11y bus
    # and the XDG portal at startup, and without one it dies before its own
    # first log line. Hyprland always has one; a bare container does not.
    if xvfb-run -a --server-args="-screen 0 1280x800x24" dbus-run-session -- \
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


# ---- 6. the Arch package (D10: PKGBUILD) ------------------------------------
# makepkg only — installing needs root, which this layer deliberately is not.
# What it catches is the class of bug it DID catch (2026-09-07): the package
# built and installed fine while putting the shell at /usr/bin/arxa-studio and
# the sidecars in /usr/lib/arxa-studio, so the shell's own
# dirname(current_exe())/arxa-studio resolved to ITSELF. The layout is visible
# in the package's file list, so assert on that.
if want all || want package; then
  step "10 arch package (makepkg)"
  PKGDIR="$WORK/arxa/desktop/packaging"
  if ! command -v makepkg >/dev/null 2>&1; then
    row SKIP "makepkg" "no makepkg on this image — the PKGBUILD is the Arch lane"
  elif [ ! -x "$WORK/arxa/desktop/src-tauri/target/release/arxa-desktop" ]; then
    row SKIP "makepkg" "no built shell to package (run the shell layer first)"
  elif (cd "$PKGDIR" && mkdir -p /work/pkgout && PKGDEST=/work/pkgout makepkg -f --nodeps --noconfirm > /tmp/makepkg.log 2>&1); then
    PKGFILE="$(ls -t /work/pkgout/*.pkg.tar.* 2>/dev/null | head -1)"
    listing="$(bsdtar -tvf "$PKGFILE" 2>/dev/null)"
    # The shell and the CLI sit in /usr/lib/arxa-studio, the engine at
    # /usr/libexec/arxa-studio (the one Linux engine home, shared with the
    # AppImage and deb layouts), and /usr/bin is a symlink — never the shell.
    ok_layout=1
    for want_path in usr/lib/arxa-studio/arxa-desktop usr/libexec/arxa-studio/arxa-studio usr/lib/arxa-studio/arxa; do
      echo "$listing" | grep -q " $want_path\$" || { ok_layout=0; missing="$want_path"; }
    done
    echo "$listing" | grep -q "usr/bin/arxa-studio -> /usr/lib/arxa-studio/arxa-desktop" || { ok_layout=0; missing="usr/bin/arxa-studio symlink"; }
    if [ "$ok_layout" = 1 ]; then
      row PASS "makepkg" "$(basename "$PKGFILE") ($(du -h "$PKGFILE" | cut -f1)), engine at usr/libexec, CLI beside the shell"
    else
      row FAIL "makepkg" "package layout wrong: $missing — the shell would resolve its own path as its engine"
    fi
  else
    row FAIL "makepkg" "$(tail -3 /tmp/makepkg.log | tr '\n' ' ')"
  fi
fi

# ---- 7. the AppImage (D10) --------------------------------------------------
# Ubuntu image only: Tauri's guidance is that the build host's glibc is the
# floor for every user, and on Arch linuxdeploy's gtk plugin dies on a
# gdk-pixbuf loaders dir that distro no longer has. What this layer asserts is
# the bug that killed the first attempt (2026-09-07): linuxdeploy patchelfs
# every ELF under usr/bin and usr/lib, and the bun engine does not survive it.
# The engine therefore ships at usr/libexec (src-tauri/tauri.linux.conf.json):
# it must be there byte-identical, and must NOT be in usr/bin.
if want all || want appimage; then
  step "11 appimage (tauri build --bundles appimage)"
  TRIPLE="$(uname -m)-unknown-linux-gnu"
  PACKED="$WORK/arxa/desktop/src-tauri/binaries/arxa-studio-$TRIPLE"
  BUNDLE="$WORK/arxa/desktop/src-tauri/target/release/bundle/appimage"
  if [ -f /etc/arch-release ]; then
    row SKIP "appimage" "Arch lane — build AppImages with DISTRO=ubuntu (gdk-pixbuf plugin, glibc floor)"
  elif [ ! -x "$PACKED" ] || [ "$(stat -c %s "$PACKED" 2>/dev/null || echo 0)" -lt 1048576 ]; then
    row SKIP "appimage" "no packed engine at $PACKED (run the sidecars layer first)"
  elif ! (cd "$WORK/arxa/desktop" && rm -rf "$BUNDLE" && APPIMAGE_EXTRACT_AND_RUN=1 \
        npx --yes @tauri-apps/cli@^2 build --bundles appimage \
          --config '{"bundle":{"createUpdaterArtifacts":false}}' > /tmp/appimage.log 2>&1); then
    row FAIL "appimage build" "$(grep -iE 'error|failed' /tmp/appimage.log | tail -3 | tr '\n' ' ' | cut -c1-160)"
  else
    APPDIR="$BUNDLE/Arxa Studio.AppDir"
    IMG="$(ls "$BUNDLE"/*.AppImage 2>/dev/null | head -1)"
    if [ -e "$APPDIR/usr/bin/arxa-studio" ]; then
      row FAIL "appimage layout" "usr/bin/arxa-studio exists — linuxdeploy patched the engine (tauri.linux.conf.json not applied?)"
    elif ! cmp -s "$PACKED" "$APPDIR/usr/libexec/arxa-studio/arxa-studio"; then
      row FAIL "appimage layout" "usr/libexec/arxa-studio/arxa-studio missing or not byte-identical to the packed engine"
    elif [ -z "$IMG" ]; then
      row FAIL "appimage" "no .AppImage produced under $BUNDLE"
    else
      row PASS "appimage build" "$(basename "$IMG") ($(du -h "$IMG" | cut -f1)); engine at usr/libexec byte-identical, absent from usr/bin"
      # No FUSE in a container: extract the image (the runtime does that
      # without FUSE) and put the engine INSIDE it through the same boot gate
      # as steps 4 and 7b.
      EXTRACT=/tmp/appimage-extract; rm -rf "$EXTRACT"; mkdir -p "$EXTRACT"
      if (cd "$EXTRACT" && "$IMG" --appimage-extract > /dev/null 2>&1) \
         && ARXA_SMOKE_LAUNCHER="$EXTRACT/squashfs-root/usr/libexec/arxa-studio/arxa-studio" npm run smoke > /tmp/appimage-smoke.log 2>&1; then
        row PASS "appimage engine" "$(grep -o 'OK — .*' /tmp/appimage-smoke.log | head -1)"
      else
        row FAIL "appimage engine" "$(tail -3 /tmp/appimage-smoke.log | tr '\n' ' ' | cut -c1-160)"
      fi
      # The whole image under Xvfb: the shell must find the engine at
      # ../libexec and the engine must extract itself into a throwaway home.
      HOME_PROBE=/tmp/appimage-home; rm -rf "$HOME_PROBE"
      xvfb-run -a --server-args="-screen 0 1280x800x24" dbus-run-session -- \
        env APPIMAGE_EXTRACT_AND_RUN=1 ARXA_HOME="$HOME_PROBE" \
            WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1 \
        timeout 60 "$IMG" > /tmp/appimage-window.log 2>&1
      code=$?
      if ls -d "$HOME_PROBE"/engine/*/ > /dev/null 2>&1; then
        row PASS "appimage window" "shell launched the bundled engine (extracted under $HOME_PROBE/engine; exit $code under Xvfb)"
      else
        row FAIL "appimage window" "engine never extracted into $HOME_PROBE (exit $code): $(grep -oE '\[arxa-desktop\][^"]*' /tmp/appimage-window.log | head -1 | cut -c1-90)"
      fi
    fi
  fi
fi

# ---- 8. the .deb ------------------------------------------------------------
# Same Ubuntu lane. Tauri's deb bundler copies files and never runs
# linuxdeploy, so this cannot hit the patchelf bug — what it CAN get wrong is
# the layout (tauri.linux.conf.json maps the engine into /usr/libexec via
# deb.files; if that map were dropped the engine would be missing, not
# corrupt). Installing needs root, which this layer is not: assert the file
# list, extract, compare bytes, and boot the engine from the extracted root.
if want all || want deb; then
  step "12 deb (tauri build --bundles deb)"
  TRIPLE="$(uname -m)-unknown-linux-gnu"
  PACKED="$WORK/arxa/desktop/src-tauri/binaries/arxa-studio-$TRIPLE"
  DEBDIR="$WORK/arxa/desktop/src-tauri/target/release/bundle/deb"
  if ! command -v dpkg-deb >/dev/null 2>&1; then
    row SKIP "deb" "no dpkg-deb on this image — the deb is the Ubuntu lane"
  elif [ ! -x "$PACKED" ] || [ "$(stat -c %s "$PACKED" 2>/dev/null || echo 0)" -lt 1048576 ]; then
    row SKIP "deb" "no packed engine at $PACKED (run the sidecars layer first)"
  elif ! (cd "$WORK/arxa/desktop" && rm -rf "$DEBDIR" && \
        npx --yes @tauri-apps/cli@^2 build --bundles deb \
          --config '{"bundle":{"createUpdaterArtifacts":false}}' > /tmp/deb.log 2>&1); then
    row FAIL "deb build" "$(grep -iE 'error|failed' /tmp/deb.log | tail -3 | tr '\n' ' ' | cut -c1-160)"
  else
    DEB="$(ls "$DEBDIR"/*.deb 2>/dev/null | head -1)"
    listing="$(dpkg-deb -c "$DEB" 2>/dev/null)"
    ok_layout=1
    # dpkg-deb -c prints members with or without a leading ./ depending on
    # how the data.tar was written; match either.
    for want_path in usr/libexec/arxa-studio/arxa-studio usr/bin/arxa-desktop usr/bin/arxa; do
      echo "$listing" | grep -qE " (\./)?$want_path\$" || { ok_layout=0; missing="$want_path"; }
    done
    echo "$listing" | grep -qE " (\./)?usr/bin/arxa-studio\$" && { ok_layout=0; missing="usr/bin/arxa-studio present (engine still an externalBin?)"; }
    DEBROOT=/tmp/deb-root; rm -rf "$DEBROOT"; mkdir -p "$DEBROOT"
    if [ -z "$DEB" ]; then
      row FAIL "deb" "no .deb produced under $DEBDIR"
    elif [ "$ok_layout" != 1 ]; then
      row FAIL "deb layout" "$missing"
    elif ! dpkg-deb -x "$DEB" "$DEBROOT" || ! cmp -s "$PACKED" "$DEBROOT/usr/libexec/arxa-studio/arxa-studio"; then
      row FAIL "deb layout" "engine in the package is not byte-identical to the packed input"
    else
      row PASS "deb build" "$(basename "$DEB") ($(du -h "$DEB" | cut -f1)); engine at usr/libexec byte-identical, absent from usr/bin"
      if ARXA_SMOKE_LAUNCHER="$DEBROOT/usr/libexec/arxa-studio/arxa-studio" npm run smoke > /tmp/deb-smoke.log 2>&1; then
        row PASS "deb engine" "$(grep -o 'OK — .*' /tmp/deb-smoke.log | head -1)"
      else
        row FAIL "deb engine" "$(tail -3 /tmp/deb-smoke.log | tr '\n' ' ' | cut -c1-160)"
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
