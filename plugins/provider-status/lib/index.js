// arxa-provider-status: ONE live status channel for every model provider.
//
// Producers call publishProviderStatus(session, status); the browser half in lib/client.js
// reads it back over RPC.
//
// WHY THIS IS NOT A SESSION EVENT (it was, until 2026-09-05):
//
// dsh's persistence read path refuses an ENTIRE session log the moment it meets an event type
// outside KNOWN_SESSION_EVENT_TYPES, unless the envelope carries `ignorable: true`
// (dsh-session-persistence, assertEventsSupported). `Session.append()` exposes no way to set that
// flag, and dsh's own known-event-types note says a registration surface for downstream plugin
// events is "deferred until such a consumer exists". arxa is that consumer, and `provider/status`
// is outside the set, so every session this plugin touched became unreadable on reopen -- the
// conversation rendering as "Failed to load history" while its transcript sat intact on disk.
// scripts/session-event-vocabulary-check.mjs is the standing gate.
//
// WHY IT IS PERSISTED TO DISK (the 2026-09-05 regression, and its fix):
//
// Dropping the session event also dropped DURABILITY, and that silently broke the pill. The SDK
// emits rate_limit_event only "when rate limit info changes" -- not per turn -- so a
// process-memory store is empty after every restart and stays empty until a limit happens to
// move. The pill went from "always shows the last known usage" to "shows nothing almost always".
// The session log used to provide that durability for free.
//
// So the store is mirrored to ONE local JSON file. Local-only on purpose: arxa studio is
// distributed software and must never require the Arxa Digital Solutions database (CLAUDE.md),
// and a usage pill is exactly the kind of state that has to work for a user with no database.
export const RPC_CHANNEL = '/rpc/arxa-provider-status'

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { PROVIDER_STATUS_SCHEMA, STATUS_VALUE_SCHEMA, bindingStatus } from './status.js'

/** `${sessionId} ${provider} ${kind}` -> newest status of that kind.
 *  Keyed by kind because a Claude subscription runs two limits at once (a premium-model
 *  weekly allowance and an all-models one) and they arrive as separate events; keying by
 *  session alone made the second erase the first. */
const latest = new Map()
const KEY = (sessionId, provider, kind) => `${sessionId} ${provider} ${kind}`

/** Where the mirror lives. ARXA_APP_DATA_DIR wins so tests never touch a real home. */
export function statusFile (env = process.env, home = homedir()) {
  const dir = env.ARXA_APP_DATA_DIR && env.ARXA_APP_DATA_DIR.trim()
    ? env.ARXA_APP_DATA_DIR.trim()
    : join(home, '.arxa')
  return join(dir, 'provider-status.json')
}

/** Statuses nobody refreshed in a week are dropped on load: a stale usage number is not worth
 *  showing, and expiring them bounds the file without needing a compaction pass. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** Bounds the file if a producer ever publishes per-turn. Newest wins. */
const MAX_ENTRIES = 500

/** Persist the mirror. Never throws: a status update must not be able to kill a turn. */
function save (file = statusFile()) {
  try {
    let rows = [...latest.entries()].map(([key, value]) => ({ key, value }))
    if (rows.length > MAX_ENTRIES) rows = rows.sort((a, b) => b.value.at - a.value.at).slice(0, MAX_ENTRIES)
    mkdirSync(dirname(file), { recursive: true })
    // Write-then-rename: a crash mid-write leaves the previous good file, not a truncated one.
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: 1, rows }), 'utf8')
    renameSync(tmp, file)
  } catch {}
}

/** Rehydrate the mirror at boot. A missing, unreadable, or malformed file is simply an empty
 *  store -- every row is re-validated, so a hand-edited file cannot inject an unchecked value. */
export function loadProviderStatus (file = statusFile(), now = Date.now()) {
  latest.clear()
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    for (const row of Array.isArray(parsed?.rows) ? parsed.rows : []) {
      if (typeof row?.key !== 'string') continue
      const value = STATUS_VALUE_SCHEMA.safeParse(row.value)
      if (!value.success || value.data === null) continue
      if (now - value.data.at > MAX_AGE_MS) continue
      latest.set(row.key, value.data)
    }
  } catch {}
  return latest.size
}

/** Observers of each accepted status. Exists because "was this status published?" is
 * otherwise unobservable -- the store keeps only the newest per session/provider/kind. */
const listeners = new Set()
export function onProviderStatus (fn) { listeners.add(fn); return () => listeners.delete(fn) }

/** Producer helper: validate, hold, mirror to disk. Throws a zod error on a bad status. */
export function publishProviderStatus (session, status, file = statusFile()) {
  const data = PROVIDER_STATUS_SCHEMA.parse(status)
  latest.set(KEY(session.id, data.provider, data.kind), { ...data, at: Date.now() })
  save(file)
  for (const fn of listeners) fn(session.id, data)
  return data
}

/** Every live status for one session, optionally narrowed to the provider on screen. */
export function statusesFor (sessionId, provider = undefined) {
  const prefix = `${sessionId} ${provider === undefined ? '' : `${provider} `}`
  return [...latest.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value)
}

/** Test seam: the store is module state, so a suite that publishes must be able to reset it. */
export function resetProviderStatus () { latest.clear() }

export const name = 'arxa-provider-status'
export function apply (ctx) {
  loadProviderStatus()
  // Child fiber: runs when `connection` is provided (web boot), stays pending harmlessly on a
  // headless boot -- the same shape gen-ui uses.
  ctx.inject(['connection'], (ctx) => ctx.connection.rpc.handle(RPC_CHANNEL, async (endpoint, payload) => {
    // One verb, explicitly allowlisted. A generic bridge is invisible to CSP; narrowness is the control.
    if (endpoint !== 'current') return { ok: false, error: { message: `unknown endpoint ${endpoint}` } }
    const { sessionId, provider } = payload ?? {}
    if (typeof sessionId !== 'string') return { ok: false, error: { message: 'current needs a string sessionId' } }
    if (provider !== undefined && typeof provider !== 'string') return { ok: false, error: { message: 'provider must be a string' } }
    // Folded host-side: the browser copy of formatBadge stays a pure one-value function, and
    // the two-limit rule lives in exactly one place.
    return { ok: true, value: { status: bindingStatus(statusesFor(sessionId, provider)) ?? null } }
  }, { authority: 'trusted-host' }))
}
