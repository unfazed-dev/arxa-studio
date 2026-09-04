// The dsh LLM adapter: one Claude Code turn per stream() call, wired to arxa's sandbox,
// approval flow, transcript and tool loop. This is where every other module meets.
//
// The dsh loop calls stream() once per STEP, not once per turn: a step that ends in tool
// calls returns, the loop dispatches them, and the loop calls stream() again with the
// results appended. One Claude child spans all of those steps, so the live TurnBridge is
// parked in `this.turns` between them and the second call resumes it instead of respawning.
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { PROVIDER_ID, PROVIDER_NAME, FABLE_MIN_VERSION, describeModel, versionAtLeast } from './models.js'
import { TurnBridge, MCP_PREFIX, stripMcpPrefix } from './bridge.js'
import { renderHandoff } from './handoff.js'
import { makeSpawner } from './spawn.js'
import { makeCanUseTool } from './approval.js'
import { createArxaMcpServer } from './mcp-bridge.js'
import { MIRROR_TOOL_NAMES } from './mirror-tools.js'
import { fromClaude, fromLoop } from './pending.js'

const textOf = (msg) => (msg?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
const resultText = (block) => (block.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
const isToolResultsOnly = (msg) => msg?.role === 'user' && (msg.content?.length ?? 0) > 0 && msg.content.every((b) => b.type === 'tool-result')
const lastClaudeSession = (events) => { for (let i = events.length - 1; i >= 0; i--) if (events[i].type === 'claude-code/session') return events[i].data.claudeSessionId }
const isFable = (model) => /fable/i.test(String(model))

/** The arxa tools Claude will see, under the names it will call them by. Mirror tools are
 * excluded from the MCP server (Claude has the real built-in), so they are excluded here too. */
const arxaMcpToolNames = (schemas) => schemas
  .filter((s) => !MIRROR_TOOL_NAMES.includes(s.name))
  .map((s) => `${MCP_PREFIX}${s.name}`)

export class ClaudeCodeAdapter extends LlmAdapter {
  /** `spawn`/`mkdir` exist only so the selftest can exercise spawnClaudeCodeProcess without
   * touching the real filesystem or starting a process; production leaves them undefined. */
  constructor ({ query, probe, ctx, binary, env, version, spawn, mkdir }) {
    super()
    Object.assign(this, { query, probe, ctx, binary, env, version, spawn, mkdir })
    this.turns = new Map()
  }

  providerInfo () { return { id: PROVIDER_ID, name: PROVIDER_NAME } }

  async listModels () {
    const account = await this.probe.current()
    return account.models.map((m) => ({ provider: PROVIDER_ID, id: m.id, name: m.name, description: describeModel(m, account) }))
  }

  async resolveModel (provider, model) {
    const account = await this.probe.current()
    const row = account.models.find((m) => m.id === model) ?? { provider: PROVIDER_ID, id: model, name: model, description: '', efforts: [] }
    const efforts = row.efforts ?? []
    return {
      provider: PROVIDER_ID,
      id: row.id,
      name: row.name,
      description: describeModel(row, account),
      context: { contextWindow: 200_000 },
      ...(efforts.length ? { reasoning: { efforts: efforts.map((id) => ({ id, name: id })), defaultEffort: efforts.includes('high') ? 'high' : efforts[0] } } : {}),
    }
  }

  /** The D5 lock every query() carries: arxa's binary, arxa's scrubbed env, no filesystem
   * settings, real permission prompts, and a child that can only start inside arxa's sandbox. */
  base (policy, extra) {
    return {
      pathToClaudeCodeExecutable: this.binary,
      env: this.env,
      settingSources: [],
      permissionMode: 'default',
      spawnClaudeCodeProcess: makeSpawner({
        // An arrow, not a bare `this.ctx.sandbox.confine` reference: confine is an instance
        // method that uses `this`, and a detached reference throws when the spawner calls it.
        confine: (argv, p) => this.ctx.sandbox.confine(argv, p),
        policy,
        ...(this.spawn ? { spawn: this.spawn } : {}),
        ...(this.mkdir ? { mkdir: this.mkdir } : {}),
      }),
      ...extra,
    }
  }

  /** Release exactly the pending ids THIS turn registered. fromClaude/fromLoop are process-wide
   * singletons shared with every other live session, so a blanket clear would reject their
   * in-flight waits; and clear() is idempotent, so calling this twice (abort handler, then the
   * catch below, after the bridge re-parked its open calls) is safe and is how the entries
   * settleOpenCalls creates on the way down get dropped. */
  endTurn (agentId, turn) {
    // Identity-checked: a late abort from a turn the agent has already moved on from must not
    // evict the record of the turn running now — that would respawn a child mid-conversation.
    if (this.turns.get(agentId) === turn) this.turns.delete(agentId)
    fromClaude.clear([...turn.claudeIds])
    fromLoop.clear([...turn.loopIds])
  }

  /** Wire a caller's signal to a teardown, firing NOW if it already aborted: addEventListener on
   * an aborted signal never fires, and there is a real await (the probe, which spawns on a cold
   * TTL) between stream() being called and this being reached. Missing it would leave a live
   * Claude Code process that nobody reads and nobody stops. Same trap pending.js:8-10 guards. */
  onceAborted (signal, teardown) {
    if (signal === undefined) return
    if (signal.aborted) teardown()
    else signal.addEventListener('abort', teardown, { once: true })
  }

  async * stream (options) {
    const agent = this.ctx.agents.currentInitiator()
    if (options.purpose !== undefined || agent === undefined) { yield * this.utility(options, agent); return }

    const account = await this.probe.current()
    if (!account.loggedIn) throw new Error('claude-code: not signed in. Run `claude auth login` in a terminal, then pick the model again.')
    if (isFable(options.model) && !versionAtLeast(account.version, FABLE_MIN_VERSION)) {
      throw new Error(`claude-code: Fable needs Claude Code ≥ ${FABLE_MIN_VERSION}, you have ${account.version}`)
    }

    const last = options.messages.at(-1)
    const live = this.turns.get(agent.id)
    // Step N+1 of a turn already in flight: hand the loop's tool results to whoever is waiting
    // and keep reading the same child. Mirror ids have no fromLoop waiter and are dropped.
    if (live && isToolResultsOnly(last)) {
      for (const b of last.content) fromLoop.resolveIfWaiting(b.toolCallId, { text: resultText(b), isError: b.isError === true })
      try {
        yield * live.bridge.segment()
      } catch (err) { this.endTurn(agent.id, live); throw err }
      if (live.bridge.finished) this.endTurn(agent.id, live)
      return
    }

    // A new turn supersedes anything left parked for this agent (a consumer that walked away
    // mid-turn); release its ids rather than leaving them waiting for a child that is gone.
    if (live) this.endTurn(agent.id, live)

    const claudeSessionId = lastClaudeSession(agent.session.events)
    const userText = textOf(last)
    // No Claude session yet but a transcript exists → another engine ran this session; Claude
    // starts fresh and needs the story so far as flat text.
    const prompt = claudeSessionId === undefined && options.messages.length > 1
      ? `${renderHandoff(options.messages.slice(0, -1))}\n\nUser: ${userText}`
      : userText

    const policy = this.ctx.sandboxPolicy.resolve({ session: agent.session })
    const schemas = agent.ctx.tools.schemas()
    const mcpQueue = []              // { id, name } per mcp__arxa__* tool_use, oldest first
    const claudeIds = new Set()      // every tool_use id this turn produced (fromClaude side)
    const loopIds = new Set()        // ids an MCP call parked on (fromLoop side)
    const turn = { bridge: undefined, mcpQueue, claudeIds, loopIds }

    const mcp = createArxaMcpServer({
      schemas,
      exclude: MIRROR_TOOL_NAMES,
      // The bridge has already streamed the tool_use block for this name and the loop is running
      // the real dsh tool; park until the loop hands the result back through the next stream().
      onCall: (name) => {
        const i = mcpQueue.findIndex((q) => q.name === name)
        if (i < 0) return Promise.resolve({ text: `arxa: no pending call for ${name}`, isError: true })
        const { id } = mcpQueue.splice(i, 1)[0]
        loopIds.add(id)
        return fromLoop.expect(id, options.signal)
      },
    })

    const abortController = new AbortController()
    const q = this.query({
      prompt,
      options: this.base(policy, {
        cwd: agent.session.header.cwd ?? process.cwd(),
        model: options.model,
        // D5: an allowlist of the built-ins arxa mirrors, plus arxa's own tools. `tools` is the
        // SDK's availability knob ("To restrict which tools are available, use the `tools`
        // option instead" — sdk.d.ts on allowedTools, which only auto-APPROVES and would bypass
        // canUseTool). A disallowedTools denylist would fail open on every built-in nobody
        // enumerated; an unlisted tool here is simply unavailable.
        // ponytail: the mcp__arxa__* names are belt-and-braces — if `tools` gates built-ins only
        // they are inert, and if it gates every name they are required. Task 12's live smoke is
        // what tells us which; either way this list cannot let an unmirrored built-in through.
        tools: [...MIRROR_TOOL_NAMES, ...arxaMcpToolNames(schemas)],
        ...(isFable(options.model) ? { fallbackModel: 'opus' } : {}),
        ...(options.reasoningEffort ? { effort: options.reasoningEffort } : {}),
        ...(claudeSessionId ? { resume: claudeSessionId } : {}),
        systemPrompt: { type: 'custom', prompt: options.system ?? '' },
        mcpServers: { arxa: mcp },
        strictMcpConfig: true,
        includePartialMessages: true,
        abortController,
        canUseTool: makeCanUseTool({ approval: this.ctx.approval, agent, isArxaTool: (n) => n.startsWith(MCP_PREFIX) }),
      }),
    })

    turn.bridge = new TurnBridge({
      messages: q,
      pending: fromClaude,
      onSession: (id, model) => agent.session.append('claude-code/session', { claudeSessionId: id, model }),
      onRateLimit: (info) => agent.session.append('claude-code/rate-limit', info),
      onToolUse: (id, name) => {
        claudeIds.add(id)
        if (name.startsWith(MCP_PREFIX)) mcpQueue.push({ id, name: stripMcpPrefix(name) })
      },
    })
    this.turns.set(agent.id, turn)

    // Abort comes from the caller only — there is no watchdog for a child that stays alive but
    // silent. Never race the signal against segment(): abandoning a parked segment() leaves the
    // bridge's waiter slot set and the next segment() throws "already being consumed".
    this.onceAborted(options.signal, () => {
      abortController.abort()
      q.interrupt?.().catch(() => {})
      this.endTurn(agent.id, turn)
    })

    try {
      yield * turn.bridge.segment()
    } catch (err) { this.endTurn(agent.id, turn); throw err }
    if (turn.bridge.finished) this.endTurn(agent.id, turn)
  }

  /** Compaction and session titles: one shot, no tools, no MCP, no resumed session — the
   * transcript of a utility call is arxa's business, not the user's Claude history. */
  async * utility (options, agent) {
    const prompt = options.messages.map((m) => `${m.role}: ${textOf(m)}`).join('\n\n')
    const policy = agent ? this.ctx.sandboxPolicy.resolve({ session: agent.session }) : this.ctx.sandboxPolicy.resolve({})
    const abortController = new AbortController()
    const q = this.query({
      prompt,
      options: this.base(policy, {
        cwd: agent?.session?.header?.cwd ?? process.cwd(),
        model: options.model,
        tools: [],
        maxTurns: 1,
        persistSession: false,
        includePartialMessages: true,
        abortController,
        systemPrompt: { type: 'custom', prompt: options.system ?? 'Answer concisely.' },
      }),
    })
    this.onceAborted(options.signal, () => { abortController.abort(); q.interrupt?.().catch(() => {}) })
    yield * new TurnBridge({ messages: q, onSession: () => {}, onRateLimit: () => {}, onToolUse: () => {} }).segment()
  }
}
