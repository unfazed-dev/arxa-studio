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
import { startOrgFollow, readOpenOrg } from './follow.js'
import { createWriteApi, createMainVersionRoute, createVersionRoute, resolveWorktree } from './write-api.js'
import { createWorktreeRoute, createTreeRoute, createSessionChangesRoute, resolveWorktreeFile } from './wt-api.js'
import { createOrgWatcher, createEventsRoute } from './watcher.js'
import { TOKEN_TTL_CEILING_SECONDS, issueToken, loadOrCreateSecret, readVerifyFor } from './tokens.js'
import { createLspBridge } from './lsp.js'
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
        if (typeof body.worktreeId !== 'string' || body.worktreeId === '') {
          return json(res, 400, { error: 'worktreeId required for write tokens' })
        }
        const token = issueToken({ secret, scope: 'write', worktreeId: body.worktreeId, ttlSeconds: ttl })
        return json(res, 200, { token })
      }
      if (body.scope === 'wt-read' || body.scope === 'changes-read') {
        // D89 worktree read classes — validated here, validated again at the lane.
        if (typeof body.worktreeId !== 'string' || body.worktreeId === '') {
          return json(res, 400, { error: 'worktreeId required' })
        }
        if (body.scope === 'wt-read') {
          if (typeof body.relPath !== 'string' || body.relPath === '') return json(res, 400, { error: 'relPath required' })
          try {
            const open0 = readOpenOrg(env)
            await resolveWorktreeFile({ env, orgPath: open0 ? open0.orgPath : null, worktreeId: body.worktreeId, relPath: body.relPath })
          } catch (err) {
            const map = { BAD: 400, ESCAPE: 403, NO_SESSION: 404, NOT_FILE: 404 }
            return json(res, map[err.code] || 404, { error: 'unresolvable worktree file' })
          }
        }
        const token = issueToken({ secret, scope: body.scope, worktreeId: body.worktreeId, relPath: body.scope === 'wt-read' ? body.relPath : null, ttlSeconds: ttl })
        return json(res, 200, { token })
      }
      if (body.scope === 'lsp') {
        // Bound to the open org, like tree-read. A SEPARATE class from read on
        // purpose: this token opens a socket that spawns a language server, so
        // a leaked per-file read token must not be able to do it.
        const openL = readOpenOrg(env)
        if (!openL) return json(res, 403, { error: 'no org open' })
        const token = issueToken({ secret, scope: 'lsp', orgPath: openL.orgPath, ttlSeconds: ttl })
        return json(res, 200, { token })
      }
      if (body.scope === 'tree-read') {
        // D90 directory listing class — bound to the open org only.
        const open0 = readOpenOrg(env)
        if (!open0) return json(res, 403, { error: 'no org open' })
        const token = issueToken({ secret, scope: 'tree-read', orgPath: open0.orgPath, ttlSeconds: ttl })
        return json(res, 200, { token })
      }
      // read (default) — orgPath OPTIONAL: the open org is authoritative,
      // a client-declared orgPath must MATCH it (no org-path probing).
      const open = readOpenOrg(env)
      if (!open) return json(res, 403, { error: 'no org open' })
      if (body.orgPath != null && body.orgPath !== open.orgPath) return json(res, 403, { error: 'org not open' })
      if (typeof body.relPath !== 'string' || body.relPath === '') return json(res, 400, { error: 'relPath required' })
      try {
        const rootReal = fs.realpathSync(path.resolve(open.orgPath))
        const abs = path.resolve(rootReal, path.normalize(body.relPath))
        if (abs !== rootReal && !abs.startsWith(rootReal + path.sep)) return json(res, 403, { error: 'outside the org root' })
        if (!fs.statSync(abs).isFile()) return json(res, 404, { error: 'not a file' })
      } catch (err) {
        return json(res, err.code === 'ENOENT' ? 404 : 403, { error: 'unresolvable path' })
      }
      const token = issueToken({ secret, scope: 'read', relPath: body.relPath, orgPath: open.orgPath, ttlSeconds: ttl })
      const origin = getOrigin()
      if (!origin) return json(res, 503, { error: 'org server not up yet — retry' })
      return json(res, 200, { token, origin })
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
  follow = startOrgFollow({
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
    // The LSP bridge needs the SAME org signal the watcher uses. onServing
    // fires on mount and on every switch, so a language server rooted at the
    // old org is killed the moment a new one is served — a server that outlived
    // the switch would be a process holding a handle on a folder the user
    // believes they closed.
    let lspBridge = null
    const started = ensureFollow(secret, (orgPath) => {
      watcher.setRoot(orgPath)
      if (lspBridge) lspBridge.stopAll('org-switch')
    })
    const routes = createTokenRoutes({
      env: process.env, secret, getSettings: currentSettings,
      getOrigin: () => started.current()?.origin ?? null,
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
    const writeApi = createWriteApi({ env: process.env, secret, getSettings: currentSettings })
    ctx.webServer?.register?.({
      path: '/__arxa/artifacts/write',
      handler: (req, res) => { void writeApi.handle(req, res) },
    })
    const mainVersion = createMainVersionRoute({ env: process.env, secret })
    ctx.webServer?.register?.({
      path: '/__arxa/artifacts/main-version',
      handler: (req, res) => { void mainVersion.handle(req, res) },
    })
    const versionRoute = createVersionRoute({ env: process.env, secret })
    ctx.webServer?.register?.({
      path: '/__arxa/artifacts/version',
      handler: (req, res) => { void versionRoute.handle(req, res) },
    })
    const events = createEventsRoute({
      watcher,
      // Phase 1: the viewer's wt lane live-reloads on agent re-writes — the
      // worktree root resolves under the OPEN org only (unknown → org lane).
      resolveSessionRoot: async (sessionId) => {
        const open = readOpenOrg(process.env)
        if (!open) return null
        const row = await resolveWorktree({ env: process.env, orgPath: open.orgPath, worktreeId: sessionId })
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
  } catch (err) {
    console.error('[arxa-artifact-viewer] startup failed: ' + (err && err.message))
  }
}
