// The provider seam (D45). A provider is any object exposing
//   fetchArtifacts() -> Artifact[] | Promise<Artifact[]>
//   Artifact = { path: string, content: string | Uint8Array }
// where `path` is relative to <org>/account/ (forward slashes).
//
// Two implementations ship:
//   createLocalProvider()  — the DEFAULT: offline, no arxa account, no
//     network; renders an empty-but-valid account/ (CLAUDE.md ownership
//     boundary — users without an account get the identical read-only
//     mirror UX, just with an empty state).
//   RemoteAccountProvider  — the shape of the future arxa backend
//     provider: interface + typed errors only. NO HTTP, NO Supabase,
//     NO Arxa-DB dependency; fetchArtifacts() always throws
//     ProviderNotImplementedError in this build.

import { ProviderNotImplementedError } from './errors.js'

const EMPTY_STATE_README = `# account/ — read-only billing mirror

This folder is a local mirror of billing and entitlement artifacts
(invoices, plan, entitlements). It is never authoritative and never
edited by hand — every file here is re-fetchable and replaced wholesale
on refresh.

No arxa account is connected, so the mirror is empty. Everything in
arxa studio works without an account; connecting one only fills this
folder with your invoices and plan documents.

This folder is excluded from the organisation's git history (D37):
its content is derivable, never committed.
`

/**
 * The default provider: local/offline, no account, no network. Returns
 * the empty-but-valid artifact set — a single README describing the
 * empty state — so account/ is always explained, never mysterious.
 */
export function createLocalProvider() {
  return {
    name: 'local-empty',
    async fetchArtifacts() {
      return [{ path: 'README.md', content: EMPTY_STATE_README }]
    },
  }
}

/**
 * Stub of the future arxa backend provider. Carries the configuration
 * shape the real implementation will need, but performs no I/O of any
 * kind: fetchArtifacts() throws ProviderNotImplementedError. When the
 * backend exists, the real class replaces this one behind the same
 * seam and refreshAccountMirror() does not change.
 */
export class RemoteAccountProvider {
  /**
   * @param {{ baseUrl?: string, token?: string }} [config]
   */
  constructor({ baseUrl = null, token = null } = {}) {
    this.name = 'arxa-remote-stub'
    this.baseUrl = baseUrl
    this.token = token
  }

  async fetchArtifacts() {
    throw new ProviderNotImplementedError(
      'the remote arxa account provider is a stub: the backend does not exist yet ' +
        'and this build never performs HTTP; use the local provider (default)',
    )
  }
}
