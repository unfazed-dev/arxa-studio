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
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Context } from '@deepseek-ai/cordis'
import { writableRoots } from '@deepseek-ai/dsh-sandbox'

import ArxaSandboxProvider from '../plugins/sandbox/lib/index.js'

const TIMEOUT_MS = 300_000
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

// The arena lives under the REPO, deliberately, and NOT under `os.tmpdir()`:
// dsh grants `/tmp` and `os.tmpdir()` outright under `workspace-write`, so a
// "sibling project" carved out of the temp dir is inside a granted root and
// the denial row would pass for the wrong reason — it would prove nothing.
// Here `arena/workspace` is writable only because it IS the policy's workspace
// root, and `arena/sibling-project` is reachable by no grant at all. The whole
// arena is removed on the way out.
const arena = mkdtempSync(join(repoRoot, '.s1-arena-'))
const workspace = join(arena, 'workspace')
const sibling = join(arena, 'sibling-project')
mkdirSync(workspace)
mkdirSync(sibling)
process.on('exit', () => rmSync(arena, { recursive: true, force: true }))

// `git status` needs a repository; creating it OUTSIDE the sandbox keeps the
// row a pure read-path measurement of git under confinement.
spawnSync('git', ['init', '-q'], { cwd: workspace, stdio: 'ignore' })

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

/** A write case: the target file is what actually decides pass/deny. */
const write = (name, target, expect) => ({
  name,
  target,
  expect,
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
  ...escapeCases
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

for (const c of cases) {
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
    // not have landed. If it did, remove it before reporting — the probe must
    // never leave a file behind on a host it was not supposed to reach.
    const landed = existsSync(c.target)
    if (landed) rmSync(c.target, { force: true })
    verdict = !ok && !landed ? 'PASS' : 'FAIL'
    got = landed
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

if (failed > 0) {
  console.error(`S1 verification RED — ${failed} row(s) did not match.`)
  process.exit(1)
}
console.log('S1 verification GREEN — toolchain works confined, sibling write denied.')
