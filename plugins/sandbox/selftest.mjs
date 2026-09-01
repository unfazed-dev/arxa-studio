// arxa-sandbox selftest — pure node, network-free (same discipline as
// plugins/conversation/selftest.mjs). Run: node plugins/sandbox/selftest.mjs
//
// The resolver is unit-tested against a FAKE `which` + env + filesystem, so the
// grant logic is pinned on a machine with no Flutter, with a standalone Dart
// SDK, or with PUB_CACHE pointed somewhere unusual. The live rows at the end
// exercise the real toolchain and SKIP (never fail) when it is absent — a CI
// box without Flutter must still go green.
//
// The end-to-end proof that the grants actually work under the kernel lives in
// scripts/s1-sandbox-verify.mjs; this file pins the logic that feeds it.

import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { canonicalPath, writableRoots } from '@deepseek-ai/dsh-sandbox'
import LocalSandboxProvider from '@deepseek-ai/dsh-sandbox-local'

import ArxaSandboxProvider, {
  extendSeatbeltArgv,
  resolveToolchainRoots,
  sbplString,
  sdkRootOf,
  whichOnPath
} from './lib/index.js'

let checks = 0
const ok = (name) => { checks += 1; console.log('  ok', name) }
let skipped = 0
const skip = (name, why) => { skipped += 1; console.log('  SKIP', name, '—', why) }

// ---- a fake world: `/opt/fvm/stable/bin/flutter` is a symlink into
//      `/real/sdk/bin/flutter`, and every listed path exists.
const world = (paths, links = {}) => ({
  exists: (p) => paths.includes(p),
  canonical: (p) => links[p] ?? p,
  home: '/home/tester'
})

// ---- 1. the happy path: flutter + dart in one SDK, default pub cache
{
  const links = { '/opt/fvm/default/bin/flutter': '/real/sdk/bin/flutter', '/opt/fvm/default/bin/dart': '/real/sdk/bin/dart' }
  const roots = resolveToolchainRoots({
    which: (c) => ({ flutter: '/opt/fvm/default/bin/flutter', dart: '/opt/fvm/default/bin/dart' })[c],
    env: {},
    ...world(['/real/sdk/bin/cache', '/home/tester/.dart-tool', '/home/tester/.pub-cache'], links)
  })
  assert.deepEqual(roots, ['/real/sdk/bin/cache', '/home/tester/.dart-tool', '/home/tester/.pub-cache'])
  ok('resolver: SDK cache (symlink resolved to the REAL sdk) + .dart-tool + default pub cache')
}

// ---- 2. dedup — flutter and dart resolve into the SAME sdk, so `bin/cache`
//      must appear exactly once even though two lookups produced it.
{
  const links = { '/opt/fvm/default/bin/flutter': '/real/sdk/bin/flutter', '/opt/fvm/default/bin/dart': '/real/sdk/bin/dart' }
  const roots = resolveToolchainRoots({
    which: (c) => ({ flutter: '/opt/fvm/default/bin/flutter', dart: '/opt/fvm/default/bin/dart' })[c],
    env: {},
    ...world(['/real/sdk/bin/cache'], links)
  })
  assert.deepEqual(roots, ['/real/sdk/bin/cache'], 'one entry, not two')
  ok('resolver: dedup — flutter and dart sharing an SDK grant one cache root')
}

// ---- 3. canonicalisation is applied to the ROOTS too, not just the launchers.
//      dsh compares resolved paths (`/tmp` IS `/private/tmp` on darwin), so an
//      as-spelled grant would match nothing.
{
  const roots = resolveToolchainRoots({
    which: (c) => (c === 'flutter' ? '/sdk/bin/flutter' : undefined),
    env: { PUB_CACHE: '/link/pub' },
    exists: (p) => ['/sdk/bin/cache', '/link/pub', '/home/tester/.dart-tool'].includes(p),
    canonical: (p) => ({ '/link/pub': '/real/pub', '/sdk/bin/cache': '/real/sdk/bin/cache' })[p] ?? p,
    home: '/home/tester'
  })
  assert.ok(roots.includes('/real/pub'), 'PUB_CACHE grant is the canonical path')
  assert.ok(roots.includes('/real/sdk/bin/cache'), 'SDK cache grant is the canonical path')
  assert.ok(!roots.includes('/link/pub'), 'the as-spelled symlink is not granted')
  ok('resolver: PUB_CACHE honoured and every root canonicalised')
}

// ---- 4. nothing when the toolchain is absent — this provider must be
//      byte-for-byte dsh on a machine with no Dart.
{
  assert.deepEqual(
    resolveToolchainRoots({ which: () => undefined, env: {}, ...world(['/home/tester/.pub-cache', '/home/tester/.dart-tool']) }),
    [],
    'no flutter, no dart → no grants, even though the caches exist on disk'
  )
  ok('resolver: no toolchain on PATH adds nothing')
}

// ---- 5. a root that does not exist is never granted.
{
  const roots = resolveToolchainRoots({
    which: (c) => (c === 'dart' ? '/sdk/bin/dart' : undefined),
    env: {},
    ...world(['/home/tester/.dart-tool'])
  })
  assert.deepEqual(roots, ['/home/tester/.dart-tool'], 'missing bin/cache and pub cache dropped')
  ok('resolver: non-existent roots are dropped')
}

// ---- 6. an unrecognised launcher layout grants nothing from the SDK.
{
  assert.equal(sdkRootOf('/usr/local/flutter', (p) => p), undefined, 'not in a bin/ dir')
  assert.equal(sdkRootOf('/real/sdk/bin/flutter', (p) => p), '/real/sdk')
  ok('sdkRootOf: only a bin/<tool> layout yields an SDK root')
}

// ---- 7. mode gating + the base roots are never duplicated.
{
  const provider = new ArxaSandboxProvider(new Context(), { runnerCommand: [], runnerFailureSignatures: [], probeTimeoutMs: 5000 })
  provider.arxaInternals.resolveToolchainRoots = () => ['/grant/a', canonicalPath('/tmp')]

  assert.deepEqual(provider.extraWritableRoots({ mode: 'read-only', workspaceRoot: '/ws' }), [], 'read-only grants nothing')
  assert.deepEqual(
    provider.extraWritableRoots({ mode: 'danger-full-access', workspaceRoot: '/ws' }), [],
    'danger-full-access needs no grant'
  )
  const extra = provider.extraWritableRoots({ mode: 'workspace-write', workspaceRoot: '/ws' })
  assert.deepEqual(extra, ['/grant/a'], '/tmp is already a dsh root and is not re-granted')
  ok('provider: workspace-write only, and never re-grants a root dsh already gives')
}

// ---- 8. the Seatbelt seam: super's profile survives VERBATIM and the extra
//      grant is appended. This is the `.git`-semantics guard — the base profile
//      carries no `.git` rule (a `.git` under the workspace is writable, which
//      is what lets `git commit` work confined), and this assertion fails the
//      moment anything here removes or rewrites a base form.
{
  const policy = { mode: 'workspace-write', workspaceRoot: process.cwd() }
  const stock = new LocalSandboxProvider(new Context(), { runnerCommand: [], runnerFailureSignatures: [], probeTimeoutMs: 5000 })
  const provider = new ArxaSandboxProvider(new Context(), { runnerCommand: [], runnerFailureSignatures: [], probeTimeoutMs: 5000 })
  provider.arxaInternals.resolveToolchainRoots = () => ['/grant/a', '/grant/b']

  const base = stock.runnerArgv('seatbelt', policy)
  const ours = provider.runnerArgv('seatbelt', policy)
  assert.equal(ours.length, base.length, 'same argv shape: [sandbox-exec, -p, <profile>]')
  assert.equal(ours[0], base[0])
  assert.equal(ours[1], '-p')
  assert.ok(ours[2].startsWith(base[2]), 'the stock profile is a verbatim PREFIX — nothing rewritten')
  assert.equal(
    ours[2].slice(base[2].length),
    ' (allow file-write* (subpath "/grant/a") (subpath "/grant/b"))',
    'exactly one appended allow form, no deny touched'
  )
  assert.equal((ours[2].match(/\(deny file-write\*\)/gu) ?? []).length, 1, 'the base deny survives, once')
  assert.ok(!ours[2].includes('.git'), 'no .git rule invented — base semantics unchanged')

  // read-only must come through completely untouched.
  const roPolicy = { mode: 'read-only', workspaceRoot: process.cwd() }
  assert.deepEqual(provider.runnerArgv('seatbelt', roPolicy), stock.runnerArgv('seatbelt', roPolicy))
  ok('seatbelt seam: stock profile verbatim + one appended allow; read-only identical')
}

// ---- 9. a changed upstream invocation shape fails LOUDLY rather than silently
//      shipping an unextended profile.
{
  assert.throws(
    () => extendSeatbeltArgv(['sandbox-exec', '--surprise', 'x'], ['/grant/a']),
    /unexpected sandbox-exec invocation shape/u
  )
  assert.deepEqual(extendSeatbeltArgv(['sandbox-exec', '-p', 'P'], []), ['sandbox-exec', '-p', 'P'], 'no roots, no change')
  assert.equal(sbplString('a"b\\c'), '"a\\"b\\\\c"', 'SBPL quoting matches dsh-sandbox-local:54')
  ok('seam guard: shape change throws; empty grant is a no-op; quoting pinned')
}

// ---- 10. bwrap gets its own dialect, landlock/windows-acl pass through.
{
  const provider = new ArxaSandboxProvider(new Context(), { runnerCommand: [], runnerFailureSignatures: [], probeTimeoutMs: 5000 })
  provider.arxaInternals.resolveToolchainRoots = () => ['/grant/a']
  const policy = { mode: 'workspace-write', workspaceRoot: '/ws' }
  const bwrap = provider.runnerArgv('bwrap', policy)
  assert.deepEqual(bwrap.slice(-3), ['--bind', '/grant/a', '/grant/a'], 'appended bind, base mounts untouched')
  ok('bwrap seam: grants appended as binds')
}

// ---- LIVE rows: the real machine, skipped (never failed) without a toolchain.
{
  const flutter = whichOnPath('flutter')
  if (flutter === undefined) {
    skip('live: flutter roots', 'flutter is not on PATH')
  } else {
    const roots = resolveToolchainRoots()
    assert.ok(roots.length > 0, 'a real flutter install must produce at least one root')
    for (const root of roots) {
      assert.ok(existsSync(root), `granted root must exist: ${root}`)
      assert.equal(root, canonicalPath(root), `granted root must be canonical: ${root}`)
    }
    assert.ok(
      roots.includes(canonicalPath(join(homedir(), '.dart-tool'))) || !existsSync(join(homedir(), '.dart-tool')),
      '~/.dart-tool is granted when it exists — the measured blocker for `flutter --version`'
    )
    // The grants must be ADDITIONS, never a replacement of dsh's own.
    const provider = new ArxaSandboxProvider(new Context(), { runnerCommand: [], runnerFailureSignatures: [], probeTimeoutMs: 5000 })
    const policy = { mode: 'workspace-write', workspaceRoot: process.cwd() }
    const argv = provider.runnerArgv('seatbelt', policy)
    for (const dshRoot of writableRoots(policy)) {
      assert.ok(argv[2].includes(sbplString(dshRoot)), `dsh root still granted: ${dshRoot}`)
    }
    ok(`live: ${roots.length} real toolchain root(s), all canonical and existing; dsh roots intact`)
  }
}

console.log(`arxa-sandbox selftest: ${checks} checks green` + (skipped > 0 ? `, ${skipped} skipped` : ''))
