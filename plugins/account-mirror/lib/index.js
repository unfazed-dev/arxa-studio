// arxa-account-mirror — Phase 6 track (b), the read-only account/
// mirror (D45/D37) of docs/plans/file-organisation-implementation.md.
// Pure-library plugin: no prompt sections, no client injection, no
// network, no database. Consumes arxa-workspace (the template already
// ships the account/ category dir) and arxa-git-workspace (runGit) as
// exported APIs only.

export const name = 'arxa-account-mirror'

export {
  AccountProviderError,
  ProviderNotImplementedError,
  ProviderAuthError,
  ProviderUnavailableError,
  InvalidArtifactError,
} from './errors.js'
export { createLocalProvider, RemoteAccountProvider } from './providers.js'
export { ACCOUNT_DIR, MIRROR_MANIFEST, ensureAccountExcluded, refreshAccountMirror } from './mirror.js'
