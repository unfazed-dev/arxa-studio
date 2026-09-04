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
import { createQuotaPoller } from './poller.js'

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

/** Warned once per FILE, not once per process. A silent `catch {}` here cost a whole debugging
 *  round: a failed write and a status that was never published look identical from the outside —
 *  an empty pill either way — so the one thing that distinguishes them has to be said out loud.
 *  Once, not per turn: a broken disk would otherwise flood the log with the same line.
 *
 *  Per-site because a process-global latch means the FIRST failing path silences every other one.
 *  With four producers now publishing (Claude plus three polled vendors) that is a real gap, not a
 *  hypothetical: a test seam writing to a bad temp path would mute the real home directory's
 *  warning for the rest of the run. */
const warned = new Set()

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
  } catch (err) {
    if (!warned.has(file)) { warned.add(file); console.warn(`arxa-provider-status: cannot persist ${file} — the usage pill will not survive a restart (${err?.message ?? err})`) }
  }
}

/** Test seam for the warn-once latch. */
export function resetProviderStatusWarning () { warned.clear() }

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

/**
 * Everything one provider currently has to say, replacing what it said before.
 *
 * REPLACE, not merge, and that distinction is the whole point. publishProviderStatus is keyed by
 * kind, so a producer that stops reporting a window leaves the old one sitting in the store where
 * bindingStatus keeps folding it in. For a polled vendor that means two live failures: a read that
 * fails publishes `?` while yesterday's number stays beside it in the fold, and a window the vendor
 * retires never goes away. A bad status must be able to erase a good one.
 *
 * Never throws — a poll must not be able to kill the RPC that triggered it. A status that fails
 * validation is dropped and the rest still land.
 */
export function replaceProviderStatus (sessionId, provider, statuses, file = statusFile()) {
  const prefix = `${sessionId} ${provider} `
  for (const key of [...latest.keys()]) if (key.startsWith(prefix)) latest.delete(key)
  const at = Date.now()
  for (const status of statuses ?? []) {
    const parsed = PROVIDER_STATUS_SCHEMA.safeParse(status)
    if (!parsed.success || parsed.data.provider !== provider) continue
    latest.set(KEY(sessionId, provider, parsed.data.kind), { ...parsed.data, at })
    for (const fn of listeners) fn(sessionId, parsed.data)
  }
  save(file)
}

/**
 * Every live status for one session, for ONE provider.
 *
 * Never returns a mix. bindingStatus folds what it is given into a single pill, so handing it two
 * providers' rows would pick a winner across them and mash both titles together — a Claude limit
 * shown against a GLM turn, which is the bug this plugin exists to prevent. With no provider named
 * (the browser has not resolved the picker's selection yet) the newest provider's rows win, so the
 * pill still says something true about one provider instead of something false about two.
 */
export function statusesFor (sessionId, provider = undefined) {
  const mine = [...latest.entries()]
    .filter(([key]) => key.startsWith(`${sessionId} `))
    .map(([, value]) => value)
  if (provider !== undefined) return mine.filter((v) => v.provider === provider)
  // `>=`, not `>`: `at` has millisecond resolution and one turn publishes every window it learns
  // about inside the same tick, so a strict `>` would tie and silently keep the FIRST provider
  // seen — showing a stale provider's pill after a switch. Ties resolve to the later entry, which
  // in Map iteration order is the more recently published one.
  const newest = mine.reduce((a, b) => (a === undefined || b.at >= a.at ? b : a), undefined)
  return newest === undefined ? [] : mine.filter((v) => v.provider === newest.provider)
}

/** Test seam: the store is module state, so a suite that publishes must be able to reset it. */
export function resetProviderStatus () { latest.clear() }

export const name = 'arxa-provider-status'
export function apply (ctx) {
  // Only at a cold start. loadProviderStatus clears the map, so an apply that re-runs (HMR,
  // re-registration) would otherwise wipe statuses this process already collected.
  if (latest.size === 0) loadProviderStatus()
  // Held, not gated: `credentials` is what lets the polled vendors report at all, but a boot
  // without it must still serve Claude's usage rather than leave the composer blank. Same lazy
  // fiber the client half uses for `modelDirectories`, and for the same reason.
  let poller
  ctx.inject(['credentials'], (scope) => {
    poller = createQuotaPoller({ credentials: scope.credentials, publish: replaceProviderStatus })
  })
  // Child fiber: runs when `connection` is provided (web boot), stays pending harmlessly on a
  // headless boot -- the same shape gen-ui uses.
  ctx.inject(['connection'], (ctx) => ctx.connection.rpc.handle(RPC_CHANNEL, async (endpoint, payload) => {
    // One verb, explicitly allowlisted. A generic bridge is invisible to CSP; narrowness is the control.
    if (endpoint !== 'current') return { ok: false, error: { message: `unknown endpoint ${endpoint}` } }
    const { sessionId, provider } = payload ?? {}
    if (typeof sessionId !== 'string') return { ok: false, error: { message: 'current needs a string sessionId' } }
    if (provider !== undefined && typeof provider !== 'string') return { ok: false, error: { message: 'provider must be a string' } }
    // The refresh trigger. arxa owns Claude's request path and asks it at turn end; it owns none of
    // the others, so their read hangs off the poll the browser is already doing. `ensure` respects
    // its own TTL and never awaits a warm or stale fetch, so this stays a cheap call.
    if (provider !== undefined && poller !== undefined) await poller.ensure(sessionId, provider)
    // Folded host-side: the browser copy of formatBadge stays a pure one-value function, and
    // the two-limit rule lives in exactly one place.
    return { ok: true, value: { status: bindingStatus(statusesFor(sessionId, provider)) ?? null } }
  }, { authority: 'trusted-host' }))
}
