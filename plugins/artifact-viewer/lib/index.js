// Host half of arxa-artifact-viewer (D7 + D78-D87): the artifact viewer-editor.
// Task 1 skeleton — settings namespace only. The per-org GET-only file server
// (D7), read/write token classes (D7/D81), the engine write API (D81), and the
// external-change watcher (D86) land in later tasks of
// docs/plans/artifact-viewer-implementation.md.
//
// Imports resolve from the operator dsh install when the profile's copied
// node_modules lacks @deepseek-ai/* (same fallback dance as design-panel and
// pi-delegate — pnpm copies file: deps without their peers).
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

async function fromDsh(pkg, sub) {
  try { return await import(pkg) } catch {
    return await import(pathToFileURL(join(
      homedir(), '.dsh', 'profiles', 'node_modules', pkg, sub)).href)
  }
}
const { default: z } = await fromDsh('@deepseek-ai/schemastery', 'lib/index.mjs')
import { createOrgServer } from './org-server.js'
import { startRootFollow, readOpenOrg, readOpenRoot, readOpenRootAliases } from './follow.js'
import { createWriteApi, createMainVersionRoute, createVersionRoute, resolveWorktree } from './write-api.js'
import { createWorktreeRoute, createTreeRoute, createSessionChangesRoute, resolveWorktreeFile } from './wt-api.js'
import { createOrgWatcher, createEventsRoute } from './watcher.js'
import { TOKEN_TTL_CEILING_SECONDS, issueToken, loadOrCreateSecret, readVerifyFor, verifyToken } from './tokens.js'
import { createLspBridge, installArgv, installServer, resolveBin, LANG_SERVERS } from './lsp.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export { TOKEN_TTL_CEILING_SECONDS }
export const inject = ['webServer']

export const name = 'arxa-artifact-viewer'

export function defaultSettings() {
  return { maxEditBytes: 5_000_000, tokenTtlSeconds: 120 }
}

// dsh 0.1.2-rc.1 dropped the settingsNamespace() branding helper; the
// settings provider validates kebab-case itself (installSection throws
// TypeError on a bad namespace), so the plain string is the namespace.
const NS = 'arxa-artifact-viewer'
export const SCHEMA = z.object({
  maxEditBytes: z.number().min(1024).default(5_000_000).description(
    'Files above this size open read-only (D82 hard guard)'),
  tokenTtlSeconds: z.number().min(5).max(TOKEN_TTL_CEILING_SECONDS).default(120).description(
    'Artifact URL token lifetime in seconds; never above 120 (D7/D81)'),
})

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => { data += c })
    req.on('end', () => resolve(data))
    req.on('error', () => resolve(''))
  })
}

/**
 * Token issue route (POST /__arxa/artifacts/token) on the TRUSTED studio
 * origin. Read tokens require the org to be OPEN and the relPath to sit
 * inside it (checked here, server-side); write tokens are worktree-scoped
 * and their target validation happens again at write time (D81).
 * Factory shape keeps this testable without an engine.
 */
/** A relPath's real location inside the open org, or null if it escapes. */
function absOf(orgPath, relPath) {
  try {
    const rootReal = fs.realpathSync(path.resolve(orgPath))
    const abs = path.resolve(rootReal, path.normalize(relPath))
    return (abs === rootReal || abs.startsWith(rootReal + path.sep)) ? abs : null
  } catch { return null }
}

let freestylePathApiP = null
function freestylePathApi() {
  return freestylePathApiP ??= import('arxa-freestyle').catch(() =>
    import(new URL('../../arxa-freestyle/lib/index.js', import.meta.url).href))
}

/** Resolve an existing ordinary file under one selected root for LSP.
 *  The shared Freestyle resolver owns lexical, reserved-segment and symlink
 *  policy; this boundary adds the LSP-specific "must be a file" rule. */
export async function resolveLspFile(rootPath, relPath) {
  try {
    return await resolveReadFile(rootPath, relPath)
  } catch { return null }
}

async function resolveReadFile(rootPath, relPath) {
  const { resolveFreestyleInside } = await freestylePathApi()
  if (typeof resolveFreestyleInside !== 'function') throw new Error('resolver unavailable')
  const { abs } = resolveFreestyleInside(rootPath, relPath)
  const st = fs.statSync(abs)
  if (!st.isFile()) throw Object.assign(new Error('not a file'), { code: 'NOT_FILE' })
  return abs
}

function selectedOpenRoot(env, rootId) {
  return readOpenRoot(env, rootId)
}

/** Map one watched physical path to its public identities. A filtered stream
 * receives exactly the requested identity or no frame; an unfiltered stream
 * fans out aliases so same-path org/Freestyle consumers both invalidate. */
export function rootIdsForPath(env, rootPath, requestedId = null) {
  if (requestedId) {
    const requested = selectedOpenRoot(env, requestedId)
    return requested && path.resolve(requested.path) === path.resolve(rootPath)
      ? requested.id
      : null
  }
  const aliases = readOpenRootAliases(env)
    .filter((r) => path.resolve(r.path) === path.resolve(rootPath))
    .map((r) => r.id)
  return aliases.length ? aliases : null
}

/** Tiny trusted-origin metadata route for the viewer header. Physical paths
 * stay host-only; aliases remain visible so a same-path Freestyle id keeps
 * its own display name. */
export function createRootsRoute({ env = process.env } = {}) {
  return {
    handle(req, res) {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        return res.end('{"error":"GET only"}')
      }
      const roots = readOpenRootAliases(env).map(({ id, name, kind }) => ({ id, name, kind }))
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ roots }))
    },
  }
}

export function createTokenRoutes({ env = process.env, secret, getSettings, getOrigin = () => null }) {
  function json(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  async function handle(req, res) {
    try {
      if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
      let body = {}
      try { body = JSON.parse((await readBody(req)) || '{}') } catch { return json(res, 400, { error: 'bad json' }) }
      const ttl = (getSettings() || {}).tokenTtlSeconds || 120
      if (body.scope === 'write') {
        if (typeof body.rootId === 'string' && body.rootId !== '' && !body.worktreeId) {
          const root = selectedOpenRoot(env, body.rootId)
          if (!root) return json(res, 403, { error: 'root not open' })
          const token = issueToken({ secret, scope: 'write', worktreeId: 'root:' + body.rootId, orgPath: root.path, ttlSeconds: ttl })
          return json(res, 200, { token })
        }
        if (typeof body.worktreeId !== 'string' || body.worktreeId === '') {
          return json(res, 400, { error: 'worktreeId required for write tokens' })
        }
        const token = issueToken({ secret, scope: 'write', worktreeId: body.worktreeId, ttlSeconds: ttl })
        return json(res, 200, { token })
      }
      if (body.scope === 'wt-read' || body.scope === 'changes-read') {
        // D89 worktree read classes — validated here, validated again at the lane.
        let wtAbs = null
        if (typeof body.worktreeId !== 'string' || body.worktreeId === '') {
          return json(res, 400, { error: 'worktreeId required' })
        }
        if (body.scope === 'wt-read') {
          if (typeof body.relPath !== 'string' || body.relPath === '') return json(res, 400, { error: 'relPath required' })
          try {
            const open0 = readOpenOrg(env)
            const r0 = await resolveWorktreeFile({ env, orgPath: open0 ? open0.orgPath : null, worktreeId: body.worktreeId, relPath: body.relPath })
            wtAbs = r0.abs
          } catch (err) {
            const map = { BAD: 400, ESCAPE: 403, NO_SESSION: 404, NOT_FILE: 404 }
            return json(res, map[err.code] || 404, { error: 'unresolvable worktree file' })
          }
        }
        const token = issueToken({ secret, scope: body.scope, worktreeId: body.worktreeId, relPath: body.scope === 'wt-read' ? body.relPath : null, ttlSeconds: ttl })
        return json(res, 200, { token, absPath: wtAbs })
      }
      if (body.scope === 'lsp') {
        // Bound to the selected open root. A SEPARATE class from read on
        // purpose: this token opens a socket that spawns a language server, so
        // a leaked per-file read token must not be able to do it.
        const openL = selectedOpenRoot(env, body.rootId)
        if (!openL) return json(res, 403, { error: body.rootId ? 'root not open' : 'no org open' })
        const token = issueToken({ secret, scope: 'lsp', orgPath: openL.path, ttlSeconds: ttl })
        return json(res, 200, { token })
      }
      if (body.scope === 'lsp-install') {
        // A SEPARATE class from 'lsp' again: that one starts a server the user
        // already has, this one puts new software on their machine. Same root
        // binding, different authority — a leaked 'lsp' token must not install.
        const openI = selectedOpenRoot(env, body.rootId)
        if (!openI) return json(res, 403, { error: body.rootId ? 'root not open' : 'no org open' })
        const token = issueToken({ secret, scope: 'lsp-install', orgPath: openI.path, ttlSeconds: ttl })
        return json(res, 200, { token })
      }
      if (body.scope === 'tree-read') {
        // D90 directory listing class. Task 8 (freestyle-section): body.rootId
        // binds the token to any currently-open root (org or Freestyle),
        // resolved fresh against readOpenRoots — omitted rootId still binds to
        // the open org, so existing callers are unaffected.
        const target = selectedOpenRoot(env, body.rootId)
        if (!target) return json(res, 403, { error: body.rootId ? 'root not open' : 'no org open' })
        const token = issueToken({ secret, scope: 'tree-read', orgPath: target.path, ttlSeconds: ttl })
        return json(res, 200, { token })
      }
      // read (default) — orgPath OPTIONAL: the open org is authoritative,
      // a client-declared orgPath must MATCH it (no org-path probing).
      const open = selectedOpenRoot(env, body.rootId)
      if (!open) return json(res, 403, { error: body.rootId ? 'root not open' : 'no org open' })
      if (body.orgPath != null && body.orgPath !== open.path) return json(res, 403, { error: 'root not open' })
      if (typeof body.relPath !== 'string' || body.relPath === '') return json(res, 400, { error: 'relPath required' })
      // An org holds several repos that share filenames — <org>/check.sh and
      // <org>/projects/<slug>/check.sh both exist and differ. A session file's
      // relPath is WORKTREE-relative, so resolving it against the org root
      // silently answers with the org's own same-named file. Callers that know
      // the session say so, and the worktree rides IN the token so the reader
      // downstream (main-version) need not guess a repo. No worktreeId is
      // every existing caller, unchanged.
      const wtId = typeof body.worktreeId === 'string' && body.worktreeId !== '' ? body.worktreeId : null
      let abs
      if (wtId) {
        try { abs = (await resolveWorktreeFile({ env, orgPath: open.path, worktreeId: wtId, relPath: body.relPath })).abs }
        catch (err) {
          const map = { BAD: 400, ESCAPE: 403, NO_SESSION: 404, NOT_FILE: 404 }
          return json(res, map[err?.code] || 404, { error: 'unresolvable worktree file' })
        }
      } else
      try { abs = await resolveReadFile(open.path, body.relPath) }
      catch (err) {
        return json(res, err?.code === 'ENOENT' || err?.code === 'ENOTDIR' || err?.code === 'NOT_FILE' ? 404 : 403, { error: 'unresolvable path' })
      }
      const token = issueToken({ secret, scope: 'read', relPath: body.relPath, orgPath: open.path, worktreeId: wtId, ttlSeconds: ttl })
      if (body.rootId) return json(res, 200, { token, absPath: abs })
      const origin = getOrigin()
      if (!origin) return json(res, 503, { error: 'org server not up yet — retry' })
      // absPath is the file's REAL identity. The editor keys its model on it so
      // a language server's diagnostics land on the right file — a model at
      // /<relPath> would put every underline on a path the server never heard
      // of. Resolved here, server-side, exactly like the path check above.
      return json(res, 200, { token, origin, absPath: wtId ? abs : absOf(open.path, body.relPath) })
    } catch (err) {
      return json(res, 500, { error: 'internal error' })
    }
  }
  return { handle }
}

/** Every type the two bundles actually emit, measured from the real output —
 *  NOT a guess. The route used to default everything to text/javascript, which
 *  a .wasm cannot survive: WebAssembly.instantiateStreaming rejects any
 *  content-type but application/wasm, so the TextMate oniguruma engine (2 .wasm
 *  files) would fail outright and every grammar with it. The rest are typed
 *  because "works by accident under a lenient fetch" is not a contract. */
const EXT_TYPES = {
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.code-snippets': 'application/json; charset=utf-8', '.tmLanguage': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml', '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
}

/** Serves browser bundles on the studio origin from one or more FLAT dirs:
 *  lib/vendor/ (committed IIFE builds — lib/vendor.js) and the Monaco/VS Code
 *  build output (monaco-build/dist, ~200 files, gitignored, built at pack time).
 *  GET/HEAD only; basename-pinned (no subpaths, no traversal).
 *
 *  Two dirs rather than one merged one: dist/ is a build product of a separate
 *  npm root and lib/vendor/ is committed, so merging them would drop 200
 *  untracked files into a tracked directory. */
export function createVendorRoutes({ vendorDir, vendorDirs }) {
  const dirs = (vendorDirs ?? [vendorDir]).filter(Boolean)
  return {
    async handle(req, res) {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { 'content-type': 'text/plain' })
          return res.end('GET only')
        }
        const name = path.basename(decodeURIComponent(new URL(req.url, 'http://x').pathname))
        // The traversal guard is per-dir on purpose: checking a name against a
        // joined list would let it escape one root while satisfying another.
        let file
        for (const dir of dirs) {
          const f = path.join(dir, name)
          if (f.startsWith(dir + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) { file = f; break }
        }
        if (file === void 0) {
          res.writeHead(404, { 'content-type': 'text/plain' })
          return res.end('not found')
        }
        const ctype = EXT_TYPES[name.slice(name.lastIndexOf('.'))] || 'text/javascript; charset=utf-8'
        res.writeHead(200, {
          'content-type': ctype,
          // Content-hashed names (vite's [name]-[hash]) can never change under
          // one url, so they cache forever; everything else stays no-store so a
          // rebuilt vendor bundle is picked up on reload.
          'cache-control': /-[A-Za-z0-9_-]{8}\.[^.]+$/.test(name)
            ? 'public, max-age=31536000, immutable'
            : 'no-store',
        })
        if (req.method === 'HEAD') return res.end()
        fs.createReadStream(file).pipe(res)
      } catch {
        try { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('internal error') } catch {}
      }
    },
  }
}

let current = defaultSettings()
export function currentSettings() { return { ...current } }

// D7: exactly one per-org server, spawned on org mount, killed on org switch.
// verify: null until Task 3 plugs the read-token class — deny-default posture.
let follow = null
export function stopFollow() {
  const f = follow
  follow = null
  return f ? f.stop() : Promise.resolve()
}

function ensureFollow(secret, onServing) {
  if (follow) return follow
  // Task 8 (freestyle-section): one server per open root (org + every open
  // Freestyle root), not just the org. onServing(roots) gets the whole array.
  follow = startRootFollow({
    env: process.env,
    onServing,
    createServer: (opts) => createOrgServer({
      ...opts,
      verify: readVerifyFor({ secret, orgPath: opts.orgRoot }),
    }),
    log: (m) => console.log('[arxa-artifact-viewer] ' + m),
  })
  return follow
}

export function apply(ctx, config) {
  const entry = { ...defaultSettings(), ...(config ?? {}) }
  if (entry.tokenTtlSeconds > TOKEN_TTL_CEILING_SECONDS) {
    entry.tokenTtlSeconds = TOKEN_TTL_CEILING_SECONDS
  }
  current = entry
  // dsh 0.1.2-rc.1 replaced the exported installSettingsSection helper with
  // the service method SettingsProvider#installSection. The old helper was
  // OPTIONAL-dependent (ctx.inject — no settings service mounted means none
  // of this runs and the composed entry keeps working), so this keeps the
  // dynamic inject rather than declaring a hard dependency in `inject`.
  ctx.inject(['settings'], (sctx) => {
    sctx.settings.installSection(ctx, NS, SCHEMA, entry, {
      setSource: () => { /* host half reads currentSettings(); browser half reads settings.describe */ },
      onChange: (next) => { if (next && typeof next === 'object') current = { ...current, ...next } },
    })
  })
  // Boot must survive a follow failure — a plugin throwing at apply() kills
  // the engine cold (theme-accent D84 lesson). Log loud, never crash.
  try {
    const secret = loadOrCreateSecret(process.env)
    const watcher = createOrgWatcher({ intervalMs: 250 })
    let servingRoots = []
    // The LSP bridge needs the SAME org signal the watcher uses. onServing
    // fires on mount and on every switch, so a language server rooted at the
    // old org is killed the moment a new one is served — a server that outlived
    // the switch would be a process holding a handle on a folder the user
    // believes they closed.
    let lspBridge = null
    const started = ensureFollow(secret, (roots) => {
      servingRoots = roots
      watcher.setRoots(roots.map((r) => r.path))
      if (lspBridge) lspBridge.retainRoots(roots.map((r) => r.path))
    })
    const routes = createTokenRoutes({
      env: process.env, secret, getSettings: currentSettings,
      // File-serving/LSP stay org-only in this task's scope; find the org's
      // own served origin out of the multi-root array.
      getOrigin: () => started.current().find((r) => r.kind === 'org')?.origin ?? null,
    })
    ctx.webServer?.register?.({
      path: '/__arxa/artifacts/token',
      handler: (req, res) => { void routes.handle(req, res) },
    })
    // Vendored browser bundles (committed build products — lib/vendor.js):
    // served on the TRUSTED studio origin so the client can <script> them in.
    const libDir = path.dirname(fileURLToPath(import.meta.url))
    const vendorRoutes = createVendorRoutes({
      vendorDirs: [
        path.join(libDir, 'vendor'),
        // Built by monaco-build at pack time (G12), gitignored, absent in a
        // fresh checkout until `npm run build` there — the route just 404s the
        // monaco chunks until it exists, it does not fail to start.
        path.join(libDir, 'monaco-build', 'dist'),
      ],
    })
    ctx.webServer?.register?.({
      path: '/__arxa/artifacts/vendor',
      handler: (req, res) => { void vendorRoutes.handle(req, res) },
    })
    // LSP bridge (G8). registerUpgrade is exact-path and single-owner; the
    // engine tracks upgraded sockets and awaits them on shutdown, so no
    // language server session can outlive the host holding a socket.
    // `ws` is imported lazily: a host without it must still boot the viewer.
    lspBridge = createLspBridge({
      secret,
      getOrgPath: () => readOpenOrg(process.env)?.orgPath ?? null,
      getRootPath: (rootId) => selectedOpenRoot(process.env, rootId)?.path ?? null,
      // The client names a file it already holds a token for; the HOST says
      // where that file is. Nothing the client sends is used as a path.
      resolveAbs: async ({ relPath, session, orgPath }) => {
        if (session) return (await resolveWorktreeFile({ env: process.env, orgPath, worktreeId: session, relPath })).abs
        return resolveLspFile(orgPath, relPath)
      },
      log: (m) => console.log('[arxa-artifact-viewer] ' + m),
    })
    if (ctx.webServer?.registerUpgrade) {
      let wssPromise = null
      const getWss = () => {
        wssPromise ??= import('ws').then((m) => new m.WebSocketServer({
          noServer: true,
          // The client offers ['arxa-lsp', <token>]; only the marker is ever
          // accepted back, so the token never appears in the response.
          handleProtocols: (protocols) => (protocols.has('arxa-lsp') ? 'arxa-lsp' : false),
        }))
        return wssPromise
      }
      ctx.webServer.registerUpgrade({
        path: '/__arxa/artifacts/lsp',
        handler: (req, socket, head) => {
          getWss().then(
            (wss) => lspBridge.handleUpgrade(req, socket, head, wss),
            () => { try { socket.destroy() } catch {} },
          )
        },
      })
    }
    const writeApi = createWriteApi({
      env: process.env,
      secret,
      getSettings: currentSettings,
      getRoot: (rootId) => selectedOpenRoot(process.env, rootId),
    })
    ctx.webServer?.register?.({
      path: '/__arxa/artifacts/write',
      handler: (req, res) => { void writeApi.handle(req, res) },
    })
    const mainVersion = createMainVersionRoute({ env: process.env, secret })
    ctx.webServer?.register?.({
      path: '/__arxa/artifacts/main-version',
      handler: (req, res) => { void mainVersion.handle(req, res) },
    })
    // Click-to-paint trace (2026-09-07): the client posts one JSON line per
    // open and it lands in the engine log, where a slow first load can be
    // read phase by phase. Same-origin POST only, body capped, nothing stored.
    ctx.webServer?.register?.({
      path: '/__arxa/artifacts/trace',
      handler: (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405); return res.end() }
        let body = ''
        req.on('data', (c) => { if (body.length < 4096) body += c })
        req.on('end', () => {
          try {
            const t = JSON.parse(body)
            console.log('[arxa-artifact-viewer] trace ' + String(t.relPath).slice(0, 120) + ' ' + t.outcome + ' ' + t.totalMs + 'ms bundle=' + (t.bundleWarm ? 'warm' : 'cold') + ' ' + String(t.marks).slice(0, 400))
          } catch { /* not ours */ }
          res.writeHead(204); res.end()
        })
      },
    })
    const versionRoute = createVersionRoute({ env: process.env, secret })
    ctx.webServer?.register?.({
      path: '/__arxa/artifacts/version',
      handler: (req, res) => { void versionRoute.handle(req, res) },
    })
    const rootsRoute = createRootsRoute({ env: process.env })
    ctx.webServer?.register?.({
      path: '/__arxa/artifacts/roots',
      handler: (req, res) => { void rootsRoute.handle(req, res) },
    })
    const events = createEventsRoute({
      watcher,
      // Task 7 trust boundary: the push stream is token-gated. A ?session=
      // lane needs a changes-read token for THAT session; a root/org lane
      // needs a tree-read token bound to the root's real path, resolved HERE
      // (the query's root id never becomes a path by itself).
      verify: async ({ session, rootId, token }) => {
        if (session) return verifyToken(token, { secret, scope: 'changes-read', worktreeId: session }).ok
        const target = selectedOpenRoot(process.env, rootId)
        if (!target) return false
        return verifyToken(token, { secret, scope: 'tree-read', orgPath: target.path }).ok
      },
      rootIdForPath: (rootPath, requestedId) => rootIdsForPath(process.env, rootPath, requestedId),
      // Phase 1: the viewer's wt lane live-reloads on agent re-writes — the
      // worktree root resolves under the OPEN org only (unknown → org lane).
      resolveSessionRoot: async (sessionId) => {
        const open = readOpenOrg(process.env)
        const row = await resolveWorktree({ env: process.env, orgPath: open?.orgPath ?? null, worktreeId: sessionId })
        return row ? row.worktreePath : null
      },
    })
    ctx.webServer?.register?.({
      path: '/__arxa/artifacts/events',
      handler: (req, res) => { void events.handle(req, res) },
    })
    // D89 worktree read lane + D90 tree listing + session changes:
    const wtRoute = createWorktreeRoute({ env: process.env, secret })
    ctx.webServer?.register?.({
      path: '/__arxa/artifacts/wt',
      handler: (req, res) => { void wtRoute.handle(req, res) },
    })
    const treeRoute = createTreeRoute({ env: process.env, secret })
    ctx.webServer?.register?.({
      path: '/__arxa/artifacts/tree',
      handler: (req, res) => { void treeRoute.handle(req, res) },
    })
    const changesRoute = createSessionChangesRoute({ env: process.env, secret })
    ctx.webServer?.register?.({
      path: '/__arxa/artifacts/session-changes',
      handler: (req, res) => { void changesRoute.handle(req, res) },
    })
    // 2c install door. NEVER automatic — nothing calls this except a person
    // pressing Install on a language whose row carries an npm package. One
    // install per language at a time: a double-click must not run two npm
    // processes into the same prefix.
    const installing = new Map()
    const installHandler = async (req, res) => {
      const json2 = (s, b) => {
        res.writeHead(s, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify(b))
      }
      try {
        if (req.method !== 'POST') return json2(405, { error: 'POST only' })
        let body = {}
        try { body = JSON.parse((await readBody(req)) || '{}') } catch { return json2(400, { error: 'bad json' }) }
        const openI = selectedOpenRoot(process.env, body.rootId)
        if (!openI) return json2(403, { error: body.rootId ? 'root not open' : 'no org open' })
        if (!verifyToken(body.avt, { secret, scope: 'lsp-install', orgPath: openI.path }).ok) {
          return json2(403, { error: 'missing or invalid token' })
        }
        const lang = typeof body.lang === 'string' ? body.lang : ''
        if (installArgv(lang) === null) {
          // dart and rust land here on purpose: they are locate-only, and the
          // copy must not pretend arxa can fetch them.
          return json2(400, { error: 'not installable', locateOnly: LANG_SERVERS[lang] !== undefined })
        }
        let run = installing.get(lang)
        if (run === undefined) {
          run = installServer({
            lang,
            extraPath: await lspBridge.extraPath(),
            log: (m) => console.log('[arxa-artifact-viewer] ' + m),
          }).finally(() => installing.delete(lang))
          installing.set(lang, run)
        }
        const out = await run
        return json2(out.ok ? 200 : 500, out)
      } catch {
        try { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"internal error"}') } catch { /* socket gone */ }
      }
    }
    ctx.webServer?.register?.({
      path: '/__arxa/artifacts/lsp/install',
      handler: (req, res) => { void installHandler(req, res) },
    })
    // Which languages can actually serve. The editor asks this instead of
    // reading the socket's close code: the host accepts the upgrade FIRST and
    // only then closes 4004, so "did it open" and "is there a server" are two
    // different questions and the close arrives too late to answer the second.
    const statusHandler = async (req, res) => {
      const json2 = (s, b) => {
        res.writeHead(s, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify(b))
      }
      try {
        const url = new URL(req.url ?? '/', 'http://x')
        const rootId = url.searchParams.get('rootId')
        const openS = selectedOpenRoot(process.env, rootId)
        if (!openS) return json2(403, { error: rootId ? 'root not open' : 'no org open' })
        if (!verifyToken(url.searchParams.get('avt'), { secret, scope: 'lsp', orgPath: openS.path }).ok) {
          return json2(403, { error: 'missing or invalid token' })
        }
        const extraPath = await lspBridge.extraPath()
        const langs = {}
        for (const [lang, def] of Object.entries(LANG_SERVERS)) {
          const cmd = process.env['ARXA_LSP_' + lang.toUpperCase()] || def.cmd
          langs[lang] = {
            available: resolveBin(cmd, { env: process.env, extraPath }) !== null,
            // false for dart and rust: their servers ship with a toolchain, so
            // the copy must say "install the SDK", never offer a download.
            installable: Array.isArray(def.npm) && def.npm.length > 0,
            cmd: def.cmd,
            // Handshake options the editor must send verbatim. Computed here
            // because only the host knows where arxa installed things —
            // typescript-language-server refuses to start without being told
            // where a compiler is.
            init: typeof def.initOptions === 'function' ? def.initOptions(process.env) : null,
          }
        }
        return json2(200, { langs })
      } catch {
        try { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"internal error"}') } catch { /* socket gone */ }
      }
    }
    ctx.webServer?.register?.({
      path: '/__arxa/artifacts/lsp/status',
      handler: (req, res) => { void statusHandler(req, res) },
    })
  } catch (err) {
    console.error('[arxa-artifact-viewer] startup failed: ' + (err && err.message))
  }
}
