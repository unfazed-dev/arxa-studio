// Binary resolution and the SDK init probe for the claude-code provider.
// Finds the claude binary, then uses the never-yielding-prompt trick to reach
// the system/init message without spending a turn, and reads accountInfo()
// and supportedModels() off it. No network call happens outside the injected
// `query`; callers are responsible for passing a real SDK `query` in production.
import { delimiter, join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { STATIC_MODELS, modelsFromSdk } from './models.js'

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
   * can observe it, exactly like `query` and `now`; a missing one throws at construction so
   * the guarantee is structural instead of a comment. */
  constructor ({ query, binary, env, spawnClaudeCodeProcess, ttlMs = 60_000, now = Date.now, timeoutMs = 15_000 }) {
    if (typeof spawnClaudeCodeProcess !== 'function') {
      throw new TypeError('Probe: spawnClaudeCodeProcess is required — the probe child must never run outside arxa\'s sandbox')
    }
    Object.assign(this, { query, binary, env, spawnClaudeCodeProcess, ttlMs, now, timeoutMs }); this.cache = undefined
  }

  async current (force = false) {
    if (!force && this.cache && this.now() - this.cache.checkedAt < this.ttlMs) return this.cache
    this.cache = await this.run(); return this.cache
  }

  async run () {
    const checkedAt = this.now()
    if (!this.binary) return { loggedIn: false, error: 'no claude binary on PATH and no bundled binary', models: STATIC_MODELS, checkedAt }
    const abort = new AbortController()
    const q = this.query({
      prompt: never,
      options: {
        pathToClaudeCodeExecutable: this.binary, env: this.env, settingSources: [], persistSession: false,
        maxTurns: 0, abortController: abort, tools: [], systemPrompt: { type: 'custom', prompt: 'probe' },
        permissionMode: 'default', spawnClaudeCodeProcess: this.spawnClaudeCodeProcess,
      },
    })
    const timer = setTimeout(() => abort.abort(), this.timeoutMs)
    try {
      const { value: init } = await q[Symbol.asyncIterator]().next()
      if (!init || init.type !== 'system' || init.subtype !== 'init') throw new Error('probe: no init message')
      const [account, models] = await Promise.all([q.accountInfo(), q.supportedModels()])
      return {
        // apiKeySource is left undefined, not defaulted to 'none', if the init message
        // omits it — Task 9 refuses the turn on `apiKeySource !== 'none'`, so a missing
        // signal already fails closed. Defaulting to 'none' here would fail open instead.
        loggedIn: true, version: init.claude_code_version, apiKeySource: init.apiKeySource,
        email: account.email, subscriptionType: account.subscriptionType,
        models: models.length ? modelsFromSdk(models) : STATIC_MODELS, checkedAt,
      }
    } catch (err) {
      return { loggedIn: false, error: String(err?.message ?? err), models: STATIC_MODELS, checkedAt }
    } finally { clearTimeout(timer); q.close?.() }
  }
}
