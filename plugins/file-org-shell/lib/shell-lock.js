/**
 * Shell-level per-org open lock (Phase A of file-org-shell-integration).
 *
 * Why a second lock exists at all: plugins/workspace keeps its rewind lock
 * inside the org's `.git` dir, so before the repo exists that lock is a
 * deliberate no-op — correct for the library (nothing rewinds without git)
 * but useless as the shell's "one process per open org" guarantee, because
 * the no-op window is exactly the first-open window where stamp/migrate and
 * repo init run. This lock closes that window: it lives at the WORKSPACE
 * root (`<root>/.arxa/locks/<slug>.lock`), which always exists before an
 * org can be opened and is never inside any git repo — the same root-level
 * `.arxa/` home the index (workspace-index) and the rail (cairn-rail)
 * already use for derived/runtime state. The library's internal lock keeps
 * serializing rewind underneath; the redundancy is harmless (different
 * files, both pid-truthful).
 *
 * Semantics mirror plugins/workspace/lib/lock.js on purpose: `wx` O_EXCL
 * creation, JSON holder { pid, orgPath, startedAt }, staleness is
 * pid-death ONLY (no time-based steal), reentrant same-pid frames are
 * no-ops, release is idempotent.
 */

import fs from 'node:fs'
import path from 'node:path'

/** Path segments under the workspace root that hold shell locks. */
export const SHELL_LOCK_DIR = ['.arxa', 'locks']

import { ShellLockError } from './errors.js'

/** Where the shell lock for one org lives. */
export function shellLockPath(workspaceRoot, orgSlug) {
  return path.join(workspaceRoot, ...SHELL_LOCK_DIR, `${orgSlug}.lock`)
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM' // alive, owned by someone else
  }
}

function readHolder(lockPath) {
  try {
    return { holder: JSON.parse(fs.readFileSync(lockPath, 'utf8')), gone: false }
  } catch (err) {
    return { holder: null, gone: err.code === 'ENOENT' }
  }
}

function tryCreate(lockPath, orgPath) {
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true })
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, orgPath, startedAt: new Date().toISOString() }),
      { flag: 'wx' }
    )
    return true
  } catch (err) {
    if (err.code === 'EEXIST') return false
    throw err
  }
}

function makeRelease(lockPath) {
  return function release() {
    try {
      fs.unlinkSync(lockPath)
    } catch {
      // idempotent: already released / stolen after our death — nothing to do
    }
  }
}

/**
 * Acquire the shell open-lock for `orgPath` (slug = basename). Returns a
 * release() function. Throws ShellLockError when a LIVE process holds it;
 * a dead holder's lock is taken over silently (crash recovery).
 */
export function acquireShellLock(workspaceRoot, orgPath) {
  const slug = path.basename(orgPath)
  const lockPath = shellLockPath(workspaceRoot, slug)
  if (tryCreate(lockPath, orgPath)) return makeRelease(lockPath)

  const { holder, gone } = readHolder(lockPath)
  if (gone) {
    // vanished between create-attempt and read — retry once
    if (tryCreate(lockPath, orgPath)) return makeRelease(lockPath)
    throw new ShellLockError(orgPath, lockPath, readHolder(lockPath).holder)
  }
  if (holder?.pid === process.pid) return () => {} // reentrant frame: outer owns release
  if (Number.isInteger(holder?.pid) && !pidAlive(holder.pid)) {
    try {
      fs.unlinkSync(lockPath) // dead holder — take over
    } catch {
      // lost the takeover race; fall through to the create attempt
    }
    if (tryCreate(lockPath, orgPath)) return makeRelease(lockPath)
  }
  throw new ShellLockError(orgPath, lockPath, readHolder(lockPath).holder)
}
