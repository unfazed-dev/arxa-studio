import { z } from 'zod'

export const PROVIDER_STATUS_SCHEMA = z.object({
  provider: z.string().min(1),
  level: z.enum(['ok', 'warn', 'limit', 'info']),
  text: z.string().min(1).max(80),
  title: z.string().max(240).optional(),
  utilization: z.number().min(0).max(1).optional(),
  resetsAt: z.number().int().nonnegative().optional(),
  detail: z.unknown().optional(),
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
  const reset = value.resetsAt !== undefined && value.level !== 'ok' ? ` · resets in ${relative(value.resetsAt, now)}` : ''
  return { level: value.level, text: `${value.text}${reset}`, title: value.title ?? value.text }
}
