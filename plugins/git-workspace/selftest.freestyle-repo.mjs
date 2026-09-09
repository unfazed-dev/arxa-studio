#!/usr/bin/env node
// Selftest: Freestyle repo init + generic check.sh (F4, F8).
//
// Freestyle (D-plan git-workspace/freestyle-section): any folder can be a
// Freestyle root — no org/project layout, no stage/track assumptions, and
// (unlike an org repo) never the org .gitignore. initPlainRepo makes the
// folder a repo without imposing anything on its contents; freestyleCheckSh
// is a green-by-absence gate that probes for a stack at the root instead of
// assuming one.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { initPlainRepo, isRepo, hasHead } from './lib/repos.js'
import { runGit } from './lib/run.js'
import { freestyleCheckSh, writeFrameFiles, frameStatus, readStamp } from './lib/frame.js'

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
let n = 0
const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ok', n, '-', m) }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-fs-'))

// 1. plain folder → repo on main with one commit, .arxa excluded, NO org .gitignore
const a = path.join(tmp, 'a'); fs.mkdirSync(a)
fs.writeFileSync(path.join(a, 'hello.txt'), 'hi')
const r1 = initPlainRepo(a)
ok(r1.created === true && isRepo(a) && hasHead(a), 'init creates a repo with a HEAD')
ok(git(a, 'branch', '--show-current') === 'main', 'default branch is main')
ok(!fs.existsSync(path.join(a, '.gitignore')), 'no org .gitignore is written into a user folder')
ok(fs.readFileSync(path.join(a, '.git', 'info', 'exclude'), 'utf8').includes('/.arxa/'), '.arxa/ is excluded')
ok(git(a, 'status', '--porcelain') === '', 'existing files are committed by the first commit')

// 2. existing repo is adopted untouched
const before = git(a, 'rev-parse', 'HEAD')
ok(initPlainRepo(a).created === false && git(a, 'rev-parse', 'HEAD') === before, 'second call is a no-op')

// A user-supplied linked worktree has a .git FILE and shares info/exclude.
// Remove the initializer's exclusion to reproduce adoption of an external repo.
fs.writeFileSync(path.join(a, '.git', 'info', 'exclude'), '# user rule\n*.local\n')
const linked = path.join(tmp, 'linked')
runGit(['worktree', 'add', '-b', 'linked', linked], { cwd: a })
fs.mkdirSync(path.join(linked, '.arxa'))
fs.writeFileSync(path.join(linked, '.arxa', 'private.json'), 'runtime metadata')
ok(initPlainRepo(linked).created === false, 'linked worktree is adopted without reinitializing')
ok(git(linked, 'status', '--porcelain') === '', 'linked worktree runtime metadata is excluded')
ok(fs.readFileSync(path.join(a, '.git', 'info', 'exclude'), 'utf8').includes('*.local'), 'existing user exclusion is preserved')
ok(git(linked, 'rev-parse', 'HEAD') === before, 'adopting a linked worktree preserves HEAD')

// 3. check.sh detects the stack at the root
const sh = freestyleCheckSh()
for (const m of ['package.json', 'pubspec.yaml', 'Cargo.toml', 'go.mod', 'pyproject.toml']) ok(sh.includes(m), 'check.sh probes ' + m)
ok(sh.includes('npm test') && sh.includes('flutter test') && sh.includes('cargo test') && sh.includes('go test') && sh.includes('pytest'), 'check.sh runs each stack test command')
ok(!sh.includes('00-') && !sh.includes('application') && !sh.includes('website'), 'no stage or track assumptions')

// 4. frame for kind freestyle: check.sh only
writeFrameFiles(a, 'freestyle')
ok(fs.existsSync(path.join(a, 'check.sh')) && !fs.existsSync(path.join(a, '.github')), 'freestyle frame writes check.sh and nothing GitHub-shaped')
ok(readStamp(fs.readFileSync(path.join(a, 'check.sh'), 'utf8')) !== null, 'check.sh carries the frame stamp')
ok(Object.values(frameStatus(a, 'freestyle')).every((s) => s === 'current'), 'frameStatus reports current')
writeFrameFiles(a, 'freestyle', { includeCiYml: true })
ok(fs.existsSync(path.join(a, '.github', 'workflows', 'ci.yml')), 'includeCiYml adds ci.yml for publish time')
ok(fs.existsSync(path.join(a, '.github', 'pull_request_template.md')), 'includeCiYml also adds the PR template, same as org/project')

// 5. unknown frame kind is a loud programmer error, not a silent fallback
assert.throws(() => writeFrameFiles(a, 'bogus'), { name: 'TypeError', message: 'frame kind must be org|project|freestyle' }, 'unknown kind throws TypeError')

fs.rmSync(tmp, { recursive: true, force: true })
console.log('GREEN freestyle-repo (' + n + ')')
