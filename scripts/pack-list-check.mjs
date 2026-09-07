#!/usr/bin/env node
// pack-list-check — the packed sidecar's bin/ list vs what the launcher loads.
//
// Two halves, both offline:
//   1. FIXTURES — the scanner itself (static import, dynamic import, a bare
//      filename literal joined to a dir, a comment that must NOT count).
//   2. LIVE — the real bin/ tree against BIN_FILES. A file the launcher loads
//      but the pack list misses is RED here instead of a sidecar that dies on
//      ERR_MODULE_NOT_FOUND after a two-minute build and an app install.
import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BIN_FILES, binDeps, checkPackList } from './pack-manifest.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
let n = 0
const ok = (s) => { n++; console.log(`  ok ${s}`) }

// ---- 1. the scanner, on a fixture bin/.
const dir = mkdtempSync(join(tmpdir(), 'arxa-pack-list-'))
try {
  const bin = join(dir, 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'entry.mjs'), [
    "// mentions dev-only.mjs in a comment — must not count",
    "/* nor a block comment about dev-only.mjs */",
    "import { a } from './static.mjs'",
    "const loader = ['--import', pathToFileURL(join(here, 'literal.mjs')).href]",
    "await import('./dynamic.mjs')",
    "import fs from 'node:fs'",
  ].join('\n'))
  writeFileSync(join(bin, 'static.mjs'), "import './nested.mjs'\n")
  writeFileSync(join(bin, 'nested.mjs'), 'export const x = 1\n')
  writeFileSync(join(bin, 'literal.mjs'), 'export const y = 1\n')
  writeFileSync(join(bin, 'dynamic.mjs'), 'export const z = 1\n')
  writeFileSync(join(bin, 'dev-only.mjs'), 'export const dev = 1\n')
  writeFileSync(join(bin, 'unreferenced.mjs'), 'export const u = 1\n')

  assert.deepEqual(binDeps(bin, 'entry.mjs'),
    ['dynamic.mjs', 'entry.mjs', 'literal.mjs', 'nested.mjs', 'static.mjs'],
    'static, dynamic, literal and transitive loads count; comments and node: builtins do not')
  ok('scan: static + dynamic + bare-literal + transitive, comments ignored')

  const partial = checkPackList(dir, ['entry.mjs', 'static.mjs', 'stale.mjs'], 'entry.mjs')
  assert.deepEqual(partial.missing, ['dynamic.mjs', 'literal.mjs', 'nested.mjs'], 'loaded but not packed → fatal')
  assert.deepEqual(partial.unused, ['stale.mjs'], 'packed but unreachable → warning')
  ok('checkPackList names both directions of drift')

  // A file that exists nowhere is simply not a dependency (no throw).
  writeFileSync(join(bin, 'entry.mjs'), "import './gone.mjs'\n")
  assert.deepEqual(binDeps(bin, 'entry.mjs'), ['entry.mjs'], 'a specifier with no file on disk is skipped')
  ok('scan: a missing target does not throw')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// ---- 2. the live tree.
const live = checkPackList(root)
assert.deepEqual(live.missing, [],
  `bin/ files the launcher loads but scripts/pack-manifest.mjs does not pack: ${live.missing.join(', ')}\n` +
  '  → add them to BIN_FILES, or the packed sidecar dies on boot with ERR_MODULE_NOT_FOUND.')
assert.ok(live.reachable.includes('arxa-studio.mjs'), 'the launcher itself is reachable')
for (const f of live.unused) console.log(`  warn ${f} is packed but nothing under bin/ loads it (computed load? stale entry?)`)
ok(`live pack list matches the launcher's loads (${live.reachable.length} files: ${live.reachable.join(', ')})`)


console.log(`pack-list-check: ${n} ok`)
