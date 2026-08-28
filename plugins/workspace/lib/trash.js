// Trash (D47). Soft delete moves a folder into
// `<workspace-root>/.arxa/trash/<entry>/` next to an origin manifest with
// enough to restore it exactly; restore moves it back; hard delete only
// ever happens from the trash and only behind an explicit per-entry
// confirm token (D23 grade). The trash lives under `.arxa`, a dot-dir the
// workspace scanner (resolve.js) never descends into, and the workspace
// root is not a git repo (orgs one level down are the repos) — so trashed
// trees never enter any org repo's history. Deletes *inside* a repo are
// D18-recorded as a WIP-tier commit in that repo when git is available;
// with git absent the fs move still happens and the skip reason is
// written into the origin manifest (same degrade posture as migrate.js).
// Cross-repo restores (destination repo ≠ origin repo) refuse with a
// typed "history won't follow" error the UI can turn into a confirm
// (D41). Auto-expiry is OFF: `sweepTrash` takes an explicit max-age and
// is never called implicitly.

import fs from 'node:fs'
import path from 'node:path'
import { readManifest, ORG_MANIFEST, PROJECT_MANIFEST } from './manifest.js'
import { probeGit, wipCommit } from '../../git-workspace/lib/index.js'

export const TRASH_DIR = path.join('.arxa', 'trash')
export const ORIGIN_MANIFEST = 'origin.json'

/** Typed failure for anything the trash refuses or cannot finish. */
export class TrashError extends Error {
  constructor(message, { cause } = {}) {
    super(message)
    this.name = 'TrashError'
    if (cause) this.cause = cause
  }
}

/** Restore destination already occupied (D47). */
export class RestoreConflictError extends TrashError {
  constructor(message) {
    super(message)
    this.name = 'RestoreConflictError'
  }
}

/** Restore would cross a repo boundary — history won't follow (D41). */
export class HistoryBoundaryError extends TrashError {
  constructor(message) {
    super(message)
    this.name = 'HistoryBoundaryError'
  }
}

/** Hard delete attempted without the explicit confirm token (D23). */
export class ConfirmRequiredError extends TrashError {
  constructor(message) {
    super(message)
    this.name = 'ConfirmRequiredError'
  }
}

/** The confirm token hardDelete demands: per-entry, never a blanket flag. */
export function hardDeleteToken(entryId) {
  return `hard-delete:${entryId}`
}

export function trashRoot(workspaceRoot) {
  return path.join(workspaceRoot, TRASH_DIR)
}

/** Filesystem-safe UTC stamp — no colons/dots (exFAT/Windows-hostile). */
function fsStamp(date = new Date()) {
  return date.toISOString().replace(/[-:.]/g, '').replace(/Z$/, 'Z')
}

/**
 * True when `p` is inside `root` (strict: `p !== root`). Both must exist
 * is NOT required — this is pure path math on resolved absolutes.
 */
function isInside(root, p) {
  const rel = path.relative(path.resolve(root), path.resolve(p))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * Nearest enclosing git repo of `p`, walking up to (and including) the
 * workspace root. Pure fs (`.git` presence) so the D41 boundary check
 * works with git absent. Returns an absolute path or null.
 */
function enclosingRepo(workspaceRoot, p) {
  let dir = path.resolve(p)
  const stop = path.resolve(workspaceRoot)
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir
    if (dir === stop) return null
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Move that survives EXDEV: copy fully first, delete only after. */
function move(src, dest) {
  try {
    fs.renameSync(src, dest)
  } catch (err) {
    if (err.code !== 'EXDEV') throw err
    fs.cpSync(src, dest, { recursive: true, errorOnExist: true, force: false })
    fs.rmSync(src, { recursive: true, force: true })
  }
}

function readOrigin(entryPath) {
  return JSON.parse(fs.readFileSync(path.join(entryPath, ORIGIN_MANIFEST), 'utf8'))
}

/** Manifest ids of the trashed tree itself, when it is an org/project. */
function ownIds(p) {
  const org = path.join(p, ORG_MANIFEST)
  const project = path.join(p, PROJECT_MANIFEST)
  if (fs.existsSync(org)) return { orgId: readManifest(org).id, projectId: null }
  if (fs.existsSync(project)) return { orgId: null, projectId: readManifest(project).id }
  return { orgId: null, projectId: null }
}

/**
 * Soft-delete: move `targetPath` into the trash and write the origin
 * manifest. When the target sat inside a git repo that survives the
 * delete, the removal is D18-recorded as a WIP commit there; with git
 * absent the move still happens and `git.skippedReason` says why no
 * commit exists.
 *
 * @returns {{ entryId: string, entryPath: string, origin: object }}
 */
export function softDelete(workspaceRoot, targetPath, { env = process.env, now = new Date() } = {}) {
  const target = path.resolve(targetPath)
  if (!isInside(workspaceRoot, target)) {
    throw new TrashError(`refusing to trash ${target} — outside the workspace root ${workspaceRoot}`)
  }
  if (isInside(path.join(workspaceRoot, '.arxa'), target) || path.basename(target) === '.arxa') {
    throw new TrashError(`refusing to trash ${target} — .arxa is studio-internal, not user content`)
  }
  if (!fs.existsSync(target)) {
    throw new TrashError(`nothing to trash at ${target}`)
  }
  if (enclosingRepo(workspaceRoot, workspaceRoot) !== null) {
    // Structural invariant behind "trash never enters org history": the
    // workspace root itself must not be a repo, or .arxa/trash would sit
    // in its worktree.
    throw new TrashError(`workspace root ${workspaceRoot} is itself a git repository — trash would enter its history`)
  }

  const slug = path.basename(target)
  const base = `${fsStamp(now)}-${slug}`
  const root = trashRoot(workspaceRoot)
  fs.mkdirSync(root, { recursive: true })
  let entryId = base
  for (let n = 2; fs.existsSync(path.join(root, entryId)); n++) entryId = `${base}-${n}`
  const entryPath = path.join(root, entryId)

  // The repo the target leaves behind (strictly above it): that repo's
  // tree changes, so that is where the D18 WIP commit belongs. A repo
  // whose root IS the target travels into the trash whole, .git and all.
  const repoAbove = enclosingRepo(workspaceRoot, path.dirname(target))
  const ids = ownIds(target)

  fs.mkdirSync(entryPath, { recursive: true })
  move(target, path.join(entryPath, slug))

  const git = { committed: false, sha: null, skippedReason: null }
  if (repoAbove) {
    const probe = probeGit(env)
    if (!probe.available) {
      git.skippedReason = `git unavailable — ${probe.reason}`
    } else {
      const res = wipCommit(repoAbove, {
        message: `trash: ${path.relative(workspaceRoot, target)} → ${entryId}`,
        env,
      })
      git.committed = res.committed
      git.sha = res.sha
      if (!res.committed) git.skippedReason = 'nothing to commit — tree already clean after move'
    }
  }

  const origin = {
    version: 1,
    entryId,
    slug,
    originalPath: path.relative(workspaceRoot, target),
    repoPath: repoAbove ? path.relative(workspaceRoot, repoAbove) : null,
    orgId: ids.orgId,
    projectId: ids.projectId,
    deletedAt: now.toISOString(),
    git,
  }
  fs.writeFileSync(path.join(entryPath, ORIGIN_MANIFEST), JSON.stringify(origin, null, 2) + '\n')
  return { entryId, entryPath, origin }
}

/**
 * List trash entries, oldest first. Entries without a readable origin
 * manifest are surfaced with `origin: null` rather than hidden — the UI
 * must be able to show (and hard-delete) damaged entries.
 *
 * @returns {Array<{ entryId: string, entryPath: string, origin: object|null }>}
 */
export function listTrash(workspaceRoot) {
  const root = trashRoot(workspaceRoot)
  if (!fs.existsSync(root)) return []
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const entryPath = path.join(root, e.name)
      let origin = null
      try {
        origin = readOrigin(entryPath)
      } catch {
        /* damaged entry — listed, never auto-dropped */
      }
      return { entryId: e.name, entryPath, origin }
    })
    .sort((a, b) => a.entryId.localeCompare(b.entryId))
}

/**
 * Restore an entry to its origin (or `intoPath`). Refusals, all typed:
 * occupied destination (RestoreConflictError), destination escaping the
 * workspace root (TrashError — origin.json is untrusted input), and a
 * destination repo different from the origin repo (HistoryBoundaryError,
 * D41) unless `acceptHistoryLoss` is passed. The arrival is D18-recorded
 * in the destination repo when git is available.
 *
 * @returns {{ restoredPath: string, git: object }}
 */
export function restoreFromTrash(
  workspaceRoot,
  entryId,
  { intoPath = null, acceptHistoryLoss = false, env = process.env } = {}
) {
  const entryPath = path.join(trashRoot(workspaceRoot), entryId)
  if (!fs.existsSync(entryPath)) throw new TrashError(`no trash entry ${entryId}`)
  let origin
  try {
    origin = readOrigin(entryPath)
  } catch (err) {
    throw new TrashError(`trash entry ${entryId} has no readable origin manifest`, { cause: err })
  }
  const payload = path.join(entryPath, origin.slug)
  if (!fs.existsSync(payload)) throw new TrashError(`trash entry ${entryId} is missing its payload ${origin.slug}`)

  const dest = path.resolve(intoPath ?? path.join(workspaceRoot, origin.originalPath))
  if (!isInside(workspaceRoot, dest)) {
    throw new TrashError(`refusing to restore ${entryId} to ${dest} — outside the workspace root`)
  }
  if (fs.existsSync(dest)) {
    throw new RestoreConflictError(`cannot restore ${entryId}: ${dest} is already occupied`)
  }

  const destRepo = enclosingRepo(workspaceRoot, path.dirname(dest))
  const originRepo = origin.repoPath ? path.resolve(workspaceRoot, origin.repoPath) : null
  if (destRepo !== originRepo && !acceptHistoryLoss) {
    throw new HistoryBoundaryError(
      `restoring ${entryId} into ${destRepo ?? 'no repo'} but it came from ${originRepo ?? 'no repo'} — ` +
        `its history won't follow (D41); pass acceptHistoryLoss to proceed`
    )
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true })
  move(payload, dest)
  fs.rmSync(entryPath, { recursive: true, force: true })

  const git = { committed: false, sha: null, skippedReason: null }
  if (destRepo) {
    const probe = probeGit(env)
    if (!probe.available) {
      git.skippedReason = `git unavailable — ${probe.reason}`
    } else {
      const res = wipCommit(destRepo, {
        message: `restore: ${entryId} → ${path.relative(workspaceRoot, dest)}`,
        env,
      })
      git.committed = res.committed
      git.sha = res.sha
      if (!res.committed) git.skippedReason = 'nothing to commit — tree already clean after move'
    }
  }
  return { restoredPath: dest, git }
}

/**
 * Hard delete ONE trash entry — permanent, no undo, so it demands the
 * per-entry token from `hardDeleteToken(entryId)` (D23 grade). Only ever
 * operates inside the trash dir.
 */
export function hardDelete(workspaceRoot, entryId, { confirm } = {}) {
  const entryPath = path.join(trashRoot(workspaceRoot), entryId)
  if (!isInside(trashRoot(workspaceRoot), entryPath)) {
    throw new TrashError(`refusing hard delete of ${entryId} — resolves outside the trash`)
  }
  if (confirm !== hardDeleteToken(entryId)) {
    throw new ConfirmRequiredError(
      `hard delete of ${entryId} is permanent — pass confirm: hardDeleteToken(entryId) to proceed`
    )
  }
  if (!fs.existsSync(entryPath)) throw new TrashError(`no trash entry ${entryId}`)
  fs.rmSync(entryPath, { recursive: true, force: true })
  return { deleted: entryId }
}

/**
 * Sweep: hard-delete entries older than `maxAgeMs`. Auto-expiry is OFF
 * by default everywhere — nothing in the studio calls this implicitly;
 * a caller must hand over an explicit, finite, positive max-age.
 *
 * @returns {{ removed: string[] }}
 */
export function sweepTrash(workspaceRoot, { maxAgeMs, now = Date.now() } = {}) {
  if (typeof maxAgeMs !== 'number' || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    throw new TrashError(`sweepTrash requires an explicit positive finite maxAgeMs — got ${maxAgeMs}`)
  }
  const removed = []
  for (const entry of listTrash(workspaceRoot)) {
    const deletedAt = entry.origin ? Date.parse(entry.origin.deletedAt) : NaN
    if (Number.isNaN(deletedAt)) continue // damaged entry: never auto-dropped
    if (now - deletedAt > maxAgeMs) {
      fs.rmSync(entry.entryPath, { recursive: true, force: true })
      removed.push(entry.entryId)
    }
  }
  return { removed }
}
