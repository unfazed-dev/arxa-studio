#!/usr/bin/env node
// Selftest for D101 commit-day streaks: plugins/git-workspace/lib/commits.js
// `commitDays`. Covers:
//  1. dated commits (3 consecutive days ending today, a gap, then 2 more)
//     bucket correctly, `current` and `longest` compute right
//  1b. `current` falls back to a streak ending yesterday when today has no
//      commits yet
//  2. cache identity: two calls within the TTL return the identical
//     (cached) value even after new commits land; clearCache forces a
//     recompute that picks the new commit up
//  3. an empty repo (no commits) reads as all-zeros, never throws
//
// Runs against a throwaway repo under a temp dir; isolated HOME-free git
// via run.js — nothing machine-global is touched. Repos are bare `git init`
// (NOT initProjectRepo, which stamps its own seed commit dated "now" and
// would contaminate today's bucket / the "today empty" fallback case).
// Commit dates are pinned via GIT_AUTHOR_DATE/GIT_COMMITTER_DATE so the
// test is deterministic regardless of when it runs.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runGit } from './lib/run.js'
import { commitDays, reviewedTip } from './lib/commits.js'
import { WIP_IDENTITY } from './lib/run.js'
import { initOrgRepo, wipCommit } from './lib/index.js'
import fsx from 'node:fs'
import osx from 'node:os'
import pathx from 'node:path'

let passed = 0
function ok(label, fn) {
  fn()
  passed += 1
  console.log(`ok ${passed} - ${label}`)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-git-commits-selftest-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

function ymd(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function dayOffset(delta) {
  const d = new Date()
  d.setDate(d.getDate() + delta)
  return ymd(d)
}

function freshRepo(dirName) {
  const proj = path.join(tmp, dirName)
  fs.mkdirSync(proj, { recursive: true })
  runGit(['init'], { cwd: proj })
  return proj
}

/** Commit with a pinned author/committer date (local noon, so the day
 *  bucket is unambiguous regardless of timezone offset from UTC). */
function commitOn(repoPath, dayYmd, message) {
  const iso = `${dayYmd}T12:00:00`
  const dateEnv = { GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso }
  fs.writeFileSync(path.join(repoPath, `${message.replace(/\W+/g, '-')}.txt`), `${message}\n`)
  runGit(['add', '-A'], { cwd: repoPath })
  runGit(['commit', '-m', message], { cwd: repoPath, env: { ...process.env, ...dateEnv } })
}

// ---- 1. buckets, current, longest ------------------------------------------

ok('commitDays buckets by day and computes current + longest streaks', () => {
  const proj = freshRepo('project-1')

  // 3 consecutive days ending today: day-2, day-1, today.
  commitOn(proj, dayOffset(-2), 'day-2 commit a')
  commitOn(proj, dayOffset(-2), 'day-2 commit b')
  commitOn(proj, dayOffset(-1), 'day-1 commit')
  commitOn(proj, dayOffset(0), 'today commit')
  // Gap: nothing on day -3, -4.
  // Then a separate, shorter run further back: 2 consecutive days.
  commitOn(proj, dayOffset(-6), 'day-6 commit')
  commitOn(proj, dayOffset(-5), 'day-5 commit')

  const result = commitDays(proj, { since: '90 days' })
  const byDay = Object.fromEntries(result.days.map((d) => [d.day, d.count]))
  assert.equal(byDay[dayOffset(-2)], 2)
  assert.equal(byDay[dayOffset(-1)], 1)
  assert.equal(byDay[dayOffset(0)], 1)
  assert.equal(byDay[dayOffset(-6)], 1)
  assert.equal(byDay[dayOffset(-5)], 1)
  assert.equal(byDay[dayOffset(-3)], undefined, 'gap day must not appear')

  // days ascending
  for (let i = 1; i < result.days.length; i++) {
    assert.ok(result.days[i - 1].day < result.days[i].day, 'days must be ascending')
  }

  // current: today, day-1, day-2 = 3 consecutive days ending today.
  assert.equal(result.current, 3)
  // longest: the same 3-day run is the longest in the window (the older
  // run is only 2 days).
  assert.equal(result.longest, 3)
})

// ---- 1b. current falls back to yesterday when today has no commits --------

ok('commitDays falls back to a streak ending yesterday when today is empty so far', () => {
  const proj = freshRepo('project-1b')

  commitOn(proj, dayOffset(-2), 'two days ago')
  commitOn(proj, dayOffset(-1), 'yesterday')
  // Nothing committed today.

  const result = commitDays(proj, { since: '90 days' })
  assert.equal(result.current, 2, 'streak ending yesterday counts even though today has no commits yet')
})

// ---- 2. cache identity + TTL + clearCache ----------------------------------

ok('commitDays caches per repo within the TTL; clearCache forces a recompute', () => {
  const proj = freshRepo('project-2')
  commitOn(proj, dayOffset(0), 'seed commit')

  const first = commitDays(proj, { since: '90 days' })
  assert.equal(first.current, 1)

  // A new commit lands, but within the TTL the cached value must still be
  // returned — same object identity, not just equal values.
  commitOn(proj, dayOffset(0), 'second same-day commit')
  const second = commitDays(proj, { since: '90 days' })
  assert.equal(second, first, 'cached call must return the identical cached object within the TTL')

  commitDays.clearCache()
  const third = commitDays(proj, { since: '90 days' })
  assert.notEqual(third, first, 'clearCache must force a fresh object')
  const byDay = Object.fromEntries(third.days.map((d) => [d.day, d.count]))
  assert.equal(byDay[dayOffset(0)], 2, 'recompute after clearCache picks up the new commit')
})

// ---- 3. empty repo: zeros, never throws ------------------------------------

ok('commitDays on a repo with no commits returns zeros and never throws', () => {
  const proj = freshRepo('project-empty')
  commitDays.clearCache()

  const result = commitDays(proj, { since: '90 days' })
  assert.deepEqual(result.days, [])
  assert.equal(result.current, 0)
  assert.equal(result.longest, 0)
})

// --- wipCommit must survive an embedded repo with no commits ---------------
// A user folder can contain a subfolder the user (or a tool) `git init`'d
// with zero commits yet. Git can't record a gitlink for a repo with no
// commits, so a plain `git add -A` aborts the WHOLE add — every other
// change in the tree must still land in the WIP commit.

ok('wipCommit commits the rest of the tree when it contains an embedded repo with no commits', () => {
  const proj = freshRepo('project-embedded-repo')
  fs.writeFileSync(path.join(proj, 'root.txt'), 'hello\n')
  runGit(['add', '-A'], { cwd: proj })
  runGit(['commit', '-m', 'seed'], { cwd: proj })

  const sub = path.join(proj, 'sub')
  fs.mkdirSync(sub)
  runGit(['init', '-b', 'main'], { cwd: sub }) // embedded repo, zero commits
  fs.writeFileSync(path.join(sub, 'file.txt'), 'content\n')
  fs.writeFileSync(path.join(proj, 'root2.txt'), 'unrelated change\n')

  const result = wipCommit(proj, { message: 'auto-save' })
  assert.equal(result.committed, true, 'wipCommit must succeed despite the embedded repo')
  assert.ok(result.sha)

  const tracked = runGit(['ls-files'], { cwd: proj }).split('\n')
  assert.ok(tracked.includes('root2.txt'), 'the unrelated file must still be committed')
  assert.ok(!tracked.some((f) => f.startsWith('sub/')), 'the embedded repo must not be tracked as plain files')
})

ok('wipCommit is a no-op, not a throw, when the embedded repo is the ONLY dirty thing', () => {
  const proj = freshRepo('project-embedded-repo-only')
  fs.writeFileSync(path.join(proj, 'root.txt'), 'hello\n')
  runGit(['add', '-A'], { cwd: proj })
  runGit(['commit', '-m', 'seed'], { cwd: proj })

  const sub = path.join(proj, 'sub')
  fs.mkdirSync(sub)
  runGit(['init', '-b', 'main'], { cwd: sub }) // embedded repo, zero commits
  fs.writeFileSync(path.join(sub, 'file.txt'), 'content\n')
  // No other change anywhere in the tree — addAll() stages nothing at all,
  // so `git commit` fails with "nothing added to commit". That must come
  // back as a no-op, the same shape a clean tree already returns, not a throw.

  const before = runGit(['rev-parse', 'HEAD'], { cwd: proj })
  const result = wipCommit(proj, { message: 'auto-save' })
  assert.equal(result.committed, false)
  assert.equal(result.sha, null)
  assert.equal(runGit(['rev-parse', 'HEAD'], { cwd: proj }), before, 'HEAD must not move')
})

ok('wipCommit still throws on a genuine add failure (not the tolerated embedded-repo case)', () => {
  const proj = freshRepo('project-genuine-add-failure')
  fs.writeFileSync(path.join(proj, 'a.txt'), 'x\n')
  runGit(['add', '-A'], { cwd: proj })
  runGit(['commit', '-m', 'seed'], { cwd: proj })

  fs.writeFileSync(path.join(proj, 'b.txt'), 'y\n')
  const lock = path.join(proj, '.git', 'index.lock')
  fs.writeFileSync(lock, '')
  try {
    assert.throws(() => wipCommit(proj, { message: 'should throw' }), /git add failed/)
  } finally {
    fs.rmSync(lock)
  }
})

// --- reviewedTip: "did the session's real work land?" ------------------------
{
  const dir = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'arxa-reviewed-'))
  try {
    initOrgRepo(dir)
    fsx.writeFileSync(pathx.join(dir, 'a.txt'), 'one\n')
    runGit(['add', '-A'], { cwd: dir })
    runGit(['commit', '-m', 'feat(a): the real work'], { cwd: dir })
    const real = runGit(['rev-parse', 'HEAD'], { cwd: dir })

    // Exactly the shape that broke cleanup: a WIP checkpoint ON TOP of the
    // commit that merged. The tip is not in main; the reviewed commit is.
    fsx.writeFileSync(pathx.join(dir, 'a.txt'), 'two\n')
    wipCommit(dir, { message: 'auto-save (watcher)' })
    const tip = runGit(['rev-parse', 'HEAD'], { cwd: dir })

    ok('reviewedTip skips a WIP checkpoint sitting above the real work', () => {
      assert.notEqual(tip, real, 'fixture: the tip really is the WIP commit')
      assert.equal(reviewedTip(dir, 'HEAD'), real)
    })
    ok('reviewedTip returns the tip when the tip is itself real work', () => {
      runGit(['commit', '--allow-empty', '-m', 'fix(a): another real one'], { cwd: dir })
      assert.equal(reviewedTip(dir, 'HEAD'), runGit(['rev-parse', 'HEAD'], { cwd: dir }))
    })
    ok('reviewedTip on an unknown branch is null, never a throw', () => {
      assert.equal(reviewedTip(dir, 'no-such-branch'), null)
    })
  } finally {
    fsx.rmSync(dir, { recursive: true, force: true })
  }
}

console.log(`# ${passed} passed`)
