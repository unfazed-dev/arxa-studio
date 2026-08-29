/**
 * arxa-file-org-shell — server-side org lifecycle service (Phase A).
 *
 * Composition layer only: discovery/scaffold, single-entry openOrg with
 * strict ordering and reverse teardown, close/switch, optional rails.
 * No client surface this phase (no dsh.client, no lib/client.js).
 */

export const name = 'arxa-file-org-shell'

export { createOrgLifecycle, STEPS } from './lifecycle.js'
// Workspace-root discovery re-exported so consumers (arxa-sidebar host half)
// need only this package — the plan contract's single import surface.
export { loadWorkspaceRoot, saveWorkspaceRoot, arxaHome } from '../../workspace/lib/root.js'
// Read-only rows faces (sidebar rethink): the host half serves every org's
// session rows and the workspace-root trash without opening anything.
export { listSessions } from '../../git-workspace/lib/sessions.js'
export { listTrash, restoreFromTrash } from '../../workspace/lib/index.js'
export { SHELL_LOCK_DIR, shellLockPath, acquireShellLock } from './shell-lock.js'
export { OrgOpenError, OrgAlreadyOpenError, OrgNotOpenError, ShellLockError } from './errors.js'
