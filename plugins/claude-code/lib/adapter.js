// The dsh LLM adapter: one Claude Code turn per stream() call, wired to arxa's sandbox,
// approval flow, transcript and tool loop. This is where every other module meets.
//
// The dsh loop calls stream() once per STEP, not once per turn: a step that ends in tool
// calls returns, the loop dispatches them, and the loop calls stream() again with the
// results appended. One Claude child spans all of those steps, so the live TurnBridge is
// parked in `this.turns` between them and the second call resumes it instead of respawning.
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { PROVIDER_ID, PROVIDER_NAME, FABLE_MIN_VERSION, describeModel, versionAtLeast, matchModel, signedOutMessage } from './models.js'
import { TurnBridge, MCP_PREFIX, stripMcpPrefix } from './bridge.js'
import { renderHandoff } from './handoff.js'
import { makeSpawner } from './spawn.js'
import { makeCanUseTool } from './approval.js'
import { createArxaMcpServer } from './mcp-bridge.js'
import { MIRROR_TOOL_NAMES } from './mirror-tools.js'
import { fromClaude, fromLoop } from './pending.js'
import { publishProviderStatus } from '../../provider-status/lib/index.js'
import { rateLimitToStatus } from './rate-limit.js'
import { fetchUsageStatuses } from './usage.js'
import { contextWindowFor } from './models.js'

const textOf = (msg) => (msg?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
const resultText = (block) => (block.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
const isToolResultsOnly = (msg) => msg?.role === 'user' && (msg.content?.length ?? 0) > 0 && msg.content.every((b) => b.type === 'tool-result')
const isFable = (model) => /fable/i.test(String(model))
const familyOf = (model) => String(model).match(/fable|opus|sonnet|haiku/i)?.[0].toLowerCase()

/** The arxa tools Claude will see, under the names it will call them by. Mirror tools are
 * excluded from the MCP server (Claude has the real built-in), so they are excluded here too. */
const arxaMcpToolNames = (schemas) => schemas
  .filter((s) => !MIRROR_TOOL_NAMES.includes(s.name))
  .map((s) => `${MCP_PREFIX}${s.name}`)

export class ClaudeCodeAdapter extends LlmAdapter {
  /** `spawn`/`mkdir` exist only so the selftest can exercise spawnClaudeCodeProcess without
   * touching the real filesystem or starting a process; production leaves them undefined. */
  constructor ({ query, probe, ctx, binary, env, version, spawn, mkdir, publish }) {
    super()
    Object.assign(this, { query, probe, ctx, binary, env, version, spawn, mkdir })
    // Where statuses go. Production hands in the providerStatus SERVICE's publish (index.mjs) so
    // the ring's store is the one the RPC serves, whichever copy of provider-status this file
    // resolved by relative path; the module import stays as the selftest default only.
    this.publish = publish ?? publishProviderStatus
    this.turns = new Map()
    // agent id -> the Claude session to resume. Deliberately in memory and NOT a session event.
    //
    // dsh refuses to load ANY log containing an event type outside its own vocabulary unless the
    // envelope carries `ignorable: true` (dsh-session-persistence assertEventsSupported). Session
    // .append() offers no way to set that flag, and dsh's own note says a registration surface for
    // downstream plugin events is "deferred until such a consumer exists" — so a `claude-code/*`
    // event makes the whole session's history unreadable: the transcript survives on disk but the
    // history RPC refuses it and the conversation renders as "Failed to load history".
    //
    // The cost of holding it here is that an arxa restart forgets the resume id, so the next turn
    // starts a fresh child and replays the conversation as handoff text — the path this adapter
    // already takes for a session another engine ran. Losing a resume degrades one turn; losing
    // the log's readability loses the whole conversation.
    this.claudeSessions = new Map()
  }

  providerInfo () { return { id: PROVIDER_ID, name: PROVIDER_NAME } }

  async listModels () {
    const account = await this.probe.current()
    return account.models.map((m) => ({ provider: PROVIDER_ID, id: m.id, name: m.name, description: describeModel(m, account) }))
  }

  async resolveModel (provider, model) {
    const account = await this.probe.current()
    // matchModel, not `find(m => m.id === model)`: the picker's id and the live SDK id
    // are different strings for the two reasoning models (F12), and a stored selection
    // outlives the probe that produced it. Equality here silently dropped `reasoning`
    // and hid dsh's effort control for signed-in users.
    const row = matchModel(account.models, model) ?? { provider: PROVIDER_ID, id: model, name: model, description: '', efforts: [] }
    const efforts = row.efforts ?? []
    return {
      provider: PROVIDER_ID,
      id: row.id,
      name: row.name,
      description: describeModel(row, account),
      // What dsh's context ring divides by. Learned from the last result's modelUsage when a
      // turn has run on this row, else inferred from the id (`[1m]` = 1M). A flat 200_000 here
      // made the Fable ring read five times too full.
      context: { contextWindow: contextWindowFor(row.id, this.contextWindows?.get(row.id)) },
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

  /** Stop this turn's child and release exactly the pending ids it registered.
   *
   * Stopping the child is not optional. A turn can end with its Claude Code process still running
   * — the user sends a new message while a tool round is parked (the supersede path), or the
   * segment throws — and nothing below us aborts it: dsh's LlmRuntime only forwards
   * `options.signal`, it never creates or aborts one. An orphan child keeps working unread, inside
   * arxa's sandbox, billing the user's own subscription.
   *
   * fromClaude/fromLoop are process-wide singletons shared with every other live session, so a
   * blanket clear would reject their in-flight waits — only this turn's ids are released. clear()
   * is idempotent, so the several callers of this method are safe. */
  endTurn (agentId, turn) {
    // Identity-checked: a late abort from a turn the agent has already moved on from must not
    // evict the record of the turn running now — that would respawn a child mid-conversation.
    if (this.turns.get(agentId) === turn) this.turns.delete(agentId)
    // Stopping the child happens once (an abort handler and a finish can both land here); a child
    // that already exited makes abort/interrupt throw or reject, and releasing the ids matters
    // more than a tidy shutdown, so neither may escape into the caller.
    if (!turn.stopped) {
      turn.stopped = true
      try { turn.abortController?.abort() } catch { /* already torn down */ }
      try { turn.q?.interrupt?.()?.catch?.(() => {}) } catch { /* already exited */ }
    }
    // Releasing ids stays unconditional: it is idempotent, and a later call sweeps entries the
    // bridge re-parked into `early` while shutting down.
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
    if (!account.loggedIn) throw new Error(signedOutMessage(account))
    // Resolve through the SAME matcher resolveModel() uses, so the turn runs on the id
    // whose capabilities we advertised. dsh stores whatever the picker listed, which is
    // the static spelling (`opus`) whenever the list was built from a cold probe — and
    // handing the SDK `opus` while having offered `opus[1m]`'s effort levels means the
    // advertised model and the billed one are not the same row. Falls back to the raw id
    // so an id the probe has never heard of still reaches the CLI, which knows its own aliases.
    const modelId = matchModel(account.models, options.model)?.id ?? options.model
    if (isFable(modelId) && !versionAtLeast(account.version, FABLE_MIN_VERSION)) {
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

    const claudeSessionId = this.claudeSessions.get(agent.id)
    const userText = textOf(last)
    // Starting fresh means Claude has no history of its own, so it needs the story so far as
    // flat text. That is true whether another engine ran this session (no claudeSessionId at
    // all) or a resume was attempted and the binary no longer holds the session — hence a
    // standalone value both paths can reach for.
    const freshPrompt = options.messages.length > 1
      ? `${renderHandoff(options.messages.slice(0, -1))}\n\nUser: ${userText}`
      : userText

    const policy = this.ctx.sandboxPolicy.resolve({ session: agent.session })
    // D5 forbids inheriting arxa's own working directory. `?? process.cwd()` ran the child
    // wherever the controller happened to be started — not the session's workspace, and not
    // what the sandbox is confining. The policy's workspace root is the root the confinement
    // is built from, so it is the only correct fallback; with neither, refuse the turn rather
    // than guess a directory to run someone's tools in.
    const cwd = agent.session.header.cwd ?? policy.workspaceRoot
    if (typeof cwd !== 'string' || cwd.length === 0) {
      throw new Error('claude-code: this session has no workspace root — refusing to run the child in arxa\'s own working directory')
    }
    const schemas = agent.ctx.tools.schemas()
    const mcpQueue = []              // { id, name } per mcp__arxa__* tool_use, oldest first
    const claudeIds = new Set()      // every tool_use id this turn produced (fromClaude side)
    const loopIds = new Set()        // ids an MCP call parked on (fromLoop side)
    const abortController = new AbortController()
    // `abortController` and `q` ride on the record so endTurn can stop the child from any path
    // that reaches it — including the supersede branch, which has no signal of its own.
    const turn = { bridge: undefined, q: undefined, abortController, stopped: false, mcpQueue, claudeIds, loopIds }

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

    // One attempt at starting the child. Called twice at most: once with the recorded Claude
    // session, and — if the binary turns out not to hold it any more — once without.
    const startChild = (resumeId) => {
      const q = this.query({
        prompt: resumeId ? userText : freshPrompt,
        options: this.base(policy, {
        cwd,
        model: modelId,
        // D5: an allowlist of the built-ins arxa mirrors, plus arxa's own tools. `tools` is the
        // SDK's availability knob ("To restrict which tools are available, use the `tools`
        // option instead" — sdk.d.ts on allowedTools, which only auto-APPROVES and would bypass
        // canUseTool). A disallowedTools denylist would fail open on every built-in nobody
        // enumerated; an unlisted tool here is simply unavailable.
        // ponytail: the mcp__arxa__* names are belt-and-braces — if `tools` gates built-ins only
        // they are inert, and if it gates every name they are required. Task 12's live smoke is
        // what tells us which; either way this list cannot let an unmirrored built-in through.
        tools: [...MIRROR_TOOL_NAMES, ...arxaMcpToolNames(schemas)],
        ...(isFable(modelId) ? { fallbackModel: 'opus' } : {}),
        ...(options.reasoningEffort ? { effort: options.reasoningEffort } : {}),
        ...(resumeId ? { resume: resumeId } : {}),
        systemPrompt: { type: 'custom', prompt: options.system ?? '' },
        mcpServers: { arxa: mcp },
        strictMcpConfig: true,
        includePartialMessages: true,
        abortController,
        canUseTool: makeCanUseTool({ approval: this.ctx.approval, agent, isArxaTool: (n) => n.startsWith(MCP_PREFIX) }),
      }),
    })

    turn.q = q
    turn.sawInit = false
    turn.bridge = new TurnBridge({
      messages: q,
      pending: fromClaude,
      onSession: (id, model) => {
        // The child reported a session, so it started. That is what separates "this resume is
        // dead" from any later failure — see the retry below.
        turn.sawInit = true
        this.claudeSessions.set(agent.id, id)
        // Pull the plan's usage while the child is alive. At turn START, not turn end: the child
        // is guaranteed up, there is no race with teardown closing the query, and nothing is added
        // to the latency the user actually feels. Fire-and-forget — see refreshUsage.
        this.refreshUsage(agent, turn)
      },
      // The API's own model stamp — the one witness that is neither the CLI's alias resolution
      // nor the model's word, which a 2026-09-04 session showed is unreliable (sonnet and haiku
      // both answered "I am Opus"). It is NOT appended as a session event: see this.claudeSessions
      // on why a `claude-code/*` event costs the whole log its readability. The mismatch still
      // reaches the user through the provider-status pill below, which is what they asked for.
      onAnswered: (model) => this.noteModelFallback(agent, modelId, model),
      // The result's per-model context window, remembered under the row the turn ran on so the
      // next resolveModel() (dsh re-resolves per turn and re-emits request/context on change)
      // divides the context ring by the real number. Never worth the turn.
      onModelUsage: (model, contextWindow) => { try { this.noteContextWindow(modelId, model, contextWindow) } catch {} },
      // A status update is never worth a user's turn. rateLimitToStatus/appendProviderStatus can
      // still throw on a payload the source-level clamp in rate-limit.js doesn't cover (e.g. a
      // malformed resetsAt) — that .parse() throw would otherwise propagate out of this
      // callback, through TurnBridge's pump(), and out of stream()'s generator, killing the turn
      // at the exact moment the pill was most useful (the user hitting their limit). This is the
      // one place in the plan that deliberately fails open: catch broadly, drop the update.
      onRateLimit: (info) => { try { this.publish(agent.session, rateLimitToStatus(info, account)) } catch {} },
      onToolUse: (id, name) => {
        claudeIds.add(id)
        if (name.startsWith(MCP_PREFIX)) mcpQueue.push({ id, name: stripMcpPrefix(name) })
      },
      })
    }

    startChild(claudeSessionId)
    this.turns.set(agent.id, turn)

    // Abort comes from the caller only — there is no watchdog for a child that stays alive but
    // silent. Never race the signal against segment(): abandoning a parked segment() leaves the
    // bridge's waiter slot set and the next segment() throws "already being consumed".
    // endTurn stops the child, so this is the whole teardown.
    this.onceAborted(options.signal, () => this.endTurn(agent.id, turn))

    let produced = false
    try {
      for await (const chunk of turn.bridge.segment()) { produced = true; yield chunk }
    } catch (err) {
      // A recorded Claude session is not a promise the binary can keep: `~/.claude/projects`
      // may have been cleared, or the transcript may live on another machine. `resume` then
      // fails and the whole turn used to just error. Start over without it instead, handing
      // Claude the conversation as flat text the way a first-turn handoff does.
      //
      // `sawInit` is the discriminator, not the error text. A child that reported its session
      // started fine, so any failure after that is a real one and must surface — only a child
      // that died before saying anything looks like a dead resume. `produced` guards the rest:
      // once chunks have reached the consumer there is no honest way to start again.
      if (claudeSessionId !== undefined && !turn.sawInit && !produced && !turn.stopped) {
        // A child that never reported a session has almost certainly exited already, but
        // close it explicitly so "the retry leaks nothing" is structural, not inferred.
        try { turn.q?.close?.() } catch { /* already gone */ }
        fromClaude.clear([...turn.claudeIds]); fromLoop.clear([...turn.loopIds])
        turn.claudeIds.clear(); turn.loopIds.clear(); turn.mcpQueue.length = 0
        startChild(undefined)
        try {
          yield * turn.bridge.segment()
        } catch (retryErr) { this.endTurn(agent.id, turn); throw retryErr }
        if (turn.bridge.finished) this.endTurn(agent.id, turn)
        return
      }
      this.endTurn(agent.id, turn); throw err
    }
    if (turn.bridge.finished) this.endTurn(agent.id, turn)
  }

  /** D10: a turn answered by a different model FAMILY than the one requested is announced in
   * the status channel — a silent swap is worse than a slow turn. Originally Fable-only
   * (`fallbackModel: 'opus'` is the one deliberate downgrade), it now covers every model:
   * `actual` is the API's canonical stamp (`claude-sonnet-5`), never an alias, so family
   * matching is safe, and a user who doubts the picker gets a pill instead of having to ask
   * the model — the one witness that cannot be trusted. `default` has no family and is
   * skipped. Guarded exactly like onRateLimit: a status update must never kill a turn. */
  noteModelFallback (agent, requested, actual) {
    const want = familyOf(requested); const got = familyOf(actual)
    if (!want || !got || want === got) return
    try {
      this.publish(agent.session, {
        provider: PROVIDER_ID,
        level: 'info',
        text: `Running on ${actual}`,
        title: `asked for ${requested} — Claude Code answered with ${actual}`,
      })
    } catch { /* never worth the turn */ }
  }

  /** Remember a context window the SDK reported on a result, under both the row id the turn
   * ran on (what resolveModel() looks up) and the API's own model stamp (in case a later probe
   * list spells the row that way). Lazily built: the adapter's constructor is not the only
   * place instances are made in the selftests, and a Map that appears on first use is one
   * fewer field for a stand-in to forget. */
  noteContextWindow (modelId, wireModel, contextWindow) {
    if (!Number.isInteger(contextWindow) || contextWindow <= 0) return
    this.contextWindows ??= new Map()
    for (const key of [modelId, wireModel]) if (typeof key === 'string' && key) this.contextWindows.set(key, contextWindow)
  }

  /** Pull the plan's `/usage` windows from the live child and publish one status per limit.
   *
   * This is the PRIMARY source for the usage pill. `rate_limit_event` stays wired below, but it
   * only fires "when rate limit info changes" — a whole Fable turn on a nearly-exhausted account
   * produced none, so a pill fed only by that event shows nothing almost always.
   *
   * Deliberately not awaited: the pill must not add a millisecond to the turn, and a plan-limits
   * lookup that hangs must not hold a conversation open. Every failure ends as no pill. */
  refreshUsage (agent, turn) {
    fetchUsageStatuses(turn.q).then(
      (statuses) => {
        for (const status of statuses) {
          try { this.publish(agent.session, status) } catch { /* one bad window is not the others' problem */ }
        }
      },
      () => {}, // never worth the turn
    )
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
        cwd: agent?.session?.header?.cwd ?? policy.workspaceRoot,
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
