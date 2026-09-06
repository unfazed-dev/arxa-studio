// Single choke point for shelling out to system git. Every invocation is
// isolated from the user's machine-global git state (D17 makes the org a
// real repo power users may also drive by hand, but the app's own
// plumbing must be deterministic): no system/global config, no hooks, no
// inherited GIT_DIR/GIT_WORK_TREE, identity + gpg + default branch pinned
// via -c. All state stays inside the workspace tree; nothing
// machine-global is read or written.

import { execFile, execFileSync, spawnSync } from 'node:child_process'
import os from 'node:os'
import { ensureGit, gitBin } from './probe.js'

// Neutral app identities. WIP-tier commits carry a distinct committer
// email so the WIP layer is detectable by identity, not just by message
// prefix (a user commit that happens to start with "wip:" must never be
// mistaken for the auto-commit layer).
export const STAGE_IDENTITY = Object.freeze({
  name: 'arxa studio',
  email: 'studio@arxa.invalid',
})
export const WIP_IDENTITY = Object.freeze({
  name: 'arxa studio (wip)',
  email: 'wip@arxa.invalid',
})

/**
 * `objectDir` is the ONE deliberate exception to the deletes below. Pointing
 * GIT_OBJECT_DIRECTORY at a scratch directory (with the repo's real store as
 * an alternate, so reads still resolve) lets a read-only probe compute an
 * answer whose intermediate objects are thrown away instead of landing in the
 * repo. `merge-tree --write-tree` needs it: measured 2026-09-03 on git 2.51,
 * it leaves 2 loose objects per call, and the conflict probe runs once per
 * open session every 30 seconds. Ambient inheritance stays forbidden — this
 * is opt-in, per call, and set AFTER the deletes for that reason.
 */
function childEnv(identity, env, objectDir) {
  const child = { ...env }
  // Never inherit repo pointers from the host process (the app may be
  // launched from inside another repo, or even from a git hook).
  delete child.GIT_DIR
  delete child.GIT_WORK_TREE
  delete child.GIT_INDEX_FILE
  delete child.GIT_OBJECT_DIRECTORY
  delete child.GIT_ALTERNATE_OBJECT_DIRECTORIES
  delete child.GIT_NAMESPACE
  delete child.GIT_COMMON_DIR
  child.GIT_CONFIG_NOSYSTEM = '1'
  child.GIT_CONFIG_GLOBAL = os.devNull // git >= 2.32; older git ignores it, -c overrides below still pin the essentials
  child.GIT_AUTHOR_NAME = identity.name
  child.GIT_AUTHOR_EMAIL = identity.email
  child.GIT_COMMITTER_NAME = identity.name
  child.GIT_COMMITTER_EMAIL = identity.email
  if (objectDir) {
    child.GIT_OBJECT_DIRECTORY = objectDir.write
    child.GIT_ALTERNATE_OBJECT_DIRECTORIES = objectDir.read
  }
  return child
}

const PINNED = [
  '-c', 'init.defaultBranch=main',
  '-c', 'commit.gpgsign=false',
  '-c', 'tag.gpgsign=false',
  '-c', 'core.hooksPath=', // never run user hooks from app plumbing
  '-c', 'core.autocrlf=false',
]

/**
 * Run git where a NON-ZERO EXIT IS AN ANSWER, not a failure.
 *
 * `runGit` collapses every non-zero exit to `null` under `allowFail`, which
 * throws away stdout. `merge-tree` reports a conflict as exit 1 *and* prints
 * the conflicted paths, so the two halves have to arrive together — hence a
 * separate entry point rather than a flag that changes runGit's return type.
 *
 * Same pinned config, same env hygiene, same opt-in `objectDir`.
 *
 * @returns {{ status: number|null, stdout: string, stderr: string }}
 */
export function runGitProbe(args, { cwd, identity = STAGE_IDENTITY, env = process.env, timeout, objectDir } = {}) {
  ensureGit(env)
  const r = spawnSync(gitBin(env), [...PINNED, '-c', `safe.directory=${cwd}`, ...args], {
    cwd,
    env: childEnv(identity, env, objectDir),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    ...(Number.isFinite(timeout) && timeout > 0 ? { timeout, killSignal: 'SIGKILL' } : {}),
  })
  return { status: r.status, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') }
}

/**
 * Run git with pinned config. Returns trimmed stdout; throws on non-zero
 * exit (after `ensureGit` has vouched that git exists at all).
 *
 * @param {string[]} args
 * `timeout` (ms) bounds the child — network verbs (push/fetch) MUST pass one:
 * runGit is synchronous, so a git that sits on a credential prompt or a dead
 * socket freezes the whole engine event loop (2026-09-03, RESTO smoke: a
 * `push` with a rejected token waited on the launcher's TTY for 6 minutes and
 * every HTTP route timed out with it). The same callers set
 * GIT_TERMINAL_PROMPT=0 so a bad token fails as text instead of prompting.
 *
 * @param {{ cwd: string, identity?: {name:string,email:string}, env?: object, allowFail?: boolean, timeout?: number }} opts
 */
/** runGit without the freeze: the same git, args, env, identity and error
 * shape, but the process runs on the event loop's terms. For the remote
 * calls (fetch/push) on the org-open path — measured 2026-09-07: 8 fetches
 * + 2 pushes to GitHub at 0.3–0.95s each blocked the host for ~10s after
 * boot, and every request in that window waited. Resolves null on failure
 * when `allowFail`, rejects with the runGit message otherwise. */
export function runGitAsync(args, { cwd, identity = STAGE_IDENTITY, env = process.env, allowFail = false, timeout, objectDir } = {}) {
  ensureGit(env)
  const perRepo = ['-c', `safe.directory=${cwd}`]
  return new Promise((resolve, reject) => {
    execFile(gitBin(env), [...PINNED, ...perRepo, ...args], {
      cwd,
      env: childEnv(identity, env, objectDir),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      ...(Number.isFinite(timeout) && timeout > 0 ? { timeout, killSignal: 'SIGKILL' } : {}),
    }, (err, stdout, stderr) => {
      if (!err) return resolve(String(stdout).trim())
      if (allowFail) return resolve(null)
      const detail = stderr ? String(stderr).trim() : err.message
      const e = new Error(`git ${args[0]} failed in ${cwd}: ${detail}`)
      e.cause = err
      reject(e)
    })
  })
}

export function runGit(args, { cwd, identity = STAGE_IDENTITY, env = process.env, allowFail = false, timeout, objectDir } = {}) {
  ensureGit(env)
  // Global config is nulled above, which also disables any user
  // safe.directory allowlist — on mounted volumes git can then refuse
  // with "dubious ownership". Trust exactly the repo we are operating
  // on, nothing wider.
  const perRepo = ['-c', `safe.directory=${cwd}`]
  try {
    return execFileSync(gitBin(env), [...PINNED, ...perRepo, ...args], {
      cwd,
      env: childEnv(identity, env, objectDir),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      ...(Number.isFinite(timeout) && timeout > 0 ? { timeout, killSignal: 'SIGKILL' } : {}),
    }).trim()
  } catch (err) {
    if (allowFail) return null
    const detail = err.stderr ? String(err.stderr).trim() : err.message
    const e = new Error(`git ${args[0]} failed in ${cwd}: ${detail}`)
    e.cause = err
    throw e
  }
}
