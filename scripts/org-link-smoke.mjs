#!/usr/bin/env node
/** D90 live smoke: the full GitHub link lifecycle against the REAL engine
 * and the REAL GitHub account (the org-purge-smoke pattern). Covers the
 * engine paths the lens E2E drives from the menus:
 *   create local-only -> connect -> disconnect KEEP -> reconnect (through
 *   the preserved origin) -> disconnect REMOVE (typed-gate backend) ->
 *   trash + purge a local-only org without any GitHub requirement.
 * Exits non-zero on the FIRST broken contract. Name is unique per run.
 */
const BASE = process.env.ARXA_BASE || 'http://127.0.0.1:7891'
const NAME = 'D90SMOKE' + Date.now().toString(36).toUpperCase().slice(-6)

const post = (action, arg) =>
  fetch(BASE + '/__arxa/sidebar/action', {
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

const fail = (msg) => {
  console.error('SMOKE FAIL: ' + msg)
  process.exit(1)
}

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
{
  const fs = await import('node:fs')
  const p = await import('node:path')
  fs.writeFileSync(p.join(orgRow.path, 'notes', 'card-smoke.md'), 'written out of band\n')
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
if (!cm.ok || !cm.result || cm.result.merged !== true) fail('S5: card.commit boundary failed: ' + JSON.stringify(cm).slice(0, 300))
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
  const deadline = Date.now() + 150000
  let green = pst.result.checks.state === 'green'
  while (!green && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000))
    const again = await post('card.pr.status', { sessionId: sid })
    green = again.ok && again.result && again.result.checks && again.result.checks.state === 'green'
  }
  if (!green) fail('S5: frame checks did not go green before merge')
}
{
  const { execFileSync } = await import('node:child_process')
  try {
    execFileSync('gh', ['pr', 'merge', String(pr.result.pr.number), '--squash', '--repo', 'unfazed-dev/' + NAME], { encoding: 'utf8', stdio: 'pipe' })
  } catch (e) {
    fail('S5: gh pr merge --squash failed: ' + String(e.message).slice(0, 200))
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
if (!trashed.ok) fail('trash failed: ' + JSON.stringify(trashed).slice(0, 200))
const sAfter = await state()
const entry = (sAfter.orgTrash || []).find((e) => (e.name || '').toUpperCase() === NAME)
if (!entry) fail('org trash entry not found for ' + NAME)
const purged = await post('orgtrash.purge', { entryId: entry.entryId })
if (!purged.ok) fail('local-only purge failed: ' + JSON.stringify(purged).slice(0, 300))
if ((await ghRepo(NAME)) !== null) fail('repo reappeared after purge?!')
console.log('6. purge local-only: no GitHub needed, folder gone OK')

console.log('ORG-LINK SMOKE: ALL GREEN (' + NAME + ')')
