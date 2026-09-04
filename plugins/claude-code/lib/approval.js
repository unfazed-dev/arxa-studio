// Claude Code's permission prompt → dsh's approval flow (D5 layer 3). Bridged MCP tools
// skip this: the stock loop runs them through its own pipeline (gates, approval, cards),
// so asking again here would double-prompt the user for the same call.
//
// Fails closed by construction: the only branch that returns `allow` is the literal
// `'allowed-once'` check below. Every other approval.request outcome — 'rejected',
// 'cancelled', 'unavailable', or any value a future dsh version might add — falls through
// to the single `deny` return at the bottom; there is no default case that could resolve
// to allow. A thrown/rejected approval.request (backend down, turn torn down mid-request,
// etc.) is caught explicitly and denied too — it is a failure to ask, not consent, and we
// don't rely on how the SDK would otherwise handle a rejected canUseTool promise.
export function makeCanUseTool ({ approval, agent, isArxaTool }) {
  return async (toolName, input, { signal, toolUseID, title }) => {
    if (isArxaTool(toolName)) return { behavior: 'allow', updatedInput: input }

    let outcome
    try {
      outcome = await approval.request({
        agent,
        toolName,
        callId: toolUseID,
        reason: title ?? `Claude Code wants to use ${toolName}`,
        signal
      })
    } catch {
      return { behavior: 'deny', message: `arxa: could not confirm approval for ${toolName}; denying by default` }
    }

    if (outcome === 'allowed-once') return { behavior: 'allow', updatedInput: input }
    return { behavior: 'deny', message: `arxa: ${toolName} ${outcome} by the user's approval policy` }
  }
}
