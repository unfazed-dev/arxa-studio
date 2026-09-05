import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hashDir, platformSkew } from './arxa-engine-sync.mjs'

let n = 0; const ok = (s) => { n++; console.log(`  ok ${s}`) }
const mk = (files) => {
  const d = mkdtempSync(join(tmpdir(), 'arxa-sync-'))
  for (const [p, body] of Object.entries(files)) {
    const full = join(d, p); mkdirSync(join(full, '..'), { recursive: true }); writeFileSync(full, body)
  }
  return d
}

const a = mk({ 'lib/index.js': 'x', 'package.json': '{"version":"1.0.0"}' })
const b = mk({ 'lib/index.js': 'x', 'package.json': '{"version":"1.0.0"}' })
assert.equal(hashDir(a), hashDir(b)); ok('identical trees hash equal')

// THE regression: an edit with no version bump. The old version-keyed check saw
// 1.0.0 === 1.0.0 and shipped nothing while reporting success.
const c = mk({ 'lib/index.js': 'EDITED', 'package.json': '{"version":"1.0.0"}' })
assert.notEqual(hashDir(a), hashDir(c)); ok('an edited file changes the hash even when the version does not')

// A plugin with no package.json at all (claude-code, memory, pi-delegate) must still
// be comparable — the old check skipped these entirely, silently.
const d = mk({ 'index.mjs': 'y' })
assert.equal(typeof hashDir(d), 'string'); ok('a tree with no package.json still hashes')

// Renames must register: same bytes, different path.
const e = mk({ 'lib/other.js': 'x', 'package.json': '{"version":"1.0.0"}' })
assert.notEqual(hashDir(a), hashDir(e)); ok('a renamed file changes the hash')

// node_modules is a build product; its churn must not force a recopy.
const f = mk({ 'lib/index.js': 'x', 'package.json': '{"version":"1.0.0"}', 'node_modules/dep/i.js': 'junk' })
assert.equal(hashDir(a), hashDir(f)); ok('node_modules is excluded')

// THE 2026-09-05 regression: a dsh wave regenerated the repo plugins against
// new platform seed words; syncing them onto the old payload platform broke
// every webview ("missed the module table") and the next engine boot. The
// sync must refuse whenever the repo pin and the payload platform differ.
const repoTree = (pin) => ({ 'package.json': JSON.stringify({ dependencies: { '@deepseek-ai/dsh': pin } }) })
const engineTree = (ver) => ver === null ? {} : { 'node_modules/@deepseek-ai/dsh/package.json': JSON.stringify({ version: ver }) }
const g = mk(repoTree('0.1.2-rc.1')); const h = mk(engineTree('0.1.2-rc.1'))
assert.equal(platformSkew(g, h), null); ok('matching pin and payload platform: coherent')
const i = mk(engineTree('0.1.1-rc.2'))
assert.deepEqual(platformSkew(g, i), { repoPin: '0.1.2-rc.1', engineVer: '0.1.1-rc.2', reason: 'mismatch' }); ok('a platform wave across the payload: refused')
const j = mk(engineTree(null))
assert.equal(platformSkew(g, j).reason, 'unverifiable'); ok('an unreadable payload platform: refused')

for (const dir of [a, b, c, d, e, f, g, h, i, j]) rmSync(dir, { recursive: true, force: true })
console.log(`selftest.engine-sync: ${n} ok`)
