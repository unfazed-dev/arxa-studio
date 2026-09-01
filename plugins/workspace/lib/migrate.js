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
import { withOrgLock } from './lock.js'

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
/** D78: every directory with nothing in it gets a .gitkeep — git (and
 * GitHub) cannot track empty dirs, so without this the scaffolded tree
 * silently never reaches the remote. .git itself is skipped, as is the
 * account dock (D37: excluded from version control entirely). */
function gitkeepEmptyDirs(root) {
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    const visible = entries.filter((e) => e.name !== '.git' && e.name !== '.gitkeep')
    if (visible.length === 0) {
      const rel = path.relative(root, dir)
      if (rel === 'account' || rel.startsWith('account/')) return
      try {
        fs.writeFileSync(path.join(dir, '.gitkeep'), '')
      } catch { /* best effort */ }
      return
    }
    for (const e of visible) {
      if (e.isDirectory()) walk(path.join(dir, e.name))
    }
  }
  walk(root)
}

/** Commit the tree change inside a project's OWN repo (projects are nested
 * git repos — the org repo's migration commits cannot carry their trees).
 * Best-effort: a repo that cannot commit still gets the tree change, and
 * the publish/push path annotates anything loud.
 *
 * B17: `subject` MUST be a conventional subject. The old hardcoded
 * `migrate: …` is not a type the frame gate accepts (`docs feat fix refactor
 * test chore perf build ci style merge`), so arxa's own migration commit
 * failed arxa's own commit gate — every migrated project went red on its
 * next CI run, through nothing the user did. It also named v3 while
 * migrating to any version, so the message lied after the second step. */
function commitProjectRepoMigration(projectPath, subject) {
  if (!fs.existsSync(path.join(projectPath, '.git'))) return
  try {
    const status = runGit(['status', '--porcelain'], { cwd: projectPath })
    if (String(status ?? '').trim() === '') return
    runGit(['add', '-A'], { cwd: projectPath })
    runGit(['commit', '-m', subject], { cwd: projectPath })
  } catch { /* best effort — the tree change stands regardless */ }
}

export const MIGRATIONS = Object.freeze([
  Object.freeze({
    from: 1,
    to: 2,
    description: 'additive v2 containers: fixed dock containers (meetings/account/communications); project containers scaffold per project',
    apply(orgPath) {
      // Additive ONLY (grilled 2026-08-30): create missing template dirs,
      // never touch existing content. Empty dirs are untracked by git — the
      // post commit carries the stamp bump; restoreTemplateDirs heals rewinds.
      const template = getTemplate(2)
      for (const dir of template.org.dirs) {
        fs.mkdirSync(path.join(orgPath, dir), { recursive: true })
      }
      // Existing projects gain their v2 containers the same additive way.
      const projectsDir = path.join(orgPath, 'projects')
      if (fs.existsSync(projectsDir)) {
        for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue
          for (const dir of template.project.dirs) {
            fs.mkdirSync(path.join(projectsDir, entry.name, dir), { recursive: true })
          }
        }
      }
    },
  }),
  Object.freeze({
    from: 2,
    to: 3,
    description: 'stage-ordered project containers (00-moodboard…08-deploy, notes free-form last) + .gitkeep in every empty dir so the whole tree reaches GitHub',
    apply(orgPath) {
      const template = getTemplate(3)
      // Org level stays additive (same rule as 1→2): create missing dirs,
      // never touch existing content.
      for (const dir of template.org.dirs) {
        fs.mkdirSync(path.join(orgPath, dir), { recursive: true })
      }
      // Per project: RENAME the stage dirs to the numbered names FIRST (old
      // content rides along), then mkdir any template dir still missing.
      // Renames — not add-only — because the whole point of v3 is the order
      // (grilled 2026-08-30); nothing in the app keys container names.
      const projectsDir = path.join(orgPath, 'projects')
      const renames = [
        ['moodboard', '00-moodboard'],
        ['intake', '01-intake'],
        ['design', '02-design'],
        ['architecture', '03-architecture'],
        ['diagrams', '04-diagrams'],
        ['scaffold', '05-scaffold'],
        ['build', '06-build'],
        ['config', '07-config'],
        ['deploy', '08-deploy'],
      ]
      if (fs.existsSync(projectsDir)) {
        for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue
          const project = path.join(projectsDir, entry.name)
          for (const [from, to] of renames) {
            const a = path.join(project, from)
            const b = path.join(project, to)
            if (fs.existsSync(a) && !fs.existsSync(b)) fs.renameSync(a, b)
          }
          for (const dir of template.project.dirs) {
            fs.mkdirSync(path.join(project, dir), { recursive: true })
          }
          // .gitkeep BEFORE the project commit — the emptiness markers are
          // exactly what the commit is supposed to carry.
          gitkeepEmptyDirs(project)
          commitProjectRepoMigration(project,
            'chore(migrate): stage folders to template v3 (stage order, 2-digit prefixes) + .gitkeep')
        }
      }
      // The org repo's migration post-commit picks the org tree up; project
      // repos were committed above; .gitkeep lands everywhere still empty.
      gitkeepEmptyDirs(orgPath)
    },
  }),
  Object.freeze({
    from: 3,
    to: 4,
    description: 'track/target vocabulary: <NN-stage>/<track>/<target>/ — the track level already exists from v3, so this moves the stamp and adds no folders',
    /**
     * Deliberately creates nothing, and that is not an oversight.
     *
     * v3 already builds `<stage>/website` and `<stage>/application` for every
     * stage (`projectDirsV3`). v4 renames that level to TRACK and defines a
     * TARGET level beneath it — but targets are chosen per project at
     * creation, never scaffolded wholesale, because arxa's contract is that
     * targets are "chosen once at project creation". Materialising
     * ios/android/macos/landing/docs here would put fifty empty folders into
     * every existing project and contradict the very model v4 exists to
     * adopt.
     *
     * So the v3 tree is ALREADY v4-shaped. This entry exists to move the
     * stamp, which is what lets `checkOrgStamp` stop refusing v4 builds.
     * Existing content sitting directly under a track (the v3 habit) keeps
     * working: the gate walks to any stack marker at any depth, so a project
     * that never adopts targets still gates exactly as it did.
     */
    apply(orgPath) {
      const template = getTemplate(4)
      // Org level: additive, same rule as every step before it.
      for (const dir of template.org.dirs) {
        fs.mkdirSync(path.join(orgPath, dir), { recursive: true })
      }
      const projectsDir = path.join(orgPath, 'projects')
      if (fs.existsSync(projectsDir)) {
        for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue
          const project = path.join(projectsDir, entry.name)
          // Track dirs only — no target dirs. Idempotent: v3 already made these.
          for (const dir of template.project.dirs) {
            fs.mkdirSync(path.join(project, dir), { recursive: true })
          }
          gitkeepEmptyDirs(project)
          commitProjectRepoMigration(project, 'chore(migrate): track/target vocabulary (template v4)')
        }
      }
      gitkeepEmptyDirs(orgPath)
    },
  }),
])

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

/**
 * B18: this used to build `stage: org format migration …` from STAGE_PREFIX,
 * and `stage` is not a type the frame gate accepts. So the org repo's own
 * migration commit pair failed the org gate's conventional-subject check —
 * arxa reddening its own repo, on a commit the user never wrote and cannot
 * amend. The commit PAIR is still the rewind mechanism; only the subject
 * changes, to one the gate recognises.
 */
function migrationMessage(step, phase) {
  return `chore(migrate): org format v${step.from}→v${step.to} (${phase})`
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
  // Serialize with other processes: a concurrent rewind under someone
  // else's live migration is the loss scenario (throws OrgLockedError).
  return withOrgLock(orgPath, env, () => recoverDanglingInner(orgPath, env))
}

function recoverDanglingInner(orgPath, env) {
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
  // Hold the org lock across recovery + the whole chain: another process
  // must see all-or-nothing, never a half-walked chain it could "recover".
  return withOrgLock(orgPath, env, () => migrateOrgInner(orgPath, { toVersion, migrations, env }))
}

function migrateOrgInner(orgPath, { toVersion, migrations, env }) {
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
  // One critical section for recover → stamp check → migrate: without it a
  // second process could slip in between recovery and migration and rewind
  // under our feet (throws OrgLockedError if the org is held elsewhere).
  return withOrgLock(orgPath, env, () => openOrgInner(orgPath, { appVersion, migrations, env }))
}

function openOrgInner(orgPath, { appVersion, migrations, env }) {
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
