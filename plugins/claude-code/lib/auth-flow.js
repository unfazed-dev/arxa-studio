import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { PROVIDER_NAME } from './models.js'

export const ACCOUNT_KEY = credentialKey('claude-code', 'account')
const LOGIN_CMD = 'claude auth login'

/** D6: arxa never launches login. It shows the command and re-checks until the CLI is signed in. */
export function claudeAuthFlow ({ probe, credentials, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pollMs = 3000, maxPolls = 200 }) {
  return {
    key: ACCOUNT_KEY,
    label: PROVIDER_NAME,
    methods: [{ id: 'cli', label: 'Sign in with the claude CLI' }],
    async run (session) {
      session.notify({ message: `In a terminal run \`${LOGIN_CMD}\` and finish the browser sign-in. arxa checks every ${pollMs / 1000}s.`, code: LOGIN_CMD })
      for (let i = 0; i < maxPolls; i++) {
        if (session.signal.aborted) throw new Error('claude-code: sign-in cancelled')
        const a = await probe.current(true)
        if (a.loggedIn) {
          await credentials.modifyRecord(ACCOUNT_KEY, async () => ({ kind: 'grant', payload: { email: a.email, subscriptionType: a.subscriptionType, version: a.version } }))
          session.notify({ message: `Signed in as ${a.email} (${a.subscriptionType}). Claude Code ${a.version}.` })
          return
        }
        await sleep(pollMs)
      }
      throw new Error('claude-code: sign-in not detected; run the command and try again')
    },
  }
}
