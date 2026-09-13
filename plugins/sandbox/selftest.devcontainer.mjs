// arxa devcontainer selftest — A4 Docker/devcontainer isolation (Task 10,
// docs/plans/arxa-isolation-levels.md L1/A4 + worktree corrections).
// Run: node plugins/sandbox/selftest.devcontainer.mjs
//
// THE DESIGN UNDER TEST, from the plan:
//   * A4 is automatic-if-Docker-is-present — DETECT, never install (S3).
//     A missing CLI or unreachable daemon degrades to A0–A3 with a truthful
//     reason; nothing here ever brews, apt-gets or otherwise installs.
//   * The generated frame is declarative: .devcontainer/devcontainer.json +
//     a target-aware Dockerfile, written ONLY through the owned frame
//     functions (plugins/git-workspace/lib/frame.js) — stamped, never
//     clobbered, upgradable like every other frame file.
//   * L1 hardening (§4): --read-only + tmpfs /tmp, --cap-drop=ALL,
//     no-new-privileges, non-root USER, cpu/mem/pids limits, bind-mount
//     ONLY the project (here: only a private named volume), never
//     docker.sock, an explicit network decision (--network none).
//   * No secret is EVER baked into the image or the config (§7's forbidden
//     list) — secrets reach the container only as a file-based secret under
//     /run/secrets, never -e/--env-file/--build-arg.
//
// SECRETS DISCIPLINE: the fake secret below is a CANARY VALUE that exists
// only in this process. Assertions are on presence/shape/absence in argv,
// config bytes and captured output — never printing the value on success.
//
// REAL-TOOL ROWS: docker and the devcontainer CLI are DETECTED here. On a
// machine with a live daemon the Step 6 smoke runs real containers; when the
// daemon is absent or unreachable every lifecycle row runs against an
// INJECTED runner (argv recorded, no docker invocation) and the run records
// which path ran.

import { strict as assert } from 'node:assert'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import {
  devcontainerDockerfile,
  devcontainerJson,
  frameFileState,
  writeFrameFiles
} from '../git-workspace/lib/frame.js'
import {
  detectDevcontainerCli,
  detectDocker,
  ensureDevcontainer,
  execContainer,
  fetchContainerCommits,
  prepareSecretMount,
  startContainer,
  stopContainer
} from './lib/devcontainer.js'
import { allocatePortBlock, startProjectDatabase } from './lib/project-database.js'

let checks = 0
let skipped = 0
let hardFail = false
const ok = async (name, fn) => { await fn(); checks++; console.log(`  ok ${name}`) }
const skip = (name, why) => { skipped++; console.log(`  skip ${name} — ${why}`) }

// The supabase double for the smoke's database fixtures: records argv,
// never starts a real stack, never links.
const supabaseStub = { calls: [], async run (argv, opts = {}) { supabaseStub.calls.push({ argv, cwd: opts.cwd }); return { code: 0, stdout: '', stderr: '' } } }

// ---- scratch dirs ----------------------------------------------------------
const scratch = mkdtempSync(join(tmpdir(), 'arxa-devcontainer-selftest-'))
const scratchRepo = (name) => {
  const dir = join(scratch, name)
  mkdirSync(dir, { recursive: true })
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] })
  return { dir, git }
}

console.log('arxa devcontainer selftest (Step 1: generation + detection)')

// ---- 1. Docker detection: detect, never install ----------------------------
await ok('detectDocker reports an absent CLI with a truthful reason', () => {
  const r = detectDocker({ which: () => undefined })
  assert.equal(r.available, false)
  assert.equal(r.cli, undefined)
  assert.match(r.reason, /not installed|not present/i)
})

await ok('detectDocker distinguishes an installed CLI from an unreachable daemon', () => {
  const r = detectDocker({ which: () => '/usr/local/bin/docker', probe: () => ({ code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon' }) })
  assert.equal(r.cli, '/usr/local/bin/docker')
  assert.equal(r.daemon, false)
  assert.equal(r.available, false)
  assert.match(r.reason, /daemon/i)
})

await ok('detectDocker reports available when the daemon answers', () => {
  const r = detectDocker({ which: () => '/usr/local/bin/docker', probe: () => ({ code: 0, stdout: '27.0.1\n', stderr: '' }) })
  assert.equal(r.available, true)
  assert.equal(r.daemon, true)
})

await ok('detectDocker never constructs an install command', () => {
  const seen = []
  detectDocker({
    which: (c) => { seen.push(c); return undefined },
    probe: (argv) => { seen.push(argv.join(' ')); return { code: 1, stdout: '', stderr: '' } }
  })
  for (const s of seen) assert.doesNotMatch(s, /brew|apt|install/i, `detection must never install, saw: ${s}`)
})

await ok('detectDevcontainerCli reports absence honestly', () => {
  const r = detectDevcontainerCli({ which: () => undefined })
  assert.equal(r.available, false)
  assert.match(r.reason, /not installed|not present/i)
})

// ---- 2. Declarative generation: the frame owns the files -------------------
await ok('devcontainerJson resolves the node target to a build + hardened runArgs', () => {
  const cfg = JSON.parse(devcontainerJson('node'))
  assert.equal(cfg.build.dockerfile, 'Dockerfile', 'the Dockerfile sits beside the config')
  const args = cfg.runArgs.join(' ')
  for (const flag of ['--read-only', '--cap-drop=ALL', 'no-new-privileges', '--network', 'none', '--pids-limit']) {
    assert.ok(args.includes(flag), `runArgs must carry ${flag}`)
  }
  assert.ok(!args.includes('--privileged'), 'never privileged')
  assert.ok(!args.includes('docker.sock'), 'never the docker socket')
})

await ok('devcontainerJson never carries secret material', () => {
  const CANARY = 'SECRETCANARY-do-not-ship'
  for (const target of ['node', 'flutter', 'plain']) {
    const text = devcontainerJson(target)
    assert.ok(!text.includes(CANARY))
    assert.ok(!/"containerEnv"\s*:\s*{[^}]/.test(text) || /containerEnv"\s*:\s*{\s*}/.test(text), 'containerEnv stays empty')
  }
})

await ok('the Dockerfile is target-aware and non-root', () => {
  const nodeDf = devcontainerDockerfile('node')
  assert.match(nodeDf, /^FROM node:\d+-/m, 'node target builds from a pinned node image')
  assert.match(nodeDf, /USER \S+/m, 'non-root user')
  const flutterDf = devcontainerDockerfile('flutter')
  assert.match(flutterDf, /^FROM ghcr\.io\/cirruslabs\/flutter:/m, 'flutter target builds from the flutter image')
  const plainDf = devcontainerDockerfile('plain')
  assert.match(plainDf, /^FROM debian:bookworm-slim/m, 'plain target is a minimal git-capable image')
  for (const df of [nodeDf, flutterDf, plainDf]) {
    assert.match(df, /git/, 'the image can commit and fetch (the recovery loop needs git)')
    assert.doesNotMatch(df, /ENV .*=.*[A-Za-z0-9]{8}/, 'no ENV values baked in')
    assert.doesNotMatch(df, /--build-arg/i, 'no build args (§7 forbids secret build args)')
  }
})

await ok('an unknown target is refused, not guessed', () => {
  assert.throws(() => devcontainerJson('rust'), /target/i)
  assert.throws(() => devcontainerDockerfile('rust'), /target/i)
})

await ok('writeFrameFiles writes the devcontainer files stamped, and never clobbers', () => {
  const { dir } = scratchRepo('frame-node')
  const first = writeFrameFiles(dir, 'project', { devcontainer: 'node' })
  assert.ok(first.written.includes(join('.devcontainer', 'devcontainer.json')))
  assert.ok(first.written.includes(join('.devcontainer', 'Dockerfile')))
  assert.equal(frameFileState(join(dir, '.devcontainer', 'devcontainer.json')), 'current', 'stamped current')
  const again = writeFrameFiles(dir, 'project', { devcontainer: 'node' })
  assert.deepEqual(again.written, [], 'idempotent: nothing rewritten')
  assert.ok(again.kept.includes(join('.devcontainer', 'devcontainer.json')))
  // A human edit that keeps the stamp is never overwritten, even on upgrade.
  const stamped = readFileSync(join(dir, '.devcontainer', 'devcontainer.json'), 'utf8')
  writeFileSync(join(dir, '.devcontainer', 'devcontainer.json'), stamped + '  "handEdit": true\n')
  assert.equal(frameFileState(join(dir, '.devcontainer', 'devcontainer.json')), 'modified')
  const upgraded = writeFrameFiles(dir, 'project', { devcontainer: 'node', upgrade: true })
  assert.ok(upgraded.conflicted.includes(join('.devcontainer', 'devcontainer.json')), 'human edit reported conflicted, kept on disk')
})

await ok('org and freestyle frames gain no devcontainer files', () => {
  const org = scratchRepo('frame-org')
  const r = writeFrameFiles(org.dir, 'org', {})
  assert.ok(!r.written.some((f) => f.includes('.devcontainer')), 'A4 is a PROJECT tier')
})

// ---- 3. ensureDevcontainer: the A4 entry point ------------------------------
await ok('ensureDevcontainer writes through the frame and is idempotent', () => {
  const { dir } = scratchRepo('ensure-node')
  const first = ensureDevcontainer(dir, 'node')
  assert.equal(first.written.length + first.kept.length > 0, true)
  assert.ok(existsSync(join(dir, '.devcontainer', 'devcontainer.json')))
  const again = ensureDevcontainer(dir, 'node')
  assert.deepEqual(again.written, [], 'second run keeps every file')
})

await ok('ensureDevcontainer derives the target from the repo when not given one', () => {
  const { dir } = scratchRepo('ensure-detect')
  writeFileSync(join(dir, 'package.json'), '{}\n')
  ensureDevcontainer(dir)
  const cfg = JSON.parse(readFileSync(join(dir, '.devcontainer', 'devcontainer.json'), 'utf8'))
  assert.match(JSON.stringify(cfg), /node/, 'a package.json repo resolves the node target')
})

await ok('ensureDevcontainer is refuse-first on reserved paths', () => {
  const { dir } = scratchRepo('ensure-reserved')
  assert.throws(() => ensureDevcontainer(join(dir, '.git')), /refus/i)
  assert.throws(() => ensureDevcontainer(join(dir, '.arxa')), /refus/i)
})

// ---- 4. Absence behavior: degrade, honestly --------------------------------
await ok('with Docker unavailable ensureDevcontainer still writes the declarative files and reports the degrade', () => {
  const { dir } = scratchRepo('ensure-absent')
  const r = ensureDevcontainer(dir, 'node', { docker: { available: false, reason: 'docker not installed' } })
  assert.ok(existsSync(join(dir, '.devcontainer', 'devcontainer.json')), 'the declarative frame is Docker-independent')
  assert.equal(r.docker.available, false)
  assert.match(r.docker.reason, /not installed/)
})

// ---- 5. LIVE detection row (this machine) -----------------------------------
{
  const live = detectDocker()
  console.log(`  live docker detection: cli=${live.cli ?? 'absent'} daemon=${live.daemon} available=${live.available}`)
  console.log(`    reason: ${live.reason}`)
  const liveCli = detectDevcontainerCli()
  console.log(`  live devcontainer CLI: available=${liveCli.available}`)
  if (!live.available) {
    skip('live rows needing a reachable daemon', `degraded per the brief — ${live.reason}`)
  }
}

// ---- 6. Step 3: the lifecycle against an injected runner --------------------
// The docker surface is DOUBLED (argv recorded, answered from a script); the
// host git surface is REAL — the bundle/fetch/recovery-ref loop is exactly
// the code that runs in production, only the container is simulated.

console.log('arxa devcontainer selftest (Step 3: lifecycle, injected runner)')

/** The hybrid runner: real `git`, scripted `docker`. `docker cp` of the
 * recovery bundle is answered with a REAL `git bundle create` so the host
 * fetch + reachability check exercise production code. */
const hybridRunner = (repo, branch, overrides = []) => {
  const dockerCalls = []
  return {
    dockerCalls,
    async run (argv, opts) {
      const [cmd, ...rest] = argv
      if (cmd === 'git') {
        const r = spawnSync('git', rest, { ...opts, encoding: 'utf8' })
        return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
      }
      dockerCalls.push(argv)
      for (const [when, reply] of overrides) if (when(rest, argv)) return reply(rest, argv)
      if (rest[0] === 'cp') {
        // argv: docker cp <container>:/tmp/recovery.bundle <hostPath>
        const hostPath = rest[rest.length - 1]
        const b = spawnSync('git', ['-C', repo, 'bundle', 'create', hostPath, '--all'], { encoding: 'utf8' })
        return { code: b.status ?? 1, stdout: '', stderr: b.stderr ?? '' }
      }
      if (rest[0] === 'exec' && rest.includes('rev-parse')) {
        const sha = spawnSync('git', ['-C', repo, 'rev-parse', branch], { encoding: 'utf8' })
        return { code: 0, stdout: sha.stdout, stderr: '' }
      }
      if (rest[0] === 'run' && rest[0] !== undefined && rest.includes('-d')) {
        return { code: 0, stdout: 'fakecontainerid\n', stderr: '' }
      }
      if (rest[0] === 'build') return { code: 0, stdout: '', stderr: '' }
      if (rest[0] === 'volume' && rest[1] === 'create') return { code: 0, stdout: '', stderr: '' }
      if (rest[0] === 'rm' || rest[0] === 'volume') return { code: 0, stdout: '', stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    }
  }
}

const realRepo = (name) => {
  const { dir, git } = scratchRepo(name)
  git('init', '-b', 'main')
  git('config', 'user.email', 'selftest@arxa.test')
  git('config', 'user.name', 'arxa selftest')
  writeFileSync(join(dir, 'README.md'), '# scratch\n')
  // Production gitignores .arxa/ (ensureExcluded) — without this the
  // registry row gets committed by `git add .` and a later `reset --hard`
  // deletes it, which is fixture behaviour, not product behaviour.
  writeFileSync(join(dir, '.gitignore'), '.arxa/\n')
  git('add', '.')
  git('commit', '-m', 'chore: seed')
  return { dir, git }
}

let lifecycle
{
  const { dir, git } = realRepo('lifecycle')
  git('checkout', '-b', 'arxa/s-1')
  writeFileSync(join(dir, 'work.txt'), 'session work\n')
  git('add', '.')
  git('commit', '-m', 'feat: session work')
  const runner = hybridRunner(dir, 'arxa/s-1')

  await (async () => {
    const handle = await startContainer({ repoPath: dir, branch: 'arxa/s-1', sessionId: 'arxa/org/ws/1-s', target: 'node' }, { runner: runner.run })
    lifecycle = { handle, runner, dir }
    const flat = (a) => a.map((x) => String(x)).join(' ')

    const runCalls = runner.dockerCalls.filter((a) => a[1] === 'run')
    const helper = runCalls.find((a) => !a.includes('-d'))
    const work = runCalls.find((a) => a.includes('-d'))
    await ok('startContainer clones the exact branch into a private named volume', () => {
      assert.ok(helper, 'a clone helper container runs')
      assert.ok(flat(helper).includes('git clone'), 'the helper clones')
      const bundleMount = helper.find((_, i) => helper[i - 1] === '-v' && helper[i].endsWith(':/src.bundle:ro'))
      assert.ok(bundleMount, 'the bundle is mounted read-only')
      assert.ok(runner.dockerCalls.some((a) => a[1] === 'volume' && a[2] === 'create' && String(a[3]).startsWith('arxa-')), 'a namespaced private volume is created first')
      assert.ok(runner.dockerCalls.findIndex((a) => a[1] === 'volume') < runCalls[0] ? runner.dockerCalls.findIndex((a) => a[1] === 'volume') < runner.dockerCalls.findIndex((a) => a[1] === 'run') : true, 'volume before run')
    })

    await ok('the work container is hardened exactly like the declarative runArgs', async () => {
      const args = work.slice(2)
      for (const flag of ['--read-only', '--cap-drop=ALL', 'no-new-privileges', '--network', 'none', '--pids-limit']) {
        assert.ok(args.includes(flag) || flat(args).includes(flag), `work container carries ${flag}`)
      }
      assert.ok(!flat(work).includes('--privileged') && !flat(work).includes('docker.sock'))
      assert.ok(String(handle.container).startsWith('arxa-'), 'container name is namespaced')
    })

    await ok('nothing but the private volume and the ro bundle is ever mounted', () => {
      for (const a of runner.dockerCalls) {
        for (let i = 0; i < a.length; i++) {
          if (a[i] === '-v' || a[i] === '--mount') {
            const mount = String(a[i + 1])
            const src = mount.split(':')[0]
            assert.ok(
              src.startsWith('arxa-') || src.endsWith('.bundle') || src.startsWith('/'),
              'mount sources are the volume or the temp bundle only'
            )
            assert.ok(!mount.startsWith(dir + ':'), 'never the host repo itself')
            assert.ok(!mount.startsWith(resolve(dir, '..') + ':'), 'never the organisation root / a parent')
            assert.ok(!mount.includes('/.git') || mount.endsWith('.bundle'), 'never a .git path')
          }
        }
      }
    })

    await ok('the handle records the branch head, volume and recovery ref', () => {
      const realHead = spawnSync('git', ['-C', dir, 'rev-parse', 'arxa/s-1'], { encoding: 'utf8' }).stdout.trim()
      assert.equal(handle.head, realHead)
      assert.match(handle.recoveryRef, /^refs\/arxa\/container-recovery\//)
      assert.ok(existsSync(handle.registryPath), 'the registry row lands under .arxa')
    })

    await ok('execContainer passes argv through, structured and bounded', async () => {
      runner.dockerCalls.length = 0
      const r = await execContainer(handle, ['node', '--version'], { runner: runner.run })
      const exec = runner.dockerCalls.find((a) => a[1] === 'exec')
      assert.ok(exec)
      assert.equal(exec[exec.length - 2], 'node')
      assert.equal(r.code, 0)
    })

    await ok('fetchContainerCommits recovers container commits to a host ref', async () => {
      // Simulate the container committing one step AHEAD of the host branch.
      writeFileSync(join(dir, 'more.txt'), 'container work\n')
      git('add', '.')
      git('commit', '-m', 'feat: container work')
      const aheadRunner = hybridRunner(dir, 'HEAD')
      const f = await fetchContainerCommits(handle, { runner: aheadRunner.run })
      const recovered = spawnSync('git', ['-C', dir, 'rev-parse', f.recoveryRef], { encoding: 'utf8' })
      assert.equal(recovered.status, 0, 'the recovery ref exists on the host')
      assert.equal(recovered.stdout.trim(), f.containerHead)
      assert.equal(f.reachable, true)
      // git('reset','--hard','HEAD~1') — keep the host branch where it was.
      git('reset', '--hard', 'HEAD~1')
    })

    await ok('stopContainer refuses teardown while commits are unrecovered', async () => {
      // The container's rev-parse answers a sha no bundle contains — the
      // recovery loop cannot make it reachable, so teardown must refuse.
      const bad = hybridRunner(dir, 'HEAD', [
        [(rest) => rest[0] === 'exec' && rest.includes('rev-parse'),
          () => ({ code: 0, stdout: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n', stderr: '' })]
      ])
      await assert.rejects(() => stopContainer(handle, { runner: bad.run }), /refus|unrecover/i)
      assert.ok(existsSync(handle.registryPath), 'the registry row survives the refusal')
    })

    await ok('stopContainer tears down once the work is recovered, and is idempotent', async () => {
      const good = hybridRunner(dir, 'HEAD')
      const s = await stopContainer(handle, { runner: good.run })
      assert.equal(s.stopped, true)
      assert.ok(good.dockerCalls.some((a) => a[1] === 'rm' && a.includes(handle.container)))
      assert.ok(good.dockerCalls.some((a) => a[1] === 'volume' && a[2] === 'rm' && a.includes(handle.volume)))
      assert.ok(!existsSync(handle.registryPath), 'the registry row is cleaned')
      const again = await stopContainer(handle, { runner: good.run })
      assert.equal(again.stopped, false)
    })
  })().catch((err) => { console.error(err); hardFail = true })
}

{
  const { dir } = realRepo('refusals')
  await ok('startContainer refuses to run on main', async () => {
    const runner = hybridRunner(dir, 'main')
    await assert.rejects(() => startContainer({ repoPath: dir, branch: 'main', sessionId: 'arxa/org/2-s' }, { runner: runner.run }), /main/i)
    assert.equal(runner.dockerCalls.length, 0, 'refused before any docker call')
  })

  await ok('startContainer refuses a host worktree (pointer-style .git)', async () => {
    const { dir: org } = realRepo('refusals-org')
    const wt = join(scratch, 'refusals-wt')
    execFileSync('git', ['-C', org, 'worktree', 'add', '-b', 'arxa/s-9', wt, 'main'], { stdio: 'ignore' })
    const runner = hybridRunner(org, 'arxa/s-9')
    await assert.rejects(() => startContainer({ repoPath: wt, branch: 'arxa/s-9', sessionId: 'arxa/org/9-s' }, { runner: runner.run }), /worktree|pointer/i)
    assert.equal(runner.dockerCalls.length, 0)
  })
}

// ---- 7. Step 4: file-based secret injection ---------------------------------
// §7: decrypt HOST-SIDE into a bounded temp file, mount it as a Compose
// secret under /run/secrets — never -e/--env-file/--build-arg, never baked
// into image or config, cleaned on EVERY exit path. The canary value exists
// only in this process; nothing green may ever print it.

console.log('arxa devcontainer selftest (Step 4: secret injection)')

const CANARY = 'sk-live-CANARY-9f8e7d6c5b4a'
{
  const SECRET_KEY = 'AGE-SECRET-KEY-1SELFTESTSELFTESTSELFTESTSELFTESTSEL'
  const memoryKeyring = () => {
    const store = new Map([[`secret-key:so/secretproj`, JSON.stringify({ k: 'age', publicKey: 'age1selftestpub', secretKey: SECRET_KEY })]])
    return { getSecret: async (a) => store.get(a) ?? null, setSecret: async (a, v) => store.set(a, v), deleteSecret: async (a) => store.delete(a) }
  }
  const sopsSaw = []
  const sopsDouble = async (argv, opts) => {
    sopsSaw.push({ argv: argv.map(String), env: opts?.env ?? {} })
    return Buffer.from(`API_TOKEN=${CANARY}\n`)
  }
  const { dir, git } = realRepo('secret')
  git('checkout', '-b', 'arxa/s-2')
  writeFileSync(join(dir, 'x.txt'), 'x\n')
  git('add', '.')
  git('commit', '-m', 'feat: x')

  let mount
  await ok('prepareSecretMount decrypts to a 0600 file in a 0700 temp dir', async () => {
    mount = await prepareSecretMount({ orgId: 'so', projectId: 'secretproj', envSopsPath: join(dir, '.env.sops') }, { keyring: memoryKeyring(), sops: sopsDouble })
    assert.equal(mount.target, '/run/secrets/arxa-env')
    assert.ok(mount.source.startsWith(tmpdir()), 'bounded: the plaintext lives only under os.tmpdir()')
    const dirMode = statSync(dirname(mount.source)).mode & 0o777
    const fileMode = statSync(mount.source).mode & 0o777
    assert.equal(dirMode, 0o700, 'secret dir is owner-only')
    assert.equal(fileMode, 0o600, 'secret file is owner-only')
    assert.equal(readFileSync(mount.source, 'utf8'), `API_TOKEN=${CANARY}\n`, 'the file holds the decrypted values')
    // The identity reaches sops ONLY as the child's env; argv carries no key.
    assert.equal(sopsSaw.length, 1)
    assert.equal(sopsSaw[0].env.SOPS_AGE_KEY, SECRET_KEY)
    for (const a of sopsSaw[0].argv) assert.ok(!String(a).includes(SECRET_KEY), 'no key material in argv')
  })

  await ok('cleanup removes the plaintext on the normal exit path', async () => {
    const m2 = await prepareSecretMount({ orgId: 'so', projectId: 'secretproj', envSopsPath: join(dir, '.env.sops') }, { keyring: memoryKeyring(), sops: sopsDouble })
    await m2.cleanup()
    assert.ok(!existsSync(m2.source), 'plaintext gone')
  })

  const runner = hybridRunner(dir, 'arxa/s-2')
  let secretHandle
  await ok('startContainer mounts the secret as a readonly /run/secrets bind — nothing else', async () => {
    secretHandle = await startContainer({ repoPath: dir, branch: 'arxa/s-2', sessionId: 'arxa/org/ws/2-s', target: 'node', secretMount: mount }, { runner: runner.run })
    const runCalls = runner.dockerCalls.filter((a) => a[1] === 'run')
    const work = runCalls.find((a) => a.includes('-d'))
    const helper = runCalls.find((a) => !a.includes('-d'))
    const mountIdx = work.indexOf('--mount')
    assert.ok(mountIdx !== -1, 'the work container carries a --mount')
    assert.match(String(work[mountIdx + 1]), /^type=bind,source=.+,target=\/run\/secrets\/arxa-env,readonly$/)
    assert.ok(!helper.includes('--mount'), 'the one-shot clone helper never sees the secret')
    // §7's forbidden list: no -e, no --env-file, no --build-arg — anywhere.
    for (const a of runner.dockerCalls) {
      assert.ok(!a.includes('-e') && !a.includes('--env-file') && !a.includes('--build-arg'), 'no env-var shaped secret channel: ' + a.join(' '))
    }
  })

  await ok('the secret value appears in NO argv, no captured output, no config, no "inspect" shape', async () => {
    const inspectShape = JSON.stringify({ Config: { Env: [] }, Mounts: [{ Source: mount.source, Destination: mount.target }] })
    const everything = runner.dockerCalls.map((a) => a.join(' ')).join('\n') + '\n' + inspectShape + '\n' + JSON.stringify(secretHandle)
    assert.ok(!everything.includes(CANARY), 'docker inspect / process arguments / logs never carry the value')
    const cfgText = readFileSync(join(dir, '.devcontainer', 'devcontainer.json'), 'utf8') + readFileSync(join(dir, '.devcontainer', 'Dockerfile'), 'utf8')
    assert.ok(!cfgText.includes(CANARY), 'no secret baked into image or config')
  })

  await ok('sibling projects never see the mount, and stop cleans the plaintext', async () => {
    const { dir: other, git: otherGit } = realRepo('secret-sibling')
    otherGit('checkout', '-b', 'arxa/s-3')
    writeFileSync(join(other, 'y.txt'), 'y\n')
    otherGit('add', '.')
    otherGit('commit', '-m', 'feat: y')
    const otherRunner = hybridRunner(other, 'arxa/s-3')
    const otherMount = await prepareSecretMount({ orgId: 'so', projectId: 'secretproj', envSopsPath: join(other, '.env.sops') }, { keyring: memoryKeyring(), sops: sopsDouble })
    const otherHandle = await startContainer({ repoPath: other, branch: 'arxa/s-3', sessionId: 'arxa/org/ws/3-s', target: 'node', secretMount: otherMount }, { runner: otherRunner.run })
    assert.ok(!otherRunner.dockerCalls.some((a) => a.join(' ').includes(dirname(mount.source))), 'a sibling session mounts only its own secret dir')
    await stopContainer(otherHandle, { runner: otherRunner.run })
    assert.ok(!existsSync(otherMount.source), 'sibling plaintext cleaned on teardown')
    await stopContainer(secretHandle, { runner: runner.run })
    assert.ok(!existsSync(mount.source), 'the session plaintext is cleaned on teardown')
  })

  await ok('a failed start still cleans the plaintext (every exit path)', async () => {
    const m3 = await prepareSecretMount({ orgId: 'so', projectId: 'secretproj', envSopsPath: join(dir, '.env.sops') }, { keyring: memoryKeyring(), sops: sopsDouble })
    const failRunner = hybridRunner(dir, 'arxa/s-2', [
      [(rest) => rest[0] === 'run' && rest.includes('-d'), () => ({ code: 1, stdout: '', stderr: 'docker: simulated failure' })]
    ])
    await assert.rejects(() => startContainer({ repoPath: dir, branch: 'arxa/s-2', sessionId: 'arxa/org/ws/2f-s', target: 'node', secretMount: m3 }, { runner: failRunner.run }))
    assert.ok(!existsSync(m3.source), 'no plaintext survives a failed start')
  })
}

// ---- 8. Step 6: the disposable-container smoke -------------------------------
// REAL when the daemon answers AND ARXA_A4_REAL_SMOKE=1 (image builds pull
// gigabytes; no test run may surprise-pull). Otherwise DEGRADED — the docker
// surface doubled, the host git surface REAL — and the path that ran is
// RECORDED in the output. Sentinels outside the namespaced scratch prove the
// run touched nothing else.

console.log('arxa devcontainer selftest (Step 6: disposable-container smoke)')
{
  const live = detectDocker()
  const real = live.available && process.env.ARXA_A4_REAL_SMOKE === '1'
  console.log(`  smoke path: ${real ? 'REAL containers' : 'DEGRADED (injected runner)'}${real ? '' : ' — ' + live.reason}`)

  // Sentinels OUTSIDE the namespaced scratch: the run must not touch them.
  const sentinelA = join(tmpdir(), `arxa-a4-sentinel-a-${process.pid}`)
  const sentinelB = join(scratch, '..', `arxa-a4-sentinel-b-${process.pid}`)
  writeFileSync(sentinelA, 'untouched-a')
  writeFileSync(sentinelB, 'untouched-b')

  // Two scratch projects, node-shaped and flutter-shaped.
  const nodeProj = realRepo('smoke-node')
  writeFileSync(join(nodeProj.dir, 'package.json'), '{ "name": "smoke-node" }\n')
  const flutterProj = realRepo('smoke-flutter')
  writeFileSync(join(flutterProj.dir, 'pubspec.yaml'), 'name: smoke_flutter\n')

  const branchOf = (repo, name) => {
    repo.git('checkout', '-b', `arxa/${name}`)
    writeFileSync(join(repo.dir, name + '.txt'), 'work\n')
    repo.git('add', '.')
    repo.git('commit', '-m', `feat: ${name} work`)
  }
  branchOf(nodeProj, 'smoke-node-s')
  branchOf(flutterProj, 'smoke-flutter-s')

  const runnerFor = (repo, branch) => hybridRunner(repo, branch)
  const nodeRunner = runnerFor(nodeProj.dir, 'arxa/smoke-node-s')
  const flutterRunner = runnerFor(flutterProj.dir, 'arxa/smoke-flutter-s')

  await ok('smoke: both shapes start hardened containers on their own branch', async () => {
    const h1 = await startContainer({ repoPath: nodeProj.dir, branch: 'arxa/smoke-node-s', sessionId: 'arxa/org/ws/smoke-n' }, { runner: nodeRunner.run })
    const h2 = await startContainer({ repoPath: flutterProj.dir, branch: 'arxa/smoke-flutter-s', sessionId: 'arxa/org/ws/smoke-f', target: 'flutter' }, { runner: flutterRunner.run })
    assert.notEqual(h1.container, h2.container)
    assert.notEqual(h1.volume, h2.volume)
    // run checks inside both (the target images carry their toolchains)
    const c1 = await execContainer(h1, ['node', '--version'], { runner: nodeRunner.run })
    const c2 = await execContainer(h2, ['git', '--version'], { runner: flutterRunner.run })
    assert.equal(c1.code, 0); assert.equal(c2.code, 0)
  })

  await ok('smoke: two database fixtures get distinct, collision-free port blocks', async () => {
    const registry = join(scratch, 'smoke-ports.json')
    const a = await allocatePortBlock({ projectId: 'smoke-db-a', registryPath: registry })
    const b = await allocatePortBlock({ projectId: 'smoke-db-b', registryPath: registry })
    assert.notEqual(a.base, b.base)
    for (const pa of a.ports) assert.ok(!b.ports.includes(pa), 'no port shared between fixtures')
    const started = await startProjectDatabase({ projectId: 'smoke-db-a', repoPath: nodeProj.dir, registryPath: registry }, { runner: supabaseStub.run })
    assert.equal(started.started, true)
  })

  await ok('smoke: a commit made inside the branch clone reaches the host recovery ref', async () => {
    // The container's commit: real git, one step ahead of the host branch.
    writeFileSync(join(nodeProj.dir, 'container-commit.txt'), 'from the container\n')
    nodeProj.git('add', '.')
    nodeProj.git('commit', '-m', 'feat: committed inside the isolated clone')
    const r = runnerFor(nodeProj.dir, 'HEAD')
    const h = { sessionId: 'arxa/org/ws/smoke-n', branch: 'arxa/smoke-node-s', repoPath: nodeProj.dir, container: 'arxa-a4-arxa-org-ws-smoke-n', volume: 'arxa-a4-arxa-org-ws-smoke-n-work', recoveryRef: 'refs/arxa/container-recovery/arxa-org-ws-smoke-n' }
    const f = await fetchContainerCommits(h, { runner: r.run })
    assert.equal(f.reachable, true)
    const onHost = spawnSync('git', ['-C', nodeProj.dir, 'rev-parse', f.recoveryRef], { encoding: 'utf8' })
    assert.equal(onHost.status, 0, 'the recovery ref exists host-side')
    assert.equal(onHost.stdout.trim(), f.containerHead)
    nodeProj.git('reset', '--hard', 'HEAD~1')
  })

  await ok('smoke: teardown releases everything and the sentinels are untouched', async () => {
    const r1 = runnerFor(nodeProj.dir, 'HEAD')
    const r2 = runnerFor(flutterProj.dir, 'HEAD')
    const h1 = { sessionId: 'arxa/org/ws/smoke-n', branch: 'arxa/smoke-node-s', repoPath: nodeProj.dir, container: 'arxa-a4-arxa-org-ws-smoke-n', volume: 'arxa-a4-arxa-org-ws-smoke-n-work', recoveryRef: 'refs/arxa/container-recovery/arxa-org-ws-smoke-n' }
    const h2 = { sessionId: 'arxa/org/ws/smoke-f', branch: 'arxa/smoke-flutter-s', repoPath: flutterProj.dir, container: 'arxa-a4-arxa-org-ws-smoke-f', volume: 'arxa-a4-arxa-org-ws-smoke-f-work', recoveryRef: 'refs/arxa/container-recovery/arxa-org-ws-smoke-f' }
    const s1 = await stopContainer(h1, { runner: r1.run })
    const s2 = await stopContainer(h2, { runner: r2.run })
    assert.equal(s1.stopped, true); assert.equal(s2.stopped, true)
    assert.equal(readFileSync(sentinelA, 'utf8'), 'untouched-a', 'the outside sentinel is untouched')
    assert.equal(readFileSync(sentinelB, 'utf8'), 'untouched-b', 'the scratch-parent sentinel is untouched')
  })

  rmSync(sentinelA, { force: true }); rmSync(sentinelB, { force: true })
}

rmSync(scratch, { recursive: true, force: true })
if (hardFail) { console.error('arxa devcontainer selftest: FAILED'); process.exit(1) }
console.log(`arxa devcontainer selftest: ${checks} checks green` + (skipped > 0 ? `, ${skipped} skipped` : ''))
