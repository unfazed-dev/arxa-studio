// Single choke point for shelling out to system git. Every invocation is
// isolated from the user's machine-global git state (D17 makes the org a
// real repo power users may also drive by hand, but the app's own
// plumbing must be deterministic): no system/global config, no hooks, no
// inherited GIT_DIR/GIT_WORK_TREE, identity + gpg + default branch pinned
// via -c. All state stays inside the workspace tree; nothing
// machine-global is read or written.

import { execFileSync } from 'node:child_process'
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

function childEnv(identity, env) {
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
 * Run git with pinned config. Returns trimmed stdout; throws on non-zero
 * exit (after `ensureGit` has vouched that git exists at all).
 *
 * @param {string[]} args
 * @param {{ cwd: string, identity?: {name:string,email:string}, env?: object, allowFail?: boolean }} opts
 */
export function runGit(args, { cwd, identity = STAGE_IDENTITY, env = process.env, allowFail = false } = {}) {
  ensureGit(env)
  // Global config is nulled above, which also disables any user
  // safe.directory allowlist — on mounted volumes git can then refuse
  // with "dubious ownership". Trust exactly the repo we are operating
  // on, nothing wider.
  const perRepo = ['-c', `safe.directory=${cwd}`]
  try {
    return execFileSync(gitBin(env), [...PINNED, ...perRepo, ...args], {
      cwd,
      env: childEnv(identity, env),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    }).trim()
  } catch (err) {
    if (allowFail) return null
    const detail = err.stderr ? String(err.stderr).trim() : err.message
    const e = new Error(`git ${args[0]} failed in ${cwd}: ${detail}`)
    e.cause = err
    throw e
  }
}
