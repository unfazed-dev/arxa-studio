import { strict as assert } from 'node:assert'
import { resolveClaudeBinary, Probe } from './lib/probe.js'

let n = 0; const ok = (s) => { n++; console.log(`  ok ${s}`) }
const exists = (p) => ['/opt/bin/claude', '/sdk/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'].includes(p)

assert.equal(resolveClaudeBinary({ env: { PATH: '/nope:/opt/bin' }, platform: 'darwin', arch: 'arm64', exists, sdkRoot: '/sdk/node_modules/@anthropic-ai/claude-agent-sdk' }), '/opt/bin/claude'); ok('PATH wins')
assert.equal(resolveClaudeBinary({ env: { PATH: '/nope' }, platform: 'darwin', arch: 'arm64', exists, sdkRoot: '/sdk/node_modules/@anthropic-ai/claude-agent-sdk' }), '/sdk/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'); ok('bundled fallback')
assert.equal(resolveClaudeBinary({ env: { PATH: '/nope' }, platform: 'linux', arch: 'x64', exists, sdkRoot: '/sdk/node_modules/@anthropic-ai/claude-agent-sdk' }), undefined); ok('none → undefined')

function fakeQuery ({ init, account, models, fail }) {
  return () => {
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
}
const init = { type: 'system', subtype: 'init', apiKeySource: 'none', claude_code_version: '2.1.259', model: 'sonnet', tools: ['Read'], session_id: 's1' }
const models = [{ value: 'fable', displayName: 'Fable', description: 'd', supportedEffortLevels: ['high'] }]
let clock = 1000
const p = new Probe({ query: fakeQuery({ init, account: { email: 'e@x', subscriptionType: 'max' }, models }), binary: '/opt/bin/claude', env: {}, now: () => clock })
const a = await p.current()
assert.equal(a.loggedIn, true); assert.equal(a.version, '2.1.259'); assert.equal(a.subscriptionType, 'max'); assert.equal(a.email, 'e@x')
assert.equal(a.models[0].id, 'fable'); ok('signed-in probe')
clock += 1000
assert.equal(await p.current(), a); ok('cached inside ttl')
clock += 70_000
assert.notEqual(await p.current(), a); ok('refreshed after ttl')

const keyed = new Probe({ query: fakeQuery({ init: { ...init, apiKeySource: 'ANTHROPIC_API_KEY' }, account: {}, models }), binary: '/opt/bin/claude', env: {}, now: () => 0 })
const k = await keyed.current()
assert.equal(k.loggedIn, true); assert.equal(k.apiKeySource, 'ANTHROPIC_API_KEY'); ok('reports key source')

const down = new Probe({ query: fakeQuery({ fail: 'Not logged in · Please run /login' }), binary: '/opt/bin/claude', env: {}, now: () => 0 })
const d = await down.current()
assert.equal(d.loggedIn, false); assert.match(d.error, /Not logged in/); assert.equal(d.models.length, 4); ok('signed-out → static models + error')

const none = new Probe({ query: fakeQuery({ init, account: {}, models }), binary: undefined, env: {}, now: () => 0 })
const nb = await none.current()
assert.equal(nb.loggedIn, false); assert.match(nb.error, /no claude binary/); ok('no binary')
console.log(`selftest.probe: ${n} ok`)
