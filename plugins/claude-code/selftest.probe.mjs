import { strict as assert } from 'node:assert'
import { resolveClaudeBinary, Probe } from './lib/probe.js'

let n = 0; const ok = (s) => { n++; console.log(`  ok ${s}`) }
// Stand-in for the confining spawner index.mjs builds from ctx.sandbox.confine.
const fakeSpawn = () => { throw new Error('selftest fake: no real child is ever started') }
const exists = (p) => ['/opt/bin/claude', '/sdk/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'].includes(p)

assert.equal(resolveClaudeBinary({ env: { PATH: '/nope:/opt/bin' }, platform: 'darwin', arch: 'arm64', exists, sdkRoot: '/sdk/node_modules/@anthropic-ai/claude-agent-sdk' }), '/opt/bin/claude'); ok('PATH wins')
assert.equal(resolveClaudeBinary({ env: { PATH: '/nope' }, platform: 'darwin', arch: 'arm64', exists, sdkRoot: '/sdk/node_modules/@anthropic-ai/claude-agent-sdk' }), '/sdk/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'); ok('bundled fallback')
assert.equal(resolveClaudeBinary({ env: { PATH: '/nope' }, platform: 'linux', arch: 'x64', exists, sdkRoot: '/sdk/node_modules/@anthropic-ai/claude-agent-sdk' }), undefined); ok('none → undefined')

function fakeQuery ({ init, account, models, fail }) {
  const factory = () => {
    factory.calls++
    const it = (async function * () {
      if (fail) throw new Error(fail)
      yield init
      await new Promise(() => {}) // never ends, like the real init-only stream
    })()
    it.accountInfo = async () => account
    it.supportedModels = async () => models
    it.close = () => {}
    return it
  }
  factory.calls = 0
  return factory
}

// A fake query whose stream never yields until the probe's own timeoutMs
// fires and calls abortController.abort() — proves Probe.run() wires the
// timeout/abort correctly and returns an error result instead of hanging.
// Also records the options it was called with, so a separate test can
// assert the Global Constraint options (permissionMode, settingSources)
// were actually sent — those flags are otherwise unobservable from outside.
function fakeAbortQuery () {
  const factory = ({ options }) => {
    factory.lastOptions = options
    const it = {
      [Symbol.asyncIterator] () { return this },
      next () {
        return new Promise((resolve) => {
          options.abortController.signal.addEventListener('abort', () => resolve({ done: true, value: undefined }), { once: true })
        })
      },
      accountInfo: async () => ({}),
      supportedModels: async () => [],
      close: () => {},
    }
    return it
  }
  return factory
}
const init = { type: 'system', subtype: 'init', apiKeySource: 'none', claude_code_version: '2.1.259', model: 'sonnet', tools: ['Read'], session_id: 's1' }
const models = [{ value: 'fable', displayName: 'Fable', description: 'd', supportedEffortLevels: ['high'] }]
let clock = 1000
const p = new Probe({ query: fakeQuery({ init, account: { email: 'e@x', subscriptionType: 'max' }, models }), binary: '/opt/bin/claude', env: {}, spawnClaudeCodeProcess: fakeSpawn, now: () => clock })
const a = await p.current()
assert.equal(a.loggedIn, true); assert.equal(a.version, '2.1.259'); assert.equal(a.subscriptionType, 'max'); assert.equal(a.email, 'e@x')
assert.equal(a.models[0].id, 'fable'); ok('signed-in probe')
clock += 1000
assert.equal(await p.current(), a); ok('cached inside ttl')
clock += 70_000
assert.notEqual(await p.current(), a); ok('refreshed after ttl')

const keyed = new Probe({ query: fakeQuery({ init: { ...init, apiKeySource: 'ANTHROPIC_API_KEY' }, account: {}, models }), binary: '/opt/bin/claude', env: {}, spawnClaudeCodeProcess: fakeSpawn, now: () => 0 })
const k = await keyed.current()
assert.equal(k.loggedIn, true); assert.equal(k.apiKeySource, 'ANTHROPIC_API_KEY'); ok('reports key source')

const down = new Probe({ query: fakeQuery({ fail: 'Not logged in · Please run /login' }), binary: '/opt/bin/claude', env: {}, spawnClaudeCodeProcess: fakeSpawn, now: () => 0 })
const d = await down.current()
assert.equal(d.loggedIn, false); assert.match(d.error, /Not logged in/); assert.equal(d.models.length, 4); ok('signed-out → static models + error')

const none = new Probe({ query: fakeQuery({ init, account: {}, models }), binary: undefined, env: {}, spawnClaudeCodeProcess: fakeSpawn, now: () => 0 })
const nb = await none.current()
assert.equal(nb.loggedIn, false); assert.match(nb.error, /no claude binary/); ok('no binary')

const forceQ = fakeQuery({ init, account: { email: 'e@x', subscriptionType: 'max' }, models })
const forceProbe = new Probe({ query: forceQ, binary: '/opt/bin/claude', env: {}, spawnClaudeCodeProcess: fakeSpawn, now: () => 0 })
const f1 = await forceProbe.current()
assert.equal(forceQ.calls, 1)
const f2 = await forceProbe.current()
assert.equal(forceQ.calls, 1); assert.equal(f2, f1) // still cached, no new call
const f3 = await forceProbe.current(true)
assert.equal(forceQ.calls, 2); assert.notEqual(f3, f1) // force bypasses cache and re-queries
ok('current(true) bypasses cache and re-queries')

const t0 = Date.now()
const abortQuery = fakeAbortQuery()
const timeoutProbe = new Probe({ query: abortQuery, binary: '/opt/bin/claude', env: {}, spawnClaudeCodeProcess: fakeSpawn, now: () => 0, timeoutMs: 20 })
let backstopTimer
const timeoutResult = await Promise.race([
  timeoutProbe.current(),
  new Promise((_, reject) => { backstopTimer = setTimeout(() => reject(new Error('timeout test hung past backstop')), 1000) }),
])
clearTimeout(backstopTimer) // race already settled; don't let the loser keep the event loop alive
const elapsed = Date.now() - t0
assert.equal(timeoutResult.loggedIn, false); assert.match(timeoutResult.error, /no init message/)
assert.ok(elapsed < 500, `probe should resolve near timeoutMs (20ms), took ${elapsed}ms`)
// Lower bound proves the abort is what released current() — a fake that resolved
// {done: true} immediately (bypassing timeoutMs entirely) would pass the upper
// bound identically, and the test would no longer be testing the timeout.
assert.ok(elapsed >= 20, `probe should not settle before timeoutMs, took ${elapsed}ms`)
ok('timeoutMs aborts a never-yielding stream and returns an error, not a hang')

// The Global Constraint options (permissionMode, settingSources) are otherwise
// unobservable from any test — assert them off the fake query's recorded call.
assert.equal(abortQuery.lastOptions.permissionMode, 'default')
assert.deepEqual(abortQuery.lastOptions.settingSources, [])
ok('probe query sets permissionMode: default and settingSources: []')

// D5: the probe child is confined like every other. `adapter.js`'s base() passes a
// spawnClaudeCodeProcess and the probe used not to — which meant the real `claude`
// binary launched outside arxa's sandbox on listModels, on resolveModel, on every
// stream(), and up to 200 times per sign-in poll (auth-flow.js:15).
assert.equal(abortQuery.lastOptions.spawnClaudeCodeProcess, fakeSpawn)
ok('probe query carries the injected spawnClaudeCodeProcess — the child starts confined')

// Structural, not advisory: a Probe built without a spawner cannot exist, so the
// unconfined-launch path is unreachable rather than merely unused.
assert.throws(
  () => new Probe({ query: abortQuery, binary: '/opt/bin/claude', env: {} }),
  /spawnClaudeCodeProcess is required/,
)
ok('constructing a Probe without a spawner throws instead of running unconfined')

console.log(`selftest.probe: ${n} ok`)
