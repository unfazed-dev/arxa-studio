// The account half of the Models-page card (docs/plans/claude-signin-surface-models-page.md).
//
// dsh-authorization is a host-only registry in 0.1.2-rc.1 — nothing in the client renders the
// flow claude-code registers on it — so the card talks to the host over its own Connection RPC
// channel instead. Two verbs, both allowlisted by name:
//
//   status  { force? }  → the probe's view of the CLI's session (D6: arxa DETECTS the sign-in,
//                         it never starts one), plus the command and docs URL the card shows.
//   signout             → `claude auth logout` through the same confining spawner every Claude
//                         child gets (D5), then the stored grant is dropped and the probe re-asked.
//
// CLAUDE_CONFIG_DIR is not relocated (lib/spawn.js), so the session this reads is the one the
// user's terminal holds — and signing out here signs the terminal out too. The card says so.
import { ACCOUNT_KEY } from './auth-flow.js'
import { SIGNIN_CMD, INSTALL_URL } from './models.js'

/** Must equal lib/client.js ACCOUNT_CHANNEL. One segment only (dsh CHANNEL_PATTERN). */
export const ACCOUNT_CHANNEL = '/arxa-claude-account'
export const SIGNOUT_ARGS = ['auth', 'logout']

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
export function createAccountRpc ({ probe, credentials, spawn, binary, env }) {
  // Written on transitions only: the card polls every 3 s while signed out, and a credential
  // write per poll would churn the store for nothing.
  let recorded
  async function status (force) {
    const a = await probe.current(force === true)
    const now = a.loggedIn === true
    if (recorded !== now) {
      if (now) await credentials.modifyRecord(ACCOUNT_KEY, async () => grantOf(a))
      else await credentials.deleteRecord(ACCOUNT_KEY)
      recorded = now
    }
    return accountStatus(a)
  }

  function run (args) {
    return new Promise((resolve) => {
      let err = ''
      const child = spawn({ command: binary(), args, env })
      child.stderr?.on('data', (d) => { err += d })
      child.on('error', (e) => resolve({ code: -1, err: String(e?.message ?? e) }))
      child.on('exit', (code) => resolve({ code, err }))
    })
  }

  async function signout () {
    if (!binary()) throw new Error('no claude binary on PATH and no bundled binary')
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
      return { ok: false, error: { message: `unknown endpoint ${endpoint}` } }
    } catch (e) {
      return { ok: false, error: { message: String(e?.message ?? e) } }
    }
  }
}
