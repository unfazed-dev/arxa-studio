#!/usr/bin/env node
// Selftest for D98/D99 session→repo routing (arxa-git-workspace side).
//
// The discriminating assertion is (b): a project-scoped session's worktree
// reports the PROJECT's .git as its common dir. Before routing, `openSession`
// was always handed the org path, so that check returned the org's .git and
// project history never saw session work — bug B2. Everything else here is
// table coverage and the aggregation contract.
//
//  (a) table: every dock routes, account/ and unknown docks REFUSE
//  (b) a project-scoped session's worktree lives in the project repo
//  (c) an org-scoped session still lives in the org repo
//  (d) a project without HEAD refuses with the exact pending message
//  (e) parkedSessions aggregates across repos with distinct ids
//  (f) id-keyed faces find a project session through the ORG path
//
// Throwaway temp workspace; nothing machine-global is touched.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  DOCK_ROUTES, ROUTING_REASONS, INITIAL_SNAPSHOT_PENDING,
  RoutingRefusedError, routeDock, resolveSessionRepo, projectRepos,
  initOrgRepo, initProjectRepo, runGit,
  openSession, listSessions, parkedSessions, sessionRepoFor,
  annotateSession, archiveSession, reviveSession,
} from './lib/index.js'

let passed = 0
function ok(label, fn) {
  fn()
  passed += 1
  console.log(`ok ${passed} - ${label}`)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-routing-selftest-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

const commonDir = (dir) => fs.realpathSync(
  path.resolve(dir, runGit(['rev-parse', '--git-common-dir'], { cwd: dir })),
)

// ---- (a) the table ---------------------------------------------------------

ok('table: every dock in DOCK_ROUTES has a kind, and the set is the D99 list', () => {
  assert.deepEqual(
    DOCK_ROUTES.map((r) => r.dock).sort(),
    ['account', 'communications', 'meetings', 'notes', 'projects'],
  )
  assert.deepEqual([...ROUTING_REASONS], ['account', 'unknown-dock', 'no-head'])
})

ok('table: notes/meetings/communications route to the org repo', () => {
  for (const ws of ['notes', 'meetings/scheduler', 'communications/inbox', 'notes/deep/nested']) {
    const r = routeDock(ws)
    assert.equal(r.kind, 'org', ws)
    assert.equal(r.slug, null)
  }
})

ok('table: projects/<slug>/** routes to the project, slug preserved (D79 case)', () => {
  const r = routeDock('projects/POLO/00-moodboard')
  assert.equal(r.kind, 'project')
  assert.equal(r.slug, 'POLO')
})

ok('table: account/** REFUSES with reason "account"', () => {
  assert.throws(
    () => routeDock('account/invoices'),
    (e) => e instanceof RoutingRefusedError && e.reason === 'account' && /D37/.test(e.message),
  )
  assert.throws(() => routeDock('account'), (e) => e.reason === 'account')
})

ok('table: an unknown dock REFUSES — never a silent org fallback (that IS B2)', () => {
  for (const ws of ['dropbox', 'dropbox/x', '', '   ', 'projects']) {
    assert.throws(
      () => routeDock(ws),
      (e) => e instanceof RoutingRefusedError && e.reason === 'unknown-dock',
      `expected refusal for ${JSON.stringify(ws)}`,
    )
  }
})

// ---- fixture: one org, two project repos -----------------------------------

const org = path.join(tmp, 'ORG')
fs.mkdirSync(path.join(org, 'notes'), { recursive: true })
fs.writeFileSync(path.join(org, 'org.json'), '{"id":"o1","slug":"ORG"}\n')
fs.writeFileSync(path.join(org, 'notes', 'seed.md'), 'seed\n')
initOrgRepo(org)

const mkProject = (slug) => {
  const p = path.join(org, 'projects', slug)
  fs.mkdirSync(p, { recursive: true })
  fs.writeFileSync(path.join(p, 'project.json'), `{"id":"p-${slug}","slug":"${slug}"}\n`)
  fs.writeFileSync(path.join(p, '.gitignore'), 'node_modules/\n')
  initProjectRepo(p)
  return p
}
const alpha = mkProject('alpha')
const beta = mkProject('beta')

ok('projectRepos discovers every nested project repo, slug-ordered', () => {
  assert.deepEqual(projectRepos(org).map((p) => p.slug), ['alpha', 'beta'])
})

ok('resolveSessionRepo returns a WORKING DIR (runGit cwd), not a .git path', () => {
  const r = resolveSessionRepo(org, 'projects/alpha/design')
  assert.equal(r.repoPath, alpha)
  assert.equal(r.kind, 'project')
  assert.equal(r.slug, 'alpha')
  assert.equal(fs.existsSync(path.join(r.repoPath, '.git')), true)
  assert.deepEqual(resolveSessionRepo(org, 'notes'), { repoPath: org, kind: 'org' })
})

ok('resolveSessionRepo refuses a project that does not exist', () => {
  assert.throws(
    () => resolveSessionRepo(org, 'projects/ghost/design'),
    (e) => e instanceof RoutingRefusedError && e.reason === 'unknown-dock',
  )
})

// ---- (b) the discriminator -------------------------------------------------

const projSession = openSession(alpha, {
  id: 'ORG/projects/alpha/design/design-001',
  name: 'design-001', project: 'alpha', workspace: 'projects/alpha/design',
})

ok('(b) a project-scoped session worktree resolves to the PROJECT .git — B2 fixed', () => {
  assert.equal(commonDir(projSession.worktree), fs.realpathSync(path.join(alpha, '.git')))
  assert.notEqual(commonDir(projSession.worktree), fs.realpathSync(path.join(org, '.git')))
})

ok('(b) a multi-segment session id nests the full path under `.arxa/worktrees`, not just the leaf', () => {
  assert.equal(
    projSession.worktree,
    path.join(alpha, '.arxa', 'worktrees', ...projSession.id.split('/')),
  )
  assert.ok(
    fs.existsSync(path.join(alpha, '.arxa', 'worktrees', 'ORG', 'projects', 'alpha', 'design')),
    'intermediate path segments were created, not just the leaf directory',
  )
})

ok('(b) the project session commit lands in PROJECT history, not org history', () => {
  fs.writeFileSync(path.join(projSession.worktree, 'work.md'), 'project work\n')
  runGit(['add', '-A'], { cwd: projSession.worktree })
  runGit(['commit', '-m', 'feat(alpha): session work'], { cwd: projSession.worktree })
  const inProject = runGit(['log', '--all', '--oneline'], { cwd: alpha })
  const inOrg = runGit(['log', '--all', '--oneline'], { cwd: org })
  assert.match(inProject, /feat\(alpha\): session work/)
  assert.doesNotMatch(inOrg, /feat\(alpha\): session work/)
})

// ---- (c) org-scoped is unchanged -------------------------------------------

const orgSession = openSession(org, { id: 'ORG/notes/note-001', name: 'note-001', project: null, workspace: 'notes' })

ok('(c) an org-scoped session still resolves to the ORG .git', () => {
  assert.equal(commonDir(orgSession.worktree), fs.realpathSync(path.join(org, '.git')))
})

// ---- (d) no HEAD -----------------------------------------------------------

ok('(d) a project directory with no repo/HEAD refuses with the pending message', () => {
  const fresh = path.join(org, 'projects', 'fresh')
  fs.mkdirSync(fresh, { recursive: true })
  fs.writeFileSync(path.join(fresh, 'project.json'), '{"id":"p-fresh","slug":"fresh"}\n')
  assert.throws(
    () => resolveSessionRepo(org, 'projects/fresh/design'),
    (e) => e instanceof RoutingRefusedError
      && e.reason === 'no-head'
      && e.message === INITIAL_SNAPSHOT_PENDING,
  )
  // ...and the raw `git worktree add` never got a chance to fail on its own.
  assert.equal(INITIAL_SNAPSHOT_PENDING.startsWith('initial-snapshot-pending'), true)
  // requireHead:false is the pure-table escape hatch, still routing correctly.
  assert.equal(
    resolveSessionRepo(org, 'projects/fresh/design', { requireHead: false }).repoPath,
    fresh,
  )
  fs.rmSync(fresh, { recursive: true, force: true })
})

// ---- (e) aggregation -------------------------------------------------------

const betaSession = openSession(beta, {
  id: 'ORG/projects/beta/design/design-001',
  name: 'design-001', project: 'beta', workspace: 'projects/beta/design',
})

ok('(e) parkedSessions aggregates org + every project registry', () => {
  const all = parkedSessions(org)
  const ids = all.map((s) => s.id)
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique across registries')
  assert.equal(ids.length, 3)
  for (const id of [orgSession.id, projSession.id, betaSession.id]) {
    assert.equal(ids.includes(id), true, `missing ${id}`)
  }
  const byId = Object.fromEntries(all.map((s) => [s.id, s]))
  assert.equal(byId[orgSession.id].origin, 'org')
  assert.equal(byId[orgSession.id].repoPath, org)
  assert.equal(byId[projSession.id].origin, 'project')
  assert.equal(byId[projSession.id].repoPath, alpha)
  assert.equal(byId[betaSession.id].projectSlug, 'beta')
  // The org registry alone never saw the project rows — that was the bug.
  assert.equal(listSessions(org).length, 1)
})

ok('(e) two projects each mint their own design-001 without colliding', () => {
  assert.equal(projSession.name, betaSession.name)
  assert.notEqual(projSession.id, betaSession.id)
  assert.notEqual(projSession.branch, betaSession.branch)
})

// ---- (f) id-keyed faces reach through the org path --------------------------

ok('(f) sessionRepoFor finds a project session given only the ORG path', () => {
  assert.equal(sessionRepoFor(org, projSession.id), alpha)
  assert.equal(sessionRepoFor(org, betaSession.id), beta)
  assert.equal(sessionRepoFor(org, orgSession.id), org)
  // Unknown id falls back unchanged so callers raise their usual error.
  assert.equal(sessionRepoFor(org, 's-nope-nope'), org)
})

ok('(f) annotate/archive/revive route a project session from the org path', () => {
  const annotated = annotateSession(org, projSession.id, { dshSessionId: 'dsh-1' })
  assert.equal(annotated.dshSessionId, 'dsh-1')
  assert.equal(listSessions(alpha).find((s) => s.id === projSession.id).dshSessionId, 'dsh-1')
  assert.equal(listSessions(org).some((s) => s.id === projSession.id), false)

  assert.equal(archiveSession(org, projSession.id).state, 'archived')
  assert.equal(fs.existsSync(projSession.worktree), false)
  assert.equal(reviveSession(org, projSession.id).state, 'open')
  assert.equal(commonDir(projSession.worktree), fs.realpathSync(path.join(alpha, '.git')))
})

ok('(f) an unknown id still throws the original error text', () => {
  assert.throws(() => annotateSession(org, 's-does-not-exist', { x: 1 }), /unknown session "s-does-not-exist"/)
})

// ---- pressure: 20 sessions across 3 project repos + org --------------------

ok('pressure: 20 sessions across 4 repos aggregate with unique ids in <2s', () => {
  const proot = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-routing-pressure-'))
  try {
    const o = path.join(proot, 'ORG')
    fs.mkdirSync(path.join(o, 'notes'), { recursive: true })
    fs.writeFileSync(path.join(o, 'org.json'), '{"id":"o2","slug":"ORG"}\n')
    fs.writeFileSync(path.join(o, 'notes', 'seed.md'), 'seed\n')
    initOrgRepo(o)
    const repos = [{ repoPath: o, ws: 'notes', slug: null }]
    for (const slug of ['p1', 'p2', 'p3']) {
      const p = path.join(o, 'projects', slug)
      fs.mkdirSync(p, { recursive: true })
      fs.writeFileSync(path.join(p, 'project.json'), `{"id":"x-${slug}","slug":"${slug}"}\n`)
      initProjectRepo(p)
      repos.push({ repoPath: p, ws: `projects/${slug}/design`, slug })
    }
    for (let i = 0; i < 20; i++) {
      const r = repos[i % repos.length]
      const route = resolveSessionRepo(o, r.ws)
      assert.equal(route.repoPath, r.repoPath)
      openSession(route.repoPath, { id: `ORG/${r.ws}/s${i}`, name: `s${i}`, project: r.slug, workspace: r.ws })
    }
    const t0 = process.hrtime.bigint()
    const all = parkedSessions(o)
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    assert.equal(all.length, 20, `expected 20 rows, got ${all.length}`)
    assert.equal(new Set(all.map((s) => s.id)).size, 20, 'ids must be globally unique')
    assert.equal(ms < 2000, true, `parkedSessions took ${ms.toFixed(1)}ms (budget 2000ms)`)
    console.log(`   (aggregated 20 sessions across 4 repos in ${ms.toFixed(1)}ms)`)
  } finally {
    fs.rmSync(proot, { recursive: true, force: true })
  }
})

console.log(`\nselftest.routing: ${passed}/${passed} passed`)
