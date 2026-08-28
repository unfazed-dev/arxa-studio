// Phase 1 + Phase 5 exit checks (docs/plans/file-organisation-implementation.md):
// Phase 1 — scaffold a workspace with one org + one project; rename the
// org twice; slugs unchanged, manifest updated; resolve everything by id;
// slug collisions get numeric suffixes.
// Phase 5 — scaffold at template v1; bump to v2 with a test migration;
// open old org → migrated with commit pair present in org repo log; open
// a v2 org in a v1-templated build → clean typed refusal; with git
// absent, stamp/refusal still work and migration fails cleanly.
// Run: node plugins/workspace/selftest.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { slugify, uniqueSlug } from './lib/slug.js'
import { readManifest, renameInManifest, orgManifestPath } from './lib/manifest.js'
import { CATEGORIES, scaffoldOrg, scaffoldProject } from './lib/scaffold.js'
import { saveWorkspaceRoot, loadWorkspaceRoot, validateWorkspaceRoot } from './lib/root.js'
import { scanWorkspace, resolveOrgById, resolveProjectById } from './lib/resolve.js'
import { TEMPLATE_VERSION, getTemplate, stampFor, parseStamp, StampParseError } from './lib/template.js'
import { StampRefusalError, readOrgStampVersion, checkOrgStamp, writeOrgStampVersion } from './lib/stamp.js'
import { MigrationError, MIGRATIONS, migrationChain, migrateOrg, openOrg } from './lib/migrate.js'
import { initOrgRepo, runGit, resetProbe, GitUnavailableError, STAGE_PREFIX } from '../git-workspace/lib/index.js'

let failures = 0
function check(label, fn) {
  try {
    fn()
    console.log(`PASS ${label}`)
  } catch (err) {
    failures++
    console.log(`FAIL ${label} — ${err.message}`)
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-workspace-selftest-'))
const workspaceRoot = path.join(tmp, 'workspace')
const fakeHome = path.join(tmp, 'arxa-home')
fs.mkdirSync(workspaceRoot, { recursive: true })
const env = { ...process.env, ARXA_HOME: fakeHome }

try {
  // --- slugs ---
  check('slugify kebab-cases display names', () => {
    assert.equal(slugify('Totem Labs'), 'totem-labs')
    assert.equal(slugify("Org & Café #1!"), 'org-cafe-1')
  })
  check('slug collision produces -2 suffix', () => {
    assert.equal(uniqueSlug('Totem Labs', ['totem-labs']), 'totem-labs-2')
    assert.equal(uniqueSlug('Totem Labs', ['totem-labs', 'totem-labs-2']), 'totem-labs-3')
  })

  // --- scaffold org + project ---
  const org = scaffoldOrg(workspaceRoot, 'Organisation A')
  const project = scaffoldProject(org.path, 'Project One')

  check('org scaffold creates exactly the five fixed categories (D42)', () => {
    for (const c of CATEGORIES) {
      assert.ok(fs.statSync(path.join(org.path, c)).isDirectory(), `missing ${c}/`)
    }
    assert.deepEqual([...CATEGORIES].sort(), ['account', 'communications', 'meetings', 'notes', 'projects'])
    const dirs = fs
      .readdirSync(org.path, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
    assert.deepEqual(dirs, [...CATEGORIES].sort(), 'extra top-level folders present')
  })
  check('AGENTS.md placed at org root and project root (D43)', () => {
    assert.ok(fs.existsSync(path.join(org.path, 'AGENTS.md')))
    assert.ok(fs.existsSync(path.join(project.path, 'AGENTS.md')))
  })
  check('manifests written with id/name/createdAt/formatStamp', () => {
    for (const m of [org.manifest, project.manifest]) {
      assert.match(m.id, /^[0-9a-f-]{36}$/)
      assert.ok(m.createdAt && m.formatStamp)
    }
    assert.equal(readManifest(path.join(project.path, 'project.json')).name, 'Project One')
  })

  // --- rename twice: slug immutable (D41) ---
  check('renaming the org twice updates name only; slug/folder unchanged (D41)', () => {
    renameInManifest(orgManifestPath(org.path), 'Organisation A (rebranded)')
    renameInManifest(orgManifestPath(org.path), 'OrgA Final')
    assert.ok(fs.existsSync(org.path), 'org folder moved')
    assert.equal(path.basename(org.path), 'organisation-a')
    assert.equal(readManifest(orgManifestPath(org.path)).name, 'OrgA Final')
    assert.equal(readManifest(orgManifestPath(org.path)).id, org.manifest.id, 'id changed on rename')
  })

  // --- resolve by id after rename ---
  check('resolve-by-id finds org and project after renames', () => {
    const foundOrg = resolveOrgById(workspaceRoot, org.manifest.id)
    const foundProject = resolveProjectById(workspaceRoot, project.manifest.id)
    assert.equal(foundOrg?.path, org.path)
    assert.equal(foundOrg?.name, 'OrgA Final')
    assert.equal(foundProject?.path, project.path)
    assert.equal(foundProject?.orgId, org.manifest.id)
    const { orgs, projects } = scanWorkspace(workspaceRoot)
    assert.equal(orgs.size, 1)
    assert.equal(projects.size, 1)
  })

  // --- org slug collision on disk ---
  check('scaffolding a second org with the same name yields <slug>-2', () => {
    const org2 = scaffoldOrg(workspaceRoot, 'Organisation A')
    assert.equal(org2.slug, 'organisation-a-2')
    assert.notEqual(org2.manifest.id, org.manifest.id)
  })

  // --- workspace-root persistence (D36) ---
  check('workspace root persists to $ARXA_HOME/workspace.json and reloads', () => {
    assert.equal(loadWorkspaceRoot(env), null, 'expected no root before save')
    saveWorkspaceRoot(workspaceRoot, env)
    assert.equal(loadWorkspaceRoot(env), path.resolve(workspaceRoot))
  })
  check('root validation rejects app checkout and app-data locations (D36)', () => {
    const checkoutDir = path.resolve(path.dirname(new URL(import.meta.url).pathname))
    assert.throws(() => validateWorkspaceRoot(checkoutDir, env), /app checkout/)
    fs.mkdirSync(path.join(fakeHome, 'inner'), { recursive: true })
    assert.throws(() => validateWorkspaceRoot(path.join(fakeHome, 'inner'), env), /app-data/)
    assert.throws(() => validateWorkspaceRoot(path.join(tmp, 'does-not-exist'), env), /does not exist/)
  })

  // ===== Phase 5 — template, stamp, migrations (D21/D44) =====

  check('template v1 IS the phase-1 tree; scaffold stamps the org with it (D44)', () => {
    assert.equal(TEMPLATE_VERSION, 1)
    assert.deepEqual([...getTemplate(1).org.dirs].sort(), [...CATEGORIES].sort())
    assert.equal(stampFor(1), 'arxa-tree/1')
    assert.equal(parseStamp('arxa-tree/7'), 7)
    assert.equal(readOrgStampVersion(org.path), 1)
    assert.equal(org.manifest.formatStamp, stampFor(TEMPLATE_VERSION))
  })

  // A dedicated org for the migration story, with its own git repo.
  const migOrg = scaffoldOrg(workspaceRoot, 'Migration Org')
  initOrgRepo(migOrg.path)
  const testMigrations = [
    {
      from: 1,
      to: 2,
      description: 'test migration: add notes/MIGRATED.md',
      apply: (orgPath) => fs.writeFileSync(path.join(orgPath, 'notes', 'MIGRATED.md'), 'migrated\n'),
    },
  ]

  check('open old org in v2 build → migrated, commit pair in org repo log (D21/D44)', () => {
    const opened = openOrg(migOrg.path, { appVersion: 2, migrations: testMigrations })
    assert.equal(opened.orgVersion, 2)
    assert.equal(readOrgStampVersion(migOrg.path), 2)
    assert.ok(fs.existsSync(path.join(migOrg.path, 'notes', 'MIGRATED.md')))
    assert.equal(opened.migrated.length, 1)
    const { preSha, postSha } = opened.migrated[0]
    assert.ok(preSha && postSha && preSha !== postSha)
    const log = runGit(['log', '--format=%s'], { cwd: migOrg.path })
    assert.match(log, /org format migration v1→v2 \(post\)/)
    assert.match(log, /org format migration v1→v2 \(pre\)/)
  })

  check('opening an up-to-date org is a no-op', () => {
    const opened = openOrg(migOrg.path, { appVersion: 2, migrations: testMigrations })
    assert.equal(opened.migrated.length, 0)
  })

  check('v2 org in a v1-templated build → clean typed refusal, nothing changed (D21)', () => {
    const before = fs.readFileSync(orgManifestPath(migOrg.path), 'utf8')
    assert.throws(() => openOrg(migOrg.path, { appVersion: 1 }), StampRefusalError)
    assert.throws(() => checkOrgStamp(migOrg.path, 1), /newer version of arxa studio/)
    try {
      checkOrgStamp(migOrg.path, 1)
    } catch (err) {
      assert.equal(err.orgVersion, 2)
      assert.equal(err.appVersion, 1)
    }
    assert.equal(fs.readFileSync(orgManifestPath(migOrg.path), 'utf8'), before)
  })

  check('missing migration step → typed MigrationError, forward-only enforced', () => {
    assert.throws(() => openOrg(migOrg.path, { appVersion: 3, migrations: testMigrations }), MigrationError)
    assert.throws(
      () => migrateOrg(migOrg.path, { toVersion: 1, migrations: testMigrations }),
      /forward-only/
    )
  })

  check('dirty org tree → migration refused before any commit', () => {
    const dirtyOrg = scaffoldOrg(workspaceRoot, 'Dirty Org')
    initOrgRepo(dirtyOrg.path)
    fs.writeFileSync(path.join(dirtyOrg.path, 'notes', 'stray.md'), 'uncommitted\n')
    assert.throws(
      () => migrateOrg(dirtyOrg.path, { toVersion: 2, migrations: testMigrations }),
      /uncommitted or untracked/
    )
    assert.equal(readOrgStampVersion(dirtyOrg.path), 1)
  })

  check('failing migration rewinds to the pre commit; stamp stays put', () => {
    const crashOrg = scaffoldOrg(workspaceRoot, 'Crash Org')
    initOrgRepo(crashOrg.path)
    const crashing = [
      {
        from: 1,
        to: 2,
        description: 'crashes mid-apply',
        apply: (orgPath) => {
          fs.writeFileSync(path.join(orgPath, 'notes', 'half-done.md'), 'partial\n')
          throw new Error('simulated crash mid-migration')
        },
      },
    ]
    assert.throws(() => migrateOrg(crashOrg.path, { toVersion: 2, migrations: crashing }), MigrationError)
    assert.equal(readOrgStampVersion(crashOrg.path), 1, 'stamp advanced despite crash')
    assert.ok(!fs.existsSync(path.join(crashOrg.path, 'notes', 'half-done.md')), 'partial write survived rewind')
    const log = runGit(['log', '--format=%s'], { cwd: crashOrg.path })
    assert.match(log, /org format migration v1→v2 \(pre\)/, 'rewind point missing from log')
    assert.doesNotMatch(log, /\(post\)/, 'post commit published despite crash')
  })

  check('corrupt format stamp → typed StampParseError, not a crash', () => {
    const corruptOrg = scaffoldOrg(workspaceRoot, 'Corrupt Org')
    const mPath = orgManifestPath(corruptOrg.path)
    const manifest = readManifest(mPath)
    manifest.formatStamp = 'not-a-stamp'
    fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2) + '\n')
    assert.throws(() => checkOrgStamp(corruptOrg.path), StampParseError)
    assert.throws(() => parseStamp(42), StampParseError)
    assert.throws(() => parseStamp('arxa-tree/zero'), StampParseError)
  })

  check('crash between pre and post commit → reopen rewinds and re-runs the migration', () => {
    const interruptedOrg = scaffoldOrg(workspaceRoot, 'Interrupted Org')
    initOrgRepo(interruptedOrg.path)
    // Simulate a run that died mid-step: pre commit made, apply half done,
    // stamp already bumped on disk, post commit never published.
    runGit(['commit', '--allow-empty', '-m', `${STAGE_PREFIX} org format migration v1→v2 (pre)`], {
      cwd: interruptedOrg.path,
    })
    fs.writeFileSync(path.join(interruptedOrg.path, 'notes', 'half-done.md'), 'partial\n')
    writeOrgStampVersion(interruptedOrg.path, 2) // the uncommitted bump that must not be trusted
    const opened = openOrg(interruptedOrg.path, { appVersion: 2, migrations: testMigrations })
    assert.equal(opened.migrated.length, 1, 'reopen treated the half-applied org as already migrated')
    assert.equal(readOrgStampVersion(interruptedOrg.path), 2)
    assert.ok(fs.existsSync(path.join(interruptedOrg.path, 'notes', 'MIGRATED.md')))
    assert.ok(!fs.existsSync(path.join(interruptedOrg.path, 'notes', 'half-done.md')), 'dead run debris survived')
    const log = runGit(['log', '--format=%s'], { cwd: interruptedOrg.path })
    assert.match(log, /org format migration v1→v2 \(post\)/)
  })

  check('shipped chain covers v1→latest; scaffold-at-latest ≡ v1 scaffold + migrations', () => {
    // If TEMPLATE_VERSION ever bumps without a shipped migration, this throws.
    assert.equal(migrationChain(1, TEMPLATE_VERSION, MIGRATIONS).length, TEMPLATE_VERSION - 1)
    // Parity: the template and the migration chain must describe the same tree.
    const fresh = scaffoldOrg(workspaceRoot, 'Parity Fresh')
    const migrated = scaffoldOrg(workspaceRoot, 'Parity Migrated')
    initOrgRepo(migrated.path)
    openOrg(migrated.path, { appVersion: TEMPLATE_VERSION, migrations: MIGRATIONS })
    const tree = (root) => {
      const out = []
      const walk = (dir, rel) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          if (ent.name === '.git' || ent.name === '.gitignore') continue // repo artifacts, not template tree
          const r = rel ? `${rel}/${ent.name}` : ent.name
          out.push(ent.isDirectory() ? `${r}/` : r)
          if (ent.isDirectory()) walk(path.join(dir, ent.name), r)
        }
      }
      walk(root, '')
      return out.sort()
    }
    assert.deepEqual(tree(fresh.path), tree(migrated.path))
  })

  check('git absent: stamp + refusal still work; migration fails with git-unavailable reason', () => {
    const absentEnv = { ...process.env, ARXA_GIT_BIN: path.join(tmp, 'no-such-git') }
    resetProbe()
    const gitlessOrg = scaffoldOrg(workspaceRoot, 'Gitless Org') // scaffold + stamp: no git needed
    assert.equal(readOrgStampVersion(gitlessOrg.path), 1)
    assert.throws(() => checkOrgStamp(migOrg.path, 1), StampRefusalError) // refusal: pure fs
    assert.throws(
      () => migrateOrg(gitlessOrg.path, { toVersion: 2, migrations: testMigrations, env: absentEnv }),
      GitUnavailableError
    )
    resetProbe()
  })
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

if (failures > 0) {
  console.log(`\nFAIL — ${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nPASS — all checks green')
