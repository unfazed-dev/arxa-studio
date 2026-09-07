import { strict as assert } from 'node:assert'
import { EventEmitter } from 'node:events'
import { createAccountRpc, accountStatus, ACCOUNT_CHANNEL, SIGNOUT_ARGS, LOGIN_TTL_MS } from './lib/account.js'
import { ACCOUNT_KEY } from './lib/auth-flow.js'
import { SIGNIN_CMD, INSTALL_URL } from './lib/models.js'

let n = 0; const ok = (s) => { n++; console.log(`  ok ${s}`) }

function harness ({ accounts, exit = 0, stderr = '' }) {
  const probeCalls = []
  let i = 0
  const probe = { current: async (force) => { probeCalls.push(force); const a = accounts[Math.min(i, accounts.length - 1)]; i++; return a } }
  const records = []
  const credentials = {
    modifyRecord: async (key, mutate) => { records.push(['set', key, await mutate(undefined)]) },
    deleteRecord: async (key) => { records.push(['del', key]) },
  }
  const spawned = []
  const spawn = ({ command, args, env }) => {
    spawned.push({ command, args, env })
    const child = new EventEmitter(); child.stderr = new EventEmitter()
    setTimeout(() => { if (stderr) child.stderr.emit('data', stderr); child.emit('exit', exit) }, 0)
    return child
  }
  const handle = createAccountRpc({ probe, credentials, spawn, binary: () => '/bin/claude', env: { X: '1' } })
  return { handle, probeCalls, records, spawned }
}

const IN = { loggedIn: true, email: 'e@x', subscriptionType: 'max', version: '2.1.261' }
const OUT = { loggedIn: false, error: 'Not logged in' }

assert.equal(ACCOUNT_CHANNEL, '/arxa-claude-account'); assert.deepEqual(SIGNOUT_ARGS, ['auth', 'logout']); ok('channel + argv pinned')

{
  const s = accountStatus(IN)
  assert.deepEqual(s, { loggedIn: true, email: 'e@x', subscriptionType: 'max', version: '2.1.261', error: undefined, signinCommand: SIGNIN_CMD, installUrl: INSTALL_URL })
  assert.equal(accountStatus(OUT).error, 'Not logged in', 'the probe\'s own words survive (F13)')
  assert.equal(accountStatus({ loggedIn: true, error: 'stale' }).error, undefined, 'a signed-in answer never carries an error')
  ok('status shape: probe fields + the command and docs URL the card shows')
}

{
  // status: forced only when asked; the grant is written on the sign-in TRANSITION, not per poll.
  const h = harness({ accounts: [OUT, OUT, IN, IN] })
  const a = await h.handle('status', {}); assert.equal(a.ok, true); assert.equal(a.value.loggedIn, false)
  const b = await h.handle('status', { force: true }); assert.equal(b.value.loggedIn, false)
  const c = await h.handle('status', { force: true }); assert.equal(c.value.loggedIn, true); assert.equal(c.value.email, 'e@x')
  await h.handle('status', { force: true })
  assert.deepEqual(h.probeCalls, [false, true, true, true], 'force is passed through, default false')
  assert.deepEqual(h.records, [['del', ACCOUNT_KEY], ['set', ACCOUNT_KEY, { kind: 'grant', payload: { email: 'e@x', subscriptionType: 'max', version: '2.1.261' } }]],
    'one delete when first seen signed out, one grant on the transition, nothing on repeats')
  ok('status: record follows transitions only (the card polls every 3 s)')
}

{
  // signout: `claude auth logout` through the CONFINING spawner, drop the record, re-probe forced.
  const h = harness({ accounts: [IN, OUT] })
  await h.handle('status', {})
  const r = await h.handle('signout')
  assert.equal(r.ok, true); assert.equal(r.value.loggedIn, false)
  assert.deepEqual(h.spawned, [{ command: '/bin/claude', args: ['auth', 'logout'], env: { X: '1' } }], 'exact argv, plugin env, injected spawner (D5)')
  assert.deepEqual(h.records.at(-1), ['del', ACCOUNT_KEY])
  assert.equal(h.probeCalls.at(-1), true, 'the re-probe after logout bypasses the TTL cache')
  ok('signout: runs auth logout via the sandboxed spawner, deletes the grant, re-probes forced')
}

{
  const h = harness({ accounts: [IN], exit: 1, stderr: 'keychain denied\n' })
  const r = await h.handle('signout')
  assert.equal(r.ok, false); assert.match(r.error.message, /exited 1: keychain denied/)
  assert.deepEqual(h.records, [], 'a failed logout keeps the record — the CLI is still signed in')
  ok('signout: a non-zero exit surfaces stderr and changes nothing')
}

{
  const h = createAccountRpc({ probe: { current: async () => IN }, credentials: {}, spawn: () => { throw new Error('must not spawn') }, binary: () => undefined, env: {} })
  const r = await h('signout'); assert.equal(r.ok, false); assert.match(r.error.message, /no claude binary/)
  const u = await h('nope'); assert.equal(u.ok, false); assert.match(u.error.message, /unknown endpoint nope/)
  ok('no binary → refused without spawning; unknown endpoint → refused')
}

// ---- login / code / cancel: the CLI's paste-a-code flow, driven through the same spawner.
function loginHarness ({ accounts, url = 'https://claude.com/cai/oauth/authorize?code=true&state=abc', exit = 0, err = '' }) {
  let i = 0
  const probeCalls = []
  const probe = { current: async (force) => { probeCalls.push(force); const a = accounts[Math.min(i, accounts.length - 1)]; i++; return a } }
  const records = []
  const credentials = { modifyRecord: async (key, mutate) => { records.push(['set', key, await mutate(undefined)]) }, deleteRecord: async (key) => { records.push(['del', key]) } }
  const spawned = []
  const children = []
  const spawn = ({ command, args, env }) => {
    spawned.push({ command, args, env })
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
    child.written = ''; child.killed = false
    child.stdin = { write: (s) => { child.written += s; setTimeout(() => { if (err) child.stderr.emit('data', err); child.emit('exit', exit) }, 0) } }
    child.kill = () => { child.killed = true; setTimeout(() => child.emit('exit', 143), 0) }
    children.push(child)
    // Only a login child waits for a pasted code; every other argv (auth logout)
    // is a one-shot that exits on its own.
    if (args[1] !== 'login') { setTimeout(() => { if (err) child.stderr.emit('data', err); child.emit('exit', exit) }, 0); return child }
    setTimeout(() => { child.stdout.emit('data', 'Opening browser to sign in…\n'); child.stdout.emit('data', `If the browser didn't open, visit: ${url}\nPaste code here if prompted > `) }, 0)
    return child
  }
  const timers = []
  const handle = createAccountRpc({ probe, credentials, spawn, binary: () => '/bin/claude', env: { X: '1' }, setTimeout: (fn, ms) => { timers.push(ms); const t = setTimeout(fn, 10_000); t.unref(); return t }, clearTimeout })
  return { handle, probeCalls, records, spawned, children, timers }
}

{
  const h = loginHarness({ accounts: [OUT, IN] })
  const s0 = await h.handle('status', {}); assert.equal(s0.value.pendingUrl, undefined)
  const l = await h.handle('login')
  assert.equal(l.ok, true); assert.match(l.value.url, /^https:\/\/claude\.com\/cai\/oauth\/authorize\?code=true/, 'the URL the CLI printed comes back verbatim')
  assert.deepEqual(h.spawned, [{ command: '/bin/claude', args: ['auth', 'login'], env: { X: '1' } }], 'exact argv, plugin env, injected spawner (D5)')
  const again = await h.handle('login'); assert.equal(again.value.url, l.value.url); assert.equal(h.spawned.length, 1, 'a second Sign in reuses the pending child')
  assert.equal((await h.handle('status', {})).value.pendingUrl, l.value.url, 'status carries the pending URL so a reopened card can continue')
  assert.equal(h.timers[0], LOGIN_TTL_MS, 'an unfinished login is reaped')
  const c = await h.handle('code', { code: '  abc#def  ' })
  assert.equal(c.ok, true); assert.equal(c.value.loggedIn, true, 'exit 0 → fresh probe → signed in')
  assert.equal(h.children[0].written, 'abc#def\n', 'the code is trimmed and handed to the CLI\'s stdin with a newline')
  assert.equal(h.probeCalls.at(-1), true, 'the post-login probe bypasses the TTL cache')
  assert.deepEqual(h.records.at(-1), ['set', ACCOUNT_KEY, { kind: 'grant', payload: { email: 'e@x', subscriptionType: 'max', version: '2.1.261' } }], 'the grant follows the transition')
  assert.equal((await h.handle('status', {})).value.pendingUrl, undefined, 'nothing pending once it finished')
  ok('login → url; code → stdin, exit 0, forced probe, grant written; pending is reused and cleared')
}

{
  const h = loginHarness({ accounts: [OUT], exit: 1, err: 'Invalid code\n' })
  await h.handle('login')
  const empty = await h.handle('code', { code: '   ' }); assert.equal(empty.ok, false); assert.match(empty.error.message, /paste the code/)
  const bad = await h.handle('code', { code: 'nope' })
  assert.equal(bad.ok, false); assert.match(bad.error.message, /sign-in failed: Invalid code/)
  assert.deepEqual(h.records, [], 'a failed exchange writes nothing')
  const none = await h.handle('code', { code: 'x' }); assert.equal(none.ok, false); assert.match(none.error.message, /no sign-in in progress/, 'the failed child is gone')
  ok('code: a non-zero exit surfaces the CLI\'s words; empty and orphan codes are refused')
}

{
  const h = loginHarness({ accounts: [OUT] })
  await h.handle('login')
  const r = await h.handle('cancel'); assert.deepEqual(r.value, { cancelled: true }); assert.equal(h.children[0].killed, true)
  assert.deepEqual((await h.handle('cancel')).value, { cancelled: false })
  await h.handle('login'); assert.equal(h.spawned.length, 2, 'after a cancel, Sign in starts a new child')
  const so = await h.handle('signout')
  assert.equal(so.ok, true); assert.equal(h.children[1].killed, true, 'sign out kills a pending login too')
  assert.deepEqual(h.spawned.at(-1).args, SIGNOUT_ARGS, 'and then runs auth logout')
  ok('cancel kills the child; sign out cancels a pending login')

  // A CLI that never exits must not wedge the RPC: run() kills it and answers.
  const stuck = loginHarness({ accounts: [OUT] })
  stuck.handle('login')
  const reap = []
  const wedged = createAccountRpc({
    probe: { current: async () => OUT }, credentials: { deleteRecord: async () => {} },
    spawn: () => { const c = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => reap.push('killed'); return c },
    binary: () => '/bin/claude', env: {},
    setTimeout: (fn) => { const t = setTimeout(fn, 0); return t }, clearTimeout,
  })
  const timedOut = await wedged('signout')
  assert.equal(timedOut.ok, false); assert.match(timedOut.error.message, /timed out/)
  assert.deepEqual(reap, ['killed'], 'the wedged child is killed, not leaked')
  ok('a CLI that never exits is reaped and surfaces a timeout instead of hanging')
}

console.log(`selftest.account: ${n} ok`)
