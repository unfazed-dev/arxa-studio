/**
 * github-link auth — GitHub OAuth against a pluggable base URL.
 *
 * Primary flow (research/github-auth-desktop-report.md; PKCE supported and
 * recommended for OAuth apps since 2025-07-14, S256 only):
 *   browser + authorization code + PKCE S256 over a 127.0.0.1 loopback
 *   redirect (ephemeral port, short-lived server, one code captured, state
 *   parameter checked).
 * Fallback flow (no browser): OAuth device flow — POST /login/device/code,
 *   then poll /login/oauth/access_token honouring the returned interval and
 *   slow_down (+5s) until access_token / expiry.
 *
 * Minimal scopes: repo + read:user (D69). The client id comes from env
 * ARXA_GITHUB_CLIENT_ID or a local config file (~/.arxa/github-link-config.json,
 * { "clientId": ... }) — never hardcoded, never a secret: the production
 * client id is owned by Arxa Digital Solutions and is not ours to invent.
 *
 * fetch and open are injectable for fully-offline tests (selftest.mjs runs a
 * local mock GitHub on 127.0.0.1 and injects it).
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import { spawn } from 'node:child_process'

import { statePath } from './state.js'

export const SCOPES = ['repo', 'read:user']

export function defaultTokenBase() { return 'https://github.com' }
export function defaultApiBase() { return 'https://api.github.com' }

// ---- PKCE (S256) -----------------------------------------------------------

function b64url(buf) { return buf.toString('base64url') }

/** S256 challenge for a verifier — exported so tests can round-trip it. */
export function pkceChallenge(verifier) {
  return b64url(crypto.createHash('sha256').update(verifier).digest())
}

/** One PKCE pair: { verifier, challenge } with challenge = S256(verifier). */
export function createPkcePair() {
  const verifier = b64url(crypto.randomBytes(48))
  return { verifier, challenge: pkceChallenge(verifier) }
}

// ---- client id resolution -----------------------------------------------------

/** Client id from ~/.arxa/github-link-config.json, or null. */
export function loadClientId(env = process.env) {
  try {
    const file = statePath(env).replace(/github-link\.json$/, 'github-link-config.json')
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return typeof parsed.clientId === 'string' ? parsed.clientId : null
  } catch {
    return null
  }
}

/** env ARXA_GITHUB_CLIENT_ID wins; then the local config file. Never invented. */
export function getClientId(env = process.env) {
  return env.ARXA_GITHUB_CLIENT_ID || loadClientId(env)
}

/**
 * Client id baked into the packed app (VS Code ships its GitHub client id
 * the same way): PUBLIC by design — it rides every authorize redirect — and
 * the device flow needs no secret. The production OAuth app is owned by
 * Arxa Digital Solutions; its client SECRET never ships and is not needed.
 */
export const SHIPPED_CLIENT_ID = 'Iv23licJCFFRwp664uwa'

// ---- token exchange (shared by both flows) ------------------------------------

/** POST {tokenBase}/login/oauth/access_token, JSON in and out. */
export async function tokenRequest({ tokenBase = defaultTokenBase(), fetch = globalThis.fetch, payload }) {
  const res = await fetch(new URL('/login/oauth/access_token', tokenBase), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('github-link: token request failed (' + res.status + ')')
  const body = await res.json()
  if (body.error) throw new Error('github-link: token request error: ' + body.error)
  return {
    accessToken: body.access_token,
    scopes: String(body.scope ?? '').split(/[\s,]+/).filter(Boolean),
  }
}

function exchangeCode({ clientId, code, verifier, redirectUri, tokenBase, fetch }) {
  return tokenRequest({
    tokenBase,
    fetch,
    payload: { client_id: clientId, code, redirect_uri: redirectUri, code_verifier: verifier },
  })
}

// ---- primary flow: browser + PKCE S256 + loopback ------------------------------

/**
 * Browser + PKCE flow. Serves ONE short-lived HTTP server on 127.0.0.1 at an
 * ephemeral port, builds the authorize URL with the S256 code_challenge, opens
 * the system browser, captures the redirect (?code=&state=), exchanges the
 * code with the verifier. Resolves { accessToken, scopes }.
 *
 * @param {{ clientId, fetch?, open?, tokenBase?, timeoutMs? }} opts
 *   open(url, server) — injectable; defaults to the system browser
 *   (`open` on macOS, `xdg-open` elsewhere).
 */
export function linkViaBrowser({
  clientId,
  fetch = globalThis.fetch,
  open = defaultOpen,
  tokenBase = defaultTokenBase(),
  timeoutMs = 5 * 60 * 1000,
} = {}) {
  if (!clientId) return Promise.reject(new Error('github-link: clientId is required (ARXA_GITHUB_CLIENT_ID or local config)'))
  return new Promise((resolve, reject) => {
    const { verifier, challenge } = createPkcePair()
    const oauthState = crypto.randomBytes(16).toString('hex')
    let settled = false
    let timer = null
    const settle = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close()
      fn(value)
    }

    const redirectUri = () => 'http://127.0.0.1:' + server.address().port + '/callback'

    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1')
        if (url.pathname === '/favicon.ico') { res.writeHead(404).end(); return }
        const errParam = url.searchParams.get('error')
        if (errParam) {
          res.writeHead(200, { 'content-type': 'text/html' })
          res.end('<p>arxa studio: sign-in cancelled. You can close this tab.</p>')
          return settle(reject, new Error('github-link: authorization refused (' + errParam + ')'))
        }
        const code = url.searchParams.get('code')
        if (!code || url.searchParams.get('state') !== oauthState) {
          res.writeHead(400, { 'content-type': 'text/plain' })
          res.end('arxa studio: bad redirect')
          return settle(reject, new Error('github-link: redirect state mismatch'))
        }
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<p>arxa studio: sign-in complete. You can close this tab and return to the app.</p>')
        exchangeCode({ clientId, code, verifier, redirectUri: redirectUri(), tokenBase, fetch })
          .then((r) => settle(resolve, r))
          .catch((e) => settle(reject, e))
      } catch (e) {
        settle(reject, e)
      }
    })

    server.on('error', (e) => settle(reject, e))
    server.listen(0, '127.0.0.1', () => {
      const authorizeUrl = new URL('/login/oauth/authorize', tokenBase)
      authorizeUrl.searchParams.set('client_id', clientId)
      authorizeUrl.searchParams.set('redirect_uri', redirectUri())
      authorizeUrl.searchParams.set('scope', SCOPES.join(' '))
      authorizeUrl.searchParams.set('state', oauthState)
      authorizeUrl.searchParams.set('code_challenge', challenge)
      authorizeUrl.searchParams.set('code_challenge_method', 'S256')

      timer = setTimeout(() => settle(reject, new Error('github-link: browser sign-in timed out')), timeoutMs)
      Promise.resolve(open(authorizeUrl.toString(), server)).catch((e) => settle(reject, e))
    })
  })
}

/** Default opener: the system browser (mac: open; linux: xdg-open). */
export function defaultOpen(url) {
  const bin = process.platform === 'darwin' ? 'open' : 'xdg-open'
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [url], { stdio: 'ignore' })
    child.on('error', reject)
    child.on('spawn', () => { child.unref(); resolve() })
  })
}

// ---- fallback flow: device code -------------------------------------------------

/**
 * Device flow (no browser). Prints / hands the user code to onCode, then
 * polls. Honours the returned interval; slow_down adds 5s. Resolves
 * { accessToken, scopes, userCode, verificationUri }.
 */
export async function linkViaDevice({
  clientId,
  fetch = globalThis.fetch,
  tokenBase = defaultTokenBase(),
  intervalMs,
  maxAttempts = 100,
  onCode,
} = {}) {
  if (!clientId) throw new Error('github-link: clientId is required (ARXA_GITHUB_CLIENT_ID or local config)')
  const initRes = await fetch(new URL('/login/device/code', tokenBase), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: SCOPES.join(' ') }),
  })
  if (!initRes.ok) throw new Error('github-link: device-code request failed (' + initRes.status + ')')
  const init = await initRes.json()
  if (init.error) throw new Error('github-link: device-code error: ' + init.error)
  let interval = intervalMs ?? Math.max(1, Number(init.interval ?? 5)) * 1000
  if (onCode) onCode({ userCode: init.user_code, verificationUri: init.verification_uri })

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, interval))
    const body = await fetch(new URL('/login/oauth/access_token', tokenBase), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        device_code: init.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    }).then((r) => {
      if (!r.ok) throw new Error('github-link: device poll failed (' + r.status + ')')
      return r.json()
    })
    if (body.access_token) {
      return {
        accessToken: body.access_token,
        scopes: String(body.scope ?? '').split(/[\s,]+/).filter(Boolean),
        userCode: init.user_code,
        verificationUri: init.verification_uri,
      }
    }
    if (body.error === 'slow_down') { interval += 5000; continue }
    if (body.error === 'authorization_pending') continue
    throw new Error('github-link: device flow error: ' + (body.error ?? 'unknown'))
  }
  throw new Error('github-link: device flow gave up (max attempts)')
}

// ---- API face ----------------------------------------------------------------

/** Create a PRIVATE repo under the user's account (POST /user/repos). */
export async function createPrivateRepoApi({ name, accessToken, fetch = globalThis.fetch, apiBase = defaultApiBase() } = {}) {
  if (!name) throw new Error('github-link: repo name is required')
  if (!accessToken) throw new Error('github-link: not linked (D69: link before publishing)')
  const res = await fetch(new URL('/user/repos', apiBase), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + accessToken,
      'user-agent': 'arxa-studio',
    },
    body: JSON.stringify({ name, private: true }),
  })
  if (!res.ok) throw new Error('github-link: repo creation failed (' + res.status + ')')
  return res.json()
}
