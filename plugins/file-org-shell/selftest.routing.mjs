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
import { runGit, listSessions, parkedSessions, RoutingRefusedError, sessionLeaf } from '../git-workspace/lib/index.js'

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
    ps.worktree === path.join(org.path, '.arxa', 'worktrees', ps.id) ||
      ps.worktree === path.join(fs.realpathSync(org.path), '.arxa', 'worktrees', ps.id),
    "the worktree directory itself lives under the ORG's .arxa/worktrees root, at the identity path — only the branch and registry stay in the project repo (Q2/D72 path-identity rewrite)",
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
  // Q2 (2026-09-03): the counter now lives on the minted ID
  // (`note-wt-<YYMMDD>-<NNN>`), scoped per workspace PER DAY. Per-repo
  // isolation is unchanged and is what this case exists to prove.
  // (The old `02-design` quirk — a digit-leading folder never advancing the
  //  counter, because nextSessionName's prefix regex demanded a leading
  //  letter — does NOT carry over: nextSessionId matches the full base
  //  verbatim, so digit-leading containers count correctly now.)
  const ymd = (d = new Date()) =>
    String(d.getFullYear() % 100).padStart(2, '0') +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0')
  const aAuto1 = await h.newSession(undefined, 'projects/alpha/notes')
  const aAuto2 = await h.newSession(undefined, 'projects/alpha/notes')
  const ps2 = await h.newSession(undefined, 'projects/beta/notes')
  const seq = (id) => Number(/-(\d+)$/.exec(id)[1])
  // Q2 (2026-09-03): the id is now the full `<org>/<workspace>/<leaf>` disk
  // path, not a bare leaf — check the leaf shape and the container prefix
  // (org folder + workspace string) separately.
  const leafOk = (id) => new RegExp(`^note-wt-${ymd()}-\\d{3}$`).test(sessionLeaf(id))
  ok(
    aAuto1.id.startsWith(`${org.slug}/projects/alpha/notes/`) &&
      aAuto2.id.startsWith(`${org.slug}/projects/alpha/notes/`) &&
      leafOk(aAuto1.id) && leafOk(aAuto2.id) &&
      seq(aAuto2.id) === seq(aAuto1.id) + 1,
    `alpha's two sessions ascend consecutively within its own container (${aAuto1.id}, ${aAuto2.id})`,
  )
  // D98's per-repo counters are superseded by Q2/Q3's per-CONTAINER counter,
  // not by a shared global one: mintSessionPath anchors its counter regex to
  // `<org>/<workspace>` (sessions.js dir/base), so beta's `notes` container
  // counts on its own, independent of alpha's. Global uniqueness no longer
  // needs a shared numeric namespace at all — the full `<org>/<workspace>/`
  // prefix baked into every id makes two containers' ids structurally
  // distinct even when both restart at -001. That is the deliberate payoff
  // of readable, path-shaped ids: beta's first session DOES restart at -001.
  // (parkedSessions below still proves global uniqueness, via the aggregate.)
  ok(
    ps2.id.startsWith(`${org.slug}/projects/beta/notes/`) && leafOk(ps2.id) && seq(ps2.id) === 1,
    `beta's own container starts its own count at -001, independent of alpha's (${ps2.id})`,
  )
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
