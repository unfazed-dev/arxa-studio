// arxa-provider-status: ONE live status channel for every model provider.
//
// Producers call publishProviderStatus(ctx, session, status); the browser half in lib/client.js
// reads it back over RPC.
//
// WHY THIS IS NOT A SESSION EVENT (it was, until 2026-09-05):
//
// dsh's persistence read path refuses an ENTIRE session log the moment it meets an event type
// outside KNOWN_SESSION_EVENT_TYPES, unless the envelope carries `ignorable: true`
// (dsh-session-persistence, assertEventsSupported). `Session.append()` exposes no way to set that
// flag, and dsh's own known-event-types note says a registration surface for downstream plugin
// events is "deferred until such a consumer exists". arxa is that consumer, and `provider/status`
// is outside the set, so every session this plugin touched became unreadable on reopen — the
// conversation rendering as "Failed to load history" while its transcript sat intact on disk.
// Two real sessions were lost that way. scripts/session-event-vocabulary-check.mjs is the gate.
//
// WHAT THAT COSTS: the session projection was the only server->client PUSH channel, and it is
// exactly the channel that corrupts the log. Connection RPC is unary (call -> Promise, no
// subscribe: dsh-client-connection/lib/types/rpc.d.ts), so the badge is now pull-based — the
// client asks on mount, on provider change, and while a turn is running. Status is per-process
// memory: a host restart clears it, and the next rate-limit event refills it.
export const RPC_CHANNEL = '/rpc/arxa-provider-status'

import { PROVIDER_STATUS_SCHEMA } from './status.js'

/** sessionId -> the latest status for that session. Not persisted, by design (see above). */
const latest = new Map()

/** Observers of each accepted status. The RPC below is a pull, so nothing in production needs
 * this yet; it exists because "was this status published?" is otherwise unobservable, and the
 * store keeps only the newest per session. */
const listeners = new Set()
export function onProviderStatus (fn) { listeners.add(fn); return () => listeners.delete(fn) }

/** Producer helper: validate, then hold. Throws a zod error on a bad status. */
export function publishProviderStatus (session, status) {
  const data = PROVIDER_STATUS_SCHEMA.parse(status)
  latest.set(session.id, { ...data, at: Date.now() })
  for (const fn of listeners) fn(session.id, data)
  return data
}

/** Test seam: the store is module state, so a suite that publishes must be able to reset it. */
export function resetProviderStatus () { latest.clear() }

export const name = 'arxa-provider-status'
export function apply (ctx) {
  // Child fiber: runs when `connection` is provided (web boot), stays pending harmlessly on a
  // headless boot — the same shape gen-ui uses.
  ctx.inject(['connection'], (ctx) => ctx.connection.rpc.handle(RPC_CHANNEL, async (endpoint, payload) => {
    // One verb, explicitly allowlisted. A generic bridge is invisible to CSP; narrowness is the control.
    if (endpoint !== 'current') return { ok: false, error: { message: `unknown endpoint ${endpoint}` } }
    const sessionId = (payload ?? {}).sessionId
    if (typeof sessionId !== 'string') return { ok: false, error: { message: 'current needs a string sessionId' } }
    return { ok: true, value: { status: latest.get(sessionId) ?? null } }
  }, { authority: 'trusted-host' }))
}
