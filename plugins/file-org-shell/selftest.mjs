/**
 * file-org-shell selftest — real end-to-end lifecycle checks against a temp
 * fixture workspace. Every check EXECUTES the composition (no import-only
 * checks): open → index queryable → git rail attached → clean close;
 * re-open; crash-safety (stale lock takeover + interrupted-migration rewind,
 * proving the composition reaches the libraries' recovery); org-switch
 * teardown (no leftover locks / live handles); optional-rails-absent; and
 * partial-open unwind when a configured rail refuses.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import {
  createOrgLifecycle,
  createDshBridge,
  joinDshLive,
  shellLockPath,
  OrgOpenError,
  OrgAlreadyOpenError,
  OrgNotOpenError,
  ShellLockError,
} from './lib/index.js'
import { openBackend } from '../workspace-index/lib/index.js'
import { readOrgStampVersion, softDelete, listRecents } from '../workspace/lib/index.js'
import { runGit, isRepo, listSessions } from '../git-workspace/lib/index.js'
import { createLocalProvider } from '../account-mirror/lib/index.js'
import { railDir } from '../cairn-rail/lib/index.js'
import { MIRROR_MANIFEST, ACCOUNT_DIR } from '../account-mirror/lib/index.js'

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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-file-org-shell-'))
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-file-org-shell-home-'))
// ARXA_HOME redirected: opening an org touches ~/.arxa/organisation.json
// recents (D69) — the selftest must never write the operator's real home.
const env = { ...process.env, ARXA_HOME: fakeHome }

try {
  // ---- fixture ------------------------------------------------------------
  const svc = createOrgLifecycle({ workspaceRoot: root, env })
  const orgA = svc.createOrg('Acme Corp')
  ok(fs.existsSync(path.join(orgA.path, 'org.json')), 'fixture org scaffolded via workspace API')
  ok(svc.listOrgs().some((o) => o.slug === orgA.slug), 'boot discovery lists the org, none auto-opened')
  ok(svc.current === null, 'boot opens nothing')

  // ---- open: full rail ----------------------------------------------------
  console.log('open → index → git → sessions:')
  const h1 = await svc.openOrg(orgA.path)
  ok(h1.manifest?.name === 'Acme Corp', 'open returns the org manifest')
  ok(fs.existsSync(shellLockPath(orgA.path, orgA.slug)), 'shell lock held while open (at <org>/.arxa/locks)')
  ok(h1.index.backend.query('orgs').some((o) => o.slug === orgA.slug), 'index queryable and contains the org')
  ok(h1.index.rebuilt && h1.index.counts.orgs >= 1, 'missing index was rebuilt on first open')
  ok(isRepo(orgA.path, env) && h1.repoInitialised, 'git rail attached (org repo initialised)')
  ok(Array.isArray(h1.sessions) && h1.sessions.length === 0, 'session registry ready and empty')
  ok(h1.rails.account.attached === false, 'account-mirror absent by default (normal state)')
  ok(h1.rails.cairn.attached === false, 'cairn-rail absent by default (normal state)')
  ok(!fs.existsSync(path.join(orgA.path, ACCOUNT_DIR, MIRROR_MANIFEST)), 'no mirror manifest written when unconfigured')
  ok(!fs.existsSync(railDir(orgA.path, orgA.slug)), 'no rail state created when unconfigured')
  // D69 per-org state home: everything stateful lives under <org>/.arxa.
  ok(fs.existsSync(path.join(orgA.path, '.arxa', 'index.db')), 'index db resolved at <org>/.arxa/index.db')
  ok(!fs.existsSync(path.join(root, '.arxa')), 'no studio state leaks to the parent folder')
  ok(listRecents(env)[0] === orgA.path, 'opening an org touches the recents (most-recent-first)')

  await throwsAsync(
    () => svc.openOrg(orgA.path),
    (e) => assert.ok(e instanceof OrgAlreadyOpenError),
    'second open refused with OrgAlreadyOpenError'
  )

  // ---- clean close --------------------------------------------------------
  console.log('clean close:')
  const backend1 = h1.index.backend
  svc.closeOrg()
  ok(svc.current === null, 'close clears the current handle')
  ok(!fs.existsSync(shellLockPath(orgA.path, orgA.slug)), 'shell lock released on close')
  assert.throws(() => backend1.query('orgs'), undefined, 'backend closed')
  passed++
  console.log('  ✓ index backend closed on close')
  assert.throws(() => svc.closeOrg(), (e) => e instanceof OrgNotOpenError)
  passed++
  console.log('  ✓ double close refused with OrgNotOpenError')

  // ---- re-open ------------------------------------------------------------
  console.log('re-open:')
  const h2 = await svc.openOrg(orgA.path)
  ok(h2.repoInitialised === false, 're-open attaches the existing repo (idempotent)')
  ok(h2.index.backend.query('orgs').some((o) => o.slug === orgA.slug), 'index still queryable after re-open')
  svc.closeOrg()

  // ---- crash safety: stale shell lock (dead pid) --------------------------
  console.log('crash safety — interrupted open:')
  const dead = spawnSync(process.execPath, ['-e', ''])
  const lockFile = shellLockPath(orgA.path, orgA.slug)
  fs.mkdirSync(path.dirname(lockFile), { recursive: true })
  fs.writeFileSync(lockFile, JSON.stringify({ pid: dead.pid, startedAt: new Date().toISOString() }))
  const h3 = await svc.openOrg(orgA.path)
  ok(h3.slug === orgA.slug, 'dead-holder shell lock recovered, open succeeds')
  svc.closeOrg()

  // live foreign holder must refuse loudly (fail-loud, never silent)
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.ppid, startedAt: new Date().toISOString() }))
  await throwsAsync(
    () => svc.openOrg(orgA.path),
    (e) => {
      assert.ok(e instanceof OrgOpenError && e.step === 'shell-lock')
      assert.ok(e.cause instanceof ShellLockError)
    },
    'live-holder lock refuses with typed OrgOpenError(shell-lock)'
  )
  fs.unlinkSync(lockFile)

  // ---- crash safety: dangling migration rewound on open -------------------
  // Simulate a migration run that died between its pre and post commits:
  // HEAD at a pre marker with half-applied debris uncommitted. The library
  // provides the rewind (stash + reset); this proves openOrg REACHES it.
  const keeper = path.join(orgA.path, 'notes', 'keep.md')
  fs.writeFileSync(keeper, 'committed truth\n')
  runGit(['add', '-A'], { cwd: orgA.path, env })
  runGit(['commit', '-m', 'stage: keep file'], { cwd: orgA.path, env })
  runGit(['commit', '--allow-empty', '-m', 'stage: org format migration v1→v2 (pre)'], { cwd: orgA.path, env })
  fs.writeFileSync(keeper, 'half-applied damage\n') // dead run's edit
  fs.writeFileSync(path.join(orgA.path, 'notes', 'debris.tmp'), 'dead run debris\n')
  const stampBefore = readOrgStampVersion(orgA.path)
  const h4 = await svc.openOrg(orgA.path)
  ok(fs.readFileSync(keeper, 'utf8') === 'committed truth\n', 'rewind restored committed content (no data loss)')
  ok(!fs.existsSync(path.join(orgA.path, 'notes', 'debris.tmp')), 'dead run debris cleared from the tree')
  const stash = runGit(['stash', 'list'], { cwd: orgA.path, env, allowFail: true })
  ok(stash && stash.includes('crash recovery'), 'debris preserved in stash, not destroyed')
  ok(readOrgStampVersion(orgA.path) === stampBefore, 'stamp untouched by recovery')
  ok(h4.orgVersion === stampBefore, 'org opens green after recovery')
  svc.closeOrg()
  // A real interrupted migration re-runs and publishes its post commit; with
  // MIGRATIONS empty the fixture must move HEAD past the pre marker itself,
  // otherwise every later open re-triggers recovery on a marker that will
  // never be superseded.
  runGit(['commit', '--allow-empty', '-m', 'stage: org format migration v1→v2 (post)'], { cwd: orgA.path, env })

  // ---- org switch: full reverse teardown ----------------------------------
  console.log('org switch teardown:')
  const orgB = svc.createOrg('Beta LLC')
  const hA = await svc.openOrg(orgA.path)
  const backendA = hA.index.backend
  const hB = await svc.switchOrg(orgB.path)
  ok(svc.current.slug === orgB.slug, 'switch lands on the new org')
  ok(listRecents(env)[0] === orgB.path, 'switching orgs re-orders the recents')
  ok(!fs.existsSync(shellLockPath(orgA.path, orgA.slug)), 'old org lock released on switch')
  ok(fs.existsSync(shellLockPath(orgB.path, orgB.slug)), 'new org lock held')
  assert.throws(() => backendA.query('orgs'), undefined)
  passed++
  console.log('  ✓ old backend closed — no live handle can reach the old org')
  ok(hB.index.backend.query('orgs').some((o) => o.slug === orgB.slug), 'new org queryable after switch')
  const sameB = await svc.switchOrg(orgB.path)
  ok(sameB === hB, 'switch to the already-open org is a no-op')
  svc.closeOrg()
  ok(!fs.existsSync(shellLockPath(orgB.path, orgB.slug)), 'no leftover locks after final close')
  const lockDir = path.join(orgB.path, '.arxa', 'locks')
  ok(!fs.existsSync(lockDir) || fs.readdirSync(lockDir).length === 0, 'lock dir empty — nothing leaked')

  // ---- optional rails: configured path + partial-open unwind --------------
  console.log('optional rails:')
  const svcRails = createOrgLifecycle({
    workspaceRoot: root,
    env,
    rails: { account: { provider: createLocalProvider() }, cairn: { deviceId: 'device-A' } },
  })
  const hR = await svcRails.openOrg(orgA.path)
  ok(hR.rails.account.attached === true, 'account-mirror attaches when a provider is configured')
  ok(hR.rails.cairn.attached === true && hR.rails.cairn.deviceId === 'device-A', 'cairn-rail attaches when a device id is configured')
  svcRails.closeOrg()

  // A refusing rail (materializer claimed by another device) must fail loud
  // AND unwind everything acquired before it — no leaked lock or backend.
  const svcOther = createOrgLifecycle({
    workspaceRoot: root,
    env,
    rails: { cairn: { deviceId: 'device-B' } },
  })
  await throwsAsync(
    () => svcOther.openOrg(orgA.path),
    (e) => {
      assert.ok(e instanceof OrgOpenError && e.step === 'cairn-rail')
      assert.equal(e.cause?.name, 'MaterializerClaimError')
    },
    'foreign materializer claim fails loud with OrgOpenError(cairn-rail)'
  )
  ok(!fs.existsSync(shellLockPath(orgA.path, orgA.slug)), 'failed open released the shell lock (reverse unwind)')
  ok(svcOther.current === null, 'failed open leaves no current handle')

  // ---- trash restore-all (the sidebar's one Restore CTA) ------------------
  console.log('trash restore-all:')
  const svcTrash = createOrgLifecycle({ workspaceRoot: root, env })
  await svcTrash.openOrg(orgA.path)
  const hT = svcTrash.current
  hT.newProject('Doomed')
  const doomedPath = path.join(orgA.path, 'projects', 'doomed')
  softDelete(orgA.path, doomedPath, { env }) // org-local trash (D69)
  ok(hT.trashCount() === 1, 'softDelete parks the project in the trash')
  const res = hT.restoreTrash()
  ok(res.restored.length === 1 && res.failed.length === 0, 'restore-all restores every entry, none blocked')
  ok(hT.trashCount() === 0, 'trash empty after restore-all')
  ok(fs.existsSync(doomedPath), 'project back at its origin path')
  svcTrash.closeOrg()

  // ---- renameOrg: display-name-only (D41), open handle refreshes ---------
  console.log('org rename:')
  const svcRename = createOrgLifecycle({ workspaceRoot: root, env })
  const renamed = svcRename.renameOrg(orgB.path, 'Beta Limited')
  ok(renamed.manifest.name === 'Beta Limited', 'rename rewrites the manifest name')
  ok(renamed.slug === orgB.slug && fs.existsSync(orgB.path), 'slug and folder untouched (D41)')
  ok(svcRename.listOrgs().some((o) => o.id === renamed.manifest.id && o.name === 'Beta Limited'), 'listOrgs serves the new display name')
  const hRen = await svcRename.openOrg(orgB.path)
  svcRename.renameOrg(orgB.path, 'Beta Renewed')
  ok(svcRename.current.manifest.name === 'Beta Renewed', 'open handle manifest refreshes in place')
  ok(hRen.activeSessions().every((s) => s.state !== 'archived'), 'activeSessions holds archived back')
  assert.throws(() => svcRename.renameOrg(path.join(root, 'not-an-org'), 'X'), /unknown-org/)
  passed++
  console.log('  ✓ rename of a non-org fails loud')
  assert.throws(() => svcRename.renameOrg(orgB.path, '  '), /non-empty/)
  passed++
  console.log('  ✓ rename to blank fails loud')
  svcRename.closeOrg()

  // ---- rename keeps the index row's denormalised name in step ----------
  {
    const be = openBackend(orgB.path) // per-org index (D69)
    const row = be.query('orgs').find((o) => o.slug === orgB.slug)
    ok(row?.name === 'Beta Renewed', 'index orgs row carries the renamed display name (no SUPO/MIRA drift)')
    be.close()
  }

  // ---- orgTree: the five D42 categories + projects, read-only ----------
  console.log('org tree:')
  {
    const svcTree = createOrgLifecycle({ workspaceRoot: root, env })
    const tree = svcTree.orgTree(orgA.path)
    ok(tree.categories.length === 5, 'all five fixed categories reported')
    ok(tree.categories.every((c) => c.exists), 'scaffolded categories exist on disk')
    ok(Array.isArray(tree.projects) && tree.projects.every((p) => p.path.startsWith(orgA.path)), 'projects scoped to the org')
    ok(tree.sessionsByProject !== null, 'session counts readable for a repo-backed org')
    assert.throws(() => svcTree.orgTree(path.join(root, 'not-an-org')), /unknown-org/)
    passed++
    console.log('  ✓ orgTree of a non-org fails loud')
    ok(svcTree.current === null, 'orgTree never opens — read-only face')
  }

  // ---- Phase D: dsh bridge (D71) ------------------------------------------
  console.log('dsh bridge (Phase D, D71):')
  {
    // (a) default bridge: unavailable → registry-only with a loud annotation.
    const svcNoDsh = createOrgLifecycle({ workspaceRoot: root, env })
    await svcNoDsh.openOrg(orgB.path)
    const hNo = svcNoDsh.current
    const regRow = await hNo.newSession('no-dsh', null)
    ok(regRow.dshSessionId === null && regRow.dshStatus === 'dsh-unavailable', 'default bridge degrades to registry-only with a loud dsh-unavailable annotation')
    ok(fs.existsSync(regRow.worktree), 'branch + worktree still created without dsh (registry stays the durable record)')
    ok(listSessions(orgB.path, env).find((s) => s.id === regRow.id).dshStatus === 'dsh-unavailable', 'annotation persisted on the registry row')
    svcNoDsh.closeOrg()

    // (b) mock faces: spawn records the worktree cwd; registry gains the id.
    const spawnedSpecs = []
    const archivedIds = []
    const attachedIds = []
    const mockFaces = {
      spawn: ({ cwd, name }) => {
        const id = 'dsh-' + (spawnedSpecs.length + 1)
        spawnedSpecs.push({ id, cwd, name })
        return { id }
      },
      attach: (id) => { attachedIds.push(id); return { ok: true } },
      list: () => spawnedSpecs.map((s, i) => ({
        id: s.id,
        displayTitle: 'Live ' + s.name,
        running: i === 0,
        pendingInteraction: i === 0 ? 'approval' : null,
      })),
      archive: (ids) => { archivedIds.push(...ids) },
    }
    const svcDsh = createOrgLifecycle({ workspaceRoot: root, env, dsh: mockFaces })
    await svcDsh.openOrg(orgB.path)
    const hD = svcDsh.current
    const liveRow = await hD.newSession('bridge', null)
    ok(typeof liveRow.dshSessionId === 'string' && liveRow.dshSessionId.startsWith('dsh-'), 'mock spawn ran and its id landed on the returned row (dshSessionId)')
    ok(spawnedSpecs[0].cwd === liveRow.worktree, 'dsh spawn cwd = the session worktree (sessions.create cwd contract)')
    ok(listSessions(orgB.path, env).find((s) => s.id === liveRow.id).dshSessionId === liveRow.dshSessionId, 'registry (durable record) carries dshSessionId')

    // (c) live join on the rows face.
    const joined = hD.activeSessions().find((s) => s.id === liveRow.id)
    ok(
      joined.dshSessionId === liveRow.dshSessionId &&
      joined.displayTitle === 'Live bridge' &&
      joined.running === true &&
      joined.pendingInteraction === 'approval',
      'activeSessions join surfaces mock live fields (displayTitle, running, pendingInteraction D63 union)',
    )
    ok(
      hD.activeSessions().filter((s) => s.id !== liveRow.id).every((s) => !('displayTitle' in s)),
      'rows without a dshSessionId join degrade to registry fields',
    )

    // (d) resume re-attach by dshSessionId.
    await hD.resumeSession(liveRow.id)
    ok(attachedIds.includes(liveRow.dshSessionId), 'resume re-attaches the dsh session by dshSessionId')

    // (e) archive feeds dsh's archivedSessionIds contract.
    await hD.archiveSession(liveRow.id)
    ok(archivedIds.includes(liveRow.dshSessionId), 'archive feeds the dsh archivedSessionIds contract')
    ok(hD.activeSessions().every((s) => s.id !== liveRow.id), 'archived row held back from active views after the dsh feed')
    svcDsh.closeOrg()

    // (f) pure join: failure modes degrade silently.
    const regRows = [{ id: 'a', name: 'A', dshSessionId: 'x' }, { id: 'b', name: 'B' }]
    ok(joinDshLive(regRows, [{ id: 'x', displayTitle: 'T', running: false, pendingInteraction: 'question' }])[0].displayTitle === 'T', 'joinDshLive maps live fields by dshSessionId')
    ok(joinDshLive(regRows, null)[1].name === 'B' && joinDshLive(regRows, null)[1].dshSessionId === null, 'joinDshLive with no dsh list degrades to registry rows (old rows read dshSessionId null)')
    ok(joinDshLive(regRows, [{ id: 'unrelated' }]).every((r) => !('running' in r)), 'joinDshLive with an unresolved id keeps registry fields (silent degrade)')

    // (g) throw-proof bridge: a throwing face never throws out.
    const boom = createDshBridge({ spawn: () => { throw new Error('boom') }, list: () => { throw new Error('boom') }, archive: () => { throw new Error('boom') } })
    ok((await boom.spawn({ cwd: '/x' })).ok === false && (await boom.list()).length === 0 && (await boom.archive(['x'])).ok === false, 'throwing dsh faces degrade to unavailable, never throw')
    ok(createDshBridge().spawn({}).then((r) => r.reason === 'dsh-unavailable'), 'empty faces = dsh-unavailable')
    passed++
    console.log('  ✓ bridge is throw-proof across face failures')
  }

  console.log(`\nfile-org-shell selftest: ${passed} checks passed`)
} finally {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(fakeHome, { recursive: true, force: true })
}
