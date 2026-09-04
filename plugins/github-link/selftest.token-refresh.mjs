/**
 * github-link token-refresh selftest — FULLY OFFLINE, no mock server needed.
 *
 * Covers the four defects found on the 2026-09-04 RESTO smoke, none of which
 * any existing suite could reach:
 *   1. a blank clientId in the config file was passed through by `??` and sent
 *      as client_id='' — GitHub answers `incorrect_client_credentials`, the
 *      same error a revoked grant gives, so the blank sends you hunting the
 *      wrong fault.
 *   2. a refresh token rotated by ANOTHER arxa process forced a full
 *      interactive re-link instead of self-healing.
 *   3. readState() dropped relinkRequired, making the flag write-only: the
 *      file said "re-link", every reader saw undefined, the UI stayed silent.
 *   4. a successful refresh carried a stale relinkRequired:true forward.
 *
 * The keyring and fetch are both injected, so nothing touches the real
 * Keychain or the network.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createGithubLink } from './lib/index.js'
import { writeState, readState } from './lib/state.js'

let passed = 0
const ok = (label) => { passed++; console.log('  ✓ ' + label) }

const SHIPPED = 'shipped-test-client-id'
const LOGIN = 'octocat'
const REFRESH_KEY = LOGIN + '#refresh'

/** A keyring over a Map — same three faces the real one exposes. */
function fakeRing (seed = {}) {
  const mem = new Map(Object.entries(seed))
  return {
    backend: 'test',
    mem,
    async setSecret (a, v) { mem.set(a, v) },
    async getSecret (a) { return mem.get(a) ?? null },
    async deleteSecret (a) { mem.delete(a) },
  }
}

/** Fresh isolated ARXA_HOME with a linked-but-expired state. */
function fixture ({ clientIdConfig } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-link-refresh-'))
  const env = { ARXA_HOME: home }
  if (clientIdConfig !== undefined) {
    fs.writeFileSync(path.join(home, 'github-link-config.json'), JSON.stringify({ clientId: clientIdConfig }))
  }
  writeState({
    linked: true, login: LOGIN, scopes: ['repo'],
    linkedAt: '2026-09-03T01:21:17.065Z',
    accessExpiresAt: '2020-01-01T00:00:00.000Z', // long expired → forces refresh
  }, env)
  return { home, env }
}

/** A fetch standing in for GitHub's token endpoint. `handler` sees the parsed
  * payload and returns either an error string or a token bundle. */
function fakeFetch (handler) {
  const calls = []
  const fn = async (_url, init) => {
    const payload = JSON.parse(init.body)
    calls.push(payload)
    const out = await handler(payload, calls.length)
    return { ok: true, async json () { return out } }
  }
  fn.calls = calls
  return fn
}

const svc = (env, ring, fetch) => createGithubLink({
  keyring: ring, fetch, env, shippedClientId: SHIPPED,
  tokenBase: 'https://example.invalid', apiBase: 'https://example.invalid',
})

console.log('github-link token-refresh selftest (offline)')

// ---- 1. blank config clientId must fall back to shipped, never send '' ------
{
  const { env } = fixture({ clientIdConfig: '' })
  const ring = fakeRing({ [LOGIN]: 'old-access', [REFRESH_KEY]: 'ghr_one' })
  const fetch = fakeFetch(() => ({ access_token: 'gho_new', refresh_token: 'ghr_two', expires_in: 28800, scope: 'repo' }))
  const { token } = await svc(env, ring, fetch).gitCredentials(true)
  assert.equal(token, 'gho_new')
  assert.equal(fetch.calls.length, 1)
  assert.equal(fetch.calls[0].client_id, SHIPPED, 'blank config must fall back to the shipped id')
  assert.notEqual(fetch.calls[0].client_id, '', 'an empty client_id is what drew incorrect_client_credentials')
  ok('blank clientId in config falls back to shippedClientId (not sent as "")')
}

// ---- 2. a refresh token rotated mid-flight self-heals, no re-link ----------
{
  const { env } = fixture()
  const ring = fakeRing({ [LOGIN]: 'old-access', [REFRESH_KEY]: 'ghr_one' })
  // Another arxa process refreshes while our request is in flight: it burns
  // ghr_one and stores ghr_two. GitHub then refuses ours.
  const fetch = fakeFetch(async (p) => {
    if (p.refresh_token === 'ghr_one') {
      await ring.setSecret(REFRESH_KEY, 'ghr_two')
      return { error: 'incorrect_client_credentials' }
    }
    return { access_token: 'gho_healed', refresh_token: 'ghr_three', expires_in: 28800, scope: 'repo' }
  })
  const { token } = await svc(env, ring, fetch).gitCredentials(true)
  assert.equal(token, 'gho_healed', 'must retry with the rotated token')
  assert.equal(fetch.calls.length, 2, 'exactly one retry, not a loop')
  assert.equal(fetch.calls[1].refresh_token, 'ghr_two')
  assert.equal(readState(env).relinkRequired, false, 'a self-heal must NOT demand a re-link')
  ok('a refresh token rotated by another process self-heals instead of forcing re-link')
}

// ---- 3. nothing rotated → no pointless second request, flag IS readable ----
{
  const { env } = fixture()
  const ring = fakeRing({ [LOGIN]: 'old-access', [REFRESH_KEY]: 'ghr_one' })
  const fetch = fakeFetch(() => ({ error: 'bad_refresh_token' }))
  await assert.rejects(
    () => svc(env, ring, fetch).gitCredentials(true),
    /re-link GitHub from Settings/,
    'a genuinely dead grant must say what to do',
  )
  assert.equal(fetch.calls.length, 1, 'unchanged refresh token → no wasted retry')
  const st = readState(env)
  assert.equal(st.relinkRequired, true, 'readState must surface the flag, not drop it')
  assert.match(st.relinkReason, /bad_refresh_token/)
  ok('a dead grant sets relinkRequired AND readState surfaces it (was write-only)')

  // status() spreads readState — the UI's actual source of truth.
  const reported = await svc(env, ring, fetch).status()
  assert.equal(reported.relinkRequired, true, 'status() must carry the flag to the UI')
  ok('status() reports relinkRequired so the UI can prompt the re-link')
}

// ---- 4. a later successful refresh clears the stale flag -------------------
{
  const { env } = fixture()
  writeState({ ...readState(env), relinkRequired: true, relinkReason: 'stale' }, env)
  const ring = fakeRing({ [LOGIN]: 'old-access', [REFRESH_KEY]: 'ghr_one' })
  const fetch = fakeFetch(() => ({ access_token: 'gho_ok', refresh_token: 'ghr_two', expires_in: 28800, scope: 'repo' }))
  await svc(env, ring, fetch).gitCredentials(true)
  const st = readState(env)
  assert.equal(st.relinkRequired, false, 'a working refresh proves the grant is alive')
  assert.equal(st.relinkReason, null)
  ok('a successful refresh clears a stale relinkRequired instead of nagging forever')
}

console.log(`# ${passed} ok`)
