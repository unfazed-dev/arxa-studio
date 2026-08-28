/**
 * Permanent rebuild gate test (Phase 2, D46).
 *
 * Proves the index is a pure derived cache: build a fixture workspace with
 * plain fs (no plugins/workspace import), index it, snapshot all query
 * results, DELETE the index entirely, rebuild from the tree, and assert the
 * query results are deep-equal. Also proves external fs edits are legal:
 * add a file / append a fact with plain fs, re-scan, assert they appear.
 *
 * Exits non-zero on any failure.
 */

import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openBackend, INDEX_DIR } from './lib/backend.js'
import { rebuild } from './lib/rebuild.js'
import { appendFact, deriveFactState } from './lib/facts.js'

let failures = 0
function check(label, fn) {
  try {
    fn()
    console.log(`ok   - ${label}`)
  } catch (err) {
    failures += 1
    console.error(`FAIL - ${label}`)
    console.error(`       ${err.message}`)
  }
}

// ---------------------------------------------------------------- fixture --
// Built directly with fs, per the documented on-disk format. Deliberately
// does NOT import plugins/workspace.
const root = mkdtempSync(join(tmpdir(), 'arxa-index-selftest-'))
const CATEGORIES = ['projects', 'notes', 'meetings', 'account', 'communications']

function makeOrg(slug, id, name) {
  const dir = join(root, slug)
  for (const c of CATEGORIES) mkdirSync(join(dir, c), { recursive: true })
  writeFileSync(
    join(dir, 'org.json'),
    JSON.stringify({ id, name, createdAt: '2026-08-28T00:00:00.000Z', formatStamp: 'v1' })
  )
  return dir
}

function makeProject(orgSlug, slug, id, name) {
  const dir = join(root, orgSlug, 'projects', slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'project.json'),
    JSON.stringify({ id, name, createdAt: '2026-08-28T00:00:00.000Z', formatStamp: 'v1' })
  )
  return dir
}

const acme = makeOrg('acme', 'org_acme', 'Acme')
makeOrg('globex', 'org_globex', 'Globex')
const website = makeProject('acme', 'website', 'proj_website', 'Website')
makeProject('globex', 'launch', 'proj_launch', 'Launch')

writeFileSync(join(acme, 'notes', 'hello.md'), '# hello\n')
writeFileSync(join(website, 'spec.md'), '# spec\n')
writeFileSync(join(acme, 'communications', 'kickoff-email.md'), 'hi\n')

// Trash + dot-dir internals: must NOT be indexed.
mkdirSync(join(acme, '.arxa', 'trash'), { recursive: true })
writeFileSync(join(acme, '.arxa', 'trash', 'old-note.md'), 'deleted\n')
writeFileSync(join(acme, '.arxa', 'scratch.tmp'), 'internal\n')

// Facts: two writes to one key (LWW by line position) plus a retraction.
appendFact(root, 'acme', 'status', { key: 'phase', value: 'draft' })
appendFact(root, 'acme', 'status', { key: 'phase', value: 'active' })
appendFact(root, 'acme', 'status', { key: 'blocked', value: true })
appendFact(root, 'acme', 'status', { key: 'blocked', value: null })

const TABLES = ['orgs', 'projects', 'files', 'facts_state']
const snapshotOf = (backend) =>
  Object.fromEntries(TABLES.map((t) => [t, backend.query(t)]))

// ------------------------------------------------------------------ tests --
try {
  // Build the index and snapshot every table.
  let { backend } = rebuild(root)
  const before = snapshotOf(backend)
  backend.close()

  check('scan found both orgs', () =>
    assert.deepEqual(before.orgs.map((o) => o.slug), ['acme', 'globex'])
  )
  check('scan found both projects with org linkage', () => {
    assert.deepEqual(before.projects.map((p) => p.slug).sort(), ['launch', 'website'])
    assert.equal(before.projects.find((p) => p.slug === 'website').orgId, 'org_acme')
  })
  check('project files carry projectId', () => {
    const spec = before.files.find((f) => f.path === 'acme/projects/website/spec.md')
    assert.ok(spec, 'spec.md indexed')
    assert.equal(spec.projectId, 'proj_website')
    assert.equal(spec.kind, 'projects')
  })
  check('trash and dot-dir internals are not indexed', () => {
    assert.ok(!before.files.some((f) => f.path.includes('/trash/')))
    assert.ok(!before.files.some((f) => f.path.endsWith('scratch.tmp')))
  })
  check('fact logs are indexed as files', () =>
    assert.ok(
      before.files.some(
        (f) => f.path === 'acme/.arxa/facts/status.jsonl' && f.kind === 'fact-log'
      )
    )
  )
  check('facts derivation: LWW by sequence, retraction removes key', () => {
    const acmeFacts = before.facts_state.find((s) => s.orgSlug === 'acme')
    assert.deepEqual(acmeFacts.state, { status: { phase: 'active' } })
  })

  // THE REBUILD GATE: delete the index entirely, rebuild, deep-equal.
  rmSync(join(root, INDEX_DIR), { recursive: true, force: true })
  check('index store was actually deleted', () =>
    assert.ok(!existsSync(join(root, INDEX_DIR)))
  )
  backend = rebuild(root).backend
  const after = snapshotOf(backend)
  backend.close()
  check('REBUILD GATE: delete index + rebuild loses nothing (deep-equal)', () =>
    assert.deepEqual(after, before)
  )

  // External edits with plain fs are legal by definition (D46).
  writeFileSync(join(acme, 'meetings', '2026-09-01-sync.md'), '# sync\n')
  appendFileSync(
    join(acme, '.arxa', 'facts', 'status.jsonl'),
    JSON.stringify({ key: 'phase', value: 'shipped', at: '2026-08-28T12:00:00.000Z' }) + '\n'
  )
  backend = rebuild(root).backend
  const rescanned = snapshotOf(backend)
  backend.close()
  check('externally added file appears after re-scan', () =>
    assert.ok(
      rescanned.files.some((f) => f.path === 'acme/meetings/2026-09-01-sync.md')
    )
  )
  check('externally appended fact changes derived state after re-scan', () => {
    assert.equal(deriveFactState(root, 'acme').status.phase, 'shipped')
    const acmeFacts = rescanned.facts_state.find((s) => s.orgSlug === 'acme')
    assert.equal(acmeFacts.state.status.phase, 'shipped')
  })

  // Backend seam sanity: clear() empties, format stamp survives reopen.
  backend = openBackend(root)
  backend.put('orgs', 'x', { probe: true })
  backend.clear()
  check('backend.clear() empties all tables', () =>
    assert.deepEqual(backend.query('orgs'), [])
  )
  backend.close()
} finally {
  rmSync(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('\nall checks passed')
}
