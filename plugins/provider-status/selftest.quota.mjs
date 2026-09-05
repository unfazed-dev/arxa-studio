// Vendor quota mappers + the read-through poller. None of these three endpoints is documented, so
// the payload fixtures here are the shapes observed live against real accounts, trimmed.
import { strict as assert } from 'node:assert'
import { zaiToStatuses, kimiToStatuses, deepseekToStatuses, brokenStatus, vendorError, PROVIDER_NAME } from './lib/quota.js'
import { createQuotaPoller, VENDORS, READERS, registerUsageReader } from './lib/poller.js'
import { PROVIDER_STATUS_SCHEMA, bindingStatus } from './lib/status.js'

let n = 0; const ok = (s) => { n++; console.log(`  ok ${s}`) }
const byKind = (list) => Object.fromEntries(list.map((s) => [s.kind, s]))
const RESET_MS = 1_800_000_000_000

// ---------------------------------------------------------------- Z.ai
{
  const list = zaiToStatuses({
    data: {
      level: 'max',
      limits: [
        { type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 100, currentValue: 49, remaining: 51, percentage: 49, nextResetTime: RESET_MS },
        { type: 'CREDIT_LIMIT', unit: 6, number: 1, usage: 100, currentValue: 95, remaining: 5, percentage: 95, nextResetTime: RESET_MS },
      ],
    },
  })
  const s = byKind(list)
  assert.equal(list.length, 2, 'both Z.ai windows map')
  // THE FIELD TRAP: `usage` is the TOTAL allowance and `currentValue` is what was consumed, which
  // is the opposite of what both names suggest. Reading `usage` as consumption would report a
  // permanently-maxed account.
  assert.equal(s['hour:5'].utilization, 0.49, 'percentage is CONSUMPTION, not remainder')
  assert.equal(s['hour:5'].text, 'GLM 49%')
  assert.equal(s['hour:5'].title, 'GLM 5-hour window · 49% used')
  assert.equal(s['week:1'].utilization, 0.95)
  assert.equal(s['week:1'].level, 'warn')
  assert.equal(s['hour:5'].resetsAt, RESET_MS / 1000, 'nextResetTime is epoch MILLISECONDS')
  ok('z.ai: consumption, both windows, ms reset')
}
{
  // A row that drops `percentage` still has consumed/total, and losing one field must not blank
  // the ring for the other window.
  const s = byKind(zaiToStatuses({ data: { limits: [
    { unit: 3, number: 5, usage: 200, currentValue: 50, nextResetTime: RESET_MS },
    { unit: 3, number: 5, usage: 0, currentValue: 0 },
  ] } }))
  assert.equal(s['hour:5'].utilization, 0.25, 'falls back to currentValue/usage')
  assert.equal(zaiToStatuses({ data: { limits: [{ unit: 9, number: 2, percentage: 10 }] } })[0].kind, 'unit9:2', 'an unknown unit gets a generic label, not a wrong one')
  ok('z.ai: field fallback and unknown units degrade rather than lie')
}

// ---------------------------------------------------------------- Kimi
{
  const list = kimiToStatuses({
    level: 'LEVEL_STANDARD',
    usage: { detail: { limit: 100, remaining: 8, resetTime: RESET_MS } },
    limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: 100, remaining: 100, resetTime: RESET_MS } }],
  })
  const s = byKind(list)
  // THE REGRESSION THIS FILE EXISTS FOR: `duration: 300, timeUnit: MINUTE` is 300 minutes = FIVE
  // HOURS. Reading it as five minutes (which happened) makes the window look disposable and hides
  // the fact that Kimi runs the same 5-hour + weekly pair as Claude and Z.ai.
  assert.ok(s['hour:5'], '300 MINUTE is a 5-HOUR window, not a 5-minute one')
  assert.equal(s['hour:5'].title, 'Kimi 5-hour window · 0% used')
  // `used` is absent; the remainder is the only evidence of consumption.
  assert.equal(s['week:1'].utilization, 0.92, 'used = limit - remaining when the payload omits used')
  assert.equal(s['week:1'].text, 'Kimi 92%')
  assert.equal(s['hour:5'].resetsAt, RESET_MS / 1000)
  ok('kimi: 300 minutes is five hours, and used is derived from the remainder')
}
{
  // The window labels itself, so one Moonshot adds later needs no arxa release.
  const w = (window) => kimiToStatuses({ limits: [{ window, detail: { limit: 10, used: 1 } }] })[0]
  assert.equal(w({ duration: 30, timeUnit: 'TIME_UNIT_MINUTE' }).kind, 'minute:30', 'a genuine sub-hour window still reads as minutes')
  assert.equal(w({ duration: 7, timeUnit: 'TIME_UNIT_DAY' }).kind, 'week:1', '7 days is the weekly limit, keyed the same as every other weekly')
  assert.equal(w({ duration: 24, timeUnit: 'TIME_UNIT_HOUR' }).kind, 'hour:24')
  assert.equal(w({ duration: 3, timeUnit: 'TIME_UNIT_DAY' }).kind, 'day:3')
  assert.equal(w({}).kind, 'quota', 'an undescribed window is generic, not guessed')
  assert.equal(kimiToStatuses({ limits: [{ window: { duration: 5, timeUnit: 'TIME_UNIT_HOUR' }, detail: { limit: 0, remaining: 0 } }] }).length, 0, 'a zero limit has no fraction and is dropped, not divided by')
  ok('kimi: every window derives its own label from the payload')
}

// ---------------------------------------------------------------- DeepSeek
{
  const list = deepseekToStatuses({ is_available: true, balance_infos: [
    { currency: 'USD', total_balance: '9.56', granted_balance: '0.00', topped_up_balance: '9.56' },
    { currency: 'CNY', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' },
  ] })
  assert.equal(list.length, 1, 'a zero balance in an unfunded currency is noise, not a ring')
  // A BALANCE HAS NO DENOMINATOR. There is no allowance to divide by, so there is no arc — and
  // inventing one (say, against a historical high) would be a fabricated number on screen.
  assert.equal(list[0].utilization, undefined, 'no denominator means no utilization, which is what makes the ring go dashed')
  assert.equal(list[0].text, 'DeepSeek $9.56')
  assert.equal(list[0].level, 'info', 'a balance is information; there is no threshold to warn against')
  assert.equal(list[0].kind, 'balance:USD')
  const spent = deepseekToStatuses({ balance_infos: [{ currency: 'USD', total_balance: '0' }] })
  assert.equal(spent[0].level, 'limit', 'a wallet empty in every currency is the one case that must show')
  assert.deepEqual(deepseekToStatuses({ balance_infos: [] }), [], 'no balances at all is "not configured", not "empty"')
  // Two funded currencies both have `utilization: undefined`, so the fold's tie-break sees 0 vs 0.
  // Which one binds must be the vendor's own order, not chance: the other is still reachable by
  // tapping, but the ring must not swap which currency it opens on between renders.
  const both = deepseekToStatuses({ balance_infos: [
    { currency: 'USD', total_balance: '9.56' }, { currency: 'CNY', total_balance: '42.00' },
  ] })
  assert.deepEqual(both.map((b) => b.kind), ['balance:USD', 'balance:CNY'], 'currency order follows the payload')
  for (let i = 0; i < 5; i++) assert.equal(bindingStatus(both).kind, 'balance:USD', 'the same currency binds every time')
  assert.deepEqual(bindingStatus(both).others.map((o) => o.kind), ['balance:CNY'], 'the other currency stays reachable by tapping')
  ok('deepseek: decimal strings, per-currency, no invented denominator, stable ordering')
}

// ---------------------------------------------------------------- shared guarantees
{
  const every = [
    ...zaiToStatuses({ data: { limits: [{ unit: 3, number: 5, percentage: 49, nextResetTime: RESET_MS }] } }),
    ...kimiToStatuses({ usage: { detail: { limit: 100, remaining: 8 } } }),
    ...deepseekToStatuses({ balance_infos: [{ currency: 'USD', total_balance: '9.56' }] }),
    brokenStatus('zai', 'GLM', 'HTTP 503'),
  ]
  for (const s of every) {
    assert.doesNotThrow(() => PROVIDER_STATUS_SCHEMA.parse(s), `${s.provider}/${s.kind} must satisfy the wire schema`)
    // `detail` ships verbatim to the browser. None of these readers sets it, which is the cheapest
    // possible guarantee that nothing rides along into the client.
    assert.equal('detail' in s, false, `${s.kind} must not set detail`)
  }
  // PROVIDER_NAME is wider than VENDORS on purpose: reader-backed providers (claude-code) have no
  // vendor URL but still need the name their `?` is titled with, so ring and error agree.
  for (const id of Object.keys(VENDORS)) assert.ok(PROVIDER_NAME[id], `vendor ${id} has a display name`)
  assert.equal(PROVIDER_NAME['claude-code'], 'Claude', 'the reader-backed provider is named like its ring')
  for (const id of Object.keys(PROVIDER_NAME)) assert.ok(Object.hasOwn(VENDORS, id) || id === 'claude-code', `${id} is a vendor or a known reader`)
  for (const [id, v] of Object.entries(VENDORS)) {
    assert.ok(v.url.startsWith('https://'), `${id} must be fetched over TLS`)
    assert.equal(v.url.includes('?'), false, `${id}'s URL carries no query string, so nothing can be smuggled into one`)
    // Stands in for dsh's credentialRef(), which the poller deliberately does not import: this is
    // the same POSIX-identifier grammar, checked here so a typo fails a test rather than silently
    // resolving to nothing and leaving a ring mysteriously dark.
    assert.ok(/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.ref), `${id}'s ref must be a valid credential reference name`)
  }
  // The payload is a pnpm isolated layout and this plugin declares no dependencies, so a bare
  // cross-package import resolves by hoisting rather than entitlement — and a load-time throw here
  // takes the whole indicator down, which is exactly the failure mode this feature keeps hitting.
  const pollerSrc = await (await import('node:fs/promises')).readFile(new URL('./lib/poller.js', import.meta.url), 'utf8')
  const imports = [...pollerSrc.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
  assert.deepEqual(imports, ['./quota.js'], 'the poller imports nothing it is not entitled to resolve in the payload')
  ok('every reader emits schema-valid, detail-free statuses over TLS')
}
{
  // A broken read must never outrank a real limit in the fold, or one flaky endpoint would mask a
  // window the user is actually about to hit.
  const real = { provider: 'zai', kind: 'week:1', level: 'warn', text: 'GLM 95%', utilization: 0.95 }
  assert.equal(bindingStatus([brokenStatus('zai', 'GLM', 'HTTP 500'), real]).kind, 'week:1')
  assert.equal(brokenStatus('zai', 'GLM', 'HTTP 500').title.includes('HTTP 500'), true, 'the reason is visible on hover')
  ok('a failed read is visible but never outranks a real limit')
}

// ---------------------------------------------------------------- the poller
const KEY = 'sk-not-a-real-key-000000000000000000'
// `null` for "no such credential" — `undefined` would hit the default parameter and hand back a key.
const creds = (value = KEY) => ({ resolve: async () => (value === null ? undefined : { value, source: 'file' }) })
const zaiBody = { data: { limits: [{ unit: 3, number: 5, percentage: 49, nextResetTime: RESET_MS }] } }
const okRes = (body) => ({ ok: true, status: 200, json: async () => body })

{
  const published = []
  let calls = 0
  const poller = createQuotaPoller({
    credentials: creds(),
    publish: (sessionId, provider, statuses) => published.push([sessionId, provider, statuses]),
    fetchImpl: async () => { calls++; return okRes(zaiBody) },
    now: () => 1000,
  })
  await poller.ensure('s1', 'zai')
  assert.equal(calls, 1)
  assert.equal(published[0][1], 'zai')
  assert.equal(published[0][2][0].text, 'GLM 49%')
  // The idle floor. Keyed by PROVIDER, not session: a Z.ai quota is account-wide, so a
  // session-keyed cache would multiply five minutes by the number of open tabs.
  await poller.ensure('s1', 'zai'); await poller.ensure('s2', 'zai')
  assert.equal(calls, 1, 'a warm cache serves every session without a second fetch')
  // Not in the table -> nothing happens at all. This is what keeps the RPC from being a
  // general-purpose outbound fetch: the provider id IS the allowlist.
  await poller.ensure('s1', 'claude-code')
  await poller.ensure('s1', 'https://evil.example')
  assert.equal(calls, 1, 'an unlisted provider reaches no network')
  ok('poller: one fetch, provider-keyed TTL, id-as-allowlist')
}

{
  // The key must reach the vendor's own Authorization header and nothing else — not a log, not a
  // status field, not a URL.
  let seen
  const published = []
  const poller = createQuotaPoller({
    credentials: creds(),
    publish: (...a) => published.push(a),
    fetchImpl: async (url, init) => { seen = { url, init }; return okRes(zaiBody) },
    now: () => 1000,
  })
  await poller.ensure('s1', 'zai')
  assert.equal(seen.url, VENDORS.zai.url)
  assert.equal(seen.init.headers.Authorization, `Bearer ${KEY}`)
  assert.equal(seen.url.includes(KEY), false, 'the key is never in the URL')
  assert.equal(JSON.stringify(published).includes(KEY), false, 'the key never reaches a published status')
  assert.ok(seen.init.signal, 'every fetch is bounded by an AbortSignal')
  ok('poller: key goes to one header on its own vendor, and nowhere else')
}

{
  // No key is "not configured here", not a failure: no ring at all, and crucially no `?`, which
  // would tell a user something is broken when they simply never set the provider up.
  const published = []
  let calls = 0
  const poller = createQuotaPoller({
    credentials: creds(null),
    publish: (...a) => published.push(a),
    fetchImpl: async () => { calls++; return okRes(zaiBody) },
    now: () => 1000,
  })
  await poller.ensure('s1', 'kimi-coding')
  assert.equal(calls, 0, 'no key means no request')
  assert.deepEqual(published[0][2], [], 'an unconfigured provider publishes nothing, not a broken marker')
  ok('poller: unconfigured stays dark, never shows a false failure')
}

{
  // Breakage is visible and REPLACES what was held. Merging would leave yesterday's number folded
  // in beside the `?`, which is the exact "stale number" the visible-failure rule forbids.
  const published = []
  const poller = createQuotaPoller({
    credentials: creds(),
    publish: (...a) => published.push(a),
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    now: () => 1000,
  })
  await poller.ensure('s1', 'zai')
  assert.equal(published[0][2].length, 1)
  assert.equal(published[0][2][0].text, '?')
  assert.equal(published[0][2][0].title, 'GLM usage unavailable · HTTP 503')
  ok('poller: an HTTP failure publishes one visible marker and nothing else')
}

{
  // Two sessions ask while one read is in flight: BOTH must be published to when it lands. The
  // joiner used to get nothing until the next tick (2026-09-06, the session on screen).
  const published = []
  let release
  const poller = createQuotaPoller({
    credentials: creds(),
    publish: (...a) => published.push(a),
    fetchImpl: () => new Promise((r) => { release = () => r(okRes(zaiBody)) }),
    now: () => 1000,
    coldWaitMs: 10,
  })
  const a = poller.ensure('s1', 'zai')
  const b = poller.ensure('s2', 'zai')
  await Promise.all([a, b])
  assert.equal(published.length, 0, 'nothing lands before the read does')
  release()
  await new Promise((r) => setTimeout(r, 5))
  assert.deepEqual(published.map((p) => p[0]).sort(), ['s1', 's2'], 'the starter AND the joiner are published to')
  assert.equal(published[0][2][0].provider, 'zai')
  ok('poller: a session that joins an in-flight read is published to when it lands')
}

{
  // Z.ai refuses a dead key with HTTP **200** and `success: false`. Observed live: the key in this
  // account went bad mid-session and the endpoint answered
  // `200 {"code":1000,"msg":"Authentication Failed","success":false}`. Reporting that as a shape
  // change would send the user hunting a broken parser when the fix is to re-enter their key.
  const published = []
  const poller = createQuotaPoller({
    credentials: creds(),
    publish: (...a) => published.push(a),
    fetchImpl: async () => okRes({ code: 1000, msg: 'Authentication Failed', success: false }),
    now: () => 1000,
  })
  await poller.ensure('s1', 'zai')
  assert.equal(published[0][2][0].title, 'GLM usage unavailable · Authentication Failed')
  // The message is vendor-controlled text on its way to a tooltip: bounded, printable, and never
  // able to reach the schema's 240-char ceiling and take the whole ring down with a throw.
  const wild = vendorError({ success: false, msg: `${'bad '.repeat(40)}` })
  assert.ok(wild.length <= 41 && /^[\x20-\x7E]*…?$/.test(wild), 'a hostile message is stripped and cut short')
  assert.doesNotThrow(() => PROVIDER_STATUS_SCHEMA.parse(brokenStatus('zai', 'GLM', wild)))
  assert.equal(vendorError({ success: false }), 'refused', 'a refusal with no message still reads as a refusal')
  assert.equal(vendorError({ error: { message: 'Insufficient balance' } }), 'Insufficient balance')
  // A healthy payload must not be mistaken for an error, or every good read would render `?`.
  assert.equal(vendorError(zaiBody), undefined)
  assert.equal(vendorError({ balance_infos: [] }), undefined)
  ok('a vendor error inside HTTP 200 is relayed in the vendor\'s own words, bounded')
}

{
  // A vendor that answers but with a shape we no longer understand is NOT the same as an
  // unconfigured provider — showing nothing would be indistinguishable from "never set up".
  const published = []
  const poller = createQuotaPoller({
    credentials: creds(),
    publish: (...a) => published.push(a),
    fetchImpl: async () => okRes({ something: 'else entirely' }),
    now: () => 1000,
  })
  await poller.ensure('s1', 'zai')
  assert.equal(published[0][2][0].title.includes('unrecognised response'), true)
  ok('poller: a moved payload shape is reported, not silently blank')
}

{
  // A hanging endpoint must not hold the RPC. First call is cold and waits a bounded moment; once
  // anything has been seen, later calls return immediately and refresh in the background.
  let release
  let calls = 0
  let clock = 1_000_000
  const published = []
  const poller = createQuotaPoller({
    credentials: creds(),
    publish: (...a) => published.push(a),
    fetchImpl: async () => { calls++; if (calls === 1) return okRes(zaiBody); return new Promise((r) => { release = () => r(okRes(zaiBody)) }) },
    now: () => clock,
    coldWaitMs: 50,
  })
  await poller.ensure('s1', 'zai')
  assert.equal(calls, 1)
  clock += 10 * 60_000                        // past the TTL, so the next read is stale
  const startedAt = Date.now()
  await poller.ensure('s1', 'zai')            // stale, and this fetch will hang forever
  assert.ok(Date.now() - startedAt < 40, 'a stale refresh is fire-and-forget: the RPC never waits on it')
  await poller.ensure('s1', 'zai')
  await poller.ensure('s2', 'zai')
  assert.equal(calls, 2, 'racing ticks coalesce onto the one in-flight request')
  assert.equal(published.length, 1, 'the hung refresh has published nothing, and the held status is what answers')
  release()
  ok('poller: warm and stale reads never await; concurrent ticks coalesce')
}

{
  // Cold, and the vendor hangs: bounded wait, then answer with whatever is held rather than
  // leaving the composer empty for a minute.
  const poller = createQuotaPoller({
    credentials: creds(),
    publish: () => {},
    fetchImpl: () => new Promise(() => {}),
    now: () => Date.now(),
    coldWaitMs: 60,
  })
  const startedAt = Date.now()
  await poller.ensure('s1', 'zai')
  const waited = Date.now() - startedAt
  assert.ok(waited >= 50 && waited < 400, `a cold hang is bounded (waited ${waited}ms)`)
  ok('poller: a cold hang is bounded, not indefinite')
}

{
  // The reset clamp: a window that resets in 40s pulls the next read in, so the ring is right
  // seconds after a limit clears instead of up to five minutes later.
  let calls = 0
  // A REAL millisecond epoch, not a small round number: toUnixSeconds tells ms from seconds by
  // magnitude, so a toy clock would be read as seconds and park the reset in the year 58000.
  let clock = RESET_MS
  const soon = Math.round((clock + 40_000) / 1000)
  const poller = createQuotaPoller({
    credentials: creds(),
    publish: () => {},
    fetchImpl: async () => { calls++; return okRes({ data: { limits: [{ unit: 3, number: 5, percentage: 99, nextResetTime: soon * 1000 }] } }) },
    now: () => clock,
  })
  await poller.ensure('s1', 'zai')
  clock += 45_000
  await poller.ensure('s1', 'zai')
  // Still floored: 45s in, the 30s minimum has passed but the clamp landed at reset+2s = 42s.
  assert.equal(calls, 2, 'the next read is pulled in to just after the window resets')
  ok('poller: cache expiry clamps to the next reset, floored so it cannot spin')
}

{
  // Registered readers: the providers arxa DOES own the request path for (Claude). The poller
  // consults them before the vendor table, through the same cache, and never touches fetch.
  const claude = (kind, utilization) => ({
    provider: 'claude-code', kind, level: 'ok', text: `Claude ${utilization}%`, utilization: utilization / 100, resetsAt: 1_000_000,
  })
  const readers = new Map()
  let reads = 0, fetches = 0
  readers.set('claude-code', async () => { reads++; return { statuses: [claude('five_hour', 25), claude('seven_day', 60)], configured: true } })
  const published = []
  const poller = createQuotaPoller({
    credentials: creds(null),
    publish: (sessionId, provider, statuses) => published.push([sessionId, provider, statuses]),
    fetchImpl: async () => { fetches++; return okRes(zaiBody) },
    now: () => 1000,
    readers,
  })
  await poller.ensure('s1', 'claude-code')
  assert.equal(reads, 1); assert.equal(fetches, 0, 'a reader never goes through fetch')
  assert.deepEqual(published[0].slice(0, 2), ['s1', 'claude-code'])
  assert.deepEqual(published[0][2].map((s) => s.text), ['Claude 25%', 'Claude 60%'])
  await poller.ensure('s2', 'claude-code')
  assert.equal(reads, 1, 'the reader is behind the same provider-keyed TTL')
  ok('poller: a registered reader feeds the ring without a turn, through the same cache')

  // A reader that throws is "reachable but failed": the `?`, replacing whatever was held.
  readers.set('claude-code', async () => { throw new Error('child died') })
  poller.reset(); published.length = 0
  await poller.ensure('s1', 'claude-code')
  assert.equal(published[0][2].length, 1)
  assert.equal(published[0][2][0].text, '?')
  assert.equal(published[0][2][0].kind, 'unavailable')
  assert.match(published[0][2][0].title, /^Claude usage unavailable · unreachable$/)
  ok('poller: a throwing reader renders as ? (unreachable), named like its ring')

  // `configured: false` (signed out) is "no account here": nothing published but an empty set,
  // so a ring from a previous sign-in disappears rather than lingering.
  readers.set('claude-code', async () => ({ statuses: [], configured: false }))
  poller.reset(); published.length = 0
  await poller.ensure('s1', 'claude-code')
  assert.deepEqual(published, [['s1', 'claude-code', []]])
  ok('poller: a not-configured reader clears the ring, no ?')

  // An empty-but-configured answer is a shape change: say so, do not show nothing.
  readers.set('claude-code', async () => ({ statuses: [] }))
  poller.reset(); published.length = 0
  await poller.ensure('s1', 'claude-code')
  assert.equal(published[0][2][0].text, '?')
  assert.match(published[0][2][0].title, /unrecognised response/)
  ok('poller: an empty configured read reports unrecognised response')

  // The module-level registry is what plugins use; it must validate its arguments, and the
  // default poller must see a registration made before it was constructed.
  assert.throws(() => registerUsageReader('claude-code', 'nope'), TypeError)
  assert.throws(() => registerUsageReader(42, () => {}), TypeError)
  registerUsageReader('claude-code', async () => ({ statuses: [claude('five_hour', 5)], configured: true }))
  assert.ok(READERS.has('claude-code'))
  const dflt = createQuotaPoller({ credentials: creds(null), publish: (...a) => published.push(a), fetchImpl: async () => { fetches++ }, now: () => 1000 })
  published.length = 0
  await dflt.ensure('s9', 'claude-code')
  assert.equal(published[0][2][0].text, 'Claude 5%'); assert.equal(fetches, 0)
  READERS.delete('claude-code')
  ok('poller: registerUsageReader validates and reaches the default poller')
}

{
  // The browser's common case is NO provider: model-selection resolves the session's directory
  // after the composer mounts. 2026-09-06: the RPC skipped `ensure` on that path, so no real
  // session ever triggered a fetch and the ring stayed blank. `ensureAny` must warm every
  // answerable provider in one call and be served from the cache on the next.
  const published = []
  let calls = 0
  const poller = createQuotaPoller({
    credentials: creds(),
    publish: (sessionId, provider, statuses) => published.push([sessionId, provider, statuses]),
    fetchImpl: async () => { calls++; return okRes(zaiBody) },
    now: () => 1000,
    readers: new Map(), // isolate from the module-level READERS other tests register into
  })
  assert.equal(typeof poller.ensureAny, 'function', 'poller exposes ensureAny for the no-provider RPC path')
  await poller.ensureAny('s1')
  assert.ok(published.some(([, p]) => p === 'zai'), 'ensureAny warms the configured vendor without being told which')
  assert.ok(calls >= 1, 'ensureAny reaches the network on a cold cache')
  const after = calls
  await poller.ensureAny('s1'); await poller.ensureAny('s2')
  assert.equal(calls, after, 'a warm cache serves every session without a second fetch')
  assert.ok(published.some(([s, p]) => s === 's2' && p === 'zai'), 'a new session is handed the held statuses')
  ok('poller: ensureAny warms every answerable provider when the browser sends none')
}

console.log(`selftest.quota: ${n} ok`)
