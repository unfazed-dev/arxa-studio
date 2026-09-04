# Claude + git/CI-CD live smoke — findings

Date: 2026-09-04. Branch: `claude-subscription-engine`.
Scope: run the claude-subscription engine against the real `claude` binary and a real
subscription, then drive arxa's git/CI-CD card flow end-to-end on a real org repo
(`unfazed-dev/RESTO`) and open a PR.

Advisor: consulted (approach, scope of the probe fix, and the split below).

## What the run found

Three defects, all in shipped code on this branch, none reachable by the offline suites.
They are listed worst-first.

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

- **B2 (from `resto-cicd-3pr-smoke.md`) is still open.** RESTO's local `main` sits ahead of
  `origin/main` by two arxa housekeeping commits (`0241521 chore(github): record link state`,
  `93abf7e chore(ci): refresh the arxa frame to v5`), both written by arxa when the org was
  opened. Session branches are cut from local main, so they ride into any PR opened from one.
- TOPO is unusable for this flow: `org.json` carries
  `githubStatus: publish-failed … Password authentication is not supported`. RESTO is the
  healthy org (`published`, frame wired, runner online).
- `.superpowers/` is untracked but **not** gitignored, so `git add -A` would sweep the SDD
  workspace into a commit.
