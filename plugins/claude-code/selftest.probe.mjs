import { strict as assert } from 'node:assert'
import { resolveClaudeBinary, Probe } from './lib/probe.js'

let passed = 0
const ok = (msg) => { passed++; console.log(`ok ${passed} - ${msg}`) }

const exists = (p) => ['/opt/bin/claude', '/sdk/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'].includes(p)
const SDK = '/sdk/node_modules/@anthropic-ai/claude-agent-sdk'

assert.equal(resolveClaudeBinary({ env: { PATH: '/nope:/opt/bin' }, platform: 'darwin', arch: 'arm64', exists, sdkRoot: SDK }), '/opt/bin/claude'); ok('PATH wins')
assert.equal(resolveClaudeBinary({ env: { PATH: '/nope' }, platform: 'darwin', arch: 'arm64', exists, sdkRoot: SDK }), '/sdk/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'); ok('bundled fallback')
assert.equal(resolveClaudeBinary({ env: { PATH: '/nope' }, platform: 'linux', arch: 'x64', exists, sdkRoot: SDK }), undefined); ok('none → undefined')

// A stand-in for the SDK's startup(). The critical detail is the stream it hands back:
// the real CLI emits NO `system/init` message until a prompt actually yields, and the
// probe's prompt never yields. So this fake's iterator never settles. Any implementation
// that goes back to awaiting the message stream hangs here instead of passing — which is
// exactly the regression that shipped, because the previous fake yielded an init the real
// binary never sends.
function fakeStartup ({ account = {}, models = [], fail, hang } = {}) {
  const factory = async ({ options, initializeTimeoutMs }) => {
    factory.calls++; factory.lastOptions = options; factory.lastTimeoutMs = initializeTimeoutMs
    if (fail) throw new Error(fail)
    // The SDK rejects startup() once initializeTimeoutMs elapses; model that, don't hang forever.
    if (hang) { await new Promise((r) => setTimeout(r, initializeTimeoutMs)); throw new Error('initialize timed out') }
    return {
      query: () => ({
        [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
        accountInfo: async () => account,
        supportedModels: async () => models,
      }),
      close: () => { factory.closed++ },
    }
  }
  factory.calls = 0; factory.closed = 0
  return factory
}

// The confining spawner, used now for `claude --version` as well as the CLI itself.
const versionSpawn = (out = '2.1.260 (Claude Code)\n', code = 0) => {
  const fn = (opts) => {
    fn.lastArgs = opts.args
    const child = {
      stdout: { on: (_e, cb) => { setImmediate(() => cb(Buffer.from(out))) } },
      on: (e, cb) => { if (e === 'exit') setImmediate(() => cb(code)); return child },
    }
    return child
  }
  return fn
}
const deadSpawn = () => { throw new Error('selftest fake: no real child is ever started') }
const models = [{ value: 'fable', displayName: 'Fable', description: 'd', supportedEffortLevels: ['high'] }]
const account = { email: 'e@x', subscriptionType: 'max', apiProvider: 'firstParty' }

// A backstop so a reintroduced stream-await fails the suite instead of hanging it forever.
const bounded = async (promise, ms = 1000, what = 'probe') => {
  let t
  try {
    return await Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what} hung past backstop`)), ms) })])
  } finally { clearTimeout(t) }
}

let clock = 1000
const startup = fakeStartup({ account, models })
const p = new Probe({ startup, binary: '/opt/bin/claude', env: {}, spawnClaudeCodeProcess: versionSpawn(), now: () => clock })
const a = await bounded(p.current())
assert.equal(a.loggedIn, true); assert.equal(a.subscriptionType, 'max'); assert.equal(a.email, 'e@x')
assert.equal(a.models[0].id, 'fable'); ok('signed-in probe resolves though init never arrives')
assert.equal(a.version, '2.1.260'); ok('version comes from the confined `claude --version` child')
assert.equal(a.apiProvider, 'firstParty'); ok('reports apiProvider (firstParty = Anthropic OAuth)')
assert.equal(startup.closed, 1); ok('warm handle closed after the probe')

clock += 1000
assert.equal(await p.current(), a); ok('cached inside ttl')
clock += 70_000
assert.notEqual(await bounded(p.current()), a); ok('refreshed after ttl')

const forceS = fakeStartup({ account, models })
const forceProbe = new Probe({ startup: forceS, binary: '/opt/bin/claude', env: {}, spawnClaudeCodeProcess: versionSpawn(), now: () => 0 })
const f1 = await bounded(forceProbe.current())
assert.equal(forceS.calls, 1)
await forceProbe.current()
assert.equal(forceS.calls, 1); ok('current() reuses the cache')
const f3 = await bounded(forceProbe.current(true))
assert.equal(forceS.calls, 2); assert.notEqual(f3, f1); ok('current(true) bypasses cache and re-probes')

const down = new Probe({ startup: fakeStartup({ fail: 'Not logged in · Please run /login' }), binary: '/opt/bin/claude', env: {}, spawnClaudeCodeProcess: versionSpawn(), now: () => 0 })
const d = await bounded(down.current())
assert.equal(d.loggedIn, false); assert.match(d.error, /Not logged in/); assert.equal(d.models.length, 4); ok('signed-out → static models + error')

const none = new Probe({ startup: fakeStartup({ account, models }), binary: undefined, env: {}, spawnClaudeCodeProcess: deadSpawn, now: () => 0 })
const nb = await none.current()
assert.equal(nb.loggedIn, false); assert.match(nb.error, /no claude binary/); ok('no binary')

// A version lookup that fails must not demote a signed-in user to signed-out: the Fable
// gate loses its input, but sign-in state does not depend on it.
const noVer = new Probe({ startup: fakeStartup({ account, models }), binary: '/opt/bin/claude', env: {}, spawnClaudeCodeProcess: deadSpawn, now: () => 0 })
const nv = await bounded(noVer.current())
assert.equal(nv.loggedIn, true); assert.equal(nv.version, undefined); ok('failed --version leaves loggedIn true, version undefined')

const t0 = Date.now()
const hung = new Probe({ startup: fakeStartup({ hang: true }), binary: '/opt/bin/claude', env: {}, spawnClaudeCodeProcess: versionSpawn(), now: () => 0, timeoutMs: 20 })
const hr = await bounded(hung.current())
const elapsed = Date.now() - t0
assert.equal(hr.loggedIn, false); assert.match(hr.error, /timed out/)
assert.ok(elapsed >= 20, `should not settle before timeoutMs, took ${elapsed}ms`)
assert.ok(elapsed < 500, `should settle near timeoutMs, took ${elapsed}ms`)
ok('initialize timeout returns an error result, not a hang')

// Global Constraint options are otherwise unobservable — assert them off the recorded call.
assert.equal(startup.lastOptions.permissionMode, 'default')
assert.deepEqual(startup.lastOptions.settingSources, [])
ok('probe sets permissionMode: default and settingSources: []')
assert.equal(startup.lastTimeoutMs, 15_000); ok('probe bounds startup with initializeTimeoutMs')

// D5: the probe child is confined like every other. The real `claude` binary must never
// launch outside arxa's sandbox — on listModels, resolveModel, or a sign-in poll.
assert.equal(typeof startup.lastOptions.spawnClaudeCodeProcess, 'function')
ok('probe carries the injected spawnClaudeCodeProcess — the child starts confined')

// Structural, not advisory: a Probe built without a spawner cannot exist, so the
// unconfined-launch path is unreachable rather than merely unused.
assert.throws(() => new Probe({ startup, binary: '/opt/bin/claude', env: {} }), /spawnClaudeCodeProcess is required/)
ok('Probe without a spawner throws at construction')

console.log(`# ${passed} ok`)
