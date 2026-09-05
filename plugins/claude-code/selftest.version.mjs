// readAppVersion must NEVER throw at plugin load: a throw here fails the whole dsh plugin tree
// and arxa studio does not boot at all. 2026-09-05: the packed sidecar payload
// (~/.arxa/engine/<hash>/arxa-studio) has no root package.json — only bin/packed.json — and a
// hard `require('../../package.json')` crash-looped the desktop watchdog 456 times.
// Run: node plugins/claude-code/selftest.version.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { readAppVersion } from './index.mjs'

const dir = (label) => mkdtempSync(join(tmpdir(), `ver-${label}-`))

const repo = dir('repo')
writeFileSync(join(repo, 'package.json'), '{"version":"9.9.9"}')

const packed = dir('packed')
mkdirSync(join(packed, 'bin'))
writeFileSync(join(packed, 'bin', 'packed.json'), '{"packedAt":"x","version":"0.1.0"}')

const oldPacked = dir('oldpacked')
mkdirSync(join(oldPacked, 'bin'))
writeFileSync(join(oldPacked, 'bin', 'packed.json'), '{"packedAt":"x"}')

const bare = dir('bare')

assert.equal(readAppVersion(repo), '9.9.9', 'repo package.json wins')
assert.equal(readAppVersion(packed), '0.1.0', 'packed payload: bin/packed.json version')
assert.equal(readAppVersion(oldPacked), 'unknown', 'packed.json without version -> unknown, no throw')
assert.equal(readAppVersion(bare), 'unknown', 'nothing at all -> unknown, no throw')
assert.match(readAppVersion(), /^\d+\.\d+\.\d+/, 'default root resolves the repo package.json')

console.log('selftest.version: 5/5 ok')
