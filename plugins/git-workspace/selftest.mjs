#!/usr/bin/env node
// Selftest for arxa-git-workspace (phases 3 + 4). Covers:
//  1. probe: git present + git absent (disabled state, GitUnavailableError)
//  2. D37 nesting isolation: org repo commits never capture nested
//     project repo contents; account/ never enters git history
//  3. D18 commit wall + squash round-trip: WIP auto-commits accumulate,
//     stage-boundary squash produces ONE clean commit, second round trip
//  4. D20/D44 version chip: mint at stage boundary, chip has no SHAs
//  5. D38–D40 sessions: open → edit → stage boundary → green merges to
//     main; forced red gate parks the branch; archive prunes the
//     worktree but the branch survives; revive continues from parked
//     state; concurrent sessions — the merge loser fails loudly with
//     all commits intact; main never has a direct commit
// Runs against a throwaway workspace under a temp dir; nothing
// machine-global is touched (isolated HOME-free git via run.js).

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  GitUnavailableError, probeGit, resetProbe,
  runGit, WIP_IDENTITY,
  isRepo, initOrgRepo, initProjectRepo,
  hasHead, readSnapshotMarker, snapshotWorkerLive, spawnSnapshotOrgRepo,
  isDirty, wipCommit, wipRun, stageBoundarySquash, stageLog,
  mintAtStageBoundary, versionChip, readVersions,
  SessionMergeError, GATE_CHECK_SCRIPT, SESSION_BRANCH_PREFIX,
  openSession, sessionStageBoundary, archiveSession, reviveSession,
  listSessions, archivedSessionIds, mintSessionPath, sessionLeaf, dshSessionKey, assertSessionIdShape,
  getOrigin, setOrigin, rekeySessionsProject,
  pushRepo, fetchRepo, mainSyncState, ffMergeMain,
  worktreeHealth,
} from './lib/index.js'

let passed = 0
function ok(label, fn) {
  fn()
  passed += 1
  console.log(`ok ${passed} - ${label}`)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-git-selftest-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// ---- 1. probe -------------------------------------------------------------

ok('probe: absent git → disabled state with user-facing reason', () => {
  resetProbe()
  const absentEnv = { ...process.env, ARXA_GIT_BIN: path.join(tmp, 'no-such-git') }
  const probe = probeGit(absentEnv)
  assert.equal(probe.available, false)
  assert.match(probe.reason, /install git/)
  // Every exported git-backed API degrades to an explicit error, not a crash.
  assert.throws(() => initOrgRepo(tmp, absentEnv), GitUnavailableError)
  assert.throws(() => wipCommit(tmp, { env: absentEnv }), GitUnavailableError)
  assert.throws(
    () => stageBoundarySquash(tmp, { message: 'x', env: absentEnv }),
    GitUnavailableError,
  )
})

ok('probe: present git → available with version', () => {
  resetProbe()
  const probe = probeGit()
  assert.equal(probe.available, true)
  assert.match(probe.version, /^\d+\./)
})

// ---- workspace scaffold (plain dirs standing in for phase 1 output) -------

const orgPath = path.join(tmp, 'acme')
const projectPath = path.join(orgPath, 'projects', 'website')
fs.mkdirSync(path.join(orgPath, 'notes'), { recursive: true })
fs.mkdirSync(path.join(orgPath, 'account'), { recursive: true })
fs.mkdirSync(projectPath, { recursive: true })
fs.writeFileSync(path.join(orgPath, 'org.json'), '{"name":"acme"}\n')
fs.writeFileSync(path.join(orgPath, 'notes', 'kickoff.md'), '# kickoff\n')
fs.writeFileSync(path.join(orgPath, 'account', 'billing.json'), '{"secret":"never-in-git"}\n')
fs.writeFileSync(path.join(projectPath, 'project.json'), '{"name":"website"}\n')

// ---- 2. D37 repo boundaries ----------------------------------------------

ok('org repo init at scaffold time, idempotent', () => {
  const first = initOrgRepo(orgPath)
  assert.equal(first.initialised, true)
  assert.equal(isRepo(orgPath), true)
  const second = initOrgRepo(orgPath)
  assert.equal(second.initialised, false) // no-op re-run
})

ok('nested project repo init, ignored by org repo', () => {
  const res = initProjectRepo(projectPath)
  assert.equal(res.initialised, true)
  assert.equal(isRepo(projectPath), true)
})

ok('D37: org commits never capture nested project repo contents', () => {
  // Dirty both tiers, then commit the org with the broadest possible add.
  fs.writeFileSync(path.join(orgPath, 'notes', 'meeting.md'), '# meeting\n')
  fs.writeFileSync(path.join(projectPath, 'draft.md'), 'project-only content\n')
  fs.writeFileSync(path.join(orgPath, 'account', 'card.json'), '{"pan":"0000"}\n')
  wipCommit(orgPath, { message: 'org edit' })
  const tracked = runGit(['ls-files'], { cwd: orgPath })
  assert.ok(tracked.includes('notes/meeting.md'))
  assert.ok(!tracked.includes('projects/website'), 'project files leaked into org repo')
  assert.ok(!/^projects\//m.test(tracked), 'something under projects/ is tracked')
  assert.ok(!/^account\//m.test(tracked), 'account/ leaked into git history')
  // And the org tree is clean afterwards — nothing left half-staged.
  assert.equal(isDirty(orgPath), false)
  // The project repo still sees its own file as untracked (its own repo).
  assert.equal(isDirty(projectPath), true)
})

// ---- 3. D18 commit wall + squash round-trip ------------------------------

ok('WIP auto-commits accumulate under the WIP identity', () => {
  wipCommit(projectPath, { message: 'edit 1' })
  fs.writeFileSync(path.join(projectPath, 'draft.md'), 'revision 2\n')
  wipCommit(projectPath, { message: 'edit 2' })
  fs.writeFileSync(path.join(projectPath, 'draft.md'), 'revision 3\n')
  wipCommit(projectPath, { message: 'edit 3' })
  const run = wipRun(projectPath)
  assert.equal(run.length, 3)
  assert.ok(run.every((c) => c.wip && c.subject.startsWith('wip:')))
  // Clean tree → no-op, not an empty commit.
  assert.equal(wipCommit(projectPath).committed, false)
})

ok('stage-boundary squash → ONE clean commit, content preserved', () => {
  const before = stageLog(projectPath).length
  const res = stageBoundarySquash(projectPath, { message: 'docs(draft): first draft complete', trailer: 'Arxa-Stage: org test' })
  assert.equal(res.squashed, true)
  const log = stageLog(projectPath)
  assert.equal(log.length, before - 3 + 1, 'WIP run did not collapse to one commit')
  assert.ok(log.every((c) => !c.subject.startsWith('wip:')), 'WIP commit survived in history')
  assert.ok(log.every((c) => SUBJECT_RE.test(c.subject)), 'non-conventional subject in history (Q7) — no stage: escape hatch, that clause hid B18/B20')
  assert.equal(log[0].subject, 'docs(draft): first draft complete')
  const body = runGit(['log', '--format=%b', '-n', '1'], { cwd: projectPath })
  assert.ok(body.includes('Arxa-Stage: org test'), 'provenance rides the trailer, not the subject')
  assert.equal(fs.readFileSync(path.join(projectPath, 'draft.md'), 'utf8'), 'revision 3\n')
  assert.equal(wipRun(projectPath).length, 0) // boundary ref advanced
  assert.equal(stageBoundarySquash(projectPath, { message: 'noop' }).squashed, false)
})

ok('second round trip: wall keeps working after a squash', () => {
  fs.writeFileSync(path.join(projectPath, 'draft.md'), 'revision 4\n')
  wipCommit(projectPath, { message: 'edit 4' })
  fs.writeFileSync(path.join(projectPath, 'notes.md'), 'more\n')
  const res = mintAtStageBoundary(projectPath, { name: 'Second draft' })
  assert.equal(res.squashed, true)
  const log = stageLog(projectPath)
  assert.ok(log.every((c) => SUBJECT_RE.test(c.subject)), 'non-conventional subject in history (Q7) — no stage: escape hatch, that clause hid B18/B20')
  assert.equal(log[0].subject, 'chore(version): mint Second draft (v1)')
})

// ---- 4. D20/D44 version chip ---------------------------------------------

ok('version chip: semantic version + state, no SHAs (D44)', () => {
  const chip = versionChip(projectPath)
  assert.equal(chip.version, 'v1')
  assert.equal(chip.label, 'v1 · Draft')
  assert.ok(!/[0-9a-f]{7,40}/.test(chip.label), 'chip leaks a SHA-like token')
  const res = mintAtStageBoundary(projectPath, { name: 'Third draft', state: 'In review' })
  assert.equal(res.squashed, true) // versions.json change is itself squashable content
  assert.equal(res.chip.label, 'v2 · In review')
  const chain = readVersions(projectPath)
  assert.equal(chain.length, 2)
  assert.equal(chain[0].state, 'Superseded') // archived, never deleted
})

ok('org repo log shows nothing from inside the project', () => {
  const orgSubjects = stageLog(orgPath).map((c) => c.subject).join('\n')
  assert.ok(!orgSubjects.includes('draft'), 'project activity leaked into org log')
  const orgFiles = runGit(['log', '--name-only', '--format='], { cwd: orgPath })
  assert.ok(!orgFiles.includes('projects/'), 'org history touched projects/')
  assert.ok(!orgFiles.includes('account/'), 'org history touched account/')
})

// ---- 5. D38–D40 sessions: branch-per-session worktrees ---------------------

ok('sessions degrade: absent git → GitUnavailableError, not a crash', () => {
  resetProbe()
  const absentEnv = { ...process.env, ARXA_GIT_BIN: path.join(tmp, 'no-such-git') }
  assert.throws(() => openSession(projectPath, { env: absentEnv }), GitUnavailableError)
  resetProbe() // restore cached probe for the checks below
})

ok('session open → edit → boundary: green merges to main; main never edited directly (D38)', () => {
  const mainBefore = runGit(['rev-parse', 'main'], { cwd: projectPath })
  const s = openSession(projectPath, { id: 'chat1', name: 'Chat 1' })
  assert.equal(s.state, 'open')
  assert.ok(fs.existsSync(path.join(s.worktree, 'draft.md')), 'worktree missing project files')
  fs.writeFileSync(path.join(s.worktree, 'draft.md'), 'session edit\n')
  wipCommit(s.worktree, { message: 'session edit' })
  // Edits live only on the session branch until the boundary (D38).
  assert.equal(runGit(['rev-parse', 'main'], { cwd: projectPath }), mainBefore)
  assert.notEqual(fs.readFileSync(path.join(projectPath, 'draft.md'), 'utf8'), 'session edit\n')
  const res = sessionStageBoundary(projectPath, 'chat1')
  assert.equal(res.merged, true)
  assert.equal(res.gate.kind, 'light') // no check.sh → content repo, config state not error
  assert.equal(res.gate.configured, false)
  assert.equal(fs.readFileSync(path.join(projectPath, 'draft.md'), 'utf8'), 'session edit\n')
  // The other session's squash base is untouched: main-side stage tooling still works.
  assert.equal(wipRun(projectPath).length, 0)
})

ok('session registry records the project scope: slug stamped, default null, junk rejected', () => {
  const scoped = openSession(projectPath, { id: 'scoped1', name: 'Scoped', project: 'acme-website' })
  assert.equal(scoped.project, 'acme-website')
  const orgLevel = openSession(projectPath, { id: 'orglevel1', name: 'Org level' })
  assert.equal(orgLevel.project, null)
  assert.throws(() => openSession(projectPath, { id: 'bad1', project: 42 }), TypeError)
  assert.throws(() => openSession(projectPath, { id: 'bad2', project: '' }), TypeError)
})

ok('red gate parks the branch — never deleted (D40)', () => {
  const s = openSession(projectPath, { id: 'red1', name: 'Red session' })
  fs.writeFileSync(path.join(s.worktree, GATE_CHECK_SCRIPT), 'exit 1\n')
  fs.writeFileSync(path.join(s.worktree, 'risky.md'), 'unreviewed\n')
  const mainBefore = runGit(['rev-parse', 'main'], { cwd: projectPath })
  const res = sessionStageBoundary(projectPath, 'red1')
  assert.equal(res.gate.green, false)
  assert.equal(res.gate.kind, 'check.sh')
  assert.equal(res.merged, false)
  assert.equal(res.session.state, 'parked')
  assert.equal(res.session.parkedReason, 'gate-red')
  assert.equal(runGit(['rev-parse', 'main'], { cwd: projectPath }), mainBefore, 'red work reached main')
  assert.ok(runGit(['branch', '--list', s.branch], { cwd: projectPath }) !== '')
})

ok('archive prunes worktree, keeps branch; revive continues from parked state (D39/D40)', () => {
  const parked = archiveSession(projectPath, 'red1')
  assert.equal(parked.state, 'archived')
  assert.ok(!fs.existsSync(parked.worktree), 'archive did not prune the worktree directory')
  assert.ok(runGit(['branch', '--list', parked.branch], { cwd: projectPath }) !== '',
    'archive deleted the parked branch (D40 violation)')
  assert.deepEqual(archivedSessionIds(projectPath), ['red1']) // dsh contract
  const s = reviveSession(projectPath, 'red1')
  assert.equal(s.state, 'open')
  assert.equal(fs.readFileSync(path.join(s.worktree, 'risky.md'), 'utf8'), 'unreviewed\n')
  // Fix the gate, finish the work: revived session merges like any other.
  fs.writeFileSync(path.join(s.worktree, GATE_CHECK_SCRIPT), 'exit 0\n')
  fs.writeFileSync(path.join(s.worktree, 'risky.md'), 'reviewed\n')
  const res = sessionStageBoundary(projectPath, 'red1')
  assert.equal(res.merged, true)
  assert.equal(fs.readFileSync(path.join(projectPath, 'risky.md'), 'utf8'), 'reviewed\n')
})

ok('concurrent sessions: merge loser fails loudly, zero commits lost', () => {
  const a = openSession(projectPath, { id: 'race-a' })
  const b = openSession(projectPath, { id: 'race-b' })
  fs.writeFileSync(path.join(a.worktree, 'shared.md'), 'from a\n')
  fs.writeFileSync(path.join(b.worktree, 'shared.md'), 'from b\n')
  assert.equal(sessionStageBoundary(projectPath, 'race-a').merged, true)
  assert.throws(() => sessionStageBoundary(projectPath, 'race-b'), SessionMergeError)
  const loser = listSessions(projectPath).find((s) => s.id === 'race-b')
  assert.equal(loser.state, 'parked')
  assert.equal(loser.parkedReason, 'merge-conflict')
  // Loser's commits are all still on its branch, recoverable.
  const tip = runGit(['rev-parse', b.branch], { cwd: projectPath })
  assert.ok(tip)
  assert.equal(runGit(['show', `${tip}:shared.md`], { cwd: projectPath }), 'from b')
  assert.equal(fs.readFileSync(path.join(projectPath, 'shared.md'), 'utf8'), 'from a\n')
})

ok('main history: every commit is a stage commit — no WIP identity, no direct edits', () => {
  const emails = runGit(['log', '--format=%ce', 'main'], { cwd: projectPath }).split('\n')
  assert.ok(!emails.includes(WIP_IDENTITY.email), 'WIP commit reached main')
  const subjects = runGit(['log', '--format=%s', 'main'], { cwd: projectPath }).split('\n')
  assert.ok(subjects.every((s) => s.startsWith('stage:') || SUBJECT_RE.test(s)), `non-conventional subject on main (Q7): ${subjects}`)
})



// ---- W3b additive faces: setOrigin + boundary push + registry rekey --------

{
  const originTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-git-origin-'))
  const proj = path.join(originTmp, 'proj')
  fs.mkdirSync(proj)
  fs.writeFileSync(path.join(proj, 'project.json'), '{"name":"proj"}\n')
  initProjectRepo(proj)

  ok('setOrigin: creates origin when absent, UPDATES when present (never throws)', () => {
    assert.equal(getOrigin(proj), null)
    const created = setOrigin(proj, 'https://github.com/octo/a.git')
    assert.equal(created.updated, false)
    assert.equal(getOrigin(proj), 'https://github.com/octo/a.git')
    const updated = setOrigin(proj, 'https://github.com/octo/b.git')
    assert.equal(updated.updated, true)
    assert.equal(getOrigin(proj), 'https://github.com/octo/b.git')
  })

  ok('stage boundary with no origin: merged stands, pushed:false no-origin', () => {
    const bare = path.join(originTmp, 'plain')
    fs.mkdirSync(bare)
    fs.writeFileSync(path.join(bare, 'project.json'), '{"name":"plain"}\n')
    initProjectRepo(bare)
    const s = openSession(bare, { id: 'push-none', name: 'Push none' })
    fs.writeFileSync(path.join(s.worktree, 'x.md'), 'x\n')
    const res = sessionStageBoundary(bare, 'push-none')
    assert.equal(res.merged, true)
    assert.deepEqual(res.push, { pushed: false, reason: 'no-origin' })
  })

  ok('stage boundary with a local bare origin: first push happens here (D18/D69)', () => {
    const remote = path.join(originTmp, 'origin.git')
    runGit(['init', '--bare', remote], { cwd: originTmp })
    setOrigin(proj, remote)
    const s = openSession(proj, { id: 'push-local', name: 'Push local' })
    fs.writeFileSync(path.join(s.worktree, 'y.md'), 'y\n')
    const res = sessionStageBoundary(proj, 'push-local')
    assert.equal(res.merged, true)
    assert.equal(res.push.pushed, true)
    assert.equal(runGit(['rev-parse', 'main'], { cwd: remote }), runGit(['rev-parse', 'main'], { cwd: proj }),
      'bare origin main does not match local main after the boundary push')
  })

  ok('rekeySessionsProject: project scope rekeyed oldSlug→newSlug, others untouched (D72)', () => {
    openSession(proj, { id: 'rk1', project: 'old-slug' })
    openSession(proj, { id: 'rk2', project: 'other' })
    openSession(proj, { id: 'rk3', project: 'old-slug' })
    assert.equal(rekeySessionsProject(proj, 'old-slug', 'new-slug'), 2)
    const byId = Object.fromEntries(listSessions(proj).map((s) => [s.id, s.project]))
    assert.equal(byId.rk1, 'new-slug')
    assert.equal(byId.rk2, 'other')
    assert.equal(byId.rk3, 'new-slug')
  })

  fs.rmSync(originTmp, { recursive: true, force: true })
}

// ---- 6. initial snapshot: defer / detached spawn / unborn-HEAD heal --------
// The 2025-08 create-org hang: an in-place org root full of bulk content
// made the inline 'add -A' run for many minutes and froze the app. The
// contract now: deferSnapshot skips the sync snapshot; the detached
// worker lands HEAD without anyone waiting; a repo left with an unborn
// HEAD is healed on the next init.

const deferPath = path.join(tmp, 'defer-org')
fs.mkdirSync(path.join(deferPath, 'notes'), { recursive: true })
fs.writeFileSync(path.join(deferPath, 'org.json'), '{"name":"defer"}\n')
fs.writeFileSync(path.join(deferPath, 'notes', 'a.md'), '# a\n')

ok('initOrgRepo deferSnapshot: repo attached, NO commit yet, deferred flagged', () => {
  const res = initOrgRepo(deferPath, process.env, { deferSnapshot: true })
  assert.equal(res.initialised, true)
  assert.equal(res.deferred, true)
  assert.equal(isRepo(deferPath), true)
  assert.equal(hasHead(deferPath), false) // session gate holds
})

async function okA(label, fn) {
  await fn()
  passed += 1
  console.log(`ok ${passed} - ${label}`)
}

await okA('spawnSnapshotOrgRepo: detached worker lands HEAD + done marker', async () => {
  const { pid } = spawnSnapshotOrgRepo(deferPath)
  assert.equal(typeof pid, 'number')
  const deadline = Date.now() + 20000
  while (!hasHead(deferPath)) {
    if (Date.now() > deadline) throw new Error('detached snapshot never landed HEAD')
    await new Promise((r) => setTimeout(r, 100))
  }
  // HEAD lands mid-run; the done marker + stage-base land at the END — the
  // v2 template's bigger tree widened that gap, so poll for done (bounded).
  const doneDeadline = Date.now() + 20000
  let m = readSnapshotMarker(deferPath)
  while (m.state !== 'done') {
    if (Date.now() > doneDeadline) throw new Error('detached snapshot never reached done')
    await new Promise((r) => setTimeout(r, 100))
    m = readSnapshotMarker(deferPath)
  }
  assert.equal(m.state, 'done')
  assert.equal(snapshotWorkerLive(deferPath), false) // worker exited
  assert.match(runGit(['rev-parse', 'refs/arxa/stage-base'], { cwd: deferPath }), /^[0-9a-f]{40}$/)
})

ok('initOrgRepo heals an unborn-HEAD repo (interrupted snapshot)', () => {
  const healPath = path.join(tmp, 'heal-org')
  fs.mkdirSync(healPath, { recursive: true })
  fs.writeFileSync(path.join(healPath, 'org.json'), '{"name":"heal"}\n')
  runGit(['init'], { cwd: healPath }) // repo with unborn HEAD, no commit
  assert.equal(hasHead(healPath), false)
  const res = initOrgRepo(healPath) // default: heal synchronously
  assert.equal(res.initialised, false) // repo already existed
  assert.equal(res.deferred, false)
  assert.equal(hasHead(healPath), true)
})

ok('initOrgRepo on a healthy repo stays a no-op (deferred or not)', () => {
  const again = initOrgRepo(deferPath, process.env, { deferSnapshot: true })
  assert.equal(again.initialised, false)
  assert.equal(again.deferred, false) // hasHead → nothing to defer
})

ok('orgIgnoreFor: includeExisting=false versions only arxa-managed files', () => {
  const wl = path.join(tmp, 'whitelist-org')
  fs.mkdirSync(path.join(wl, 'notes'), { recursive: true })
  fs.writeFileSync(path.join(wl, 'org.json'), '{"name":"wl"}\n')
  fs.writeFileSync(path.join(wl, 'notes', 'a.md'), '# a\n')
  fs.writeFileSync(path.join(wl, 'bulk.bin'), 'BULK'.repeat(100))
  const res = initOrgRepo(wl, process.env, { includeExisting: false, managedDirs: ['projects', 'notes', 'meetings', 'account', 'communications'] })
  assert.equal(res.initialised, true)
  const tracked = runGit(['ls-files'], { cwd: wl }).split('\n')
  assert.ok(tracked.includes('notes/a.md'), 'managed org files are tracked')
  assert.ok(tracked.includes('org.json'))
  assert.ok(!tracked.includes('bulk.bin'), 'pre-existing bulk is NOT tracked')
  assert.equal(fs.existsSync(path.join(wl, 'bulk.bin')), true) // untouched on disk
})

ok('pushRepo: pushes the PRIMARY branch to a remote URL (D73 push half, offline bare)', () => {
  const src = path.join(tmp, 'push-src')
  fs.mkdirSync(src, { recursive: true }) // real callers always scaffold the folder first
  const bare = path.join(tmp, 'push-remote.git')
  initOrgRepo(src, process.env, { managedDirs: ['projects', 'notes', 'meetings', 'account', 'communications'] })
  runGit(['init', '--bare', bare], { cwd: tmp })
  // a session branch exists locally but must NEVER publish
  const noiseBranch = `${SESSION_BRANCH_PREFIX}ORG/notes/noise-wt-260903-001`
  runGit(['branch', noiseBranch], { cwd: src })
  const res = pushRepo(src, bare, process.env)
  assert.equal(res.ref, 'main', 'primary branch resolved (HEAD was main)')
  assert.ok(runGit(['rev-parse', '--verify', 'main'], { cwd: bare, allowFail: true }) !== null, 'main landed on the remote')
  assert.equal(runGit(['rev-parse', '--verify', `refs/heads/${noiseBranch}`], { cwd: bare, allowFail: true }), null, 'session branches never publish')
  // HEAD on a session branch (session open) → falls back to main, still not the session branch
  const openBranch = `${SESSION_BRANCH_PREFIX}ORG/notes/open-wt-260903-001`
  runGit(['checkout', '-b', openBranch], { cwd: src })
  const res2 = pushRepo(src, bare, process.env)
  assert.equal(res2.ref, 'main', 'session-branch HEAD falls back to the primary branch')
  assert.throws(() => pushRepo(src, '', process.env), TypeError, 'empty url is a loud TypeError')
})


// ---- 6. CI frame (Part B S1: Q3/Q4/Q5/Q7/Q8) ------------------------------

import { SUBJECT_RE, FRAME_JOB, orgCheckSh, projectCheckSh, ciYml, prTemplate, protectionPayload, settingsPayload, writeFrameFiles, frameStatus, frameFileState, readStamp, stampContent, FRAME_VERSION } from './lib/frame.js'
import { createWipWatcher } from './lib/watch.js'
import { execFileSync } from 'node:child_process'

ok('frame: conventional-subject regex matches the law (Q7)', () => {
  assert.equal(SUBJECT_RE.test('fix(x): ok'), true)
  assert.equal(SUBJECT_RE.test('feat!: breaking ok'), true)
  assert.equal(SUBJECT_RE.test('chore(ci): wire the arxa frame'), true)
  assert.equal(SUBJECT_RE.test('nope: bad'), false)
  assert.equal(SUBJECT_RE.test('wip: internal tier'), false, 'wip tier never passes (it never reaches history either)')
})

ok('frame: ci.yml carries the canon runner labels, concurrency, timeout (Q5)', () => {
  const y = ciYml()
  assert.ok(y.includes('runs-on: [self-hosted, macOS, ARM64, arxa]'), 'canon labels')
  assert.ok(y.includes('group: ci-' + String.fromCharCode(36) + '{{ github.ref }}'), 'concurrency group')
  assert.ok(y.includes('cancel-in-progress: true'))
  assert.ok(y.includes('timeout-minutes: 15'), 'timeout always')
  assert.ok(y.includes('sh check.sh'), 'the one-root check')
  assert.ok(!y.includes('ubuntu-latest') && !y.includes('macos-1'), 'never GitHub-hosted')
})

// Q7 (2026-09-03): without this trigger a session-branch push fires no
// workflow at all, so "push the branch at the stage boundary" would have been
// a backup rather than CI. The version bump is what rolls it out to repos that
// already carry a v2 frame.
ok('frame: ci.yml runs frame-check on session branches as well as main (Q7)', () => {
  const y = ciYml()
  assert.ok(y.includes("branches: [main, 'arxa/**']"), 'session branches are watched')
  assert.ok(y.includes('pull_request:'), 'the PR trigger survives — the review path is unchanged')
  assert.equal(FRAME_VERSION, 5, 'the stamp version bumped so existing published repos heal to the t3ci project checks (v4 widened the branch glob; v5 adds pinned SDK + --enforce-lockfile + --fatal-warnings)')
})

ok('frame: protection + settings payloads (Q3/Q8)', () => {
  assert.deepEqual(protectionPayload().required_status_checks, { strict: true, checks: [{ context: FRAME_JOB }] })
  assert.equal(protectionPayload().enforce_admins, false, 'solo machine commits ride main (S0 V4)')
  // D107 flip: collapse-then-`--no-ff` needs a real merge commit. GitHub's
  // squash merge writes a commit whose ancestry excludes the branch, which
  // breaks every "is this session in main?" question the card asks.
  assert.deepEqual(settingsPayload(), { allow_squash_merge: false, allow_merge_commit: true, allow_rebase_merge: false })
})

ok('frame: projectCheckSh walks to every target, not just the root (B11)', () => {
  const sh = projectCheckSh()
  assert.ok(sh.includes('-print'), 'finds stack markers by walking')
  assert.ok(/cd "\$d"/.test(sh), 'probes inside each target dir, not the project root')
  for (const pruned of ['node_modules', '.dart_tool', 'Pods', 'vendor', 'build'])
    assert.ok(sh.includes(pruned), `prunes ${pruned} so a dependency is never a target`)
  assert.ok(sh.includes('done || exit 1'), 'a failure inside the loop subshell reds the run')
})

ok('frame: analyze is never gated on a test/ dir (B15)', () => {
  const sh = projectCheckSh()
  const analyze = sh.slice(sh.indexOf('"$run" analyze'))
  const guard = sh.slice(0, sh.indexOf('"$run" analyze'))
  assert.ok(!/\[ -d test \][^\n]*&&[^\n]*\n?[^\n]*analyze/.test(guard), 'no [ -d test ] AND before analyze')
  assert.ok(analyze.includes('if [ -d test ]'), 'only the test run is guarded by test/')
  // The invariant is that a pub-get failure reds — NOT the exact redirect.
  // v5 keeps stderr (only stdout is dropped) so a lockfile rejection names the
  // dependency that drifted; a gate that fails without saying why is one
  // nobody can act on.
  assert.ok(/pub get[^\n]*\|\| fail "\$run pub get/.test(sh), 'unresolvable pubspec is a hard red')
  assert.ok(!/pub get[^\n]*2>&1/.test(sh), 'pub get keeps stderr so the reason survives')
})

ok('frame: v5 t3ci checks are all GUARDED — absence is never a failure (Q13)', () => {
  const sh = projectCheckSh()
  // Each of the three reproducibility checks, and the guard that keeps it from
  // reddening a tree that simply lacks an optional file. arxa studio is
  // distributed: a gate that fails for a MISSING pubspec.lock is one users
  // switch off, and a switched-off gate catches nothing at all.
  assert.ok(sh.includes('--enforce-lockfile'), 'the lockfile is enforced')
  assert.ok(/\[ -f pubspec\.lock \]/.test(sh), '…only when a lockfile actually exists')
  assert.ok(sh.includes('analyze --fatal-warnings'), 'a warning is fatal')
  assert.ok(sh.includes('command -v fvm'), 'the SDK is pinned through fvm')
  assert.ok(/\[ -f \.fvmrc \] \|\| \[ -f "\$root\/\.fvmrc" \]/.test(sh),
    'the pin is read from the target OR the project root — fvm resolves .fvmrc by walking up, so a project-level pin must count')
  // Unpinned still requires the tool; pinned needs only fvm, which supplies it.
  assert.ok(sh.includes('[ -n "$pin" ] || command -v "$run" >/dev/null 2>&1 || exit 0'),
    'a target whose toolchain is absent is skipped, not failed')
  assert.ok(sh.includes('root=$(pwd)'), 'the project root is captured before the per-target walk')
})

ok('frame: .arxa/ is excluded at git init, before anything can be added', () => {
  // The per-org lock under .arxa/locks holds a pid and is rewritten on every
  // open. Excluding only helps files that are not ALREADY tracked, so this has
  // to happen at init — doing it at first session (as it used to) let the
  // initial snapshot commit runtime state into the user's history.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-exclude-'))
  try {
    initOrgRepo(dir)
    const exclude = path.join(dir, '.git', 'info', 'exclude')
    assert.ok(fs.readFileSync(exclude, 'utf8').split('\n').includes('/.arxa/'), '.arxa/ excluded at init')
    fs.mkdirSync(path.join(dir, '.arxa', 'locks'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.arxa', 'locks', 'x.lock'), '{"pid":1}')
    fs.writeFileSync(path.join(dir, 'real.txt'), 'content\n')
    runGit(['add', '-A'], { cwd: dir })
    const staged = runGit(['diff', '--cached', '--name-only'], { cwd: dir })
    assert.ok(staged.includes('real.txt'), 'real content is still added')
    assert.ok(!staged.includes('.arxa'), 'no .arxa/ path is ever staged')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

ok('frame: flutter targets are driven by flutter, not dart (B16)', () => {
  const sh = projectCheckSh()
  assert.ok(sh.includes('sdk:[[:space:]]*flutter'), 'detects a flutter sdk dep')
  assert.ok(sh.includes('run=flutter') && sh.includes('run=dart'), 'picks the runner per target')
  assert.ok(!/\bdart analyze\b/.test(sh), 'never hardcodes dart for a possibly-flutter target')
})

ok('frame: writeFrameFiles writes executable check.sh + template, never clobbers', () => {
  const d = path.join(tmp, 'frame-org')
  fs.mkdirSync(d, { recursive: true })
  const r1 = writeFrameFiles(d, 'org')
  assert.deepEqual(r1.written.sort(), ['.github/pull_request_template.md', 'check.sh'])
  assert.equal((fs.statSync(path.join(d, 'check.sh')).mode & 0o111) !== 0, true, 'executable bit')
  fs.writeFileSync(path.join(d, 'check.sh'), '# user-owned\n')
  const r2 = writeFrameFiles(d, 'org', { includeCiYml: true })
  assert.deepEqual(r2.kept, ['check.sh', '.github/pull_request_template.md'])
  assert.equal(fs.readFileSync(path.join(d, 'check.sh'), 'utf8'), '# user-owned\n', 'user edit survives')
  assert.ok(fs.existsSync(path.join(d, '.github', 'workflows', 'ci.yml')), 'ci.yml only with includeCiYml')
})

ok('frame: org check.sh is green by absence, red on real rot (Q4)', () => {
  const d = path.join(tmp, 'frame-check-org')
  for (const dock of ['projects', 'notes', 'meetings', 'account', 'communications']) {
    fs.mkdirSync(path.join(d, dock), { recursive: true })
    fs.writeFileSync(path.join(d, dock, '.gitkeep'), '')
  }
  fs.writeFileSync(path.join(d, 'org.json'), '{"name":"t","templateVersion":"v1"}')
  writeFrameFiles(d, 'org')
  runGit(['init', '-b', 'main'], { cwd: d })
  runGit(['add', '-A'], { cwd: d })
  runGit(['commit', '-m', 'chore(org): scaffold the organisation tree'], { cwd: d })
  const sh = () => {
    try {
      execFileSync('sh', ['check.sh'], { cwd: d, stdio: ['ignore', 'pipe', 'pipe'] })
      return 0
    } catch (err) { return err.status ?? 1 }
  }
  assert.equal(sh(), 0, 'green by absence on a fresh scaffold')
  // bad subject
  fs.writeFileSync(path.join(d, 'notes', 'a.md'), 'x')
  runGit(['add', '-A'], { cwd: d })
  runGit(['commit', '-m', 'nope not conventional'], { cwd: d })
  assert.notEqual(sh(), 0, 'bad subject goes red')
  runGit(['reset', '--hard', 'HEAD~1'], { cwd: d })
  // WIP tier is exempt (committer identity)
  fs.writeFileSync(path.join(d, 'notes', 'b.md'), 'y')
  runGit(['add', '-A'], { cwd: d })
  runGit(['commit', '-m', 'wip: auto-save'], { cwd: d, identity: WIP_IDENTITY })
  assert.equal(sh(), 0, 'wip tier never trips the subject check')
  // top-level violation
  fs.mkdirSync(path.join(d, 'random-stuff'))
  assert.notEqual(sh(), 0, 'unexpected top-level directory goes red')
  fs.rmSync(path.join(d, 'random-stuff'), { recursive: true })
  // Stage naming, at the level that actually has stages.
  // B19: the org gate used to walk INTO projects/, which are nested separate
  // repos holding the user's application. It failed on things like
  // android/.gradle/9.1.0 — a Gradle cache, not a stage. Each repo now
  // polices its own stages: the org walks its own docks, the project walks
  // its own depth-1 stages.
  fs.mkdirSync(path.join(d, 'notes', '01-good'))
  assert.equal(sh(), 0, 'NN-kebab accepted in the org tree')
  fs.mkdirSync(path.join(d, 'notes', '1bad'))
  assert.notEqual(sh(), 0, 'non-NN folder in the ORG tree goes red')
  fs.rmSync(path.join(d, 'notes', '1bad'), { recursive: true })
  // A project slug is not a stage, and lives in another repo entirely.
  fs.mkdirSync(path.join(d, 'projects', '2024-rebrand', '05-scaffold'), { recursive: true })
  assert.equal(sh(), 0, 'the org gate does not judge names inside project repos')
  // Deep application content that merely starts with a digit must be fine.
  fs.mkdirSync(path.join(d, 'projects', 'p1', '05-scaffold', 'application', 'ios', 'android', '.gradle', '9.1.0'), { recursive: true })
  assert.equal(sh(), 0, 'a Gradle cache directory is not a malformed stage (B19)')
})

ok('sessions: a deleted worktree is `missing`, never silently clean (B1)', () => {
  const d = path.join(tmp, 'b1-health')
  fs.mkdirSync(d, { recursive: true })
  execFileSync('git', ['init', '-q', '-b', 'main', '.'], { cwd: d })
  fs.writeFileSync(path.join(d, 'a.txt'), 'hi\n')
  execFileSync('git', ['add', '-A'], { cwd: d })
  execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'feat: init'], { cwd: d })

  const s = openSession(d, { id: 'probe1', name: 'probe' })
  assert.equal(worktreeHealth(s.worktree), 'ok', 'a live worktree is ok')

  fs.rmSync(s.worktree, { recursive: true, force: true })
  assert.equal(worktreeHealth(s.worktree), 'missing',
    'a deleted worktree must not read as clean — git returns null and `?? \'\'` used to make that "no changes"')
  assert.equal(worktreeHealth(''), 'missing', 'an empty path is not a healthy worktree')
  assert.equal(worktreeHealth('/nonexistent/xyz'), 'missing')
})

ok('repos: the detached snapshot worker commits the same subject as the sync path (B20)', () => {
  const src = fs.readFileSync(new URL('./lib/repos.js', import.meta.url), 'utf8')
  // The ORG scaffold subject appears twice: once in the synchronous path
  // (which the tests exercise) and once inside the detached worker source
  // (which production actually runs). They diverged, the worker's was
  // `stage: scaffold organisation`, and no test could see it.
  const orgSubject = 'chore(org): scaffold the organisation tree'
  const hits = src.split(orgSubject).length - 1
  assert.equal(hits, 2, 'the sync path and the detached worker must commit the SAME org subject')
  assert.ok(SUBJECT_RE.test(orgSubject), "arxa's first commit must pass arxa's own gate")
  assert.ok(!/'stage: scaffold/.test(src), 'no stage:-prefixed scaffold subject may survive — the gate rejects it')
})

ok('frame: the org gate never walks into nested project repos (B19)', () => {
  const org = orgCheckSh()
  assert.match(org, /-name projects -prune/,
    'projects/ are separate repos (D37) whose content is the user\'s app — a Gradle cache dir like 9.1.0 must not read as a malformed stage')
  // The project gate owns its own stages, and only at depth 1.
  const proj = projectCheckSh()
  assert.match(proj, /-mindepth 1 -maxdepth 1 -type d ! -name \.git/,
    'a project checks its own stage names, at depth 1 only')
  assert.match(proj, /stage folder not NN-kebab/)
})

ok('frame: every subject arxa itself commits passes its own gate (B17/B18)', () => {
  // arxa writing a commit its own gate rejects is the worst kind of red: the
  // user did not write it and cannot amend it.
  for (const subject of [
    'chore(migrate): org format migration v3→v4 (pre)',
    'chore(migrate): org format migration v3→v4 (post)',
    'chore(migrate): stage folders to template v3 (stage order, 2-digit prefixes) + .gitkeep',
    'chore(migrate): track/target vocabulary (template v4)',
    'chore(ci): wire the arxa frame (checks, workflow, PR template)',
    'chore(org): scaffold the organisation tree',
    'chore(project): scaffold the project tree',
    `chore(ci): refresh the arxa frame to v${FRAME_VERSION}`,
  ]) {
    assert.ok(SUBJECT_RE.test(subject), `arxa commits this and its own gate rejects it: ${subject}`)
  }
  // The two prefixes that are MEANT to fail — they never reach main.
  assert.equal(SUBJECT_RE.test('wip: auto-save'), false, 'wip tier is squashed away, never merged')
  assert.equal(SUBJECT_RE.test('stage: anything'), false, 'bare stage: is not a conventional type')
})

ok('frame: generated files carry a version stamp after the shebang', () => {
  const sh = stampContent(projectCheckSh())
  const lines = sh.split('\n')
  assert.equal(lines[0], '#!/bin/sh', 'shebang stays first or the file stops being executable')
  assert.match(lines[1], /^# arxa-frame: v\d+ [0-9a-f]{16}$/, 'stamp is line 2')
  assert.equal(readStamp(sh).version, FRAME_VERSION)
})

ok('frame: an existing repo can be upgraded, and a hand-edit is never clobbered', () => {
  const d = path.join(tmp, 'frame-upgrade')
  fs.mkdirSync(d, { recursive: true })
  const abs = path.join(d, 'check.sh')

  writeFrameFiles(d, 'project')
  assert.equal(frameFileState(abs), 'current', 'a fresh write is current')
  assert.deepEqual(writeFrameFiles(d, 'project').upgraded, [], 'default never rewrites')

  // A repo created before stamping existed.
  fs.writeFileSync(abs, '#!/bin/sh\necho legacy\n')
  assert.equal(frameFileState(abs), 'unversioned', 'pre-v2 files are detectable')
  assert.deepEqual(writeFrameFiles(d, 'project').upgraded, [], 'still no silent rewrite')
  assert.deepEqual(writeFrameFiles(d, 'project', { upgrade: true }).upgraded, ['check.sh'], 'upgrade reaches it')
  assert.equal(frameFileState(abs), 'current')

  // A human edited the generated file: that is data, not drift.
  fs.appendFileSync(abs, '\n# local tweak\n')
  assert.equal(frameFileState(abs), 'modified')
  const r = writeFrameFiles(d, 'project', { upgrade: true })
  assert.deepEqual(r.conflicted, ['check.sh'], 'an edited file conflicts instead of being overwritten')
  assert.deepEqual(r.upgraded, [])
  assert.ok(fs.readFileSync(abs, 'utf8').includes('# local tweak'), 'the edit survived')
  assert.deepEqual(writeFrameFiles(d, 'project', { upgrade: true, force: true }).upgraded, ['check.sh'], 'force is the only way past')
})

ok('frame: frameStatus reports per-file state without writing', () => {
  const d = path.join(tmp, 'frame-status')
  fs.mkdirSync(d, { recursive: true })
  assert.deepEqual(frameStatus(d, 'project'), { 'check.sh': 'missing' })
  writeFrameFiles(d, 'project', { includeCiYml: true })
  assert.deepEqual(frameStatus(d, 'project', { includeCiYml: true }),
    { 'check.sh': 'current', '.github/workflows/ci.yml': 'current' })
  assert.ok(!('.github/pull_request_template.md' in frameStatus(d, 'project')), 'prose is never version-judged')
})

ok('frame: project check.sh probes stacks only when present (Q4)', () => {
  const d = path.join(tmp, 'frame-check-proj')
  fs.mkdirSync(d, { recursive: true })
  writeFrameFiles(d, 'project')
  const body = fs.readFileSync(path.join(d, 'check.sh'), 'utf8')
  assert.ok(body.includes('package.json') && body.includes('pubspec.yaml') && body.includes('Cargo.toml') && body.includes('pyproject.toml'), 'stack probes present')
  // dart/flutter is chosen per target (B16), so its guard is `command -v "$run"`.
  assert.ok(body.includes('command -v npm') && body.includes('command -v "$run"') && body.includes('command -v cargo') && body.includes('command -v python3'), 'tool-presence guards')
  assert.ok(prTemplate().includes('## Problem') && prTemplate().includes('arxa studio'), 'PR template shape')
})


// ---- 7. WIP watcher (Part B S2, Q9) ----------------------------------------
{
  const d = path.join(tmp, 'watch-unit')
  fs.mkdirSync(path.join(d, 'notes'), { recursive: true })
  const fired = []
  const w = createWipWatcher({ paths: [d], debounceMs: 120, onQuiet: (p) => fired.push(p) })
  await new Promise((r) => setTimeout(r, 60))
  fs.writeFileSync(path.join(d, 'notes', 'x.md'), 'x')
  await new Promise((r) => setTimeout(r, 400))
  assert.equal(fired.length >= 1, true, 'onQuiet fired after the write')
  assert.equal(fired[0], d)
  passed++; console.log('ok ' + passed + ' - watcher: fires onQuiet after debounce')
  const before = fired.length
  fs.mkdirSync(path.join(d, '.git'), { recursive: true })
  fs.writeFileSync(path.join(d, '.git', 'index'), 'noise')
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(fired.length, before, '.git writes never fire the watcher')
  w.stop()
  fs.writeFileSync(path.join(d, 'notes', 'y.md'), 'y')
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(fired.length, before, 'stopped watcher stays silent')
  passed++; console.log('ok ' + passed + ' - watcher: ignores .git, silent after stop')
  const d2 = path.join(tmp, 'watch-unit-2')
  fs.mkdirSync(d2, { recursive: true })
  w.setPaths([d2])
  assert.deepEqual(w.paths(), [d2])
  fs.writeFileSync(path.join(d2, 'z.md'), 'z')
  await new Promise((r) => setTimeout(r, 400))
  assert.equal(fired[fired.length - 1], d2, 'new path watched after setPaths')
  w.stop()
  passed++; console.log('ok ' + passed + ' - watcher: setPaths swaps the watched set')
}


// ---- D95/D96 sync primitives (2026-09-01 grill) ---------------------------
{
  const syncTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-sync-selftest-'))
  try {
    const senv = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    const git = (cwd, args) => runGit(args, { cwd, env: senv })
    const commit = (cwd, msg) => runGit(['-c', 'user.email=t@arxa', '-c', 'user.name=t', 'commit', '-m', msg], { cwd, env: senv })
    const work = path.join(syncTmp, 'work')
    fs.mkdirSync(work, { recursive: true })
    git(work, ['init', '-b', 'main'])
    fs.writeFileSync(path.join(work, 'a.md'), 'a')
    git(work, ['add', '.'])
    commit(work, 'one')
    const bare = path.join(syncTmp, 'remote.git')
    git(syncTmp, ['clone', '--bare', work, bare])
    pushRepo(work, bare)
    let st = mainSyncState(work)
    ok('sync: in-sync after push (0/0)', () => {
      assert.equal(st.behind, 0)
      assert.equal(st.ahead, 0)
    })
    const other = path.join(syncTmp, 'other')
    git(syncTmp, ['clone', bare, other])
    fs.writeFileSync(path.join(other, 'b.md'), 'b')
    git(other, ['add', '.'])
    commit(other, 'two')
    git(other, ['push', 'origin', 'main'])
    ok('sync: tracking ref stale before fetch', () => assert.equal(mainSyncState(work).behind, 0))
    ok('sync: fetchRepo succeeds against local bare', () => assert.equal(fetchRepo(work, bare), true))
    st = mainSyncState(work)
    ok('sync: behind by one after fetch', () => assert.equal(st.behind, 1))
    ok('sync: ffMergeMain advances main', () => assert.equal(ffMergeMain(work), true))
    ok('sync: pulled content materialised', () => assert.equal(fs.existsSync(path.join(work, 'b.md')), true))
    ok('sync: caught up', () => assert.equal(mainSyncState(work).behind, 0))
    fs.writeFileSync(path.join(work, 'c.md'), 'c')
    git(work, ['add', '.'])
    commit(work, 'three-local')
    fs.writeFileSync(path.join(other, 'd.md'), 'd')
    git(other, ['add', '.'])
    commit(other, 'three-remote')
    git(other, ['push', 'origin', 'main'])
    fetchRepo(work, bare)
    st = mainSyncState(work)
    ok('sync: divergence detected', () => assert.equal(st.diverged, true))
    ok('sync: ffMergeMain refuses diverged history (D96: park, never merge)', () => assert.equal(ffMergeMain(work), false))
  } finally {
    fs.rmSync(syncTmp, { recursive: true, force: true })
  }
}

// ---- Q2 (2026-09-03): readable session ids --------------------------------
// `<org>/<workspace>/<word>-wt-<YYMMDD>-<NNN>`. The id IS the worktree dir
// (under the org root) and the branch suffix (after `arxa/`), so these cases
// guard a path/branch component, not a label. nextSessionId (bare-leaf mint)
// is gone — mintSessionPath mints the full identity path (Q2/Q4/Q5 grill).
{
  const D = (y, m, d) => new Date(y, m - 1, d)
  const row = (id) => ({ id })

  ok('id: first of the day is -001, word de-pluralised from the workspace folder', () =>
    assert.equal(
      mintSessionPath({ org: 'RESTO', workspace: 'notes', sessions: [], now: D(2026, 9, 3) }),
      'RESTO/notes/note-wt-260903-001',
    ))

  ok('id: counter advances within the same org/workspace on the same day', () =>
    assert.equal(
      mintSessionPath({
        org: 'RESTO', workspace: 'notes',
        sessions: [row('RESTO/notes/note-wt-260903-001'), row('RESTO/notes/note-wt-260903-002')],
        now: D(2026, 9, 3),
      }),
      'RESTO/notes/note-wt-260903-003',
    ))

  ok('id: a different day restarts the counter', () =>
    assert.equal(
      mintSessionPath({ org: 'RESTO', workspace: 'notes', sessions: [row('RESTO/notes/note-wt-260903-001')], now: D(2026, 9, 4) }),
      'RESTO/notes/note-wt-260904-001',
    ))

  ok('id: a different workspace does not inherit another folder`s count', () =>
    assert.equal(
      mintSessionPath({
        org: 'RESTO', workspace: 'notes',
        sessions: [row('RESTO/emails/email-wt-260903-001'), row('RESTO/emails/email-wt-260903-002')],
        now: D(2026, 9, 3),
      }),
      'RESTO/notes/note-wt-260903-001',
    ))

  // The counter counts per org/workspace/day ACROSS WORDS (docstring, Q2/Q4):
  // a differently-named session minted into the same dir still advances the
  // same counter, it is not scoped per word. This replaces the old
  // "an id taken by another workspace is skipped" case: that guarded a single
  // flat/global id namespace, which path-qualified ids no longer have — a
  // workspace's ids can never collide with another workspace's, the path
  // itself disambiguates, so cross-workspace skipping is not a thing anymore.
  ok('id: the day counter is shared across different names in the same org/workspace, not scoped per word', () =>
    assert.equal(
      mintSessionPath({
        org: 'RESTO', workspace: 'notes', name: 'Kickoff',
        sessions: [row('RESTO/notes/note-wt-260903-001')],
        now: D(2026, 9, 3),
      }),
      'RESTO/notes/kickoff-wt-260903-002',
    ))

  // The invariant the old "an id taken by another workspace is skipped"
  // test actually guarded: dsh has ONE store for the whole app, so two
  // sessions that would reduce to the same dsh key can never collide. Flat
  // leaf ids needed a skip loop to enforce this (alpha/notes and beta/notes
  // could both mint 'note-wt-260903-001'). Path-qualified ids make the skip
  // loop unnecessary — the org+workspace prefix disambiguates on its own.
  ok('id: same leaf minted in two different workspaces still gets distinct dsh keys (dsh has ONE store)', () => {
    const a = mintSessionPath({ org: 'RESTO', workspace: 'projects/alpha/notes', sessions: [], now: D(2026, 9, 3) })
    const b = mintSessionPath({ org: 'RESTO', workspace: 'projects/beta/notes', sessions: [], now: D(2026, 9, 3) })
    assert.equal(sessionLeaf(a), sessionLeaf(b), 'same leaf — the old flat id would have collided here')
    assert.notEqual(dshSessionKey(a), dshSessionKey(b), 'the path disambiguates, which is why the skip loop is gone')
  })

  ok('id: a same-day id freed by a drop is not reused (registry is the authority)', () =>
    assert.equal(
      mintSessionPath({ org: 'RESTO', workspace: 'notes', sessions: [row('RESTO/notes/note-wt-260903-002')], now: D(2026, 9, 3) }),
      'RESTO/notes/note-wt-260903-003',
    ))

  // The old nextSessionName counter never advanced for digit-leading folders
  // (its prefix regex demanded a leading letter). mintSessionPath matches the
  // full base verbatim, so these count correctly.
  ok('id: a digit-leading container counts (the old prefix-regex bug is gone)', () =>
    assert.equal(
      mintSessionPath({
        org: 'RESTO', workspace: 'projects/rocket/01-intake',
        sessions: [row('RESTO/projects/rocket/01-intake/01-intake-wt-260903-001')],
        now: D(2026, 9, 3),
      }),
      'RESTO/projects/rocket/01-intake/01-intake-wt-260903-002',
    ))

  // Org and workspace are now required inputs — the old bare-leaf mint
  // tolerated an empty workspace with a 'session' fallback; the app layer
  // must supply both now (the library never invents scope).
  ok('id: mintSessionPath throws when the org folder is missing', () =>
    assert.throws(() => mintSessionPath({ workspace: 'notes', sessions: [], now: D(2026, 9, 3) }), /org folder name is required/))

  ok('id: mintSessionPath throws when the workspace key is missing', () =>
    assert.throws(() => mintSessionPath({ org: 'RESTO', sessions: [], now: D(2026, 9, 3) }), /workspace key is required/))

  // openSession's guard — a minted id that fails this is a broken worktree
  // path and an unpushable branch name. assertSessionIdShape IS that guard
  // now (every segment checked, not one flat token).
  ok('id: every minted id satisfies openSession`s branch/path guard (assertSessionIdShape)', () => {
    for (const ws of ['notes', 'emails', 'projects/rocket/01-intake', 'projects/alpha/design']) {
      const id = mintSessionPath({ org: 'RESTO', workspace: ws, sessions: [], now: D(2026, 9, 3) })
      assert.equal(assertSessionIdShape(id), id, `${ws} -> ${id}`)
    }
  })

  ok('id: zero-padding survives past 999 without truncating', () => {
    const sessions = [row('RESTO/notes/note-wt-260903-999')]
    assert.equal(
      mintSessionPath({ org: 'RESTO', workspace: 'notes', sessions, now: D(2026, 9, 3) }),
      'RESTO/notes/note-wt-260903-1000',
    )
  })

  // New surfaces the rename introduced: the leaf (sidebar/dsh header label,
  // Q9) and the dsh conversation key (Q3: '/' -> '-', org segment leading for
  // cross-org uniqueness).
  ok('id: sessionLeaf returns the last path segment', () =>
    assert.equal(sessionLeaf('RESTO/notes/note-wt-260903-001'), 'note-wt-260903-001'))

  ok('id: dshSessionKey flattens the path with the org leading, arxa- prefixed', () =>
    assert.equal(dshSessionKey('RESTO/notes/note-wt-260903-001'), 'arxa-RESTO-notes-note-wt-260903-001'))

  // openSession: id is required (Q8) — the app layer mints via mintSessionPath,
  // never the library. This is the contract behind the id-required failures
  // this whole rename exists to fix.
  ok('id: openSession throws id-required when no id is given', () => {
    assert.throws(() => openSession(projectPath, { name: 'no id given' }), TypeError)
    assert.throws(() => openSession(projectPath, { name: 'no id given' }), /id-required/)
  })

  // When no explicit name is given, the session's display name defaults to
  // the LEAF of the id, not the whole path — the sidebar/dsh header label
  // must not show the org/workspace prefix.
  ok('id: session name defaults to the id`s leaf when no name is given', () => {
    const s = openSession(projectPath, { id: 'RESTO/notes/note-wt-260903-777' })
    assert.equal(s.name, 'note-wt-260903-777', 'name defaulted to the leaf, not the whole path')
  })

  // A multi-segment minted id nests the FULL path under `.arxa/worktrees` —
  // the worktree directory, the branch and the folder a human sees are the
  // same string end to end (Q2/Q5). Docstring example, verbatim.
  ok('id: a multi-segment minted id creates the full nested worktree directory tree', () => {
    const id = mintSessionPath({
      org: 'RESTO', workspace: 'projects/kitchen-project/06-build', name: 'Backoffice',
      sessions: [], now: D(2026, 9, 3),
    })
    assert.equal(id, 'RESTO/projects/kitchen-project/06-build/backoffice-wt-260903-001')
    const s = openSession(projectPath, { id, name: 'Backoffice' })
    assert.equal(s.branch, `arxa/${id}`)
    assert.equal(s.worktree, path.join(projectPath, '.arxa', 'worktrees', ...id.split('/')))
    assert.ok(fs.existsSync(s.worktree), 'leaf worktree directory was created')
    assert.ok(
      fs.existsSync(path.join(projectPath, '.arxa', 'worktrees', 'RESTO', 'projects', 'kitchen-project', '06-build')),
      'intermediate path segments were created too, not just the leaf',
    )
  })
}

console.log(`\nselftest: ${passed}/${passed} passed`)
