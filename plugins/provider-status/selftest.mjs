import { strict as assert } from 'node:assert'
import { PROVIDER_STATUS_SCHEMA, applyProviderStatus, formatBadge } from './lib/status.js'
import { appendProviderStatus, PROJECTION } from './lib/index.js'

let n = 0; const ok = (s) => { n++; console.log(`  ok ${s}`) }
const good = { provider: 'claude-code', level: 'warn', text: 'Claude 90%', title: 'weekly limit · max', utilization: 0.9, resetsAt: 1_800_000_000 }
assert.deepEqual(PROVIDER_STATUS_SCHEMA.parse(good), good)
assert.throws(() => PROVIDER_STATUS_SCHEMA.parse({ ...good, level: 'loud' })); ok('schema')

// detail (Finding 1): a real JSON-value type, not z.unknown(). The wire view is identity, so
// this schema IS the security boundary for what reaches the browser — it stops non-serializable
// values, raw Error objects, and functions. It does not stop a plain string secret; that's still
// valid JSON and stays the producer's responsibility.
assert.doesNotThrow(() => PROVIDER_STATUS_SCHEMA.parse({ ...good, detail: { code: 429, retryable: true, tags: ['rate-limit', null, 3] } }))
assert.throws(() => PROVIDER_STATUS_SCHEMA.parse({ ...good, detail: new Error('boom') }))
assert.throws(() => PROVIDER_STATUS_SCHEMA.parse({ ...good, detail: () => {} })); ok('detail is a JSON-value type, not unknown')

assert.equal(applyProviderStatus(null, { type: 'turn/start', time: 1, data: {} }), null)
const v = applyProviderStatus(null, { type: 'provider/status', time: 123, data: good })
assert.deepEqual(v, { ...good, at: 123 })
assert.equal(applyProviderStatus(v, { type: 'provider/status', time: 124, data: { ...good, level: 'zzz' } }), v, 'invalid event leaves state untouched'); ok('fold = latest valid value')

const now = 1_799_990_000 * 1000
assert.deepEqual(formatBadge(v, now), { level: 'warn', text: 'Claude 90% · resets in 2h 46m', title: 'weekly limit · max' })
assert.deepEqual(formatBadge({ ...v, level: 'ok' }, now), { level: 'ok', text: 'Claude 90%', title: 'weekly limit · max' })
assert.equal(formatBadge(null, now), undefined); assert.equal(formatBadge(undefined, now), undefined); ok('badge text')

assert.equal(PROJECTION.key, 'providerStatus'); assert.equal(PROJECTION.init(), null); assert.equal(PROJECTION.stateVersion, 1)
assert.deepEqual(PROJECTION.wire.view(v), v); ok('projection definition')

const appended = []
const session = { append: (type, data) => { appended.push([type, data]); return { seq: 0 } } }
appendProviderStatus(session, good)
assert.deepEqual(appended, [['provider/status', good]])
assert.throws(() => appendProviderStatus(session, { provider: 'x' }), /text/); ok('producer helper validates')

// text is capped at 80 chars (schema); an overlong event is invalid and the fold leaves state untouched.
const overlong = { ...good, text: 'x'.repeat(81) }
assert.throws(() => PROVIDER_STATUS_SCHEMA.parse(overlong))
assert.equal(applyProviderStatus(v, { type: 'provider/status', time: 125, data: overlong }), v, 'overlong text leaves state untouched'); ok('text length cap enforced')

// Staleness (Finding 4): once resetsAt has passed, the badge hides rather than freezing on old
// text. Recomputed fresh against `now` on every call, so replay/reconnect is correct for free —
// this lives in formatBadge, not the fold, because the fold must stay deterministic for replay.
assert.equal(formatBadge(v, v.resetsAt * 1000), undefined, 'boundary: exactly at resetsAt counts as stale (<=)')
assert.notEqual(formatBadge(v, v.resetsAt * 1000 - 1000), undefined, 'one second before resetsAt: still shown')
// resetsAt: 0 is the load-bearing fixture: it must be treated as "already reset" (stale), not as
// "no resetsAt set" — that only holds if the check is `!== undefined`, not a truthy check (0 is
// falsy). A truthy-checked version of this guard would wrongly fall through to showing the badge.
assert.equal(formatBadge({ ...v, resetsAt: 0 }, now), undefined, 'resetsAt: 0 is stale, not "unset"'); ok('badge hides once stale')

// Parity guard: lib/client.js duplicates formatBadge for the browser bundle (no module graph
// into lib/ from a __ModuleLoader__ factory). Extract it from the source and prove it agrees
// with lib/status.js's formatBadge on the same fixtures, so the two never silently diverge.
const clientSrc = await (await import('node:fs/promises')).readFile(new URL('./lib/client.js', import.meta.url), 'utf8')
const relSrc = clientSrc.slice(clientSrc.indexOf('const relative'), clientSrc.indexOf('const COLOR'))
const clientFormatBadge = new Function(`${relSrc} return formatBadge`)()
// title: '' is falsy-but-present — discriminates `??` (host, correct) from `||` (a regression
// the client copy could silently drift to) since only `??` treats '' as a real title.
// resetsAt: 0 proves client and host agree the badge is stale-hidden, not just that they agree
// on reset text. minutesOnly exercises the h === 0 branch of `relative` (all other fixtures land
// in h > 0). vNoReset covers resetsAt absent entirely (distinct from resetsAt: 0).
const minutesOnly = { ...v, resetsAt: Math.floor(now / 1000) + 300 } // 5m out, not stale
const { resetsAt: _drop, ...vNoReset } = v
for (const [value, at] of [[v, now], [{ ...v, level: 'ok' }, now], [null, now], [{ ...v, title: '' }, now], [{ ...v, resetsAt: 0 }, now], [minutesOnly, now], [vNoReset, now]]) {
  assert.deepEqual(clientFormatBadge(value, at), formatBadge(value, at))
}
ok('client formatBadge parity')

// Slot registration (Finding 3): ctx.slots.inject/register are silent no-ops if the slot name or
// callback shape is wrong — nothing else in the app throws, so a plain boot proof can't catch it.
// Run the real __ModuleLoader__.load(...) call through a fake `window` that just captures the
// factory (no manual slicing/reconstruction of the file), then call the captured factory to get
// the real exports and assert apply(ctx) wires the exact slot the composer row depends on.
let capturedFactory
const fakeWindow = { __ModuleLoader__: { load: ({ factory }) => { capturedFactory = factory } } }
new Function('window', clientSrc)(fakeWindow)
const fakeRequire = (id) => {
  if (id === 'react') return { createElement: () => {}, useState: () => [0, () => {}], useEffect: () => {} }
  throw new Error(`unexpected require(${id})`)
}
const clientExports = capturedFactory(fakeRequire)
assert.deepEqual(clientExports.inject, ['slots'])

let injectedSlotName, registeredOpts, registeredComponent
const fakeCtx = {
  slots: {
    inject: (slotName, cb) => { injectedSlotName = slotName; cb() },
    register: (opts, component) => { registeredOpts = opts; registeredComponent = component },
  },
}
clientExports.apply(fakeCtx)
assert.equal(injectedSlotName, 'conversation.input.right')
assert.deepEqual(registeredOpts, { name: 'conversation.input.right', id: 'arxa-provider-status', order: 20 })
assert.equal(typeof registeredComponent, 'function'); ok('slot registration wiring')

console.log(`selftest.provider-status: ${n} ok`)
