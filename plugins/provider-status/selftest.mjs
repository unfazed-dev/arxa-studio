import { strict as assert } from 'node:assert'
import { ZodError } from 'zod'
import { PROVIDER_STATUS_SCHEMA, STATUS_VALUE_SCHEMA, formatBadge } from './lib/status.js'
import { publishProviderStatus, resetProviderStatus, RPC_CHANNEL, apply } from './lib/index.js'

let n = 0; const ok = (s) => { n++; console.log(`  ok ${s}`) }
const good = { provider: 'claude-code', level: 'warn', text: 'Claude 90%', title: 'weekly limit · max', utilization: 0.9, resetsAt: 1_800_000_000 }
const v = { ...good, at: 123 }
const now = 1_799_990_000 * 1000

assert.deepEqual(PROVIDER_STATUS_SCHEMA.parse(good), good)
assert.throws(() => PROVIDER_STATUS_SCHEMA.parse({ ...good, level: 'loud' })); ok('schema')

// detail: a real JSON-value type, not z.unknown(). `detail` ships verbatim to the browser, so this
// schema IS the security boundary — it stops non-serializable values, raw Error objects, and
// functions. It does not stop a plain string secret; that's valid JSON and stays the producer's job.
assert.doesNotThrow(() => PROVIDER_STATUS_SCHEMA.parse({ ...good, detail: { code: 429, retryable: true, tags: ['rate-limit', null, 3] } }))
assert.throws(() => PROVIDER_STATUS_SCHEMA.parse({ ...good, detail: new Error('boom') }))
assert.throws(() => PROVIDER_STATUS_SCHEMA.parse({ ...good, detail: () => {} })); ok('detail is a JSON-value type, not unknown')

// The wire schema is what the RPC value is parsed by, so the rejection must hold through it too —
// not only through the standalone schema, which nothing on the wire calls directly.
assert.deepEqual(STATUS_VALUE_SCHEMA.parse(v), v)
assert.deepEqual(STATUS_VALUE_SCHEMA.parse(null), null)
assert.throws(() => STATUS_VALUE_SCHEMA.parse({ ...v, detail: new Error('boom') }))
assert.throws(() => STATUS_VALUE_SCHEMA.parse({ ...v, detail: () => {} }))
// detail's JsonValue is z.lazy, which memoizes its inner schema on first resolution; this proves
// it resolves through the real wire call shape, not just an ad hoc parse.
const vWithDetail = { ...v, detail: { code: 429 } }
assert.deepEqual(STATUS_VALUE_SCHEMA.parse(vWithDetail), vWithDetail)
ok('status wire schema round-trips and rejects non-JSON detail')

// A circular detail (detail.self = detail) has no finite JSON shape. Before rejectCircular in
// lib/status.js, JsonValue's union recursion had no cycle detection and blew the call stack with a
// bare RangeError — which escapes even .safeParse(). Prove it rejects cleanly, as a real ZodError.
const circularDetail = {}; circularDetail.self = circularDetail
// Positive check, not `!(err instanceof RangeError)`: "not a RangeError" would also pass on a
// TypeError or anything else. A rejection is only correct if it is an actual ZodError with issues.
const rejectsCleanly = (fn) => {
  try { fn(); return false } catch (err) {
    assert.ok(err instanceof ZodError, `must reject as a ZodError, got ${err?.constructor?.name}: ${err?.message}`)
    assert.ok(Array.isArray(err.issues) && err.issues.length > 0, 'the ZodError must carry issues')
    return true
  }
}
assert.ok(rejectsCleanly(() => PROVIDER_STATUS_SCHEMA.parse({ ...good, detail: circularDetail })))
assert.ok(rejectsCleanly(() => STATUS_VALUE_SCHEMA.parse({ ...v, detail: circularDetail })))
// and the producer entry point must reject it rather than crash
assert.throws(() => publishProviderStatus({ id: 's1' }, { ...good, detail: circularDetail }))
ok('circular detail rejects cleanly as a ZodError, not a RangeError')

// Depth is the other half of the same crash, and closing cycles did not close it. A deep but
// perfectly ACYCLIC detail has a finite JSON shape, sails past the stringify probe, then overflows
// inside JsonValue's union. Nothing produces this today (Claude's detail is flat); one nested
// array from a future producer would.
const deepDetail = (levels) => { let node = { leaf: true }; for (let i = 0; i < levels; i++) node = { nested: node }; return node }
const deepAcyclic = deepDetail(5000)
assert.equal(JSON.stringify(deepAcyclic).length > 0, true, 'the deep detail is acyclic — it serialises fine, which is the whole problem')
assert.ok(rejectsCleanly(() => PROVIDER_STATUS_SCHEMA.parse({ ...good, detail: deepAcyclic })))
assert.ok(rejectsCleanly(() => STATUS_VALUE_SCHEMA.parse({ ...v, detail: deepAcyclic })))
// The limit must not be so tight that an ordinary nested detail is rejected.
assert.deepEqual(PROVIDER_STATUS_SCHEMA.parse({ ...good, detail: deepDetail(8) }).detail, deepDetail(8))
ok('a deep acyclic detail is rejected as data, while an ordinary nested detail still parses')

assert.deepEqual(formatBadge(v, now), { level: 'warn', text: 'Claude 90% · resets in 2h 46m', title: 'weekly limit · max' })
assert.deepEqual(formatBadge({ ...v, level: 'ok' }, now), { level: 'ok', text: 'Claude 90%', title: 'weekly limit · max' })
assert.equal(formatBadge(null, now), undefined); assert.equal(formatBadge(undefined, now), undefined); ok('badge text')

// Staleness: once resetsAt has passed the badge hides rather than freezing on old text. Recomputed
// against `now` on every call, so a reconnect re-renders correctly for free.
assert.equal(formatBadge(v, v.resetsAt * 1000), undefined, 'boundary: exactly at resetsAt counts as stale (<=)')
assert.equal(formatBadge({ ...v, resetsAt: 0 }, now), undefined, 'resetsAt: 0 is stale, not "unset"'); ok('badge hides once stale')

// The reported bug: a Claude usage pill stayed on screen while the user worked in GLM, reading as
// GLM's limit. The badge takes the provider selected RIGHT NOW — in the browser that is the model
// picker's own store, so it reacts to a switch immediately rather than waiting for a turn.
assert.notEqual(formatBadge(v, now, 'claude-code'), undefined, 'visible while claude-code is selected')
assert.equal(formatBadge(v, now, 'zai'), undefined, 'THE BUG: claude usage must not show while GLM is selected')
assert.deepEqual(formatBadge(v, now, 'claude-code'), formatBadge(v, now), 'switching back shows the same pill again')
assert.notEqual(formatBadge(v, now, undefined), undefined, 'no selection known yet -> show it')
ok('the badge follows the selected provider')

// The producer validates and holds in memory. It must NOT append a session event: `provider/status`
// is outside dsh's known vocabulary, and one such event makes the whole conversation unreadable on
// reopen ("Failed to load history"). scripts/session-event-vocabulary-check.mjs is the standing gate.
resetProviderStatus()
const appended = []
const session = { id: 's1', append: (type, data) => { appended.push([type, data]); return { seq: 0 } } }
assert.deepEqual(publishProviderStatus(session, good), good)
assert.deepEqual(appended, [], 'publishing must not write a session event')
assert.throws(() => publishProviderStatus(session, { provider: 'x' }), /text/); ok('producer validates and never appends')

// text is capped at 80 chars; an overlong status is rejected at the producer.
assert.throws(() => PROVIDER_STATUS_SCHEMA.parse({ ...good, text: 'x'.repeat(81) }))
assert.throws(() => publishProviderStatus(session, { ...good, text: 'x'.repeat(81) })); ok('overlong text is rejected')

// --- the RPC surface the browser half calls
{
  let handler; let opts
  const ctx = { inject: (_deps, fn) => fn({ connection: { rpc: { handle: (_ch, h, o) => { handler = h; opts = o } } } }) }
  apply(ctx)
  assert.equal(typeof handler, 'function'); assert.deepEqual(opts, { authority: 'trusted-host' })
  resetProviderStatus()
  assert.deepEqual(await handler('current', { sessionId: 's1' }), { ok: true, value: { status: null } })
  publishProviderStatus({ id: 's1' }, good)
  const got = await handler('current', { sessionId: 's1' })
  assert.equal(got.ok, true); assert.deepEqual({ ...got.value.status, at: 0 }, { ...good, at: 0 })
  // one session's status must never leak into another's badge
  assert.deepEqual(await handler('current', { sessionId: 'other' }), { ok: true, value: { status: null } })
  // the endpoint is an explicit allowlist, not a generic bridge
  assert.equal((await handler('anything-else', { sessionId: 's1' })).ok, false)
  assert.equal((await handler('current', {})).ok, false, 'a missing sessionId is refused, not coerced')
  ok('rpc: one allowlisted verb, per-session isolation, validated payload')
}

// lib/client.js duplicates formatBadge for the browser bundle (no module graph into lib/ from a
// __ModuleLoader__ factory). Extract it and prove it agrees with the host copy, including the
// provider-visibility rule — the regression this pair exists to catch.
const clientSrc = await (await import('node:fs/promises')).readFile(new URL('./lib/client.js', import.meta.url), 'utf8')
const relSrc = clientSrc.slice(clientSrc.indexOf('const relative'), clientSrc.indexOf('const COLOR'))
const clientFormatBadge = new Function(`${relSrc} return formatBadge`)()
for (const [value, at, active] of [
  [v, now, undefined], [{ ...v, level: 'ok' }, now, undefined], [null, now, undefined],
  [{ ...v, title: '' }, now, undefined], [{ ...v, resetsAt: 0 }, now, undefined],
  [{ ...good, at: 1, resetsAt: undefined }, now, undefined],
  [v, now, 'claude-code'], [v, now, 'zai'],
]) {
  assert.deepEqual(clientFormatBadge(value, at, active), formatBadge(value, at, active), `client/host parity for ${JSON.stringify(value)} active=${active}`)
}
assert.equal(RPC_CHANNEL, '/rpc/arxa-provider-status')
assert.ok(clientSrc.includes(RPC_CHANNEL), 'the client calls the channel the host registers')
ok('client formatBadge parity + channel agreement')

console.log(`selftest.provider-status: ${n} ok`)
