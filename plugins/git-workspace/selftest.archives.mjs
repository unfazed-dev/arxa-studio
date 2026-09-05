/**
 * git-workspace archives-tier selftest (2026-09-05 grill) — the registry-row
 * and ref primitives under the Archives row's Move-to-Trash / the trash's
 * restore / purge doors:
 *   removeSessionRow (row-only removal), restoreSessionRow (verbatim
 *   re-add, replace-never-duplicate), dropSessionRefs (branch + base ref,
 *   honest booleans, no row needed), and mintSessionPath's `ghosts` — the
 * trash-flow collision fix (a trashed session's row is gone but its branch
 * occupies the id namespace; a newborn mint must skip it).
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  initOrgRepo,
  runGit,
  openSession,
  archiveSession,
  reviveSession,
  removeSessionRow,
  restoreSessionRow,
  dropSessionRefs,
  mintSessionPath,
  listSessions,
} from './lib/index.js'

let passed = 0
function ok(cond, label) {
  assert.ok(cond, label)
  passed++
  console.log(`  ✓ ${label}`)
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-gw-archives-'))
const env = { ...process.env, GIT_AUTHOR_NAME: 'selftest', GIT_AUTHOR_EMAIL: 'selftest@arxa', GIT_COMMITTER_NAME: 'selftest', GIT_COMMITTER_EMAIL: 'selftest@arxa' }

try {
  const org = path.join(root, 'Acme')
  fs.mkdirSync(org, { recursive: true })
  initOrgRepo(org, env)
  runGit(['commit', '-m', 'init', '--allow-empty'], { cwd: org, env })

  const sid = mintSessionPath({ org: 'Acme', workspace: 'notes', name: '', sessions: [] })
  const s = openSession(org, { id: sid, orgPath: org, workspace: 'notes', env })
  ok(openSession.name.length > 0 && s.state === 'open', 'fixture session opened')

  // removeSessionRow: row leaves, branch stays (the trash contract).
  const removed = removeSessionRow(org, sid, env)
  ok(removed.id === sid && removed.branch === s.branch, 'removeSessionRow returns the row (the trash manifest payload)')
  ok(listSessions(org, env).length === 0, 'registry row gone after removeSessionRow')
  const branchAlive = runGit(['rev-parse', '--verify', s.branch], { cwd: org, env, allowFail: true }) !== null
  ok(branchAlive, 'branch KEPT after removeSessionRow (D40: never auto-deleted)')

  // Unknown id is loud.
  assert.throws(() => removeSessionRow(org, 'nope/nope', env), /unknown session/, 'removeSessionRow unknown id throws')
  ok(true, 'removeSessionRow unknown id is loud')

  // restoreSessionRow: verbatim re-add; same-id restore replaces, never
  // duplicates (double-restore / hand-edited registry).
  const back = restoreSessionRow(org, { ...removed, state: 'archived' }, env)
  ok(back.id === sid && listSessions(org, env).length === 1, 'restoreSessionRow re-adds exactly one row')
  restoreSessionRow(org, { ...removed, state: 'archived' }, env)
  ok(listSessions(org, env).length === 1, 'restoreSessionRow replaces on id collision, never duplicates')
  assert.throws(() => restoreSessionRow(org, { id: '' }, env), /required/, 'shape guard')
  ok(true, 'restoreSessionRow rejects a row without an id')

  // dropSessionRefs works with NO registry row (by purge time the row lives
  // only in the trash manifest) and reports honestly. The branch may still
  // be CHECKED OUT in a surviving worktree (crash between archive steps) —
  // the worktree handoff removes it first so `branch -D` cannot be refused
  // (the exact refusal the first cut of this selftest caught).
  restoreSessionRow(org, { ...removed, state: 'archived' }, env) // ensure row present
  removeSessionRow(org, sid, env) // and gone again — purge-time reality
  ok(fs.existsSync(s.worktree), 'fixture: the worktree survives with the branch checked out (crash-between-steps shape)')
  const refs = dropSessionRefs(org, { id: sid, branch: s.branch, worktree: s.worktree }, env)
  ok(refs.branchDropped === true && refs.baseRefDropped === true, 'dropSessionRefs removes a surviving worktree, then branch + base ref, with no registry row')
  ok(!fs.existsSync(s.worktree), 'worktree really removed by dropSessionRefs')
  ok(runGit(['rev-parse', '--verify', s.branch], { cwd: org, env, allowFail: true }) === null, 'branch really gone after dropSessionRefs')
  const refs2 = dropSessionRefs(org, { id: sid, branch: s.branch }, env)
  // git semantics: `branch -D` refuses a missing branch (honest false);
  // `update-ref -d` is a silent no-op success on a missing ref (git's own
  // behavior, verified 2026-09-05 — both fine for an idempotent purge).
  ok(refs2.branchDropped === false && typeof refs2.baseRefDropped === 'boolean', 'dropSessionRefs is idempotent-honest (branch false; base ref no-op), never a throw')

  // ---- mintSessionPath ghosts: the trash-flow collision --------------------
  // A trashed session's row is gone; its branch still holds the id. Without
  // ghosts a newborn mint reuses the id and `worktree add` dies ("a branch
  // named X already exists" — seen live in the 2026-09-05 probe).
  const ghost = { id: sid, name: removed.name, workspace: 'notes' }
  const minted = mintSessionPath({ org: 'Acme', workspace: 'notes', name: '', sessions: [], ghosts: [ghost], now: new Date(2026, 8, 5) })
  ok(minted !== sid, 'mint with ghosts skips the parked (trashed) identity')
  const s2 = openSession(org, { id: minted, orgPath: org, workspace: 'notes', env })
  ok(s2.branch !== s.branch && fs.existsSync(s2.worktree), 'second session born cleanly beside the parked branch')

  // Same-day ghost counting: the ghost's numeric suffix raises the counter.
  const minted2 = mintSessionPath({ org: 'Acme', workspace: 'notes', name: '', sessions: [], ghosts: [ghost, { id: minted }], now: new Date(2026, 8, 5) })
  ok(Number(minted2.slice(-3)) === Number(minted.slice(-3)) + 1, 'ghost ids participate in the day counter (no reuse, no off-by-one)')

  // archiveSession/reviveSession still behave (regression guard).
  archiveSession(org, minted, env)
  ok(listSessions(org, env).find((x) => x.id === minted).state === 'archived', 'archiveSession unchanged')
  reviveSession(org, minted, env)
  ok(listSessions(org, env).find((x) => x.id === minted).state === 'open', 'reviveSession unchanged')

  console.log(`git-workspace archives selftest: ${passed} checks green`)
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
