/**
 * Adaptive polling (task 13, D35) — the realtime degradation, as CONTRACT
 * constants, not provider hints. 3 s focused-and-active, 30 s focused-idle,
 * 120 s background, plus an immediate poll after any local write.
 *
 * A manual clock drives the poller so the whole transition table is pinned
 * without waiting a real 120 s.
 *
 * Run: node plugins/workspace-provider/selftest.polling.mjs
 */
import { strict as assert } from 'node:assert'
import { POLLING } from './lib/contract.js'
import { AdaptivePoller } from './lib/polling.js'

let n = 0
const ok = (s) => { n++; console.log('  ok ' + s) }

/** Manual clock: setTimeout records {fn, ms} and hands back an id; fire()
 *  runs one and the poller reschedules against the same clock. */
function manualClock () {
  const timers = new Map()
  let nextId = 1
  return {
    setTimeout: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id },
    clearTimeout: (id) => timers.delete(id),
    pending: () => [...timers.entries()].map(([id, t]) => ({ id, ms: t.ms })),
    // Returns the callback's result: a tick returns a promise whose finally
    // does the reschedule, so callers await fire() before asserting.
    fire: (id) => { const t = timers.get(id); if (!t) throw new Error('no timer ' + id); timers.delete(id); return t.fn() },
    only: () => {
      const p = [...timers.entries()]
      assert.equal(p.length, 1, 'exactly one pending timer, got ' + JSON.stringify(p.map((x) => x[1].ms)))
      return { id: p[0][0], ms: p[0][1].ms }
    },
  }
}

// ---------------------------------------------- 1. the D35 transition table
{
  const clock = manualClock()
  const polls = []
  const poller = new AdaptivePoller({ poll: async () => { polls.push(clock.pending().length) }, clock })
  poller.start()
  assert.equal(clock.only().ms, POLLING.ACTIVE_MS, 'active → 3 s')
  poller.setActivity('idle')
  assert.equal(clock.only().ms, POLLING.IDLE_MS, 'idle → 30 s (rescheduled, one timer)')
  poller.setActivity('background')
  assert.equal(clock.only().ms, POLLING.BACKGROUND_MS, 'background → 120 s')
  poller.setActivity('active')
  assert.equal(clock.only().ms, POLLING.ACTIVE_MS, 'back to active → 3 s')
  poller.stop()
  assert.equal(clock.pending().length, 0, 'stop clears the pending timer')
  ok('transitions: active/idle/background reschedule to the contract constants; stop clears')
}

// ---------------------------------------------- 2. a fired poll reschedules at the CURRENT interval
{
  const clock = manualClock()
  const poller = new AdaptivePoller({ poll: async () => {}, clock })
  poller.start()
  poller.setActivity('idle')
  const t1 = clock.only()
  await clock.fire(t1.id) // the 30 s tick elapses (await: the reschedule rides a microtask)
  assert.equal(clock.only().ms, POLLING.IDLE_MS, 'after a tick the next one is still the current interval')
  poller.stop()
  ok('tick → reschedule at the current activity interval')
}

// ---------------------------------------------- 3. immediate poll after write (D35)
{
  const clock = manualClock()
  const polls = []
  const poller = new AdaptivePoller({ poll: async () => { polls.push(Date.now()) }, clock })
  poller.start()
  assert.equal(polls.length, 0, 'no poll before the first tick')
  await poller.notifyWrite()
  assert.equal(polls.length, 1, 'a write polls IMMEDIATELY, not on the 3 s tick')
  assert.equal(clock.only().ms, POLLING.ACTIVE_MS, 'and the next tick reschedules at the current interval')
  poller.stop()
  ok('notifyWrite: immediate poll + reschedule (IMMEDIATE_AFTER_WRITE)')
}

// ---------------------------------------------- 4. a throwing poll never kills the loop
{
  const clock = manualClock()
  let calls = 0
  const poller = new AdaptivePoller({
    poll: async () => { calls++; if (calls === 1) throw new Error('transient backend hiccup') },
    clock,
  })
  poller.start()
  await poller.notifyWrite() // first poll throws
  await poller.notifyWrite() // second poll runs
  assert.equal(calls, 2, 'the poller survived a rejected poll')
  poller.stop()
  ok('resilience: a rejected poll is swallowed; the loop keeps polling')
}

// ---------------------------------------------- 5. constants, not hints
{
  // The poller must not accept a provider-supplied interval — D35's whole
  // point is that degradation timing is CONTRACT, not negotiable per backend.
  const clock = manualClock()
  const poller = new AdaptivePoller({ poll: async () => {}, clock, intervalMs: 10 })
  poller.start()
  assert.equal(clock.only().ms, POLLING.ACTIVE_MS, 'an injected interval is ignored; the contract constant wins')
  poller.stop()
  ok('provider hints ignored: intervals come from contract.POLLING only')
}

console.log(`workspace-provider polling: ${n} checks green`)
