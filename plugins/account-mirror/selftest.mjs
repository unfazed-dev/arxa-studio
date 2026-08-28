#!/usr/bin/env node
// Selftest for arxa-account-mirror (phase 6 track b, D45/D37). Covers:
//  1. default refresh with no provider → empty-but-valid account/
//     (offline, no account, no network), files read-only 0444
//  2. refresh is idempotent — second run is byte-for-byte identical
//  3. billing artifacts from an injected provider land read-only,
//     including nested paths
//  4. re-refresh overwrites existing read-only files with new content
//  5. second refresh with fewer artifacts prunes stale files (and their
//     now-empty dirs) but never touches non-mirror files in account/
//  6. git: org repo status shows NOTHING from account/ content, even
//     after `git add -A`; info/exclude carries the D37 choke point
//  7. remote provider stub throws typed errors, performs no I/O, and a
//     failed fetch leaves the previous mirror intact
//  8. provider artifact validation rejects escaping/reserved paths
// Runs against a throwaway workspace under a temp dir.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { scaffoldOrg } from '../workspace/lib/index.js'
import { initOrgRepo, runGit } from '../git-workspace/lib/index.js'
import {
  ACCOUNT_DIR,
  MIRROR_MANIFEST,
  createLocalProvider,
  RemoteAccountProvider,
  ProviderNotImplementedError,
  InvalidArtifactError,
  refreshAccountMirror,
} from './lib/index.js'

let passed = 0
async function ok(label, fn) {
  await fn()
  passed += 1
  console.log(`ok ${passed} - ${label}`)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-account-mirror-selftest-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

const mode = (p) => fs.statSync(p).mode & 0o777
const snapshot = (dir) => {
  const out = {}
  for (const entry of fs.readdirSync(dir, { recursive: true })) {
    const abs = path.join(dir, entry)
    if (fs.statSync(abs).isFile()) out[entry] = { content: fs.readFileSync(abs, 'utf8'), mode: mode(abs) }
  }
  return out
}

const billingProvider = (artifacts) => ({ name: 'test-billing', fetchArtifacts: async () => artifacts })
const fullSet = [
  { path: 'plan.md', content: '# Plan\n\npro (annual)\n' },
  { path: 'entitlements.json', content: '{ "seats": 5 }\n' },
  { path: 'invoices/2026-001.md', content: '# Invoice 2026-001\n' },
  { path: 'invoices/2026-002.md', content: '# Invoice 2026-002\n' },
]

// ---- offline org: no git involved at all --------------------------------
const wsA = path.join(tmp, 'ws-offline')
fs.mkdirSync(wsA, { recursive: true })
const orgA = scaffoldOrg(wsA, 'Offline Org').path

await ok('default refresh (no provider) renders empty-but-valid account/, no git required', async () => {
  const result = await refreshAccountMirror(orgA)
  assert.deepEqual(result.written, ['README.md'])
  assert.equal(result.excluded, false) // not a git repo — still fully functional
  const readme = path.join(orgA, ACCOUNT_DIR, 'README.md')
  assert.match(fs.readFileSync(readme, 'utf8'), /No arxa account is connected/)
  assert.equal(mode(readme), 0o444)
  assert.equal(mode(path.join(orgA, ACCOUNT_DIR, MIRROR_MANIFEST)), 0o444)
})

await ok('refresh is idempotent — repeat run leaves account/ byte-for-byte identical', async () => {
  const before = snapshot(path.join(orgA, ACCOUNT_DIR))
  const result = await refreshAccountMirror(orgA, createLocalProvider())
  assert.deepEqual(result.removed, [])
  assert.deepEqual(snapshot(path.join(orgA, ACCOUNT_DIR)), before)
})

await ok('injected provider artifacts land read-only, nested dirs included', async () => {
  const result = await refreshAccountMirror(orgA, billingProvider(fullSet))
  assert.deepEqual(result.written, ['entitlements.json', 'invoices/2026-001.md', 'invoices/2026-002.md', 'plan.md'])
  for (const rel of result.written) {
    assert.equal(mode(path.join(orgA, ACCOUNT_DIR, rel)), 0o444)
  }
  assert.equal(fs.readFileSync(path.join(orgA, ACCOUNT_DIR, 'plan.md'), 'utf8'), '# Plan\n\npro (annual)\n')
  // README came from the previous provider — stale now, pruned
  assert.deepEqual(result.removed, ['README.md'])
  assert.equal(fs.existsSync(path.join(orgA, ACCOUNT_DIR, 'README.md')), false)
})

await ok('refresh rewrites existing read-only files with changed content', async () => {
  const updated = fullSet.map((a) => (a.path === 'plan.md' ? { path: a.path, content: '# Plan\n\nteam (monthly)\n' } : a))
  await refreshAccountMirror(orgA, billingProvider(updated))
  const plan = path.join(orgA, ACCOUNT_DIR, 'plan.md')
  assert.equal(fs.readFileSync(plan, 'utf8'), '# Plan\n\nteam (monthly)\n')
  assert.equal(mode(plan), 0o444)
})

await ok('fewer artifacts → stale files pruned, empty dirs removed, non-mirror files untouched', async () => {
  const secret = path.join(orgA, ACCOUNT_DIR, 'user-secret.txt') // D28-style non-mirror resident
  fs.writeFileSync(secret, 'keep me\n')
  const result = await refreshAccountMirror(orgA, billingProvider([fullSet[0]])) // plan.md only
  assert.deepEqual(result.written, ['plan.md'])
  assert.deepEqual(result.removed, ['entitlements.json', 'invoices/2026-001.md', 'invoices/2026-002.md'])
  assert.equal(fs.existsSync(path.join(orgA, ACCOUNT_DIR, 'invoices')), false) // empty dir pruned
  assert.equal(fs.readFileSync(secret, 'utf8'), 'keep me\n') // never deleted
})

// ---- git org: D37 exclusion ---------------------------------------------
const wsB = path.join(tmp, 'ws-git')
fs.mkdirSync(wsB, { recursive: true })
const orgB = scaffoldOrg(wsB, 'Git Org').path
initOrgRepo(orgB)

await ok('git status shows NOTHING from account/ content, even after add -A', async () => {
  const result = await refreshAccountMirror(orgB, billingProvider(fullSet))
  assert.equal(result.excluded, true)
  const status = runGit(['status', '--porcelain'], { cwd: orgB }) ?? ''
  assert.equal(status.split('\n').filter((l) => l.includes('account')).length, 0)
  runGit(['add', '-A'], { cwd: orgB })
  const staged = runGit(['diff', '--cached', '--name-only'], { cwd: orgB }) ?? ''
  assert.equal(staged.split('\n').filter((l) => l.includes('account')).length, 0)
  runGit(['reset'], { cwd: orgB })
  const tracked = runGit(['ls-files', ACCOUNT_DIR], { cwd: orgB }) ?? ''
  assert.equal(tracked.trim(), '')
})

await ok('info/exclude choke point carries /account/ exactly once across refreshes', async () => {
  await refreshAccountMirror(orgB, billingProvider(fullSet))
  const excludeFile = path.join(orgB, '.git', 'info', 'exclude')
  const lines = fs.readFileSync(excludeFile, 'utf8').split('\n')
  assert.equal(lines.filter((l) => l === '/account/').length, 1)
})

// ---- remote stub + validation -------------------------------------------
await ok('remote provider stub throws typed error and a failed fetch leaves the mirror intact', async () => {
  const stub = new RemoteAccountProvider({ baseUrl: 'https://api.arxa.example', token: 'unused' })
  await assert.rejects(() => stub.fetchArtifacts(), ProviderNotImplementedError)
  const before = snapshot(path.join(orgA, ACCOUNT_DIR))
  await assert.rejects(() => refreshAccountMirror(orgA, stub), ProviderNotImplementedError)
  assert.deepEqual(snapshot(path.join(orgA, ACCOUNT_DIR)), before)
})

await ok('escaping and reserved artifact paths are rejected before any write', async () => {
  const before = snapshot(path.join(orgA, ACCOUNT_DIR))
  for (const bad of ['../evil.md', '/abs.md', 'a/../../b.md', MIRROR_MANIFEST]) {
    await assert.rejects(
      () => refreshAccountMirror(orgA, billingProvider([{ path: bad, content: 'x' }])),
      InvalidArtifactError,
    )
  }
  assert.deepEqual(snapshot(path.join(orgA, ACCOUNT_DIR)), before)
})

await ok('provider seam contract enforced: provider must expose fetchArtifacts()', async () => {
  await assert.rejects(() => refreshAccountMirror(orgA, {}), TypeError)
  await assert.rejects(() => refreshAccountMirror(path.join(tmp, 'nope')), TypeError)
})

console.log(`\narxa-account-mirror selftest: ${passed} passed`)
