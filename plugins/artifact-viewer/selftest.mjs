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
