#!/usr/bin/env node
/**
 * arxa-dashboard focus selftest — docs/plans/org-row-dashboard.md §4 step 4
 * (D10). Two halves, both RUN rather than pattern-matched:
 *   host   — focusTotal(): accumulation and the refusals around it.
 *   client — the heartbeat itself, driven in a stubbed browser with a frozen
 *            clock: what it posts, when, and what it refuses to claim.
 * Run: node plugins/arxa-dashboard/selftest.focus.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FOCUS_MAX_MS, focusTotal } from './lib/index.js'

const here = dirname(fileURLToPath(import.meta.url))

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}
const refused = (fn) => { try { fn(); return false } catch (e) { return e.message } }

// ---- host: the accumulator -------------------------------------------------
check('focusTotal: adds the delta to the row figure', focusTotal(60_000, 30_000) === 90_000)
check('focusTotal: an absent / zero / junk previous figure starts from the delta',
  focusTotal(null, 30_000) === 30_000 && focusTotal(0, 30_000) === 30_000 && focusTotal('9', 30_000) === 30_000 && focusTotal(-5, 30_000) === 30_000)
check('focusTotal: whole milliseconds, never a fraction', Number.isInteger(focusTotal(1, 30_000.4)))
check('focusTotal: a delta over the cap is REFUSED, not clamped (a clamp banks the lie)',
  refused(() => focusTotal(0, FOCUS_MAX_MS + 1)) === 'focus-delta-refused' && focusTotal(0, FOCUS_MAX_MS) === FOCUS_MAX_MS)
check('focusTotal: zero, negative, NaN, Infinity and non-numbers refused',
  ['0', 0, -1, NaN, Infinity, null, undefined, {}, '30000'].every((d) => refused(() => focusTotal(0, d)) === 'focus-delta-refused'))

// ---- client: the heartbeat, in a stubbed browser ---------------------------
/** Minimal browser the client half needs to reach apply(): no DOM rendering. */
function browser() {
  const posts = []
  const win = new EventTarget()
  const doc = new EventTarget()
  doc.visibilityState = 'visible'
  doc.querySelector = () => null
  doc.createElement = () => ({ dataset: {}, remove() {} })
  doc.head = { appendChild() {} }
  win.__ARXA_SIDEBAR__ = { boundSession: () => null }
  win.__ModuleLoader__ = { load: (m) => { win.__loaded = m } }
  const g = globalThis
  const saved = { window: g.window, document: g.document, fetch: g.fetch, now: Date.now }
  g.window = win
  g.document = doc
  g.fetch = async (route, init) => {
    posts.push({ route, ...JSON.parse(init.body) })
    return { json: async () => ({ ok: true, result: {} }) }
  }
  let clock = 1_000_000
  Date.now = () => clock
  return {
    posts, win, doc,
    tick: (ms) => { clock += ms },
    bind: (s) => { win.__ARXA_SIDEBAR__ = { boundSession: () => s } },
    beat: () => win.dispatchEvent(new Event('arxa-sidebar-state')),
    hide: () => { doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')) },
    show: () => { doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')) },
    restore: () => { g.window = saved.window; g.document = saved.document; g.fetch = saved.fetch; Date.now = saved.now },
  }
}

const b = browser()
const disposers = []
try {
  // eslint-disable-next-line no-new-func — the client is a browser module, not an ES import.
  new Function('React', readFileSync(join(here, 'lib', 'client.js'), 'utf8'))()
  const mod = b.win.__loaded
  const client = mod.factory((name) => {
    if (name === 'react') return { createElement: () => null, Fragment: 'Fragment', useState: () => [0, () => {}], useEffect: () => {}, useRef: () => ({ current: null }) }
    throw new Error('unexpected require: ' + name)
  })
  const ctx = { effect: (fn) => { disposers.push(fn() || (() => {})) }, locale: { register: () => {} } }
  client.apply(ctx)
  // css, root seam, focus heartbeat — every one of them disposable.
  check('client: apply() publishes the Root seam and starts the heartbeat as disposable effects', disposers.length === 3 && typeof b.win.__ARXA_DASHBOARD__.Root === 'function', 'effects=' + disposers.length)

  const focusPosts = () => b.posts.filter((p) => p.action === 'session.focus')
  const S1 = { orgId: 'org-1', sessionId: 'ses-1' }

  // Nothing bound → nothing claimed, however long the app is up.
  b.tick(120_000); b.beat()
  check('heartbeat: no bound session ⇒ nothing posted', focusPosts().length === 0)

  // Bound and visible: the first beat marks, and slices land on the 30 s edge.
  b.bind(S1); b.beat()
  b.tick(20_000); b.beat()
  check('heartbeat: a partial slice under 30 s is not posted yet', focusPosts().length === 0)
  b.tick(11_000); b.beat()
  check('heartbeat: the slice posts once 30 s of visible, bound time has passed',
    focusPosts().length === 1 && focusPosts()[0].arg.sessionId === 'ses-1' && focusPosts()[0].arg.orgId === 'org-1' && focusPosts()[0].arg.deltaMs === 31_000,
    JSON.stringify(focusPosts()))

  // Hiding the window closes the open slice immediately, and hidden time is never claimed.
  b.tick(5_000); b.hide()
  check('heartbeat: hiding the window banks the open slice at once', focusPosts().length === 2 && focusPosts()[1].arg.deltaMs === 5_000)
  b.tick(600_000); b.beat(); b.beat()
  check('heartbeat: time while hidden is never claimed', focusPosts().length === 2)
  b.show()
  b.tick(31_000); b.beat()
  check('heartbeat: showing the window restarts the clock from the show, not the hide', focusPosts().length === 3 && focusPosts()[2].arg.deltaMs === 31_000)

  // Switching session flushes the old one before marking the new.
  b.tick(4_000); b.bind({ orgId: 'org-1', sessionId: 'ses-2' }); b.beat()
  check('heartbeat: switching session banks the previous one first', focusPosts().length === 4 && focusPosts()[3].arg.sessionId === 'ses-1' && focusPosts()[3].arg.deltaMs === 4_000)
  b.tick(31_000); b.beat()
  check('heartbeat: the new session accrues on its own row', focusPosts().length === 5 && focusPosts()[4].arg.sessionId === 'ses-2')

  // A slept machine: one enormous gap between beats is dropped, not posted.
  b.tick(6 * 3600_000); b.beat()
  check('heartbeat: a gap over the cap (slept machine) is dropped, never posted', focusPosts().length === 5, JSON.stringify(focusPosts().slice(5)))
  b.tick(31_000); b.beat()
  check('heartbeat: it resumes normally after the dropped gap', focusPosts().length === 6 && focusPosts()[5].arg.deltaMs === 31_000)

  // Sub-second noise is not a claim either.
  b.tick(400)
  disposers.forEach((d) => d())
  check('heartbeat: dispose banks nothing for a sub-second tail and removes both listeners', focusPosts().length === 6)
  b.bind(S1); b.tick(60_000); b.beat(); b.hide()
  check('heartbeat: after dispose no listener is left to post', focusPosts().length === 6)
  check('client: the seam is withdrawn on dispose', b.win.__ARXA_DASHBOARD__ === undefined)
} finally {
  b.restore()
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
