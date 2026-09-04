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
const CIRCULAR = Symbol('detail: circular or unserializable')
const rejectCircular = (val) => {
  if (val === undefined || val === null || typeof val !== 'object') return val
  try { JSON.stringify(val); return val } catch { return CIRCULAR }
}

export const PROVIDER_STATUS_SCHEMA = z.object({
  provider: z.string().min(1),
  level: z.enum(['ok', 'warn', 'limit', 'info']),
  text: z.string().min(1).max(80),
  title: z.string().max(240).optional(),
  utilization: z.number().min(0).max(1).optional(),
  resetsAt: z.number().int().nonnegative().optional(),
  detail: z.preprocess(rejectCircular, JsonValue.optional()),
})
export const PROJECTION_VALUE_SCHEMA = PROVIDER_STATUS_SCHEMA.extend({ at: z.number() }).nullable()

/** Fold: the projection is the latest valid provider/status event. Whole value, never a delta. */
export function applyProviderStatus (state, event) {
  if (event.type !== 'provider/status') return state
  const parsed = PROVIDER_STATUS_SCHEMA.safeParse(event.data)
  return parsed.success ? { ...parsed.data, at: event.time } : state
}

const relative = (resetsAt, now) => {
  const s = Math.max(0, Math.round(resetsAt - now / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function formatBadge (value, now = Date.now()) {
  if (!value) return undefined
  // Stale beats wrong: once resetsAt has passed with nothing new to say, show nothing rather
  // than freeze on "resets in 0m". Recomputed against `now` on every call, so a reconnect/replay
  // (which re-renders with a live clock, not a stored one) reproduces this correctly for free —
  // this can't live in the fold, since the fold must stay deterministic for replay.
  if (value.resetsAt !== undefined && value.resetsAt * 1000 <= now) return undefined
  const reset = value.resetsAt !== undefined && value.level !== 'ok' ? ` · resets in ${relative(value.resetsAt, now)}` : ''
  return { level: value.level, text: `${value.text}${reset}`, title: value.title ?? value.text }
}
