#!/usr/bin/env node
// Selftest: Freestyle file verbs + trash (F6, F9). Real repo, every verb leaves a commit.
import assert from 'node:assert/strict'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { addRoot } from './lib/roots.js'
import { createFile, createDir, renameEntry, moveEntry, duplicateEntry, trashEntry, listTrash, restoreEntry, purgeEntry, revealEntry, listDir } from './lib/files.js'
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
ok(!fs.existsSync(path.join(folder, 'archive/b copy.md')) && fs.existsSync(path.join(folder, '.arxa/trash', e.id, e.payloadName)) && listTrash(root).length === 1 && clean(), 'trash moves into .arxa/trash and commits the removal')
restoreEntry(root, e.id, { env }); ok(fs.existsSync(path.join(folder, 'archive/b copy.md')) && listTrash(root).length === 0, 'restore puts it back')
createFile(root, 'archive/c.md', { env }); const e3 = trashEntry(root, 'archive/c.md', { env })
createFile(root, 'archive/c.md', { env }); restoreEntry(root, e3.id, { env })
ok(fs.existsSync(path.join(folder, 'archive/c (restored).md')), 'restore collides -> lands at "<name> (restored)<ext>"')
const e2 = trashEntry(root, 'archive', { env }); ok(listTrash(root)[0].kind === 'dir', 'folders trash too')
purgeEntry(root, e2.id); ok(listTrash(root).length === 0 && !fs.existsSync(path.join(folder, '.arxa/trash', e2.id)), 'purge is final')
const ls = listDir(root, ''); ok(ls.dirs.includes('docs') && !ls.dirs.includes('.arxa') && !ls.dirs.includes('.git'), 'listDir hides studio state')
createDir(root, 'empty', { env }); const lsEmpty = listDir(root, 'empty')
ok(lsEmpty.dirs.length === 0 && lsEmpty.files.length === 0, 'freshly created folder lists as empty (.gitkeep hidden)')
ok(revealEntry(root, 'does-not-exist.md').ok === false, 'revealEntry returns { ok: false } for a missing path')
createFile(root, 'top.md', { env }) // committed in the root repo before `nested` exists, so its own add -A never has to look at an uncommitted embedded repo
fs.mkdirSync(path.join(folder, 'nested')); git(path.join(folder, 'nested'), 'init', '-b', 'main')
moveEntry(root, 'top.md', 'nested', { env })
ok(fs.existsSync(path.join(folder, 'nested/top.md')) && clean() && git(path.join(folder, 'nested'), 'status', '--porcelain') === '', 'cross-repo move commits both the source and destination repos')
for (const bad of ['.git/HEAD', '.arxa/freestyle.json', '../x']) assert.throws(() => createFile(root, bad, { env })); ok(true, 'verbs refuse reserved and escaping paths')

const outside = path.join(tmp, 'outside')
fs.mkdirSync(outside)
fs.writeFileSync(path.join(outside, 'entry.json'), '{}')
fs.writeFileSync(path.join(outside, 'sentinel'), 'keep')
assert.throws(() => purgeEntry(root, '../../../outside'), /unknown-entry/)
ok(fs.readFileSync(path.join(outside, 'sentinel'), 'utf8') === 'keep', 'purge traversal cannot delete an outside directory')
const trashRoot = path.join(folder, '.arxa', 'trash')
fs.symlinkSync(outside, path.join(trashRoot, 'alias'))
assert.throws(() => purgeEntry(root, 'alias'), /unknown-entry/)
ok(!listTrash(root).some(row => row.id === 'alias'), 'symlink trash entries are never exposed')
fs.unlinkSync(path.join(trashRoot, 'alias'))

createFile(root, 'again.md', { env })
const again = trashEntry(root, 'again.md', { env })
fs.writeFileSync(path.join(folder, 'again.md'), 'first')
fs.writeFileSync(path.join(folder, 'again (restored).md'), 'second')
restoreEntry(root, again.id, { env })
ok(fs.readFileSync(path.join(folder, 'again (restored).md'), 'utf8') === 'second' && fs.existsSync(path.join(folder, 'again (restored 2).md')), 'repeated restore never overwrites an existing copy')
for (const bad of ['nested/.git/unsafe', 'docs/.arxa/unsafe']) assert.throws(() => createFile(root, bad, { env }), /reserved/)
fs.symlinkSync(path.join(folder, 'nested', '.git'), path.join(folder, 'git-alias'))
assert.throws(() => createFile(root, 'git-alias/unsafe', { env }), /reserved/)
ok(!fs.existsSync(path.join(folder, 'nested', '.git', 'unsafe')), 'nested reserved paths and aliases are protected')

// Redirecting the entire trash directory must not redirect file mutations.
fs.renameSync(trashRoot, trashRoot + '-saved')
fs.symlinkSync(outside, trashRoot)
assert.throws(() => trashEntry(root, 'again.md', { env }), /unsafe-trash/)
ok(fs.existsSync(path.join(folder, 'again.md')) && fs.readFileSync(path.join(outside, 'sentinel'), 'utf8') === 'keep', 'symlink trash storage leaves source and outside files intact')
fs.unlinkSync(trashRoot)
fs.renameSync(trashRoot + '-saved', trashRoot)
fs.writeFileSync(path.join(folder, 'entry.json'), '{"user":"data"}')
const markerNamedFile = trashEntry(root, 'entry.json', { env })
restoreEntry(root, markerNamedFile.id, { env })
ok(fs.readFileSync(path.join(folder, 'entry.json'), 'utf8') === '{"user":"data"}', 'trashing entry.json preserves its contents separately from the trash marker')
fs.symlinkSync(path.join(folder, 'entry.json'), path.join(folder, 'data-link'))
const trashedLink = trashEntry(root, 'data-link', { env })
restoreEntry(root, trashedLink.id, { env })
ok(fs.lstatSync(path.join(folder, 'data-link')).isSymbolicLink() && fs.readFileSync(path.join(folder, 'data-link'), 'utf8') === '{"user":"data"}', 'restore preserves a valid within-root symlink without following it')
console.log('GREEN arxa-freestyle files (' + n + ')')
