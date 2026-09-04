// Host-side quota reads for the providers arxa does NOT own the request path for.
//
// WHY A POLLER AT ALL: Claude publishes usage because arxa runs the child and can ask it
// (`Query.usage_...()` at the end of a turn). zai, kimi-coding and deepseek-official are provider
// profiles consumed by dsh's own adapter — arxa never sees their responses, and dsh-llm surfaces
// only error codes (RATE_LIMIT, QUOTA), never usage or headers. The numbers have to be fetched.
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

import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { zaiToStatuses, kimiToStatuses, deepseekToStatuses, brokenStatus, vendorError, PROVIDER_NAME } from './quota.js'

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

const MINUTE = 60_000
/** The idle floor: one read per provider per five minutes, however many sessions are open. */
const TTL_MS = 5 * MINUTE
/** Never re-read faster than this, even when a window claims it resets in seconds. */
const MIN_TTL_MS = 30_000
/** An undocumented endpoint that hangs must not hold the ring hostage. */
const TIMEOUT_MS = 6_000
/** How long a COLD read may block the RPC before it answers with what little it has. */
const COLD_WAIT_MS = 1_500

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

  async function read (provider) {
    const vendor = VENDORS[provider]
    const name = PROVIDER_NAME[provider] ?? provider
    let statuses
    try {
      const key = await credentials.resolve(credentialRef(vendor.ref))
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
    if (entry.inflight !== undefined) return entry.inflight
    const inflight = read(provider).then(
      ({ statuses, configured }) => {
        const t = now()
        cache.set(provider, { expires: configured ? expiryFor(statuses, t) : t + ttlMs, inflight: undefined })
        if (configured) seen.add(provider)
        publish(sessionId, provider, statuses)
      },
      // read() catches its own failures; this only fires if publish or the cache write throws,
      // and even then the next tick must be able to try again.
      () => { cache.set(provider, { expires: now() + MIN_TTL_MS, inflight: undefined }) },
    )
    cache.set(provider, { ...entry, inflight })
    return inflight
  }

  return {
    /**
     * Make sure the store is as current as the TTL allows, then resolve. Resolving does NOT mean a
     * fetch happened — on a warm cache it means no fetch was needed, and on a stale one it means
     * the refresh is running in the background and the caller should answer from what is held.
     * Awaiting a warm or stale refresh is how one hanging endpoint would stall the whole RPC.
     */
    async ensure (sessionId, provider) {
      if (!Object.hasOwn(VENDORS, provider)) return
      const entry = cache.get(provider)
      if (entry !== undefined && entry.inflight === undefined && entry.expires > now()) return
      const inflight = refresh(sessionId, provider)
      // Cold only: with nothing held there is nothing to answer with, so a bounded wait beats
      // 60 seconds of empty composer. Bounded, because the wait is on an undocumented endpoint.
      if (seen.has(provider)) return
      await Promise.race([inflight, new Promise((r) => setTimeout(r, coldWaitMs))])
    },
    /** Test seam. */
    reset () { cache.clear(); seen.clear() },
  }
}
