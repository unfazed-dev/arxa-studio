#!/usr/bin/env node
// Selftest for B7 (docs/plans/git-card-sessions-worktree-rewire.md) —
// worktree ↔ registry ↔ git reconciliation.
//
// Builds one repo with 3 real sessions (via `openSession`), then induces
// every drift kind by hand:
//   - `rm -rf` a worktree dir (bypassing git)      → git-prunable + registry-without-dir
//   - `git worktree remove --force` a worktree dir
//     (bypassing the registry)                     → registry-without-git + registry-without-dir
//   - edit a registry row's branch directly         → branch-mismatch
//   - add a stray directory under the worktrees dir → dir-without-git
//   - `git worktree add` an unregistered worktree   → git-without-registry
//   - delete a registry row for a healthy session    → git-without-registry (2nd route)
// then asserts each induced problem is classified exactly once, that
// `repairWorktrees` dry-run mutates nothing (registry bytes + `git worktree
// list` output byte-identical before/after), and that a non-dry run applies
// exactly the safe set (prune + mark-detached) and nothing else.
//
// Stress: 50 worktrees, report generation must finish under 3s.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  openSession, listSessions, runGit,
  parseWorktreePorcelain, reconcileWorktrees, repairWorktrees,
  SESSIONS_DIR,
} from './lib/index.js'

let passed = 0
function ok(label, fn) {
  fn()
  passed += 1
  console.log(`ok ${passed} - ${label}`)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-git-reconcile-selftest-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q', '-b', 'main', '.'], { cwd: dir })
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hi\n')
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'feat: init'], { cwd: dir })
}

function registryFile(repoPath) {
  const common = runGit(['rev-parse', '--git-common-dir'], { cwd: repoPath })
  return path.join(path.resolve(repoPath, common), 'arxa', 'sessions.json')
}

function driftBy(report, kind, matcher) {
  return report.drift.filter((d) => d.kind === kind && (matcher ? matcher(d) : true))
}

// git canonicalizes paths it reports (e.g. macOS /var → /private/var,
// /tmp → /private/tmp); drift entries sourced from git carry that
// canonical form, so path-based assertions below compare against the
// realpath of what we actually created, not the pre-canonicalization string.
function samePath(a, b) {
  const real = (p) => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }
  return real(a) === real(b)
}

// ---- parseWorktreePorcelain -------------------------------------------------

ok('parseWorktreePorcelain: branch, detached, bare, locked, prunable blocks', () => {
  const text = [
    'worktree /path/to/bare-source',
    'bare',
    '',
    'worktree /path/to/main-worktree',
    'HEAD abcd1234',
    'branch refs/heads/main',
    '',
    'worktree /path/to/detached-worktree',
    'HEAD 1234abcd',
    'detached',
    '',
    'worktree /path/to/locked-worktree',
    'HEAD acbd5678',
    'branch refs/heads/branch-a',
    'locked',
    '',
    'worktree /path/to/locked-worktree-with-reason',
    'HEAD 1234abcd',
    'branch refs/heads/branch-b',
    'locked reason why is locked',
    '',
    'worktree /path/to/prunable-worktree',
    'HEAD 5678abc1',
    'detached',
    'prunable gitdir file points to non-existent location',
    '',
  ].join('\n')
  const rows = parseWorktreePorcelain(text)
  assert.equal(rows.length, 6)
  assert.deepEqual(rows[0], { path: '/path/to/bare-source', head: null, branch: null, bare: true, detached: false, locked: null, prunable: null })
  assert.equal(rows[1].branch, 'refs/heads/main')
  assert.equal(rows[1].head, 'abcd1234')
  assert.equal(rows[2].detached, true)
  assert.equal(rows[3].locked, true)
  assert.equal(rows[4].locked, 'reason why is locked')
  assert.equal(rows[5].prunable, 'gitdir file points to non-existent location')
})

ok('parseWorktreePorcelain: empty / malformed input never throws', () => {
  assert.deepEqual(parseWorktreePorcelain(''), [])
  assert.deepEqual(parseWorktreePorcelain(null), [])
  assert.deepEqual(parseWorktreePorcelain('bare\nlocked\n'), []) // no leading `worktree` line — nothing to attach to
})

// ---- reconcileWorktrees: induce every drift kind ---------------------------

const repo = path.join(tmp, 'repo')
initRepo(repo)
const worktreesDir = path.join(repo, SESSIONS_DIR)

const sA = openSession(repo, { id: 'sess-a', name: 'A' }) // → rm -rf'd (git-prunable + registry-without-dir)
const sB = openSession(repo, { id: 'sess-b', name: 'B' }) // → worktree remove --force (registry-without-git + registry-without-dir)
const sC = openSession(repo, { id: 'sess-c', name: 'C' }) // → branch edited by hand (branch-mismatch)
const sD = openSession(repo, { id: 'sess-d', name: 'D' }) // → row deleted, worktree/git left intact (git-without-registry)

ok('setup: 4 sessions registered and git-visible before any drift', () => {
  const report = reconcileWorktrees(repo)
  assert.equal(report.registry, 4)
  assert.equal(report.git, 5) // 4 sessions + the primary worktree
  assert.equal(report.drift.length, 0, `expected zero drift before induction, got ${JSON.stringify(report.drift)}`)
})

// 1. rm -rf a worktree dir, bypassing git entirely.
fs.rmSync(sA.worktree, { recursive: true, force: true })

// 2. git worktree remove --force, bypassing the registry (row stays put).
runGit(['worktree', 'remove', '--force', sB.worktree], { cwd: repo })

// 3. edit a registry row's branch directly.
{
  const p = registryFile(repo)
  const reg = JSON.parse(fs.readFileSync(p, 'utf8'))
  const row = reg.sessions.find((s) => s.id === sC.id)
  row.branch = 'arxa/session/not-the-real-branch'
  fs.writeFileSync(p, JSON.stringify(reg, null, 2) + '\n')
}

// 4. a stray directory under the worktrees dir, unknown to git and unregistered.
fs.mkdirSync(path.join(worktreesDir, 'stray-orphan'), { recursive: true })

// 5. `git worktree add` an unregistered worktree.
const roguePath = path.join(worktreesDir, 'rogue')
runGit(['worktree', 'add', '-b', 'arxa/session/rogue', roguePath, 'main'], { cwd: repo })

// 6. delete a registry row for an otherwise-healthy session.
{
  const p = registryFile(repo)
  const reg = JSON.parse(fs.readFileSync(p, 'utf8'))
  reg.sessions = reg.sessions.filter((s) => s.id !== sD.id)
  fs.writeFileSync(p, JSON.stringify(reg, null, 2) + '\n')
}

let report
ok('reconcileWorktrees: every induced problem is classified exactly once', () => {
  report = reconcileWorktrees(repo)

  assert.equal(driftBy(report, 'git-prunable', (d) => d.id === sA.id).length, 1, 'sA prunable')
  assert.equal(driftBy(report, 'registry-without-dir', (d) => d.id === sA.id).length, 1, 'sA dir gone')
  assert.equal(driftBy(report, 'registry-without-git', (d) => d.id === sB.id).length, 1, 'sB deregistered from git')
  assert.equal(driftBy(report, 'registry-without-dir', (d) => d.id === sB.id).length, 1, 'sB dir gone too')
  assert.equal(driftBy(report, 'branch-mismatch', (d) => d.id === sC.id).length, 1, 'sC branch edited')
  assert.equal(driftBy(report, 'dir-without-git', (d) => samePath(d.path, path.join(worktreesDir, 'stray-orphan'))).length, 1, 'stray dir')
  assert.equal(driftBy(report, 'git-without-registry', (d) => samePath(d.path, roguePath)).length, 1, 'rogue worktree')
  assert.equal(driftBy(report, 'git-without-registry', (d) => samePath(d.path, sD.worktree)).length, 1, 'sD orphaned by row deletion')

  // Nothing extra leaked in: sA/sB/sC/sD/rogue/stray account for exactly
  // these 8 entries and nothing else.
  assert.equal(report.drift.length, 8, `unexpected drift count: ${JSON.stringify(report.drift, null, 2)}`)
  assert.equal(report.registry, 3) // sA, sB, sC (sD's row was deleted)
  assert.equal(report.dirs, fs.readdirSync(worktreesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).length)
})

// ---- repairWorktrees: dry-run mutates nothing ------------------------------

ok('repairWorktrees: dry-run touches neither git nor the registry', () => {
  const beforeRegistry = fs.readFileSync(registryFile(repo))
  const beforeGit = runGit(['worktree', 'list', '--porcelain'], { cwd: repo })

  const result = repairWorktrees(repo, report, { dryRun: true })
  assert.ok(result.applied.length > 0, 'dry-run still reports what it WOULD do')

  const afterRegistry = fs.readFileSync(registryFile(repo))
  const afterGit = runGit(['worktree', 'list', '--porcelain'], { cwd: repo })
  assert.ok(beforeRegistry.equals(afterRegistry), 'dry-run must not touch sessions.json bytes')
  assert.equal(beforeGit, afterGit, 'dry-run must not touch git worktree state')

  // Re-running reconcile after a dry-run must see the SAME drift — nothing moved.
  const reportAfter = reconcileWorktrees(repo)
  assert.equal(reportAfter.drift.length, report.drift.length)
})

// ---- repairWorktrees: non-dry applies exactly the safe set ----------------

ok('repairWorktrees: applies exactly {git-prunable, registry-without-git(open)}, skips the rest', () => {
  const result = repairWorktrees(repo, report, { dryRun: false })

  const appliedKinds = new Set(result.applied.map((a) => a.kind))
  assert.deepEqual(appliedKinds, new Set(['git-prunable', 'registry-without-git']))
  assert.equal(result.applied.filter((a) => a.action === 'pruned').length, 1)
  assert.equal(result.applied.filter((a) => a.action === 'marked-detached').length, 1)
  assert.equal(result.applied.find((a) => a.id === sB.id).action, 'marked-detached')

  const skippedKinds = new Set(result.skipped.map((s) => s.kind))
  assert.deepEqual(skippedKinds, new Set(['registry-without-dir', 'branch-mismatch', 'dir-without-git', 'git-without-registry']))

  // sB's row is marked detached, never deleted (D40: never auto-delete).
  const rows = listSessions(repo)
  const rowB = rows.find((s) => s.id === sB.id)
  assert.equal(rowB.state, 'detached')
  assert.equal(rows.length, 3, 'no row was deleted by repair')

  // git no longer carries sA's prunable admin entry.
  const gitAfter = runGit(['worktree', 'list', '--porcelain'], { cwd: repo })
  assert.ok(!gitAfter.includes(sA.worktree), 'pruned entry gone from git')

  // `git worktree remove --force` was never invoked by repair — the rogue
  // and stray-orphan directories are untouched (report-only kinds).
  assert.ok(fs.existsSync(roguePath), 'rogue worktree untouched (report-only)')
  assert.ok(fs.existsSync(path.join(worktreesDir, 'stray-orphan')), 'stray dir untouched (report-only)')
})

ok('repairWorktrees: pruning cascades — sA now genuinely orphaned from git too', () => {
  // `git worktree prune` removed sA's dangling admin entry entirely, so sA's
  // still-`open` registry row is now a real registry-without-git case (it
  // wasn't one before prune — it was git-prunable). This is correct
  // cascading behavior, not a bug: the safe repair marks it detached too.
  const again = reconcileWorktrees(repo)
  assert.equal(driftBy(again, 'git-prunable').length, 0, 'prune already ran')
  assert.equal(driftBy(again, 'registry-without-git', (d) => d.id === sA.id).length, 1, 'sA orphaned by its own pruning')
  assert.equal(driftBy(again, 'registry-without-git', (d) => d.id === sB.id).length, 1, 'sB still orphaned from before')

  const second = repairWorktrees(repo, again, { dryRun: false })
  assert.deepEqual(second.applied.map((a) => a.id).sort(), [sA.id], 'only the newly-open orphan (sA) is marked — sB is already detached')
  assert.equal(second.applied[0].action, 'marked-detached')
  assert.ok(second.skipped.some((s) => s.id === sB.id && /state is "detached"/.test(s.reason)), 'sB skipped: already detached')

  const rows = listSessions(repo)
  assert.equal(rows.find((s) => s.id === sA.id).state, 'detached')
  assert.equal(rows.find((s) => s.id === sB.id).state, 'detached')
})

ok('repairWorktrees: a third pass is a true no-op — both rows now detached', () => {
  const third = reconcileWorktrees(repo)
  assert.equal(driftBy(third, 'registry-without-git', (d) => d.id === sA.id).length, 1, 'still reported (report never lies about drift)')
  assert.equal(driftBy(third, 'registry-without-git', (d) => d.id === sB.id).length, 1)
  const result = repairWorktrees(repo, third, { dryRun: false })
  assert.equal(result.applied.filter((a) => a.kind === 'registry-without-git').length, 0, 'nothing left to safely repair')
})

// ---- stress: 50 worktrees, report < 3s -------------------------------------

ok('stress: 50 worktrees, reconcileWorktrees < 3s', () => {
  const stressRepo = path.join(tmp, 'stress')
  initRepo(stressRepo)
  for (let i = 0; i < 50; i++) {
    const id = `s${String(i).padStart(3, '0')}`
    runGit(['worktree', 'add', '-b', `arxa/session/${id}`, path.join(stressRepo, SESSIONS_DIR, id), 'main'], { cwd: stressRepo })
  }
  const start = Date.now()
  const stressReport = reconcileWorktrees(stressRepo)
  const elapsed = Date.now() - start
  assert.equal(stressReport.git, 51) // 50 + primary
  assert.ok(elapsed < 3000, `reconcileWorktrees took ${elapsed}ms, expected < 3000ms`)
})

console.log(`\n${passed} tests passed.`)
