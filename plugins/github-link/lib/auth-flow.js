import { credentialKey } from '@deepseek-ai/dsh-credentials'

export const ACCOUNT_KEY = credentialKey('github-link', 'account')

/**
 * F9: GitHub's sign-in surface, beside Claude's.
 *
 * Before this, github-link was a LIBRARY with no plugin entry and no registered
 * flow, so arxa had no Settings sign-in for GitHub at all. The only in-app
 * re-link was a button inside the delete-forever modal that rendered only once
 * an error already said "re-link GitHub" — unfindable by anyone whose push had
 * just started failing with a 401. Measured 2026-09-04 when a revoked grant
 * left the user with no route back.
 *
 * Device flow, not the browser/PKCE one: it is the only secret-less path GitHub
 * grants OAuth apps (index.js:44 records the 2025-08 probe), and a distributed
 * desktop app cannot ship a client secret.
 */
export function githubAuthFlow ({ github, credentials, pollMs = 300 }) {
  return {
    key: ACCOUNT_KEY,
    label: 'GitHub',
    methods: [{ id: 'device', label: 'Sign in with a device code' }],
    async run (session) {
      // link() blocks while it polls GitHub and hands the one-time code to
      // deviceCode() the moment GitHub issues it — the same face the in-app
      // button reads. Poll for it so the code reaches the sign-in surface
      // instead of the user staring at a spinner.
      let shown = false
      const poll = setInterval(() => {
        if (shown) return
        const d = github.deviceCode()
        if (!d?.userCode) return
        shown = true
        session.notify({ message: `Open ${d.verificationUri} and enter this code:`, code: d.userCode })
      }, pollMs)

      // link() has no abort seam of its own (it polls a fixed number of times
      // and then gives up), so cancelling releases THIS flow rather than the
      // in-flight request. The orphaned poll expires on its own; nothing is
      // authorized unless the user approves the code on github.com.
      const cancelled = new Promise((_, reject) => {
        if (session.signal.aborted) reject(new Error('github-link: sign-in cancelled'))
        session.signal.addEventListener('abort', () => reject(new Error('github-link: sign-in cancelled')), { once: true })
      })

      try {
        const state = await Promise.race([github.link(), cancelled])
        // The record carries identity only. The token itself never leaves the
        // OS keychain — github-link's whole storage story depends on that.
        await credentials.modifyRecord(ACCOUNT_KEY, async () => ({
          kind: 'grant',
          payload: { login: state.login, scopes: state.scopes, accessExpiresAt: state.accessExpiresAt ?? null },
        }))
        session.notify({ message: `Linked as ${state.login} (${(state.scopes ?? []).join(', ')}).` })
      } finally { clearInterval(poll) }
    },
  }
}
