// AGENT-plane plugin: registers the mirror tools (Task 5) into this session's tool registry.
export const name = 'arxa-claude-code-tools'
export const inject = ['tools']

export function apply (ctx) {
  ctx.logger?.info?.('arxa-claude-code-tools: loaded (mirror tools wired in Task 5)')
}
