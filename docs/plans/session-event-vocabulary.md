# Custom session events make a whole conversation unreadable

Reported 2026-09-05:

> Failed to load history: … session "arxa-RESTO-notes-note-wt-260905-001" contains event type
> "claude-code/session" (seq 15) unknown to this harness and not marked ignorable

## Mechanism

`dsh-session-persistence` `assertEventsSupported` walks a log on read and throws on the FIRST
event whose type is outside `KNOWN_SESSION_EVENT_TYPES` (48 types) unless the envelope carries
`ignorable: true`. It refuses the entire log, not the event.

`Session.append(type, data, ...opts)` builds `{type, seq, time, data, ...surfaceMetadata}` — the
only opts it reads are `sourceEventSeqs` and `surfaceOp`. **There is no way to set `ignorable`.**
dsh's own known-event-types note says a registration surface for downstream plugin events is
"deferred until such a consumer exists". arxa is that consumer, so today the rule is: only append
types dsh already knows.

The flag itself is not the obstacle — `adoptSessionEvent` preserves unknown envelope keys and the
jsonl backend never strips them, so `ignorable: true` *would* round-trip if anything could set it.
That makes this recoverable: if dsh ever exposes the flag, the two damaged logs render again.

## Why it stayed hidden

Appending works. The turn runs. The transcript is written correctly. Only *reopening* the session
fails, and only through the `history` RPC — which returns an error the composer renders as "Failed
to load history". The conversation text is intact on disk (readable with `zstdcat`); arxa simply
refuses to serve it. Nothing goes red until a user restarts, which is why a week of Claude turns
looked fine.

## Measured scope

Replicating the check over all 52 sessions on disk:

- before: **2 refuse to load, 50 fine** — `claude-code/session` at seq 15 and seq 1251, the only
  two sessions that had run a Claude turn.
- simulating removal of `claude-code/*` only: both **still** break, on `provider/status` at seq 19
  and 1252. First-offender was the wrong test; sole-offender is the right one. All three of arxa's
  custom types had to go.

## The three types, and where each went

| type | was | now |
|---|---|---|
| `claude-code/session` | session event, read back for the resume id | in-memory `Map` on the adapter |
| `claude-code/answered` | session event (added 7bcf0c3, this session) | not recorded; still drives the mismatch pill |
| `provider/status` | session event feeding a projection | host memory + Connection RPC |

## What it cost

The session projection was the only server→client PUSH channel, and it is exactly the channel that
corrupts the log. Connection RPC is unary (`call` → Promise, no subscribe), so the badge is now
pull-based: the client asks on mount, on every provider change, and on a 15s tick.

Two deliberate losses:

- **Resume across an arxa restart.** The resume id lives in process memory, so after a restart the
  next turn starts a fresh child and replays the conversation as handoff text — the path the
  adapter already took for a session another engine ran. Losing a resume degrades one turn; losing
  the log's readability loses the whole conversation.
- **Status durability.** A host restart clears the pill until the next rate-limit event refills it.

Gained, from the same rework: the pill now reads the **model picker's own store**
(`modelDirectories.directoryFor(sessionId).store`), so it hides and reappears the instant a model
is switched rather than waiting for a turn — and because the pill and dsh's selector read one
store, they cannot disagree.

## The gate

`scripts/session-event-vocabulary-check.mjs`, wired into `scripts/ci.mjs`. It reads the vocabulary
out of the installed dsh (so a dsh upgrade is reflected automatically) and fails on any
`.append('type'` under `plugins/` whose type dsh cannot load. This is the check that would have
caught it; a passing selftest never would, because appending is not what breaks.

## Upstream

The real fix belongs in dsh: either an `ignorable` option on `Session.append`, or the deferred
registration surface for downstream event types. Worth filing — arxa is the consumer whose
existence that note was waiting on.
