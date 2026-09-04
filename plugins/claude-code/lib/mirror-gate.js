// The mirror tools are only meaningful while a `claude-code` model is selected.
// Their `execute` parks on `fromClaude.expect(callId)`, and nothing ever resolves
// that unless a Claude Code child produced the call. Left visible to a pi-ai or
// DeepSeek model, a `Bash` call — the first name an Anthropic-trained model reaches
// for — hangs the turn until the user cancels. Nothing fails loudly first: arxa's
// own tools are snake_case, so there is no name collision at boot.
//
// `ctx.tools.restrict()` cannot hide them. Its contract (dsh-tools/lib/index.js,
// `restrict`) reads: "Restrict global tools for the calling agent scope. Empty
// filters, unknown names, scope-local names, and reserved transport names fail.
// Restrictions intersect; scoped registrations remain visible." agent.mjs registers
// into the agent scope, so those names are scope-local — restrict() would throw on
// them, and even if it did not, scoped registrations stay visible by design.
// `register()` on the other hand "returns the exact disposer that unregisters the
// tool", so registration itself is the lever.
//
// The selection can change mid-session, so a static cordis-row gate is not enough.
// The gate re-evaluates on every prompt assembly and every request build. Both
// listeners are PREPENDED, which cordis documents as outermost-first ("Listeners
// run outermost-first"; `on(name, listener, true)` is prepend shorthand). Being
// outermost means `await next()` returns the value dsh-agent's own model-selection
// listener has already stamped with the live selection — it sets
// `variables.provider` after its own `next()` (dsh-agent/lib/index.js:272), and
// overrides `provider` on the resolved request config the same way.
//
// Tool schemas are collected BEFORE the `system-prompt/assemble` waterfall runs
// (dsh-system-prompt/lib/index.js:249-283), so a registry change made during the
// waterfall cannot reach the list this turn already gathered. The assemble listener
// therefore reconciles `assembly.tools` itself — dropping the mirror rows off a
// non-claude turn, adding them back on the first claude turn after a switch — so the
// list the loop hands the adapter (dsh-agent-loop/lib/index.js:613) always matches
// the registry the gate just settled on. Registration state fixes
// `ctx.tools.schemas()` for everything downstream; this fixes the turn in flight.
import { MIRROR_TOOL_NAMES, mirrorToolDefinitions } from './mirror-tools.js'

const MIRROR_NAMES = new Set(MIRROR_TOOL_NAMES)

// An unknown provider keeps today's behaviour (mirror tools visible) rather than
// breaking the Claude path in a deployment that never populates the signal. Every
// real entry point does populate it: dsh-agent-loop registers the `provider` prompt
// variable from `agent.options.provider` (lib/index.js:1024), and both dsh-headless
// and dsh-host-apiproxy install the model selection that overrides it. `agent/request`
// is stronger still — buildRequest throws unless the resolved provider is non-empty.
const wants = (provider, providerId) => provider === undefined || provider === providerId

/**
 * Register the mirror tools and keep their visibility tied to the selected model.
 *
 * @param ctx - the agent-plane plugin context (needs `tools` and `on`).
 * @param defineTool - dsh-tools' `defineTool`.
 * @param pending - the `fromClaude` PendingResults instance.
 * @param providerId - the claude-code provider id.
 * @returns a disposer that removes both listeners and unregisters the tools.
 */
export function installMirrorTools ({ ctx, defineTool, pending, providerId }) {
  const definitions = mirrorToolDefinitions(defineTool, pending)
  // Same shape and same defensive clone dsh-system-prompt gives a collected schema.
  const mirrorSchemas = definitions.map(({ name, description, parameters }) => ({ name, description, parameters: structuredClone(parameters) }))
  let disposers = null // null = currently unregistered

  const register = () => {
    if (disposers !== null) return // duplicates within one layer fail; never register over a live one
    disposers = definitions.map((definition) => ctx.tools.register(definition))
  }
  const unregister = () => {
    if (disposers === null) return
    for (const dispose of [...disposers].reverse()) dispose()
    disposers = null
  }
  // Steady state is a no-op: `register`/`unregister` both return early when the
  // registry already matches, so the per-step `agent/request` hook costs nothing.
  const sync = (provider) => { wants(provider, providerId) ? register() : unregister() }

  // Start visible, matching the pre-gate behaviour. The first assembly of any turn
  // corrects this before the list reaches a model, and it filters that turn's list
  // too, so a session that opens on DeepSeek never sees a mirror tool.
  register()

  const disposeAssemble = ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembled = await next()
    const provider = assembled?.variables?.provider
    sync(provider)
    const tools = assembled?.tools ?? []
    if (!wants(provider, providerId)) {
      const kept = tools.filter((tool) => !MIRROR_NAMES.has(tool.name))
      return kept.length === tools.length ? assembled : { ...assembled, tools: kept }
    }
    const present = new Set(tools.map((tool) => tool.name))
    const missing = mirrorSchemas.filter((schema) => !present.has(schema.name))
    return missing.length === 0 ? assembled : { ...assembled, tools: [...tools, ...missing] }
  }, true)

  const disposeRequest = ctx.on('agent/request', async (_payload, next) => {
    const resolved = await next()
    sync(resolved?.provider)
    return resolved
  }, true)

  return () => { disposeRequest(); disposeAssemble(); unregister() }
}

export { MIRROR_NAMES }
