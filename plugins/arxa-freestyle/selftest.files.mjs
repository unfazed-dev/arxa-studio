#!/usr/bin/env node
// Selftest: Freestyle file verbs + trash (F6, F9). Real repo, every verb leaves a commit.
import assert from 'node:assert/strict'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { addRoot } from './lib/roots.js'
import { createFile, createDir, renameEntry, moveEntry, duplicateEntry, trashEntry, listTrash, restoreEntry, purgeEntry, listDir } from './lib/files.js'
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ok', n, '-', m) }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-fs-')); const env = { ...process.env, ARXA_HOME: path.join(tmp, 'home') }
const folder = path.join(tmp, 'R'); fs.mkdirSync(folder); const root = addRoot(folder, { env })
const clean = () => git(folder, 'status', '--porcelain') === ''
const head = () => git(folder, 'rev-parse', 'HEAD')

let h = head()
createDir(root, 'docs', { env }); ok(fs.statSync(path.join(folder, 'docs')).isDirectory(), 'createDir')
createFile(root, 'docs/a.md', { env }); ok(fs.readFileSync(path.join(folder, 'docs/a.md'), 'utf8') === '' && clean() && head() !== h, 'createFile is empty and auto-committed')
assert.throws(() => createFile(root, 'docs/a.md', { env }), /exists/); ok(true, 'createFile refuses to clobber')
h = head(); renameEntry(root, 'docs/a.md', 'b.md', { env }); ok(fs.existsSync(path.join(folder, 'docs/b.md')) && !fs.existsSync(path.join(folder, 'docs/a.md')) && clean() && head() !== h, 'rename in place, committed')
assert.throws(() => renameEntry(root, 'docs/b.md', '../x.md', { env })); ok(true, 'rename cannot escape its folder')
createDir(root, 'archive', { env }); h = head(); moveEntry(root, 'docs/b.md', 'archive', { env }); ok(fs.existsSync(path.join(folder, 'archive/b.md')) && clean() && head() !== h, 'move, committed')
assert.throws(() => moveEntry(root, 'archive', 'archive', { env }), /into itself/); ok(true, 'cannot move a folder into itself')
const d1 = duplicateEntry(root, 'archive/b.md', { env }); const d2 = duplicateEntry(root, 'archive/b.md', { env })
ok(d1.rel === 'archive/b copy.md' && d2.rel === 'archive/b copy 2.md' && clean(), 'duplicate names like Finder')
const e = trashEntry(root, 'archive/b copy.md', { env })
ok(!fs.existsSync(path.join(folder, 'archive/b copy.md')) && fs.existsSync(path.join(folder, '.arxa/trash', e.id, 'b copy.md')) && listTrash(root).length === 1 && clean(), 'trash moves into .arxa/trash and commits the removal')
restoreEntry(root, e.id, { env }); ok(fs.existsSync(path.join(folder, 'archive/b copy.md')) && listTrash(root).length === 0, 'restore puts it back')
const e2 = trashEntry(root, 'archive', { env }); ok(listTrash(root)[0].kind === 'dir', 'folders trash too')
purgeEntry(root, e2.id, { env }); ok(listTrash(root).length === 0 && !fs.existsSync(path.join(folder, '.arxa/trash', e2.id)), 'purge is final')
const ls = listDir(root, '', { env }); ok(ls.dirs.includes('docs') && !ls.dirs.includes('.arxa') && !ls.dirs.includes('.git'), 'listDir hides studio state')
for (const bad of ['.git/HEAD', '.arxa/freestyle.json', '../x']) assert.throws(() => createFile(root, bad, { env })); ok(true, 'verbs refuse reserved and escaping paths')
console.log('GREEN arxa-freestyle files (' + n + ')')
