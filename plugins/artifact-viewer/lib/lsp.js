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
  },
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
export function projectRootFor (absFile, orgRoot, markers, exists = (p) => fs.existsSync(p)) {
  if (!Array.isArray(markers) || markers.length === 0) return null
  const root = path.resolve(orgRoot)
  let dir = path.dirname(path.resolve(absFile))
  if (dir !== root && !dir.startsWith(root + path.sep)) return null
  for (;;) {
    for (const marker of markers) {
      if (exists(path.join(dir, marker))) return dir
    }
    if (dir === root) return null
    const up = path.dirname(dir)
    if (up === dir) return null
    dir = up
  }
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
        // The CHILD needs the toolchain PATH too, not just the lookup that
        // found it. rust-analyzer shells out to `cargo` (metadata, check) for
        // every diagnostic, and cargo is in the same directory the engine's
        // own PATH cannot see — measured: `cargo` is missing under
        // /usr/bin:/bin:/usr/sbin:/sbin. Left alone the server starts, answers
        // initialize, holds a healthy socket and never reports anything.
        env: extra === '' ? env : { ...env, PATH: [env.PATH, extra].filter(Boolean).join(path.delimiter) },
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
    const root = projectRootFor(absFile, orgPath, servers[lang].rootMarkers, exists)
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

  return { handleUpgrade, stopAll, ensureServer, stats: () => ({ ...stats }), running }
}
