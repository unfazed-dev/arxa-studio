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
  // or eviction of its own — the release valve is clear(ids), which the caller (Task 9, on
  // turn end/abort, scoped to the ids it registered this turn) is responsible for invoking;
  // this class has no notion of "turn".
  resolve (id, outcome) { const w = this.waiters.get(id); w ? w.resolve(outcome) : this.early.set(id, outcome) }
  /** Resolve only if someone is waiting; ids nobody asked for (mirror results echoed by the loop) are dropped. */
  resolveIfWaiting (id, outcome) { const w = this.waiters.get(id); if (w) w.resolve(outcome) }
  reject (id, err) { this.waiters.get(id)?.reject(err) }
  /** Reject the outstanding waiter and drop the unclaimed `early` entry for each given id.
   * `ids` is required, not a convenience no-arg overload: fromClaude/fromLoop are module-level
   * singletons shared by every concurrent session in the process (subagent/fork/ralph/workflow
   * presets all run multiple live sessions at once), so a no-arg "clear everything" on one
   * session's turn end would reject every *other* session's in-flight waits too. Task 9 tracks
   * the ids it registered this turn and passes exactly those. */
  clear (ids) {
    if (!ids) throw new Error('claude-code: PendingResults.clear(ids) requires an ids array')
    const err = new Error('claude-code: pending results cleared')
    for (const id of ids) { this.waiters.get(id)?.reject(err); this.early.delete(id) }
  }
}
export const fromClaude = new PendingResults() // Claude ran it; the dsh loop's mirror tool waits
export const fromLoop = new PendingResults()   // the dsh loop ran it; Claude's MCP call waits
