/**
 * arxa-gen-ui self-check. `node plugins/gen-ui/selftest.mjs` — exits non-zero
 * on any failure, prints one line per assertion.
 *
 * Covers the parts that fail silently in a browser: the parameter/output
 * schemas actually compile through the real `defineTool` (a malformed schema
 * throws at registration, which in a live boot only shows up as a failed
 * profile), execute produces canonical A2UI v0.9 envelopes, invalid
 * components are rejected rather than rendered as placeholders, and the RPC
 * handler's verbs behave. Stubs cordis's `ctx`, uses the real dsh-tools.
 */
import assert from 'node:assert/strict'

import { apply } from './lib/index.js'
import { A2UI_VERSION, CATALOG_ID } from './lib/catalog.js'

let passed = 0
const check = (label, fn) => {
  try { fn(); console.log(`  ok  ${label}`); passed++ } catch (e) {
    console.error(`  FAIL ${label}\n       ${e.message}`); process.exitCode = 1
  }
}
const checkAsync = async (label, fn) => {
  try { await fn(); console.log(`  ok  ${label}`); passed++ } catch (e) {
    console.error(`  FAIL ${label}\n       ${e.message}`); process.exitCode = 1
  }
}

// --- stub the two ctx faces the plugin injects ---------------------------
let toolDef = null
let rpcHandler = null
let rpcOptions = null
const ctx = {
  tools: { register: (def) => { toolDef = def } },
  connection: {
    rpc: {
      handle: (channel, handler, options) => {
        assert.equal(channel, '/arxa-gen-ui', 'channel must be one URL path segment')
        rpcHandler = handler
        rpcOptions = options
        return () => {}
      },
    },
  },
}

console.log('arxa-gen-ui selftest')
apply(ctx, {})

check('tool registered', () => assert.ok(toolDef, 'no tool registered'))
check('tool is named gen_ui', () => assert.equal(toolDef.name, 'gen_ui'))
check('rpc channel registered with loopback authority', () => {
  assert.ok(rpcHandler, 'no rpc handler')
  assert.equal(rpcOptions.authority, 'loopback')
})

const exec = { callId: 'call-abc' }
const goodArgs = {
  title: 'Pick a rung',
  components: [
    { id: 'h', component: 'Heading', text: 'Preview' },
    { id: 'c', component: 'Choice', prompt: 'Which?', options: [{ id: 'a', label: 'A' }] },
  ],
}

await checkAsync('execute returns canonical A2UI v0.9 envelopes', async () => {
  const value = await toolDef.execute(goodArgs, exec)
  assert.equal(value.surfaceId, 'call-abc', 'surfaceId should be the callId')
  assert.equal(value.title, 'Pick a rung')
  const [create, update] = value.messages
  assert.equal(create.version, A2UI_VERSION)
  assert.equal(create.createSurface.catalogId, CATALOG_ID)
  assert.equal(update.version, A2UI_VERSION)
  assert.equal(update.updateComponents.components.length, 2)
  // Exactly one verb key per envelope — the invariant AppBoxKitA2uiMessage
  // .fromJson enforces on the Dart side.
  for (const m of value.messages) {
    const verbs = Object.keys(m).filter((k) => k !== 'version')
    assert.equal(verbs.length, 1, `envelope must carry exactly one verb, got ${verbs.join(',')}`)
  }
})

await checkAsync('dataModel adds an updateDataModel envelope', async () => {
  const value = await toolDef.execute({ ...goodArgs, dataModel: { n: 1 } }, exec)
  assert.equal(value.messages.length, 3)
  assert.deepEqual(value.messages[2].updateDataModel.value, { n: 1 })
})

await checkAsync('a component outside the catalogue is rejected', async () => {
  await assert.rejects(
    () => toolDef.execute({ title: 't', components: [{ id: 'x', component: 'ScriptTag' }] }, exec),
    /not in the catalogue/,
  )
})

await checkAsync('duplicate component ids are rejected', async () => {
  await assert.rejects(
    () => toolDef.execute({
      title: 't',
      components: [{ id: 'x', component: 'Text', text: 'a' }, { id: 'x', component: 'Text', text: 'b' }],
    }, exec),
    /duplicated/,
  )
})

await checkAsync('presenters are pure and produce generic cards', async () => {
  const call = toolDef.presentCall(goodArgs)
  assert.equal(call.card, 'generic')
  assert.match(call.title, /Pick a rung/)
  const res = toolDef.presentResult(goodArgs, { content: [] })
  assert.equal(res.card, 'generic')
  assert.equal(res.title, 'Pick a rung')
})

await checkAsync('rpc select then state round-trips', async () => {
  const w = await rpcHandler('select', { surfaceId: 's', componentId: 'c', value: 'v' })
  assert.equal(w.ok, true)
  const r = await rpcHandler('state', { surfaceId: 's' })
  assert.deepEqual(r.value.selections, { c: 'v' })
})

await checkAsync('rpc rejects unknown endpoints and bad args', async () => {
  assert.equal((await rpcHandler('drop_table', {})).ok, false)
  assert.equal((await rpcHandler('state', {})).ok, false)
})

console.log(process.exitCode ? 'FAILED' : `all ${passed} checks passed`)
