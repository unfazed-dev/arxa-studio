// Migration runner (D21/D44). Explicit forward-only transforms from one
// org format version to the next, each run as its own commit PAIR in the
// org repo — a pre commit marking the rewind point and a post commit
// publishing the migrated tree + bumped stamp — so a crash mid-migration
// rewinds via git. Day one ships stamp-only: the runner exists and is
// tested, but MIGRATIONS is empty (no pre-existing workspace population
// needs moving).
//
// All git goes through the arxa-git-workspace choke point (runGit); this
// module never spawns git itself. Degrade path: with git absent, stamp
// read + refusal (stamp.js) keep working — but a migration needs its
// commit pair, so it fails cleanly with the git-unavailable reason.

import {
  ensureGit,
  runGit,
  isRepo,
  isDirty,
  STAGE_PREFIX,
} from '../../git-workspace/lib/index.js'
import fs from 'node:fs'
import path from 'node:path'
import { TEMPLATE_VERSION, getTemplate } from './template.js'
import { readManifest, orgManifestPath } from './manifest.js'
import { checkOrgStamp, readOrgStampVersion, writeOrgStampVersion } from './stamp.js'

/** Typed failure for anything the runner refuses or cannot finish. */
export class MigrationError extends Error {
  constructor(message, { cause } = {}) {
    super(message)
    this.name = 'MigrationError'
    if (cause) this.cause = cause
  }
}

/**
 * Migrations shipped in this build: `{ from, to, description, apply }`
 * where `to === from + 1` (forward-only, one step at a time) and
 * `apply(orgPath)` performs the tree transform. Day one: empty (D44 —
 * stamp-only until a real v1→v2 exists).
 */
export const MIGRATIONS = Object.freeze([])

/** Resolve the step chain from one version to another, or throw. */
export function migrationChain(fromVersion, toVersion, migrations = MIGRATIONS) {
  const chain = []
  for (let v = fromVersion; v < toVersion; v++) {
    const step = migrations.find((m) => m.from === v && m.to === v + 1)
    if (!step) {
      throw new MigrationError(
        `no migration from format v${v} to v${v + 1} — cannot bring this organisation to v${toVersion}`
      )
    }
    chain.push(step)
  }
  return chain
}

function migrationMessage(step, phase) {
  return `${STAGE_PREFIX} org format migration v${step.from}→v${step.to} (${phase})`
}

/**
 * Re-create the template's directories after a rewind. Git cannot track
 * empty directories, so `reset --hard` + `clean -fd` deletes any category
 * dir with no committed file in it — but the tree must still match the
 * template the org is stamped with. Best-effort: an unreadable stamp or
 * unknown version leaves the tree as git restored it.
 */
function restoreTemplateDirs(orgPath) {
  let dirs
  try {
    dirs = getTemplate(readOrgStampVersion(orgPath)).org.dirs
  } catch {
    return
  }
  for (const dir of dirs) {
    fs.mkdirSync(path.join(orgPath, dir), { recursive: true })
  }
}

/** Matches the subject of a migration *pre* commit — the rewind marker. */
const PRE_MARKER = /org format migration v\d+→v\d+ \(pre\)$/

/**
 * Crash recovery (D21/D44). A run that dies between a pre and post commit
 * leaves HEAD at the pre marker with the half-applied step — and possibly
 * an already-bumped stamp — sitting uncommitted. The tree was clean when
 * the pre commit was made, so everything uncommitted is the dead run's
 * debris: rewind to the pre commit and let migration re-run from a
 * known-good state. With git absent, not a repo, or no dangling marker
 * this is a no-op (the stamp read + refusal degrade path stays pure fs).
 *
 * @returns {boolean} true when a rewind actually happened
 */
export function recoverDanglingMigration(orgPath, env = process.env) {
  try {
    ensureGit(env)
  } catch {
    return false
  }
  if (!isRepo(orgPath, env)) return false
  const head = runGit(['log', '-1', '--format=%s'], { cwd: orgPath, env, allowFail: true })
  if (!head || !PRE_MARKER.test(head)) return false
  if (!isDirty(orgPath, env)) return false // crashed right after the pre commit; nothing to rewind
  // Rewind reversibly: stash the debris rather than deleting it. The
  // debris-only assumption (everything dirty belongs to the dead run) is
  // almost always right, but if anything else touched the tree between
  // crash and reopen, `git stash list` still has it. Stash leaves the
  // tree clean at HEAD; only if it failed do we fall back to the
  // destructive rewind — a wedged open path is worse than losing debris.
  runGit(
    ['stash', 'push', '--include-untracked', '-m', `arxa migration crash recovery ${new Date().toISOString()}`],
    { cwd: orgPath, env, allowFail: true }
  )
  if (isDirty(orgPath, env)) {
    runGit(['reset', '--hard', 'HEAD'], { cwd: orgPath, env })
    runGit(['clean', '-fd'], { cwd: orgPath, env })
  }
  restoreTemplateDirs(orgPath)
  return true
}

/**
 * Migrate an org forward to `toVersion`, one commit pair per step.
 *
 * Per step: pre commit (empty, marks the rewind point on a clean tree) →
 * apply + stamp bump → post commit (the only publisher of the new
 * version). If apply or the stamp bump throws, the tree is rewound to
 * the pre commit (`reset --hard` + `clean -fd` — safe because a clean
 * tree is a hard precondition) and a MigrationError is thrown.
 *
 * @returns {{ orgVersion: number, toVersion: number, migrated: Array<{ from: number, to: number, preSha: string, postSha: string }> }}
 */
export function migrateOrg(orgPath, { toVersion = TEMPLATE_VERSION, migrations = MIGRATIONS, env = process.env } = {}) {
  recoverDanglingMigration(orgPath, env) // a dead run's uncommitted stamp bump must not be trusted
  const orgVersion = readOrgStampVersion(orgPath)
  if (orgVersion === toVersion) return { orgVersion, toVersion, migrated: [] }
  if (orgVersion > toVersion) {
    throw new MigrationError(
      `organisation is at format v${orgVersion}, newer than target v${toVersion} — migrations are forward-only (D21)`
    )
  }
  const chain = migrationChain(orgVersion, toVersion, migrations)

  // Hard preconditions: the rewind story is git, so git must be present,
  // the org must be a repo, and the tree must be clean (a dirty tree
  // would make `reset --hard` destroy uncommitted user work — the exact
  // loss the commit pair exists to prevent).
  ensureGit(env) // throws GitUnavailableError — the clean degrade-path failure
  if (!isRepo(orgPath, env)) {
    throw new MigrationError(
      `organisation at ${orgPath} is not a git repository — cannot record the migration commit pair (D21/D44)`
    )
  }
  if (isDirty(orgPath, env)) {
    throw new MigrationError(
      `organisation at ${orgPath} has uncommitted or untracked changes — commit or clean them before migrating`
    )
  }

  const migrated = []
  for (const step of chain) {
    runGit(['commit', '--allow-empty', '-m', migrationMessage(step, 'pre')], { cwd: orgPath, env })
    const preSha = runGit(['rev-parse', 'HEAD'], { cwd: orgPath, env })
    try {
      step.apply(orgPath)
      writeOrgStampVersion(orgPath, step.to) // bump travels inside the pair
      runGit(['add', '-A'], { cwd: orgPath, env })
      runGit(['commit', '-m', migrationMessage(step, 'post')], { cwd: orgPath, env })
    } catch (err) {
      // Rewind to the pre commit; tree was clean, so nothing user-owned is lost.
      runGit(['reset', '--hard', preSha], { cwd: orgPath, env, allowFail: true })
      runGit(['clean', '-fd'], { cwd: orgPath, env, allowFail: true })
      restoreTemplateDirs(orgPath)
      throw new MigrationError(
        `migration v${step.from}→v${step.to} failed and was rewound to its pre commit: ${err.message}`,
        { cause: err }
      )
    }
    const postSha = runGit(['rev-parse', 'HEAD'], { cwd: orgPath, env })
    migrated.push({ from: step.from, to: step.to, preSha, postSha })
  }
  return { orgVersion, toVersion, migrated }
}

/**
 * Open an org (D21): refuse if it is newer than this build (typed
 * StampRefusalError from stamp.js), migrate forward if it is older,
 * return it as-is when current. The refusal path is pure filesystem and
 * works with git absent; only the migrate path needs git.
 *
 * @returns {{ path: string, manifest: object, orgVersion: number, migrated: Array }}
 */
export function openOrg(orgPath, { appVersion = TEMPLATE_VERSION, migrations = MIGRATIONS, env = process.env } = {}) {
  // Heal a crash-interrupted migration BEFORE reading the stamp: the dead
  // run may have bumped the stamp without publishing its post commit, and
  // that uncommitted bump must not make the org look up to date.
  recoverDanglingMigration(orgPath, env)
  const { needsMigration } = checkOrgStamp(orgPath, appVersion) // throws StampRefusalError when newer
  const migrated = needsMigration
    ? migrateOrg(orgPath, { toVersion: appVersion, migrations, env }).migrated
    : []
  return {
    path: orgPath,
    manifest: readManifest(orgManifestPath(orgPath)),
    orgVersion: readOrgStampVersion(orgPath),
    migrated,
  }
}
