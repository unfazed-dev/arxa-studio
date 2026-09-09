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
  resolveBin, readShellPath, lspHome, installArgv, childPath,
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

// ---- Freestyle root selection + cross-root denial -------------------------
{
  const rootA = '/tmp/arxa-lsp-freestyle-a'
  const rootB = '/tmp/arxa-lsp-freestyle-b'
  const resolved = []
  const spawned = []
  const fakeChild = () => ({
    stdout: { on: () => {} }, stderr: { on: () => {} }, stdin: { write: () => {} },
    on: () => {}, kill: () => {},
  })
  const bridge = createLspBridge({
    secret: SECRET,
    getOrgPath: () => ORG,
    getRootPath: (rootId) => ({ 'root-a': rootA, 'root-b': rootB })[rootId] ?? null,
    resolveAbs: async (args) => { resolved.push(args); return path.join(args.orgPath, args.relPath) },
    exists: (p) => p === '/bin/fake-rust' || p === path.join(rootA, 'Cargo.toml'),
    spawn: (_cmd, _args, opts) => { spawned.push(opts.cwd); return fakeChild() },
    shellPath: '',
    servers: { rust: { exts: ['.rs'], cmd: '/bin/fake-rust', args: [], rootMarkers: ['Cargo.toml'] } },
  })
  let upgraded = 0
  const wss = { handleUpgrade: (_req, _socket, _head, cb) => { upgraded++; cb({ on: () => {}, close: () => {}, send: () => {} }) } }
  const tokenA = issueToken({ secret: SECRET, scope: 'lsp', orgPath: rootA })
  const accepted = fakeSocket()
  await bridge.handleUpgrade({
    url: '/__arxa/artifacts/lsp?lang=rust&path=src/main.rs&rootId=root-a',
    headers: { 'sec-websocket-protocol': 'arxa-lsp, ' + tokenA },
  }, accepted, Buffer.alloc(0), wss)
  assert.equal(accepted.destroyed, false, 'a token for the selected Freestyle root is accepted')
  assert.equal(upgraded, 1, 'the accepted Freestyle request reaches WebSocket upgrade')
  assert.equal(resolved[0].orgPath, rootA, 'path resolution is bounded by the selected Freestyle root')
  assert.equal(resolved[0].rootId, 'root-a', 'the selected registry id reaches path resolution')
  assert.deepEqual(spawned, [rootA], 'the language server roots at the Freestyle project')

  const wrong = fakeSocket()
  const tokenB = issueToken({ secret: SECRET, scope: 'lsp', orgPath: rootB })
  await bridge.handleUpgrade({
    url: '/__arxa/artifacts/lsp?lang=rust&path=src/main.rs&rootId=root-a',
    headers: { 'sec-websocket-protocol': 'arxa-lsp, ' + tokenB },
  }, wrong, Buffer.alloc(0), wss)
  assert.equal(wrong.destroyed, true, 'a token for root B cannot open a socket against root A')
  assert.equal(upgraded, 1, 'cross-root denial happens before WebSocket upgrade')
  assert.equal(resolved.length, 1, 'cross-root denial happens before filesystem resolution')
  bridge.retainRoots([rootB])
  assert.equal(bridge.running.size, 0, 'closing a Freestyle root reaps its language server')
  ok('Freestyle LSP selects the requested open root and denies cross-root tokens')
}

// ---- 2c: the rest of the languages -----------------------------------------
{
  for (const [ext, lang] of [
    ['.ts', 'typescript'], ['.tsx', 'typescript'], ['.mts', 'typescript'], ['.cts', 'typescript'],
    ['.js', 'typescript'], ['.jsx', 'typescript'], ['.mjs', 'typescript'], ['.cjs', 'typescript'],
    ['.html', 'html'], ['.htm', 'html'],
    ['.css', 'css'], ['.scss', 'css'], ['.less', 'css'],
    ['.json', 'json'], ['.jsonc', 'json'],
    ['.rs', 'rust'], ['.dart', 'dart'],
  ]) assert.equal(langForPath('x' + ext), lang, ext + ' routes to ' + lang)
  assert.equal(langForPath('x.py'), null, 'a language with no row is still no error')
  ok('typescript/js, html, css and json route to their servers')

  // These four are Node programs with a `#!/usr/bin/env node` shebang. Measured:
  // under the engine's PATH that shebang dies with "env: node: No such file or
  // directory" — not an ENOENT on the server itself, so it would read as a
  // healthy spawn that instantly exited.
  for (const lang of ['typescript', 'html', 'css', 'json']) {
    assert.ok(Array.isArray(LANG_SERVERS[lang].npm) && LANG_SERVERS[lang].npm.length > 0,
      lang + ' is installable')
    assert.deepEqual(LANG_SERVERS[lang].args, ['--stdio'])
  }
  assert.equal(LANG_SERVERS.dart.npm, undefined,
    'dart ships inside the SDK — there is no download, only locating one')
  assert.equal(LANG_SERVERS.rust.npm, undefined, 'rust-analyzer is not an npm package')
  ok('the installable rows are exactly the npm ones; dart and rust are locate-only')

  // typescript-language-server ships no compiler: it looks for `typescript` in
  // the WORKSPACE and refuses to start without one ("Could not find a valid
  // TypeScript installation ... Exiting" — measured). Its resolution order,
  // read out of the installed cli.mjs, is user path -> workspace -> fallback,
  // so arxa's copy fills the gap without overriding a project's own compiler.
  assert.deepEqual(
    LANG_SERVERS.typescript.initOptions({ ARXA_HOME: '/tmp/h' }),
    { tsserver: { fallbackPath: path.join('/tmp/h', 'lsp', 'node_modules', 'typescript', 'lib', 'tsserver.js') } })
  assert.ok(LANG_SERVERS.typescript.npm.includes('typescript@^5'),
    'typescript is PINNED to 5: 7 is the native rewrite and ships no tsserver.js, so an unpinned install silently kills the row')
  for (const lang of ['html', 'css', 'json']) {
    assert.equal(LANG_SERVERS[lang].initOptions, undefined, lang + ' needs no initialization options')
  }
  ok('the typescript row carries a compiler fallback and pins the compiler major')
}

// ---- where an arxa-installed server lives ----------------------------------
{
  assert.equal(lspHome({ ARXA_HOME: '/tmp/h' }), path.join('/tmp/h', 'lsp'))
  const argv = installArgv('typescript', LANG_SERVERS, { ARXA_HOME: '/tmp/h' })
  assert.equal(argv.cmd, 'npm')
  assert.ok(argv.args.includes('--prefix') && argv.args.includes(path.join('/tmp/h', 'lsp')))
  assert.ok(argv.args.includes('typescript-language-server') && argv.args.includes('typescript@^5'))
  assert.equal(installArgv('dart', LANG_SERVERS, {}), null, 'dart has nothing to install')
  assert.equal(installArgv('cobol', LANG_SERVERS, {}), null)
  ok('installArgv installs into <arxa home>/lsp and refuses a locate-only language')

  // arxa's own copy WINS over whatever a shell exports: a stale global server
  // must not shadow the one the Install button just put there.
  const arxaBin = path.join('/tmp/h', 'lsp', 'node_modules', '.bin')
  const found = resolveBin('typescript-language-server', {
    env: { ARXA_HOME: '/tmp/h', PATH: '/usr/bin' },
    extraPath: '/somebody/global/bin',
    exists: (f) => f === path.join(arxaBin, 'typescript-language-server') ||
                   f === '/somebody/global/bin/typescript-language-server',
  })
  assert.equal(found, path.join(arxaBin, 'typescript-language-server'))
  ok("arxa's own lsp directory is searched before the shell PATH")
}

// ---- the child's PATH ------------------------------------------------------
{
  const p = childPath({ ARXA_HOME: '/tmp/h', PATH: '/usr/bin' }, '/shell/bin').split(path.delimiter)
  assert.ok(p.includes('/usr/bin') && p.includes('/shell/bin'))
  assert.ok(p.includes(path.join('/tmp/h', 'lsp', 'node_modules', '.bin')))
  assert.ok(p.includes(path.dirname(process.execPath)),
    "arxa's own node is the last resort, so `#!/usr/bin/env node` resolves even with no node installed")
  ok('the child PATH carries the toolchain, arxa\'s installed servers, and a node')
}

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

  // The CHILD gets the toolchain PATH too. rust-analyzer shells out to cargo
  // for every diagnostic, and cargo sits in the same directory the engine's own
  // PATH cannot see — measured: `cargo` is missing under launchd's PATH. Without
  // this the server starts, answers initialize, and reports nothing forever.
  const opts = []
  const c = createLspBridge({
    secret: SECRET, getOrgPath: () => ORG, shellPath: '/opt/toolchain/bin',
    env: { PATH: '/usr/bin' }, exists: () => true,
    spawn: (_cmd, _args, o) => {
      opts.push(o)
      return { stdout: { on: () => {} }, stderr: { on: () => {} }, stdin: { write: () => {} }, on: () => {}, kill: () => {} }
    },
    servers: { rust: { exts: ['.rs'], cmd: 'rust-analyzer', args: [] } },
  })
  c.ensureServer(ORG, 'rust', '/opt/toolchain/bin')
  assert.ok(opts[0].env.PATH.startsWith('/usr/bin:/opt/toolchain/bin'),
    'the child inherits the engine PATH PLUS the toolchain PATH, in that order')
  assert.equal(opts[0].env.PATH, childPath({ PATH: '/usr/bin' }, '/opt/toolchain/bin'))
  assert.equal(opts[0].cwd, ORG)
  c.stopAll('test')

  // No toolchain PATH to add: the rest of the env still survives, and the
  // child still gets arxa's own directories (a node for the npm servers).
  const passthrough = []
  const baseEnv = { PATH: '/usr/bin', SOMETHING: 'kept' }
  const d = createLspBridge({
    secret: SECRET, getOrgPath: () => ORG, shellPath: '', env: baseEnv, exists: () => true,
    spawn: (_cmd, _args, o) => {
      passthrough.push(o)
      return { stdout: { on: () => {} }, stderr: { on: () => {} }, stdin: { write: () => {} }, on: () => {}, kill: () => {} }
    },
    servers: { rust: { exts: ['.rs'], cmd: 'rust-analyzer', args: [] } },
  })
  d.ensureServer(ORG, 'rust')
  assert.equal(passthrough[0].env.SOMETHING, 'kept', 'the rest of the environment survives')
  assert.equal(passthrough[0].env.PATH, childPath(baseEnv, ''))
  assert.ok(passthrough[0].env.PATH.includes(path.dirname(process.execPath)))
  d.stopAll('test')
  ok('the language server child is spawned with the toolchain on its PATH')
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

// ---- a loose file is not an error -------------------------------------------
// html, css and json normally have NO manifest above them. projectRootFor
// answering null there would deny every such file with 'no-project-root'.
{
  const org = '/org'
  const none = () => false
  assert.equal(projectRootFor('/org/a/b/x.html', org, [], none), null,
    'no markers and no fallback is still null (the old contract holds)')
  assert.equal(projectRootFor('/org/a/b/x.html', org, [], none, { fallbackToFileDir: true }),
    '/org/a/b', "with the fallback, a loose file roots at its own directory")
  assert.equal(projectRootFor('/org/a/b/x.ts', org, ['tsconfig.json'],
    (f) => f === '/org/a/tsconfig.json', { fallbackToFileDir: true }), '/org/a',
    'a real manifest still beats the fallback')
  assert.equal(projectRootFor('/elsewhere/x.html', org, [], none, { fallbackToFileDir: true }), null,
    'the fallback is still BOUNDED by the org — a file outside it roots nowhere')
  ok('a file with no manifest roots at its own directory, never outside the org')
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

// ---- LIVE: a real typescript-language-server, if one is installed -----------
// Gated on the binary rather than skipped outright: CI must not download from
// npm, but the moment the Install door has run once this becomes a real check.
{
  const tsBin = resolveBin('typescript-language-server', { env: process.env, extraPath: await readShellPath({}) })
  if (tsBin === null) {
    console.log('  SKIP  live typescript-language-server — not installed (press Install, or run installServer)')
  } else {
    const liveOrg = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-lsp-ts-'))
    // NO tsconfig and NO package.json on purpose: a loose .ts file is the
    // normal case, and it must root at its own directory rather than be denied.
    fs.mkdirSync(path.join(liveOrg, 'notes'), { recursive: true })
    fs.writeFileSync(path.join(liveOrg, 'notes', 'loose.ts'), 'const n: number = "no"\n')

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
      'ws://127.0.0.1:' + port + '/__arxa/artifacts/lsp?lang=typescript&path=' + encodeURIComponent('notes/loose.ts'),
      ['arxa-lsp', liveToken])
    const reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('typescript-language-server did not answer initialize in 30s')), 30_000)
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString('utf8'))
        if (msg.id === 1) { clearTimeout(timer); resolve(msg) }
      })
      ws.on('error', (e) => { clearTimeout(timer); reject(e) })
      ws.on('open', () => {
        ws.send(JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: {
            processId: null,
            rootUri: null,
            capabilities: {},
            // The same options the editor sends: without the compiler fallback
            // this server refuses to start on a file outside a node project.
            initializationOptions: LANG_SERVERS.typescript.initOptions(process.env),
          },
        }))
      })
    })
    assert.ok(reply.result && reply.result.capabilities,
      'a real LSP payload came back' + (reply.error ? ' — got: ' + reply.error.message : ''))
    ok('LIVE: typescript-language-server answered initialize through the bridge')
    assert.equal([...bridge.running.keys()][0], path.join(liveOrg, 'notes') + '\0typescript',
      'a loose .ts with no manifest rooted at its own directory, not nowhere')
    ok('LIVE: the no-manifest fallback roots the server at the file\'s folder')
    bridge.stopAll('test-over')
    await new Promise((r) => setTimeout(r, 200))
    server.close()
    try { ws.close() } catch {}
    fs.rmSync(liveOrg, { recursive: true, force: true })
  }
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
