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

// ---- 11. a caller-attached `policy.extraWritableRoots` (claude-code's
//      ~/.claude/projects) is honoured once, workspace-write only.
{
  const provider = new ArxaSandboxProvider(new Context(), { runnerCommand: [], runnerFailureSignatures: [], probeTimeoutMs: 5000 })
  const roots = provider.extraWritableRoots({ mode: 'workspace-write', workspaceRoot: '/ws', extraWritableRoots: ['/home/u/.claude/projects', '/home/u/.claude/projects'] })
  assert.ok(roots.includes('/home/u/.claude/projects'))
  assert.equal(roots.filter((r) => r === '/home/u/.claude/projects').length, 1)
  assert.deepEqual(provider.extraWritableRoots({ mode: 'read-only', workspaceRoot: '/ws', extraWritableRoots: ['/home/u/.claude/projects'] }), [])
  ok('policy.extraWritableRoots honoured once, workspace-write only')
}

// ---- 12. the blast-radius guard (never home/filesystem-root, never near-root)
//      applies to the caller-attached channel too, not just the toolchain
//      resolver — pinned against the real claude-code transcript-dir grant.
{
  const provider = new ArxaSandboxProvider(new Context(), { runnerCommand: [], runnerFailureSignatures: [], probeTimeoutMs: 5000 })
  const claudeRoot = join(homedir(), '.claude', 'projects')
  const roots = provider.extraWritableRoots({ mode: 'workspace-write', workspaceRoot: '/ws', extraWritableRoots: [claudeRoot] })
  const forbidden = new Set([canonicalPath(homedir()), canonicalPath('/'), canonicalPath('/Users'), canonicalPath('/Volumes')])
  for (const root of roots) {
    assert.ok(!forbidden.has(root), `caller-attached grant must never be a home/filesystem root: ${root}`)
    assert.ok(root.split('/').filter(Boolean).length >= 2, `caller-attached grant must be specific, not near-root: ${root}`)
  }
  ok('blast-radius guard covers caller-attached roots (extraWritableRoots output), not only the resolver')
}

// ---- 12b. NEGATIVE: the never-grant invariant is ENFORCED on the caller-attached
//      channel, not merely asserted about the one caller that exists today.
//      `policy.extraWritableRoots` takes whatever any caller attaches; a near-root
//      path fed through it must never reach the writable set, because every grant
//      becomes a `(subpath ...)` and would turn workspace-write into full access.
{
  const provider = new ArxaSandboxProvider(new Context(), { runnerCommand: [], runnerFailureSignatures: [], probeTimeoutMs: 5000 })
  const nearRoot = [homedir(), '/', '/Users', '/Volumes', '/tmp', join(homedir(), '..')]
  const roots = provider.extraWritableRoots({ mode: 'workspace-write', workspaceRoot: '/ws', extraWritableRoots: nearRoot })
  const rejected = new Set(nearRoot.map(canonicalPath))
  for (const root of roots) {
    assert.ok(!rejected.has(root), `near-root grant must be dropped, not granted: ${root}`)
    assert.ok(root.split('/').filter(Boolean).length >= 2, `surviving grant must be specific: ${root}`)
  }
  ok('near-root paths fed through policy.extraWritableRoots are dropped by the provider itself')

  // And the invariant does not swallow a legitimate grant sitting alongside them.
  const claudeRoot = join(homedir(), '.claude', 'projects')
  const mixed = provider.extraWritableRoots({ mode: 'workspace-write', workspaceRoot: '/ws', extraWritableRoots: [homedir(), claudeRoot, '/'] })
  assert.ok(mixed.includes(canonicalPath(claudeRoot)), 'the real claude-code transcript grant still survives')
  assert.ok(!mixed.includes(canonicalPath(homedir())), '$HOME alongside it is still dropped')
  ok('a legitimate grant beside rejected ones is kept, so the filter is not a blanket refusal')
}

// ---- 13. tier resolution (S3, docs/plans/arxa-isolation-levels.md §16/§22–23):
//      the effective tier is resolved per machine at session start, can only
//      DECREASE from the configured capability, and every decrease carries a
//      user-readable reason — the card shows the effective tier, never the
//      configured one, whenever they differ.
{
  const { resolveEffectiveTier } = await import('./lib/effective-tier.js')

  // macOS Seatbelt: the full A0–A3 ladder is enforceable in the profile.
  const darwin = resolveEffectiveTier({ configured: 'A2', platform: 'darwin', runners: { seatbelt: true } })
  assert.equal(darwin.configured, 'A2')
  assert.equal(darwin.effective, 'A2')
  assert.ok(typeof darwin.reason === 'string' && darwin.reason.length > 0, 'a reason is always present')
  ok('tier: darwin + seatbelt holds A0–A3 (A2 stays A2)')

  // Missing runners: nothing can be enforced — decrease to A0 with a reason.
  const noRunner = resolveEffectiveTier({ configured: 'A3', platform: 'darwin', runners: {} })
  assert.equal(noRunner.effective, 'A0', 'no runner → A0')
  assert.ok(noRunner.reason.length > 0, 'the decrease says why')
  ok('tier: missing runners decrease to A0 with a readable reason')

  // Linux bwrap carries the egress rung; Landlock cannot deny network (§16).
  const bwrap = resolveEffectiveTier({ configured: 'A3', platform: 'linux', runners: { bwrap: true } })
  assert.equal(bwrap.effective, 'A3')
  const landlock = resolveEffectiveTier({ configured: 'A3', platform: 'linux', runners: { landlock: true } })
  assert.equal(landlock.effective, 'A2', 'Landlock caps below the egress tier')
  assert.ok(/network/i.test(landlock.reason), 'the cap names what Landlock cannot do')
  ok('tier: linux bwrap reaches A3, landlock caps at A2 (no network control)')

  // Windows: the ACL rung is write confinement only, and unsupported when absent.
  const acl = resolveEffectiveTier({ configured: 'A2', platform: 'win32', runners: { 'windows-acl': true } })
  assert.equal(acl.effective, 'A1', 'ACL rung holds the write boundary but not read isolation')
  const noAcl = resolveEffectiveTier({ configured: 'A1', platform: 'win32', runners: {} })
  assert.equal(noAcl.effective, 'A0')
  assert.ok(/acl|windows/i.test(noAcl.reason), 'the reason names the unsupported rung')
  ok('tier: windows ACL is write-only (A1) and A0 when unsupported')

  // Inherited A5 must degrade to the best AVAILABLE local tier, never stall a
  // session (S3 §23b) — sbx absent, sbx unsigned, and sbx ready are three
  // different answers.
  const a5NoSbx = resolveEffectiveTier({ configured: 'A5', platform: 'darwin', runners: { seatbelt: true } })
  assert.equal(a5NoSbx.effective, 'A3', 'degrades to the best local tier')
  assert.ok(/sbx|sandbox/i.test(a5NoSbx.reason), 'names the missing microVM runner')
  const a5Unauthed = resolveEffectiveTier({ configured: 'A5', platform: 'darwin', runners: { seatbelt: true, sbx: true } })
  assert.equal(a5Unauthed.effective, 'A3')
  assert.ok(/sign/i.test(a5Unauthed.reason), 'names the one-time sign-in arxa cannot automate (§23a)')
  const a5Ready = resolveEffectiveTier({ configured: 'A5', platform: 'darwin', runners: { seatbelt: true, sbx: true, sbxAuthed: true } })
  assert.equal(a5Ready.effective, 'A5')
  const a4NoDocker = resolveEffectiveTier({ configured: 'A4', platform: 'darwin', runners: { seatbelt: true } })
  assert.equal(a4NoDocker.effective, 'A3')
  assert.ok(/docker/i.test(a4NoDocker.reason), 'arxa detects Docker, never assumes (S3)')
  ok('tier: inherited A5/A4 degrade to the best available tier, never stall')

  // A no-toolchain host still confines: the ladder never depended on Flutter.
  const bare = resolveEffectiveTier({ configured: 'A2', platform: 'darwin', runners: { seatbelt: true } })
  assert.equal(bare.effective, 'A2')
  // The effective tier can only decrease from configured — never widen.
  const a1 = resolveEffectiveTier({ configured: 'A1', platform: 'darwin', runners: { seatbelt: true, sbx: true, sbxAuthed: true, docker: true } })
  assert.equal(a1.effective, 'A1', 'a configured A1 is never widened by available runners')
  // An unknown configured tier resolves to A0 rather than guessing.
  const bogus = resolveEffectiveTier({ configured: 'A9', platform: 'darwin', runners: { seatbelt: true } })
  assert.equal(bogus.effective, 'A0')
  assert.ok(/A9|unknown/i.test(bogus.reason))
  ok('tier: no-toolchain hosts still hold A2; effective never widens; unknown tiers fall to A0')
}

// ---- 14. provisioning (S3/S4): A0–A3 confinement + B1–B2 integrity provision
//      silently at install — no prompts, no choices, no README steps. The plan
//      this returns is what the launcher seeds and the card reports.
{
  const { provisionLocalConfinement } = await import('./lib/provision.js')

  const p = provisionLocalConfinement({ platform: 'darwin' })
  // Idempotence: provisioning twice plans the identical world.
  assert.deepEqual(p, provisionLocalConfinement({ platform: 'darwin' }), 'provisioning is idempotent')
  ok('provision: idempotent — the same machine plans the same confinement twice')

  // Safe preset materialization: new profiles get workspace-write (S1 order —
  // the provider ships with the flip, never the flip without the provider).
  assert.equal(p.preset.settingsKey, 'permission.defaultPreset')
  assert.equal(p.preset.value, 'workspace-write')
  ok('provision: preset materializes permission.defaultPreset=workspace-write')

  // The in-process fence ships with it (§20): reads confined, reserved paths
  // rejected on mutation.
  assert.equal(p.filesystem.provider, 'arxa-filesystem')
  assert.equal(p.filesystem.readIsolation, 'org-root')
  assert.deepEqual(p.filesystem.reservedPaths, ['.git', '.arxa'])
  ok('provision: arxa-filesystem provider with org-root read isolation + reserved paths')

  // A3 stays honest: subprocess egress is a capability, NOT enforced by
  // default (git push, npm install and pub get all need subprocess network),
  // and the things it could never cover are named, not implied.
  assert.equal(p.subprocessEgress.enforced, false)
  assert.equal(p.subprocessEgress.seatbeltForm, '(deny network*)')
  for (const outside of ['WebFetch', 'MCP', 'web search', 'model-provider']) {
    assert.ok(p.subprocessEgress.doesNotCover.some((x) => x.includes(outside)),
      `the egress claim must name ${outside} as outside its coverage`)
  }
  assert.ok(p.subprocessEgress.reason.length > 0)
  ok('provision: A3 is a reported capability, not a default — and its ceiling is named')

  // No widening: the subprocess provider grants exactly dsh's mode roots plus
  // the measured toolchain caches, and nothing else is planned.
  assert.ok(/workspace.*temp.*toolchain|toolchain.*temp.*workspace/i.test(p.subprocessWritableRoots),
    'the writable-root plan names exactly workspace + temp + measured toolchain roots')
  ok('provision: no widening beyond workspace/temp/measured toolchain roots')

  // B1/B2 ship unconditionally (S4) — they are not a menu item.
  assert.ok(p.integrity.install.npm.includes('npm ci --ignore-scripts'))
  assert.ok(p.integrity.install.dart.includes('--enforce-lockfile'))
  assert.ok(/osv-scanner/i.test(p.integrity.osv) && /skip/i.test(p.integrity.osv),
    'OSV scanning reports an honest skip when the scanner is absent')
  assert.equal(p.integrity.diffPolicy, 'base-branch')
  ok('provision: B1 lockfile-pinned script-free installs + B2 base-branch diff policy')

  // No manual prerequisite anywhere in the plan (§23: the user does nothing).
  assert.deepEqual(p.manualSteps, [])
  ok('provision: zero manual steps — everything derives from the machine')
}

// ---- 15. the A2/A3 seatbelt extensions: the org-scoped read-deny (§9b,
//      measured working) and the opt-in egress deny. Both are APPENDED forms
//      on the same last-match-wins seam as the write grants — never a rebuilt
//      profile — and both key on the same org-root derivation as the
//      in-process fence (lib/filesystem.js), so the two fences cannot drift.
{
  const { seatbeltReadDenyForms, arxaOrgRootOf, SEATBELT_EGRESS_DENY_FORM } = await import('./lib/index.js')

  const org = '/vol/org-a'
  const ws = join(org, '.arxa', 'worktrees', 's-123')
  assert.equal(arxaOrgRootOf(ws), org, 'the org root is derived from the worktree layout')
  assert.equal(arxaOrgRootOf(join('/vol', 'plain', 'project')), undefined, 'a non-arxa root derives nothing')

  const forms = seatbeltReadDenyForms(ws, (p) => p)
  assert.equal(forms,
    `(deny file-read* (subpath "${org}")) ` +
    `(allow file-read* (literal "${org}")) ` +
    `(allow file-read* (subpath "${ws}")) ` +
    `(allow file-read* (subpath "${org}/.git"))`,
    'deny the org root, re-allow the org entry itself (git ownership check), the worktree, and the org git plumbing')
  assert.equal(seatbeltReadDenyForms('/vol/plain/project', (p) => p), '',
    'no org layout → no read-deny forms (the honest no-op, never a wider deny)')
  assert.ok(!forms.includes('file-write'), 'the read-deny never touches a write rule')
  ok('read-deny forms: org-scoped deny + worktree/git re-allows, layout-keyed, write rules untouched')

  const stock = new LocalSandboxProvider(new Context(), { runnerCommand: [], runnerFailureSignatures: [], probeTimeoutMs: 5000 })
  const provider = new ArxaSandboxProvider(new Context(), { runnerCommand: [], runnerFailureSignatures: [], probeTimeoutMs: 5000 })
  provider.arxaInternals.resolveToolchainRoots = () => []
  const policy = { mode: 'workspace-write', workspaceRoot: ws }

  const base = stock.runnerArgv('seatbelt', policy)
  const ours = provider.runnerArgv('seatbelt', policy)
  assert.ok(ours[2].startsWith(base[2]), 'stock profile still a verbatim prefix')
  assert.equal(ours[2].slice(base[2].length), ' ' + forms, 'exactly the read-deny forms appended, nothing else')
  ok('provider: A2 read-deny rides the seatbelt argv when the root is an arxa worktree')

  provider.arxaInternals.egress = 'deny'
  const egressArgv = provider.runnerArgv('seatbelt', policy)
  assert.ok(egressArgv[2].endsWith(SEATBELT_EGRESS_DENY_FORM), 'the opt-in egress deny is appended')
  assert.equal((egressArgv[2].match(/\(deny network\*\)/gu) ?? []).length, 1, 'exactly one egress form')
  delete provider.arxaInternals.egress
  const plainPolicy = { mode: 'workspace-write', workspaceRoot: '/vol/plain/project' }
  assert.deepEqual(
    provider.runnerArgv('seatbelt', plainPolicy),
    stock.runnerArgv('seatbelt', plainPolicy),
    'a non-arxa root and no grants → byte-identical to stock dsh'
  )
  assert.deepEqual(
    provider.runnerArgv('seatbelt', { mode: 'read-only', workspaceRoot: ws }),
    stock.runnerArgv('seatbelt', { mode: 'read-only', workspaceRoot: ws }),
    'read-only stays stock — the read-deny is a workspace-write behaviour'
  )
  ok('provider: egress deny is opt-in only; plain roots and read-only stay byte-identical to stock')
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
    // Blast-radius guard. Every grant is a `(subpath ...)`, so granting the
    // home directory or `/` would silently turn workspace-write into
    // danger-full-access. scripts/s1-sandbox-verify.mjs proves the live
    // subpath grants do not leak UPWARD; this pins that no resolver change can
    // ever name one of these as a root in the first place.
    const forbidden = new Set([canonicalPath(homedir()), canonicalPath('/'), canonicalPath('/Users'), canonicalPath('/Volumes')])
    for (const root of roots) {
      assert.ok(!forbidden.has(root), `grant must never be a home/filesystem root: ${root}`)
      assert.ok(root.split('/').filter(Boolean).length >= 2, `grant must be specific, not near-root: ${root}`)
    }
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

// --- reached through the cordis service proxy, the way every real caller reaches it ---
// dsh serves ctx.<service> as a tracked Proxy, and a JS `#private` field CANNOT be read
// through a Proxy — `this` inside the method is the proxy, which is not an instance of
// the declaring class. A memo held in a #field therefore turned every confined spawn
// into "Cannot read private member #toolchainRoots from an object whose class did not
// declare it". Every previous test called confine() on the RAW instance and passed,
// which is exactly why this shipped.
{
  const ctx = new Context()
  new ArxaSandboxProvider(ctx, { runnerCommand: [], runnerFailureSignatures: [], probeTimeoutMs: 5000 })
  const policy = { mode: 'workspace-write', workspaceRoot: process.cwd(), extraWritableRoots: [join(homedir(), '.claude', 'projects')] }
  // Through ctx.sandbox — NOT the raw instance. This is the production path.
  // A host with no usable backend (no bwrap, no Landlock — an emulated CI
  // container, 2026-09-07) refuses to confine at all, by design; that refusal
  // is a different test, so report it and skip rather than fail here.
  let out
  try {
    out = ctx.sandbox.confine(['/bin/echo', 'hi'], policy)
  } catch (err) {
    if (err?.code !== 'SANDBOX_UNAVAILABLE') throw err
    console.log('  SKIP live: no sandbox backend usable on this host — the proxy path cannot be exercised here')
  }
  if (out) {
    assert.ok(Array.isArray(out.argv) && out.argv.length > 0)
    ok('confine() works through the cordis service proxy, not only on a raw instance')
  }
  // The memo must still memoize: resolution shells out, so a second call must not re-resolve.
  const a = ctx.sandbox.toolchainRoots()
  const b = ctx.sandbox.toolchainRoots()
  assert.equal(a, b, 'toolchainRoots must return the same memoized array, not re-resolve')
  ok('toolchainRoots stays memoized when reached through the proxy')
}

console.log(`arxa-sandbox selftest: ${checks} checks green` + (skipped > 0 ? `, ${skipped} skipped` : ''))
