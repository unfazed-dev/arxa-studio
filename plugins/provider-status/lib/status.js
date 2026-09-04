import { z } from 'zod'

// JSON-value type: `detail` ships verbatim to the browser (wire.view is identity), so the
// schema IS the security boundary. z.unknown() would let non-serializable values, raw Error
// objects, or tokens sit here; this rejects anything that isn't plain JSON. It does not reject
// a bare string containing a secret — that's still a valid JSON value — producers stay
// responsible for not putting one in `detail`.
const JsonValue = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValue), z.record(z.string(), JsonValue)]))

// A genuinely circular `detail` (detail.self = detail) has no finite JSON shape, and JsonValue's
// union recursion has no cycle detection — it recurses forever and throws a bare RangeError (stack
// overflow) instead of a ZodError. That escapes even .safeParse(), so a malformed producer payload
// would crash the projection fold outright. JSON.stringify has its own cheap cycle detector (it
// tracks the objects currently being stringified, so it throws the moment a repeat shows up, not
// after blowing the stack) — probe with that first and swap in a value JsonValue cleanly rejects.
// Depth is the other half of the same crash, and closing cycles did not close it. JsonValue's
// union costs a stack of JS frames per level — far more than JSON.stringify's native walk — so
// there is a window where a deep but perfectly ACYCLIC `detail` passes the stringify probe and
// then overflows inside `safeParse`. That parse runs host-side in `applyProviderStatus`, inside
// the projection fold and outside the adapter's try/catch, so it takes the session down exactly
// as the circular case did. Claude's own detail is flat, so nothing produces this today; a
// future producer is one nested array away from it.
const MAX_DETAIL_DEPTH = 32
// Iterative on purpose: a recursive depth check would blow the very stack it exists to guard.
// Safe to run unguarded against cycles only because the stringify probe below rejects those
// first — a cyclic value never reaches this walk.
const tooDeep = (root) => {
  const stack = [[root, 1]]
  while (stack.length > 0) {
    const [val, depth] = stack.pop()
    if (val === null || typeof val !== 'object') continue
    if (depth > MAX_DETAIL_DEPTH) return true
    for (const child of Array.isArray(val) ? val : Object.values(val)) stack.push([child, depth + 1])
  }
  return false
}

const CIRCULAR = Symbol('detail: circular, too deep, or unserializable')
const rejectCircular = (val) => {
  if (val === undefined || val === null || typeof val !== 'object') return val
  try { JSON.stringify(val) } catch { return CIRCULAR }
  return tooDeep(val) ? CIRCULAR : val
}

export const PROVIDER_STATUS_SCHEMA = z.object({
  provider: z.string().min(1),
  // Which limit this is (the SDK's rateLimitType, or 'default' for producers with one
  // limit). Two limits are live on a Claude subscription at once — a premium-model
  // weekly allowance and an all-models one — and they arrive as separate events. Keying
  // the store by provider+kind keeps both; without it the second event erases the first.
  kind: z.string().min(1).max(64).default('default'),
  level: z.enum(['ok', 'warn', 'limit', 'info']),
  text: z.string().min(1).max(80),
  title: z.string().max(240).optional(),
  utilization: z.number().min(0).max(1).optional(),
  resetsAt: z.number().int().nonnegative().optional(),
  detail: z.preprocess(rejectCircular, JsonValue.optional()),
})
/** What the RPC hands the browser: a validated status plus when it was recorded. */
export const STATUS_VALUE_SCHEMA = PROVIDER_STATUS_SCHEMA.extend({ at: z.number() }).nullable()

const relative = (resetsAt, now) => {
  const s = Math.max(0, Math.round(resetsAt - now / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** @param activeProvider the provider selected RIGHT NOW, so the caller can pass the picker's
 * live value and the badge reacts to a model switch without waiting for a turn. */
export function formatBadge (value, now = Date.now(), activeProvider = undefined) {
  if (!value) return undefined
  // Someone else's provider is selected: a Claude usage pill next to a GLM answer reads as GLM's
  // limit. Hidden, not dropped — switching back shows the same pill again.
  if (activeProvider !== undefined && activeProvider !== value.provider) return undefined
  // Stale beats wrong: once resetsAt has passed with nothing new to say, show nothing rather
  // than freeze on "resets in 0m". Recomputed against `now` on every call, so a reconnect/replay
  // (which re-renders with a live clock, not a stored one) reproduces this correctly for free —
  // this can't live in the fold, since the fold must stay deterministic for replay.
  if (value.resetsAt !== undefined && value.resetsAt * 1000 <= now) return undefined
  const reset = value.resetsAt !== undefined && value.level !== 'ok' ? ` · resets in ${relative(value.resetsAt, now)}` : ''
  // `utilization` rides along because the ring draws its arc from it. It stays a fraction USED —
  // the one inversion to "left" happens at render, so nothing downstream has to remember which
  // direction a number points.
  return { level: value.level, text: `${value.text}${reset}`, title: value.title ?? value.text, utilization: value.utilization }
}

/** Rank: a refusal outranks a warning outranks fine; ties break on utilization. Two live
 * limits mean the user is bound by whichever is worst, so that is the one the pill shows. */
const RANK = { limit: 3, warn: 2, info: 1, ok: 0 }
const worse = (a, b) => (RANK[a.level] ?? 0) !== (RANK[b.level] ?? 0)
  ? (RANK[a.level] ?? 0) > (RANK[b.level] ?? 0)
  : (a.utilization ?? 0) >= (b.utilization ?? 0)

/**
 * Fold every live status for one provider into the single pill the composer shows.
 * @param values statuses for one session, newest values of each kind.
 * @param now used to drop limits whose window already reset.
 * @returns the binding status, its title widened to name every live limit, or undefined.
 */
export function bindingStatus (values, now = Date.now()) {
  const live = (values ?? []).filter((v) => v && (v.resetsAt === undefined || v.resetsAt * 1000 > now))
  if (live.length === 0) return undefined
  const top = live.reduce((a, b) => (worse(a, b) ? a : b))
  if (live.length === 1) return top
  const rest = live.filter((v) => v !== top)
  // Two things, for two audiences. `title` names every live limit for the tooltip — the ring can
  // only draw one number, and a limit the user is never shown is how they get surprised by it.
  // `others` carries the siblings STRUCTURALLY so the ring can be tapped through them; the joined
  // string used to be the only channel, which left tap-to-cycle nothing to cycle to.
  return { ...top, title: [top.title ?? top.text, ...rest.map((v) => v.title ?? v.text)].join(' · '), others: rest }
}
