// arxa sbx-install — A5 sbx packaging/provisioning (Task 11 Step 2,
// docs/plans/arxa-isolation-levels.md §23: "Install sbx — Yes … or
// bundle/download the release artifact. Must not assume Homebrew.")
//
// THE DESIGN:
//   * arxa provisions sbx itself: a checksum-pinned artifact from the
//     official release feed, per shipped platform, installed into the
//     arxa-managed state root (<arxaHome>/bin — ARXA_HOME relocatable, the
//     same convention as bin/arxa-studio.mjs). NEVER /opt/homebrew, never
//     /usr/local, never `brew anything`.
//   * FAIL-CLOSED PINNING: an artifact without a measured sha256 pin is
//     REFUSED — arxa does not download-and-run unverified binaries. The
//     shipped SBX_PIN carries null checksums wherever unmeasured; the
//     authorized external gate (Task 16) fills them from the official
//     checksums before any real install.
//   * Idempotent updater: a managed install at the pinned version
//     re-downloads nothing; a stale one upgrades in place. An operator PATH
//     install is DETECTED and used as-is — never modified, never shadowed
//     (S3: detect rather than assume).
//   * The daemon starts and diagnoses automatically (§23 checklist); a
//     daemon that will not start is reported, never thrown.
//
// Every seam is injectable: downloader(url, dest), extract(archive, dir),
// fs, which, runner. Unit tests never touch the operator install.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { whichOnPath } from './index.js'
import { sbxStatus } from './sbx.js'

/** The arxa-managed state root (same convention as bin/arxa-studio.mjs). */
export function defaultStateRoot () {
  return process.env.ARXA_HOME?.trim() ? resolve(process.env.ARXA_HOME) : join(homedir(), '.arxa')
}

/**
 * The shipped pin. Version + artifact names follow the official feed
 * (github.com/docker/sbx-releases); the sha256 values are UNSET until
 * measured — planning against an unset pin refuses rather than trusting an
 * unverified download. Task 16's authorized gate fills them from the
 * release's official checksums.
 * ponytail: single tar.gz-per-platform assumption; adjust file names/sha
 * when the real asset shape is measured at the gate.
 */
export const SBX_PIN = {
  version: '0.42.1',
  base: 'https://github.com/docker/sbx-releases/releases/download',
  artifacts: {
    'darwin-arm64': { file: 'sbx_0.42.1_darwin_arm64.tar.gz', sha256: null },
    'darwin-amd64': { file: 'sbx_0.42.1_darwin_amd64.tar.gz', sha256: null },
    'linux-arm64': { file: 'sbx_0.42.1_linux_arm64.tar.gz', sha256: null },
    'linux-amd64': { file: 'sbx_0.42.1_linux_amd64.tar.gz', sha256: null }
  }
}

/**
 * Resolve the pinned artifact for one platform+arch. Pure.
 * @returns {{ supported: true, artifact: { url: string, file: string,
 *   sha256: string } } | { supported: false, reason: string }}
 */
export function planSbxInstall ({ pin = SBX_PIN, platform = process.platform, arch = process.arch }) {
  const archKey = arch === 'x64' ? 'amd64' : arch
  const key = `${platform}-${archKey}`
  const artifact = pin.artifacts[key]
  if (artifact === undefined) {
    return { supported: false, reason: `no pinned sbx artifact for ${key} — the A5 tier stays unavailable on this platform; degrading to the highest tier this machine can enforce` }
  }
  if (typeof artifact.sha256 !== 'string' || artifact.sha256 === '') {
    return { supported: false, reason: `the sbx checksum pin for ${key} is unmeasured — arxa refuses to download and run an unverified binary (fail-closed); the authorized external gate fills the pin from the official release checksums` }
  }
  return { supported: true, artifact: { url: `${pin.base}/${artifact.file}`, file: artifact.file, sha256: artifact.sha256 }, version: pin.version }
}

/** The default downloader: node fetch → bytes → dest (no curl/wget). */
async function defaultDownloader (url, dest) {
  const { writeFileSync } = await import('node:fs')
  const r = await fetch(url)
  if (!r.ok) throw new Error(`sbx-install: download failed (${r.status} ${url})`)
  writeFileSync(dest, Buffer.from(await r.arrayBuffer()))
}

/** The default extractor: a plain tar.gz. */
function defaultExtract (archive, dir) {
  const r = spawnSync('tar', ['-xzf', archive, '-C', dir], { encoding: 'utf8', timeout: 120000 })
  if (r.status !== 0) throw new Error(`sbx-install: extraction failed: ${(r.stderr || '').slice(0, 200)}`)
}

/**
 * Ensure sbx exists on this machine, arxa-managed when possible:
 *   1. a managed install at the pinned version is the live answer
 *      (idempotent — re-downloads nothing);
 *   2. an operator PATH install is detected and used as-is, never touched;
 *   3. otherwise download the pinned artifact, VERIFY ITS CHECKSUM, extract
 *      into the state root and stamp the version (the updater path — a
 *      stale stamp upgrades in place).
 *
 * @param {object} deps - injection seam (tests): `{ stateRoot, pin,
 *   platform, arch, which, downloader, extract, fs }`.
 * @returns {Promise<{ installed: boolean, cli?: string, managed?: string,
 *   version?: string, already?: boolean, upgraded?: boolean, reason? }>}
 * @throws only on an INTEGRITY violation (checksum mismatch) — an
 *   unsupported platform or unavailable artifact is a reported degrade,
 *   not an exception.
 */
export async function ensureSbxInstalled (deps = {}) {
  const fs = deps.fs ?? (await import('node:fs'))
  const which = deps.which ?? whichOnPath
  const root = resolve(deps.stateRoot ?? defaultStateRoot())
  const binDir = join(root, 'bin')
  const cliPath = join(binDir, 'sbx')
  const stampPath = join(binDir, 'sbx.version')
  const pin = deps.pin ?? SBX_PIN

  // 1. Idempotent: the stamp answers before any download.
  if (fs.existsSync(cliPath) && fs.existsSync(stampPath) && fs.readFileSync(stampPath, 'utf8').trim() === pin.version) {
    return { installed: true, managed: 'arxa', cli: cliPath, version: pin.version, already: true }
  }

  // 2. An operator PATH install is used as-is (S3) — never modified.
  const onPath = which('sbx')
  if (onPath !== undefined && !fs.existsSync(cliPath)) {
    return { installed: true, managed: 'operator-path', cli: onPath }
  }

  // 3. Provision from the pinned artifact.
  const plan = planSbxInstall({ pin, platform: deps.platform, arch: deps.arch })
  if (!plan.supported) return { installed: false, reason: plan.reason }

  const downloader = deps.downloader ?? defaultDownloader
  const extract = deps.extract ?? defaultExtract
  const upgraded = fs.existsSync(cliPath)
  const archive = join(binDir, '.sbx-download.tmp')
  const extractDir = join(binDir, '.sbx-extract')
  fs.mkdirSync(binDir, { recursive: true })
  try {
    await downloader(plan.artifact.url, archive)
    const digest = createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
    if (digest !== plan.artifact.sha256) {
      throw new Error(`sbx-install: checksum verification FAILED for ${plan.artifact.file} — expected ${plan.artifact.sha256.slice(0, 12)}…, got ${digest.slice(0, 12)}…; refusing to install unverified bytes`)
    }
    fs.rmSync(extractDir, { recursive: true, force: true })
    fs.mkdirSync(extractDir, { recursive: true })
    await extract(archive, extractDir)
    const extracted = join(extractDir, 'sbx')
    if (!fs.existsSync(extracted)) throw new Error('sbx-install: the artifact did not contain an `sbx` binary — pin table does not match the release shape')
    fs.rmSync(cliPath, { force: true })
    fs.copyFileSync(extracted, cliPath)
    fs.chmodSync(cliPath, 0o755)
    fs.writeFileSync(stampPath, plan.version + '\n')
    return { installed: true, managed: 'arxa', cli: cliPath, version: plan.version, ...(upgraded ? { upgraded: true } : {}) }
  } finally {
    fs.rmSync(archive, { force: true })
    fs.rmSync(extractDir, { recursive: true, force: true })
  }
}

/**
 * Start the sandboxd daemon and verify it answered. `sbx daemon start` is
 * idempotent; `sbx daemon status` prints the truth ("Status: stopped"
 * exits 0 — the TEXT decides). `sbx diagnose` output is captured for the
 * card. A daemon that will not start is REPORTED, never thrown.
 * @returns {Promise<{ daemon: boolean, status?: string, diagnostics?: string,
 *   reason?: string }>}
 */
export async function ensureSbxDaemon (cli = 'sbx', deps = {}) {
  const runner = deps.runner ?? (async (argv, opts) => {
    const r = spawnSync(argv[0], argv.slice(1), { ...opts, encoding: 'utf8', timeout: opts?.timeout ?? 60000, maxBuffer: 16 * 1024 * 1024 })
    return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  })
  await runner([cli, 'daemon', 'start'], { timeout: 60000 })
  const statusR = await runner([cli, 'daemon', 'status'], { timeout: 15000 })
  const status = /Status:\s*(\w+)/.exec(statusR.stdout)?.[1]
  const daemon = status === 'running'
  const diagR = await runner([cli, 'diagnose'], { timeout: 30000 }).catch(() => ({ code: 1, stdout: '', stderr: '' }))
  return {
    daemon,
    status,
    diagnostics: daemon ? (diagR.stdout || '').trim().slice(0, 4000) : undefined,
    ...(daemon ? {} : { reason: `the sandboxd daemon did not come up (status: ${status ?? 'unreachable'}) — the A5 tier cannot run here; degrading to the highest tier this machine can enforce` })
  }
}

/**
 * The full §23 provisioning leg short of the two operator-owned steps:
 * install (arxa-managed, checksum-pinned), daemon (started + diagnosed),
 * status (version/auth). NEVER signs in (§23a) and NEVER touches policy
 * (§22a) — those belong to the operator and the authorized gate.
 * @returns {Promise<object>} the composed truthful machine state.
 */
export async function ensureSbxRuntime (deps = {}) {
  const inst = await ensureSbxInstalled(deps)
  if (!inst.installed) {
    return { installed: false, daemon: false, authed: false, install: inst, reason: inst.reason }
  }
  const daemon = await ensureSbxDaemon(inst.cli, deps)
  const status = await sbxStatus({ which: () => inst.cli, runner: deps.statusRunner ?? deps.runner })
  return { ...status, install: inst, daemon: daemon.daemon && status.daemon, daemonDetail: daemon, runners: { ...status.runners, sbx: daemon.daemon && status.runners.sbx } }
}
