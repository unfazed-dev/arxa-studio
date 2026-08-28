// Advisory per-org process lock. Two studio processes opening the same
// org concurrently could interleave the crash-recovery rewind
// (`reset --hard` + `clean -fd`) under each other's live migration —
// exactly the data loss the commit-pair design exists to prevent. This
// serializes openOrg/migrateOrg/recovery across processes on ONE machine.
//
// Placement: inside the resolved git dir (`git rev-parse --git-dir`, so
// worktrees and `.git`-as-file both work). Git never commits, resets, or
// cleans its own dir, so the lock survives every rewind and can never
// leak into user history.
//
// Honesty boundary: `open('wx')` exclusivity and pid-liveness are truthful
// on a local disk but LIE on synced/network volumes (Dropbox, iCloud
// Drive, SMB). If orgs ever officially live there, this must become an
// OS-level lock held open for the session.
import fs from 'node:fs'
import path from 'node:path'
import { runGit } from '../../git-workspace/lib/index.js'

const LOCK_NAME = 'arxa-open.lock'

/** Typed refusal: the org is held by another live studio process. */
export class OrgLockedError extends Error {
  constructor(orgPath, lockPath, holder) {
    super(
      `organisation at ${orgPath} is open in another arxa studio process` +
        (holder?.pid ? ` (pid ${holder.pid})` : '') +
        ` — close it there first; if that process already crashed, delete ${lockPath}`
    )
    this.name = 'OrgLockedError'
    this.lockPath = lockPath
    this.holder = holder ?? null
  }
}

/**
 * Where the lock lives, or null when there is no git dir. Without a repo
 * the runner never rewinds (recovery and migration both bail), so there
 * is nothing destructive to serialize and locking would only pollute the
 * user's tree.
 */
function lockPathFor(orgPath, env) {
  let gitDir = null
  try {
    gitDir = runGit(['rev-parse', '--git-dir'], { cwd: orgPath, env, allowFail: true })
  } catch {
    return null // git itself unavailable — nothing that rewinds can run either
  }
  if (gitDir) return path.resolve(orgPath, gitDir.trim(), LOCK_NAME)
  return null
}

/** Signal-0 liveness probe; EPERM means alive-but-not-ours. */
function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}

/** @returns {{ holder: object|null, gone: boolean }} */
function readHolder(lockPath) {
  try {
    return { holder: JSON.parse(fs.readFileSync(lockPath, 'utf8')), gone: false }
  } catch (err) {
    return { holder: null, gone: err.code === 'ENOENT' }
  }
}

/** Atomic claim via exclusive create; never writes over an existing lock. */
function tryCreate(lockPath) {
  try {
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
      { flag: 'wx' }
    )
    return true
  } catch (err) {
    if (err.code === 'EEXIST') return false
    throw err
  }
}

/**
 * Acquire the org lock; returns a release function. Reentrant within a
 * process (openOrg → migrateOrg → recovery nest freely: inner frames get
 * a no-op release, the outermost frame owns the unlink).
 *
 * Staleness is pid-death ONLY. There is deliberately no time-based steal:
 * a legitimately slow migration in a live process must never have the
 * lock seized out from under it — that reintroduces the concurrent-rewind
 * data loss this lock exists to prevent. Takeover of a dead holder is
 * unlink + one fresh exclusive create; two simultaneous stale-detectors
 * race the create and exactly one wins.
 */
export function acquireOrgLock(orgPath, env = process.env) {
  const lockPath = lockPathFor(orgPath, env)
  if (!lockPath) return () => {}
  if (tryCreate(lockPath)) return makeRelease(lockPath)

  const { holder, gone } = readHolder(lockPath)
  if (gone) {
    // Holder released between our failed create and the read — one retry.
    if (tryCreate(lockPath)) return makeRelease(lockPath)
    throw new OrgLockedError(orgPath, lockPath, readHolder(lockPath).holder)
  }
  if (holder?.pid === process.pid) return () => {} // reentrant frame
  if (Number.isInteger(holder?.pid) && !pidAlive(holder.pid)) {
    try {
      fs.unlinkSync(lockPath)
    } catch {
      /* another taker raced us to the unlink */
    }
    if (tryCreate(lockPath)) return makeRelease(lockPath)
  }
  throw new OrgLockedError(orgPath, lockPath, holder)
}

function makeRelease(lockPath) {
  return () => {
    try {
      fs.unlinkSync(lockPath)
    } catch {
      /* already gone — nothing to leak */
    }
  }
}

/** Run `fn` holding the org lock; always releases, even on throw. */
export function withOrgLock(orgPath, env, fn) {
  const release = acquireOrgLock(orgPath, env)
  try {
    return fn()
  } finally {
    release()
  }
}
