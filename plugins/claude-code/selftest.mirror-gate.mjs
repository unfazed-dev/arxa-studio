// The mirror tools must be invisible to every provider except claude-code: their
// execute() parks forever on a Claude child that a pi-ai or DeepSeek turn never spawns.
// This suite drives the real listeners through a faithful cordis waterfall — listener
// ordering included — because the bug is a wiring bug, not a filter bug.
import { strict as assert } from 'node:assert'
import { installMirrorTools } from './lib/mirror-gate.js'
import { MIRROR_TOOL_NAMES } from './lib/mirror-tools.js'
import { PROVIDER_ID } from './lib/models.js'
import { PendingResults } from './lib/pending.js'

let passed = 0
const ok = (msg) => { passed++; console.log(`ok ${passed} - ${msg}`) }

const defineTool = (d) => d
const OTHER = 'llm-pi-ai'

// ── a faithful-enough cordis context ────────────────────────────────────────────
// `waterfall` is transcribed from cordis/lib/index.js:317-324 so ordering is the
// real ordering: listeners run outermost-first, `prepend` puts one at the front.
function makeCtx () {
  const layer = new Map() // one scope layer, the agent scope agent.mjs registers into
  const hooks = {}
  const ctx = {
    restrictCalls: 0,
    tools: {
      register (definition) {
        if (layer.has(definition.name)) throw new Error(`duplicate tool "${definition.name}" in one layer`)
        layer.set(definition.name, definition)
        let live = true
        return () => { if (!live) return false; live = false; layer.delete(definition.name); return true }
      },
      schemas: () => [...layer.values()].map(({ name, description, parameters }) => ({ name, description, parameters })),
      restrict () {
        ctx.restrictCalls++
        throw new Error('tools.restrict() names unknown global tools; known global tools: (none)')
      },
    },
    on (name, listener, options) {
      const prepend = typeof options === 'object' && options !== null ? options.prepend === true : options === true
      const list = hooks[name] ??= []
      list[prepend ? 'unshift' : 'push'](listener)
      return () => { const i = list.indexOf(listener); if (i >= 0) list.splice(i, 1); return i >= 0 }
    },
    waterfall (name, ...args) {
      const cbs = [...(hooks[name] ?? [])]
      const inner = args.pop()
      const next = () => (cbs.shift() ?? inner)(...args)
      args.push(next)
      return next()
    },
    listenerCount: (name) => (hooks[name] ?? []).length,
  }
  return ctx
}

const ctx = makeCtx()

// ── the stand-in for dsh-agent's installModelSelection ──────────────────────────
// Transcribed from dsh-agent/lib/index.js:272-296. Registered BEFORE the gate and
// NOT prepended, which is the ordering that breaks a naively-registered listener:
// it stamps variables.provider only AFTER its own next() resolves, so a gate that
// is not outermost reads the stale baseline instead of the live selection.
const selection = { current: undefined, assembled: undefined }
ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
  const selected = selection.current
  const assembled = await next()
  selection.assembled = selected
  if (selected === undefined) return assembled
  return { ...assembled, variables: { ...assembled.variables, provider: selected.provider, model: selected.model } }
})
ctx.on('agent/request', async (_payload, next) => {
  const resolved = await next()
  const selected = selection.assembled
  return selected === undefined ? resolved : { ...resolved, provider: selected.provider, model: selected.model }
})

const dispose = installMirrorTools({ ctx, defineTool, pending: new PendingResults(), providerId: PROVIDER_ID })

// `variables.provider` before any selection is dsh-agent-loop's prompt variable,
// fed from agent.options.provider (dsh-agent-loop/lib/index.js:1024).
const BASELINE_PROVIDER = OTHER
const names = () => ctx.tools.schemas().map((s) => s.name)
const mirrorsIn = (list) => MIRROR_TOOL_NAMES.filter((n) => list.includes(n))

// dsh-system-prompt collects the tool schemas BEFORE running the waterfall
// (dsh-system-prompt/lib/index.js:249-283) — that is why the gate must filter too.
const assemble = () => {
  const assembly = { sections: [], contexts: [], tools: ctx.tools.schemas(), variables: { provider: BASELINE_PROVIDER, model: 'baseline' } }
  return ctx.waterfall('system-prompt/assemble', assembly, {}, () => Promise.resolve(assembly))
}
// buildRequest guarantees a non-empty provider on the seed (dsh-agent-loop:693-715).
const buildRequest = () => ctx.waterfall('agent/request', { turn: 1, step: 0 }, () => Promise.resolve({ provider: BASELINE_PROVIDER, model: 'baseline' }))

assert.deepEqual(mirrorsIn(names()), MIRROR_TOOL_NAMES)
ok('all 21 mirror tools are registered at plugin apply (pre-gate behaviour preserved)')

// ── the bug: a non-claude provider must not see them ────────────────────────────
selection.current = { provider: OTHER, model: 'pi-fast' }
let assembled = await assemble()
assert.deepEqual(mirrorsIn(names()), [])
ok('with a non-claude-code model selected, ctx.tools.schemas() contains no mirror tool')
assert.deepEqual(mirrorsIn(assembled.tools.map((t) => t.name)), [])
ok('and the tools list the loop hands the adapter carries none either')
assert.equal(assembled.variables.provider, OTHER)
ok('the gate ran outermost: it read the selection-stamped provider, not the baseline')

// ── the other half: claude-code must still see all 21 ───────────────────────────
selection.current = { provider: PROVIDER_ID, model: 'claude-fable-5-1' }
assembled = await assemble()
assert.deepEqual(mirrorsIn(names()), MIRROR_TOOL_NAMES)
ok('with a claude-code model selected, ctx.tools.schemas() contains all 21 mirror tools')
assert.deepEqual(mirrorsIn(assembled.tools.map((t) => t.name)), MIRROR_TOOL_NAMES)
ok('and the assembled tools list keeps them, so the bridge can dispatch Claude\'s calls')

// ── mid-session switching, both directions, repeatedly ──────────────────────────
selection.current = { provider: OTHER, model: 'pi-fast' }
await assemble()
assert.deepEqual(mirrorsIn(names()), [])
await assemble()
assert.deepEqual(mirrorsIn(names()), [])
ok('switching back to a non-claude model mid-session withdraws them again, idempotently')
selection.current = { provider: PROVIDER_ID, model: 'claude-fable-5-1' }
await assemble()
await assemble()
assert.deepEqual(mirrorsIn(names()), MIRROR_TOOL_NAMES)
ok('re-selecting claude-code re-registers without a duplicate-in-one-layer throw')

// ── the per-step hook catches a switch that lands between assemblies ────────────
selection.assembled = { provider: OTHER, model: 'pi-fast' }
const resolved = await buildRequest()
assert.equal(resolved.provider, OTHER)
assert.deepEqual(mirrorsIn(names()), [])
ok('agent/request re-syncs per step, so a switch between assemblies cannot leak them')

// ── the mechanism the brief asked us to justify ─────────────────────────────────
assert.equal(ctx.restrictCalls, 0)
ok('tools.restrict() is never called — it rejects scope-local names, so it cannot hide these')

// ── unknown provider keeps the claude path working ──────────────────────────────
const bare = makeCtx()
installMirrorTools({ ctx: bare, defineTool, pending: new PendingResults(), providerId: PROVIDER_ID })
const bareAssembly = { sections: [], contexts: [], tools: bare.tools.schemas(), variables: {} }
await bare.waterfall('system-prompt/assemble', bareAssembly, {}, () => Promise.resolve(bareAssembly))
assert.deepEqual(MIRROR_TOOL_NAMES.filter((n) => bare.tools.schemas().some((s) => s.name === n)), MIRROR_TOOL_NAMES)
ok('an absent provider signal leaves them visible rather than breaking Claude Code')

// ── disposal ────────────────────────────────────────────────────────────────────
dispose()
assert.deepEqual(mirrorsIn(names()), [])
assert.equal(ctx.listenerCount('agent/request'), 1)
assert.equal(ctx.listenerCount('system-prompt/assemble'), 1)
ok('the disposer unregisters every mirror tool and removes both listeners')

console.log(`# ${passed} ok`)
