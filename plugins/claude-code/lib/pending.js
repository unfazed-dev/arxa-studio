// Promise mailbox keyed by Claude tool_use id. One direction per instance.
export class PendingResults {
  constructor () { this.waiters = new Map(); this.early = new Map() }
  has (id) { return this.waiters.has(id) }
  expect (id, signal) {
    if (this.early.has(id)) { const v = this.early.get(id); this.early.delete(id); return Promise.resolve(v) }
    // Guard an already-aborted signal: addEventListener('abort', …) never fires for a
    // signal that is aborted before it's attached, which would otherwise leave the
    // promise unsettled and a `waiters` entry parked forever.
    if (signal?.aborted) return Promise.reject(new Error(`claude-code: wait for tool ${id} aborted`))
    return new Promise((resolve, reject) => {
      const done = () => { this.waiters.delete(id); signal?.removeEventListener('abort', onAbort) }
      const onAbort = () => { done(); reject(new Error(`claude-code: wait for tool ${id} aborted`)) }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.waiters.set(id, { resolve: (v) => { done(); resolve(v) }, reject: (e) => { done(); reject(e) } })
    })
  }
  // ponytail: a resolve() that arrives after the waiter aborted has nobody left to hand
  // the outcome to, so it parks in `early` like any unclaimed result. `early` has no TTL
  // or eviction of its own — the release valve is clear(), which the caller (Task 9, on
  // turn end/abort) is responsible for invoking; this class has no notion of "turn".
  resolve (id, outcome) { const w = this.waiters.get(id); w ? w.resolve(outcome) : this.early.set(id, outcome) }
  /** Resolve only if someone is waiting; ids nobody asked for (mirror results echoed by the loop) are dropped. */
  resolveIfWaiting (id, outcome) { const w = this.waiters.get(id); if (w) w.resolve(outcome) }
  reject (id, err) { this.waiters.get(id)?.reject(err) }
  /** Drop every unclaimed `early` result and reject every outstanding waiter. Caller-driven
   * reset point (e.g. turn end) — this class doesn't know what a "turn" is. */
  clear () {
    const err = new Error('claude-code: pending results cleared')
    for (const w of [...this.waiters.values()]) w.reject(err)
    this.early.clear()
  }
}
export const fromClaude = new PendingResults() // Claude ran it; the dsh loop's mirror tool waits
export const fromLoop = new PendingResults()   // the dsh loop ran it; Claude's MCP call waits
