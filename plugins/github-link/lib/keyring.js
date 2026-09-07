/**
 * github-link keyring — token storage, never plaintext disk.
 *
 * Backend ladder (first present wins):
 *   1. Tauri shell bridge  — injected object with set/get/delete secret faces
 *     (production: the Rust side faces the platform store via the keyring
 *      crate; node reads through the shell bridge per the Phase B plan).
 *   2. Platform secret store, by OS:
 *        macOS — /usr/bin/security add-generic-password /
 *          find-generic-password / delete-generic-password.
 *        Linux — secret-tool (libsecret) store/lookup/clear against the
 *          Secret Service. Omarchy ships libsecret + gnome-keyring and
 *          pre-creates an unlocked default keyring, so this is the real
 *          store there; any DE running a Secret Service works the same.
 *      Service 'arxa-studio', account = the linked login, on both.
 *   3. In-memory           — loud warning; process lifetime only. This is a
 *     degraded dev fallback, never a storage story.
 *
 * The token is NEVER written to a file by this module.
 */

import { execFile, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { promisify } from 'node:util'

/** The probe is SYNCHRONOUS and sits on the engine's boot path, so it must be
 *  bounded: `security add-generic-password` blocks forever when the HOME it is
 *  given has no login keychain (a scratch home, a service account, a locked
 *  session). Unbounded, that hung the whole engine before it served anything —
 *  observed 2026-09-07 with a 70s-old `security` child and no studio on the
 *  port. A store that cannot answer in two seconds is a store we do not use. */
export const PROBE_TIMEOUT_MS = 2000

export const KEYCHAIN_SERVICE = 'arxa-studio'
export const SECURITY_PATH = '/usr/bin/security'
/** libsecret's CLI. Same role on Linux that `security` plays on macOS. */
export const SECRET_TOOL_PATH = '/usr/bin/secret-tool'
/** secret-tool matches on ATTRIBUTES, not a service field — these are ours. */
export const SECRET_ATTRS = ['service', KEYCHAIN_SERVICE, 'account']

// Process-wide store for the memory fallback: a real keychain is shared by
// every keyring instance in the process, and consumers (the link flow, the
// service, tests) each build their own keyring — per-instance Maps would
// make a stored token invisible to the next reader. Still process-lifetime
// only; never a storage story.
const MEMORY_STORE = new Map()

function makeMemoryBackend() {
  console.warn(
    '[github-link] WARNING: no keyring backend available (no Tauri shell ' +
    'bridge, and no usable platform secret store — /usr/bin/security on ' +
    'macOS, secret-tool + a running Secret Service on Linux). The GitHub ' +
    'token will be held IN MEMORY ONLY and lost when this process exits.'
  )
  const mem = MEMORY_STORE
  return {
    backend: 'memory',
    async setSecret(account, secret) { mem.set(account, secret) },
    async getSecret(account) { return mem.get(account) ?? null },
    async deleteSecret(account) { mem.delete(account) },
  }
}

/**
 * libsecret backend. Two shapes differ from `security` and both matter:
 *  - the secret goes in on STDIN (`--label` + attrs on argv), so it never
 *    appears in the process table the way `-w <secret>` would;
 *  - `lookup` exits 1 with empty stdout when nothing matches, which is "unset",
 *    not an error.
 */
function makeSecretToolBackend(toolPath, runCapture) {
  const attrs = (account) => [...SECRET_ATTRS, account]
  return {
    backend: 'secret-tool',
    async setSecret(account, secret) {
      await runCapture(toolPath, ['store', '--label=' + KEYCHAIN_SERVICE + ': ' + account, ...attrs(account)], secret)
    },
    async getSecret(account) {
      try {
        const out = await runCapture(toolPath, ['lookup', ...attrs(account)])
        return out === '' ? null : out.replace(/\n$/, '')
      } catch (err) {
        // Exit 1 is how libsecret spells "no such secret". The word boundary is
        // load-bearing: `exited 127` (no dbus, no binary) must NOT read as an
        // empty store, or a broken keyring looks exactly like a signed-out user.
        if (/exited 1\b|No such secret/i.test(String(err?.message))) return null
        throw err
      }
    },
    async deleteSecret(account) {
      try {
        await runCapture(toolPath, ['clear', ...attrs(account)])
      } catch (err) {
        if (!/exited 1\b|No such secret/i.test(String(err?.message))) throw err
      }
    },
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

/** execFile that can feed stdin and returns stdout — secret-tool takes the
 *  secret on stdin so it never lands in the process table. */
function captureWithStdin(cmd, args, stdin) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} exited ${err.code ?? 'error'}: ${String(stderr).trim()}`))
      resolve(stdout)
    })
    child.stdin?.end(stdin ?? '')
  })
}

/**
 * Create the keyring. Options:
 *   bridge          — Tauri shell bridge with setSecret/getSecret/deleteSecret
 *   platform        — override process.platform (tests)
 *   securityPath    — override the macOS security binary path (tests force
 *                     memory with a nonexistent path)
 *   secretToolPath  — override the libsecret binary path (same)
 *   run             — injectable (cmd, args) => Promise<{stdout}> for `security`
 *   runSecret       — injectable (cmd, args, stdin) => Promise<string> for secret-tool
 *   probeStore      — injectable () => boolean usability probe (tests; default
 *                     is the real throwaway write against the platform store)
 */
export function createKeyring({ bridge, platform = process.platform, securityPath = SECURITY_PATH, secretToolPath = SECRET_TOOL_PATH, run, runSecret, probeStore } = {}) {
  if (bridge && typeof bridge.setSecret === 'function' && typeof bridge.getSecret === 'function' && typeof bridge.deleteSecret === 'function') {
    return makeBridgeBackend(bridge)
  }
  const runner = run ?? promisify(execFile)
  const capture = runSecret ?? captureWithStdin
  // Which store this platform HAS. Existence only — usability is probed lazily
  // below, because a binary that is present and refuses is the common case in
  // service contexts (a locked keychain, a session with no Secret Service).
  const linux = platform === 'linux'
  const storePath = linux ? secretToolPath : securityPath
  if (!fs.existsSync(storePath)) return makeMemoryBackend()
  // Probe on first use, not at plugin apply: the synchronous round-trips cost
  // 38ms on the engine's boot path (CPU profile, 2026-09-07) for a keyring most
  // boots never touch.
  let real = null
  const build = () => {
    if (linux) return (probeStore ?? (() => secretServiceUsable(secretToolPath)))() ? makeSecretToolBackend(secretToolPath, capture) : makeMemoryBackend()
    return (probeStore ?? (() => keychainUsable(securityPath)))() ? makeSecurityBackend(securityPath, runner) : makeMemoryBackend()
  }
  const backend = () => (real ??= build())
  return {
    get backend() { return backend().backend },
    setSecret: (account, secret) => backend().setSecret(account, secret),
    getSecret: (account) => backend().getSecret(account),
    deleteSecret: (account) => backend().deleteSecret(account),
  }
}

/**
 * Usability probe, not existence: /usr/bin/security exists on every macOS —
 * including service contexts (CI runners, launchd agents) where the user
 * keychain is locked or interaction is refused and every
 * add-generic-password fails. One throwaway round-trip up front routes those
 * environments to the memory fallback instead of failing the first real
 * store at runtime (seen on the self-hosted runner since 2026-09-02).
 */
function secretServiceUsable(toolPath) {
  const probeAccount = '__keyring_probe__'
  const attrs = ['service', KEYCHAIN_SERVICE, 'account', probeAccount]
  const set = spawnSync(toolPath, ['store', '--label=' + KEYCHAIN_SERVICE + ' probe', ...attrs],
    { input: 'probe', stdio: ['pipe', 'ignore', 'ignore'], timeout: PROBE_TIMEOUT_MS, killSignal: 'SIGKILL' })
  if (set.error || set.status !== 0) {
    console.warn(set.error?.code === 'ETIMEDOUT'
      ? `[github-link] WARNING: secret-tool did not answer within ${PROBE_TIMEOUT_MS}ms (a locked keyring waiting on a prompt?) — using the in-memory fallback for this process.`
      : '[github-link] WARNING: secret-tool is installed but no Secret Service accepted a probe write (no gnome-keyring/kwallet running, or the keyring is locked) — using the in-memory fallback for this process.')
    return false
  }
  spawnSync(toolPath, ['clear', ...attrs], { stdio: 'ignore', timeout: PROBE_TIMEOUT_MS, killSignal: 'SIGKILL' })
  return true
}

function keychainUsable(securityPath) {
  const probeAccount = '__keyring_probe__'
  const setProbe = spawnSync(securityPath,
    ['add-generic-password', '-s', KEYCHAIN_SERVICE, '-a', probeAccount, '-w', 'probe', '-U'],
    { stdio: 'ignore', timeout: PROBE_TIMEOUT_MS, killSignal: 'SIGKILL' })
  if (setProbe.error || setProbe.status !== 0) {
    const timedOut = setProbe.error?.code === 'ETIMEDOUT'
    console.warn(timedOut
      ? `[github-link] WARNING: /usr/bin/security did not answer within ${PROBE_TIMEOUT_MS}ms (no login keychain for this HOME, or securityd is waiting on something) — using the in-memory fallback for this process.`
      : '[github-link] WARNING: /usr/bin/security exists but the keychain refused a probe write — using the in-memory fallback for this process.')
    return false
  }
  spawnSync(securityPath,
    ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', probeAccount],
    { stdio: 'ignore', timeout: PROBE_TIMEOUT_MS, killSignal: 'SIGKILL' })
  return true
}
