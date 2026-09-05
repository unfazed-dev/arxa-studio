# provider-status service seam (Claude usage ring)

Date: 2026-09-05. Status: implementing.

## Problem

The Claude 5h / weekly usage ring never appeared, while DeepSeek and Kimi rings
did (once the RPC channel fix landed earlier today). Engine-side facts measured
against the live engine (pid 49586, boot 22:14):

- `current` RPC for `deepseek-official` / `kimi-coding` published real rows
  (`~/.arxa/provider-status.json`: DeepSeek $9.56, Kimi week 5 %, 5h 0 %).
- `current` for `claude-code` answered `status: null` in ~10 ms, wrote no row,
  not even a `?` — i.e. the poller's `ensure()` returned before reading.
- The probe itself is healthy: SDK `startup()` + `accountInfo()` +
  `supportedModels()` + `--version`, under an equivalent Seatbelt profile, with
  the engine's bare `PATH`, `cwd /`, and the repo's bundled binary, completes
  in 652 ms.

Root cause: two module instances of `plugins/provider-status/lib/poller.js`
(and `lib/index.js`).

- `profile/cordis.patch.yml` pins `claude-code` (and six others) by **absolute
  repo path** (`/Volumes/.../plugins/claude-code/index.mjs`, since 5e4fc7d).
- `arxa-provider-status` is loaded **by package name** through the profile's
  `node_modules`, a `file:` copy of the engine tree
  (`~/.arxa/engine/<hash>/arxa-studio/plugins/provider-status`).
- `claude-code/index.mjs` imported `../provider-status/lib/poller.js` and
  `adapter.js` imported `../../provider-status/lib/index.js` — the **repo**
  instances. The reader went into a `READERS` map the real poller never
  consulted; turn-time rate-limit publishes went into a `latest` map the RPC
  never served.

Second, separate finding: the SDK's `warm.close()` does not reap a
sandbox-exec-wrapped child (2 children still alive 3 s after `close()`), and the
engine holds nine idle `claude --output-format stream-json` children from
boot-time probes. Not fixed here; tracked below.

## Fix

Couple through a cordis service, never through module state:

1. `provider-status/lib/index.js` `apply(ctx)` provides `providerStatus`:
   `{ registerUsageReader, publish, replace, onStatus }`.
2. `claude-code/index.mjs` drops the relative import; registers the reader in
   `ctx.inject(['providerStatus'], …)` (same deferred shape as `authorization`),
   and hands the adapter a lazy `publish` bound to the service.
3. `claude-code/lib/adapter.js` takes `publish` in its constructor
   (`this.publish = publish ?? publishProviderStatus`, the import kept only as
   the selftest default) and uses it at all three call sites.

A cordis service is one object per app regardless of how many copies of a file
were loaded, so this survives the mixed profile and packed mode alike.

## Verification

- `node plugins/provider-status/selftest.mjs`, `node plugins/claude-code/selftest*.mjs`.
- Restart the engine; `POST /arxa-provider-status/current` with
  `provider: 'claude-code'` must return the 5h/weekly statuses and write
  `… claude-code hour:5|week:1` rows to `~/.arxa/provider-status.json`.
- Open the desktop app: ring visible with a Claude model selected.

## Follow-ups (not in this change)

- Probe children are not reaped by `warm.close()`; add an explicit kill of the
  spawned child on close/timeout in `claude-code/lib/spawn.js` or the probe.
- `profile/cordis.patch.yml` ships seven absolute `/Volumes/...` paths; packed
  mode cannot resolve them. Needs its own decision.
- Credentials were printed unmasked into the assistant session on 2026-09-05
  (`~/.arxa/dsh/.credentials.yaml`: ZAI, DeepSeek, Kimi keys, browser-session
  grant). Rotate if that transcript is considered exposed.
