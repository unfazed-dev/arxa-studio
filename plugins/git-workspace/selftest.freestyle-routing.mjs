#!/usr/bin/env node
// Selftest: freestyle routing (F5) — nearest enclosing repo wins; root sessions mint.
import assert from 'node:assert/strict'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { resolveFreestyleRepo, RoutingRefusedError, ROUTING_REASONS } from './lib/routing.js'
import { mintSessionPath, openSession, assertSessionIdShape, sessionLeaf, dshSessionKey } from './lib/sessions.js'
import { initPlainRepo } from './lib/repos.js'
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ok', n, '-', m) }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-fs-'))
const root = path.join(tmp, 'root'); fs.mkdirSync(path.join(root, 'docs', 'deep'), { recursive: true }); initPlainRepo(root)

ok(ROUTING_REASONS.includes('outside-root'), 'outside-root is a documented reason')
let r = resolveFreestyleRepo(root, '')
ok(r.kind === 'freestyle' && r.repoPath === root && r.cwdRel === '', 'root session binds to the root repo')
r = resolveFreestyleRepo(root, 'docs/deep')
ok(r.repoPath === root && r.cwdRel === 'docs/deep', 'nested folder binds to the root repo with its relative cwd')

assert.throws(() => resolveFreestyleRepo(root, '../elsewhere'), (e) => e instanceof RoutingRefusedError && e.reason === 'outside-root'); ok(true, 'escaping the root refuses loudly')
const bare = path.join(tmp, 'bare'); fs.mkdirSync(bare); git(bare, 'init', '-q', '-b', 'main')
assert.throws(() => resolveFreestyleRepo(bare, ''), (e) => e.reason === 'no-head'); ok(true, 'a repo without HEAD refuses with no-head')

// A root that is not a repo at all (never added through Freestyle) also
// refuses with no-head, so the two "nothing to branch from" cases read the
// same way to a caller — the difference (repo-with-no-commits vs no-repo-at-
// -all) is in the message, not in a reason the sidebar would branch on.
const notARepo = path.join(tmp, 'not-a-repo'); fs.mkdirSync(notARepo)
assert.throws(() => resolveFreestyleRepo(notARepo, ''), (e) => e instanceof RoutingRefusedError && e.reason === 'no-head'); ok(true, 'a root that is not a repo at all refuses with no-head')

const nested = path.join(root, 'lib', 'child'); fs.mkdirSync(nested, { recursive: true }); initPlainRepo(nested)
r = resolveFreestyleRepo(root, 'lib/child/src')
ok(r.repoPath === nested && r.cwdRel === 'src', 'a nested repo is the nearest enclosing repo')

const id = mintSessionPath({ org: 'root', workspace: '', name: 'scratch', sessions: [], ghosts: [] })
ok(/^root\/scratch-wt-\d{6}-\d{3}$/.test(id), 'root session identity is <root>/<word>-wt-<date>-<nnn>: ' + id)
// The identity is two segments (org/leaf, not org/workspace/leaf) — every
// segment-splitting face of a session identity must round-trip it.
ok(assertSessionIdShape(id) === id, 'a two-segment root identity passes assertSessionIdShape')
ok(sessionLeaf(id) === id.split('/')[1], 'sessionLeaf reads the leaf of a two-segment identity')
ok(dshSessionKey(id) === 'arxa-' + id.split('/').join('-'), 'dshSessionKey flattens a two-segment identity')
const s = openSession(root, { id, orgPath: root, name: 'scratch', workspace: '' })
ok(fs.existsSync(path.join(root, '.arxa', 'worktrees', id)) && git(s.worktree, 'branch', '--show-current') === 'arxa/' + id, 'root session gets a worktree and branch')
console.log('GREEN freestyle-routing (' + n + ')')
