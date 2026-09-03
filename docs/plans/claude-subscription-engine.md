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

## Verification once a shape is chosen

- `claude auth status` -> JSON shows subscription login; SDK
  `system/init` message has `apiKeySource: "none"` and `model` = chosen.
- One session each on `sonnet`, `opus`, `fable` (Max account) renders in
  the stock conversation UI, persists, resumes after restart.
- With `ANTHROPIC_API_KEY` exported in the parent shell, the child still
  reports `apiKeySource: "none"` (env scrub works).
- Settings > Models never lists "Anthropic (Claude Pro/Max)" from pi-ai.
