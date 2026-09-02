// arxa-git-workspace — Phase 3 git rail
// (docs/plans/file-organisation-implementation.md). Pure-library plugin
// like arxa-workspace: no prompt sections, no client injection.
//
// Sub-modules mirror the audit's layering:
//   probe.js    — startup probe + disabled state (git absent = clear
//                 GitUnavailableError, never a crash)
//   run.js      — isolated shell-out to system git
//   repos.js    — D37 repo boundaries: org repo init, nested project
//                 repos ignored by the org repo, account/ never in git
//   commits.js  — D18 two-tier commits: WIP auto-commits + clean
//                 stage-boundary squash
//   versions.js — D20 version chain + version-chip data (no SHAs, D44)
//   sessions.js — D38–D40 session lifecycle: branch-per-session
//                 worktrees, stage-boundary gate + merge, parked
//                 branches, archive/revive (phase 4)
//   reconcile.js — B7: worktree ↔ registry ↔ git drift report + safe repair

export const name = 'arxa-git-workspace'

export { GitUnavailableError, probeGit, resetProbe, ensureGit, gitBin } from './probe.js'
export { FRAME_JOB, FRAME_VERSION, SUBJECT_TYPES, SUBJECT_RE, orgCheckSh, projectCheckSh, ciYml, prTemplate, protectionPayload, settingsPayload, writeFrameFiles, frameStatus, frameFileState } from './frame.js'
export { createWipWatcher } from './watch.js'
export {
  DOCK_ROUTES,
  ROUTING_REASONS,
  INITIAL_SNAPSHOT_PENDING,
  RoutingRefusedError,
  routeDock,
  resolveSessionRepo,
  projectRepos,
} from './routing.js'
export { runGit, STAGE_IDENTITY, WIP_IDENTITY } from './run.js'
export { ORG_GITIGNORE, orgIgnoreFor, isRepo, hasHead, initOrgRepo, initProjectRepo, getOrigin, setOrigin, pushRepo, fetchRepo, mainSyncState, ffMergeMain, readSnapshotMarker, snapshotOrgRepo, snapshotWorkerLive, spawnSnapshotOrgRepo } from './repos.js'
export {
  STAGE_BASE_REF,
  WIP_PREFIX,
  isDirty,
  stageBase,
  wipCommit,
  wipRun,
  stageBoundarySquash,
  stageLog,
  commitDays,
} from './commits.js'
export {
  VERSIONS_FILE,
  VERSION_STATES,
  readVersions,
  mintVersion,
  versionChip,
} from './versions.js'
export {
  SESSION_BRANCH_PREFIX,
  SESSION_BASE_PREFIX,
  SESSIONS_DIR,
  SESSIONS_FILE,
  GATE_CHECK_SCRIPT,
  SESSION_STATES,
  SessionMergeError,
  listSessions,
  parkedSessions,
  sessionRepoFor,
  archivedSessionIds,
  annotateSession,
  nextSessionName,
  rekeySessionsProject,
  openSession,
  runGate,
  sessionStageBoundary,
  holdSession,
  archiveSession,
  reviveSession,
  worktreeHealth,
} from './sessions.js'
export {
  parseWorktreePorcelain,
  reconcileWorktrees,
  repairWorktrees,
} from './reconcile.js'
export {
  transitionVersion,
  recordTargetRelease,
  readTargetReleases,
} from './versions.js'
export {
  behindMain,
  branchTip,
  isMergedIntoMain,
  finishSession,
  sweepMerged,
  FinishRefusedError,
} from './finish.js'

import { stageBoundarySquash } from './commits.js'
import { mintVersion, versionChip } from './versions.js'

/**
 * Convenience wall for the common stage transition: mint the next
 * semantic version (D20) so it is captured inside the clean stage
 * commit, then squash the WIP run into that one commit (D18).
 *
 * @returns {{ squashed: boolean, sha: string|null, chip: object|null }}
 */
export function mintAtStageBoundary(repoPath, { message, name, state, env = process.env } = {}) {
  const entry = mintVersion(repoPath, { name, state })
  const result = stageBoundarySquash(repoPath, {
    message: message || `chore(version): mint ${entry.name} (${entry.version})`,
    trailer: `Arxa-Stage: version ${entry.version}`,
    env,
  })
  return { ...result, chip: versionChip(repoPath) }
}
