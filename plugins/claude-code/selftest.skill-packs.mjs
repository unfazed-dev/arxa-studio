// Selftest: skill-pack resolution (phase 2) and the option it puts on a turn.
//
// What matters here is what a BROKEN pack costs: nothing. A directory with no
// manifest, a manifest that is not JSON, a root that does not exist — each is
// skipped with a line in the log, never an exception on the turn path.
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ClaudeCodeAdapter } from './lib/adapter.js'
import { MANIFEST_REL, PACKS_DIRNAME, packName, resolveSkillPacks } from './lib/skill-packs.js'

let n = 0
const ok = (s) => { n++; console.log(`  ok ${s}`) }

const root = mkdtempSync(join(tmpdir(), 'arxa-skill-packs-'))
const pack = (dir, manifest) => {
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
  writeFileSync(join(dir, MANIFEST_REL), typeof manifest === 'string' ? manifest : JSON.stringify(manifest))
  return dir
}

try {
  const home = join(root, 'home')
  const app = join(root, 'app')
  const userPack = pack(join(home, PACKS_DIRNAME, 'designer'), { name: 'arxa-designer', version: '1.0.0' })
  const bundledPack = pack(join(app, PACKS_DIRNAME, 'lens'), { name: 'arxa-lens' })
  const shadowed = pack(join(app, PACKS_DIRNAME, 'designer-too'), { name: 'arxa-designer' })
  mkdirSync(join(home, PACKS_DIRNAME, 'not-a-pack'), { recursive: true })
  pack(join(home, PACKS_DIRNAME, 'broken'), '{ not json')
  pack(join(home, PACKS_DIRNAME, 'nameless'), { version: '2' })

  assert.equal(packName(userPack), 'arxa-designer')
  assert.equal(packName(join(home, PACKS_DIRNAME, 'broken')), undefined, 'unparseable manifest is not a pack')
  assert.equal(packName(join(home, PACKS_DIRNAME, 'nameless')), undefined, 'a manifest without a name is not a pack')
  assert.equal(packName('/no/such/dir'), undefined)
  ok('packName reads .claude-plugin/plugin.json and refuses everything else')

  const logs = []
  const packs = resolveSkillPacks({ env: { ARXA_HOME: home }, appRoot: app, log: (m) => logs.push(m) })
  assert.deepEqual(packs, [
    { type: 'local', path: userPack, skipMcpDiscovery: true },
    { type: 'local', path: bundledPack, skipMcpDiscovery: true },
  ], 'user packs before bundled ones; every pack loads with MCP discovery off')
  assert.ok(logs.some((m) => m.includes('not-a-pack')), 'a directory that is not a pack is logged, not thrown')
  assert.ok(logs.some((m) => m.includes(shadowed) && m.includes('already loaded')), 'a duplicate NAME from a later root is skipped')
  ok('roots scan in precedence order, duplicates and rubbish are skipped with a log')

  const pinned = resolveSkillPacks({ env: { ARXA_HOME: home, ARXA_SKILL_PACKS: `${shadowed}:${join(root, 'gone')}` }, appRoot: app, log: () => {} })
  assert.deepEqual(pinned.map((p) => p.path), [shadowed, bundledPack],
    'ARXA_SKILL_PACKS wins the name, a listed path that does not exist is skipped, and it is NOT exclusive — the other roots still contribute')
  ok('ARXA_SKILL_PACKS pins packs ahead of the standard roots')

  assert.deepEqual(resolveSkillPacks({ env: { ARXA_HOME: join(root, 'empty') }, log: () => {} }), [],
    'no roots, no packs, no throw')
  ok('an install with no packs resolves to nothing')

  // G5 (Task 16, Step 3): the DEFAULT bundled skill-pack set stays EMPTY —
  // the studio ships no packs inside the app bundle; the resolver's third
  // root is ready for the first that does. Asserted against the REAL app
  // root (the repo root, the same `studioRoot` index.mjs passes), with an
  // empty ARXA_HOME so only the bundled root can contribute.
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  assert.deepEqual(resolveSkillPacks({ env: { ARXA_HOME: join(root, 'empty') }, appRoot, log: () => {} }), [],
    'the shipped bundle contributes zero packs — the bundled set stays empty by policy')
  ok('the real app root bundles no skill packs (G5 policy)')

  // The turn option: absent entirely when there are no packs (never `plugins: []`,
  // which is a different statement to the SDK than "not configured").
  const mk = (skillPacks) => new ClaudeCodeAdapter({
    query: () => {}, probe: {}, ctx: { sandbox: {} }, binary: '/bin/claude', env: { PATH: '/x' }, version: '1', skillPacks,
  })
  const bare = mk(undefined).base({})
  assert.equal('plugins' in bare, false, 'no packs → the option is not sent')
  assert.deepEqual(bare.settingSources, [], 'D5 still holds: no filesystem settings')
  const loaded = mk(packs).base({})
  assert.deepEqual(loaded.plugins, packs, 'packs ride on every query() the adapter builds')
  assert.deepEqual(loaded.settingSources, [], 'packs are passed explicitly, they do not re-open settings discovery')
  ok('base() carries the packs and nothing else changes')

  console.log(`selftest.skill-packs: ${n} ok`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
