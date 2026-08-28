#!/usr/bin/env node
// Selftest for arxa-git-workspace (phase 3). Covers:
//  1. probe: git present + git absent (disabled state, GitUnavailableError)
//  2. D37 nesting isolation: org repo commits never capture nested
//     project repo contents; account/ never enters git history
//  3. D18 commit wall + squash round-trip: WIP auto-commits accumulate,
//     stage-boundary squash produces ONE clean commit, second round trip
//  4. D20/D44 version chip: mint at stage boundary, chip has no SHAs
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

console.log(`\nselftest: ${passed}/${passed} passed`)
