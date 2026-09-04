# Claude sign-in surface + reasoning-effort selector

Status: F12/F13/F14 fixed and verified live; F11 partially fixed (see Outcome).
Trigger: user picked Opus, got no effort control, and the turn failed with
"claude-code: not signed in" while the CLI was demonstrably signed in.

## Phase 1 — evidence

Instrumented every boundary (engine env -> scrubEnv -> binary resolution ->
confining spawner -> `startup()`), scripts in `scratchpad/probe-*.mjs`.

| Boundary | Result |
|---|---|
| shell env | `loggedIn=true` firstParty Claude Max, CLI 2.1.260, 1440 ms |
| GUI-minimal env (`PATH=/usr/bin:/bin:...`) | `loggedIn=true`, falls back to the **bundled** CLI 2.1.259, 5962 ms cold |
| sandbox `workspace-write` + sessionId | `loggedIn=true`, 989 ms |
| sandbox `workspace-write`, no sessionId (`resolve({})`) | `loggedIn=true`, 1392 ms |
| sandbox `read-only` | `loggedIn=true`, 1112 ms |
| 4 concurrent probes, PATH and bundled binaries | all `ok`, 1375 / 1798 ms |

**The probe is not fragile.** Sandbox, environment, binary choice and
concurrency were each eliminated by measurement, not by argument.

Live `supportedModels()` returns ids `default`, `opus[1m]`,
`claude-fable-5-1[1m]`, `sonnet`, `haiku` — with
`supportedEffortLevels: ["low","medium","high","xhigh","max"]` and
`supportsEffort: true` on the reasoning models. `accountInfo()` returns only
`email, organization, subscriptionType, apiProvider` — **no `apiKeySource`**.

## Phase 2/3 — root cause

`dsh-client-ui-model-selection/lib/client.js`:
- `:312` `const reasoning = currentChoice?.model.reasoning`
- `:490` the Effort menu row renders **only** when `reasoning !== undefined`
- `:419` the chip reads `` `${modelLabel} · ${effortLabel}` `` when effort exists

The screenshot's chip read plain **"Opus"** — no `· effort`. So `resolveModel`
returned **no `reasoning` key**. dsh's UI is correct and needs no change.

`plugins/claude-code/lib/adapter.js:50`:
```js
const row = account.models.find((m) => m.id === model) ?? { …, efforts: [] }
```
`STATIC_MODELS` ids are `fable, opus, sonnet, haiku`. Live ids are
`default, opus[1m], claude-fable-5-1[1m], sonnet, haiku`. **`opus` and `fable`
never match a live id.** The lookup falls through to a synthetic row with
`efforts: []`, `reasoning` is omitted, and the effort control hides — *even
when signed in*. Any user who picks Opus or Fable from a cold-probe list, or
whose stored selection predates a good probe, loses the effort control
permanently.

This also explains the "5 turns succeeded, then not signed in" sequence: the
turns ran fine on a working probe; the id mismatch is independent of sign-in.

## Findings

- **F12 — model id-space mismatch (root cause of the missing effort selector).**
  `STATIC_MODELS` ids do not exist in the live model list. Confirmed.
- **F13 — every probe failure is reported as "not signed in".**
  `adapter.js:126` throws a fixed string and discards `account.error`, which
  carries the real cause (timeout, spawn failure, missing binary). This is why
  the failure was undiagnosable from the UI.
- **F14 — the failure is a dead end.** It names a terminal command but offers
  no route to the sign-in surface. `dsh-authorization` supports
  `notify({ message, url?, code? })`; `claudeAuthFlow` currently sends `code`
  only, and the composer error names no surface at all.
- **F15 — the probe is heavier than the question.** Answering "is the user
  signed in?" costs a full `startup()` handshake (1.4-6 s). `claude auth status`
  exists and answers it directly.
- **F11 (carried) — `plugins/claude-code` has no `package.json`,** so
  `arxa-engine-sync` skips it and it is absent from *every* engine payload
  (verified: `ls -d ~/.arxa/engine/*/arxa-studio/plugins/claude-code` is empty).
  It works here only because the profile row loads it by absolute repo path —
  impossible on a user's install. `bin/arxa-engine-sync.mjs` also never copies
  `profile/`.

Not a defect: `apiKeySource` is enforced on the real init message at
`bridge.js:42` (selftest `selftest.bridge.mjs:99`). The `probe.js:70` copy is
always `undefined` because `accountInfo()` does not return it — dead field.

## Fixes

1. **F12** — add `matchModel(models, id)` in `models.js`: exact id, then the
   id before `[` (so `opus` matches `opus[1m]`), then case-insensitive. Use it
   in `resolveModel` and `stream`. Align `STATIC_MODELS` ids to the live
   spelling so a cold-probe pick still resolves once the probe warms.
2. **F13** — carry `account.error` into the thrown message, and distinguish
   *not signed in* from *probe failed*.
3. **F14** — the sign-in surface, reusing dsh's own UI (no new UI):
   - `claudeAuthFlow` notifies with `code: 'claude auth login'` **and** a `url`
     to the official sign-in docs, and detects "no binary" separately from
     "not signed in" so the message matches the user's actual situation.
   - The composer error names the surface: Settings -> Models -> Claude Code.
4. **F15** — use `claude auth status` for the liveness check; keep `startup()`
   only for the model list.
5. **F11** — add `plugins/claude-code/package.json`; make `arxa-engine-sync`
   copy `profile/`; switch the profile rows from absolute repo paths to
   package names.

## Verification

- selftests: `selftest.probe.mjs`, `selftest.adapter.mjs`, `selftest.auth-flow.mjs`
- new: a regression asserting `resolveModel('opus')` returns `reasoning` with
  five efforts against a live-shaped model list — the exact defect
- `node scripts/ci.mjs` green
- live: chip reads `Opus (1M context) · High`, effort menu lists five levels

## Global constraints (unchanged)

`permissionMode: 'default'`; `settingSources: []`; child env is `scrubEnv`;
refuse the turn if `apiKeySource !== 'none'`; **arxa never launches
`claude auth login`** — it shows the command and re-checks. No token, email or
`~/.claude` content is printed, logged or committed.

## Outcome (2026-09-04)

**F12 fixed.** `matchModel()` in `lib/models.js` resolves a picked id to a live model
by family: exact -> case-insensitive -> base before `[` -> whole-token match. Verified
against the live SDK:

```
picked "opus"  -> id=opus[1m]              chip="Opus (1M context) · high"  efforts=low,medium,high,xhigh,max
picked "fable" -> id=claude-fable-5-1[1m]  chip="Fable · high"              efforts=low,medium,high,xhigh,max
picked "haiku" -> id=haiku                 chip="Haiku"                     efforts=NONE (correct — not a reasoning model)
```

dsh's own picker is unchanged: it renders the effort row as soon as `resolveModel`
returns `reasoning`, which it now does.

**F13 fixed.** `signedOutMessage()` separates three cases that used to be one fixed
string: genuinely signed out, no CLI installed, and probe-failed-for-another-reason
(which now carries `account.error` and says the sign-in may be fine). Selftests cover
all three.

**F12, turn side.** `stream()` resolves `options.model` through the same matcher, so
the turn runs on the id whose capabilities were advertised — dsh stores whatever the
picker listed, and a cold-probe list stores `opus`. Regression: *"a turn runs on the
resolved live id, not the static id the picker stored"*.

**F14 fixed — with an honest limit.** The sign-in notice now carries `code` (the copyable command) **and**
`url` (the install docs), and the signed-out message names the surface —
Settings -> Models -> Claude Code — which waits and picks the sign-in up
automatically. arxa still never launches `claude auth login`.

There is **no terminal-opening link**, because no such affordance exists: `notify`
carries `message`, `url` and `code` only, and no OS URL scheme opens a terminal at a
command. What a signed-out user gets is the copyable command, a link to the install
docs, and a sign-in surface that polls and picks the login up on its own the moment it
succeeds — so they never have to come back and re-select the model.

**F15 not done.** `claude auth status` would answer the liveness question far cheaper
than a `startup()` handshake, but the probe is not the bug and changing it now would be
an unforced risk. Left as a follow-up.

**F11 partially fixed.** `bin/arxa-engine-sync.mjs` now compares a **content hash**
instead of a package version, copies every plugin directory (not only those with a
`package.json`), and copies `profile/`. Gated by `bin/selftest.engine-sync.mjs`, wired
into CI. The first run proved the old traps were live, not theoretical:

```
synced plugins/claude-code: MISSING      -> a00ca8f055dc   (absent from EVERY payload)
synced plugins/sandbox:     4a5f54770db5 -> 15e5c6e29828   (stale: same version, different bytes)
synced profile:             441b96556e8d -> c902dc78997e   (never copied at all)
```

**Remaining blocker, unfixed and deliberate:** the payload carries no
`@anthropic-ai/claude-agent-sdk`, and both claude-code rows (host plane in
`profile/cordis.patch.yml`, agent plane in `profile/agent-presets/arxa/agent.cordis.yml`)
load the plugin by **absolute repo path**. So claude-code still runs only on a machine
holding this checkout. Shipping it needs the SDK vendored into the payload and the rows
switched to package names — a distribution change that should not be improvised
alongside a bug fix. `arxa-engine-sync` now prints this as a warning on every run rather
than leaving it silent.

## What was NOT the cause

Ruled out by measurement, not argument — recorded so nobody re-investigates them:
the sandbox (all three policy modes), the GUI-minimal environment, binary choice
(PATH vs bundled), probe concurrency, and `modelsFromSdk` (which was correct
throughout). `apiKeySource` enforcement at `bridge.js:42` is intact.

## F16 — `#toolchainRoots` through the cordis proxy (found by the F13 fix)

The F13 message change paid for itself on its first run. Instead of a fake "not signed
in", the app reported:

> claude-code: could not reach Claude Code (Cannot read private member #toolchainRoots
> from an object whose class did not declare it)

**Root cause.** dsh hands every consumer `ctx.<service>`, which is a cordis tracking
**Proxy**, not the instance. A JS `#private` field cannot be read through a Proxy —
inside the method `this` is the proxy, which is not an instance of the declaring class.
`ArxaSandboxProvider` memoized its toolchain roots in `#toolchainRoots`
(`plugins/sandbox/lib/index.js`), and `extraWritableRoots()` reads it on every confined
spawn. So **every** `ctx.sandbox.confine()` call threw.

Reproduced in one run, three paths:

```
RAW instance       : ok
via ctx.sandbox    : THROWS -> Cannot read private member #toolchainRoots …
via cordis.original: ok
```

**Why every earlier test passed.** Every existing test — mine included — constructed the
provider and called `confine()` on the **raw instance**. Production never does. The
suite tested a path no caller uses.

**Why turns worked while the probe did not.** `extraWritableRoots()` returns early
unless the mode is `workspace-write`, so the private field is only read in that one
mode. Measured against the pre-fix file:

```
danger-full-access -> ok       (early return, field never read)
read-only          -> ok       (early return)
workspace-write    -> THROWS
```

The session runs **Full access**, so every turn's confined spawn was fine. The probe
does not belong to a session: `index.mjs` builds its spawner from
`ctx.sandboxPolicy.resolve({})`, the agentless deployment default —
`workspace-write`. So the probe, and only the probe, threw on every call.

**This is also the original "not signed in".** One defect produced every symptom:
probe throws -> `loggedIn: false` -> the old fixed string said "not signed in" ->
`listModels` fell back to `STATIC_MODELS` -> the picker stored `opus` -> `resolveModel`
missed the live `opus[1m]` -> no `reasoning` -> no effort control. F12 is still a real
defect (a stored id outlives any probe), but F16 is what triggered the whole sequence.

**Correction.** An earlier draft of this section claimed the desktop payload's stale
`plugins/sandbox` had shielded the bug until the content-hash sync brought it current.
That was wrong: `profile/cordis.patch.yml:102` loads sandbox by **absolute repo path**,
so the payload copy is never loaded and its staleness shielded nothing. `e7f500c` landed
2026-09-02 and was in master well before this session. The mode matrix above is the
actual explanation.

**Fix.** The memo is a plain property (`toolchainRootsMemo`), not a `#private` field.
Ordinary properties forward through the proxy untouched. Fixing it in the provider
covers every call site, rather than asking each caller to remember
`Symbol.for('cordis.original')`.

**Gate.** `plugins/sandbox/selftest.mjs` now calls `confine()` through `ctx.sandbox` and
asserts the memo still memoizes through the proxy. Swept the rest of the plugin tree:
`ArxaSandboxProvider` is the only class extending a dsh Service, and the only host-plane
private field. (`plugins/arxa-frame/lib/client.js` uses private fields but is
browser-plane and extends no Service — unaffected.)

**Standing rule:** no `#private` fields in a class registered as a dsh service.
