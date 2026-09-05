// Vendor quota payloads -> provider statuses. PURE: no network, no keys, no clock beyond what
// the caller passes. lib/poller.js owns the I/O; everything here is a total function of a payload,
// which is what makes the undocumented shapes testable at all.
//
// WHY THESE ARE HAND-WRITTEN PER VENDOR: none of the three endpoints is documented, and no two
// agree on anything. Z.ai reports consumption as a percentage and resets as epoch ms; Kimi reports
// a limit and a remainder and describes its own window in a nested {duration, timeUnit}; DeepSeek
// reports a wallet balance with no denominator at all. The one thing they are normalised to is the
// house rule: `utilization` is always the fraction USED, and the ring inverts once, at render.
//
// SECURITY: every mapper takes an already-parsed payload and reads named fields only. No key, no
// header, no URL and no raw response body ever reaches an output field — `text` and `title` are
// built from numbers and fixed phrases, and `detail` is deliberately never set (it ships verbatim
// to the browser, so not setting it is the cheapest way to be sure nothing rides along).

/** Level from consumption. Same thresholds as the Claude reader, so ranking is comparable across
 *  providers. NOT the ring's colour — that steps at 30%/10% LEFT and reads `utilization` itself. */
const levelFor = (u) => (u === undefined ? 'ok' : u >= 1 ? 'limit' : u >= 0.8 ? 'warn' : 'ok')

const num = (v) => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

/** Epoch, in whichever unit the vendor felt like. Z.ai sends ms, Kimi sends ms, and neither says
 *  so; a seconds value would otherwise land in 1970 and the badge would read as permanently stale.
 *  1e11 seconds is year 5138 and 1e11 ms is 1973, so the split is unambiguous for any real value. */
const toUnixSeconds = (v) => {
  const n = num(v)
  if (n === undefined || n <= 0) return undefined
  return Math.round(n > 1e11 ? n / 1000 : n)
}

const clamp01 = (n) => (n === undefined ? undefined : Math.min(1, Math.max(0, n)))

/** One status. `name` is the provider's display name, `what` the window in words. */
function statusFrom ({ provider, kind, name, what, utilization, resetsAt }) {
  const u = clamp01(utilization)
  const level = levelFor(u)
  const pct = u === undefined ? undefined : Math.round(u * 100)
  return {
    provider,
    kind,
    level,
    text: level === 'limit' ? `${name} limit reached` : `${name} ${pct}%`,
    title: `${name} ${what} · ${pct}% used`,
    utilization: u,
    ...(resetsAt === undefined ? {} : { resetsAt }),
  }
}

// ---------------------------------------------------------------------------
// Z.ai — GET /api/monitor/usage/quota/limit
//
// data.limits[]: { type, unit, number, usage, currentValue, remaining, percentage, nextResetTime }
// `usage` is the TOTAL allowance and `currentValue` the amount consumed, which is the opposite of
// what both names suggest; `percentage` is consumption, and is the field trusted here.
// ---------------------------------------------------------------------------

/** Z.ai names a window as a (unit, number) pair with no legend. Observed: unit 3 counts hours
 *  (number 5 = the 5-hour window), unit 6 counts weeks (number 1 = the weekly one). An unknown
 *  unit degrades to a generic label rather than a wrong one. */
function zaiWindow (unit, number) {
  const n = num(number)
  if (unit === 3 && n !== undefined) return { kind: `hour:${n}`, what: `${n}-hour window` }
  if (unit === 6 && n !== undefined) return { kind: `week:${n}`, what: n === 1 ? 'weekly limit' : `${n}-week window` }
  return { kind: `unit${unit}:${n ?? '?'}`, what: 'quota' }
}

export function zaiToStatuses (payload) {
  const limits = payload?.data?.limits
  if (!Array.isArray(limits)) return []
  const out = []
  for (const row of limits) {
    if (row === null || typeof row !== 'object') continue
    // percentage first (it is what the vendor's own console shows); consumed/total as the fallback
    // for a row that omits it, so one missing field does not blank the ring.
    const pct = num(row.percentage)
    const total = num(row.usage)
    const used = num(row.currentValue)
    const utilization = pct !== undefined ? pct / 100
      : total !== undefined && total > 0 && used !== undefined ? used / total
        : undefined
    if (utilization === undefined) continue
    const { kind, what } = zaiWindow(row.unit, row.number)
    out.push(statusFrom({ provider: 'zai', kind, name: 'GLM', what, utilization, resetsAt: toUnixSeconds(row.nextResetTime) }))
  }
  return out
}

// ---------------------------------------------------------------------------
// Kimi Code — GET /coding/v1/usages
//
// Top-level `usage` is the weekly block. `limits[]` each carry their own
// `window: {duration, timeUnit}` and `detail: {limit, remaining, used?, resetTime}`.
// ---------------------------------------------------------------------------

/** The window labels itself. `duration: 300, timeUnit: TIME_UNIT_MINUTE` is FIVE HOURS, not five
 *  minutes — reading that as minutes is a real mistake this function exists to prevent. Deriving
 *  the label from the payload also means a window Moonshot adds later names itself correctly with
 *  no arxa release. */
function kimiWindow (window) {
  const d = num(window?.duration)
  const unit = String(window?.timeUnit ?? '').toUpperCase()
  if (d === undefined) return { kind: 'quota', what: 'quota' }
  if (unit.includes('MINUTE')) {
    return d >= 60 && d % 60 === 0
      ? { kind: `hour:${d / 60}`, what: `${d / 60}-hour window` }
      : { kind: `minute:${d}`, what: `${d}-minute window` }
  }
  if (unit.includes('HOUR')) return { kind: `hour:${d}`, what: `${d}-hour window` }
  if (unit.includes('DAY')) return d === 7 ? { kind: 'week:1', what: 'weekly limit' } : { kind: `day:${d}`, what: `${d}-day window` }
  return { kind: 'quota', what: 'quota' }
}

/** `used` is optional; when it is absent the remainder is the only evidence of consumption. */
function kimiUsage (detail) {
  const limit = num(detail?.limit)
  if (limit === undefined || limit <= 0) return undefined
  const used = num(detail?.used) ?? (num(detail?.remaining) === undefined ? undefined : limit - num(detail.remaining))
  return used === undefined ? undefined : used / limit
}

export function kimiToStatuses (payload) {
  if (payload === null || typeof payload !== 'object') return []
  const out = []
  const push = (kind, what, detail, resets) => {
    const utilization = kimiUsage(detail)
    if (utilization === undefined) return
    out.push(statusFrom({ provider: 'kimi-coding', kind, name: 'Kimi', what, utilization, resetsAt: toUnixSeconds(resets) }))
  }
  // The top-level block is the weekly allowance; it carries no `window` of its own to derive from.
  const weekly = payload.usage
  if (weekly !== null && typeof weekly === 'object') push('week:1', 'weekly limit', weekly.detail ?? weekly, (weekly.detail ?? weekly).resetTime)
  for (const row of Array.isArray(payload.limits) ? payload.limits : []) {
    if (row === null || typeof row !== 'object') continue
    const { kind, what } = kimiWindow(row.window)
    const detail = row.detail ?? row
    push(kind, what, detail, detail.resetTime)
  }
  return out
}

// ---------------------------------------------------------------------------
// DeepSeek — GET /user/balance (the one documented endpoint of the three)
//
// A balance has NO DENOMINATOR: there is no allowance to divide by, so there is no utilization and
// no arc to draw. The status carries the amount and omits `utilization` entirely, which is the
// signal the ring uses to switch to its dashed idle form.
// ---------------------------------------------------------------------------

export function deepseekToStatuses (payload) {
  const rows = payload?.balance_infos
  if (!Array.isArray(rows)) return []
  const symbol = { USD: '$', CNY: '¥' }
  const funded = []
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    const amount = num(row.total_balance)
    const currency = typeof row.currency === 'string' ? row.currency : ''
    if (amount === undefined || currency === '') continue
    funded.push({ currency, amount, shown: `${symbol[currency] ?? ''}${amount.toFixed(2)}${symbol[currency] ? '' : ` ${currency}`}` })
  }
  // A zero balance in a currency the user never funded is noise; a zero balance in ALL of them is
  // the one thing they need to see, so it survives as a single spent-wallet status.
  const live = funded.filter((f) => f.amount > 0)
  if (live.length === 0) {
    if (funded.length === 0) return []
    return [{ provider: 'deepseek-official', kind: 'balance', level: 'limit', text: 'DeepSeek out of credit', title: 'DeepSeek balance · empty' }]
  }
  return live.map((f) => ({
    provider: 'deepseek-official',
    kind: `balance:${f.currency}`,
    // Balance is information, not a limit: there is no window and no threshold to warn against.
    level: 'info',
    text: `DeepSeek ${f.shown}`,
    title: `DeepSeek balance · ${f.shown}`,
  }))
}

/**
 * The status a failed read publishes. Undocumented endpoints break; a ring that silently keeps
 * showing yesterday's number is worse than one that admits it does not know.
 *
 * `level: 'info'` ranks below warn/limit, so a broken window can never outrank a real one, and the
 * reason is a fixed phrase plus at most an HTTP status — never a URL, a header, or a response body.
 */
export function brokenStatus (provider, name, reason) {
  return { provider, kind: 'unavailable', level: 'info', text: '?', title: `${name} usage unavailable · ${reason}` }
}

/** Provider id -> the display name its statuses use. One place, so a ring and its error agree. */
export const PROVIDER_NAME = { zai: 'GLM', 'kimi-coding': 'Kimi', 'deepseek-official': 'DeepSeek', 'claude-code': 'Claude' }

/**
 * A vendor's own error, when it ships one inside an HTTP 200.
 *
 * Z.ai does exactly this: a dead key comes back as `200 {"code":1000,"msg":"Authentication
 * Failed","success":false}`. Without this the reader sees a body it cannot map and reports
 * "unrecognised response" — true, but it sends the user looking for a shape change when the actual
 * fix is to re-enter their key. The vendor already knows what went wrong; the job is to relay it.
 *
 * The message is VENDOR-CONTROLLED TEXT heading for a tooltip, so it is stripped to printable
 * characters and cut short. Anything unrecognisable degrades to a generic phrase rather than
 * putting an arbitrary string, of arbitrary length, in front of the user.
 */
export function vendorError (payload) {
  if (payload === null || typeof payload !== 'object') return undefined
  const failed = payload.success === false || (payload.error !== null && typeof payload.error === 'object')
  if (!failed) return undefined
  const raw = typeof payload.error?.message === 'string' ? payload.error.message : typeof payload.msg === 'string' ? payload.msg : ''
  const clean = raw.replace(/[^\x20-\x7E]+/g, ' ').trim()
  return clean === '' ? 'refused' : clean.length > 40 ? `${clean.slice(0, 39)}…` : clean
}
