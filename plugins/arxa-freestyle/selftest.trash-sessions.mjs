#!/usr/bin/env node
// Task 12 host regression: archived Freestyle sessions move through a visible,
// restorable trash marker; purge is the only ref-deleting door.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { addRoot, writeManifest } from './lib/roots.js'
import { listTrash } from './lib/files.js'
import { createFreestyleSessions } from './lib/sessions.js'
import { setOrigin } from '../git-workspace/lib/repos.js'
import * as GW from '../git-workspace/lib/sessions.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-fs-session-trash-'))
const env = { ...process.env, ARXA_HOME: path.join(tmp, 'home') }
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
let n = 0
const ok = (value, label) => { assert.ok(value, label); n++; console.log('  ok', n, '-', label) }
const rootAt = (name) => {
  const dir = path.join(tmp, name)
  fs.mkdirSync(dir, { recursive: true })
  return addRoot(dir, { env })
}
const dshBridge = { spawn: async ({ id, rootId }) => ({ ok: true, id: 'dsh-' + rootId + '-' + id }) }

try {
  const root = rootAt('restore-root')
  const S = createFreestyleSessions({ env, dshBridge })
  const active = await S.newSession(root, '', 'still active')
  assert.throws(() => S.trashArchived(root, active.id), /not-archived/)
  ok(S.list(root).active.some((row) => row.id === active.id), 'a non-archived session is refused and remains visible')

  const archived = await S.newSession(root, '', 'restore me')
  S.archive(root, archived.id)
  const beforeTrash = S.list(root).archived.find((row) => row.id === archived.id)
  const moved = S.trashArchived(root, archived.id)
  const entry = listTrash(root).find((row) => row.id === moved.entryId)
  ok(entry?.kind === 'session' && entry.session?.id === archived.id, 'Move-to-Trash writes a visible session marker with the full row')
  ok(!S.list(root).archived.some((row) => row.id === archived.id), 'the archive row is removed only after its marker exists')
  ok(git(root.path, 'branch', '--list', archived.branch) === archived.branch, 'Move-to-Trash keeps the parked branch')

  const restored = S.restoreTrash(root, moved.entryId)
  const afterRestore = S.list(root).archived.find((row) => row.id === archived.id)
  assert.deepEqual(afterRestore, beforeTrash)
  ok(restored.sessionId === archived.id, 'Restore returns the exact row to Archives')
  ok(!listTrash(root).some((row) => row.id === moved.entryId), 'Restore removes the session trash marker')
  ok(git(root.path, 'branch', '--list', archived.branch) === archived.branch, 'Restore keeps the parked branch')

  // A trashed row is a ghost in the ID namespace: its branch still exists,
  // so a new session on the same day must advance rather than reuse its ID.
  const ghostRoot = rootAt('ghost-root')
  const G = createFreestyleSessions({ env, dshBridge })
  const first = await G.newSession(ghostRoot, '', 'repeat')
  G.archive(ghostRoot, first.id)
  const ghost = G.trashArchived(ghostRoot, first.id)
  const second = await G.newSession(ghostRoot, '', 'repeat')
  ok(second.id !== first.id && /-002$/.test(second.id), 'session.new counts trashed session ghosts and never reuses their branch ID')
  const purged = await G.purgeTrash(ghostRoot, ghost.entryId)
  ok(purged.refs?.branchDropped === true && !listTrash(ghostRoot).some((row) => row.id === ghost.entryId), 'local-only purge drops refs then removes the marker')

  // Published roots are remote-first. A remote refusal keeps both the local
  // branch and marker, while success observes the branch before local cleanup.
  const published = rootAt('published-root')
  const bare = path.join(tmp, 'published.git')
  fs.mkdirSync(bare)
  git(bare, 'init', '--bare', '-q')
  setOrigin(published.path, bare, env)
  writeManifest(published, { localOnly: false, repoOwner: 'acme', repoName: 'published-root', repoUrl: 'https://github.com/acme/published-root' })
  let refuseRemote = true
  let remoteSawLocalBranch = false
  const githubBridge = {
    deleteBranch: async (owner, name, branch) => {
      remoteSawLocalBranch = git(published.path, 'branch', '--list', branch) === branch
      return refuseRemote ? { ok: false, reason: 'offline' } : { ok: true }
    },
  }
  const P = createFreestyleSessions({ env, dshBridge, githubBridge })
  const remoteSession = await P.newSession(published, '', 'remote')
  P.archive(published, remoteSession.id)
  const remoteEntry = P.trashArchived(published, remoteSession.id)
  await assert.rejects(P.purgeTrash(published, remoteEntry.entryId), /remote branch deletion failed/)
  ok(listTrash(published).some((row) => row.id === remoteEntry.entryId) && git(published.path, 'branch', '--list', remoteSession.branch) === remoteSession.branch, 'remote purge failure keeps the marker and local branch for retry')
  refuseRemote = false
  const remotePurged = await P.purgeTrash(published, remoteEntry.entryId)
  ok(remoteSawLocalBranch && remotePurged.remoteBranch === 'deleted', 'published purge deletes the remote branch before local refs')
  ok(git(published.path, 'branch', '--list', remoteSession.branch) === '' && !listTrash(published).some((row) => row.id === remoteEntry.entryId), 'successful published purge removes local refs and marker')

  // Nested repos remain the owner throughout the round trip. The marker
  // records a confined relative path rather than relying on the root repo.
  const nestedRoot = rootAt('nested-root')
  const nestedRepo = path.join(nestedRoot.path, 'child')
  fs.mkdirSync(nestedRepo)
  git(nestedRepo, 'init', '-qb', 'main')
  fs.writeFileSync(path.join(nestedRepo, 'seed.txt'), 'seed\n')
  git(nestedRepo, 'add', 'seed.txt')
  git(nestedRepo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'seed')
  const N = createFreestyleSessions({ env, dshBridge })
  const nestedSession = await N.newSession(nestedRoot, 'child', 'nested')
  N.archive(nestedRoot, nestedSession.id)
  const nestedEntry = N.trashArchived(nestedRoot, nestedSession.id)
  ok(listTrash(nestedRoot).find((e) => e.id === nestedEntry.entryId)?.repoPath === 'child', 'session trash records the nested owning repo relative to its root')
  N.restoreTrash(nestedRoot, nestedEntry.entryId)
  const restoredNested = N.list(nestedRoot).archived.find((row) => row.id === nestedSession.id)
  ok(restoredNested && fs.realpathSync(restoredNested.repoPath) === fs.realpathSync(nestedRepo), 'Restore writes the row back to its nested owning repo')

  // Compatibility: sessions created before D122 alignment stored a nested
  // repo's worktree under the Freestyle root. Their exact recorded location
  // remains restorable, but workspace tampering cannot redirect their refs.
  const oldLocationId = GW.mintSessionPath({
    org: 'nested-root', workspace: 'child', name: 'old location',
    sessions: GW.listSessions(nestedRepo, env), ghosts: [],
  })
  GW.openSession(nestedRepo, {
    id: oldLocationId, orgPath: nestedRoot.path, name: 'old location', workspace: 'child', env,
  })
  GW.annotateSession(nestedRepo, oldLocationId, { freestyleRootId: nestedRoot.id }, env)
  N.archive(nestedRoot, oldLocationId)
  const oldLocationEntry = N.trashArchived(nestedRoot, oldLocationId)
  const oldLocationMarkerPath = path.join(nestedRoot.path, '.arxa', 'trash', oldLocationEntry.entryId, 'entry.json')
  const oldLocationMarker = JSON.parse(fs.readFileSync(oldLocationMarkerPath, 'utf8'))
  git(nestedRoot.path, 'branch', oldLocationId.startsWith('arxa/') ? oldLocationId : 'arxa/' + oldLocationId)
  oldLocationMarker.repoPath = '.'
  oldLocationMarker.session.workspace = ''
  fs.writeFileSync(oldLocationMarkerPath, JSON.stringify(oldLocationMarker, null, 2) + '\n')
  await assert.rejects(N.purgeTrash(nestedRoot, oldLocationEntry.entryId), /unknown-entry|repo-mismatch/)
  ok(
    git(nestedRoot.path, 'rev-parse', '--verify', oldLocationMarker.branch) !== ''
      && git(nestedRepo, 'rev-parse', '--verify', oldLocationMarker.branch) !== ''
      && listTrash(nestedRoot).some((e) => e.id === oldLocationEntry.entryId),
    'workspace plus repoPath tampering cannot redirect an old root-local marker to its ancestor repo',
  )
  oldLocationMarker.repoPath = 'child'
  oldLocationMarker.session.workspace = 'child'
  fs.writeFileSync(oldLocationMarkerPath, JSON.stringify(oldLocationMarker, null, 2) + '\n')
  N.restoreTrash(nestedRoot, oldLocationEntry.entryId)
  const restoredOldLocation = N.list(nestedRoot).archived.find((row) => row.id === oldLocationId)
  ok(
    restoredOldLocation?.worktree === path.join(nestedRoot.path, '.arxa', 'worktrees', ...oldLocationId.split('/')),
    'an existing nested session at the old root-local worktree location still restores',
  )

  // A hand-edited marker cannot redirect purge at a sibling repository.
  const guarded = N.trashArchived(nestedRoot, nestedSession.id)
  const outsideRepo = path.join(tmp, 'outside-repo')
  fs.mkdirSync(outsideRepo)
  git(outsideRepo, 'init', '-q')
  fs.writeFileSync(path.join(outsideRepo, 'seed.txt'), 'outside\n')
  git(outsideRepo, 'add', 'seed.txt')
  git(outsideRepo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'seed')
  git(outsideRepo, 'branch', nestedSession.branch)
  const markerPath = path.join(nestedRoot.path, '.arxa', 'trash', guarded.entryId, 'entry.json')
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
  const siblingRepo = path.join(nestedRoot.path, 'sibling')
  fs.mkdirSync(siblingRepo)
  git(siblingRepo, 'init', '-qb', 'main')
  fs.writeFileSync(path.join(siblingRepo, 'seed.txt'), 'sibling\n')
  git(siblingRepo, 'add', 'seed.txt')
  git(siblingRepo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'seed')
  git(siblingRepo, 'branch', nestedSession.branch)
  marker.repoPath = 'sibling'
  fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2) + '\n')
  await assert.rejects(N.purgeTrash(nestedRoot, guarded.entryId), /unknown-entry|repo-mismatch/)
  ok(
    git(siblingRepo, 'rev-parse', '--verify', nestedSession.branch) !== ''
      && git(nestedRepo, 'rev-parse', '--verify', nestedSession.branch) !== ''
      && listTrash(nestedRoot).some((e) => e.id === guarded.entryId),
    'a marker cannot redirect purge to another repository inside the same root',
  )

  marker.repoPath = path.relative(nestedRoot.path, outsideRepo)
  fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2) + '\n')
  await assert.rejects(N.purgeTrash(nestedRoot, guarded.entryId), /unknown-entry/)
  ok(git(outsideRepo, 'branch', '--list', nestedSession.branch) === nestedSession.branch, 'a marker cannot redirect purge to a repository outside its root')
  ok(listTrash(nestedRoot).some((e) => e.id === guarded.entryId), 'a rejected redirected purge keeps its visible marker')

  marker.repoPath = 'child'
  marker.branch = 'main'
  marker.session.branch = 'main'
  fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2) + '\n')
  await assert.rejects(N.purgeTrash(nestedRoot, guarded.entryId), /unknown-entry/)
  ok(git(nestedRepo, 'rev-parse', '--verify', 'main') !== '', 'a marker cannot redirect purge at main or another branch')

  marker.branch = nestedSession.branch
  marker.session.branch = nestedSession.branch
  const outsideWorktree = path.join(tmp, 'outside-worktree-sentinel')
  fs.mkdirSync(outsideWorktree)
  fs.writeFileSync(path.join(outsideWorktree, 'keep.txt'), 'keep\n')
  marker.session.worktree = outsideWorktree
  fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2) + '\n')
  await assert.rejects(N.purgeTrash(nestedRoot, guarded.entryId), /unknown-entry/)
  ok(fs.existsSync(path.join(outsideWorktree, 'keep.txt')), 'a marker cannot redirect worktree cleanup outside its expected session path')

  marker.session.worktree = nestedSession.worktree
  fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2) + '\n')
  const branchHolder = path.join(tmp, 'branch-holder')
  git(nestedRepo, 'worktree', 'add', '-q', branchHolder, nestedSession.branch)
  await assert.rejects(N.purgeTrash(nestedRoot, guarded.entryId), /local session refs or worktree remain/)
  ok(listTrash(nestedRoot).some((e) => e.id === guarded.entryId) && git(nestedRepo, 'rev-parse', '--verify', nestedSession.branch) !== '', 'failed local ref deletion keeps the marker and remaining branch for retry')
  git(nestedRepo, 'worktree', 'remove', '--force', branchHolder)
  const retried = await N.purgeTrash(nestedRoot, guarded.entryId)
  ok(retried.refs?.branchDropped === true && !listTrash(nestedRoot).some((e) => e.id === guarded.entryId), 'local purge retry removes the branch and marker after the obstruction clears')

  // Old rows predate freestyleRootId. Moving one to Trash normalizes its
  // ownership so the marker remains restorable and purgeable thereafter.
  const legacyRoot = rootAt('legacy-root')
  const L = createFreestyleSessions({ env, dshBridge })
  const legacySession = await L.newSession(legacyRoot, '', 'legacy')
  L.archive(legacyRoot, legacySession.id)
  const commonDir = path.resolve(legacyRoot.path, git(legacyRoot.path, 'rev-parse', '--git-common-dir'))
  const registryFile = path.join(commonDir, 'arxa', 'sessions.json')
  const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'))
  delete registry.sessions.find((row) => row.id === legacySession.id).freestyleRootId
  fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2) + '\n')
  const legacyEntry = L.trashArchived(legacyRoot, legacySession.id)
  ok(listTrash(legacyRoot).find((e) => e.id === legacyEntry.entryId)?.session?.freestyleRootId === legacyRoot.id, 'Move-to-Trash normalizes explicit ownership onto a legacy row snapshot')
  L.restoreTrash(legacyRoot, legacyEntry.entryId)
  ok(L.list(legacyRoot).archived.find((row) => row.id === legacySession.id)?.freestyleRootId === legacyRoot.id, 'a legacy session round trip restores as an explicitly owned archived row')

  // A same-basename root nested inside another added root produces the same
  // legacy id prefix. The parent must not claim the child's unannotated row.
  const parentPath = path.join(tmp, 'legacy-parent', 'notes')
  fs.mkdirSync(parentPath, { recursive: true })
  const parentRoot = addRoot(parentPath, { env })
  const childPath = path.join(parentPath, 'inside', 'notes')
  fs.mkdirSync(childPath, { recursive: true })
  const childRoot = addRoot(childPath, { env })
  const Child = createFreestyleSessions({ env, dshBridge })
  const Parent = createFreestyleSessions({ env, dshBridge })
  const childLegacy = await Child.newSession(childRoot, '', 'legacy child')
  Child.archive(childRoot, childLegacy.id)
  const childCommonDir = path.resolve(childRoot.path, git(childRoot.path, 'rev-parse', '--git-common-dir'))
  const childRegistryFile = path.join(childCommonDir, 'arxa', 'sessions.json')
  const childRegistry = JSON.parse(fs.readFileSync(childRegistryFile, 'utf8'))
  delete childRegistry.sessions.find((row) => row.id === childLegacy.id).freestyleRootId
  fs.writeFileSync(childRegistryFile, JSON.stringify(childRegistry, null, 2) + '\n')
  assert.throws(() => Parent.trashArchived(parentRoot, childLegacy.id), /legacy-ownership|unknown-session/)
  ok(
    Child.list(childRoot).archived.some((row) => row.id === childLegacy.id)
      && !Parent.list(parentRoot).archived.some((row) => row.id === childLegacy.id)
      && !listTrash(parentRoot).some((e) => e.kind === 'session'),
    'a parent root hides and refuses an ambiguous legacy child row without removing it or creating a marker',
  )

  // A temporarily missing nested repository retains its Trash marker. Once
  // restored at the recorded path, purge can retry and remove its refs.
  const missingRoot = rootAt('missing-repo-root')
  const missingRepo = path.join(missingRoot.path, 'nested')
  fs.mkdirSync(missingRepo)
  git(missingRepo, 'init', '-qb', 'main')
  fs.writeFileSync(path.join(missingRepo, 'seed.txt'), 'missing\n')
  git(missingRepo, 'add', 'seed.txt')
  git(missingRepo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'seed')
  const M = createFreestyleSessions({ env, dshBridge })
  const missingSession = await M.newSession(missingRoot, 'nested', 'missing')
  M.archive(missingRoot, missingSession.id)
  const missingEntry = M.trashArchived(missingRoot, missingSession.id)
  const movedRepo = path.join(tmp, 'temporarily-moved-repo')
  fs.renameSync(missingRepo, movedRepo)
  await assert.rejects(M.purgeTrash(missingRoot, missingEntry.entryId), /repo-gone|owning repo.*unavailable/)
  ok(listTrash(missingRoot).some((e) => e.id === missingEntry.entryId), 'purge keeps the marker while its owning nested repository is unavailable')
  fs.renameSync(movedRepo, missingRepo)
  const missingRetried = await M.purgeTrash(missingRoot, missingEntry.entryId)
  ok(missingRetried.refs?.branchDropped === true && !listTrash(missingRoot).some((e) => e.id === missingEntry.entryId), 'purge succeeds after the recorded nested repository returns')

  // A marker duplicated by a crash is harmless while the matching row is
  // still archived. If that row has since been revived, restore must retain
  // both the active row and marker instead of overwriting the live state.
  const conflictRoot = rootAt('conflict-root')
  const C = createFreestyleSessions({ env, dshBridge })
  const conflictSession = await C.newSession(conflictRoot, '', 'conflict')
  C.archive(conflictRoot, conflictSession.id)
  let conflictEntry = C.trashArchived(conflictRoot, conflictSession.id)
  let conflictMarker = listTrash(conflictRoot).find((e) => e.id === conflictEntry.entryId)
  GW.restoreSessionRow(conflictRoot.path, conflictMarker.session, env)
  C.restoreTrash(conflictRoot, conflictEntry.entryId)
  ok(C.list(conflictRoot).archived.some((row) => row.id === conflictSession.id) && !listTrash(conflictRoot).some((e) => e.id === conflictEntry.entryId), 'restore idempotently clears a crash-duplicate marker for the same archived row')
  conflictEntry = C.trashArchived(conflictRoot, conflictSession.id)
  conflictMarker = listTrash(conflictRoot).find((e) => e.id === conflictEntry.entryId)
  GW.restoreSessionRow(conflictRoot.path, conflictMarker.session, env)
  C.revive(conflictRoot, conflictSession.id)
  assert.throws(() => C.restoreTrash(conflictRoot, conflictEntry.entryId), /session-conflict/)
  ok(C.list(conflictRoot).active.some((row) => row.id === conflictSession.id) && listTrash(conflictRoot).some((e) => e.id === conflictEntry.entryId), 'restore refuses a revived-row conflict and retains both the live row and marker')
  await assert.rejects(C.purgeTrash(conflictRoot, conflictEntry.entryId), /session-conflict/)
  ok(
    fs.existsSync(conflictSession.worktree)
      && git(conflictRoot.path, 'rev-parse', '--verify', conflictSession.branch) !== ''
      && C.list(conflictRoot).active.some((row) => row.id === conflictSession.id)
      && listTrash(conflictRoot).some((e) => e.id === conflictEntry.entryId),
    'purge refuses a duplicate live row before deleting its worktree, branch, registry row, or marker',
  )

  // Restore can also race the awaited remote deletion. The second registry
  // guard protects local data even after the remote half has completed.
  const raceRoot = rootAt('race-root')
  setOrigin(raceRoot.path, bare, env)
  writeManifest(raceRoot, { localOnly: false, repoOwner: 'acme', repoName: 'race-root', repoUrl: 'https://github.com/acme/race-root' })
  let remoteStartedResolve, releaseRemote
  const remoteStarted = new Promise((resolve) => { remoteStartedResolve = resolve })
  const remoteRelease = new Promise((resolve) => { releaseRemote = resolve })
  const R = createFreestyleSessions({
    env,
    dshBridge,
    githubBridge: { deleteBranch: async () => { remoteStartedResolve(); await remoteRelease; return { ok: true } } },
  })
  const raceSession = await R.newSession(raceRoot, '', 'race')
  R.archive(raceRoot, raceSession.id)
  const raceEntry = R.trashArchived(raceRoot, raceSession.id)
  const raceMarker = listTrash(raceRoot).find((e) => e.id === raceEntry.entryId)
  const pendingPurge = R.purgeTrash(raceRoot, raceEntry.entryId)
  await remoteStarted
  GW.restoreSessionRow(raceRoot.path, raceMarker.session, env)
  R.revive(raceRoot, raceSession.id)
  releaseRemote()
  await assert.rejects(pendingPurge, /restored while purge was running/)
  ok(
    fs.existsSync(raceSession.worktree)
      && git(raceRoot.path, 'rev-parse', '--verify', raceSession.branch) !== ''
      && R.list(raceRoot).active.some((row) => row.id === raceSession.id)
      && listTrash(raceRoot).some((e) => e.id === raceEntry.entryId),
    'a restore racing remote purge preserves the local worktree, branch, registry row, and marker',
  )

  console.log('GREEN arxa-freestyle session trash (' + n + ')')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
