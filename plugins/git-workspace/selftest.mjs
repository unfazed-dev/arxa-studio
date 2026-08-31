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
  SessionMergeError, GATE_CHECK_SCRIPT,
  openSession, sessionStageBoundary, archiveSession, reviveSession,
  listSessions, archivedSessionIds,
  getOrigin, setOrigin, rekeySessionsProject,
  pushRepo,
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
  assert.ok(log.every((c) => c.subject.startsWith('stage:') || SUBJECT_RE.test(c.subject)), 'non-conventional subject in history (Q7)')
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
  assert.ok(log.every((c) => c.subject.startsWith('stage:') || SUBJECT_RE.test(c.subject)), 'non-conventional subject in history (Q7)')
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
  assert.ok(runGit(['branch', '--list', 'arxa/session/red1'], { cwd: projectPath }) !== '')
})

ok('archive prunes worktree, keeps branch; revive continues from parked state (D39/D40)', () => {
  const parked = archiveSession(projectPath, 'red1')
  assert.equal(parked.state, 'archived')
  assert.ok(!fs.existsSync(path.join(projectPath, '.arxa', 'worktrees', 'red1')))
  assert.ok(runGit(['branch', '--list', 'arxa/session/red1'], { cwd: projectPath }) !== '',
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
  const tip = runGit(['rev-parse', 'arxa/session/race-b'], { cwd: projectPath })
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
  runGit(['branch', 'arxa/session/noise'], { cwd: src })
  const res = pushRepo(src, bare, process.env)
  assert.equal(res.ref, 'main', 'primary branch resolved (HEAD was main)')
  assert.ok(runGit(['rev-parse', '--verify', 'main'], { cwd: bare, allowFail: true }) !== null, 'main landed on the remote')
  assert.equal(runGit(['rev-parse', '--verify', 'refs/heads/arxa/session/noise'], { cwd: bare, allowFail: true }), null, 'session branches never publish')
  // HEAD on a session branch (session open) → falls back to main, still not the session branch
  runGit(['checkout', '-b', 'arxa/session/open'], { cwd: src })
  const res2 = pushRepo(src, bare, process.env)
  assert.equal(res2.ref, 'main', 'session-branch HEAD falls back to the primary branch')
  assert.throws(() => pushRepo(src, '', process.env), TypeError, 'empty url is a loud TypeError')
})


// ---- 6. CI frame (Part B S1: Q3/Q4/Q5/Q7/Q8) ------------------------------

import { SUBJECT_RE, FRAME_JOB, orgCheckSh, projectCheckSh, ciYml, prTemplate, protectionPayload, settingsPayload, writeFrameFiles } from './lib/frame.js'
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

ok('frame: protection + settings payloads (Q3/Q8)', () => {
  assert.deepEqual(protectionPayload().required_status_checks, { strict: true, checks: [{ context: FRAME_JOB }] })
  assert.equal(protectionPayload().enforce_admins, false, 'solo machine commits ride main (S0 V4)')
  assert.deepEqual(settingsPayload(), { allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false })
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
  // stage naming
  fs.mkdirSync(path.join(d, 'projects', '01-good'))
  assert.equal(sh(), 0, 'NN-kebab accepted')
  fs.mkdirSync(path.join(d, 'projects', '1bad'))
  assert.notEqual(sh(), 0, 'non-NN stage folder goes red')
})

ok('frame: project check.sh probes stacks only when present (Q4)', () => {
  const d = path.join(tmp, 'frame-check-proj')
  fs.mkdirSync(d, { recursive: true })
  writeFrameFiles(d, 'project')
  const body = fs.readFileSync(path.join(d, 'check.sh'), 'utf8')
  assert.ok(body.includes('package.json') && body.includes('pubspec.yaml') && body.includes('Cargo.toml') && body.includes('pyproject.toml'), 'stack probes present')
  assert.ok(body.includes('command -v npm') && body.includes('command -v dart') && body.includes('command -v cargo') && body.includes('command -v python3'), 'tool-presence guards')
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


console.log(`\nselftest: ${passed}/${passed} passed`)
