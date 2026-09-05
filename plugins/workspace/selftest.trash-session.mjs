/**
 * workspace trash — session entries (2026-09-05 grill). Orgs/projects are
 * physical folder moves; a session is a LOGICAL entry (its body is a
 * registry row plus a parked branch, neither of which can move into a
 * directory). Checks: manifest-only shape with the kind discriminator,
 * slash-safe entry ids (pre-2026-09-03 path-shaped session ids), listTrash
 * visibility, and the outside-org refusal.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { softDeleteSession, listTrash, SESSION_TRASH_KIND, TrashError } from './lib/index.js'

let passed = 0
function ok(cond, label) {
  assert.ok(cond, label)
  passed++
  console.log(`  ✓ ${label}`)
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-trash-session-'))

try {
  const org = path.join(root, 'acme')
  const proj = path.join(org, 'projects', 'rocket')
  fs.mkdirSync(proj, { recursive: true })

  const row = { id: 's-xyz', name: 'note-002', branch: 'arxa/acme/notes/note-002', state: 'archived', workspace: 'notes', dshSessionId: 'dsh-7' }

  // Entry shape: manifest-only, kind-discriminated, project repo recorded.
  const entry = softDeleteSession(org, { repoPath: proj, session: row })
  const origin = JSON.parse(fs.readFileSync(path.join(entry.entryPath, 'origin.json'), 'utf8'))
  ok(origin.kind === SESSION_TRASH_KIND && SESSION_TRASH_KIND === 'session', 'origin carries the session kind discriminator')
  ok(origin.sessionId === row.id && origin.name === row.name && origin.branch === row.branch && origin.dshSessionId === row.dshSessionId, 'origin snapshots the session identity fields')
  ok(origin.repoPath === path.join('projects', 'rocket'), 'origin records the owning project repo (org-relative)')
  ok(origin.deletedAt != null && /^\d{4}-\d{2}-\d{2}T/.test(origin.deletedAt), 'origin stamps the deletion time')
  ok(!fs.existsSync(path.join(entry.entryPath, row.id)) && fs.readdirSync(entry.entryPath).length === 1, 'manifest-only entry — NO payload move (a session has no folder)')

  // Org-root session: repoPath '.' (the owning repo IS the org).
  const orgEntry = softDeleteSession(org, { repoPath: org, session: { id: 's-org', name: 'org note', branch: 'arxa/acme/notes/org-note', state: 'archived' } })
  const orgOrigin = JSON.parse(fs.readFileSync(path.join(orgEntry.entryPath, 'origin.json'), 'utf8'))
  ok(orgOrigin.repoPath === '.', 'org-root session records repoPath "."')

  // listTrash lists BOTH kinds; session entries surface their origin.
  const listed = listTrash(org)
  ok(listed.length === 2 && listed.every((e) => e.origin?.kind === 'session'), 'listTrash serves session entries with origins')

  // Slash-shaped legacy ids do not nest the entry directory.
  const slash = softDeleteSession(org, { repoPath: org, session: { id: '2026-08-30/foo-001', name: 'old', branch: 'arxa/x', state: 'archived' } })
  ok(!slash.entryId.includes('/') && fs.statSync(slash.entryPath).isDirectory(), 'path-shaped session id flattens to a leaf entryId (no nested dirs)')
  ok(JSON.parse(fs.readFileSync(path.join(slash.entryPath, 'origin.json'), 'utf8')).sessionId === '2026-08-30/foo-001', '…but the origin keeps the FULL slash id (restore keys on it)')

  // Collisions on the same leaf take numeric suffixes (softDelete parity).
  const twin = softDeleteSession(org, { repoPath: org, session: { id: '2026-08-30/foo-001', name: 'old again', branch: 'arxa/y', state: 'archived' } })
  ok(twin.entryId !== slash.entryId && fs.existsSync(twin.entryPath), 'same-leaf collision suffixes, both entries survive')

  // Refusals: outside the org; missing row shape.
  assert.throws(() => softDeleteSession(org, { repoPath: root, session: row }), TrashError)
  ok(true, 'a repo outside the org root is refused')
  assert.throws(() => softDeleteSession(org, { repoPath: org, session: { id: '' } }), TrashError)
  ok(true, 'a session without an id is refused')

  console.log(`workspace trash-session selftest: ${passed} checks green`)
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
