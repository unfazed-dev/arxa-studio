#!/usr/bin/env node
// pack-cli.mjs — build the `arxa` CLI sidecar for the desktop bundle.
//
// The shell declares two externalBin entries (tauri.conf.json): `binaries/arxa-studio`
// (the engine, scripts/pack-sidecar.mjs) and `binaries/arxa` — this one, a
// `dart compile exe` of the sibling arxa repo's CLI. Tauri resolves both to
// `<name>-<target triple>`, so the triple comes from the same place the engine
// packer gets it (scripts/pack-manifest.mjs) and the two can never disagree.
//
// Usage:  node scripts/pack-cli.mjs [--out <path>] [--check]
//         --check verifies the inputs and the dart toolchain, then exits.
import { chmodSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostTriple } from './pack-manifest.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const studioRoot = resolve(here, '..')
const parentDir = dirname(studioRoot)
const arxaRepo = join(parentDir, 'arxa')
const cliPkg = join(arxaRepo, 'arxa')            // the Dart package root
const cliEntry = join(cliPkg, 'bin', 'arxa.dart')

const triple = hostTriple()
const outIdx = process.argv.indexOf('--out')
const outFile = outIdx >= 0
  ? resolve(process.argv[outIdx + 1])
  : join(arxaRepo, 'desktop', 'src-tauri', 'binaries', `arxa-${triple}`)
const checkOnly = process.argv.includes('--check')

for (const rel of [cliEntry, join(cliPkg, 'pubspec.yaml')]) {
  if (!existsSync(rel)) {
    console.error(`pack-cli: missing ${rel} — the sibling arxa repo must sit beside ${basename(studioRoot)}`)
    process.exit(1)
  }
}

const dartVersion = spawnSync('dart', ['--version'], { encoding: 'utf8' })
if (dartVersion.error || dartVersion.status !== 0) {
  console.error('pack-cli: no usable `dart` on PATH — install the Dart SDK (Arch: the SDK tarball; macOS: brew install dart-sdk)')
  process.exit(1)
}

if (checkOnly) {
  console.log(`pack-cli: --check OK — target ${triple}, ${(dartVersion.stdout || dartVersion.stderr).trim()}`)
  process.exit(0)
}

// `dart compile exe` needs the package's deps resolved, and .dart_tool is NOT
// portable: package_config.json holds absolute paths into the pub cache of the
// machine that wrote it. A tree copied to another machine (or a container)
// therefore resolves `package:path` to nothing and AOT dies with
// "Method not found: 'join'". Always resolve; it is a no-op when current.
{
  console.log('pack-cli: dart pub get …')
  const pub = spawnSync('dart', ['pub', 'get'], { cwd: cliPkg, stdio: 'inherit' })
  if (pub.status !== 0) { console.error('pack-cli: dart pub get failed'); process.exit(1) }
}

console.log(`pack-cli: dart compile exe → ${outFile}`)
mkdirSync(dirname(outFile), { recursive: true })
rmSync(outFile, { force: true })
const build = spawnSync('dart', ['compile', 'exe', cliEntry, '-o', outFile], { cwd: cliPkg, stdio: 'inherit' })
if (build.status !== 0) { console.error('pack-cli: dart compile exe failed'); process.exit(1) }
if (!existsSync(outFile) || statSync(outFile).size < 1024 * 1024) {
  console.error('pack-cli: dart produced an empty binary')
  process.exit(1)
}
chmodSync(outFile, 0o755)
console.log(`pack-cli: OK → ${outFile} (${(statSync(outFile).size / 1024 / 1024).toFixed(1)} MB)`)
