// Pure environment scrubber for the claude-code child. No I/O.
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
