/**
 * integrate selftest — FULLY OFFLINE, real git throughout.
 *
 * The properties worth proving here are the ones that would be expensive to
 * discover in production:
 *
 *   - `mergePreview` answers correctly AND leaves the object store untouched.
 *     It runs once per open session every 30 seconds, so a per-call object
 *     leak is not cosmetic. There is a NEGATIVE CONTROL for this: the same
 *     probe without the ODB redirect is run first and asserted to leak, so a
 *     future refactor that quietly drops the redirect fails here instead of
 *     bloating users' repos silently.
 *   - a conflicted integrate is LEFT IN PLACE, because that is what makes it
 *     resolvable.
 *   - `finishIntegrate` refuses a staged conflict marker — the case git itself
 *     waves through.
 *   - `readySession` will not collapse or push a branch mid-merge.
 *
 * Plain node assert; exit 0 on green.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { runGit } from './lib/run.js'
import { runGitProbe } from './lib/run.js'
import { openSession } from './lib/sessions.js'
import { setOrigin } from './lib/repos.js'
import { readLedger } from './lib/ledger.js'
import { mergePreview, integrateMain, finishIntegrate, isIntegrating, conflictMarkerFiles } from './lib/integrate.js'
import { readySession } from './lib/prflow.js'

let passed = 0
function ok(cond, label) {
  assert.ok(cond, label)
  passed++
  console.log('  ✓ ' + label)
}

const g = (cwd, args, allowFail = false) => runGit(args, { cwd, allowFail })
const looseObjects = (repo) => {
  const root = path.join(repo, '.git', 'objects')
  let n = 0
  const walk = (d) => {
    for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
      if (e.name === 'pack' || e.name === 'info') continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p); else n++
    }
  }
  walk(root)
  return n
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-integrate-'))
const repoPath = path.join(root, 'repo')

function world() {
  fs.mkdirSync(repoPath, { recursive: true })
  g(root, ['init', '--initial-branch=main', repoPath])
  fs.writeFileSync(path.join(repoPath, 'menu.txt'), 'starter\nmain-dish\ndessert\n')
  g(repoPath, ['add', '-A'])
  g(repoPath, ['commit', '-m', 'chore: base'])
}
world()

// Two sessions from the same base — the tier-3 shape exactly.
const A = openSession(repoPath, { id: 'sess-a', name: 'sess-a', workspace: 'notes' })
const B = openSession(repoPath, { id: 'sess-b', name: 'sess-b', workspace: 'notes' })

// A changes the middle line and lands on main.
fs.writeFileSync(path.join(A.worktree, 'menu.txt'), 'starter\nA-PRICING\ndessert\n')
g(A.worktree, ['add', '-A']); g(A.worktree, ['commit', '-m', 'feat: pricing'])
g(repoPath, ['merge', '--no-ff', '-m', 'merge A', A.branch])

// B changes the SAME line — a genuine content conflict, not just a lag.
fs.writeFileSync(path.join(B.worktree, 'menu.txt'), 'starter\nB-ALLERGENS\ndessert\n')
g(B.worktree, ['add', '-A']); g(B.worktree, ['commit', '-m', 'feat: allergens'])

console.log('\n— mergePreview: correct, and costs the repo nothing —')

// NEGATIVE CONTROL: the same call WITHOUT the redirect must leak, or this
// test proves nothing about the redirect that follows it.
{
  const before = looseObjects(repoPath)
  runGitProbe(['merge-tree', '--write-tree', '--name-only', 'main', B.branch], { cwd: repoPath })
  const leaked = looseObjects(repoPath) - before
  ok(leaked > 0, `negative control: an unredirected probe DOES leak (${leaked} loose object(s)) — the redirect below is load-bearing`)
  g(repoPath, ['prune'], true)
}

{
  const before = looseObjects(repoPath)
  const p = mergePreview(repoPath, B.branch)
  const after = looseObjects(repoPath)
  // 2, not 1: under D107 a feature lands as a MERGE commit, so one landing
  // puts the feature commit AND the merge commit on main.
  ok(p.behind === 2, `B reads 2 behind main — feature + merge commit (got ${p.behind})`)
  ok(p.conflicts === true, 'the conflict is detected')
  ok(p.files.includes('menu.txt'), `the conflicting file is named (${p.files.join(', ') || 'none'})`)
  ok(after === before, `the repo gained 0 objects (${before} → ${after}) — the ODB redirect holds`)
  ok(isIntegrating(B.worktree) === false, 'and no merge was started: preview is read-only')
}

console.log('\n— a clean integrate —')
{
  const C = openSession(repoPath, { id: 'sess-c', name: 'sess-c', workspace: 'notes' })
  fs.writeFileSync(path.join(C.worktree, 'other.txt'), 'untouched by main\n')
  g(C.worktree, ['add', '-A']); g(C.worktree, ['commit', '-m', 'feat: other'])
  // Move main AFTER C branched, on a file C never touches: behind, but clean.
  fs.writeFileSync(path.join(repoPath, 'hours.txt'), 'open 6pm\n')
  g(repoPath, ['add', '-A']); g(repoPath, ['commit', '-m', 'chore: hours'])
  const pre = mergePreview(repoPath, C.branch)
  ok(pre.conflicts === false && pre.behind > 0, 'preview says behind but clean')
  const r = integrateMain(C, { author: 'unfazed-dev', collaborator: 'Claude Opus 5@(high)' })
  ok(r.integrated === true && r.conflicted === false, 'it merges without stopping')
  ok(g(C.worktree, ['merge-base', '--is-ancestor', 'main', 'HEAD'], true) !== null, "main is now an ancestor of C's tip")
  const row = readLedger(repoPath, 'sess-c').find((x) => x.stage === 'integrated')
  ok(row?.result === 'clean', `ledger records integrated/clean (got ${row?.result})`)
  ok(row?.author === 'unfazed-dev' && row?.collaborator === 'Claude Opus 5@(high)', 'with author AND collaborator')
}

console.log('\n— a conflicting integrate is left resolvable —')
{
  const r = integrateMain(B, { author: 'unfazed-dev', collaborator: 'Claude Opus 5@(high)' })
  ok(r.conflicted === true && r.integrated === false, 'it reports the conflict rather than merging')
  ok(isIntegrating(B.worktree) === true, 'the merge is LEFT OPEN — markers in the tree, MERGE_HEAD set')
  ok(r.files.includes('menu.txt'), 'and it names what to resolve')
  ok(conflictMarkerFiles(B.worktree).includes('menu.txt'), 'the file really does carry markers')
  const row = readLedger(repoPath, 'sess-b').find((x) => x.stage === 'integrated')
  ok(row?.result === 'conflicted', `ledger records integrated/conflicted (got ${row?.result})`)
}

console.log('\n— a branch mid-merge cannot be readied —')
{
  const out = readySession(repoPath, 'sess-b', { subject: 'feat: allergens', author: 'unfazed-dev' })
  ok(out.reason === 'integrate-conflict', `readySession refuses with 'integrate-conflict' (got ${out.reason})`)
  ok(out.pushed === false && out.sha === null, 'nothing was collapsed and nothing was pushed')
}

console.log('\n— finish refuses a staged marker, the case git waves through —')
{
  // The realistic failure: an agent "resolves" but leaves a marker, then stages
  // it. Git sees a resolved path and would commit it without complaint.
  fs.writeFileSync(path.join(B.worktree, 'menu.txt'), 'starter\n<<<<<<< HEAD\nB-ALLERGENS\n=======\nA-PRICING\n>>>>>>> main\ndessert\n')
  g(B.worktree, ['add', 'menu.txt'])
  ok(runGit(['diff', '--name-only', '--diff-filter=U'], { cwd: B.worktree, allowFail: true }) === '',
    'git now considers the path resolved — it would commit this')
  const bad = finishIntegrate(B, { author: 'unfazed-dev' })
  ok(bad.finished === false && bad.reason === 'markers-remain', `we refuse anyway (reason=${bad.reason})`)
  ok(bad.files.includes('menu.txt'), 'naming the file still carrying markers')
}

console.log('\n— finish after a real resolution —')
{
  // NOT staged, deliberately. In arxa the agent EDITS the file and nothing
  // runs `git add` — the path stays unmerged with the resolution in it. The
  // first version of this test staged first and so never exercised the only
  // route a user actually takes; the card smoke run found it in production.
  // The block above staged the file to prove the marker check bites, which
  // also resolved it in git's eyes. Put it back to genuinely unmerged first.
  g(B.worktree, ['checkout', '--merge', '--', 'menu.txt'], true)
  ok(runGit(['diff', '--name-only', '--diff-filter=U'], { cwd: B.worktree, allowFail: true }) !== '',
    'the path is unmerged again')
  fs.writeFileSync(path.join(B.worktree, 'menu.txt'), 'starter\nA-PRICING\nB-ALLERGENS\ndessert\n')
  ok(runGit(['diff', '--name-only', '--diff-filter=U'], { cwd: B.worktree, allowFail: true }) !== '',
    'and editing it does NOT stage it — git still calls it unmerged')
  const done = finishIntegrate(B, { author: 'unfazed-dev', collaborator: 'Claude Opus 5@(high)' })
  ok(done.finished === true, 'the merge concludes')
  ok(isIntegrating(B.worktree) === false, 'MERGE_HEAD is gone')
  ok(g(B.worktree, ['merge-base', '--is-ancestor', 'main', 'HEAD'], true) !== null, 'main is an ancestor of B')
  const kept = fs.readFileSync(path.join(B.worktree, 'menu.txt'), 'utf8')
  ok(kept.includes('A-PRICING') && kept.includes('B-ALLERGENS'), 'and BOTH features survived — no work was dropped')
  const rows = readLedger(repoPath, 'sess-b').filter((x) => x.stage === 'integrated')
  ok(rows.length === 2 && rows[1].result === 'resolved',
    `the ledger APPENDED rather than replaced: ${rows.map((r) => r.result).join(' → ')}`)
}

console.log('\n— a dirty worktree does not block an integrate —')
{
  const D = openSession(repoPath, { id: 'sess-d', name: 'sess-d', workspace: 'notes' })
  fs.writeFileSync(path.join(D.worktree, 'draft.txt'), 'half-written, never committed\n')
  g(repoPath, ['commit', '--allow-empty', '-m', 'chore: move main on'])
  const r = integrateMain(D, { author: 'unfazed-dev' })
  ok(r.wip?.committed === true, 'the uncommitted work was WIP-committed first, not stashed')
  ok(r.integrated === true, 'and the integrate went through')
  ok(fs.readFileSync(path.join(D.worktree, 'draft.txt'), 'utf8').includes('half-written'), 'the draft is still there')
}

console.log('\n— no origin: local-only orgs keep working (CLAUDE.md contract) —')
{
  const solo = path.join(root, 'solo')
  g(root, ['init', '--initial-branch=main', solo])
  fs.writeFileSync(path.join(solo, 'a.txt'), 'x\n')
  g(solo, ['add', '-A']); g(solo, ['commit', '-m', 'chore: base'])
  const S = openSession(solo, { id: 'solo1', name: 'solo1', workspace: 'notes' })
  const r = integrateMain(S, { author: 'local-user' })
  ok(r.reason === 'no-origin' || r.reason === 'current', `no throw without a remote (reason=${r.reason})`)
  const p = mergePreview(solo, S.branch)
  ok(p.conflicts === false || p.conflicts === null, 'and the preview answers rather than blowing up')
}

fs.rmSync(root, { recursive: true, force: true })
console.log(`\nintegrate: ${passed} assertions green`)
