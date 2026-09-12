/**
 * land-race selftest — the deterministic core of the S4 stress scenario
 * (cicd-stress.mjs, 2026-09-13).
 *
 * What the barrier run actually observed: two sessions released onto one
 * repo, one merge won, and the loser's `merge --no-ff` had already staged
 * its result into main's index before it lost the ref race — leaving
 * `A <loser file>`, `D <winner file>` + an untracked twin behind, with the
 * failure reported as "merge conflict with main" although the files never
 * overlapped. Every later land then refused ("Your local changes … would be
 * overwritten"), so the org's main worktree stayed dirty forever.
 *
 * This pins the two halves of the contract separately:
 *   1. the RACED loser (no conflict, just residue) must heal and land;
 *   2. a GENUINE conflict must still park loudly with every commit intact —
 *      the race repair may not weaken the conflict guard.
 *
 * Fully offline, real git throughout. Plain node assert; exit 0 on green.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { runGit } from './lib/run.js'
import { openSession, sessionStageBoundary, listSessions } from './lib/sessions.js'

let passed = 0
function ok(cond, label) {
  assert.ok(cond, label)
  passed++
  console.log('  ✓ ' + label)
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-landrace-'))
const repo = path.join(root, 'repo')
runGit(['init', '--initial-branch=main', repo], { env: process.env })
fs.writeFileSync(path.join(repo, 'shared.md'), 'base line\n')
runGit(['add', '-A'], { cwd: repo, env: process.env })
runGit(['commit', '-m', 'chore: base'], { cwd: repo, env: process.env })

const mkSession = (id, file, text) => {
  const s = openSession(repo, { id, name: id, workspace: 'notes', env: process.env })
  fs.writeFileSync(path.join(s.worktree, file), text)
  runGit(['add', '-A'], { cwd: s.worktree, env: process.env })
  runGit(['commit', '-m', 'feat: ' + id], { cwd: s.worktree, env: process.env })
  return s
}
const status = () => runGit(['status', '--porcelain'], { cwd: repo, env: process.env, allowFail: true })

// ---- 1. the raced loser heals and lands ------------------------------------
mkSession('win-a', 'a.md', 'content a\n')
mkSession('lose-b', 'b.md', 'content b\n')

const win = sessionStageBoundary(repo, 'win-a', { env: process.env })
ok(win.merged === true, 'the winner lands first')

// Rebuild EXACTLY what the loser's raced merge leaves in main's worktree:
// its result staged (A b.md), the winner's file knocked out of the index
// with the file still on disk (D a.md + ?? a.md). Byte-for-byte the state
// the barrier run left behind.
fs.writeFileSync(path.join(repo, 'b.md'), 'content b\n')
runGit(['add', 'b.md'], { cwd: repo, env: process.env })
runGit(['rm', '--cached', '-q', 'a.md'], { cwd: repo, env: process.env })
const residue = status()
ok(residue.includes('D  a.md') && residue.includes('A  b.md') && residue.includes('?? a.md'),
  'the raced residue is staged in main (fixture pinned), got: ' + JSON.stringify(residue))

let lose = null
let loseErr = null
try { lose = sessionStageBoundary(repo, 'lose-b', { env: process.env }) } catch (err) { loseErr = err }
ok(loseErr === null, 'the raced loser lands instead of parking: ' + (loseErr && loseErr.message))
ok(lose !== null && lose.merged === true, 'the loser\'s land reports merged')
ok(runGit(['show', 'main:b.md'], { cwd: repo, env: process.env, allowFail: true }) === 'content b'
  && runGit(['show', 'main:a.md'], { cwd: repo, env: process.env, allowFail: true }) === 'content a',
  'main carries BOTH sessions\' content after the race')
ok(status() === '', 'main\'s worktree is clean after the loser healed the raced index, got: ' + JSON.stringify(status()))
const row = listSessions(repo, process.env).find((s) => s.id === 'lose-b')
ok(row.state === 'open', 'the raced loser was never parked')

// ---- 2. a genuine conflict still parks loudly, commits intact --------------
mkSession('cf-a', 'shared.md', 'settled by cf-a\n')
mkSession('cf-b', 'shared.md', 'settled by cf-b\n')
const cfa = sessionStageBoundary(repo, 'cf-a', { env: process.env })
ok(cfa.merged === true, 'the conflicting round\'s first land succeeds')

let threw = null
try { sessionStageBoundary(repo, 'cf-b', { env: process.env }) } catch (err) { threw = err }
ok(threw !== null && threw.name === 'SessionMergeError',
  'a genuine same-file conflict throws SessionMergeError loudly, got: ' + (threw && threw.name))
const cfRow = listSessions(repo, process.env).find((s) => s.id === 'cf-b')
ok(cfRow.state === 'parked' && cfRow.parkedReason === 'merge-conflict',
  'the conflicting session parks with its reason, got: ' + cfRow.state + '/' + cfRow.parkedReason)
ok(runGit(['show', 'arxa/cf-b:shared.md'], { cwd: repo, env: process.env, allowFail: true }) === 'settled by cf-b',
  'the parked conflict keeps every commit on its branch')
ok(runGit(['show', 'main:shared.md'], { cwd: repo, env: process.env, allowFail: true }) === 'settled by cf-a',
  'main keeps the winner\'s content untouched by the conflict')

console.log('arxa-git-workspace land-race selftest: GREEN (' + passed + ' checks)')
