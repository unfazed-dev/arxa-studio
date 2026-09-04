import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { PROVIDER_NAME } from './models.js'

export const ACCOUNT_KEY = credentialKey('claude-code', 'account')
const LOGIN_CMD = 'claude auth login'

/** D6: arxa never launches login. It shows the command and re-checks until the CLI is signed in. */
export function claudeAuthFlow ({ probe, credentials, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pollMs = 3000, maxPolls = 200 }) {
  return {
    key: ACCOUNT_KEY,
    label: PROVIDER_NAME,
    methods: [{ id: 'cli', label: 'Sign in with the claude CLI' }],
    async run (session) {
      session.notify({ message: `In a terminal run \`${LOGIN_CMD}\` and finish the browser sign-in. arxa checks every ${pollMs / 1000}s.`, code: LOGIN_CMD })
      for (let i = 0; i < maxPolls; i++) {
        if (session.signal.aborted) throw new Error('claude-code: sign-in cancelled')
        const a = await probe.current(true)
        if (a.loggedIn) {
          await credentials.modifyRecord(ACCOUNT_KEY, async () => ({ kind: 'grant', payload: { email: a.email, subscriptionType: a.subscriptionType, version: a.version } }))
          session.notify({ message: `Signed in as ${a.email} (${a.subscriptionType}). Claude Code ${a.version}.` })
          return
        }
        await sleep(pollMs)
      }
      throw new Error('claude-code: sign-in not detected; run the command and try again')
    },
  }
}

export const ANTHROPIC_PIAI_KEY = credentialKey('llm-pi-ai', 'anthropic')

/** D1: pi-ai's Anthropic OAuth is the Claude Code client-id spoof Anthropic forbids. Keep the API-key method. */
export function stripOauthMethod (flow) {
  if (flow.key !== ANTHROPIC_PIAI_KEY) return undefined
  return { ...flow, methods: flow.methods.filter((m) => m.id !== 'oauth') }
}

// cordis/lib/index.js:38 — `Symbol.for("cordis.original")` on a traceable proxy returns the
// raw service instance. Read via Symbol.for rather than an import so a second copy of cordis
// on disk still resolves to the same well-known symbol.
const CORDIS_ORIGINAL = Symbol.for('cordis.original')
// Re-applying the patch (an HMR reload of arxa's plugin) must not stack wrappers on a service
// that now outlives us.
const PATCHED = Symbol.for('arxa.claude-code.hideAnthropicOauth')

export function hideAnthropicOauth (authorization) {
  const fix = (flow) => {
    const s = stripOauthMethod(flow); if (s === undefined) return flow
    return s.methods.length === 0 ? null : s
  }
  const existing = authorization.flows?.get?.(ANTHROPIC_PIAI_KEY)
  if (existing) { const f = fix(existing); f ? authorization.flows.set(ANTHROPIC_PIAI_KEY, f) : authorization.flows.delete(ANTHROPIC_PIAI_KEY) }

  // Patch the RAW service, and forward the CALLER's receiver.
  //
  // `authorization` is arxa's traceable proxy. Reading a method off it hands back a
  // shadow-bound function whose `this.ctx` is arxa's ctx (cordis/lib/index.js:141-144), and
  // `registerFlow` does its work in `this.ctx.effect(...)` (dsh-authorization:76). So the old
  // `.bind(authorization)` made every LATER caller's flow an arxa-owned effect: disposing
  // arxa's plugin withdrew `llm-pi-ai/anthropic` outright, and under cordis-plugin-hmr an arxa
  // reload silently dropped Anthropic API-key sign-in until a full restart.
  //
  // Two changes together fix that. Patching `[CORDIS_ORIGINAL]` puts the wrapper on the shared
  // instance instead of behind arxa's shadow, and a NON-ARROW wrapper keeps `this` as whatever
  // receiver the caller used — pi-ai's own shadow when pi-ai calls it — so `this.ctx.effect`
  // parents the flow on pi-ai's fiber, where it belongs.
  const service = authorization[CORDIS_ORIGINAL] ?? authorization
  if (service[PATCHED]) return
  const original = service.registerFlow
  service.registerFlow = function registerFlow (flow) {
    const f = fix(flow)
    // A hidden flow still owes the caller a disposer; it just has nothing to withdraw.
    if (f === null) return () => {}
    // `this ?? service` covers a detached call, where there is no receiver to preserve.
    return original.call(this ?? service, f)
  }
  service[PATCHED] = true
}
