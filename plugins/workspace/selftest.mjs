// Phase 1 exit check (docs/plans/file-organisation-implementation.md):
// scaffold a workspace with one org + one project; rename the org twice;
// slugs unchanged, manifest updated; resolve everything by id; slug
// collisions get numeric suffixes. Run: node plugins/workspace/selftest.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { slugify, uniqueSlug } from './lib/slug.js'
import { readManifest, renameInManifest, orgManifestPath } from './lib/manifest.js'
import { CATEGORIES, scaffoldOrg, scaffoldProject } from './lib/scaffold.js'
import { saveWorkspaceRoot, loadWorkspaceRoot, validateWorkspaceRoot } from './lib/root.js'
import { scanWorkspace, resolveOrgById, resolveProjectById } from './lib/resolve.js'

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
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

if (failures > 0) {
  console.log(`\nFAIL — ${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nPASS — all checks green')
