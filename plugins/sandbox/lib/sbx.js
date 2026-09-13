// arxa sbx — A5 Docker Sandbox (microVM) isolation (Task 11, docs/plans/
// arxa-isolation-levels.md §§21–24/S3/S4).
//
// THE DESIGN, from the plan:
//   * A5 is the ONLY tier allowed to require a Docker account (§23b). Every
//     missing piece — CLI, daemon, sign-in — degrades with a truthful reason
//     (to A4, then A0–A3) and NEVER blocks a session (S3 #4).
//   * `sbx login` is an OAuth device-code flow with no headless path (§23a);
//     arxa never touches credentials, so the argv is ALWAYS bare
//     `['sbx','login']` — never --username, never --password-stdin. Failure
//     (including Auth0's "Global rate limit exceeded") is an expected,
//     retryable state, never a crash.
//   * sbx ships with NO network policy (§22a): arxa plans exactly
//     `sbx policy init deny-all` (reset first when a wider posture already
//     exists — init is one-time), but applying it is GLOBAL one-time state
//     and belongs to the authenticated external gate after explicit operator
//     authorization (Task 16). ensurePolicy only ever READS.
//   * The clone/start/fetch loop (§24): `sbx create --clone --name <n>
//     <agent> <path>` mounts the host source read-only and the agent works
//     in an in-container clone wired back via a git daemon. The daemon port
//     is EPHEMERAL (observed 49152→49153→49154) — resolve it from `sbx ls`
//     on EVERY start and never persist the URL; a stopped sandbox has no
//     daemon, so wake it (`sbx exec <name> true` starts a stopped one)
//     before any fetch; the advertised remote is NOT added by sbx — arxa
//     adds and maintains it host-side.
//   * SAFETY INVARIANT (binding): `sbx rm --force` runs ONLY after every
//     sandbox commit is verified reachable from the host recovery ref, and
//     refs/sandboxes/<name>/<branch> is RETAINED as recovery evidence —
//     teardown never deletes it. Removing a sandbox does not reclaim the
//     image cache (~2.4 GB retained by design, §24e); removeSandbox reports
//     the retained cache separately from reclaimed workspace bytes.
//
// Registry rows live in `<repo>/.arxa/sandboxes/<slug>.json`, mirroring the
// A4 container registry. Every runner call is argv-form through an
// injectable runner; a non-zero exit is DATA, not an exception.

import { execFile, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { whichOnPath } from './index.js'

const runFile = promisify(execFile)

/** The default runner: real subprocesses, argv form only, bounded output
 * and time. Structured `{ code, stdout, stderr }` — refusal paths report
 * honestly instead of throwing. */
async function defaultRunner (argv, opts = {}) {
  try {
    const r = await runFile(argv[0], argv.slice(1), {
      cwd: opts.cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: opts.timeout ?? 15000
    })
    return { code: 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  } catch (err) {
    return { code: err.code === undefined ? 1 : (typeof err.code === 'number' ? err.code : 1), stdout: err.stdout ?? '', stderr: err.stderr ?? String(err?.message ?? err) }
  }
}

/** A docker/sbx-safe slug for one session's names. */
const slugFor = (sessionId) => String(sessionId).replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()

/** Branch names reach refspecs — only the git-safe alphabet is accepted. */
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

/** The registry row for one session's sandbox: `<repo>/.arxa/sandboxes/`. */
const registryPathFor = (repo, sessionId) => join(repo, '.arxa', 'sandboxes', `${slugFor(sessionId)}.json`)

function writeRegistry (repo, row) {
  mkdirSync(join(repo, '.arxa', 'sandboxes'), { recursive: true })
  writeFileSync(registryPathFor(repo, row.sessionId), JSON.stringify(row, null, 2) + '\n')
}

/** Read one session's registry row, or null when it never had a sandbox. */
export function readSandboxRegistry (repo, sessionId) {
  const p = registryPathFor(resolve(String(repo)), sessionId)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}

const UNAUTH_RE = /401|unauthorized|no valid user session/i

/**
 * Measure the sbx machine state: CLI, version (through the update-banner
 * noise), daemon health (`sbx daemon status` prints "Status: stopped" with
 * exit 0 — the TEXT is the truth, not the code) and sign-in (`sbx ls`
 * 401s until the one-time browser login). Pure probing; never installs,
 * never signs in — the one measured side effect: `sbx ls` auto-starts a
 * stopped daemon.
 *
 * @param {object} [deps] - injection seam (tests): `{ which, runner }`.
 * @returns {Promise<{ installed: boolean, cli: string | undefined,
 *   version?: string, updateAvailable?: string, daemon: boolean,
 *   daemonStatus?: string, authed: boolean, reason: string,
 *   runners: { sbx: boolean, sbxAuthed: boolean, sbxReason: string } }>} the
 *   truthful machine state, ready to feed resolveEffectiveTier.
 */
export async function sbxStatus (deps = {}) {
  const which = deps.which ?? whichOnPath
  const runner = deps.runner ?? defaultRunner
  const absent = 'sbx (Docker Sandboxes) is not installed on this machine'
  const cli = which('sbx')
  if (cli === undefined) {
    return { installed: false, cli, daemon: false, authed: false, reason: absent + ' — degrading to the highest tier this machine can enforce', runners: { sbx: false, sbxAuthed: false, sbxReason: absent } }
  }

  const versionR = await runner([cli, 'version'])
  const version = /sbx version:\s*v?(\d+\.\d+\.\d+)/.exec(versionR.stdout)?.[1]
  const updateAvailable = /→\s*v?(\d+\.\d+\.\d+)/.exec(versionR.stdout)?.[1]

  const daemonR = await runner([cli, 'daemon', 'status'])
  const daemonStatus = /Status:\s*(\w+)/.exec(daemonR.stdout)?.[1]
  const daemon = daemonStatus === 'running'

  const lsR = await runner([cli, 'ls'])
  const authed = lsR.code === 0 && !UNAUTH_RE.test(lsR.stderr + lsR.stdout)

  let sbxReason
  if (!daemon) {
    sbxReason = `sbx is installed${version ? ` (v${version})` : ''} but the sandboxd daemon is ${daemonStatus ?? 'unreachable'} — start it with \`sbx daemon start\``
  } else if (!authed) {
    sbxReason = 'sbx is installed and the daemon is healthy but not signed in — the one-time browser sign-in is the only step arxa cannot automate (§23a)'
  } else {
    sbxReason = 'sbx is installed and signed in — the microVM tier is available on this machine'
  }
  return {
    installed: true,
    cli,
    version,
    updateAvailable,
    daemon,
    daemonStatus,
    authed,
    reason: sbxReason,
    runners: { sbx: daemon, sbxAuthed: authed, sbxReason }
  }
}

/**
 * Launch the one unautomatable step: the OAuth device-code sign-in (§23a).
 * arxa never handles credentials, so the argv is always bare
 * `['sbx','login']` — the flow prints its own code + activation URL for a
 * human to confirm in a browser. Every failure is DATA (retryable or not),
 * never a crash, and never blocks the session — the caller degrades to the
 * best available tier (S3 #4). The reason text is CLASSIFIED, never the raw
 * stderr echo: login output carries the device code, an OAuth code arxa
 * must not print.
 *
 * @param {object} [deps] - injection seam (tests): `{ cli, runner }`.
 * @returns {Promise<{ signedIn: boolean, retryable: boolean, degrade: 'A4',
 *   reason: string }>}
 */
export async function sbxLoginFlow (deps = {}) {
  const which = deps.which ?? whichOnPath
  const runner = deps.runner ?? defaultRunner
  const cli = deps.cli ?? which('sbx')
  if (cli === undefined) {
    return { signedIn: false, retryable: false, degrade: 'A4', reason: 'sbx is not installed — nothing to sign in to' }
  }
  const r = await runner([cli, 'login'], { timeout: 600000 })
  if (r.code === 0) return { signedIn: true, retryable: false, degrade: null, reason: 'signed in to Docker — the A5 microVM tier is now available' }
  const err = r.stderr + r.stdout
  if (/rate limit/i.test(err)) {
    return { signedIn: false, retryable: true, degrade: 'A4', reason: 'upstream sign-in rate limit (Auth0 "Global rate limit exceeded") — nothing is wrong locally; retry later' }
  }
  if (/cancel|abort|EOF|stdin is not a terminal/i.test(err)) {
    return { signedIn: false, retryable: true, degrade: 'A4', reason: 'sign-in was cancelled before the browser confirmation — retry when ready; the session runs at the best available tier meanwhile' }
  }
  return { signedIn: false, retryable: true, degrade: 'A4', reason: 'sign-in did not complete — run sbx login to see the device code and retry; the session runs at the best available tier meanwhile' }
}

/**
 * Plan the global network policy WITHOUT touching global state (§22a, Step
 * 4): read `sbx policy ls`, classify the posture, and surface the exact
 * argv the AUTHORIZED EXTERNAL GATE (Task 16) must run. Applying it here
 * would be a global, one-time mutation of operator state — out of bounds
 * for in-product code. The only argv this function ever runs is the
 * read-only `sbx policy ls`.
 *
 * @param {object} [deps] - injection seam (tests): `{ runner }`.
 * @returns {Promise<{ current: string, compliant: boolean, changes:
 *   string[][], perSandbox: { name: string, source: string, appliesTo:
 *   string, summary: string }[], applied: false, note: string }>} the plan.
 *   `changes` is empty when the posture is already deny-all (or unreadable —
 *   an unauthenticated/failed read plans nothing; the gate signs in first).
 */
export async function ensurePolicy (deps = {}) {
  const runner = deps.runner ?? defaultRunner
  const r = await runner(['sbx', 'policy', 'ls'])
  const text = (r.stdout ?? '') + (r.stderr ?? '')

  if (UNAUTH_RE.test(text)) {
    return { current: 'unauthenticated', compliant: false, changes: [], perSandbox: [], applied: false, note: 'sbx is not signed in — the external gate signs in (sbx login) before reviewing and applying any policy plan' }
  }
  if (/has not been initialized/i.test(text)) {
    return { current: 'uninitialized', compliant: false, changes: [['sbx', 'policy', 'init', 'deny-all']], perSandbox: [], applied: false, note: 'sbx ships with NO policy (§22a) — the plan is the exact argv for the authorized external gate (Task 16); arxa never mutates global policy in-product' }
  }

  // The policy table: POLICY / SOURCE / APPLIES TO / SUMMARY, 2+ spaces
  // between columns (measured §22a/§24e).
  const perSandbox = []
  let current = 'unknown'
  for (const line of text.split('\n')) {
    const m = /^(\S+)\s{2,}(\S+)\s{2,}(\S+(?:\s\S+)*?)\s{2,}(.+)$/.exec(line)
    if (!m || m[1] === 'POLICY') continue
    if (m[3] === 'all' && /deny-all/.test(m[1])) current = 'deny-all'
    else if (m[3] === 'all' && /allow-all/.test(m[1])) current = 'allow-all'
    else if (m[3] === 'all' && /balanced/.test(m[1] + m[4])) current = 'balanced'
    if (m[3] !== 'all') perSandbox.push({ name: m[1], source: m[2], appliesTo: m[3], summary: m[4].trim() })
  }

  if (current === 'deny-all') {
    return { current, compliant: true, changes: [], perSandbox, applied: false, note: 'the global posture is already deny-all — nothing to plan; per-sandbox rules are lifecycle-bound and disappear with their sandbox (§24e)' }
  }
  if (current === 'unknown') {
    return { current, compliant: false, changes: [], perSandbox, applied: false, note: 'the policy read was unreadable — plan nothing blind; the external gate re-reads and decides' }
  }
  // init is one-time ("once initialized, use sbx policy reset to start
  // over" — §22a), so a wider existing posture needs reset first.
  return { current, compliant: false, changes: [['sbx', 'policy', 'reset'], ['sbx', 'policy', 'init', 'deny-all']], perSandbox, applied: false, note: `the global posture is ${current} — the plan resets to a clean slate then initializes deny-all; exact argv for the authorized external gate (Task 16), never applied in-product` }
}

// ---- the lifecycle (Steps 5–6) -----------------------------------------------

/**
 * Resolve and guard a project repo path before any mutation: refuse the
 * reserved `.git`/`.arxa` segments (root confinement) and symlink escape.
 * @param {string} projectRepo - the repo root as the caller spells it.
 * @returns {string} the realpath'd repo root.
 */
function resolveRepoGuarded (projectRepo) {
  const repo = resolve(String(projectRepo))
  for (const seg of repo.split(/[/\\]/)) {
    if (seg === '.git' || seg === '.arxa') {
      throw new Error(`sbx: refusing to sandbox inside reserved path '${seg}' (${repo})`)
    }
  }
  if (existsSync(repo)) return realpathSync(repo)
  return repo
}

/**
 * Create one session's clone-mode sandbox (§24): `sbx create --clone --name
 * <n> <agent> <path>` mounts the host source READ-ONLY (verified by the
 * tool's own refused write, §24a) and the agent works in an in-container
 * clone wired back via a git daemon. Idempotent: an existing registry row
 * IS the live handle.
 *
 * @param {{ repoPath: string, branch: string, sessionId: string,
 *   agent?: string }} input - the owning repo, the session branch (never
 *   main), the session id, the agent kit.
 * @param {object} [deps] - injection seam (tests): `{ runner }`.
 * @returns {Promise<object>} the sandbox handle (name, remote,
 *   recoveryRef, registryPath). Never a port or URL — those are ephemeral
 *   and resolved per start (§24d).
 */
export async function createSandbox ({ repoPath, branch, sessionId, agent }, deps = {}) {
  const runner = deps.runner ?? defaultRunner
  if (typeof branch !== 'string' || !BRANCH_RE.test(branch)) throw new Error(`sbx: refusing branch ${JSON.stringify(branch)} — not a branch name this lifecycle will clone`)
  if (branch === 'main' || branch === 'master') throw new Error(`sbx: refusing to run the sandbox on '${branch}' — A5 sessions work on their own branch, never on project main`)
  if (typeof sessionId !== 'string' || sessionId.trim() === '') throw new TypeError('sbx: sessionId is required')

  const repo = resolveRepoGuarded(repoPath)
  const existing = readSandboxRegistry(repo, sessionId)
  if (existing !== null) return existing

  const name = `arxa-sbx-${slugFor(sessionId)}`
  const r = await runner(['sbx', 'create', '--clone', '--name', name, agent ?? 'claude', repo], { cwd: repo, timeout: 600000 })
  if (r.code !== 0) {
    throw new Error(`sbx: create of ${name} failed: ${(r.stderr || r.stdout).trim().slice(0, 400)}`)
  }
  const handle = {
    sessionId, branch, repoPath: repo, name,
    remote: `sandbox-${name}`,
    recoveryRef: `refs/sandboxes/${name}/${branch}`,
    registryPath: registryPathFor(repo, sessionId)
  }
  writeRegistry(repo, { ...handle, head: null, insideBranch: null, recovered: false, createdAt: Date.now() })
  return handle
}

/**
 * Resolve the sandbox's git-daemon endpoint FRESH from `sbx ls` — the port
 * is ephemeral (observed 49152→49153→49154 across restarts, §24d), so the
 * URL is never persisted anywhere. A stopped or removed sandbox has no
 * port: that state REFUSES rather than guessing.
 *
 * @param {string} name - the sandbox name.
 * @param {object} [deps] - injection seam (tests): `{ runner, json }`.
 * @returns {Promise<{ name: string, endpoint: string, port: number }>}
 */
export async function resolveGitEndpoint (name, deps = {}) {
  const runner = deps.runner ?? defaultRunner
  const wantJson = deps.json !== false
  const r = await runner(['sbx', 'ls', ...(wantJson ? ['--json'] : [])], { timeout: 15000 })
  if (r.code !== 0) {
    throw new Error(`sbx: cannot list sandboxes to resolve the git endpoint for ${name}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`)
  }
  if (wantJson) {
    try {
      const entries = JSON.parse(r.stdout).sandboxes
      const entry = Array.isArray(entries) ? entries.find((e) => e?.name === name) : undefined
      if (entry !== undefined) {
        // ponytail: the per-entry shape is read tolerantly (any git:// URL on
        // the entry) — the real v0.39 field name is verified at Task 16's gate.
        const endpoint = /git:\/\/[^\s"',]+/.exec(JSON.stringify(entry))?.[0]
        if (endpoint !== undefined) {
          return { name, endpoint, port: Number(/:(\d+)\//.exec(endpoint)?.[1] ?? 0) }
        }
      }
    } catch { /* fall through to the text shape */ }
  }
  // Text shape: the line starting with the name carries the PORTS column.
  for (const line of r.stdout.split('\n')) {
    if (!line.trimStart().startsWith(name)) continue
    const port = /\b(49\d{3}|[1-6]\d{4})\b/.exec(line)?.[1]
    const workspace = /\s(\S+)\s*$/.exec(line.trimEnd())?.[1]
    if (port !== undefined) {
      const repoName = workspace ? workspace.split('/').filter(Boolean).pop() : 'repo'
      const endpoint = `git://127.0.0.1:${port}/${repoName}`
      return { name, endpoint, port: Number(port) }
    }
  }
  throw new Error(`sbx: no reachable git endpoint for ${name} — the sandbox is stopped or gone; never a stale URL (§24d)`)
}

/**
 * Wake the sandbox and resolve its CURRENT git endpoint. `sbx exec <name>
 * true` starts a stopped sandbox first (measured, §24d #2) — the agent's
 * work is only reachable while the sandbox runs, so the wake precedes every
 * fetch.
 * @returns {Promise<{ name: string, endpoint: string, port: number,
 *   started: boolean }>}
 */
export async function startSandbox (handle, deps = {}) {
  const runner = deps.runner ?? defaultRunner
  const wake = await runner(['sbx', 'exec', handle.name, 'true'], { timeout: 120000 })
  if (wake.code !== 0) {
    throw new Error(`sbx: cannot wake ${handle.name}: ${(wake.stderr || wake.stdout).trim().slice(0, 200)}`)
  }
  const resolved = await resolveGitEndpoint(handle.name, deps)
  return { ...resolved, started: true }
}

/**
 * Bring the sandbox's commits back to the host: wake, resolve the endpoint
 * fresh, add/maintain the host remote (sbx does NOT add it — §24d #3),
 * fetch the in-sandbox branch into the RECOVERY REF
 * `refs/sandboxes/<name>/<branch>`, then verify reachability by ancestry.
 * Idempotent.
 *
 * @param {object} handle - the createSandbox handle.
 * @param {object} [deps] - injection seam (tests): `{ runner }`.
 * @returns {Promise<{ sandboxHead: string, recoveryRef: string,
 *   reachable: boolean }>} `reachable` false is a reported state, not an
 *   exception — teardown reads it as a refusal.
 */
export async function fetchSandboxCommits (handle, deps = {}) {
  const runner = deps.runner ?? defaultRunner
  const repo = resolveRepoGuarded(handle.repoPath)
  const { endpoint } = await startSandbox(handle, deps)

  const headR = await runner(['sbx', 'exec', handle.name, 'git', 'rev-parse', 'HEAD'], { timeout: 60000 })
  if (headR.code !== 0) throw new Error(`sbx: cannot read the in-sandbox HEAD of ${handle.name}: ${(headR.stderr || headR.stdout).trim().slice(0, 200)}`)
  const sandboxHead = headR.stdout.trim()

  const branchR = await runner(['sbx', 'exec', handle.name, 'git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 60000 })
  // ponytail: single-branch fetch of the in-sandbox HEAD branch; widen the
  // refspec when a session ever needs cross-branch recovery.
  const insideBranch = branchR.code === 0 && BRANCH_RE.test(branchR.stdout.trim()) ? branchR.stdout.trim() : handle.branch
  const recoveryRef = `refs/sandboxes/${handle.name}/${insideBranch}`

  // Remote maintenance: add when absent, follow the port when stale.
  const getR = await runner(['git', '-C', repo, 'remote', 'get-url', handle.remote])
  if (getR.code !== 0) {
    const add = await runner(['git', '-C', repo, 'remote', 'add', handle.remote, endpoint])
    if (add.code !== 0) throw new Error(`sbx: cannot add host remote ${handle.remote}: ${add.stderr.trim().slice(0, 200)}`)
  } else if (getR.stdout.trim() !== endpoint) {
    const set = await runner(['git', '-C', repo, 'remote', 'set-url', handle.remote, endpoint])
    if (set.code !== 0) throw new Error(`sbx: cannot update host remote ${handle.remote}: ${set.stderr.trim().slice(0, 200)}`)
  }

  const fetch = await runner(['git', '-C', repo, 'fetch', endpoint, `+refs/heads/${insideBranch}:${recoveryRef}`], { timeout: 60000 })
  if (fetch.code !== 0) throw new Error(`sbx: host git fetch into ${recoveryRef} failed: ${fetch.stderr.trim().slice(0, 200)}`)

  const reach = await runner(['git', '-C', repo, 'merge-base', '--is-ancestor', sandboxHead, recoveryRef])
  const reachable = reach.code === 0
  const row = readSandboxRegistry(repo, handle.sessionId)
  writeRegistry(repo, { ...row, ...handle, head: sandboxHead, insideBranch, recoveryRef, recovered: reachable, fetchedAt: Date.now() })
  return { sandboxHead, recoveryRef, reachable }
}

/** Is the named sandbox verifiably absent from `sbx ls`? An unreadable list
 * is UNVERIFIED, which counts as still-present (the conservative answer
 * keeps the guard armed — mirrors A4's objectGone). */
async function sandboxGone (runner, name) {
  const r = await runner(['sbx', 'ls', '--json'], { timeout: 15000 })
  if (r.code !== 0) return false
  try {
    const entries = JSON.parse(r.stdout).sandboxes
    return !(Array.isArray(entries) && entries.some((e) => e?.name === name))
  } catch {
    return !r.stdout.split('\n').some((l) => l.trimStart().startsWith(name))
  }
}

/** The retained image cache's home (darwin; undefined elsewhere). */
const defaultStorePath = () => process.platform === 'darwin'
  ? join(process.env.HOME ?? '', 'Library', 'Application Support', 'com.docker.sandboxes')
  : undefined

/** du -sk through the runner; 0 when there is nothing measurable. */
async function storeBytes (runner, storePath) {
  if (storePath === undefined || !existsSync(storePath)) return 0
  const r = await runner(['du', '-sk', storePath], { timeout: 60000 })
  const kb = Number(/^\s*(\d+)/.exec(r.stdout)?.[1] ?? 0)
  return Number.isFinite(kb) ? kb * 1024 : 0
}

/**
 * Remove one session's sandbox — SAFELY. The binding invariant: `sbx rm
 * --force` runs ONLY after every sandbox commit is verified reachable from
 * the host recovery ref, and `refs/sandboxes/<name>/<branch>` is RETAINED
 * as recovery evidence (never deleted). A failed rm whose absence cannot be
 * verified is a REFUSAL, not a shrug: the registry row stays so recovery
 * stays armed. The retained image cache is reported SEPARATELY from
 * reclaimed workspace bytes (§24e — removing a sandbox does not reclaim
 * the cache; that is desirable, and the accounting must not lie).
 *
 * @param {object} handle - the createSandbox handle.
 * @param {object} [deps] - injection seam (tests): `{ runner, storePath }`.
 * @returns {Promise<{ removed: boolean, alreadyGone?: boolean,
 *   retainedImageCache?: boolean, cacheBytes?: number,
 *   reclaimedWorkspaceBytes?: number, note?: string }>}
 */
export async function removeSandbox (handle, deps = {}) {
  const runner = deps.runner ?? defaultRunner
  const repo = resolveRepoGuarded(handle.repoPath)
  const row = readSandboxRegistry(repo, handle.sessionId)
  if (row === null) return { removed: false, alreadyGone: true }

  const storePath = deps.storePath ?? defaultStorePath()
  const cacheBefore = await storeBytes(runner, storePath)

  // Recover first; fall back to the last recorded head when the sandbox is
  // already gone (exec cannot answer).
  let sandboxHead = row.head
  try {
    const f = await fetchSandboxCommits({ ...handle, ...row }, deps)
    sandboxHead = f.sandboxHead
  } catch {
    sandboxHead = row.head
  }
  const reach = await runner(['git', '-C', repo, 'merge-base', '--is-ancestor', String(sandboxHead), row.recoveryRef])
  if (reach.code !== 0) {
    throw new Error(`sbx: refusing teardown — sandbox commits (${String(sandboxHead).slice(0, 12)}) are not reachable from ${row.recoveryRef}; run fetchSandboxCommits first — the recovery ref stays as evidence`)
  }
  const rm = await runner(['sbx', 'rm', '--force', row.name], { timeout: 300000 })
  if (rm.code !== 0 && !(await sandboxGone(runner, row.name))) {
    throw new Error(`sbx: refusing teardown bookkeeping — sbx rm of ${row.name} failed (${(rm.stderr || rm.stdout).trim().slice(0, 200)}) and its absence cannot be verified; the registry row stays so recovery stays armed`)
  }
  const cacheAfter = await storeBytes(runner, storePath)
  rmSync(registryPathFor(repo, handle.sessionId), { force: true })
  return {
    removed: true,
    retainedImageCache: true,
    cacheBytes: cacheAfter,
    reclaimedWorkspaceBytes: Math.max(0, cacheBefore - cacheAfter),
    note: 'the image cache is retained by design (~2.4 GB — the next create is fast); removing a sandbox does not reclaim it — sbx prune / image reclamation is separate (§24e)'
  }
}

/**
 * The SYNC teardown guard (consumed by git-workspace's finishSession /
 * dropSession): every sandbox commit must be reachable from the host
 * recovery ref before any branch-dropping teardown. Pure read — no sbx.
 * @returns {{ unrecovered: number, head: string | null, recoveryRef: string |
 *   null }} unrecovered > 0 refuses teardown.
 */
export function unrecoveredSandboxCommits (repoPath, sessionId) {
  const repo = resolve(String(repoPath))
  const row = readSandboxRegistry(repo, sessionId)
  if (row === null) return { unrecovered: 0, head: null, recoveryRef: null }
  const head = row.head ?? null
  const recoveryRef = row.recoveryRef ?? null
  if (head === null || recoveryRef === null) return { unrecovered: 1, head, recoveryRef }
  const r = spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', head, recoveryRef], { encoding: 'utf8', timeout: 10000 })
  return { unrecovered: r.status === 0 ? 0 : 1, head, recoveryRef }
}
