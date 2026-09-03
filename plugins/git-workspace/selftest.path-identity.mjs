#!/usr/bin/env node
// Selftest: session identity IS the relative disk path (grilled 2026-09-03,
// docs/plans/session-path-identity-and-cicd-smoke.md). Runs against REAL git
// repos in a temp dir — the whole point of this contract is what git and the
// filesystem actually do with it, which a mock cannot tell you.
//
// Covers:
//  1. mint shape: <org>/<workspace key>/<word>-wt-<YYMMDD>-<NNN>, path mirrors
//     disk exactly (projects/ kept, numeric container prefixes kept)
//  2. the counter is per path per day and shared ACROSS words
//  3. branch = `arxa/` + identity; worktree = <ORG>/.arxa/worktrees/<identity>
//  4. a PROJECT session's checkout sits under the ORG root while its branch
//     still belongs to the PROJECT repo (the B2 invariant, re-expressed)
//  5. git itself ties the nested directory to the nested branch
//  6. the row label defaults to the LEAF, not the whole path
//  7. archive prunes emptied identity directories and stops at an occupied one
//  8. openSession refuses to invent an id (Q8 — only the app layer mints)
//  9. a folder name git cannot express is refused at mint/validate time
// 10. dsh conversation key flattens `/` to `-`

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  openSession, archiveSession, mintSessionPath, sessionLeaf, dshSessionKey,
  assertSessionIdShape, SESSION_BRANCH_PREFIX,
} from './lib/sessions.js'

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const newRepo = (p) => {
  fs.mkdirSync(p, { recursive: true })
  git(p, 'init', '-q', '-b', 'main')
  git(p, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
  return p
}
let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('  ok', n, '-', msg) }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-path-identity-'))
const org = newRepo(path.join(tmp, 'RESTO'))
const proj = newRepo(path.join(org, 'projects', 'kitchen-project'))
const day = new Date(2026, 8, 3)

try {
  // ---- 1 & 2. mint ---------------------------------------------------------
  const id1 = mintSessionPath({ org: 'RESTO', workspace: 'notes', sessions: [], now: day })
  assert.equal(id1, 'RESTO/notes/note-wt-260903-001')
  ok(true, 'mint: org session is <org>/<workspace>/<singular folder>-wt-<YYMMDD>-001')

  const id2 = mintSessionPath({
    org: 'RESTO', workspace: 'projects/kitchen-project/06-build', name: 'BackOffice', sessions: [], now: day,
  })
  assert.equal(id2, 'RESTO/projects/kitchen-project/06-build/backoffice-wt-260903-001')
  ok(true, 'mint: the path mirrors disk — `projects/` kept, `06-` prefix kept, name slugged')

  const id3 = mintSessionPath({
    org: 'RESTO', workspace: 'notes', name: 'Shopping List', sessions: [{ id: id1 }], now: day,
  })
  assert.equal(id3, 'RESTO/notes/shopping-list-wt-260903-002')
  ok(true, 'mint: NNN counts per path per day and is SHARED across words (001 note → 002 shopping-list)')

  const nextDay = mintSessionPath({
    org: 'RESTO', workspace: 'notes', sessions: [{ id: id1 }, { id: id3 }], now: new Date(2026, 8, 4),
  })
  assert.equal(nextDay, 'RESTO/notes/note-wt-260904-001')
  ok(true, 'mint: a new day restarts the counter under its own stamp')

  const afterDrop = mintSessionPath({
    org: 'RESTO', workspace: 'notes', sessions: [{ id: 'RESTO/notes/note-wt-260903-002' }], now: day,
  })
  assert.equal(afterDrop, 'RESTO/notes/note-wt-260903-003')
  ok(true, 'mint: a number freed by a drop is skipped, never reused (registry is the authority)')

  // ---- 3 & 4. placement ----------------------------------------------------
  const s1 = openSession(org, { id: id1, workspace: 'notes' })
  const s2 = openSession(proj, {
    id: id2, orgPath: org, workspace: 'projects/kitchen-project/06-build', project: 'kitchen-project',
  })

  assert.equal(s1.branch, SESSION_BRANCH_PREFIX + id1)
  assert.equal(s1.branch, 'arxa/RESTO/notes/note-wt-260903-001')
  ok(true, 'branch = `arxa/` + identity — the directory path with one prefix')

  assert.equal(s1.worktree, path.join(org, '.arxa/worktrees', id1))
  ok(true, 'org session worktree = <ORG>/.arxa/worktrees/<identity>')

  assert.equal(s2.worktree, path.join(org, '.arxa/worktrees', id2))
  assert.ok(!s2.worktree.startsWith(proj + path.sep))
  ok(true, 'PROJECT session checkout also sits under the ORG root, not inside the project')

  const commonDir = fs.realpathSync(git(s2.worktree, 'rev-parse', '--git-common-dir'))
  assert.equal(commonDir, fs.realpathSync(path.join(proj, '.git')))
  assert.notEqual(commonDir, fs.realpathSync(path.join(org, '.git')))
  ok(true, 'B2 invariant intact: the project session BRANCH belongs to the PROJECT repo')

  // ---- 5. git agrees -------------------------------------------------------
  assert.ok(git(proj, 'worktree', 'list', '--porcelain').includes(`branch refs/heads/${s2.branch}`))
  ok(true, 'git worktree list ties the nested directory to the nested branch')

  // ---- 6. label ------------------------------------------------------------
  assert.equal(s1.name, 'note-wt-260903-001')
  assert.equal(sessionLeaf(id2), 'backoffice-wt-260903-001')
  ok(true, 'the row label defaults to the LEAF — the breadcrumb already carries the folders')

  // ---- 7. archive prunes ---------------------------------------------------
  assert.ok(fs.existsSync(path.join(org, '.arxa/worktrees/RESTO/notes')))
  archiveSession(org, id1)
  assert.ok(!fs.existsSync(path.join(org, '.arxa/worktrees/RESTO/notes')))
  ok(true, 'archive prunes identity directories it emptied')

  assert.ok(fs.existsSync(path.join(org, '.arxa/worktrees/RESTO/projects/kitchen-project/06-build')))
  ok(true, 'prune stops at a still-occupied sibling rather than walking the whole root away')

  // ---- 8. the library never mints ------------------------------------------
  assert.throws(() => openSession(org, { workspace: 'notes' }), /id-required/)
  ok(true, 'openSession refuses to invent an id — only the app layer mints (Q8)')

  // ---- 9. ref-safety -------------------------------------------------------
  assert.throws(() => assertSessionIdShape('RESTO/my org/x-wt-260903-001'), /cannot be a git branch component/)
  assert.throws(() => assertSessionIdShape('RESTO/.hidden/x-wt-260903-001'), /cannot be a git branch component/)
  assert.throws(() => assertSessionIdShape('RESTO//x-wt-260903-001'), /no empty segments/)
  assert.equal(assertSessionIdShape('RESTO/notes/note-wt-260903-001'), 'RESTO/notes/note-wt-260903-001')
  ok(true, 'a folder git cannot express is refused loudly at validate time, not three steps later')

  // ---- 10. dsh key ---------------------------------------------------------
  assert.equal(dshSessionKey(id2), 'arxa-RESTO-projects-kitchen-project-06-build-backoffice-wt-260903-001')
  ok(true, 'dsh conversation key flattens `/` to `-` (dsh names a conversation directory by its id)')

  console.log(`selftest.path-identity: ${n} checks passed`)
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
