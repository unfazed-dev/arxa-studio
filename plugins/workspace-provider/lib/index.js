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

// One path segment only (dsh-client-connection CHANNEL_PATTERN), same law as
// '/arxa-provider-status'. Must equal the channel in lib/client.js.
export const RPC_CHANNEL = '/arxa-workspace-provider'

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
      if (endpoint !== 'info') throw new Error('unknown endpoint: ' + endpoint)
      let backend
      try { backend = readBackendConfig() } catch { backend = {} }
      const caps = backend.provider === 'generic-rest'
        ? null // remote caps need a live fetch; the panel asks the host CLI/diagnose for those
        : LOCAL_CAPABILITIES
      return {
        provider: backend.provider ?? 'local',
        config: configShape(backend),
        ...(caps ? { capabilities: normalizeCapabilities(caps) } : {}),
      }
    }))
  },
}
