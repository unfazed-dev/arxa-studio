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
// Recents faces (D69): the org list the shell serves until the sidebar's
// org-switcher wave takes it over.
export { listRecents, readRecents, touchRecent, removeRecent } from '../../workspace/lib/root.js'
// Read-only rows faces (sidebar rethink): the host half serves every org's
// session rows and the workspace-root trash without opening anything.
// In-place scaffold (D69): the create modal's org.create-at verb targets the
// picked folder itself — the org IS the folder the user chose.
export { scaffoldOrg } from '../../workspace/lib/scaffold.js'
export { listSessions } from '../../git-workspace/lib/sessions.js'
export { listTrash, restoreFromTrash } from '../../workspace/lib/index.js'
// dsh bridge (Phase D, D71): injectable spawn/attach/list/archive faces with
// a default loud no-op, plus the pure live-rows join and the registry
// annotation the lifecycle uses to store dshSessionId.
export { createDshBridge, joinDshLive } from './dsh-bridge.js'
// GitHub bridge (W3b, D69 publish half): injectable status/createPrivateRepo
// faces with a default unavailable stub — publish never blocks local work.
export { createGithubBridge, annotateProjectManifest, annotateOrgManifest } from './github-bridge.js'
export { annotateSession } from '../../git-workspace/lib/sessions.js'
export { SHELL_LOCK_DIR, shellLockPath, acquireShellLock } from './shell-lock.js'
export { OrgOpenError, OrgAlreadyOpenError, OrgNotOpenError, ShellLockError } from './errors.js'
