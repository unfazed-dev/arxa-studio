#!/usr/bin/env node
/**
 * file-org-shell selftest — D98/D99 session→repo routing through the real
 * lifecycle composition (no stubs: a real org, a real project repo, real
 * worktrees).
 *
 * The discriminating assertion: `newSession(name, 'projects/<slug>/…')`
 * produces a worktree whose `git rev-parse --git-common-dir` is the PROJECT's
 * .git. Before routing, lifecycle always handed `openSession` the org path, so
 * project work accumulated in org history and the project repo never saw it
 * (bug B2). The rest covers the refusals, the aggregate faces, and the
 * id-keyed round trip (resume / rename / archive) for a project session.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createOrgLifecycle } from './lib/index.js'
import { runGit, listSessions, parkedSessions, RoutingRefusedError } from '../git-workspace/lib/index.js'

let passed = 0
function ok(cond, label) {
  assert.ok(cond, label)
  passed++
  console.log(`  ✓ ${label}`)
}

async function throwsAsync(fn, check, label) {
  try {
    await fn()
  } catch (err) {
    check(err)
    passed++
    console.log(`  ✓ ${label}`)
    return err
  }
  assert.fail(`${label}: expected a throw`)
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-fos-routing-'))
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-fos-routing-home-'))
// ARXA_HOME redirected: opening an org writes recents (D69) — never the
// operator's real home.
const env = { ...process.env, ARXA_HOME: fakeHome }

const commonDir = (dir) => fs.realpathSync(
  path.resolve(dir, runGit(['rev-parse', '--git-common-dir'], { cwd: dir, env })),
)

try {
  console.log('\nD98/D99 — session→repo routing through the lifecycle:')

  const svc = createOrgLifecycle({ workspaceRoot: root, env })
  const org = svc.createOrg('Routing Org')
  await svc.openOrg(org.path)
  const h = svc.current

  const proj = await h.newProject('alpha')
  const proj2 = await h.newProject('beta')
  ok(fs.existsSync(path.join(proj.path, '.git')), 'fixture: newProject attaches its own repo')

  // ---- (f) newSession for a project workspace -----------------------------

  const ps = await h.newSession('design-001', 'projects/alpha/02-design')
  ok(ps.workspace === 'projects/alpha/02-design' && ps.project === 'alpha', 'project session keeps its workspace + project scope')
  ok(
    commonDir(ps.worktree) === fs.realpathSync(path.join(proj.path, '.git')),
    'B2 FIXED: a project session worktree belongs to the PROJECT repo',
  )
  ok(
    commonDir(ps.worktree) !== fs.realpathSync(path.join(org.path, '.git')),
    'B2 FIXED: it is NOT the org repo (the old silent fallback)',
  )
  ok(
    ps.worktree.startsWith(fs.realpathSync(proj.path)) || ps.worktree.startsWith(proj.path),
    'the worktree directory itself lives under the project',
  )

  // The registry is repo-local (D38): the row lands in the project's registry.
  ok(
    listSessions(proj.path, env).some((s) => s.id === ps.id),
    'the row lands in the PROJECT registry (repo-local state, D38)',
  )
  ok(
    !listSessions(org.path, env).some((s) => s.id === ps.id),
    'the org registry does not carry the project session row',
  )

  // ---- org-scoped is unchanged -------------------------------------------

  const os1 = await h.newSession('note-001', 'notes')
  ok(
    commonDir(os1.worktree) === fs.realpathSync(path.join(org.path, '.git')),
    'an org-scoped session still lands in the ORG repo',
  )
  ok(listSessions(org.path, env).some((s) => s.id === os1.id), 'the org row stays in the org registry')

  // ---- refusals ------------------------------------------------------------

  await throwsAsync(
    () => h.newSession('nope', 'account/invoices'),
    (e) => assert.match(String(e.message), /account|unknown-workspace/),
    'account/** never gets a session (D37 — billing artefacts stay out of git)',
  )
  await throwsAsync(
    () => h.newSession('nope', 'dropbox/x'),
    (e) => assert.match(String(e.message), /unknown-workspace|unknown-dock/),
    'an unknown dock refuses loudly — never a silent org fallback (that IS B2)',
  )
  await throwsAsync(
    () => h.newSession('nope', 'projects/ghost/02-design'),
    (e) => assert.match(String(e.message), /unknown-workspace|unknown-dock/),
    'a project that does not exist refuses',
  )

  // ---- no HEAD: routing refuses instead of letting worktree add fail raw ---

  {
    const bare = path.join(org.path, 'projects', 'headless')
    fs.mkdirSync(bare, { recursive: true })
    fs.writeFileSync(path.join(bare, 'project.json'), JSON.stringify({ id: 'p-headless', slug: 'headless', name: 'headless', orgId: 'x' }) + '\n')
    // A project directory with no repo at all is the fresh-project state the
    // plan calls out: the first snapshot has not landed.
    const mod = await import('../git-workspace/lib/routing.js')
    let caught = null
    try { mod.resolveSessionRepo(org.path, 'projects/headless/02-design', { env }) } catch (e) { caught = e }
    ok(caught instanceof RoutingRefusedError && caught.reason === 'no-head', 'a project without HEAD refuses with reason "no-head"')
    ok(
      caught.message === mod.INITIAL_SNAPSHOT_PENDING
      && caught.message.startsWith('initial-snapshot-pending')
      && caught.message === 'initial-snapshot-pending: the first git snapshot of this organisation is still running — sessions unlock the moment it completes',
      'the refusal is the exact initial-snapshot-pending message the rows client keys on',
    )
    fs.rmSync(bare, { recursive: true, force: true })
  }

  // ---- (e) aggregation across registries ----------------------------------

  // The auto-name counter reads the OWNING repo's registry (D98). The org
  // already holds `note-001` (os1 above); alpha's own `notes` container must
  // still start at note-001, and advance within alpha alone. Drawing the
  // counter from the org registry — the pre-D98 behaviour — would have made
  // alpha's first note-002 and let two projects share one namespace.
  // (Containers whose folder starts with a digit, e.g. `02-design`, never
  //  advance the counter at all: nextSessionName's prefix regex requires a
  //  leading letter. Pre-existing, unrelated to routing — noted, not fixed.)
  const aAuto1 = await h.newSession(undefined, 'projects/alpha/notes')
  const aAuto2 = await h.newSession(undefined, 'projects/alpha/notes')
  const ps2 = await h.newSession(undefined, 'projects/beta/notes')
  ok(
    aAuto1.name === 'note-001' && aAuto2.name === 'note-002',
    `alpha's counter starts fresh and advances within its own repo (${aAuto1.name}, ${aAuto2.name})`,
  )
  ok(ps2.name === 'note-001', `the counter is per-repo: beta's first is its own note-001 (${ps2.name})`)
  ok(
    commonDir(ps2.worktree) === fs.realpathSync(path.join(proj2.path, '.git')),
    'the second project session lands in the second project repo',
  )

  const all = parkedSessions(org.path, env)
  const ids = all.map((s) => s.id)
  ok(new Set(ids).size === ids.length, 'session ids stay globally unique across registries')
  ok(
    [ps.id, ps2.id, os1.id].every((id) => ids.includes(id)),
    'parkedSessions aggregates org + every project registry',
  )
  ok(all.find((s) => s.id === ps.id).origin === 'project', 'rows are tagged with their origin repo')

  const active = h.activeSessions().map((s) => s.id)
  ok(
    [ps.id, ps2.id, os1.id].every((id) => active.includes(id)),
    'the activeSessions face shows project sessions (it read only the org registry before)',
  )

  // ---- id-keyed round trip through the ORG handle -------------------------

  const renamed = await h.renameSession(ps.id, 'renamed design')
  ok(renamed.name === 'renamed design', 'renameSession resolves a project session id from the org handle')
  ok(
    listSessions(proj.path, env).find((s) => s.id === ps.id).name === 'renamed design',
    'the rename persisted in the PROJECT registry',
  )

  fs.writeFileSync(path.join(ps.worktree, 'work.md'), 'project work\n')
  runGit(['add', '-A'], { cwd: ps.worktree, env })
  runGit(['commit', '-m', 'feat(alpha): work inside the session'], { cwd: ps.worktree, env })
  ok(
    /feat\(alpha\): work inside the session/.test(runGit(['log', '--all', '--oneline'], { cwd: proj.path, env })),
    'a file edited in the session worktree is committed to PROJECT history',
  )
  ok(
    !/feat\(alpha\): work inside the session/.test(runGit(['log', '--all', '--oneline'], { cwd: org.path, env })),
    'org history never saw it',
  )

  const archived = await h.archiveSession(ps.id)
  ok(archived.state === 'archived', 'archiveSession routes to the project repo')
  ok(!fs.existsSync(ps.worktree), 'the project worktree was pruned')
  const resumed = await h.resumeSession(ps.id)
  ok(resumed.state === 'open', 'resumeSession revives a project session from the org handle')
  ok(
    commonDir(resumed.worktree) === fs.realpathSync(path.join(proj.path, '.git')),
    'the revived worktree is still attached to the PROJECT repo (survives archive)',
  )
  ok(
    fs.existsSync(path.join(resumed.worktree, 'work.md')),
    'the work survived archive→revive inside the project repo',
  )

  await throwsAsync(
    () => h.renameSession('s-not-a-real-id', 'x'),
    (e) => assert.match(String(e.message), /unknown-session/),
    'an unknown id still fails loudly after aggregation',
  )

  svc.closeOrg()
  console.log(`\nselftest.routing: ${passed}/${passed} passed`)
} finally {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(fakeHome, { recursive: true, force: true })
}
