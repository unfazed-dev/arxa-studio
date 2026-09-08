#!/usr/bin/env node
// Selftest for Phase 3 session lifecycle helpers (D108, D104 as revised by
// D107): plugins/git-workspace/lib/finish.js. Covers:
//  1. merged session (via sessionStageBoundary, which under D107 already
//     produces real ancestry — ff-only or --no-ff) → finishSession
//     succeeds and leaves no worktree/branch/base-ref behind
//  2. unmerged (parked, gate red) session → finishSession refuses with a
//     typed FinishRefusedError, reason 'not-merged', and changes nothing
//     (worktree, branch, registry bytes all unchanged)
//  3. behindMain is correct, including after extra commits land on main
//  4. branchTip matches the branch's own HEAD
//  5. sweepMerged: dryRun previews without touching anything; non-dry run
//     finishes only the merged branches
//  6. pressure: 30 sessions, 15 merged, sweepMerged finishes exactly 15
//     in under 5s
//
// Runs against a throwaway repo under a temp dir; isolated HOME-free git
// via run.js — nothing machine-global is touched.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runGit } from './lib/run.js'
import { initProjectRepo } from './lib/repos.js'
import {
  openSession, sessionStageBoundary, archiveSession, annotateSession, listSessions,
  SESSION_BASE_PREFIX, GATE_CHECK_SCRIPT,
} from './lib/sessions.js'
import { behindMain, branchTip, isMergedIntoMain, finishSession, sweepMerged, FinishRefusedError } from './lib/finish.js'

let passed = 0
function ok(label, fn) {
  fn()
  passed += 1
  console.log(`ok ${passed} - ${label}`)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-git-finish-selftest-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

const proj = path.join(tmp, 'project')
fs.mkdirSync(proj, { recursive: true })
fs.writeFileSync(path.join(proj, 'README.md'), '# project\n')
initProjectRepo(proj)

function registryBytes() {
  const commonDir = runGit(['rev-parse', '--git-common-dir'], { cwd: proj })
  const p = path.join(path.resolve(proj, commonDir), 'arxa', 'sessions.json')
  return fs.existsSync(p) ? fs.readFileSync(p) : null
}

// ---- 1. merged session: finishSession succeeds, cleans up fully -----------

ok('finishSession on a merged session removes worktree, branch and base ref', () => {
  const s = openSession(proj, { id: 'done1', name: 'Done one' })
  fs.writeFileSync(path.join(s.worktree, 'x.txt'), 'work\n')
  const res = sessionStageBoundary(proj, 'done1')
  assert.equal(res.merged, true)
  assert.equal(isMergedIntoMain(proj, s.branch), true)
  const baseRef = `${SESSION_BASE_PREFIX}done1`
  assert.ok(runGit(['show-ref', '--verify', '--quiet', baseRef], { cwd: proj, allowFail: true }) !== null)

  const fin = finishSession(proj, 'done1')
  assert.equal(fin.finished, true)
  assert.equal(fin.branchDeleted, true)
  assert.equal(fin.baseRefDeleted, true)
  assert.ok(!fs.existsSync(s.worktree), 'worktree still on disk')
  assert.equal(runGit(['branch', '--list', s.branch], { cwd: proj }), '', 'branch survived finish')
  assert.equal(runGit(['show-ref', '--verify', '--quiet', baseRef], { cwd: proj, allowFail: true }), null, 'base ref survived finish')

  const row = listSessions(proj).find((r) => r.id === 'done1')
  assert.ok(row && typeof row.finishedAt === 'number', 'finishedAt not stamped on the finished session row')
})

// ---- 1b. dirty worktree at finish time: refuses, changes nothing ----------

ok('finishSession on a merged session with an unexpectedly dirty worktree refuses and changes nothing', () => {
  const s = openSession(proj, { id: 'dirty1', name: 'Dirty one' })
  fs.writeFileSync(path.join(s.worktree, 'x.txt'), 'work\n')
  const res = sessionStageBoundary(proj, 'dirty1')
  assert.equal(res.merged, true)

  // Something writes into the worktree AFTER the merge landed — the
  // ancestry check still passes, but archiving now would WIP-commit past
  // what was actually verified.
  fs.writeFileSync(path.join(s.worktree, 'late.txt'), 'unreviewed\n')

  const beforeBytes = registryBytes()
  const worktreeBefore = fs.existsSync(s.worktree)
  const branchBefore = runGit(['branch', '--list', s.branch], { cwd: proj })

  assert.throws(() => finishSession(proj, 'dirty1'), FinishRefusedError)
  try {
    finishSession(proj, 'dirty1')
  } catch (err) {
    assert.equal(err.reason, 'worktree-dirty')
  }

  assert.equal(fs.existsSync(s.worktree), worktreeBefore, 'worktree presence changed')
  assert.equal(runGit(['branch', '--list', s.branch], { cwd: proj }), branchBefore, 'branch changed')
  assert.deepEqual(registryBytes(), beforeBytes, 'registry bytes changed on a dirty-worktree refusal')

  const dry = finishSession(proj, 'dirty1', { dryRun: true })
  assert.equal(dry.finished, false)
  assert.equal(dry.reason, 'worktree-dirty')

  // Clean it up (the stray file was never committed — just delete it, no
  // new commit, so the branch tip stays exactly what was verified merged).
  fs.rmSync(path.join(s.worktree, 'late.txt'))
  const cleaned = finishSession(proj, 'dirty1')
  assert.equal(cleaned.finished, true)
})

// ---- 2. unmerged session: refuses, changes nothing -------------------------

ok('finishSession on an unmerged (parked) session refuses and changes nothing', () => {
  const s = openSession(proj, { id: 'red1', name: 'Red one' })
  fs.writeFileSync(path.join(s.worktree, GATE_CHECK_SCRIPT), 'exit 1\n')
  fs.writeFileSync(path.join(s.worktree, 'risky.txt'), 'unreviewed\n')
  const res = sessionStageBoundary(proj, 'red1')
  assert.equal(res.merged, false)
  assert.equal(isMergedIntoMain(proj, s.branch), false)

  const beforeBytes = registryBytes()
  const worktreeBefore = fs.existsSync(s.worktree)
  const branchBefore = runGit(['branch', '--list', s.branch], { cwd: proj })

  assert.throws(() => finishSession(proj, 'red1'), FinishRefusedError)
  try {
    finishSession(proj, 'red1')
  } catch (err) {
    assert.equal(err.reason, 'not-merged')
  }

  assert.equal(fs.existsSync(s.worktree), worktreeBefore, 'worktree presence changed')
  assert.equal(runGit(['branch', '--list', s.branch], { cwd: proj }), branchBefore, 'branch changed')
  assert.deepEqual(registryBytes(), beforeBytes, 'registry bytes changed on a refused finish')

  const dry = finishSession(proj, 'red1', { dryRun: true })
  assert.equal(dry.finished, false)
  assert.equal(dry.reason, 'not-merged')
  assert.equal(fs.existsSync(s.worktree), worktreeBefore, 'dry run touched the worktree')
})

// ---- 3. behindMain --------------------------------------------------------

ok('behindMain counts commits main has that the branch lacks', () => {
  const s = openSession(proj, { id: 'behind1', name: 'Behind one' })
  assert.equal(behindMain(proj, s.branch), 0)
  fs.writeFileSync(path.join(proj, 'main-only.txt'), 'a\n')
  runGit(['add', '-A'], { cwd: proj })
  runGit(['commit', '-m', 'chore: main-only a'], { cwd: proj })
  assert.equal(behindMain(proj, s.branch), 1)
  fs.writeFileSync(path.join(proj, 'main-only-2.txt'), 'b\n')
  runGit(['add', '-A'], { cwd: proj })
  runGit(['commit', '-m', 'chore: main-only b'], { cwd: proj })
  assert.equal(behindMain(proj, s.branch), 2)
  archiveSession(proj, 'behind1')
})

// ---- 4. branchTip ----------------------------------------------------------

ok('branchTip matches the branch\'s own HEAD sha + subject', () => {
  const s = openSession(proj, { id: 'tip1', name: 'Tip one' })
  fs.writeFileSync(path.join(s.worktree, 'y.txt'), 'edit\n')
  runGit(['add', '-A'], { cwd: s.worktree })
  runGit(['commit', '-m', 'feat: tip commit'], { cwd: s.worktree })
  const expectedSha = runGit(['rev-parse', s.branch], { cwd: proj })
  const tip = branchTip(proj, s.branch)
  assert.equal(tip.sha, expectedSha)
  assert.equal(tip.subject, 'feat: tip commit')
  archiveSession(proj, 'tip1')
})

// ---- 5. sweepMerged: dryRun previews, non-dry finishes only merged --------

ok('sweepMerged dryRun lists candidates without touching anything', () => {
  const a = openSession(proj, { id: 'sweep-a' })
  fs.writeFileSync(path.join(a.worktree, 'sa.txt'), 'a\n')
  assert.equal(sessionStageBoundary(proj, 'sweep-a').merged, true)

  const b = openSession(proj, { id: 'sweep-b' })
  fs.writeFileSync(path.join(b.worktree, GATE_CHECK_SCRIPT), 'exit 1\n')
  fs.writeFileSync(path.join(b.worktree, 'sb.txt'), 'b\n')
  assert.equal(sessionStageBoundary(proj, 'sweep-b').merged, false)

  const preview = sweepMerged(proj, { dryRun: true })
  assert.ok(preview.finished.some((r) => r.id === 'sweep-a'))
  assert.ok(preview.skipped.some((r) => r.id === 'sweep-b'))
  assert.ok(fs.existsSync(a.worktree), 'dry run removed a worktree')
  assert.ok(runGit(['branch', '--list', a.branch], { cwd: proj }) !== '', 'dry run deleted a branch')

  const real = sweepMerged(proj, { dryRun: false })
  assert.ok(real.finished.some((r) => r.id === 'sweep-a' && r.finished === true))
  assert.ok(real.skipped.some((r) => r.id === 'sweep-b'))
  assert.equal(runGit(['branch', '--list', a.branch], { cwd: proj }), '', 'real sweep left a merged branch behind')
  assert.ok(runGit(['branch', '--list', b.branch], { cwd: proj }) !== '', 'real sweep deleted an unmerged branch')

  // Re-sweep: sweep-a is already finished (branch gone) — it must NOT come
  // back as 'not-merged' forever. sweep-b is still legitimately unmerged.
  const again = sweepMerged(proj, { dryRun: false })
  const aRow = again.skipped.find((r) => r.id === 'sweep-a')
  assert.ok(aRow, 'already-finished session vanished from skipped entirely')
  assert.equal(aRow.reason, 'already-finished', 'already-finished session misreported as not-merged')
  const bRow = again.skipped.find((r) => r.id === 'sweep-b')
  // 'parked', not 'not-merged': the parked guard runs first now. sweep-b is
  // both, and D40 (parked is never deleted) is the stronger reason to say.
  assert.equal(bRow.reason, 'parked')

  archiveSession(proj, 'sweep-b')
})

// The case the guard actually exists for. sweep-b above is parked AND unmerged,
// so the merged filter alone would have covered it — which is exactly why the
// guard's absence went unnoticed. A session that is parked while its branch IS
// merged (park after a green land) was swept by the old code, deleting the
// branch D40 promises to keep.
ok('sweepMerged never sweeps a parked session, even one whose branch is merged', () => {
  const p = openSession(proj, { id: 'sweep-parked-merged' })
  fs.writeFileSync(path.join(p.worktree, 'spm.txt'), 'x\n')
  assert.equal(sessionStageBoundary(proj, 'sweep-parked-merged').merged, true, 'setup: branch must be merged')
  annotateSession(proj, 'sweep-parked-merged', { state: 'parked' })

  const out = sweepMerged(proj, { dryRun: false })
  assert.ok(!out.finished.some((r) => r.id === 'sweep-parked-merged'), 'a parked session was swept')
  const row = out.skipped.find((r) => r.id === 'sweep-parked-merged')
  assert.equal(row && row.reason, 'parked')
  assert.ok(runGit(['branch', '--list', p.branch], { cwd: proj }) !== '', 'a parked session lost its branch')
})

// A preview for a destructive batch must never promise something the act will
// refuse. The old dryRun branch checked only "is the branch merged" and skipped
// finishSession's OTHER refusal (dirty worktree), so it did exactly that.
ok('sweepMerged dryRun refuses a dirty worktree, exactly as the real sweep would', () => {
  const d = openSession(proj, { id: 'sweep-dirty' })
  fs.writeFileSync(path.join(d.worktree, 'sd.txt'), 'x\n')
  assert.equal(sessionStageBoundary(proj, 'sweep-dirty').merged, true, 'setup: branch must be merged')
  fs.writeFileSync(path.join(d.worktree, 'left-behind.txt'), 'uncommitted\n')

  const preview = sweepMerged(proj, { dryRun: true })
  assert.ok(!preview.finished.some((r) => r.id === 'sweep-dirty'), 'preview promised a session the act would refuse')
  const row = preview.skipped.find((r) => r.id === 'sweep-dirty')
  assert.equal(row && row.reason, 'worktree-dirty')

  fs.rmSync(path.join(d.worktree, 'left-behind.txt'))
  archiveSession(proj, 'sweep-dirty')
})

// The staleness window: the WIP watcher can auto-commit a refused session clean
// between the preview and the confirm. `only` makes the preview a ceiling, so
// the act can be a subset of what was shown but never a superset.
ok('sweepMerged acts on nothing outside the previewed id list', () => {
  const a = openSession(proj, { id: 'sweep-only-a' })
  fs.writeFileSync(path.join(a.worktree, 'oa.txt'), 'a\n')
  assert.equal(sessionStageBoundary(proj, 'sweep-only-a').merged, true)
  const b = openSession(proj, { id: 'sweep-only-b' })
  fs.writeFileSync(path.join(b.worktree, 'ob.txt'), 'b\n')
  assert.equal(sessionStageBoundary(proj, 'sweep-only-b').merged, true)

  // Both are sweepable; the operator was only ever shown A.
  const preview = sweepMerged(proj, { dryRun: true })
  assert.ok(preview.finished.some((r) => r.id === 'sweep-only-a'))
  assert.ok(preview.finished.some((r) => r.id === 'sweep-only-b'), 'setup: B must also be sweepable')

  const out = sweepMerged(proj, { dryRun: false, only: ['sweep-only-a'] })
  assert.ok(out.finished.some((r) => r.id === 'sweep-only-a' && r.finished === true))
  assert.ok(!out.finished.some((r) => r.id === 'sweep-only-b'), 'swept a session that was never shown')
  assert.ok(!out.skipped.some((r) => r.id === 'sweep-only-b'), 'an unlisted session must be invisible, not reported')
  assert.ok(runGit(['branch', '--list', b.branch], { cwd: proj }) !== '', 'an unlisted session lost its branch')
  archiveSession(proj, 'sweep-only-b')
})

// A per-session refusal must not lose the successes before it. sweepMerged
// catches inside the loop rather than propagating — this is what proves it.
ok('a mid-batch refusal records, it does not abort the sweep', () => {
  const good = openSession(proj, { id: 'sweep-mix-good' })
  fs.writeFileSync(path.join(good.worktree, 'g.txt'), 'g\n')
  assert.equal(sessionStageBoundary(proj, 'sweep-mix-good').merged, true)
  const bad = openSession(proj, { id: 'sweep-mix-bad' })
  fs.writeFileSync(path.join(bad.worktree, 'b.txt'), 'b\n')
  assert.equal(sessionStageBoundary(proj, 'sweep-mix-bad').merged, true)
  fs.writeFileSync(path.join(bad.worktree, 'dirty.txt'), 'x\n')

  const out = sweepMerged(proj, { dryRun: false, only: ['sweep-mix-good', 'sweep-mix-bad'] })
  assert.ok(out.finished.some((r) => r.id === 'sweep-mix-good' && r.finished === true), 'a refusal swallowed an earlier success')
  assert.equal(out.skipped.find((r) => r.id === 'sweep-mix-bad')?.reason, 'worktree-dirty')
  fs.rmSync(path.join(bad.worktree, 'dirty.txt'))
  archiveSession(proj, 'sweep-mix-bad')
})

// ---- 6. pressure: 30 sessions, 15 merged, sweep < 5s -----------------------

ok('pressure: 30 sessions, 15 merged, sweepMerged finishes exactly 15 in under 5s', () => {
  const mergedIds = []
  const unmergedIds = []
  const branchById = {}
  for (let i = 0; i < 30; i++) {
    const id = `p${i}`
    const s = openSession(proj, { id })
    branchById[id] = s.branch
    fs.writeFileSync(path.join(s.worktree, 'p.txt'), `edit ${i}\n`)
    if (i % 2 === 0) {
      const res = sessionStageBoundary(proj, id)
      assert.equal(res.merged, true)
      mergedIds.push(id)
    } else {
      fs.writeFileSync(path.join(s.worktree, GATE_CHECK_SCRIPT), 'exit 1\n')
      const res = sessionStageBoundary(proj, id)
      assert.equal(res.merged, false)
      unmergedIds.push(id)
    }
  }
  assert.equal(mergedIds.length, 15)
  assert.equal(unmergedIds.length, 15)

  const t0 = Date.now()
  const res = sweepMerged(proj, { dryRun: false })
  const elapsed = Date.now() - t0
  // Wall-clock budget is only meaningful on an unloaded machine: 15 finishes
  // spawn ~100 git processes, and a saturated box (load > cores) stretched
  // this from 6.6s to 31s in the wave-1 CI run without any code change.
  // Under saturation the timing is logged, not asserted. Override the
  // budget with ARXA_PERF_BUDGET_MS when calibrating.
  const budget = Number(process.env.ARXA_PERF_BUDGET_MS || 5000)
  const saturated = os.loadavg()[0] > os.cpus().length
  if (saturated) console.log(`# perf: sweepMerged took ${elapsed}ms (load ${os.loadavg()[0].toFixed(1)} > ${os.cpus().length} cores, budget ${budget}ms not asserted)`)
  else assert.ok(elapsed < budget, `sweepMerged took ${elapsed}ms, wanted < ${budget}ms`)

  const finishedMerged = res.finished.filter((r) => mergedIds.includes(r.id))
  assert.equal(finishedMerged.length, 15)
  assert.ok(res.finished.every((r) => r.finished === true))
  for (const id of mergedIds) {
    const branch = branchById[id]
    assert.equal(runGit(['branch', '--list', branch], { cwd: proj }), '', `${branch} survived the sweep`)
  }
  for (const id of unmergedIds) {
    const branch = branchById[id]
    assert.ok(runGit(['branch', '--list', branch], { cwd: proj }) !== '', `${branch} was wrongly deleted`)
    archiveSession(proj, id)
  }
})

console.log(`# ${passed} passed`)
