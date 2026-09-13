/**
 * Provider capability declarations (task 13, §1 of the source plan).
 *
 * `capabilities()` is the ONE call the app feature-flags from. The key set is
 * the frozen CAPABILITY_KEYS; each provider answers the same keys, so the
 * conformance kit and every first-party consumer read one shape.
 */
import { CAPABILITY_KEYS } from './contract.js'

/**
 * The local provider declares the FULL workspace surface: realtime is the
 * in-process emitter (strictly better than the polling degradation — there is
 * no network in between), storage is the filesystem. Only analytics degrades
 * (no-op sink — nothing user-visible, so it is advertised off).
 */
export const LOCAL_CAPABILITIES = Object.freeze(Object.fromEntries(
  CAPABILITY_KEYS.map((k) => [k, k !== 'analytics'])))

/** Normalize any capability answer to the frozen key set (absent = false). */
export function normalizeCapabilities (caps) {
  const out = {}
  for (const k of CAPABILITY_KEYS) out[k] = caps?.[k] === true
  return out
}
