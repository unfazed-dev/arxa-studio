# Claude sign-in surface + reasoning-effort selector

Status: investigated (systematic-debugging Phase 1-3 complete), ready to implement.
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
