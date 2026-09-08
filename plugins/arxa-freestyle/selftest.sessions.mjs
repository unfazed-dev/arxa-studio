#!/usr/bin/env node
// Selftest: Freestyle sessions (F5) — any folder, worktree of the enclosing repo, cwd inside it.
import assert from 'node:assert/strict'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { addRoot } from './lib/roots.js'
import { createDir } from './lib/files.js'
import { createFreestyleSessions } from './lib/sessions.js'
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ok', n, '-', m) }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-fs-')); const env = { ...process.env, ARXA_HOME: path.join(tmp, 'home') }
const root = addRoot((() => { const p = path.join(tmp, 'R'); fs.mkdirSync(p); return p })(), { env })
const spawned = []; const dshBridge = { spawn: async (a) => { spawned.push(a); return { ok: true, id: 'dsh-' + a.id } }, list: async () => [] }
const S = createFreestyleSessions({ env, dshBridge })

const s1 = await S.newSession(root, '', 'scratch')
ok(s1.worktree === path.join(root.path, '.arxa', 'worktrees', s1.id) && s1.cwd === s1.worktree, 'root session: worktree under the root, cwd = worktree')
ok(spawned[0].cwd === s1.cwd && spawned[0].id === s1.id, 'dsh spawned in the worktree')
createDir(root, 'docs/deep', { env })
const s2 = await S.newSession(root, 'docs/deep', 'write')
ok(s2.cwd === path.join(s2.worktree, 'docs', 'deep') && fs.existsSync(s2.cwd), 'folder session: cwd is the folder inside the worktree')
ok(/^R\/docs\/deep\/write-wt-/.test(s2.id), 'identity mirrors the disk path: ' + s2.id)
const l = S.list(root); ok(l.active.length === 2 && l.archived.length === 0, 'list sees two active')
fs.writeFileSync(path.join(s2.cwd, 'x.md'), 'x'); git(s2.worktree, 'add', '-A'); git(s2.worktree, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'feat: x')
const a = await S.archive(root, s2.id)
ok(!fs.existsSync(s2.worktree) && S.list(root).archived.length === 1, 'archive removes the worktree and parks/merges per D39')
await S.revive(root, s2.id); ok(fs.existsSync(path.join(root.path, '.arxa', 'worktrees', s2.id)) && S.list(root).archived.length === 0, 'revive rebuilds the worktree')
assert.rejects(S.newSession(root, '../out', 'nope'), /outside-root/); ok(true, 'escaping relDir refuses')
console.log('GREEN arxa-freestyle sessions (' + n + ')')
