import { strict as assert } from 'node:assert'
import { rateLimitToStatus } from './lib/rate-limit.js'
import { PROVIDER_STATUS_SCHEMA } from '../provider-status/lib/status.js'

let passed = 0
const ok = (msg) => { passed++; console.log(`ok ${passed} - ${msg}`) }

// No account email or subscription tier ever reaches the status object (constraints.md security
// section: never let an account identifier reach code that ships to the browser). `acct` still
// carries subscriptionType so a future plan-level rate-limit rule has something to read from
// `account`, but nothing here asserts it appears in the output — see the leak test below.
const acct = { subscriptionType: 'max' }

assert.deepEqual(
  rateLimitToStatus({ status: 'allowed_warning', utilization: 0.9, resetsAt: 1_800_000_000, rateLimitType: 'seven_day' }, acct),
  { provider: 'claude-code', level: 'warn', text: 'Claude 90%', title: 'Claude weekly limit · 90% used', utilization: 0.9, resetsAt: 1_800_000_000, detail: { rateLimitType: 'seven_day', status: 'allowed_warning' } },
)
ok('warn level: weekly limit at 90%, no account info in title')

assert.equal(rateLimitToStatus({ status: 'allowed', utilization: 0.2 }, acct).level, 'ok')
assert.equal(rateLimitToStatus({ status: 'allowed', utilization: 0.2 }, acct).text, 'Claude 20%')
ok('ok level: allowed status maps to level ok, text carries percentage')

const lim = rateLimitToStatus({ status: 'rejected', resetsAt: 1_800_000_000, rateLimitType: 'five_hour' }, acct)
assert.equal(lim.level, 'limit'); assert.equal(lim.text, 'Claude limit reached'); assert.match(lim.title, /5-hour window/)
ok('limit level: rejected status, five_hour window named in title')

assert.equal(rateLimitToStatus({ status: 'allowed' }, {}).text, 'Claude')
ok('missing optional fields (no utilization, no rateLimitType, no account): text falls back to "Claude"')

assert.equal(rateLimitToStatus({ status: 'allowed_warning', isUsingOverage: true, rateLimitType: 'overage' }, acct).title, 'Claude usage credits')
ok('overage window labelled, isUsingOverage itself never surfaces (see leak test)')

// resetsAt has no documented unit in sdk.d.ts and cannot be verified against a live SDK from a
// selftest, so rate-limit.js normalises defensively instead of assuming: a seconds-shaped value
// and the same instant expressed in milliseconds must both resolve to the same Unix-seconds
// output. See MS_VS_S_THRESHOLD in lib/rate-limit.js for why 1e11 is a safe boundary.
const secondsForm = rateLimitToStatus({ status: 'allowed', resetsAt: 1_800_000_000 }, acct).resetsAt
const millisForm = rateLimitToStatus({ status: 'allowed', resetsAt: 1_800_000_000_000 }, acct).resetsAt
assert.equal(secondsForm, 1_800_000_000); assert.equal(millisForm, 1_800_000_000)
ok('resetsAt: seconds-shaped and millisecond-shaped values for the same instant normalise identically')

assert.ok(!('resetsAt' in rateLimitToStatus({ status: 'allowed' }, acct)))
ok('resetsAt: absent on the SDK payload stays absent on the output, never synthesised')

// utilization is passed through raw from the SDK and PROVIDER_STATUS_SCHEMA bounds it to [0,1]
// non-NaN. An overage-billing payload can plausibly report utilization > 1 (measured against
// base allocation while overage covers the rest) — that must clamp to a usable pill, not throw.
assert.equal(rateLimitToStatus({ status: 'allowed', utilization: 1.5 }, acct).utilization, 1)
assert.equal(rateLimitToStatus({ status: 'allowed', utilization: -0.5 }, acct).utilization, 0)
assert.ok(!('utilization' in rateLimitToStatus({ status: 'allowed', utilization: NaN }, acct)))
ok('utilization: out-of-range and NaN values clamp to a schema-valid pill instead of passing through raw')

// Every rateLimitType × status × utilization × resetsAt combination must (a) stay inside the
// 80-char text cap the provider/status schema enforces and (b) actually pass
// PROVIDER_STATUS_SCHEMA.parse — the real proof the browser will accept it, not just that the
// JS object looks right. The max reachable text is 'Claude 100%' (11 chars), so a single
// hand-picked boundary case would be theater; the invariant has to hold over the whole matrix
// instead. resetsAt is in the matrix (not just the two dedicated cases above) specifically so
// the schema's `int` requirement is checked against a float seconds-shaped value
// (1_800_000_000.5, e.g. Date.now() / 1000) — toUnixSeconds must round that branch too, or
// PROVIDER_STATUS_SCHEMA.parse throws here. UTILS includes out-of-range and NaN values (not just
// the in-bounds [0,1] samples) specifically so clampUtilization is proven against the whole
// matrix, not just the two dedicated cases above — an in-range-only sample here is exactly the
// shape of gap that hid the resetsAt rounding bug until it shipped.
const TYPES = [undefined, 'five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_overage_included', 'overage']
const STATUSES = ['allowed', 'allowed_warning', 'rejected']
const UTILS = [undefined, 0, 0.2, 0.9, 1, 1.5, -0.5, NaN]
const RESETS_AT = [undefined, 0, 1_800_000_000, 1_800_000_000_000, 1_800_000_000.5]
for (const rateLimitType of TYPES) {
  for (const status of STATUSES) {
    for (const utilization of UTILS) {
      for (const resetsAt of RESETS_AT) {
        const info = {
          status,
          ...(rateLimitType === undefined ? {} : { rateLimitType }),
          ...(utilization === undefined ? {} : { utilization }),
          ...(resetsAt === undefined ? {} : { resetsAt }),
        }
        const result = rateLimitToStatus(info, acct)
        assert.ok(result.text.length <= 80, `text over 80 chars: ${result.text}`)
        PROVIDER_STATUS_SCHEMA.parse(result)
      }
    }
  }
}
ok('every rateLimitType × status × utilization × resetsAt stays ≤ 80 chars and passes PROVIDER_STATUS_SCHEMA')

// Leak test: a hostile/future SDK payload carrying a token, response headers and an account id
// alongside the fields we do read. None of them may reach the output — the allowlist means an
// unnamed field is dropped by construction, not by a denylist a new SDK field could slip past.
const hostile = {
  status: 'allowed_warning', utilization: 0.5, rateLimitType: 'seven_day', isUsingOverage: true,
  authToken: 'FAKE-NOT-A-REAL-TOKEN', responseHeaders: { 'x-api-key': 'FAKE-KEY' }, accountId: 'acct_should_not_leak',
}
const serialized = JSON.stringify(rateLimitToStatus(hostile, acct))
for (const secret of ['FAKE-NOT-A-REAL-TOKEN', 'FAKE-KEY', 'acct_should_not_leak', 'isUsingOverage', 'authToken', 'responseHeaders', 'accountId']) {
  assert.ok(!serialized.includes(secret), `leaked forbidden field: ${secret}`)
}
ok('unlisted SDK fields (token, response headers, account id, isUsingOverage) never reach the output')

console.log(`# ${passed} ok`)
