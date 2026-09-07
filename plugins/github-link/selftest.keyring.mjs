// Selftest: the keyring's platform ladder (bridge → platform store → memory).
//
// The Linux half is what this file exists for: the token used to land in the
// in-memory fallback on every non-macOS host, which means re-linking GitHub
// after every engine restart. Nothing here touches a real keychain or a real
// Secret Service — the store binaries and the usability probe are injected.
import { strict as assert } from 'node:assert'
import { createKeyring, KEYCHAIN_SERVICE, SECRET_TOOL_PATH, SECURITY_PATH } from './lib/keyring.js'

let n = 0
const ok = (s) => { n++; console.log(`  ok ${s}`) }
// The backends warn loudly by design; keep the transcript readable.
const quiet = async (fn) => {
  const warn = console.warn
  console.warn = () => {}
  try { return await fn() } finally { console.warn = warn }
}

// ---- Linux: secret-tool, when a Secret Service answers the probe.
{
  const calls = []
  const k = createKeyring({
    platform: 'linux',
    secretToolPath: '/usr/bin/env', // exists, so the ladder gets past existence
    probeStore: () => true,
    runSecret: (cmd, args, stdin) => {
      calls.push({ cmd, args, stdin })
      if (args[0] === 'lookup') return Promise.resolve('ghp_stored\n')
      return Promise.resolve('')
    },
  })
  assert.equal(k.backend, 'secret-tool')
  await k.setSecret('octocat', 'ghp_secret')
  assert.equal(await k.getSecret('octocat'), 'ghp_stored')
  await k.deleteSecret('octocat')
  assert.deepEqual(calls.map((c) => c.args[0]), ['store', 'lookup', 'clear'])
  assert.deepEqual(calls[0].args.slice(1), ['--label=arxa-studio: octocat', 'service', KEYCHAIN_SERVICE, 'account', 'octocat'])
  assert.equal(calls[0].stdin, 'ghp_secret', 'the secret goes in on stdin, never on argv where ps would show it')
  assert.deepEqual(calls[1].args, ['lookup', 'service', KEYCHAIN_SERVICE, 'account', 'octocat'])
  assert.deepEqual(calls[2].args, ['clear', 'service', KEYCHAIN_SERVICE, 'account', 'octocat'])
  ok('linux: store/lookup/clear with our attributes, secret on stdin')
}

// ---- Linux: "no such secret" is unset, not a failure.
{
  const k = createKeyring({
    platform: 'linux',
    secretToolPath: '/usr/bin/env',
    probeStore: () => true,
    runSecret: (cmd, args) => {
      if (args[0] === 'lookup') return Promise.reject(new Error('secret-tool exited 1: '))
      if (args[0] === 'clear') return Promise.reject(new Error('secret-tool exited 1: No such secret'))
      return Promise.resolve('')
    },
  })
  assert.equal(await k.getSecret('nobody'), null, 'a missing secret reads as null')
  await k.deleteSecret('nobody') // must not throw
  ok('linux: an empty lookup and a no-op clear are unset, not errors')
}

// ---- Linux: a real failure still escapes (a broken store must not look empty).
{
  const k = createKeyring({
    platform: 'linux',
    secretToolPath: '/usr/bin/env',
    probeStore: () => true,
    runSecret: () => Promise.reject(new Error('secret-tool exited 127: dbus-launch not found')),
  })
  await assert.rejects(() => k.getSecret('octocat'), /exited 127/, 'a broken store throws rather than reporting "no token"')
  ok('linux: a genuine store failure is not swallowed')
}

// ---- Linux: binary present, no Secret Service → memory, loudly.
{
  const k = await quiet(async () => {
    const ring = createKeyring({ platform: 'linux', secretToolPath: '/usr/bin/env', probeStore: () => false, runSecret: () => { throw new Error('must not run') } })
    assert.equal(ring.backend, 'memory')
    await ring.setSecret('octocat', 'held-in-ram')
    return ring
  })
  assert.equal(await k.getSecret('octocat'), 'held-in-ram')
  await k.deleteSecret('octocat')
  ok('linux: no Secret Service → in-memory fallback, still functional for this process')
}

// ---- Linux: no secret-tool at all → memory without probing.
{
  const k = await quiet(async () => createKeyring({ platform: 'linux', secretToolPath: '/no/such/secret-tool', probeStore: () => { throw new Error('must not probe') } }))
  assert.equal(k.backend, 'memory')
  ok('linux: no libsecret installed → memory, no probe attempted')
}

// ---- macOS is unchanged by the port.
{
  const calls = []
  const k = createKeyring({
    platform: 'darwin',
    securityPath: '/usr/bin/env',
    probeStore: () => true,
    run: async (cmd, args) => { calls.push(args); return { stdout: args[0] === 'find-generic-password' ? 'ghp_mac\n' : '' } },
  })
  assert.equal(k.backend, 'security')
  await k.setSecret('octocat', 'ghp_secret')
  assert.equal(await k.getSecret('octocat'), 'ghp_mac')
  assert.deepEqual(calls[0], ['add-generic-password', '-s', KEYCHAIN_SERVICE, '-a', 'octocat', '-w', 'ghp_secret', '-U'])
  ok('darwin: the security rung is untouched')
}

// ---- The bridge still outranks everything.
{
  const seen = []
  const bridge = {
    setSecret: async (...a) => seen.push(['set', ...a]),
    getSecret: async () => 'from-bridge',
    deleteSecret: async (...a) => seen.push(['del', ...a]),
  }
  const k = createKeyring({ bridge, platform: 'linux', secretToolPath: '/usr/bin/env', probeStore: () => { throw new Error('must not probe') } })
  assert.equal(k.backend, 'tauri-bridge')
  assert.equal(await k.getSecret('octocat'), 'from-bridge')
  ok('the Tauri bridge rung wins on every platform')
}

assert.equal(SECRET_TOOL_PATH, '/usr/bin/secret-tool')
assert.equal(SECURITY_PATH, '/usr/bin/security')
ok('store paths pinned')

console.log(`selftest.keyring: ${n} ok`)
