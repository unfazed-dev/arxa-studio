# Claude models via the user's Claude subscription — research + plan skeleton

Status: research done 2026-09-03; decisions pending grill. No code yet.

## The problem in one line

Users want to pick Claude (Fable/Opus/Sonnet/Haiku) in arxa studio and pay
with their Claude Pro/Max plan, not an Anthropic API key.

## What the docs actually say (primary sources, read 2026-09-03)

**Sanctioned path = run the real Claude Code binary.**
- support.claude.com article 15036540 ("Use the Claude Agent SDK with your
  Claude plan"), Update June 15 2026: *"Claude Agent SDK, `claude -p`, and
  third-party app usage still draw from your subscription's usage limits."*
  The paused plan even named "third-party apps built on the Agent SDK" as a
  covered category. Third-party GUIs driving the official `claude` binary
  are an acknowledged, allowed pattern.
- support.claude.com 11145838: subscription auth is done by `claude auth
  login` / `/login` inside Claude Code. An `ANTHROPIC_API_KEY` in the env
  silently overrides the subscription and bills the API instead.
- code.claude.com/docs/en/headless: `claude -p --output-format stream-json
  --input-format stream-json` is the official programmatic surface;
  `--bare` never reads OAuth/keychain (so NOT usable for subscription runs).
- code.claude.com/docs/en/agent-sdk/typescript: `@anthropic-ai/claude-agent-sdk`
  (npm 0.3.259 today, tracks CLI 2.1.259) bundles the CLI binary, or takes
  `pathToClaudeCodeExecutable`. `SDKSystemMessage.apiKeySource` reports
  `none` when the session authenticates via claude.ai login. Options that
  matter: `model`, `fallbackModel`, `effort`, `permissionMode`,
  `canUseTool`, `allowedTools/disallowedTools`, `resume`, `forkSession`,
  `includePartialMessages`, `settingSources`, `mcpServers`, `cwd`,
  `additionalDirectories`, `env`.

**Forbidden path = spoofing Claude Code with the OAuth token.**
- The 2026 crackdown (OpenClaw first, then OpenCode and every third-party
  harness) targeted tools that took the subscription OAuth token and called
  the Messages API pretending to be Claude Code. Users were blocked
  server-side. Policy wording circulating: OAuth for Free/Pro/Max "is
  intended exclusively for Claude Code and Claude.ai".

**Exact legal wording** (code.claude.com/docs/en/legal-and-compliance, updated
2026-02-19; via web-research agent): *"Using OAuth tokens obtained through
Claude Free, Pro, or Max accounts in any other product, tool, or service —
including the Agent SDK — is not permitted and constitutes a violation of
the Consumer Terms of Service."* And: Anthropic *"does not permit
third-party developers to offer Claude.ai login into their own applications,
or to route requests through Free, Pro, or Max plan credentials on behalf of
their users."* Branding rule on the same page: the product must not appear
to be Claude Code or any Anthropic product.
Consequences: arxa never shows a "Sign in with Claude" button of its own;
login happens inside Claude Code (`claude auth login`) and arxa only
*detects* it (`claude auth status` JSON, the way T3 Code does, including
plan-tier detection to filter the model list). The engine is labelled
"Claude Code (your subscription)" and never re-skinned as arxa's own model.

**Model access on plans** (support.claude.com 15424964):
- Max / premium seats: Fable 5 + 5.1 included, capped at 50% of weekly
  limit, burn faster than other models. Pro: Fable only via usage credits.
- Fable 5.1 needs Claude Code >= 2.1.255. Opus/Sonnet/Haiku on all paid plans.
- `--model` accepts aliases `fable`, `opus`, `sonnet` or full ids.

**How T3 Code does it** (pingdotgg/t3code, `apps/server/src/provider/Layers/
ClaudeProvider.ts`): spawns the `claude` binary as a child process via the
Agent SDK, requires the user to run `claude auth login` first, never touches
OAuth tokens, shows "Authenticated as … · Claude Max Subscription", model
switch mid-thread. No proxy, no T3 billing.

## What dsh already ships — and why it is a trap

dsh 0.1.1-rc.2 -> `@deepseek-ai/dsh-llm-pi-ai` -> `@earendil-works/pi-ai`
0.84.4 (pinned by our `overrides`). pi-ai's `anthropic` provider has an
OAuth login labelled "Anthropic (Claude Pro/Max)", and dsh-llm-pi-ai
auto-registers a sign-in flow for every catalog provider with a login
(`registerPiAiFlows`, dsh-llm-pi-ai/lib/index.js:2252). So a "Sign in with
Claude" button is one config row away today.

It is exactly the forbidden mechanism:
- `pi-ai/dist/auth/oauth/anthropic.js:13-20`: base64-hidden CLIENT_ID
  (Claude Code's), scopes `user:sessions:claude_code …`.
- `pi-ai/dist/api/anthropic-messages.js:39` "Stealth mode: Mimic Claude
  Code's tool naming exactly"; `:703` sends `anthropic-beta:
  claude-code-20250219,oauth-2025-04-20`, `x-app: cli`; `:751` injects
  "You are Claude Code, Anthropic's official CLI for Claude."

Shipping that in a distributed product = every arxa user risks a ban, and
arxa is the party doing the spoofing. **Do not surface it.** (It also needs
guarding: the flow registers unconditionally, so the settings UI may
already list it. Verify and hide.)

## The architectural fact that shapes everything

Claude Code is an *agent*, not a *model*. The subscription only pays for
Claude Code's own loop + tools. dsh's model seam (`LlmAdapter`: providerInfo /
listModels / resolveModel / generate) cannot host it honestly — dsh would
run its loop and tools, Claude Code would run its own, and the transcript
would be two agents fighting.

dsh's real seam for this is the **agent factory**: `ctx.agents.setFactory`
(dsh-agent/lib/index.js:519, contract dsh-agent/lib/types/index.d.ts:165
`AgentFactory.createAgent/resume -> AgentHandle`). dsh-agent-loop registers
itself there (dsh-agent-loop/lib/index.js:1023). One factory at a time.

## Candidate shapes (grill decides)

- **B-full — Claude Code as a session engine.** New host plugin
  `arxa-claude-code`: wraps the stock factory; routes whose provider is
  `claude-code` get an `AgentHandle` backed by the Agent SDK `query()`
  (child `claude` process, cwd = workspace root); every other route falls
  through to dsh-agent-loop. The handle translates SDK messages
  (assistant / tool_use / tool_result / result / stream_event) into dsh
  session log entries so the stock conversation UI, sidebar, artifact
  viewer and persistence render it unchanged. Claude Code's permission
  prompts surface via `canUseTool` -> dsh user-approval. Model list =
  Claude Code's aliases + full ids, gated by what `claude auth status`
  reports. This is what T3 Code, Conductor, Zed's ACP adapter do.
  Cost: the translation layer + resume mapping (dsh session id <->
  Claude Code session id) + permission bridge. Biggest, correct.

- **B-lite — Claude Code as a delegated subagent tool.** Copy the
  `plugins/pi-delegate` shape (`delegate_pi` runs `pi -p`): a
  `delegate_claude` tool that runs one `claude -p` turn in the workspace and
  returns stdout. ~100 lines, sanctioned, ships in a day. Does NOT make
  Claude the main model; the main loop stays on DeepSeek/GLM/BYO-key.

- **C — BYO Anthropic API key only** (already works via pi-ai `anthropic`
  route with `apiKeyEnv`). Zero work. Not what was asked.

- **A — pi-ai OAuth spoof.** Rejected. Policy violation, ban risk.

## Things that cut against "ASAP"

- Claude Code sessions bypass dsh's sandbox (S1 isolation levels plan),
  permission presets, compaction, tool set and skills. Users get Claude
  Code's, not arxa's. Either accept the split or bridge each one.
- `ANTHROPIC_API_KEY` leaking into the child env silently switches billing
  to the API. Must scrub env and surface `apiKeySource` in the UI.
- Claude Code must be installed and logged in on the user's machine
  (bundled binary via SDK optional dep is possible, but login state lives
  in the user's keychain/`~/.claude`). arxa cannot log in for them.
- Plan limits are the user's problem, but the UI must show rate-limit
  events (`SDKRateLimitEvent`) and the Fable 50% cap or users will blame
  arxa.
- D22 (grill decisions) already fixed the default inference lane as BYO
  keys / local. This adds a third lane, "BYO subscription via Claude Code".

## Spike 2026-09-03 — Claude Code under arxa's own confinement (macOS)

Script: scratchpad `spike-seatbelt.sh`, `spike2.sh`, plus F/G one-liner.
Profile = the exact SBPL dsh-sandbox-local builds for `workspace-write`
(`lib/index.js:65-76`): allow default, deny file-write*, re-allow
workspace + /private/tmp + os.tmpdir(). Machine logged in via claude.ai
(`claude auth status` -> `authMethod: "claude.ai"`). Child env had
CLAUDECODE / CLAUDE_CODE_ENTRYPOINT unset (nested-session guard).

| Run | Setup | Result |
|-----|-------|--------|
| A | profile, default `~/.claude` | exit 0, "OK", model claude-fable-5-1. Keychain read survives Seatbelt (reads are allowed). |
| B/C | profile + `CLAUDE_CONFIG_DIR` inside workspace | "Not logged in": keychain entry is keyed per config dir (`Claude Code-credentials-<hash>`). Do NOT relocate the config dir. |
| C' | profile, Bash allowed, default cfg | `touch $WS/inside.txt` exit 0; `touch $HOME/…` exit 1. Confined, and Claude reported the denial honestly. |
| D | `--resume` of A under profile | "No conversation found": transcript under `~/.claude/projects` was never written (write denied). |
| E | unconfined control | transcript persisted. |
| F/G | profile + `(subpath ~/.claude/projects)` | persisted; `--resume` answered "PEACH" from the prior turn. |

Conclusion: Claude Code CAN be locked by arxa's environment. The child is
spawned through the arxa sandbox provider (same `runnerArgv` seam
`plugins/sandbox/lib/index.js` already extends) with ONE extra writable
root, `~/.claude/projects`, so its transcripts and resume keep working.
`~/.claude/settings.json` and the rest of `~/.claude` stay read-only, which
is stricter than Claude Code alone. Linux (bwrap/landlock) and Windows
(ACL) rungs need the same extra root; not yet measured.

**Linux rung (Docker Desktop, `node:22-bookworm`, `--privileged`, kernel
7.0.12-linuxkit), 2026-09-03** — script `spike-linux.sh`. bwrap argv is
dsh's exact `bwrapProfileArgs` (`lib/index.js:22-40`) + one extra
`--bind ~/.claude/projects`. Mechanics-only (no Linux credential yet):
- plain shell under bwrap: workspace write ok, HOME write denied, 5 visible
  pids (private PID namespace works).
- `claude -p` 2.1.259 starts under bwrap, reaches the auth check, returns
  a well-formed JSON result ("Not logged in"). Node runtime, `/proc`,
  `/dev` all fine under the profile.
- with the projects bind the session file IS written (persisted=1) even
  for the failed run; without it, nothing is persisted.
- Landlock: securityfs not mounted inside the container, so the landlock
  rung was not probed. dsh prefers bwrap on Linux anyway.
- Token-dependent runs (resume, Bash escape test) pending a
  `claude setup-token` value in scratchpad `linux-token` (never printed,
  only used by Claude Code inside the container).

**Windows ACL rung**: cannot be spiked from macOS/Docker Desktop (Windows
containers need a Windows host). UNMEASURED. Needs a Windows box/VM.

Second lock layer, free: Agent SDK options `cwd`, `additionalDirectories`,
`settingSources` (omit user/local so a user's own hooks/MCP don't leak into
an arxa session), `disallowedTools`, `--restricted` when a preset asks for
no code execution. And a third: arxa's own context via
`systemPrompt.append` / `--add-dir` for the org context chain (D1/D2).

## Verification once a shape is chosen

- `claude auth status` -> JSON shows subscription login; SDK
  `system/init` message has `apiKeySource: "none"` and `model` = chosen.
- One session each on `sonnet`, `opus`, `fable` (Max account) renders in
  the stock conversation UI, persists, resumes after restart.
- With `ANTHROPIC_API_KEY` exported in the parent shell, the child still
  reports `apiKeySource: "none"` (env scrub works).
- Settings > Models never lists "Anthropic (Claude Pro/Max)" from pi-ai.

## Decisions locked in the grill (2026-09-03)

| # | Decision |
|---|---|
| D1 | Real Claude Code binary only. No in-app Claude sign-in. pi-ai's Anthropic OAuth flow hidden from arxa's login list + CI guard that it never reappears. |
| D2 | Claude Code is a session engine, not a model: wrapped behind a dsh `AgentFactory` (`ctx.agents.setFactory`) that translates SDK messages into the dsh session log so stock UI/persistence render unchanged. |
| D3 | `@anthropic-ai/claude-agent-sdk` pinned exact. Prefer user's `claude` on PATH, else bundled binary. Zero UI/UX change: stock model picker, `session.models` / `session.selectModel`. |
| D4 | Cross-engine switch mid-session blocked with a reason via `routable`; free switching among Claude models; opt-in hot swap with handoff summary (phase 2). |
| D5 | Three lock layers: arxa sandbox around the child (extra writable root `~/.claude/projects`, spiked green on macOS Seatbelt + Linux bwrap); Claude Code knobs set by arxa (cwd, disallowedTools, `--restricted`, never bypassPermissions); `canUseTool` bridged to dsh approval. |
| D6 | Not-signed-in = T3-style state: copyable `claude auth login` command, periodic probe (`claude --version`, `claude auth status`), email + tier badge, "Check again". arxa never starts login. Fable labelled by tier (Pro: usage credits; Max: included, 50% cap). |
| D7 | Claude Code is intelligence only. `settingSources: []` (no `~/.claude` settings/hooks/plugins/MCP, no `CLAUDE.md`). No Claude Code preset prompt: arxa's own system prompt + org context chain, same as every other model. arxa perks (`gen_ui`, gates, delegate, approval) bridged in via the SDK in-process MCP server, phase 1. Hidden transcript under `~/.claude/projects` kept only for resume. |
| D8 | Keep Claude's built-in Read/Write/Edit/Bash/Grep/Glob inside arxa's sandbox + approval bridge. Subagent, skills and plugin *mechanisms* stay available, but they resolve arxa's catalogue, never Claude's `~/.claude` conventions or instructions. |
| D9 | Model list live from the SDK's `supportedModels()` at probe time, static fallback (fable/opus/sonnet/haiku) when the probe fails. Tier from `claude auth status`, version from `claude --version`. Fable labelled per tier (Pro: usage credits; Max: included, 50% cap; needs CC ≥ 2.1.255). Ineligible models stay visible but unroutable with a reason, never hidden. |
| D10 | Child env always stripped of `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and the Bedrock/Vertex/Foundry switches; if the SDK system message reports `apiKeySource` other than `none`, refuse the session with a reason. API-key billing keeps its existing path: dsh's stock Anthropic provider. Rate-limit events surface in the status line next to the tier badge; cost figure hidden; Fable cap trips → `fallbackModel` Opus with a visible note. No usage meter. |
