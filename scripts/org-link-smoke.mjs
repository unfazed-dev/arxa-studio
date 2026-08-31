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
