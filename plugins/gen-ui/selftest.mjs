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
import {
  A2UI_VERSION, CATALOG_ID, claimedChildren, sandboxFor, STRICT_SANDBOX,
  SAME_ORIGIN_SANDBOX, validateComponents,
} from './lib/catalog.js'
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

await checkAsync('a model-supplied surfaceId wins, so updates share one surface', async () => {
  const value = await toolDef.execute({ ...goodArgs, surfaceId: 'card-7' }, exec)
  assert.equal(value.surfaceId, 'card-7', 'a supplied surfaceId must beat the callId')
  assert.equal(value.messages[0].createSurface.surfaceId, 'card-7')
  assert.equal(value.messages[1].updateComponents.surfaceId, 'card-7')
})

await checkAsync('a malformed surfaceId is rejected like any bad component', async () => {
  await assert.rejects(
    () => toolDef.execute({ ...goodArgs, surfaceId: 'has spaces in it' }, exec), /surfaceId/)
  await assert.rejects(
    () => toolDef.execute({ ...goodArgs, surfaceId: 42 }, exec), /surfaceId/)
})

check('the tool teaches the fold in its own schema', () => {
  // defineTool compiles the shorthand map into a JSON Schema: properties.*.
  const params = toolDef.parameters.properties ?? {}
  assert.ok(params.surfaceId,
    'no surfaceId parameter — the model cannot name an update target')
  assert.match(params.surfaceId.description, /same surfaceId/i,
    'the parameter must tell the model to reuse the id for updates')
  assert.match(toolDef.description, /full list, never a delta/i,
    'replace semantics must be spelled out or the model will send deltas')
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

// One table, run against catalog.js's claimedChildren AND the copy inside
// client.js — the same two-list contract as DEFAULT_RUNGS and sandboxFor.
const CLAIMED_TABLE = [
  [[{ id: 'c', component: 'Card', children: ['a', 'b'] }], ['a', 'b']],
  [[{ id: 't', component: 'Text', text: 'x' }], []],
  [[{ id: 'c', component: 'Card' }], []],
  [[{ id: 'c', component: 'Card', children: 'nope' }], []],
  [[{ id: 'c', component: 'Card', children: ['a', 7, null] }], ['a']],
  [[{ id: 'o', component: 'Card', children: ['i'] },
    { id: 'i', component: 'Card', children: ['leaf'] }], ['i', 'leaf']],
  [null, []],
]

check('the Card child graph is validated, not trusted', () => {
  const bad = (cs) => validateComponents(cs)[0] ?? ''
  assert.match(bad([{ id: 'c', component: 'Card', children: ['x'] }]),
    /not an id in this surface/, 'a dangling child id must be caught')
  assert.match(bad([{ id: 'a', component: 'Card', children: ['a'] }]),
    /cannot contain itself/, 'self-parenting must be caught')
  // Each reference below is individually valid; only walking the graph finds
  // it, and the renderer would recurse forever.
  assert.match(bad([{ id: 'a', component: 'Card', children: ['b'] },
    { id: 'b', component: 'Card', children: ['a'] }]),
  /cycle/, 'a cycle must be caught')
  assert.match(bad([{ id: 'a', component: 'Card', children: ['t'] },
    { id: 'b', component: 'Card', children: ['t'] },
    { id: 't', component: 'Text', text: 'x' }]),
  /one parent/, 'two parents would render the component twice')
  assert.deepEqual(validateComponents([
    { id: 'c', component: 'Card', children: ['t', 'i'] },
    { id: 't', component: 'Text', text: 'hi' },
    { id: 'i', component: 'Icon', name: 'check' },
  ]), [], 'a well-formed card must be accepted')
})

check('claimedChildren agrees in catalog.js and client.js', () => {
  const src = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
  const start = src.indexOf('function claimedChildren')
  assert.ok(start > 0, 'client.js no longer defines claimedChildren')
  const end = src.indexOf('\n    }', start)
  // eslint-disable-next-line no-new-func
  const mirror = new Function(`${src.slice(start, end + 6)}; return claimedChildren`)()
  for (const [input, want] of CLAIMED_TABLE) {
    assert.deepEqual([...claimedChildren(input)].sort(), [...want].sort(),
      `catalog.js: ${JSON.stringify(input)}`)
    assert.deepEqual([...mirror(input)].sort(), [...want].sort(),
      `client.js: ${JSON.stringify(input)}`)
  }
})

// Run the browser half's renderers for real, in Node, against a React stub.
// Answers the standing caveat in plan decision 32c ("no component in
// client.js has executed"). Not a browser — no layout, no CSS — but the
// component FUNCTIONS run, which is where the surface graph is resolved.
// Evaluate the factory once and return the registered toolview. The factory
// closes over module-level state — the surface ledger among it — so checks
// that need several blocks to SHARE one ledger must load once and render
// each block through the same ToolView: renderBlocksForTest below.
function loadToolView () {
  const h = (type, props, ...kids) => ({
    type, props: { ...(props || {}), children: kids.flat(Infinity) },
  })
  const React = {
    createElement: h,
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useLayoutEffect: () => {},
    useRef: (v) => ({ current: v ?? null }),
    useMemo: (fn) => fn(),
  }
  let factory
  global.window = {
    location: { href: 'http://arxa.studio.localhost:7891/' },
    __ModuleLoader__: { load: (m) => { factory = m.factory } },
  }
  delete global.document
  const clientPath = new URL('./lib/client.js', import.meta.url)
  const src = readFileSync(clientPath, 'utf8')
  // eslint-disable-next-line no-new-func
  new Function('window', src)(global.window)
  assert.ok(factory, 'client.js did not register with __ModuleLoader__')
  const mod = factory((name) => {
    if (name === 'react') return React
    throw new Error('unexpected require: ' + name)
  })

  let ToolView
  mod.apply({
    slots: {
      inject: (_slot, cb) => cb(),
      register: (_meta, component) => { ToolView = component },
    },
    connection: {},
  })
  assert.ok(ToolView, 'no toolview was registered')
  return ToolView
}

// Walk one rendered tree, invoking every function component, and collect
// what was drawn.
function walkTree (tree) {
  const seenTypes = []
  const strings = []
  const classes = []
  const delays = []
  const fits = []
  const pairs = []
  const walk = (node, depth) => {
    if (depth > 60) throw new Error('render did not terminate — a cycle reached the renderer')
    if (node === null || node === undefined || node === false) return
    if (Array.isArray(node)) { for (const n of node) walk(n, depth + 1); return }
    if (typeof node === 'string' || typeof node === 'number') { strings.push(String(node)); return }
    if (typeof node !== 'object') return
    if (typeof node.props?.className === 'string') classes.push(node.props.className)
    const delay = node.props?.style?.['--arxa-enter-delay']
    if (typeof delay === 'string') delays.push(delay)
    if (node.props?.className === 'arxa-genui-enter' && node.props?.style?.width === 'fit-content') fits.push(true)
    if (node.props?.className === 'arxa-genui-enter') {
      pairs.push(node.props.children?.[0]?.props?.className === 'arxa-genui-enter-rise')
    }
    if (typeof node.type === 'function') {
      seenTypes.push(node.type.name)
      walk(node.type(node.props, node.props), depth + 1)
      return
    }
    if (typeof node.type === 'string') seenTypes.push(node.type)
    walk(node.props?.children, depth + 1)
  }
  walk(tree, 0)
  return { text: strings.join('\u0000'), types: seenTypes, classes, delays, fits, pairs }
}

// A settled tool-result block — the durable path. meta.surfaceId mirrors
// the host's stamping (the callId) unless one is supplied.
function settledBlock ({ callId, time, title, components, surfaceId }) {
  const sid = surfaceId ?? callId
  return {
    toolName: 'gen_ui',
    block: {
      kind: 'tool-result',
      callId,
      ...time === undefined ? {} : { time },
      isError: false,
      meta: {
        surfaceId: sid,
        title: title ?? 'Test surface',
        messages: [{ version: 'v0.9', updateComponents: { surfaceId: sid, components } }],
      },
    },
  }
}

function renderSurfaceForTest (components, blockTime) {
  const ToolView = loadToolView()
  return walkTree(ToolView(settledBlock({
    callId: 'call_' + Math.random().toString(36).slice(2),
    time: blockTime,
    components,
  })))
}

// N block descriptors through ONE ToolView, sharing the module-level
// surface ledger — the only way the fold can be observed end to end.
// Repeat a descriptor to re-render that block after later ones registered.
function renderBlocksForTest (blocks) {
  const ToolView = loadToolView()
  return blocks.map((b) => walkTree(ToolView(settledBlock(b))))
}

check('the browser half renders a Card with its children nested exactly once', () => {
  const out = renderSurfaceForTest([
    { id: 'card', component: 'Card', title: 'Release 1.4', children: ['t', 'ico', 'img', 'btn'] },
    { id: 't', component: 'Text', text: 'UNIQUE_TEXT_MARKER' },
    { id: 'ico', component: 'Icon', name: 'check' },
    { id: 'img', component: 'Image', src: 'https://example.invalid/a.png', height: 90 },
    { id: 'btn', component: 'Button', label: 'UNIQUE_BUTTON_MARKER', tone: 'primary' },
  ])
  // Drawn once — inside the card. A claimed child rendered at top level too
  // would appear twice and would give one componentId two selection records.
  assert.equal(out.text.split('UNIQUE_TEXT_MARKER').length - 1, 1,
    'the card child must be drawn exactly once')
  assert.equal(out.text.split('UNIQUE_BUTTON_MARKER').length - 1, 1,
    'the button must be drawn exactly once')
  // NB: RendererHost invokes each renderer as a plain function rather than
  // through createElement, so a renderer never appears as a node type — only
  // what it DRAWS is observable. Assert on output, not on the call.
  assert.ok(out.types.includes('RendererHost'), 'nothing was dispatched to a renderer')
  assert.ok(out.text.includes('Release 1.4'), 'the card title did not render')
  assert.ok(out.text.includes('✓'), 'the icon glyph did not resolve')
  assert.ok(out.types.includes('Slot'), 'the image did not reserve its slot')
})

check('an unloaded Image reserves its slot instead of collapsing', () => {
  const out = renderSurfaceForTest([
    { id: 'img', component: 'Image', src: 'https://example.invalid/a.png', height: 90 },
  ])
  // useState stays 'loading' under the stub, which is exactly the pre-load
  // state: the Slot must be what stands in, or the surface would jump when
  // the bytes land. That reserved height IS the "outline of that size".
  assert.ok(out.types.includes('Slot'), 'no reserved slot while the image loads')
})

check('a dangling child id draws a note, never a blank card', () => {
  // Host validation rejects this, so it can only arrive on replay from a
  // build whose validation differed — it must degrade visibly.
  const out = renderSurfaceForTest([
    { id: 'card', component: 'Card', children: ['ghost'] },
  ])
  assert.match(out.text, /no such component/, 'a missing child must say so')
})

check('the entrance cascade steps 90ms and never outruns its cap', () => {
  const src = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
  const start = src.indexOf('const STAGGER_MS')
  assert.ok(start > 0, 'client.js no longer defines the stagger')
  const end = src.indexOf('\n    }', src.indexOf('function cascadeDelay', start))
  assert.ok(end > start, 'could not find the end of cascadeDelay')
  // eslint-disable-next-line no-new-func
  const { cascadeDelay, STAGGER_MS, STAGGER_MAX_MS } = new Function(
    `${src.slice(start, end + 6)}; return { cascadeDelay, STAGGER_MS, STAGGER_MAX_MS }`)()

  assert.equal(cascadeDelay(0), 0, 'the first node of a batch enters at mount — no dead time')
  assert.equal(cascadeDelay(1), STAGGER_MS, 'one batch step is the researched interval')
  assert.equal(cascadeDelay(2), 2 * STAGGER_MS, 'steps are linear inside the cap')
  // THE property: a big batch must not crawl. The delay clamps, so the whole
  // cascade is bounded no matter how many components arrive together.
  assert.equal(cascadeDelay(8), STAGGER_MAX_MS, 'the cap is exactly the researched max')
  assert.equal(cascadeDelay(200), STAGGER_MAX_MS, 'a huge batch never outruns the cap')
})

check('only a live surface enters with motion — replay paints bare', () => {
  const components = [
    { id: 'card', component: 'Card', children: ['t', 'b'] },
    { id: 't', component: 'Text', text: 'UNIQUE_LIVE_MARKER' },
    { id: 'b', component: 'Button', label: 'UNIQUE_BTN_MARKER', tone: 'primary' },
  ]
  // A time comfortably after the factory's LIVE_SINCE snapshot: the harness
  // re-evaluates client.js per call, so "now" captured here would PREDATE it.
  const live = renderSurfaceForTest(components, Date.now() + 60_000)
  assert.ok(live.classes.includes('arxa-genui-enter'),
    'a surface born on this page must enter with the animation class')
  assert.ok(live.text.includes('UNIQUE_LIVE_MARKER') && live.text.includes('UNIQUE_BTN_MARKER'),
    'every child draws on the first frame — motion is CSS delay, never a draw gate')
  assert.deepEqual(live.delays, ['90ms', '180ms'],
    'the batch cascades in reading order; the root enters at mount (no style)')

  const replay = renderSurfaceForTest(components)
  assert.ok(!replay.classes.includes('arxa-genui-enter'),
    'replay and scrollback must paint with no motion at all')
  assert.ok(replay.text.includes('UNIQUE_LIVE_MARKER') && replay.text.includes('UNIQUE_BTN_MARKER'),
    'replay draws every child at once, no slots')
})

check('reduced motion: no JS clock remains — the CSS guard is the whole promise', () => {
  // The stand-down used to be two halves: a media query for CSS and a
  // matchMedia gate for the JS reveal clock. The clock is DELETED — motion
  // is animation-delay on mounted nodes, and with animation:none the delays
  // are inert. What remains to pin: the clock must stay dead, the media
  // query must stay present, and paint must never be gated either way.
  const src = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
  assert.ok(!src.includes('useReveal'), 'the JS reveal clock must stay deleted')
  assert.ok(!src.includes('prefersReducedMotion'), 'no JS-side motion gate may return')
  assert.match(src, /@media \(prefers-reduced-motion: reduce\)/,
    'the CSS stand-down must remain')
  const out = renderSurfaceForTest([
    { id: 'card', component: 'Card', children: ['t', 'b'] },
    { id: 't', component: 'Text', text: 'UNIQUE_RM_TEXT' },
    { id: 'b', component: 'Button', label: 'UNIQUE_RM_BTN' },
  ], Date.now() + 60_000)
  assert.ok(out.text.includes('UNIQUE_RM_TEXT') && out.text.includes('UNIQUE_RM_BTN'),
    'every child paints on frame one — nothing is held back behind a clock')
  assert.ok(!out.types.includes('Slot'), 'no child may be held back as a slot')
})

check('arriving components sweep the accent ring once, aligned with their rise', () => {
  // Operator report 2026-08-23: only the card glowed while children popped
  // with motion alone. The ring must JOIN the entrance: one sweep per
  // arriving node, starting exactly when that node moves.
  const src = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
  const start = src.indexOf('const ENTER_CLASS')
  assert.ok(start > 0, 'client.js no longer defines ENTER_CLASS/ENTER_CSS')
  const end = src.indexOf('\n    }', src.indexOf('function installEnter', start))
  // eslint-disable-next-line no-new-func
  const { ENTER_CSS } = new Function('accent',
    `${src.slice(start, end + 6)}; return { ENTER_CSS }`)('ACCENT_TOKEN')

  assert.match(ENTER_CSS, /@keyframes arxa-enter-ring/, 'the one-shot ring keyframes must exist')
  assert.match(ENTER_CSS, /\.arxa-genui-enter::after/, 'the ring paints on the enter wrapper itself')
  assert.match(ENTER_CSS, /mask-composite/, 'the ring must be a ring — the interior is cut out')
  assert.match(ENTER_CSS, /opacity: 0/, 'the ring must fade out, not linger')
  assert.ok(!/arxa-enter-ring[^;]*infinite/.test(ENTER_CSS),
    'the entrance ring is one-shot — infinite belongs to the warm glow alone')
  // The ring LEADS, strictly (operator directive): it starts at the batch
  // delay; the rise starts only after the 600ms sweep completes.
  const ringFirst = ENTER_CSS.match(/animation-delay: var\(--arxa-enter-delay, 0ms\);/g) ?? []
  assert.equal(ringFirst.length, 1, 'exactly one animation starts at the batch delay — the ring')
  assert.ok(ENTER_CSS.includes('animation-delay: calc(var(--arxa-enter-delay, 0ms) + 600ms);'),
    'the rise must wait for the full sweep — ring before node ui, always')
  assert.ok(ENTER_CSS.includes('arxa-enter-ring 600ms linear forwards'),
    'the pinned 600ms sweep, fill FORWARDS — holds the faded-out end state')
  // The ghost guard: the ::after must be invisible at BASE (before the
  // sweep starts, the animation has no say) and must fade IN — otherwise
  // every pending slot shows a static arc fragment (lens recording).
  assert.match(ENTER_CSS, /\.arxa-genui-enter::after \{[^}]*opacity: 0;/,
    'the ring must not exist before its sweep — base opacity 0')
  assert.ok(ENTER_CSS.includes('12% { opacity: 1; }'),
    'the ring fades IN at the start of its sweep')
  assert.ok(!ENTER_CSS.includes('//'),
    'no JS-style comments inside the stylesheet — // is a CSS parse error')
  // The wrapper must anchor the pseudo-element — and that is ALL it may do.
  // The exact-rule pin is the regression invariant: a pseudo shares its
  // host's opacity, so if the ring host ever carries the fade again, the
  // ring sweeps inside an invisible box (the third-clip bug).
  assert.match(ENTER_CSS, /\.arxa-genui-enter \{\s*position: relative;\s*\}/,
    'the ring host must carry position:relative and NOTHING else — never the fade')
  assert.match(ENTER_CSS, /\.arxa-genui-enter-rise \{\s*animation: arxa-genui-enter/,
    'the fade+rise must live on the inner rise box')
  assert.match(ENTER_CSS, /\.arxa-genui-enter-rise \{ animation: none; \}/,
    'reduced motion must stop the rise too')
  // Reduced motion: no ring at all — a static substitute is noise.
  const rm = ENTER_CSS.slice(ENTER_CSS.indexOf('prefers-reduced-motion'))
  assert.match(rm, /::after \{ content: none; \}/, 'reduced motion must remove the ring entirely')
})

check('the entrance stylesheet is the researched curve, installed once', () => {
  const src = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
  const start = src.indexOf('const ENTER_CLASS')
  assert.ok(start > 0, 'client.js no longer defines ENTER_CLASS/installEnter')
  const end = src.indexOf('\n    }', src.indexOf('function installEnter', start))
  assert.ok(end > start, 'could not find the end of installEnter')

  // The same deliberately-thin DOM stub the glow check uses.
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
    `${src.slice(start, end + 6)}; return { installEnter, ENTER_CSS, ENTER_MS }`)(document, 'ACCENT_TOKEN')

  assert.equal(mod.installEnter(), true, 'first call must install')
  assert.equal(mod.installEnter(), false, 'HMR re-apply must be a no-op')
  assert.equal(head.length, 1, 'exactly one <style> may reach <head>')

  const css = head[0].textContent
  // Material 3 emphasized DECELERATE — the curve M3 assigns to elements
  // entering the screen (MotionTokens.kt, AOSP). Curve drift would be a
  // silent visual regression, so the value is pinned, not approximated.
  assert.ok(css.includes('cubic-bezier(0.05, 0.7, 0.1, 1)'),
    'the entering curve must be M3 emphasized-decelerate')
  assert.ok(css.includes(mod.ENTER_MS + 'ms'), 'the researched duration must be the one applied')
  assert.match(css, /prefers-reduced-motion/, 'the motion must be escapable')
  assert.match(css, /transform: translateY\(8px\)/, 'the rise must be small — 8px, not a screen')
  assert.match(css, /opacity: 0/, 'the fade must be present')
  // transform+opacity only: layout properties would re-layout every frame.
  assert.ok(!/animation:[^;]*(height|width|margin|padding)/.test(css),
    'only compositor properties may animate')
})

check('stepwise calls fold into one growing surface; a rebuild starts a new one', () => {
  const src = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
  const start = src.indexOf('function isPrefixChain')
  assert.ok(start > 0, 'client.js no longer defines the surface fold')
  const end = src.indexOf('\n    }', src.indexOf('function foldCall', start))
  assert.ok(end > start, 'could not find the end of foldCall')
  // eslint-disable-next-line no-new-func
  const { foldCall } = new Function(
    `${src.slice(start, end + 6)}; return { foldCall }`)()

  const mk = (ids) => ids.map((id) => ({ id, component: id === 'card' ? 'Card' : 'Text' }))
  const T = 'Studio pricing card'
  const S = new Map()
  // The observed glm-5.3 pattern (session e0b1b8ce, 2026-08-23): N calls,
  // each a prefix of the next, surfaceId never set.
  const a = foldCall(S, { callId: 'a', title: T, surfaceId: null, components: mk(['card']), time: 100 })
  const b = foldCall(S, { callId: 'b', title: T, surfaceId: null, components: mk(['card', 't1']), time: 200 })
  const c = foldCall(S, { callId: 'c', title: T, surfaceId: null, components: mk(['card', 't1', 't2']), time: 300 })
  assert.equal(b.key, a.key, 'a prefix extension must fold into the same surface')
  assert.equal(c.key, a.key, 'and the third step too')
  assert.equal(c.hostCallId, 'a', 'the FIRST call owns the card')
  assert.equal(c.ordinal, 3, 'the stub needs its step number')
  assert.equal(c.components.length, 3, 'the surface holds the latest snapshot')
  assert.ok(b.changed && c.changed, 'growth is a change')
  assert.equal(a.lastChangeAt, 100, 'a surface is born warm at its own time')
  assert.equal(c.lastChangeAt, 300, 'growth advances the warmth clock')

  // Same title but starting from scratch — a rebuild is NOT an extension.
  const d = foldCall(S, { callId: 'd', title: T, surfaceId: null, components: mk(['card']), time: 400 })
  assert.notEqual(d.key, a.key, 'a rebuild must not fold into the finished surface')
  assert.equal(d.hostCallId, 'd')
  assert.equal(d.lastChangeAt, 400, 'a rebuild starts its own clock')

  // Explicit surfaceId folds on identity, no prefix rule — a shrink replaces.
  const e = foldCall(S, { callId: 'e', title: 'X', surfaceId: 'surf-1', components: mk(['card', 't1']), time: 500 })
  const f2 = foldCall(S, { callId: 'f', title: 'X', surfaceId: 'surf-1', components: mk(['card']), time: 600 })
  assert.equal(f2.key, e.key)
  assert.equal(f2.components.length, 1, 'an explicit update replaces, even shrinking')

  // The model echoes the receipt's surfaceId — the first call's callId —
  // which must find the auto surface, not open a parallel one.
  const g = foldCall(S, { callId: 'g', title: T, surfaceId: 'a', components: mk(['card', 't1', 't2', 't3']), time: 700 })
  assert.equal(g.key, a.key, 'echoing the host callId as surfaceId must fold home')
  assert.equal(g.components.length, 4)

  // Re-registration is idempotent (StrictMode double-invokes initializers).
  const a2 = foldCall(S, { callId: 'a', title: T, surfaceId: null, components: mk(['card']), time: 100 })
  assert.equal(a2.changed, false, 'a known callId is a no-op')
  assert.equal(a2.ordinal, 1)
  assert.equal(a2.components.length, 4, 'and it sees the grown state')
  assert.equal(a2.lastChangeAt, 700, 'a no-op read carries the current warmth clock')

  // The entrance batch ledger: each id stamps with the ordinal that joined it.
  assert.equal(a2.firstSeen.get('card'), 1, 'the shell joined with call one')
  assert.equal(a2.firstSeen.get('t1'), 2, 'growth stamps the growing call')
  assert.equal(a2.firstSeen.get('t2'), 3)
  assert.equal(a2.firstSeen.get('t3'), 4, 'the receipt-echo fold stamps its additions too')
  assert.equal(d.firstSeen.get('card'), 1, 'a rebuild starts a fresh ledger')

  // The title gate: same shape, different surface purpose — no fold.
  const h = foldCall(S, { callId: 'h', title: 'Other card', surfaceId: null, components: mk(['card', 't1', 't2', 't3', 't4']), time: 800 })
  assert.notEqual(h.key, a.key, 'a different title must not fold')

  // Empty args (an unparseable call) never heuristic-fold.
  const e1 = foldCall(S, { callId: 'e1', title: '', surfaceId: null, components: [], time: 900 })
  const e2 = foldCall(S, { callId: 'e2', title: '', surfaceId: null, components: [], time: 1000 })
  assert.notEqual(e2.key, e1.key, 'empty snapshots each stand alone')
})

check('folded calls render ONE growing card plus one-line stubs', () => {
  const T = 'Studio pricing card'
  const mk = (ids) => ids.map((id) => ({
    id,
    component: id === 'card' ? 'Card' : id === 'cta' ? 'Button' : 'Text',
    ...(id === 'card' ? { children: ids.filter((x) => x !== 'card') } : {}),
    ...(id === 't1' ? { text: 'FOLD_ONE' } : {}),
    ...(id === 'cta' ? { label: 'FOLD_TWO' } : {}),
  }))
  const t0 = Date.now() + 60_000
  const first = { callId: 'fa', time: t0, title: T, components: mk(['card', 't1']) }
  const grown = { callId: 'fb', time: t0 + 1, title: T, components: mk(['card', 't1', 'cta']) }
  // host paints, step 2 arrives, host paints again — the live sequence.
  const views = renderBlocksForTest([first, grown, first])

  assert.ok(views[0].text.includes('FOLD_ONE'), 'the host renders the first snapshot')
  assert.ok(!views[0].text.includes('FOLD_TWO'), 'growth has not landed at first paint')
  assert.match(views[1].text, /assembled into/, 'a folded-away call renders the stub')
  assert.ok(!views[1].text.includes('FOLD_TWO'), 'the stub shows no surface content')
  assert.ok(views[2].text.includes('FOLD_ONE') && views[2].text.includes('FOLD_TWO'),
    'the host re-render draws the grown surface — one card, assembling')
})

check('the arrival window owns the accent — and the warm clock is GONE', () => {
  // The 1500ms warmth window only ever fired as a tail pulse right after the
  // last node's entrance (cadence 705ms < arrival window closes every gap),
  // reading as a phantom second ring on the last node (operator report, run
  // call_c944d223). It was removed, not retuned — pin its absence so the
  // tail pulse cannot sneak back in under a new name.
  const src = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
  assert.ok(!src.includes('SURFACE_WARM_MS'), 'the warm window constant must stay deleted')
  assert.ok(!src.includes('surfaceWarm'), 'the warm clock function must stay deleted')
  const start = src.indexOf('const ARRIVAL_MS')
  assert.ok(start > 0, 'client.js no longer defines the arrival window')
  const end = src.indexOf('\n    }', src.indexOf('function surfaceArriving', start))
  assert.ok(end > start, 'could not find the end of surfaceArriving')
  // eslint-disable-next-line no-new-func
  const { surfaceArriving, ARRIVAL_MS } = new Function(
    `${src.slice(start, end + 6)}; return { surfaceArriving, ARRIVAL_MS }`)()
  const now = Date.now()
  assert.equal(ARRIVAL_MS, 850, 'ring 600 + rise 250 — the window a fresh arrival owns')
  assert.equal(surfaceArriving(now, now), true, 'a change right now is arriving')
  assert.equal(surfaceArriving(now - (ARRIVAL_MS - 1), now), true, 'the entrance still plays')
  assert.equal(surfaceArriving(now - ARRIVAL_MS, now), false, 'the arrival window ends exactly at the boundary')
  assert.equal(surfaceArriving(now - 60_000, now), false, 'replay/scrollback is never arriving')
  assert.equal(surfaceArriving(undefined, now), false, 'no timestamp -> not arriving, never crash')
})

check('the card ring means EXECUTING — it yields to arrivals and never tails', () => {
  // Contract after run call_c944d223: the card-level ring shows only while
  // THIS block is still executing AND no entrance is playing. Settled
  // surfaces never glow — the warm tail pulse read as the last node getting
  // a second ring (operator report). The RungLadder boot glow is per-rung,
  // unaffected.
  const src = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
  assert.ok(src.includes('!settled && !arriving ? GLOW_CLASS : undefined'),
    'the card ring must require EXECUTING and NOT arriving — nothing else')
  assert.ok(src.includes('setTimeout(() => setClockNow(Date.now()), arriveEnds + 30)'),
    'the effect must TICK at the arrival boundary or a running block never starts its ring')
  const comps = [
    { id: 'card', component: 'Card', children: ['t'] },
    { id: 't', component: 'Text', text: 'WARM_MARKER' },
  ]
  // Settled blocks: cold in every temporal state — no tail pulse, ever.
  const fresh = renderSurfaceForTest(comps, Date.now())
  assert.ok(!fresh.classes.includes('arxa-genui-pending'),
    'settled + arriving: the node ring owns the accent')
  const gap = renderSurfaceForTest(comps, Date.now() - 1000)
  assert.ok(!gap.classes.includes('arxa-genui-pending'),
    'settled + just past the arrival window: NO tail pulse (the run-12 bug)')
  const stale = renderSurfaceForTest(comps, Date.now() - 60_000)
  assert.ok(!stale.classes.includes('arxa-genui-pending'),
    'a surface assembled a minute ago must stand still')
  const timeless = renderSurfaceForTest(comps)
  assert.ok(!timeless.classes.includes('arxa-genui-pending'),
    'no timestamp -> cold (fail closed, same as the entrance)')
  // A RUNNING block: the ring yields while an entrance plays and shows only
  // once the arrival is over — the executing signal the glow exists for.
  const ToolView = loadToolView()
  const runningBlock = (callId, time, title) => ({
    toolName: 'gen_ui',
    block: { callId, time, argsRaw: JSON.stringify({ title, components: comps }) },
  })
  const runFresh = walkTree(ToolView(runningBlock('run_f', Date.now(), 'Exec fresh')))
  assert.ok(!runFresh.classes.includes('arxa-genui-pending'),
    'executing but ARRIVING: the entrance owns the accent')
  const runGap = walkTree(ToolView(runningBlock('run_g', Date.now() - 1000, 'Exec gap')))
  assert.ok(runGap.classes.includes('arxa-genui-pending'),
    'executing past the arrival window: the card ring says still working')
})

check('every component in a live surface enters individually — nested children cascade', () => {
  // The enter wrapper reaches every depth; what makes it read as INDIVIDUAL
  // entrances is the cascade — per-node delays from the batch ledger
  // (firstSeen), 90ms steps in depth-first reading order, 720ms cap. The
  // batch's first node (here the card shell) carries no delay: it enters at
  // mount and its children follow one by one.
  const src = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
  assert.ok(src.includes('const batchCounts = new Map()'),
    'the cascade must count per render — stale counts would mistime re-renders')
  assert.ok(src.includes('if (!surface.firstSeen.has(cid)) surface.firstSeen.set(cid, ordinal)'),
    'the fold must stamp each id with the ordinal of the call that joined it')
  const kids = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9']
  const comps = [
    { id: 'card', component: 'Card', title: 'Cascade', children: kids },
    ...kids.map((id) => ({ id, component: 'Text', text: 'CASC_' + id.toUpperCase() })),
  ]
  const out = renderSurfaceForTest(comps, Date.now() + 60_000)
  for (const id of kids) assert.ok(out.text.includes('CASC_' + id.toUpperCase()),
    id + ' must be drawn inside its card')
  const enters = out.classes.filter((c) => c === 'arxa-genui-enter')
  assert.equal(enters.length, 9, 'the 9 children carry ring hosts — the Card rises ringless')
  assert.equal(out.pairs.length, 9, 'every ring host is present')
  assert.ok(out.pairs.every(Boolean), 'every ring host wraps exactly one rise box')
  assert.ok(src.includes("if (entry?.component === 'Card')"),
    'the Card ringless branch must exist — a growing container has no honest ring size')
  assert.ok(src.includes("style: { animationDelay: delay + 'ms' }"),
    'the ringless Card must NOT wait out the 600ms ring offset — no ring leads it')
  assert.deepEqual(out.delays,
    ['90ms', '180ms', '270ms', '360ms', '450ms', '540ms', '630ms', '720ms', '720ms'],
    'children cascade 90ms apart in reading order, capped at the researched max')
})

check('the ring hugs each node UI — leaves shrink-wrap, structure keeps the row', () => {
  // Operator clip 10.22.28: every ring was an identical full-row strip. The
  // ring is the wrapper's ::after, so the wrapper must BE the node's size:
  // fit-content for ink-sized leaves AND the Button pill (inline-block in
  // the real renderer — the row-wide bar was a fixture fiction), never for
  // structural/measuring boxes.
  const src = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
  assert.ok(src.includes("const FIT_RING = new Set(['Text', 'Heading', 'Icon', 'Button'])"),
    'exactly Text/Heading/Icon/Button shrink-wrap — the set is the contract')
  const comps = [
    { id: 'card', component: 'Card', children: ['hd', 't', 'ico', 'btn'] },
    { id: 'hd', component: 'Heading', text: 'HUG_HEAD' },
    { id: 't', component: 'Text', text: 'HUG_TEXT' },
    { id: 'ico', component: 'Icon', name: 'check' },
    { id: 'btn', component: 'Button', label: 'HUG_BTN', tone: 'primary' },
  ]
  const live = renderSurfaceForTest(comps, Date.now() + 60_000)
  const enters = live.classes.filter((c) => c === 'arxa-genui-enter')
  assert.equal(enters.length, 4, '4 children wrapped — the Card rises ringless')
  assert.equal(live.fits.length, 4, 'heading, text, icon and the button pill hug their ink')
  const replay = renderSurfaceForTest(comps)
  assert.equal(replay.fits.length, 0, 'replay has no wrappers at all')
})

check('fold growth joins its own entrance batch — the ledger drives the cascade', () => {
  // The latch that used to draw growth "at once" is gone; the batch ledger
  // does better: each fold STEP's additions cascade from their own mount,
  // while everything already on screen keeps its original delay VALUES, so
  // a growth re-render never restarts a finished animation.
  //
  // Harness boundary, honestly: the live host holds its reveal in MOUNT
  // state (useState initializer), which this stateless stub cannot hold
  // across ToolView calls — a re-rendered host is indistinguishable from
  // scrollback here and correctly paints bare. So the composition is pinned
  // at its two ends instead: the ledger stamps per joining call (the fold
  // sequence check above), and renderEntry counts within batches per render
  // (pins below) — with the single-batch cascade proven end to end by the
  // render check above.
  const src = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
  assert.ok(src.includes('const seenAt = firstSeen instanceof Map ? firstSeen.get(id) : undefined'),
    'the delay must come from the batch ledger, not traversal position alone')
  assert.ok(src.includes('const n = batchCounts.get(seenAt) ?? 0'),
    'batch position must count within the node OWN batch — a fold step starts at 0')
  assert.ok(src.includes('batchCounts.set(seenAt, n + 1)'),
    'the counter must advance per rendered node')
  assert.ok(src.includes('delay = cascadeDelay(n)'),
    'the batch position passes through the capped cascade step')
  assert.ok(src.includes("...(delay > 0 ? { '--arxa-enter-delay': delay + 'ms' } : null),"),
    'a batch-leading node carries no delay property — it enters at its mount')
})

check('replay never animates — only a surface born on this page does', () => {
  const src = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
  const start = src.indexOf('const LIVE_SINCE')
  assert.ok(start > 0, 'client.js no longer defines LIVE_SINCE/claimReveal')
  const end = src.indexOf('\n    }', src.indexOf('function claimReveal', start))
  // eslint-disable-next-line no-new-func
  const shouldReveal = new Function(
    `${src.slice(start, end + 6)}; return claimReveal`)()

  const now = Date.now()
  // Scrollback and reload: the call happened before this page existed. An
  // animation here would re-run on every scroll and break stage 2's promise
  // that a settled surface renders identically forever.
  assert.equal(shouldReveal('old', now - 60_000), false, 'history must paint instantly')
  assert.equal(shouldReveal('nostamp', undefined), false, 'no timestamp -> do not animate')
  assert.equal(shouldReveal('nulltime', null), false, 'a null callTime -> do not animate')
  assert.equal(shouldReveal('', now + 1000), false, 'no call id -> do not animate')
  // A live turn animates exactly once.
  assert.equal(shouldReveal('live', now + 1000), true, 'a new surface assembles')
  assert.equal(shouldReveal('live', now + 1000), false, 'and never assembles twice')

  // The host sets callTime to `previous?.time ?? null`. If the toolview read
  // callTime alone, every surface whose call head was dropped would silently
  // skip the animation — implemented, shipped, never running. The toolview
  // computes the fallback ONCE and both the reveal and the fold read it.
  assert.match(src.slice(src.indexOf('const callTime'), src.indexOf('const callTime') + 300),
    /block\?\.callTime.*block\?\.time/, 'callTime must fall back to the node time when callTime is null')
  assert.match(src.slice(src.indexOf('const [reveal]'), src.indexOf('const [reveal]') + 200),
    /callTime/, 'the reveal must consume the same fallback the fold uses')
})

check('REPRO: a LIVE surface cascades every child; history paints bare', () => {
  const comps = [
    { id: 'card', component: 'Card', title: 'T', children: ['a', 'b', 'c', 'd'] },
    { id: 'a', component: 'Text', text: 'MARK_A' },
    { id: 'b', component: 'Text', text: 'MARK_B' },
    { id: 'c', component: 'Text', text: 'MARK_C' },
    { id: 'd', component: 'Text', text: 'MARK_D' },
  ]
  const marks = (out) => ['MARK_A', 'MARK_B', 'MARK_C', 'MARK_D']
    .filter((m) => out.text.includes(m))

  // History: no timestamp -> paints whole, instantly.
  assert.deepEqual(marks(renderSurfaceForTest(comps)),
    ['MARK_A', 'MARK_B', 'MARK_C', 'MARK_D'], 'history must paint whole')

  // Live: born now. There is no draw gate anymore — every child is in the
  // tree on frame one and the CSS cascade moves them one by one. Heights are
  // real from the first commit, so no stand-in slots exist to jump later.
  const live = renderSurfaceForTest(comps, Date.now() + 5000)
  assert.deepEqual(marks(live), ['MARK_A', 'MARK_B', 'MARK_C', 'MARK_D'],
    'a live surface must draw every child on frame one — motion is CSS-side')
  assert.ok(!live.types.includes('Slot'), 'no reserved slots remain in a card')
  assert.deepEqual(live.delays, ['90ms', '180ms', '270ms', '360ms'],
    'the children cascade in reading order behind the shell')
})

check('each rung is its own document, and a reload stays inside one rung', () => {
  // The frame key IS the reload trigger: change it and React unmounts the old
  // element and mounts a new one, which reloads that design. So the key
  // decides the blast radius of a refresh.
  //
  // It used to be `epoch:url:rungLabel` off ONE shared epoch, which made every
  // rung click a page load. Then it was `epoch:url`, one shared document —
  // which cannot keep per-rung scroll, because an iframe has exactly one
  // scroll offset. Now it is per-rung epoch + rung index: one live document
  // each, and bumping one rung's epoch cannot touch another's key.
  const src = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
  const panel = readFileSync(
    new URL('../design-panel/lib/client.js', import.meta.url), 'utf8')

  for (const [name, text] of [['gen-ui', src], ['design-panel', panel]]) {
    assert.match(text, /epochs\[/,
      `${name}: the epoch must be PER RUNG, or a refresh reloads every rung`)
    assert.doesNotMatch(text, /setEpoch\(/,
      `${name}: a single shared epoch is back — one bump reloads all rungs`)
    // Hidden, not unmounted. Unmounting is what loses the scroll position.
    assert.match(text, /display: i === (active|rung) \? 'block' : 'none'/,
      `${name}: inactive rungs must be HIDDEN, not unmounted`)
  }

  // The reload button must bump exactly the rung on screen.
  const btn = src.slice(src.indexOf('reload this rung only') - 260,
    src.indexOf('reload this rung only'))
  assert.match(btn, /\[active\]/,
    'the gen-ui reload button must bump only the active rung')

  // An SSE reload must reload the visible rung and FLAG the rest, never bump
  // them: bumping a hidden rung throws away a scroll position nobody asked to
  // lose. This is the piece most likely to be "simplified" back.
  const sse = panel.slice(panel.indexOf("addEventListener('reload'"),
    panel.indexOf("addEventListener('reload'") + 420)
  assert.match(sse, /setStale/,
    'an SSE reload must mark hidden rungs stale rather than reloading them')
  assert.match(sse, /rungRef\.current/,
    'the SSE handler is created once and would otherwise close over a stale rung')

  // Lazy: a rung nobody opened is never booted.
  for (const [name, text] of [['gen-ui', src], ['design-panel', panel]]) {
    assert.match(text, /if \(!mounted\[i\]\) return null/,
      `${name}: rungs must mount lazily — three live app instances up front is `
      + 'the cost that made a shared frame look attractive')
  }
})

check('a RungLadder boots ONE rung, not all three', () => {
  // Executes RungLadder for real against the React stub. Source greps cannot
  // catch a crash in it, and a crash here takes the whole card down — the
  // ladder is the one renderer that touches window, ResizeObserver and a
  // sandbox attribute.
  //
  // The count is the point: three mounted iframes is three live app instances
  // for viewports nobody has opened. Lazy mounting is the concession that
  // makes one-document-per-rung affordable, so it is pinned here rather than
  // left to a comment.
  const out = renderSurfaceForTest([{
    id: 'ladder',
    component: 'RungLadder',
    url: 'http://127.0.0.1:4319/',
    rungs: [
      { label: 'mobile', w: 390, h: 844 },
      { label: 'tablet', w: 744, h: 1133 },
      { label: 'desktop', w: 1280, h: 832 },
    ],
  }])
  const frames = out.types.filter((t) => t === 'iframe').length
  assert.equal(frames, 1,
    `only the active rung may be mounted on first paint, got ${frames} iframes`)
  // All three buttons are there — the rungs exist, they are just not booted.
  assert.ok(out.text.includes('mobile') && out.text.includes('desktop'),
    'the rung buttons must render even though their frames are not booted')
})

console.log(process.exitCode ? 'FAILED' : `all ${passed} checks passed`)
