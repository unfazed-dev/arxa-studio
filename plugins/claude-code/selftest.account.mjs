import { strict as assert } from 'node:assert'
import { EventEmitter } from 'node:events'
import { createAccountRpc, accountStatus, ACCOUNT_CHANNEL, SIGNOUT_ARGS } from './lib/account.js'
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

console.log(`selftest.account: ${n} ok`)
