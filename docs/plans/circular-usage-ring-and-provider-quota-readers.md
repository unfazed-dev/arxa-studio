# Circular usage ring + quota readers for Z.ai, Kimi and DeepSeek

Replaces the text pill in the composer row with a two-tone circular indicator, and
gives the three non-Claude providers a usage source of their own.

Decisions below marked **(locked)** were made by the operator in the grilling pass;
they are recorded, not re-argued.

## What the ring is

A ~18px SVG ring at the right of the composer input.

- **Track**: the accent colour at 15% opacity, full circle. Always drawn.
- **Arc**: the fraction of the window **left** (`1 - utilization`), drawn clockwise from 12 o'clock.
- **Centre**: the percent left, digits only (`92`). The `%` glyph does not fit at 18px
  and the number alone is unambiguous next to a ring; the tooltip spells it out.
- **Colour, from `utilization` directly, never from `level`** (locked, stepped):
  - more than 30% left → accent (`--dsw-static-deepseek-500`)
  - 10–30% left → amber (`--dsw-alias-state-warn-primary`)
  - under 10% left → red (`--dsw-alias-state-error-primary`)

  `level` cannot drive this: `levelFor` turns amber at 0.8 used (20% left), but the
  locked threshold is 30% left. A 0.75-used status must render amber.

- **Tap to cycle** (locked): providers run more than one window at once. The ring shows the
  binding one; clicking advances through the rest. Keyboard-reachable (`role="button"`,
  Enter/Space), because the click is the only way to reach the other window.
- **Tooltip and `aria-label` carry every live window**, so the state is legible without
  relying on colour.

### Balance-only providers (locked)

DeepSeek reports a wallet balance with no denominator — there is no percentage to draw.
The ring stays, drawn as a dashed idle track with no arc, and the **amount renders beside
it as text** (`$9.56`). That honours "ring stays, shows the amount, no fill" without
trying to squeeze a currency figure inside 18px.

### Breakage is visible, never blank (locked)

These quota endpoints are undocumented. A failed read renders `?` in the ring with the
reason on hover — never a URL, never a response body. `level: 'info'` ranks below
`warn`/`limit`, so a broken window can never outrank a real one.

Three distinct reasons, because they send the user to three different fixes:

| what happened | hover says |
|---|---|
| HTTP failure | `HTTP 503` |
| the vendor refused inside a 200 | the vendor's own message, stripped to printable and cut at 40 chars |
| the vendor answered something unmappable | `unrecognised response` |

That middle row is not hypothetical. **Z.ai returns application errors with HTTP 200**:
a dead key comes back as `200 {"code":1000,"msg":"Authentication Failed","success":false}`,
which the live smoke hit mid-build. Without relaying it, the ring would have said
"unrecognised response" and sent the user hunting a broken parser when the fix is to
re-enter their key. `vendorError()` in `lib/quota.js` handles it, and bounds the message
because it is vendor-controlled text heading for a tooltip.

A failed read **replaces** what the provider was showing rather than merging into it —
otherwise yesterday's number stays folded in beside the `?`, which is the stale number
this rule exists to prevent. That is `replaceProviderStatus` in `lib/index.js`.

### Empty state (locked)

Nothing renders until data has arrived. Reconciled with the rule above: nothing before
*any* data; a visible `?` once data has existed and then stopped arriving.

## Where the numbers come from

`lib/quota.js` holds one pure mapper per vendor. No I/O, no keys, fully testable.

| provider id (picker route) | endpoint | shape |
|---|---|---|
| `zai` | `GET https://api.z.ai/api/monitor/usage/quota/limit` | `data.limits[]` — `percentage` is **consumed**, `nextResetTime` epoch **ms**. `unit:3,number:5` = 5-hour; `unit:6,number:1` = weekly |
| `kimi-coding` | `GET https://api.kimi.com/coding/v1/usages` | top-level `usage` = weekly; `limits[]` each carry `window:{duration,timeUnit}` and `detail:{limit,remaining,resetTime}`. `duration:300 + MINUTE` = 5 hours. `used = limit - remaining` |
| `deepseek-official` | `GET https://api.deepseek.com/user/balance` | `balance_infos[]` decimal strings, per currency. No denominator → no arc |

Two facts that shape the code:

- Every producer publishes `utilization` as the fraction **used**. Z.ai's `percentage`
  and Kimi's `used` are already consumption; the ring inverts once, at render.
- Kimi's window labels are **derived from the payload** (`duration`/`timeUnit`), not
  assumed, so a new window upstream labels itself.

Provider ids are the picker's own route keys, verified against dsh: pi-ai registers the
keys of `llm-pi-ai.providers` (`zai`, `kimi-coding`); dsh-llm-deepseek registers
`deepseek-official`. Credential refs are each vendor's dsh default —
`ZAI_API_KEY`, `KIMI_CODING_API_KEY`, `DEEPSEEK_API_KEY` — resolved through
`ctx.credentials.resolve()` per read, never cached, never logged, never placed in any
field that crosses the wire.

**Scope (locked): indicator only.** All three readers ship. `kimi-coding` has no baseURL
or models today and `deepseek-official` has no profile at all, so their rings stay dark
until those exist — then they light up with no code change.

## How it refreshes

A **read-through cache behind the RPC the browser already calls**, not a scheduler.

The browser polls `current` every 60s and re-calls immediately on a provider switch
(`activeProvider` is in the effect's deps). The host answers from what it holds and
refreshes the vendor at most once per TTL.

This is worth stating plainly against the locked refresh rule, because it is not a
perfect match:

| locked | what pull gives |
|---|---|
| provider switch | yes — immediate, the browser re-calls on switch |
| exact reset timing | yes — cache expiry clamps to just after each window's `resetsAt` |
| 5-minute idle floor | yes — that is the TTL |
| turn end | **no** for non-Claude providers — reduces to "within 60s" |

Claude keeps its turn-end refresh (`refreshUsage` in the claude-code adapter); arxa owns
that request path and does not own the others. The justification for pull: refreshing
when no browser is watching updates nothing anybody can see.

Cache rules that are load-bearing:

- Keyed by **provider, not session**. A Z.ai quota is account-wide; a session-keyed cache
  would multiply the 5-minute floor by the number of open sessions.
- Holds the **in-flight promise**, so racing 60s ticks coalesce into one request.
- `AbortSignal.timeout()` on every fetch.
- **Never await on a warm cache.** Return what is held and kick the refresh
  fire-and-forget — otherwise one hanging undocumented endpoint stalls the RPC and the
  ring with it, which is the exact failure the visible-breakage rule exists to prevent.
- On a cold miss the RPC waits a bounded moment, then answers with whatever it has.

The RPC's outbound reach is a hardcoded allowlist keyed by a provider id that must appear
in the vendor table. The handler stays `authority: 'trusted-host'` and one verb.

## Other fixes carried in

- **`warned` becomes per-file, not per-process.** It is a module-global latch today; three
  new publish paths are about to land, and one failing path would silence the warning for
  all of them.
- `detail` is set by none of the new readers. It ships verbatim to the browser, and
  omitting it sidesteps the JsonValue/depth surface entirely.

## Wire shape

`bindingStatus` currently folds siblings into a joined `title` **string**, which leaves
tap-to-cycle nothing structured to cycle to, and `formatBadge` drops `utilization`, which
leaves the arc nothing to draw from. Both change, in both copies:

- `bindingStatus(values)` → `{ ...top, others: [...siblings] }`, joined title kept for the tooltip.
- `formatBadge(value, now, activeProvider)` → passes `utilization` through.

`lib/client.js` duplicates `formatBadge` for the browser bundle, and `selftest.mjs`
extracts that copy by source slice to prove parity. The slice is bounded by
`const relative` … `const COLOR` today; the ring renames that region, so the extractor
moves to a stable `// PARITY-END` sentinel rather than a variable name it should never
have been coupled to.

## The payload was stale, and that is why every previous fix "didn't work"

Found while syncing this change, and it is bigger than this change.

`~/.arxa/dsh/profiles/arxa/node_modules/arxa-provider-status` resolves to a **hard copy**
under pnpm's store, not a link back to the repo. That copy was dated **Sep 4 18:34** and
contained neither `bindingStatus` nor `RPC_CHANNEL` — it was the pre-2026-09-05 build, from
before the durability rewrite. Neighbouring plugins (`arxa-git-card`, `arxa-sidebar`) were
dated Sep 5 01:51.

So the whole previous session's work — the durable store, the wiring-gate fix, the
provider-aware fold, the `/usage` reader — **never reached the running engine**. Every
"still no chip" report was against code from hours earlier. That is a debugging cost worth
naming: the fixes were tested and correct, and the engine was running something else.

**Why only this plugin.** `profile/cordis.patch.yml` mounts the two halves differently:

```yaml
  - id: arxa-claude-code
    name: /Volumes/.../plugins/claude-code/index.mjs     # absolute repo path — always current
  - id: arxa-provider-status
    name: arxa-provider-status                            # package name — via the pnpm copy
```

That asymmetry is the whole explanation. Every fix on the claude-code side took effect
immediately; every fix on the provider-status side went into a copy nobody loaded.

`--materialise-only` does not fix it: it deliberately skips the pnpm install
(`bin/arxa-studio.mjs`, "without pnpm-installing the profile"). Until that refresh is made
reliable, **verify the payload, not just the tests**:

```
P=$(readlink -f ~/.arxa/dsh/profiles/arxa/node_modules/arxa-provider-status)
diff -q "$P/lib" plugins/provider-status/lib
```

Related, and the reason for the second commit: the payload is a **pnpm isolated layout**
and this plugin declares no dependencies, so a bare `@deepseek-ai/dsh-credentials` import
resolved by hoisting rather than entitlement. It worked when tested — and a layout change
would have turned it into a load-time throw that takes the whole indicator down, which is
the same class of failure this feature keeps hitting. The poller now imports nothing but
its own sibling, and `selftest.quota.mjs` asserts that.

## Verified live

`selftest.mjs` 24 ok, `selftest.quota.mjs` 16 ok, plus claude-code's `usage` 11,
`rate-limit` 10 and `adapter` 34 unchanged. Then the shipping poller run against the real
accounts (keys redacted, never printed):

```
zai                 ?  dashed   GLM usage unavailable · Authentication Failed
kimi-coding  week:1  8  red      Kimi weekly limit · 92% used
             hour:5 100 accent   Kimi 5-hour window · 0% used
deepseek-official   —  dashed   DeepSeek balance · $9.56
```

Two facts worth carrying forward: **the stored Z.ai key is dead** — the same endpoint
returned real 5-hour/weekly numbers earlier in the day and now refuses every path
(`/api/monitor/...`, `/api/biz/monitor/...`, and the coding endpoint the adapter itself
uses, which 401s). And the **Kimi weekly is at 92% used** with the 5-hour window untouched,
which is what a configured-but-unused route looks like.
