#!/usr/bin/env node
/**
 * arxa-git-card — the re-link dialog must be closeable. TIMING regression.
 *
 * Why this file exists, separately from selftest.mjs: the bug the user hit
 * (2026-09-06, "on the link dialog i cannot close the dialog once opened")
 * was invisible to every static pin. The wiring was correct — the modal had
 * an onClose, the button had an onClick, both called setRelink(null) — and
 * the dialog still could not be closed, because a 700ms interval outside the
 * modal kept writing the state that held it open. Nothing you can grep for.
 *
 * So this drives the REAL shipped functions against a REAL clock. It slices
 * `stopRelink` and `startRelink` straight out of the generated client.js and
 * evaluates that exact text with the closure variables injected, so editing
 * the logic changes what runs here. It does not re-implement them.
 *
 * The scenario is the user's, exactly:
 *   1. start the flow — card.github.link NEVER settles (it long-polls until
 *      GitHub confirms, which a cancelling user never does)
 *   2. the code arrives, the dialog shows it
 *   3. Cancel
 *   4. wait past several poll ticks — the dialog must STAY closed, and the
 *      poll must have actually stopped, not merely been ignored
 *   5. the button must work again afterwards (the old `if (relink !== null)
 *      return` guard left the user unable to retry at all)
 *
 * Exit 0 = every assertion held.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const client = readFileSync(path.join(here, 'lib', 'client.js'), 'utf8')

let failures = 0
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : '\n        ' + detail))
  if (!ok) failures++
}

// ---- slice the real functions out of the shipped bundle --------------------
/** Text from `const <name> = ` to the matching close of its body. */
function sliceFn (src, name) {
  const start = src.indexOf('const ' + name + ' = ')
  if (start < 0) throw new Error('cannot find ' + name + ' in client.js')
  let i = src.indexOf('{', start)
  let depth = 0
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1) }
  }
  throw new Error('unbalanced braces slicing ' + name)
}

const source = sliceFn(client, 'stopRelink') + '\n' + sliceFn(client, 'startRelink')
check('the shipped bundle still carries both halves of the flow',
  source.includes('relinkRun.current = null') && source.includes('window.clearInterval'))

// ---- harness: the closure the two functions actually live in ---------------
function mount ({ linkSettles = null } = {}) {
  const log = { relink: [], notified: [], loaded: 0, deviceCalls: 0, linkCalls: 0 }
  let relinkState = null
  const relinkRun = { current: null }
  const alive = { current: true }

  const post = (action) => {
    if (action === 'card.github.device') {
      log.deviceCalls++
      return Promise.resolve({ userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' })
    }
    if (action === 'card.github.link') {
      log.linkCalls++
      // The real call long-polls until GitHub confirms. A cancelling user
      // never confirms, so by default this promise NEVER settles.
      return linkSettles === null ? new Promise(() => {}) : linkSettles
    }
    return Promise.resolve(null)
  }
  const setRelink = (v) => { relinkState = v; log.relink.push(v === null ? null : (v.userCode ?? 'starting')) }

  const api = new Function(
    'window', 'post', 'setRelink', 'relinkRun', 'alive', 'notify', 't', 'load', 'loadPr', 'pr', 'reasonOf',
    source + '\nreturn { stopRelink, startRelink }',
  )(
    globalThis, post, setRelink, relinkRun, alive,
    (kind, msg) => log.notified.push(kind + ':' + msg),
    (key) => key,
    () => { log.loaded++ },
    () => {},
    void 0,
    (e) => String(e && e.message),
  )
  return { ...api, log, relinkRun, alive, state: () => relinkState }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- 1. the bug, reproduced then disproved ---------------------------------
{
  const c = mount()
  c.startRelink()
  await sleep(1600) // two 700ms ticks: the code has arrived and is on screen
  check('the dialog opens and shows the one-time code',
    c.state() !== null && c.state().userCode === 'ABCD-1234',
    'state was ' + JSON.stringify(c.state()))
  const ticksBefore = c.log.deviceCalls

  c.stopRelink()
  check('Cancel closes it immediately', c.state() === null)

  await sleep(2500) // >3 further ticks — this is where the bug used to bite
  check('IT STAYS CLOSED — no late poll reopens the dialog (the reported bug)',
    c.state() === null,
    'reopened; setRelink sequence was ' + JSON.stringify(c.log.relink))
  check('and the poll actually STOPPED rather than being ignored',
    c.log.deviceCalls === ticksBefore,
    'poll kept firing: ' + ticksBefore + ' -> ' + c.log.deviceCalls)

  // The old guard was `if (relink !== null) return` against a state that the
  // poll kept resetting, so after a cancel the button did nothing forever.
  c.startRelink()
  check('the button works again after a cancel', c.state() !== null && c.log.linkCalls === 2)
  c.stopRelink()
}

// ---- 2. a dismissed flow that GitHub later confirms -------------------------
{
  let settle
  const c = mount({ linkSettles: new Promise((r) => { settle = r }) })
  c.startRelink()
  await sleep(900)
  c.stopRelink()
  settle({ linked: true })
  await sleep(200)
  check('a dismissed flow that GitHub confirms anyway still refreshes the card',
    c.log.loaded === 1, 'load() ran ' + c.log.loaded + ' times')
  check('but it does not reopen the dialog or toast at someone who walked away',
    c.state() === null && c.log.notified.length === 0,
    'notified: ' + JSON.stringify(c.log.notified))
}

// ---- 3. unmount must not leave a timer behind ------------------------------
{
  const c = mount()
  c.startRelink()
  await sleep(900)
  const before = c.log.deviceCalls
  c.alive.current = false        // what the unmount effect sets
  c.stopRelink()                 // and what it then does to the live run
  await sleep(1600)
  check('unmount stops the poll — no timer outlives the card',
    c.log.deviceCalls === before, 'poll survived: ' + before + ' -> ' + c.log.deviceCalls)
}

console.log(failures === 0
  ? '\narxa-git-card selftest.relink: ALL GREEN'
  : `\narxa-git-card selftest.relink: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
