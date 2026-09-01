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
import { CATEGORIES, scaffoldOrg, scaffoldOrgInRoot, scaffoldProject } from './lib/scaffold.js'
import { saveWorkspaceRoot, loadWorkspaceRoot, validateWorkspaceRoot, rootFilePath, legacyRootFilePath, listRecents, touchRecent, removeRecent, RECENTS_CAP } from './lib/root.js'
import { scanWorkspace, resolveOrgById, resolveProjectById } from './lib/resolve.js'
import { TEMPLATE_VERSION, getTemplate, stampFor, parseStamp, StampParseError } from './lib/template.js'
import { StampRefusalError, readOrgStampVersion, checkOrgStamp, writeOrgStampVersion } from './lib/stamp.js'
import { MigrationError, MIGRATIONS, migrationChain, migrateOrg, openOrg } from './lib/migrate.js'
import { OrgLockedError, acquireOrgLock } from './lib/lock.js'
import {
  TrashError,
  RestoreConflictError,
  HistoryBoundaryError,
  ConfirmRequiredError,
  hardDeleteToken,
  trashRoot,
  softDelete,
  listTrash,
  restoreFromTrash,
  hardDelete,
  sweepTrash,
} from './lib/trash.js'
import { spawnSync } from 'node:child_process'
import {
  initOrgRepo,
  initProjectRepo,
  runGit,
  resetProbe,
  GitUnavailableError,
} from '../git-workspace/lib/index.js'

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
  check('slugify kebab-cases display names, PRESERVING case (D79)', () => {
    assert.equal(slugify('Totem Labs'), 'Totem-Labs')
    assert.equal(slugify("Org & Café #1!"), 'Org-Cafe-1')
    assert.equal(slugify('POLO'), 'POLO')
    assert.equal(slugify('project-001'), 'project-001')
  })
  check('slug collision produces -2 suffix, case-insensitive (D79)', () => {
    assert.equal(uniqueSlug('Totem Labs', ['totem-labs']), 'Totem-Labs-2')
    assert.equal(uniqueSlug('Totem Labs', ['totem-labs', 'totem-labs-2']), 'Totem-Labs-3')
    assert.equal(uniqueSlug('POLO', ['polo']), 'POLO-2')
    assert.equal(uniqueSlug('polo', ['POLO']), 'polo-2')
  })

  // --- scaffold org + project ---
  const org = scaffoldOrgInRoot(workspaceRoot, 'Organisation A')
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
  check('scaffold creates fixed dock containers + project containers with targets (grilled 2026-08-30; D78 reads current template)', () => {
    for (const w of getTemplate(TEMPLATE_VERSION).fixedWorkspaces) {
      assert.ok(fs.statSync(path.join(org.path, w)).isDirectory(), `missing ${w}`)
    }
    for (const c of getTemplate(TEMPLATE_VERSION).projectContainers) {
      assert.ok(fs.statSync(path.join(project.path, c)).isDirectory(), `missing project container ${c}`)
      assert.ok(fs.statSync(path.join(project.path, c, 'website')).isDirectory(), `missing ${c}/website`)
      assert.ok(fs.statSync(path.join(project.path, c, 'application')).isDirectory(), `missing ${c}/application`)
    }
  })
  check('AGENTS.md placed at org root and project root (D43)', () => {
    assert.ok(fs.existsSync(path.join(org.path, 'AGENTS.md')))
    assert.ok(fs.existsSync(path.join(project.path, 'AGENTS.md')))
  })
  check('manifests written with id/name/createdAt; only the ORG is stamped (B13)', () => {
    for (const m of [org.manifest, project.manifest]) {
      assert.match(m.id, /^[0-9a-f-]{36}$/)
      assert.ok(m.createdAt)
    }
    assert.ok(org.manifest.formatStamp, 'the org carries the tree-format stamp')
    // A project stamp would be derived data that migrateOrg never refreshes,
    // so it could only ever go stale while looking authoritative.
    assert.equal('formatStamp' in project.manifest, false, 'projects carry no stamp')
    assert.equal('formatStamp' in readManifest(path.join(project.path, 'project.json')), false,
      'and none is written to disk either')
    assert.equal(readManifest(path.join(project.path, 'project.json')).name, 'Project One')
  })

  // --- rename twice: slug immutable (D41) ---
  check('renaming the org twice updates name only; slug/folder unchanged (D41)', () => {
    renameInManifest(orgManifestPath(org.path), 'Organisation A (rebranded)')
    renameInManifest(orgManifestPath(org.path), 'OrgA Final')
    assert.ok(fs.existsSync(org.path), 'org folder moved')
    assert.equal(path.basename(org.path), 'Organisation-A')
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
    const org2 = scaffoldOrgInRoot(workspaceRoot, 'Organisation A')
    assert.equal(org2.slug, 'Organisation-A-2')
    assert.notEqual(org2.manifest.id, org.manifest.id)
  })

  // --- D69: org-create targets the picked folder DIRECTLY ---
  check('scaffoldOrg scaffolds IN PLACE: org.json + five categories inside the picked folder', () => {
    const picked = path.join(tmp, 'picked-org')
    fs.mkdirSync(picked, { recursive: true })
    const inPlace = scaffoldOrg(picked, 'Picked Org')
    assert.equal(inPlace.path, path.resolve(picked), 'wrapper directory created')
    assert.equal(inPlace.slug, 'picked-org', 'slug is the folder basename (D41)')
    assert.ok(fs.existsSync(path.join(picked, 'org.json')), 'org.json missing inside picked folder')
    for (const c of CATEGORIES) {
      assert.ok(fs.statSync(path.join(picked, c)).isDirectory(), `missing ${c}/ inside picked folder`)
    }
    assert.equal(readManifest(orgManifestPath(picked)).name, 'Picked Org')
    assert.throws(() => scaffoldOrg(picked, 'Again'), /already-an-organisation/, 'double scaffold not refused')
    assert.throws(() => scaffoldOrg(path.join(tmp, 'no-such-folder'), 'X'), /does not exist/, 'missing folder not refused')
  })

  // --- recents: ~/.arxa/organisation.json is { orgs: [...] } (D69) ---
  check('recents start empty; saveWorkspaceRoot routes through touchRecent', () => {
    assert.deepEqual(listRecents(env), [], 'expected empty recents before any save')
    saveWorkspaceRoot(workspaceRoot, env)
    assert.deepEqual(listRecents(env), [path.resolve(workspaceRoot)])
    assert.equal(loadWorkspaceRoot(env), path.resolve(workspaceRoot), 'back-compat face serves the most recent')
    assert.equal(rootFilePath(env), path.join(fakeHome, 'organisation.json'), 'file renamed from workspace.json')
    assert.ok(fs.existsSync(rootFilePath(env)), 'organisation.json written')
  })
  check('loadWorkspaceRoot walks past DEAD pointers (D92c: one deleted folder must not blank the orgs)', () => {
    const deadA = path.join(tmp, 'org-dead-a')
    const liveB = path.join(tmp, 'org-live-b')
    fs.mkdirSync(liveB, { recursive: true })
    // deadA is never created — a Finder-deleted recent
    fs.writeFileSync(rootFilePath(env), JSON.stringify({ orgs: [deadA, liveB, '/definitely/not/there'] }, null, 2))
    assert.equal(loadWorkspaceRoot(env), path.resolve(liveB), 'first VALID recent wins when recents[0] is dead')
    // all-dead → null (the honest no-workspace state), never a throw
    fs.writeFileSync(rootFilePath(env), JSON.stringify({ orgs: [deadA] }, null, 2))
    assert.equal(loadWorkspaceRoot(env), null, 'all-dead recents answer null')
    // restore the EXACT pre-check recents (touchRecent would keep the
    // dead pointers — move-to-front dedupes by path, it never prunes)
    fs.writeFileSync(rootFilePath(env), JSON.stringify({ orgs: [workspaceRoot] }, null, 2))
  })
  check('recents are most-recent-first, deduped by move-to-front', () => {
    const a = path.join(tmp, 'org-a')
    const b = path.join(tmp, 'org-b')
    fs.mkdirSync(a, { recursive: true })
    fs.mkdirSync(b, { recursive: true })
    touchRecent(a, env)
    touchRecent(b, env)
    assert.deepEqual(listRecents(env), [path.resolve(b), path.resolve(a), path.resolve(workspaceRoot)])
    touchRecent(a, env) // re-open moves to front, no duplicate
    assert.deepEqual(listRecents(env), [path.resolve(a), path.resolve(b), path.resolve(workspaceRoot)])
  })
  check(`recents cap at ${RECENTS_CAP}`, () => {
    for (let n = 1; n <= RECENTS_CAP; n++) {
      const dir = path.join(tmp, 'cap-org-' + n)
      fs.mkdirSync(dir, { recursive: true })
      touchRecent(dir, env)
    }
    const list = listRecents(env)
    assert.equal(list.length, RECENTS_CAP, 'cap not enforced')
    assert.equal(list[0], path.resolve(path.join(tmp, 'cap-org-' + RECENTS_CAP)))
    assert.ok(!list.includes(path.resolve(workspaceRoot)), 'oldest entry should have been evicted')
  })
  check('removeRecent drops exactly one entry and is idempotent-safe', () => {
    const gone = path.join(tmp, 'cap-org-10')
    const before = listRecents(env).length
    removeRecent(gone, env)
    assert.equal(listRecents(env).length, before - 1)
    removeRecent(gone, env) // removing again is a no-op
    assert.equal(listRecents(env).length, before - 1)
  })
  check('file shape is { orgs: [...] } and the pre-D69 { root } shape migrates one-way', () => {
    const onDisk = JSON.parse(fs.readFileSync(rootFilePath(env), 'utf8'))
    assert.ok(Array.isArray(onDisk.orgs), 'expected { orgs: [...] } on disk')
    fs.writeFileSync(rootFilePath(env), JSON.stringify({ root: path.resolve(workspaceRoot) }))
    assert.deepEqual(listRecents(env), [path.resolve(workspaceRoot)], '{ root } shape still reads')
    assert.deepEqual(JSON.parse(fs.readFileSync(rootFilePath(env), 'utf8')), { orgs: [path.resolve(workspaceRoot)] }, 'not migrated on read')
  })
  check('legacy workspace.json is migrated (one-way) on load', () => {
    fs.rmSync(rootFilePath(env), { force: true })
    fs.writeFileSync(legacyRootFilePath(env), JSON.stringify({ root: path.resolve(workspaceRoot) }))
    assert.equal(loadWorkspaceRoot(env), path.resolve(workspaceRoot), 'legacy root still loads')
    assert.ok(fs.existsSync(rootFilePath(env)), 'migrated to organisation.json')
    assert.ok(!fs.existsSync(legacyRootFilePath(env)), 'legacy file removed — no two live copies')
  })
  check('root validation rejects app checkout and app-data locations (D36)', () => {
    const checkoutDir = path.resolve(path.dirname(new URL(import.meta.url).pathname))
    assert.throws(() => validateWorkspaceRoot(checkoutDir, env), /app checkout/)
    fs.mkdirSync(path.join(fakeHome, 'inner'), { recursive: true })
    assert.throws(() => validateWorkspaceRoot(path.join(fakeHome, 'inner'), env), /app-data/)
    assert.throws(() => validateWorkspaceRoot(path.join(tmp, 'does-not-exist'), env), /does not exist/)
  })

  // ===== Phase 5 — template, stamp, migrations (D21/D44) =====

  check('template v4 is the track/target tree; scaffold stamps the org with it (D44; D78 stage order; V1a tracks)', () => {
    assert.equal(TEMPLATE_VERSION, 4)
    assert.deepEqual(
      [...getTemplate(3).org.dirs].sort(),
      [...CATEGORIES, ...getTemplate(3).fixedWorkspaces.filter((w) => w.includes('/'))].sort(),
    )
    assert.equal(getTemplate(3).fixedWorkspaces.length, 10, 'notes + nine fixed dock containers')
    assert.equal(getTemplate(3).projectContainers.length, 10, 'ten project containers')
    assert.equal(getTemplate(3).projectTargets.join('+'), 'website+application')
    assert.equal(stampFor(2), 'arxa-tree/2')
    assert.equal(parseStamp('arxa-tree/7'), 7)
    assert.equal(readOrgStampVersion(org.path), 4)
    assert.equal(org.manifest.formatStamp, stampFor(TEMPLATE_VERSION))
    // D78: containers carry a 2-digit prefix in arxa's own pipeline order;
    // notes is free-form (D42), not a stage, and stays unnumbered, last.
    assert.deepEqual(
      [...getTemplate(3).projectContainers],
      ['00-moodboard', '01-intake', '02-design', '03-architecture', '04-diagrams', '05-scaffold', '06-build', '07-config', '08-deploy', 'notes'],
    )
    // D78: every scaffolded empty dir carries a .gitkeep so git (and
    // GitHub) can track the folder.
    assert.ok(fs.existsSync(path.join(org.path, 'notes', '.gitkeep')), 'org dock .gitkeep')
    assert.ok(fs.existsSync(path.join(org.path, 'meetings', 'scheduler', '.gitkeep')), 'dock container .gitkeep')
    assert.ok(fs.existsSync(path.join(project.path, '02-design', 'website', '.gitkeep')), 'project stage/track .gitkeep')

    // --- v4 pins the PAIR: track and target (V1/V1a) ---
    const t4 = getTemplate(4)
    assert.deepEqual([...t4.projectTracks], ['website', 'application'], 'tracks are the upper level')
    assert.deepEqual([...t4.targetCatalogue.application].slice(0, 3), ['ios', 'android', 'macos'],
      'application targets are arxa platforms — the contract holds for this track')
    assert.deepEqual([...t4.targetCatalogue.website].slice(0, 2), ['landing', 'docs'],
      'website targets are site types; the platform is web and stays implicit')
    // v3 must keep emitting exactly what it always did — migrations replay it.
    assert.equal(getTemplate(3).project.dirs.length, 30, 'v3 tree is untouched by v4')
    assert.equal(t4.project.dirs.length, 30, 'v4 with no chosen targets equals the v3 shape')
    // A chosen target adds one dir per stage, and only the chosen one.
    const chosen = t4.project.projectDirs({ application: ['ios'] })
    assert.equal(chosen.filter((d) => d.endsWith('/application/ios')).length, 10, 'one per stage')
    assert.equal(chosen.filter((d) => d.includes('/android')).length, 0, 'unchosen targets are never scaffolded')
    assert.throws(() => t4.project.projectDirs({ application: ['solaris'] }), /unknown target/)
    assert.throws(() => t4.project.projectDirs({ nope: ['ios'] }), /unknown track/)
    // The selection is recorded, so "no targets yet" is a fact, not a guess.
    assert.deepEqual(project.manifest.targets, {}, 'a project with no chosen targets says so')
  })

  check('D73: the project template carries a .gitignore — noise + secrets only, never managed containers', () => {
    const project = getTemplate(2).project
    const ignoreEntry = project.files.find((f) => f.path === '.gitignore')
    assert.ok(ignoreEntry, 'v2 project template writes a .gitignore')
    const body = ignoreEntry.content({ displayName: 'X' })
    assert.match(body, /\.env\b/, 'secrets ignored')
    assert.match(body, /node_modules\//, 'dependency dirs ignored')
    assert.doesNotMatch(body, /(^|\/)build\//, 'build/ is a MANAGED CONTAINER — never ignored')
    // end-to-end: scaffoldProject really writes it on disk
    const p = scaffoldProject(org.path, 'Ignore Probe')
    assert.equal(fs.readFileSync(path.join(p.path, '.gitignore'), 'utf8'), body)
  })

  // A dedicated org for the migration story, with its own git repo.
  const migOrg = scaffoldOrgInRoot(workspaceRoot, 'Migration Org')
  initOrgRepo(migOrg.path)
  // Fresh scaffolds stamp at the CURRENT version (v2); the migration
  // story needs v1 orgs — downgrade the stamp and commit (migrations
  // demand a clean tree).
  const stampV1 = (orgPath) => {
    writeOrgStampVersion(orgPath, 1)
    runGit(['add', '-A'], { cwd: orgPath })
    runGit(['commit', '-m', 'test: stamp at v1'], { cwd: orgPath })
  }
  stampV1(migOrg.path)
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
    const dirtyOrg = scaffoldOrgInRoot(workspaceRoot, 'Dirty Org')
    initOrgRepo(dirtyOrg.path)
    stampV1(dirtyOrg.path)
    fs.writeFileSync(path.join(dirtyOrg.path, 'notes', 'stray.md'), 'uncommitted\n')
    assert.throws(
      () => migrateOrg(dirtyOrg.path, { toVersion: 2, migrations: testMigrations }),
      /uncommitted or untracked/
    )
    assert.equal(readOrgStampVersion(dirtyOrg.path), 1)
  })

  check('failing migration rewinds to the pre commit; stamp stays put', () => {
    const crashOrg = scaffoldOrgInRoot(workspaceRoot, 'Crash Org')
    initOrgRepo(crashOrg.path)
    stampV1(crashOrg.path)
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
    const corruptOrg = scaffoldOrgInRoot(workspaceRoot, 'Corrupt Org')
    const mPath = orgManifestPath(corruptOrg.path)
    const manifest = readManifest(mPath)
    manifest.formatStamp = 'not-a-stamp'
    fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2) + '\n')
    assert.throws(() => checkOrgStamp(corruptOrg.path), StampParseError)
    assert.throws(() => parseStamp(42), StampParseError)
    assert.throws(() => parseStamp('arxa-tree/zero'), StampParseError)
  })

  check('crash between pre and post commit → reopen rewinds and re-runs the migration', () => {
    const interruptedOrg = scaffoldOrgInRoot(workspaceRoot, 'Interrupted Org')
    initOrgRepo(interruptedOrg.path)
    stampV1(interruptedOrg.path)
    // Simulate a run that died mid-step: pre commit made, apply half done,
    // stamp already bumped on disk, post commit never published.
    runGit(['commit', '--allow-empty', '-m', 'chore(migrate): org format migration v1→v2 (pre)'], {
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
    const fresh = scaffoldOrgInRoot(workspaceRoot, 'Parity Fresh')
    const migrated = scaffoldOrgInRoot(workspaceRoot, 'Parity Migrated')
    initOrgRepo(migrated.path)
    stampV1(migrated.path)
    openOrg(migrated.path, { appVersion: TEMPLATE_VERSION, migrations: MIGRATIONS })
    const tree = (root) => {
      const out = []
      const walk = (dir, rel) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          if (ent.name === '.git' || ent.name === '.gitignore' || ent.name === '.gitkeep') continue // repo artifacts, not template tree
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

  check('D78 migration v2→v3: project stage dirs renamed to numbered order, .gitkeep lands, project repo commits', () => {
    const v2org = scaffoldOrgInRoot(workspaceRoot, 'D78 Migrate')
    // A realistic v2 project: old container names, its OWN nested repo (the
    // org repo cannot carry a nested repo's tree), blank stage dirs.
    const proj = path.join(v2org.path, 'projects', 'project-001')
    for (const c of getTemplate(2).projectContainers) {
      fs.mkdirSync(path.join(proj, c, 'website'), { recursive: true })
      fs.mkdirSync(path.join(proj, c, 'application'), { recursive: true })
    }
    fs.writeFileSync(path.join(proj, 'project.json'), JSON.stringify({ id: 'p1', name: 'P1', createdAt: 'now', formatStamp: 'arxa-tree/2' }))
    // Real-world order: the project repo exists FIRST; the org repo then
    // records it as a nested repo (gitlink) and the tree is clean.
    runGit(['init'], { cwd: proj })
    runGit(['add', '-A'], { cwd: proj })
    runGit(['commit', '-m', 'chore(project): scaffold the project tree'], { cwd: proj })
    initOrgRepo(v2org.path)
    writeOrgStampVersion(v2org.path, 2)
    runGit(['add', '-A'], { cwd: v2org.path })
    runGit(['commit', '-m', 'test: stamp at v2'], { cwd: v2org.path }) // migrations demand a clean tree
    const opened = openOrg(v2org.path, { appVersion: TEMPLATE_VERSION, migrations: MIGRATIONS })
    assert.equal(readOrgStampVersion(v2org.path), 4, 'org restamped at the current template')
    assert.ok(fs.existsSync(path.join(proj, '02-design')), 'design → 02-design')
    assert.ok(!fs.existsSync(path.join(proj, 'design')), 'old design dir gone')
    assert.ok(fs.existsSync(path.join(proj, '00-moodboard', 'website')), 'targets rode along in the rename')
    assert.ok(fs.existsSync(path.join(proj, '08-deploy', 'application', '.gitkeep')), '.gitkeep in the emptied target dir')
    assert.ok(fs.existsSync(path.join(v2org.path, 'notes', '.gitkeep')), 'org-level empties gitkeep’d too')
    const log = runGit(['log', '--format=%s'], { cwd: proj })
    assert.match(log, /chore\(migrate\): stage folders to template v3/, 'the project REPO carries the migration commit, with a subject the frame gate accepts (B17)')
    assert.ok(opened.migrated.some((m) => m.from === 2 && m.to === 3), 'openOrg ran the shipped 2→3 step')
  })

  check('git absent: stamp + refusal still work; migration fails with git-unavailable reason', () => {
    const absentEnv = { ...process.env, ARXA_GIT_BIN: path.join(tmp, 'no-such-git') }
    resetProbe()
    const gitlessOrg = scaffoldOrgInRoot(workspaceRoot, 'Gitless Org') // scaffold + stamp: no git needed
    writeOrgStampVersion(gitlessOrg.path, 1) // fresh scaffolds stamp at the current version; the story needs v1
    assert.equal(readOrgStampVersion(gitlessOrg.path), 1)
    assert.throws(() => checkOrgStamp(migOrg.path, 1), StampRefusalError) // refusal: pure fs
    assert.throws(
      () => migrateOrg(gitlessOrg.path, { toVersion: 2, migrations: testMigrations, env: absentEnv }),
      GitUnavailableError
    )
    resetProbe()
  })

  // --- org open lock (concurrent-process safety) ---
  const lockFile = path.join(migOrg.path, '.git', 'arxa-open.lock')

  check('org held by a live foreign process: openOrg refuses with OrgLockedError', () => {
    // pid 1 (launchd/init) is always alive and never ours.
    fs.writeFileSync(lockFile, JSON.stringify({ pid: 1, startedAt: new Date().toISOString() }))
    try {
      assert.throws(
        () => openOrg(migOrg.path, { appVersion: 2, migrations: testMigrations }),
        OrgLockedError
      )
    } finally {
      fs.rmSync(lockFile, { force: true })
    }
  })

  check('stale lock from a dead pid is taken over, then released', () => {
    const dead = spawnSync('/bin/echo', ['x']).pid // exited child: guaranteed-dead pid
    fs.writeFileSync(lockFile, JSON.stringify({ pid: dead, startedAt: new Date().toISOString() }))
    const opened = openOrg(migOrg.path, { appVersion: 2, migrations: testMigrations })
    assert.equal(opened.orgVersion, 2)
    assert.equal(fs.existsSync(lockFile), false) // takeover must not leak the lock
  })

  check('lock is reentrant in-process and always released on the happy path', () => {
    const release = acquireOrgLock(migOrg.path)
    try {
      // openOrg nests inside our own lock instead of deadlocking (openOrg →
      // migrateOrg → recovery all reenter via the same pid).
      openOrg(migOrg.path, { appVersion: 2, migrations: testMigrations })
      assert.equal(fs.existsSync(lockFile), true) // inner frames must not steal our unlink
    } finally {
      release()
    }
    assert.equal(fs.existsSync(lockFile), false)
  })
  // --- Phase 6: trash (D47) ---
  const trashOrg = scaffoldOrgInRoot(workspaceRoot, 'Trash Org')
  initOrgRepo(trashOrg.path)
  const doomed = scaffoldProject(trashOrg.path, 'Doomed Project')
  initProjectRepo(doomed.path)
  fs.writeFileSync(path.join(doomed.path, 'work.md'), 'irreplaceable work\n')
  runGit(['add', '-A'], { cwd: doomed.path })
  runGit(['commit', '-m', 'stage: work'], { cwd: doomed.path })

  check('soft-delete a nested project repo, restore, git history identical', () => {
    const logBefore = runGit(['log', '--format=%H %s'], { cwd: doomed.path })
    const { entryId, entryPath, origin } = softDelete(workspaceRoot, doomed.path)
    assert.equal(fs.existsSync(doomed.path), false)
    assert.equal(fs.existsSync(path.join(entryPath, doomed.slug, 'work.md')), true)
    assert.equal(origin.originalPath, path.relative(workspaceRoot, doomed.path))
    assert.equal(origin.projectId, doomed.manifest.id)
    const { restoredPath } = restoreFromTrash(workspaceRoot, entryId)
    assert.equal(restoredPath, doomed.path)
    assert.equal(fs.existsSync(path.join(trashRoot(workspaceRoot), entryId)), false) // entry consumed
    const logAfter = runGit(['log', '--format=%H %s'], { cwd: doomed.path })
    assert.equal(logAfter, logBefore) // full history intact, byte for byte
  })

  check('delete inside an org repo is D18-recorded as a wip commit', () => {
    // projects/ is gitignored by the org repo (D37), so use a tracked path.
    const trackedDir = path.join(trashOrg.path, 'notes', 'tracked-notes')
    fs.mkdirSync(trackedDir, { recursive: true })
    fs.writeFileSync(path.join(trackedDir, 'a.md'), 'tracked\n')
    runGit(['add', '-A'], { cwd: trashOrg.path })
    runGit(['commit', '-m', 'stage: add tracked notes'], { cwd: trashOrg.path })
    const { entryId, origin } = softDelete(workspaceRoot, trackedDir)
    assert.equal(origin.git.committed, true)
    const subject = runGit(['log', '-1', '--format=%s'], { cwd: trashOrg.path })
    assert.equal(subject.startsWith('wip:'), true)
    hardDelete(workspaceRoot, entryId, { confirm: hardDeleteToken(entryId) })
  })

  check('hard delete refused without the confirm token', () => {
    const junk = path.join(trashOrg.path, 'notes', 'junk')
    fs.mkdirSync(junk, { recursive: true })
    const { entryId, entryPath } = softDelete(workspaceRoot, junk)
    assert.throws(() => hardDelete(workspaceRoot, entryId), ConfirmRequiredError)
    assert.throws(() => hardDelete(workspaceRoot, entryId, { confirm: 'yes' }), ConfirmRequiredError)
    assert.equal(fs.existsSync(entryPath), true) // still there after refusals
    hardDelete(workspaceRoot, entryId, { confirm: hardDeleteToken(entryId) })
    assert.equal(fs.existsSync(entryPath), false)
  })

  check('restore into an occupied path is refused, typed', () => {
    const spot = path.join(trashOrg.path, 'notes', 'spot')
    fs.mkdirSync(spot, { recursive: true })
    const { entryId } = softDelete(workspaceRoot, spot)
    fs.mkdirSync(spot, { recursive: true }) // squatter takes the origin
    assert.throws(() => restoreFromTrash(workspaceRoot, entryId), RestoreConflictError)
    fs.rmSync(spot, { recursive: true, force: true })
    restoreFromTrash(workspaceRoot, entryId) // origin free again → succeeds
    assert.equal(fs.existsSync(spot), true)
  })

  check('cross-repo restore refuses with history-boundary error (D41) unless accepted', () => {
    const otherOrg = scaffoldOrgInRoot(workspaceRoot, 'Other Trash Org')
    initOrgRepo(otherOrg.path)
    const drifting = path.join(trashOrg.path, 'notes', 'drifting')
    fs.mkdirSync(drifting, { recursive: true })
    const { entryId } = softDelete(workspaceRoot, drifting)
    const foreignDest = path.join(otherOrg.path, 'notes', 'drifting')
    assert.throws(
      () => restoreFromTrash(workspaceRoot, entryId, { intoPath: foreignDest }),
      HistoryBoundaryError
    )
    const { restoredPath } = restoreFromTrash(workspaceRoot, entryId, {
      intoPath: foreignDest,
      acceptHistoryLoss: true,
    })
    assert.equal(restoredPath, foreignDest)
  })

  check('trash is invisible to scanWorkspace and resolve-by-id', () => {
    const ghostOrg = scaffoldOrgInRoot(workspaceRoot, 'Ghost Org')
    const { entryId } = softDelete(workspaceRoot, ghostOrg.path)
    const scan = scanWorkspace(workspaceRoot)
    assert.equal(scan.orgs.has(ghostOrg.manifest.id), false)
    for (const org of scan.orgs.values()) assert.equal(org.path.includes('.arxa'), false)
    assert.equal(resolveOrgById(workspaceRoot, ghostOrg.manifest.id), null)
    assert.equal(listTrash(workspaceRoot).some((e) => e.entryId === entryId), true) // but trash sees it
    hardDelete(workspaceRoot, entryId, { confirm: hardDeleteToken(entryId) })
  })

  check('sweep requires explicit max-age and only removes older entries', () => {
    assert.throws(() => sweepTrash(workspaceRoot), TrashError)
    assert.throws(() => sweepTrash(workspaceRoot, { maxAgeMs: 0 }), TrashError)
    assert.throws(() => sweepTrash(workspaceRoot, { maxAgeMs: Infinity }), TrashError)
    const day = 24 * 60 * 60 * 1000
    const oldDir = path.join(trashOrg.path, 'notes', 'old-thing')
    const newDir = path.join(trashOrg.path, 'notes', 'new-thing')
    fs.mkdirSync(oldDir, { recursive: true })
    fs.mkdirSync(newDir, { recursive: true })
    const oldEntry = softDelete(workspaceRoot, oldDir, { now: new Date(Date.now() - 10 * day) })
    const newEntry = softDelete(workspaceRoot, newDir)
    const { removed } = sweepTrash(workspaceRoot, { maxAgeMs: 5 * day })
    assert.deepEqual(removed, [oldEntry.entryId])
    assert.equal(fs.existsSync(newEntry.entryPath), true)
    hardDelete(workspaceRoot, newEntry.entryId, { confirm: hardDeleteToken(newEntry.entryId) })
  })

  check('git absent: soft delete still moves, records the skip reason', () => {
    const absentEnv = { ...process.env, ARXA_GIT_BIN: path.join(tmp, 'no-such-git') }
    resetProbe()
    const offline = path.join(trashOrg.path, 'notes', 'offline-thing')
    fs.mkdirSync(offline, { recursive: true })
    const { entryId, entryPath, origin } = softDelete(workspaceRoot, offline, { env: absentEnv })
    assert.equal(fs.existsSync(offline), false) // fs move happened anyway
    assert.equal(fs.existsSync(entryPath), true)
    assert.equal(origin.git.committed, false)
    assert.match(origin.git.skippedReason, /git unavailable/)
    resetProbe()
    hardDelete(workspaceRoot, entryId, { confirm: hardDeleteToken(entryId) })
  })

  check('trash refuses targets outside the workspace and .arxa itself', () => {
    assert.throws(() => softDelete(workspaceRoot, tmp), TrashError)
    assert.throws(() => softDelete(workspaceRoot, path.join(workspaceRoot, '.arxa')), TrashError)
    assert.throws(() => softDelete(workspaceRoot, trashRoot(workspaceRoot)), TrashError)
  })
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

if (failures > 0) {
  console.log(`\nFAIL — ${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nPASS — all checks green')
