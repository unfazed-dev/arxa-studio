// The account half of the Models-page card (docs/plans/claude-signin-surface-models-page.md).
//
// dsh-authorization is a host-only registry in 0.1.2-rc.1 — nothing in the client renders the
// flow claude-code registers on it — so the card talks to the host over its own Connection RPC
// channel instead. Two verbs, both allowlisted by name:
//
//   status  { force? }  → the probe's view of the CLI's session, plus the command and docs URL.
//   signout             → `claude auth logout` through the same confining spawner every Claude
//                         child gets (D5), then the stored grant is dropped and the probe re-asked.
//   login               → starts `claude auth login` (same spawner) and answers with the sign-in
//                         URL the CLI prints. The CLI owns the OAuth exchange and the token; arxa
//                         only relays the page and the code (D6 amended 2026-09-06, user direction:
//                         a Sign in button, not a command to copy). Without a TTY the CLI uses its
//                         paste-a-code flow (verified 2.1.261: "Opening browser… If the browser
//                         didn't open, visit: <url>" then "Paste code here if prompted >").
//   code    { code }    → hands the pasted code to that child and waits for it to finish.
//   cancel              → kills a pending login child.
//
// CLAUDE_CONFIG_DIR is not relocated (lib/spawn.js), so the session this reads is the one the
// user's terminal holds — and signing in or out here does the same to the terminal. The card
// says so before signing out.
import { ACCOUNT_KEY } from './auth-flow.js'
import { SIGNIN_CMD, INSTALL_URL } from './models.js'

/** Must equal lib/client.js ACCOUNT_CHANNEL. One segment only (dsh CHANNEL_PATTERN). */
export const ACCOUNT_CHANNEL = '/arxa-claude-account'
export const SIGNOUT_ARGS = ['auth', 'logout']
export const LOGIN_ARGS = ['auth', 'login']
/** A login left unfinished is killed after this: the child holds a PKCE state nobody will use. */
export const LOGIN_TTL_MS = 10 * 60_000
/** How long a pasted code may take to exchange before the card hears "took too long". */
export const CODE_WAIT_MS = 60_000
/** The URL line the CLI prints (2.1.261). Anchored on the scheme so a changed preamble still parses. */
export const URL_RE = /https:\/\/[^\s"'<>]+/

/** The wire shape. `error` is the probe's own words (F13): a stale CLI, a dead sandbox and a
 *  genuine sign-out must stay distinguishable on the card. */
export function accountStatus (a) {
  return {
    loggedIn: a.loggedIn === true,
    email: a.email,
    subscriptionType: a.subscriptionType,
    version: a.version,
    error: a.loggedIn === true ? undefined : a.error,
    signinCommand: SIGNIN_CMD,
    installUrl: INSTALL_URL,
  }
}

export const grantOf = (a) => ({ kind: 'grant', payload: { email: a.email, subscriptionType: a.subscriptionType, version: a.version } })

/**
 * @param {object} deps
 * @param {{ current(force?: boolean): Promise<object> }} deps.probe
 * @param {{ modifyRecord: Function, deleteRecord: Function }} deps.credentials
 * @param {(opts: { command: string, args: string[], env: object }) => import('node:child_process').ChildProcess} deps.spawn
 *        the CONFINING spawner (makeSpawner), never node's own — D5.
 * @param {() => string | undefined} deps.binary thunk, so the settings-section rebind is seen.
 */
export function createAccountRpc ({ probe, credentials, spawn, binary, env, setTimeout: st = setTimeout, clearTimeout: ct = clearTimeout }) {
  // Written on transitions only: the card polls every 3 s while signed out, and a credential
  // write per poll would churn the store for nothing.
  let recorded
  // One login at a time: { child, url, exit: Promise<{code, out, err}>, timer }.
  let pending
  async function status (force) {
    const a = await probe.current(force === true)
    const now = a.loggedIn === true
    if (recorded !== now) {
      if (now) await credentials.modifyRecord(ACCOUNT_KEY, async () => grantOf(a))
      else await credentials.deleteRecord(ACCOUNT_KEY)
      recorded = now
    }
    return { ...accountStatus(a), pendingUrl: pending?.url }
  }

  function clearPending (p) { if (pending === p) { ct(p.timer); pending = undefined } }

  async function login () {
    if (!binary()) throw new Error('no claude binary on PATH and no bundled binary')
    if (pending !== undefined) return { url: pending.url }
    const child = spawn({ command: binary(), args: LOGIN_ARGS, env })
    let out = '', err = ''
    const exit = new Promise((resolve) => {
      child.on('error', (e) => resolve({ code: -1, out, err: String(e?.message ?? e) }))
      child.on('exit', (code) => resolve({ code, out, err }))
    })
    const p = { child, url: undefined, exit, timer: undefined }
    // The URL arrives on stdout within a second; an early exit (no binary, stale CLI, refused
    // spawn) races it and is reported instead of hanging the button.
    const url = await new Promise((resolve, reject) => {
      const look = () => { const m = URL_RE.exec(out); if (m) resolve(m[0]) }
      child.stdout?.on('data', (d) => { out += d; look() })
      child.stderr?.on('data', (d) => { err += d })
      exit.then((r) => reject(new Error(`claude auth login exited ${r.code}${(r.err || r.out).trim() ? `: ${(r.err || r.out).trim().slice(-300)}` : ''}`)))
    })
    p.url = url
    p.timer = st(() => { try { child.kill() } catch {} clearPending(p) }, LOGIN_TTL_MS)
    p.timer?.unref?.()
    exit.then(() => clearPending(p))
    pending = p
    return { url }
  }

  async function code (value) {
    const p = pending
    if (p === undefined) throw new Error('no sign-in in progress — press Sign in first')
    const text = String(value ?? '').trim()
    if (text === '') throw new Error('paste the code the sign-in page showed')
    p.child.stdin?.write(text + '\n')
    const r = await Promise.race([p.exit, new Promise((resolve) => st(() => resolve(undefined), CODE_WAIT_MS))])
    if (r === undefined) throw new Error('the sign-in took too long to finish — try again')
    if (r.code !== 0) {
      const tail = (r.err || r.out).trim().split('\n').filter((l) => !/Paste code here/.test(l)).slice(-2).join(' ').slice(-300)
      throw new Error(`sign-in failed${tail ? `: ${tail}` : ''}`)
    }
    // A fresh probe, not the cached signed-out one; the record follows on the transition.
    return status(true)
  }

  function cancel () {
    const p = pending
    if (p !== undefined) { try { p.child.kill() } catch {} clearPending(p) }
    return { cancelled: p !== undefined }
  }

  // One-shot CLI run, bounded: `claude auth logout` normally exits in under a
  // second, but a wedged binary (a keychain prompt nobody answers, a hung
  // sandbox) used to leave the RPC awaiting forever with the card spinning.
  // Same ceiling as the code exchange.
  function run (args) {
    return new Promise((resolve) => {
      let err = ''
      let done = false
      let timer
      const finish = (r) => { if (done) return; done = true; ct(timer); resolve(r) }
      const child = spawn({ command: binary(), args, env })
      timer = st(() => { try { child.kill() } catch {} ; finish({ code: -1, err: `timed out after ${CODE_WAIT_MS}ms` }) }, CODE_WAIT_MS)
      child.stderr?.on('data', (d) => { err += d })
      child.on('error', (e) => finish({ code: -1, err: String(e?.message ?? e) }))
      child.on('exit', (code) => finish({ code, err }))
    })
  }

  async function signout () {
    if (!binary()) throw new Error('no claude binary on PATH and no bundled binary')
    cancel()
    const { code, err } = await run(SIGNOUT_ARGS)
    if (code !== 0) throw new Error(`claude auth logout exited ${code}${err.trim() ? `: ${err.trim()}` : ''}`)
    await credentials.deleteRecord(ACCOUNT_KEY)
    recorded = false
    return accountStatus(await probe.current(true))
  }

  return async function handle (endpoint, payload) {
    try {
      if (endpoint === 'status') return { ok: true, value: await status(payload?.force) }
      if (endpoint === 'signout') return { ok: true, value: await signout() }
      if (endpoint === 'login') return { ok: true, value: await login() }
      if (endpoint === 'code') return { ok: true, value: await code(payload?.code) }
      if (endpoint === 'cancel') return { ok: true, value: cancel() }
      return { ok: false, error: { message: `unknown endpoint ${endpoint}` } }
    } catch (e) {
      return { ok: false, error: { message: String(e?.message ?? e) } }
    }
  }
}
