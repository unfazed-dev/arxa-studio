// arxa-artifact-viewer selftest — run: node plugins/artifact-viewer/selftest.mjs
// Task 1 scope: identity, settings guards (D82 cap + D81 token ceiling), and
// the WIRING CROSS-CHECK — the mcp-apps lesson is that a package-name mismatch
// between patch row, profile package.json, BY_NAME_PLUGINS and the packed-mode
// copy list silently loads nothing. These assertions make any of the four
// drifting a loud red.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(dirname(here)) // repo checkout root (selftests never run packed)

const mod = await import('./lib/index.js')

// 1. identity
assert.equal(mod.name, 'arxa-artifact-viewer', 'plugin name')
assert.equal(typeof mod.apply, 'function', 'apply is a function')
assert.equal(mod.TOKEN_TTL_CEILING_SECONDS, 120, 'D81 token ceiling is 120 s')

// 2. settings defaults + guards
assert.deepEqual(mod.defaultSettings(), { maxEditBytes: 5_000_000, tokenTtlSeconds: 120 })
const withDefaults = mod.SCHEMA({})
assert.equal(withDefaults.maxEditBytes, 5_000_000, 'schema applies maxEditBytes default')
assert.equal(withDefaults.tokenTtlSeconds, 120, 'schema applies tokenTtlSeconds default')
let ttlBehavior
try {
  const parsed = mod.SCHEMA({ tokenTtlSeconds: 999 })
  ttlBehavior = parsed.tokenTtlSeconds
} catch {
  ttlBehavior = 'rejected'
}
assert.ok(
  ttlBehavior === 'rejected' || ttlBehavior <= mod.TOKEN_TTL_CEILING_SECONDS,
  'a 999 s TTL must be rejected or clamped to the D81 ceiling, got: ' + ttlBehavior)

// 3. wiring cross-check (patch row <-> launcher <-> package name)
const pkg = JSON.parse(fs.readFileSync(join(here, 'package.json'), 'utf8'))
assert.equal(pkg.name, 'arxa-artifact-viewer')
assert.equal(pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform, 'web',
  'dsh.client declares platform web')
assert.ok(Array.isArray(pkg.dsh && pkg.dsh.client && pkg.dsh.client.inject) &&
  pkg.dsh.client.inject.length > 0, 'dsh.client declares its inject packages')
assert.ok(fs.existsSync(join(here, 'lib', 'client.js')), 'client half exists for discovery')

const patch = fs.readFileSync(join(root, 'profile', 'cordis.patch.yml'), 'utf8')
assert.match(patch, /- id: arxa-artifact-viewer\r?\n    name: arxa-artifact-viewer/,
  'patch row registers the plugin by package name')

const launcher = fs.readFileSync(join(root, 'bin', 'arxa-studio.mjs'), 'utf8')
assert.match(launcher, /'arxa-artifact-viewer':\s+\S*file:/,
  'profile package.json materializes the file: dep')
assert.match(launcher, /BY_NAME_PLUGINS = \[[^\]]*'arxa-artifact-viewer'/,
  'BY_NAME_PLUGINS carries the package name')
assert.match(launcher, /\['arxa-artifact-viewer',\s*artifactViewerDir\]/,
  'packed mode copies the plugin directory')

console.log('arxa-artifact-viewer selftest: GREEN')
