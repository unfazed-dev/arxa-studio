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

assert.ok(fromClaude instanceof PendingResults && fromLoop instanceof PendingResults && fromClaude !== fromLoop)
ok('fromClaude and fromLoop are distinct PendingResults singletons')

console.log(`# ${passed} ok`)
