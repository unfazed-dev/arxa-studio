/**
 * F9 sign-in flow selftest — offline, no keychain, no network.
 *
 * Guards three things the live surface cannot tell you until it is too late:
 * that the one-time code actually reaches the user, that the token never enters
 * the credential record, and that the plugin entry does not repeat F1's
 * boot-killing top-level `authorization` inject.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { githubAuthFlow, ACCOUNT_KEY } from './lib/auth-flow.js'

let passed = 0
const ok = (m) => { passed++; console.log('  ✓ ' + m) }

const LINKED = { linked: true, login: 'octocat', scopes: ['repo', 'workflow'], accessExpiresAt: '2026-09-05T00:00:00.000Z' }

/** A github-link stand-in: link() resolves only after the code is surfaced. */
function fakeGithub ({ fail } = {}) {
  let code = null
  let release
  const gate = new Promise((r) => { release = r })
  return {
    deviceCode: () => code,
    link: async () => {
      code = { userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' }
      await gate                       // hold open so the poll can see the code
      if (fail) throw new Error(fail)
      return LINKED
    },
    _release: () => release(),
  }
}
function fakeSession () {
  const notes = []
  const ac = new AbortController()
  return { notes, abort: () => ac.abort(), signal: ac.signal, notify: (n) => notes.push(n) }
}
function fakeCredentials () {
  const written = []
  return { written, modifyRecord: async (k, fn) => { written.push({ key: k, record: await fn() }) } }
}

console.log('github-link sign-in flow selftest (offline)')

// ---- shape ---------------------------------------------------------------
{
  const flow = githubAuthFlow({ github: fakeGithub(), credentials: fakeCredentials() })
  assert.equal(flow.key, ACCOUNT_KEY)
  assert.equal(flow.label, 'GitHub')
  assert.deepEqual(flow.methods.map((m) => m.id), ['device'])
  ok('registers a GitHub flow with a device method')
}

// ---- the code reaches the user, and the record carries no token -----------
{
  const github = fakeGithub(); const session = fakeSession(); const credentials = fakeCredentials()
  const flow = githubAuthFlow({ github, credentials, pollMs: 5 })
  const running = flow.run(session)
  // Let the poll observe the code, then let link() finish.
  await new Promise((r) => setTimeout(r, 40))
  const coded = session.notes.find((n) => n.code)
  assert.ok(coded, 'the one-time code must be surfaced, not swallowed by a spinner')
  assert.equal(coded.code, 'ABCD-1234')
  assert.match(coded.message, /github\.com\/login\/device/)
  github._release()
  await running

  assert.equal(credentials.written.length, 1)
  const { key, record } = credentials.written[0]
  assert.equal(key, ACCOUNT_KEY)
  assert.equal(record.kind, 'grant')
  assert.deepEqual(record.payload, { login: 'octocat', scopes: ['repo', 'workflow'], accessExpiresAt: '2026-09-05T00:00:00.000Z' })
  // The token lives in the OS keychain and nowhere else — github-link's entire
  // storage story depends on it never reaching a record or a client surface.
  const blob = JSON.stringify(record)
  for (const leak of ['gho_', 'ghr_', 'token', 'secret']) assert.ok(!blob.includes(leak), `record must not carry ${leak}`)
  ok('surfaces the device code, then records identity only — never the token')

  assert.match(session.notes.at(-1).message, /Linked as octocat/)
  ok('confirms the linked login when it completes')
}

// ---- cancel ---------------------------------------------------------------
{
  const github = fakeGithub(); const session = fakeSession()
  const flow = githubAuthFlow({ github, credentials: fakeCredentials(), pollMs: 5 })
  const running = flow.run(session)
  await new Promise((r) => setTimeout(r, 20))
  session.abort()
  await assert.rejects(() => running, /sign-in cancelled/)
  ok('cancelling releases the flow instead of hanging on a poll that cannot abort')
}

// ---- failure surfaces --------------------------------------------------------
{
  const github = fakeGithub({ fail: 'device-code error: expired_token' }); const session = fakeSession()
  const credentials = fakeCredentials()
  const flow = githubAuthFlow({ github, credentials, pollMs: 5 })
  const running = flow.run(session)
  await new Promise((r) => setTimeout(r, 20)); github._release()
  await assert.rejects(() => running, /expired_token/)
  assert.equal(credentials.written.length, 0, 'a failed sign-in must not write a grant')
  ok('a failed sign-in surfaces the error and writes no credential')
}

// ---- F1 regression: the boot-killing inject ---------------------------------
{
  const entry = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8')
  const line = entry.match(/^export const inject = \[(.*)\]$/m)
  assert.ok(line, 'plugin entry must declare inject')
  assert.ok(!line[1].includes('authorization'),
    "F1: 'authorization' in the top-level inject leaves the plugin pending forever and dsh fails the WHOLE boot — arxa studio will not start")
  assert.match(entry, /ctx\.inject\(\['authorization'\]/, 'it must be reached through a deferred ctx.inject instead')
  ok("plugin entry keeps 'authorization' deferred — arxa still boots without the service")
}

// ---- F10: the seam must actually be mounted ---------------------------------
// A flow registered into a service nobody mounts is inert. That was the state
// until 2026-09-04: pi-ai's, claude-code's and this one all sat behind a
// deferred inject whose service never arrived, so arxa had NO sign-in surface
// for any provider. Assert the row, or this whole file passes while the feature
// does nothing.
{
  const profile = readFileSync(new URL('../../profile/cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(profile, /name: '@deepseek-ai\/dsh-authorization'/,
    'no profile row mounts dsh-authorization — every sign-in flow, including this one, is inert')
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.ok(pkg.dependencies['@deepseek-ai/dsh-authorization'],
    'dsh-authorization must be a declared dependency — it resolved only via a hoisted transitive copy')
  ok('the authorization seam is mounted by a profile row and declared as a dependency')
}

console.log(`# ${passed} ok`)
