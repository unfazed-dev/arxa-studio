#!/usr/bin/env node
// S1 verification — does the arxa SandboxProvider actually let the toolchain
// work under REAL confinement, while still fencing the workspace?
//
// This is not a simulation. Every row below is produced by handing the argv to
// `ArxaSandboxProvider.confine(argv, policy)` — the same method
// `@deepseek-ai/dsh-bash-sandbox` calls before it spawns — and then spawning
// exactly the argv that comes back. The kernel, not this script, decides.
//
// The pass bar comes from docs/plans/arxa-isolation-levels.md §17:
//   * `git` / `node` / `npm` already passed under the UNMODIFIED profile, so
//     they are the regression baseline — they must still pass.
//   * `dart --version` and `flutter --version` FAILED, and are what S1 fixes.
//   * a write to a sibling project must STILL be denied — that is the whole
//     point of the confinement, and a provider that widened it into
//     danger-full-access with extra steps would pass every other row.
//
// Usage: node scripts/s1-sandbox-verify.mjs
// Exit 0 only when every row matches its expectation.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Context } from '@deepseek-ai/cordis'
import { writableRoots } from '@deepseek-ai/dsh-sandbox'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'

import ArxaSandboxProvider from '../plugins/sandbox/lib/index.js'
import ArxaFileSystem from '../plugins/sandbox/lib/filesystem.js'
import { provisionLocalConfinement } from '../plugins/sandbox/lib/provision.js'

const TIMEOUT_MS = 300_000
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

// The arena lives under the REPO, deliberately, and NOT under `os.tmpdir()`:
// dsh grants `/tmp` and `os.tmpdir()` outright under `workspace-write`, so a
// "sibling project" carved out of the temp dir is inside a granted root and
// the denial row would pass for the wrong reason — it would prove nothing.
// Here `arena/workspace` is writable only because it IS the policy's workspace
// root, and `arena/sibling-project` is reachable by no grant at all. The whole
// arena is removed on the way out.
//
// THE LAYOUT IS THE PRODUCTION SHAPE (§19): the session worktree is a linked
// worktree of the ORG repo at `<org>/.arxa/worktrees/<id>` — its `.git` is a
// pointer into `<org>/.git/worktrees/<id>`, which is exactly why the A2
// read-deny must re-allow the org's `.git` (git status/diff/log read through
// the pointer) while still denying `org.json` and the sibling project.
const arena = mkdtempSync(join(repoRoot, '.s1-arena-'))
const org = join(arena, 'org')
const workspace = join(org, '.arxa', 'worktrees', 'workspace')
const sibling = join(org, 'projects', 'sibling-project')
mkdirSync(join(org, 'projects'), { recursive: true })
mkdirSync(sibling)
process.on('exit', () => rmSync(arena, { recursive: true, force: true }))

// The org repo + its linked session worktree, created OUTSIDE the sandbox so
// the rows measure confinement, not setup.
spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: org, stdio: 'ignore' })
writeFileSync(join(org, 'org.json'), '{"name":"arena"}\n')
spawnSync('git', ['-C', org, 'add', 'org.json'], { stdio: 'ignore' })
spawnSync('git', ['-C', org, '-c', 'user.email=s1@arxa.invalid', '-c', 'user.name=s1', 'commit', '-qm', 'chore: org seed'], { stdio: 'ignore' })
spawnSync('git', ['-C', org, 'worktree', 'add', '-q', workspace, '-b', 'ws-session'], { stdio: 'ignore' })
// The baits: a sibling secret, and a sentinel OUTSIDE the org entirely.
writeFileSync(join(sibling, 'secret.env'), 'SECRET-FROM-SIBLING\n')
writeFileSync(join(arena, 'outside-sentinel.txt'), 'SENTINEL-UNTOUCHED\n')
writeFileSync(join(workspace, 'probe-inside.txt'), 'INSIDE\n')

const ctx = new Context()
const provider = new ArxaSandboxProvider(ctx, {
  runnerCommand: [],
  runnerFailureSignatures: [],
  probeTimeoutMs: 5000
})

const policy = { mode: 'workspace-write', workspaceRoot: workspace }

/**
 * Run one argv under real confinement through the provider's own wrap path.
 * @param {string[]} argv - the exact command.
 * @returns {{ code: number | null, out: string }} exit status and merged output.
 */
function confined (argv) {
  const wrapped = provider.confine(argv, policy)
  const r = spawnSync(wrapped.argv[0], wrapped.argv.slice(1), {
    cwd: workspace,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    env: process.env
  })
  return {
    code: r.status,
    out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim()
  }
}

const insideTarget = join(workspace, 'written-inside.txt')

/** A write case: the target file is what actually decides pass/deny. For a
 * target that already exists (a bait), the verdict is decided by content, not
 * existence — `existsSync` alone would call every denial an escape. */
const write = (name, target, expect) => ({
  name,
  target,
  expect,
  before: existsSync(target) ? readFileSync(target, 'utf8') : undefined,
  argv: ['/bin/sh', '-c', `printf s1probe > ${JSON.stringify(target)}`]
})

// The grants this provider ADDS are the ones worth attacking. `(subpath X)`
// must mean X and nothing above it: granting `<sdk>/bin/cache` must NOT make
// `<sdk>/bin` or `<sdk>` writable. Without these rows the table cannot tell
// this provider apart from one that granted the whole SDK — every other row
// would pass either way. The probes are non-destructive when confinement
// holds (nothing is created); if one lands, that IS the finding, and the row
// fails loudly after deleting the file.
const grantedCache = provider.extraWritableRoots(policy).find((r) => r.endsWith('/bin/cache'))
const escapeCases = grantedCache === undefined
  ? []
  : [
      write('write to <sdk>/bin (parent of grant)', join(dirname(grantedCache), '.s1-probe-denied'), 'deny'),
      write('write to <sdk> root (grandparent)', join(dirname(dirname(grantedCache)), '.s1-probe-denied'), 'deny')
    ]
const cases = [
  { name: 'dart --version', argv: ['dart', '--version'], expect: 'pass', tool: 'dart' },
  { name: 'flutter --version', argv: ['flutter', '--version'], expect: 'pass', tool: 'flutter' },
  { name: 'git status', argv: ['git', 'status', '--porcelain'], expect: 'pass', tool: 'git' },
  { name: 'node -e 1', argv: ['node', '-e', '1'], expect: 'pass', tool: 'node' },
  { name: 'npm --version', argv: ['npm', '--version'], expect: 'pass', tool: 'npm' },
  write('write INSIDE workspace', insideTarget, 'pass'),
  write('write OUTSIDE (sibling)', join(sibling, 'written-outside.txt'), 'deny'),
  write('write OUTSIDE (outside sentinel)', join(arena, 'outside-sentinel.txt'), 'deny'),
  ...escapeCases
]

// The positive twin of the escape rows: a write INSIDE a measured toolchain
// root must succeed — that grant is the whole reason the provider exists (§17).
const grantedToolchainRoot = provider.extraWritableRoots(policy)[0]
if (grantedToolchainRoot !== undefined) {
  const probeFile = join(grantedToolchainRoot, '.s1-probe-ok')
  cases.push(write('write INSIDE measured toolchain root', probeFile, 'pass'))
  // The toolchain root is OUTSIDE the arena — clean its probe file up too.
  process.on('exit', () => rmSync(probeFile, { force: true }))
}

// A2 read rows: the read-deny is scoped to the ORG root, so reads inside the
// worktree and outside the org pass, while the sibling project, its secret and
// the org's own files are unreadable. A denial must also NOT have leaked the
// content — the row checks stdout, not just the exit code.
const read = (name, target, expect, opts = {}) => ({
  name,
  expect,
  argv: ['/bin/cat', target],
  secret: opts.secret
})
const readCases = [
  read('read INSIDE workspace', join(workspace, 'probe-inside.txt'), 'pass'),
  read('read SIBLING secret', join(sibling, 'secret.env'), 'deny', { secret: 'SECRET-FROM-SIBLING' }),
  read('read SIBLING dir listing (via cat)', join(sibling, 'no-such-file'), 'deny'),
  read('read ORG root (org.json)', join(org, 'org.json'), 'deny'),
  read('read OUTSIDE the org (sentinel)', join(arena, 'outside-sentinel.txt'), 'pass'),
  // The deliberate carve-out: git plumbing reads through the worktree's .git
  // POINTER into <org>/.git — this is the row that fails if the re-allow is
  // ever dropped (git status above would go red with it).
  read('read ORG .git plumbing (HEAD)', join(org, '.git', 'HEAD'), 'pass'),
  {
    name: 'agent git add (index write lands in org .git)',
    // The honest limitation, pinned: the agent's SUBPROCESS commits cannot
    // write the worktree index under workspace-write (the index lives in
    // <org>/.git/worktrees/<id>, outside every writable root). Sessions
    // commit host-side (auto-commit); this row proves the confinement is not
    // silently wider than documented.
    argv: ['/bin/sh', '-c', `git add ${JSON.stringify(join(workspace, 'probe-inside.txt'))} 2>&1`],
    expect: 'deny'
  }
]

/** @returns {boolean} whether the named tool is on PATH at all. */
function onPath (tool) {
  return spawnSync('/usr/bin/which', [tool], { stdio: 'ignore' }).status === 0
}

const rows = []
let failed = 0

console.log('S1 — arxa SandboxProvider verification')
console.log(`workspace : ${workspace}`)
console.log(`sibling   : ${sibling}`)
console.log(`dsh roots : ${writableRoots(policy).join(', ')}`)
console.log(`arxa adds : ${provider.extraWritableRoots(policy).join(', ') || '(none)'}`)
console.log('')

for (const c of [...cases, ...readCases]) {
  if (c.tool !== undefined && !onPath(c.tool)) {
    rows.push({ name: c.name, expect: c.expect, got: 'SKIP (not on PATH)', verdict: 'SKIP' })
    continue
  }
  const { code, out } = confined(c.argv)
  const ok = code === 0
  let got = ok ? 'OK' : `FAIL (exit ${code})`
  let verdict

  if (c.expect === 'pass') {
    verdict = ok ? 'PASS' : 'FAIL'
    if (!ok) got += out === '' ? '' : ` — ${out.split('\n')[0].slice(0, 110)}`
  } else {
    // A denial must be a DENIAL, not merely a non-zero exit: the write must
    // not have landed (and a denied read must not have leaked its content).
    // If it did, remove the file before reporting — the probe must never
    // leave a file behind on a host it was not supposed to reach.
    const landed = c.target !== undefined && existsSync(c.target)
      && (c.before === undefined || readFileSync(c.target, 'utf8') !== c.before)
    if (landed && c.before === undefined) rmSync(c.target, { force: true })
    if (landed && c.before !== undefined) writeFileSync(c.target, c.before)
    const leaked = c.secret !== undefined && out.includes(c.secret)
    verdict = !ok && !landed && !leaked ? 'PASS' : 'FAIL'
    got = leaked
      ? 'LEAKED THE SECRET (read isolation failure)'
      : landed
        ? 'WROTE THE FILE (sandbox escape)'
        : ok ? 'exit 0 with no file' : `DENIED (exit ${code})`
  }

  if (verdict === 'FAIL') failed += 1
  rows.push({ name: c.name, expect: c.expect, got, verdict })
}

// The inside-write must have produced its file, not just exited 0.
const insideOk = existsSync(insideTarget) && readFileSync(insideTarget, 'utf8') === 's1probe'
const insideRow = rows.find((r) => r.name === 'write INSIDE workspace')
if (insideRow !== undefined && insideRow.verdict === 'PASS' && !insideOk) {
  insideRow.verdict = 'FAIL'
  insideRow.got = 'exit 0 but no file written'
  failed += 1
}

const w0 = Math.max(...rows.map((r) => r.name.length), 8)
const w1 = Math.max(...rows.map((r) => r.expect.length), 6)
const w2 = Math.max(...rows.map((r) => r.got.length), 6)
const line = (a, b, c, d) => `| ${a.padEnd(w0)} | ${b.padEnd(w1)} | ${c.padEnd(w2)} | ${d.padEnd(7)} |`
console.log(line('command', 'expect', 'result', 'verdict'))
console.log(`|${'-'.repeat(w0 + 2)}|${'-'.repeat(w1 + 2)}|${'-'.repeat(w2 + 2)}|${'-'.repeat(9)}|`)
for (const r of rows) console.log(line(r.name, r.expect, r.got, r.verdict))
console.log('')

// ---- the outside sentinel must be UNCHANGED by everything above ----------
{
  const sentinel = join(arena, 'outside-sentinel.txt')
  const unchanged = existsSync(sentinel) && readFileSync(sentinel, 'utf8') === 'SENTINEL-UNTOUCHED\n'
  console.log(`${unchanged ? 'PASS' : 'FAIL'} outside sentinel unchanged by every probe`)
  if (!unchanged) failed += 1
}

// ---- in-process fence (§20): the same org shape, through ctx.fs -----------
{
  const fsCtx = new Context()
  fsCtx.reflect.provide('sessionProjections', { register () {} })
  new SandboxPolicyService(fsCtx, { mode: 'workspace-write', workspaceRoot: workspace })
  new ArxaFileSystem(fsCtx, {})
  const fs = fsCtx.fs
  // Production call shape (dsh-tool-fs): resolve awaited FIRST, the target
  // handed to the verb as a plain object.
  const readAt = async (p) => fs.readText(await fs.resolve(p, { cwd: workspace }))
  const deniedRead = async (p) => readAt(p).then(() => false, (err) => err?.code === 'FS_SANDBOX_DENIED')
  const deniedWrite = async (p) => fs.writeText(await fs.resolve(p, { cwd: workspace }), 'x', undefined, undefined, policy)
    .then(() => false, (err) => err?.code === 'FS_SANDBOX_DENIED')
  const results = [
    (await readAt('probe-inside.txt')).trim() === 'INSIDE',
    await deniedRead('../../../projects/sibling-project/secret.env'),
    await deniedRead('../../../org.json'),
    await deniedRead('../../registry.json'),
    (await readAt('../../../../outside-sentinel.txt')).trim() === 'SENTINEL-UNTOUCHED',
    // In-process, the agent's file tools must not author git control state.
    // (A nested .git, not the worktree's own `.git` POINTER FILE — that is a
    // file, and resolving under it is FS_NOT_FOUND, not a denial.)
    await deniedWrite('nested/.git/objects/probe')
  ]
  const inProcOk = results.every(Boolean)
  console.log(`${inProcOk ? 'PASS' : 'FAIL'} in-process fence: inside/outside reads ok; sibling, org root, .arxa registry reads and .git writes denied`)
  if (!inProcOk) failed += 1
}

// ---- egress honesty (S3/A3): the status must not overstate coverage -------
{
  const p = provisionLocalConfinement({ platform: process.platform })
  const honest = p.subprocessEgress.enforced === false
    && p.subprocessEgress.doesNotCover.some((x) => x.includes('WebFetch'))
    && p.subprocessEgress.doesNotCover.some((x) => x.includes('MCP'))
    && p.subprocessEgress.doesNotCover.some((x) => x.includes('model-provider'))
    && p.subprocessEgress.seatbeltForm === '(deny network*)'
  console.log(`${honest ? 'PASS' : 'FAIL'} egress status is honest: enforced=${p.subprocessEgress.enforced}, form shipped, and WebFetch/MCP/model traffic named as outside the claim`)
  if (!honest) failed += 1
}

if (failed > 0) {
  console.error(`S1 verification RED — ${failed} row(s) did not match.`)
  process.exit(1)
}
console.log('S1 verification GREEN — toolchain works confined, sibling write denied, reads isolated to the worktree, egress honestly reported.')
