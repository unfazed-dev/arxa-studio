#!/usr/bin/env node
/**
 * artifact-viewer — the LSP bridge (G8).
 *
 * Why this is a HOST test and not part of the lens check: monaco-build's
 * check.mjs serves dist/ from a throwaway static server. It has no host, no
 * ctx.webServer, no registerUpgrade and no spawner, so the bridge is the first
 * thing in this branch the browser check cannot reach at all. Everything the
 * socket does is proven here instead.
 *
 * The last block drives a REAL rust-analyzer through a REAL WebSocket and
 * asserts it answers `initialize`. It skips (loudly) when the binary is absent,
 * because CI on another machine must not go red for a toolchain choice.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { WebSocketServer, WebSocket } from 'ws'
import {
  LANG_SERVERS, langForPath, createFrameReader, frame, tokenFromProtocols, createLspBridge, projectRootFor,
  resolveBin, readShellPath,
} from './lib/lsp.js'
import { issueToken } from './lib/tokens.js'

let n = 0
const ok = (s) => { n++; console.log('  ok ' + s) }
const SECRET = 'test-secret-for-the-lsp-bridge'
const ORG = '/tmp/arxa-lsp-selftest-org'

// ---- routing ---------------------------------------------------------------
assert.equal(langForPath('src/main.rs'), 'rust'); ok('.rs routes to rust')
assert.equal(langForPath('lib/widget.dart'), 'dart'); ok('.dart routes to dart')
assert.equal(langForPath('notes/readme.md'), null); ok('an unserved extension routes to NOTHING (the editor still opens)')
assert.equal(langForPath('Makefile'), null); ok('a file with no extension does not crash the router')
assert.equal(langForPath('SRC/MAIN.RS'), 'rust'); ok('extension match is case-insensitive')

// ---- the project root, not the org -----------------------------------------
// An arxa org holds notes, meetings and projects. A server rooted at the org
// finds no Cargo.toml and reports NOTHING, with no error to explain the
// silence — so the root has to be the directory holding the manifest.
{
  const has = (set) => (p) => set.includes(p)
  assert.equal(
    projectRootFor('/org/projects/app/src/main.rs', '/org', ['Cargo.toml'], has(['/org/projects/app/Cargo.toml'])),
    '/org/projects/app'); ok('the root is the nearest directory with a manifest, not the org')
  assert.equal(
    projectRootFor('/org/notes/scratch.rs', '/org', ['Cargo.toml'], has([])),
    null); ok('a loose file with no project above it gets NO server (rather than a useless one)')
  // Bounded by the org: a manifest above the open org must never become a root,
  // or opening one file could root a language server anywhere up the filesystem.
  assert.equal(
    projectRootFor('/org/a/main.rs', '/org', ['Cargo.toml'], has(['/Cargo.toml', '/org/../Cargo.toml'])),
    null); ok('the walk stops at the org root — a manifest ABOVE it is never used')
  assert.equal(
    projectRootFor('/elsewhere/main.rs', '/org', ['Cargo.toml'], has(['/elsewhere/Cargo.toml'])),
    null); ok('a file outside the open org is refused outright')
  // Worktrees live at <repo>/.arxa/worktrees/<id>, inside the org, so the same
  // walk finds the project copy INSIDE the worktree — the right root for a file
  // being edited there, not the main checkout's.
  assert.equal(
    projectRootFor('/org/.arxa/worktrees/s1/projects/app/src/m.rs', '/org', ['Cargo.toml'],
      has(['/org/projects/app/Cargo.toml', '/org/.arxa/worktrees/s1/projects/app/Cargo.toml'])),
    '/org/.arxa/worktrees/s1/projects/app'); ok('a worktree file roots at the worktree copy, not the main checkout')
  assert.equal(LANG_SERVERS.rust.rootMarkers[0], 'Cargo.toml'); ok('rust roots on Cargo.toml')
  assert.equal(LANG_SERVERS.dart.rootMarkers[0], 'pubspec.yaml'); ok('dart roots on pubspec.yaml')
}

// ---- framing ---------------------------------------------------------------
// THE bug this reader exists to avoid: Content-Length counts BYTES. A body
// with any non-ascii character makes byte length and string length disagree,
// and a character-counting reader desynchronises the stream permanently —
// every message after the first accented path is garbage.
{
  const got = []
  const read = createFrameReader((m) => got.push(m))
  const body = JSON.stringify({ msg: 'diagnostics for café — naïve ✓' })
  assert.ok(Buffer.byteLength(body, 'utf8') > body.length, 'the fixture really is multi-byte')
  read(frame(body))
  assert.deepEqual(got, [body]); ok('a multi-byte body round-trips (byte-counted, not char-counted)')
}
{
  const got = []
  const read = createFrameReader((m) => got.push(m))
  const buf = Buffer.concat([frame('{"a":1}'), frame('{"b":2}')])
  // Deliver ONE BYTE AT A TIME: a real stdout stream splits wherever it likes,
  // including mid-header and mid-body.
  for (const byte of buf) read(Buffer.from([byte]))
  assert.deepEqual(got, ['{"a":1}', '{"b":2}']); ok('frames split across arbitrary chunk boundaries reassemble')
}
{
  const got = []
  const read = createFrameReader((m) => got.push(m))
  read(Buffer.concat([frame('{"a":1}'), frame('{"b":2}'), frame('{"c":3}')]))
  assert.equal(got.length, 3); ok('three frames in one chunk all surface')
}

// ---- the subprotocol token trick -------------------------------------------
const goodToken = issueToken({ secret: SECRET, scope: 'lsp', orgPath: ORG })
assert.equal(tokenFromProtocols('arxa-lsp, ' + goodToken), goodToken); ok('the token is read out of Sec-WebSocket-Protocol')
assert.equal(tokenFromProtocols(goodToken + ', arxa-lsp'), null); ok('a list not led by the marker is refused')
assert.equal(tokenFromProtocols(''), null); ok('an empty protocol list is refused')
assert.equal(tokenFromProtocols(undefined), null); ok('a missing protocol header is refused')
// The whole point of the subprotocol carrier: every character of the token has
// to be legal there, or a browser silently fails the handshake.
assert.match(goodToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/); ok('the token is subprotocol-safe (base64url + dot, no padding)')

// ---- deny-default at the upgrade -------------------------------------------
function fakeSocket () {
  const s = { written: '', destroyed: false }
  s.write = (d) => { s.written += d; return true }
  s.destroy = () => { s.destroyed = true }
  s.on = () => s
  s.once = () => s
  return s
}
const neverUpgrade = { handleUpgrade: () => { throw new Error('handshake must not be reached') } }

async function refuses (what, { org = ORG, token = goodToken, lang = 'rust', relPath = 'a.rs', exists = () => true }) {
  const bridge = createLspBridge({
    secret: SECRET, getOrgPath: () => org, exists,
    resolveAbs: async ({ relPath: r }) => (r === '' ? null : ORG + '/' + r),
    spawn: () => { throw new Error('must not spawn on a refused upgrade') },
  })
  const sock = fakeSocket()
  await bridge.handleUpgrade(
    { url: '/__arxa/artifacts/lsp?lang=' + lang + '&path=' + relPath, headers: { 'sec-websocket-protocol': token === null ? '' : 'arxa-lsp, ' + token } },
    sock, Buffer.alloc(0), neverUpgrade,
  )
  assert.ok(sock.destroyed, what + ': socket destroyed')
  assert.match(sock.written, /^HTTP\/1\.1 403/, what + ': answered 403')
  assert.equal(bridge.stats().refused, 1, what + ': counted as refused')
  ok('refused — ' + what)
}
await refuses('no org open', { org: null })
await refuses('no token', { token: null })
await refuses('a forged token', { token: 'not.atoken' })
await refuses('a token for a DIFFERENT org', { token: issueToken({ secret: SECRET, scope: 'lsp', orgPath: '/somewhere/else' }) })
await refuses('a read token used as an lsp token', { token: issueToken({ secret: SECRET, scope: 'read', orgPath: ORG, relPath: 'a.rs' }) })
await refuses('a language nothing serves', { lang: 'cobol' })
await refuses('a path the host cannot resolve', { relPath: '' })
await refuses('a file with no project manifest above it', { exists: () => false })

// ---- finding the binary at all --------------------------------------------
// The engine is launched by the desktop, not from a shell: its PATH is
// launchd's default and holds no toolchain. Measured on the build machine:
// dart under fvm, rust-analyzer under a CARGO_HOME on another volume.
{
  const seen = new Set(['/opt/tools/dart'])
  const exists = (p) => seen.has(p)
  const env = { PATH: '/usr/bin:/bin' }
  assert.equal(resolveBin('dart', { env, exists }), null,
    'launchd PATH alone finds nothing — this is the bug being fixed')
  assert.equal(resolveBin('dart', { env, exists, extraPath: '/opt/tools' }), '/opt/tools/dart',
    'the login shell PATH is what finds it')
  assert.equal(resolveBin('dart', { env: { PATH: '/opt/tools' }, exists }), '/opt/tools/dart')
  assert.equal(resolveBin('/opt/tools/dart', { env, exists }), '/opt/tools/dart',
    'an absolute override is taken as given')
  assert.equal(resolveBin('/nope/dart', { env, exists }), null,
    'an absolute override that is not there is null, not a spawn')
  assert.equal(resolveBin('', { env, exists }), null)
  assert.equal(resolveBin(undefined, { env, exists }), null)
  ok('resolveBin searches the engine PATH, then the login-shell PATH, and honours an absolute override')

  // ARXA_LSP_<LANG> beats the row's own command.
  const spawned = []
  const b = createLspBridge({
    secret: SECRET, getOrgPath: () => ORG, shellPath: '',
    env: { PATH: '/usr/bin', ARXA_LSP_RUST: '/opt/mine/ra' },
    exists: (p) => p === '/opt/mine/ra',
    spawn: (cmd) => {
      spawned.push(cmd)
      return { stdout: { on: () => {} }, stderr: { on: () => {} }, stdin: { write: () => {} }, on: () => {}, kill: () => {} }
    },
    servers: { rust: { exts: ['.rs'], cmd: 'rust-analyzer', args: [] } },
  })
  b.ensureServer(ORG, 'rust')
  assert.deepEqual(spawned, ['/opt/mine/ra'], 'ARXA_LSP_RUST overrides the row')
  b.stopAll('test')
  ok('ARXA_LSP_<LANG> overrides the built-in command')
}

// ---- reading the login shell's PATH ----------------------------------------
{
  assert.equal(await readShellPath({ env: {} }), '', 'no SHELL is not an error')
  const noisy = 'Welcome to your shell!\nnvm: v24\n@ARXA_PATH@/a/bin:/b/bin@END@\n$ '
  assert.equal(
    await readShellPath({ env: { SHELL: '/bin/zsh' }, run: (_c, _a, _o, cb) => cb(null, noisy) }),
    '/a/bin:/b/bin',
    'a banner, a greeting and a prompt around the value do not corrupt it')
  assert.equal(
    await readShellPath({ env: { SHELL: '/bin/zsh' }, run: (_c, _a, _o, cb) => cb(new Error('timeout'), '') }),
    '', 'a shell that hangs or fails yields no extra PATH, not a crash')
  assert.equal(
    await readShellPath({ env: { SHELL: '/bin/zsh' }, run: () => { throw new Error('spawn blew up') } }),
    '', 'a spawn that throws yields no extra PATH')
  ok('readShellPath fences the value with markers and never throws')

  // The real shell on this machine — proves the marker trick against a real rc file.
  const real = await readShellPath({})
  assert.ok(typeof real === 'string')
  if (real === '') console.log('  NOTE  login shell reported no PATH (SHELL unset or shell failed)')
  else ok('the real login shell PATH resolved (' + real.split(':').length + ' entries)')
}

// ---- a missing binary is a clean answer, not a crash -----------------------
{
  // (a) not on the PATH at all: refused before a process is ever created.
  const bridge = createLspBridge({
    secret: SECRET, getOrgPath: () => ORG, shellPath: '',
    spawn: () => { throw new Error('must not spawn a binary that was not found') },
    servers: { ghost: { exts: ['.ghost'], cmd: 'definitely-not-a-real-binary-xyz', args: [] } },
  })
  assert.equal(bridge.ensureServer(ORG, 'ghost'), null)
  assert.equal(bridge.running.size, 0)
  assert.equal(bridge.stats().spawnFailed, 1)
  ok('a language-server binary that is not on the PATH never reaches spawn')

  // (b) resolved but broken: ENOENT arrives ASYNCHRONOUSLY on the error event,
  // so the synchronous try/catch around spawn is not enough on its own.
  const b2 = createLspBridge({
    secret: SECRET, getOrgPath: () => ORG, shellPath: '',
    exists: () => true,   // pretend it resolved; the real spawn still fails
    servers: { ghost: { exts: ['.ghost'], cmd: 'definitely-not-a-real-binary-xyz', args: [] } },
  })
  const entry = b2.ensureServer(ORG, 'ghost')
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(b2.running.size, 0, 'the dead child is not left in the table')
  assert.equal(b2.stats().spawnFailed, 1)
  ok('a missing language-server binary fails cleanly and is not cached as running')
  if (entry) { try { entry.child.kill() } catch {} }
}

// ---- org switch kills the server -------------------------------------------
{
  const killed = []
  const fakeChild = () => ({
    stdout: { on: () => {} }, stderr: { on: () => {} }, stdin: { write: () => {} },
    on: () => {}, kill: () => killed.push(1),
  })
  const bridge = createLspBridge({
    secret: SECRET, getOrgPath: () => ORG, spawn: fakeChild, exists: () => true, shellPath: '',
    servers: { rust: { exts: ['.rs'], cmd: 'x', args: [] } },
  })
  bridge.ensureServer(ORG, 'rust')
  assert.equal(bridge.running.size, 1)
  bridge.stopAll('org-switch')
  assert.equal(bridge.running.size, 0)
  assert.equal(killed.length, 1)
  ok('an org switch kills the language server (no process holding a closed org)')
}

// ---- LIVE: a real rust-analyzer answers initialize over a real socket -------
const haveRa = spawnSync('rust-analyzer', ['--version'], { encoding: 'utf8' }).status === 0
if (!haveRa) {
  console.log('  SKIP  live rust-analyzer round trip — binary not on PATH')
} else {
  // A REAL cargo project in a temp org: rust-analyzer rooted anywhere else
  // finds no manifest and answers nothing, which is the whole point of
  // projectRootFor. The org is the parent; the project sits inside it, exactly
  // as an arxa org holds projects/<name>.
  const liveOrg = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-lsp-org-'))
  const proj = path.join(liveOrg, 'projects', 'demo')
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true })
  fs.writeFileSync(path.join(proj, 'Cargo.toml'), '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n')
  fs.writeFileSync(path.join(proj, 'src', 'main.rs'), 'fn main() { println!("hi"); }\n')

  const bridge = createLspBridge({
    secret: SECRET,
    getOrgPath: () => liveOrg,
    resolveAbs: async ({ relPath, orgPath }) => path.join(orgPath, relPath),
  })
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has('arxa-lsp') ? 'arxa-lsp' : false),
  })
  const server = http.createServer()
  server.on('upgrade', (req, socket, head) => bridge.handleUpgrade(req, socket, head, wss))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const liveToken = issueToken({ secret: SECRET, scope: 'lsp', orgPath: liveOrg })

  const ws = new WebSocket(
    'ws://127.0.0.1:' + port + '/__arxa/artifacts/lsp?lang=rust&path=' + encodeURIComponent('projects/demo/src/main.rs'),
    ['arxa-lsp', liveToken])
  const reply = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('rust-analyzer did not answer initialize in 30s')), 30_000)
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString('utf8'))
      if (msg.id === 1) { clearTimeout(timer); resolve(msg) }
    })
    ws.on('error', (e) => { clearTimeout(timer); reject(e) })
    ws.on('open', () => {
      ws.send(JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { processId: process.pid, rootUri: null, capabilities: {} },
      }))
    })
  })
  assert.equal(ws.protocol, 'arxa-lsp'); ok('the server accepted ONLY the marker subprotocol (the token is never echoed)')
  assert.ok(reply.result && reply.result.capabilities, 'initialize returned capabilities')
  ok('LIVE: rust-analyzer answered initialize through the bridge')
  assert.ok(reply.result.capabilities.textDocumentSync !== undefined, 'the answer is a real LSP capability set')
  ok('LIVE: the capabilities are a real LSP payload, not an echo')
  assert.equal(bridge.stats().accepted, 1)
  assert.equal(bridge.stats().spawned, 1)
  ok('LIVE: exactly one server spawned for one socket')
  // THE point of projectRootFor: the server is rooted at the cargo project,
  // not at the org that merely contains it.
  assert.equal([...bridge.running.keys()][0], proj + '\0rust')
  ok('LIVE: rooted at the cargo project, not the org above it')

  ws.close()
  bridge.stopAll('selftest-done')
  await new Promise((r) => server.close(r))
  assert.equal(bridge.running.size, 0); ok('LIVE: the real child is reaped')
  fs.rmSync(liveOrg, { recursive: true, force: true })
}

console.log('selftest.lsp: ' + n + ' ok')
