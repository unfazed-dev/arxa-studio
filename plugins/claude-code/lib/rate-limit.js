// SDK rate_limit_event → the provider-neutral status every model shares (Task 13's
// provider/status channel, plugins/provider-status/lib/index.js). Task 13's schema stops a
// non-JSON value or a circular structure reaching the browser but cannot catch a secret sitting
// inside an ordinary string — that boundary is this module's job. `detail`/`title`/`text` are
// built from an explicit allowlist of named SDK fields (status, rateLimitType, resetsAt,
// utilization); the SDK payload is never spread and no other field of it can reach the output,
// so a field a future SDK version adds stays out by default. See selftest.rate-limit.mjs's leak
// test for the check that proves this.
const TYPE_LABEL = {
  five_hour: '5-hour window',
  seven_day: 'weekly limit',
  seven_day_opus: 'weekly Opus limit',
  seven_day_sonnet: 'weekly Sonnet limit',
  seven_day_overage_included: 'weekly limit (credits included)',
  overage: 'usage credits',
}

// SDKRateLimitInfo.resetsAt has no documented unit (sdk.d.ts just says `number`) and we cannot
// invoke the live SDK from a selftest to find out. Rather than assume, normalise defensively: a
// Unix timestamp in seconds for any real date is ~1e9-2e9, the same instant in milliseconds is
// ~1e12 — 1e11 sits between them with enormous margin (1e11s ≈ year 5138, 1e11ms ≈ 1973), so no
// real timestamp is ever near the boundary in either unit.
// Round on both branches: PROVIDER_STATUS_SCHEMA requires resetsAt to be an int, and a
// seconds-shaped float (Date.now() / 1000 is a common upstream idiom) would otherwise pass
// the pass-through branch unrounded and fail .parse() in appendProviderStatus.
const MS_VS_S_THRESHOLD = 1e11
const toUnixSeconds = (value) => Math.round(value > MS_VS_S_THRESHOLD ? value / 1000 : value)

// ponytail: `account` stays in the signature (interface contract) for a future plan-level
// rate-limit rule, but no such rule exists yet, so it's unused here. Never fill it back in with
// account.email/account.subscriptionType for display — the status pill is provider state, not
// identity; an account identifier reaching this object means it reaches the browser.
/** SDK rate_limit_event → the provider-neutral status every model shares (Task 13). */
export function rateLimitToStatus (info, account = {}) {
  const what = TYPE_LABEL[info.rateLimitType] ?? 'usage'
  const pct = info.utilization === undefined ? undefined : Math.round(info.utilization * 100)
  const title = ['Claude ' + what, ...(pct === undefined ? [] : [`${pct}% used`])].join(' · ')
  const level = info.status === 'rejected' ? 'limit' : info.status === 'allowed_warning' ? 'warn' : 'ok'
  const text = level === 'limit' ? 'Claude limit reached' : pct === undefined ? 'Claude' : `Claude ${pct}%`
  return {
    provider: 'claude-code',
    level,
    text,
    title,
    ...(info.utilization === undefined ? {} : { utilization: info.utilization }),
    ...(info.resetsAt === undefined ? {} : { resetsAt: toUnixSeconds(info.resetsAt) }),
    // Allowlist: only the window kind and the raw status enum — both name rate-limit *state*,
    // never upstream payload, error body, headers, tokens, or an account identifier. An absent
    // rateLimitType is omitted rather than set to `undefined`: the provider/status schema's
    // JsonValue has no undefined member, so an explicit `rateLimitType: undefined` key would
    // fail PROVIDER_STATUS_SCHEMA.parse in appendProviderStatus.
    detail: { status: info.status, ...(info.rateLimitType === undefined ? {} : { rateLimitType: info.rateLimitType }) },
  }
}
