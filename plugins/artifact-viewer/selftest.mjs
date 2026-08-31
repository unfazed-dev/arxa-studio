// arxa-artifact-viewer selftest — run: node plugins/artifact-viewer/selftest.mjs
// Task 1 scope: identity, settings guards (D82 cap + D81 token ceiling), and
// the WIRING CROSS-CHECK — the mcp-apps lesson is that a package-name mismatch
// between patch row, profile package.json, BY_NAME_PLUGINS and the packed-mode
// copy list silently loads nothing. These assertions make any of the four
// drifting a loud red.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(dirname(here)) // repo checkout root (selftests never run packed)

const mod = await import('./lib/index.js')

// 1. identity
assert.equal(mod.name, 'arxa-artifact-viewer', 'plugin name')
assert.equal(typeof mod.apply, 'function', 'apply is a function')
assert.equal(mod.TOKEN_TTL_CEILING_SECONDS, 120, 'D81 token ceiling is 120 s')

// 2. settings defaults + guards
assert.deepEqual(mod.defaultSettings(), { maxEditBytes: 5_000_000, tokenTtlSeconds: 120 })
const withDefaults = mod.SCHEMA({})
assert.equal(withDefaults.maxEditBytes, 5_000_000, 'schema applies maxEditBytes default')
assert.equal(withDefaults.tokenTtlSeconds, 120, 'schema applies tokenTtlSeconds default')
let ttlBehavior
try {
  const parsed = mod.SCHEMA({ tokenTtlSeconds: 999 })
  ttlBehavior = parsed.tokenTtlSeconds
} catch {
  ttlBehavior = 'rejected'
}
assert.ok(
  ttlBehavior === 'rejected' || ttlBehavior <= mod.TOKEN_TTL_CEILING_SECONDS,
  'a 999 s TTL must be rejected or clamped to the D81 ceiling, got: ' + ttlBehavior)

// 3. wiring cross-check (patch row <-> launcher <-> package name)
const pkg = JSON.parse(fs.readFileSync(join(here, 'package.json'), 'utf8'))
assert.equal(pkg.name, 'arxa-artifact-viewer')
assert.equal(pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform, 'web',
  'dsh.client declares platform web')
assert.ok(Array.isArray(pkg.dsh && pkg.dsh.client && pkg.dsh.client.inject) &&
  pkg.dsh.client.inject.length > 0, 'dsh.client declares its inject packages')
assert.ok(fs.existsSync(join(here, 'lib', 'client.js')), 'client half exists for discovery')

const patch = fs.readFileSync(join(root, 'profile', 'cordis.patch.yml'), 'utf8')
assert.match(patch, /- id: arxa-artifact-viewer\r?\n    name: arxa-artifact-viewer/,
  'patch row registers the plugin by package name')

const launcher = fs.readFileSync(join(root, 'bin', 'arxa-studio.mjs'), 'utf8')
assert.match(launcher, /'arxa-artifact-viewer':\s+\S*file:/,
  'profile package.json materializes the file: dep')
assert.match(launcher, /BY_NAME_PLUGINS = \[[^\]]*'arxa-artifact-viewer'/,
  'BY_NAME_PLUGINS carries the package name')
assert.match(launcher, /\['arxa-artifact-viewer',\s*artifactViewerDir\]/,
  'packed mode copies the plugin directory')

console.log('arxa-artifact-viewer selftest: GREEN')

// ---- Task 2: per-org GET-only server --------------------------------------
import http from 'node:http'
import os from 'node:os'
import path2 from 'node:path'
import { createOrgServer, resolveInside } from './lib/org-server.js'
import { readOpenOrg, startOrgFollow } from './lib/follow.js'

function req(port, urlPath, { method = 'GET', host } = {}) {
  return new Promise((resolve, rejectP) => {
    const r = http.request({
      host: '127.0.0.1', port, path: urlPath, method,
      headers: host ? { host } : {},
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'), raw: Buffer.concat(chunks) }))
    })
    r.on('error', rejectP)
    r.end()
  })
}

const org = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-org-'))
fs.mkdirSync(path2.join(org, 'notes'), { recursive: true })
fs.writeFileSync(path2.join(org, 'notes', 'a.md'), '# hello\n')
fs.writeFileSync(path2.join(org, 'app.js'), 'console.log(1)\n')
fs.writeFileSync(path2.join(org, 'img.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
fs.writeFileSync(path2.join(org, 'vid.mp4'), Buffer.alloc(64, 7))

const outside = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-out-'))
fs.writeFileSync(path2.join(outside, 'secret.txt'), 'top secret')
fs.symlinkSync(path2.join(outside, 'secret.txt'), path2.join(org, 'leak.txt'))

// containment unit checks
assert.equal(resolveInside(org, 'notes/a.md'), path2.join(org, 'notes', 'a.md'))
assert.throws(() => resolveInside(org, '../x'), /escape|ESCAPE/i)
assert.throws(() => resolveInside(org, '/etc/passwd'), /escape|ESCAPE/i)

const srv = await createOrgServer({ orgRoot: org, orgSlug: 'test', verify: () => true })
const { port, origin } = srv
assert.ok(origin.startsWith('http://org-test.localhost:'), 'origin uses the org hostname')
const H = 'org-test.localhost:' + port

const r1 = await req(port, '/notes/a.md', { host: H })
assert.equal(r1.status, 200)
assert.equal(r1.headers['content-type'], 'text/markdown; charset=utf-8')
assert.equal(r1.body, '# hello\n')
assert.equal(r1.headers['cache-control'], 'no-store')

assert.equal((await req(port, '/img.png', { host: H })).headers['content-type'], 'image/png')
assert.equal((await req(port, '/app.js', { host: H })).status, 200)
assert.equal((await req(port, '/', { host: H })).status, 404, 'directories never list')
assert.equal((await req(port, '/missing.md', { host: H })).status, 404)
assert.equal((await req(port, '/notes/a.md', { method: 'POST', host: H })).status, 405, 'GET-only (D81)')
const srv2 = await createOrgServer({ orgRoot: org, orgSlug: 'test2' }) // verify omitted: deny-default
const H2 = 'org-test2.localhost:' + srv2.port
assert.equal((await req(srv2.port, '/notes/a.md', { host: H2 })).status, 403, 'no verifier -> deny-default')
assert.equal((await req(srv2.port, '/healthz', { host: H2 })).status, 200, 'healthz needs no token')
await srv2.close()
assert.equal((await req(port, '/healthz')).status, 200, 'healthz needs no host/token')
const trav = await req(port, '/%2e%2e/secret.txt', { host: H })
assert.ok(trav.status === 403 || trav.status === 404,
  'encoded traversal never serves content, got: ' + trav.status)
assert.equal((await req(port, '/leak.txt', { host: H })).status, 403, 'symlink escape rejected')
assert.equal((await req(port, '/notes/a.md', { host: 'evil.example:1234' })).status, 403, 'host allowlist')

const rr = await req(port, '/vid.mp4', { host: H, method: 'GET' })
Object.assign(rr.req ||= {}, {})
const rr2 = await new Promise((resolve, rejectP) => {
  const rq = http.request({ host: '127.0.0.1', port, path: '/vid.mp4',
    headers: { host: H, range: 'bytes=0-3' } }, (res) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers,
      raw: Buffer.concat(chunks) }))
  })
  rq.on('error', rejectP)
  rq.end()
})
assert.equal(rr2.status, 206, 'single range served')
assert.equal(rr2.headers['content-range'], 'bytes 0-3/64')
assert.equal(rr2.raw.length, 4)

await srv.close()
let refused = false
try { await req(port, '/healthz') } catch { refused = true }
assert.ok(refused, 'server actually stops on close()')

// ---- Task 2: open-org follow loop -----------------------------------------
const home = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-home-'))
const orgA = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-a-'))
const orgB = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-b-'))
const env = { ...process.env, ARXA_HOME: home }
fs.writeFileSync(path2.join(home, 'organisation.json'), JSON.stringify({ orgs: [orgA, orgB] }))
const lockOf = (o) => path2.join(o, '.arxa', 'locks', path2.basename(o) + '.lock')
const writeLock = (o, holder) => {
  fs.mkdirSync(path2.join(o, '.arxa', 'locks'), { recursive: true })
  fs.writeFileSync(lockOf(o), JSON.stringify(holder))
}
assert.equal(readOpenOrg(env), null, 'no lock -> nothing open')

const started = []
const closed = []
const fake = { createServer: async ({ orgRoot }) => {
  started.push(orgRoot)
  return { origin: 'fake://' + orgRoot, close: async () => { closed.push(orgRoot) } }
} }
const sleep = (ms) => new Promise((r2) => setTimeout(r2, ms))
writeLock(orgA, { pid: process.pid, orgPath: orgA })
const f = startOrgFollow({ env, intervalMs: 15, createServer: fake.createServer })
await sleep(70)
assert.equal(f.current() && f.current().orgPath, orgA, 'serves the locked org')

writeLock(orgB, { pid: process.pid, orgPath: orgB })
fs.unlinkSync(lockOf(orgA))
await sleep(70)
assert.equal(f.current() && f.current().orgPath, orgB, 'switches org on lock change')
assert.deepEqual(closed, [orgA], 'old org server closed on switch')

writeLock(orgA, { pid: 999999999, orgPath: orgA })
await sleep(70)
assert.equal(f.current() && f.current().orgPath, orgB, 'dead-pid lock is not an open org')

await f.stop()
assert.deepEqual(closed, [orgA, orgB], 'stop() closes the serving org')

console.log('arxa-artifact-viewer selftest: GREEN (server + follow)');

// ---- Task 3: token classes, secret, verify glue, issue route ---------------
import { issueToken, verifyToken, loadOrCreateSecret, readVerifyFor } from './lib/tokens.js'
import { createTokenRoutes } from './lib/index.js'

// identity guard (theme-accent D84 lesson: undeclared inject kills cold boots)
assert.deepEqual(mod.inject, ['webServer'], 'declares inject: ["webServer"]')

// tokens: round-trip + bindings
const secret = 'unit-test-secret'
const tk = issueToken({ secret, scope: 'read', relPath: 'notes/a.md', orgPath: org, ttlSeconds: 30 })
assert.equal(verifyToken(tk, { secret, scope: 'read', relPath: 'notes/a.md', orgPath: org }).ok, true)
assert.equal(verifyToken(tk, { secret, scope: 'read', relPath: 'app.js', orgPath: org }).ok, false, 'wrong rel rejected')
assert.equal(verifyToken(tk, { secret, scope: 'write', worktreeId: 'w1' }).ok, false, 'wrong scope rejected')
assert.equal(verifyToken(tk, { secret, scope: 'read', relPath: 'notes/a.md', orgPath: '/somewhere/else' }).ok, false, 'wrong org rejected')
assert.equal(verifyToken(tk, { secret: 'other', scope: 'read', relPath: 'notes/a.md', orgPath: org }).ok, false, 'wrong secret rejected')
assert.equal(verifyToken(tk.slice(0, -2) + 'xx', { secret, scope: 'read', relPath: 'notes/a.md', orgPath: org }).ok, false, 'tampered rejected')
const past = issueToken({ secret, scope: 'read', relPath: 'x', ttlSeconds: 5, now: () => 1000 })
assert.equal(verifyToken(past, { secret, scope: 'read', relPath: 'x', now: () => 2000 }).reason, 'expired', 'expired rejected')
const clamped = issueToken({ secret, scope: 'read', relPath: 'x', ttlSeconds: 9999, now: () => 1000 })
const body = JSON.parse(Buffer.from(clamped.split('.')[0], 'base64url').toString('utf8'))
assert.ok(body.exp - body.iat <= 120, 'ttl clamped to the D81 ceiling')
const wtk = issueToken({ secret, scope: 'write', worktreeId: 'sess-1', ttlSeconds: 30 })
assert.equal(verifyToken(wtk, { secret, scope: 'write', worktreeId: 'sess-1' }).ok, true)
assert.equal(verifyToken(wtk, { secret, scope: 'write', worktreeId: 'sess-2' }).ok, false, 'write token bound to worktree')

// secret file: created 0600, idempotent
const envHome = { ...process.env, ARXA_HOME: fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-keys-')) }
const s1 = loadOrCreateSecret(envHome)
const s2 = loadOrCreateSecret(envHome)
assert.equal(s1, s2, 'secret idempotent')
assert.equal(fs.statSync(path2.join(envHome.ARXA_HOME, 'keys', 'artifact-viewer-secret')).mode & 0o777, 0o600, 'secret is 0600')

// verify glue against a live server
const vorg = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-vorg-'))
fs.writeFileSync(path2.join(vorg, 'a.md'), 'hello')
const vsrv = await createOrgServer({ orgRoot: vorg, orgSlug: 'vtest', verify: readVerifyFor({ secret, orgPath: vorg }) })
const VH = 'org-vtest.localhost:' + vsrv.port
const goodT = issueToken({ secret, scope: 'read', relPath: 'a.md', orgPath: vorg, ttlSeconds: 30 })
assert.equal((await req(vsrv.port, '/a.md', { host: VH })).status, 403, 'no token -> 403')
assert.equal((await req(vsrv.port, '/a.md?avt=' + goodT, { host: VH })).status, 200, 'valid token -> 200')
const otherT = issueToken({ secret, scope: 'read', relPath: 'b.md', orgPath: vorg, ttlSeconds: 30 })
assert.equal((await req(vsrv.port, '/a.md?avt=' + otherT, { host: VH })).status, 403, 'token for another file -> 403')
const otherOrgT = issueToken({ secret, scope: 'read', relPath: 'a.md', orgPath: '/elsewhere', ttlSeconds: 30 })
assert.equal((await req(vsrv.port, '/a.md?avt=' + otherOrgT, { host: VH })).status, 403, 'token for another org -> 403')
await vsrv.close()

// issue route over a fake ctx
const routeHome = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-route-'))
const routeOrg = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-rorg-'))
const routeEnv = { ...process.env, ARXA_HOME: routeHome }
fs.writeFileSync(path2.join(routeHome, 'organisation.json'), JSON.stringify({ orgs: [routeOrg] }))
fs.mkdirSync(path2.join(routeOrg, '.arxa', 'locks'), { recursive: true })
fs.writeFileSync(path2.join(routeOrg, '.arxa', 'locks', path2.basename(routeOrg) + '.lock'),
  JSON.stringify({ pid: process.pid, orgPath: routeOrg }))
fs.writeFileSync(path2.join(routeOrg, 'doc.md'), 'route')

const routeSecret = 'route-secret'
const routes = createTokenRoutes({ env: routeEnv, secret: routeSecret, getSettings: () => ({ tokenTtlSeconds: 120 }), getOrigin: () => 'http://org-test.localhost:59999' })
function callRoute(payload) {
  return new Promise((resolve, rejectP) => {
    const res = { statusCode: 0, headers: null, body: '',
      writeHead(s, h) { this.statusCode = s; this.headers = h },
      end(b) { this.body = b || '' } }
    const rq = { method: 'POST',
      on(ev, fn) {
        if (ev === 'data') queueMicrotask(() => fn(Buffer.from(JSON.stringify(payload))))
        if (ev === 'end') queueMicrotask(() => fn())
      } }
    routes.handle(rq, res).then(() => resolve(res), rejectP)
  })
}
const ok = await callRoute({ orgPath: routeOrg, relPath: 'doc.md' })
assert.equal(ok.statusCode, 200, 'open org + contained rel -> 200')
const issued = JSON.parse(ok.body).token
assert.equal(verifyToken(issued, { secret: routeSecret, scope: 'read', relPath: 'doc.md', orgPath: routeOrg }).ok, true)
assert.equal((await callRoute({ orgPath: routeOrg, relPath: '../x' })).statusCode, 403, 'escape -> 403')
assert.equal((await callRoute({ orgPath: '/not/open', relPath: 'doc.md' })).statusCode, 403, 'unopened org -> 403')
assert.equal((await callRoute({ orgPath: routeOrg, relPath: 'nope.md' })).statusCode, 404, 'missing file -> 404')
assert.equal((await callRoute({ scope: 'write' })).statusCode, 400, 'write without worktreeId -> 400')
const w = await callRoute({ scope: 'write', worktreeId: 'sess-9' })
assert.equal(w.statusCode, 200, 'write token issued')
assert.equal(verifyToken(JSON.parse(w.body).token, { secret: routeSecret, scope: 'write', worktreeId: 'sess-9' }).ok, true)

console.log('arxa-artifact-viewer selftest: GREEN (tokens + route)');

// ---- Task 4: vendored bundles exist + vendor route serves them ------------
import { createVendorRoutes } from './lib/index.js'
const vendorDir = path2.join(here, 'lib', 'vendor')
for (const f of ['codemirror.js', 'markdown.js', 'pdf.js', 'pdf.worker.js']) {
  assert.ok(fs.existsSync(path2.join(vendorDir, f)), 'vendored bundle present: ' + f)
  const bytes = fs.readFileSync(path2.join(vendorDir, f))
  assert.ok(bytes.length > 50_000, f + ' is a real bundle (' + bytes.length + ' bytes)')
  assert.ok(bytes.toString('utf8').slice(0, 300).includes('GENERATED by lib/vendor.js'), f + ' carries provenance banner')
}
const vr = createVendorRoutes({ vendorDir })
const vhttp = http.createServer((rq, rs) => { void vr.handle(rq, rs) })
await new Promise((r2) => vhttp.listen(0, '127.0.0.1', r2))
const vport = vhttp.address().port
const vget = await req(vport, '/codemirror.js')
assert.equal(vget.status, 200, 'vendor route serves codemirror.js')
assert.equal(vget.headers['content-type'], 'text/javascript; charset=utf-8')
assert.ok(vget.body.startsWith('/* arxa-artifact-viewer vendored bundle'), 'provenance banner served')
assert.equal((await req(vport, '/markdown.js')).status, 200)
assert.equal((await req(vport, '/codemirror.js', { method: 'POST' })).status, 405, 'vendor route GET-only')
const vt = await req(vport, '/%2e%2e/index.js')
assert.ok(vt.status === 404 || vt.status === 403, 'vendor traversal refused, got ' + vt.status)
await new Promise((r2) => vhttp.close(r2))
console.log('arxa-artifact-viewer selftest: GREEN (vendor bundles + route)');

// ---- Task 6: engine write API over a REAL git session worktree ------------
import { createWriteApi, resolveWorktree } from './lib/write-api.js'
import { execFileSync } from 'node:child_process'

const gitEnv = { ...process.env,
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@arxa.invalid',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@arxa.invalid' }
const orgRepo = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-git-'))
const g = (args, cwd) => execFileSync('git', args, { cwd, env: gitEnv })
g(['init', '-b', 'main'], orgRepo)
fs.writeFileSync(path2.join(orgRepo, 'seed.md'), 'seed\n')
g(['add', '.'], orgRepo)
g(['commit', '-m', 'init'], orgRepo)

const sessions = await import(new URL('../git-workspace/lib/sessions.js', import.meta.url).href)
const created = sessions.openSession(orgRepo, { id: 'sess1', name: 'T1', env: gitEnv })
const worktreeOf = (id) => path2.join(orgRepo, '.arxa', 'worktrees', id)
assert.ok(fs.existsSync(worktreeOf('sess1')), 'session worktree exists after openSession')

const wtEnv = { ...process.env, ARXA_HOME: home } // home from Task 2 with orgA? use a fresh route-style open org:
// open-org truth for the write api: point orgA at the git org repo
const gitHome = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-ghome-'))
const gitEnvHome = { ...process.env, ARXA_HOME: gitHome }
fs.writeFileSync(path2.join(gitHome, 'organisation.json'), JSON.stringify({ orgs: [orgRepo] }))
writeLock(orgRepo, { pid: process.pid, orgPath: orgRepo })
assert.equal(readOpenOrg(gitEnvHome) && readOpenOrg(gitEnvHome).orgPath, orgRepo, 'git org reads as open')

assert.equal(resolveWorktree({ env: gitEnvHome, orgPath: orgRepo, worktreeId: 'sess1' }).worktreePath, worktreeOf('sess1'))
assert.equal(resolveWorktree({ env: gitEnvHome, orgPath: orgRepo, worktreeId: 'nope' }), null)

const writeApi = createWriteApi({ env: gitEnvHome, secret, getSettings: () => ({ maxEditBytes: 1024 }) })
function callWrite(payload, headers = {}) {
  return new Promise((resolve, rejectP) => {
    const res = { statusCode: 0, headers: null, body: '',
      writeHead(s, h) { this.statusCode = s; this.headers = h || null },
      end(b) { this.body = b || ''; resolve(this) } }
    const rq = { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
      on(ev, fn) {
        if (ev === 'data') queueMicrotask(() => fn(Buffer.from(JSON.stringify(payload))))
        if (ev === 'end') queueMicrotask(() => fn())
      } }
    writeApi.handle(rq, res).then(() => resolve(res), rejectP)
  })
}
const wtok = issueToken({ secret, scope: 'write', worktreeId: 'sess1', ttlSeconds: 30 })
const WH = { 'x-arxa-write-token': wtok }

const w1 = await callWrite({ worktreeId: 'sess1', relPath: 'notes/a.md', content: 'written by the editor\n' }, WH)
assert.equal(w1.statusCode, 200, 'happy write -> 200, got ' + w1.statusCode + ' ' + w1.body)
const w1body = JSON.parse(w1.body)
assert.equal(w1body.committed, true, 'WIP commit ran')
const saved = path2.join(worktreeOf('sess1'), 'notes', 'a.md')
assert.equal(fs.readFileSync(saved, 'utf8'), 'written by the editor\n')
const log = g(['log', '--oneline'], worktreeOf('sess1')).toString()
assert.match(log, /wip:/, 'WIP commit visible in worktree log')

const w2 = await callWrite({ worktreeId: 'sess1', relPath: '../escape.md', content: 'x' }, WH)
assert.equal(w2.statusCode, 403, 'worktree escape -> 403')
const w3 = await callWrite({ worktreeId: 'sess1', relPath: 'account/secret.txt', content: 'x' }, WH)
assert.equal(w3.statusCode, 403, 'account/ reserved -> 403 (D28/D37)')
const w4 = await callWrite({ worktreeId: 'sess1', relPath: '.arxa/x', content: 'x' }, WH)
assert.equal(w4.statusCode, 403, '.arxa/ reserved -> 403')
const expiredW = issueToken({ secret, scope: 'write', worktreeId: 'sess1', ttlSeconds: 5, now: () => 1000 })
const w5 = await callWrite({ worktreeId: 'sess1', relPath: 'notes/a.md', content: 'x' }, { 'x-arxa-write-token': expiredW })
assert.equal(w5.statusCode, 401, 'expired write token -> 401')
const w6 = await callWrite({ worktreeId: 'nope', relPath: 'x.md', content: 'x' }, { 'x-arxa-write-token': issueToken({ secret, scope: 'write', worktreeId: 'nope', ttlSeconds: 30 }) })
assert.equal(w6.statusCode, 404, 'unknown session -> 404')
const first = JSON.parse(w1.body)
const w7 = await callWrite({ worktreeId: 'sess1', relPath: 'notes/a.md', content: 'conflict', expectedMtimeMs: first.mtimeMs + 99999 }, WH)
assert.equal(w7.statusCode, 409, 'stale expectedMtimeMs -> 409 (external change wins)')
const w8 = await callWrite({ worktreeId: 'sess1', relPath: 'notes/a.md', content: 'second save\n', expectedMtimeMs: first.mtimeMs }, WH)
assert.equal(w8.statusCode, 200, 'matching mtime -> 200')
assert.equal(fs.readFileSync(saved, 'utf8'), 'second save\n')
const w9 = await callWrite({ worktreeId: 'sess1', relPath: 'big.md', content: 'x'.repeat(2000) }, WH)
assert.equal(w9.statusCode, 413, 'over-cap content -> 413 (D82 server-side twin)')

console.log('arxa-artifact-viewer selftest: GREEN (write api over real git worktree)');

// ---- Task 9: main-version route (D84 worktree-vs-main) ---------------------
import { createMainVersionRoute } from './lib/write-api.js'
const mv = createMainVersionRoute({ env: gitEnvHome, secret })
function callMain(relPath, token) {
  return new Promise((resolve, rejectP) => {
    const res = { statusCode: 0, headers: null, body: '',
      writeHead(s, h) { this.statusCode = s; this.headers = h || null },
      end(b) { this.body = b || ''; resolve(this) } }
    const rq = { method: 'GET', url: '/?relPath=' + encodeURIComponent(relPath) + '&avt=' + encodeURIComponent(token || '') }
    mv.handle(rq, res).then(() => resolve(res), rejectP)
  })
}
const readT = issueToken({ secret, scope: 'read', relPath: 'seed.md', orgPath: orgRepo, ttlSeconds: 30 })
const m1 = await callMain('seed.md', readT)
assert.equal(m1.statusCode, 200, 'main-version 200')
assert.equal(JSON.parse(m1.body).content, 'seed\n', 'main blob content')
const m2 = await callMain('notes/a.md', issueToken({ secret, scope: 'read', relPath: 'notes/a.md', orgPath: orgRepo, ttlSeconds: 30 }))
assert.equal(m2.statusCode, 200, 'file absent on main still 200')
assert.equal(JSON.parse(m2.body).content, '', 'new-file diff gets empty base')
assert.equal((await callMain('seed.md', null)).statusCode, 403, 'no token -> 403')
const wrongRel = issueToken({ secret, scope: 'read', relPath: 'other.md', orgPath: orgRepo, ttlSeconds: 30 })
assert.equal((await callMain('seed.md', wrongRel)).statusCode, 403, 'relPath-bound token enforced')
const esc = await callMain('../outside.md', issueToken({ secret, scope: 'read', relPath: '../outside.md', orgPath: orgRepo, ttlSeconds: 30 }))
assert.equal(esc.statusCode, 403, 'escape -> 403')
console.log('arxa-artifact-viewer selftest: GREEN (main-version diff route)');
