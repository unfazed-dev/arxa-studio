# Claude Subscription Engine — Implementation Plan

> **Status 2026-09-12: shipped and verified.** The unchecked boxes below are stale tracking, not
> open work. `plugins/claude-code/` carries the full module set (models, probe, spawn, env, pending,
> mirror-tools, mirror-gate, bridge, handoff, mcp-bridge, approval, adapter, account, auth-flow,
> rate-limit, skill-packs, usage) with 21 selftests, all GREEN in the 110-suite `npm test` run of
> 2026-09-12 (worktree `4d1b924`); the SDK ships in the payload (`scripts/pack-list-check.mjs`:
> 10 ok). The remaining live gates are external — AXS-016 (Task 16) in
> [`open-work-inventory-2026-09-12.md`](open-work-inventory-2026-09-12.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude models appear in arxa studio's stock model picker as provider `claude-code`, billed to the user's Claude subscription, running the real Claude Code binary inside arxa's own sandbox, approval flow and system prompt — with zero UI/UX change.

**Architecture:** A new dsh **LLM adapter** (`ctx.llm.registerAdapter(['claude-code'], adapter)`) whose `stream()` runs one Claude Code turn through `@anthropic-ai/claude-agent-sdk`'s `query()`. Claude's own tool calls are surfaced to the stock agent loop as ordinary `tool-call` stream blocks and satisfied by **mirror tools** (dsh tools named `Read`, `Bash`, … whose `execute` just waits for the result Claude already produced), so the dsh session log is byte-for-byte the shape every other model produces. arxa's own tools (`gen_ui`, gates, `delegate_pi`) reach Claude through an in-process MCP server whose handlers park until the **stock loop** has executed the real dsh tool. The child process is spawned through `ctx.sandbox.confine()` with one extra writable root, `~/.claude/projects`.

**Tech Stack:** Node ≥ 22 ESM, `@deepseek-ai/dsh-*` 0.1.1-rc.2 (cordis plugins), `@anthropic-ai/claude-agent-sdk` 0.3.259 (exact), `@modelcontextprotocol/sdk` ^1.29 (peer of the SDK), `node:assert` selftests auto-discovered by `scripts/ci.mjs`.

**Spec:** `docs/plans/claude-subscription-engine.md` (research + decisions D1–D10). Read its "Decisions locked in the grill" table first.

## Amendments to the grill decisions (facts found while researching this plan)

| Decision | Change | Why |
|---|---|---|
| D2 | Claude Code is wired as an **LLM adapter**, not an `AgentFactory`. | `ctx.agents.setFactory` is a single exclusive slot that throws on a second registration and has no getter or chaining (`dsh-agent/lib/types/index.d.ts:264-276`). Replacing `dsh-agent-loop` wholesale would mean re-implementing turns, steps, inbox, cancel, compaction. The adapter seam keeps all of that stock. |
| D4 | The cross-engine switch **block is dropped**. Switching is free in both directions. | With the mirror-tool design the dsh log already holds Claude's full transcript in stock shape, so any other model can continue it. Switching *into* Claude mid-session gets a plain-text handoff of prior turns (Task 6). This is the "hot swap with handoff" moved from phase 2 into phase 1 because it fell out for free. |
| D5 | Confinement is applied through the SDK's `spawnClaudeCodeProcess` hook, not by wrapping the CLI ourselves. | The SDK exposes the spawn (`sdk.d.ts` Options `spawnClaudeCodeProcess?: (options: SpawnOptions) => SpawnedProcess`), so `ctx.sandbox.confine([command, ...args], policy)` wraps exactly what the SDK would have run. |
| D6 | The "not signed in" state lives in dsh's **stock login surface** (`ctx.authorization.registerFlow`) instead of a new status card. | Zero new UI. The flow's `run()` shows the command, polls until signed in, then commits email + tier as a credential record. Same place users log into every other provider. |
| D9 | Ineligible models are shown with the reason in their `description` and refused at `stream()` time. |
| D10 | Rate limits are shown in the UI in phase 1 through a **provider-neutral** channel: any provider appends `provider/status`, one host projection `providerStatus` folds it, one pill in the composer row renders it via the standard `useProjection` slot prop (Tasks 13–14). | The user asked for the UI and for a hook that works for all models. dsh already has the generic client hook (`useProjection` is a standard slot prop) and a host-side projection registry; what was missing is one shared event + projection. Live push, replay on reconnect, no polling. |

## Global Constraints

- `@anthropic-ai/claude-agent-sdk` pinned **exactly** `0.3.259` (`npm i -E`). Never `^`.
- `settingSources: []` on every `query()`. Never load `~/.claude` settings, hooks, plugins, MCP servers or `CLAUDE.md`.
- `systemPrompt: { type: 'custom', prompt: <dsh system prompt> }`. Never the `claude_code` preset.
- Child env is `scrubEnv(process.env)`; `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT` never reach the child. If the init message reports `apiKeySource !== 'none'`, the turn is refused.
- `permissionMode: 'default'` always. Never `bypassPermissions`, never `allowDangerouslySkipPermissions`.
- arxa never launches `claude auth login`. It only tells the user the command and re-checks.
- Provider id `claude-code`; display name `Claude Code (your subscription)`.
- `plugins/claude-code/` stays bare ESM registered by absolute path (like `plugins/pi-delegate/index.mjs`), no package.json. `plugins/provider-status/` is a named package because it ships a browser half.
- Tests are `plugins/claude-code/selftest.<topic>.mjs`, plain `node:assert/strict`, run with `node <file>`; `scripts/ci.mjs` discovers them automatically.
- Commit messages: one line, `type: description`, no author trailer (global operator rule).
- Do not print, log, or commit any OAuth token, email, or `~/.claude` content in tests.

---

## File structure

| Path | Responsibility |
|---|---|
| `plugins/claude-code/index.mjs` | HOST-plane plugin `arxa-claude-code`: builds probe + adapter, registers adapter on `ctx.llm`, registers the sign-in flow, hides pi-ai's Anthropic OAuth method. |
| `plugins/claude-code/agent.mjs` | AGENT-plane plugin `arxa-claude-code-tools`: registers the mirror tools into the session's `ctx.tools`. |
| `plugins/claude-code/lib/models.js` | Static fallback list, SDK→dsh model mapping, Fable tier/version labels, version compare. Pure. |
| `plugins/claude-code/lib/env.js` | `scrubEnv`, `BLOCKED_ENV`. Pure. |
| `plugins/claude-code/lib/probe.js` | Binary resolution (PATH → bundled), SDK init probe (version, apiKeySource, account, models), 60 s cache. |
| `plugins/claude-code/lib/spawn.js` | `makeSpawner({ confine, policy, cwd })` → the `spawnClaudeCodeProcess` function. |
| `plugins/claude-code/lib/pending.js` | `PendingResults`: promise map keyed by tool_use id, two directions (`fromClaude`, `fromLoop`). Module singleton shared by host and agent plane. |
| `plugins/claude-code/lib/bridge.js` | `TurnBridge`: pumps SDK messages, emits dsh `StreamChunk`s per step segment, records the Claude session id, resolves pending results. |
| `plugins/claude-code/lib/mcp-bridge.js` | `createArxaMcpServer(schemas, onCall)`: exposes dsh tool schemas verbatim over an in-process MCP server. |
| `plugins/claude-code/lib/approval.js` | `makeCanUseTool({ approval, agent })`. |
| `plugins/claude-code/lib/handoff.js` | `renderHandoff(messages)`: prior dsh turns → plain text for an engine switch. Pure. |
| `plugins/claude-code/lib/adapter.js` | `ClaudeCodeAdapter extends LlmAdapter`: `providerInfo`, `listModels`, `resolveModel`, `stream`. |
| `plugins/claude-code/lib/auth-flow.js` | `claudeAuthFlow(deps)`, `stripOauthMethod(flow)`, `hideAnthropicOauth(authorization)`. |
| `plugins/claude-code/lib/mirror-tools.js` | `MIRROR_TOOL_NAMES`, `mirrorToolDefinitions(defineTool, pending)`. |
| `plugins/claude-code/lib/rate-limit.js` | SDK rate-limit event → provider-neutral `provider/status`. Pure. |
| `plugins/provider-status/lib/index.js` | Generic host plugin: registers the `providerStatus` projection; `appendProviderStatus` producer helper. Works for every provider. |
| `plugins/provider-status/lib/status.js` | Zod schema, fold, `formatBadge`. Pure. |
| `plugins/provider-status/lib/client.js` | Browser half: the status pill in `conversation.input.right`, reads `useProjection('providerStatus')`. |
| `plugins/provider-status/package.json` | Named package so dsh discovers the client half (`dsh.client`). |
| `plugins/claude-code/selftest.*.mjs` | One selftest per lib file. |
| `plugins/sandbox/lib/index.js` | `extraWritableRoots(policy)` also honours `policy.extraWritableRoots`. |
| `profile/cordis.patch.yml` | Host rows for `arxa-claude-code` (by path) and `arxa-provider-status` (by package name). |
| `bin/arxa-studio.mjs` | `PROFILE_PLUGINS` + `BY_NAME_PLUGINS` entries for `arxa-provider-status` (Task 13). |
| `profile/agent-presets/arxa/agent.cordis.yml` | Agent row for `arxa-claude-code-tools`. |
| `scripts/claude-code-smoke.mjs` | HAND-RUN live smoke against the real, signed-in `claude`. Never joins `ci.mjs`. |
| `package.json` | New exact deps. |

### How one turn flows (read this before Task 6)

```
dsh loop step N ──stream(options)──▶ ClaudeCodeAdapter.stream
                                      │ agent = ctx.agents.currentInitiator()
                                      │ first call this turn? → bridge.start(query(...))
                                      │ else → resolve fromLoop pending from options.messages tail,
                                      │        bridge.nextSegment()
                                      ▼
   TurnBridge.pump()  ◀── SDK messages ── Claude Code child (sandboxed, sub billing)
     text deltas   → yield text-delta
     tool_use done → yield block-end(tool-call) … finish{tool-calls}   ⟵ segment ends
     tool_result   → pending.fromClaude.resolve(id)
     result        → yield usage, finish{stop}
                                      ▼
dsh loop dispatches tool-call blocks via ctx.tools.execute:
   Read/Bash/…   → mirror tool → awaits pending.fromClaude(id) → returns Claude's own result
   gen_ui/…      → REAL dsh tool runs (gates, cards) → result lands in next stream() messages
                   → pending.fromLoop.resolve(id) → MCP handler returns to Claude
```

---

### Task 1: Dependencies, plugin skeleton, static models, cordis rows

**Files:**
- Modify: `package.json`
- Create: `plugins/claude-code/lib/models.js`
- Create: `plugins/claude-code/selftest.models.mjs`
- Create: `plugins/claude-code/index.mjs`
- Create: `plugins/claude-code/agent.mjs`
- Modify: `profile/cordis.patch.yml` (append after the last `- insert:` block)
- Modify: `profile/agent-presets/arxa/agent.cordis.yml` (append after the `arxa-pi-delegate` row, ~line 299)

**Interfaces:**
- Produces: `STATIC_MODELS`, `modelsFromSdk(sdkModels)`, `describeModel(model, account)`, `versionAtLeast(a, b)`, `PROVIDER_ID = 'claude-code'`, `PROVIDER_NAME`.

- [ ] **Step 1: Install pinned deps**

```bash
cd /Volumes/business_ssd/arxa_digital_solutions/arxa-studio
npm view @modelcontextprotocol/sdk version          # note the exact 1.x version printed, call it MCPV
npm i -E @anthropic-ai/claude-agent-sdk@0.3.259 @modelcontextprotocol/sdk@MCPV
node -e "import('@anthropic-ai/claude-agent-sdk').then(m=>console.log(typeof m.query, typeof m.createSdkMcpServer))"
node -e "import('@modelcontextprotocol/sdk/server/mcp.js').then(m=>console.log(Object.keys(m)))"
ls node_modules/@anthropic-ai/ | grep claude-agent-sdk-      # the platform package that carries the bundled `claude` binary
```
Expected: `function function`, a key list containing `McpServer`, and one platform package such as `claude-agent-sdk-darwin-arm64` containing a `claude` file.

- [ ] **Step 2: Write the failing models test**

`plugins/claude-code/selftest.models.mjs`:
```js
import { strict as assert } from 'node:assert'
import { STATIC_MODELS, modelsFromSdk, describeModel, versionAtLeast, PROVIDER_ID } from './lib/models.js'

let n = 0; const ok = (name) => { n++; console.log(`  ok ${name}`) }

assert.equal(PROVIDER_ID, 'claude-code'); ok('provider id')
assert.deepEqual(STATIC_MODELS.map((m) => m.id), ['fable', 'opus', 'sonnet', 'haiku']); ok('static ids')
assert.ok(STATIC_MODELS.every((m) => m.provider === 'claude-code' && m.name.length > 0)); ok('static rows complete')

const sdk = [
  { value: 'fable', resolvedModel: 'claude-fable-5-1', displayName: 'Fable', description: 'Most capable', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet', description: 'Fast', supportsEffort: false },
]
const mapped = modelsFromSdk(sdk)
assert.deepEqual(mapped[0], { provider: 'claude-code', id: 'fable', name: 'Fable', description: 'Most capable', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }); ok('sdk fable mapped')
assert.deepEqual(mapped[1].efforts, []); ok('no-effort model maps to empty efforts')

assert.equal(versionAtLeast('2.1.259', '2.1.255'), true)
assert.equal(versionAtLeast('2.1.240', '2.1.255'), false)
assert.equal(versionAtLeast('2.2.0', '2.1.255'), true); ok('version compare')

const max = { loggedIn: true, subscriptionType: 'max', version: '2.1.259' }
const pro = { loggedIn: true, subscriptionType: 'pro', version: '2.1.259' }
const old = { loggedIn: true, subscriptionType: 'max', version: '2.1.240' }
const out = { loggedIn: false }
assert.equal(describeModel(mapped[0], max), 'Most capable — included on Max, up to 50% of your weekly limit')
assert.equal(describeModel(mapped[0], pro), 'Most capable — on Pro this uses usage credits')
assert.equal(describeModel(mapped[0], old), 'Most capable — needs Claude Code ≥ 2.1.255, you have 2.1.240')
assert.equal(describeModel(mapped[0], out), 'Most capable — sign in with `claude auth login` first')
assert.equal(describeModel(mapped[1], max), 'Fast'); ok('fable labels per tier / version / signed-out')
console.log(`selftest.models: ${n} ok`)
```

- [ ] **Step 3: Run it, expect failure**

Run: `node plugins/claude-code/selftest.models.mjs`
Expected: `ERR_MODULE_NOT_FOUND` for `./lib/models.js`.

- [ ] **Step 4: Implement models.js**

`plugins/claude-code/lib/models.js`:
```js
// Pure model-catalog helpers for the claude-code provider. No I/O.
export const PROVIDER_ID = 'claude-code'
export const PROVIDER_NAME = 'Claude Code (your subscription)'
export const FABLE_MIN_VERSION = '2.1.255'

const row = (id, name, description) => ({ provider: PROVIDER_ID, id, name, description, efforts: [] })
// ponytail: static fallback only when the SDK probe fails; the probe list wins.
export const STATIC_MODELS = [
  row('fable', 'Fable', 'Most capable Claude model'),
  row('opus', 'Opus', 'Strong general model'),
  row('sonnet', 'Sonnet', 'Fast, balanced'),
  row('haiku', 'Haiku', 'Fastest, cheapest'),
]

/** @param {{value:string,displayName:string,description:string,supportedEffortLevels?:string[]}[]} sdkModels */
export function modelsFromSdk (sdkModels) {
  return sdkModels.map((m) => ({
    provider: PROVIDER_ID,
    id: m.value,
    name: m.displayName,
    description: m.description,
    efforts: m.supportedEffortLevels ?? [],
  }))
}

export function versionAtLeast (actual, min) {
  const a = String(actual).split('.').map(Number), b = String(min).split('.').map(Number)
  for (let i = 0; i < 3; i++) { if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0) }
  return true
}

const isFable = (model) => /fable/i.test(model.id) || /fable/i.test(model.name)

/** Picker description: base description plus the Fable tier/version note (D9). */
export function describeModel (model, account) {
  if (!isFable(model)) return model.description
  const base = model.description
  if (!account?.loggedIn) return `${base} — sign in with \`claude auth login\` first`
  if (!versionAtLeast(account.version, FABLE_MIN_VERSION)) return `${base} — needs Claude Code ≥ ${FABLE_MIN_VERSION}, you have ${account.version}`
  if (account.subscriptionType === 'max') return `${base} — included on Max, up to 50% of your weekly limit`
  return `${base} — on Pro this uses usage credits`
}
```

- [ ] **Step 5: Run, expect pass**

Run: `node plugins/claude-code/selftest.models.mjs`
Expected: `selftest.models: 7 ok`

- [ ] **Step 6: Plugin skeletons (compile-only for now)**

`plugins/claude-code/index.mjs`:
```js
// HOST-plane plugin: the claude-code LLM adapter (D2 amended), the sign-in flow (D6),
// and the pi-ai Anthropic-OAuth hide (D1). Tools live in ./agent.mjs (agent plane).
export const name = 'arxa-claude-code'
export const inject = ['llm', 'agents', 'approval', 'sandbox', 'sandboxPolicy', 'authorization', 'credentials']

export function apply (ctx, config = {}) {
  ctx.logger?.info?.('arxa-claude-code: loaded (adapter wired in Task 9)')
}
```

`plugins/claude-code/agent.mjs`:
```js
// AGENT-plane plugin: registers the mirror tools (Task 5) into this session's tool registry.
export const name = 'arxa-claude-code-tools'
export const inject = ['tools']

export function apply (ctx) {
  ctx.logger?.info?.('arxa-claude-code-tools: loaded (mirror tools wired in Task 5)')
}
```

- [ ] **Step 7: Cordis rows**

Append to `profile/cordis.patch.yml`:
```yaml
# arxa-specific: Claude models on the user's Claude subscription (docs/plans/
# claude-subscription-engine-implementation.md). HOST-PLANE: it registers an
# LLM adapter on ctx.llm and an authorization flow — registry/service rows.
# The tool half is the agent-plane row arxa-claude-code-tools in
# profile/agent-presets/arxa/agent.cordis.yml.
- insert:
  - id: arxa-claude-code
    name: /Volumes/business_ssd/arxa_digital_solutions/arxa-studio/plugins/claude-code/index.mjs
```

Append to `profile/agent-presets/arxa/agent.cordis.yml` after the `arxa-pi-delegate` row:
```yaml
# arxa-specific: mirror tools for the claude-code provider (Read/Write/Edit/
# Bash/… as dsh tools whose execute returns the result Claude Code already
# produced in its sandboxed child). AGENT-PLANE because it registers tools.
# Plain composition row (no `insert:`), bare `name` per entryListProblem.
- id: arxa-claude-code-tools
  name: /Volumes/business_ssd/arxa_digital_solutions/arxa-studio/plugins/claude-code/agent.mjs
```

- [ ] **Step 8: Boot check + commit**

Run: `node scripts/preset-check.mjs` (preset health) and `npm test`.
Expected: both green; the new selftest shows in the ci output.

```bash
git add package.json package-lock.json plugins/claude-code profile/cordis.patch.yml profile/agent-presets/arxa/agent.cordis.yml
git commit -m "feat: scaffold the claude-code provider plugin with its model catalog helpers"
```

---

### Task 2: Environment scrubbing

**Files:**
- Create: `plugins/claude-code/lib/env.js`
- Create: `plugins/claude-code/selftest.env.mjs`

**Interfaces:**
- Produces: `BLOCKED_ENV: string[]`, `scrubEnv(env, { version }) → Record<string,string>`.

- [ ] **Step 1: Failing test**

```js
import { strict as assert } from 'node:assert'
import { BLOCKED_ENV, scrubEnv } from './lib/env.js'

const input = {
  PATH: '/usr/bin', HOME: '/Users/x', ANTHROPIC_API_KEY: 'sk-ant-1', ANTHROPIC_AUTH_TOKEN: 't',
  ANTHROPIC_BASE_URL: 'http://x', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1',
  CLAUDE_CODE_USE_FOUNDRY: '1', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', KEEP_ME: 'y', UNDEF: undefined,
}
const out = scrubEnv(input, { version: '0.1.0' })
for (const k of BLOCKED_ENV) assert.equal(k in out, false, `${k} must be stripped`)
assert.equal(out.PATH, '/usr/bin'); assert.equal(out.KEEP_ME, 'y')
assert.equal('UNDEF' in out, false)
assert.equal(out.CLAUDE_AGENT_SDK_CLIENT_APP, 'arxa-studio/0.1.0')
assert.notEqual(out, input)
console.log('selftest.env: 5 ok')
```

- [ ] **Step 2: Run, expect `ERR_MODULE_NOT_FOUND`**

- [ ] **Step 3: Implement**

```js
// The child must bill the subscription, never a key (D10), and must not think it is
// nested inside another Claude Code (spike: CLAUDECODE / CLAUDE_CODE_ENTRYPOINT guard).
export const BLOCKED_ENV = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT',
]

export function scrubEnv (env, { version }) {
  const out = {}
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || BLOCKED_ENV.includes(k)) continue
    out[k] = v
  }
  out.CLAUDE_AGENT_SDK_CLIENT_APP = `arxa-studio/${version}`
  return out
}
```

- [ ] **Step 4: Run, expect `selftest.env: 5 ok`**

- [ ] **Step 5: Commit** — `git add plugins/claude-code && git commit -m "feat: scrub api keys and nesting guards from the claude-code child environment"`

---

### Task 3: Binary resolution and the SDK init probe

**Files:**
- Create: `plugins/claude-code/lib/probe.js`
- Create: `plugins/claude-code/selftest.probe.mjs`

**Interfaces:**
- Consumes: `scrubEnv` (Task 2), `modelsFromSdk`, `STATIC_MODELS` (Task 1).
- Produces:
  - `resolveClaudeBinary({ env, platform, arch, exists, sdkRoot }) → string | undefined` — first `claude` on `PATH`, else `<sdkRoot>/../claude-agent-sdk-<platform>-<arch>/claude`, else `undefined`.
  - `class Probe { constructor({ query, binary, env, ttlMs = 60_000, now = Date.now }); async current(force = false) → Account; }` with `Account = { loggedIn: boolean, version?: string, apiKeySource?: string, email?: string, subscriptionType?: string, models: LlmModelInfo[], error?: string, checkedAt: number }`.

The probe is T3 Code's trick: start `query()` with a prompt stream that never yields, read the `system/init` message, call `accountInfo()` and `supportedModels()`, then `close()`. No API turn is spent.

- [ ] **Step 1: Failing test (fake `query`)**

```js
import { strict as assert } from 'node:assert'
import { resolveClaudeBinary, Probe } from './lib/probe.js'

let n = 0; const ok = (s) => { n++; console.log(`  ok ${s}`) }
const exists = (p) => ['/opt/bin/claude', '/sdk/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'].includes(p)

assert.equal(resolveClaudeBinary({ env: { PATH: '/nope:/opt/bin' }, platform: 'darwin', arch: 'arm64', exists, sdkRoot: '/sdk/node_modules/@anthropic-ai/claude-agent-sdk' }), '/opt/bin/claude'); ok('PATH wins')
assert.equal(resolveClaudeBinary({ env: { PATH: '/nope' }, platform: 'darwin', arch: 'arm64', exists, sdkRoot: '/sdk/node_modules/@anthropic-ai/claude-agent-sdk' }), '/sdk/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'); ok('bundled fallback')
assert.equal(resolveClaudeBinary({ env: { PATH: '/nope' }, platform: 'linux', arch: 'x64', exists, sdkRoot: '/sdk/node_modules/@anthropic-ai/claude-agent-sdk' }), undefined); ok('none → undefined')

function fakeQuery ({ init, account, models, fail }) {
  return () => {
    const it = (async function * () {
      if (fail) throw new Error(fail)
      yield init
      await new Promise(() => {}) // never ends, like the real init-only stream
    })()
    it.accountInfo = async () => account
    it.supportedModels = async () => models
    it.close = () => {}
    return it
  }
}
const init = { type: 'system', subtype: 'init', apiKeySource: 'none', claude_code_version: '2.1.259', model: 'sonnet', tools: ['Read'], session_id: 's1' }
const models = [{ value: 'fable', displayName: 'Fable', description: 'd', supportedEffortLevels: ['high'] }]
let clock = 1000
const p = new Probe({ query: fakeQuery({ init, account: { email: 'e@x', subscriptionType: 'max' }, models }), binary: '/opt/bin/claude', env: {}, now: () => clock })
const a = await p.current()
assert.equal(a.loggedIn, true); assert.equal(a.version, '2.1.259'); assert.equal(a.subscriptionType, 'max'); assert.equal(a.email, 'e@x')
assert.equal(a.models[0].id, 'fable'); ok('signed-in probe')
clock += 1000
assert.equal(await p.current(), a); ok('cached inside ttl')
clock += 70_000
assert.notEqual(await p.current(), a); ok('refreshed after ttl')

const keyed = new Probe({ query: fakeQuery({ init: { ...init, apiKeySource: 'ANTHROPIC_API_KEY' }, account: {}, models }), binary: '/opt/bin/claude', env: {}, now: () => 0 })
const k = await keyed.current()
assert.equal(k.loggedIn, true); assert.equal(k.apiKeySource, 'ANTHROPIC_API_KEY'); ok('reports key source')

const down = new Probe({ query: fakeQuery({ fail: 'Not logged in · Please run /login' }), binary: '/opt/bin/claude', env: {}, now: () => 0 })
const d = await down.current()
assert.equal(d.loggedIn, false); assert.match(d.error, /Not logged in/); assert.equal(d.models.length, 4); ok('signed-out → static models + error')

const none = new Probe({ query: fakeQuery({ init, account: {}, models }), binary: undefined, env: {}, now: () => 0 })
const nb = await none.current()
assert.equal(nb.loggedIn, false); assert.match(nb.error, /no claude binary/); ok('no binary')
console.log(`selftest.probe: ${n} ok`)
```

- [ ] **Step 2: Run, expect `ERR_MODULE_NOT_FOUND`**

- [ ] **Step 3: Implement**

```js
import { delimiter, join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { STATIC_MODELS, modelsFromSdk } from './models.js'

export function resolveClaudeBinary ({ env, platform, arch, exists = existsSync, sdkRoot }) {
  const exe = platform === 'win32' ? 'claude.exe' : 'claude'
  for (const dir of String(env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const p = join(dir, exe); if (exists(p)) return p
  }
  const bundled = join(dirname(sdkRoot), `claude-agent-sdk-${platform}-${arch}`, exe)
  return exists(bundled) ? bundled : undefined
}

const never = { [Symbol.asyncIterator] () { return { next: () => new Promise(() => {}) } } }

export class Probe {
  constructor ({ query, binary, env, ttlMs = 60_000, now = Date.now, timeoutMs = 15_000 }) {
    Object.assign(this, { query, binary, env, ttlMs, now, timeoutMs }); this.cache = undefined
  }

  async current (force = false) {
    if (!force && this.cache && this.now() - this.cache.checkedAt < this.ttlMs) return this.cache
    this.cache = await this.run(); return this.cache
  }

  async run () {
    const checkedAt = this.now()
    if (!this.binary) return { loggedIn: false, error: 'no claude binary on PATH and no bundled binary', models: STATIC_MODELS, checkedAt }
    const abort = new AbortController()
    const q = this.query({ prompt: never, options: {
      pathToClaudeCodeExecutable: this.binary, env: this.env, settingSources: [], persistSession: false,
      maxTurns: 0, abortController: abort, tools: [], systemPrompt: { type: 'custom', prompt: 'probe' },
    } })
    const timer = setTimeout(() => abort.abort(), this.timeoutMs)
    try {
      const { value: init } = await q[Symbol.asyncIterator]().next()
      if (!init || init.type !== 'system' || init.subtype !== 'init') throw new Error('probe: no init message')
      const [account, models] = await Promise.all([q.accountInfo(), q.supportedModels()])
      return {
        loggedIn: true, version: init.claude_code_version, apiKeySource: init.apiKeySource,
        email: account.email, subscriptionType: account.subscriptionType,
        models: models.length ? modelsFromSdk(models) : STATIC_MODELS, checkedAt,
      }
    } catch (err) {
      return { loggedIn: false, error: String(err?.message ?? err), models: STATIC_MODELS, checkedAt }
    } finally { clearTimeout(timer); q.close?.() }
  }
}
```

- [ ] **Step 4: Run, expect `selftest.probe: 8 ok`**

- [ ] **Step 5: Live sanity (this machine is signed in; prints no secrets)**

```bash
node -e "
import('@anthropic-ai/claude-agent-sdk').then(async ({ query }) => {
  const { Probe, resolveClaudeBinary } = await import('./plugins/claude-code/lib/probe.js')
  const { scrubEnv } = await import('./plugins/claude-code/lib/env.js')
  const sdkRoot = new URL('./node_modules/@anthropic-ai/claude-agent-sdk', 'file://' + process.cwd() + '/').pathname
  const binary = resolveClaudeBinary({ env: process.env, platform: process.platform, arch: process.arch, sdkRoot })
  const a = await new Probe({ query, binary, env: scrubEnv(process.env, { version: 'dev' }) }).current()
  console.log({ loggedIn: a.loggedIn, version: a.version, apiKeySource: a.apiKeySource, tier: a.subscriptionType, models: a.models.map(m => m.id), error: a.error })
})"
```
Expected: `loggedIn: true`, `apiKeySource: 'none'`, `tier: 'max'`, a model list that includes `fable`. If `loggedIn` is false with a "no init message" error, raise `timeoutMs` to 30 s and retry once; if it still fails, stop and report — the never-yielding probe is the load-bearing assumption of D6/D9.

- [ ] **Step 6: Commit** — `git commit -am "feat: resolve the claude binary and probe sign-in, version and models through one sdk init"`

---

### Task 4: Sandboxed spawn + extra writable root

**Files:**
- Create: `plugins/claude-code/lib/spawn.js`
- Create: `plugins/claude-code/selftest.spawn.mjs`
- Modify: `plugins/sandbox/lib/index.js:277-281` (`extraWritableRoots`)
- Modify: `plugins/sandbox/selftest.mjs` (add one case)

**Interfaces:**
- Produces: `makeSpawner({ confine, policy, spawn }) → (options: SpawnOptions) => SpawnedProcess`; `CLAUDE_EXTRA_ROOTS: string[]`.
- `SpawnOptions` (SDK): `{ command, args, cwd?, env, signal? }`. `SpawnedProcess` (SDK): `{ stdin, stdout, killed, exitCode, signalCode?, kill(signal), on('exit', fn) }` — a Node `ChildProcess` satisfies it.

- [ ] **Step 1: Failing test**

```js
import { strict as assert } from 'node:assert'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { makeSpawner, CLAUDE_EXTRA_ROOTS } from './lib/spawn.js'

let n = 0; const ok = (s) => { n++; console.log(`  ok ${s}`) }
assert.deepEqual(CLAUDE_EXTRA_ROOTS, [join(homedir(), '.claude', 'projects')]); ok('one extra root, the hidden transcript dir')

const calls = []
const confine = (argv, policy) => { calls.push({ argv, policy }); return { argv: ['sandbox-exec', '-p', 'P', ...argv] } }
const spawned = []
const spawn = (cmd, args, opts) => { spawned.push({ cmd, args, opts }); return { pid: 1 } }
const policy = { mode: 'workspace-write', workspaceRoot: '/ws', sessionId: 's' }
const spawner = makeSpawner({ confine, policy, spawn })
const proc = spawner({ command: '/opt/bin/claude', args: ['--output-format', 'stream-json'], cwd: '/ws', env: { PATH: '/x' } })
assert.equal(proc.pid, 1)
assert.deepEqual(calls[0].argv, ['/opt/bin/claude', '--output-format', 'stream-json'])
assert.deepEqual(calls[0].policy, { ...policy, extraWritableRoots: CLAUDE_EXTRA_ROOTS }); ok('confine gets the policy plus the extra root')
assert.equal(spawned[0].cmd, 'sandbox-exec')
assert.deepEqual(spawned[0].args, ['-p', 'P', '/opt/bin/claude', '--output-format', 'stream-json'])
assert.deepEqual(spawned[0].opts, { cwd: '/ws', env: { PATH: '/x' }, stdio: ['pipe', 'pipe', 'pipe'], signal: undefined }); ok('spawns the confined argv with piped stdio')
console.log(`selftest.spawn: ${n} ok`)
```

- [ ] **Step 2: Run, expect `ERR_MODULE_NOT_FOUND`**

- [ ] **Step 3: Implement spawn.js**

```js
import { spawn as nodeSpawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Spike 2026-09-03: under dsh's exact Seatbelt/bwrap profile Claude Code runs and
// answers with only the workspace + tmp writable; `--resume` additionally needs its
// transcript dir. Keychain credentials are keyed per config dir, so CLAUDE_CONFIG_DIR
// must NOT be relocated — we grant this one hidden dir instead.
export const CLAUDE_EXTRA_ROOTS = [join(homedir(), '.claude', 'projects')]

/** Build the SDK `spawnClaudeCodeProcess` hook: arxa's sandbox wraps the exact argv the SDK asked for. */
export function makeSpawner ({ confine, policy, spawn = nodeSpawn }) {
  return ({ command, args, cwd, env, signal }) => {
    const confined = confine([command, ...args], { ...policy, extraWritableRoots: CLAUDE_EXTRA_ROOTS })
    const [cmd, ...rest] = confined.argv
    return spawn(cmd, rest, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], signal })
  }
}
```

- [ ] **Step 4: Run, expect `selftest.spawn: 3 ok`**

- [ ] **Step 5: Teach arxa-sandbox the per-call extra roots**

In `plugins/sandbox/lib/index.js` replace the `extraWritableRoots` body:
```js
  extraWritableRoots (policy) {
    if (policy.mode !== 'workspace-write') return []
    const already = new Set(writableRoots(policy))
    // Per-call grants a caller attaches to the policy (claude-code: ~/.claude/projects).
    const requested = Array.isArray(policy.extraWritableRoots) ? policy.extraWritableRoots : []
    return [...this.toolchainRoots(), ...requested].filter((root, i, all) => !already.has(root) && all.indexOf(root) === i)
  }
```

- [ ] **Step 6: Add the case to `plugins/sandbox/selftest.mjs`**

Follow the file's existing `ok(name)` helper and fake-world construction. Add at the end:
```js
{
  const provider = /* construct the provider exactly as the existing cases above do */ makeProvider()
  const roots = provider.extraWritableRoots({ mode: 'workspace-write', workspaceRoot: '/ws', extraWritableRoots: ['/home/u/.claude/projects', '/home/u/.claude/projects'] })
  assert.ok(roots.includes('/home/u/.claude/projects'))
  assert.equal(roots.filter((r) => r === '/home/u/.claude/projects').length, 1)
  assert.deepEqual(provider.extraWritableRoots({ mode: 'read-only', workspaceRoot: '/ws', extraWritableRoots: ['/home/u/.claude/projects'] }), [])
  ok('policy.extraWritableRoots honoured once, workspace-write only')
}
```
(If the existing file has no `makeProvider` helper, reuse whatever local constructor the earlier cases call; do not invent a new fake world.)

- [ ] **Step 7: Run both selftests and `npm test`; commit**

```bash
node plugins/sandbox/selftest.mjs && node plugins/claude-code/selftest.spawn.mjs && npm test
git add plugins/sandbox plugins/claude-code
git commit -m "feat: spawn claude code through arxa's sandbox with the transcript dir as the one extra writable root"
```

---

### Task 5: Pending results + mirror tools (agent plane)

**Files:**
- Create: `plugins/claude-code/lib/pending.js`
- Create: `plugins/claude-code/lib/mirror-tools.js`
- Create: `plugins/claude-code/selftest.pending.mjs`
- Create: `plugins/claude-code/selftest.mirror.mjs`
- Modify: `plugins/claude-code/agent.mjs`

**Interfaces:**
- Produces:
  - `class PendingResults { expect(id, signal?): Promise<ToolOutcome>; resolve(id, outcome): void; resolveIfWaiting(id, outcome): void; reject(id, err): void; has(id): boolean }` with `ToolOutcome = { text: string, isError: boolean }`. Two module-level singletons: `fromClaude` (Claude executed, loop is waiting) and `fromLoop` (loop executed, Claude is waiting).
  - `MIRROR_TOOL_NAMES: string[]`, `mirrorToolDefinitions(defineTool, pending) → ToolDefinition[]`.
- Consumed later by: Task 6 bridge (`fromClaude.resolve`), Task 7 MCP (`fromLoop.expect`), Task 9 adapter (`fromLoop.resolve`).

The tool run context passed to `execute(args, exec)` carries `exec.callId` (the `tool-call` block id the loop dispatched) and `exec.signal` — the same fields `plugins/pi-delegate/index.mjs` reads. The mirror uses `exec.callId` to find Claude's result.

- [ ] **Step 1: Failing pending test**

```js
import { strict as assert } from 'node:assert'
import { PendingResults, fromClaude, fromLoop } from './lib/pending.js'

const p = new PendingResults()
const wait = p.expect('t1')
assert.equal(p.has('t1'), true)
p.resolve('t1', { text: 'done', isError: false })
assert.deepEqual(await wait, { text: 'done', isError: false })
assert.equal(p.has('t1'), false)

p.resolve('early', { text: 'x', isError: false })          // result before anyone waited
assert.deepEqual(await p.expect('early'), { text: 'x', isError: false })

const rej = p.expect('t2'); p.reject('t2', new Error('boom'))
await assert.rejects(rej, /boom/)

const ac = new AbortController(); const ab = p.expect('t3', ac.signal); ac.abort()
await assert.rejects(ab, /aborted/)
assert.equal(p.has('t3'), false)

p.resolveIfWaiting('nobody', { text: 'x', isError: false })
assert.equal(p.early.size, 0, 'resolveIfWaiting never parks early results')

assert.ok(fromClaude instanceof PendingResults && fromLoop instanceof PendingResults && fromClaude !== fromLoop)
console.log('selftest.pending: 7 ok')
```

- [ ] **Step 2: Run, expect `ERR_MODULE_NOT_FOUND`**

- [ ] **Step 3: Implement pending.js**

```js
// Promise mailbox keyed by Claude tool_use id. One direction per instance.
export class PendingResults {
  constructor () { this.waiters = new Map(); this.early = new Map() }
  has (id) { return this.waiters.has(id) }
  expect (id, signal) {
    if (this.early.has(id)) { const v = this.early.get(id); this.early.delete(id); return Promise.resolve(v) }
    return new Promise((resolve, reject) => {
      const done = () => { this.waiters.delete(id); signal?.removeEventListener('abort', onAbort) }
      const onAbort = () => { done(); reject(new Error(`claude-code: wait for tool ${id} aborted`)) }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.waiters.set(id, { resolve: (v) => { done(); resolve(v) }, reject: (e) => { done(); reject(e) } })
    })
  }
  resolve (id, outcome) { const w = this.waiters.get(id); w ? w.resolve(outcome) : this.early.set(id, outcome) }
  /** Resolve only if someone is waiting; ids nobody asked for (mirror results echoed by the loop) are dropped. */
  resolveIfWaiting (id, outcome) { const w = this.waiters.get(id); if (w) w.resolve(outcome) }
  reject (id, err) { this.waiters.get(id)?.reject(err) }
}
export const fromClaude = new PendingResults() // Claude ran it; the dsh loop's mirror tool waits
export const fromLoop = new PendingResults()   // the dsh loop ran it; Claude's MCP call waits
```

- [ ] **Step 4: Run, expect `selftest.pending: 7 ok`**

- [ ] **Step 5: Failing mirror test**

```js
import { strict as assert } from 'node:assert'
import { MIRROR_TOOL_NAMES, mirrorToolDefinitions } from './lib/mirror-tools.js'
import { PendingResults } from './lib/pending.js'

const defineTool = (d) => d // identity: we only assert the shape defineTool receives
const pending = new PendingResults()
const defs = mirrorToolDefinitions(defineTool, pending)
assert.deepEqual(defs.map((d) => d.name), MIRROR_TOOL_NAMES)
for (const n of ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task', 'Skill', 'WebFetch', 'WebSearch', 'TodoWrite']) assert.ok(MIRROR_TOOL_NAMES.includes(n), n)
const read = defs.find((d) => d.name === 'Read')
assert.equal(read.parameters.file_path.type, 'string')
assert.deepEqual(read.output.render({}, { text: 'hello' }), [{ type: 'text', text: 'hello' }])

const r = read.execute({ file_path: 'a' }, { callId: 'tu_1', signal: new AbortController().signal })
pending.resolve('tu_1', { text: 'file body', isError: false })
assert.deepEqual(await r, { text: 'file body' })

const e = read.execute({}, { callId: 'tu_2', signal: new AbortController().signal })
pending.resolve('tu_2', { text: 'ENOENT', isError: true })
await assert.rejects(e, /ENOENT/)
console.log('selftest.mirror: 5 ok')
```

- [ ] **Step 6: Run, expect `ERR_MODULE_NOT_FOUND`**

- [ ] **Step 7: Implement mirror-tools.js**

```js
// Claude Code's built-in tools, re-declared as dsh tools so the stock loop can dispatch
// the tool-call blocks the bridge emits. `execute` never runs anything: the child already
// did, inside arxa's sandbox; we just hand the loop the result Claude saw.
// Parameter schemas are deliberately loose (the model never sees these — Claude Code's own
// schema drove the call); they exist so the loop's argument validation accepts any payload.
export const MIRROR_TOOL_NAMES = [
  'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'BashOutput', 'KillShell',
  'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'Skill', 'TodoWrite',
  'AskUserQuestion', 'ToolSearch', 'ExitPlanMode', 'EnterPlanMode',
]

const LOOSE = { type: 'object', additionalProperties: true, properties: {} }
const KNOWN_PARAMS = { // a few named fields so the generic card shows something useful
  Read: { file_path: { type: 'string', description: 'Path Claude read.' } },
  Write: { file_path: { type: 'string', description: 'Path Claude wrote.' } },
  Edit: { file_path: { type: 'string', description: 'Path Claude edited.' } },
  Bash: { command: { type: 'string', description: 'Command Claude ran.' } },
  Glob: { pattern: { type: 'string' } }, Grep: { pattern: { type: 'string' } },
}

export function mirrorToolDefinitions (defineTool, pending) {
  return MIRROR_TOOL_NAMES.map((name) => defineTool({
    name,
    description: `${name} — executed by Claude Code inside arxa's sandbox; this row shows its result.`,
    parameters: KNOWN_PARAMS[name] ?? {},
    output: {
      schema: { ...LOOSE, properties: { text: { type: 'string', required: true, description: 'Tool output as Claude saw it.' } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute (_args, exec) {
      const out = await pending.expect(exec.callId, exec.signal)
      if (out.isError) throw new Error(out.text)
      return { text: out.text }
    },
  }))
}
```
If `defineTool` rejects `parameters: {}` or `additionalProperties`, check `node_modules/@deepseek-ai/dsh-tools/lib/types/schema.d.ts` (`ParameterSchemaSpec`) and adjust to the smallest accepted spec — the pi-delegate comment notes `required: false` is rejected; only `required: true` or absent.

- [ ] **Step 8: Run, expect `selftest.mirror: 5 ok`**

- [ ] **Step 9: Register in agent.mjs**

```js
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mirrorToolDefinitions } from './lib/mirror-tools.js'
import { fromClaude } from './lib/pending.js'

// Same resolution dance as plugins/pi-delegate/index.mjs:26-31.
const defineTool = await (async () => {
  try { return (await import('@deepseek-ai/dsh-tools')).defineTool } catch { /* not installed here */ }
  const op = join(homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')
  if (existsSync(op)) return (await import(pathToFileURL(op).href)).defineTool
  throw new Error('arxa-claude-code-tools: cannot resolve @deepseek-ai/dsh-tools')
})()

export const name = 'arxa-claude-code-tools'
export const inject = ['tools']

export function apply (ctx) {
  for (const def of mirrorToolDefinitions(defineTool, fromClaude)) ctx.tools.register(def)
}
```

- [ ] **Step 10: Real defineTool smoke**

Run: `node -e "import('./plugins/claude-code/agent.mjs').then(m => { const regs=[]; m.apply({ tools: { register: (d) => regs.push(d.name) } }); console.log(regs.length, regs[0]) })"`
Expected: `21 Read`. If `defineTool` throws on the loose schema, fix per Step 7 note.

- [ ] **Step 11: Commit** — `git add plugins/claude-code && git commit -m "feat: add mirror tools so claude code's own tool calls render as stock dsh tool rows"`

---

### Task 6: The turn bridge (SDK messages → dsh stream chunks)

**Files:**
- Create: `plugins/claude-code/lib/bridge.js`
- Create: `plugins/claude-code/lib/handoff.js`
- Create: `plugins/claude-code/selftest.bridge.mjs`
- Create: `plugins/claude-code/selftest.handoff.mjs`

**Interfaces:**
- Consumes: `fromClaude` (Task 5).
- Produces:
  - `class TurnBridge { constructor({ messages: AsyncIterable<SDKMessage>, onSession(id, model), onRateLimit(info), onToolUse(id, name) = noop, pending = fromClaude }); segment(): AsyncGenerator<StreamChunk>; finished: boolean; claudeSessionId }`, plus `MCP_PREFIX = 'mcp__arxa__'` and `stripMcpPrefix(name)` (defined here so Task 7 can import them without a cycle).
    `segment()` yields dsh `StreamChunk`s and ends after `finish`. It ends with `finish {kind:'tool-calls'}` when a top-level assistant message that contains `tool_use` blocks completes; the caller then calls `segment()` again on the next dsh step. It ends with `finish {kind:'stop'}` after the SDK `result`.
  - `renderHandoff(messages: Message[]) → string`.

dsh `StreamChunk` (from `dsh-llm/lib/types/types.d.ts:287-317`):
`{type:'block-start',index,blockType}` · `{type:'text-delta',index,text}` · `{type:'reasoning-delta',index,text}` · `{type:'tool-call-delta',index,id,name?,argumentsDelta}` · `{type:'block-end',index,block}` · `{type:'usage',usage:{inputTokens,outputTokens,cacheReadTokens?,cacheWriteTokens?}}` · `{type:'finish',reason:{kind}}`.
Block types: `'text' | 'reasoning' | 'tool-call'`. `ToolCallBlock = { type:'tool-call', id, name, arguments: string }` (raw JSON string).

SDK message handling (top-level only — skip anything with `parent_tool_use_id !== null`):
- `system/init` → `onSession(session_id, model)`; if `apiKeySource !== 'none'` throw `Error('claude-code: an API key is configured (' + apiKeySource + '); arxa uses your Claude subscription only. Unset it and retry.')`.
- `stream_event` (`includePartialMessages: true`): `event.type === 'content_block_start'` → `block-start` (`text`→text, `thinking`→reasoning, `tool_use`→tool-call, plus the tool-call-delta with `name`); `content_block_delta` → `text_delta`→text-delta, `thinking_delta`→reasoning-delta, `input_json_delta`→tool-call-delta; `content_block_stop` → `block-end` with the assembled block.
- `assistant` (complete message) → if any `tool_use` block: yield `finish {kind:'tool-calls'}` and end the segment. Otherwise nothing (text already streamed).
- `user` with `tool_result` blocks → `pending.resolve(tool_use_id, { text, isError })` where text = string content or the joined `text` parts.
- `rate_limit_event` → `onRateLimit(rate_limit_info)`.
- `result` → `usage` chunk from `usage.input_tokens/output_tokens/cache_read_input_tokens/cache_creation_input_tokens`, then `finish {kind:'stop'}` — or `throw new Error(errors.join('; ') || result)` when `is_error`.
- Everything else → ignore.

Block `index` restarts at 0 for each segment (each dsh step is its own assistant message).

- [ ] **Step 1: Failing bridge test**

```js
import { strict as assert } from 'node:assert'
import { TurnBridge } from './lib/bridge.js'
import { PendingResults } from './lib/pending.js'

let n = 0; const ok = (s) => { n++; console.log(`  ok ${s}`) }
async function * from (arr) { for (const m of arr) yield m }
const collect = async (gen) => { const out = []; for await (const c of gen) out.push(c); return out }
const init = { type: 'system', subtype: 'init', apiKeySource: 'none', session_id: 'cs-1', model: 'sonnet', claude_code_version: '2.1.259', tools: [] }
const ev = (event, parent = null) => ({ type: 'stream_event', event, parent_tool_use_id: parent, session_id: 'cs-1', uuid: 'u' })

// --- plain text turn
{
  const sessions = []
  const b = new TurnBridge({ pending: new PendingResults(), onSession: (id, m) => sessions.push([id, m]), onRateLimit: () => {}, messages: from([
    init,
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } }),
    ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } }),
    ev({ type: 'content_block_stop', index: 0 }),
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Hello' }] } },
    { type: 'result', subtype: 'success', is_error: false, result: 'Hello', usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 1 } },
  ]) })
  const chunks = await collect(b.segment())
  assert.deepEqual(sessions, [['cs-1', 'sonnet']])
  assert.deepEqual(chunks, [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'Hel' }, { type: 'text-delta', index: 0, text: 'lo' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello' } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 1 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]); ok('text turn → chunks')
  assert.equal(b.claudeSessionId, 'cs-1')
}

// --- tool round: segment 1 ends on tool-calls, result resolves pending, segment 2 finishes
{
  const pending = new PendingResults()
  const b = new TurnBridge({ pending, onSession: () => {}, onRateLimit: () => {}, messages: from([
    init,
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: 'Read', input: {} } }),
    ev({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file_path":' } }),
    ev({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"a.txt"}' } }),
    ev({ type: 'content_block_stop', index: 0 }),
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'a.txt' } }] } },
    { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'body of a', is_error: false }] } },
    ev({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }),
    ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Read it.' } }),
    ev({ type: 'content_block_stop', index: 1 }),
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Read it.' }] } },
    { type: 'result', subtype: 'success', is_error: false, result: 'Read it.', usage: { input_tokens: 1, output_tokens: 1 } },
  ]) })
  const seg1 = await collect(b.segment())
  assert.deepEqual(seg1, [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: 'tu_1', name: 'Read', argumentsDelta: '' },
    { type: 'tool-call-delta', index: 0, id: 'tu_1', argumentsDelta: '{"file_path":' },
    { type: 'tool-call-delta', index: 0, id: 'tu_1', argumentsDelta: '"a.txt"}' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'tu_1', name: 'Read', arguments: '{"file_path":"a.txt"}' } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]); ok('segment 1 ends on tool-calls')
  assert.deepEqual(await pending.expect('tu_1'), { text: 'body of a', isError: false }); ok('tool_result resolves the mirror')
  const seg2 = await collect(b.segment())
  assert.equal(seg2[0].index, 0, 'index restarts per segment')
  assert.deepEqual(seg2.at(-1), { type: 'finish', reason: { kind: 'stop' } }); ok('segment 2 finishes the turn')
}

// --- nested (subagent) frames are ignored; api key refused; error result throws
{
  const b = new TurnBridge({ pending: new PendingResults(), onSession: () => {}, onRateLimit: () => {}, messages: from([
    init, ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, 'tu_parent'),
    { type: 'result', subtype: 'success', is_error: false, result: '', usage: { input_tokens: 0, output_tokens: 0 } },
  ]) })
  const c = await collect(b.segment())
  assert.deepEqual(c.map((x) => x.type), ['usage', 'finish']); ok('subagent frames skipped')
}
{
  const b = new TurnBridge({ pending: new PendingResults(), onSession: () => {}, onRateLimit: () => {}, messages: from([{ ...init, apiKeySource: 'ANTHROPIC_API_KEY' }]) })
  await assert.rejects(collect(b.segment()), /API key is configured/); ok('api key refused')
}
{
  const limits = []
  const b = new TurnBridge({ pending: new PendingResults(), onSession: () => {}, onRateLimit: (i) => limits.push(i), messages: from([
    init, { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', utilization: 0.9 } },
    { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['boom'], usage: { input_tokens: 0, output_tokens: 0 } },
  ]) })
  await assert.rejects(collect(b.segment()), /boom/)
  assert.deepEqual(limits, [{ status: 'allowed_warning', utilization: 0.9 }]); ok('rate limit forwarded, error result throws')
}
// --- bridged arxa tool: dispatched under its dsh name, id reported to onToolUse
{
  const seen = []
  const b = new TurnBridge({ pending: new PendingResults(), onSession: () => {}, onRateLimit: () => {}, onToolUse: (id, name) => seen.push([id, name]), messages: from([
    init,
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_9', name: 'mcp__arxa__gen_ui', input: {} } }),
    ev({ type: 'content_block_stop', index: 0 }),
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'tu_9', name: 'mcp__arxa__gen_ui', input: {} }] } },
  ]) })
  const c = await collect(b.segment())
  assert.equal(c.find((x) => x.type === 'block-end').block.name, 'gen_ui')
  assert.deepEqual(seen, [['tu_9', 'mcp__arxa__gen_ui']]); ok('mcp prefix stripped, onToolUse called')
}
// --- results arrive while nobody is reading a segment (the loop is dispatching tools)
{
  const pending = new PendingResults()
  const b = new TurnBridge({ pending, onSession: () => {}, onRateLimit: () => {}, messages: from([
    init, { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_bg', content: 'bg', is_error: false }] } },
  ]) })
  assert.deepEqual(await pending.expect('tu_bg'), { text: 'bg', isError: false }); ok('background pump resolves results without segment()')
  void b
}
console.log(`selftest.bridge: ${n} ok`)
```

- [ ] **Step 2: Run, expect `ERR_MODULE_NOT_FOUND`**

- [ ] **Step 3: Implement bridge.js**

The child keeps producing messages while the dsh loop is off dispatching tools, so the bridge
**pumps in the background** from construction: every SDK message is handled for side effects
immediately (tool results → `pending`, rate limits, session id) and queued for `segment()` to
turn into chunks. Reading the iterator only inside `segment()` would deadlock the mirror tools.

```js
import { fromClaude } from './pending.js'

export const MCP_PREFIX = 'mcp__arxa__'
export const stripMcpPrefix = (name) => name.startsWith(MCP_PREFIX) ? name.slice(MCP_PREFIX.length) : name

const toolResultText = (block) => typeof block.content === 'string'
  ? block.content
  : (block.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')

export class TurnBridge {
  constructor ({ messages, onSession, onRateLimit, onToolUse = () => {}, pending = fromClaude }) {
    Object.assign(this, { onSession, onRateLimit, onToolUse, pending })
    this.claudeSessionId = undefined
    this.finished = false          // true once the SDK `result` (or a fatal error) has been queued
    this.queue = []; this.waiter = undefined; this.failure = undefined
    this.pump(messages[Symbol.asyncIterator]())
  }

  async pump (iterator) {
    try {
      while (true) {
        const { value: m, done } = await iterator.next()
        if (done) { this.fail(new Error('claude-code: child ended without a result')); return }
        if (m.parent_tool_use_id) continue                       // Task/subagent internals stay inside Claude
        if (m.type === 'system' && m.subtype === 'init') {
          if (m.apiKeySource !== 'none') { this.fail(new Error(`claude-code: an API key is configured (${m.apiKeySource}); arxa uses your Claude subscription only. Unset it and retry.`)); return }
          this.claudeSessionId = m.session_id; this.onSession(m.session_id, m.model); continue
        }
        if (m.type === 'user') {
          const content = Array.isArray(m.message?.content) ? m.message.content : []
          for (const b of content) if (b.type === 'tool_result') this.pending.resolve(b.tool_use_id, { text: toolResultText(b), isError: b.is_error === true })
          continue
        }
        if (m.type === 'rate_limit_event') { this.onRateLimit(m.rate_limit_info); continue }
        if (m.type === 'stream_event' && m.event.type === 'content_block_start' && m.event.content_block.type === 'tool_use') {
          this.onToolUse(m.event.content_block.id, m.event.content_block.name)
        }
        this.push(m)
        if (m.type === 'result') return
      }
    } catch (err) { this.fail(err) }
  }

  push (m) { this.queue.push(m); this.waiter?.(); this.waiter = undefined }
  fail (err) { this.failure = err; this.finished = true; this.waiter?.(); this.waiter = undefined }
  async next () {
    while (this.queue.length === 0) {
      if (this.failure) throw this.failure
      await new Promise((r) => { this.waiter = r })
    }
    return this.queue.shift()
  }

  /** One dsh step's worth of chunks. Ends on tool-calls (tool round) or stop (turn done). */
  async * segment () {
    const open = new Map() // sdk index -> { index, kind, text, id, name, args }
    let nextIndex = 0
    while (true) {
      const m = await this.next()
      if (m.type === 'stream_event') {
        const e = m.event
        if (e.type === 'content_block_start') {
          const b = e.content_block, index = nextIndex++
          if (b.type === 'text') { open.set(e.index, { index, kind: 'text', text: '' }); yield { type: 'block-start', index, blockType: 'text' } }
          else if (b.type === 'thinking') { open.set(e.index, { index, kind: 'reasoning', text: '' }); yield { type: 'block-start', index, blockType: 'reasoning' } }
          else if (b.type === 'tool_use') {
            const name = stripMcpPrefix(b.name)   // bridged arxa tools dispatch under their dsh name
            open.set(e.index, { index, kind: 'tool-call', id: b.id, name, args: '' })
            yield { type: 'block-start', index, blockType: 'tool-call' }
            yield { type: 'tool-call-delta', index, id: b.id, name, argumentsDelta: '' }
          }
        } else if (e.type === 'content_block_delta') {
          const o = open.get(e.index); if (!o) continue
          const d = e.delta
          if (d.type === 'text_delta') { o.text += d.text; yield { type: 'text-delta', index: o.index, text: d.text } }
          else if (d.type === 'thinking_delta') { const t = d.thinking ?? d.text ?? ''; o.text += t; yield { type: 'reasoning-delta', index: o.index, text: t } }
          else if (d.type === 'input_json_delta') { o.args += d.partial_json; yield { type: 'tool-call-delta', index: o.index, id: o.id, argumentsDelta: d.partial_json } }
        } else if (e.type === 'content_block_stop') {
          const o = open.get(e.index); if (!o) continue
          open.delete(e.index)
          const block = o.kind === 'tool-call'
            ? { type: 'tool-call', id: o.id, name: o.name, arguments: o.args || '{}' }
            : { type: o.kind, text: o.text }
          yield { type: 'block-end', index: o.index, block }
        }
      } else if (m.type === 'assistant') {
        if ((m.message.content ?? []).some((b) => b.type === 'tool_use')) { yield { type: 'finish', reason: { kind: 'tool-calls' } }; return }
      } else if (m.type === 'result') {
        this.finished = true
        if (m.is_error) throw new Error((m.errors ?? []).join('; ') || m.result || `claude-code: ${m.subtype}`)
        const u = m.usage ?? {}
        yield { type: 'usage', usage: {
          inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0,
          ...(u.cache_read_input_tokens ? { cacheReadTokens: u.cache_read_input_tokens } : {}),
          ...(u.cache_creation_input_tokens ? { cacheWriteTokens: u.cache_creation_input_tokens } : {}),
        } }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
    }
  }
}
```

- [ ] **Step 4: Run, expect `selftest.bridge: 9 ok`**

- [ ] **Step 5: Handoff test + implementation**

`selftest.handoff.mjs`:
```js
import { strict as assert } from 'node:assert'
import { renderHandoff } from './lib/handoff.js'
const msgs = [
  { role: 'user', content: [{ type: 'text', text: 'Build me a thing' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'Sure.' }, { type: 'tool-call', id: 'c1', name: 'write', arguments: '{"path":"a"}' }] },
  { role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] }] },
  { role: 'user', content: [{ type: 'text', text: 'Now test it' }] },
]
const text = renderHandoff(msgs.slice(0, -1))
assert.match(text, /^Conversation so far in this arxa session \(another model handled it\):/)
assert.match(text, /User: Build me a thing/); assert.match(text, /Assistant: Sure\./)
assert.match(text, /\[tool write\({"path":"a"}\) → ok\]/)
assert.equal(renderHandoff([]), '')
const big = renderHandoff([{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(100_000) }] }])
assert.ok(big.length <= 40_200 && big.includes('…(earlier turns trimmed)'))
console.log('selftest.handoff: 5 ok')
```

`lib/handoff.js`:
```js
// Engine switch INTO Claude mid-session: Claude has no transcript yet, dsh has all of it.
const MAX = 40_000
export function renderHandoff (messages) {
  if (messages.length === 0) return ''
  const lines = []
  for (const m of messages) {
    for (const b of m.content) {
      if (b.type === 'text') lines.push(`${m.role === 'assistant' ? 'Assistant' : 'User'}: ${b.text}`)
      else if (b.type === 'tool-call') lines.push(`[tool ${b.name}(${b.arguments})`)
      else if (b.type === 'tool-result') {
        const out = b.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
        const i = lines.findLastIndex((l) => l.startsWith('[tool ') && !l.endsWith(']'))
        if (i >= 0) lines[i] += ` → ${out}]`; else lines.push(`[tool result → ${out}]`)
      }
    }
  }
  let body = lines.join('\n')
  if (body.length > MAX) body = '…(earlier turns trimmed)\n' + body.slice(-MAX)
  return `Conversation so far in this arxa session (another model handled it):\n${body}`
}
```

- [ ] **Step 6: Run both; commit**

```bash
node plugins/claude-code/selftest.bridge.mjs && node plugins/claude-code/selftest.handoff.mjs
git add plugins/claude-code && git commit -m "feat: translate claude code sdk messages into dsh stream chunks with per-step tool segments"
```

---

### Task 7: MCP bridge for arxa's tools

**Files:**
- Create: `plugins/claude-code/lib/mcp-bridge.js`
- Create: `plugins/claude-code/selftest.mcp.mjs`

**Interfaces:**
- Consumes: `fromLoop` (Task 5).
- Produces: `createArxaMcpServer({ schemas: ToolSchema[], exclude: string[], onCall(name, args) → Promise<{text,isError}>, timeoutMs }) → McpSdkServerConfigWithInstance` i.e. `{ type: 'sdk', name: 'arxa', timeout, instance: McpServer }`; `MCP_PREFIX = 'mcp__arxa__'`; `stripMcpPrefix(name)`.

dsh `ToolSchema = { name, description, parameters: <JSON Schema> }` from `ctx.tools.schemas()`. We pass the JSON Schema through verbatim by installing raw request handlers on the underlying low-level server (no zod conversion).

- [ ] **Step 1: Failing test**

```js
import { strict as assert } from 'node:assert'
import { createArxaMcpServer, stripMcpPrefix, MCP_PREFIX } from './lib/mcp-bridge.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

assert.equal(stripMcpPrefix('mcp__arxa__gen_ui'), 'gen_ui'); assert.equal(stripMcpPrefix('Read'), 'Read')
const schemas = [
  { name: 'gen_ui', description: 'Render a card', parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } },
  { name: 'Read', description: 'mirror', parameters: { type: 'object', properties: {} } },
]
const calls = []
const cfg = createArxaMcpServer({ schemas, exclude: ['Read'], onCall: async (name, args) => { calls.push([name, args]); return { text: 'rendered', isError: false } }, timeoutMs: 5000 })
assert.equal(cfg.type, 'sdk'); assert.equal(cfg.name, 'arxa'); assert.equal(cfg.timeout, 5000)
// Drive the handlers directly through the low-level server's request map.
const handlers = cfg.instance.server._requestHandlers
const list = await handlers.get('tools/list')({ method: 'tools/list', params: {} }, {})
assert.deepEqual(list.tools, [{ name: 'gen_ui', description: 'Render a card', inputSchema: schemas[0].parameters }])
const res = await handlers.get('tools/call')({ method: 'tools/call', params: { name: 'gen_ui', arguments: { title: 'hi' } } }, {})
assert.deepEqual(calls, [['gen_ui', { title: 'hi' }]])
assert.deepEqual(res, { content: [{ type: 'text', text: 'rendered' }], isError: false })
console.log('selftest.mcp: 6 ok')
```
If `_requestHandlers` is not the private map name in the installed MCP SDK, print `Object.keys(cfg.instance.server)` once and use the map that holds `'tools/list'`. Only the test touches it.

- [ ] **Step 2: Run, expect `ERR_MODULE_NOT_FOUND`**

- [ ] **Step 3: Implement**

```js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

export { MCP_PREFIX, stripMcpPrefix } from './bridge.js'

/**
 * arxa's model-facing tools, exposed to Claude Code in-process. The handler does NOT run the
 * tool: it asks the caller (the adapter) which parks until the stock dsh loop has executed
 * the real tool — gates, cards and approvals included — and hands back that result.
 */
export function createArxaMcpServer ({ schemas, exclude = [], onCall, timeoutMs = 30 * 60 * 1000 }) {
  const visible = schemas.filter((s) => !exclude.includes(s.name))
  const instance = new McpServer({ name: 'arxa', version: '1.0.0' })
  instance.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: visible.map((s) => ({ name: s.name, description: s.description, inputSchema: s.parameters })),
  }))
  instance.server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const out = await onCall(req.params.name, req.params.arguments ?? {})
    return { content: [{ type: 'text', text: out.text }], isError: out.isError }
  })
  return { type: 'sdk', name: 'arxa', timeout: timeoutMs, instance }
}
```

- [ ] **Step 4: Run, expect `selftest.mcp: 6 ok`**

- [ ] **Step 5: Commit** — `git add plugins/claude-code && git commit -m "feat: expose arxa's tool schemas to claude code over an in-process mcp bridge"`

---

### Task 8: Approval bridge

**Files:**
- Create: `plugins/claude-code/lib/approval.js`
- Create: `plugins/claude-code/selftest.approval.mjs`

**Interfaces:**
- Produces: `makeCanUseTool({ approval, agent, isArxaTool }) → CanUseTool` where `approval.request({ agent, toolName, callId, reason, signal }) → Promise<'allowed-once'|'rejected'|'cancelled'|'unavailable'>` (`dsh-user-approval`, `ctx.approval.request`, requires an open turn — true during `stream()`).
- SDK `CanUseTool = (toolName, input, { signal, toolUseID, title, ... }) => Promise<PermissionResult>`; `PermissionResult = { behavior:'allow', updatedInput } | { behavior:'deny', message, interrupt? }`.

- [ ] **Step 1: Failing test**

```js
import { strict as assert } from 'node:assert'
import { makeCanUseTool } from './lib/approval.js'
const asked = []
const approval = { request: async (r) => { asked.push(r); return r.toolName === 'Bash' ? 'allowed-once' : 'rejected' } }
const agent = { id: 'a1' }
const can = makeCanUseTool({ approval, agent, isArxaTool: (n) => n.startsWith('mcp__arxa__') })
const sig = new AbortController().signal
assert.deepEqual(await can('Bash', { command: 'ls' }, { signal: sig, toolUseID: 'tu1', title: 'Run ls' }), { behavior: 'allow', updatedInput: { command: 'ls' } })
assert.deepEqual(asked[0], { agent, toolName: 'Bash', callId: 'tu1', reason: 'Run ls', signal: sig })
const denied = await can('Write', { file_path: 'x' }, { signal: sig, toolUseID: 'tu2' })
assert.equal(denied.behavior, 'deny'); assert.match(denied.message, /rejected/)
assert.deepEqual(await can('mcp__arxa__gen_ui', { a: 1 }, { signal: sig, toolUseID: 'tu3' }), { behavior: 'allow', updatedInput: { a: 1 } })
assert.equal(asked.length, 2, 'arxa tools are gated by the dsh loop, not asked twice')
console.log('selftest.approval: 4 ok')
```

- [ ] **Step 2: Run, expect `ERR_MODULE_NOT_FOUND`**

- [ ] **Step 3: Implement**

```js
// Claude Code's permission prompt → dsh's approval flow (D5 layer 3). Bridged MCP tools
// skip this: the stock loop runs them through its own pipeline (gates, approval, cards).
export function makeCanUseTool ({ approval, agent, isArxaTool }) {
  return async (toolName, input, { signal, toolUseID, title }) => {
    if (isArxaTool(toolName)) return { behavior: 'allow', updatedInput: input }
    const outcome = await approval.request({ agent, toolName, callId: toolUseID, reason: title ?? `Claude Code wants to use ${toolName}`, signal })
    if (outcome === 'allowed-once') return { behavior: 'allow', updatedInput: input }
    return { behavior: 'deny', message: `arxa: ${toolName} ${outcome} by the user's approval policy` }
  }
}
```

- [ ] **Step 4: Run, expect `selftest.approval: 4 ok`; commit** — `git commit -am "feat: route claude code permission prompts through dsh's approval flow"`

---

### Task 9: The adapter — wiring it all into `stream()`

**Files:**
- Create: `plugins/claude-code/lib/adapter.js`
- Create: `plugins/claude-code/selftest.adapter.mjs`
- Modify: `plugins/claude-code/index.mjs`

**Interfaces:**
- Consumes everything above.
- Produces: `class ClaudeCodeAdapter extends LlmAdapter` with constructor deps `{ query, probe, ctx, binary, env, version }` and the dsh methods:
  - `providerInfo(provider) → { id: 'claude-code', name: PROVIDER_NAME }`
  - `async listModels(provider) → LlmModelInfo[]` = probe models with `description` from `describeModel`.
  - `async resolveModel(provider, model) → LlmResolvedModelInfo` = the row plus `reasoning: { efforts: efforts.map(id => ({ id, name: id })), defaultEffort: 'high' }` when efforts exist, `context: { contextWindow: 200_000 }`.
  - `async * stream(options: GenerateOptions)`.

dsh `GenerateOptions = { provider, model, reasoningEffort?, messages, system?, tools?, maxTokens?, signal?, sessionId?, purpose?: 'compaction'|'session-title' }`. `Message = { role, content: ContentBlock[] }` with blocks `text | tool-call | tool-result | image`.

`stream()` algorithm:
1. `agent = this.ctx.agents.currentInitiator()`. If `options.purpose` is set (compaction / title) or no agent → **utility path**: one `query({ prompt: flatten(messages), options: base({ tools: [], maxTurns: 1, persistSession: false }) })`, yield text deltas from a `TurnBridge` (no mirror, no MCP), return.
2. `account = await this.probe.current()`. If `!account.loggedIn` → `throw new Error('claude-code: not signed in. Run `claude auth login` in a terminal, then pick the model again.')`. If the model is Fable and `!versionAtLeast(account.version, FABLE_MIN_VERSION)` → throw the same text `describeModel` shows.
3. Turn state lives in `this.turns: Map<agentId, { bridge, mcpQueue }>`.
   - `last = options.messages.at(-1)`. If `last.role === 'user'` and every block is `tool-result` **and** `this.turns.has(agent.id)` → this is the loop's next step after tool dispatch: for each `tool-result` block `fromLoop.resolve(toolCallId, { text, isError })` (only matters for MCP-bridged calls; mirror ids have no waiter and are dropped by `has()`… see note), then `yield* turn.bridge.segment()`; if the bridge finished, `this.turns.delete(agent.id)`. Return.
   - Otherwise start a new turn: `this.turns.delete(agent.id)`; build the prompt:
     - `claudeSessionId = lastClaudeSession(agent.session.events)` — the newest `claude-code/session` event's `data.claudeSessionId`.
     - `userText = text blocks of last`. If `claudeSessionId === undefined` and `options.messages.length > 1` → `prompt = renderHandoff(options.messages.slice(0, -1)) + '\n\nUser: ' + userText`, else `prompt = userText`.
   - `policy = this.ctx.sandboxPolicy.resolve({ session: agent.session })`; `cwd = agent.session.header.cwd ?? process.cwd()`.
   - `mcp = createArxaMcpServer({ schemas: agent.ctx.tools.schemas(), exclude: MIRROR_TOOL_NAMES, onCall })` where `onCall(name, args)`: the bridge has already streamed the `tool_use` block for `mcp__arxa__<name>` — take the oldest unclaimed id for that name from `turn.mcpQueue` (filled by a `TurnBridge` hook `onToolUse(id, name)` added in this task: push `{id, name}` for names with the prefix). Then `return fromLoop.expect(id, options.signal)`.
   - `q = this.query({ prompt, options: base({ cwd, model: options.model, fallbackModel: /fable/.test(options.model) ? 'opus' : undefined, effort: options.reasoningEffort, resume: claudeSessionId, systemPrompt: { type: 'custom', prompt: options.system ?? '' }, mcpServers: { arxa: mcp }, strictMcpConfig: true, canUseTool: makeCanUseTool({ approval: this.ctx.approval, agent, isArxaTool: (n) => n.startsWith(MCP_PREFIX) }), includePartialMessages: true, abortController }) })` where `base(policy, extra)` = `{ pathToClaudeCodeExecutable: this.binary, env: this.env, settingSources: [], permissionMode: 'default', spawnClaudeCodeProcess: makeSpawner({ confine: (a, p) => this.ctx.sandbox.confine(a, p), policy }), ...extra }`.
   - `bridge = new TurnBridge({ messages: q, onSession: (id, model) => agent.session.append('claude-code/session', { claudeSessionId: id, model }), onRateLimit: (info) => agent.session.append('claude-code/rate-limit', info), onToolUse })`.
   - Wire `options.signal` → `abortController.abort()` and `q.interrupt()`.
   - The bridge already emits MCP tool calls under their dsh name (`stripMcpPrefix`) and reports every `tool_use` id through `onToolUse`, so the loop dispatches the real dsh tool and `mcpQueue` knows which id the MCP handler is waiting on.
   - `this.turns.set(agent.id, { bridge, mcpQueue })`; `yield* bridge.segment()`; if `bridge.finished` → `this.turns.delete(agent.id)`.
4. Errors thrown propagate; `LlmRuntime.stream()` turns them into a `finish {kind:'error'}` for the loop.

Note on mirror ids: the loop's `tool-result` for a mirror call also appears in step-N+1 messages; that is why the adapter uses `fromLoop.resolveIfWaiting` (Task 5) — an id nobody awaits is dropped instead of parking forever.

- [ ] **Step 1: Failing adapter test (fake ctx, fake query, fake probe)**

```js
import { strict as assert } from 'node:assert'
import { ClaudeCodeAdapter } from './lib/adapter.js'
import { fromClaude, fromLoop } from './lib/pending.js'

let n = 0; const ok = (s) => { n++; console.log(`  ok ${s}`) }
async function * from (arr) { for (const m of arr) yield m }
const collect = async (gen) => { const out = []; for await (const c of gen) out.push(c); return out }
const init = { type: 'system', subtype: 'init', apiKeySource: 'none', session_id: 'cs-9', model: 'sonnet', claude_code_version: '2.1.259', tools: [] }
const ev = (event) => ({ type: 'stream_event', event, parent_tool_use_id: null })
const done = (text) => [
  ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
  ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }),
  ev({ type: 'content_block_stop', index: 0 }),
  { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text }] } },
  { type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 1, output_tokens: 1 } },
]
const queries = []
const fakeQuery = (script) => (params) => { queries.push(params); const it = from(script); it.interrupt = async () => {}; it.close = () => {}; return it }
const events = []
const agent = {
  id: 'agent-1',
  session: { header: { cwd: '/ws' }, events, append: (type, data) => { events.push({ type, data }); return { seq: events.length - 1 } } },
  ctx: { tools: { schemas: () => [{ name: 'gen_ui', description: 'card', parameters: { type: 'object', properties: {} } }, { name: 'Read', description: 'm', parameters: {} }] } },
}
const confined = []
const ctx = {
  agents: { currentInitiator: () => agent },
  sandbox: { confine: (argv, policy) => { confined.push({ argv, policy }); return { argv } } },
  sandboxPolicy: { resolve: ({ session }) => ({ mode: 'workspace-write', workspaceRoot: session.header.cwd, sessionId: 's' }) },
  approval: { request: async () => 'allowed-once' },
}
const probe = { current: async () => ({ loggedIn: true, version: '2.1.259', subscriptionType: 'max', models: [{ provider: 'claude-code', id: 'fable', name: 'Fable', description: 'Best', efforts: ['high'] }, { provider: 'claude-code', id: 'sonnet', name: 'Sonnet', description: 'Fast', efforts: [] }] }) }
const mk = (script, p = probe) => new ClaudeCodeAdapter({ query: fakeQuery(script), probe: p, ctx, binary: '/opt/bin/claude', env: { PATH: '/x' }, version: '0.1.0' })

assert.deepEqual(mk([]).providerInfo('claude-code'), { id: 'claude-code', name: 'Claude Code (your subscription)' }); ok('providerInfo')
const models = await mk([]).listModels('claude-code')
assert.equal(models[0].description, 'Best — included on Max, up to 50% of your weekly limit'); ok('listModels carries tier label')
const resolved = await mk([]).resolveModel('claude-code', 'fable')
assert.deepEqual(resolved.reasoning, { efforts: [{ id: 'high', name: 'high' }], defaultEffort: 'high' }); ok('resolveModel efforts')

// first turn, fresh session: options assembled per D5/D7/D10
{
  const a = mk([init, ...done('Hi')])
  const chunks = await collect(a.stream({ provider: 'claude-code', model: 'fable', system: 'You are arxa.', messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }], tools: [] }))
  assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'stop' } })
  const o = queries[0].options
  assert.equal(queries[0].prompt, 'hello')
  assert.deepEqual(o.settingSources, []); assert.equal(o.permissionMode, 'default'); assert.equal(o.strictMcpConfig, true)
  assert.deepEqual(o.systemPrompt, { type: 'custom', prompt: 'You are arxa.' })
  assert.equal(o.model, 'fable'); assert.equal(o.fallbackModel, 'opus'); assert.equal(o.resume, undefined)
  assert.equal(o.pathToClaudeCodeExecutable, '/opt/bin/claude'); assert.equal(o.cwd, '/ws'); assert.equal(o.includePartialMessages, true)
  assert.equal(o.mcpServers.arxa.type, 'sdk'); assert.equal(typeof o.canUseTool, 'function'); assert.equal(typeof o.spawnClaudeCodeProcess, 'function')
  assert.deepEqual(events.find((e) => e.type === 'claude-code/session').data, { claudeSessionId: 'cs-9', model: 'sonnet' }); ok('fresh turn options + session event')
}
// second turn resumes and does NOT hand off
{
  const a = mk([init, ...done('Again')])
  await collect(a.stream({ provider: 'claude-code', model: 'sonnet', system: 's', messages: [
    { role: 'user', content: [{ type: 'text', text: 'hello' }] }, { role: 'assistant', content: [{ type: 'text', text: 'Hi' }] }, { role: 'user', content: [{ type: 'text', text: 'more' }] }], tools: [] }))
  assert.equal(queries.at(-1).options.resume, 'cs-9'); assert.equal(queries.at(-1).prompt, 'more'); assert.equal(queries.at(-1).options.fallbackModel, undefined); ok('resume, no handoff')
}
// engine switch into claude: no session event yet → handoff prefix
{
  events.length = 0
  const a = mk([init, ...done('Sw')])
  await collect(a.stream({ provider: 'claude-code', model: 'sonnet', system: 's', messages: [
    { role: 'user', content: [{ type: 'text', text: 'built by deepseek' }] }, { role: 'assistant', content: [{ type: 'text', text: 'done' }] }, { role: 'user', content: [{ type: 'text', text: 'continue' }] }], tools: [] }))
  assert.match(queries.at(-1).prompt, /^Conversation so far/); assert.match(queries.at(-1).prompt, /User: continue$/); ok('handoff on switch')
}
// tool round across two stream() calls + mcp bridged result
{
  events.length = 0
  const script = [init,
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_r', name: 'Read', input: {} } }),
    ev({ type: 'content_block_stop', index: 0 }),
    ev({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_g', name: 'mcp__arxa__gen_ui', input: {} } }),
    ev({ type: 'content_block_stop', index: 1 }),
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'tu_r', name: 'Read', input: {} }, { type: 'tool_use', id: 'tu_g', name: 'mcp__arxa__gen_ui', input: {} }] } },
    { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_r', content: 'file!', is_error: false }] } },
    ...done('All done')]
  const a = mk(script)
  const base = { provider: 'claude-code', model: 'sonnet', system: 's', tools: [] }
  const seg1 = await collect(a.stream({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }] }))
  const names = seg1.filter((c) => c.type === 'block-end').map((c) => c.block.name)
  assert.deepEqual(names, ['Read', 'gen_ui'], 'mcp prefix stripped so the real dsh tool runs'); assert.deepEqual(seg1.at(-1).reason, { kind: 'tool-calls' })
  assert.deepEqual(await fromClaude.expect('tu_r'), { text: 'file!', isError: false })
  // the MCP handler asks for gen_ui's result; the loop answers via the next stream() messages
  const handlers = queries.at(-1).options.mcpServers.arxa.instance.server._requestHandlers
  const mcpCall = handlers.get('tools/call')({ method: 'tools/call', params: { name: 'gen_ui', arguments: {} } }, {})
  const seg2 = await collect(a.stream({ ...base, messages: [
    { role: 'user', content: [{ type: 'text', text: 'go' }] },
    { role: 'assistant', content: [{ type: 'tool-call', id: 'tu_r', name: 'Read', arguments: '{}' }, { type: 'tool-call', id: 'tu_g', name: 'gen_ui', arguments: '{}' }] },
    { role: 'user', content: [{ type: 'tool-result', toolCallId: 'tu_r', content: [{ type: 'text', text: 'file!' }] }, { type: 'tool-result', toolCallId: 'tu_g', content: [{ type: 'text', text: 'card shown' }] }] }] }))
  assert.deepEqual(await mcpCall, { content: [{ type: 'text', text: 'card shown' }], isError: false })
  assert.deepEqual(seg2.at(-1), { type: 'finish', reason: { kind: 'stop' } }); ok('tool round + mcp result round-trip')
  assert.equal(confined[0].policy.extraWritableRoots.length, 1); ok('spawner built with the sandbox policy')
}
// signed out / old version refuse before spawning
{
  const before = queries.length
  const out = mk([], { current: async () => ({ loggedIn: false, error: 'x', models: [] }) })
  await assert.rejects(collect(out.stream({ provider: 'claude-code', model: 'sonnet', messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }] }] })), /claude auth login/)
  const old = mk([], { current: async () => ({ loggedIn: true, version: '2.1.240', subscriptionType: 'max', models: [] }) })
  await assert.rejects(collect(old.stream({ provider: 'claude-code', model: 'fable', messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }] }] })), /2\.1\.255/)
  assert.equal(queries.length, before); ok('refusals spawn nothing')
}
// utility purpose: no mcp, no tools, no resume
{
  const a = mk([init, ...done('Summary')])
  const chunks = await collect(a.stream({ provider: 'claude-code', model: 'haiku', purpose: 'compaction', messages: [{ role: 'user', content: [{ type: 'text', text: 'summarise' }] }] }))
  assert.equal(chunks.filter((c) => c.type === 'text-delta').map((c) => c.text).join(''), 'Summary')
  const o = queries.at(-1).options
  assert.deepEqual(o.tools, []); assert.equal(o.maxTurns, 1); assert.equal(o.mcpServers, undefined); assert.equal(o.persistSession, false); ok('compaction path is tool-less')
}
console.log(`selftest.adapter: ${n} ok`)
```

- [ ] **Step 2: Run, expect `ERR_MODULE_NOT_FOUND`**

- [ ] **Step 3: Implement adapter.js** (skeleton below; fill in exactly the algorithm above)

```js
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { PROVIDER_ID, PROVIDER_NAME, FABLE_MIN_VERSION, describeModel, versionAtLeast } from './models.js'
import { TurnBridge, MCP_PREFIX, stripMcpPrefix } from './bridge.js'
import { renderHandoff } from './handoff.js'
import { makeSpawner } from './spawn.js'
import { makeCanUseTool } from './approval.js'
import { createArxaMcpServer } from './mcp-bridge.js'
import { MIRROR_TOOL_NAMES } from './mirror-tools.js'
import { fromClaude, fromLoop } from './pending.js'

const textOf = (msg) => msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
const isToolResultsOnly = (msg) => msg.role === 'user' && msg.content.length > 0 && msg.content.every((b) => b.type === 'tool-result')
const lastClaudeSession = (events) => { for (let i = events.length - 1; i >= 0; i--) if (events[i].type === 'claude-code/session') return events[i].data.claudeSessionId }
const isFable = (model) => /fable/i.test(model)

export class ClaudeCodeAdapter extends LlmAdapter {
  constructor ({ query, probe, ctx, binary, env, version }) {
    super(); Object.assign(this, { query, probe, ctx, binary, env, version }); this.turns = new Map()
  }

  providerInfo () { return { id: PROVIDER_ID, name: PROVIDER_NAME } }

  async listModels () {
    const account = await this.probe.current()
    return account.models.map((m) => ({ provider: PROVIDER_ID, id: m.id, name: m.name, description: describeModel(m, account) }))
  }

  async resolveModel (provider, model) {
    const account = await this.probe.current()
    const row = account.models.find((m) => m.id === model) ?? { provider: PROVIDER_ID, id: model, name: model, description: '', efforts: [] }
    return {
      provider: PROVIDER_ID, id: row.id, name: row.name, description: describeModel(row, account),
      context: { contextWindow: 200_000 },
      ...(row.efforts.length ? { reasoning: { efforts: row.efforts.map((id) => ({ id, name: id })), defaultEffort: row.efforts.includes('high') ? 'high' : row.efforts[0] } } : {}),
    }
  }

  base (policy, extra) {
    return {
      pathToClaudeCodeExecutable: this.binary, env: this.env, settingSources: [], permissionMode: 'default',
      spawnClaudeCodeProcess: makeSpawner({ confine: (argv, p) => this.ctx.sandbox.confine(argv, p), policy }),
      ...extra,
    }
  }

  async * stream (options) {
    const agent = this.ctx.agents.currentInitiator()
    if (options.purpose !== undefined || agent === undefined) { yield * this.utility(options, agent); return }

    const account = await this.probe.current()
    if (!account.loggedIn) throw new Error('claude-code: not signed in. Run `claude auth login` in a terminal, then pick the model again.')
    if (isFable(options.model) && !versionAtLeast(account.version, FABLE_MIN_VERSION)) throw new Error(`claude-code: Fable needs Claude Code ≥ ${FABLE_MIN_VERSION}, you have ${account.version}`)

    const last = options.messages.at(-1)
    const live = this.turns.get(agent.id)
    if (live && isToolResultsOnly(last)) {
      for (const b of last.content) fromLoop.resolveIfWaiting(b.toolCallId, { text: b.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'), isError: b.isError === true })
      yield * live.bridge.segment()
      if (live.bridge.finished) this.turns.delete(agent.id)
      return
    }

    this.turns.delete(agent.id)
    const claudeSessionId = lastClaudeSession(agent.session.events)
    const userText = textOf(last)
    const prompt = claudeSessionId === undefined && options.messages.length > 1
      ? `${renderHandoff(options.messages.slice(0, -1))}\n\nUser: ${userText}` : userText

    const policy = this.ctx.sandboxPolicy.resolve({ session: agent.session })
    const mcpQueue = []
    const mcp = createArxaMcpServer({
      schemas: agent.ctx.tools.schemas(), exclude: MIRROR_TOOL_NAMES,
      onCall: (name) => {
        const i = mcpQueue.findIndex((q) => q.name === name); const id = i >= 0 ? mcpQueue.splice(i, 1)[0].id : undefined
        if (!id) return Promise.resolve({ text: `arxa: no pending call for ${name}`, isError: true })
        return fromLoop.expect(id, options.signal)
      },
    })
    const abortController = new AbortController()
    const q = this.query({ prompt, options: this.base(policy, {
      cwd: agent.session.header.cwd ?? process.cwd(), model: options.model,
      ...(isFable(options.model) ? { fallbackModel: 'opus' } : {}),
      ...(options.reasoningEffort ? { effort: options.reasoningEffort } : {}),
      ...(claudeSessionId ? { resume: claudeSessionId } : {}),
      systemPrompt: { type: 'custom', prompt: options.system ?? '' },
      mcpServers: { arxa: mcp }, strictMcpConfig: true, includePartialMessages: true, abortController,
      canUseTool: makeCanUseTool({ approval: this.ctx.approval, agent, isArxaTool: (n) => n.startsWith(MCP_PREFIX) }),
    }) })
    options.signal?.addEventListener('abort', () => { abortController.abort(); q.interrupt?.().catch(() => {}) }, { once: true })
    const bridge = new TurnBridge({
      messages: q, pending: fromClaude,
      onSession: (id, model) => agent.session.append('claude-code/session', { claudeSessionId: id, model }),
      onRateLimit: (info) => agent.session.append('claude-code/rate-limit', info),
      onToolUse: (id, name) => { if (name.startsWith(MCP_PREFIX)) mcpQueue.push({ id, name: stripMcpPrefix(name) }) },
    })
    this.turns.set(agent.id, { bridge, mcpQueue })
    yield * bridge.segment()
    if (bridge.finished) this.turns.delete(agent.id)
  }

  async * utility (options, agent) {
    const prompt = options.messages.map((m) => `${m.role}: ${textOf(m)}`).join('\n\n')
    const policy = agent ? this.ctx.sandboxPolicy.resolve({ session: agent.session }) : this.ctx.sandboxPolicy.resolve({})
    const q = this.query({ prompt, options: this.base(policy, { model: options.model, tools: [], maxTurns: 1, persistSession: false, includePartialMessages: true, systemPrompt: { type: 'custom', prompt: options.system ?? 'Answer concisely.' } }) })
    yield * new TurnBridge({ messages: q, onSession: () => {}, onRateLimit: () => {}, onToolUse: () => {} }).segment()
  }
}
```

- [ ] **Step 4: Run all selftests, expect `selftest.adapter: 10 ok` and the others still green**

- [ ] **Step 5: Wire index.mjs**

```js
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeCodeAdapter } from './lib/adapter.js'
import { Probe, resolveClaudeBinary } from './lib/probe.js'
import { scrubEnv } from './lib/env.js'
import { PROVIDER_ID } from './lib/models.js'
import { claudeAuthFlow, hideAnthropicOauth } from './lib/auth-flow.js'

const require = createRequire(import.meta.url)
const version = require(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json')).version
const sdkRoot = dirname(require.resolve('@anthropic-ai/claude-agent-sdk/package.json'))

export const name = 'arxa-claude-code'
export const inject = ['llm', 'agents', 'approval', 'sandbox', 'sandboxPolicy', 'authorization', 'credentials']

export function apply (ctx, config = {}) {
  const env = scrubEnv(process.env, { version })
  const binary = config.binary ?? resolveClaudeBinary({ env: process.env, platform: process.platform, arch: process.arch, sdkRoot })
  const probe = new Probe({ query, binary, env })
  const adapter = new ClaudeCodeAdapter({ query, probe, ctx, binary, env, version })
  ctx.llm.registerAdapter([PROVIDER_ID], adapter)
  ctx.authorization.registerFlow(claudeAuthFlow({ probe, credentials: ctx.credentials }))   // Task 10
  hideAnthropicOauth(ctx.authorization)                                                       // Task 11
}
```
(Until Tasks 10–11 land, comment the last two lines out so the host boots.)

- [ ] **Step 6: Boot the studio and look at the picker**

Run the studio the way `bin/arxa-studio.mjs` normally starts (see README), open a session, open the model picker.
Expected: a group **Claude Code (your subscription)** with Fable / Opus / Sonnet / Haiku; Fable's description shows the Max label on this machine. Pick Sonnet, send "Reply with the single word OK". Expected: `OK` renders like any other model's reply, and `~/.claude/projects` gains a new transcript. Check the host log for `DUPLICATE_ADAPTER` or `defineTool` errors; fix before committing.

- [ ] **Step 7: Commit** — `git add plugins/claude-code && git commit -m "feat: run claude code as a dsh llm adapter on the user's subscription"`

---

### Task 10: Sign-in flow in the stock login surface

**Files:**
- Create: `plugins/claude-code/lib/auth-flow.js`
- Create: `plugins/claude-code/selftest.auth-flow.mjs`
- Modify: `plugins/claude-code/index.mjs` (uncomment the flow line)

**Interfaces:**
- Produces: `claudeAuthFlow({ probe, credentials, sleep = ms => new Promise(r => setTimeout(r, ms)), pollMs = 3000, maxPolls = 200 }) → AuthorizationFlow`, `ACCOUNT_KEY = credentialKey('claude-code', 'account')`.
- dsh types: `AuthorizationFlow = { key: CredentialKey, label: string, methods: [{ id, label }, ...], run(session): Promise<void> }`; `AuthorizationSession = { method: string, signal: AbortSignal, notify({ message, url?, code? }): void, prompt({ kind:'select'|'text'|'secret', message, options? }): Promise<string> }`. `run()` resolving means a record for `key` was committed via `ctx.credentials.modifyRecord(key, async (current) => record)`; `GrantRecord = { kind: 'grant', payload: unknown }`. `credentialKey(scope, id)` is exported by `@deepseek-ai/dsh-credentials`.

- [ ] **Step 1: Failing test**

```js
import { strict as assert } from 'node:assert'
import { claudeAuthFlow, ACCOUNT_KEY } from './lib/auth-flow.js'

let n = 0; const ok = (s) => { n++; console.log(`  ok ${s}`) }
const notices = [], records = []
const credentials = { modifyRecord: async (key, mutate) => { records.push([key, await mutate(undefined)]) } }
let calls = 0
const probe = { current: async (force) => { calls++; return calls < 3 ? { loggedIn: false, error: 'Not logged in' } : { loggedIn: true, email: 'e@x', subscriptionType: 'max', version: '2.1.259' } } }
const flow = claudeAuthFlow({ probe, credentials, sleep: async () => {}, pollMs: 1 })
assert.equal(flow.key, ACCOUNT_KEY); assert.equal(flow.label, 'Claude Code (your subscription)')
assert.deepEqual(flow.methods, [{ id: 'cli', label: 'Sign in with the claude CLI' }]); ok('flow shape')
await flow.run({ method: 'cli', signal: new AbortController().signal, notify: (x) => notices.push(x), prompt: async () => '' })
assert.match(notices[0].message, /claude auth login/); assert.equal(notices[0].code, 'claude auth login')
assert.match(notices.at(-1).message, /Signed in as e@x \(max\)/)
assert.deepEqual(records[0], [ACCOUNT_KEY, { kind: 'grant', payload: { email: 'e@x', subscriptionType: 'max', version: '2.1.259' } }]); ok('polls until signed in, commits the record')

const ac = new AbortController(); ac.abort()
const never = claudeAuthFlow({ probe: { current: async () => ({ loggedIn: false }) }, credentials, sleep: async () => {}, pollMs: 1 })
await assert.rejects(never.run({ method: 'cli', signal: ac.signal, notify: () => {}, prompt: async () => '' }), /cancelled/); ok('abort → rejects')
console.log(`selftest.auth-flow: ${n} ok`)
```

- [ ] **Step 2: Run, expect `ERR_MODULE_NOT_FOUND`**

- [ ] **Step 3: Implement**

```js
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { PROVIDER_NAME } from './models.js'

export const ACCOUNT_KEY = credentialKey('claude-code', 'account')
const LOGIN_CMD = 'claude auth login'

/** D6: arxa never launches login. It shows the command and re-checks until the CLI is signed in. */
export function claudeAuthFlow ({ probe, credentials, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pollMs = 3000, maxPolls = 200 }) {
  return {
    key: ACCOUNT_KEY,
    label: PROVIDER_NAME,
    methods: [{ id: 'cli', label: 'Sign in with the claude CLI' }],
    async run (session) {
      session.notify({ message: `In a terminal run \`${LOGIN_CMD}\` and finish the browser sign-in. arxa checks every ${pollMs / 1000}s.`, code: LOGIN_CMD })
      for (let i = 0; i < maxPolls; i++) {
        if (session.signal.aborted) throw new Error('claude-code: sign-in cancelled')
        const a = await probe.current(true)
        if (a.loggedIn) {
          await credentials.modifyRecord(ACCOUNT_KEY, async () => ({ kind: 'grant', payload: { email: a.email, subscriptionType: a.subscriptionType, version: a.version } }))
          session.notify({ message: `Signed in as ${a.email} (${a.subscriptionType}). Claude Code ${a.version}.` })
          return
        }
        await sleep(pollMs)
      }
      throw new Error('claude-code: sign-in not detected; run the command and try again')
    },
  }
}
```

- [ ] **Step 4: Run, expect `selftest.auth-flow: 3 ok`**

- [ ] **Step 5: Uncomment the flow line in index.mjs, boot, open the login surface**

Expected: **Claude Code (your subscription)** listed with one method. Starting it shows the command; since this machine is already signed in, it completes on the first poll with the email + tier notice. Commit:
`git commit -am "feat: show the claude cli sign-in state in dsh's stock login surface"`

---

### Task 11: Hide pi-ai's Anthropic OAuth method + tripwire

**Files:**
- Modify: `plugins/claude-code/lib/auth-flow.js` (add `stripOauthMethod`, `hideAnthropicOauth`)
- Modify: `plugins/claude-code/selftest.auth-flow.mjs`
- Create: `plugins/claude-code/selftest.oauth-guard.mjs`
- Modify: `plugins/claude-code/index.mjs` (uncomment)

Facts: pi-ai registers one flow per provider with `methods: [{id:'oauth',…}, {id:'api-key',…}]` and picks the path by `session.method === 'oauth'` (`dsh-llm-pi-ai/lib/index.js:2251-2290`). Its key is `credentialKey('llm-pi-ai', 'anthropic')`. `AuthorizationService` stores flows in `this.flows: Map<key, flow>` (`dsh-authorization/lib/index.js:75-85`) and validates the chosen method against `flow.methods` (`UNKNOWN_METHOD`). Load order between arxa's row and pi-ai's row is not guaranteed, so we handle both: patch what is already registered, and wrap `registerFlow` for what comes later.

- [ ] **Step 1: Failing tests** (append to `selftest.auth-flow.mjs`)

```js
import { stripOauthMethod, hideAnthropicOauth, ANTHROPIC_PIAI_KEY } from './lib/auth-flow.js'
{
  const flow = { key: ANTHROPIC_PIAI_KEY, label: 'Anthropic', methods: [{ id: 'oauth', label: 'Claude.ai' }, { id: 'api-key', label: 'API key' }], run: async () => {} }
  const s = stripOauthMethod(flow)
  assert.deepEqual(s.methods, [{ id: 'api-key', label: 'API key' }]); assert.equal(s.run, flow.run)
  assert.equal(stripOauthMethod({ ...flow, key: 'llm-pi-ai/openai' }), undefined, 'other providers untouched → undefined means leave alone'); ok('stripOauthMethod')

  // already registered before us
  const flows = new Map([[ANTHROPIC_PIAI_KEY, flow]])
  const svc = { flows, registerFlow (f) { this.flows.set(f.key, f); return () => this.flows.delete(f.key) } }
  hideAnthropicOauth(svc)
  assert.deepEqual(flows.get(ANTHROPIC_PIAI_KEY).methods.map((m) => m.id), ['api-key']); ok('patches an existing flow')
  // registered after us
  flows.clear()
  svc.registerFlow({ ...flow })
  assert.deepEqual(flows.get(ANTHROPIC_PIAI_KEY).methods.map((m) => m.id), ['api-key']); ok('wraps later registrations')
  // oauth-only flow would become method-less → dropped entirely
  flows.clear()
  svc.registerFlow({ ...flow, methods: [{ id: 'oauth', label: 'x' }] })
  assert.equal(flows.has(ANTHROPIC_PIAI_KEY), false); ok('oauth-only flow dropped')
}
```

- [ ] **Step 2: Implement** (append to `auth-flow.js`)

```js
export const ANTHROPIC_PIAI_KEY = credentialKey('llm-pi-ai', 'anthropic')

/** D1: pi-ai's Anthropic OAuth is the Claude Code client-id spoof Anthropic forbids. Keep the API-key method. */
export function stripOauthMethod (flow) {
  if (flow.key !== ANTHROPIC_PIAI_KEY) return undefined
  return { ...flow, methods: flow.methods.filter((m) => m.id !== 'oauth') }
}

export function hideAnthropicOauth (authorization) {
  const fix = (flow) => {
    const s = stripOauthMethod(flow); if (s === undefined) return flow
    return s.methods.length === 0 ? null : s
  }
  const existing = authorization.flows?.get?.(ANTHROPIC_PIAI_KEY)
  if (existing) { const f = fix(existing); f ? authorization.flows.set(ANTHROPIC_PIAI_KEY, f) : authorization.flows.delete(ANTHROPIC_PIAI_KEY) }
  const original = authorization.registerFlow.bind(authorization)
  authorization.registerFlow = (flow) => { const f = fix(flow); return f === null ? () => {} : original(f) }
}
```

- [ ] **Step 3: Tripwire selftest** (`selftest.oauth-guard.mjs`, pattern from `scripts/jobs-fence-check.mjs`)

```js
// Tripwire: the hide in lib/auth-flow.js relies on three unpublished facts about the installed
// dsh. If a dsh upgrade changes any of them the spoofed Claude.ai login silently returns to
// arxa's login list. Fail RED naming the fact.
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const piai = readFileSync(require.resolve('@deepseek-ai/dsh-llm-pi-ai'), 'utf8')
const auth = readFileSync(require.resolve('@deepseek-ai/dsh-authorization'), 'utf8')
assert.match(piai, /methods\.push\(\{ id: "oauth"/, 'pi-ai no longer labels its OAuth method "oauth"')
assert.match(piai, /const RECORD_SCOPE = "llm-pi-ai"/, 'pi-ai credential scope changed; update ANTHROPIC_PIAI_KEY')
assert.match(auth, /this\.flows\.set\(flow\.key, flow\)/, 'AuthorizationService no longer keeps flows in this.flows')
console.log('selftest.oauth-guard: 3 ok')
```

- [ ] **Step 4: Run all three, uncomment in index.mjs, boot, open the login list**

Expected: the Anthropic entry offers only the API-key method. Commit:
`git add plugins/claude-code && git commit -m "feat: hide pi-ai's anthropic oauth spoof from arxa's login list with a dsh-upgrade tripwire"`

---

### Task 12: Live smoke (hand-run) and docs

**Files:**
- Create: `scripts/claude-code-smoke.mjs`
- Modify: `docs/plans/claude-subscription-engine.md` (status section)

Pattern: `scripts/cicd-smoke.mjs` — header says HAND-RUN ONLY, requires `--yes`, never joins `ci.mjs`.

- [ ] **Step 1: Write the smoke**

```js
#!/usr/bin/env node
// LIVE smoke for the claude-code adapter — real `claude`, real subscription, real sandbox.
// HAND-RUN ONLY (`node scripts/claude-code-smoke.mjs --yes`); never joins scripts/ci.mjs.
// Asserts: (1) apiKeySource none; (2) text reply; (3) a Read tool round mirrors into
// tool-call/tool-result shape; (4) a write outside the workspace is denied by the sandbox.
import { strict as assert } from 'node:assert'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeCodeAdapter } from '../plugins/claude-code/lib/adapter.js'
import { Probe, resolveClaudeBinary } from '../plugins/claude-code/lib/probe.js'
import { scrubEnv } from '../plugins/claude-code/lib/env.js'
import { fromClaude } from '../plugins/claude-code/lib/pending.js'
import { createRequire } from 'node:module'

if (!process.argv.includes('--yes')) { console.log('live smoke: pass --yes to run against your real Claude subscription'); process.exit(0) }
const require = createRequire(import.meta.url)
const sdkRoot = join(require.resolve('@anthropic-ai/claude-agent-sdk/package.json'), '..')
const ws = mkdtempSync(join(tmpdir(), 'arxa-cc-smoke-'))
writeFileSync(join(ws, 'note.txt'), 'PEACH')
const escape = join(homedir(), 'arxa-cc-smoke-escape.txt'); rmSync(escape, { force: true })

// Minimal real-ish ctx: arxa's sandbox provider for confine, a permissive approval, a fake agent.
const { default: ArxaSandboxProvider } = await import('../plugins/sandbox/lib/index.js')
const sandbox = new ArxaSandboxProvider({ /* ctx stub as plugins/sandbox/selftest.mjs constructs it */ })
const events = []
const agent = { id: 'smoke', session: { header: { cwd: ws }, events, append: (type, data) => { events.push({ type, data }); return { seq: events.length - 1 } } }, ctx: { tools: { schemas: () => [] } } }
const ctx = {
  agents: { currentInitiator: () => agent },
  sandbox,
  sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: ws, sessionId: 'smoke' }) },
  approval: { request: async () => 'allowed-once' },
}
const env = scrubEnv(process.env, { version: 'smoke' })
const binary = resolveClaudeBinary({ env: process.env, platform: process.platform, arch: process.arch, sdkRoot })
const probe = new Probe({ query, binary, env })
const a = new ClaudeCodeAdapter({ query, probe, ctx, binary, env, version: 'smoke' })
const collect = async (gen) => { const out = []; for await (const c of gen) out.push(c); return out }
const base = { provider: 'claude-code', model: 'sonnet', system: 'You are arxa. Be terse.', tools: [] }

const acct = await probe.current(); assert.equal(acct.loggedIn, true, acct.error); console.log('probe ok:', acct.version, acct.subscriptionType)

const t1 = await collect(a.stream({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly the word OK.' }] }] }))
assert.match(t1.filter((c) => c.type === 'text-delta').map((c) => c.text).join(''), /OK/); console.log('text turn ok')

const t2 = await collect(a.stream({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'Use the Read tool on note.txt in the current directory and reply with its content only.' }] }] }))
const call = t2.find((c) => c.type === 'block-end' && c.block.type === 'tool-call')
assert.ok(call, 'expected a Read tool-call block'); assert.equal(call.block.name, 'Read')
assert.deepEqual(t2.at(-1).reason, { kind: 'tool-calls' })
const mirrored = await fromClaude.expect(call.block.id)
assert.match(mirrored.text, /PEACH/); console.log('mirror result ok')
const t2b = await collect(a.stream({ ...base, messages: [
  { role: 'user', content: [{ type: 'text', text: 'x' }] },
  { role: 'assistant', content: [call.block] },
  { role: 'user', content: [{ type: 'tool-result', toolCallId: call.block.id, content: [{ type: 'text', text: mirrored.text }] }] }] }))
assert.match(t2b.filter((c) => c.type === 'text-delta').map((c) => c.text).join(''), /PEACH/); console.log('tool round ok')

const t3 = await collect(a.stream({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: `Use the Bash tool to run: touch ${escape} ; then report the exit status only.` }] }] }))
for (const c of t3.filter((c) => c.type === 'block-end' && c.block.type === 'tool-call')) await fromClaude.expect(c.block.id).catch(() => {})
assert.equal(existsSync(escape), false, 'SANDBOX ESCAPE: file written outside the workspace'); console.log('sandbox confinement ok')
console.log('claude-code live smoke: all green')
```
Fill the `ArxaSandboxProvider` construction from how `plugins/sandbox/selftest.mjs` builds one (it injects a fake world); if the constructor needs a cordis ctx, use `ctx.sandbox.confine` from a booted host instead and note it in the header.

- [ ] **Step 2: Run** — `node scripts/claude-code-smoke.mjs --yes`
Expected: five `ok` lines and `all green`. If the Bash round fails with a `shell-snapshots` write error, add `join(homedir(), '.claude', 'shell-snapshots')` to `CLAUDE_EXTRA_ROOTS` in `lib/spawn.js`, update `selftest.spawn.mjs`, and re-run.

- [ ] **Step 3: Record status in the spec**

Append to `docs/plans/claude-subscription-engine.md`:
```markdown
## Implementation status
- Plan: docs/plans/claude-subscription-engine-implementation.md (Tasks 1–14).
- Shipped: adapter, mirror tools, MCP bridge, approval bridge, sign-in flow, OAuth hide + tripwire, live smoke, provider/status channel + composer pill (all providers), Claude usage as its first producer.
- Still open: Windows ACL rung unmeasured; Linux token-dependent runs (resume, Bash escape) pending a `claude setup-token`; Claude Code `plugins:` loading of arxa skill packs (phase 2).
```

- [ ] **Step 4: Full CI + commit**

```bash
npm test
git add scripts/claude-code-smoke.mjs docs/plans/claude-subscription-engine.md
git commit -m "test: add the hand-run live smoke for the claude-code adapter and record implementation status"
```

---

### Task 13: `provider/status` — one live status channel for every model provider

**Files:**
- Create: `plugins/provider-status/package.json`
- Create: `plugins/provider-status/lib/index.js` (host: projection registration + producer helper)
- Create: `plugins/provider-status/lib/status.js` (pure: schema, fold, badge formatting)
- Create: `plugins/provider-status/lib/client.js` (browser: badge in the composer row)
- Create: `plugins/provider-status/selftest.mjs`
- Modify: `bin/arxa-studio.mjs:178-190` (`PROFILE_PLUGINS`) and `:369` (`BY_NAME_PLUGINS`)
- Modify: `profile/cordis.patch.yml` (one `- insert:` row)
- Modify: `package.json` (`zod` exact dep)

**Why this shape — the generic client-side hook already exists.** Every session-scoped slot component receives `useSession`, `sessionId` and **`useProjection`** as standard props (`dsh-client-runtime/lib/types/client/index.d.ts:63-73`, `SessionStandardProps`; the goal dock destructures `useProjection` from props and is registered into `conversation.input.dock`, a sibling of `conversation.input.right` rendered with the same `zone`, `dsh-client-ui-goal/lib/client.js:242,410`). A host plugin adds a projection key with `ctx.sessionProjections.register({ key, stateSchema, init, apply, wire, stateVersion })` (`@deepseek-ai/dsh-session-projection`, exactly how `dsh-goal/lib/index.js:522-534` registers `goal`). The registry folds every appended session event, pushes `session/projection` frames live to all connected clients (`dsh-host-apiproxy/lib/types/api-proxy.js:978-1024`), and replays the current value on open/reconnect. The wire schema accepts any key (`dsh-client-connection/lib/client.js:5641-5643`, `key: string().min(1)`). No polling, no RPC, no second socket, no per-provider client code.

So the generic hook is: **any provider appends `provider/status` events; one projection `providerStatus` folds them; any slot component reads `useProjection('providerStatus')`.** Claude Code is the first producer (Task 14). pi-ai providers, DeepSeek, GLM and anything future append the same event and get the same badge.

**Interfaces:**
- Session event `provider/status`, data (whole value, never a delta):
  `{ provider: string, level: 'ok'|'warn'|'limit'|'info', text: string, title?: string, utilization?: number (0..1), resetsAt?: number (unix seconds), detail?: JsonValue }`.
  `text` is what the pill shows (short, provider-prefixed, e.g. "Claude 90%"); `title` is the hover text.
- Projection key `providerStatus`, value `ProviderStatus & { at: number } | null` (`at` = event time ms).
- Host helper: `appendProviderStatus(session, status)` — validates with the zod schema, then `session.append('provider/status', status)`.
- Pure: `PROVIDER_STATUS_SCHEMA` (zod), `applyProviderStatus(state, event)`, `formatBadge(value, now) → { text, level, title } | undefined` (adds "· resets in 2h 46m" when `resetsAt` is present and `level !== 'ok'`).
- Client: `ProviderStatusBadge(props)` registered into `conversation.input.right`, `id: 'arxa-provider-status'`, `order: 20`; reads `props.useProjection('providerStatus')`.

- [ ] **Step 1: Deps**

```bash
npm i -E zod@$(node -p "require('./node_modules/zod/package.json').version")   # today 4.4.3, already hoisted by dsh; pin it explicitly since we import it
```

- [ ] **Step 2: Failing test**

`plugins/provider-status/selftest.mjs`:
```js
import { strict as assert } from 'node:assert'
import { PROVIDER_STATUS_SCHEMA, applyProviderStatus, formatBadge } from './lib/status.js'
import { appendProviderStatus, PROJECTION } from './lib/index.js'

let n = 0; const ok = (s) => { n++; console.log(`  ok ${s}`) }
const good = { provider: 'claude-code', level: 'warn', text: 'Claude 90%', title: 'weekly limit · max', utilization: 0.9, resetsAt: 1_800_000_000 }
assert.deepEqual(PROVIDER_STATUS_SCHEMA.parse(good), good)
assert.throws(() => PROVIDER_STATUS_SCHEMA.parse({ ...good, level: 'loud' })); ok('schema')

assert.equal(applyProviderStatus(null, { type: 'turn/start', time: 1, data: {} }), null)
const v = applyProviderStatus(null, { type: 'provider/status', time: 123, data: good })
assert.deepEqual(v, { ...good, at: 123 })
assert.equal(applyProviderStatus(v, { type: 'provider/status', time: 124, data: { ...good, level: 'zzz' } }), v, 'invalid event leaves state untouched'); ok('fold = latest valid value')

const now = 1_799_990_000 * 1000
assert.deepEqual(formatBadge(v, now), { level: 'warn', text: 'Claude 90% · resets in 2h 46m', title: 'weekly limit · max' })
assert.deepEqual(formatBadge({ ...v, level: 'ok' }, now), { level: 'ok', text: 'Claude 90%', title: 'weekly limit · max' })
assert.equal(formatBadge(null, now), undefined); assert.equal(formatBadge(undefined, now), undefined); ok('badge text')

assert.equal(PROJECTION.key, 'providerStatus'); assert.equal(PROJECTION.init(), null); assert.equal(PROJECTION.stateVersion, 1)
assert.deepEqual(PROJECTION.wire.view(v), v); ok('projection definition')

const appended = []
const session = { append: (type, data) => { appended.push([type, data]); return { seq: 0 } } }
appendProviderStatus(session, good)
assert.deepEqual(appended, [['provider/status', good]])
assert.throws(() => appendProviderStatus(session, { provider: 'x' }), /text/); ok('producer helper validates')
console.log(`selftest.provider-status: ${n} ok`)
```

- [ ] **Step 3: Run, expect `ERR_MODULE_NOT_FOUND`**

- [ ] **Step 4: Implement status.js**

```js
import { z } from 'zod'

export const PROVIDER_STATUS_SCHEMA = z.object({
  provider: z.string().min(1),
  level: z.enum(['ok', 'warn', 'limit', 'info']),
  text: z.string().min(1).max(80),
  title: z.string().max(240).optional(),
  utilization: z.number().min(0).max(1).optional(),
  resetsAt: z.number().int().nonnegative().optional(),
  detail: z.unknown().optional(),
})
export const PROJECTION_VALUE_SCHEMA = PROVIDER_STATUS_SCHEMA.extend({ at: z.number() }).nullable()

/** Fold: the projection is the latest valid provider/status event. Whole value, never a delta. */
export function applyProviderStatus (state, event) {
  if (event.type !== 'provider/status') return state
  const parsed = PROVIDER_STATUS_SCHEMA.safeParse(event.data)
  return parsed.success ? { ...parsed.data, at: event.time } : state
}

const relative = (resetsAt, now) => {
  const s = Math.max(0, Math.round(resetsAt - now / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function formatBadge (value, now = Date.now()) {
  if (!value) return undefined
  const reset = value.resetsAt !== undefined && value.level !== 'ok' ? ` · resets in ${relative(value.resetsAt, now)}` : ''
  return { level: value.level, text: `${value.text}${reset}`, title: value.title ?? value.text }
}
```

- [ ] **Step 5: Implement lib/index.js (host)**

```js
// arxa-provider-status: ONE live status channel for every model provider.
// Producers (any LlmAdapter, host plugin, tool) call appendProviderStatus(session, {...});
// the projection `providerStatus` folds it and dsh pushes it to every client live and
// replays it on reconnect (session/projection frames). The badge lives in lib/client.js.
import { PROVIDER_STATUS_SCHEMA, PROJECTION_VALUE_SCHEMA, applyProviderStatus } from './status.js'

export const PROJECTION = Object.freeze({
  key: 'providerStatus',
  stateSchema: PROJECTION_VALUE_SCHEMA,
  init: () => null,
  apply: applyProviderStatus,
  wire: { viewSchema: PROJECTION_VALUE_SCHEMA, view: (state) => state },
  stateVersion: 1,
})

/** Producer helper: validate, then append. Throws a zod error on a bad status. */
export function appendProviderStatus (session, status) {
  return session.append('provider/status', PROVIDER_STATUS_SCHEMA.parse(status))
}

export const name = 'arxa-provider-status'
export const inject = ['sessionProjections']
export function apply (ctx) {
  ctx.sessionProjections.register(PROJECTION)
}
```

- [ ] **Step 6: Run, expect `selftest.provider-status: 6 ok`**

- [ ] **Step 7: package.json + wiring**

`plugins/provider-status/package.json`:
```json
{
  "name": "arxa-provider-status",
  "version": "0.1.0",
  "private": true,
  "description": "One live status channel for every model provider: provider/status session events → providerStatus projection → a small pill in the composer row.",
  "type": "module",
  "main": "lib/index.js",
  "exports": { ".": "./lib/index.js", "./client": "./lib/client.js", "./package.json": "./package.json" },
  "dsh": { "client": { "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-conversation"], "platform": "web" } },
  "peerDependencies": { "react": "^18.2.0" }
}
```
`bin/arxa-studio.mjs`: `const providerStatusDir = resolve(here, '..', 'plugins', 'provider-status')` next to `genUiDir` (`:124`); `['arxa-provider-status', providerStatusDir]` in `PROFILE_PLUGINS`; `'arxa-provider-status'` in `BY_NAME_PLUGINS`.
`profile/cordis.patch.yml`, append:
```yaml
# arxa-specific: provider/status → providerStatus projection → composer pill.
# HOST-PLANE (registers a projection). Works for every provider; claude-code is
# the first producer. By PACKAGE NAME — browser half via package.json dsh.client.
- insert:
  - id: arxa-provider-status
    name: arxa-provider-status
```

- [ ] **Step 8: The badge (client.js)**

```js
/**
 * arxa-provider-status browser half: a small pill in the composer's trailing row
 * (slot conversation.input.right, beside the model name and dsh's context meter).
 * Reads the host-computed `providerStatus` projection through the standard
 * `useProjection` slot prop — live push, replay on reconnect, no polling.
 * __ModuleLoader__ factory shape, like plugins/gen-ui/lib/client.js.
 */
window.__ModuleLoader__.load({
  id: 'arxa-provider-status',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement

    // Duplicated from lib/status.js on purpose: the client bundle is a plain browser
    // file with no module graph into lib/. Keep the two in step (selftest asserts parity).
    const relative = (resetsAt, now) => { const s = Math.max(0, Math.round(resetsAt - now / 1000)); const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60); return hh > 0 ? `${hh}h ${mm}m` : `${mm}m` }
    function formatBadge (value, now) {
      if (!value) return undefined
      const reset = value.resetsAt !== undefined && value.level !== 'ok' ? ` · resets in ${relative(value.resetsAt, now)}` : ''
      return { level: value.level, text: `${value.text}${reset}`, title: value.title || value.text }
    }
    const COLOR = { ok: 'var(--dsw-text-muted, #8a8f98)', info: 'var(--dsw-text-muted, #8a8f98)', warn: 'var(--dsw-warning, #d08a00)', limit: 'var(--dsw-danger, #d64545)' }

    function ProviderStatusBadge ({ useProjection }) {
      const value = useProjection('providerStatus')
      const [now, setNow] = React.useState(Date.now())
      React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t) }, []) // only re-renders the "resets in" text
      const badge = formatBadge(value, now)
      if (!badge) return null
      return h('span', {
        title: badge.title, 'aria-label': badge.title,
        style: { fontSize: '11px', lineHeight: '18px', padding: '0 6px', borderRadius: '9px', border: `1px solid ${COLOR[badge.level]}`, color: COLOR[badge.level], whiteSpace: 'nowrap' },
      }, badge.text)
    }

    function apply (ctx) {
      ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: 'arxa-provider-status',
        order: 20,
      }, ProviderStatusBadge))
    }
    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
```
Parity guard: add to `selftest.mjs` a check that the `formatBadge` source in `lib/client.js` (extract with a regex between `function formatBadge` and the next `const COLOR`) produces the same output as `lib/status.js`'s for the three fixtures above, by `new Function`-evaluating the extracted snippet. One more `ok('client formatBadge parity')`.

- [ ] **Step 9: Boot and prove the channel end to end without Claude**

Run the studio, open a session, then from a node REPL against the running host (or a one-off host-plane script) append a status to the open session:
```bash
node -e "
// Adjust to the host's session access; the point is only to prove the wire.
import('./plugins/provider-status/lib/index.js').then(({ appendProviderStatus }) => console.log(typeof appendProviderStatus))"
```
Simplest reliable proof: temporarily add to `plugins/provider-status/lib/index.js` `apply()` a dev hook `ctx.on('session/event', (session, e) => { if (e.type === 'user/message' && process.env.ARXA_PROVIDER_STATUS_DEMO) appendProviderStatus(session, { provider: 'demo', level: 'warn', text: 'Demo 42%', title: 'demo channel', utilization: 0.42, resetsAt: Math.floor(Date.now()/1000) + 5400 }) })`, boot with `ARXA_PROVIDER_STATUS_DEMO=1`, send any message. Expected: the pill "Demo 42% · resets in 1h 30m" appears next to the model name within the same second, survives a page reload (projection replay), and vanishes for other sessions. Remove the demo hook before committing.

- [ ] **Step 10: Commit**

```bash
npm test
git add package.json package-lock.json plugins/provider-status bin/arxa-studio.mjs profile/cordis.patch.yml
git commit -m "feat: add the provider/status projection and composer pill shared by every model provider"
```

---

### Task 14: Claude Code emits `provider/status`

**Files:**
- Modify: `plugins/claude-code/lib/adapter.js`
- Create: `plugins/claude-code/lib/rate-limit.js`
- Create: `plugins/claude-code/selftest.rate-limit.mjs`
- Modify: `plugins/claude-code/selftest.adapter.mjs`

**Interfaces:**
- Produces: `rateLimitToStatus(info: SDKRateLimitInfo, account) → ProviderStatus`.
- Consumes: `appendProviderStatus` from `plugins/provider-status/lib/index.js` (relative import `../../provider-status/lib/index.js`).
- SDK `SDKRateLimitInfo`: `{ status: 'allowed'|'allowed_warning'|'rejected', resetsAt?: number, rateLimitType?: 'five_hour'|'seven_day'|'seven_day_opus'|'seven_day_sonnet'|'seven_day_overage_included'|'overage', utilization?: number, isUsingOverage?: boolean, ... }`.

- [ ] **Step 1: Failing test**

```js
import { strict as assert } from 'node:assert'
import { rateLimitToStatus } from './lib/rate-limit.js'
const acct = { email: 'e@x', subscriptionType: 'max' }
assert.deepEqual(rateLimitToStatus({ status: 'allowed_warning', utilization: 0.9, resetsAt: 1_800_000_000, rateLimitType: 'seven_day' }, acct),
  { provider: 'claude-code', level: 'warn', text: 'Claude 90%', title: 'Claude weekly limit · 90% used · max · e@x', utilization: 0.9, resetsAt: 1_800_000_000, detail: { rateLimitType: 'seven_day', status: 'allowed_warning' } })
assert.deepEqual(rateLimitToStatus({ status: 'allowed', utilization: 0.2 }, acct).level, 'ok')
assert.equal(rateLimitToStatus({ status: 'allowed', utilization: 0.2 }, acct).text, 'Claude 20%')
const lim = rateLimitToStatus({ status: 'rejected', resetsAt: 1_800_000_000, rateLimitType: 'five_hour' }, acct)
assert.equal(lim.level, 'limit'); assert.equal(lim.text, 'Claude limit reached'); assert.match(lim.title, /5-hour window/)
assert.equal(rateLimitToStatus({ status: 'allowed' }, {}).text, 'Claude')
assert.equal(rateLimitToStatus({ status: 'allowed_warning', isUsingOverage: true, rateLimitType: 'overage' }, acct).title, 'Claude usage credits · max · e@x')
console.log('selftest.rate-limit: 6 ok')
```

- [ ] **Step 2: Run, expect `ERR_MODULE_NOT_FOUND`**

- [ ] **Step 3: Implement**

```js
const TYPE_LABEL = { five_hour: '5-hour window', seven_day: 'weekly limit', seven_day_opus: 'weekly Opus limit', seven_day_sonnet: 'weekly Sonnet limit', seven_day_overage_included: 'weekly limit (credits included)', overage: 'usage credits' }

/** SDK rate_limit_event → the provider-neutral status every model shares (Task 13). */
export function rateLimitToStatus (info, account = {}) {
  const what = TYPE_LABEL[info.rateLimitType] ?? 'usage'
  const pct = info.utilization === undefined ? undefined : Math.round(info.utilization * 100)
  const who = [account.subscriptionType, account.email].filter(Boolean)
  const title = ['Claude ' + what, ...(pct === undefined ? [] : [`${pct}% used`]), ...who].join(' · ')
  const level = info.status === 'rejected' ? 'limit' : info.status === 'allowed_warning' ? 'warn' : 'ok'
  const text = level === 'limit' ? 'Claude limit reached' : pct === undefined ? 'Claude' : `Claude ${pct}%`
  return {
    provider: 'claude-code', level, text, title,
    ...(info.utilization === undefined ? {} : { utilization: info.utilization }),
    ...(info.resetsAt === undefined ? {} : { resetsAt: info.resetsAt }),
    detail: { rateLimitType: info.rateLimitType, status: info.status },
  }
}
```

- [ ] **Step 4: Wire into the adapter**

In `lib/adapter.js`: `import { appendProviderStatus } from '../../provider-status/lib/index.js'` and `import { rateLimitToStatus } from './rate-limit.js'`; replace the bridge's `onRateLimit` with
```js
onRateLimit: (info) => appendProviderStatus(agent.session, rateLimitToStatus(info, account)),
```
The `claude-code/rate-limit` event and the `status` dependency from the earlier Task 13 draft are gone: one event type, one projection, one pill. In `selftest.adapter.mjs`, assert after a script containing a `rate_limit_event` that `events` holds `{ type: 'provider/status', data: { provider: 'claude-code', level: 'warn', … } }`.

- [ ] **Step 5: Run all selftests; boot; run a Claude turn**

Expected: the composer pill reads "Claude NN%" right after the first Claude turn, turns amber with "resets in …" at Anthropic's warning threshold, red with "Claude limit reached" when refused. Switch the session to another provider: the pill keeps the last Claude value until that provider emits its own `provider/status` (or forever if it never does — acceptable; a provider that says nothing has nothing to show).

- [ ] **Step 6: Commit** — `git add plugins/claude-code && git commit -m "feat: publish claude subscription usage through the shared provider/status channel"`

---

## Self-review against the spec

- D1 real binary / no in-app sign-in / spoof hidden + guard → Tasks 3, 10, 11. ✔
- D2 (amended) session engine via adapter, stock UI → Tasks 6, 9. ✔
- D3 exact SDK pin, PATH binary then bundled, stock picker → Tasks 1, 3. ✔
- D4 (amended) free switching + handoff → Task 6 `renderHandoff`, Task 9. ✔
- D5 three lock layers: sandbox spawn (Task 4), knobs `settingSources: []`, `permissionMode: 'default'` (Task 9), approval bridge (Task 8). ✔
- D6 not-signed-in state → Task 10 in the stock login surface; probe cadence 3 s while the flow runs, 60 s cache otherwise. ✔
- D7 Claude intelligence only: custom system prompt, no settings, arxa tools over MCP (Task 7/9). ✔
- D8 built-ins kept, rendered via mirror tools (Task 5). Subagent/skill/plugin *tools* stay enabled — nothing disallows them; their frames are hidden as nested (`parent_tool_use_id`). ✔
- D9 live models + static fallback + tier/version descriptions (Tasks 1, 3, 9). ✔
- D10 env scrub + `apiKeySource` refusal (Tasks 2, 6), rate limits published as `provider/status` and shown live in the composer pill for every provider (Tasks 13–14), Fable → `fallbackModel: 'opus'` (Task 9), no separate meter page. ✔

Known ceilings, all marked in code comments or the status section: Windows unmeasured; nested subagent activity not rendered; the pill shows the latest status only (a fold, not a history), and a provider that never emits `provider/status` shows nothing; the dsh arxa-gate (`arxa-gate` row, tool names `write/edit/bash`) does not pre-check Claude's built-ins — approval + sandbox are the gates for those.

### Task 14: Both rings live for every provider (2026-09-05)

**Problem, as reported:** the composer's usage ring (5-hour / weekly) showed nothing until a Claude turn had run in *that* session, so it looked "activated only by limits"; and the context ring read far too full on Fable.

**Root causes (from source, not memory):**
- Usage: `adapter.refreshUsage()` publishes Claude's `/usage` windows only at turn start, keyed per session. The host `poller.ensure(sessionId, provider)` (`plugins/provider-status/lib/poller.js`) returned early for any provider not in the static `VENDORS` table, so picking Claude in a fresh session fetched nothing. `formatBadge`/`bindingStatus` never hide a level-`ok` status — the ring was empty for lack of data, not by design.
- Context: `resolveModel()` advertised a flat `context: { contextWindow: 200_000 }`. The live Fable row is `claude-fable-5-1[1m]` (1M). dsh's `dsh-token-meter` already counts cache-read tokens in `pressureFrom`, so only the divisor was wrong. `supportedModels()` (SDK `ModelInfo`, `@anthropic-ai/claude-agent-sdk` 0.3.259) carries no window; the only live source is `modelUsage[model].contextWindow` on each turn's `result`.

**Changes:**
- `provider-status/lib/poller.js`: `READERS` + `registerUsageReader(provider, read)`; `read()` dispatches to a registered reader before the vendor table; `ensure()` admits registered providers. A reader returns `{ statuses, configured }`; a throw renders as `?`. Same TTL / reset-clamped cache.
- `claude-code/lib/probe.js`: `warmStart()` (the startup handshake, shared) and `usage()` — signed-in check via the cached probe, then a warm child, `fetchUsageStatuses(warm.query(never))`, close. No turn, no tokens, same sandboxed spawner.
- `claude-code/index.mjs`: `registerUsageReader(PROVIDER_ID, () => probe.usage())`.
- `claude-code/lib/models.js`: `contextWindowFor(id, learned)` — learned value wins, else `[1m]` → 1_000_000, else 200_000.
- `claude-code/lib/bridge.js`: `onModelUsage(model, contextWindow)` fired from the result's `modelUsage`.
- `claude-code/lib/adapter.js`: `noteContextWindow()` records it under the row id the turn ran on; `resolveModel()` uses `contextWindowFor(row.id, learned)`. dsh re-resolves per turn and re-emits `request/context` on change (`dsh-agent-loop`), so the ring corrects from the next turn.

**Docs consulted:** `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (`Query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`, `ModelUsage.contextWindow`, `ModelInfo`), `node_modules/@deepseek-ai/dsh-token-meter/lib/index.js` (`pressureFrom`, `request/context` fold), `dsh-agent-loop/lib/index.js:764`.

**Ceiling, stated:** the `/usage` control request is marked experimental by the SDK; if it is renamed, `fetchUsageStatuses` already falls back to a plain `usage()` method and otherwise yields no statuses — the ring shows `?` (via the poller's "unrecognised response"), never a stale number.
