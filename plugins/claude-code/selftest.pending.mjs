import { strict as assert } from 'node:assert'
import { PendingResults, fromClaude, fromLoop } from './lib/pending.js'

let passed = 0
const ok = (msg) => { passed++; console.log(`ok ${passed} - ${msg}`) }

const p = new PendingResults()
const wait = p.expect('t1')
assert.equal(p.has('t1'), true)
ok('expect() registers a waiter before resolution arrives')
p.resolve('t1', { text: 'done', isError: false })
assert.deepEqual(await wait, { text: 'done', isError: false })
assert.equal(p.has('t1'), false)
ok('resolve() settles the waiter and clears it from waiters')

p.resolve('early', { text: 'x', isError: false }) // result before anyone waited
assert.deepEqual(await p.expect('early'), { text: 'x', isError: false })
ok('resolve-before-expect is delivered from the early map')

const rej = p.expect('t2'); p.reject('t2', new Error('boom'))
await assert.rejects(rej, /boom/)
ok('reject() rejects the waiter with the given error')

const ac = new AbortController(); const ab = p.expect('t3', ac.signal); ac.abort()
await assert.rejects(ab, /aborted/)
assert.equal(p.has('t3'), false)
ok('abort mid-wait rejects and removes the waiter (no leak)')

const ac2 = new AbortController(); ac2.abort()
await assert.rejects(p.expect('t4', ac2.signal), /aborted/)
assert.equal(p.has('t4'), false)
ok('an already-aborted signal rejects immediately without parking a waiter')

p.resolveIfWaiting('nobody', { text: 'x', isError: false })
assert.equal(p.early.size, 0, 'resolveIfWaiting never parks early results')
ok('resolveIfWaiting drops results nobody asked for (no orphan in early)')

const ac3 = new AbortController()
const aborted = p.expect('t-late', ac3.signal)
ac3.abort()
await assert.rejects(aborted, /aborted/)
p.resolve('t-late', { text: 'arrived late', isError: false }) // nobody's waiting anymore
assert.deepEqual(await p.expect('t-late'), { text: 'arrived late', isError: false })
ok('resolve() after abort parks the outcome in early for a later expect() to claim')

const dup1 = p.expect('dup') // never awaited: superseded below, would hang forever otherwise
const dup2 = p.expect('dup')
p.resolve('dup', { text: 'second caller', isError: false })
assert.deepEqual(await dup2, { text: 'second caller', isError: false })
// "Last expect wins" is only half the claim. Asserting dup2 resolves proves the second waiter
// works; it says nothing about the first. The whole point is that dup1 is STRANDED — the
// resolve went to dup2 only, and dup1 stays pending forever. Race it against a settled promise:
// if dup1 had also been resolved, the race would come back 'dup1'.
const stranded = await Promise.race([dup1.then(() => 'dup1'), Promise.resolve('still-pending')])
assert.equal(stranded, 'still-pending', 'the superseded waiter must stay pending, not resolve too')
ok('a second expect() on the same id replaces the first waiter — and the first stays pending')
dup1.catch(() => {}) // it never settles; keep node from flagging it if that ever changes

assert.ok(fromClaude instanceof PendingResults && fromLoop instanceof PendingResults && fromClaude !== fromLoop)
ok('fromClaude and fromLoop are distinct PendingResults singletons')

const p2 = new PendingResults()
const w1 = p2.expect('t5')
const w2 = p2.expect('t6')
p2.resolve('t7', { text: 'orphan', isError: false }) // parks in early, nobody waited
p2.clear(['t5', 't6', 't7'])
await assert.rejects(w1, /cleared/)
await assert.rejects(w2, /cleared/)
assert.equal(p2.has('t5'), false)
assert.equal(p2.has('t6'), false)
assert.equal(p2.early.has('t7'), false)
ok('clear(ids) rejects the given waiters and drops the given early results, scoped to those ids')

assert.throws(() => p2.clear(), /requires an ids array/)
ok('clear() with no ids throws — a no-arg clear-everything is not a supported overload')

const w8 = p2.expect('t8')
p2.resolve('t8', { text: 'after clear', isError: false })
assert.deepEqual(await w8, { text: 'after clear', isError: false })
ok('clear(ids) round-trip: the object still settles a fresh id normally afterwards')

console.log(`# ${passed} ok`)
