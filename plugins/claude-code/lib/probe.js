// Binary resolution and the SDK init probe for the claude-code provider.
// Finds the claude binary, then uses the SDK startup() handshake to reach
// the system/init message without spending a turn, and reads accountInfo()
// and supportedModels() off it. No network call happens outside the injected
// `query`; callers are responsible for passing a real SDK `query` in production.
import { delimiter, join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { STATIC_MODELS, modelsFromSdk } from './models.js'
import { fetchUsageStatuses } from './usage.js'

export function resolveClaudeBinary ({ env, platform, arch, exists = existsSync, sdkRoot }) {
  const exe = platform === 'win32' ? 'claude.exe' : 'claude'
  for (const dir of String(env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const p = join(dir, exe); if (exists(p)) return p
  }
  const bundled = join(dirname(sdkRoot), `claude-agent-sdk-${platform}-${arch}`, exe)
  return exists(bundled) ? bundled : undefined
}

// An async-iterable prompt stream that never yields a value — reaching the
// SDK's system/init message costs nothing because no user turn is ever sent.
const never = { [Symbol.asyncIterator] () { return { next: () => new Promise(() => {}) } } }

export class Probe {
  /** `spawnClaudeCodeProcess` is REQUIRED, not optional. D5 says no Claude child ever runs
   * outside arxa's sandbox, and the probe is the busiest child of all: it runs on
   * `listModels`, on `resolveModel`, on every `stream()`, and `auth-flow.js` polls it up to
   * 200 times while the user sits at the sign-in screen. Left out, every one of those was a
   * real `claude` binary launched unconfined. Injected rather than built here so the selftest
   * can observe it, exactly like `startup` and `now`; a missing one throws at construction so
   * the guarantee is structural instead of a comment. */
  constructor ({ startup, binary, env, spawnClaudeCodeProcess, ttlMs = 60_000, now = Date.now, timeoutMs = 15_000 }) {
    if (typeof spawnClaudeCodeProcess !== 'function') {
      throw new TypeError('Probe: spawnClaudeCodeProcess is required — the probe child must never run outside arxa\'s sandbox')
    }
    Object.assign(this, { startup, binary, env, spawnClaudeCodeProcess, ttlMs, now, timeoutMs }); this.cache = undefined
  }

  async current (force = false) {
    if (!force && this.cache && this.now() - this.cache.checkedAt < this.ttlMs) return this.cache
    this.cache = await this.run(); return this.cache
  }

  async run () {
    const checkedAt = this.now()
    if (!this.binary) return { loggedIn: false, error: 'no claude binary on PATH and no bundled binary', models: STATIC_MODELS, checkedAt }
    let warm
    try {
      warm = await this.warmStart()
      // The prompt never yields, so no turn starts and no tokens are spent: accountInfo and
      // supportedModels are control requests over the channel startup() already opened.
      const q = warm.query(never)
      const [account, models, version] = await Promise.all([q.accountInfo(), q.supportedModels(), this.readVersion()])
      return {
        // The authoritative API-key refusal lives in bridge.js, on the init message of each
        // real turn. apiProvider is the probe's own signal ('firstParty' means Anthropic
        // OAuth — the subscription arxa requires). Neither field is defaulted: a missing
        // signal stays missing rather than reading as approval.
        loggedIn: true, version, apiKeySource: account.apiKeySource, apiProvider: account.apiProvider,
        email: account.email, subscriptionType: account.subscriptionType,
        models: models.length ? modelsFromSdk(models) : STATIC_MODELS, checkedAt,
      }
    } catch (err) {
      return { loggedIn: false, error: String(err?.message ?? err), models: STATIC_MODELS, checkedAt }
    } finally { try { warm?.close() } catch { /* already closed */ } }
  }

  /** startup() spawns the CLI and completes the initialize handshake itself, which is what
   * makes this bounded. The older pattern handed a never-yielding prompt to query() and
   * waited for a `system/init` message — but the CLI does not emit init until a prompt
   * actually arrives, so every probe stalled to its full timeout and reported a signed-in
   * user as signed out, with the model picker falling back to STATIC_MODELS. */
  async warmStart () {
    // startup() plus a reaper. The SDK's close() destroys the child's stdin and stops there; a
    // sandbox-exec'd claude sits on the dead socket instead of exiting (2026-09-05: two children
    // still alive 3s after close(), nine idle under one engine after a day of probes). So every
    // child a handle spawned is remembered and killed when the handle closes — or when startup()
    // itself throws, which is where a timed-out handshake used to leak the child for good.
    const children = new Set()
    const spawnClaudeCodeProcess = (request) => {
      const child = this.spawnClaudeCodeProcess(request)
      children.add(child)
      child.on?.('exit', () => children.delete(child))
      return child
    }
    const reap = () => {
      for (const child of children) { try { child.kill('SIGTERM') } catch { /* already gone */ } }
      children.clear()
    }
    let warm
    try {
      warm = await this.startup({
        options: {
          pathToClaudeCodeExecutable: this.binary, env: this.env, settingSources: [], persistSession: false,
          systemPrompt: { type: 'custom', prompt: 'probe' }, permissionMode: 'default',
          spawnClaudeCodeProcess,
        },
        initializeTimeoutMs: this.timeoutMs,
      })
    } catch (err) { reap(); throw err }
    return {
      query: (prompt) => warm.query(prompt),
      close: () => { try { warm.close() } finally { reap() } },
    }
  }

  /** The plan's `/usage` windows WITHOUT a turn — the provider-status poller's reader for
   * claude-code, so the ring is live the moment a Claude model is picked in any session.
   * Reuses the probe's (cached) signed-in verdict first: a signed-out user costs no child and
   * reads as "not configured" (no ring), not as a `?`. Anything else throws to the poller,
   * which renders the `?`. Same warm handle, same sandboxed spawner, closed in finally. */
  async usage () {
    const account = await this.current()
    if (!account.loggedIn) return { statuses: [], configured: false }
    let warm
    try {
      warm = await this.warmStart()
      const statuses = await fetchUsageStatuses(warm.query(never))
      return { statuses, configured: true }
    } finally { try { warm?.close() } catch { /* already closed */ } }
  }

  /** CLI version, for adapter.js's Fable minimum-version gate. The init message used to
   *  carry claude_code_version; startup() exposes no equivalent, so ask the binary — through
   *  the same confining spawner, never unconfined. Returns undefined rather than throwing:
   *  a missing version must not turn a signed-in probe into a signed-out one. */
  async readVersion () {
    try {
      const child = this.spawnClaudeCodeProcess({ command: this.binary, args: ['--version'], env: this.env })
      let out = ''
      child.stdout?.on('data', (d) => { out += d })
      const code = await new Promise((res) => { child.on('error', () => res(-1)); child.on('exit', res) })
      return code === 0 ? out.trim().match(/[0-9]+\.[0-9]+\.[0-9]+/)?.[0] : undefined
    } catch { return undefined }
  }
}
