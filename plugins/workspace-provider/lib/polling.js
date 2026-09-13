/**
 * AdaptivePoller (task 13, D35) — the realtime degradation as contract
 * constants: 3 s focused-and-active, 30 s focused-idle, 120 s background,
 * plus an immediate poll after any local write. NOT provider-hintable: the
 * intervals come from contract.POLLING and nowhere else.
 *
 * The clock is injectable so the whole transition table is pinnable without
 * waiting a real 120 s (selftest.polling.mjs).
 */
import { POLLING } from './contract.js'

const DELAYS = { active: POLLING.ACTIVE_MS, idle: POLLING.IDLE_MS, background: POLLING.BACKGROUND_MS }

export class AdaptivePoller {
  constructor ({ poll, activity = 'active', clock = { setTimeout, clearTimeout } } = {}) {
    if (typeof poll !== 'function') throw new Error('AdaptivePoller requires a poll function')
    this.poll = poll
    this.activity = activity
    this.clock = clock
    this.timer = null
    this.running = false
    this.inFlight = false
    this.queued = false
  }

  /** The contract interval for the current activity — the only source. */
  get delay () { return DELAYS[this.activity] }

  schedule () {
    this.clear()
    // `return` so an injected clock can await the tick it fired.
    this.timer = this.clock.setTimeout(() => { this.timer = null; return this.tick() }, this.delay)
  }

  clear () {
    if (this.timer !== null) { this.clock.clearTimeout(this.timer); this.timer = null }
  }

  /**
   * One poll pass, coalescing: a poll requested while one is in flight is
   * queued and runs when the current pass ends (two overlapping list reads
   * racing a write would diff against a stale snapshot and invent events).
   */
  async runOnce () {
    if (this.inFlight) { this.queued = true; return }
    this.inFlight = true
    try {
      do { this.queued = false; await this.poll() } while (this.queued && this.running)
    } catch { /* a failed poll never kills the loop */ } finally {
      this.inFlight = false
    }
  }

  async tick () {
    if (!this.running) return
    await this.runOnce()
    if (this.running) this.schedule()
  }

  start () {
    if (this.running) return
    this.running = true
    this.schedule()
  }

  setActivity (activity) {
    if (!(activity in DELAYS)) throw new Error('activity must be active, idle or background')
    this.activity = activity
    if (this.running) this.schedule()
  }

  /** D35 IMMEDIATE_AFTER_WRITE: poll now, then reschedule at the interval. */
  async notifyWrite () {
    if (!this.running) return
    this.clear()
    await this.runOnce()
    if (this.running) this.schedule()
  }

  stop () {
    this.running = false
    this.clear()
  }
}
