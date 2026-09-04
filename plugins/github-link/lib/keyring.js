/**
 * github-link keyring — token storage, never plaintext disk.
 *
 * Backend ladder (first present wins):
 *   1. Tauri shell bridge  — injected object with set/get/delete secret faces
 *     (production: the Rust side faces the Keychain via the keyring crate;
 *      node reads through the shell bridge per the Phase B plan).
 *   2. macOS Keychain      — /usr/bin/security add-generic-password /
 *     find-generic-password / delete-generic-password. Service
 *     'arxa-studio', account = the linked login.
 *   3. In-memory           — loud warning; process lifetime only. This is a
 *     degraded dev fallback, never a storage story.
 *
 * The token is NEVER written to a file by this module.
 */

import { execFile, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { promisify } from 'node:util'

export const KEYCHAIN_SERVICE = 'arxa-studio'
export const SECURITY_PATH = '/usr/bin/security'

function makeMemoryBackend() {
  console.warn(
    '[github-link] WARNING: no keyring backend available (no Tauri shell ' +
    'bridge, no /usr/bin/security). The GitHub token will be held IN MEMORY ' +
    'ONLY and lost when this process exits.'
  )
  const mem = new Map()
  return {
    backend: 'memory',
    async setSecret(account, secret) { mem.set(account, secret) },
    async getSecret(account) { return mem.get(account) ?? null },
    async deleteSecret(account) { mem.delete(account) },
  }
}

function makeSecurityBackend(securityPath, run) {
  async function sec(args) {
    const { stdout } = await run(securityPath, args)
    return stdout
  }
  return {
    backend: 'security',
    async setSecret(account, secret) {
      // -U updates the item when it already exists (idempotent set).
      await sec(['add-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w', secret, '-U'])
    },
    async getSecret(account) {
      try {
        const out = await sec(['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w'])
        return out.trim() === '' ? null : out.replace(/\n$/, '')
      } catch (err) {
        // item 44 not found = simply unset; anything else is a real failure
        if (/could not be found|not found|44/i.test(String(err?.message))) return null
        throw err
      }
    },
    async deleteSecret(account) {
      try {
        await sec(['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account])
      } catch (err) {
        if (!/could not be found|not found|44/i.test(String(err?.message))) throw err
      }
    },
  }
}

function makeBridgeBackend(bridge) {
  return {
    backend: 'tauri-bridge',
    async setSecret(account, secret) { await bridge.setSecret(KEYCHAIN_SERVICE, account, secret) },
    async getSecret(account) { return (await bridge.getSecret(KEYCHAIN_SERVICE, account)) ?? null },
    async deleteSecret(account) { await bridge.deleteSecret(KEYCHAIN_SERVICE, account) },
  }
}

/**
 * Create the keyring. Options:
 *   bridge        — Tauri shell bridge with setSecret/getSecret/deleteSecret
 *   securityPath  — override the security binary path (tests force memory
 *                   with a nonexistent path)
 *   run           — injectable (cmd, args) => Promise<{stdout}> (default
 *                   promisified execFile)
 */
export function createKeyring({ bridge, securityPath = SECURITY_PATH, run } = {}) {
  if (bridge && typeof bridge.setSecret === 'function' && typeof bridge.getSecret === 'function' && typeof bridge.deleteSecret === 'function') {
    return makeBridgeBackend(bridge)
  }
  const runner = run ?? promisify(execFile)
  if (fs.existsSync(securityPath) && keychainUsable(securityPath)) {
    return makeSecurityBackend(securityPath, runner)
  }
  return makeMemoryBackend()
}

/**
 * Usability probe, not existence: /usr/bin/security exists on every macOS —
 * including service contexts (CI runners, launchd agents) where the user
 * keychain is locked or interaction is refused and every
 * add-generic-password fails. One throwaway round-trip up front routes those
 * environments to the memory fallback instead of failing the first real
 * store at runtime (seen on the self-hosted runner since 2026-09-02).
 */
function keychainUsable(securityPath) {
  const probeAccount = '__keyring_probe__'
  const setProbe = spawnSync(securityPath,
    ['add-generic-password', '-s', KEYCHAIN_SERVICE, '-a', probeAccount, '-w', 'probe', '-U'],
    { stdio: 'ignore' })
  if (setProbe.error || setProbe.status !== 0) {
    console.warn('[github-link] WARNING: /usr/bin/security exists but the keychain refused a probe write — using the in-memory fallback for this process.')
    return false
  }
  spawnSync(securityPath,
    ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', probeAccount],
    { stdio: 'ignore' })
  return true
}
