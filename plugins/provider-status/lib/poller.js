// Host-side quota reads for the providers arxa does NOT own the request path for.
//
// WHY A POLLER AT ALL: Claude publishes usage because arxa runs the child and can ask it
// (`Query.usage_...()` at the start of a turn). zai, kimi-coding and deepseek-official are provider
// profiles consumed by dsh's own adapter — arxa never sees their responses, and dsh-llm surfaces
// only error codes (RATE_LIMIT, QUOTA), never usage or headers. The numbers have to be fetched.
//
// WHY CLAUDE IS ALSO HERE (2026-09-05): turn-start publishing is per session, so a fresh session
// with a Claude model picked showed NO ring until a turn had run — the ring looked "activated by
// limits" when it was really activated by turns. Claude's plugin now registers a READER (see
// `registerUsageReader`) that asks a warm child for `/usage` without a turn, and the same
// read-through cache serves it. Every provider with a source is live the moment it is picked.
//
// WHY PULL, NOT A SCHEDULER: the browser already calls the `current` RPC every 60s and again the
// moment the model picker changes provider. Refreshing on a timer when no browser is watching
// updates nothing anybody can see, so this is a read-through cache hung behind that existing call.
// The tradeoff, stated plainly: non-Claude providers get "within 60s", not turn-end.
//
// SECURITY: the key is resolved per read through ctx.credentials (never cached across reads, which
// is what lets a rotated key take effect without a restart), used to build one Authorization header
// to that credential's OWN vendor, and dropped. It is never logged, never placed in a status field,
// and never returned. The reachable URL set is the hardcoded table below — the RPC cannot ask this
// module to fetch anything else, because a provider id that is not a key here does nothing.

import { zaiToStatuses, kimiToStatuses, deepseekToStatuses, brokenStatus, vendorError, PROVIDER_NAME } from './quota.js'

// The ref is passed as a plain string on purpose. dsh's `credentialRef()` only validates the name
// against the POSIX-identifier grammar and returns it — the brand is a TYPE, erased at runtime — so
// importing it would buy a check on three hardcoded constants at the price of an undeclared
// cross-package import. This plugin declares no dependencies, and the payload it ships into is a
// pnpm isolated layout: that import resolves today by hoisting, not by entitlement, and a layout
// change would turn it into a load-time crash that takes the whole indicator with it. The grammar
// is asserted against these three constants in selftest.quota.mjs instead, where a typo is caught
// before it ships rather than at boot.

/**
 * provider id -> where its usage lives. The ids are dsh's own route keys, not arxa's invention:
 * dsh-llm-pi-ai registers the keys of `llm-pi-ai.providers` (so `zai`, `kimi-coding`), and
 * dsh-llm-deepseek registers `deepseek-official`. The refs are each vendor's dsh default.
 *
 * ponytail: the ref name is the vendor default, not read back from the profile's `apiKeyEnv`.
 * A user who renames the ref gets a dark ring rather than a wrong one. Read the profile here if
 * that ever comes up.
 */
export const VENDORS = {
  zai: { ref: 'ZAI_API_KEY', url: 'https://api.z.ai/api/monitor/usage/quota/limit', map: zaiToStatuses },
  'kimi-coding': { ref: 'KIMI_CODING_API_KEY', url: 'https://api.kimi.com/coding/v1/usages', map: kimiToStatuses },
  'deepseek-official': { ref: 'DEEPSEEK_API_KEY', url: 'https://api.deepseek.com/user/balance', map: deepseekToStatuses },
}

/**
 * provider id -> reader, for the providers arxa DOES own the request path for. Registered by that
 * provider's plugin (claude-code registers `probe.usage()`), so the ring is live the moment the
 * model is picked rather than after the first turn of every session.
 *
 * A reader returns `{ statuses, configured }`: `configured: false` means "no account here" (no
 * ring, no `?`); a throw means "reachable but failed" and renders as `?`. Module-level on purpose:
 * plugin apply() order is not a contract, and the poller is built inside a deferred inject, so
 * registration must be able to precede construction.
 */
export const READERS = new Map()
export function registerUsageReader (provider, read) {
  if (typeof provider !== 'string' || typeof read !== 'function') throw new TypeError('registerUsageReader(provider, read): string provider and function reader required')
  READERS.set(provider, read)
}

const MINUTE = 60_000
/** The idle floor: one read per provider per five minutes, however many sessions are open. */
const TTL_MS = 5 * MINUTE
/** Never re-read faster than this, even when a window claims it resets in seconds. */
const MIN_TTL_MS = 30_000
/** An undocumented endpoint that hangs must not hold the ring hostage. */
const TIMEOUT_MS = 6_000
/** How long a COLD read may block the RPC before it answers with what little it has. */
// Measured 2026-09-06 against the packed desktop engine: a cold Claude probe (spawn the CLI, read
// /usage) lands at ~2.5 s. At 1.5 s the first RPC answered null while the probe was still running,
// and the browser then slept a full poll interval on an empty composer. 4 s covers the measured
// cold path with margin and still sits under TIMEOUT_MS, so a hung endpoint cannot hold the RPC.
const COLD_WAIT_MS = 4_000

/**
 * @param credentials ctx.credentials (needs `resolve`).
 * @param publish (sessionId, provider, statuses) => void — REPLACES every status held for that
 *        provider. Replace, not merge: a failed read must not leave yesterday's number folded in
 *        beside the `?`, and a window the vendor stops reporting must actually disappear.
 */
export function createQuotaPoller ({
  credentials,
  publish,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  ttlMs = TTL_MS,
  timeoutMs = TIMEOUT_MS,
  coldWaitMs = COLD_WAIT_MS,
  readers = READERS,
} = {}) {
  // Keyed by PROVIDER, not session. A Z.ai quota is account-wide; keying this by session would
  // multiply the five-minute floor by the number of open tabs.
  const cache = new Map()
  const seen = new Set()

  /** Next read time: the TTL, pulled in to just after the soonest window resets so the ring is
   *  right within seconds of a limit clearing, and floored so a reset-in-2s cannot spin. */
  function expiryFor (statuses, t) {
    const resets = statuses.map((s) => s.resetsAt).filter((s) => typeof s === 'number').map((s) => s * 1000 + 2_000)
    const soonest = resets.filter((ms) => ms > t).sort((a, b) => a - b)[0]
    return Math.max(t + MIN_TTL_MS, Math.min(t + ttlMs, soonest ?? Infinity))
  }

  /** A registered reader owns its own transport (Claude's spawns a sandboxed child with its own
   *  timeout), so this only classifies the outcome the way the vendor path does. */
  async function readViaReader (provider, reader, name) {
    let statuses, configured
    try {
      ({ statuses = [], configured = true } = (await reader()) ?? {})
    } catch (err) {
      const reason = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timed out' : 'unreachable'
      return { statuses: [brokenStatus(provider, name, reason)], configured: true }
    }
    if (!configured) return { statuses: [], configured: false }
    return { statuses: statuses.length > 0 ? statuses : [brokenStatus(provider, name, 'unrecognised response')], configured: true }
  }

  async function read (provider) {
    const name = PROVIDER_NAME[provider] ?? provider
    const reader = readers.get(provider)
    if (reader !== undefined) return readViaReader(provider, reader, name)
    const vendor = VENDORS[provider]
    let statuses
    try {
      const key = await credentials.resolve(vendor.ref)
      // No key is not a failure — it is "this provider is not configured here". No ring, no `?`.
      if (!key?.value) return { statuses: [], configured: false }
      const res = await fetchImpl(vendor.url, {
        headers: { Authorization: `Bearer ${key.value}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      // Only the STATUS reaches the tooltip. A body can quote the key back, name an internal host,
      // or run to a megabyte of HTML; none of that belongs on a hover.
      if (!res.ok) return { statuses: [brokenStatus(provider, name, `HTTP ${res.status}`)], configured: true }
      const body = await res.json()
      // Not every failure comes with a failing status code. Z.ai answers a dead key with
      // `200 {"success":false,"msg":"Authentication Failed"}` — relay that rather than reporting a
      // shape change, because the two send the user to completely different fixes.
      const refusal = vendorError(body)
      if (refusal !== undefined) return { statuses: [brokenStatus(provider, name, refusal)], configured: true }
      statuses = vendor.map(body)
    } catch (err) {
      const reason = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timed out' : 'unreachable'
      return { statuses: [brokenStatus(provider, name, reason)], configured: true }
    }
    // Reached the vendor, understood nothing: the shape moved. Say so rather than showing nothing,
    // which is indistinguishable from "not configured".
    return { statuses: statuses.length > 0 ? statuses : [brokenStatus(provider, name, 'unrecognised response')], configured: true }
  }

  function refresh (sessionId, provider) {
    const entry = cache.get(provider) ?? {}
    if (entry.inflight !== undefined) { entry.pending.add(sessionId); return entry.inflight }
    // Every session that asks while this read is in flight is remembered here and published to
    // when it lands. Without it a joiner got NOTHING: the read published to the session that
    // started it only, the joiner's RPC answered from an empty store, and — because the browser's
    // provider filter then hid the vendor rows it did have — the composer drew no ring until the
    // 60 s tick (measured 2026-09-06: other session at +9 s, the one on screen at +67 s).
    const pending = new Set([sessionId])
    const inflight = read(provider).then(
      ({ statuses, configured }) => {
        const t = now()
        // The statuses are HELD with the expiry, and the sessions they were published to are
        // remembered: the cache is per provider (an account quota is account-wide) but the store
        // is per session, so a warm hit for a session that has not been published to yet must
        // hand it the held statuses instead of nothing. Without this a second tab, a new
        // session, or the composer opened within the TTL of any earlier poll got `null` and
        // drew no ring at all (2026-09-06: the engine had Claude 38%/10%/17% for one session and
        // nothing for the one on screen).
        cache.set(provider, { expires: configured ? expiryFor(statuses, t) : t + ttlMs, inflight: undefined, statuses, sessions: new Set(pending) })
        if (configured) seen.add(provider)
        for (const s of pending) publish(s, provider, statuses)
      },
      // read() catches its own failures; this only fires if publish or the cache write throws,
      // and even then the next tick must be able to try again.
      () => { cache.set(provider, { expires: now() + MIN_TTL_MS, inflight: undefined }) },
    )
    cache.set(provider, { ...entry, inflight, pending })
    return inflight
  }

  const api = {
    /**
     * Make sure the store is as current as the TTL allows, then resolve. Resolving does NOT mean a
     * fetch happened — on a warm cache it means no fetch was needed, and on a stale one it means
     * the refresh is running in the background and the caller should answer from what is held.
     * Awaiting a warm or stale refresh is how one hanging endpoint would stall the whole RPC.
     */
    async ensure (sessionId, provider) {
      if (!Object.hasOwn(VENDORS, provider) && !readers.has(provider)) return
      const entry = cache.get(provider)
      if (entry !== undefined && entry.inflight === undefined && entry.expires > now()) {
        // Warm: no fetch, but a session that has not been handed these statuses gets them now.
        if (entry.statuses !== undefined && !entry.sessions.has(sessionId)) {
          entry.sessions.add(sessionId)
          publish(sessionId, provider, entry.statuses)
        }
        return
      }
      const inflight = refresh(sessionId, provider)
      // Cold only: with nothing held there is nothing to answer with, so a bounded wait beats
      // 60 seconds of empty composer. Bounded, because the wait is on an undocumented endpoint.
      if (seen.has(provider)) return
      await Promise.race([inflight, new Promise((r) => setTimeout(r, coldWaitMs))])
    },
    /**
     * The browser does not always know the provider — dsh's model-selection resolves the session's
     * directory lazily, and until it does the pill asks with no provider at all. Measured
     * 2026-09-06: every real session sat on that path, so `ensure` never ran and the ring stayed
     * blank for the life of the window. With no provider to filter on, warm every provider that
     * can answer (registered readers + configured vendors); unconfigured vendors cache a cheap
     * "not configured" and cost nothing after the first call. Waits run in parallel, so the
     * bounded cold wait is paid once, not once per provider.
     */
    async ensureAny (sessionId) {
      const providers = new Set([...readers.keys(), ...Object.keys(VENDORS)])
      await Promise.all([...providers].map((provider) => api.ensure(sessionId, provider)))
    },
    /** Test seam. */
    reset () { cache.clear(); seen.clear() },
  }
  return api
}
