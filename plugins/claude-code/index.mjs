// HOST-plane plugin: the claude-code LLM adapter (D2 amended), the sign-in flow (D6),
// and the pi-ai Anthropic-OAuth hide (D1). Tools live in ./agent.mjs (agent plane).
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeCodeAdapter } from './lib/adapter.js'
import { Probe, resolveClaudeBinary } from './lib/probe.js'
import { scrubEnv } from './lib/env.js'
import { PROVIDER_ID } from './lib/models.js'

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
  const probe = new Probe({ query, binary, env })
  ctx.llm.registerAdapter([PROVIDER_ID], new ClaudeCodeAdapter({ query, probe, ctx, binary, env, version }))
  // Task 10: ctx.authorization.registerFlow(claudeAuthFlow({ probe, credentials: ctx.credentials }))
  // Task 11: hideAnthropicOauth(ctx.authorization)
}
