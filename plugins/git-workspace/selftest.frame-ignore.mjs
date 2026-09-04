#!/usr/bin/env node
// Selftest: the CI frame must be versioned by the org .gitignore.
// Regression for RESTO 2026-09-03 — the create-time whitelist contract
// (`/*` + `!/…` allow lines, orgIgnoreFor({ includeExisting: false }))
// never un-ignored check.sh or .github/, so wireFrameOnce's `git add`
// was a silent no-op, GitHub never saw a workflow, and the manifest still
// said frameWired: true. Covers:
//  1. orgIgnoreFor whitelist carries FRAME_UNIGNORE_LINES; the D37 default
//     is untouched (it never ignored them)
//  2. ensureFrameUnignored: appends the two lines to a whitelist ignore,
//     is idempotent, leaves a D37-default ignore alone, tolerates a
//     missing .gitignore
//  3. end to end in a real repo: with the fix, `git add check.sh .github`
//     tracks the files; on the pre-fix whitelist it does not (the exact
//     silent failure) and ensureFrameUnignored repairs it

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { ORG_GITIGNORE, FRAME_UNIGNORE_LINES, orgIgnoreFor, ensureFrameUnignored } from './lib/index.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-frame-ignore-'))
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const tracked = (cwd) => {
  try { git(cwd, 'ls-files', '--error-unmatch', '--', 'check.sh', '.github/workflows/ci.yml'); return true } catch { return false }
}
const seedFrame = (cwd) => {
  fs.mkdirSync(path.join(cwd, '.github', 'workflows'), { recursive: true })
  fs.writeFileSync(path.join(cwd, 'check.sh'), '#!/bin/sh\nexit 0\n')
  fs.writeFileSync(path.join(cwd, '.github', 'workflows', 'ci.yml'), 'on: push\n')
}
let n = 0
const ok = (msg) => { n++; console.log('  ok', n, msg) }

// 1. generator
{
  const wl = orgIgnoreFor({ includeExisting: false, managedDirs: ['notes', 'projects', 'account'] })
  for (const l of FRAME_UNIGNORE_LINES) assert.ok(wl.split('\n').includes(l), 'whitelist carries ' + l)
  assert.ok(!wl.includes('!/projects/') && !wl.includes('!/account/'), 'projects/account never whitelisted')
  assert.equal(orgIgnoreFor({ includeExisting: true }), ORG_GITIGNORE)
  assert.ok(!ORG_GITIGNORE.split('\n').includes('/*'), 'D37 default is not a whitelist')
  ok('orgIgnoreFor whitelist un-ignores the frame; D37 default unchanged')
}

// 2. ensureFrameUnignored on files
{
  const d = path.join(tmp, 'wl'); fs.mkdirSync(d)
  fs.writeFileSync(path.join(d, '.gitignore'), '/*\n!/.gitignore\n!/org.json\n') // pre-fix shape
  assert.deepEqual(ensureFrameUnignored(d), { changed: true })
  const lines = fs.readFileSync(path.join(d, '.gitignore'), 'utf8').split('\n')
  for (const l of FRAME_UNIGNORE_LINES) assert.ok(lines.includes(l))
  assert.equal(ensureFrameUnignored(d).changed, false, 'idempotent')
  assert.equal(ensureFrameUnignored(d).reason, 'already')
  ok('whitelist .gitignore patched once, idempotent')

  const e = path.join(tmp, 'd37'); fs.mkdirSync(e)
  fs.writeFileSync(path.join(e, '.gitignore'), ORG_GITIGNORE)
  assert.deepEqual(ensureFrameUnignored(e), { changed: false, reason: 'not-whitelist' })
  assert.equal(fs.readFileSync(path.join(e, '.gitignore'), 'utf8'), ORG_GITIGNORE)
  ok('D37 default left byte-identical')

  const f = path.join(tmp, 'none'); fs.mkdirSync(f)
  assert.deepEqual(ensureFrameUnignored(f), { changed: false, reason: 'no-gitignore' })
  ok('missing .gitignore tolerated')
}

// 3. real git: the silent no-op, then the repair
{
  const r = path.join(tmp, 'repo'); fs.mkdirSync(r)
  git(r, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(r, '.gitignore'), '/*\n!/.gitignore\n!/org.json\n') // pre-fix
  seedFrame(r)
  // git refuses explicitly-named ignored paths (exit 1, "use -f"); the
  // engine ran this through runGit(..., { allowFail: true }) and never
  // looked — that swallow is the RESTO failure.
  assert.throws(() => git(r, 'add', '--', 'check.sh', '.github'), /ignored/)
  assert.equal(tracked(r), false, 'pre-fix whitelist: frame files not tracked')
  assert.equal(ensureFrameUnignored(r).changed, true)
  git(r, 'add', '--', '.gitignore', 'check.sh', '.github')
  assert.equal(tracked(r), true, 'after repair: frame files tracked')
  ok('real repo: silent no-op reproduced, repaired by ensureFrameUnignored')

  const g = path.join(tmp, 'fresh'); fs.mkdirSync(g)
  git(g, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(g, '.gitignore'), orgIgnoreFor({ includeExisting: false, managedDirs: ['notes'] }))
  seedFrame(g)
  git(g, 'add', '--', 'check.sh', '.github')
  assert.equal(tracked(g), true, 'fresh whitelist from orgIgnoreFor tracks the frame')
  ok('fresh whitelist org tracks the frame without repair')
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`selftest.frame-ignore: ${n} checks passed`)
