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
import { A2UI_VERSION, CATALOG_ID, sandboxFor, STRICT_SANDBOX, SAME_ORIGIN_SANDBOX }
  from './lib/catalog.js'
import { readFileSync } from 'node:fs'

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

// The RungLadder's sandbox is the one security decision the browser half makes
// on model-supplied input, so it is tested on BOTH copies of the rule: the
// importable one in catalog.js and the real one inside client.js, which cannot
// be imported (it lives in a __ModuleLoader__ factory). Drift fails here
// instead of in a browser nobody is watching.
const SELF = 'http://arxa.studio.localhost:7891/session'
const SANDBOX_TABLE = [
  // The case this whole fix exists for: a foreign http host may keep its own
  // origin, so a server-rendered design can actually boot.
  ['http://127.0.0.1:4319/', SAME_ORIGIN_SANDBOX],
  ['https://example.test/x', SAME_ORIGIN_SANDBOX],
  // Same host as us — the MDN escape applies, so it stays opaque.
  ['http://arxa.studio.localhost:7891/', STRICT_SANDBOX],
  // Same host, different port: an origin difference, but cookies ignore the
  // port, so this must NOT be treated as foreign.
  ['http://arxa.studio.localhost:9999/x', STRICT_SANDBOX],
  // Relative — resolves against US. Parsed without a base it would throw or
  // read as foreign; both are wrong.
  ['/admin', STRICT_SANDBOX],
  ['../x', STRICT_SANDBOX],
  // origin "null" is !== ours, so a naive difference check would GRANT these.
  ['data:text/html,<script>1</script>', STRICT_SANDBOX],
  ['javascript:alert(1)', STRICT_SANDBOX],
  ['file:///etc/passwd', STRICT_SANDBOX],
  // Unparseable or absent: fail closed, never open.
  ['', STRICT_SANDBOX],
  ['   ', STRICT_SANDBOX],
  [null, STRICT_SANDBOX],
  [undefined, STRICT_SANDBOX],
  [42, STRICT_SANDBOX],
  ['http://', STRICT_SANDBOX],
]

check('sandboxFor grants same-origin only to a foreign http host', () => {
  for (const [url, want] of SANDBOX_TABLE) {
    assert.equal(sandboxFor(url, SELF), want, `catalog.js: ${String(url)}`)
  }
})

check("client.js's copy of the sandbox rule has not drifted", () => {
  const src = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
  const start = src.indexOf('function sandboxFor')
  assert.ok(start > 0, 'client.js no longer defines sandboxFor')
  // Take the function plus the two constants it closes over, and run the very
  // same table against the code the browser will actually execute.
  const end = src.indexOf('\n    }', start)
  const body = src.slice(start, end + 6)
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    `const STRICT_SANDBOX = ${JSON.stringify(STRICT_SANDBOX)};` +
    `const SAME_ORIGIN_SANDBOX = ${JSON.stringify(SAME_ORIGIN_SANDBOX)};` +
    `${body}; return sandboxFor`)()
  for (const [url, want] of SANDBOX_TABLE) {
    assert.equal(fn(url, SELF), want, `client.js: ${String(url)}`)
  }
})

check('rungScale fits the width, never upscales, and honours the height cap', () => {
  const src = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
  const start = src.indexOf('const HEIGHT_CAP')
  assert.ok(start > 0, 'client.js no longer defines HEIGHT_CAP/rungScale')
  const end = src.indexOf('\n    }', start)
  // eslint-disable-next-line no-new-func
  const scale = new Function(`${src.slice(start, end + 6)}; return rungScale`)()
  const near = (got, want, why) =>
    assert.ok(Math.abs(got - want) < 1e-6, `${why}: got ${got}, want ${want}`)

  // A 900px window caps a frame at 630px tall.
  near(scale(1280, 832, 700, 900), 700 / 1280, 'desktop is width-bound')
  near(scale(744, 1133, 700, 900), 630 / 1133, 'tablet is height-bound')
  near(scale(390, 844, 700, 900), 630 / 844, 'mobile is height-bound, not 1:1')
  // The cap can only ever shrink.
  near(scale(390, 844, 700, 10000), 1, 'a tall window never upscales')
  near(scale(100, 100, 700, 900), 1, 'a small rung is never blown up')
  // Degrade sanely before either measurement lands.
  near(scale(390, 844, 700, 0), 1, 'no viewport yet -> width only')
  near(scale(390, 844, 0, 0), 320 / 390, 'nothing measured -> the old default')
})

check('the glow stylesheet installs exactly once and can actually animate', () => {
  const src = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
  const start = src.indexOf('const GLOW_CLASS')
  assert.ok(start > 0, 'client.js no longer defines GLOW_CLASS/installGlow')
  const end = src.indexOf('\n    }', src.indexOf('function installGlow', start))
  assert.ok(end > start, 'could not find the end of installGlow')

  // A DOM stub thin enough to be obviously honest: it observes the guard and
  // nothing else. HMR re-runs apply(), and N copies of an infinite animation
  // is a real cost, so "installs once" is the property worth pinning.
  const head = []
  const document = {
    querySelector: (sel) => {
      const m = /data-plugin-css=(".*")\]$/.exec(sel)
      const want = m ? JSON.parse(m[1]) : null
      return head.find((t) => t.attrs['data-plugin-css'] === want) ?? null
    },
    createElement: () => ({
      attrs: {}, textContent: '', setAttribute (k, v) { this.attrs[k] = v },
    }),
    head: { appendChild: (t) => head.push(t) },
  }
  // eslint-disable-next-line no-new-func
  const mod = new Function('document', 'accent',
    `${src.slice(start, end + 6)}; return { installGlow, GLOW_CSS }`)(document, 'ACCENT_TOKEN')

  assert.equal(mod.installGlow(), true, 'first call must install')
  assert.equal(mod.installGlow(), false, 'second call must be a no-op')
  assert.equal(head.length, 1, 'exactly one <style> may reach <head>')

  const css = head[0].textContent
  // A plain custom property is a STRING to the animation engine: it would jump
  // 0->360 instead of sweeping. The @property registration is what makes it an
  // angle, so its absence is a silent visual failure, not an error.
  assert.match(css, /@property --arxa-glow-angle/, 'the angle must be a registered property')
  assert.match(css, /mask-composite: exclude/, 'without the mask the gradient fills the box, not the ring')
  assert.match(css, /prefers-reduced-motion/, 'the motion must be escapable')
  assert.ok(css.includes('ACCENT_TOKEN'), 'the ring must use the accent token, never a hardcoded colour')
})

console.log(process.exitCode ? 'FAILED' : `all ${passed} checks passed`)
