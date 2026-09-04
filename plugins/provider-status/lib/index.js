// arxa-provider-status: ONE live status channel for every model provider.
// Producers (any LlmAdapter, host plugin, tool) call appendProviderStatus(session, {...});
// the projection `providerStatus` folds it and dsh pushes it to every client live and
// replays it on reconnect (session/projection frames). The badge lives in lib/client.js.
import { PROVIDER_STATUS_SCHEMA, PROJECTION_VALUE_SCHEMA, applyProviderStatus } from './status.js'

export const PROJECTION = Object.freeze({
  key: 'providerStatus',
  stateSchema: PROJECTION_VALUE_SCHEMA,
  init: () => null,
  apply: applyProviderStatus,
  wire: { viewSchema: PROJECTION_VALUE_SCHEMA, view: (state) => state },
  stateVersion: 1,
})

/** Producer helper: validate, then append. Throws a zod error on a bad status. */
export function appendProviderStatus (session, status) {
  return session.append('provider/status', PROVIDER_STATUS_SCHEMA.parse(status))
}

export const name = 'arxa-provider-status'
export const inject = ['sessionProjections']
export function apply (ctx) {
  ctx.sessionProjections.register(PROJECTION)
}
