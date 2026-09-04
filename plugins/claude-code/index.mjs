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

const require = createRequire(import.meta.url)
const version = require(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json')).version
// Resolved via the package's main entry, not './package.json': the SDK's `exports` map does
// not expose its own package.json, so requiring that subpath throws at plugin load.
const sdkRoot = dirname(require.resolve('@anthropic-ai/claude-agent-sdk'))

export const name = 'arxa-claude-code'
export const inject = ['llm', 'agents', 'approval', 'sandbox', 'sandboxPolicy', 'authorization', 'credentials']

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
  ctx.llm.registerAdapter([PROVIDER_ID], new ClaudeCodeAdapter({ query, probe, ctx, binary, env, version }))
  ctx.authorization.registerFlow(claudeAuthFlow({ probe, credentials: ctx.credentials }))
  hideAnthropicOauth(ctx.authorization)
}
