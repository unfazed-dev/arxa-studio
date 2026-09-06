// LSP bridge for the artifact viewer (G8, G11).
//
// One WebSocket per (open org, language). The browser speaks JSON-RPC over the
// socket; this module speaks the same JSON-RPC to a real language server over
// stdio, translating between WebSocket messages and LSP's Content-Length
// framing. The server is spawned LAZILY — on the first file of that language —
// rooted at the open org, and killed on org switch.
//
// Why the socket rides `webServer.registerUpgrade` rather than a second
// ephemeral-port server: the engine already tracks upgraded sockets and awaits
// them on shutdown (dsh-host-webserver `upgradedSockets`), so a language server
// session cannot outlive the host by holding a socket open.
import { spawn as nodeSpawn, execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { verifyToken } from './tokens.js'

/** Which server serves which files.
 *
 *  Only rows that have been RUN are here. `typescript-language-server` and
 *  `vscode-langservers-extracted` (html/css/json) are named by the plan but are
 *  not installed on the machine this was built on, and a routing row nobody has
 *  ever exercised is a liability rather than a head start — they arrive with
 *  the install flow that can fetch them.
 *
 *  An extension with no row is not an error: the editor opens exactly as it
 *  does today, just without diagnostics. */
export const LANG_SERVERS = {
  rust: {
    exts: ['.rs'],
    cmd: 'rust-analyzer',
    args: [],
    // rust-analyzer's own defaults run build scripts and proc macros, which is
    // arbitrary code from the project. That is what VS Code does too and it is
    // the user's own project — but it is the reason this spawn takes an
    // injectable `spawn`, so a confined one can be handed in without touching
    // the bridge.
    rootMarkers: ['Cargo.toml'],
  },
  dart: {
    exts: ['.dart'],
    cmd: 'dart',
    args: ['language-server', '--protocol=lsp'],
    rootMarkers: ['pubspec.yaml'],
    // No `npm`: the Dart language server ships INSIDE the Dart/Flutter SDK.
    // There is nothing to download — an install door here could only locate an
    // SDK the user already has, which is what resolveBin already does.
  },
  // The four below are npm packages, so `npm` is both the install instruction
  // and the marker that an Install door may offer them. They are Node programs
  // with a `#!/usr/bin/env node` shebang, which is why childPath() must carry a
  // node: measured, under the engine's own PATH the shebang dies with
  // "env: node: No such file or directory" — an instant exit that looks like a
  // healthy spawn, not like a missing binary.
  typescript: {
    exts: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
    cmd: 'typescript-language-server',
    args: ['--stdio'],
    // `typescript@^5`, PINNED. typescript@7 is the native rewrite: its lib/ holds
    // tsc.js and getExePath.js and no tsserver.js at all, and this server drives
    // tsserver. Unpinned, npm installs 7 and every .ts file gets nothing.
    npm: ['typescript-language-server', 'typescript@^5'],
    // The server ships no compiler — it looks for `typescript` IN THE WORKSPACE
    // and refuses to start without one. Measured, verbatim:
    //   "Could not find a valid TypeScript installation. Please ensure that the
    //    \"typescript\" dependency is installed in the workspace or that a valid
    //    `tsserver.path` is specified. Exiting."
    // So a loose .ts file outside a node project would never get a server.
    //
    // Read out of the installed cli.mjs rather than from memory: there is NO
    // --tsserver-path flag (the whole CLI is --stdio and --log-level); the knob
    // is initializationOptions, and findTypescriptVersion() tries the user path,
    // then the WORKSPACE, then this fallback. So a project with its own
    // TypeScript still uses it — arxa's copy only fills the gap.
    initOptions: (env = process.env) => ({
      tsserver: { fallbackPath: path.join(lspHome(env), 'node_modules', 'typescript', 'lib', 'tsserver.js') },
    }),
    rootMarkers: ['tsconfig.json', 'jsconfig.json', 'package.json'],
    rootFallback: true,
  },
  html: {
    exts: ['.html', '.htm'],
    cmd: 'vscode-html-language-server',
    args: ['--stdio'],
    npm: ['vscode-langservers-extracted'],
    rootMarkers: [],
    rootFallback: true,
  },
  css: {
    exts: ['.css', '.scss', '.less'],
    cmd: 'vscode-css-language-server',
    args: ['--stdio'],
    npm: ['vscode-langservers-extracted'],
    rootMarkers: [],
    rootFallback: true,
  },
  json: {
    exts: ['.json', '.jsonc'],
    cmd: 'vscode-json-language-server',
    args: ['--stdio'],
    npm: ['vscode-langservers-extracted'],
    rootMarkers: [],
    rootFallback: true,
  },
}

/** Where arxa keeps the language servers it installed itself.
 *
 *  Its own prefix, never a global npm install: arxa must not change what the
 *  user's own `npm -g` holds, and an arxa-installed server has to be
 *  removable by deleting one directory. */
export function lspHome (env = process.env) {
  return path.join(env.ARXA_HOME || path.join(os.homedir(), '.arxa'), 'lsp')
}

const lspBinDir = (env) => path.join(lspHome(env), 'node_modules', '.bin')

/** The npm command that installs one language's server, or null when the
 *  language is locate-only (dart, rust) or unknown. */
export function installArgv (lang, servers = LANG_SERVERS, env = process.env) {
  const def = servers[lang]
  if (def === void 0 || !Array.isArray(def.npm) || def.npm.length === 0) return null
  return {
    cmd: 'npm',
    args: ['install', '--prefix', lspHome(env), '--no-audit', '--no-fund', ...def.npm],
  }
}

/** The PATH a language server child runs with.
 *
 *  Three things it needs that the engine's own PATH does not have: the user's
 *  toolchain (rust-analyzer runs `cargo` for every diagnostic), whatever arxa
 *  installed itself, and a `node` for the `#!/usr/bin/env node` shebangs.
 *  arxa's own node goes LAST — a user's node wins, but a machine with no node
 *  installed at all still runs the npm servers. */
export function childPath (env = process.env, extraPath = '') {
  const dirs = [
    ...String(env.PATH ?? '').split(path.delimiter),
    ...String(extraPath ?? '').split(path.delimiter),
    lspBinDir(env),
    path.dirname(process.execPath),
  ].filter(Boolean)
  return [...new Set(dirs)].join(path.delimiter)
}

/** The nearest PROJECT root above `absFile`, or null.
 *
 *  This is the difference between the language service working and silently
 *  doing nothing. An arxa org is a workspace of notes, meetings and projects —
 *  it is not itself a Cargo or Flutter project, so a server rooted at the org
 *  finds no manifest and reports nothing, with no error to explain it. The root
 *  has to be the directory holding Cargo.toml / pubspec.yaml.
 *
 *  The walk is BOUNDED by orgRoot: a marker outside the open org must never
 *  become a server root, or opening one file could root a language server
 *  anywhere above it on the filesystem.
 *
 *  Session worktrees live at <repo>/.arxa/worktrees/<id>, INSIDE the org, so
 *  the same walk finds the project copy inside the worktree — which is the
 *  right root for a file being edited there. */
export function projectRootFor (absFile, orgRoot, markers, exists = (p) => fs.existsSync(p),
  { fallbackToFileDir = false } = {}) {
  const root = path.resolve(orgRoot)
  const fileDir = path.dirname(path.resolve(absFile))
  if (fileDir !== root && !fileDir.startsWith(root + path.sep)) return null
  if (Array.isArray(markers) && markers.length > 0) {
    let dir = fileDir
    for (;;) {
      for (const marker of markers) {
        if (exists(path.join(dir, marker))) return dir
      }
      if (dir === root) break
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
  }
  // html, css and json normally have NO manifest above them, and a loose .ts
  // still analyses fine on its own. Denying those would make "no diagnostics"
  // the normal case for three of the five languages. The fallback is still
  // inside the org — the bounds check above already ran.
  return fallbackToFileDir ? fileDir : null
}

/** The language id for a path, or null when nothing serves it. */
export function langForPath (relPath) {
  const dot = String(relPath ?? '').lastIndexOf('.')
  if (dot < 0) return null
  const ext = relPath.slice(dot).toLowerCase()
  for (const [lang, def] of Object.entries(LANG_SERVERS)) {
    if (def.exts.includes(ext)) return lang
  }
  return null
}

/** LSP's stdio framing: `Content-Length: N\r\n\r\n<N bytes of utf8 json>`.
 *
 *  Written as a byte-counting reader, not a line reader: the length is in
 *  BYTES and json with any non-ascii character (a path with an accent, a
 *  diagnostic quoting the user's source) makes byte length and string length
 *  disagree. Reading by characters there silently desynchronises the stream
 *  and every later message is garbage. */
export function createFrameReader (onMessage) {
  let buf = Buffer.alloc(0)
  return (chunk) => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      const end = buf.indexOf('\r\n\r\n')
      if (end < 0) return
      const header = buf.subarray(0, end).toString('ascii')
      const m = /content-length:\s*(\d+)/i.exec(header)
      if (m === null) { buf = buf.subarray(end + 4); continue }  // unframed noise
      const len = Number(m[1])
      const start = end + 4
      if (buf.length < start + len) return                       // wait for the body
      onMessage(buf.subarray(start, start + len).toString('utf8'))
      buf = buf.subarray(start + len)
    }
  }
}

/** Frame one json string for a language server's stdin. */
export function frame (json) {
  const body = Buffer.from(json, 'utf8')
  return Buffer.concat([Buffer.from('Content-Length: ' + body.length + '\r\n\r\n', 'ascii'), body])
}

/** Read the token a browser WebSocket smuggled through Sec-WebSocket-Protocol.
 *
 *  A browser cannot set headers on a WebSocket, so the usual
 *  `x-arxa-write-token` shape does not transfer. The subprotocol list can carry
 *  it: the token is base64url + '.', every character of which is a valid
 *  protocol token per RFC 6455/7230, and unlike a query string it does not land
 *  in a URL that gets logged or referred. The client offers
 *  ['arxa-lsp', <token>] and the server accepts only 'arxa-lsp'. */
export function tokenFromProtocols (header) {
  const parts = String(header ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (parts[0] !== 'arxa-lsp') return null
  return parts[1] ?? null
}

/** Where a language server binary actually lives, or null.
 *
 *  A desktop-launched engine does NOT inherit the user's shell PATH. Measured
 *  on the machine this was built on, the engine's whole PATH is
 *  `/usr/bin:/bin:/usr/sbin:/sbin` — launchd's default, which holds no
 *  toolchain at all. `dart` was under fvm and `rust-analyzer` under a CARGO_HOME
 *  on another volume entirely, so a list of well-known directories would have
 *  found NEITHER. Without this the bridge does everything right and then spawns
 *  a binary that is not there: ENOENT, socket closed, no diagnostics, and no
 *  error anywhere that says why.
 *
 *  ARXA_LSP_<LANG> (ARXA_LSP_RUST, ARXA_LSP_DART) wins over everything — the
 *  knob for a toolchain no shell exports either. */
export function resolveBin (cmd, { env = process.env, exists = fs.existsSync, extraPath = '' } = {}) {
  if (typeof cmd !== 'string' || cmd === '') return null
  if (cmd.includes(path.sep)) return exists(cmd) ? cmd : null
  const dirs = [
    // arxa's own installed servers come FIRST: what the Install door just put
    // there must not be shadowed by a stale global of the same name.
    lspBinDir(env),
    ...String(env.PATH ?? '').split(path.delimiter),
    ...String(extraPath ?? '').split(path.delimiter),
  ].filter(Boolean)
  for (const dir of dirs) {
    const p = path.join(dir, cmd)
    if (exists(p)) return p
  }
  return null
}

/** The login shell's PATH, or '' — the only thing that knows where a user's
 *  toolchain is. Same problem, and the same answer, as VS Code's shell
 *  environment resolution.
 *
 *  `-lic`: login AND interactive, because PATH is set in .zshrc as often as in
 *  .zprofile. That means the output can also carry a banner, a prompt, or an
 *  fvm/nvm greeting, so the value is fenced by markers rather than trusted to
 *  be the whole of stdout. Plain-ASCII markers, not \x01: POSIX printf is not
 *  required to understand hex escapes. */
export function readShellPath ({ env = process.env, run = execFile, timeoutMs = 3000 } = {}) {
  const shell = env.SHELL
  if (typeof shell !== 'string' || shell === '') return Promise.resolve('')
  return new Promise((resolve) => {
    try {
      run(shell, ['-lic', 'printf "@ARXA_PATH@%s@END@" "$PATH"'],
        { timeout: timeoutMs, encoding: 'utf8', maxBuffer: 1 << 20 },
        (_err, stdout) => {
          const m = /@ARXA_PATH@([\s\S]*?)@END@/.exec(String(stdout ?? ''))
          resolve(m === null ? '' : m[1])
        })
    } catch { resolve('') }
  })
}

/** Install one language's server into arxa's own prefix.
 *
 *  NEVER automatic (the plan's rule): a caller reaches this only because a
 *  person pressed Install. npm does its own integrity checking, so there is no
 *  download, extract or hash code here to get wrong — and npm itself has to be
 *  resolved the same way the servers are, because it is under nvm on this
 *  machine and invisible to the engine's PATH. */
export async function installServer ({
  lang, servers = LANG_SERVERS, env = process.env, spawn = nodeSpawn, extraPath = '', log = () => {},
}) {
  const argv = installArgv(lang, servers, env)
  if (argv === null) return { ok: false, reason: 'not-installable' }
  const npm = resolveBin(argv.cmd, { env, extraPath })
  if (npm === null) return { ok: false, reason: 'npm-not-found' }
  try { fs.mkdirSync(lspHome(env), { recursive: true }) } catch { return { ok: false, reason: 'home-unwritable' } }
  log('lsp: installing ' + lang + ' (' + argv.args.slice(-2).join(' ') + ')')
  return new Promise((resolve) => {
    let out = ''
    let child
    try {
      child = spawn(npm, argv.args, { env: { ...env, PATH: childPath(env, extraPath) }, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch { return resolve({ ok: false, reason: 'spawn-failed' }) }
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('error', () => resolve({ ok: false, reason: 'spawn-failed' }))
    child.on('exit', (code) => {
      log('lsp: install ' + lang + ' exited ' + code)
      resolve(code === 0 ? { ok: true } : { ok: false, reason: 'npm-exit-' + code, output: out.slice(-2000) })
    })
  })
}

/** The bridge.
 *
 *  `getOrgPath` is the authority on which org is open — a client cannot name
 *  one. `spawn` is injected so the selftest can drive a fake and so a confined
 *  spawner can replace it without this module changing. */
export function createLspBridge ({
  secret, getOrgPath, spawn = nodeSpawn, servers = LANG_SERVERS, log = () => {},
  env = process.env,
  // null = probe the login shell once, lazily. A test passes '' to skip it.
  shellPath = null,
  // Resolves the client's (relPath, session) to a real absolute path. Injected
  // rather than imported so this module stays free of the worktree resolver,
  // and so the client NEVER names a path itself — it names a file it already
  // holds a token for, and the host says where that file is.
  resolveAbs = null,
  exists = (p) => fs.existsSync(p),
}) {
  /** key `<orgPath> <lang>` -> { child, sockets:Set, reader } */
  const running = new Map()
  const stats = { accepted: 0, refused: 0, spawned: 0, spawnFailed: 0, killed: 0 }
  // Probed at most once per bridge, off the first upgrade rather than at
  // startup: a slow login shell must not delay the engine booting.
  let extraPathP = null
  const extraPath = () => (extraPathP ??= (shellPath === null ? readShellPath({ env }) : Promise.resolve(shellPath)))

  function stopAll (why) {
    for (const [key, entry] of running) {
      for (const ws of entry.sockets) { try { ws.close(1001, why) } catch {} }
      try { entry.child.kill() } catch {}
      stats.killed++
      log('lsp: stopped ' + key.replace('\0', ' / ') + ' (' + why + ')')
    }
    running.clear()
  }

  /** Start (or join) the server for `lang` rooted at `root` — the PROJECT
   *  directory (the one holding Cargo.toml / pubspec.yaml), NOT the org. A
   *  server rooted at the org finds no manifest and reports nothing at all.
   *
   *  Returns null when the binary is absent: the caller closes the socket with
   *  a code the client reads as "no server", and the editor carries on. */
  function ensureServer (root, lang, extra = '') {
    // NUL-separated: a path may contain spaces, so a space here would make
    // two different (root, lang) pairs collide on one key.
    const key = root + '\0' + lang
    const live = running.get(key)
    if (live !== void 0) return live
    const def = servers[lang]
    if (def === void 0) return null
    const cmd = resolveBin(env['ARXA_LSP_' + lang.toUpperCase()] || def.cmd, { env, exists, extraPath: extra })
    if (cmd === null) {
      stats.spawnFailed++
      log('lsp: ' + lang + ' unavailable — ' + def.cmd + ' is not on the engine PATH')
      return null
    }
    let child
    try {
      child = spawn(cmd, def.args, {
        cwd: root,
        // The CHILD needs its own PATH, not just the lookup that found it.
        // rust-analyzer shells out to `cargo` (metadata, check) for every
        // diagnostic, and the npm servers are `#!/usr/bin/env node` scripts —
        // measured, neither cargo nor node is reachable from the engine's own
        // /usr/bin:/bin:/usr/sbin:/sbin. Left alone the server starts, answers
        // initialize, holds a healthy socket and never reports anything.
        env: { ...env, PATH: childPath(env, extra) },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch {
      stats.spawnFailed++
      return null
    }
    const entry = { child, sockets: new Set(), lang, root }
    // A binary that is missing fails ASYNCHRONOUSLY on spawn (ENOENT on the
    // 'error' event), not by throwing, so the catch above is not enough.
    child.on('error', () => {
      stats.spawnFailed++
      running.delete(key)
      for (const ws of entry.sockets) { try { ws.close(4004, 'language-server-unavailable') } catch {} }
    })
    child.on('exit', (code) => {
      running.delete(key)
      for (const ws of entry.sockets) { try { ws.close(1011, 'language-server-exited-' + code) } catch {} }
      log('lsp: ' + lang + ' exited (' + code + ')')
    })
    const read = createFrameReader((json) => {
      for (const ws of entry.sockets) { try { ws.send(json) } catch {} }
    })
    child.stdout.on('data', read)
    // stderr is the server's own diagnostics, never protocol — relaying it into
    // the socket would corrupt the json-rpc stream.
    child.stderr.on('data', (d) => log('lsp[' + lang + ']: ' + String(d).trimEnd()))
    running.set(key, entry)
    stats.spawned++
    log('lsp: started ' + lang + ' in ' + root)
    return entry
  }

  /** webServer.registerUpgrade handler. `wss` is a ws WebSocketServer in
   *  noServer mode, injected so the selftest can drive it without a port. */
  async function handleUpgrade (req, socket, head, wss) {
    const url = new URL(req.url ?? '/', 'http://x')
    const lang = url.searchParams.get('lang') ?? ''
    const token = tokenFromProtocols(req.headers['sec-websocket-protocol'])
    const orgPath = getOrgPath()
    const deny = (why) => {
      stats.refused++
      log('lsp: refused (' + why + ')')
      try { socket.write('HTTP/1.1 403 Forbidden\r\nconnection: close\r\n\r\n') } catch {}
      socket.destroy()
    }
    // Deny-default, in the order that leaks least: no org, then no token, then
    // an unserved language.
    if (orgPath === null || orgPath === undefined) return deny('no-org')
    if (token === null) return deny('no-token')
    if (!verifyToken(token, { secret, scope: 'lsp', orgPath }).ok) return deny('bad-token')
    if (servers[lang] === void 0) return deny('unserved-language')

    // The client names a RELATIVE path (and a session, for a worktree file);
    // the host resolves where that actually is. Nothing the client sends is
    // used as a filesystem path directly.
    const relPath = url.searchParams.get('path') ?? ''
    const session = url.searchParams.get('session')
    let absFile = null
    try {
      absFile = resolveAbs === null
        ? path.join(orgPath, relPath)
        : await resolveAbs({ relPath, session, orgPath })
    } catch { absFile = null }
    if (absFile === null) return deny('unresolvable-path')
    // The project root, not the org: an arxa org holds notes and meetings as
    // well as code, so a server rooted there would find no manifest and report
    // nothing at all — with no error to explain the silence.
    const root = projectRootFor(absFile, orgPath, servers[lang].rootMarkers, exists,
      { fallbackToFileDir: servers[lang].rootFallback === true })
    if (root === null) return deny('no-project-root')

    const extra = await extraPath()
    wss.handleUpgrade(req, socket, head, (ws) => {
      const entry = ensureServer(root, lang, extra)
      if (entry === null) {
        // The lane still opens; only the language service is missing.
        try { ws.close(4004, 'language-server-unavailable') } catch {}
        return
      }
      stats.accepted++
      entry.sockets.add(ws)
      ws.on('message', (data) => {
        try { entry.child.stdin.write(frame(typeof data === 'string' ? data : data.toString('utf8'))) } catch {}
      })
      const drop = () => {
        entry.sockets.delete(ws)
        // The child OUTLIVES its last socket on purpose: reopening a file of
        // the same language must not pay for a cold rust-analyzer index again.
        // The org switch is what ends it.
      }
      ws.on('close', drop)
      ws.on('error', drop)
    })
  }

  return { handleUpgrade, stopAll, ensureServer, stats: () => ({ ...stats }), running, extraPath }
}
