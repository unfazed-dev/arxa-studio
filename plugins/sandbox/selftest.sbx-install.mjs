// arxa sbx-install selftest — A5 sbx packaging/provisioning (Task 11 Step 2,
// docs/plans/arxa-isolation-levels.md §23: "Install sbx — Yes … or
// bundle/download the release artifact. Must not assume Homebrew.")
// Run: node plugins/sandbox/selftest.sbx-install.mjs
//
// THE DESIGN UNDER TEST:
//   * arxa provisions sbx itself — a checksum-pinned artifact from the
//     official release feed (github.com/docker/sbx-releases) per shipped
//     platform, NO Homebrew assumption, installed into the arxa-managed
//     state root (<arxaHome>/bin), never into /opt/homebrew or /usr.
//   * CHECKSUM PINNED, fail-closed: an artifact without a pinned sha256 is
//     REFUSED — arxa never downloads-and-runs an unverified binary. The
//     shipped pin table ships UNSET where unmeasured; Task 16's authorized
//     gate fills it from the official checksums.
//   * Idempotent updater: an existing managed install at the pinned version
//     re-downloads nothing; a stale one upgrades in place.
//   * An operator PATH install is DETECTED and used as-is — never modified,
//     never shadowed (S3: detect rather than assume).
//   * The daemon starts and diagnoses automatically (§23 checklist).
//
// ALL rows run against injected downloader/extract/runner seams and a fake
// state root under os.tmpdir(). The operator's real install
// (/opt/homebrew/bin/sbx on this machine) is never touched: which() is
// injected everywhere, and every write path is asserted to stay inside the
// fake state root.

import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import * as realFs from 'node:fs'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  SBX_PIN,
  ensureSbxDaemon,
  ensureSbxInstalled,
  ensureSbxRuntime,
  planSbxInstall
} from './lib/sbx-install.js'

let checks = 0
const ok = async (name, fn) => { await fn(); checks++; console.log(`  ok ${name}`) }

// ---- the double ecosystem ----------------------------------------------------

const ARTIFACT_BYTES = Buffer.from('#!/bin/sh\necho fake-sbx\n')

/** A fake-but-complete fs: the REAL node:fs, wrapped so every mutating call
 * is recorded — the confinement assertions read the record. */
const recordingFs = () => {
  const writes = []
  const real = realFs
  const wrap = {}
  for (const k of ['writeFileSync', 'mkdirSync', 'chmodSync', 'rmSync', 'renameSync', 'copyFileSync']) {
    wrap[k] = (p, ...a) => { writes.push(String(p)); return real[k](p, ...a) }
  }
  for (const k of ['existsSync', 'readFileSync', 'readdirSync', 'statSync']) wrap[k] = real[k].bind(real)
  return { fs: wrap, writes }
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** A test pin: versioned, with REAL checksums over the fake artifact bytes. */
const testPin = (version = '9.9.9') => ({
  version,
  base: 'https://releases.test/sbx',
  artifacts: {
    'darwin-arm64': { file: `sbx_${version}_darwin_arm64.tar.gz`, sha256: sha256(ARTIFACT_BYTES) },
    'darwin-amd64': { file: `sbx_${version}_darwin_amd64.tar.gz`, sha256: sha256(ARTIFACT_BYTES) },
    'linux-arm64': { file: `sbx_${version}_linux_arm64.tar.gz`, sha256: sha256(ARTIFACT_BYTES) }
  }
})

const fakeDownloader = (log, bytes = ARTIFACT_BYTES) => async (url, dest) => {
  log.push({ url, dest })
  realFs.writeFileSync(dest, bytes)
}

const fakeExtract = (log) => async (archive, dir) => {
  log.push({ extract: archive })
  realFs.writeFileSync(join(dir, 'sbx'), ARTIFACT_BYTES)
  realFs.chmodSync(join(dir, 'sbx'), 0o755)
}

console.log('arxa sbx-install selftest (Step 2: packaging, updater, daemon)')

// ---- 1. the pinned plan ------------------------------------------------------

await ok('planSbxInstall resolves the exact pinned artifact per platform+arch', () => {
  const p = planSbxInstall({ pin: testPin(), platform: 'darwin', arch: 'arm64' })
  assert.equal(p.supported, true)
  assert.equal(p.artifact.url, 'https://releases.test/sbx/sbx_9.9.9_darwin_arm64.tar.gz')
  assert.equal(p.artifact.sha256, sha256(ARTIFACT_BYTES))
})

await ok('an unsupported platform is refused, not guessed', () => {
  const p = planSbxInstall({ pin: testPin(), platform: 'win32', arch: 'x64' })
  assert.equal(p.supported, false)
  assert.match(p.reason, /win32|platform/i)
})

await ok('the SHIPPED pin table is measured: v0.42.1 feed names, sha256 per key, darwin universal', () => {
  // Task 16 (2026-09-14) measured the official feed
  // (github.com/docker/sbx-releases tag v0.42.1): the darwin artifact is a
  // single universal DockerSandboxes-darwin.tar.gz (both arch keys share it);
  // the darwin sha256 below was cross-checked by hashing the streamed bytes,
  // the linux ones are the release API's server-computed digests.
  assert.equal(SBX_PIN.version, '0.42.1')
  for (const key of ['darwin-arm64', 'darwin-amd64', 'linux-arm64', 'linux-amd64']) {
    assert.match(typeof SBX_PIN.artifacts[key].sha256, /string/, `${key} pin is measured`)
    assert.match(SBX_PIN.artifacts[key].sha256, /^[0-9a-f]{64}$/, `${key} pin is a sha256`)
    assert.match(SBX_PIN.artifacts[key].file, /^DockerSandboxes-(darwin|linux-(amd64|arm64))\.tar\.gz$/, `${key} file matches the official feed shape`)
  }
  assert.equal(SBX_PIN.artifacts['darwin-arm64'].file, SBX_PIN.artifacts['darwin-amd64'].file, 'darwin is one universal artifact')
  const p = planSbxInstall({ pin: SBX_PIN, platform: 'darwin', arch: 'arm64' })
  assert.equal(p.supported, true)
  assert.equal(p.version, '0.42.1')
})

await ok('an unmeasured pin STILL fails closed — the invariant survives the fill', () => {
  const unmeasured = { version: '0.42.1', base: SBX_PIN.base, artifacts: { 'darwin-arm64': { file: 'x.tar.gz', sha256: null } } }
  const p = planSbxInstall({ pin: unmeasured, platform: 'darwin', arch: 'arm64' })
  assert.equal(p.supported, false)
  assert.match(p.reason, /pin|checksum|verif/i)
})

// ---- 2. install into the arxa-managed state root ------------------------------

await ok('a fresh install downloads, verifies, extracts and stamps into the state root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arxa-sbxinstall-'))
  const { fs, writes } = recordingFs()
  const dl = []
  const r = await ensureSbxInstalled({
    stateRoot: root, pin: testPin(), platform: 'darwin', arch: 'arm64',
    which: () => undefined, downloader: fakeDownloader(dl), extract: fakeExtract(dl), fs
  })
  assert.equal(r.installed, true)
  assert.equal(r.managed, 'arxa')
  assert.equal(r.cli, join(root, 'bin', 'sbx'))
  assert.ok(existsSync(r.cli), 'the binary lands in the state root')
  assert.equal(readFileSync(join(root, 'bin', 'sbx.version'), 'utf8').trim(), '9.9.9', 'the version stamp')
  assert.equal(dl.filter((x) => x.url).length, 1, 'exactly one download')
  assert.match(dl[0].url, /darwin_arm64\.tar\.gz$/)
  assert.ok(dl.findIndex((x) => x.extract) > 0, 'extraction happens after the download')
  // CONFIRMED: the sha256 was verified — see the tamper row below.
  for (const w of writes) assert.ok(w.startsWith(root), `every write stays inside the state root, saw ${w}`)
  rmSync(root, { recursive: true, force: true })
})

await ok('a tampered artifact is refused and nothing is installed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arxa-sbxinstall-'))
  const { fs } = recordingFs()
  const tampered = async (url, dest) => {
    realFs.writeFileSync(dest, Buffer.from('#!/bin/sh\necho pwned\n'))
  }
  await assert.rejects(
    () => ensureSbxInstalled({
      stateRoot: root, pin: testPin(), platform: 'darwin', arch: 'arm64',
      which: () => undefined, downloader: tampered, extract: fakeExtract([]), fs
    }),
    /checksum|sha|verif/i
  )
  assert.ok(!existsSync(join(root, 'bin', 'sbx')), 'no unverified binary is ever installed')
  rmSync(root, { recursive: true, force: true })
})

await ok('the updater is idempotent: a matching stamp re-downloads nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arxa-sbxinstall-'))
  const { fs } = recordingFs()
  const dl = []
  const first = await ensureSbxInstalled({
    stateRoot: root, pin: testPin(), platform: 'darwin', arch: 'arm64',
    which: () => undefined, downloader: fakeDownloader(dl), extract: fakeExtract(dl), fs
  })
  assert.equal(first.already, undefined)
  const again = await ensureSbxInstalled({
    stateRoot: root, pin: testPin(), platform: 'darwin', arch: 'arm64',
    which: () => undefined, downloader: fakeDownloader(dl), extract: fakeExtract(dl), fs
  })
  assert.equal(again.installed, true)
  assert.equal(again.already, true, 'the stamp answers before any download')
  assert.equal(dl.filter((x) => x.url).length, 1, 'still exactly one download')
  rmSync(root, { recursive: true, force: true })
})

await ok('a stale managed install upgrades in place', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arxa-sbxinstall-'))
  const { fs } = recordingFs()
  const dl = []
  await ensureSbxInstalled({
    stateRoot: root, pin: testPin('0.1.0'), platform: 'darwin', arch: 'arm64',
    which: () => undefined, downloader: fakeDownloader(dl), extract: fakeExtract(dl), fs
  })
  const up = await ensureSbxInstalled({
    stateRoot: root, pin: testPin('9.9.9'), platform: 'darwin', arch: 'arm64',
    which: () => undefined, downloader: fakeDownloader(dl), extract: fakeExtract(dl), fs
  })
  assert.equal(up.installed, true)
  assert.equal(up.upgraded, true)
  assert.equal(readFileSync(join(root, 'bin', 'sbx.version'), 'utf8').trim(), '9.9.9', 'the stamp moves to the new pin')
  rmSync(root, { recursive: true, force: true })
})

await ok('an operator PATH install is detected and NEVER modified', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arxa-sbxinstall-'))
  const { fs, writes } = recordingFs()
  const dl = []
  const r = await ensureSbxInstalled({
    stateRoot: root, pin: testPin(), platform: 'darwin', arch: 'arm64',
    which: (c) => (c === 'sbx' ? '/opt/homebrew/bin/sbx' : undefined),
    downloader: fakeDownloader(dl), extract: fakeExtract(dl), fs
  })
  assert.equal(r.installed, true)
  assert.equal(r.managed, 'operator-path')
  assert.equal(r.cli, '/opt/homebrew/bin/sbx')
  assert.equal(dl.length, 0, 'nothing is downloaded over an operator install')
  assert.equal(writes.length, 0, 'and nothing is written at all')
  rmSync(root, { recursive: true, force: true })
})

// ---- 3. the daemon ------------------------------------------------------------

const daemonRunner = (statusOut) => {
  const calls = []
  return {
    calls,
    async run (argv, opts) {
      calls.push(argv)
      if (argv[1] === 'daemon' && argv[2] === 'status') return { code: 0, stdout: statusOut, stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    }
  }
}

await ok('ensureSbxDaemon starts (idempotently) and verifies via status', async () => {
  const d = daemonRunner('Status: running\nSocket: /x/sandboxd.sock (connected)\n')
  const r = await ensureSbxDaemon('/opt/homebrew/bin/sbx', { runner: d.run })
  assert.equal(r.daemon, true)
  assert.ok(d.calls.some((a) => a.slice(1, 3).join(' ') === 'daemon start'), 'start runs first')
  assert.ok(d.calls.some((a) => a.slice(1, 3).join(' ') === 'daemon status'), 'status verifies')
})

await ok('a daemon that will not start is reported, never thrown', async () => {
  const d = daemonRunner('Status: stopped\nSocket: /x/sandboxd.sock (not connected)\n')
  const r = await ensureSbxDaemon('/opt/homebrew/bin/sbx', { runner: d.run })
  assert.equal(r.daemon, false)
  assert.match(r.reason, /stopped|not running|unreachable/i)
})

// ---- 4. the runtime orchestration ----------------------------------------------

await ok('ensureSbxRuntime provisions install+daemon+status and NEVER signs in or mutates policy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arxa-sbxruntime-'))
  const { fs } = recordingFs()
  const dl = []
  const d = daemonRunner('Status: running\n')
  const r = await ensureSbxRuntime({
    stateRoot: root, pin: testPin(), platform: 'darwin', arch: 'arm64',
    which: () => undefined, downloader: fakeDownloader(dl), extract: fakeExtract(dl), fs,
    runner: d.run,
    statusRunner: async (argv) => argv[1] === 'ls'
      ? { code: 0, stdout: 'No sandboxes found.\n', stderr: '' }
      : argv[1] === 'daemon'
          ? { code: 0, stdout: 'Status: running\n', stderr: '' }
          : { code: 0, stdout: 'sbx version: v9.9.9 abc\n', stderr: '' }
  })
  assert.equal(r.installed, true)
  assert.equal(r.daemon, true)
  assert.equal(r.authed, true)
  for (const a of d.calls) {
    assert.ok(!a.includes('login'), 'provisioning never signs in (§23a)')
    assert.ok(!a.includes('policy'), 'provisioning never mutates policy (§22a)')
  }
  rmSync(root, { recursive: true, force: true })
})

console.log(`arxa sbx-install selftest: ${checks} checks green`)
