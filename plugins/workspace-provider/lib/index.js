/**
 * arxa-workspace-provider — host half (task 13 step 9 wiring).
 *
 * The library surface (contract, providers, conformance kit, bundles) is
 * consumed by FIRST-PARTY modules only, via this package's exports — never by
 * arbitrary adapters (D32: no third-party JavaScript executes inside the app).
 * The dsh service row exposes a read-only status channel over Connection RPC
 * (one segment, the CHANNEL_PATTERN law) so the browser half and future
 * settings panels can show provider + capabilities without touching a
 * provider instance themselves. Local-first parity: with no config at all
 * the service answers for the local provider — no network, account,
 * database, or environment variable involved.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { assertProviderConfig } from './contract.js'
import { normalizeCapabilities, LOCAL_CAPABILITIES } from './capabilities.js'
import { SUPABASE_CAPABILITIES, SIGN_IN } from './supabase.js'

// One path segment only (dsh-client-connection CHANNEL_PATTERN), same law as
// '/arxa-provider-status'. Must equal the channel in lib/client.js.
export const RPC_CHANNEL = '/arxa-workspace-provider'

/**
 * Truthful capability badges per configured provider (task 14 step 5):
 * local is full (in-process realtime), supabase is the adapter's static
 * declaration (realtime ABSENT → polling degradation, email-form sign-in),
 * generic-rest needs a live fetch so the panel gets `null` — never a guess.
 */
export function capabilitiesFor (backend = {}) {
  if (backend.provider === 'supabase')
    return { ...normalizeCapabilities(SUPABASE_CAPABILITIES), signIn: { ...SIGN_IN } }
  if (backend.provider === 'generic-rest') return null
  return { ...normalizeCapabilities(LOCAL_CAPABILITIES) }
}

/** Redacted workspaceBackend shape — keys only; values never cross the wire. */
export function configShape (backend = {}) {
  return { provider: backend.provider ?? 'local', sections: Object.keys(backend).filter((k) => k !== 'provider') }
}

/** Read the §5 user config (~/.arxa/studio.json) — absent file means local. */
export function readBackendConfig (env = process.env, home = homedir()) {
  const arxaHome = env.ARXA_HOME?.trim() ? resolve(env.ARXA_HOME.trim()) : join(home, '.arxa')
  let backend = {}
  const file = join(arxaHome, 'studio.json')
  if (existsSync(file)) {
    try { backend = JSON.parse(readFileSync(file, 'utf8')).workspaceBackend ?? {} } catch { backend = {} }
  }
  const envProvider = env.ARXA_WORKSPACE_PROVIDER?.trim()
  if (envProvider) backend = { ...backend, provider: envProvider }
  assertProviderConfig(backend)
  return backend
}

export default {
  inject: [],
  apply (ctx) {
    // Child fiber: runs when `connection` is provided (web boot); on a
    // headless boot it stays pending harmlessly — same shape as
    // arxa-provider-status.
    ctx.inject(['connection'], (c) => c.connection.rpc.handle(RPC_CHANNEL, async (endpoint) => {
      // The envelope IS the wire contract (E3/L3, closeout 2026-09-14): the
      // engine hands this return to the browser VERBATIM as the
      // server-response `result`, and the client accepts only {ok:true,value}
      // / {ok:false,error:{code,message,details}} — a bare record reads as
      // "connection: invalid server-response result". Same law as
      // arxa-provider-status; the error code is from the frozen ERROR_CODES set.
      if (endpoint !== 'info') return { ok: false, error: { code: 'invalid_request', message: 'unknown endpoint: ' + endpoint, details: {} } }
      let backend
      try { backend = readBackendConfig() } catch { backend = {} }
      const caps = capabilitiesFor(backend)
      return {
        ok: true,
        value: {
          provider: backend.provider ?? 'local',
          config: configShape(backend),
          ...(caps ? { capabilities: caps } : {}),
        },
      }
    }))
  },
}
