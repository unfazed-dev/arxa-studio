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
import { BIN_FILES, binDeps, checkPackList, devOnlyDirs, devOnlyImports, hostTriple } from './pack-manifest.mjs'

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


// ---- 3. the target triple both packers stamp into the sidecar filename.
assert.equal(hostTriple('darwin', 'arm64'), 'aarch64-apple-darwin')
assert.equal(hostTriple('darwin', 'x64'), 'x86_64-apple-darwin')
assert.equal(hostTriple('linux', 'arm64'), 'aarch64-unknown-linux-gnu')
assert.equal(hostTriple('linux', 'x64'), 'x86_64-unknown-linux-gnu')
assert.throws(() => hostTriple('win32', 'x64'), /unsupported platform/)
assert.throws(() => hostTriple('linux', 'ppc64'), /unsupported cpu/)
assert.match(hostTriple(), /^(aarch64|x86_64)-(apple-darwin|unknown-linux-gnu)$/, 'this host resolves to a real triple')
ok('hostTriple covers both supported platforms and refuses the rest')

// ---- 4. the devDependency trim (2026-09-07).
// The payload used to ship all 290 dev-only trees (87 MB uncompressed). The
// exclusion is cheap; the danger is the other direction — dropping a package
// something loads at runtime, which cordis only discovers on the user's
// machine. These cover both halves.
{
  const dir = mkdtempSync(join(tmpdir(), 'arxa-devtrim-'))
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { keep: '1', '@deepseek-ai/dsh': '1' } }))
    const abs = (...p) => join(dir, ...p)
    const run = (_root, args) => (args.includes('--omit=dev')
      ? [dir, abs('node_modules', 'keep'), abs('node_modules', '@deepseek-ai', 'dsh'), abs('node_modules', 'keep', 'node_modules', 'nested')]
      : [dir, abs('node_modules', 'keep'), abs('node_modules', '@deepseek-ai', 'dsh'), abs('node_modules', 'keep', 'node_modules', 'nested'),
         abs('node_modules', 'devtool'), abs('node_modules', 'devtool', 'node_modules', 'deep'), abs('node_modules', '@scope', 'devbit')]
    ).join('\n') + '\n'

    const drop = devOnlyDirs(dir, run)
    assert.deepEqual(drop, [join('node_modules', '@scope', 'devbit'), join('node_modules', 'devtool')],
      'only the TOP-most dev-only dirs — excluding a dir takes its children with it')
    ok('devOnlyDirs: dev-only trees, top-most only, prod trees untouched')

    // Truncated `npm ls` output is the silent hazard: a short keep set makes
    // the complement swallow production packages.
    const truncated = (_root, args) => (args.includes('--omit=dev') ? [dir].join('\n') : run(_root, args))
    assert.throws(() => devOnlyDirs(dir, truncated), /truncated output/, 'a keep set missing a direct dependency must throw, not drop it')
    ok('devOnlyDirs: refuses to build an exclude list from truncated npm output')

    mkdirSync(join(dir, 'bin'), { recursive: true })
    mkdirSync(join(dir, 'profile'), { recursive: true })
    writeFileSync(join(dir, 'bin', 'ok.mjs'), "import { x } from 'keep'\nimport fs from 'node:fs'\n")
    writeFileSync(join(dir, 'profile', 'prose.yml'), '# devtool is mentioned in prose and must not count\n- id: keep\n')
    assert.deepEqual(devOnlyImports(dir, drop), [], 'prod imports and prose are clean')

    writeFileSync(join(dir, 'bin', 'bad.mjs'), "import('devtool')\n")
    writeFileSync(join(dir, 'profile', 'rows.yml'), "- id: '@scope/devbit'\n")
    const hits = devOnlyImports(dir, drop)
    assert.deepEqual(hits.map((h) => h.pkg).sort(), ['@scope/devbit', 'devtool'],
      'a JS specifier AND a cordis `- id:` row both count — the profile resolves plugins by name at boot')
    ok('devOnlyImports: catches a dropped package in JS and in a profile id row')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---- 5. the live tree: nothing the engine loads lives in a dev-only package.
// This is the gate. The day a plugin imports something that only @wdio/cli
// installs, it goes red HERE instead of on a user's machine after install.
{
  const drop = devOnlyDirs(root)
  assert.ok(drop.length > 0, 'this repo has devDependencies, so the drop set cannot be empty')
  const refs = devOnlyImports(root, drop)
  assert.deepEqual(refs, [],
    `runtime code references dev-only packages: ${refs.map((r) => `${r.pkg} ← ${r.file}`).join(', ')}\n` +
    '  → move it into "dependencies", or the packed sidecar dies on ERR_MODULE_NOT_FOUND.')
  ok(`live: ${drop.length} dev-only trees are excluded from the payload and nothing loads them`)
}

console.log(`pack-list-check: ${n} ok`)
