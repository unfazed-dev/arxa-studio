#!/usr/bin/env node
// Selftest: Freestyle sessions (F5) — any folder, worktree of the enclosing repo, cwd inside it.
import assert from 'node:assert/strict'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { addRoot } from './lib/roots.js'
import { createDir, listTrash } from './lib/files.js'
import { createFreestyleSessions } from './lib/sessions.js'
import * as GW from '../git-workspace/lib/sessions.js'
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ok', n, '-', m) }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-fs-')); const env = { ...process.env, ARXA_HOME: path.join(tmp, 'home') }
const root = addRoot((() => { const p = path.join(tmp, 'R'); fs.mkdirSync(p); return p })(), { env })
const spawned = []; const dshBridge = { spawn: async (a) => { spawned.push(a); return { ok: true, id: 'dsh-' + a.id } }, list: async () => [] }
const S = createFreestyleSessions({ env, dshBridge })

const s1 = await S.newSession(root, '', 'scratch')
ok(s1.worktree === path.join(root.path, '.arxa', 'worktrees', s1.id) && s1.cwd === s1.worktree, 'root session: worktree under the root, cwd = worktree')
ok(spawned[0].cwd === s1.cwd && spawned[0].id === s1.id && spawned[0].rootId === root.id, 'dsh spawned in the worktree with the stable root namespace')
ok(s1.freestyleRootId === root.id, 'new session records explicit Freestyle root ownership')
createDir(root, 'docs/deep', { env })
const s2 = await S.newSession(root, 'docs/deep', 'write')
ok(s2.cwd === path.join(s2.worktree, 'docs', 'deep') && fs.existsSync(s2.cwd), 'folder session: cwd is the folder inside the worktree')
ok(/^r\/docs\/deep\/write-wt-/.test(s2.id), 'identity mirrors the disk path (slugged): ' + s2.id)
const l = S.list(root); ok(l.active.length === 2 && l.archived.length === 0, 'list sees two active')
fs.writeFileSync(path.join(s2.cwd, 'x.md'), 'x'); git(s2.worktree, 'add', '-A'); git(s2.worktree, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'feat: x')
const a = await S.archive(root, s2.id)
ok(!fs.existsSync(s2.worktree) && S.list(root).archived.length === 1, 'archive removes the worktree and parks/merges per D39')
await S.revive(root, s2.id); ok(fs.existsSync(path.join(root.path, '.arxa', 'worktrees', s2.id)) && S.list(root).archived.length === 0, 'revive rebuilds the worktree')
await assert.rejects(S.newSession(root, '../out', 'nope'), /outside-root/); ok(true, 'escaping relDir refuses')

// Freestyle accepts real folder names that Git cannot use verbatim in a ref.
// The registry keeps the raw workspace/cwd while only the session identity is
// encoded. Similar-looking names and a literal encoded-looking name must stay
// distinct, otherwise one root can mint the same DSH identity twice.
for (const rel of ['docs/My Notes', 'docs/My-Notes', 'docs/你好', 'docs/.draft', 'docs/arxa-fs--TXkgTm90ZXM']) {
  fs.mkdirSync(path.join(root.path, rel), { recursive: true })
}
const unusual = []
for (const rel of ['docs/My Notes', 'docs/My-Notes', 'docs/你好', 'docs/.draft', 'docs/arxa-fs--TXkgTm90ZXM']) {
  const session = await S.newSession(root, rel, rel === 'docs/My Notes' ? undefined : 'write')
  unusual.push(session)
  ok(session.workspace === rel && session.cwd === path.join(session.worktree, rel), `raw workspace and cwd survive identity encoding: ${rel}`)
  ok(GW.assertSessionIdShape(session.id) === session.id, `encoded identity remains a valid git session path: ${rel}`)
}
ok(new Set(unusual.map((session) => session.id)).size === unusual.length, 'spaces, Unicode, leading dots, safe lookalikes and the reserved escape prefix mint distinct identities')
ok(
  [0, 2, 3, 4].every((index) => /^r\/arxa-fs--[A-Za-z0-9_-]{43}\//.test(unusual[index].id)),
  'an unsafe or escape-prefixed workspace maps to one bounded hash component',
)
const unusualEntry = (() => {
  const session = unusual[0]
  S.archive(root, session.id)
  return { session, entry: S.trashArchived(root, session.id) }
})()
S.restoreTrash(root, unusualEntry.entry.entryId)
const unusualRestored = S.list(root).archived.find((session) => session.id === unusualEntry.session.id)
ok(unusualRestored?.workspace === 'docs/My Notes' && unusualRestored.worktree === unusualEntry.session.worktree, 'archive to Trash and restore preserves the raw workspace and worktree identity')

const longUnsafeLeaf = 'a'.repeat(200) + ' b'
const longUnsafeWorkspace = 'docs/' + longUnsafeLeaf
fs.mkdirSync(path.join(root.path, longUnsafeWorkspace), { recursive: true })
const longUnsafe = await S.newSession(root, longUnsafeWorkspace)
ok(
  longUnsafe.workspace === longUnsafeWorkspace
    && /^r\/arxa-fs--[A-Za-z0-9_-]{43}\//.test(longUnsafe.id)
    && longUnsafe.id.split('/').every((segment) => Buffer.byteLength(segment) <= 240),
  'a long unsafe folder keeps its raw workspace while every identity component stays bounded',
)
S.archive(root, longUnsafe.id)
const longUnsafeEntry = S.trashArchived(root, longUnsafe.id)
S.restoreTrash(root, longUnsafeEntry.entryId)
ok(S.list(root).archived.some((session) => session.id === longUnsafe.id && session.workspace === longUnsafeWorkspace), 'a long hashed workspace survives archive to Trash and restore')

const hashLookingWorkspace = 'docs/' + longUnsafe.id.split('/')[1]
fs.mkdirSync(path.join(root.path, hashLookingWorkspace), { recursive: true })
const hashLooking = await S.newSession(root, hashLookingWorkspace)
ok(hashLooking.id !== longUnsafe.id && hashLooking.workspace === hashLookingWorkspace, 'a literal hash-looking folder cannot collide with the workspace whose hash it resembles')

const longSafeWorkspace = 'docs/' + 'z'.repeat(240)
fs.mkdirSync(path.join(root.path, longSafeWorkspace), { recursive: true })
const longSafe = await S.newSession(root, longSafeWorkspace)
ok(
  longSafe.workspace === longSafeWorkspace
    && longSafe.id.split('/')[2].length === 240
    && Buffer.byteLength(longSafe.id.split('/').at(-1)) <= 160,
  'a valid 240-byte folder keeps its ordinary ID path and gets a bounded default leaf',
)

// IDs remain root-unique even when two nested repositories have folder names
// that collapse to the same ordinary slug. Repo-local worktrees do not make
// duplicate DSH identities safe because production scopes DSH by root + id.
const initNested = (name) => {
  const repo = path.join(root.path, name)
  fs.mkdirSync(repo)
  git(repo, '-c', 'init.defaultBranch=main', 'init', '-q')
  fs.writeFileSync(path.join(repo, 'seed.md'), name)
  git(repo, 'add', '-A')
  git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'chore: seed')
  return repo
}
const spacedNested = initNested('repo A')
const dashedNested = initNested('repo-A')
const nestedLookalikeA = await S.newSession(root, 'repo A', 'nested')
const nestedLookalikeB = await S.newSession(root, 'repo-A', 'nested')
ok(nestedLookalikeA.id !== nestedLookalikeB.id, 'slug-similar folders in different nested repositories keep distinct identities')
ok(nestedLookalikeA.workspace === 'repo A' && nestedLookalikeA.worktree.startsWith(spacedNested + path.sep), 'encoded nested workspace keeps its raw value and owning repo worktree')
ok(nestedLookalikeB.workspace === 'repo-A' && nestedLookalikeB.worktree.startsWith(dashedNested + path.sep), 'ordinary nested workspace keeps its existing identity and owning repo worktree')

// The escape prefix is reserved, including while validating mutable Trash
// markers. Otherwise a marker can reinterpret encoded `repo A` as a literal
// hash-looking workspace and redirect purge to that sibling repository.
const encodedRepoSegment = nestedLookalikeA.id.split('/')[1]
const encodedLiteralRepo = initNested(encodedRepoSegment)
S.archive(root, nestedLookalikeA.id)
const encodedEntry = S.trashArchived(root, nestedLookalikeA.id)
const encodedMarkerPath = path.join(root.path, '.arxa', 'trash', encodedEntry.entryId, 'entry.json')
const encodedMarker = JSON.parse(fs.readFileSync(encodedMarkerPath, 'utf8'))
git(encodedLiteralRepo, 'branch', encodedMarker.branch)
encodedMarker.repoPath = encodedRepoSegment
encodedMarker.session.workspace = encodedRepoSegment
encodedMarker.session.worktree = path.join(encodedLiteralRepo, '.arxa', 'worktrees', ...encodedMarker.session.id.split('/'))
fs.writeFileSync(encodedMarkerPath, JSON.stringify(encodedMarker, null, 2) + '\n')
await assert.rejects(S.purgeTrash(root, encodedEntry.entryId), /unknown-entry|repo-mismatch/)
ok(
  git(spacedNested, 'rev-parse', '--verify', encodedMarker.branch) !== ''
    && git(encodedLiteralRepo, 'rev-parse', '--verify', encodedMarker.branch) !== ''
    && listTrash(root).some((entry) => entry.id === encodedEntry.entryId),
  'the reserved prefix cannot redirect an encoded session purge to a literal-prefix repository',
)

// FIX4: a nested repo can carry session rows from a different org that
// happens to share the same repo — those foreign rows must never leak into
// this root's list (regression test for the leak fix that shipped without
// one).
const foreignRepo = path.join(root.path, 'foreign')
fs.mkdirSync(foreignRepo)
git(foreignRepo, '-c', 'init.defaultBranch=main', 'init', '-q')
fs.writeFileSync(path.join(foreignRepo, 'seed.md'), 'seed')
git(foreignRepo, 'add', '-A')
git(foreignRepo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'chore: seed')
const foreignId = GW.mintSessionPath({
  org: 'other-org', workspace: '', name: 'planted', sessions: GW.listSessions(foreignRepo, env), ghosts: [],
})
GW.openSession(foreignRepo, { id: foreignId, orgPath: foreignRepo, name: 'planted', workspace: '', env })
ok(!S.list(root).active.some((s) => s.id === foreignId), "a foreign nested-repo session does not leak into this root's list")
const collidingPrefixId = GW.mintSessionPath({
  org: 'r', workspace: '', name: 'planted-same-prefix', sessions: GW.listSessions(foreignRepo, env), ghosts: [],
})
GW.openSession(foreignRepo, { id: collidingPrefixId, orgPath: foreignRepo, name: 'planted-same-prefix', workspace: '', env })
GW.annotateSession(foreignRepo, collidingPrefixId, { freestyleRootId: 'different-root-uuid' }, env)
ok(!S.list(root).active.some((s) => s.id === collidingPrefixId), 'explicit root ownership beats a colliding legacy basename prefix')

// FIX2: sweep must aggregate over the same repo set list/archive/finish use
// — a session merged inside a nested repo, not just the root's own repo.
const clonePath = path.join(root.path, 'clone')
fs.mkdirSync(clonePath)
git(clonePath, '-c', 'init.defaultBranch=main', 'init', '-q')
fs.writeFileSync(path.join(clonePath, 'seed.md'), 'seed')
git(clonePath, 'add', '-A')
git(clonePath, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'chore: seed')
const s3 = await S.newSession(root, 'clone', 'temp')
ok(
  s3.worktree === path.join(clonePath, '.arxa', 'worktrees', ...s3.id.split('/')),
  'a nested repository owns its Freestyle session worktree under its own .arxa directory',
)
// Round 2: plant a merged session from a DIFFERENT org in this SAME nested
// repo. sweepMerged has no ownership filter of its own — sweep must report
// on neither array for it, and (the assertion that matters) must not
// finish it either, even though its branch is just as trivially merged.
const foreignCloneId = GW.mintSessionPath({
  org: 'other-org', workspace: '', name: 'planted-in-clone', sessions: GW.listSessions(clonePath, env), ghosts: [],
})
const foreignCloneSession = GW.openSession(clonePath, { id: foreignCloneId, orgPath: clonePath, name: 'planted-in-clone', workspace: '', env })
// A freshly-opened session's branch tip IS main's tip — trivially merged,
// no extra commits needed to make it a sweep candidate.
const dry = S.sweep(root, { dryRun: true })
ok(dry.finished.some((f) => f.id === s3.id && f.repoPath === clonePath), 'sweep(dryRun:true) reports the nested-repo session as mergeable')
ok(!dry.finished.some((f) => f.id === foreignCloneId) && !dry.skipped.some((f) => f.id === foreignCloneId), "dry-run sweep reports the foreign session in neither array — not this root's business")
ok(fs.existsSync(s3.worktree), 'dry-run touches nothing: worktree still there')
// sweep's default (unchanged by this fix) is dryRun:true, so an actual sweep
// needs dryRun:false explicit, same as finish.js's own sweepMerged.
const real = S.sweep(root, { dryRun: false })
const s3Result = real.finished.find((f) => f.id === s3.id && f.repoPath === clonePath)
ok(s3Result?.finished === true, "sweep(dryRun:false) actually finishes the nested-repo session, preserving finishSession's {finished:true,...} shape")
ok(!fs.existsSync(s3.worktree), 'sweep removed the nested-repo session worktree')
ok(!real.finished.some((f) => f.id === foreignCloneId) && !real.skipped.some((f) => f.id === foreignCloneId), 'real sweep still reports the foreign session in neither array')
ok(git(clonePath, 'branch', '--list', foreignCloneSession.branch).length > 0, "the foreign session's branch still exists — verified with git, not the return value")
// The FIX4 fixture (a different foreign session, planted earlier in
// foreign/, a separate nested repo) is just as trivially merged — free
// regression coverage that this fix protects EVERY nested repo, not just
// clone/. This is the exact session round 1's probe showed flipping to
// 'archived'; it must still read 'open' after a real sweep.
ok(GW.listSessions(foreignRepo, env).find((s) => s.id === foreignId)?.state === 'open', "sweep leaves the FIX4 foreign-repo session untouched too — regression pin for the round-1 bug")

// FIX3: a root whose folder name is not a valid git ref segment (spaces,
// punctuation) must still mint sessions — REF_SEGMENT_RE would otherwise
// throw on the very first session in a folder like "My Notes".
const spacedRoot = addRoot((() => { const p = path.join(tmp, 'My Notes'); fs.mkdirSync(p); return p })(), { env })
const s4 = await S.newSession(spacedRoot, '', 'note')
ok(/^my-notes\//.test(s4.id), 'space-named root slugs to a valid ref segment: ' + s4.id)
ok(S.list(spacedRoot).active.some((s) => s.id === s4.id), 'the slugged session comes back from list')

// Degenerate basename (slugs to ""): fall back to the root's own id rather
// than throwing.
const dotsRoot = addRoot((() => { const p = path.join(tmp, '...'); fs.mkdirSync(p); return p })(), { env })
const s5 = await S.newSession(dotsRoot, '', 'note')
ok(new RegExp('^root-' + dotsRoot.id.slice(0, 8) + '/').test(s5.id), 'degenerate root name falls back to the root id: ' + s5.id)
ok(S.list(dotsRoot).active.some((s) => s.id === s5.id), 'the fallback-keyed session comes back from list')

console.log('GREEN arxa-freestyle sessions (' + n + ')')
