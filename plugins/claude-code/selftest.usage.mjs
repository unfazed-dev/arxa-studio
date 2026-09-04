import { strict as assert } from 'node:assert'
import { usageToStatuses, fetchUsageStatuses } from './lib/usage.js'
import { PROVIDER_STATUS_SCHEMA } from '../provider-status/lib/status.js'

let n = 0; const ok = (s) => { n++; console.log(`  ok ${s}`) }

const RESETS = '2027-01-02T03:04:05.000Z'
const RESETS_UNIX = Math.round(Date.parse(RESETS) / 1000)
const res = (rate_limits, extra = {}) => ({ rate_limits_available: true, rate_limits, ...extra })
const byKind = (list) => Object.fromEntries(list.map((s) => [s.kind, s]))

// --- the unit bug the SDK sets up for you: this endpoint reports 0-100, the event path reports a
// fraction, and PROVIDER_STATUS_SCHEMA takes 0-1. Passing 90 straight through clamps to 1.0, and
// an account with 10% left renders "Claude limit reached".
{
  const s = byKind(usageToStatuses(res({ seven_day: { utilization: 90, resets_at: RESETS } })))
  assert.equal(s.seven_day.utilization, 0.9, 'THE UNIT BUG: 90 percent is 0.9, not clamped 1.0')
  assert.equal(s.seven_day.text, 'Claude 90%')
  assert.equal(s.seven_day.level, 'warn')
  assert.equal(s.seven_day.resetsAt, RESETS_UNIX, 'resets_at is an ISO string here, not an epoch number')
  ok('percentages become fractions and ISO timestamps become unix seconds')
}

// --- levels come from the number, since this endpoint carries no status field
{
  const at = (u) => usageToStatuses(res({ seven_day: { utilization: u, resets_at: null } }))[0]
  assert.equal(at(0).level, 'ok'); assert.equal(at(79).level, 'ok')
  assert.equal(at(80).level, 'warn'); assert.equal(at(99).level, 'warn')
  assert.equal(at(100).level, 'limit')
  assert.equal(at(100).text, 'Claude limit reached')
  assert.equal(at(50).resetsAt, undefined, 'a null window has no reset time, rather than epoch 0')
  ok('level derives from utilization; a null resets_at is absent, not zero')
}

// --- THE POINT OF THIS MODULE: the per-model bucket, labelled by the server.
// arxa must never guess whether the premium bucket is called Opus or Fable — the plan says so.
{
  const list = usageToStatuses(res({
    seven_day: { utilization: 40, resets_at: RESETS },
    model_scoped: [{ display_name: 'Fable', utilization: 96, resets_at: RESETS }],
  }))
  assert.equal(list.length, 2, 'both limits are reported, not just one')
  const s = byKind(list)
  const fable = s['model_scoped:fable']
  assert.ok(fable, 'the per-model bucket gets its own kind, so it cannot overwrite the weekly one')
  assert.equal(fable.text, 'Fable 96%', "the pill uses the plan's own name for the bucket")
  assert.equal(fable.title, 'Claude weekly Fable limit · 96% used')
  assert.equal(fable.level, 'warn')
  assert.equal(s.seven_day.text, 'Claude 40%')
  ok('the per-model bucket is labelled by the server, and keyed apart from the weekly limit')
}

// A rename upstream must reach the user without an arxa release.
{
  const s = usageToStatuses(res({ model_scoped: [{ display_name: 'Opus', utilization: 10, resets_at: null }] }))[0]
  assert.equal(s.kind, 'model_scoped:opus'); assert.equal(s.text, 'Opus 10%')
  ok('a bucket rename upstream needs no arxa change')
}

// --- API-key / Bedrock / Vertex sessions: plan limits do not apply, so the honest pill is none.
assert.deepEqual(usageToStatuses(res({ seven_day: { utilization: 50, resets_at: null } }, { rate_limits_available: false })), [])
assert.deepEqual(usageToStatuses({ rate_limits_available: true, rate_limits: null }), [])
ok('no pill when plan limits do not apply')

// --- a malformed or hostile payload must yield [] or valid statuses, never a throw
for (const bad of [undefined, null, {}, 'nope', 42, { rate_limits_available: true }, res(null), res('x'), res([]),
  res({ seven_day: null }), res({ seven_day: { utilization: 'lots' } }), res({ seven_day: { utilization: NaN } }),
  res({ model_scoped: 'not-an-array' }), res({ model_scoped: [null, 7, {}] })]) {
  const out = usageToStatuses(bad)
  assert.ok(Array.isArray(out), `must return an array for ${JSON.stringify(bad)}`)
  for (const s of out) assert.doesNotThrow(() => PROVIDER_STATUS_SCHEMA.parse(s))
}
ok('a malformed payload yields an array, never a throw')

// --- server text is bounded before it reaches a schema that throws above 80 chars. A throw here
// would cost the whole pill, so an absurd display_name must degrade to a short label.
{
  const s = usageToStatuses(res({ model_scoped: [{ display_name: 'F'.repeat(500), utilization: 50, resets_at: null }] }))[0]
  assert.doesNotThrow(() => PROVIDER_STATUS_SCHEMA.parse(s), 'an overlong server label must not be able to kill the pill')
  assert.ok(s.text.length <= 80 && s.title.length <= 240)
  const blank = usageToStatuses(res({ model_scoped: [{ display_name: '   ', utilization: 50, resets_at: null }] }))[0]
  assert.equal(blank.text, 'model 50%', 'a blank server label falls back rather than rendering " 50%"')
  ok('server-supplied labels are bounded and never reach the schema overlong')
}

// --- every window shape the endpoint documents maps, and each passes the wire schema
{
  const list = usageToStatuses(res({
    five_hour: { utilization: 12, resets_at: RESETS },
    seven_day: { utilization: 34, resets_at: RESETS },
    seven_day_opus: { utilization: 56, resets_at: RESETS },
    seven_day_sonnet: { utilization: 78, resets_at: RESETS },
    seven_day_oauth_apps: { utilization: 90, resets_at: RESETS },
    model_scoped: [{ display_name: 'Fable', utilization: 99, resets_at: RESETS }],
  }))
  assert.equal(list.length, 6)
  assert.equal(new Set(list.map((s) => s.kind)).size, 6, 'every window needs its own kind or they overwrite each other in the store')
  for (const s of list) assert.doesNotThrow(() => PROVIDER_STATUS_SCHEMA.parse(s), `${s.kind} must satisfy the wire schema`)
  ok('all six documented windows map to distinct, schema-valid statuses')
}

// --- no field but the allowlisted ones may reach the browser
{
  const s = usageToStatuses(res({
    seven_day: { utilization: 50, resets_at: RESETS, oauth_token: 'sk-secret', account_email: 'a@b.c' },
  }, { subscription_type: 'max', behaviors: { day: { request_count: 9 } } }))[0]
  const serialised = JSON.stringify(s)
  for (const leak of ['sk-secret', 'a@b.c', 'request_count', 'subscription_type', 'oauth']) {
    assert.equal(serialised.includes(leak), false, `${leak} must never reach the status`)
  }
  assert.deepEqual(Object.keys(s).sort(), ['kind', 'level', 'provider', 'resetsAt', 'text', 'title', 'utilization'])
  ok('unlisted response fields never reach the output')
}

// --- feature detection: the SDK says the method name WILL change on stabilisation
{
  const payload = res({ seven_day: { utilization: 25, resets_at: null } })
  const experimental = { usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => payload }
  assert.equal((await fetchUsageStatuses(experimental))[0].text, 'Claude 25%')
  // the stabilised name the docs promise
  assert.equal((await fetchUsageStatuses({ usage: async () => payload }))[0].text, 'Claude 25%')
  // an older or newer CLI without either: no pill, no crash — the rate_limit_event path stays wired
  assert.deepEqual(await fetchUsageStatuses({}), [])
  assert.deepEqual(await fetchUsageStatuses(undefined), [])
  assert.deepEqual(await fetchUsageStatuses({ usage: 'not-a-function' }), [])
  // a failing call is never worth the turn
  assert.deepEqual(await fetchUsageStatuses({ usage: async () => { throw new Error('boom') } }), [])
  ok('found by feature detection across both names; absence or failure costs only the pill')
}

// `this` must survive the detached call — a method reaching for internal state would throw.
{
  const q = {
    secret: 'max',
    async usage () { return res({ seven_day: { utilization: this.secret === 'max' ? 60 : 0, resets_at: null } }) },
  }
  assert.equal((await fetchUsageStatuses(q))[0].text, 'Claude 60%', 'the method must be invoked on the query, not detached')
  ok('the usage method is called with its own receiver')
}

console.log(`selftest.usage: ${n} ok`)
