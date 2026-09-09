#!/usr/bin/env node
// Selftest: arxa-freestyle roots registry (F1, F4, F8) against real git in a temp HOME.
import assert from 'node:assert/strict'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { resolveInside, registryPath, manifestPath } from './lib/paths.js'
import { addRoot, newRoot, listRoots, openRoot, closeRoot, forgetRoot, renameRoot, readManifest, rootById } from './lib/roots.js'
import { isRepo, hasHead } from '../git-workspace/lib/repos.js'
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ok', n, '-', m) }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-fs-'))
const env = { ...process.env, ARXA_HOME: path.join(tmp, 'home') }

const folder = path.join(tmp, 'Scratch'); fs.mkdirSync(folder); fs.writeFileSync(path.join(folder, 'a.txt'), 'a')
const r = addRoot(folder, { env })
ok(r.id && r.name === 'Scratch' && r.path === folder && r.open === true, 'addRoot registers, names from the folder, opens')
ok(isRepo(folder) && hasHead(folder), 'addRoot inits a repo on main (F4)')
ok(fs.existsSync(path.join(folder, 'check.sh')) && !fs.existsSync(path.join(folder, '.github')), 'addRoot writes check.sh only (F8)')
ok(readManifest(r).kind === 'freestyle' && readManifest(r).localOnly === true, 'manifest at <root>/.arxa/freestyle.json')
ok(fs.existsSync(registryPath(env)), 'registry at ~/.arxa/freestyle.json')
ok(addRoot(folder, { env }).id === r.id && listRoots({ env }).length === 1, 'adding the same folder twice is idempotent')

const r2 = newRoot(tmp, 'Fresh', { env })
ok(fs.existsSync(path.join(tmp, 'Fresh')) && isRepo(r2.path) && listRoots({ env }).length === 2, 'newRoot mkdirs then adds')
assert.throws(() => newRoot(tmp, 'Fresh', { env }), /exists/); ok(true, 'newRoot refuses an existing folder')

closeRoot(r.id, { env }); ok(rootById(r.id, { env }).open === false, 'closeRoot flips open')
openRoot(r.id, { env }); ok(rootById(r.id, { env }).open === true && rootById(r.id, { env }).lastOpenedAt, 'openRoot flips open and stamps')
renameRoot(r.id, 'Notes', { env }); ok(rootById(r.id, { env }).name === 'Notes' && readManifest(rootById(r.id, { env })).name === 'Notes' && path.basename(rootById(r.id, { env }).path) === 'Scratch', 'rename is display-only, folder untouched')
forgetRoot(r.id, { env }); ok(!rootById(r.id, { env }) && fs.existsSync(folder), 'forget drops the row and never deletes the folder')

// FIX 2 coverage: a raw env object (not wrapped in { env }) passed where
// opts goes must throw loudly, not silently fall through to process.env and
// hit the real ~/.arxa/freestyle.json.
assert.throws(() => openRoot(r2.id, env), /roots\.js takes \{ env \}/)
ok(true, 'passing a raw env bag instead of { env } throws instead of silently hitting the real registry')

ok(resolveInside(folder, 'docs/x.md').abs === path.join(folder, 'docs', 'x.md'), 'resolveInside keeps a normal path')
for (const bad of ['../x', '/etc/passwd', '.git/config', '.arxa/freestyle.json', 'a/../../b']) { assert.throws(() => resolveInside(folder, bad)); }
ok(true, 'resolveInside rejects escapes and reserved dirs')

// Not in the brief's test — added because the realpath-vs-path.resolve split
// (see task-3-report.md, deviation 2) is a rewrite of a security check and
// needs its own coverage beyond the syntactic-escape cases above.
const outside = path.join(tmp, 'Outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'secret.txt'), 's')
fs.symlinkSync(outside, path.join(folder, 'link'))
assert.throws(() => resolveInside(folder, 'link/secret.txt'), /outside-root/)
ok(true, 'resolveInside rejects a symlink inside the root pointing outside it')

// FIX 1 coverage: a symlink INSIDE the root under a non-reserved name that
// points AT a reserved dir must be refused too — not just symlinks that
// leave the root entirely (the case above).
fs.symlinkSync(path.join(folder, '.git'), path.join(folder, 'alias'))
assert.throws(() => resolveInside(folder, 'alias/config'), /reserved/)
ok(true, 'resolveInside refuses a within-root symlink alias to a reserved dir')

const rootSelf = resolveInside(folder, '')
ok(rootSelf.abs === folder && rootSelf.rel === '', "resolveInside(root, '') addresses the root itself")

console.log('GREEN arxa-freestyle roots (' + n + ')')
