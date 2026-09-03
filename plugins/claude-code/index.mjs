// HOST-plane plugin: the claude-code LLM adapter (D2 amended), the sign-in flow (D6),
// and the pi-ai Anthropic-OAuth hide (D1). Tools live in ./agent.mjs (agent plane).
export const name = 'arxa-claude-code'
export const inject = ['llm', 'agents', 'approval', 'sandbox', 'sandboxPolicy', 'authorization', 'credentials']

export function apply (ctx, config = {}) {
  ctx.logger?.info?.('arxa-claude-code: loaded (adapter wired in Task 9)')
}
