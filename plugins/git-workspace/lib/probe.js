// Startup probe for system git (git-capability-audit.md Recommendation).
// End-user machines are assumed minimal: detect git presence + version
// ONCE, cache the result, and expose a clear disabled state. When git is
// absent the tree rail runs without the git rail — every API in this
// plugin throws GitUnavailableError (with a user-facing reason) instead
// of crashing. No isomorphic-git emulation.

import { execFileSync } from 'node:child_process'

/** Thrown by every git-backed API when the probe found no usable git. */
export class GitUnavailableError extends Error {
  constructor(reason) {
    super(`git unavailable — ${reason}`)
    this.name = 'GitUnavailableError'
    this.reason = reason
  }
}

/** Override the binary with ARXA_GIT_BIN (also how selftest simulates absence). */
export function gitBin(env = process.env) {
  return env.ARXA_GIT_BIN || 'git'
}

let cachedProbe = null

/**
 * Detect system git once. Returns
 * `{ available, version, reason }` — `reason` is the user-facing
 * explanation when `available` is false.
 */
export function probeGit(env = process.env) {
  if (cachedProbe) return cachedProbe
  const bin = gitBin(env)
  try {
    const out = execFileSync(bin, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const m = out.match(/git version (\d+(?:\.\d+)*)/)
    if (!m) {
      cachedProbe = {
        available: false,
        version: null,
        reason: `"${bin} --version" did not identify itself as git`,
      }
    } else {
      cachedProbe = { available: true, version: m[1], reason: null }
    }
  } catch {
    cachedProbe = {
      available: false,
      version: null,
      reason: `system git not found (tried "${bin}") — version history is disabled; install git to enable it`,
    }
  }
  return cachedProbe
}

/** Forget the cached probe (selftest only — the probe is per-process). */
export function resetProbe() {
  cachedProbe = null
}

/** Gate for every git-backed API: returns the probe or throws. */
export function ensureGit(env = process.env) {
  const probe = probeGit(env)
  if (!probe.available) throw new GitUnavailableError(probe.reason)
  return probe
}
