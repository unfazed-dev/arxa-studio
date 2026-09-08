// arxa-artifact-viewer roots selftest — run: node plugins/artifact-viewer/selftest.roots.mjs
// Task 8 (freestyle-section): the viewer follows, lists and watches every
// open Freestyle root beside the open org. Dominant risk under test:
// cross-root token leakage — a token minted for root A must never read
// root B or escape its own root.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
void here

const { readOpenRoots, startRootFollow } = await import('./lib/follow.js')
const { issueToken } = await import('./lib/tokens.js')
const { createTreeRoute } = await import('./lib/wt-api.js')
const { createOrgWatcher } = await import('./lib/watcher.js')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix))
function writeJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(obj))
}

// ---- fixtures: one open org + a Freestyle registry with one open, one closed root
const home = tmp('arxa-roots-home-')
const env = { ARXA_HOME: home }

const orgPath = tmp('arxa-roots-org-')
const orgSlug = path.basename(orgPath)
writeJSON(path.join(home, 'organisation.json'), { orgs: [orgPath] })
writeJSON(path.join(orgPath, '.arxa', 'locks', orgSlug + '.lock'), { pid: process.pid, orgPath })
fs.writeFileSync(path.join(orgPath, 'org-file.md'), '# org\n')

const rootOpenPath = tmp('arxa-roots-open-')
const rootClosedPath = tmp('arxa-roots-closed-')
fs.writeFileSync(path.join(rootOpenPath, 'a.md'), '# a\n')
fs.mkdirSync(path.join(rootOpenPath, 'sub'))
fs.writeFileSync(path.join(rootOpenPath, 'sub', 'b.md'), '# b\n')
fs.writeFileSync(path.join(rootClosedPath, 'z.md'), '# z\n')
const idOpen = 'root-open-1'
const idClosed = 'root-closed-1'
writeJSON(path.join(home, 'freestyle.json'), {
  roots: [
    { id: idOpen, name: 'Open Root', path: rootOpenPath, addedAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString(), open: true },
    { id: idClosed, name: 'Closed Root', path: rootClosedPath, addedAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString(), open: false },
  ],
  ui: { activeTab: 'org' },
})

// ============================================================================
// readOpenRoots: org first, then open Freestyle roots, closed ones excluded
// ============================================================================
{
  const roots = readOpenRoots(env)
  assert.equal(roots.length, 2, 'org + one open freestyle root, closed root excluded')
  assert.equal(roots[0].kind, 'org', 'org listed first')
  assert.equal(roots[0].path, orgPath)
  assert.equal(roots[0].id, orgSlug, 'org id is its slug')
  assert.equal(roots[1].kind, 'freestyle')
  assert.equal(roots[1].id, idOpen)
  assert.equal(roots[1].path, rootOpenPath)
  assert.ok(!roots.some((r) => r.path === rootClosedPath), 'closed root never listed')
  console.log('PASS readOpenRoots: org + open freestyle root only, closed root excluded')
}

// missing/malformed freestyle.json degrades to org-only, never throws
{
  const home2 = tmp('arxa-roots-home2-')
  const env2 = { ARXA_HOME: home2 }
  const org2 = tmp('arxa-roots-org2-')
  const slug2 = path.basename(org2)
  writeJSON(path.join(home2, 'organisation.json'), { orgs: [org2] })
  writeJSON(path.join(org2, '.arxa', 'locks', slug2 + '.lock'), { pid: process.pid, orgPath: org2 })
  const roots2a = readOpenRoots(env2) // no freestyle.json at all
  assert.equal(roots2a.length, 1, 'missing freestyle.json -> org only')
  fs.writeFileSync(path.join(home2, 'freestyle.json'), '{not json')
  const roots2b = readOpenRoots(env2) // malformed freestyle.json
  assert.equal(roots2b.length, 1, 'malformed freestyle.json -> org only, no throw')
  assert.equal(roots2b[0].kind, 'org')
  console.log('PASS readOpenRoots: missing/malformed freestyle.json never breaks the org path')
}

// readOpenRoots dedupes a Freestyle root whose path collides with the open
// org's path (a project nested in a Freestyle root, or a stray duplicate
// registry row). Org wins — two servers on one path would orphan a socket
// in startRootFollow and knock kind:'org' out of the list entirely.
{
  const home3 = tmp('arxa-roots-home3-')
  const env3 = { ARXA_HOME: home3 }
  const org3 = tmp('arxa-roots-org3-')
  const slug3 = path.basename(org3)
  writeJSON(path.join(home3, 'organisation.json'), { orgs: [org3] })
  writeJSON(path.join(org3, '.arxa', 'locks', slug3 + '.lock'), { pid: process.pid, orgPath: org3 })
  writeJSON(path.join(home3, 'freestyle.json'), {
    roots: [{ id: 'dup-of-org', name: 'Dup', path: org3, addedAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString(), open: true }],
    ui: { activeTab: 'org' },
  })
  const roots3 = readOpenRoots(env3)
  assert.equal(roots3.length, 1, 'freestyle root pointing at the open org path is deduped away, got ' + roots3.length)
  assert.equal(roots3[0].kind, 'org', 'the org identity wins the collision')
  assert.equal(roots3[0].path, org3)
  console.log('PASS readOpenRoots: a freestyle root sharing the org path is deduped, org wins')

  const created3 = []
  const rf3 = startRootFollow({
    env: env3, intervalMs: 15,
    createServer: async ({ orgRoot }) => { created3.push(orgRoot); return { origin: 'fake://' + orgRoot, close: async () => {} } },
  })
  await sleep(60)
  assert.equal(created3.length, 1, 'exactly one server for the colliding path, not one per registry row, got ' + created3.length)
  await rf3.stop()
  console.log('PASS startRootFollow: a path-colliding freestyle root spawns no extra/orphaned server')
}

// ============================================================================
// startRootFollow: one server per open root, reconciled on adds/closes/stop
// ============================================================================
{
  const created = []
  const closedList = []
  const fake = {
    createServer: async ({ orgRoot }) => {
      created.push(orgRoot)
      return { origin: 'fake://' + orgRoot, close: async () => { closedList.push(orgRoot) } }
    },
  }
  const rf = startRootFollow({ env, intervalMs: 15, createServer: fake.createServer })
  await sleep(60)
  assert.equal(created.length, 2, 'org + open freestyle root each get a server, got ' + created.length)
  assert.ok(created.includes(orgPath), 'org server created')
  assert.ok(created.includes(rootOpenPath), 'freestyle root server created')

  // adding a third open root -> one more server
  const idOpen2 = 'root-open-2'
  const rootOpen2Path = tmp('arxa-roots-open2-')
  let reg = JSON.parse(fs.readFileSync(path.join(home, 'freestyle.json'), 'utf8'))
  reg.roots.push({ id: idOpen2, name: 'Open Root 2', path: rootOpen2Path, addedAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString(), open: true })
  writeJSON(path.join(home, 'freestyle.json'), reg)
  await sleep(60)
  assert.equal(created.length, 3, 'adding an open root spawns exactly one more server')
  assert.ok(created.includes(rootOpen2Path))

  // closing the original freestyle root -> its server (only its server) closes
  reg = JSON.parse(fs.readFileSync(path.join(home, 'freestyle.json'), 'utf8'))
  reg.roots.find((r) => r.id === idOpen).open = false
  writeJSON(path.join(home, 'freestyle.json'), reg)
  await sleep(60)
  assert.ok(closedList.includes(rootOpenPath), 'closing a root closes its server')
  assert.ok(!closedList.includes(orgPath), 'org server stays up while an unrelated root closes')
  assert.ok(!closedList.includes(rootOpen2Path), 'other freestyle root stays up too')

  await rf.stop()
  assert.ok(closedList.includes(orgPath) && closedList.includes(rootOpen2Path), 'stop() closes every remaining server')
  console.log('PASS startRootFollow: reconciles one server per open root across adds/closes/stop')

  // restore registry for the rest of the file
  reg = JSON.parse(fs.readFileSync(path.join(home, 'freestyle.json'), 'utf8'))
  reg.roots = reg.roots.filter((r) => r.id !== idOpen2)
  reg.roots.find((r) => r.id === idOpen).open = true
  writeJSON(path.join(home, 'freestyle.json'), reg)
}

// ============================================================================
// createTreeRoute: root=<id> lists inside that root; cross-root leakage tests
// ============================================================================
function fakeReq({ method = 'GET', url }) {
  return { method, url }
}
function fakeRes() {
  return {
    statusCode: 0, headers: null, body: '',
    writeHead(s, h) { this.statusCode = s; this.headers = h || null },
    end(b) { this.body = b || '' },
  }
}
async function callTree(route, url) {
  const res = fakeRes()
  await route.handle(fakeReq({ url }), res)
  return res
}

{
  const secret = 'roots-test-secret'
  const route = createTreeRoute({ env, secret })

  // no `root` param -> the open org, unchanged behavior
  const orgTok = issueToken({ secret, scope: 'tree-read', orgPath: orgPath, ttlSeconds: 30 })
  const rOrg = await callTree(route, '/?avt=' + orgTok)
  assert.equal(rOrg.statusCode, 200, 'no root param -> org tree, got ' + rOrg.statusCode)
  const orgBody = JSON.parse(rOrg.body)
  assert.deepEqual(orgBody.files, ['org-file.md'], 'org listing unchanged')

  // root=<id> for the freestyle root, with a token minted for THAT root
  const openTok = issueToken({ secret, scope: 'tree-read', orgPath: rootOpenPath, ttlSeconds: 30 })
  const rOpen = await callTree(route, '/?root=' + idOpen + '&avt=' + openTok)
  assert.equal(rOpen.statusCode, 200, 'root=<id> lists that freestyle root, got ' + rOpen.statusCode)
  const openBody = JSON.parse(rOpen.body)
  assert.deepEqual(openBody.files, ['a.md'])
  assert.deepEqual(openBody.dirs, ['sub'])
  const rSub = await callTree(route, '/?root=' + idOpen + '&dir=sub&avt=' + openTok)
  assert.equal(rSub.statusCode, 200)
  assert.deepEqual(JSON.parse(rSub.body).files, ['b.md'], 'subdirectory listing inside the freestyle root')

  // --- cross-root leakage: the finding that matters ---

  // a token minted for the ORG must not read the freestyle root
  const rWrongRoot = await callTree(route, '/?root=' + idOpen + '&avt=' + orgTok)
  assert.equal(rWrongRoot.statusCode, 403, 'org-bound token cannot read a freestyle root')

  // a token minted for the freestyle root must not read the org (nor another root)
  const rWrongOrg = await callTree(route, '/?avt=' + openTok)
  assert.equal(rWrongOrg.statusCode, 403, 'freestyle-root-bound token cannot read the org')

  // token with no rootId claim at all (orgPath: null) is accepted by neither
  const noRootTok = issueToken({ secret, scope: 'tree-read', orgPath: null, ttlSeconds: 30 })
  assert.equal((await callTree(route, '/?avt=' + noRootTok)).statusCode, 403, 'orgPath-less token cannot read the org')
  assert.equal((await callTree(route, '/?root=' + idOpen + '&avt=' + noRootTok)).statusCode, 403, 'orgPath-less token cannot read a freestyle root')

  // token naming a root that is closed (or entirely unknown/forgotten) -> 403,
  // regardless of whether the token would otherwise verify
  const closedTok = issueToken({ secret, scope: 'tree-read', orgPath: rootClosedPath, ttlSeconds: 30 })
  assert.equal((await callTree(route, '/?root=' + idClosed + '&avt=' + closedTok)).statusCode, 403, 'closed root -> 403 even with a matching token')
  const forgottenTok = issueToken({ secret, scope: 'tree-read', orgPath: '/nowhere/at/all', ttlSeconds: 30 })
  assert.equal((await callTree(route, '/?root=forgotten-id&avt=' + forgottenTok)).statusCode, 403, 'unknown/forgotten root id -> 403')

  // dir escape via `..` or an absolute path, inside a real open root
  assert.equal((await callTree(route, '/?root=' + idOpen + '&dir=..&avt=' + openTok)).statusCode, 403, '.. dir escape refused')
  assert.equal((await callTree(route, '/?root=' + idOpen + '&dir=' + encodeURIComponent('../' + path.basename(orgPath)) + '&avt=' + openTok)).statusCode, 403, '../<sibling> dir escape refused')
  assert.equal((await callTree(route, '/?root=' + idOpen + '&dir=' + encodeURIComponent(orgPath) + '&avt=' + openTok)).statusCode, 403, 'absolute-path dir escape refused')

  // symlink inside the open freestyle root pointing OUT into the org root
  fs.symlinkSync(orgPath, path.join(rootOpenPath, 'escape-link'))
  const rSymlink = await callTree(route, '/?root=' + idOpen + '&dir=escape-link&avt=' + openTok)
  assert.equal(rSymlink.statusCode, 403, 'symlink inside root A pointing into root B is refused, got ' + rSymlink.statusCode + ' ' + rSymlink.body)
  fs.unlinkSync(path.join(rootOpenPath, 'escape-link'))

  console.log('PASS createTreeRoute: root=<id> lists that root; no cross-root read via wrong token, closed/forgotten root, dir escape, or symlink escape')
}

// ============================================================================
// watcher.setRoots: SSE-style change events carry the rootId they came from
// ============================================================================
{
  const wRootA = tmp('arxa-roots-watch-a-')
  const wRootB = tmp('arxa-roots-watch-b-')
  const w = createOrgWatcher({ intervalMs: 40 })
  const events = []
  const off = w.onChange((rel, mtime, rootId) => events.push({ rel, mtime, rootId }))
  w.setRoots([wRootA, wRootB])

  // fs.watch (FSEvents on macOS) arms asynchronously (documented flake in
  // this plugin's own selftest.mjs Task 11 watcher test): a single write
  // made right after setRoots can race the OS stream actually starting.
  // Re-probe on an interval, capped, instead of gambling on one write.
  const armWith = async (writeProbe, cond, label, capMs = 8000) => {
    const cap = Date.now() + capMs
    let n = 0
    while (!cond() && Date.now() < cap) { writeProbe(n++); await sleep(100) }
    assert.ok(cond(), label + ' (within ' + capMs + ' ms)')
  }
  await armWith(
    (n) => fs.writeFileSync(path.join(wRootA, 'probe.md'), 'arm ' + n + '\n'),
    () => events.some((e) => e.rel === 'probe.md'),
    'watcher armed on root A',
  )
  await armWith(
    (n) => fs.writeFileSync(path.join(wRootB, 'c.md'), 'in B ' + n + '\n'),
    () => events.some((e) => e.rel === 'c.md'),
    'change under root B reported',
  )
  const bEvent = events.find((e) => e.rel === 'c.md')
  assert.equal(bEvent.rootId, wRootB, 'event for a file written under B carries B as rootId')

  // dropping a root via setRoots stops watching it
  w.setRoots([wRootA])
  await sleep(150)
  const before = events.length
  fs.writeFileSync(path.join(wRootB, 'after-drop.md'), 'x')
  await sleep(250)
  assert.equal(events.length, before, 'dropped root no longer reported')

  off()
  w.stop()
  console.log('PASS watcher.setRoots: change events carry the originating rootId; dropped roots stop reporting')
}

console.log('arxa-artifact-viewer selftest.roots: GREEN')
