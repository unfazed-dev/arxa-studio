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

## Seventh: the browser never named a provider, so the host never fetched (2026-09-06)

With the pill mounted in `conversation.input.dock` and the store durable, the desktop still showed
no ring for hours while a headless page against the same engine showed it. The store was the
tell: the two real sessions had **zero rows**, and only `ensure` writes rows for a session.

Three defects, all on the cold path, found by replaying the pill's exact RPC:

1. **Props are computed once per mount, before `modelDirectories` exists.** The slot's
   `inject(sessionId)` resolved `directory` at that moment — model-selection registers *after*
   the composer mounts, so every real session got `undefined`, sent `provider: undefined`
   forever, and the host's `if (provider !== undefined) ensure(...)` skipped the fetch for the
   life of the window. Fix (`lib/client.js`): the fiber keeps a waiter set and wakes mounted
   pills when the service lands; the pill re-resolves via `resolveDirectory`/`onModels` (plus a
   1 s fallback tick, because `directoryFor()` also throws until the session is registered).
2. **No provider must still fetch.** `index.js` now calls `poller.ensureAny(sessionId)` when
   none is named — every registered reader + configured vendor, waits in parallel — so the
   ring shows the moment the pill exists and the provider filter tightens it later.
3. **The cold wait was shorter than the probe.** `COLD_WAIT_MS` was 1.5 s; a cold Claude probe
   lands at ~2.5 s. First RPC answered `null`, the pill slept 60 s. Now 4 s (still under
   `TIMEOUT_MS`), and the pill retries a null on a 3 s / 10 s / 30 s ladder before the tick.

Proof after `engine-sync` + relaunch (02:46:18): within 8–12 s the store gained `claude-code`
rows for both live sessions (`session-c6ccf05e…` 16:46:26Z, `…note-wt-260905-002` 16:46:30Z) —
the sessions that had none for hours. Tests: `selftest.mjs` pins the re-resolver, the waiter
wake, and the `ensureAny` branch; `selftest.quota.mjs` covers `ensureAny` cold/warm.

## Standing gaps

- Status is per-machine and per-user, never shared. Intended.
- A user who has never hit a limit event still sees no pill. Correct: there is nothing to report.

## Eighth: two rings, next to the context ring (2026-09-06)

User report on the first visible build: three rings in a row, in the dock row above the
composer, nowhere near dsh's context ring. Three separate mistakes:

1. **Wrong slot.** `conversation.input.dock` is a row stack *above* the composer (the git card
   lives there). The bottom row's trailing group is `conversation.input.right` ·
   `conversation.input.model` · `ContextMeter` · send. The pill now registers in
   `conversation.input.right`.
2. **One ring too many.** The Claude usage answer carries `five_hour`, `seven_day` and
   `model_scoped:<name>` windows, each numeric, and every numeric window got a ring. Only the
   5-hour and weekly windows are rings now (`RING_RANK`); model-scoped and textual windows
   stay in the panel.
3. **Rings landed after the send button.** Slot entries render inside a `display: contents`
   wrapper, so CSS sibling selectors from the entry never reach the send button and `order` on
   the entry alone is not enough. `pushSendAfter()` walks up to the trailing group and gives its
   last child (the send tooltip wrapper) `order: 2`; the pill's root is `order: 1`. Row reads:
   model · context ring · 5h ring · weekly ring · send. Verified on screen 03:13:24.

Known gap, not fixed here: on a cold desktop boot the Claude probe can take far longer than
`COLD_WAIT_MS`; the vendor rows bind first, the Fable filter hides them, and the rings appear
only when the retry ladder lands the Claude rows (measured 59 s after boot on 2026-09-06).

## Ninth: one ring, and ContextMeter's card verbatim (2026-09-06)

Report on the two-ring build: the 5-hour and weekly numbers are both in the card, so a second
ring only adds a third circle to the row; the card looked hand-rolled next to the context card;
and the ring had no hover behaviour.

- **One ring**, for the window the host folds as binding (worst level, ties on utilization). The
  card lists every live window (5-hour, Weekly, per-model "Fable weekly"). With a single ring in
  the slot the trailing row's own 12px gap spaces model · context ring · usage ring · send evenly.
- **Card = ContextMeter's stylesheet**, rule for rule (`JObwrW_*` in
  `@deepseek-ai/dsh-client-ui-conversation` 0.1.2-rc.1, read from `lib/client.js`), injected once
  as `arxa-ps-*` classes on dsh's tokens: 264px, radius 12, `--dsw-elevation-prominent`, header
  (percent · headline · figures), 4px bar, `dl` rows with 8px swatches. Bar and swatches tint by
  `RING_COLOR`, so amber/red in the card match the ring.
- **Hover = dsh's `Tooltip`** from `@deepseek-ai/dsh-client-ui-primitives` (the pattern every
  other arxa plugin client uses), same `side: 'top'`, `delayMs: 200`, disabled while the card is
  open, plus the trigger's `:hover` wash. Label reads like the context ring's: "35% of 5-hour
  window used".

Verified on screen 03:28–03:30: row evenly spaced, hover wash on the trigger, card open with
three rows. `selftest.mjs` pins one `Meter`, `numeric[0]` as the ring's window, the Tooltip
props, and every `arxa-ps-*` class ContextMeter has.

### Ninth, follow-up: colour and air in the card (2026-09-06)

- Per-window tints on ContextMeter's own three tokens: 5-hour `--dsw-static-blue-450`, weekly
  `#a78bfa`, per-model `--dsw-static-neutral-bluish-400`. Swatch, bar and the header countdown
  share the window's tint; a window running low keeps the ring's amber/red instead (`tintOf`).
- Rows read `36% / 23m`, header figures show the countdown alone — the words "resets in" are gone.
- Padding 14/16px, row padding 4px, bar margins 12/14px. Verified on screen 03:36.

### Ninth, follow-up 2: accent-tinted ring, tighter pair (2026-09-06)

- The healthy arc is now `--dsw-alias-button-info-fill` (the send button's accent, which
  theme-accent remaps with the palette) at 0.55 opacity, so the usage ring is a tinted sibling of
  the grey context ring. Amber/red stay solid. `RING_COLOR` returns `ACCENT` for healthy, and the
  card's `tintOf` keys off the same constant.
- `.arxa-ps-root{margin-left:-6px}` pulls the usage ring to 6px from the context ring (the row's
  own gap is 12px); the gap to send is unchanged. Verified on screen 03:41.

### Ninth, follow-up 3: the 6px is between the circles, not the buttons (2026-09-06)

`margin-left:-6px` put the 28px *triggers* 6px apart, but each pads its 13px ring by 7.5px, so
the circles the user sees were 22px apart. The margin is now `-22px` (the row's 12px gap plus
both paddings, minus 6): measured on screen, context circle at x 219–230, usage circle at
237–248 — 6px between them. Trade-off recorded in the source: the hover wash now overlaps the
context ring's edge by ~2px.

Also caught: a sandboxed patch had thrown silently, the old pin passed, and the unchanged file was
synced — "tests green + synced" proved nothing. The re-run was chained with `&&` through the shell
so a failing step stops the chain, and every live copy was grepped for the new value.

### Ninth, follow-up 4: 12px, so the hover washes clear each other (2026-09-06)

At 6px between circles the two 28px hover washes overlapped. `margin-left:-16px` now: 12px
between the circles, still tighter than the row's own gap, washes just touching at most.

## Tenth: the joiner was never published to (2026-09-06)

"Cannot see the usage ring" after a relaunch, with the row for the *other* session in the store
9 s after boot and the on-screen session's Claude rows only at +67 s — the 60 s tick.

Two defects, one per side:

1. **Host.** `refresh()` de-duplicated concurrent reads by returning the in-flight promise, but
   only the session that *started* the read was published to when it landed. A session that
   joined (the composer on screen, asking a second later) answered from an empty store. Fix:
   the in-flight entry carries a `pending` set; every joiner is added and published to on
   landing, and `sessions` starts from that set. `selftest.quota.mjs` covers it (23 ok).
2. **Browser.** The retry ladder stopped on any non-null reply. Right after boot the host's
   provider-less answer is whichever provider landed first (the cheap vendor polls), which the
   Fable filter hides — a reply that draws nothing counted as success. Fix: a reply for another
   provider is a miss for the ladder.

Verified: after relaunch at 17:53:17Z both sessions got Claude rows at 17:53:26.20, together.

## Eleventh: Kimi's reset times were dropped (2026-09-06)

The card showed no reset for either Kimi window while GLM's were fine. Live payload from
`GET /coding/v1/usages`: `resetTime` is an **ISO 8601 string with microseconds**
(`"2026-09-12T00:45:13.375515Z"`), not epoch ms as the old `toUnixSeconds` comment claimed;
`num()` returned undefined and the reset was silently omitted. `toUnixSeconds` now parses a
non-numeric string with `Date.parse` (garbage stays undefined, never 1970). `selftest.quota.mjs`
pins the live shape for both windows (24 ok).

## Twelfth (2026-09-06): "Balance", and one path, not two

- **Wallet label.** DeepSeek's pill read `DeepSeek $9.56`. The picker beside it already says DeepSeek, and a wallet is a different kind of thing from a window, so the text is now `Balance $9.56` (`Balance empty` when spent). `lib/quota.js` deepseekToStatuses; the title keeps the vendor name for the tooltip. Any pay-as-you-go vendor added later reads the same way.
- **Composer crumb dropped.** arxa-sidebar registered a breadcrumb (`RESTO / notes / note-wt-…`) in `conversation.input.left`; the git card above the composer already carries that path. Removed the registration (scripts/gen-workspace.mjs), the component + nav + segment builder + CSS + `crumbs.label` locale keys (lib/workspace-region.snippet.txt), regenerated `lib/client.js` with `node scripts/gen-workspace.mjs --write`. The hero-slot bound state keeps its hidden anchor so the empty-state effect still finds the stack.
- **Tests.** selftest.quota pins `Balance $9.56` / `Balance empty`; arxa-sidebar selftest now asserts the crumb is absent and the drift gate is green.
