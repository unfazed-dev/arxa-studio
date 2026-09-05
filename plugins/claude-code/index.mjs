// HOST-plane plugin: the claude-code LLM adapter (D2 amended), the sign-in flow (D6),
// and the pi-ai Anthropic-OAuth hide (D1). Tools live in ./agent.mjs (agent plane).
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { query, startup } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeCodeAdapter } from './lib/adapter.js'
import { Probe, resolveClaudeBinary } from './lib/probe.js'
import { scrubEnv } from './lib/env.js'
import { makeSpawner } from './lib/spawn.js'
import { PROVIDER_ID } from './lib/models.js'
import { claudeAuthFlow, hideAnthropicOauth } from './lib/auth-flow.js'
// No `../provider-status/...` import here, on purpose — see the providerStatus seam in apply().

const require = createRequire(import.meta.url)
const version = require(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json')).version
// Resolved via the package's main entry, not './package.json': the SDK's `exports` map does
// not expose its own package.json, so requiring that subpath throws at plugin load.
const sdkRoot = dirname(require.resolve('@anthropic-ai/claude-agent-sdk'))

export const name = 'arxa-claude-code'
// 'authorization' is deliberately NOT here. It is an optional seam: no arxa profile row mounts
// @deepseek-ai/dsh-authorization, so requiring it up front leaves this plugin forever 'pending'
// and dsh fails the whole boot — arxa studio will not start at all. dsh-llm-pi-ai, which
// registers an auth flow on the same seam, declares inject = ['llm'] and reaches authorization
// through a deferred ctx.inject() callback; this follows that pattern, so the adapter always
// loads and the sign-in surface attaches only where the service exists.
export const inject = ['llm', 'agents', 'approval', 'sandbox', 'sandboxPolicy', 'credentials']

export function apply (ctx, config = {}) {
  // scrubEnv's second argument is required and must carry a real version: `{}` would silently
  // brand every child `arxa-studio/undefined` in Anthropic's client-app telemetry.
  const env = scrubEnv(process.env, { version })
  const binary = config.binary ?? resolveClaudeBinary({ env: process.env, platform: process.platform, arch: process.arch, sdkRoot })
  // D5 covers the probe child too. It has no session of its own, so the policy is the
  // agentless resolve() the adapter's utility path already uses — deployment default mode,
  // configured workspace root — wrapped by the same spawner every turn child gets, transcript
  // grant included. Without this the probe launched the real `claude` binary unconfined on
  // listModels, on resolveModel, on every stream(), and up to 200 times per sign-in poll.
  const probeSpawner = makeSpawner({
    // Arrow, not a detached reference: confine() is an instance method that uses `this`.
    confine: (argv, policy) => ctx.sandbox.confine(argv, policy),
    policy: ctx.sandboxPolicy.resolve({}),
  })
  const probe = new Probe({ startup, binary, env, spawnClaudeCodeProcess: probeSpawner })
  // Everything this plugin tells the usage ring goes through the `providerStatus` SERVICE that
  // arxa-provider-status provides — never through a relative import of ../provider-status.
  // The profile loads this plugin by absolute path (cordis.patch.yml) and provider-status by
  // package name through a copy under the profile's node_modules, so a relative import bound a
  // SECOND module instance: a READERS map the real poller never consulted and a `latest` map the
  // RPC never served. Reader registered, ring never appeared, no row, not even a `?`
  // (measured 2026-09-05; DeepSeek/Kimi were fine because their path never leaves that plugin).
  // A cordis service is one object per app however many copies of a file got loaded.
  //
  // Deferred like `authorization`: the adapter never waits on it. A status published before the
  // service exists is dropped — a status update is never worth a turn, and the seam is up long
  // before any turn can run.
  let statusService
  const publish = (session, status) => { if (statusService !== undefined) statusService.publish(session, status) }
  ctx.llm.registerAdapter([PROVIDER_ID], new ClaudeCodeAdapter({ query, probe, ctx, binary, env, version, publish }))
  ctx.inject(['providerStatus'], (scope) => {
    statusService = scope.providerStatus
    // The usage ring's turn-free source: the provider-status poller asks this the moment a Claude
    // model is picked (and every 60s while one is), so the 5-hour / weekly windows show in every
    // session, not only after a turn has run in it. Same sandboxed probe child, no turn, no tokens.
    statusService.registerUsageReader(PROVIDER_ID, () => probe.usage())
  })
  // Deferred: fires if and when ctx.authorization exists. The model adapter above does not
  // depend on it — a user can pick a Claude model whether or not the login surface is mounted.
  ctx.inject(['authorization'], (authorized) => {
    authorized.authorization.registerFlow(claudeAuthFlow({ probe, credentials: ctx.credentials }))
    hideAnthropicOauth(authorized.authorization)
  })
}
