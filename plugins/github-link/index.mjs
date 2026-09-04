// F9: the plugin half of github-link. The library half (lib/index.js) stays
// exactly as it was — the sidebar imports it directly and must keep working.
// This adds only the missing sign-in surface.
import { createGithubLink } from './lib/index.js'
import { githubAuthFlow } from './lib/auth-flow.js'

export const name = 'arxa-github-link'
// 'authorization' is deliberately NOT here — the same trap F1 hit with
// claude-code. No arxa profile row mounts @deepseek-ai/dsh-authorization, so
// requiring it up front leaves this plugin forever 'pending' and dsh fails the
// WHOLE boot: arxa studio would not start at all. Reach it through a deferred
// ctx.inject() instead, so the sign-in attaches only where the service exists.
export const inject = ['credentials']

export function apply (ctx, config = {}) {
  // Its own service instance: every piece of state github-link owns lives on
  // disk or in the keychain, so this and the sidebar's instance cannot diverge.
  // Only `lastDeviceCode` is per-instance, and that belongs to whichever
  // instance is running the flow — here, this one.
  const github = createGithubLink(config)
  ctx.inject(['authorization'], (authorized) => {
    authorized.authorization.registerFlow(githubAuthFlow({ github, credentials: ctx.credentials }))
  })
}
