import { strict as assert } from 'node:assert'
import { PROVIDER_STATUS_SCHEMA, applyProviderStatus, formatBadge } from './lib/status.js'
import { appendProviderStatus, PROJECTION } from './lib/index.js'

let n = 0; const ok = (s) => { n++; console.log(`  ok ${s}`) }
const good = { provider: 'claude-code', level: 'warn', text: 'Claude 90%', title: 'weekly limit · max', utilization: 0.9, resetsAt: 1_800_000_000 }
assert.deepEqual(PROVIDER_STATUS_SCHEMA.parse(good), good)
assert.throws(() => PROVIDER_STATUS_SCHEMA.parse({ ...good, level: 'loud' })); ok('schema')

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

// Parity guard: lib/client.js duplicates formatBadge for the browser bundle (no module graph
// into lib/ from a __ModuleLoader__ factory). Extract it from the source and prove it agrees
// with lib/status.js's formatBadge on the same fixtures, so the two never silently diverge.
const clientSrc = await (await import('node:fs/promises')).readFile(new URL('./lib/client.js', import.meta.url), 'utf8')
const relSrc = clientSrc.slice(clientSrc.indexOf('const relative'), clientSrc.indexOf('const COLOR'))
const clientFormatBadge = new Function(`${relSrc} return formatBadge`)()
// title: '' is falsy-but-present — discriminates `??` (host, correct) from `||` (a regression
// the client copy could silently drift to) since only `??` treats '' as a real title.
for (const [value, at] of [[v, now], [{ ...v, level: 'ok' }, now], [null, now], [{ ...v, title: '' }, now]]) {
  assert.deepEqual(clientFormatBadge(value, at), formatBadge(value, at))
}
ok('client formatBadge parity')

console.log(`selftest.provider-status: ${n} ok`)
