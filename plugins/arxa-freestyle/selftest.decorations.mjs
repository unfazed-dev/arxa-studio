#!/usr/bin/env node
// Selftest: D117 decorations for a Freestyle root (F9). Real repo, real git.
//
// The Freestyle tree shows the ROOT working tree — session edits live in their
// own worktree under `.arxa` — so the baseline is HEAD, not `main`: "changed on
// disk, not committed yet". These assertions pin that meaning, because the
// letters are indistinguishable from the org tab's and the two answer different
// questions.
import assert from 'node:assert/strict'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { addRoot } from './lib/roots.js'
import { createFile } from './lib/files.js'
import { decorate, foldDirs } from '../git-workspace/lib/decorations.js'

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ok', n, '-', m) }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-fsdeco-'))
const env = { ...process.env, ARXA_HOME: path.join(tmp, 'home') }
const folder = path.join(tmp, 'R'); fs.mkdirSync(folder)
const root = addRoot(folder, { env })
// The map exactly as the state route builds it.
const deco = () => { const d = decorate(folder, { env, base: 'HEAD' }); return { ...d, dirs: foldDirs(d.files) } }

createFile(root, 'docs/keep.md', { env })
createFile(root, 'docs/gone.md', { env })
createFile(root, 'top.md', { env })
ok(git(folder, 'status', '--porcelain') === '' && Object.keys(deco().files).length === 0,
  'a root arxa just committed decorates nothing — clean means clean')

// The three states a Freestyle root actually reaches, all from outside arxa:
// an editor writing a file, a new file appearing, a file removed.
fs.writeFileSync(path.join(folder, 'top.md'), 'edited outside arxa\n')
fs.writeFileSync(path.join(folder, 'docs/fresh.md'), 'brand new\n')
fs.rmSync(path.join(folder, 'docs/gone.md'))

const d = deco()
ok(d.ok === true, 'the map reports ok on a real repo')
ok(d.files['top.md'] === 'M', 'an edited file decorates M')
ok(d.files['docs/fresh.md'] === 'A', 'an untracked file decorates A (git ? -> added)')
ok(d.files['docs/gone.md'] === 'D', 'a deleted file decorates D')
ok(d.files['docs/keep.md'] === void 0, 'an untouched file carries no letter')
ok(d.dirs['docs'] === 'M', 'a folder holding several kinds of change rolls up to M')

// The rollup is what makes a decoration survive collapsing the folder — without
// it, closing `docs` hides the only signal there is something in there.
fs.rmSync(path.join(folder, 'docs/fresh.md')); fs.rmSync(path.join(folder, 'docs/gone.md'), { force: true })
git(folder, 'checkout', '--', 'docs/gone.md')
fs.writeFileSync(path.join(folder, 'docs/keep.md'), 'one kind only\n')
ok(deco().dirs['docs'] === 'M', 'a folder with one modified child rolls up that letter')

// A session must not steal the tab's meaning: session worktrees are their own
// repos under .arxa, and nothing in there is a row in this tree.
fs.mkdirSync(path.join(folder, '.arxa/worktrees/pretend'), { recursive: true })
fs.writeFileSync(path.join(folder, '.arxa/worktrees/pretend/x.md'), 'session file\n')
ok(Object.keys(deco().files).every((p) => !p.startsWith('.arxa/')),
  'nothing under .arxa decorates — studio state is not the user\'s work')

// A folder the user added before it was ever a repo, or one whose repo is gone.
const bare = path.join(tmp, 'bare'); fs.mkdirSync(bare)
const dBare = decorate(bare, { env, base: 'HEAD' })
ok(dBare.ok === false && Object.keys(dBare.files).length === 0,
  'a non-repo root reports ok:false and decorates nothing — never "all clean"')

// The state route is the only way any of this reaches a row, and the baseline
// is the whole meaning: `main` would silently answer a different question on a
// tab whose rows are never a session's files.
const host = fs.readFileSync(new URL('./lib/index.js', import.meta.url), 'utf8')
ok(host.includes("base: 'HEAD'"), 'the state route decorates against HEAD, not main')
ok(host.includes('deco: decoFor(r, head)'), 'every root row carries its map')
ok(host.includes('if (!root.open || !repoOk) return null'),
  'a closed root pays nothing — its rows are not on screen')

fs.rmSync(tmp, { recursive: true, force: true })
console.log('arxa-freestyle decorations selftest: ' + n + ' checks OK')
