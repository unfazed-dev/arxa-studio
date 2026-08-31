/**
 * github-link runner (Part B S1, Q5) — self-hosted runner management on
 * THIS machine, the arxa canon (docs/ci/self-hosted-runners.md in the
 * arxa repo): every CI job for an arxa-managed repo runs on a runner with
 * labels [self-hosted, macOS, ARM64, arxa]; personal accounts get one
 * runner INSTANCE per repo; never GitHub-hosted for private repos.
 *
 * arxa studio's convention (mirrors arxa/scripts/register-runner.sh):
 *   cache     ~/.arxa/runners/runner.tar.gz   (one download per machine)
 *   instance  ~/.arxa/runners/<owner>__<name> (config.sh --unattended)
 *   service   ./svc.sh install && start       (user LaunchAgent, no sudo)
 *
 * Everything is injectable for tests (run, fetch, home). Idempotent: an
 * existing configured runner is a no-op. The frame's ci.yml waits for
 * this runner to pick jobs up — a queued-not-running job means the
 * runner is asleep (wake it; never fix code, the canon says).
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'

function sh(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: opts.timeoutMs ?? 120000, ...opts, }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; err.stdout = stdout; reject(err); return }
      resolve(stdout)
    })
  })
}

function runnersBase(home) {
  return path.join(home, '.arxa', 'runners')
}

/** Download+extract the runner once per machine into base/runner-cache. */
async function materializeRunnerBits(base, { latestRunnerTarball, fetch }) {
  const cacheDir = path.join(base, 'runner-cache')
  const versionFile = path.join(cacheDir, 'VERSION')
  if (fs.existsSync(path.join(cacheDir, 'config.sh')) && fs.existsSync(versionFile)) return cacheDir
  const { url, version } = await latestRunnerTarball()
  fs.mkdirSync(cacheDir, { recursive: true })
  const res = await fetch(url)
  if (!res.ok) throw new Error('github-link: runner tarball download failed (' + res.status + ')')
  const buf = Buffer.from(await res.arrayBuffer())
  const tgz = path.join(base, 'runner.tar.gz')
  fs.writeFileSync(tgz, buf)
  await sh('tar', ['-xzf', tgz, '-C', cacheDir])
  fs.writeFileSync(versionFile, version + String.fromCharCode(10))
  fs.rmSync(tgz, { force: true })
  return cacheDir
}

/**
 * Ensure a runner is registered for owner/name on this machine.
 *
 * @param {{ owner: string, name: string, registrationToken: () => Promise<string>,
 *           latestRunnerTarball: () => Promise<{url: string, version: string}>,
 *           home?: string, fetch?, run?: (file: string, args: string[], opts?) => Promise<string> }} opts
 * @returns {Promise<{ ok: true, existing?: boolean, dir: string } | { ok: false, reason: string }>}
 */
export async function ensureRunner(opts) {
  const { owner, name, registrationToken, latestRunnerTarball } = opts
  const home = opts.home ?? process.env.HOME
  const run = opts.run ?? sh
  const fetchImpl = opts.fetch ?? globalThis.fetch
  if (!owner || !name) return { ok: false, reason: 'owner-and-name-required' }
  const base = runnersBase(home)
  const dir = path.join(base, owner + '__' + name)
  try {
    if (fs.existsSync(path.join(dir, '.runner'))) return { ok: true, existing: true, dir }
    const cacheDir = await materializeRunnerBits(base, { latestRunnerTarball, fetch: fetchImpl })
    fs.mkdirSync(dir, { recursive: true })
    for (const f of fs.readdirSync(cacheDir)) {
      const from = path.join(cacheDir, f)
      const to = path.join(dir, f)
      if (!fs.existsSync(to)) fs.cpSync(from, to, { recursive: true })
    }
    const token = await registrationToken()
    await run('./config.sh', [
      '--url', 'https://github.com/' + owner + '/' + name,
      '--token', token,
      '--name', 'arxa-' + owner + '-' + name,
      '--labels', 'macOS,ARM64,arxa',
      '--unattended',
    ], { cwd: dir })
    // Service install is best-effort: a runner without the LaunchAgent
    // still works while arxa studio runs; svc.sh merely survives reboots.
    try {
      await run('./svc.sh', ['install'], { cwd: dir })
      await run('./svc.sh', ['start'], { cwd: dir })
    } catch { /* best-effort — the runner is registered and listening */ }
    return { ok: true, dir }
  } catch (err) {
    return { ok: false, reason: 'runner-setup-failed: ' + String(err?.message ?? err) }
  }
}

/** True when a runner instance directory exists for owner/name. */
export function runnerExists(owner, name, home = process.env.HOME) {
  return fs.existsSync(path.join(runnersBase(home), owner + '__' + name, '.runner'))
}
