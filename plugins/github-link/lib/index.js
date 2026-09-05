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

import { getClientId, defaultApiBase, defaultTokenBase, linkViaBrowser, linkViaDevice, createPrivateRepoApi, renameRepoApi, repoNameAvailableApi, deleteRepoApi, deleteBranchApi, refreshAccessToken, SCOPES, SHIPPED_CLIENT_ID, defaultOpen } from './auth.js'
import { settingsApi, protectionApi, registrationTokenApi, latestRunnerTarballApi, prCreateApi, prListForHeadApi, prSquashMergeApi, prMergeApi, prCommentApi, prUpdateApi, prStateApi,prChecksApi, workflowRunsApi, rerunRunApi, cancelRunApi, prConversationApi, setThreadResolvedApi, prThreadReplyApi, runJobsApi } from './frame.js'
import { ensureRunner } from './runner.js'
import { createKeyring } from './keyring.js'
import { readState, writeState, clearState } from './state.js'

export { SCOPES, createPkcePair, pkceChallenge, getClientId, loadClientId, linkViaBrowser, linkViaDevice, createPrivateRepoApi, renameRepoApi, repoNameAvailableApi } from './auth.js'
export { settingsApi, protectionApi, registrationTokenApi, latestRunnerTarballApi, prCreateApi, prListForHeadApi, prSquashMergeApi, prMergeApi, prCommentApi, prUpdateApi, prStateApi,prChecksApi, workflowRunsApi, rerunRunApi, cancelRunApi, prConversationApi, setThreadResolvedApi, prThreadReplyApi, runJobsApi } from './frame.js'
export { ensureRunner, runnerExists } from './runner.js'
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
  /** Production default: the shipped OAuth app completes sign-in via the
   * DEVICE flow — the only secret-less path GitHub gives OAuth apps
   * (probed 2025-08: the PKCE web-flow exchange still answers
   * incorrect_client_credentials without a client secret). The browser
   * PKCE flow stays available for a future GitHub App: useDeviceFlow:false. */
  useDeviceFlow = true,
  /** Public-by-design client id baked in VS Code-style; env/config still
   * win. This is NOT a secret — the client secret never ships anywhere. */
  shippedClientId = SHIPPED_CLIENT_ID,
} = {}) {
  const ring = keyring ?? createKeyring({ bridge: keyringBridge })
  /** Latest device-flow code, surfaced to the UI via deviceCode() so the
   * sign-in step can display it while the poll runs. */
  let lastDeviceCode = null

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
    const clientId = getClientId(env) ?? shippedClientId
    if (!clientId) {
      throw new Error(
        'github-link: no client id. Set ARXA_GITHUB_CLIENT_ID or write ' +
        '{ "clientId": "..." } to ~/.arxa/github-link-config.json — the ' +
        'production client id is owned by Arxa Digital Solutions.'
      )
    }
    const result = useDeviceFlow
      ? await linkViaDevice({
          clientId,
          fetch,
          tokenBase,
          onCode: ({ userCode, verificationUri }) => {
            lastDeviceCode = { userCode, verificationUri }
            // The injected open is test-only; production falls back to the
            // system opener (mac open / linux xdg-open). Without this default
            // the packed app silently opened nothing — found in the field.
            const opener = typeof open === 'function' ? open : defaultOpen
            Promise.resolve()
              .then(() => opener(verificationUri))
              .catch(() => {})
          },
        })
      : await linkViaBrowser({ clientId, fetch, open, tokenBase })

    const login = await whoAmI(result.accessToken)
    await ring.setSecret(login, result.accessToken)
    // D76: GitHub OAuth-app tokens (ghu_) EXPIRE — persist the refresh
    // token (a SECRET: keyring, never the state file) and the expiry so
    // the token machinery can self-refresh. The refresh token MAY be
    // rotated by GitHub; the state file only carries the non-secret
    // expiry clock.
    let accessExpiresAt = null
    if (result.refreshToken) {
      await ring.setSecret(login + REFRESH_SUFFIX, result.refreshToken)
      if (result.expiresInSeconds) accessExpiresAt = new Date(Date.now() + result.expiresInSeconds * 1000).toISOString()
    }
    const state = {
      linked: true,
      login,
      scopes: result.scopes.length ? result.scopes : [...SCOPES],
      linkedAt: new Date().toISOString(),
      accessExpiresAt,
    }
    writeState(state, env)
    lastDeviceCode = null
    return state
  }

  /**
   * Unlink: delete the stored secret, clear the local state. Idempotent —
   * orgs stay local (D69 rider); pushes simply fail loud (D23 indicator).
   */
  async function unlink() {
    const state = readState(env)
    if (state?.login) {
      await ring.deleteSecret(state.login)
      await ring.deleteSecret(state.login + REFRESH_SUFFIX).catch(() => {}) // legacy links have none
    }
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
    // S1 (2026-08-31): a link that predates the workflow scope cannot push
    // ci.yml (GitHub refuses OAuth workflow-file pushes without it) — the
    // frame wiring records the failure and retries; the fix is ONE re-link,
    // the same unavoidable class as D76's refresh-token migration.
    const missingScopes = SCOPES.filter((s) => !(state.scopes ?? []).includes(s))
    return { ...state, tokenAvailable, missingScopes }
  }

  // ---- D76 token machinery: expiry clock + self-refresh -------------------
  const REFRESH_SUFFIX = '#refresh'
  /** Refresh-window: renew 60 s before the recorded expiry (clock skew).
    * A missing/implausible clock counts as expired — always safe to renew. */
  function accessExpired(state) {
    const t = state?.accessExpiresAt ? Date.parse(state.accessExpiresAt) : 0
    return !(t > Date.now() + 60_000)
  }
  /**
   * A live access token for API calls and pushes, refreshing through the
   * stored refresh token when the clock says expired. Refresh tokens MAY
   * rotate — a fresh refresh_token is written straight back to the
   * keyring; the state file only ever carries the non-secret expiry.
   */
  async function getToken(force = false) {
    const state = readState(env)
    if (!state?.linked) throw new Error('github-link: not linked (link before publishing)')
    const current = await ring.getSecret(state.login).catch(() => null)
    if (!force && current && !accessExpired(state)) return current
    const storedRefresh = await ring.getSecret(state.login + REFRESH_SUFFIX).catch(() => null)
    if (!storedRefresh) {
      // Legacy link (pre-D76): no refresh token was stored. The access
      // token MIGHT still be alive — hand it over and let a 401 send the
      // user to re-link; there is nothing to refresh from.
      if (!force && current) return current
      throw new Error('github-link: token expired and no refresh token stored — sign in again (D76)')
    }
    // `||`, not `??`: getClientId ends in `||`, so a config file carrying a
    // blank clientId yields '' — and `??` passes '' straight through, sending
    // client_id='' and drawing GitHub's "incorrect_client_credentials". That is
    // the same error a revoked grant gives, so the blank sends you hunting the
    // wrong fault entirely. link() keeps `??` on purpose: a blank config must
    // hit its loud guard there, never silently link against a different app
    // than the one the user configured.
    // shippedClientId (the constructor param), not the module constant: link()
    // already honours the injected value, and getToken() reaching past it for
    // SHIPPED_CLIENT_ID meant a custom-wired service refreshed against a
    // different app than it linked with.
    const clientId = getClientId(env) || shippedClientId
    let fresh
    try {
      fresh = await refreshAccessToken({ clientId, refreshToken: storedRefresh, fetch, tokenBase })
    } catch (err) {
      // GitHub burns BOTH tokens on every rotation: "once you use a refresh
      // token, that refresh token and the old user access token will no longer
      // work" (docs: Refreshing user access tokens). So a second arxa process —
      // another engine, another window, the updater — that refreshes first
      // leaves this one holding a superseded refresh token through no fault of
      // its own. Re-read the keyring once: if the stored refresh token changed
      // while our request was in flight, that rotation is exactly what happened
      // and the newly stored one is good. Retry with it before condemning the
      // user to a full interactive re-link.
      const rotated = await ring.getSecret(state.login + REFRESH_SUFFIX).catch(() => null)
      if (rotated && rotated !== storedRefresh) {
        try {
          fresh = await refreshAccessToken({ clientId, refreshToken: rotated, fetch, tokenBase })
        } catch { /* the rotated one is dead too — fall through to re-link */ }
      }
      if (!fresh) {
        // Genuinely dead: revoked grant, expired refresh token, or a client-id
        // mismatch. Found 2026-09-03 on the RESTO smoke: every push and PR
        // failed with the raw "incorrect_client_credentials" and nothing told
        // the user to re-link. Flag the state (status() surfaces it, the link
        // button clears it) and say plainly what to do.
        writeState({ ...state, relinkRequired: true, relinkReason: String(err?.message ?? err).slice(0, 160) }, env)
        throw new Error(
          'github-link: GitHub session expired and could not be refreshed (' +
          String(err?.message ?? err).replace(/^github-link:\s*/, '') +
          ') — re-link GitHub from Settings'
        )
      }
    }
    await ring.setSecret(state.login, fresh.accessToken)
    if (fresh.refreshToken) await ring.setSecret(state.login + REFRESH_SUFFIX, fresh.refreshToken)
    const accessExpiresAt = fresh.expiresInSeconds
      ? new Date(Date.now() + fresh.expiresInSeconds * 1000).toISOString()
      : null
    // Clear the re-link flag: a refresh that just succeeded is proof the grant
    // is alive again, and `{ ...state }` would otherwise carry a stale
    // relinkRequired:true forward forever, nagging past the actual fault.
    writeState({ ...state, accessExpiresAt, relinkRequired: false, relinkReason: null }, env)
    return fresh.accessToken
  }

  /** Create a PRIVATE repo under the linked account (implemented, unwired). */
  async function createPrivateRepo(name) {
    const accessToken = await getToken()
    try {
      return await createPrivateRepoApi({ name, accessToken, fetch, apiBase })
    } catch (err) {
      // A revoked/rotated token can 401 while the recorded clock still says
      // alive — force one refresh + one retry before giving up (D76).
      if (!/\(401\)/.test(String(err?.message ?? err))) throw err
      return createPrivateRepoApi({ name, accessToken: await getToken(true), fetch, apiBase })
    }
  }

  /** Rename a repository under the linked account (D80). Returns the
    * canonical repo JSON — callers adopt full_name verbatim. */
  async function renameRepo(owner, name, newName) {
    const accessToken = await getToken()
    try {
      return await renameRepoApi({ owner, name, newName, accessToken, fetch, apiBase })
    } catch (err) {
      // A revoked/rotated token can 401 while the clock says alive — one
      // forced refresh + one retry before giving up (mirrors D76).
      if (!String(err?.message ?? err).includes('(401)')) throw err
      return renameRepoApi({ owner, name, newName, accessToken: await getToken(true), fetch, apiBase })
    }
  }

  /** Permanently delete a repository (D80 trash purge). No undo — the
    * caller owns the confirmation UX. A 403 means the linked token
    * predates the delete_repo scope: re-link to upgrade, loudly. */
  async function deleteRepo(owner, name) {
    const accessToken = await getToken()
    try {
      return await deleteRepoApi({ owner, name, accessToken, fetch, apiBase })
    } catch (err) {
      if (!String(err?.message ?? err).includes('(401)')) throw err
      return deleteRepoApi({ owner, name, accessToken: await getToken(true), fetch, apiBase })
    }
  }

  /** Delete ONE branch on the remote (archives trash purge, 2026-09-05):
    * the parked session branch's remote half. A missing ref (422) resolves
    * alreadyGone — idempotent by design. 401 self-heals like deleteRepo. */
  async function deleteBranch(owner, name, branch) {
    const accessToken = await getToken()
    try {
      return await deleteBranchApi({ owner, name, branch, accessToken, fetch, apiBase })
    } catch (err) {
      if (!String(err?.message ?? err).includes('(401)')) throw err
      return deleteBranchApi({ owner, name, branch, accessToken: await getToken(true), fetch, apiBase })
    }
  }

  /** Pre-flight (D80): is `name` free under `owner`? Throws when the
    * check cannot be answered — an unverifiable name is an error, never
    * a silent go. */
  async function repoNameTaken(owner, name) {
    const accessToken = await getToken()
    return !(await repoNameAvailableApi({ owner, name, accessToken, fetch, apiBase }))
  }

  /**
   * Credentials for git-over-HTTPS pushes (D73): { login, token } for the
   * linked account. The token NEVER leaves this call chain except into the
   * push command line — it is not logged, not persisted, not returned to
   * any client surface. Throws loud when unlinked / token unavailable.
   */
  async function gitCredentials(force = false) {
    const state = readState(env)
    if (!state?.linked) throw new Error('github-link: not linked (push needs a linked GitHub account)')
    // `force` mints a fresh token even when the recorded clock still reads
    // "alive". A git push is the one caller that cannot self-heal on its own:
    // every REST path here retries a 401 through getToken(true), but git
    // reports auth failure as text on a non-zero exit, so the caller has to
    // ask for the retry explicitly (2026-09-03: RESTO sat on
    // "Invalid username or token" with a clock that still said valid).
    const accessToken = await getToken(force === true)
    return { login: state.login, token: accessToken }
  }

  /** Wire the CI frame on a published repo (Part B S1): merge-commit-only
   *  repo settings + branch protection (strict, frame-check required). Both
   *  calls are idempotent — callers re-apply on every heal so a changed
   *  payload reaches repos wired under an older one. The
   *  measured free-plan 403 (S0 V1) is NOT an error — returned as
   *  protection:'plan-limited'; the card enforces gates client-side
   *  regardless (Q2). Payloads come from git-workspace/lib/frame.js. */
  async function wireFrame(owner, name, payloads) {
    const run = (token) => (async () => {
      await settingsApi({ owner, name, payload: payloads.settings, accessToken: token, fetch, apiBase })
      const prot = await protectionApi({ owner, name, payload: payloads.protection, accessToken: token, fetch, apiBase })
      return { ok: true, protection: prot.planLimited ? 'plan-limited' : 'ok' }
    })()
    try {
      return await run(await getToken())
    } catch (err) {
      if (!String(err?.message ?? err).includes('(401)')) throw err
      return run(await getToken(true))
    }
  }

  /** Ensure a self-hosted runner (canon labels) exists on THIS machine for
   *  owner/name — one instance per repo under ~/.arxa/runners/, user
   *  LaunchAgent, idempotent (Q5). Never throws: { ok:false, reason }. */
  async function ensureRunnerFace(owner, name) {
    return ensureRunner({
      owner,
      name,
      registrationToken: async () => registrationTokenApi({ owner, name, accessToken: await getToken(), fetch, apiBase }),
      latestRunnerTarball: async () => latestRunnerTarballApi({ accessToken: await getToken(), fetch, apiBase }),
    })
  }

  /** PR faces (Part B Q1/Q7/Q8): create (dedupe first), checks with
   *  runner-asleep classification, squash merge. 401 → one refresh retry. */
  async function withRefresh(fn) {
    try {
      return await fn(await getToken())
    } catch (err) {
      if (!String(err?.message ?? err).includes('(401)')) throw err
      return fn(await getToken(true))
    }
  }
  function prCreate(owner, name, { title, body, head, base }) {
    return withRefresh((t) => prCreateApi({ owner, name, title, body, head, base, accessToken: t, fetch, apiBase }))
  }
  function prListForHead(owner, name, head, state = 'open') {
    return withRefresh((t) => prListForHeadApi({ owner, name, head, state, accessToken: t, fetch, apiBase }))
  }
  /** DEPRECATED (D107) — see frame.js. No callers; use prMerge. */
  function prSquashMerge(owner, name, number) {
    return withRefresh((t) => prSquashMergeApi({ owner, name, number, accessToken: t, fetch, apiBase }))
  }
  /** D107: merge-commit the collapsed session branch, pinned to the
   *  reviewed `sha` so a moved head is refused rather than merged blind. */
  function prMerge(owner, name, { number, sha, subject, message } = {}) {
    return withRefresh((t) => prMergeApi({ owner, name, number, sha, subject, message, accessToken: t, fetch, apiBase }))
  }
  /** D107: live PR state — { merged, state, mergeable_state, head_sha }. */
  function prState(owner, name, number) {
    return withRefresh((t) => prStateApi({ owner, name, number, accessToken: t, fetch, apiBase }))
  }
  function prChecks(owner, name, ref) {
    return withRefresh((t) => prChecksApi({ owner, name, ref, accessToken: t, fetch, apiBase }))
  }
  /** Stage comment on a PR (2026-09-03) — { id, url }. */
  /** Rewrite a PR's body — the ledger table is re-rendered at each stage. */
  function prUpdate(owner, name, number, { body } = {}) {
    return withRefresh((t) => prUpdateApi({ owner, name, number, body, accessToken: t, fetch, apiBase }))
  }
  function prComment(owner, name, { number, body } = {}) {
    return withRefresh((t) => prCommentApi({ owner, name, number, body, accessToken: t, fetch, apiBase }))
  }
  /** Q8: re-run a workflow run (optionally only its failed jobs). */
  function rerunRun({ owner, name, runId, failedOnly } = {}) {
    return withRefresh((t) => rerunRunApi({ owner, name, runId, failedOnly, accessToken: t, fetch, apiBase }))
  }
  /** Q8: request cancellation of an in-flight workflow run. */
  function cancelRun({ owner, name, runId } = {}) {
    return withRefresh((t) => cancelRunApi({ owner, name, runId, accessToken: t, fetch, apiBase }))
  }
  /** D101/A3: recent workflow runs for a branch (insight panel CI history).
   *  Single-options-object call shape (unlike prChecks' positional args) —
   *  matches the sidebar call site: g.workflowRuns({ owner, name, branch, perPage }). */
  function workflowRuns({ owner, name, branch, perPage } = {}) {
    return withRefresh((t) => workflowRunsApi({ owner, name, branch, perPage, accessToken: t, fetch, apiBase }))
  }

  /** The conversation on one PR — comments, reviews, review threads, linked
   *  issues and commit notes in ONE GraphQL round trip. See frame.js for why
   *  this surface is GraphQL while its neighbours are REST. */
  function prConversation({ owner, name, number } = {}) {
    return withRefresh((t) => prConversationApi({ owner, name, number, accessToken: t, fetch, apiBase }))
  }
  /** Resolve / unresolve a review thread (GraphQL-only capability). */
  function setThreadResolved({ threadId, resolved } = {}) {
    return withRefresh((t) => setThreadResolvedApi({ threadId, resolved, accessToken: t, fetch, apiBase }))
  }
  /** Reply inside a review thread, addressed to its first comment's numeric id. */
  function prThreadReply({ owner, name, number, commentId, body } = {}) {
    return withRefresh((t) => prThreadReplyApi({ owner, name, number, commentId, body, accessToken: t, fetch, apiBase }))
  }
  /** Jobs + failed step names for one workflow run. */
  function runJobs({ owner, name, runId } = {}) {
    return withRefresh((t) => runJobsApi({ owner, name, runId, accessToken: t, fetch, apiBase }))
  }

  /** Latest device-flow code for the UI (null until a link() starts one). */
  function deviceCode() {
    return lastDeviceCode
  }

  return {
    backend: ring.backend,
    link,
    unlink,
    status,
    createPrivateRepo,
    renameRepo,
    repoNameTaken,
    deleteRepo,
    deleteBranch,
    gitCredentials,
    wireFrame,
    ensureRunner: ensureRunnerFace,
    prCreate,
    prListForHead,
    prSquashMerge,
    prMerge,
    prComment,
    prUpdate,
    prState,
    prChecks,
    rerunRun,
    cancelRun,
    workflowRuns,
    prConversation,
    setThreadResolved,
    prThreadReply,
    runJobs,
    deviceCode,
  }
}
