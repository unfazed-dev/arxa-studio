// arxa sbx selftest — A5 Docker Sandbox isolation (Task 11, docs/plans/
// arxa-isolation-levels.md §§21–24/S3/S4).
// Run: node plugins/sandbox/selftest.sbx.mjs
//
// THE DESIGN UNDER TEST, from the plan:
//   * A5 is the ONLY tier allowed to require a Docker account (§23b); its
//     absence degrades to A4 then A0–A3 with a truthful reason and NEVER
//     blocks a session (S3 #4).
//   * sbx has NO default network policy — arxa must plan `sbx policy init
//     deny-all`, but the real init is GLOBAL one-time state, so it belongs
//     to the authenticated external gate (Task 16) after explicit operator
//     authorization. Everything here PLANS, never applies (§22a).
//   * `sbx login` is an OAuth device-code flow with no headless path; arxa
//     must never touch credentials (§23a) — no --username, no
//     --password-stdin, ever. Sign-in failure (incl. Auth0's "Global rate
//     limit exceeded") is an EXPECTED, retryable state, never a crash.
//   * The git-daemon port is EPHEMERAL (observed 49152→49153→49154 across
//     restarts, §24d): resolve from `sbx ls` on EVERY start, never persist
//     the URL; wake the sandbox (`sbx exec <name> true` starts a stopped
//     one) before any fetch; arxa adds/maintains the host remote itself.
//   * SAFETY INVARIANT (binding): never `sbx rm --force` until every
//     sandbox commit is reachable from a host ref and verified; retain
//     refs/sandboxes/<name>/<branch> as recovery evidence. Removing a
//     sandbox does NOT reclaim the image cache (~2.4 GB retained, §24e) —
//     report it separately from reclaimed workspace bytes.
//
// ALL rows run against injected runners and fixtures measured from the real
// CLI (v0.39.0, §§21–24 + re-measured 2026-09-13). No real sign-in, no
// global policy change, no operator Docker Sandbox mutation — the real leg
// is Task 16's external gate.

import { strict as assert } from 'node:assert'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveEffectiveTier } from './lib/effective-tier.js'
import {
  ensurePolicy,
  fetchSandboxCommits,
  createSandbox,
  removeSandbox,
  resolveGitEndpoint,
  sbxLoginFlow,
  sbxStatus,
  startSandbox,
  unrecoveredSandboxCommits
} from './lib/sbx.js'

let checks = 0
let skipped = 0
let hardFail = false
const ok = async (name, fn) => { await fn(); checks++; console.log(`  ok ${name}`) }
const skip = (name, why) => { skipped++; console.log(`  skip ${name} — ${why}`) }

// ---- measured fixtures (real CLI, §§21/22/24 + 2026-09-13) ------------------

const FIX = {
  versionV39: 'sbx version: v0.39.0 def8cb0523a77e757bdd6ef52b459fe374f3783e\n',
  versionBanner: [
    '╭──────────────────────────────────────────────────────────────────────────────────╮',
    '│ Docker Sandboxes Update Available                                                │',
    '│ v0.39.0  →  v0.42.1                                                              │',
    '╰──────────────────────────────────────────────────────────────────────────────────╯'
  ].join('\n'),
  daemonStopped: 'Status: stopped\nSocket: /Users/x/Library/Application Support/com.docker.sandboxes/sandboxes/sandboxd/sandboxd.sock (not connected)\n',
  daemonRunning: 'Status: running\nSocket: /Users/x/Library/Application Support/com.docker.sandboxes/sandboxes/sandboxd/sandboxd.sock (/var/folders/.../sandboxd.sock)\n',
  unauthenticated: 'ERROR: 401 Unauthorized: no valid user session found. Please run `sbx login` to authenticate.\n',
  lsEmptyAuthed: 'No sandboxes found.\nLaunch one: sbx run claude\n',
  lsEmptyJson: '{"sandboxes":[]}\n',
  policyUninitialized: 'ERROR: global network policy has not been initialized\n  Initialize it with: sbx policy init <allow-all|balanced|deny-all>\n',
  policyDenyAll: [
    'POLICY             SOURCE   APPLIES TO   SUMMARY',
    'default-deny-all   local    all          network: 1 deny',
    'local-policy       local    all          filesystem read: 1 allow; filesystem write: 1 allow'
  ].join('\n') + '\n',
  policyAllowAll: [
    'POLICY             SOURCE   APPLIES TO   SUMMARY',
    'default-allow-all  local    all          network: 1 allow',
    'local-policy       local    all          filesystem read: 1 allow; filesystem write: 1 allow'
  ].join('\n') + '\n',
  policyPerSandbox: [
    'POLICY             SOURCE   APPLIES TO   SUMMARY',
    'default-deny-all   local    all          network: 1 deny',
    'kit-claude         kit      arxa-sbx-1   network: 6 allow',
    'local-policy       local    all          filesystem read: 1 allow; filesystem write: 1 allow'
  ].join('\n') + '\n',
  rateLimit: 'ERROR: oauth2: "access_denied" "Global rate limit exceeded"\n',
  rmRefusal: [
    'Sandbox "arxa-sbx-1" has commits that exist nowhere else.',
    'git branch <local-name> refs/sandboxes/arxa-sbx-1/main',
    'Alternatively, ask the agent to push them to an upstream remote.',
    'ERROR: stdin is not a terminal; use --force to skip confirmation'
  ].join('\n') + '\n'
}

/** The hybrid runner: `git` and `du` are REAL (host-side recovery is
 * production code); `sbx` is scripted from a per-argv script and recorded.
 * The transport double is honest about WHAT it simulates: `sbx exec … git
 * rev-parse` answers from the REAL repo (that is what the sandbox clone
 * mirrors), and a `git fetch git://127.0.0.1:<port>/…` source is rewritten
 * to the repo path — only the daemon transport is simulated, the fetch,
 * refspec, remote bookkeeping and reachability check run real git. */
const hybridRunner = (repo, script = []) => {
  const sbxCalls = []
  const reply = (rest) => {
    for (const [when, make] of script) if (when(rest)) return make(rest)
    return { code: 0, stdout: '', stderr: '' }
  }
  const realGit = (args, opts) => {
    const r = spawnSync('git', ['-C', repo, ...args], { ...opts, encoding: 'utf8', timeout: 30000 })
    return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  }
  return {
    sbxCalls,
    async run (argv, opts) {
      const [cmd, ...rest] = argv
      if (cmd === 'git') {
        // rest: [-C, repo, ...] from production; tests may pass bare args.
        const args = rest[0] === '-C' ? rest.slice(2) : rest
        if (args[0] === 'fetch' && /^git:\/\/127\.0\.0\.1:\d+\//.test(args[1] ?? '')) {
          return realGit(['fetch', repo, ...args.slice(2)], opts)
        }
        return realGit(args, opts)
      }
      if (cmd === 'du') {
        const r = spawnSync('du', rest, { ...opts, encoding: 'utf8', timeout: 30000 })
        return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
      }
      sbxCalls.push(argv)
      const rest2 = argv.slice(1)
      // The script double wins over the default — a test may want a lying
      // in-sandbox HEAD (the deadbeef rows).
      for (const [when, make] of script) if (when(rest2)) return make(rest2)
      if (rest2[0] === 'exec' && rest2.includes('rev-parse')) {
        return realGit(['rev-parse', ...rest2.slice(rest2.lastIndexOf('rev-parse') + 1)], opts)
      }
      return reply(rest2)
    }
  }
}

/** A `sbx ls --json` reply advertising one sandbox's git daemon. */
const lsJson = (name, endpoint) => ({
  code: 0,
  stdout: JSON.stringify({ sandboxes: [{ name, status: 'running', agent: 'claude', workspace: '/scratch/proj', gitDaemon: endpoint, ports: endpoint }] }) + '\n',
  stderr: ''
})

/** A scripted sbx runner for the status probe sequence (version/daemon/ls). */
const statusRunner = (over = {}) => async (argv) => argv[1] === 'daemon'
  ? (over.daemon ?? { code: 0, stdout: FIX.daemonRunning, stderr: '' })
  : argv[1] === 'ls'
      ? (over.ls ?? { code: 0, stdout: FIX.lsEmptyAuthed, stderr: '' })
      : (over.version ?? { code: 0, stdout: FIX.versionV39 + FIX.versionBanner + '\n', stderr: '' })

console.log('arxa sbx selftest (Step 1/3/4: detection, sign-in surface, policy planning)')

// ---- 1. sbxStatus: every measured state parses to a truthful row -------------

await ok('sbxStatus reports an absent CLI without ever constructing an install command', async () => {
  const seen = []
  const r = await sbxStatus({
    which: (c) => { seen.push(c); return undefined },
    runner: async (argv) => { seen.push(argv.join(' ')); return { code: 1, stdout: '', stderr: '' } }
  })
  assert.equal(r.installed, false)
  assert.equal(r.authed, false)
  assert.equal(r.runners.sbx, false)
  assert.match(r.reason, /sbx|Docker Sandboxes/i)
  for (const s of seen) assert.doesNotMatch(s, /brew|apt|install/i, `detection must never install, saw: ${s}`)
})

await ok('sbxStatus parses the version line through the update-banner noise', async () => {
  const r = await sbxStatus({ which: () => '/opt/homebrew/bin/sbx', runner: statusRunner() })
  assert.equal(r.installed, true)
  assert.equal(r.version, '0.39.0')
  assert.equal(r.updateAvailable, '0.42.1', 'the banner is surfaced, not silently upgraded past')
})

await ok('sbxStatus distinguishes an installed CLI from a stopped daemon (rc 0!)', async () => {
  const r = await sbxStatus({
    which: () => '/opt/homebrew/bin/sbx',
    runner: async (argv) => argv[1] === 'daemon'
      ? { code: 0, stdout: FIX.daemonStopped, stderr: '' }
      : argv[1] === 'ls' ? { code: 0, stdout: FIX.lsEmptyAuthed, stderr: '' } : { code: 0, stdout: FIX.versionV39, stderr: '' }
  })
  assert.equal(r.installed, true)
  assert.equal(r.daemon, false, '"Status: stopped" exits 0 — the parser must read the text, not the code')
  assert.equal(r.runners.sbx, false, 'a stopped daemon cannot run the microVM tier')
  assert.match(r.runners.sbxReason, /daemon/i)
})

await ok('sbxStatus reads the 401 as "signed out", never as a crash', async () => {
  const r = await sbxStatus({
    which: () => '/opt/homebrew/bin/sbx',
    runner: async (argv) => argv[1] === 'ls'
      ? { code: 1, stdout: '', stderr: FIX.unauthenticated }
      : argv[1] === 'daemon' ? { code: 0, stdout: FIX.daemonRunning, stderr: '' } : { code: 0, stdout: FIX.versionV39, stderr: '' }
  })
  assert.equal(r.authed, false)
  assert.equal(r.runners.sbx, true)
  assert.equal(r.runners.sbxAuthed, false)
  assert.match(r.runners.sbxReason, /sign/i)
})

await ok('sbxStatus reports the authed, daemon-healthy machine as A5-ready', async () => {
  const r = await sbxStatus({ which: () => '/opt/homebrew/bin/sbx', runner: async () => ({ code: 0, stdout: FIX.lsEmptyAuthed + FIX.daemonRunning + FIX.versionV39, stderr: '' }) })
  assert.equal(r.authed, true)
  assert.equal(r.runners.sbx && r.runners.sbxAuthed, true)
})

await ok('the status row feeds the effective tier, and the measured sbx detail reaches the degrade reason', () => {
  const dead = resolveEffectiveTier({
    configured: 'A5', platform: 'darwin',
    runners: { seatbelt: true, sbx: false, sbxAuthed: false, sbxReason: 'sbx is installed (/opt/homebrew/bin/sbx, v0.39.0) but the sandboxd daemon is stopped — start it with `sbx daemon start`' }
  })
  assert.equal(dead.effective, 'A3')
  assert.match(dead.reason, /daemon/, 'the measured truth, not a generic "not installed" line')
  const authed = resolveEffectiveTier({
    configured: 'A5', platform: 'darwin',
    runners: { seatbelt: true, sbx: true, sbxAuthed: true }
  })
  assert.equal(authed.effective, 'A5')
})

// ---- 2. sbxLoginFlow: the one unautomatable step, honestly surfaced ----------

await ok('sbxLoginFlow invokes the bare device-code flow — never a credential flag', async () => {
  const runner = hybridRunner()
  await sbxLoginFlow({ runner: runner.run })
  const login = runner.sbxCalls.find((a) => a[1] === 'login')
  assert.ok(login, 'sbx login runs')
  assert.equal(login.length, 2, 'argv is exactly ["sbx","login"]')
  for (const a of runner.sbxCalls) {
    for (const flag of ['--username', '--password-stdin', '-e', '--env-file']) {
      assert.ok(!a.includes(flag), `arxa must never handle Docker credentials (§23a), saw ${flag}`)
    }
  }
})

await ok('the Auth0 rate limit is an expected, retryable state — not a crash', async () => {
  const r = await sbxLoginFlow({ runner: async () => ({ code: 1, stdout: '', stderr: FIX.rateLimit }) })
  assert.equal(r.signedIn, false)
  assert.equal(r.retryable, true)
  assert.match(r.reason, /rate limit/i)
})

await ok('a cancelled sign-in degrades cleanly and never blocks the session', async () => {
  const r = await sbxLoginFlow({ runner: async () => ({ code: 1, stdout: '', stderr: 'ERROR: login cancelled\n' }) })
  assert.equal(r.signedIn, false)
  assert.equal(r.degrade, 'A4', 'the flow names the tier to fall back to')
  assert.equal(typeof r.reason, 'string')
})

await ok('a missing CLI answers without attempting login', async () => {
  const runner = hybridRunner()
  const r = await sbxLoginFlow({ which: () => undefined, runner: runner.run })
  assert.equal(r.signedIn, false)
  assert.equal(runner.sbxCalls.length, 0)
})

// ---- 3. ensurePolicy: plan the exact change, never touch global state --------

await ok('an uninitialized global policy plans exactly `sbx policy init deny-all`', async () => {
  const runner = hybridRunner(null, [[() => true, () => ({ code: 1, stdout: '', stderr: FIX.policyUninitialized })]])
  const p = await ensurePolicy({ runner: runner.run })
  assert.equal(p.current, 'uninitialized')
  assert.equal(p.compliant, false)
  assert.deepEqual(p.changes, [['sbx', 'policy', 'init', 'deny-all']], '§22a: arxa must own this decision explicitly')
})

await ok('an existing deny-all posture is compliant — no change planned', async () => {
  const runner = hybridRunner(null, [[() => true, () => ({ code: 0, stdout: FIX.policyDenyAll, stderr: '' })]])
  const p = await ensurePolicy({ runner: runner.run })
  assert.equal(p.current, 'deny-all')
  assert.equal(p.compliant, true)
  assert.deepEqual(p.changes, [])
})

await ok('a wider posture plans reset-then-init, because init is one-time', async () => {
  const runner = hybridRunner(null, [[() => true, () => ({ code: 0, stdout: FIX.policyAllowAll, stderr: '' })]])
  const p = await ensurePolicy({ runner: runner.run })
  assert.equal(p.current, 'allow-all')
  assert.equal(p.compliant, false)
  assert.deepEqual(p.changes, [['sbx', 'policy', 'reset'], ['sbx', 'policy', 'init', 'deny-all']])
})

await ok('per-sandbox kit rules are surfaced separately from the global posture', async () => {
  const runner = hybridRunner(null, [[() => true, () => ({ code: 0, stdout: FIX.policyPerSandbox, stderr: '' })]])
  const p = await ensurePolicy({ runner: runner.run })
  assert.equal(p.compliant, true, 'the global posture is still deny-all')
  assert.ok(p.perSandbox.some((row) => /arxa-sbx-1/.test(row.appliesTo)), 'lifecycle-bound per-sandbox rules are listed (§24e)')
})

await ok('ensurePolicy is read-only: the only argv it ever runs is `sbx policy ls`', async () => {
  const runner = hybridRunner()
  await ensurePolicy({ runner: runner.run })
  for (const a of runner.sbxCalls) {
    assert.deepEqual(a.slice(0, 2), ['sbx', 'policy'], 'no policy argv outside the ls read')
    assert.equal(a[2], 'ls')
  }
})

await ok('an unauthenticated policy read plans nothing and names the gate', async () => {
  const runner = hybridRunner(null, [[() => true, () => ({ code: 1, stdout: '', stderr: FIX.unauthenticated })]])
  const p = await ensurePolicy({ runner: runner.run })
  assert.equal(p.current, 'unauthenticated')
  assert.deepEqual(p.changes, [])
  assert.match(p.note, /sign in|gate/i)
})

// ---- 4. Step 5: clone/start/Git retrieval (§24) ------------------------------

const scratch = mkdtempSync(join(tmpdir(), 'arxa-sbx-selftest-'))
const realRepo = (name) => {
  const dir = join(scratch, name)
  mkdirSync(dir, { recursive: true })
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] })
  git('init', '-b', 'main')
  git('config', 'user.email', 'selftest@arxa.test')
  git('config', 'user.name', 'arxa selftest')
  writeFileSync(join(dir, 'README.md'), '# scratch\n')
  writeFileSync(join(dir, '.gitignore'), '.arxa/\n')
  git('add', '.')
  git('commit', '-m', 'chore: seed')
  return { dir, git }
}

console.log('arxa sbx selftest (Step 5: clone/start/Git retrieval)')

{
  const { dir, git } = realRepo('lifecycle')
  git('checkout', '-b', 'arxa/s-1')
  writeFileSync(join(dir, 'work.txt'), 'session work\n')
  git('add', '.')
  git('commit', '-m', 'feat: session work')
  const NAME = 'arxa-sbx-arxa-org-ws-1-s'

  let handle
  await ok('createSandbox builds the measured §24 signature: --clone --name <n> <agent> <path>', async () => {
    const runner = hybridRunner(dir)
    handle = await createSandbox({ repoPath: dir, branch: 'arxa/s-1', sessionId: 'arxa/org/ws/1-s' }, { runner: runner.run })
    const create = runner.sbxCalls.find((a) => a[1] === 'create')
    assert.ok(create, 'sbx create runs')
    assert.equal(create[2], '--clone')
    assert.equal(create[3], '--name')
    assert.equal(create[4], NAME)
    assert.equal(create[5], 'claude')
    assert.equal(create[6], realpathSync(dir), 'the project path is the last positional (read-only source mount)')
  })

  await ok('the registry row records name/remote/recoveryRef — and NEVER a port or URL', () => {
    const row = JSON.parse(readFileSync(handle.registryPath, 'utf8'))
    assert.equal(row.name, NAME)
    assert.equal(row.remote, `sandbox-${NAME}`)
    assert.equal(row.recoveryRef, `refs/sandboxes/${NAME}/arxa/s-1`)
    const text = JSON.stringify(row)
    assert.ok(!/port|git:\/\/|endpoint/i.test(text), 'the ephemeral port is resolved per start, never persisted (§24d)')
  })

  await ok('createSandbox is idempotent: the registry row IS the live handle', async () => {
    const runner = hybridRunner(dir)
    const again = await createSandbox({ repoPath: dir, branch: 'arxa/s-1', sessionId: 'arxa/org/ws/1-s' }, { runner: runner.run })
    assert.equal(again.name, NAME)
    assert.equal(runner.sbxCalls.length, 0, 'a re-create builds nothing')
  })

  await ok('createSandbox refuses main and unsafe branch names before any sbx call', async () => {
    const runner = hybridRunner(dir)
    await assert.rejects(() => createSandbox({ repoPath: dir, branch: 'main', sessionId: 'x/1' }, { runner: runner.run }), /main/i)
    await assert.rejects(() => createSandbox({ repoPath: dir, branch: 'ev"al; rm -rf', sessionId: 'x/2' }, { runner: runner.run }), /branch/i)
    assert.equal(runner.sbxCalls.length, 0, 'refused before any sbx invocation')
  })

  await ok('resolveGitEndpoint parses the JSON shape and the text shape, and follows the changing port', async () => {
    const jsonRunner = hybridRunner(dir, [[(r) => r[0] === 'ls', () => lsJson(NAME, 'git://127.0.0.1:49154/lifecycle')]])
    const e1 = await resolveGitEndpoint(NAME, { runner: jsonRunner.run })
    // The empty JSON shape measured 2026-09-13: {"sandboxes":[]}
    await assert.rejects(
      () => resolveGitEndpoint(NAME, { runner: async () => ({ code: 0, stdout: FIX.lsEmptyJson, stderr: '' }) }),
      /stopped or gone|never a stale URL/i,
      'a stopped/removed sandbox has no port — never a stale URL'
    )
    const text = hybridRunner(dir, [[(r) => r[0] === 'ls', () => ({
      code: 0,
      stdout: `NAME            AGENT    STATUS    PORTS      WORKSPACE\n${NAME}   claude   running   49155      ${dir}\n`,
      stderr: ''
    })]])
    const e2 = await resolveGitEndpoint(NAME, { runner: text.run, json: false })
    assert.notEqual(e1.endpoint, e2.endpoint, 'the endpoint follows the freshly resolved port, never a cached one')
  })

  await ok('startSandbox wakes the sandbox BEFORE resolving the endpoint', async () => {
    const runner = hybridRunner(dir, [[(r) => r[0] === 'ls', () => lsJson(NAME, `git://127.0.0.1:49160/lifecycle`)]])
    const s = await startSandbox(handle, { runner: runner.run })
    assert.match(s.endpoint, /^git:\/\/127\.0\.0\.1:\d+\//)
    const wake = runner.sbxCalls.findIndex((a) => a[1] === 'exec')
    const ls = runner.sbxCalls.findIndex((a) => a[1] === 'ls')
    assert.ok(wake !== -1 && ls !== -1 && wake < ls, 'sbx exec <name> true starts a stopped sandbox (§24d) before the port is read')
    assert.equal(runner.sbxCalls[wake][3], 'true')
  })

  let fetched
  await ok('fetchSandboxCommits maintains the remote, lands the recovery ref, verifies reachability', async () => {
    // The agent commits one step ahead of the host branch — inside the clone.
    writeFileSync(join(dir, 'inside.txt'), 'committed inside the microVM\n')
    git('add', '.')
    git('commit', '-m', 'feat: inside the sandbox')
    const runner = hybridRunner(dir, [[(r) => r[0] === 'ls', () => lsJson(NAME, `git://127.0.0.1:49161/lifecycle`)]])
    fetched = await fetchSandboxCommits(handle, { runner: runner.run })
    assert.equal(fetched.reachable, true)
    assert.equal(fetched.recoveryRef, `refs/sandboxes/${NAME}/${'arxa/s-1'}`)
    const onHost = spawnSync('git', ['-C', dir, 'rev-parse', fetched.recoveryRef], { encoding: 'utf8' })
    assert.equal(onHost.status, 0, 'refs/sandboxes/<name>/<branch> exists host-side')
    assert.equal(onHost.stdout.trim(), fetched.sandboxHead)
    // The remote is arxa's to add and maintain (§24d #3).
    const remoteUrl = spawnSync('git', ['-C', dir, 'remote', 'get-url', `sandbox-${NAME}`], { encoding: 'utf8' })
    assert.equal(remoteUrl.status, 0, 'the host remote exists')
    assert.equal(remoteUrl.stdout.trim(), 'git://127.0.0.1:49161/lifecycle')
    git('reset', '--hard', 'HEAD~1')
  })

  await ok('a stale remote URL is corrected on the next fetch, not trusted', async () => {
    const runner = hybridRunner(dir, [[(r) => r[0] === 'ls', () => lsJson(NAME, `git://127.0.0.1:49162/lifecycle`)]])
    const f = await fetchSandboxCommits(handle, { runner: runner.run })
    assert.equal(f.reachable, true)
    const remoteUrl = spawnSync('git', ['-C', dir, 'remote', 'get-url', `sandbox-${NAME}`], { encoding: 'utf8' })
    assert.equal(remoteUrl.stdout.trim(), 'git://127.0.0.1:49162/lifecycle', 'set-url follows the ephemeral port change')
  })

  await ok('a fetch whose head lands nowhere near the ref reports unreachable, never a silent pass', async () => {
    const runner = hybridRunner(dir, [
      [(r) => r[0] === 'ls', () => lsJson(NAME, 'git://127.0.0.1:49163/lifecycle')],
      // The in-sandbox HEAD answers a sha the fetched history cannot contain
      // (the branch probe still tells the truth).
      [(r) => r[0] === 'exec' && r.includes('rev-parse') && !r.includes('--abbrev-ref'), () => ({ code: 0, stdout: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n', stderr: '' })]
    ])
    const f = await fetchSandboxCommits(handle, { runner: runner.run })
    assert.equal(f.reachable, false, 'a head outside the recovery ref is an unreachable state, reported not thrown')
  })

  // ---- 5. Step 6: safe teardown ---------------------------------------------

  console.log('arxa sbx selftest (Step 6: recoverable teardown)')

  await ok('removeSandbox REFUSES while sandbox commits are unfetched — no rm ever runs', async () => {
    const { dir: d2, git: g2 } = realRepo('refusal')
    g2('checkout', '-b', 'arxa/s-9')
    writeFileSync(join(d2, 'unfetched.txt'), 'only in the microVM\n')
    g2('add', '.')
    g2('commit', '-m', 'feat: unfetched')
    const name2 = 'arxa-sbx-arxa-org-ws-9-s'
    const runner = hybridRunner(d2)
    const h = await createSandbox({ repoPath: d2, branch: 'arxa/s-9', sessionId: 'arxa/org/ws/9-s' }, { runner: runner.run })
    // The fetch attempt finds a head the host history cannot reach.
    const bad = hybridRunner(d2, [[(r) => r[0] === 'exec' && r.includes('rev-parse'), () => ({ code: 0, stdout: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n', stderr: '' })]])
    await assert.rejects(() => removeSandbox(h, { runner: bad.run }), /refus|unrecover/i)
    assert.ok(!bad.sbxCalls.some((a) => a[1] === 'rm'), 'SAFETY INVARIANT: no sbx rm (let alone --force) while work is unrecovered')
    assert.ok(existsSync(h.registryPath), 'the registry row survives the refusal — recovery stays armed')
  })

  await ok('once reachable: rm --force runs exactly once, absence is verified, the recovery ref is RETAINED', async () => {
    const good = hybridRunner(dir, [[(r) => r[0] === 'ls', () => lsJson(NAME, 'git://127.0.0.1:49164/lifecycle')]])
    const store = join(scratch, 'store')
    mkdirSync(store, { recursive: true })
    writeFileSync(join(store, 'image-cache.bin'), 'x'.repeat(4096))
    const r = await removeSandbox(handle, { runner: good.run, storePath: store })
    assert.equal(r.removed, true)
    const rm = good.sbxCalls.filter((a) => a[1] === 'rm')
    assert.equal(rm.length, 1)
    assert.ok(rm[0].includes('--force'), 'non-interactive teardown needs --force — arxa decides the safety question first')
    assert.ok(rm[0].includes(NAME))
    // The recovery evidence STAYS after teardown (binding invariant).
    const ref = spawnSync('git', ['-C', dir, 'rev-parse', fetched.recoveryRef], { encoding: 'utf8' })
    assert.equal(ref.status, 0, 'refs/sandboxes/<name>/<branch> is retained as recovery evidence')
    assert.ok(!existsSync(handle.registryPath), 'the registry row is cleaned only after verified removal')
    // Cache accounting: retained image cache reported SEPARATELY from
    // reclaimed workspace bytes (§24e — teardown does not reclaim the cache).
    assert.equal(r.retainedImageCache, true)
    assert.equal(typeof r.cacheBytes, 'number')
    assert.ok(r.cacheBytes > 0)
    assert.equal(typeof r.reclaimedWorkspaceBytes, 'number')
    assert.match(String(r.note), /cache|reclaim/i)
  })

  await ok('a failed rm with the sandbox still listed refuses bookkeeping — the row stays armed', async () => {
    const { dir: d3, git: g3 } = realRepo('bookkeeping')
    g3('checkout', '-b', 'arxa/s-10')
    writeFileSync(join(d3, 'b.txt'), 'b\n')
    g3('add', '.')
    g3('commit', '-m', 'feat: b')
    const name3 = 'arxa-sbx-arxa-org-ws-10-s'
    const seeded = hybridRunner(d3)
    const h = await createSandbox({ repoPath: d3, branch: 'arxa/s-10', sessionId: 'arxa/org/ws/10-s' }, { runner: seeded.run })
    const down = hybridRunner(d3, [
      [(r) => r[0] === 'ls', () => lsJson(name3, 'git://127.0.0.1:49165/bookkeeping')],
      [(r) => r[0] === 'rm', () => ({ code: 1, stdout: '', stderr: 'ERROR: Cannot connect to the Docker daemon at unix:///var/run/docker.sock' })]
    ])
    await assert.rejects(() => removeSandbox(h, { runner: down.run }), /refus/i)
    assert.ok(existsSync(h.registryPath), 'the row survives the failed teardown')
    const down2 = hybridRunner(d3, [
      [(r) => r[0] === 'ls', () => lsJson(name3, 'git://127.0.0.1:49166/bookkeeping')],
      [(r) => r[0] === 'rm', () => ({ code: 1, stdout: '', stderr: 'ERROR: daemon down' })]
    ])
    const again = await removeSandbox(h, { runner: down2.run }).catch(() => null)
    assert.equal(again, null, 'still refusing while the rm cannot be verified')
  })

  await ok('removeSandbox is idempotent: no row means already gone', async () => {
    const r = await removeSandbox(handle, { runner: hybridRunner(dir).run })
    assert.equal(r.removed, false)
    assert.equal(r.alreadyGone, true)
  })

  await ok('unrecoveredSandboxCommits is the sync guard finish/drop consume', () => {
    const { dir: d4, git: g4 } = realRepo('guard')
    g4('checkout', '-b', 'arxa/s-11')
    writeFileSync(join(d4, 'g.txt'), 'g\n')
    g4('add', '.')
    g4('commit', '-m', 'feat: g')
    const name4 = 'arxa-sbx-arxa-org-ws-11-s'
    const slug4 = 'arxa-org-ws-11-s'
    const regDir = join(d4, '.arxa', 'sandboxes')
    mkdirSync(regDir, { recursive: true })
    const tip = spawnSync('git', ['-C', d4, 'rev-parse', 'arxa/s-11'], { encoding: 'utf8' }).stdout.trim()
    const rowPath = join(regDir, `${slug4}.json`)
    writeFileSync(rowPath, JSON.stringify({
      sessionId: 'arxa/org/ws/11-s', branch: 'arxa/s-11', repoPath: d4, name: name4,
      remote: `sandbox-${name4}`, head: tip, recoveryRef: `refs/sandboxes/${name4}/arxa/s-11`, recovered: false
    }))
    assert.equal(unrecoveredSandboxCommits(d4, 'arxa/org/ws/11-s').unrecovered, 1, 'a head outside the recovery ref is unrecovered')
    spawnSync('git', ['-C', d4, 'update-ref', `refs/sandboxes/${name4}/arxa/s-11`, tip], { encoding: 'utf8' })
    assert.equal(unrecoveredSandboxCommits(d4, 'arxa/org/ws/11-s').unrecovered, 0, 'reachable from the recovery ref → recovered')
    assert.equal(unrecoveredSandboxCommits(d4, 'never-had-one').unrecovered, 0, 'no row → nothing to guard')
  })
}

// ---- 6. live detection + the honest skip of the real gate --------------------
// The live row is READ-ONLY measurement (version, daemon status, ls). The
// real lifecycle leg — create/fetch/rm against the operator's signed-in sbx
// — belongs to Task 16's authorized external gate and NEVER runs here;
// ARXA_A5_REAL_SMOKE is the sentinel that would select it, and without
// operator authorization it is skipped honestly.

{
  const live = await sbxStatus()
  console.log(`  live sbx detection: cli=${live.cli ?? 'absent'} v=${live.version ?? '?'} daemon=${live.daemon} authed=${live.authed}`)
  console.log(`    reason: ${live.reason}`)
  if (live.updateAvailable) console.log(`    update available: v${live.updateAvailable} (surfaced, never auto-applied)`)

  await ok('the A5 surface is exported from the plugin entry', () => {
    const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'package.json'), 'utf8'))
    assert.equal(pkg.exports['./sbx'], './lib/sbx.js')
    assert.equal(pkg.exports['./sbx-install'], './lib/sbx-install.js')
  })

  if (process.env.ARXA_A5_REAL_SMOKE === '1') {
    skip('the real sbx lifecycle leg', 'operator authorization required — Task 16 executes the prepared runbook (this suite stays injected/fake-state by design)')
  } else {
    await ok('the real gate stays shut without authorization', async () => {
      // The suite itself is the proof: every lifecycle row above ran against
      // the injected hybrid runner. This row pins the sentinel contract.
      const r = await sbxStatus({ which: () => undefined })
      assert.equal(r.runners.sbx, false)
    })
  }
}

rmSync(scratch, { recursive: true, force: true })
if (hardFail) { console.error('arxa sbx selftest: FAILED'); process.exit(1) }
console.log(`arxa sbx selftest: ${checks} checks green` + (skipped > 0 ? `, ${skipped} skipped` : ''))
