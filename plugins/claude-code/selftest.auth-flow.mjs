import { strict as assert } from 'node:assert'
import { claudeAuthFlow, ACCOUNT_KEY, stripOauthMethod, hideAnthropicOauth, ANTHROPIC_PIAI_KEY } from './lib/auth-flow.js'

let n = 0; const ok = (s) => { n++; console.log(`  ok ${s}`) }
const notices = [], records = []
const credentials = { modifyRecord: async (key, mutate) => { records.push([key, await mutate(undefined)]) } }
let calls = 0
const forces = []
const probe = { current: async (force) => { calls++; forces.push(force); return calls < 3 ? { loggedIn: false, error: 'Not logged in' } : { loggedIn: true, email: 'e@x', subscriptionType: 'max', version: '2.1.259' } } }
const flow = claudeAuthFlow({ probe, credentials, sleep: async () => {}, pollMs: 1 })
assert.equal(flow.key, ACCOUNT_KEY); assert.equal(flow.label, 'Claude Code (your subscription)')
assert.deepEqual(flow.methods, [{ id: 'cli', label: 'Sign in with the claude CLI' }]); ok('flow shape')
await flow.run({ method: 'cli', signal: new AbortController().signal, notify: (x) => notices.push(x), prompt: async () => '' })
assert.match(notices[0].message, /claude auth login/); assert.equal(notices[0].code, 'claude auth login')
assert.match(notices.at(-1).message, /Signed in as e@x \(max\)/)
assert.deepEqual(records[0], [ACCOUNT_KEY, { kind: 'grant', payload: { email: 'e@x', subscriptionType: 'max', version: '2.1.259' } }]); ok('polls until signed in, commits the record')
assert.deepEqual(forces, [true, true, true]); ok('every poll forces a fresh probe (bypasses the TTL cache)')

const ac = new AbortController(); ac.abort()
const never = claudeAuthFlow({ probe: { current: async () => ({ loggedIn: false }) }, credentials, sleep: async () => {}, pollMs: 1 })
await assert.rejects(never.run({ method: 'cli', signal: ac.signal, notify: () => {}, prompt: async () => '' }), /cancelled/); ok('abort → rejects')

// Beyond the brief's Step 1 test: coverage the dispatch explicitly asked for.

// Already signed in on the very first poll — no sleep, exactly one probe call, one record.
const alreadyRecords = []
const alreadyCredentials = { modifyRecord: async (key, mutate) => { alreadyRecords.push([key, await mutate(undefined)]) } }
let alreadyCalls = 0
const alreadyForces = []
const alreadyProbe = { current: async (force) => { alreadyCalls++; alreadyForces.push(force); return { loggedIn: true, email: 'a@x', subscriptionType: 'pro', version: '2.1.260' } } }
const alreadyFlow = claudeAuthFlow({ probe: alreadyProbe, credentials: alreadyCredentials, sleep: async () => { throw new Error('sleep must not be called') }, pollMs: 1 })
await alreadyFlow.run({ method: 'cli', signal: new AbortController().signal, notify: () => {}, prompt: async () => '' })
assert.equal(alreadyCalls, 1); assert.equal(alreadyRecords.length, 1); assert.equal(alreadyRecords[0][1].payload.email, 'a@x')
assert.deepEqual(alreadyForces, [true]); ok('probe forced fresh even on the first poll')
ok('already signed in on the first poll — no sleep, one probe call, one record')

// maxPolls exhausted: never signs in → rejects with a clear error, never resolves as success, no credential written.
let exhaustedSleeps = 0
const exhaustedRecords = []
const exhaustedCredentials = { modifyRecord: async (key, mutate) => { exhaustedRecords.push([key, await mutate(undefined)]) } }
const exhaustedProbe = { current: async () => ({ loggedIn: false, error: 'Not logged in' }) }
const exhaustedFlow = claudeAuthFlow({ probe: exhaustedProbe, credentials: exhaustedCredentials, sleep: async () => { exhaustedSleeps++ }, pollMs: 1, maxPolls: 4 })
await assert.rejects(exhaustedFlow.run({ method: 'cli', signal: new AbortController().signal, notify: () => {}, prompt: async () => '' }), /not detected/)
assert.equal(exhaustedSleeps, 4); assert.equal(exhaustedRecords.length, 0)
ok('maxPolls exhausted → rejects with a clear error, loop terminates, no credential written')

// Abort mid-poll (after at least one real poll, not just a pre-aborted signal) stops promptly and writes nothing.
const midRecords = []
const midCredentials = { modifyRecord: async (key, mutate) => { midRecords.push([key, await mutate(undefined)]) } }
const midController = new AbortController()
let midPolls = 0
const midProbe = { current: async () => { midPolls++; if (midPolls === 1) return { loggedIn: false }; midController.abort(); return { loggedIn: false } } }
const midFlow = claudeAuthFlow({ probe: midProbe, credentials: midCredentials, sleep: async () => {}, pollMs: 1 })
await assert.rejects(midFlow.run({ method: 'cli', signal: midController.signal, notify: () => {}, prompt: async () => '' }), /cancelled/)
assert.equal(midPolls, 2); assert.equal(midRecords.length, 0)
ok('abort mid-poll stops the loop promptly, no credential written')

// Task 11: pi-ai's Anthropic OAuth is a Claude Code client-id spoof — arxa hides it from the
// login list, both when pi-ai's flow is already registered and when it registers afterward.
{
  const flow = { key: ANTHROPIC_PIAI_KEY, label: 'Anthropic', methods: [{ id: 'oauth', label: 'Claude.ai' }, { id: 'api-key', label: 'API key' }], run: async () => {} }
  const s = stripOauthMethod(flow)
  assert.deepEqual(s.methods, [{ id: 'api-key', label: 'API key' }]); assert.equal(s.run, flow.run)
  assert.equal(stripOauthMethod({ ...flow, key: 'llm-pi-ai/openai' }), undefined, 'other providers untouched → undefined means leave alone'); ok('stripOauthMethod')

  // already registered before us
  const flows = new Map([[ANTHROPIC_PIAI_KEY, flow]])
  const svc = { flows, registerFlow (f) { this.flows.set(f.key, f); return () => this.flows.delete(f.key) } }
  hideAnthropicOauth(svc)
  assert.deepEqual(flows.get(ANTHROPIC_PIAI_KEY).methods.map((m) => m.id), ['api-key']); ok('patches an existing flow')
  // registered after us
  flows.clear()
  svc.registerFlow({ ...flow })
  assert.deepEqual(flows.get(ANTHROPIC_PIAI_KEY).methods.map((m) => m.id), ['api-key']); ok('wraps later registrations')
  // oauth-only flow would become method-less → dropped entirely
  flows.clear()
  svc.registerFlow({ ...flow, methods: [{ id: 'oauth', label: 'x' }] })
  assert.equal(flows.has(ANTHROPIC_PIAI_KEY), false); ok('oauth-only flow dropped')
}

// ── the patch must not steal ownership of every later caller's flow ─────────────
// `registerFlow` registers inside `this.ctx.effect(...)`, so whichever ctx is `this`
// OWNS the flow and withdraws it on disposal. Reading the method off arxa's traceable
// proxy hands back a shadow bound to ARXA's ctx — the old `.bind(authorization)` — which
// made pi-ai's Anthropic row an arxa-owned effect: disposing arxa's plugin removed
// `llm-pi-ai/anthropic` entirely, so under cordis-plugin-hmr an arxa reload silently
// dropped Anthropic API-key sign-in until a full restart.
{
  const CORDIS_ORIGINAL = Symbol.for('cordis.original')
  // A faithful-enough stand-in for cordis' traceable proxy: `[CORDIS_ORIGINAL]` yields the
  // raw instance, and a method read through it comes back bound to THAT scope's shadow.
  const raw = {
    flows: new Map(),
    registerFlow (flow) { this.ctx.owned.push(flow.key); this.flows.set(flow.key, flow); return () => this.flows.delete(flow.key) },
  }
  const proxyFor = (ctx) => new Proxy(raw, {
    get: (target, prop, receiver) => {
      if (prop === CORDIS_ORIGINAL) return target
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind({ ...target, ctx, flows: target.flows }) : value
    },
    set: (target, prop, value) => Reflect.set(target, prop, value),
  })
  const arxaCtx = { owned: [] }
  const piCtx = { owned: [] }

  hideAnthropicOauth(proxyFor(arxaCtx))

  const anthropic = { key: ANTHROPIC_PIAI_KEY, label: 'Anthropic', methods: [{ id: 'oauth', label: 'Claude.ai' }, { id: 'api-key', label: 'API key' }], run: async () => {} }
  proxyFor(piCtx).registerFlow(anthropic)
  proxyFor(piCtx).registerFlow({ key: 'llm-pi-ai/openai', label: 'OpenAI', methods: [{ id: 'api-key', label: 'API key' }], run: async () => {} })

  assert.deepEqual(arxaCtx.owned, [], 'arxa must own none of pi-ai\'s flows')
  assert.deepEqual(piCtx.owned, [ANTHROPIC_PIAI_KEY, 'llm-pi-ai/openai'])
  ok('a later caller\'s flow stays parented on the CALLER\'s fiber, not arxa\'s')

  // The hide itself is untouched by the receiver fix.
  assert.deepEqual(raw.flows.get(ANTHROPIC_PIAI_KEY).methods.map((m) => m.id), ['api-key'])
  ok('the Claude.ai OAuth method is still stripped when the flow arrives through a proxy')

  // Re-applying (an HMR reload of arxa) must not stack wrappers on a service that
  // now outlives arxa's fiber.
  const wrapped = raw.registerFlow
  hideAnthropicOauth(proxyFor(arxaCtx))
  assert.equal(raw.registerFlow, wrapped, 're-applying the hide must be a no-op, not a second wrapper')
  ok('re-applying the hide does not stack wrappers across a reload')
}

console.log(`selftest.auth-flow: ${n} ok`)
