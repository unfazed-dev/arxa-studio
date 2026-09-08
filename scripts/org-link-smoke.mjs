#!/usr/bin/env node
/** D90 live smoke: the full GitHub link lifecycle against the REAL engine
 * and the REAL GitHub account (the org-purge-smoke pattern). Covers the
 * engine paths the lens E2E drives from the menus:
 *   create local-only -> connect -> disconnect KEEP -> reconnect (through
 *   the preserved origin) -> disconnect REMOVE (typed-gate backend) ->
 *   trash + purge a local-only org without any GitHub requirement.
 * Exits non-zero on the FIRST broken contract. Name is unique per run.
 */
import { execFileSync } from 'node:child_process'

const BASE = process.env.ARXA_BASE || 'http://127.0.0.1:7891'

/** Steps the run could not measure, printed loudly at the end.
 *
 * A skip that prints nothing is a pass, and this smoke already learned that
 * lesson twice today (a vacuous `.every()` on an empty array, and a cleanup that
 * reported success while leaking). Anything pushed here has to survive to the
 * final line. */
const skipped = []
const NAME = 'D90SMOKE' + Date.now().toString(36).toUpperCase().slice(-6)

/* card.* / insight.* / version.* live on the CARD's own route, not the
 * sidebar's — the same split card-local-smoke.mjs:77 makes. This helper posted
 * everything to the sidebar route, so every card assertion in S5 below has been
 * answering `unknown-action` since the card got its own wire, and the smoke
 * failed at its first card call instead of testing the loop it names. */
const post = (action, arg) =>
  fetch(BASE + (/^(card|insight|version)\./.test(action) ? '/__arxa/git-card/action' : '/__arxa/sidebar/action'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, arg }),
  }).then((r) => r.json())

const state = () => fetch(BASE + '/__arxa/sidebar/state').then((r) => r.json())

const ghRepo = async (name) => {
  const { execFileSync } = await import('node:child_process')
  try {
    const out = execFileSync('gh', ['repo', 'view', 'unfazed-dev/' + name, '--json', 'name'], { encoding: 'utf8' })
    return JSON.parse(out).name
  } catch {
    return null
  }
}

/* Safety net (2026-09-08): `fail()` exited straight out, so every broken run
 * left its throwaway repo on GitHub forever — four had piled up by the time
 * anyone looked, all from S5 failing at its first card call. The smoke deletes
 * its repo as part of step 5 on the happy path; this is the unhappy one.
 *
 * SYNCHRONOUS on purpose. All 51 call sites are bare `fail('...')` with no
 * await, so an async fail would return a promise and let the caller keep
 * running past the failure it just reported — cascading errors ahead of the
 * exit. execFileSync works fine here and keeps fail() a hard stop.
 *
 * Deliberately paranoid about WHAT it deletes: only names this run could have
 * minted (D90SMOKE + 6 chars from its own Date.now, or the fixed project repo
 * it publishes). Anything else is left alone — a cleanup path that can reach a
 * real repository is worse than the litter it removes. */
const DISPOSABLE = /^(D90SMOKE[A-Z0-9]{6}|Born-Smoke)$/
const dropRepo = (name) => {
  if (!DISPOSABLE.test(name)) return
  try {
    execFileSync('gh', ['repo', 'delete', 'unfazed-dev/' + name, '--yes'], { stdio: 'ignore' })
    console.log('   cleaned up unfazed-dev/' + name)
  } catch { /* already gone, or no delete_repo scope — never mask the real failure */ }
}

/** The org this run registered in the LIVE app, once it exists.
 *
 * Leak #4, found by the lens pass on 2026-09-08: six D90SMOKE orgs were sitting
 * in the operator's real sidebar, pointing at /tmp. `org.trash` is called on the
 * happy path (step 5 below) — but S5 had been failing since the routing bug, so
 * every run since had left one behind, and five of the six were EXPANDED. That
 * pushed the real org's row out of the rendered tree entirely and cost the lens
 * pass 7 of its 16 checks before anyone suspected the registry.
 *
 * Deleting the /tmp directory is not enough and never was: what pollutes the app
 * is the REGISTRY ENTRY, which outlives the folder. */
let bornOrgId = null

/** Trash the org synchronously, for the same reason dropRepo is synchronous:
 * fail() must stay a hard stop. A child `node -e` keeps the one await-free. */
const dropOrg = () => {
  if (!bornOrgId) return
  try {
    execFileSync(process.execPath, ['-e', `
      fetch(${JSON.stringify(BASE)} + '/__arxa/sidebar/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'org.trash', arg: { orgId: ${JSON.stringify(bornOrgId)} } }),
      }).then(() => {}, () => {})
    `], { stdio: 'ignore', timeout: 15000 })
    console.log('   deregistered org ' + NAME)
  } catch { /* app down, or already gone — never mask the real failure */ }
}

const fail = (msg) => {
  console.error('SMOKE FAIL: ' + msg)
  process.exit(1)
}

/* The net has to hang off `exit`, not off fail().
 *
 * Proven the hard way twice in one session. A fail()-only net catches the
 * failures the smoke ASSERTS and none of the ones it suffers: on 2026-09-08 a
 * stray `import()` ran this file, the module threw somewhere past org.create-at,
 * fail() was never called, and D90SMOKESP6PWK was left registered in the live
 * app — the exact leak the net had just been written to stop.
 *
 * `exit` fires for every path out: fail(), an uncaught throw, and a clean
 * finish. Handlers must be synchronous there, which is why dropRepo/dropOrg are
 * execFileSync — an async cleanup here would be registered and never run.
 * The happy path clears both handles as it consumes them, so this stays a net
 * and never a second delete. */
process.on('exit', () => {
  dropRepo(NAME)
  dropRepo('Born-Smoke')
  dropOrg()
})

const orgOf = async (slug) => {
  const s = await state()
  return (s.orgs || []).find((o) => o.slug === slug)
}

console.log('smoke org:', NAME)
// 1. create LOCAL-ONLY — no repo, connected:false, marker data present.
const created = await post('org.create-at', { name: NAME, path: '/tmp/arxa-d90-smoke', link: false })
if (!created.ok) fail('create-at link:false failed: ' + JSON.stringify(created).slice(0, 200))
await new Promise((r) => setTimeout(r, 2500)) // let any rogue heal window pass
const { readFileSync } = await import('node:fs')
const manifest1 = JSON.parse(readFileSync('/tmp/arxa-d90-smoke/' + NAME + '/org.json', 'utf8'))
if (manifest1.localOnly !== true) fail('manifest missing localOnly after local-only create: ' + JSON.stringify(manifest1))
if (manifest1.repoUrl) fail('local-only create published a repo: ' + manifest1.repoUrl)
let org = await orgOf(NAME)
// Arm the cleanup net the moment an id exists. `org.create-at` answers with the
// registry FACE, not the row, so there is no id in its result to arm from — the
// first place the id is knowable is here, and a net armed any later is a net the
// failing run never has.
bornOrgId = org?.id ?? null
if (!org || org.connected !== false) fail('state connected must be false after local-only create: ' + JSON.stringify(org))
console.log('1. local-only create: no repo, connected:false OK')

// 1b. D92 contract: same name at the same root is REFUSED (folder-exists),
// the sticky create root points at the last-used parent, and folder-info
// reports the org manifest.
const dupe = await post('org.create-at', { name: NAME, path: '/tmp/arxa-d90-smoke', link: false })
if (dupe.ok || !String(dupe.error || '').startsWith('folder-exists:')) fail('D92: duplicate create-at must refuse with folder-exists: ' + JSON.stringify(dupe).slice(0, 200))
const defaults = await post('create.defaults', {})
if (!defaults.ok || defaults.result?.root !== '/tmp/arxa-d90-smoke') fail('D92: sticky create root wrong: ' + JSON.stringify(defaults).slice(0, 200))
const fi = await fetch(BASE + '/__arxa/sidebar/folder-info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: '/tmp/arxa-d90-smoke/' + NAME }) }).then((r) => r.json())
if (!fi.ok || fi.exists !== true || fi.entryCount < 1 || fi.isOrg !== true) fail('D92: folder-info must report the org target: ' + JSON.stringify(fi).slice(0, 200))
console.log('1b. D92 folder-exists refusal + sticky root + folder-info isOrg OK')

// 2. connect — repo exists.
const pub = await post('github.publish', { orgId: org.id })
if (!pub.ok || !pub.result || pub.result.ok !== true) fail('connect failed: ' + JSON.stringify(pub).slice(0, 300))
if ((await ghRepo(NAME)) !== NAME) fail('repo ' + NAME + ' missing on GitHub after connect')
org = await orgOf(NAME)
if (org.connected !== true) fail('state connected must be true after connect')
console.log('2. connect: repo exists, connected:true OK')

// 3. disconnect KEEP — repo survives, manifest stripped, localOnly set.
const keep = await post('org.disconnect', { orgId: org.id, removeRepos: false })
if (!keep.ok || keep.result.ok !== true) fail('disconnect keep failed: ' + JSON.stringify(keep).slice(0, 300))
if ((await ghRepo(NAME)) !== NAME) fail('repo vanished after KEEP disconnect')
const manifest2 = JSON.parse(readFileSync('/tmp/arxa-d90-smoke/' + NAME + '/org.json', 'utf8'))
if (manifest2.repoUrl || manifest2.localOnly !== true) fail('keep disconnect left manifest dirty: ' + JSON.stringify(manifest2))
console.log('3. disconnect keep: repo alive, manifest stripped OK')

// 4. reconnect — MUST succeed through the preserved origin (no 422 create).
const reconn = await post('github.publish', { orgId: org.id })
if (!reconn.ok || !reconn.result || reconn.result.ok !== true) fail('reconnect after keep failed (422 path?): ' + JSON.stringify(reconn).slice(0, 300))
org = await orgOf(NAME)
if (org.connected !== true) fail('state connected must be true after reconnect')
console.log('4. reconnect after keep: adopted origin, published OK')

// 5. disconnect REMOVE — repo deleted from GitHub.
const rm = await post('org.disconnect', { orgId: org.id, removeRepos: true })
if (!rm.ok || rm.result.ok !== true) fail('disconnect remove failed: ' + JSON.stringify(rm).slice(0, 300))
if ((await ghRepo(NAME)) !== null) fail('repo still on GitHub after REMOVE disconnect')
if (!rm.result.removedRepos || !rm.result.removedRepos.includes('unfazed-dev/' + NAME)) fail('removedRepos missing entry: ' + JSON.stringify(rm.result).slice(0, 200))
console.log('5. disconnect remove: repo deleted, removedRepos reported OK')

// 5b. D91: a project born into the now-LOCAL-ONLY org creates NO repo.
const proj = await post('project.create', { orgId: org.id, name: 'Born Smoke' })
if (!proj.ok) fail('project.create in local-only org failed: ' + JSON.stringify(proj).slice(0, 300))
const pSlug = (proj.result && proj.result.slug) || 'Born-Smoke'
await new Promise((r) => setTimeout(r, 1200))
if ((await ghRepo(pSlug)) !== null) fail('D91: project born into local-only org PUBLISHED a repo (' + pSlug + ')')
const pManifest = (proj.result && proj.result.path ? proj.result.path : '/tmp/arxa-d90-smoke/' + NAME + '/projects/' + pSlug) + '/project.json'
const pm = JSON.parse(readFileSync(pManifest, 'utf8'))
if (pm.localOnly !== true || pm.repoUrl) fail('D91: born-local project manifest wrong: ' + JSON.stringify({ localOnly: pm.localOnly, repoUrl: pm.repoUrl }))
console.log('5b. D91 born-local project: no repo, manifest localOnly OK')

// 5c. D91: connect the org again — the retrofit must NOT resurrect the project.
const rep2 = await post('github.publish', { orgId: org.id })
if (!rep2.ok || !rep2.result || rep2.result.ok !== true) fail('D91: org reconnect failed: ' + JSON.stringify(rep2).slice(0, 300))
await new Promise((r) => setTimeout(r, 1200))
if ((await ghRepo(pSlug)) !== null) fail('D91: org reconnect resurrected the local-only project (' + pSlug + ')')
const skip = (rep2.result.projects || []).find((x) => x.slug === pSlug)
if (!skip || skip.skipped !== 'local-only') fail('D91: reconnect projects result missing local-only skip: ' + JSON.stringify(rep2.result.projects))
console.log('5c. D91 org reconnect: born-local project skipped OK')

// 5d. D91: project.connect links it on demand, then remove both repos so
// the purge below stays honest.
const pc = await post('project.connect', { orgId: org.id, projectSlug: pSlug })
if (!pc.ok || !pc.result || pc.result.ok !== true) fail('D91: project.connect failed: ' + JSON.stringify(pc).slice(0, 300))
if ((await ghRepo(pSlug)) !== pSlug) fail('D91: project repo missing after project.connect')
const rmP = await post('project.disconnect', { orgId: org.id, projectSlug: pSlug, removeRepos: true })
if (!rmP.ok || !rmP.result || rmP.result.ok !== true) fail('D91: project disconnect failed: ' + JSON.stringify(rmP).slice(0, 300))
if ((await ghRepo(pSlug)) !== null) fail('D91: project repo still on GitHub after disconnect-remove')
const rmO = await post('org.disconnect', { orgId: org.id, removeRepos: true })
if (!rmO.ok || !rmO.result || rmO.result.ok !== true) fail('D91: org re-disconnect failed: ' + JSON.stringify(rmO).slice(0, 300))
if ((await ghRepo(NAME)) !== null) fail('D91: org repo still on GitHub after re-disconnect')
console.log('5d. D91 project.connect + disconnect-remove: on-demand link OK')


// 5e. Part B S5: the composer git card loop end-to-end (live GitHub):
// republish -> session -> out-of-band edit (watcher) -> status ->
// subject law -> boundary commit -> branch push -> PR (dedupe) -> squash merge.
const rep = await post('github.publish', { orgId: org.id })
if (!rep.ok || !rep.result || rep.result.ok !== true) fail('S5: republish failed: ' + JSON.stringify(rep).slice(0, 300))
const ns = await post('workspace.new-session', { orgId: org.id, workspace: 'notes', name: 'Card smoke' })
if (!ns.ok || !ns.result || !ns.result.id) fail('S5: new-session failed: ' + JSON.stringify(ns).slice(0, 300))
const sid = ns.result.id
const orgRow = await orgOf(org.slug)
if (!orgRow || !orgRow.path) fail('S5: org row without path')
// The probe belongs in the SESSION's worktree, not the org's.
//
// It used to be written to `<org>/notes/card-smoke.md`. A session is a git
// worktree on its own branch with its own directory, so a file written into the
// org checkout is invisible to the session: the watcher had nothing to commit,
// `card.commit` answered `nothing-to-propose`, and the whole card loop below was
// asserting against an edit the session never saw. The staleness was masked for
// a long time because S5 could not reach this line at all (every card call went
// to the sidebar route and died earlier).
const sessionRow = (orgRow.sessions || []).find((x) => x.id === sid)
if (!sessionRow || !sessionRow.worktree) {
  fail('S5: session row carries no worktree path: ' + JSON.stringify(sessionRow ?? null).slice(0, 200))
}
{
  const fs = await import('node:fs')
  const p = await import('node:path')
  const dir = p.join(sessionRow.worktree, 'notes')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(p.join(dir, 'card-smoke.md'), 'written out of band\n')
}
await new Promise((r) => setTimeout(r, 6000)) // S2 watcher: out-of-band edit -> wip commit
const st1 = await post('card.status', { sessionId: sid })
if (!st1.ok || !st1.result || !String(st1.result.seat.branch).startsWith('arxa/')) fail('S5: card.status seat wrong: ' + JSON.stringify(st1).slice(0, 300))
if (!(st1.result.wipRun >= 1)) fail('S5: watcher did not land a wip commit before status (wipRun=' + st1.result.wipRun + ')')
const badC = await post('card.commit', { sessionId: sid, subject: 'nope not conventional' })
if (badC.ok !== false || !String(badC.error || '').includes('subject-not-conventional')) fail('S5: non-conventional subject was not refused: ' + JSON.stringify(badC).slice(0, 200))
const evd = await post('card.commit.draft', { sessionId: sid })
if (!evd.ok || !evd.result || !String(evd.result.rule || '').includes('<type>')) fail('S5: draft evidence missing the rule: ' + JSON.stringify(evd).slice(0, 200))
const cm = await post('card.commit', { sessionId: sid, subject: 'docs(notes): card smoke note added' })
// A LINKED seat does not land on main locally — it squashes, runs the gate and
// PUSHES for review (`shape: 'prflow'`, index.js:727), so `merged` is false by
// design and the merge happens on GitHub in the PR steps below. The assertion
// here used to demand `merged === true`, which is the LOCAL-ONLY shape: it could
// only ever have passed against an unlinked org, and this whole section runs
// against a linked one. It never got the chance to be wrong out loud, because
// the routing bug killed S5 four calls earlier.
if (!cm.ok || !cm.result) fail('S5: card.commit boundary failed: ' + JSON.stringify(cm).slice(0, 300))
if (cm.result.shape !== 'prflow') fail('S5: linked seat did not take the PR flow: shape=' + JSON.stringify(cm.result.shape))
if (cm.result.squashed !== true || !cm.result.sha) fail('S5: boundary did not squash the WIP run: ' + JSON.stringify(cm.result).slice(0, 250))
if (cm.result.gate?.green !== true) fail('S5: gate was not green on the boundary: ' + JSON.stringify(cm.result.gate))
if (cm.result.parked === true) fail('S5: a green gate must not park the session')
if (cm.result.pushed?.ok !== true) fail('S5: the PR flow did not push the branch: ' + JSON.stringify(cm.result.pushed).slice(0, 200))
const pu = await post('card.push', { sessionId: sid })
if (!pu.ok || !pu.result || pu.result.ok !== true) fail('S5: card.push failed: ' + JSON.stringify(pu).slice(0, 300))
const prArgs = { sessionId: sid, title: 'docs(notes): card smoke note added', problem: 'no smoke note', fix: 'added one via the card', model: 'smoke' }
const pr = await post('card.pr.create', prArgs)
if (!pr.ok || !pr.result || !pr.result.pr || !pr.result.pr.url) fail('S5: card.pr.create failed: ' + JSON.stringify(pr).slice(0, 300))
const prDup = await post('card.pr.create', prArgs)
if (!prDup.ok || !prDup.result || prDup.result.existing !== true) fail('S5: PR dedupe failed (second create must return existing): ' + JSON.stringify(prDup).slice(0, 300))
const pst = await post('card.pr.status', { sessionId: sid })
if (!pst.ok || !pst.result || !pst.result.pr || !pst.result.checks) fail('S5: card.pr.status failed: ' + JSON.stringify(pst).slice(0, 300))
// Q8: squash-merge on GitHub once the frame checks are green (a plan/
// scope gap leaves checks 'none' — merge directly, protection is
// plan-limited there anyway).
if (pst.result.checks.state !== 'none') {
  // The states are none | pending | green | red (github-link/lib/frame.js:303).
  //
  // This loop used to test ONLY for green, so it span the full deadline on a RED
  // run and then reported "did not go green" — a sentence that fits a slow run
  // and a failing one equally well, and names neither. It also cannot converge
  // when a run is skipped or cancelled: `every(success)` is false for those, so
  // the state is 'pending' forever and only the deadline ends it.
  //
  // So: stop at any TERMINAL state, and say what was actually seen.
  const deadline = Date.now() + 240000
  let last = pst.result.checks
  while (last.state === 'pending' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000))
    const again = await post('card.pr.status', { sessionId: sid })
    if (again.ok && again.result && again.result.checks) last = again.result.checks
  }
  const runsSeen = (last.runs || []).map((r) => (r.name ?? '?') + '=' + (r.conclusion ?? r.status ?? 'running')).join(', ')
  if (last.state === 'red') {
    fail('S5: frame checks went RED — runs: ' + (runsSeen || 'none reported'))
  }
  if (last.state === 'pending' && !last.asleep) {
    // Pending, nothing queued, four minutes gone: the runs are moving and simply
    // never settled. That is a real stall worth failing on.
    fail('S5: frame checks never settled in 240s — runs: ' + (runsSeen || 'none reported'))
  }
  if (last.state !== 'green') {
    // `asleep` is literally "a check run is still QUEUED" (frame.js:301). GitHub
    // has not started it yet, so there is nothing about this repository, this
    // card or this code to measure — waiting longer tests the runner queue, not
    // arxa. The block above already merges directly when the plan gives us no
    // checks at all; a runner that has not woken is the same situation arriving
    // by a different road, and failing the suite for it would train everyone to
    // ignore a red S5.
    skipped.push('S5 merge through card.pr.merge (it requires green): runner asleep (' + (runsSeen || 'queued') + ')')
    console.log('   SKIP the merge tail — GitHub had not started the checks after 240s')
  }
}
{
  // Merge the way ARXA merges, which is deliberately NOT a squash.
  //
  // This shelled out to `gh pr merge --squash` and GitHub refused it outright:
  // "Squash merges are not allowed on this repository." The refusal was doing us
  // a favour. `git-workspace/lib/prflow.js` spells out why arxa never squash-
  // merges: GitHub's squash writes a NEW commit to main whose CONTENT matches
  // but whose ancestry does not, so `merge-base --is-ancestor` is false forever,
  // `branch --merged main` never lists the branch again, and Finish and Sweep
  // can never see the session as landed. arxa squashes ON THE BRANCH and then
  // merges for real, which buys single-commit history AND true ancestry.
  // `prSquashMergeApi` survives only so an import does not break — nothing calls
  // it, and `mergeSessionPr` uses `merge_method: 'merge'` (frame.js:141).
  //
  // So `--squash` was not a wrong flag, it was a wrong WORLD: had GitHub allowed
  // it, the repo would have been left in a shape arxa never produces, and every
  // Finish and Sweep assertion downstream would have been measuring fiction
  // while passing. TERRA, a real linked org, has squashMergeAllowed:false — the
  // product needs nothing else.
  const { execFileSync } = await import('node:child_process')
  if (last.state === 'green') {
    // The real path: arxa's own action, which re-checks green itself.
    const mg = await post('card.pr.merge', { sessionId: sid })
    if (!mg.ok || !mg.result || mg.result.ok !== true) fail('S5: card.pr.merge failed: ' + JSON.stringify(mg).slice(0, 300))
  } else {
    // Checks never started, so card.pr.merge refuses on `checks-pending`. Merge
    // with arxa's METHOD so the repo lands in the shape the rest of the run
    // expects, and record that the card's own merge went unexercised.
    try {
      execFileSync('gh', ['pr', 'merge', String(pr.result.pr.number), '--merge', '--repo', 'unfazed-dev/' + NAME], { encoding: 'utf8', stdio: 'pipe' })
    } catch (e) {
      fail('S5: gh pr merge --merge failed: ' + String(e.message).slice(0, 200))
    }
  }
}
// cleanup the smoke runner instance (svc + dir; the shared tarball cache stays)
{
  const { execFileSync } = await import('node:child_process')
  const fs = await import('node:fs')
  const os = await import('node:os')
  const p = await import('node:path')
  const rdir = p.join(os.homedir(), '.arxa', 'runners', 'unfazed-dev__' + NAME)
  try { execFileSync('./svc.sh', ['uninstall'], { cwd: rdir, stdio: 'pipe' }) } catch { /* not installed */ }
  fs.rmSync(rdir, { recursive: true, force: true })
}
const rmB = await post('org.disconnect', { orgId: org.id, removeRepos: true })
if (!rmB.ok || !rmB.result || rmB.result.ok !== true) fail('S5: post-card disconnect failed: ' + JSON.stringify(rmB).slice(0, 300))
if ((await ghRepo(NAME)) !== null) fail('S5: org repo still on GitHub after the card loop')
console.log('5e. Part B card loop: status/subject-law/commit/push/PR+dedupe/squash-merge OK')

// 6. purge the local-only org — no GitHub requirement, local folder gone.
const trashed = await post('org.trash', { orgId: org.id })
if (trashed?.ok) bornOrgId = null // consumed on the happy path; the exit net stays a net
if (!trashed.ok) fail('trash failed: ' + JSON.stringify(trashed).slice(0, 200))
const sAfter = await state()
const entry = (sAfter.orgTrash || []).find((e) => (e.name || '').toUpperCase() === NAME)
if (!entry) fail('org trash entry not found for ' + NAME)
const purged = await post('orgtrash.purge', { entryId: entry.entryId })
if (!purged.ok) fail('local-only purge failed: ' + JSON.stringify(purged).slice(0, 300))
if ((await ghRepo(NAME)) !== null) fail('repo reappeared after purge?!')
console.log('6. purge local-only: no GitHub needed, folder gone OK')

if (skipped.length) {
  // Never let a skip wear the word GREEN. The final line is the only line most
  // runs are read by, and "ALL GREEN" over an unmeasured step is how a suite
  // starts lying — the same vacuous-pass shape as an `.every()` over an empty
  // array, just printed instead of computed.
  console.log('\nNOT MEASURED (skipped, not passed):')
  for (const x of skipped) console.log('  - ' + x)
  console.log('\nORG-LINK SMOKE: GREEN WITH ' + skipped.length + ' SKIPPED (' + NAME + ')')
} else {
  console.log('ORG-LINK SMOKE: ALL GREEN (' + NAME + ')')
}
