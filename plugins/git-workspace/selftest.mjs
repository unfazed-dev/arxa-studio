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
  isDirty, wipCommit, wipRun, stageBoundarySquash, stageLog,
  mintAtStageBoundary, versionChip, readVersions,
  SessionMergeError, GATE_CHECK_SCRIPT,
  openSession, sessionStageBoundary, archiveSession, reviveSession,
  listSessions, archivedSessionIds,
  getOrigin, setOrigin, rekeySessionsProject,
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
  const res = stageBoundarySquash(projectPath, { message: 'first draft complete' })
  assert.equal(res.squashed, true)
  const log = stageLog(projectPath)
  assert.equal(log.length, before - 3 + 1, 'WIP run did not collapse to one commit')
  assert.ok(log.every((c) => c.subject.startsWith('stage:')), 'WIP commit survived in history')
  assert.equal(log[0].subject, 'stage: first draft complete')
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
  assert.ok(log.every((c) => c.subject.startsWith('stage:')))
  assert.equal(log[0].subject, 'stage: Second draft (v1)')
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
  assert.ok(subjects.every((s) => s.startsWith('stage:')), `non-stage commit on main: ${subjects}`)
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
console.log(`\nselftest: ${passed}/${passed} passed`)
