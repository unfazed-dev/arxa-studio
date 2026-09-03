import { strict as assert } from 'node:assert'
import { STATIC_MODELS, modelsFromSdk, describeModel, versionAtLeast, PROVIDER_ID } from './lib/models.js'

let n = 0; const ok = (name) => { n++; console.log(`  ok ${name}`) }

assert.equal(PROVIDER_ID, 'claude-code'); ok('provider id')
assert.deepEqual(STATIC_MODELS.map((m) => m.id), ['fable', 'opus', 'sonnet', 'haiku']); ok('static ids')
assert.ok(STATIC_MODELS.every((m) => m.provider === 'claude-code' && m.name.length > 0)); ok('static rows complete')

const sdk = [
  { value: 'fable', resolvedModel: 'claude-fable-5-1', displayName: 'Fable', description: 'Most capable', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet', description: 'Fast', supportsEffort: false },
]
const mapped = modelsFromSdk(sdk)
assert.deepEqual(mapped[0], { provider: 'claude-code', id: 'fable', name: 'Fable', description: 'Most capable', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }); ok('sdk fable mapped')
assert.deepEqual(mapped[1].efforts, []); ok('no-effort model maps to empty efforts')

assert.equal(versionAtLeast('2.1.259', '2.1.255'), true)
assert.equal(versionAtLeast('2.1.240', '2.1.255'), false)
assert.equal(versionAtLeast('2.2.0', '2.1.255'), true); ok('version compare')

const max = { loggedIn: true, subscriptionType: 'max', version: '2.1.259' }
const pro = { loggedIn: true, subscriptionType: 'pro', version: '2.1.259' }
const old = { loggedIn: true, subscriptionType: 'max', version: '2.1.240' }
const out = { loggedIn: false }
assert.equal(describeModel(mapped[0], max), 'Most capable — included on Max, up to 50% of your weekly limit')
assert.equal(describeModel(mapped[0], pro), 'Most capable — on Pro this uses usage credits')
assert.equal(describeModel(mapped[0], old), 'Most capable — needs Claude Code ≥ 2.1.255, you have 2.1.240')
assert.equal(describeModel(mapped[0], out), 'Most capable — sign in with `claude auth login` first')
assert.equal(describeModel(mapped[1], max), 'Fast'); ok('fable labels per tier / version / signed-out')
console.log(`selftest.models: ${n} ok`)
