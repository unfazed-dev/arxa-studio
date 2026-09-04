import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { stripMcpPrefix } from './bridge.js'

export { MCP_PREFIX, stripMcpPrefix } from './bridge.js'

/**
 * arxa's model-facing tools, exposed to Claude Code in-process. The handler does NOT run the
 * tool: it calls `onCall(name, args)`, supplied by the caller (Task 9), which parks — typically
 * via `fromLoop.expect(id)` (Task 5) — until the stock dsh loop has actually executed the real
 * tool (gates, cards and approvals included) and hands back that result.
 *
 * Schemas reach `tools/list` verbatim as arxa produced them (no zod conversion, no
 * re-validation) by installing raw request handlers on the low-level server underneath
 * `McpServer`, rather than using its `registerTool` helper.
 */
export function createArxaMcpServer ({ schemas, exclude = [], onCall, timeoutMs = 30 * 60 * 1000 }) {
  const visible = schemas.filter((s) => !exclude.includes(s.name))
  // capabilities.tools must be declared up front: the low-level Server refuses
  // setRequestHandler(ListToolsRequestSchema/CallToolRequestSchema) otherwise.
  const instance = new McpServer({ name: 'arxa', version: '1.0.0' }, { capabilities: { tools: {} } })

  instance.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: visible.map((s) => ({ name: s.name, description: s.description, inputSchema: s.parameters })),
  }))

  instance.server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = stripMcpPrefix(req.params.name)
    // `exclude` must hold even for a name the model was never shown in tools/list — a call for
    // it is refused here too, not just hidden from the listing.
    const out = exclude.includes(name)
      ? { text: `arxa: tool "${name}" is not exposed to Claude Code`, isError: true }
      // onCall(...) is created and handed straight into withTimeout(), which subscribes
      // .then/.catch to it in the same expression (before this statement finishes). So even
      // when the timeout wins the race, the promise is already "being listened to" — a later
      // rejection (e.g. PendingResults.clear() rejecting a fromLoop.expect() this call parked
      // on) lands on that handler instead of surfacing as an unhandled rejection.
      : await withTimeout(onCall(name, req.params.arguments ?? {}), timeoutMs)
    return { content: [{ type: 'text', text: out.text }], isError: out.isError }
  })

  return { type: 'sdk', name: 'arxa', timeout: timeoutMs, instance }
}

/** Race `promise` against `ms`; either outcome always resolves (never rejects) to a readable
 * `{text,isError}`, so a slow or dying tool call settles the MCP call instead of hanging it or
 * throwing into the request-handling pump. */
function withTimeout (promise, ms) {
  const settled = promise.then((v) => ({ done: true, v })).catch((err) => ({ done: true, err }))
  let timer
  const timedOut = new Promise((resolve) => { timer = setTimeout(() => resolve({ done: false }), ms) })
  return Promise.race([settled, timedOut]).then((r) => {
    clearTimeout(timer)
    if (!r.done) return { text: `arxa: tool call timed out after ${ms}ms`, isError: true }
    if (r.err) return { text: `arxa: tool call failed: ${r.err?.message ?? String(r.err)}`, isError: true }
    return r.v
  })
}
