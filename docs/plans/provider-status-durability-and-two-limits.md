# provider-status: why the pill vanished, and the two Claude limits

Date: 2026-09-05. Follows `session-event-vocabulary.md`, which caused this.

## Symptom

After the session-event fix shipped and arxa was restarted, the usage pill was gone for
**every** provider, including Claude Fable — not mis-labelled, not stale: absent.

## Root cause: durability, traded away and not replaced

`session-event-vocabulary.md` moved provider status off the session log (an unknown event type
made whole conversations unreadable). The replacement was a per-process `Map`. That fixed the
corruption and silently broke the feature, because of one line in the SDK:

```ts
/** Rate limit event emitted when rate limit info changes. */
export declare type SDKRateLimitEvent = { type: 'rate_limit_event'; ... }
```

**`rate_limit_event` fires when the numbers change — not once per turn.** The session log had
been providing durability for free: one event, ever, and the pill persisted. With a process-memory
store the pill is empty after every restart and stays empty until a limit happens to move. In
normal use that is "never shows anything".

This was written down as an accepted cost ("a host restart clears it, and the next rate-limit
event refills it"). The cost was underestimated: "the next rate-limit event" can be days away.

### Fix

One local JSON file, `~/.arxa/provider-status.json` (`ARXA_APP_DATA_DIR` overrides).

- Written on publish, write-then-rename so a crash cannot truncate it.
- Re-validated row by row on load — a hand-edited file cannot inject an unchecked value.
- Corrupt, truncated, or missing file degrades to "no pill", never a boot crash.
- Rows expire after 7 days and are capped at 500, so the file cannot grow without bound.

Local-only by design: arxa studio is distributed software and must never require the Arxa Digital
Solutions database (CLAUDE.md). A usage pill has to work for a user with no database at all.

## Second defect: the wiring gate

The rewrite also declared:

```js
exports.inject = ['slots', 'modelDirectories', 'connection']
```

`exports.inject` is a **hard gate** — dsh's own contract calls it *"service required before the
companion can register"*. `modelDirectories` belongs to another plugin
(`dsh-client-ui-model-selection`), and dsh deliberately keeps it **out** of that plugin's own
module-level list, reaching it through a lazy inner `ctx.inject` instead. Naming it in the gate
made the entire pill hostage to another plugin's service.

Two further hazards on the same path:

- `directoryFor(sessionId)` **throws** when the session has no scope ("Unknown sessions fail
  loud") — subagent sessions, or a session mid-teardown. It was called unguarded inside slot
  inject.
- The badge hid whenever it could not identify the active provider, so any failure in that chain
  read as "no pill".

### Fix

Gate on core services only (`slots`, `connection`). Resolve the directory at **render** time,
inside `try/catch`, optional-chained. No directory simply means no provider filter — the pill
shows. **Degrade visible, never invisible.**

`selftest.mjs` asserts the gate does not name `modelDirectories`, and that the `directoryFor`
call stays guarded.

## Third: two Claude limits at once

A Claude subscription now enforces a premium-model weekly allowance **alongside** the all-models
weekly limit. They arrive as separate `rate_limit_event`s with different `rateLimitType`s.

The store was keyed by session id alone, so the second event **erased** the first: the user saw
whichever limit moved most recently and had no way to know the other existed.

### Fix

- Status carries `kind` (the SDK's `rateLimitType`, or `default`). The store keys on
  session + provider + kind, so both limits coexist.
- `bindingStatus()` folds them: the worst level wins, ties break on utilization — that is the
  limit actually constraining the user. **Both** are named in the tooltip, because a limit the
  user is never shown is how they get surprised by it.
- The fold runs host-side, so the browser's duplicated `formatBadge` stays one pure function of
  one value and the parity test is unchanged.

`kind` is passed through raw (bounded by the schema) rather than mapped against the installed
SDK's enum, so a limit type newer than the SDK still gets its own slot instead of colliding.

### Superseded: the labels now come from the server

The earlier note here said the SDK enum has no Fable key and that relabelling would have to wait
for observation. That is resolved — see "Fifth" below. `model_scoped[].display_name` is the plan's
own name for the bucket, so arxa never guesses.

## Fourth: the fold must never mix providers

`bindingStatus()` folds what it is handed into one pill. `statusesFor(sessionId)` originally
returned **every** provider's rows when no provider was named, so the fold picked a winner across
providers and joined their titles -- a Claude limit shown against a GLM turn, the original bug in
a new place.

This is the ordinary path, not an edge case. dsh's `ModelSelect` loads its catalog only inside
`useEffect(..., [open])`, and the directory starts at `current: null`, so the browser does not know
the selected provider until the user opens the picker.

### Fix

- `statusesFor` returns one provider's rows, never a mix. With no provider named, the most recently
  updated provider wins -- something true about one provider beats something false about two.
- The pill calls `directory.load()` itself on mount, so it learns the selection without waiting for
  the user to open the picker. Fire-and-forget: a catalog that fails to load costs the provider
  filter, never the pill.
- `apply()` only rehydrates from disk when the store is empty, so a re-run (HMR) cannot wipe live
  state.

## Fifth: the event never fires, so stop waiting for it

Reported again after the durability fix shipped: still no pill, on Fable, on an account the user
knew was low. The evidence settled it:

- arxa restarted at 01:31:50, on the new payload.
- A `claude-fable-5-1[1m]` turn ran at 01:32:03 — after the restart, with the new code.
- `~/.arxa/provider-status.json` did not exist. `~/.arxa` is writable.

So a Fable turn on a nearly-exhausted account produced **no `rate_limit_event` at all**. The SDK
is explicit that it fires "when rate limit info changes" — that is a notification, not a source.
A pill fed only by it shows nothing almost always. Durability was necessary and not sufficient.

### Fix: ask, don't wait

`Query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` returns the structured data
behind the CLI's own `/usage` command: the 5-hour window, the 7-day windows, and — the point —
`model_scoped[]`, per-model weekly windows each carrying the plan's own `display_name`
("e.g. 'Fable'"). `plugins/claude-code/lib/usage.js` maps it; the adapter calls it from
`onSession`, when the child is up, the query is alive, and nothing is added to turn latency.

**The labels are the server's.** A bucket renamed upstream (Opus -> Fable) reaches the user with
no arxa release and no guess.

Two shape traps, both tested: `utilization` here is a **percentage 0-100** where the event path
and the schema use a fraction (passing 90 through clamps to 1.0 and reads "limit reached" on an
account with 10% left), and `resets_at` is an **ISO 8601 string**, not an epoch number.
`rate_limits_available: false` (API key, Bedrock, Vertex) yields no pill rather than a zeroed one.

### On depending on an experimental API

The method name carries `_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`, and the doc says the name will
change on stabilisation. It is therefore found by **feature detection across both the experimental
and the stable name**, never called by a hardcoded name alone; any absence or failure returns no
statuses. `rate_limit_event` stays wired as the fallback — it costs nothing and it is the only
path left if this method disappears.

### And the blind spot that hid all this

`save()` swallowed every write error with a bare `catch {}`, so a failed write and a status that
was never published looked identical: an empty pill. That ambiguity is what forced a second
debugging round. A write failure now warns once per process, naming the path.

## Sixth: the packed payload is not the repo (2026-09-05)

Two boots of the desktop engine died in a row after `bin/arxa-engine-sync.mjs`, for two
different reasons, both from treating `~/.arxa/engine/<hash>/arxa-studio` as a copy of the repo:

1. `engine-sync` copies `profile/` and `plugins/` into the payload but never `bin/`. The template
   `profile/cordis.patch.yml` had just switched to `__ARXA_STUDIO_PLUGINS__/...` placeholders that
   only the *new* launcher resolves; the payload's old launcher wrote them verbatim and dsh failed
   every plugin include with `ERR_MODULE_NOT_FOUND`. Fix: copy the launcher over as well whenever
   the template contract changes (the payload launcher was byte-identical to `HEAD`, so this was
   safe). `engine-sync` still does not sync `bin/` — do it by hand and say so.
2. `plugins/claude-code/index.mjs` read the app version with a hard
   `require('../../package.json')`. The payload has no root `package.json` — only
   `bin/packed.json`, which carried no version. The throw failed the whole plugin tree, and the
   desktop watchdog crash-looped 456 boots at 10 s intervals. Fix: `readAppVersion()` tries
   `package.json`, then `bin/packed.json`, then returns `'unknown'` and never throws
   (`selftest.version.mjs`); `scripts/pack-sidecar.mjs` now stamps `version` into `packed.json`.
   The live payload was stamped by hand (`"version": "0.1.0"`) until the next repack.

Rule that falls out: anything a plugin needs at load time must exist in **both** trees, and a
load-time read that can miss must degrade, never throw — a throw there is a no-boot, not a
warning.

## Standing gaps

- Status is per-machine and per-user, never shared. Intended.
- A user who has never hit a limit event still sees no pill. Correct: there is nothing to report.
