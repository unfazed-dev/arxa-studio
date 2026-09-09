#!/usr/bin/env node
// Selftest: arxa-freestyle roots registry (F1, F4, F8) against real git in a temp HOME.
import assert from 'node:assert/strict'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { resolveInside, registryPath, manifestPath } from './lib/paths.js'
import { addRoot, newRoot, createRoot, listRoots, openRoot, closeRoot, trashRoot, restoreRoot, purgeRoot, listRootTrash, renameRoot, setActiveTab, readManifest, writeManifest, rootById, disconnectRoot, syncRoot } from './lib/roots.js'
import { isRepo, hasHead, getOrigin, setOrigin } from '../git-workspace/lib/repos.js'
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

// createRoot: the org create contract (parity ruling 2026-09-09).
const r3 = await createRoot({ name: "Evan's Notes", path: tmp, link: false }, { env })
ok(r3.path === path.join(tmp, 'Evans-Notes') && r3.name === "Evan's Notes" && isRepo(r3.path) && listRoots({ env }).length === 3, 'createRoot makes parent + slug(name), keeps the display name')
ok(JSON.parse(fs.readFileSync(path.join(tmp, 'home', 'create-root.json'), 'utf8')).root === tmp, 'createRoot remembers the parent for the next modal')
await assert.rejects(() => createRoot({ name: 'Scratch', path: tmp, link: false }, { env }), /folder-exists/); ok(true, 'createRoot refuses a non-empty target')
fs.mkdirSync(path.join(tmp, 'Empty'))
const r4 = await createRoot({ name: 'Empty', path: tmp, link: false }, { env })
ok(r4.path === path.join(tmp, 'Empty') && isRepo(r4.path), 'createRoot adopts an existing EMPTY folder, like org.create-at')
await assert.rejects(() => createRoot({ name: '!!!', path: tmp, link: false }, { env }), /no slug/); ok(true, 'createRoot refuses a name that slugs to nothing')
await assert.rejects(() => createRoot({ name: 'Pub', path: tmp, link: true }, { env, github: { status: async () => ({ ok: true, linked: false }) } }), /linked-required/)
ok(listRoots({ env }).some((x) => x.name === 'Pub') && readManifest(listRoots({ env }).find((x) => x.name === 'Pub')).localOnly === true, 'link on an unlinked account: folder created local-only, modal told linked-required')

// Org parity: disconnect (keep / remove) and sync mirror lifecycle.js disconnectOne / syncRepoNow.
ok((await syncRoot(r3, { env })) === 'local', 'syncRoot on a local-only root says local')
ok((await disconnectRoot(r3, { env })).skipped === 'not-connected', 'disconnectRoot on a local-only root is a no-op')
writeManifest(r3, { localOnly: false, repoOwner: 'evan', repoName: 'evans-notes', repoUrl: 'https://github.com/evan/evans-notes' }); setOrigin(r3.path, 'https://github.com/evan/evans-notes', env)
const kept = await disconnectRoot(r3, { env, removeRepos: false })
ok(kept.ok && kept.removed === false && kept.repo === 'evan/evans-notes' && readManifest(r3).localOnly === true && readManifest(r3).repoUrl === null && getOrigin(r3.path, env) !== null, 'disconnect KEEP strips the link state and leaves origin for a later publish')
writeManifest(r3, { localOnly: false, repoOwner: 'evan', repoName: 'evans-notes', repoUrl: 'https://github.com/evan/evans-notes' })
const deleted = []
const removed = await disconnectRoot(r3, { env, removeRepos: true, github: { deleteRepo: async (o, n) => { deleted.push(o + '/' + n); return { ok: true } } } })
ok(removed.removed === true && deleted[0] === 'evan/evans-notes' && getOrigin(r3.path, env) === null, 'disconnect REMOVE deletes the GitHub repo and drops origin')
writeManifest(r3, { localOnly: false, repoOwner: 'evan', repoName: 'evans-notes', repoUrl: 'https://github.com/evan/evans-notes' })
await assert.rejects(() => disconnectRoot(r3, { env, removeRepos: true, github: { deleteRepo: async () => ({ ok: false, reason: '403' }) } }), /disconnect incomplete/)
ok(readManifest(r3).localOnly === false, 'a refused GitHub deletion leaves the folder connected')
ok((await syncRoot(r3, { env })) === 'no-creds' && (await syncRoot(r3, { env, github: { gitCredentials: async () => ({ ok: false }) } })) === 'no-creds', 'syncRoot without credentials reports no-creds, never throws')

closeRoot(r.id, { env }); ok(rootById(r.id, { env }).open === false, 'closeRoot flips open')
openRoot(r.id, { env }); ok(rootById(r.id, { env }).open === true && rootById(r.id, { env }).lastOpenedAt, 'openRoot flips open and stamps')
renameRoot(r.id, 'Notes', { env }); ok(rootById(r.id, { env }).name === 'Notes' && readManifest(rootById(r.id, { env })).name === 'Notes' && path.basename(rootById(r.id, { env }).path) === 'Scratch', 'rename is display-only, folder untouched')
trashRoot(r.id, { env }); ok(!rootById(r.id, { env }) && listRootTrash({ env }).length === 1 && fs.existsSync(folder), 'deleting a folder moves its row to the trash and never touches the folder')
restoreRoot(r.id, { env }); ok(rootById(r.id, { env }) && rootById(r.id, { env }).open === false && !listRootTrash({ env }).length, 'restore brings the row back, closed')
trashRoot(r.id, { env }); purgeRoot(r.id, { env }); ok(!rootById(r.id, { env }) && !listRootTrash({ env }).length && fs.existsSync(folder), 'purge drops the trashed row and STILL never deletes the folder')
// The registry reader is the only place that decides which keys survive a
// write: a key it drops is erased on the next mutation, not preserved. This
// catches that silently losing a user's trashed folder.
trashRoot(addRoot(folder, { env, name: 'Scratch' }).id, { env }); setActiveTab('freestyle', { env })
ok(listRootTrash({ env }).length === 1, 'the trashed row survives an unrelated registry write')

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
