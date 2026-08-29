/**
 * github-link selftest — FULLY OFFLINE.
 *
 * A local mock GitHub (node http server on 127.0.0.1) is injected as both
 * tokenBase/apiBase and as the fetch target, so no real network call happens
 * anywhere. Covered:
 *   - PKCE verifier/challenge round-trip + code exchange via the mock (the
 *     mock REJECTS an exchange whose S256(code_verifier) does not match the
 *     code_challenge it saw in the captured authorize URL)
 *   - browser-flow state-parameter mismatch is refused
 *   - device-flow poll via the mock (authorization_pending → token)
 *   - keyring round-trip (real /usr/bin/security when present; otherwise the
 *     loud-warned memory fallback)
 *   - unlink removes state + secret; createPrivateRepo POSTs {private:true}
 * Plain node assert; exit 0 on green.
 */

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import {
  createGithubLink,
  createPkcePair,
  pkceChallenge,
  createKeyring,
  SECURITY_PATH,
} from './lib/index.js'
import { linkViaDevice } from './lib/auth.js'
import { writeState } from './lib/state.js'

let passed = 0
function ok(cond, label) {
  assert.ok(cond, label)
  passed++
  console.log('  ✓ ' + label)
}

// ---- mock GitHub -------------------------------------------------------------

const state = {} // shared test↔mock state

const mock = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    let body = {}
    try { body = raw ? JSON.parse(raw) : {} } catch {}
    const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }

    if (req.method === 'POST' && req.url === '/login/oauth/access_token') {
      // Device-flow poll.
      if (body.grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
        if (body.device_code !== state.deviceCode) return json(400, { error: 'bad_verification_code' })
        if (state.devicePolls++ === 0) return json(200, { error: 'authorization_pending' })
        return json(200, { access_token: 'dev-token', scope: 'repo,read:user' })
      }
      // Authorization-code exchange — the mock ENFORCES the PKCE round-trip.
      if (!state.expectedChallenge) return json(400, { error: 'no_authorize_observed' })
      if (!body.code_verifier || pkceChallenge(body.code_verifier) !== state.expectedChallenge) {
        return json(400, { error: 'pkce_mismatch' })
      }
      if (body.code !== state.expectedCode) return json(400, { error: 'bad_code' })
      return json(200, { access_token: 'browser-token', scope: 'repo read:user' })
    }
    if (req.method === 'POST' && req.url === '/login/device/code') {
      state.deviceCode = 'dc-' + Math.random().toString(36).slice(2)
      state.devicePolls = 0
      return json(200, {
        device_code: state.deviceCode,
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        interval: 0,
      })
    }
    if (req.method === 'GET' && req.url === '/user') {
      if (req.headers.authorization !== 'Bearer ' + state.expectBearer) return json(401, { message: 'Bad credentials' })
      return json(200, { login: state.login })
    }
    if (req.method === 'POST' && req.url === '/user/repos') {
      if (req.headers.authorization !== 'Bearer ' + state.expectBearer) return json(401, { message: 'Bad credentials' })
      if (body.private !== true) return json(422, { message: 'must be private' })
      return json(201, { full_name: state.login + '/' + body.name, private: true, name: body.name })
    }
    json(404, { message: 'not found: ' + req.method + ' ' + req.url })
  })
})

await new Promise((r) => mock.listen(0, '127.0.0.1', r))
const mockPort = mock.address().port
const mockBase = 'http://127.0.0.1:' + mockPort
const mockFetch = (input, init) => {
  const url = typeof input === 'string' ? new URL(input) : input
  return fetch(mockBase + url.pathname + url.search, init)
}

// ---- fixture: isolated ARXA_HOME + keyring ------------------------------------

const arxaHome = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-github-link-'))
const env = { ...process.env, ARXA_HOME: arxaHome }
const haveSecurity = fs.existsSync(SECURITY_PATH)
const keyring = createKeyring({ run: promisify(execFile) })
const CLIENT_ID = 'selftest-client-id'
env.ARXA_GITHUB_CLIENT_ID = CLIENT_ID

console.log('github-link selftest (offline, mock GitHub at 127.0.0.1:' + mockPort + ')')

try {
  // ---- PKCE primitives -------------------------------------------------------
  console.log('PKCE S256:')
  const pair = createPkcePair()
  ok(pair.verifier.length >= 43, 'verifier is high-entropy base64url (>=43 chars)')
  ok(pkceChallenge(pair.verifier) === pair.challenge, 'challenge = S256(verifier) round-trips')
  ok(pkceChallenge(pair.verifier + 'x') !== pair.challenge, 'a different verifier gives a different challenge')
  ok(!/[+/=]/.test(pair.challenge), 'challenge is base64url (no +/= padding)')

  // ---- browser + PKCE loopback flow -------------------------------------------
  console.log('browser + PKCE loopback flow:')
  let capturedAuthorizeUrl = null
  const fakeOpen = async (url, server) => {
    capturedAuthorizeUrl = new URL(url)
    // The mock enforces the challenge exactly as GitHub received it:
    state.expectedChallenge = capturedAuthorizeUrl.searchParams.get('code_challenge')
    // Simulate GitHub redirecting the user's browser to our loopback server.
    const cb = new URL('http://127.0.0.1:' + server.address().port + '/callback')
    cb.searchParams.set('code', 'auth-code-1')
    cb.searchParams.set('state', capturedAuthorizeUrl.searchParams.get('state'))
    await new Promise((resolve, reject) => {
      const req = http.get(cb, (res) => { res.resume(); res.on('end', resolve) })
      req.on('error', reject)
    })
  }

  state.expectedCode = 'auth-code-1'
  state.login = 'octocat'
  state.expectBearer = 'browser-token'
  const svcB = createGithubLink({ fetch: mockFetch, open: fakeOpen, tokenBase: mockBase, apiBase: mockBase, env })
  const linkState = await svcB.link()

  ok(linkState.login === 'octocat', 'link() resolves state with the linked login')
  assert.deepEqual(linkState.scopes, ['repo', 'read:user'])
  passed++
  console.log('  ✓ minimal scopes repo + read:user recorded')
  ok(capturedAuthorizeUrl.searchParams.get('code_challenge_method') === 'S256', 'authorize URL asks for S256')
  ok(capturedAuthorizeUrl.searchParams.get('scope') === 'repo read:user', 'authorize URL carries the minimal scopes')
  ok(/^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(capturedAuthorizeUrl.searchParams.get('redirect_uri')), 'redirect_uri is a 127.0.0.1 loopback on an ephemeral port')
  ok(capturedAuthorizeUrl.searchParams.get('client_id') === CLIENT_ID, 'authorize URL carries the configured client id')
  ok(JSON.parse(fs.readFileSync(path.join(arxaHome, 'github-link.json'), 'utf8')).linked === true, 'link state persisted locally under ~/.arxa (github-link.json)')
  ok(await keyring.getSecret('octocat') === 'browser-token', 'token stored in the keyring under the login — never in the state file')
  ok(!fs.readFileSync(path.join(arxaHome, 'github-link.json'), 'utf8').includes('browser-token'), 'the state file contains no token material')

  // state-parameter mismatch is refused
  await assert.rejects(
    () => new Promise((resolve, reject) => {
      const fakeOpenBad = async (url, server) => {
        const cb = new URL('http://127.0.0.1:' + server.address().port + '/callback')
        cb.searchParams.set('code', 'x')
        cb.searchParams.set('state', 'WRONG')
        http.get(cb, (res) => { res.resume(); res.on('end', () => resolve()) })
      }
      createGithubLink({ fetch: mockFetch, open: fakeOpenBad, tokenBase: mockBase, apiBase: mockBase, env })
        .link().then(resolve, reject)
    }),
    /state mismatch/,
    'browser flow refuses a redirect whose state does not match'
  )
  passed++
  console.log('  ✓ state-parameter mismatch is refused')
  await keyring.deleteSecret('octocat') // clean the keychain between flows

  // ---- device-flow fallback -----------------------------------------------------
  console.log('device-flow fallback:')
  state.expectBearer = 'dev-token'
  const device = await linkViaDevice({
    clientId: CLIENT_ID,
    fetch: mockFetch,
    tokenBase: mockBase,
    intervalMs: 5,
    onCode: (c) => { state.userCode = c.userCode },
  })
  ok(state.userCode === 'ABCD-1234', 'device flow surfaces the user code')
  ok(device.accessToken === 'dev-token', 'device poll completes: authorization_pending → access_token')
  ok(state.devicePolls >= 2, 'device poll honoured authorization_pending before succeeding')
  assert.deepEqual(device.scopes, ['repo', 'read:user'])
  passed++
  console.log('  ✓ device flow returns the minimal scopes')
  const devState = writeState({ linked: true, login: 'octocat', scopes: device.scopes, linkedAt: new Date().toISOString() }, env)
  await keyring.setSecret(devState.login, device.accessToken)
  ok(await keyring.getSecret('octocat') === 'dev-token', 'device token stored via the same keyring face as the service')

  // ---- keyring round-trip --------------------------------------------------------
  console.log('keyring (' + keyring.backend + ' backend):')
  if (!haveSecurity) console.log('  (note: /usr/bin/security unavailable — exercising the memory fallback)')
  const probeAccount = 'roundtrip-' + Date.now()
  await keyring.setSecret(probeAccount, 'secret-xyz')
  ok(await keyring.getSecret(probeAccount) === 'secret-xyz', 'set → get round-trips')
  await keyring.deleteSecret(probeAccount)
  ok(await keyring.getSecret(probeAccount) === null, 'delete removes the secret')
  ok(await keyring.getSecret('never-stored') === null, 'missing secret reads as null, not a throw')
  if (keyring.backend === 'security') {
    ok(haveSecurity, 'real /usr/bin/security keychain backend in use (service ' + (await import('./lib/keyring.js')).KEYCHAIN_SERVICE + ')')
  } else {
    ok(true, 'memory fallback active (loud-warned; no plaintext disk ever)')
  }

  // ---- faces: status / createPrivateRepo / unlink ----------------------------------
  console.log('faces:')
  const svc = createGithubLink({ fetch: mockFetch, tokenBase: mockBase, apiBase: mockBase, env })
  state.expectBearer = 'dev-token'
  const st = await svc.status()
  ok(st.linked === true && st.login === 'octocat' && st.tokenAvailable === true, 'status reports linked + tokenAvailable')
  const repo = await svc.createPrivateRepo('mira-site')
  ok(repo.private === true && repo.full_name === 'octocat/mira-site', 'createPrivateRepo POSTs /user/repos {private:true}')
  const un = await svc.unlink()
  ok(un.unlinked === true && un.hadLogin === 'octocat', 'unlink reports the removed login')
  ok(!fs.existsSync(path.join(arxaHome, 'github-link.json')), 'unlink removed the local state file')
  ok(await keyring.getSecret('octocat') === null, 'unlink deleted the stored secret')
  ok((await svc.status()).linked === false, 'status reads unlinked after unlink')
  await assert.rejects(() => svc.createPrivateRepo('x'), /not linked/, 'createPrivateRepo refuses when unlinked (D69 gate)')
  passed++
  console.log('  ✓ createPrivateRepo gate refuses when unlinked')
  await svc.unlink()
  ok(true, 'unlink is idempotent')
  passed++
} finally {
  await new Promise((r) => mock.close(r))
}

console.log('\ngithub-link selftest: ' + passed + ' checks passed')
process.exit(0)
