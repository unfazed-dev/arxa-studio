# "A crash every time I open Arxa Studio" — an ordinary stop with the wrong exit code

Date: 2026-09-08. Reported on Omarchy: "there seem to be always a process crash
occurring when opening arxa studio on the box".

## What was actually happening

Nothing crashed. Opening the app restarts `arxa-engine.service` (the shell hands
the engine a new session token), and **every one of those stops was reported as
a failure**:

```
Stopping arxa studio engine...
arxa-engine.service: Main process exited, code=exited, status=1/FAILURE
arxa-engine.service: Killing process 69498 (node-MainThread) with signal SIGKILL
arxa-engine.service: Failed with result 'exit-code'
```

Counted on the box: **466 failed stops against 23 clean ones**. `Restart=always`
started a fresh engine each time, so the app worked — which is why this survived
so long as noise rather than a bug.

## The process ladder

```
systemd main  →  libexec/arxa-studio --no-open   (bun-compiled sidecar, scripts/pack-sidecar.mjs)
                 └─ node bin/arxa-studio.mjs     (the launcher)
                    └─ node … dsh                (the engine)
```

`KillMode=mixed` sends SIGTERM to the **main pid only**; anything still alive
when it exits is SIGKILLed.

## Root cause — one fault, one amplifier

Both the wrapper and the launcher ended with the same line:

```js
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1))
```

but they are **not** two independent causes. The chain is:

1. **The fault — `bin/arxa-studio.mjs` had no signal handling at all.** The
   wrapper forwards SIGTERM to it correctly; with no handler it dies *by the
   signal*, and the dsh engine below it never learns the app is stopping. That
   orphaned engine is what systemd then **SIGKILLs**.
2. **The amplifier — the wrapper mistranslates that death.** Seeing its child
   killed by a signal, `signal ? 1` reports **exit 1**, which is the
   `status=1/FAILURE` systemd records.

Proved by the box: patching **only** the launcher, leaving the shipped wrapper
untouched, made the stop clean. The launcher now exits 0 instead of dying by
signal, so the old wrapper's `code ?? 1` sees 0 and reports success. The
wrapper's line was never reached on a signal path once the launcher stopped
producing one.

## Fix

A stop we asked for is a success, and it has to reach the bottom of the ladder:

1. `scripts/pack-sidecar.mjs` — the generated wrapper records that it forwarded
   a signal and exits **0** when the child then dies.
2. `bin/arxa-studio.mjs` — forwards SIGTERM/SIGINT/SIGHUP to the engine, exits 0
   on a requested stop, and SIGKILLs after 8s as a backstop (inside the unit's
   `TimeoutStopSec=20`).

Fixing the launcher alone is enough to clear the exit code on an already-installed
build, and that is what was verified on the box. **The wrapper change is
unverified** — the box still runs the old wrapper — but it is the right change
anyway: without it, a launcher that dies by signal for a real reason would still
be reported as exit 1. It ships with the next build.

**Deploy caveat.** The box's fix is a hot patch of
`~/.arxa/engine/<hash>/arxa-studio/bin/arxa-studio.mjs`. A re-extraction reverts
exactly that file — it happened during this session — so the next AppImage
install brings the failing stop back until a Linux build carries both commits.

## Incident during the investigation

Testing the sidecar by hand (`… --no-open &`, then `kill -TERM`) left an orphan
engine holding port 7891 — because the unpatched wrapper did not shut its child
down, which is this very bug. The service then crash-looped on `EADDRINUSE` for
about two minutes until the orphan was terminated by pid. Worth recording twice
over: it is the cleanest demonstration of the fault, and a warning that manual
sidecar runs need their child reaped.

## Evidence

Measured on this Mac against the real launcher, sandboxed `ARXA_HOME`/`DSH_HOME`,
`ARXA_PORT=7899`:

| | exit code | engine child after stop |
|---|---|---|
| before (`git show HEAD:bin/arxa-studio.mjs`) | 143, killed by signal | **still alive** — systemd would SIGKILL it |
| after | **0** | shut down |

The box's sidecar reports 1 rather than 143 because the bun wrapper translates
it; the fix removes the dependence on either default by exiting explicitly.

Pinned by `scripts/pack-list-check.mjs` in both files — the one-liner is easy to
reintroduce while "simplifying".

## Not this bug

Two other crashes were in `coredumpctl` and are unrelated:

- `SIGABRT`, `Could not create GBM EGL display` — my own launch of the AppImage
  over SSH. Hybrid Intel + NVIDIA on Wayland; launching without a seat has no
  DRM access. `WEBKIT_DISABLE_DMABUF_RENDERER=1` works around it. Does not
  affect launches from the desktop's own session.
- `SIGBUS` ×2 in `/usr/libexec/arxa-studio/arxa-studio`, a binary **no package
  owns** (left over from the `.deb`/PKGBUILD work), faulting in the dynamic
  linker. Not the installed AppImage, which is what the `.desktop` entry runs.
  Worth deleting that stray tree; not investigated further.
