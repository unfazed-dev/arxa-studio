# Claude + git/CI-CD live smoke — findings

Date: 2026-09-04. Branch: `claude-subscription-engine`.
Scope: run the claude-subscription engine against the real `claude` binary and a real
subscription, then drive arxa's git/CI-CD card flow end-to-end on a real org repo
(`unfazed-dev/RESTO`) and open a PR.

Advisor: consulted (approach, scope of the probe fix, and the split below).

## What the run found

Six defects. Three are in this branch's own code (F1-F3); three are in the surrounding
surface (F4-F6). None were reachable by the offline suites — `npm test` was green throughout.
Listed worst-first.

### F1 — the plugin stopped arxa studio from booting at all (critical)

`plugins/claude-code/index.mjs` declared `authorization` in its top-level `inject`. No arxa
profile row mounts `@deepseek-ai/dsh-authorization`, so the plugin stayed `pending` forever
and dsh failed the whole plugin tree:

```
dsh: plugin tree failed to load: dsh: 1 entry did not activate
  plugins/claude-code/index.mjs: pending (waiting for service: authorization)
```

That is the entire app refusing to start, not a degraded feature. `npm test` was green
throughout — nothing in the suite boots the real plugin tree, and the offline tests inject a
fake `ctx.authorization`, so the missing service was invisible.

**Fix:** follow the pattern `@deepseek-ai/dsh-llm-pi-ai` already uses for this same seam —
declare only the services the plugin truly requires and reach authorization through a
deferred `ctx.inject(['authorization'], cb)`. The adapter now always loads; the sign-in
surface attaches only where the service exists. Commit `4bc6988`.

### F2 — every sign-in check reported a signed-in user as signed out (major)

`Probe.run()` passed a never-yielding prompt to `query()` and awaited a `system/init`
message. The CLI does not emit init until a prompt actually yields, so the probe never got
one: it ran to its full 15s timeout on every call and returned
`{ loggedIn: false, error: 'Operation aborted' }`, with the model picker silently falling
back to the 4-row `STATIC_MODELS`.

Measured, confined, against the real binary:

| pattern | result |
|---|---|
| never-yielding prompt + `maxTurns: 0` (shipped) | aborted at timeout |
| never-yielding prompt, no `maxTurns` | aborted at timeout |
| never-yielding prompt, no `tools` | aborted at timeout |
| `startup()` | handshake in **739ms** |
| `startup()` + `query(never)` + `accountInfo()`/`supportedModels()` | **791ms, 5 live models, 0 tokens** |

Confinement was ruled out first: a confined `claude --version` and a confined
`claude -p "say OK"` both succeed, so the sandbox and the credential were never the problem.

**Fix:** `startup()` completes the initialize handshake itself, which is what makes the probe
bounded. `accountInfo()`/`supportedModels()` are control requests over the channel it opens,
so the probe still spends no tokens. Two consequences handled:

- `init.apiKeySource` is no longer on this path. The authoritative API-key refusal was never
  here — it is `bridge.js:42`, on the init message of each real turn — so the security
  property is unchanged. The probe now reports `apiProvider` (`firstParty` = Anthropic OAuth).
- `init.claude_code_version` is gone too, and `adapter.js:127` gates Fable on it. The probe
  now reads the version from `claude --version` through the same confining spawner. A failed
  version lookup returns `undefined` rather than demoting a signed-in user to signed-out.

Commit `6f7ec9f`. `selftest.probe.mjs` was rebuilt: its old fake yielded an init the real
binary never sends, which is exactly why the bug shipped. The new fake's stream never
settles, so any return to awaiting it fails the suite — verified by mutation.

### F3 — the live smoke script had never been run

`scripts/claude-code-smoke.mjs` was committed in `bc3ea15` and never executed. It failed
before its first assertion on `require.resolve('@anthropic-ai/claude-agent-sdk/package.json')`
— the SDK's `exports` map has no `./package.json` subpath — and then again on a `Probe`
constructed without the spawner that commit `fa9becc` had made required. Commit `9f95411`.

### F4 — a failed session create reported success and poisoned the session id (observed once)

The first `workspace.new-session` on RESTO returned `ok: true` with a complete session
record — id, branch, worktree path, `state: "open"`, `dshSessionId` — but nothing durable
landed: the registry (`.git/arxa/sessions.json`) still held only the four archived sessions
from 2026-09-03, `git worktree list` showed only the main checkout, and the card could not
find the session (`session-not-found`). The branch `arxa/RESTO/notes/note-wt-260904-001`
*was* created (at main's tip), so the create got partway and then stopped.

The leftover directory then poisons that session id permanently — the next attempt fails with:

```
git worktree failed in /Volumes/business_ssd/RESTO: Preparing worktree (new branch 'arxa/RESTO/notes/note-wt-260904-001')
fatal: '/Volumes/business_ssd/RESTO/.arxa/worktrees/RESTO/notes/note-wt-260904-001' already exists
```

After removing the stale directory and branch, session creation worked correctly every time —
with and without a `title`, registry 4 → 5 → 6, real worktrees, branches checked out. So the
trigger is not reproducible on demand; the most likely candidate is a race with `org.open`'s
own housekeeping commits (`0241521`, `93abf7e`), which were being written at that moment.

What is proven regardless, and is the part worth fixing: **a create whose `git worktree add`
fails still returns `ok: true` with a full session record**, and leaves a directory behind
that makes the same id unusable forever after.

### F5 — arxa's GitHub link holds a dead credential, and the card hides it

Every arxa-initiated GitHub call fails. `card.pr.create` names it exactly:

```
github-link: PR create failed (401: Bad credentials)
```

`card.commit`'s embedded push and the standalone `card.push` both report the opaque
`push-failed`. This is not a missing retry — `index.js:290-301` already does the forced
refresh and one retry that the D76 machinery was built for; the refresh itself no longer
recovers the token, so re-authorisation is needed (an interactive OAuth flow, the user's to run).

Two things make this worse than a stale token:

- **The read path fails silently.** With PR #6 open on the branch, `card.pr.status` returns
  `ok: true` with `pr: null` and `checks.state: "unknown"` — the card shows "no PR"
  rather than "cannot reach GitHub". A user cannot tell the two apart.
- **The write path's error does not name the cause.** `push-failed` gives the user nothing
  to act on; the underlying 401 is only visible on the PR-create path.

This is the same root cause as the open items already on record: TOPO's
`githubStatus: publish-failed … Invalid username or token`, and RESTO's `main` sitting
unpushed (B2). `status.linked` is `true` and `tokenAvailable` is `true` throughout, so
no surface reports the link as broken.

### F6 — the mirror tool list is out of sync with the real CLI, in both directions

With the live smoke's Q1 finally able to read a real init message, the CLI's own tool list
can be compared against `MIRROR_TOOL_NAMES` for the first time. They disagree both ways.

Live built-ins with **no mirror row** (16): `CronCreate`, `CronDelete`, `CronList`,
`DesignSync`, `EnterWorktree`, `ExitWorktree`, `ListAgents`, `Monitor`,
`PushNotification`, `RemoteTrigger`, `ReportFindings`, `ScheduleWakeup`,
`SendMessage`, `TaskOutput`, `TaskStop`, `Workflow`.

Mirror rows the live CLI **does not expose** (11): `MultiEdit`, `BashOutput`,
`KillShell`, `Glob`, `Grep`, `LS`, `Agent`, `TodoWrite`, `AskUserQuestion`,
`ExitPlanMode`, `EnterPlanMode`.

Both lists above are **measured output from a passing assertion**, not inferred: Q1 now reads
the init message of a real turn, so the comparison is against what the pinned CLI actually
advertises. Regenerate `MIRROR_TOOL_NAMES` from a live init whenever the pinned
`@anthropic-ai/claude-agent-sdk` or `claude` version moves — that is the only thing that
keeps the two in step.

**A note on Q2's limits.** Q2 asks whether the `tools` allowlist admits MCP names, and it
tried to answer by having the model call `mcp__arxa__gen_ui` end to end. A live model's
tool choice is not an invariant — it twice chose `ToolSearch` instead — so that assertion
is soft by nature and a red Q2 does not imply a broken bridge. The question is in fact
answered by construction: `adapter.js` builds
`tools: [...MIRROR_TOOL_NAMES, ...arxaMcpToolNames(schemas)]`, and Q1 proves `tools` is the
option the CLI honours. Treat Q2 as an end-to-end nicety, not a gate.

This is lost capability, not a hang: `tools` restricts the child to the mirror names plus
the arxa MCP names, so Claude simply cannot reach the 16. But the list was written from an
assumed tool set rather than a measured one, and it will drift again on the next CLI
release. Worth regenerating from a live init and re-checking when the pinned CLI moves.

## The PR

**[unfazed-dev/RESTO#6](https://github.com/unfazed-dev/RESTO/pull/6)** —
`docs(notes): the winter menu changeover the kitchen will run`, six files across
`notes/`, `meetings/` and `communications/`, commit `752e584`.

- **Content:** written by Claude (Sonnet) on the subscription, through arxa's
  `ClaudeCodeAdapter`, arxa's sandbox and arxa's mirror tools — 6 `Write` calls over 8
  turns. Asserted at run time: `providerInfo().id === 'claude-code'`, `apiProvider ===
  'firstParty'`, every listed model from the `claude-code` provider.
- **Commit and gate:** through the arxa git card. `card.commit` squashed the session's
  three `wip: auto-save (watcher)` commits into one conventional commit and ran the
  `check.sh` frame gate: `gate: {green: true, kind: 'check.sh'}`.
- **CI:** green on the self-hosted runner for both the `push` and `pull_request` events
  (runs 33854971249 and 33855090350, 17-18s).
- **Pushed with `gh`, not by arxa** — blocked by F5. The branch, the commit and the gate
  are arxa's work; only the GitHub transport was substituted, and the PR body says so.

One content note: Claude wrote the costing file to `account/`, which `.gitignore` never
tracks by design (D37, financial records stay local). It moved to
`notes/winter-menu-2026/03-costing.md` and its cross-references were updated. Not a bug —
worth knowing that a valid dock is deliberately untracked.

## What is proven, and what is not

Proven against the real binary and a real subscription:

- `apiKeySource: 'none'` on the turn's init; a text turn; a mirror-tool round-trip; and a
  write outside the workspace denied by the sandbox (`part A: all green`).
- The probe returns bounded and correct: signed in, `firstParty`, live CLI version, and a
  model list strictly larger than the static fallback.
- arxa studio boots with the plugin mounted, and the git card answers over HTTP.

Not covered — stated plainly rather than implied:

- **dsh's conversation/agent mux is not exercised.** The Claude turn that produced the PR
  content ran through arxa's own `ClaudeCodeAdapter`, sandbox, scrubbed env and mirror tools,
  pointed at the session worktree — but not through the browser WebSocket protocol the real
  UI uses. Driving that would have meant reverse-engineering the mux.
- `arxa --headless` cannot run arxa's profile at all: eight UI plugins require `webServer`.
  Pre-existing, unrelated to this branch.
- The composer status pill's browser render remains unverified.

## Open items carried forward

- **B2 (from `resto-cicd-3pr-smoke.md`) is still open, and F5 explains it.** RESTO's local `main` sits ahead of
  `origin/main` by two arxa housekeeping commits (`0241521 chore(github): record link state`,
  `93abf7e chore(ci): refresh the arxa frame to v5`), both written by arxa when the org was
  opened. Session branches are cut from local main, so they ride into any PR opened from one.
- TOPO is unusable for this flow: `org.json` carries
  `githubStatus: publish-failed … Password authentication is not supported`. RESTO is the
  healthy org (`published`, frame wired, runner online).
- `.superpowers/` is untracked but **not** gitignored, so `git add -A` would sweep the SDD
  workspace into a commit.

## F7 — the GitHub link is genuinely dead; the cause is NOT established

**Correction to the first version of this entry.** It claimed the smoke's second
engine caused this through a refresh-token rotation race, and said so to the
user. That claim does not survive the next measurement and is retracted. The
timing overlap was real; the causal link was not.

**It never "unlinked".** `~/.arxa/github-link.json` still reads `linked: true`,
`login: unfazed-dev`, all four scopes. What flipped is `relinkRequired: true`,
`relinkReason: "token request error: incorrect_client_credentials"`, written
2026-09-04T09:01Z.

**Measured**

- Access token in the keychain: `gho_` prefix, 40 chars → an **OAuth App** user
  token (a GitHub App would be `ghu_`). Matches the `Ov23liFN…` OAuth App client
  id in `~/.arxa/github-link-config.json`, which overrides the shipped
  `Iv23licJ…` GitHub App id.
- Refresh token: `ghr_`, 80 chars. Both keychain items have `mdat`
  `20260904083217Z` — the same second — so a secret-less refresh **succeeded**
  at 08:32:17Z and stored a fresh pair.
- `accessExpiresAt` is `16:32:17.305Z` = exactly +8h, confirming that write.
- **`GET /user` with that token returns 401 Bad credentials right now** — hours
  before its recorded expiry, with no later successful refresh written to the
  keychain.

**Why the rotation-race story fails.** A race leaves the *winner's* valid token
in the keychain; the loser re-reads it and recovers. Here the keychain holds a
token that is dead well before expiry and no newer one was ever written. Nothing
local invalidated it — the grant was invalidated **server-side** between
08:32:17Z and 09:01Z. Most likely the authorization was revoked (GitHub →
Settings → Applications → Authorized OAuth Apps will show this), or the OAuth
app's credentials changed. That cannot be determined from this machine, and it
is not attributable to the smoke.

**Supporting note already in the codebase** (index.js:44): a 2025-08 probe
recorded that GitHub answers `incorrect_client_credentials` for a secret-less
web-flow exchange, device flow being the only secret-less path it grants OAuth
apps. So that error string is what this app sees whenever GitHub declines to
honour a secret-less request — it does not by itself mean "wrong client id".

**Fix for the user:** one re-link from Settings. Nothing else recovers a
server-side revocation.

## F8 — four real defects found while diagnosing F7 (all fixed)

None were reachable by any existing suite; all four are covered now by
`plugins/github-link/selftest.token-refresh.mjs` (5 assertions), and each was
mutation-verified — reverting the fix fails the suite.

1. **Blank client id was sent as `''`** — `getToken()` did
   `getClientId(env) ?? SHIPPED_CLIENT_ID`, but `getClientId` ends in `||`, so a
   config file with a blank `clientId` yields `''`, which `??` passes straight
   through. GitHub answers `incorrect_client_credentials` — the *same* error a
   revoked grant gives, so the blank would send you hunting the wrong fault.
   Now `||`. `link()` deliberately keeps `??`: a blank config must hit its loud
   guard there, never silently link against a different app than the configured
   one.
2. **`relinkRequired` was write-only** — `getToken()` wrote the flag, but
   `readState()`'s field whitelist dropped it, so `status()` (which spreads
   `readState()`) never carried it to the UI. The comment claiming "status()
   surfaces it" was false. This is why every push failed with a bare 401 and
   nothing said "re-link". Both fields are now on the whitelist.
3. **A successful refresh kept a stale `relinkRequired: true`** —
   `writeState({ ...state, accessExpiresAt })` carried the flag forward forever,
   nagging past the actual fault. Now cleared on success.
4. **A rotation by another process forced a full re-link** — GitHub burns both
   tokens on every rotation, so a second arxa process refreshing first left this
   one holding a superseded token. `getToken()` now re-reads the keyring once on
   failure and retries if the stored refresh token changed, self-healing instead
   of demanding interactive OAuth. Exactly one retry, and only when the token
   actually changed — an unchanged token makes no second request.

Also fixed alongside: `getToken()` used the module constant `SHIPPED_CLIENT_ID`
while `link()` used the injected `shippedClientId` param, so a custom-wired
service refreshed against a different app than it linked with.

**Not fixed — F6 needs the user's call.** The mirror tool list (21 names) drifts
from the live CLI in both directions. Adding the missing built-ins widens what
the model can reach inside arxa's sandbox, which is a capability decision under
the standing security constraints, not a defect fix; and the phantom rows are
asserted by `selftest.mirror-gate.mjs` in five places and may be deliberate
forward-compat. Needs a fresh live init plus a decision on which tools arxa
intends to expose.
