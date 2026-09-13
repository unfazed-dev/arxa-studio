// arxa devcontainer — A4 Docker project isolation (Task 10, docs/plans/
// arxa-isolation-levels.md L1/§4-§8 + worktree corrections).
//
// THE DESIGN, from the plan:
//   * A4 is automatic-if-Docker-is-present — DETECT, never install (S3 §2).
//     detectDocker() distinguishes an absent CLI from an unreachable daemon
//     and every degrade carries a truthful reason; nothing here ever runs
//     brew/apt/npm-install.
//   * The declarative half (.devcontainer/devcontainer.json + a
//     target-aware Dockerfile) is generated ONLY through the owned frame
//     functions in plugins/git-workspace/lib/frame.js — stamped, never
//     clobbered, upgradable exactly like check.sh, so a repo a human edited
//     is never overwritten. The lifecycle half reuses the SAME runArgs as
//     its docker argv: one source of truth for the L1 hardening.
//   * L1 hardening (§4): --read-only + tmpfs /tmp, --cap-drop=ALL,
//     no-new-privileges, non-root USER (in the Dockerfile), cpu/mem/pids
//     limits, an EXPLICIT network decision (--network none — egress off
//     until a phase-split exists), bind-mount only the project (here: only
//     a private named volume), never docker.sock, never --privileged.
//   * @devcontainers/cli is DETECTED (absence degrades honestly) but the
//     lifecycle runs raw `docker`: `devcontainer up --workspace-folder`
//     bind-mounts a HOST path, which the worktree invariants forbid — a
//     session's work lives in a private volume, not on the host tree.
//
// ROOT CONFINEMENT: paths are resolved and realpath'd before any mutation;
// `.git`/`.arxa` are refused as generation targets, and a pre-existing
// `.devcontainer` symlink pointing outside the repo is a refused escape.

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'

import { createKeyring } from '../../github-link/lib/keyring.js'
import { devcontainerRunArgs, writeFrameFiles } from '../../git-workspace/lib/frame.js'
import { whichOnPath } from './index.js'
import { accountFor } from './project-secrets.js'

const runFile = promisify(execFile)

/**
 * The default runner: real subprocesses, argv form only (never a shell
 * string), bounded output and time. Every caller-facing result is
 * structured `{ code, stdout, stderr }` — a non-zero exit is DATA, not an
 * exception, so refusal paths can report honestly.
 */
async function defaultRunner (argv, opts = {}) {
  try {
    const r = await runFile(argv[0], argv.slice(1), {
      cwd: opts.cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: opts.timeout ?? 120000
    })
    return { code: 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  } catch (err) {
    return { code: err.code === undefined ? 1 : (typeof err.code === 'number' ? err.code : 1), stdout: err.stdout ?? '', stderr: err.stderr ?? String(err?.message ?? err) }
  }
}

/** A docker-safe, filesystem-safe slug for one session's names. */
const slugFor = (sessionId) => String(sessionId).replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()

/** Branch names reach a `sh -c` clone string — only the git-safe alphabet is
 * accepted, so nothing user-controlled can escape the quotes. */
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

/** The registry row for one session's container: `<repo>/.arxa/containers/`. */
const registryPathFor = (repo, sessionId) => join(repo, '.arxa', 'containers', `${slugFor(sessionId)}.json`)

function writeRegistry (repo, row) {
  mkdirSync(join(repo, '.arxa', 'containers'), { recursive: true })
  writeFileSync(registryPathFor(repo, row.sessionId), JSON.stringify(row, null, 2) + '\n')
}

/** Read one session's registry row, or null when it never had a container. */
export function readContainerRegistry (repo, sessionId) {
  const p = registryPathFor(resolve(String(repo)), sessionId)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}

/**
 * The SYNC teardown guard (consumed by git-workspace's finishSession /
 * dropSession): every container commit must be reachable from the host
 * recovery ref before any branch-dropping teardown. Pure read — no docker.
 * @returns {{ unrecovered: number, head: string | null, recoveryRef: string |
 *   null }} unrecovered > 0 refuses teardown.
 */
export function unrecoveredContainerCommits (repoPath, sessionId) {
  const repo = resolve(String(repoPath))
  const row = readContainerRegistry(repo, sessionId)
  if (row === null) return { unrecovered: 0, head: null, recoveryRef: null }
  const head = row.head ?? null
  const recoveryRef = row.recoveryRef ?? null
  if (head === null || recoveryRef === null) return { unrecovered: 1, head, recoveryRef }
  const r = spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', head, recoveryRef], { encoding: 'utf8', timeout: 10000 })
  return { unrecovered: r.status === 0 ? 0 : 1, head, recoveryRef }
}

/** Detect Docker: CLI presence then daemon reachability. Never installs.
 * @param {object} [deps] - injection seam (tests): `{ which, probe }`.
 * @returns {{ available: boolean, daemon: boolean, cli: string | undefined,
 *   version?: string, reason: string }} the truthful machine state. */
export function detectDocker (deps = {}) {
  const which = deps.which ?? whichOnPath
  const probe = deps.probe ?? ((argv) => spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: 5000 }))
  const cli = which('docker')
  if (cli === undefined) {
    return { available: false, daemon: false, cli: undefined, reason: 'Docker is not installed — arxa detects rather than assumes (S3); the A4 tier stays unavailable on this machine' }
  }
  const r = probe([cli, 'version', '--format', '{{.Server.Version}}'])
  const version = String(r.stdout ?? '').trim()
  if (r.code !== 0 || version === '') {
    return { available: false, daemon: false, cli, reason: `Docker is installed (${cli}) but its daemon is not reachable — the A4 tier cannot run containers here; degrading to the highest tier this machine can enforce` }
  }
  return { available: true, daemon: true, cli, version, reason: 'Docker is present — the A4 hardened-container tier is available on this machine' }
}

/** Detect the @devcontainers/cli — reported honestly, never required (the
 * lifecycle uses raw docker because the invariants forbid host mounts).
 * @param {object} [deps] - injection seam (tests): `{ which }`.
 * @returns {{ available: boolean, cli: string | undefined, reason: string }} */
export function detectDevcontainerCli (deps = {}) {
  const which = deps.which ?? whichOnPath
  const cli = which('devcontainer')
  if (cli === undefined) {
    return { available: false, cli: undefined, reason: 'the @devcontainers/cli is not installed — IDE-side "Reopen in Container" stays unavailable; arxa\'s own lifecycle does not depend on it' }
  }
  return { available: true, cli, reason: 'the @devcontainers/cli is installed — the generated config is directly usable from the IDE' }
}

/**
 * Resolve and guard a project repo path before any mutation: refuse the
 * reserved `.git`/`.arxa` paths (root confinement) and symlink escape (the
 * `.devcontainer` write target must stay inside the repo after realpath).
 * @param {string} projectRepo - the repo root as the caller spells it.
 * @returns {string} the realpath'd repo root.
 */
function resolveRepoGuarded (projectRepo) {
  const repo = resolve(String(projectRepo))
  for (const seg of repo.split(/[/\\]/)) {
    if (seg === '.git' || seg === '.arxa') {
      throw new Error(`devcontainer: refusing to generate inside reserved path '${seg}' (${repo})`)
    }
  }
  if (!existsSync(repo)) return repo // writeFrameFiles mkdirs it; nothing escaped yet
  const real = realpathSync(repo)
  const target = join(real, '.devcontainer')
  if (existsSync(target) && statSync(target).isDirectory()) {
    const realTarget = realpathSync(target)
    if (!realTarget.startsWith(real + '/') && realTarget !== real) {
      throw new Error(`devcontainer: refusing symlink escape — ${target} resolves outside the repo`)
    }
  }
  return real
}

/**
 * Derive the devcontainer target from the repo's own shape (the same probe
 * idea as the frame's check.sh): package.json → node, pubspec.yaml →
 * flutter, anything else → plain (a minimal git-capable image).
 * @param {string} repo - the repo root.
 * @returns {'node' | 'flutter' | 'plain'} the target.
 */
function detectTarget (repo) {
  if (existsSync(join(repo, 'package.json'))) return 'node'
  if (existsSync(join(repo, 'pubspec.yaml'))) return 'flutter'
  return 'plain'
}

/**
 * Ensure one project repo carries the A4 declarative frame: the
 * `.devcontainer/devcontainer.json` + target-aware Dockerfile, written
 * ONLY through the owned frame functions (idempotent, stamped,
 * never-clobbering a human edit). The files themselves are
 * Docker-independent — they are written even when Docker is absent; only
 * the LIFECYCLE degrades, and it degrades with the reported reason.
 *
 * @param {string} projectRepo - the project repo root.
 * @param {'node' | 'flutter' | 'plain'} [target] - the scaffold target;
 *   derived from the repo shape when omitted.
 * @param {object} [deps] - injection seam (tests): `{ docker }` — a
 *   pre-measured detectDocker() result.
 * @returns {{ target: string, docker: object, written: string[],
 *   kept: string[], upgraded: string[], conflicted: string[] }} the frame
 *   write report plus the measured Docker state.
 */
export function ensureDevcontainer (projectRepo, target, deps = {}) {
  const repo = resolveRepoGuarded(projectRepo)
  const t = target ?? detectTarget(repo)
  const docker = deps.docker ?? detectDocker()
  return { target: t, docker, ...writeFrameFiles(repo, 'project', { devcontainer: t }) }
}

// ---- file-based secret injection (Step 4, §7) -------------------------------
//
// The L0/L1 rule: decrypt HOST-SIDE, hand the plaintext to EXACTLY ONE
// container as a file-based secret under /run/secrets — never `-e`,
// `--env-file` or `--build-arg` (docker inspect shows all three in clear),
// never ambient env, never baked into the image or config. The plaintext
// lives in one bounded temp file (0600 inside a 0700 mkdtemp dir under
// os.tmpdir()) and is removed on EVERY exit path: explicit cleanup, container
// teardown (the handle records the dir), and a failed start.

/**
 * Decrypt one project's `.env.sops` into a bounded temporary file ready to
 * mount as a Compose-secret-equivalent at /run/secrets/arxa-env.
 *
 * @param {{ orgId: string, projectId: string, envSopsPath: string }} input -
 *   the Task 9 scoping ids and the ciphertext path.
 * @param {object} [deps] - injection seam (tests): `{ keyring, sops }`.
 * @returns {Promise<{ source: string, target: string, secretDir: string,
 *   cleanup: () => void }>} the mount triple; `source` is the ONLY place the
 *   plaintext exists, and `cleanup` removes it.
 */
export async function prepareSecretMount ({ orgId, projectId, envSopsPath }, deps = {}) {
  const keyring = deps.keyring ?? createKeyring()
  const sops = deps.sops ?? (async (sargv, opts) => runFile('sops', sargv, opts))
  const stored = await keyring.getSecret(accountFor(orgId, projectId))
  if (stored === null) throw new Error(`devcontainer: no keychain key for ${orgId}/${projectId} — run ensureProjectAgeKey first`)
  let identity
  try { identity = JSON.parse(stored) } catch { throw new Error('devcontainer: project-secrets keychain item is not valid JSON') }

  let plaintext = Buffer.alloc(0)
  try {
    // The identity reaches ONLY this child's env (§7); encoding 'buffer'
    // keeps the plaintext out of string interning so the zeroing works.
    plaintext = await sops(['--decrypt', envSopsPath], {
      env: { ...process.env, SOPS_AGE_KEY: identity.secretKey },
      encoding: 'buffer',
      maxBuffer: 16 * 1024 * 1024
    })
    const secretDir = mkdtempSync(join(tmpdir(), 'arxa-secret-'))
    const source = join(secretDir, 'arxa-env')
    writeFileSync(source, plaintext, { mode: 0o600 })
    chmodSync(source, 0o600)
    return {
      source,
      target: '/run/secrets/arxa-env',
      secretDir,
      cleanup: () => rmSync(secretDir, { recursive: true, force: true })
    }
  } finally {
    plaintext.fill(0)
  }
}

/**
 * The boot sweep for §7's "every exit path": a SIGINT/SIGKILL between
 * prepareSecretMount and any cleanup leaves plaintext under tmpdir. At boot
 * no lifecycle is live yet, so every arxa-secret-* dir there is stale.
 * @param {object} [deps] - injection seam (tests): `{ tmpdir, rmSync }`.
 * @returns {number} how many stale dirs were removed.
 */
export function sweepStaleSecretDirs (deps = {}) {
  const tmp = (deps.tmpdir ?? tmpdir)()
  const rm = deps.rmSync ?? rmSync
  if (!existsSync(tmp)) return 0
  let swept = 0
  for (const name of readdirSync(tmp)) {
    if (!name.startsWith('arxa-secret-')) continue
    rm(join(tmp, name), { recursive: true, force: true })
    swept++
  }
  return swept
}

// ponytail: the boot sweep would also delete the live secret dir of a second
// concurrently-running arxa process; per-session locks if that ever matters.
try { sweepStaleSecretDirs() } catch { /* a boot sweep must never break boot */ }

// ---- the lifecycle (Step 3) -------------------------------------------------
//
// SAFETY INVARIANTS (binding):
//   * the session branch is cloned into a PRIVATE NAMED VOLUME from a host
//     git bundle — the one and only host artifact mounted, read-only, into
//     the one-shot clone helper. The repo itself, the org root, sibling
//     projects and a host worktree's pointer-style .git are NEVER mounted
//     (the bundle is built host-side before any container exists);
//   * the container NEVER runs on main/master — refused before any docker
//     call;
//   * results return to the host through git (bundle → fetch → recovery
//     ref) BEFORE teardown; stopContainer refuses while any container
//     commit is unreachable from the recovery ref, and so does the sync
//     guard git-workspace's teardown paths call.

/**
 * Clone the exact session branch into a private volume and start the
 * hardened work container.
 *
 * @param {{ repoPath: string, branch: string, sessionId: string,
 *   target?: 'node' | 'flutter' | 'plain' }} input - the owning repo, the
 *   session branch (never main), the session id and optional target.
 * @param {object} [deps] - injection seam (tests): `{ runner }`.
 * @returns {Promise<object>} the container handle (container, volume,
 *   image, head, recoveryRef, registryPath).
 */
export async function startContainer ({ repoPath, branch, sessionId, target, secretMount }, deps = {}) {
  const runner = deps.runner ?? defaultRunner
  if (typeof branch !== 'string' || !BRANCH_RE.test(branch)) throw new Error(`devcontainer: refusing branch ${JSON.stringify(branch)} — not a branch name this lifecycle will clone`)
  if (branch === 'main' || branch === 'master') throw new Error(`devcontainer: refusing to run the container on '${branch}' — A4 sessions work on their own branch, never on project main`)
  if (typeof sessionId !== 'string' || sessionId.trim() === '') throw new TypeError('devcontainer: sessionId is required')

  const repo = resolveRepoGuarded(repoPath)
  // A host worktree's `.git` is a POINTER FILE into the parent repo's
  // common git dir — cloning through it would couple the container to the
  // org repo's whole object store. Refuse; A4 needs a real repo.
  const gitPath = join(repo, '.git')
  if (existsSync(gitPath) && statSync(gitPath).isFile()) {
    throw new Error(`devcontainer: refusing ${repo} — a host worktree's pointer-style .git cannot back a container; pass the owning repository`)
  }

  // Idempotent start (Step 3): an existing session's registry row IS the
  // live handle — a re-start returns it instead of cloning into the
  // session's own non-empty volume and colliding on the container name.
  const existing = readContainerRegistry(repo, sessionId)
  if (existing !== null) return existing

  const headR = await runner(['git', '-C', repo, 'rev-parse', '--verify', branch])
  if (headR.code !== 0) throw new Error(`devcontainer: branch '${branch}' not found in ${repo}`)
  const head = headR.stdout.trim()

  const t = target ?? detectTarget(repo)
  // The frame (declarative config + Dockerfile) is written through the OWNED
  // frame functions — never clobbering a human edit — because the image is
  // BUILT from the same Dockerfile the spec points at.
  writeFrameFiles(repo, 'project', { devcontainer: t })

  const slug = slugFor(sessionId)
  const image = `arxa-a4-${t}:frame`
  const volume = `arxa-a4-${slug}-work`
  const container = `arxa-a4-${slug}`
  const recoveryRef = `refs/arxa/container-recovery/${slug}`

  // The bundle: the ONLY host path any container ever sees, read-only
  // (the secret mount is the second, equally narrow exception — also a
  // bounded temp file, readonly, never the repo itself).
  const tmp = mkdtempSync(join(tmpdir(), `arxa-a4-${slug}-`))
  try {
    const bundle = join(tmp, 'src.bundle')
    const b = await runner(['git', '-C', repo, 'bundle', 'create', bundle, branch])
    if (b.code !== 0) throw new Error(`devcontainer: git bundle create failed: ${b.stderr.trim()}`)

    const build = await runner(['docker', 'build', '-t', image, join(repo, '.devcontainer')], { timeout: 600000 })
    if (build.code !== 0) throw new Error(`devcontainer: docker build failed: ${build.stderr.trim().slice(0, 400)}`)

    const v = await runner(['docker', 'volume', 'create', volume])
    if (v.code !== 0) throw new Error(`devcontainer: docker volume create failed: ${v.stderr.trim()}`)

    // The clone helper: root (it must chown the fresh volume for the
    // non-root work user) but capped, offline, read-only rootfs — it only
    // ever touches the ro bundle and the private volume, never the secret.
    const clone = await runner([
      'docker', 'run', '--rm', '--user', '0:0', '--read-only', '--cap-drop=ALL', '--network', 'none',
      '-v', `${bundle}:/src.bundle:ro`, '-v', `${volume}:/work`, image,
      'sh', '-c', `git clone /src.bundle -b ${branch} /work && chown -R 1000:1000 /work`
    ])
    if (clone.code !== 0) throw new Error(`devcontainer: branch clone into the private volume failed: ${(clone.stdout + clone.stderr).trim().slice(0, 400)}`)

    const start = await runner(['docker', 'run', '-d', '--name', container,
      ...devcontainerRunArgs(),
      '-v', `${volume}:/work`,
      ...(secretMount ? ['--mount', `type=bind,source=${secretMount.source},target=${secretMount.target},readonly`] : []),
      '-w', '/work', image, 'sleep', 'infinity'])
    if (start.code !== 0) throw new Error(`devcontainer: docker run failed: ${start.stderr.trim().slice(0, 400)}`)
  } catch (err) {
    // EVERY exit path cleans the plaintext: a failed start must not leave
    // the decrypted .env sitting in tmpdir.
    if (secretMount) rmSync(dirname(secretMount.source), { recursive: true, force: true })
    throw err
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  const handle = { sessionId, branch, repoPath: repo, target: t, container, volume, image, head, recoveryRef, registryPath: registryPathFor(repo, sessionId), ...(secretMount ? { secretDir: dirname(secretMount.source) } : {}) }
  writeRegistry(repo, { ...handle, recovered: false, createdAt: Date.now() })
  return handle
}

/**
 * Run one command inside the container. Structured result, bounded output.
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export async function execContainer (handle, argv, deps = {}) {
  const runner = deps.runner ?? defaultRunner
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((a) => typeof a !== 'string')) {
    throw new TypeError('devcontainer: execContainer takes an argv array of strings, never a shell string')
  }
  return runner(['docker', 'exec', handle.container, ...argv])
}

/**
 * Bring the container's commits back to the host: bundle INSIDE the
 * container, `docker cp` out, then a real host-side `git fetch` into the
 * recovery ref. Idempotent.
 * @returns {Promise<{ containerHead: string, recoveryRef: string,
 *   reachable: boolean }>}
 */
export async function fetchContainerCommits (handle, deps = {}) {
  const runner = deps.runner ?? defaultRunner
  const repo = handle.repoPath ?? resolveRepoGuarded(handle.registryPath ? handle.repoPath : '.')
  const headR = await runner(['docker', 'exec', handle.container, 'git', '-C', '/work', 'rev-parse', 'HEAD'])
  if (headR.code !== 0) throw new Error(`devcontainer: cannot read the container HEAD (${handle.container}): ${(headR.stderr || headR.stdout).trim().slice(0, 200)}`)
  const containerHead = headR.stdout.trim()

  const mkBundle = await runner(['docker', 'exec', handle.container, 'git', '-C', '/work', 'bundle', 'create', '/tmp/recovery.bundle', '--all'])
  if (mkBundle.code !== 0) throw new Error(`devcontainer: in-container bundle create failed: ${mkBundle.stderr.trim().slice(0, 200)}`)

  const tmp = mkdtempSync(join(tmpdir(), `arxa-a4-recover-`))
  try {
    const out = join(tmp, 'recovery.bundle')
    const cp = await runner(['docker', 'cp', `${handle.container}:/tmp/recovery.bundle`, out])
    if (cp.code !== 0) throw new Error(`devcontainer: docker cp of the recovery bundle failed: ${cp.stderr.trim().slice(0, 200)}`)
    const fetch = await runner(['git', '-C', repo, 'fetch', out, `+refs/heads/${handle.branch}:${handle.recoveryRef}`])
    if (fetch.code !== 0) throw new Error(`devcontainer: host git fetch into ${handle.recoveryRef} failed: ${fetch.stderr.trim().slice(0, 200)}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  const reach = await runner(['git', '-C', repo, 'merge-base', '--is-ancestor', containerHead, handle.recoveryRef])
  const reachable = reach.code === 0
  const row = readContainerRegistry(repo, handle.sessionId)
  writeRegistry(repo, { ...row, ...handle, head: containerHead, recovered: reachable, fetchedAt: Date.now() })
  return { containerHead, recoveryRef: handle.recoveryRef, reachable }
}

/** Is the named docker object verifiably absent? inspect exit 0 = it still
 * exists; "No such" = gone; a daemon/connection error = UNVERIFIED, which
 * counts as still-present (the conservative answer keeps the guard armed). */
async function objectGone (runner, inspectArgv) {
  const r = await runner(inspectArgv)
  if (r.code === 0) return false
  return ((r.stderr || '') + (r.stdout || '')).toLowerCase().includes('no such')
}

/**
 * Stop the container, remove its volume and its registry row — but only
 * after every container commit is reachable from the host recovery ref.
 * Idempotent: a handle with no registry row is already gone.
 * @returns {Promise<{ stopped: boolean, alreadyGone?: boolean }>}
 */
export async function stopContainer (handle, deps = {}) {
  const runner = deps.runner ?? defaultRunner
  const repo = resolveRepoGuarded(handle.repoPath)
  const row = readContainerRegistry(repo, handle.sessionId)
  if (row === null) return { stopped: false, alreadyGone: true }

  // Recover first; fall back to the last recorded head when the container
  // is already gone (exec cannot answer).
  let containerHead = row.head
  try {
    const f = await fetchContainerCommits(handle, deps)
    containerHead = f.containerHead
  } catch {
    containerHead = row.head
  }
  const reach = await runner(['git', '-C', repo, 'merge-base', '--is-ancestor', containerHead, row.recoveryRef])
  if (reach.code !== 0) {
    throw new Error(`devcontainer: refusing teardown — container commits (${containerHead.slice(0, 12)}) are not reachable from ${row.recoveryRef}; run fetchContainerCommits and inspect before discarding session work`)
  }
  // A failed rm is a REFUSAL, not a shrug: deleting the registry row while
  // the container/volume may still exist would disarm
  // unrecoveredContainerCommits and let the branch be dropped with
  // container-only commits stranded in an orphaned volume. The row stays so
  // recovery stays armed; only an rm that succeeded (or a verified absence)
  // proceeds.
  const rmContainer = await runner(['docker', 'rm', '-f', row.container])
  if (rmContainer.code !== 0 && !(await objectGone(runner, ['docker', 'container', 'inspect', row.container]))) {
    throw new Error(`devcontainer: refusing teardown bookkeeping — docker rm of ${row.container} failed (${rmContainer.stderr.trim().slice(0, 200)}) and its absence cannot be verified; the registry row stays so recovery stays armed`)
  }
  const rmVolume = await runner(['docker', 'volume', 'rm', row.volume])
  if (rmVolume.code !== 0 && !(await objectGone(runner, ['docker', 'volume', 'inspect', row.volume]))) {
    throw new Error(`devcontainer: refusing teardown bookkeeping — docker volume rm of ${row.volume} failed (${rmVolume.stderr.trim().slice(0, 200)}) and its absence cannot be verified; the registry row stays so recovery stays armed`)
  }
  if (row.secretDir) rmSync(row.secretDir, { recursive: true, force: true })
  rmSync(registryPathFor(repo, handle.sessionId), { force: true })
  return { stopped: true }
}
