/**
 * arxa-file-org-shell — server-side org lifecycle service (Phase A).
 *
 * Composition layer only: discovery/scaffold, single-entry openOrg with
 * strict ordering and reverse teardown, close/switch, optional rails.
 * No client surface this phase (no dsh.client, no lib/client.js).
 */

export const name = 'arxa-file-org-shell'

export { createOrgLifecycle, STEPS } from './lifecycle.js'
export { SHELL_LOCK_DIR, shellLockPath, acquireShellLock } from './shell-lock.js'
export { OrgOpenError, OrgAlreadyOpenError, OrgNotOpenError, ShellLockError } from './errors.js'
