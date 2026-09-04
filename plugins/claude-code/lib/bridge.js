// Claude Code SDK messages → dsh stream chunks, one dsh step ("segment") at a time.
//
// The child keeps producing messages while the dsh loop is off dispatching the tools of the
// step we just ended, so the bridge PUMPS IN THE BACKGROUND from construction: every message
// is handled for side effects the moment it arrives (tool results → pending, rate limits,
// session id) and queued for segment() to turn into chunks. Reading the iterator only inside
// segment() deadlocks — between two steps nobody drains the stream, so the tool_result Claude
// has already produced never arrives and the mirror tool waiting on it never resolves.
import { fromClaude } from './pending.js'

export const MCP_PREFIX = 'mcp__arxa__'
// Defined here, re-exported by mcp-bridge.js: the other direction would be an import cycle.
export const stripMcpPrefix = (name) => name.startsWith(MCP_PREFIX) ? name.slice(MCP_PREFIX.length) : name

const toolResultText = (block) => typeof block.content === 'string'
  ? block.content
  : (block.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')

export class TurnBridge {
  constructor ({ messages, onSession, onRateLimit, onToolUse = () => {}, pending = fromClaude }) {
    Object.assign(this, { onSession, onRateLimit, onToolUse, pending })
    this.claudeSessionId = undefined
    this.finished = false        // true once a consumer has seen the SDK `result`, or the turn failed
    this.queue = []              // messages the pump has read and segment() has not consumed yet
    this.waiter = undefined      // the parked consumer's resolve(), if one is waiting
    this.failure = undefined     // sticky, so a consumer arriving AFTER the failure still sees it
    this.ended = false           // sticky: the `result` was the last message; nothing more is coming
    this.mcpCallIds = new Set()  // tool_use ids the dsh loop itself runs (their results echo back)
    this.openCalls = new Set()   // mirror-tool ids Claude started and has not reported a result for
    this.pump(messages[Symbol.asyncIterator]())
  }

  // ponytail: the queue is unbounded — the whole point is to never apply backpressure to the
  // child, and one turn's messages are small next to the transcript the loop already holds.
  async pump (iterator) {
    try {
      while (true) {
        const { value: m, done } = await iterator.next()
        if (done) { this.fail(new Error('claude-code: child ended without a result')); return }
        if (m.parent_tool_use_id) continue                       // Task/subagent internals stay inside Claude
        if (m.type === 'system' && m.subtype === 'init') {
          if (m.apiKeySource !== 'none') { this.fail(new Error(`claude-code: an API key is configured (${m.apiKeySource}); arxa uses your Claude subscription only. Unset it and retry.`)); return }
          this.claudeSessionId = m.session_id; this.onSession(m.session_id, m.model); continue
        }
        if (m.type === 'user') { this.resolveToolResults(m); continue }
        if (m.type === 'rate_limit_event') { this.onRateLimit(m.rate_limit_info); continue }
        if (m.type === 'stream_event' && m.event?.type === 'content_block_start' && m.event.content_block?.type === 'tool_use') {
          const { id, name } = m.event.content_block
          this.trackCall(id, name)
          this.onToolUse(id, name)
        }
        // Backstop for a stream without partial messages: the assistant message always
        // precedes its own tool_result, so every id is classified before its echo arrives.
        if (m.type === 'assistant') {
          for (const b of m.message?.content ?? []) if (b.type === 'tool_use') this.trackCall(b.id, b.name)
        }
        this.push(m)
        if (m.type === 'result') { this.close(); return }
      }
    } catch (err) { this.fail(err) }
  }

  trackCall (id, name) { if (name.startsWith(MCP_PREFIX)) this.mcpCallIds.add(id); else this.openCalls.add(id) }

  /** A tool_result normally belongs to a mirror tool the loop is (or will be) waiting on, so it
   * parks in `pending` when it arrives first. The exception is a call the loop ran itself — an
   * MCP-bridged arxa tool — where the SDK echoes back a result nobody awaits; parking that one
   * would leak an entry for the life of the process. */
  resolveToolResults (m) {
    for (const b of Array.isArray(m.message?.content) ? m.message.content : []) {
      if (b.type !== 'tool_result') continue
      const outcome = { text: toolResultText(b), isError: b.is_error === true }
      if (this.mcpCallIds.has(b.tool_use_id)) this.pending.resolveIfWaiting(b.tool_use_id, outcome)
      else { this.openCalls.delete(b.tool_use_id); this.pending.resolve(b.tool_use_id, outcome) }
    }
  }

  /** Once the stream is over, no result is coming for a call still in flight — and the loop is
   * very likely blocked inside a mirror tool awaiting exactly that id, which is a hang no later
   * task can break: Task 9 is stuck inside the loop and never reaches clear(ids). An error
   * outcome settles a mirror tool already waiting AND parks one for a mirror tool that asks a
   * moment later, so both orderings end as a failed tool row instead of a wedged turn. */
  settleOpenCalls (reason) {
    for (const id of this.openCalls) this.pending.resolve(id, { text: reason, isError: true })
    this.openCalls.clear()
  }

  push (m) { this.queue.push(m); this.wake() }
  // `String(err?.message ?? err)` — the same idiom probe.js:59 uses — because the SDK iterator
  // can reject with a non-Error (a string, an object with no `message`). Reading `err.message`
  // straight made `fail` itself throw on exactly the paths that exist to report a failure.
  fail (err) { this.failure = err; this.finished = true; this.settleOpenCalls(String(err?.message ?? err)); this.wake() }
  close () { this.ended = true; this.settleOpenCalls('claude-code: the turn ended before this tool reported a result'); this.wake() }
  wake () { const w = this.waiter; this.waiter = undefined; w?.() }

  /** The next queued message, parking until the pump produces one. Always settles: a failure or
   * a finished stream wakes the parked consumer and throws for consumers arriving afterwards. */
  async next () {
    while (this.queue.length === 0) {
      if (this.failure) throw this.failure
      if (this.ended) throw new Error('claude-code: segment() called after the turn finished')
      // One waiter slot, so throw rather than overwrite it — a second consumer parking here
      // would replace the first's resolve() and strand it forever. This is a deadlock
      // preventer, NOT concurrency detection: it only fires when a second consumer reaches
      // an EMPTY queue while another is parked. Two consumers racing a non-empty queue both
      // shift from it and interleave, and nothing here notices. Single-consumer use is the
      // contract; this guard only stops the one failure mode that would hang silently.
      if (this.waiter) throw new Error('claude-code: segment() is already being consumed')
      await new Promise((r) => { this.waiter = r })
    }
    return this.queue.shift()
  }

  /** One dsh step's worth of chunks. Ends on tool-calls (tool round) or stop (turn done). */
  async * segment () {
    const open = new Map() // sdk block index -> { index, kind, text, id, name, args }
    let nextIndex = 0      // dsh block index restarts at 0: each segment is its own assistant message
    const endChunk = (o) => ({
      type: 'block-end',
      index: o.index,
      block: o.kind === 'tool-call'
        ? { type: 'tool-call', id: o.id, name: o.name, arguments: o.args || '{}' }
        : { type: o.kind, text: o.text },
    })
    // A segment must never end holding a block it opened: the loop would dispatch a tool call
    // whose arguments it never received.
    function * closeOpen () { for (const o of open.values()) yield endChunk(o); open.clear() }

    while (true) {
      const m = await this.next()
      if (m.type === 'stream_event') {
        const e = m.event
        if (e.type === 'content_block_start') {
          const b = e.content_block, index = nextIndex++
          if (b.type === 'text') { open.set(e.index, { index, kind: 'text', text: '' }); yield { type: 'block-start', index, blockType: 'text' } }
          else if (b.type === 'thinking') { open.set(e.index, { index, kind: 'reasoning', text: '' }); yield { type: 'block-start', index, blockType: 'reasoning' } }
          else if (b.type === 'tool_use') {
            const name = stripMcpPrefix(b.name)   // bridged arxa tools dispatch under their dsh name
            open.set(e.index, { index, kind: 'tool-call', id: b.id, name, args: '' })
            yield { type: 'block-start', index, blockType: 'tool-call' }
            yield { type: 'tool-call-delta', index, id: b.id, name, argumentsDelta: '' }
          }
        } else if (e.type === 'content_block_delta') {
          const o = open.get(e.index); if (!o) continue
          const d = e.delta
          if (d.type === 'text_delta') { o.text += d.text; yield { type: 'text-delta', index: o.index, text: d.text } }
          else if (d.type === 'thinking_delta') { const t = d.thinking ?? d.text ?? ''; o.text += t; yield { type: 'reasoning-delta', index: o.index, text: t } }
          else if (d.type === 'input_json_delta') { o.args += d.partial_json; yield { type: 'tool-call-delta', index: o.index, id: o.id, argumentsDelta: d.partial_json } }
        } else if (e.type === 'content_block_stop') {
          const o = open.get(e.index); if (!o) continue
          open.delete(e.index)
          yield endChunk(o)
        }
      } else if (m.type === 'assistant') {
        if ((m.message?.content ?? []).some((b) => b.type === 'tool_use')) {
          yield * closeOpen()
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
          return
        }
      } else if (m.type === 'result') {
        this.finished = true
        if (m.is_error) throw new Error((m.errors ?? []).join('; ') || m.result || `claude-code: ${m.subtype}`)
        yield * closeOpen()
        const u = m.usage ?? {}
        yield { type: 'usage', usage: {
          inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0,
          ...(u.cache_read_input_tokens ? { cacheReadTokens: u.cache_read_input_tokens } : {}),
          ...(u.cache_creation_input_tokens ? { cacheWriteTokens: u.cache_creation_input_tokens } : {}),
        } }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
    }
  }
}
