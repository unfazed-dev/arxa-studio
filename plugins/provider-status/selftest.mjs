import { strict as assert } from 'node:assert'
import { ZodError } from 'zod'
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
assert.deepEqual(v, { ...good, at: 123, activeProvider: good.provider })
assert.equal(applyProviderStatus(v, { type: 'provider/status', time: 124, data: { ...good, level: 'zzz' } }), v, 'invalid event leaves state untouched'); ok('fold = latest valid value')

const now = 1_799_990_000 * 1000
assert.deepEqual(formatBadge(v, now), { level: 'warn', text: 'Claude 90% · resets in 2h 46m', title: 'weekly limit · max' })
assert.deepEqual(formatBadge({ ...v, level: 'ok' }, now), { level: 'ok', text: 'Claude 90%', title: 'weekly limit · max' })
assert.equal(formatBadge(null, now), undefined); assert.equal(formatBadge(undefined, now), undefined); ok('badge text')

assert.equal(PROJECTION.key, 'providerStatus'); assert.equal(PROJECTION.init(), null); assert.equal(PROJECTION.stateVersion, 1)
assert.deepEqual(PROJECTION.wire.view(v), v)
// detail's JsonValue is z.lazy, which memoizes its inner schema on first resolution — a schema-level
// .parse() proved it's valid, but dsh-session-projection calls stateSchema.parse/viewSchema.parse on
// the frozen PROJECTION object at runtime. stateSchema and wire.viewSchema are the same schema
// instance here, so this one round-trip proves the lazy schema resolves through both real call shapes,
// not just an ad hoc parse.
const vWithDetail = { ...v, detail: { code: 429 } }
assert.deepEqual(PROJECTION.wire.viewSchema.parse(PROJECTION.wire.view(vWithDetail)), vWithDetail)
assert.deepEqual(PROJECTION.stateSchema.parse(vWithDetail), vWithDetail)
ok('projection definition')

// Fix round 2 (Finding 1a): round 1 only proved detail rejection through the standalone
// PROVIDER_STATUS_SCHEMA.parse — never through PROJECTION.stateSchema.parse / wire.viewSchema.parse,
// which are the parse calls that actually guard the wire. The security claim rests on those, not on
// a schema object nothing in production calls directly.
const badDetailError = { ...v, detail: new Error('boom') }
const badDetailFn = { ...v, detail: () => {} }
assert.throws(() => PROJECTION.stateSchema.parse(badDetailError))
assert.throws(() => PROJECTION.wire.viewSchema.parse(badDetailError))
assert.throws(() => PROJECTION.stateSchema.parse(badDetailFn))
assert.throws(() => PROJECTION.wire.viewSchema.parse(badDetailFn))

// Fix round 2 (Finding 1b): a circular detail (detail.self = detail) has no finite JSON shape.
// Before the rejectCircular fix in lib/status.js, JsonValue's union recursion had no cycle
// detection and blew the call stack with a bare RangeError — which escaped even .safeParse() and
// would have crashed the projection fold on one malformed producer payload. Prove it now rejects
// cleanly (a real ZodError, not a RangeError) through every parse call that sees a `detail`.
const circularDetail = {}; circularDetail.self = circularDetail
// Positive check, not `!(err instanceof RangeError)`: "not a RangeError" would also pass on a
// TypeError, an AssertionError, or anything else the schema might start throwing. A validation
// rejection is only correct if it is an actual ZodError carrying issues.
const rejectsCleanly = (fn) => {
  try { fn(); return false } catch (err) {
    assert.ok(err instanceof ZodError, `must reject as a ZodError, got ${err?.constructor?.name}: ${err?.message}`)
    assert.ok(Array.isArray(err.issues) && err.issues.length > 0, 'the ZodError must carry issues')
    return true
  }
}
assert.ok(rejectsCleanly(() => PROVIDER_STATUS_SCHEMA.parse({ ...good, detail: circularDetail })), 'PROVIDER_STATUS_SCHEMA rejects circular detail cleanly')
assert.ok(rejectsCleanly(() => PROJECTION.stateSchema.parse({ ...v, detail: circularDetail })), 'stateSchema rejects circular detail cleanly')
assert.ok(rejectsCleanly(() => PROJECTION.wire.viewSchema.parse({ ...v, detail: circularDetail })), 'wire.viewSchema rejects circular detail cleanly')
// and the actual producer entry point — the fold itself — must not crash on it either
assert.doesNotThrow(() => applyProviderStatus(v, { type: 'provider/status', time: 126, data: { ...good, detail: circularDetail } }))
assert.equal(
  applyProviderStatus(v, { type: 'provider/status', time: 126, data: { ...good, detail: circularDetail } }), v,
  'invalid (circular) detail leaves state untouched, does not crash the fold',
)
ok('detail rejection proven through the real wire/fold path; circular detail rejects cleanly, not RangeError')

// Depth is the other half of the same crash, and closing cycles did not close it. A deep but
// perfectly ACYCLIC detail has a finite JSON shape, so it sails past the stringify probe, then
// overflows inside JsonValue's union — and that parse runs host-side in applyProviderStatus,
// inside the projection fold and outside the adapter's try/catch. Same dead session as the
// circular case. Nothing produces this today (Claude's detail is flat); one nested array from a
// future producer would.
const deepDetail = (levels) => { let node = { leaf: true }; for (let i = 0; i < levels; i++) node = { nested: node }; return node }
const deepAcyclic = deepDetail(5000)
assert.equal(JSON.stringify(deepAcyclic).length > 0, true, 'the deep detail is acyclic — it serialises fine, which is the whole problem')
assert.ok(rejectsCleanly(() => PROVIDER_STATUS_SCHEMA.parse({ ...good, detail: deepAcyclic })), 'PROVIDER_STATUS_SCHEMA rejects a deep acyclic detail cleanly')
assert.ok(rejectsCleanly(() => PROJECTION.wire.viewSchema.parse({ ...v, detail: deepAcyclic })), 'wire.viewSchema rejects a deep acyclic detail cleanly')
assert.doesNotThrow(() => applyProviderStatus(v, { type: 'provider/status', time: 127, data: { ...good, detail: deepAcyclic } }))
assert.deepEqual(
  applyProviderStatus(v, { type: 'provider/status', time: 127, data: { ...good, detail: deepAcyclic } }), v,
  'a deep acyclic detail leaves state untouched instead of killing the fold',
)
// The limit must not be so tight that an ordinary nested detail is rejected.
assert.deepEqual(PROVIDER_STATUS_SCHEMA.parse({ ...good, detail: deepDetail(8) }).detail, deepDetail(8))
ok('a deep acyclic detail is rejected as data, while an ordinary nested detail still parses')

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

// The reported bug: a Claude usage pill stayed on screen while the user worked in GLM, reading
// as GLM's limit. A status describes one provider's account, so the fold tracks which provider
// each turn is routed to and the badge hides a status belonging to anyone else.
const hdr = (provider) => ({ type: 'request/header', time: 200, data: { header: { config: { provider, model: 'm' } } } })
const cctx = (provider) => ({ type: 'request/context', time: 201, data: { provider, model: 'm', contextWindow: 1 } })
assert.equal(v.activeProvider, 'claude-code', 'a status seeds activeProvider with its own provider — it is live when posted')
assert.notEqual(formatBadge(v, now), undefined, 'visible while claude-code is the routed provider')

const onGlm = applyProviderStatus(v, hdr('zai'))
assert.equal(onGlm.activeProvider, 'zai')
assert.equal(formatBadge(onGlm, now), undefined, 'THE BUG: claude usage must not show while a GLM turn is routed')
assert.deepEqual({ ...onGlm, activeProvider: v.activeProvider }, v, 'hidden, not dropped — the status itself is untouched')

const backOnClaude = applyProviderStatus(onGlm, hdr('claude-code'))
assert.deepEqual(formatBadge(backOnClaude, now), formatBadge(v, now), 'switching back shows the same pill again')
assert.equal(formatBadge(applyProviderStatus(v, cctx('zai')), now), undefined, 'request/context carries the routed provider too')
assert.equal(applyProviderStatus(null, hdr('zai')), null, 'a routed turn with no status folds to nothing, not a bare activeProvider')
// A status posted while another provider is marked active still wins: it is live by construction.
assert.notEqual(formatBadge(applyProviderStatus(onGlm, { type: 'provider/status', time: 202, data: good }), now), undefined)
ok('the badge follows the routed provider, not whichever status was folded last')

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
// onGlm/backOnClaude carry the activeProvider mismatch, so the client copy is held to the
// same provider-visibility rule as the host — the regression this pair exists to catch.
for (const [value, at] of [[v, now], [{ ...v, level: 'ok' }, now], [null, now], [{ ...v, title: '' }, now], [{ ...v, resetsAt: 0 }, now], [minutesOnly, now], [vNoReset, now], [onGlm, now], [backOnClaude, now]]) {
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
