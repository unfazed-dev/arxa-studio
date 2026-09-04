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
  level: z.enum(['ok', 'warn', 'limit', 'info']),
  text: z.string().min(1).max(80),
  title: z.string().max(240).optional(),
  utilization: z.number().min(0).max(1).optional(),
  resetsAt: z.number().int().nonnegative().optional(),
  detail: z.preprocess(rejectCircular, JsonValue.optional()),
})
// `activeProvider` is the provider of the LAST ROUTED TURN, which is not always the provider the
// status came from — that is the whole point of it. See applyProviderStatus.
export const PROJECTION_VALUE_SCHEMA = PROVIDER_STATUS_SCHEMA.extend({ at: z.number(), activeProvider: z.string().min(1).optional() }).nullable()

/** The provider a turn was actually routed to. `request/header` is logged whenever the request
 * config changes (so a provider switch always produces one) and `request/context` rides along
 * with a flatter shape; reading both means neither event's absence can strand the pill. */
const routedProvider = (event) => event.type === 'request/header'
  ? event.data?.header?.config?.provider
  : event.type === 'request/context' ? event.data?.provider : undefined

/** Fold: the projection is the latest valid provider/status event. Whole value, never a delta.
 *
 * A status describes ONE provider's account — "Claude 90%" is a fact about the Claude
 * subscription, not about the session. The pill used to render whatever was folded last,
 * regardless of what was running, so switching to GLM left Claude's usage sitting next to a
 * GLM answer, reading as GLM's limit. So the fold also tracks which provider each turn is
 * routed to, and formatBadge hides a status belonging to anyone else.
 *
 * Hidden, not dropped: switching away and back must bring the pill back, and a rate-limit
 * event only arrives when the provider chooses to send one — discarding it here would blank
 * the badge until the next one, which may be many turns away.
 *
 * A producer only posts while its own turn is running, so a status is live by construction and
 * seeds `activeProvider` with its own provider. That keeps a status visible even when the
 * routed events never arrive (utility turns log no header). */
export function applyProviderStatus (state, event) {
  const routed = routedProvider(event)
  if (routed !== undefined) return state ? { ...state, activeProvider: routed } : state
  if (event.type !== 'provider/status') return state
  const parsed = PROVIDER_STATUS_SCHEMA.safeParse(event.data)
  return parsed.success ? { ...parsed.data, at: event.time, activeProvider: parsed.data.provider } : state
}

const relative = (resetsAt, now) => {
  const s = Math.max(0, Math.round(resetsAt - now / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function formatBadge (value, now = Date.now()) {
  if (!value) return undefined
  // Someone else's provider is running: a Claude usage pill next to a GLM answer reads as GLM's
  // limit. Hidden only while another provider is routed — switching back shows it again.
  if (value.activeProvider !== undefined && value.activeProvider !== value.provider) return undefined
  // Stale beats wrong: once resetsAt has passed with nothing new to say, show nothing rather
  // than freeze on "resets in 0m". Recomputed against `now` on every call, so a reconnect/replay
  // (which re-renders with a live clock, not a stored one) reproduces this correctly for free —
  // this can't live in the fold, since the fold must stay deterministic for replay.
  if (value.resetsAt !== undefined && value.resetsAt * 1000 <= now) return undefined
  const reset = value.resetsAt !== undefined && value.level !== 'ok' ? ` · resets in ${relative(value.resetsAt, now)}` : ''
  return { level: value.level, text: `${value.text}${reset}`, title: value.title ?? value.text }
}
