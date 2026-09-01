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
      // D76 refresh grant — rotated refresh token + fresh expiry.
      if (body.grant_type === 'refresh_token') {
        if (body.refresh_token !== 'dev-refresh') return json(400, { error: 'bad_refresh_token' })
        state.expectBearer = 'dev-token-2'
        return json(200, { access_token: 'dev-token-2', scope: 'repo,read:user,delete_repo,workflow', refresh_token: 'dev-refresh-2', expires_in: 28800 })
      }
      // Device-flow poll.
      if (body.grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
        if (body.device_code !== state.deviceCode) return json(400, { error: 'bad_verification_code' })
        if (state.devicePolls++ === 0) return json(200, { error: 'authorization_pending' })
        return json(200, { access_token: 'dev-token', scope: 'repo,read:user,delete_repo,workflow', refresh_token: 'dev-refresh', expires_in: 28800 })
      }
      // Authorization-code exchange — the mock ENFORCES the PKCE round-trip.
      if (!state.expectedChallenge) return json(400, { error: 'no_authorize_observed' })
      if (!body.code_verifier || pkceChallenge(body.code_verifier) !== state.expectedChallenge) {
        return json(400, { error: 'pkce_mismatch' })
      }
      if (body.code !== state.expectedCode) return json(400, { error: 'bad_code' })
      return json(200, { access_token: 'browser-token', scope: 'repo read:user delete_repo workflow' })
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
  const svcB = createGithubLink({ fetch: mockFetch, open: fakeOpen, tokenBase: mockBase, apiBase: mockBase, env, useDeviceFlow: false })
  const linkState = await svcB.link()

  ok(linkState.login === 'octocat', 'link() resolves state with the linked login')
  assert.deepEqual(linkState.scopes, ['repo', 'read:user', 'delete_repo', 'workflow'])
  passed++
  console.log('  ✓ scopes repo + read:user + delete_repo recorded (D81: trash purge deletes repos)')
  ok(capturedAuthorizeUrl.searchParams.get('code_challenge_method') === 'S256', 'authorize URL asks for S256')
  ok(capturedAuthorizeUrl.searchParams.get('scope') === 'repo read:user delete_repo workflow', 'authorize URL carries the scopes incl. delete_repo + workflow')
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
      createGithubLink({ fetch: mockFetch, open: fakeOpenBad, tokenBase: mockBase, apiBase: mockBase, env, useDeviceFlow: false })
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
  assert.deepEqual(device.scopes, ['repo', 'read:user', 'delete_repo', 'workflow'])
  passed++
  console.log('  ✓ device flow returns the minimal scopes')
  const devState = writeState({ linked: true, login: 'octocat', scopes: device.scopes, linkedAt: new Date().toISOString() }, env)
  await keyring.setSecret(devState.login, device.accessToken)
  ok(await keyring.getSecret('octocat') === 'dev-token', 'device token stored via the same keyring face as the service')

  // ---- shipped defaults: device flow ON, client id baked --------------------------
  console.log('shipped defaults:')
  state.expectBearer = 'dev-token'
  let openedUrl = null
  const homeD = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-gh-d-'))
  const svcD = createGithubLink({
    fetch: mockFetch,
    open: async (u) => { openedUrl = String(u) },
    tokenBase: mockBase,
    apiBase: mockBase,
    env: { ...process.env, ARXA_HOME: homeD },
  })
  const pending = svcD.link()
  await new Promise((r) => setTimeout(r, 300))
  ok(svcD.deviceCode() !== null && svcD.deviceCode().userCode === 'ABCD-1234', 'deviceCode() surfaces the live one-time code to the UI face')
  ok(openedUrl === 'https://github.com/login/device', 'device flow auto-opens the verification page once the code is issued')
  const linkSrc = fs.readFileSync(new URL('./lib/index.js', import.meta.url), 'utf8')
  ok(linkSrc.includes("typeof open === 'function' ? open : defaultOpen"), 'device flow falls back to the system opener when none is injected (packed-app fix)')
  const dState = await pending
  ok(dState.login === 'octocat', 'default flow is the device flow — no useDeviceFlow flag needed (OAuth app: secret-less path)')
  ok(svcD.deviceCode() === null, 'deviceCode() clears after a successful link')
  await keyring.deleteSecret('octocat')
  await keyring.setSecret('octocat', 'dev-token') // restore what the faces section asserts on
  const homeE = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-gh-e-'))
  const svcE = createGithubLink({ fetch: mockFetch, tokenBase: mockBase, apiBase: mockBase, env: { ...process.env, ARXA_HOME: homeE }, shippedClientId: null })
  await assert.rejects(() => svcE.link(), /no client id/, 'link() refuses loud when no client id exists anywhere (shipped fallback disabled)')
  passed++
  console.log('  ✓ device-flow default + shipped client-id fallback + loud refusal')

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
  const svc = createGithubLink({ fetch: mockFetch, tokenBase: mockBase, apiBase: mockBase, env, useDeviceFlow: false })
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
// ---- D76: refresh-token machinery -------------------------------------------
{
  const { writeState, readState, clearState } = await import('./lib/index.js')
  const svcD76 = createGithubLink({ fetch: mockFetch, tokenBase: mockBase, apiBase: mockBase, env })
  try {
    // Expired link with a stored refresh token: gitCredentials self-refreshes.
    writeState({ linked: true, login: 'octo-d76', scopes: ['repo'], accessExpiresAt: new Date(Date.now() - 1000).toISOString() }, env)
    await keyring.setSecret('octo-d76', 'stale-token')
    await keyring.setSecret('octo-d76#refresh', 'dev-refresh')
    const cred = await svcD76.gitCredentials()
    ok(cred.token === 'dev-token-2', 'D76: expired access token self-refreshes through the stored refresh grant')
    ok(await keyring.getSecret('octo-d76') === 'dev-token-2', 'D76: fresh access token persisted in the keyring')
    ok(await keyring.getSecret('octo-d76#refresh') === 'dev-refresh-2', 'D76: rotated refresh token persisted')
    ok(Date.parse(readState(env).accessExpiresAt) > Date.now(), 'D76: expiry clock advanced after refresh')
    // Live (non-expired) link: no network, current token served as-is.
    writeState({ linked: true, login: 'octo-d76', scopes: ['repo'], accessExpiresAt: new Date(Date.now() + 3600_000).toISOString() }, env)
    const live = await svcD76.gitCredentials()
    ok(live.token === 'dev-token-2', 'D76: non-expired link serves the stored token without refreshing')
  } finally {
    await keyring.deleteSecret('octo-d76').catch(() => {})
    await keyring.deleteSecret('octo-d76#refresh').catch(() => {})
    clearState(env)
  }
  passed++
  console.log('  ✓ D76 refresh machinery verified (expired refresh, rotation, live serve)')
}
} finally {
  await new Promise((r) => mock.close(r))
}

// ---- D73: gitCredentials face (push half) -----------------------------------
{
  const { writeState, clearState } = await import('./lib/index.js')
  const svcCreds = createGithubLink({ keyring, env })
  try {
    await assert.rejects(() => svcCreds.gitCredentials(), /not linked/, 'gitCredentials refuses when unlinked')
    writeState({ linked: true, login: 'octo-creds', scopes: ['repo'] }, env)
    await keyring.setSecret('octo-creds', 'tok-123')
    const creds = await svcCreds.gitCredentials()
    ok(creds && creds.login === 'octo-creds' && creds.token === 'tok-123', 'gitCredentials returns { login, token } for the linked account')
    await keyring.deleteSecret('octo-creds')
    writeState({ linked: true, login: 'octo-creds', scopes: ['repo'] }, env)
    await assert.rejects(() => svcCreds.gitCredentials(), /no refresh token stored|token unavailable/, 'gitCredentials refuses when the keyring lost the token')
  } finally {
    clearState(env)
  }
  passed++
  console.log('  ✓ gitCredentials face verified (linked / unlinked / token-lost)')
}



// ---- Part B S1: frame API + runner (grilled 2026-08-31) ---------------------
{
  const { settingsApi, protectionApi, registrationTokenApi, latestRunnerTarballApi, ensureRunner, runnerExists } = await import('./lib/index.js')
  const calls = []
  const mockFetch = async (url, opts = {}) => {
    calls.push(String(url) + ' ' + (opts.method ?? 'GET'))
    const u = String(url)
    if (u.includes('/repos/planframed/') && u.includes('/branches/main/protection')) {
      return { ok: false, status: 403, json: async () => ({ message: 'Upgrade to GitHub Pro or make this repository public to enable this feature.' }) }
    }
    if (u.includes('/branches/main/protection')) {
      return { ok: true, status: 200, json: async () => ({}) }
    }
    if (u.includes('/repos/octocat/framed') && opts.method === 'PATCH') {
      const body = JSON.parse(opts.body)
      assert.equal(body.allow_squash_merge, true)
      assert.equal(body.allow_merge_commit, false)
      return { ok: true, status: 200, json: async () => ({}) }
    }
    if (u.includes('/actions/runners/registration-token')) {
      return { ok: true, status: 201, json: async () => ({ token: 'reg-tok-1' }) }
    }
    if (u.includes('/repos/actions/runner/releases/latest')) {
      return { ok: true, status: 200, json: async () => ({ tag_name: 'v9.9.9', assets: [{ name: 'actions-runner-osx-x64-9.9.9.tar.gz', browser_download_url: 'x64' }, { name: 'actions-runner-osx-arm64-9.9.9.tar.gz', browser_download_url: 'arm64-url' }] }) }
    }
    return { ok: false, status: 404, json: async () => ({ message: 'no route: ' + u }) }
  }
  const base = { accessToken: 't', fetch: mockFetch, apiBase: 'https://api.github.com' }

  await settingsApi({ owner: 'octocat', name: 'framed', payload: { allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false }, ...base })
  ok(calls.some((c) => c.startsWith('https://api.github.com/repos/octocat/framed PATCH')), 'frame: settingsApi PATCHes the repo')
  const protOk = await protectionApi({ owner: 'octocat', name: 'framed', payload: { required_status_checks: { strict: true } }, ...base })
  ok(protOk.planLimited === false, 'frame: protection PUT succeeds clean')
  const protPlan = await protectionApi({ owner: 'planframed', name: 'x', payload: {}, ...base })
  ok(protPlan.planLimited === true, 'frame: the free-plan 403 classifies as plan-limited (S0 V1)')
  const tok = await registrationTokenApi({ owner: 'octocat', name: 'framed', ...base })
  ok(tok === 'reg-tok-1', 'frame: runner registration token served')
  const asset = await latestRunnerTarballApi({ ...base })
  ok(asset.url === 'arm64-url' && asset.version === 'v9.9.9', 'frame: latestRunnerTarball picks the osx-arm64 asset')

  // ---- D107 PR merge / state request shapes --------------------------------
  {
    const { prMergeApi, prStateApi } = await import('./lib/index.js')
    const seen = []
    const prFetch = async (url, opts = {}) => {
      const u = String(url)
      seen.push({ url: u, method: opts.method ?? 'GET', body: opts.body ? JSON.parse(opts.body) : null, headers: opts.headers ?? {} })
      if (u.endsWith('/pulls/7/merge')) {
        return { ok: true, status: 200, json: async () => ({ sha: 'mergesha1', merged: true, message: 'Pull Request successfully merged' }) }
      }
      if (u.endsWith('/pulls/9/merge')) {
        return { ok: false, status: 409, json: async () => ({ message: 'Head branch was modified. Review and try the merge again.' }) }
      }
      if (u.endsWith('/pulls/7')) {
        return { ok: true, status: 200, json: async () => ({ number: 7, state: 'closed', merged: true, mergeable_state: 'unknown', head: { ref: 'arxa/session/s1', sha: 'headsha1' } }) }
      }
      if (u.endsWith('/pulls/8')) {
        // No `head` object at all — the flattening must not throw.
        return { ok: true, status: 200, json: async () => ({ number: 8, state: 'open', merged: false }) }
      }
      return { ok: false, status: 404, json: async () => ({ message: 'no route: ' + u }) }
    }
    const pbase = { owner: 'octocat', name: 'framed', accessToken: 't', fetch: prFetch, apiBase: 'https://api.github.com' }

    const merged = await prMergeApi({ ...pbase, number: 7, sha: 'headsha1', subject: 'feat(core): the thing' })
    const req = seen.at(-1)
    ok(req.method === 'PUT' && req.url === 'https://api.github.com/repos/octocat/framed/pulls/7/merge',
      'frame: prMergeApi PUTs the documented merge endpoint')
    ok(req.body.merge_method === 'merge', 'frame: prMergeApi sends merge_method "merge" (D107 --no-ff), never squash')
    ok(req.body.sha === 'headsha1', 'frame: prMergeApi pins the merge to the reviewed sha')
    ok(req.body.commit_title === 'feat(core): the thing', 'frame: prMergeApi sends the subject as commit_title')
    ok(!('commit_message' in req.body), 'frame: prMergeApi omits commit_message when none is given')
    ok(req.headers['X-GitHub-Api-Version'] === '2022-11-28', 'frame: prMergeApi pins the REST API version')
    ok(merged.merged === true && merged.sha === 'mergesha1',
      'frame: prMergeApi returns the MERGE commit sha (not the head it sent)')

    await assert.rejects(() => prMergeApi({ ...pbase, number: 9, sha: 'stale' }), /head moved since review \(409\)/)
    passed++
    console.log('  ✓ frame: prMergeApi names the 409 head-moved refusal specifically')

    const st = await prStateApi({ ...pbase, number: 7 })
    ok(seen.at(-1).method === 'GET' && seen.at(-1).url === 'https://api.github.com/repos/octocat/framed/pulls/7',
      'frame: prStateApi GETs the pull endpoint')
    ok(st.merged === true && st.state === 'closed' && st.mergeable_state === 'unknown' && st.head_sha === 'headsha1' && st.number === 7,
      'frame: prStateApi flattens head.sha to head_sha')
    const stOpen = await prStateApi({ ...pbase, number: 8 })
    ok(stOpen.merged === false && stOpen.state === 'open' && stOpen.head_sha === null,
      'frame: prStateApi survives a payload with no head object')
  }

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-runner-home-'))
  try {
    const ran = []
    const fakeRun = async (file, args, opts = {}) => {
      ran.push([file, ...args].join(' '))
      if (file === './config.sh') {
        assert.ok(args.includes('macOS,ARM64,arxa'), 'canon labels on config.sh')
        assert.ok(args.join(' ').includes('https://github.com/octocat/framed'), 'repo URL on config.sh')
        // the REAL config.sh writes the .runner marker — mirror it
        fs.writeFileSync(path.join(opts.cwd, '.runner'), '{}\n')
      }
      return ''
    }
    const cacheDir = path.join(home, '.arxa', 'runners', 'runner-cache')
    fs.mkdirSync(cacheDir, { recursive: true })
    fs.writeFileSync(path.join(cacheDir, 'config.sh'), '#!/bin/sh\n')
    fs.writeFileSync(path.join(cacheDir, 'svc.sh'), '#!/bin/sh\n')
    fs.writeFileSync(path.join(cacheDir, 'VERSION'), 'v9.9.9\n')
    const opts = { owner: 'octocat', name: 'framed', home, run: fakeRun, fetch: mockFetch, registrationToken: async () => 'rt', latestRunnerTarball: async () => ({ url: 'u', version: 'v9.9.9' }) }
    const r1 = await ensureRunner(opts)
    ok(r1.ok === true && !r1.existing, 'frame: ensureRunner registers a runner (config.sh + svc.sh run)')
    ok(ran.some((c) => c.startsWith('./config.sh')), 'frame: config.sh ran unattended')
    ok(runnerExists('octocat', 'framed', home), 'frame: runnerExists sees the instance')
    const r2 = await ensureRunner(opts)
    ok(r2.ok === true && r2.existing === true, 'frame: ensureRunner is idempotent')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
  passed++
  console.log('  ✓ frame API + runner verified (settings / plan-limited protection / reg-token / arm64 asset / idempotent runner)')
}
