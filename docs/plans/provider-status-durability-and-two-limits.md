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

### Not done, deliberately

The installed SDK (0.3.220) enum is
`five_hour | seven_day | seven_day_opus | seven_day_sonnet | seven_day_overage_included | overage`
— **there is no Fable key.** Which of these now carries the premium bucket is not knowable from
the type alone, and `TYPE_LABEL.seven_day_opus = 'weekly Opus limit'` may therefore read wrong.
The `?? 'usage'` fallback absorbs an unknown string safely, so nothing breaks either way.
Relabelling waits until a real turn is observed emitting the actual value — guessing at the label
would be inventing an API.

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

## Standing gaps

- Status is per-machine and per-user, never shared. Intended.
- A user who has never hit a limit event still sees no pill. Correct: there is nothing to report.
