// The `/usage` data, pulled on demand -> provider-neutral statuses for the pill.
//
// WHY THIS EXISTS (the event path is not enough):
//
// `rate_limit_event` is emitted only "when rate limit info changes" (SDK sdk.d.ts). It is not per
// turn, and in practice a whole Fable turn on a nearly-exhausted account produced none. A pill fed
// only by that event shows nothing almost always, which is exactly how it was reported broken.
//
// `Query.usage_...()` returns the structured data behind the CLI's own `/usage` command: the
// 5-hour and 7-day windows, the per-model weekly windows, and the plan's own labels. It can be
// asked at any time, so the pill no longer waits for the account to volunteer news.
//
// THE LABELS COME FROM THE SERVER. `model_scoped[].display_name` is the plan's own name for a
// model bucket ("e.g. 'Fable'"), so arxa never has to guess which SDK enum key currently carries
// the premium bucket — a guess that would silently mislabel the pill on the next plan change.
//
// SECURITY: the response is a wire payload. Output is built from an explicit allowlist of named
// fields (utilization, resets_at, display_name) and never by spreading the response, so no other
// field can reach the browser. `display_name` is server-supplied text: it is length-bounded here
// rather than trusted, because PROVIDER_STATUS_SCHEMA throws above 80 chars and a throw would
// cost the pill entirely.

/** Fixed windows, with the wording the pill uses. Server-labelled buckets are handled separately. */
const WINDOW_LABEL = {
  five_hour: '5-hour window',
  seven_day: 'weekly limit',
  seven_day_opus: 'weekly Opus limit',
  seven_day_sonnet: 'weekly Sonnet limit',
  seven_day_oauth_apps: 'weekly apps limit',
}

/** `utilization` here is a PERCENTAGE (0-100), unlike SDKRateLimitInfo.utilization which is a
 *  fraction. Feeding a 90 straight into the schema's 0-1 range clamps it to 1.0 and the pill
 *  reads "100%" on an account with 10% left. */
const toFraction = (pct) => (typeof pct !== 'number' || Number.isNaN(pct) ? undefined : Math.min(1, Math.max(0, pct / 100)))

/** `resets_at` is an ISO 8601 string here, not the epoch number the event path carries. */
const toUnixSeconds = (iso) => {
  if (typeof iso !== 'string' || iso === '') return undefined
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? undefined : Math.round(ms / 1000)
}

/** No `status` field on this endpoint — only a number — so the level is derived from it. */
const levelFor = (fraction) => (fraction === undefined ? 'ok' : fraction >= 1 ? 'limit' : fraction >= 0.8 ? 'warn' : 'ok')

/** Server text, bounded before it can reach a schema that throws on overlong input. */
const label = (value, fallback) => {
  const s = typeof value === 'string' ? value.trim() : ''
  return s === '' ? fallback : (s.length > 32 ? `${s.slice(0, 31)}…` : s)
}

const statusFrom = ({ kind, what, name, utilization, resetsAt }) => {
  const fraction = toFraction(utilization)
  const level = levelFor(fraction)
  const pct = fraction === undefined ? undefined : Math.round(fraction * 100)
  return {
    provider: 'claude-code',
    kind,
    level,
    text: level === 'limit' ? `${name} limit reached` : pct === undefined ? name : `${name} ${pct}%`,
    title: [`Claude ${what}`, ...(pct === undefined ? [] : [`${pct}% used`])].join(' · '),
    ...(fraction === undefined ? {} : { utilization: fraction }),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  }
}

/**
 * Turn one `/usage` response into the statuses the pill holds — one per live limit window.
 * @param res an SDKControlGetUsageResponse, or anything at all (a malformed payload yields []).
 * @returns provider statuses ready for PROVIDER_STATUS_SCHEMA, newest-limit semantics applied
 *          by the store's `kind` keying.
 */
export function usageToStatuses (res) {
  // rate_limits_available is false for API-key, Bedrock and Vertex sessions: plan limits simply
  // do not apply there, and the honest pill is no pill rather than a zeroed one.
  if (res?.rate_limits_available !== true || res.rate_limits === null || typeof res.rate_limits !== 'object') return []
  const limits = res.rate_limits
  const out = []

  for (const [kind, what] of Object.entries(WINDOW_LABEL)) {
    const window = limits[kind]
    if (window === null || typeof window !== 'object') continue
    if (typeof window.utilization !== 'number') continue
    out.push(statusFrom({ kind, what, name: 'Claude', utilization: window.utilization, resetsAt: toUnixSeconds(window.resets_at) }))
  }

  // Per-model weekly windows. The plan names its own bucket, so a rename upstream ("Opus" ->
  // "Fable") reaches the user correctly without an arxa release.
  for (const window of Array.isArray(limits.model_scoped) ? limits.model_scoped : []) {
    if (window === null || typeof window !== 'object' || typeof window.utilization !== 'number') continue
    const name = label(window.display_name, 'model')
    out.push(statusFrom({
      kind: `model_scoped:${name.toLowerCase()}`,
      what: `weekly ${name} limit`,
      name,
      utilization: window.utilization,
      resetsAt: toUnixSeconds(window.resets_at),
    }))
  }
  return out
}

/**
 * Ask a live Claude child for its usage. Returns [] rather than throwing on any failure — the
 * pill is never worth a turn.
 *
 * The method is found by FEATURE DETECTION across both names: the SDK's own doc says
 * "the method name will change when the API is stabilized", so a build that renames it to the
 * stable `usage` keeps working, and one that removes it falls back to the rate_limit_event path
 * (which stays wired for exactly this reason).
 */
export async function fetchUsageStatuses (q) {
  const fn = q?.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET ?? q?.usage
  if (typeof fn !== 'function') return []
  try { return usageToStatuses(await fn.call(q)) } catch { return [] }
}
