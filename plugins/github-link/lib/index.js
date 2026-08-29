/**
 * arxa-github-link — the GitHub link faces (Phase B, D69 gate half).
 *
 * Faces: link(), unlink(), status(), createPrivateRepo(name).
 * Implemented but NOT wired into any caller this phase (org.create gate and
 * the sidebar sign-in step are later phases).
 *
 * Local-first: link state is a local JSON file; the token lives in the OS
 * keyring; no cloud database anywhere (CLAUDE.md boundary, D16).
 */

import { getClientId, defaultApiBase, defaultTokenBase, linkViaBrowser, linkViaDevice, createPrivateRepoApi, SCOPES } from './auth.js'
import { createKeyring } from './keyring.js'
import { readState, writeState, clearState } from './state.js'

export { SCOPES, createPkcePair, pkceChallenge, getClientId, loadClientId, linkViaBrowser, linkViaDevice, createPrivateRepoApi } from './auth.js'
export { createKeyring, KEYCHAIN_SERVICE, SECURITY_PATH } from './keyring.js'
export { readState, writeState, clearState, statePath, arxaHome } from './state.js'

/**
 * Create the github-link service.
 *
 * @param {{
 *   keyring?,            // pre-built keyring (tests); else created below
 *   keyringBridge?,      // Tauri shell bridge (production keyring route)
 *   fetch?,              // injectable fetch (tests point it at a mock GitHub)
 *   open?,               // injectable browser opener (tests)
 *   tokenBase?, apiBase?, env?, useDeviceFlow?,
 * }} opts
 */
export function createGithubLink({
  keyring,
  keyringBridge,
  fetch = globalThis.fetch,
  open,
  tokenBase = defaultTokenBase(),
  apiBase = defaultApiBase(),
  env = process.env,
  useDeviceFlow = false,
} = {}) {
  const ring = keyring ?? createKeyring({ bridge: keyringBridge })

  /** Fetch the authenticated /user login for a fresh token. */
  async function whoAmI(accessToken) {
    const res = await fetch(new URL('/user', apiBase), {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: 'Bearer ' + accessToken,
        'user-agent': 'arxa-studio',
      },
    })
    if (!res.ok) throw new Error('github-link: could not read the authenticated user (' + res.status + ')')
    const user = await res.json()
    return user.login
  }

  /**
   * Link a GitHub account: run the auth flow, store the token under the
   * login, persist the non-secret state. Resolves the new state.
   */
  async function link() {
    const clientId = getClientId(env)
    if (!clientId) {
      throw new Error(
        'github-link: no client id. Set ARXA_GITHUB_CLIENT_ID or write ' +
        '{ "clientId": "..." } to ~/.arxa/github-link-config.json — the ' +
        'production client id is owned by Arxa Digital Solutions.'
      )
    }
    const result = useDeviceFlow
      ? await linkViaDevice({ clientId, fetch, tokenBase })
      : await linkViaBrowser({ clientId, fetch, open, tokenBase })

    const login = await whoAmI(result.accessToken)
    await ring.setSecret(login, result.accessToken)
    const state = {
      linked: true,
      login,
      scopes: result.scopes.length ? result.scopes : [...SCOPES],
      linkedAt: new Date().toISOString(),
    }
    writeState(state, env)
    return state
  }

  /**
   * Unlink: delete the stored secret, clear the local state. Idempotent —
   * orgs stay local (D69 rider); pushes simply fail loud (D23 indicator).
   */
  async function unlink() {
    const state = readState(env)
    if (state?.login) await ring.deleteSecret(state.login)
    clearState(env)
    return { unlinked: true, hadLogin: state?.login ?? null }
  }

  /** Read-only status: local state + whether the token is retrievable. */
  async function status() {
    const state = readState(env)
    if (!state?.linked) return { linked: false }
    let tokenAvailable = false
    try {
      tokenAvailable = (await ring.getSecret(state.login)) != null
    } catch {
      tokenAvailable = false
    }
    return { ...state, tokenAvailable }
  }

  /** Create a PRIVATE repo under the linked account (implemented, unwired). */
  async function createPrivateRepo(name) {
    const state = readState(env)
    if (!state?.linked) throw new Error('github-link: not linked (D69: create org requires a linked GitHub account)')
    const accessToken = await ring.getSecret(state.login)
    if (!accessToken) throw new Error('github-link: token unavailable for ' + state.login + ' — link again')
    return createPrivateRepoApi({ name, accessToken, fetch, apiBase })
  }

  return {
    backend: ring.backend,
    link,
    unlink,
    status,
    createPrivateRepo,
  }
}
