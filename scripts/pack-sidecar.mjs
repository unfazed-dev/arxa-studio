#!/usr/bin/env node
// pack-sidecar.mjs — build the arxa studio engine sidecar as ONE Mach-O
// executable for the Tauri desktop shell.
//
// Why self-extracting instead of a plain `bun build --compile` of the
// launcher: the engine is not a bundleable module graph.
//   - bin/arxa-studio.mjs spawns a SECOND node process on
//     @deepseek-ai/dsh/lib/bin.js (with the loopback --import patch);
//   - dsh's cordis loader resolves plugins BY NAME at runtime from a profile
//     node_modules materialized under $HOME at boot — invisible to any
//     bundler (bun --compile, node SEA and deno compile all hit this wall;
//     the earlier bun attempt shipped exactly 1 module and broke, see
//     arxa/desktop/README.md);
//   - inside a compiled binary process.execPath is the binary itself, so the
//     child spawn would recurse instead of running node.
// So the ladder's honest top rung is: a bun-compiled entry that EMBEDS a
// tar.gz payload (this repo's runtime tree + the arxa gate file + a pinned
// real node binary), extracts it once to <ARXA_HOME>/engine/<sha12>, then
// spawns the extracted node on the extracted launcher. One file on disk, no
// pnpm / nvm / checkout dependency at runtime.
//
// Usage:  node scripts/pack-sidecar.mjs [--out <path>] [--check]
//         --check validates inputs and the bin/ pack list, then exits (no build).
// Default out: ../arxa/desktop/src-tauri/binaries/arxa-studio-<target-triple>
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { BIN_FILES, checkPackList, devOnlyDirs, devOnlyImports, hostTriple } from './pack-manifest.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const studioRoot = resolve(here, '..')            // .../arxa-studio
const parentDir = dirname(studioRoot)             // .../totem_labs
const studioName = basename(studioRoot)           // arxa-studio
const arxaGateRel = join('arxa', 'harness', 'pi', 'arxa-gate.ts')
// The profile's arxa-gate row (__ARXA_REPO__/harness/…) resolves inside the
// payload, so these ship with it — without them a packed app on any machine but
// the build host dies on ERR_MODULE_NOT_FOUND before serving anything.
const arxaHarnessRels = [join('arxa', 'harness', 'dsh-external-gate'), join('arxa', 'harness', 'verdict.sh')]

const triple = hostTriple()
const outIdx = process.argv.indexOf('--out')
const outFile = outIdx >= 0
  ? resolve(process.argv[outIdx + 1])
  : join(parentDir, 'arxa', 'desktop', 'src-tauri', 'binaries', `arxa-studio-${triple}`)

// Sanity: this script must run under real node — its execPath is what we pin
// into the payload as the engine's runtime.
const tarBin = ['/usr/bin/tar', '/bin/tar'].find((c) => existsSync(c)) ?? 'tar'

const nodeBin = process.execPath
if (!/node$/.test(nodeBin)) {
  console.error(`pack-sidecar: run me with node, not ${nodeBin} — the exec path is pinned into the payload`)
  process.exit(1)
}
// The pack list lives in scripts/pack-manifest.mjs, next to the scan that
// proves it still matches what bin/arxa-studio.mjs actually loads. Drift here
// is invisible in the repo (a checkout has all of bin/) and fatal in the
// bundle, so the check runs BEFORE the two-minute bun build — and again in CI
// via scripts/pack-list-check.mjs.
const drift = checkPackList(studioRoot)
if (drift.missing.length > 0) {
  console.error(`pack-sidecar: bin/ files the launcher loads but the pack list misses: ${drift.missing.join(', ')}`)
  console.error('             add them to BIN_FILES in scripts/pack-manifest.mjs — a packed sidecar without them dies on ERR_MODULE_NOT_FOUND before binding its port')
  process.exit(1)
}
for (const f of drift.unused) console.warn(`pack-sidecar: warning — ${f} is packed but nothing under bin/ loads it`)
for (const rel of [...BIN_FILES.map((f) => `bin/${f}`), 'profile/cordis.patch.yml', 'node_modules/@deepseek-ai/dsh/lib/bin.js']) {
  if (!existsSync(join(studioRoot, rel))) {
    console.error(`pack-sidecar: missing ${rel} — run npm install first`)
    process.exit(1)
  }
}
for (const rel of [arxaGateRel, ...arxaHarnessRels]) {
  if (!existsSync(join(parentDir, rel))) {
    console.error(`pack-sidecar: missing sibling ${rel}`)
    process.exit(1)
  }
}
// --check: every cheap validation above, no build. What CI and a pre-release
// pass want — the pack list, the inputs, the monaco bundle — in milliseconds
// instead of the two-minute compile.
const checkOnly = process.argv.includes('--check')
// The artifact viewer's Monaco/VS Code bundle is a build product of a SEPARATE
// npm root and is gitignored, so a checkout has plugins/ but no dist/ — and the
// viewer would ship with every monaco chunk 404ing. Refuse rather than pack a
// viewer that cannot open a file. Not built here: `npm ci` there installs 383
// packages / 1.3 GB and needs network, which packing must not require.
const monacoDist = 'plugins/artifact-viewer/lib/monaco-build/dist/arxa-monaco.js'
if (!existsSync(join(studioRoot, monacoDist))) {
  console.error(`pack-sidecar: missing ${monacoDist} — run \`npm ci && npm run build\` in plugins/artifact-viewer/lib/monaco-build first`)
  process.exit(1)
}

// The payload used to tar ALL of node_modules, so every devDependency shipped
// to every user: 290 top-level dirs, 87 MB uncompressed. None of it can run in
// a packed app. The exclusion is only safe because of the line under it —
// cordis resolves plugins BY NAME at boot, so a package that is dropped but
// still referenced is not a build error, it is a stock row that dies on
// ERR_MODULE_NOT_FOUND on the user's machine. Static half of the proof here,
// live half in the packed boot smoke (ARXA_SMOKE_LAUNCHER).
const devDirs = devOnlyDirs(studioRoot)
const devRefs = devOnlyImports(studioRoot, devDirs)
if (devRefs.length > 0) {
  console.error('pack-sidecar: runtime code references packages that only devDependencies install:')
  for (const { pkg, file } of devRefs) console.error(`             ${pkg} ← ${file}`)
  console.error('             move the package into "dependencies" (or drop the reference) — the packed app would die on ERR_MODULE_NOT_FOUND')
  process.exit(1)
}

if (checkOnly) {
  console.log(`pack-sidecar: --check OK — target ${triple}, pack list (${drift.reachable.join(', ')}), inputs and monaco bundle present, ${devDirs.length} dev-only trees excluded and unreferenced`)
  process.exit(0)
}

const work = mkdtempSync(join(tmpdir(), 'arxa-sidecar-'))
try {
  // Stage ONLY what differs from the checkout: the bin dir gains packed.json
  // (flips the launcher into packed mode), and the pinned node binary.
  // Everything immutable is tarred straight from the repos via multiple -C
  // flags — no 270 MB staging copy.
  const stage = join(work, 'stage')
  mkdirSync(join(stage, studioName, 'bin'), { recursive: true })
  for (const f of BIN_FILES) {
    cpSync(join(studioRoot, 'bin', f), join(stage, studioName, 'bin', f))
  }
  // `version` is read by plugins/claude-code (readAppVersion) for CLAUDE_AGENT_SDK_CLIENT_APP:
  // the payload has no root package.json, so this is the only version the packed app has.
  writeFileSync(join(stage, studioName, 'bin', 'packed.json'), JSON.stringify({
    packedAt: new Date().toISOString(),
    version: JSON.parse(readFileSync(join(studioRoot, 'package.json'), 'utf8')).version,
    node: spawnSync(nodeBin, ['--version'], { encoding: 'utf8' }).stdout.trim(),
  }, null, 2) + '\n')
  mkdirSync(join(stage, 'node', 'bin'), { recursive: true })
  cpSync(nodeBin, join(stage, 'node', 'bin', 'node'))
  chmodSync(join(stage, 'node', 'bin', 'node'), 0o755)

  // One pattern per dropped dir, plus its children: bsdtar (macOS) and GNU tar
  // (the Arch container) agree on both forms, and neither is trusted — the
  // tarball is listed and asserted below.
  const excludeFile = join(work, 'exclude.txt')
  writeFileSync(excludeFile, devDirs.flatMap((d) => {
    const p = `${studioName}/${d}`
    return [p, `${p}/*`]
  }).join('\n') + '\n')
  const tarball = join(work, 'payload.tar.gz')
  console.log('pack-sidecar: creating payload.tar.gz (node_modules + plugins + node runtime)…')
  const tar = spawnSync(tarBin, [
    // plugins/ is tarred whole, and monaco-build carries 1.3 GB of build-time
    // node_modules (vite, rolldown, the @codingame stack) that exists only to
    // produce dist/. Without this the payload grows by that entire tree.
    // Excludes must precede the file list for bsdtar.
    '--exclude', '*/lib/monaco-build/node_modules',
    '--exclude-from', excludeFile,
    '-czf', tarball,
    '-C', stage, '.',
    '-C', parentDir,
    join(studioName, 'node_modules'),
    join(studioName, 'plugins'),
    join(studioName, 'profile'),
    join(studioName, 'pi'),
    arxaGateRel,
    ...arxaHarnessRels,
  ], { stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' } })
  if (tar.status !== 0) throw new Error('tar failed')

  // Assert on the archive, never on the flags: a no-op exclude (nothing saved,
  // and we would report a saving that did not happen) and an over-broad one
  // (a payload missing a prod tree) are both silent.
  const listed = spawnSync(tarBin, ['-tzf', tarball], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
  if (listed.status !== 0) throw new Error('tar -tzf failed on the payload we just wrote')
  const members = listed.stdout.split('\n').filter(Boolean)
  const dropped = new Set(devDirs.map((d) => `${studioName}/${d}`))
  const leaked = members.filter((m) => {
    for (let i = m.indexOf('/'); i > 0; i = m.indexOf('/', i + 1)) if (dropped.has(m.slice(0, i))) return true
    return false
  })
  if (leaked.length > 0) throw new Error(`payload still contains ${leaked.length} dev-only members (e.g. ${leaked[0]}) — the tar exclude did not apply`)
  const anchor = `${studioName}/node_modules/@deepseek-ai/dsh/lib/bin.js`
  if (!members.includes(anchor)) throw new Error(`payload is missing ${anchor} — the exclude list was too broad`)
  console.log(`pack-sidecar: payload verified — ${members.length} members, ${devDirs.length} dev-only trees excluded, engine entry present`)

  const sha = createHash('sha256').update(readFileSync(tarball)).digest('hex').slice(0, 12)
  const launcherRel = `${studioName}/bin/arxa-studio.mjs`

  const entry = `// AUTO-GENERATED by ${studioName}/scripts/pack-sidecar.mjs — do not edit.
import payload from "./payload.tar.gz" with { type: "file" };
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const SHA = ${JSON.stringify(sha)};
const arxaHome = process.env.ARXA_HOME?.trim()
  ? resolve(process.env.ARXA_HOME)
  : join(homedir(), ".arxa");
const engineDir = join(arxaHome, "engine", SHA);
const okMarker = join(engineDir, ".extracted");

if (!existsSync(okMarker)) {
  // First run for this payload hash: extract to a tmp sibling, then rename
  // into place — atomic, so concurrent first runs can't see a half-extracted
  // engine. Old engine dirs are left behind deliberately (an already-running
  // older app may still be executing from one); they are plain dirs under
  // <ARXA_HOME>/engine and safe to delete by hand.
  const tmp = engineDir + ".tmp-" + process.pid;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const tarball = join(tmp, "payload.tar.gz");
  await Bun.write(tarball, Bun.file(payload));
  const tarBin = ["/usr/bin/tar", "/bin/tar"].find((c) => existsSync(c)) ?? "tar";
  const r = spawnSync(tarBin, ["-xzf", tarball, "-C", tmp], { stdio: "inherit" });
  if (r.status !== 0) { console.error("arxa-studio sidecar: payload extraction failed"); process.exit(1); }
  rmSync(tarball, { force: true });
  writeFileSync(join(tmp, ".extracted"), SHA + "\\n");
  try { renameSync(tmp, engineDir); } catch { rmSync(tmp, { recursive: true, force: true }); }
  if (!existsSync(okMarker)) { console.error("arxa-studio sidecar: engine dir missing after extraction"); process.exit(1); }
}

const child = spawn(
  join(engineDir, "node", "bin", "node"),
  [join(engineDir, ${JSON.stringify(launcherRel)}), ...process.argv.slice(2)],
  { stdio: "inherit" },
);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 1));
`
  writeFileSync(join(work, 'entry.ts'), entry)

  console.log('pack-sidecar: bun build --compile …')
  // Compile inside the workdir, then COPY to the destination: bun's
  // --outfile silently produces a 0-byte file when the target sits on a
  // different filesystem than its temp output (observed with bun 1.3.4
  // writing to an external volume).
  const compiled = join(work, 'sidecar.bin')
  const bun = spawnSync('bun', ['build', '--compile', '--outfile', compiled, join(work, 'entry.ts')], { stdio: 'inherit', cwd: work })
  if (bun.status !== 0) throw new Error('bun build --compile failed')
  if (!existsSync(compiled) || statSync(compiled).size < 1024 * 1024) throw new Error('bun produced an empty binary')
  mkdirSync(dirname(outFile), { recursive: true })
  rmSync(outFile, { force: true })
  cpSync(compiled, outFile)
  chmodSync(outFile, 0o755)

  const mb = (statSync(outFile).size / 1024 / 1024).toFixed(1)
  console.log(`pack-sidecar: OK → ${outFile} (${mb} MB, payload sha12 ${sha})`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
