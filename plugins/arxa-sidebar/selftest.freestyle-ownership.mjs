// Execute the generator's actual no-rider policy against session-store bumps.
// A Freestyle conversation must survive refresh; unrelated startup riders
// must still be cleared after both registries have loaded.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../../scripts/gen-workspace.mjs', import.meta.url), 'utf8')
const start = source.indexOf("  T(3) + 'let liveRefreshTimer = 0;'")
const end = source.indexOf("  T(3) + 'const browserInjected = () => ({'", start)
assert.ok(start > 0 && end > start)
const code = vm.runInNewContext('[' + source.slice(start, end) + ']', { T: () => '' }).join('\n')
let current = 'freestyle-live'
let clears = 0
let orgRefreshes = 0
let freestyleRefreshes = 0
let scheduled
let dispose
let unsubscribed = 0
const listeners = []
const list = { getSnapshot: () => ({ current }), subscribe: fn => { listeners.push(fn); return () => { unsubscribed++ } } }
const orgState = { orgs: [{ sessions: [{ dshSessionId: 'org-live', state: 'open' }] }] }
const freestyleState = { roots: [{ sessions: { active: [{ dshSessionId: 'freestyle-live' }], parked: [{ dshSessionId: 'freestyle-parked' }], archived: [{ dshSessionId: 'freestyle-archived' }] } }] }
const context = vm.createContext({
  Set, Promise,
  orgStore: { get: () => orgState, refresh: async () => { orgRefreshes++ } },
  freestyleStore: { get: () => freestyleState, refresh: async () => { freestyleRefreshes++ } },
  arxaClientSessions: { list, clear: () => { clears++ } },
  ctx: { get: () => ({ list }), effect: fn => { dispose = fn() } },
  window: { setTimeout: fn => { scheduled = fn; return 1 }, clearTimeout: () => { scheduled = null } },
})
vm.runInContext(code, context)
vm.runInContext('enforceNoRiders()', context)
assert.equal(clears, 0, 'active Freestyle conversation remains open')
current = 'freestyle-parked'
vm.runInContext('enforceNoRiders()', context)
assert.equal(clears, 0, 'parked Freestyle conversation remains open for resumption')
current = 'org-live'
vm.runInContext('enforceNoRiders()', context)
assert.equal(clears, 0, 'open organisation conversation remains open')
current = 'unowned'
listeners[0]()
assert.equal(clears, 0, 'a store bump waits for authoritative registry refresh')
await scheduled()
await new Promise(resolve => setImmediate(resolve))
assert.equal(orgRefreshes, 1)
assert.equal(freestyleRefreshes, 1)
assert.equal(clears, 1, 'unowned rider is cleared after both registries refresh')
current = 'freestyle-archived'
vm.runInContext('enforceNoRiders()', context)
assert.equal(clears, 2, 'archived conversation is not treated as an active seat')
dispose()
assert.equal(unsubscribed, 2, 'plugin disposal releases both live subscriptions')
console.log('GREEN Freestyle conversation ownership')
