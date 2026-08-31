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
const { installSettingsSection, settingsNamespace } =
  await fromDsh('@deepseek-ai/dsh-settings', 'lib/index.js')
const { default: z } = await fromDsh('@deepseek-ai/schemastery', 'lib/index.mjs')
import { createOrgServer } from './org-server.js'
import { startOrgFollow, readOpenOrg } from './follow.js'
import { createWriteApi, createMainVersionRoute } from './write-api.js'
import { TOKEN_TTL_CEILING_SECONDS, issueToken, loadOrCreateSecret, readVerifyFor } from './tokens.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export { TOKEN_TTL_CEILING_SECONDS }
export const inject = ['webServer']

export const name = 'arxa-artifact-viewer'

export function defaultSettings() {
  return { maxEditBytes: 5_000_000, tokenTtlSeconds: 120 }
}

const NS = settingsNamespace('arxa-artifact-viewer')
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

/** Serves the vendored IIFE bundles from lib/vendor/ on the studio origin.
 *  GET/HEAD only; basename-pinned (no subpaths, no traversal). */
export function createVendorRoutes({ vendorDir }) {
  return {
    async handle(req, res) {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { 'content-type': 'text/plain' })
          return res.end('GET only')
        }
        const name = path.basename(decodeURIComponent(new URL(req.url, 'http://x').pathname))
        const file = path.join(vendorDir, name)
        if (!file.startsWith(vendorDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          res.writeHead(404, { 'content-type': 'text/plain' })
          return res.end('not found')
        }
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
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

function ensureFollow(secret) {
  if (follow) return follow
  follow = startOrgFollow({
    env: process.env,
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
  installSettingsSection(ctx, NS, SCHEMA, entry, {
    setSource: () => { /* host half reads currentSettings(); browser half reads settings.describe */ },
    onChange: (next) => { if (next && typeof next === 'object') current = { ...current, ...next } },
  })
  // Boot must survive a follow failure — a plugin throwing at apply() kills
  // the engine cold (theme-accent D84 lesson). Log loud, never crash.
  try {
    const secret = loadOrCreateSecret(process.env)
    const started = ensureFollow(secret)
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
    const vendorDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vendor')
    const vendorRoutes = createVendorRoutes({ vendorDir })
    ctx.webServer?.register?.({
      path: '/__arxa/artifacts/vendor',
      handler: (req, res) => { void vendorRoutes.handle(req, res) },
    })
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
  } catch (err) {
    console.error('[arxa-artifact-viewer] startup failed: ' + (err && err.message))
  }
}
