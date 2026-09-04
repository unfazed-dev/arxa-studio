// Pure environment scrubber for the claude-code child. No I/O.
// The child must bill the subscription, never a key (D10), and must not think it is
// nested inside another Claude Code (spike: CLAUDECODE / CLAUDE_CODE_ENTRYPOINT guard).
export const BLOCKED_ENV = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT',
]

export function scrubEnv (env, { version }) {
  // A missing version silently shipped `arxa-studio/undefined` as the client-app identifier
  // Anthropic sees on every request. Fail here instead — it is a wiring mistake at plugin
  // apply, and the only caller reads it straight out of package.json.
  if (typeof version !== 'string' || version.length === 0) {
    throw new TypeError('scrubEnv: a non-empty version is required for CLAUDE_AGENT_SDK_CLIENT_APP')
  }
  const out = {}
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || BLOCKED_ENV.includes(k)) continue
    out[k] = v
  }
  out.CLAUDE_AGENT_SDK_CLIENT_APP = `arxa-studio/${version}`
  return out
}
