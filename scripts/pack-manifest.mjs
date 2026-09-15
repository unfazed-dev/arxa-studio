// pack-manifest — what the packed sidecar ships out of bin/, and the scan that
// proves the list still matches what the launcher actually loads.
//
// The failure this exists to stop (2026-09-02): a89b02e added
// `import { materialisePreset } from './materialise-preset.mjs'` to
// bin/arxa-studio.mjs; the pack list still named two files; the packed sidecar
// died on ERR_MODULE_NOT_FOUND before binding its port. Nothing was red — the
// repo engine boots from a full checkout, so only a real bundle boot saw it.
//
// The scan is static and takes milliseconds, so it runs on every pack (before
// the two-minute bun build) and as a CI gate, instead of the boot-the-141MB-
// binary check the plan first proposed.
//
// ponytail: a text scan, not a parser. It reads two reference shapes, which is
// every shape bin/ uses: a relative specifier (`from './x.mjs'`,
// `import('./x.mjs')`) and a bare filename literal that gets joined to a dir
// (`join(here, 'loopback-localhost-patch.mjs')` — the --import re-exec). If bin/
// ever loads a file through a COMPUTED name, this cannot see it; add it to
// BIN_FILES by hand and the check stays quiet (an unreachable entry is a
// warning, never a failure).
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * The Rust target triple Tauri expects in an `externalBin` filename, for the
 * host we are packing on: Tauri resolves `binaries/arxa-studio` to
 * `binaries/arxa-studio-<triple>`, so a wrong triple is a build that cannot
 * find its sidecar.
 *
 * Linux is glibc-only on purpose — the payload embeds the BUILD HOST's node, so
 * a musl host would produce a binary that only runs on musl. If that day comes,
 * pack on the target libc rather than renaming the triple.
 */
export function hostTriple (platform = process.platform, arch = process.arch) {
  const cpu = arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : undefined
  if (cpu === undefined) throw new Error(`pack: unsupported cpu ${arch}`)
  if (platform === 'darwin') return `${cpu}-apple-darwin`
  if (platform === 'linux') return `${cpu}-unknown-linux-gnu`
  throw new Error(`pack: unsupported platform ${platform}`)
}

/**
 * Every bin/ module the launcher loads at runtime. Explicit (not a glob) on
 * purpose: bin/ also holds dev-only scripts (arxa-explore, isolation-check,
 * arxa-engine-sync) that must NOT ship in the sidecar.
 */
export const BIN_FILES = ['arxa-studio.mjs', 'arxa-studio-provider.mjs', 'loopback-localhost-patch.mjs', 'materialise-preset.mjs', 'seed-settings.mjs']

/** The launcher — the one entry the Mach-O payload execs. */
export const BIN_ENTRY = 'arxa-studio.mjs'

// Full-line comments and block comments are stripped before scanning so that a
// comment naming a dev-only script (they do: the pack list is discussed in
// bin/arxa-studio.mjs's own header) cannot fake a dependency.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*)/.test(l))
  .join('\n')

const NAME_RE = /['"`]([\w./-]+\.m?js)['"`]/g

/**
 * Files under `binDir` reachable from `entry`, transitively. Returns sorted
 * basenames, entry included.
 */
export function binDeps (binDir, entry = BIN_ENTRY) {
  const seen = new Set()
  const queue = [entry]
  while (queue.length > 0) {
    const name = queue.shift()
    if (seen.has(name)) continue
    seen.add(name)
    const file = join(binDir, name)
    if (!existsSync(file)) continue
    for (const m of stripComments(readFileSync(file, 'utf8')).matchAll(NAME_RE)) {
      const base = m[1].split('/').pop()
      if (base !== name && existsSync(join(binDir, base))) queue.push(base)
    }
  }
  return [...seen].sort()
}

/**
 * @returns {{ reachable: string[], missing: string[], unused: string[] }}
 *   missing — loaded at runtime but NOT packed (fatal: the sidecar dies on boot).
 *   unused  — packed but unreachable from the entry (a warning: harmless bytes,
 *             or a computed load the scan cannot see).
 */
export function checkPackList (studioRoot, files = BIN_FILES, entry = BIN_ENTRY) {
  const reachable = binDeps(join(studioRoot, 'bin'), entry)
  return {
    reachable,
    missing: reachable.filter((f) => !files.includes(f)),
    unused: files.filter((f) => !reachable.includes(f)),
  }
}

// ---------------------------------------------------------------------------
// devDependency trim (2026-09-07)
//
// The payload tars all of node_modules, so every devDependency shipped: 290
// top-level dirs, 87 MB uncompressed (esbuild, @esbuild/darwin-arm64,
// webdriverio, webdriver, rxjs, cheerio, the @wdio stack). None of it can run
// in a packed app — there is no test runner in there — but it all extracts to
// <ARXA_HOME>/engine/<sha> on every user's disk.
//
// The dangerous half of this is not the exclusion, it is the QUESTION it
// answers: "does anything the engine loads at runtime live in a dev-only
// tree?" cordis resolves plugins BY NAME from the profile at boot, so a
// missing package is not a build error — it is a stock row that dies on
// ERR_MODULE_NOT_FOUND after the app is installed. devOnlyImports() below is
// the static half of that answer (JS specifiers AND profile YAML names); the
// packed boot smoke is the live half.

/** Direct dependencies that MUST survive the trim, whatever npm reports. */
const KEEP_ANCHOR = '@deepseek-ai/dsh'

const nmRelative = (studioRoot, stdout) => new Set(
  stdout.split('\n')
    .filter(Boolean)
    .map((p) => relative(studioRoot, p))
    .filter((p) => p.startsWith('node_modules' + sep) || p === 'node_modules'),
)

/** Default runner: `npm ls`, tolerating a non-zero exit (extraneous deps). */
const npmLs = (studioRoot, args) => {
  const r = spawnSync('npm', ['ls', '--parseable', '--all', ...args], {
    cwd: studioRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  })
  // A non-zero exit is normal (npm ls reports extraneous/peer noise as failure)
  // — TRUNCATED stdout is the hazard: a short keep set makes the complement
  // swallow production packages. The caller asserts the anchors.
  return r.stdout ?? ''
}

/**
 * Top-most node_modules dirs (repo-relative, POSIX-ish) that ONLY
 * devDependencies reach — i.e. safe to leave out of the sidecar payload.
 * "Top-most" because excluding a directory takes its children with it.
 *
 * @throws if the keep set looks truncated (see npmLs).
 */
export function devOnlyDirs (studioRoot, run = npmLs) {
  const keep = nmRelative(studioRoot, run(studioRoot, ['--omit=dev']))
  const all = nmRelative(studioRoot, run(studioRoot, []))
  const pkg = JSON.parse(readFileSync(join(studioRoot, 'package.json'), 'utf8'))
  const direct = Object.keys(pkg.dependencies ?? {})
  // Truncation guard: every DIRECT production dependency must be in the keep
  // set. If npm's output was cut short, this trips instead of the payload
  // silently losing a prod tree.
  const lost = [...direct, KEEP_ANCHOR].filter((n) => !keep.has(join('node_modules', n)))
  if (lost.length > 0) {
    throw new Error(`devOnlyDirs: production packages missing from \`npm ls --omit=dev\` (${lost.join(', ')}) — refusing to compute an exclude list from truncated output`)
  }
  const drop = [...all].filter((p) => !keep.has(p))
  // Keep only the top-most: a/b is implied by a.
  return drop.filter((p) => !drop.some((q) => q !== p && p.startsWith(q + sep))).sort()
}

const RUNTIME_DIRS = ['bin', 'plugins', 'pi', 'profile']
const SPEC_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"'./][^"']*)["']/g
// A profile row names a plugin by bare package name in an `- id:` position;
// cordis resolves that name from the materialized node_modules at boot. Only
// that position is scanned — a looser scan matches English prose (the words
// "process" and "events" are both npm packages in the dev-only tree).
const YAML_ID_RE = /^\s*-?\s*id:\s*['"]?(@?[\w.-]+(?:\/[\w.-]+)?)['"]?\s*$/gm

const pkgOf = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])

/**
 * Runtime references to a package in `dropped` — the trim's fatal case.
 * Scans JS-ish sources for bare specifiers and profile YAML for bare names.
 * @returns {{ pkg: string, file: string }[]}
 */
export function devOnlyImports (studioRoot, dropped) {
  const names = new Set([...dropped].map((p) => p.split(sep).slice(1).join('/')))
  // Engine-graph members ride the dsh WAVE's own dependency closure: host
  // plugins import them bare and dsh's cordis runner resolves them from the
  // materialized node_modules at boot, never from a repo-root link — so a
  // dev-only ROOT LINK is not a payload drop of the package itself. Their
  // devDependencies exist only so tests resolve the PINNED wave (2026-09-15,
  // when the stale pre-pnpm root leftovers that used to satisfy them went).
  // ponytail: store-layout aware (.pnpm names); if arxa ever leaves pnpm,
  // re-derive from the wave's package graph instead.
  let wave = new Set()
  try {
    const store = join(studioRoot, 'node_modules', '.pnpm')
    for (const d of readdirSync(store)) {
      if (!d.startsWith('@deepseek-ai+')) continue
      const rest = d.slice('@deepseek-ai+'.length)
      wave.add('@deepseek-ai/' + rest.slice(0, rest.indexOf('@')))
    }
  } catch { /* no store — every hit reports, fail-closed */ }
  const hits = []
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue
      const file = join(dir, e.name)
      if (e.isDirectory()) { walk(file); continue }
      const yaml = /\.ya?ml$/.test(e.name)
      if (!yaml && !/\.(mjs|cjs|js|ts)$/.test(e.name)) continue
      const src = readFileSync(file, 'utf8')
      const found = yaml
        ? [...src.matchAll(YAML_ID_RE)].map((m) => m[1])
        : [...src.matchAll(SPEC_RE)].map((m) => pkgOf(m[1]))
      for (const name of found) {
        if (name.startsWith('node:')) continue
        if (names.has(name) && !wave.has(name)) hits.push({ pkg: name, file: relative(studioRoot, file) })
      }
    }
  }
  for (const d of RUNTIME_DIRS) walk(join(studioRoot, d))
  return hits
}
