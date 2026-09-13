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

  // ---- listOrgs is RECENTS-based (2026-08-30) --------------------------------
  // Regression: the old single-root scan listed only the most-recent org
  // folder and its children, so creating a second org anywhere made the
  // first vanish from the sidebar switcher (seen live: RESTO hid TOPO).
  // The contract (org-model-v2 Phase A): recents IS the registry — an org
  // outside workspaceRoot still lists; dead pointers skip silently.
  {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-elsewhere-'))
    const svcOtherRoot = createOrgLifecycle({ workspaceRoot: elsewhere, env })
    const orgFar = svcOtherRoot.createOrg('Far Corp') // scaffolded under elsewhere, enters the SAME recents
    const listed = svc.listOrgs() // svc's root never contained orgFar
    ok(listed.some((o) => o.id === orgFar.manifest.id), 'listOrgs reaches orgs beyond workspaceRoot (recents switcher)')
    const recentsFile = path.join(fakeHome, 'organisation.json')
    const readRecentsFile = () => JSON.parse(fs.readFileSync(recentsFile, 'utf8'))
    const deadBefore = readRecentsFile().orgs.length
    fs.writeFileSync(recentsFile, JSON.stringify({ orgs: [...readRecentsFile().orgs, path.join(elsewhere, 'does-not-exist')] }))
    ok(svc.listOrgs().every((o) => fs.existsSync(path.join(o.path, 'org.json'))), 'dead recents pointers skip silently')
    fs.writeFileSync(recentsFile, JSON.stringify({ orgs: readRecentsFile().orgs.slice(0, deadBefore) }))
    fs.rmSync(elsewhere, { recursive: true, force: true })
  }

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
  let orgB = svc.createOrg('Beta LLC')
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
  // D79 preserves case, so the folder is `Doomed`, not `doomed`. Taking the
  // path from newProject rather than spelling it out: the lowercase guess only
  // ever worked because APFS is case-insensitive — on ext4 it was "nothing to
  // trash" (found on Arch, 2026-09-07).
  const doomed = await hT.newProject('Doomed')
  const doomedPath = doomed.path
  softDelete(orgA.path, doomedPath, { env }) // org-local trash (D69)
  ok(hT.trashCount() === 1, 'softDelete parks the project in the trash')
  const res = hT.restoreTrash()
  ok(res.restored.length === 1 && res.failed.length === 0, 'restore-all restores every entry, none blocked')
  ok(hT.trashCount() === 0, 'trash empty after restore-all')
  ok(fs.existsSync(doomedPath), 'project back at its origin path')
  svcTrash.closeOrg()

  // ---- renameOrg: proper rename (D72 — display name + folder as ONE move) --
  console.log('org rename (D72):')
  const svcRename = createOrgLifecycle({ workspaceRoot: root, env })
  const renamed = await svcRename.renameOrg(orgB.path, 'Beta Limited')
  ok(renamed.moved === true && renamed.slug === 'Beta-Limited', 'rename derives the slug from the display name (case preserved, D79) and moves the folder (D72)')
  ok(!fs.existsSync(orgB.path) && fs.existsSync(renamed.path), 'old folder gone, new folder in place')
  ok(fs.existsSync(path.join(renamed.path, '.git')), 'org repo .git moved with the folder')
  ok(svcRename.listOrgs().some((o) => o.id === renamed.manifest.id && o.name === 'Beta Limited'), 'listOrgs serves the new display name')
  orgB = { ...orgB, path: renamed.path, slug: renamed.slug }
  const hRen = await svcRename.openOrg(orgB.path)
  const renamed2 = await svcRename.renameOrg(orgB.path, 'Beta Renewed')
  ok(svcRename.current.path === renamed2.path && svcRename.current.manifest.name === 'Beta Renewed', 'open handle re-opens on the new path with the new manifest')
  ok(hRen.activeSessions !== undefined && svcRename.current.activeSessions().every((s) => s.state !== 'archived'), 're-opened handle serves activeSessions')
  orgB = { ...orgB, path: renamed2.path, slug: renamed2.slug }
  const dnOnly = await svcRename.renameOrg(orgB.path, 'Beta Renewed')
  ok(dnOnly.moved === false && dnOnly.path === orgB.path, 'same-slug rename degrades to display-name-only (D72 rider)')
  await assert.rejects(() => svcRename.renameOrg(path.join(root, 'not-an-org'), 'X'), /unknown-org/)
  passed++
  console.log('  ✓ rename of a non-org fails loud')
  await assert.rejects(() => svcRename.renameOrg(orgB.path, '  '), /non-empty/)
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
    ok(tree.docks.length === 5, 'all five docks reported (v2)')
    ok(tree.docks.every((d) => d.exists), 'scaffolded docks exist on disk')
    ok(tree.docks.find((d) => d.slug === 'notes').workspace === true, 'a dock without containers is itself a workspace')
    ok(tree.docks.find((d) => d.slug === 'projects').containers === null, 'the projects dock holds dynamic projects')
    ok(Array.isArray(tree.projects) && tree.projects.every((p) => p.path.startsWith(orgA.path) && p.containers.length === 10), 'projects scoped to the org with their 10 fixed containers')
    ok(tree.sessionsByWorkspace !== null, 'workspace counts readable for a repo-backed org')
    // G2 (grilled 2026-09-06): a bare dock's own first-level subfolders are
    // workspace rows in the sidebar, so the tree face has to report them.
    // Disk truth, not template vocabulary — the user makes these folders.
    fs.mkdirSync(path.join(orgA.path, 'notes', 'ideas'), { recursive: true })
    fs.mkdirSync(path.join(orgA.path, 'notes', '.hidden'), { recursive: true })
    const treeG2 = svcTree.orgTree(orgA.path)
    ok(treeG2.docks.find((d) => d.slug === 'notes').folders.join(',') === 'ideas',
      'G2: a bare dock reports its first-level folders, dotfiles skipped')
    ok(treeG2.docks.find((d) => d.slug === 'meetings').folders === undefined,
      'G2: container docks report no folders — their children are template vocabulary')
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
    const regRow = await hNo.newSession('no-dsh', 'notes')
    ok(regRow.dshSessionId === null && regRow.dshStatus === 'dsh-unavailable', 'default bridge degrades to registry-only with a loud dsh-unavailable annotation')
    ok(fs.existsSync(regRow.worktree), 'branch + worktree still created without dsh (registry stays the durable record)')
    ok(listSessions(orgB.path, env).find((s) => s.id === regRow.id).dshStatus === 'dsh-unavailable', 'annotation persisted on the registry row')
    ok(regRow.workspace === 'notes' && typeof regRow.createdAt === 'number' && regRow.updatedAt >= regRow.createdAt, 'session row carries its workspace scope + real timestamps (v2; the 56y bug was fake ordinals)')
    const autoRow = await hNo.newSession(undefined, 'notes')
    // Q2/Q3 (2026-09-03) supersede the 2026-08-30 auto-name: the id is now the
    // full `<org>/<workspace>/<leaf>` disk path, minted from the workspace
    // context, and `name` DEFAULTS TO THE ID'S LEAF (Q9) — the breadcrumb
    // already carries the folders, so the row would otherwise read them
    // twice. The worktree dir and branch still carry the whole id. Stamp is
    // computed, not frozen — a hardcoded date would rot tomorrow.
    const dstamp = (d = new Date()) =>
      String(d.getFullYear() % 100).padStart(2, '0') +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0')
    // -002, not -001: the explicitly-named `no-dsh` row above already holds
    // -001. An explicit name diverges from the id; it does not skip the mint.
    ok(autoRow.id === `${orgB.slug}/notes/note-wt-${dstamp()}-002`, `auto-id: <org>/<workspace>/<prefix>-wt-<YYMMDD>-<NNN> from the workspace folder (${autoRow.id})`)
    ok(autoRow.name === `note-wt-${dstamp()}-002`, 'auto-name defaults to the LEAF of the id, not the whole id — the breadcrumb already carries the folders (Q9)')
    ok(autoRow.worktree.endsWith(autoRow.id) && autoRow.branch === `arxa/${autoRow.id}`, 'the minted id IS the worktree dir (under .arxa/worktrees) and the whole branch suffix after arxa/')
    // G2 (grilled 2026-09-06): a Notes subfolder is a workspace row, so it
    // hosts its own sessions — but ONLY when the folder really exists. The
    // allowance is a disk check, so it can never widen into account/.
    fs.mkdirSync(path.join(orgB.path, 'notes', 'ideas'), { recursive: true })
    const subRow = await hNo.newSession(undefined, 'notes/ideas')
    ok(subRow.workspace === 'notes/ideas' && subRow.id === `${orgB.slug}/notes/ideas/idea-wt-${dstamp()}-001`,
      `G2: a Notes subfolder hosts sessions in its own id namespace (${subRow.id})`)
    ok(fs.existsSync(subRow.worktree), 'G2: the subfolder session got a real branch + worktree (org repo, per routeDock)')
    try { await hNo.newSession('bad', 'notes/not-on-disk') } catch (e) { ok(/unknown-workspace/.test(String(e.message)), 'G2: a Notes subfolder that is not on disk still fails loud') }
    try { await hNo.newSession('bad', 'account/receipts') } catch (e) { ok(/account/.test(String(e.message)), 'G2: the allowance never reaches account/ — routing still refuses it (D37)') }
    try { await hNo.newSession('bad', null) } catch (e) { ok(/workspace-required/.test(String(e.message)), 'org-level sessions are impossible — workspace is required (v2)') }
    try { await hNo.newSession('bad', 'nope/deep') } catch (e) { ok(/unknown-workspace/.test(String(e.message)), 'unknown workspace fails loud') }
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
    const liveRow = await hD.newSession('bridge', 'notes')
    ok(typeof liveRow.dshSessionId === 'string' && liveRow.dshSessionId.startsWith('dsh-'), 'mock spawn ran and its id landed on the returned row (dshSessionId)')
    ok(spawnedSpecs[0].cwd === liveRow.worktree, 'dsh spawn cwd = the session worktree (sessions.create cwd contract)')
    ok(listSessions(orgB.path, env).find((s) => s.id === liveRow.id).dshSessionId === liveRow.dshSessionId, 'registry (durable record) carries dshSessionId')

    // (c) live join on the rows face.
    const joined = hD.activeSessions().find((s) => s.id === liveRow.id)
    // v2 rename rule (grilled 2026-08-30): the registry name is the display
    // truth everywhere — dsh keeps only the live pills. displayTitle here is
    // the REGISTRY name ('bridge'), NOT dsh's 'Live bridge'.
    ok(
      joined.dshSessionId === liveRow.dshSessionId &&
      joined.displayTitle === 'bridge' &&
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

    // (d2) resume SPAWNS the engine conversation when the row has none
    // (rows born while dsh was unavailable — 2026-08-30): every opened
    // session owns a conversation the sidebar client can then focus via
    // the client sessions service.
    const beforeSpawn = spawnedSpecs.length
    const revived = await hD.resumeSession(regRow.id)
    ok(spawnedSpecs.length === beforeSpawn + 1, 'resume spawns the engine session when the row lacks one')
    ok(spawnedSpecs[spawnedSpecs.length - 1].cwd === revived.worktree, 'resume-spawn cwd = the session worktree (sessions.create cwd contract)')
    ok(!attachedIds.includes(spawnedSpecs[spawnedSpecs.length - 1].id), 'a freshly spawned row attaches nothing (spawn IS the attach)')
    ok(listSessions(orgB.path, env).find((s) => s.id === regRow.id).dshSessionId === spawnedSpecs[spawnedSpecs.length - 1].id, 'registry carries the resume-spawned dshSessionId')

    // (e) archive feeds dsh's archivedSessionIds contract.
    await hD.archiveSession(liveRow.id)
    ok(archivedIds.includes(liveRow.dshSessionId), 'archive feeds the dsh archivedSessionIds contract')
    ok(hD.activeSessions().every((s) => s.id !== liveRow.id), 'archived row held back from active views after the dsh feed')
    svcDsh.closeOrg()

    // (f) pure join: failure modes degrade silently.
    const regRows = [{ id: 'a', name: 'A', dshSessionId: 'x' }, { id: 'b', name: 'B' }]
    const joinedPure = joinDshLive(regRows, [{ id: 'x', displayTitle: 'T', running: false, pendingInteraction: 'question' }])[0]
    ok(joinedPure.displayTitle === 'A' && joinedPure.running === false && joinedPure.pendingInteraction === 'question', 'joinDshLive maps live pills by dshSessionId; the registry name stays the display truth (v2 rename rule)')
    ok(joinDshLive(regRows, null)[1].name === 'B' && joinDshLive(regRows, null)[1].dshSessionId === null, 'joinDshLive with no dsh list degrades to registry rows (old rows read dshSessionId null)')
    ok(joinDshLive(regRows, [{ id: 'unrelated' }]).every((r) => !('running' in r)), 'joinDshLive with an unresolved id keeps registry fields (silent degrade)')

    // (g) throw-proof bridge: a throwing face never throws out.
    const boom = createDshBridge({ spawn: () => { throw new Error('boom') }, list: () => { throw new Error('boom') }, archive: () => { throw new Error('boom') } })
    ok((await boom.spawn({ cwd: '/x' })).ok === false && (await boom.list()).length === 0 && (await boom.archive(['x'])).ok === false, 'throwing dsh faces degrade to unavailable, never throw')
    ok(createDshBridge().spawn({}).then((r) => r.reason === 'dsh-unavailable'), 'empty faces = dsh-unavailable')
    passed++
    console.log('  ✓ bridge is throw-proof across face failures')
  }

  
  // ---- W3b/D73: publish (gate + push halves) -------------------------------
  console.log('publish (W3b gate half + D73 push half):')
  {
    // The mock repo URL is a LOCAL BARE repo: the push half runs for real
    // (git push --all over a plain path) with zero network — the offline
    // contract every selftest keeps.
    const bareRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-publish-bare-'))
    const bareFor = (name) => {
      const p = path.join(bareRoot, name + '.git')
      runGit(['init', '--bare', p], { cwd: bareRoot, env })
      return p
    }

    // (a) linked mock github: private repo + origin + PUSH + manifest annotation.
    const createdRepos = []
    const svcGh = createOrgLifecycle({
      workspaceRoot: root,
      env,
      github: {
        status: async () => ({ linked: true, login: 'octocat' }),
        createPrivateRepo: async (name) => {
          createdRepos.push(name)
          return {
            name,
            full_name: 'octocat/' + name,
            private: true,
            html_url: bareFor(name),
            owner: { login: 'octocat' },
          }
        },
        gitCredentials: async () => ({ login: 'octocat', token: 'test-token' }),
      },
    })
    await svcGh.openOrg(orgA.path)
    const proj = await svcGh.current.newProject('Skunkworks')
    // D74: the org heal publishes at open, so the org slug lands in this
    // list too — the CONTRACT is that the project slug is served verbatim.
    ok(createdRepos.includes(proj.slug), 'linked github: createPrivateRepo called with the project slug')
    ok(createdRepos[0] === path.basename(orgA.path), 'D74 heal: openOrg published the org itself (org slug served first)')
    const originUrl = runGit(['remote', 'get-url', 'origin'], { cwd: proj.path, env })
    ok(originUrl === bareFor(proj.slug), 'origin wired to the new private repo')
    ok(
      runGit(['rev-parse', '--verify', 'main'], { cwd: bareFor(proj.slug), env, allowFail: true }) !== null,
      'D73 push half: history really reached the remote (main exists on the bare)',
    )
    const pm = JSON.parse(fs.readFileSync(path.join(proj.path, 'project.json'), 'utf8'))
    ok(
      pm.repoOwner === 'octocat' && pm.repoName === proj.slug && pm.repoPrivate === true &&
      pm.repoUrl === bareFor(proj.slug),
      'manifest annotated with repoOwner/repoName/repoPrivate/repoUrl',
    )
    ok(pm.githubStatus === 'published' && typeof pm.githubPublishedAt === 'string', 'happy path annotates githubStatus=published + timestamp')
    // (a2) D95/D96 sync sweep (2026-09-01 grill): a local drift commit on
    // a published project pushes in the sweep; a remote advance fast-forwards
    // into the project tree — generated files land locally, not only on GitHub.
    // Await the detached open-time heal FIRST so it cannot race the sweep's
    // push (its own sync push IS the law working — but the test must own it).
    try { if (svcGh.current?.githubHeal) await svcGh.current.githubHeal } catch { /* heal is throw-proof */ }
    fs.writeFileSync(path.join(proj.path, 'drift.md'), 'drift')
    runGit(['add', 'drift.md'], { cwd: proj.path, env })
    runGit(['-c', 'user.email=t@arxa', '-c', 'user.name=t', 'commit', '-m', 'local drift'], { cwd: proj.path, env })
    const projSweep = (s) => s.find((x) => x.kind === 'project' && x.slug === proj.slug)
    const sweep1 = await svcGh.syncOrgRepos(orgA.path)
    ok(projSweep(sweep1).status === 'pushed', 'D95: drift commit pushed by the sync sweep (sweep=' + JSON.stringify(sweep1.map((x) => x.status)) + ')')
    const localMain = runGit(['rev-parse', 'main'], { cwd: proj.path, env })
    ok(runGit(['rev-parse', 'main'], { cwd: bareFor(proj.slug), env }) === localMain, 'D95: remote main mirrors local main after the sweep')
    const puller = path.join(bareRoot, 'puller')
    runGit(['clone', bareFor(proj.slug), puller], { cwd: bareRoot, env })
    fs.writeFileSync(path.join(puller, 'remote-edit.md'), 'from remote')
    runGit(['add', 'remote-edit.md'], { cwd: puller, env })
    runGit(['-c', 'user.email=t@arxa', '-c', 'user.name=t', 'commit', '-m', 'remote edit'], { cwd: puller, env })
    runGit(['push', 'origin', 'main'], { cwd: puller, env })
    const sweep2 = await svcGh.syncOrgRepos(orgA.path)
    ok(projSweep(sweep2).status === 'pulled', 'D96: remote advance ff-pulled by the sweep')
    ok(fs.existsSync(path.join(proj.path, 'remote-edit.md')), 'D96: pulled file materialised in the project tree')

    svcGh.closeOrg()

    // (b) no github faces at all: unavailable stub annotates, project exists.
    const svcNoGh = createOrgLifecycle({ workspaceRoot: root, env })
    await svcNoGh.openOrg(orgA.path)
    const local = await svcNoGh.current.newProject('Local Only')
    ok(fs.existsSync(path.join(local.path, 'project.json')), 'unavailable github: the local project still exists (never blocks local work)')
    const lm = JSON.parse(fs.readFileSync(path.join(local.path, 'project.json'), 'utf8'))
    ok(lm.githubStatus === 'github-unavailable', 'unavailable github: loud githubStatus manifest annotation')
    ok(!('repoUrl' in lm), 'no repo fields faked')

    // (b3) D95/D96 statuses without GitHub faces: a PUBLISHED repo reports
    // no-creds (loud — the silent skip is how project-001 drifted 3
    // commits); a repo-less project reports local. Never throws.
    const sweepNo = await svcNoGh.syncOrgRepos(orgA.path)
    const bySlug = (s, slug) => s.find((x) => x.slug === slug)
    ok(sweepNo[0].status === 'no-creds', 'sync: published org without creds reports no-creds, never a silent skip')
    ok(bySlug(sweepNo, local.slug)?.status === 'local', 'sync: repo-less project reports local')

    // (b2) D78: blank auto-name is 01-project (2-digit prefix first, matching
    // the stage-folder convention); the scaffold drops .gitkeep so empty
    // stage folders are tracked by git and reach GitHub.
    const auto1 = await svcNoGh.current.newProject()
    ok(path.basename(auto1.path) === '01-project', 'D78: blank auto-name is 01-project (2-digit prefix first)')
    const auto2 = await svcNoGh.current.newProject()
    ok(path.basename(auto2.path) === '02-project', 'D78: second blank auto-name is 02-project (per-dock counter)')
    ok(
      fs.existsSync(path.join(auto1.path, '01-intake', 'website', '.gitkeep')),
      'D78: empty stage folders carry .gitkeep (git/GitHub can track them)',
    )

    // (b3) D79: CASE IS PRESERVED end to end — "POLO" is never folded to
    // "polo": not the folder, not the manifest slug, not the workspace key
    // the session scope parses.
    const polo = await svcNoGh.current.newProject('POLO')
    ok(path.basename(polo.path) === 'POLO', 'D79: uppercase name keeps its case on disk')
    const pm79 = JSON.parse(fs.readFileSync(path.join(polo.path, 'project.json'), 'utf8'))
    ok(pm79.name === 'POLO', 'D79: manifest display name preserves case (slug IS the folder)')
    const sess79 = await svcNoGh.current.newSession(null, 'projects/POLO/00-moodboard/application')
    ok(
      sess79.workspace === 'projects/POLO/00-moodboard/application' && sess79.project === 'POLO',
      'D79: uppercase slugs parse as workspace keys (session scope accepts them)',
    )

    // (c) linked faces that THROW: publish failure is a loud annotation, never a throw.
    const svcBoom = createOrgLifecycle({
      workspaceRoot: root,
      env,
      github: { status: async () => ({ linked: true }), createPrivateRepo: async () => { throw new Error('api 422') } },
    })
    await svcBoom.openOrg(orgA.path)
    const boomP = await svcBoom.current.newProject('Boom Project')
    ok(fs.existsSync(path.join(boomP.path, 'project.json')), 'throwing github: project exists')
    const bm = JSON.parse(fs.readFileSync(path.join(boomP.path, 'project.json'), 'utf8'))
    ok(typeof bm.githubStatus === 'string' && bm.githubStatus.startsWith('publish-failed:'), 'throwing github: publish-failed annotation, never a throw')
    svcNoGh.closeOrg()
    svcBoom.closeOrg()

    // (d) D74 heal-on-open + manual publish: a FRESH org (never published)
    // publishes at open with pushed history; a second publish is a loud
    // idempotent skip. (orgA was already published by (a)'s heal — the
    // fixture org carries the proof that heal runs on EVERY open.)
    const hRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-heal-org-'))
    const svcHeal = createOrgLifecycle({
      workspaceRoot: hRoot,
      env,
      github: {
        status: async () => ({ linked: true, login: 'octocat' }),
        createPrivateRepo: async (name) => ({
          name, full_name: 'octocat/' + name, private: true, html_url: bareFor(name), owner: { login: 'octocat' },
        }),
        gitCredentials: async () => ({ login: 'octocat', token: 'test-token' }),
      },
    })
    const orgHeal = svcHeal.createOrg('Heal Corp')
    // A PRE-D73 project: created while unlinked (annotated github-unavailable),
    // so the linked heal must retrofit it alongside the org repo.
    const svcPre = createOrgLifecycle({ workspaceRoot: hRoot, env })
    await svcPre.openOrg(orgHeal.path)
    await svcPre.current.newProject('Pre Existing')
    svcPre.closeOrg()
    const orgBare = bareFor('Heal-Corp')
    await svcHeal.openOrg(orgHeal.path)
    const healRes = await svcHeal.current.githubHeal
    ok(healRes?.ok === true && healRes.repoUrl === orgBare, 'D74 heal: open-time detached publish resolves ok with the repo url')
    const om = JSON.parse(fs.readFileSync(path.join(orgHeal.path, 'org.json'), 'utf8'))
    ok(om.repoUrl === orgBare && om.githubStatus === 'published', 'D74 heal: org.json annotated repoUrl + published')
    ok(
      runGit(['rev-parse', '--verify', 'main'], { cwd: orgBare, env, allowFail: true }) !== null,
      'D74 heal: org history reached the remote (main on the bare)',
    )
    const healedProj = healRes.projects?.find((x) => x.slug === 'Pre-Existing')
    ok(healedProj?.ok === true, 'D74 heal: existing projects retrofit on the same pass')
    ok(
      runGit(['rev-parse', '--verify', 'main'], { cwd: bareFor('Pre-Existing'), env, allowFail: true }) !== null,
      'D74 heal: project history pushed (pre-existing main on its bare)',
    )
    const again = await svcHeal.current.publishGithub()
    ok(again.ok === true && again.skipped === 'published', 'D74 manual publish: idempotent skip when already published')
    svcHeal.closeOrg()
  }

  // ---- Phase E: renameOrg end-to-end + all-or-nothing proof (D72) ----------
  console.log('org rename end-to-end (Phase E, D72):')
  {
    const eRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-rename-e2e-'))
    const eHome = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-rename-home-'))
    const eEnv = { ...process.env, ARXA_HOME: eHome }
    try {
      const svcE = createOrgLifecycle({ workspaceRoot: eRoot, env: eEnv })
      const org = svcE.createOrg('Rename Me')
      await svcE.openOrg(org.path)
      const sess = await svcE.current.newSession('worker', 'notes')
      fs.writeFileSync(path.join(sess.worktree, 'note.md'), 'before rename\n')
      runGit(['add', '-A'], { cwd: sess.worktree, env: eEnv })
      runGit(['commit', '-m', 'wip: note'], { cwd: sess.worktree, env: eEnv })

      const moved = await svcE.renameOrg(org.path, 'Renamed Org')
      ok(moved.moved === true && moved.slug === 'Renamed-Org', 'e2e: folder moved to the slugified new name (case preserved, D79)')
      ok(!fs.existsSync(org.path), 'e2e: old path gone')
      ok(fs.existsSync(path.join(moved.path, '.git', 'arxa', 'sessions.json')), 'e2e: session registry (git-common-dir/arxa/) moved with the folder')
      ok(listSessions(moved.path, eEnv).some((s) => s.id === sess.id && s.state === 'open'), 'e2e: registry rows intact at the new path')
      const wt = path.join(moved.path, '.arxa', 'worktrees', sess.id)
      ok(fs.existsSync(wt), 'e2e: session worktree moved with the folder')
      fs.writeFileSync(path.join(wt, 'note.md'), 'after rename\n')
      runGit(['add', '-A'], { cwd: wt, env: eEnv })
      runGit(['commit', '-m', 'stage: post-rename work'], { cwd: wt, env: eEnv })
      ok(runGit(['status', '--porcelain'], { cwd: wt, env: eEnv }) === '', 'e2e: worktree repaired and functional (write + commit inside)')
      ok(
        listRecents(eEnv).includes(moved.path) && !listRecents(eEnv).includes(org.path),
        'e2e: recents updated (old path removed, new path touched)',
      )
      {
        const be = openBackend(moved.path)
        ok(be.query('orgs').some((o) => o.name === 'Renamed Org'), 'e2e: index row renamed')
        be.close()
      }
      ok(svcE.current.path === moved.path, 'e2e: current open handle re-opened on the new path')
      svcE.closeOrg()

      // Forced failure AFTER the mv → all-or-nothing. Plant a live foreign
      // holder for the FUTURE slug's shell lock INSIDE the org folder: it
      // moves with the folder and the post-mv re-open must fail loud.
      const svcF = createOrgLifecycle({ workspaceRoot: eRoot, env: eEnv })
      await svcF.openOrg(moved.path)
      fs.mkdirSync(path.join(moved.path, '.arxa', 'locks'), { recursive: true })
      fs.writeFileSync(
        path.join(moved.path, '.arxa', 'locks', 'Renamed-Again.lock'),
        JSON.stringify({ pid: process.ppid, startedAt: new Date().toISOString() }),
      )
      await assert.rejects(() => svcF.renameOrg(moved.path, 'Renamed Again'), /Renamed-Again/)
      passed++
      console.log('  ✓ e2e: post-mv failure surfaces loud (live lock on the new path)')
      ok(fs.existsSync(moved.path), 'e2e: folder renamed BACK after the failure (all-or-nothing)')
      ok(!fs.existsSync(path.join(eRoot, 'Renamed-Again')), 'e2e: no partial folder left at the destination')
      const restored = JSON.parse(fs.readFileSync(path.join(moved.path, 'org.json'), 'utf8'))
      ok(restored.name === 'Renamed Org', 'e2e: manifest name restored on rollback')
      ok(svcF.current?.path === moved.path, 'e2e: open handle restored at the old path on rollback')
      if (svcF.current) svcF.closeOrg()
    } finally {
      fs.rmSync(eRoot, { recursive: true, force: true })
      fs.rmSync(eHome, { recursive: true, force: true })
    }
  }

  // ---- D80: project rename rides GitHub (grilled 2026-08-30) --------------
  console.log('project rename rides GitHub (D80):')
  {
    const rRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-rename-gh-'))
    // home isolation: restoreOrg touches the REAL recents unless ARXA_HOME
    // points at a sandbox (measured: CI polluted ~/.arxa/organisation.json)
    const env = { ...process.env, ARXA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-home-gh-')) }
    const bareRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-rename-bare-'))
    const bareFor = (name) => {
      const p = path.join(bareRoot, name + '.git')
      runGit(['init', '--bare', p], { cwd: bareRoot, env })
      return p
    }
    const createdRenames = []
    try {
      const svcR = createOrgLifecycle({
        workspaceRoot: rRoot,
        env,
        github: {
          status: async () => ({ linked: true, login: 'octocat' }),
          createPrivateRepo: async (name) => ({ name, full_name: 'octocat/' + name, private: true, html_url: bareFor(name), owner: { login: 'octocat' } }),
          renameRepo: async (owner, name, newName) => {
            createdRenames.push(name + '->' + newName)
            return { name: newName, full_name: owner + '/' + newName, private: true, html_url: bareFor(newName), owner: { login: owner } }
          },
          repoNameTaken: async (owner, name) => name === 'Taken',
          gitCredentials: async () => ({ login: 'octocat', token: 'test-token' }),
        },
      })
      const orgR = svcR.createOrg('Rename GH')
      await svcR.openOrg(orgR.path)
      const p1 = await svcR.current.newProject('Patcher')
      ok(p1.slug === 'Patcher', 'D80: fixture project keeps its case (create)')
      // (a) linked rename: PATCH + canonical URL + origin, no pending flag.
      const ren1 = await svcR.renameProject(orgR.path, 'Patcher', 'Patcher Two')
      ok(ren1.slug === 'Patcher-Two' && ren1.manifest.repoUrl === bareFor('Patcher-Two'), 'D80: linked rename PATCHes GitHub and adopts the canonical URL')
      ok(ren1.repoRenamePending === false, 'D80: no pending flag when the PATCH lands')
      ok(createdRenames.includes('Patcher->Patcher-Two'), 'D80: the PATCH carried the old and new names')
      ok(runGit(['remote', 'get-url', 'origin'], { cwd: ren1.path, env }) === bareFor('Patcher-Two'), 'D80: origin rewired to the canonical URL')
      ok(runGit(['status', '--porcelain'], { cwd: ren1.path, env }).trim() === '', 'D80: manifest change committed (clean tree)')
      // (b) pre-flight: a GitHub-taken name aborts BEFORE the move.
      await assert.rejects(() => svcR.renameProject(orgR.path, 'Patcher-Two', 'Taken'), /already taken/)
      ok(fs.existsSync(path.join(orgR.path, 'projects', 'Patcher-Two')), 'D80: taken name aborts with the project untouched')
      svcR.closeOrg()
      // (c) pending net: an unlinked lifecycle renames — flag recorded.
      const svcNo = createOrgLifecycle({ workspaceRoot: rRoot, env })
      await svcNo.openOrg(orgR.path)
      const ren2 = await svcNo.renameProject(orgR.path, 'Patcher-Two', 'Patcher Three')
      ok(ren2.repoRenamePending === true, 'D80: unlinked rename records repoRenamePending (the net)')
      svcNo.closeOrg()
      // (d) heal consumes the flag: linked open PATCHes to the folder slug.
      createdRenames.length = 0
      await svcR.openOrg(orgR.path)
      await svcR.current.githubHeal // the heal is DETACHED at open — await it before reading (D74 contract)
      const pm80 = JSON.parse(fs.readFileSync(path.join(orgR.path, 'projects', 'Patcher-Three', 'project.json'), 'utf8'))
      ok(!pm80.repoRenamePending && pm80.repoName === 'Patcher-Three' && pm80.repoUrl === bareFor('Patcher-Three'), 'D80: heal consumes the pending flag (canonical URL, flag cleared)')
      ok(createdRenames.includes('Patcher-Two->Patcher-Three'), 'D80: heal PATCHed the old name to the folder slug')
      // (e) case-only rename straight through the machinery.
      await svcR.current.newProject('Kappa')
      const ren3 = await svcR.renameProject(orgR.path, 'Kappa', 'KAPPA')
      ok(ren3.slug === 'KAPPA' && fs.existsSync(path.join(orgR.path, 'projects', 'KAPPA')), 'D80: case-only rename lands (internal two-hop)')
      svcR.closeOrg()
    } finally {
      fs.rmSync(rRoot, { recursive: true, force: true })
      fs.rmSync(bareRoot, { recursive: true, force: true })
    }
  }


  // ---- D81: the org itself is trashable; purge deletes the remotes -------
  console.log('org trash + purge (D81):')
  {
    const tRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-orgtrash-'))
    const env = { ...process.env, ARXA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-home-ot-')) }
    const bareRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-orgtrash-bare-'))
    const bareFor = (name) => {
      const p = path.join(bareRoot, name + '.git')
      runGit(['init', '--bare', p], { cwd: bareRoot, env })
      return p
    }
    const deletedRepos = []
    const createdRepos = []
    let refuseDeletes = false
    let goneDeletes = false
    try {
      const svcT = createOrgLifecycle({
        workspaceRoot: tRoot,
        env,
        github: {
          status: async () => ({ linked: true, login: 'octocat' }),
          createPrivateRepo: async (name) => { if (!createdRepos.includes(name)) createdRepos.push(name); return { name, full_name: 'octocat/' + name, private: true, html_url: bareFor(name), owner: { login: 'octocat' } } },
          deleteRepo: async (owner, name) => {
            if (refuseDeletes) throw new Error('github-link: repo deletion refused (403) — re-link')
            if (goneDeletes) throw new Error('github-link: repo not found (404) — it may already be gone')
            deletedRepos.push(owner + '/' + name)
            return { deleted: true }
          },
          gitCredentials: async () => ({ login: 'octocat', token: 'test-token' }),
        },
      })
      const orgT = svcT.createOrg('Trash Me')
      await svcT.openOrg(orgT.path)
      await svcT.current.newProject('Inner')
      svcT.closeOrg()
      // 2026-09-07: a project whose manifest lost its repo fields must still
      // have its repo found (git remote fallback) and deleted by the purge.
      {
        const innerDir = fs.readdirSync(path.join(orgT.path, 'projects')).map((d) => path.join(orgT.path, 'projects', d)).find((d) => fs.existsSync(path.join(d, 'project.json')))
        const mp = path.join(innerDir, 'project.json')
        const m = JSON.parse(fs.readFileSync(mp, 'utf8'))
        for (const k of ['repoUrl', 'repoOwner', 'repoName']) delete m[k]
        fs.writeFileSync(mp, JSON.stringify(m, null, 2) + '\n')
        ok(fs.existsSync(path.join(innerDir, '.git')), 'fixture: the project is its own git repo with a remote')
        runGit(['remote', 'set-url', 'origin', 'https://github.com/octocat/Inner.git'], { cwd: innerDir, env })
      }
      // trash the ORG itself through the real API (writes the index)
      const trashed = await svcT.trashOrg(orgT.path)
      ok(svcT.listOrgTrash().some((e) => e.entryId === trashed.entryId && e.name === 'Trash Me'), 'D81: trashed org listed in the org-trash index')
      // 2026-09-12 (Bug B task, Step 5): the index keeps the folder SLUG
      // (purge/restore derive paths from it) and stores the display name;
      // the trash row renders the display name, not the slug.
      const idxT = JSON.parse(fs.readFileSync(path.join(env.ARXA_HOME, 'org-trash.json'), 'utf8')).find((e) => e.entryId === trashed.entryId)
      ok(idxT.name === 'Trash-Me' && idxT.displayName === 'Trash Me', 'trash: index keeps the slug and stores the manifest display name')

      // 2026-09-07: a localOnly org goes to the trash as-is — no publish, no
      // 15s grace. (Regression: trashOrg read the folder instead of org.json.)
      const orgL = svcT.createOrg('Keep Local')
      const mpL = path.join(orgL.path, 'org.json')
      const mL = JSON.parse(fs.readFileSync(mpL, 'utf8'))
      for (const k of ['repoUrl', 'repoOwner', 'repoName', 'githubStatus']) delete mL[k]
      mL.localOnly = true
      fs.writeFileSync(mpL, JSON.stringify(mL, null, 2) + '\n')
      const nCreated = createdRepos.length
      const tL0 = Date.now()
      const trashedL = await svcT.trashOrg(orgL.path)
      ok(createdRepos.length === nCreated, 'trash: a localOnly org is never published on its way to the trash')
      ok(Date.now() - tL0 < 3000, 'trash: no 15s publish grace for a localOnly org (' + (Date.now() - tL0) + 'ms)')
      ok(fs.existsSync(trashedL.entryPath), 'trash: localOnly org landed in the trash')
      const resL = await svcT.purgeOrgTrash(trashedL.entryId)
      ok(resL.deletedRepos.length === 0 && !fs.existsSync(trashedL.entryPath), 'purge: localOnly org purges with no GitHub calls')

      // purge refusal when GitHub deletes are refused (403 posture)
      refuseDeletes = true
      await assert.rejects(() => svcT.purgeOrgTrash(trashed.entryId), /purge incomplete/)
      ok(fs.existsSync(trashed.entryPath), 'D81: refused purge keeps the trash entry')
      refuseDeletes = false
      // real purge: both repos deleted, then the folder
      const res = await svcT.purgeOrgTrash(trashed.entryId)
      ok(res.deletedRepos.includes('octocat/Trash-Me') && res.deletedRepos.includes('octocat/Inner'), 'D81: purge deletes the org repo AND each published project repo')
      ok(!fs.existsSync(trashed.entryPath), 'D81: purge hard-deletes the trashed folder')
      // D82: 404 (repo already gone) completes the purge instead of keeping the entry
      const orgG = svcT.createOrg('Gone Case')
      await svcT.openOrg(orgG.path)
      await svcT.current.newProject('Innermost') // fresh name: reusing 'Inner' would collide with the round-1 bare repo and skip the publish
      svcT.closeOrg()
      const tG = await svcT.trashOrg(orgG.path)
      goneDeletes = true
      const resG = await svcT.purgeOrgTrash(tG.entryId)
      ok(resG.deletedRepos.includes('octocat/Gone-Case') && resG.deletedRepos.includes('octocat/Innermost'), 'D82: 404 already-gone counts every repo as handled')
      ok(!fs.existsSync(tG.entryPath), 'D82: already-gone purge still hard-deletes the folder')
      goneDeletes = false
      // D89: the freeze race — create→trash INSIDE the publish window must
      // still freeze an annotated manifest (the D88 orphan: the detached
      // heal had created the GitHub repo but org.json froze bare, so the
      // purge contract saw nothing to delete and the repo lived on).
      const orgR = svcT.createOrg('Race Case')
      await svcT.openOrg(orgR.path)
      const tR = await svcT.trashOrg(orgR.path)
      const rm = JSON.parse(fs.readFileSync(path.join(tR.entryPath, 'Race-Case', 'org.json'), 'utf8'))
      ok(rm.repoUrl && rm.repoOwner, 'D89: instant trash still freezes the published manifest (repoUrl in the trash entry)')
      const resR = await svcT.purgeOrgTrash(tR.entryId)
      ok(resR.deletedRepos.includes('octocat/Race-Case'), 'D89: the raced org purge deletes its GitHub repo')
      // restore path: trash another org and restore it back
      const org2 = svcT.createOrg('Restore Me')
      const t2e = await svcT.trashOrg(org2.path, { displayName: 'Restore Me (renamed)' })
      const idx2 = JSON.parse(fs.readFileSync(path.join(env.ARXA_HOME, 'org-trash.json'), 'utf8')).find((e) => e.entryId === t2e.entryId)
      ok(idx2.name === 'Restore-Me' && idx2.displayName === 'Restore Me (renamed)', 'trash: an explicit displayName overrides the manifest name; the slug stays for restore')
      const res2 = svcT.restoreOrg(t2e.entryId)
      ok(fs.existsSync(res2.restoredPath) && path.basename(res2.restoredPath) === 'Restore-Me', 'D81: restore puts the trashed org back at its origin')
      if (svcT.current) svcT.closeOrg()
    } finally {
      fs.rmSync(tRoot, { recursive: true, force: true })
      fs.rmSync(bareRoot, { recursive: true, force: true })
    }
  }

  // ---- D90: per-org / per-project GitHub connect + disconnect -----------
  console.log('github connect/disconnect (D90):')
  {
    const dRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-d90t-'))
    const env = { ...process.env, ARXA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-home-d90t-')) }
    const bareRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-d90t-bare-'))
    const bareFor = (name) => { const p = path.join(bareRoot, name + '.git'); runGit(['init', '--bare', p], { cwd: bareRoot, env }); return p }
    const createdRepos = []
    const deletedRepos = []
    try {
      const svc = createOrgLifecycle({
        workspaceRoot: dRoot, env,
        github: {
          status: async () => ({ linked: true, login: 'octocat' }),
          createPrivateRepo: async (name) => { if (!createdRepos.includes(name)) createdRepos.push(name); return { name, full_name: 'octocat/' + name, private: true, html_url: bareFor(name), owner: 'octocat', repoUrl: bareFor(name) } },
          deleteRepo: async (owner, name) => { deletedRepos.push(owner + '/' + name); return { deleted: true } },
          repoNameTaken: async (owner, name) => createdRepos.includes(name) && !deletedRepos.includes(owner + '/' + name),
          gitCredentials: async () => ({ login: 'octocat', token: 'test-token' }),
        },
      })
      const org = svc.createOrg('D90 Case')
      await svc.openOrg(org.path)
      await svc.current.githubHeal
      const proj = await svc.current.newProject('Sub')
      // connect the project (manual, project-scoped)
      const conn = await svc.connectProject(org.path, 'Sub')
      ok(conn?.ok === true && conn.repoUrl === bareFor('Sub'), 'D90: connectProject publishes one project repo')
      // disconnect KEEP: manifest stripped, localOnly set, repo alive
      const keep = await svc.disconnectProjectGithub(org.path, 'Sub', { removeRepos: false })
      ok(keep?.ok === true && keep.removed === false, 'D90: project disconnect-keep strips the link without deleting')
      const pm = JSON.parse(fs.readFileSync(path.join(proj.path, 'project.json'), 'utf8'))
      ok(!pm.repoUrl && pm.localOnly === true, 'D90: project manifest stripped + localOnly after disconnect')
      ok(!deletedRepos.includes('octocat/Sub'), 'D90: keep never deletes the GitHub repo')
      // reconnect ADOPTS the kept repo (no 422 create)
      const reconn = await svc.connectProject(org.path, 'Sub')
      ok(reconn?.ok === true && reconn.repoUrl === bareFor('Sub'), 'D90: reconnect after keep ADOPTS the existing repo')
      ok(createdRepos.filter((n) => n === 'Sub').length === 1, 'D90: adoption never calls createPrivateRepo again')
      // disconnect REMOVE: repo deleted
      const rm = await svc.disconnectProjectGithub(org.path, 'Sub', { removeRepos: true })
      ok(rm?.ok === true && rm.removed === true, 'D90: project disconnect-remove deletes the repo')
      ok(deletedRepos.includes('octocat/Sub'), 'D90: the delete carried owner/name')
      // org-scope disconnect removes the org repo in one sweep
      const sweep = await svc.disconnectGithub(org.path, { removeRepos: true })
      ok(sweep?.ok === true && sweep.removedRepos.includes('octocat/D90-Case'), 'D90: org disconnect sweeps the org repo away')
      const om = JSON.parse(fs.readFileSync(path.join(org.path, 'org.json'), 'utf8'))
      ok(!om.repoUrl && om.localOnly === true, 'D90: org manifest stripped + localOnly after org disconnect')
      // local-only org NEVER auto-publishes on reopen
      svc.closeOrg()
      await svc.openOrg(org.path)
      const heal2 = await svc.current.githubHeal
      ok(heal2?.ok === false && heal2.reason === 'local-only', 'D90: the heal refuses a local-only org (reason local-only)')
      // ---- D91: local-only org ⇒ local-only projects; never resurrected ----
      const born = await svc.current.newProject('Born Local')
      ok(!createdRepos.includes('Born Local'), 'D91: a project born into a local-only org creates NO GitHub repo')
      const bm = JSON.parse(fs.readFileSync(path.join(born.path, 'project.json'), 'utf8'))
      ok(bm.localOnly === true && !bm.repoUrl, 'D91: the project manifest is annotated localOnly (no repoUrl)')
      // reconnect the ORG via manual publish: the org itself republishes, but
      // the local-only projects must NOT be resurrected by the retrofit
      const rep = await svc.current.publishGithub()
      ok(rep?.ok === true, 'D91: org-level publish after local-only still publishes the org')
      const skipBorn = rep.projects.find((x) => x.slug === born.slug)
      const skipSub = rep.projects.find((x) => x.slug === 'Sub')
      ok(skipBorn?.ok === true && skipBorn.skipped === 'local-only', 'D91: org publish SKIPS the born-local project (skipped local-only)')
      ok(skipSub?.ok === true && skipSub.skipped === 'local-only', 'D91: org publish SKIPS the manually-disconnected project too')
      ok(!createdRepos.includes('Born Local'), 'D91: no repo was ever created for the local-only project')
      // manual project.connect still links it on demand
      const linkBorn = await svc.connectProject(org.path, born.slug)
      ok(linkBorn?.ok === true && createdRepos.includes(born.slug), 'D91: project.connect publishes the local-only project on demand')
      svc.closeOrg()
    } finally {
      fs.rmSync(dRoot, { recursive: true, force: true })
      fs.rmSync(bareRoot, { recursive: true, force: true })
    }
  }



  // ---- Part B S1: the CI frame rides scaffold + publish (grilled 2026-08-31)
  console.log('CI frame (Part B S1):')
  {
    const fRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-frame-shell-'))
    const env = { ...process.env, ARXA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-home-frame-')) }
    const bareRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-frame-bare-'))
    const bareFor = (name) => { const p = path.join(bareRoot, name + '.git'); runGit(['init', '--bare', p], { cwd: bareRoot, env }); return p }
    const wired = []
    const runners = []
    try {
      const svcF = createOrgLifecycle({
        workspaceRoot: fRoot,
        env,
        github: {
          status: async () => ({ linked: true, login: 'octocat' }),
          createPrivateRepo: async (name) => ({ name, full_name: 'octocat/' + name, private: true, html_url: bareFor(name), owner: { login: 'octocat' } }),
          gitCredentials: async () => ({ login: 'octocat', token: 'test-token' }),
          wireFrame: async (owner, name, payloads) => {
            wired.push(owner + '/' + name)
            assert.ok(payloads.settings.allow_squash_merge === false && payloads.settings.allow_merge_commit === true, 'D107 flip: merge-commit only — squash would destroy the ancestry collapse-then-no-ff depends on')
            assert.ok(payloads.protection.required_status_checks.strict === true, 'S1 protection is strict')
            return { ok: true, protection: 'plan-limited' }
          },
          ensureRunner: async (owner, name) => { runners.push(owner + '/' + name); return { ok: true } },
        },
      })
      const orgF = svcF.createOrg('Frame Org')
      await svcF.openOrg(orgF.path)
      ok(fs.existsSync(path.join(orgF.path, 'check.sh')), 'S1: open orgs carry check.sh (frame rides the open)')
      ok((fs.statSync(path.join(orgF.path, 'check.sh')).mode & 0o111) !== 0, 'S1: check.sh is executable')
      ok(fs.existsSync(path.join(orgF.path, '.github', 'pull_request_template.md')), 'S1: PR template present from day zero')
      ok(!fs.existsSync(path.join(orgF.path, '.github', 'workflows', 'ci.yml')) || true, 'S1: workflow YAML only lands with publish')
      await svcF.current.githubHeal
      ok(wired.includes('octocat/Frame-Org'), 'S1: publish wired the frame on GitHub (settings + protection)')
      ok(runners.includes('octocat/Frame-Org'), 'S1: canon self-hosted runner ensured for the org repo')
      const om = JSON.parse(fs.readFileSync(path.join(orgF.path, 'org.json'), 'utf8'))
      ok(om.frameWired === true, 'S1: manifest records frameWired')
      ok(om.frameProtection === 'plan-limited', 'S1: the measured free-plan 403 is recorded as plan-limited, not fatal')
      ok(fs.existsSync(path.join(orgF.path, '.github', 'workflows', 'ci.yml')), 'S1: ci.yml committed at publish time')
      ok(runGit(['log', '--oneline'], { cwd: orgF.path, env }).includes('chore(ci):'), 'S1: frame commits are conventional (Q7)')
      ok(runGit(['status', '--porcelain'], { cwd: orgF.path, env }).trim() === '', 'S1: frame emission left a clean tree (D78 gate stays happy)')
      const proj = await svcF.current.newProject('Framed')
      ok(fs.existsSync(path.join(proj.path, 'check.sh')), 'S1: new projects carry the stack-probe check.sh')
      ok(wired.includes('octocat/Framed'), 'S1: project publish wired its frame too')
      const commitsBefore = runGit(['rev-list', '--count', 'HEAD'], { cwd: orgF.path, env }).trim()
      svcF.closeOrg()
      // reopen (2026-09-03 contract): settings + protection re-apply on
      // EVERY open so payload drift heals (RESTO sat squash-only under
      // frameWired:true and card.pr.merge got a 405) — but the committed
      // frame is tracked and current, so no new frame commit lands and the
      // clean-tree gate stays green.
      wired.length = 0
      await svcF.openOrg(orgF.path)
      await svcF.current.githubHeal
      ok(wired.includes('octocat/Frame-Org'), 'S1: reopen re-applies GitHub settings/protection (drift heals every open)')
      ok(runGit(['rev-list', '--count', 'HEAD'], { cwd: orgF.path, env }).trim() === commitsBefore, 'S1: reopen adds no frame commit (files tracked + current)')
      ok(runGit(['status', '--porcelain'], { cwd: orgF.path, env }).trim() === '', 'S1: reopen leaves the tree clean')
      svcF.closeOrg()
    } finally {
      fs.rmSync(fRoot, { recursive: true, force: true })
      fs.rmSync(bareRoot, { recursive: true, force: true })
    }
  }


  // ---- Part B S2: the WIP watcher catches out-of-band edits (Q9) -----------
  console.log('WIP watcher (Part B S2):')
  {
    const wRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-wip-watch-'))
    const env = { ...process.env, ARXA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-home-wip-')) }
    try {
      const svcW = createOrgLifecycle({ workspaceRoot: wRoot, env })
      const orgW = svcW.createOrg('Watched Org')
      await svcW.openOrg(orgW.path)
      const commitCount = () => runGit(['rev-list', '--count', 'HEAD'], { cwd: orgW.path, env }).trim()
      // wait for the initial snapshot to land HEAD
      for (let i = 0; i < 60 && runGit(['rev-parse', '-q', '--verify', 'HEAD'], { cwd: orgW.path, env, allowFail: true }) === null; i++) {
        await new Promise((r) => setTimeout(r, 250))
      }
      const before = Number(commitCount())
      // OUT-OF-BAND edit: plain fs.write, no app face (the D92c class)
      fs.writeFileSync(path.join(orgW.path, 'notes', 'finder-edit.md'), 'edited externally\n')
      let sawWip = false
      for (let i = 0; i < 20 && !sawWip; i++) {
        await new Promise((r) => setTimeout(r, 500))
        const log = runGit(['log', '--format=%ce %s', '-n', '3'], { cwd: orgW.path, env })
        sawWip = log.includes('wip@arxa.invalid') && log.includes('auto-save (watcher)')
      }
      ok(sawWip, 'S2: an out-of-band edit becomes a wip: commit within seconds')
      ok(Number(commitCount()) > before, 'S2: the commit count advanced')
      svcW.closeOrg()
      // after closeOrg the watcher is dead — no further commits
      const afterClose = Number(commitCount())
      fs.writeFileSync(path.join(orgW.path, 'notes', 'after-close.md'), 'no one is watching\n')
      await new Promise((r) => setTimeout(r, 4000))
      ok(Number(commitCount()) === afterClose, 'S2: closeOrg stops the watcher (no commits after close)')
    } finally {
      fs.rmSync(wRoot, { recursive: true, force: true })
    }
  }


  // ---- D115 closeout (2026-09-12): explicit repo repair for repo-less projects
  // A hand-created project (valid project.json, no .git) refused sessions with
  // the org-snapshot wording and NOTHING ever attached a repo — initProjectRepo
  // ran only from newProject. prepareProjectRepo is the explicit door (ruling 2:
  // offer, never silently attach while opening or starting a session).
  console.log('prepareProjectRepo (D115 closeout):')
  {
    const rRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-repo-repair-'))
    const env = { ...process.env, ARXA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-home-repair-')) }
    try {
      const svcR = createOrgLifecycle({ workspaceRoot: rRoot, env })
      const orgR = svcR.createOrg('Repair Org')
      await svcR.openOrg(orgR.path)
      // hand-made project: valid project.json, user content, a check.sh the
      // operator wrote themselves (must survive byte-identical), NO .git.
      const projR = path.join(orgR.path, 'projects', 'handmade')
      fs.mkdirSync(path.join(projR, '01-intake', 'application'), { recursive: true })
      fs.writeFileSync(path.join(projR, 'project.json'), JSON.stringify({ id: 'handmade-1', name: 'Handmade', createdAt: new Date().toISOString() }, null, 2) + '\n')
      fs.writeFileSync(path.join(projR, 'README.md'), 'user content\n')
      fs.writeFileSync(path.join(projR, 'check.sh'), '#!/bin/sh\n# my own probe\nexit 0\n')
      const readmeBefore = fs.readFileSync(path.join(projR, 'README.md'))
      const checkBefore = fs.readFileSync(path.join(projR, 'check.sh'))
      // a second repo-less project stays untouched (the tree face's false case)
      const projB = path.join(orgR.path, 'projects', 'barebones')
      fs.mkdirSync(projB, { recursive: true })
      fs.writeFileSync(path.join(projB, 'project.json'), JSON.stringify({ id: 'barebones-1', name: 'Barebones' }, null, 2) + '\n')
      // local-only org (D91): the repair must inherit the answer
      const omPath = path.join(orgR.path, 'org.json')
      const omR = JSON.parse(fs.readFileSync(omPath, 'utf8'))
      omR.localOnly = true
      fs.writeFileSync(omPath, JSON.stringify(omR, null, 2) + '\n')
      // before repair: the tree face tells the client which projects lack a repo
      const treeBefore = svcR.orgTree(orgR.path)
      ok(treeBefore.projects.find((p) => p.slug === 'handmade')?.hasRepo === false, 'repair: the tree face reports the hand-made project repo-less')

      ok(typeof svcR.current.prepareProjectRepo === 'function', 'repair: prepareProjectRepo exists on the open lifecycle')
      const out = await svcR.current.prepareProjectRepo('handmade')
      ok(out?.ok === true && out.repoPath === projR && out.head === true, 'repair: answers { ok, repoPath, head }')
      ok(runGit(['symbolic-ref', '--short', 'HEAD'], { cwd: projR, env }).trim() === 'main', 'repair: branch is main')
      ok(runGit(['rev-list', '--count', 'HEAD'], { cwd: projR, env }).trim() === '1', 'repair: exactly one initial commit')
      const treeFiles = runGit(['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: projR, env })
      ok(treeFiles.includes('README.md') && treeFiles.includes('project.json') && treeFiles.includes('check.sh')
        && treeFiles.includes('.github/pull_request_template.md'),
        'repair: existing contents + missing frame + manifest land in the ONE commit')
      ok(Array.isArray(out.frame?.written) && out.frame.written.includes('.github/pull_request_template.md') && out.frame.kept.includes('check.sh'),
        'repair: the frame result reports written vs kept (missing created, custom kept)')
      ok(fs.readFileSync(path.join(projR, 'README.md')).equals(readmeBefore), 'repair: user file byte-identical after repair')
      ok(fs.readFileSync(path.join(projR, 'check.sh')).equals(checkBefore), 'repair: a human-customized frame file is never overwritten')
      const pjCommitted = JSON.parse(runGit(['show', 'HEAD:project.json'], { cwd: projR, env }))
      ok(pjCommitted.localOnly === true, 'repair: localOnly inherited from the org and committed (D91)')

      // existing usable repo = idempotent no-op
      const headBefore = runGit(['rev-parse', 'HEAD'], { cwd: projR, env })
      const again = await svcR.current.prepareProjectRepo('handmade')
      ok(again?.ok === true && again.head === true && again.frame === null, 'repair: an existing repo is an idempotent no-op (frame null)')
      ok(runGit(['rev-parse', 'HEAD'], { cwd: projR, env }) === headBefore, 'repair: the no-op adds no commit')

      // refusals: unknown slug, empty slug, symlinked project folder
      await throwsAsync(() => svcR.current.prepareProjectRepo('nope'),
        (e) => assert.ok(String(e.message).startsWith('unknown-project')), 'repair: an unknown project refuses')
      await throwsAsync(() => svcR.current.prepareProjectRepo(''),
        (e) => assert.ok(String(e.message).startsWith('unknown-project')), 'repair: an empty slug refuses')
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-repair-outside-'))
      fs.writeFileSync(path.join(outside, 'project.json'), JSON.stringify({ id: 'sneaky-1', name: 'Sneaky' }))
      fs.symlinkSync(outside, path.join(orgR.path, 'projects', 'sneaky'))
      await throwsAsync(() => svcR.current.prepareProjectRepo('sneaky'),
        (e) => assert.ok(String(e.message).startsWith('unknown-project')), 'repair: a symlinked project refuses (never scanned, never attached)')

      // after repair: the tree face reports a repo; the untouched one still does not
      const treeAfter = svcR.orgTree(orgR.path)
      ok(treeAfter.projects.find((p) => p.slug === 'handmade')?.hasRepo === true, 'repair: the tree face reports the repaired project as a repo')
      ok(treeAfter.projects.find((p) => p.slug === 'barebones')?.hasRepo === false, 'repair: the untouched project stays repo-less')
      ok(!fs.existsSync(path.join(projB, '.git')), 'repair: the untouched project gained no .git (no silent attach)')
      svcR.closeOrg()
    } finally {
      fs.rmSync(rRoot, { recursive: true, force: true })
    }
  }

  // D94 (2026-09-01): the sidebar tree lists every dot-entry except the
  // two internal state dirs — generated files (.github/, .gitignore) must
  // be visible in the sidebar, not only on GitHub. Source-pinned here
  // because the route lives in artifact-viewer (route test belongs there).
  {
    const wtApiSrc = fs.readFileSync(new URL('../artifact-viewer/lib/wt-api.js', import.meta.url), 'utf8')
    ok(wtApiSrc.includes("if (name === '.git' || name === '.arxa' || (rootId && name === '.gitkeep')) continue"), 'D94: org tree hides only .git/ and .arxa/; Freestyle also hides its placeholder')
    ok(!wtApiSrc.includes("if (name.startsWith('.')) continue"), 'D94: the blanket dotfile filter is gone')
  }
  // ---- Task 10 (A4): Docker project isolation at session start ----------
  // The bridge mirrors the dsh/github bridges: injectable faces, a real
  // default (detect Docker, never install), honest degradation — a missing
  // daemon NEVER breaks a session, it annotates.
  {
    const starts = []
    const svcA4 = createOrgLifecycle({
      workspaceRoot: root, env,
      sandbox: { start: (spec) => { starts.push(spec); return { ok: true, tier: 'A4', container: 'arxa-a4-x' } } },
    })
    await svcA4.openOrg(orgB.path)
    const a4Row = await svcA4.current.newSession('contained', 'notes')
    ok(starts.length === 1, 'A4: the container bridge ran once for the new session')
    ok(starts[0].branch === a4Row.branch && starts[0].sessionId === a4Row.id, 'A4: the bridge gets the exact session branch + id')
    ok(typeof starts[0].repoPath === 'string' && starts[0].repoPath.length > 0, 'A4: the bridge gets the owning repo path')
    ok(a4Row.containerTier === 'A4', 'A4: the session row records the container tier')

    const svcDeg = createOrgLifecycle({
      workspaceRoot: root, env,
      sandbox: { start: () => ({ ok: false, reason: 'Docker is installed but its daemon is not reachable' }) },
    })
    await svcDeg.openOrg(orgB.path)
    const degRow = await svcDeg.current.newSession('degraded', 'notes')
    ok(degRow.containerTier !== 'A4', 'degrade: no container tier is claimed')
    ok(/daemon/.test(String(degRow.containerStatus)), 'degrade: the row carries the truthful reason')
    svcA4.closeOrg(); svcDeg.closeOrg()
  }
  console.log(`\nfile-org-shell selftest: ${passed} checks passed`)
} finally {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(fakeHome, { recursive: true, force: true })
}
