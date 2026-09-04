/**
 * Re-link GitHub from the terminal (device flow).
 *
 * Why this exists: github-link is a LIBRARY, not a plugin — it registers no
 * dsh authorization flow, so arxa has no Settings sign-in for GitHub. The only
 * in-app re-link button lives inside the delete-forever modal and only appears
 * once an error already says "re-link GitHub", which is not a path anyone can
 * find when a push starts failing. This is the missing front door.
 *
 *   node scripts/github-relink.mjs --check   # show state, resolve client id, touch nothing
 *   node scripts/github-relink.mjs --yes     # run the device flow
 *
 * The device flow needs no client secret and no browser redirect: GitHub prints
 * a one-time code, you approve it on github.com, and the token lands in your
 * Keychain (service 'arxa-studio'). Nothing is authorized until you approve.
 */
import { createGithubLink } from '../plugins/github-link/lib/index.js'
import { getClientId, SHIPPED_CLIENT_ID, SCOPES } from '../plugins/github-link/lib/auth.js'

const svc = createGithubLink({})
const before = await svc.status()
const clientId = getClientId(process.env) || SHIPPED_CLIENT_ID

console.log('keyring backend :', svc.backend)
console.log('client id       :', clientId.slice(0, 6) + '…(' + clientId.length + ' chars)' +
  (clientId === SHIPPED_CLIENT_ID ? '  [shipped]' : '  [from ~/.arxa/github-link-config.json]'))
console.log('linked          :', before.linked === true)
if (before.linked) {
  console.log('login           :', before.login)
  console.log('scopes          :', (before.scopes ?? []).join(' '))
  console.log('token in keyring:', before.tokenAvailable)
  if (before.relinkRequired) console.log('relink required :', before.relinkReason ?? 'yes')
  if (before.missingScopes?.length) console.log('missing scopes  :', before.missingScopes.join(' '))
}
console.log('will request    :', SCOPES.join(' '))

if (!process.argv.includes('--yes')) {
  console.log('\n--check only. Re-run with --yes to start the device flow.')
  process.exit(0)
}

// link() blocks while it polls GitHub, and hands the one-time code to the
// service's deviceCode() face the moment GitHub issues it — the same way the
// in-app button reads it. Poll for it so the code reaches the terminal.
let shown = false
const poll = setInterval(() => {
  const d = svc.deviceCode()
  if (d && d.userCode && !shown) {
    shown = true
    console.log('\n  ┌─ open  ' + d.verificationUri)
    console.log('  └─ code  ' + d.userCode + '\n')
    console.log('waiting for you to approve it on github.com …')
  }
}, 300)

try {
  const state = await svc.link()
  console.log('\nlinked as ' + state.login)
  console.log('scopes    ' + (state.scopes ?? []).join(' '))
  console.log('expires   ' + (state.accessExpiresAt ?? 'no expiry recorded'))
  console.log('\nDone — arxa can push, open PRs and merge again.')
} catch (err) {
  console.error('\nre-link failed: ' + (err?.message ?? err))
  process.exitCode = 1
} finally { clearInterval(poll) }
