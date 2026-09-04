import { strict as assert } from 'node:assert'
import { STATIC_MODELS, modelsFromSdk, describeModel, versionAtLeast, matchModel, PROVIDER_ID } from './lib/models.js'

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
// F12 regression. The live SDK spells Opus `opus[1m]` and Fable `claude-fable-5-1[1m]`,
// but a model id picked while the probe was cold — or persisted from any earlier
// session — is the static spelling `opus` / `fable`. An `m.id === model` lookup misses,
// resolveModel falls back to a synthetic row with `efforts: []`, omits `reasoning`, and
// dsh's effort control (dsh-client-ui-model-selection/lib/client.js:490 renders the row
// only when `reasoning !== undefined`) hides itself — for a signed-in user, permanently.
const live = modelsFromSdk([
  { value: 'default', displayName: 'Default', description: 'd' },
  { value: 'opus[1m]', displayName: 'Opus (1M context)', description: 'd', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'claude-fable-5-1[1m]', displayName: 'Fable', description: 'd', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'sonnet', displayName: 'Sonnet', description: 'd', supportedEffortLevels: ['low', 'high'] },
  { value: 'haiku', displayName: 'Haiku', description: 'd' },
])
assert.equal(matchModel(live, 'opus[1m]').id, 'opus[1m]'); ok('matchModel: exact id wins')
assert.equal(matchModel(live, 'opus').id, 'opus[1m]'); ok('matchModel: static `opus` reaches live `opus[1m]`')
assert.equal(matchModel(live, 'Opus').id, 'opus[1m]'); ok('matchModel: case-insensitive')
assert.equal(matchModel(live, 'sonnet').id, 'sonnet'); ok('matchModel: plain live id still exact')
assert.equal(matchModel(live, 'nope'), undefined); ok('matchModel: unknown id -> undefined, never a wrong model')
// `fable` must not be answered by `default`, and must not silently pick a 5-1 variant
// by prefix alone — the alias is what carries it.
assert.equal(matchModel(live, 'fable').id, 'claude-fable-5-1[1m]'); ok('matchModel: `fable` reaches the live Fable id')
// Every STATIC_MODELS id must resolve against the live list, or a cold-probe pick
// strands the user without an effort control the moment the probe warms up.
for (const s of STATIC_MODELS) {
  assert.ok(matchModel(live, s.id), `static id ${s.id} must resolve against the live list`)
}
ok('every STATIC_MODELS id resolves against the live list')

console.log(`selftest.models: ${n} ok`)
