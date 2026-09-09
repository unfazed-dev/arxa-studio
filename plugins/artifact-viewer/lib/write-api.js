// Engine write API (D81): the ONLY write path into the editor. Lives on the
// TRUSTED studio origin; the per-org file server stays read-only forever.
//
// Flow: write token (worktree-scoped, separate class from read tokens) →
// resolve the session worktree through the D38 registry (repo-local
// <git-common-dir>/arxa/sessions.json, worktree at <repo>/.arxa/worktrees/
// <id>) → containment (inside the worktree; never account/, .arxa/, .git/)
// → optimistic mtime check (409 on external change) → atomic write (tmp +
// rename) → D18 WIP auto-commit via git-workspace's own helper.
//
// Org writes land in session worktrees (D80); explicit Freestyle root writes
// save to that root's main working tree and auto-commit in the nearest repo.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { verifyToken } from './tokens.js'
import { resolveInside } from './org-server.js'
import { readOpenOrg } from './follow.js'
// git-workspace via the house dual probe: bare name resolves through the
// flat copies in installed profiles; relative resolves in the repo checkout
// (selftests). Same discipline as approvals' importShell.
let gwCache = null
async function gw() {
  if (gwCache) return gwCache
  try { gwCache = await import('git-workspace') } catch {
    gwCache = await import(new URL('../../git-workspace/lib/index.js', import.meta.url).href)
  }
  return gwCache
}

let freestyleCache = null
async function freestyle() {
  if (!freestyleCache) {
    try { freestyleCache = await import('arxa-freestyle') }
    catch { freestyleCache = await import(new URL('../../arxa-freestyle/lib/index.js', import.meta.url).href) }
  }
  return freestyleCache
}

const RESERVED = ['.arxa/', '.git/', 'account/']

/** Resolve a worktreeId against the open org: the org repo itself plus every
 *  project repo. Matches the registry id (`RESTO/notes/note-wt-…`) OR the
 *  dsh session id the chat runs under (`arxa-RESTO-notes-note-wt-…`): the
 *  viewer mirrors the latter, and matching only the former made every
 *  session open miss and fall back to the org copy (traced 2026-09-07).
 * project repo under projects/* (D37 nested repos). Loud null when unknown. */
export async function resolveWorktree({ env = process.env, orgPath, worktreeId }) {
  const gwMod = await gw()
  const listSessions = gwMod.listSessions
  const SESSIONS_DIR = gwMod.SESSIONS_DIR
  const candidates = []
  if (typeof orgPath === 'string' && orgPath !== '') {
    candidates.push(orgPath)
    try {
      for (const name of fs.readdirSync(path.join(orgPath, 'projects'))) {
        const p = path.join(orgPath, 'projects', name)
        if (fs.statSync(p).isDirectory()) candidates.push(p)
      }
    } catch { /* no projects dir — org repo only */ }
  }
  const matches = new Map()
  const take = (repoPath, row) => {
    if (!row || (row.id !== worktreeId && row.dshSessionId !== worktreeId) || row.state !== 'open') return
    const worktreePath = typeof row.worktree === 'string' && row.worktree !== ''
      ? row.worktree
      : path.join(repoPath, ...SESSIONS_DIR.split('/'), row.id)
    if (!fs.existsSync(worktreePath)) return
    let key = path.resolve(repoPath) + '\0' + row.id
    try { key = fs.realpathSync(repoPath) + '\0' + row.id } catch {}
    matches.set(key, { repoPath, worktreePath, worktree: worktreePath })
  }
  for (const repoPath of candidates) {
    let rows = []
    try { rows = listSessions(repoPath, env) } catch { continue }
    for (const row of rows) take(repoPath, row)
  }
  // Freestyle sessions may belong to any registered root and any git repo
  // nested under it. Reuse that package's ownership-aware aggregation instead
  // of guessing a projects/* layout. This also works when no org is open.
  try {
    const { listRoots, createFreestyleSessions } = await freestyle()
    const sessions = createFreestyleSessions({ env, dshBridge: { spawn: async () => ({ ok: false, reason: 'lookup-only' }) } })
    for (const root of listRoots({ env }).filter((row) => row.open === true)) {
      const groups = sessions.list(root)
      for (const row of [...groups.active, ...groups.parked, ...groups.archived]) take(row.repoPath, row)
    }
  } catch { /* missing/broken Freestyle registry leaves the org lane intact */ }
  if (matches.size === 1) return matches.values().next().value
  if (matches.size > 1) {
    console.log('[arxa-artifact-viewer] ambiguous session id refused: ' + String(worktreeId).slice(0, 120))
  }
  return null
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => { data += c })
    req.on('end', () => resolve(data))
    req.on('error', () => resolve(''))
  })
}

/** GET /__arxa/artifacts/main-version?relPath=&avt= — main's blob of the
 *  OPEN org repo file, read-token gated (same per-file token class as the
 *  viewer), containment-checked, for D84 worktree-vs-main diffs. Empty
 *  content when the file does not exist on main (new-file diffs). */
export function createMainVersionRoute({ env = process.env, secret }) {
  return {
    async handle(req, res) {
      const json2 = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify(body))
      }
      try {
        if (req.method !== 'GET') return json2(405, { error: 'GET only' })
        const url = new URL(req.url, 'http://x')
        const relPath = (url.searchParams.get('relPath') || '').replace(/^\/+/, '')
        const token = url.searchParams.get('avt') || ''
        const open = readOpenOrg(env)
        if (!open) return json2(403, { error: 'no org open' })
        const verdict = verifyToken(token, { secret, scope: 'read', relPath, orgPath: open.orgPath })
        if (!verdict.ok) return json2(403, { error: 'read token ' + verdict.reason })
        let rootReal
        try { rootReal = fs.realpathSync(path.resolve(open.orgPath)) } catch { return json2(403, { error: 'org unreadable' }) }
        try { resolveInside(rootReal, relPath) } catch { return json2(403, { error: 'outside the org root' }) }
        for (const branch of ['main', 'master']) {
          try {
            const content = execFileSync('git', ['show', branch + ':' + relPath], {
              cwd: rootReal, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
            })
            return json2(200, { branch, content })
          } catch (err) {
            if (!err || !String(err.stderr || err.message).includes('does not exist') &&
                !String(err.stderr || err.message).includes('path') &&
                err.status !== 128) continue
          }
        }
        return json2(200, { branch: null, content: '' })
      } catch {
        return json2(500, { error: 'internal error' })
      }
    },
  }
}

/** GET /__arxa/artifacts/version?relPath=&avt= — the D20 version chip +
 *  timeline for the repo owning relPath (projects/<slug>/… -> that project
 *  repo, anything else -> the org repo). Read-token gated, D44-safe by
 *  construction (versionChip carries label only — no SHAs, no stamps). */
export function createVersionRoute({ env = process.env, secret }) {
  return {
    async handle(req, res) {
      const json2 = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify(body))
      }
      try {
        if (req.method !== 'GET') return json2(405, { error: 'GET only' })
        const url = new URL(req.url, 'http://x')
        const relPath = (url.searchParams.get('relPath') || '').replace(/^\/+/, '')
        const token = url.searchParams.get('avt') || ''
        const open = readOpenOrg(env)
        if (!open) return json2(403, { error: 'no org open' })
        const verdict = verifyToken(token, { secret, scope: 'read', relPath, orgPath: open.orgPath })
        if (!verdict.ok) return json2(403, { error: 'read token ' + verdict.reason })
        let rootReal
        try { rootReal = fs.realpathSync(path.resolve(open.orgPath)) } catch { return json2(403, { error: 'org unreadable' }) }
        try { resolveInside(rootReal, relPath) } catch { return json2(403, { error: 'outside the org root' }) }
        let repoPath = open.orgPath
        const pm = /^projects\/([^/]+)\//.exec(relPath)
        if (pm) {
          const candidate = path.join(open.orgPath, 'projects', pm[1])
          try { if (fs.statSync(candidate).isDirectory()) repoPath = candidate } catch { /* fall back to org repo */ }
        }
        let chip = null
        let timeline = []
        try {
          const gwMod = await gw()
          chip = gwMod.versionChip(repoPath)
          timeline = gwMod.readVersions(repoPath)
        } catch { /* unminted repo -> hidden chip */ }
        return json2(200, { chip, timeline })
      } catch {
        return json2(500, { error: 'internal error' })
      }
    },
  }
}

export function createWriteApi({ env = process.env, secret, getSettings = () => ({}), getRoot = () => null }) {
  async function handle(req, res) {
    try {
      if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
      let body
      try { body = JSON.parse((await readBody(req)) || '{}') } catch { return json(res, 400, { error: 'bad json' }) }
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'bad json' })
      const rootWrite = body.rootId !== undefined && !body.worktreeId
      if (rootWrite && (typeof body.rootId !== 'string' || !body.rootId)) return json(res, 400, { error: 'rootId required' })
      const root = rootWrite ? await getRoot(body.rootId) : null
      if (rootWrite && !root) return json(res, 404, { error: 'root not open' })
      const token = String(req.headers['x-arxa-write-token'] || '')
      const verdict = verifyToken(token, { secret, scope: 'write',
        worktreeId: rootWrite ? 'root:' + body.rootId : body.worktreeId ?? null,
        orgPath: rootWrite ? root.path : null,
      })
      if (!verdict.ok) return json(res, rootWrite ? 403 : 401, { error: 'write token ' + verdict.reason })
      const open = readOpenOrg(env)
      if (!rootWrite && (typeof body.worktreeId !== 'string' || body.worktreeId === '')) return json(res, 400, { error: 'worktreeId required' })
      if (typeof body.relPath !== 'string' || body.relPath === '') return json(res, 400, { error: 'relPath required' })
      if (typeof body.content !== 'string') return json(res, 400, { error: 'content required' })
      // D82 server-side twin of the editor cap: the client guard is UX, this
      // one is enforcement — a 40 MB paste never reaches the worktree.
      const cap = Number((getSettings() || {}).maxEditBytes) || 5 * 1024 * 1024
      if (Buffer.byteLength(body.content, 'utf8') > cap) return json(res, 413, { error: 'content over the ' + cap + ' byte edit cap (D82)' })
      let rel = body.relPath
      let abs
      let commitPath
      if (rootWrite) {
        const { resolveFreestyleInside } = await freestyle()
        try { ({ abs, rel } = resolveFreestyleInside(root.path, rel)) }
        catch { return json(res, 403, { error: 'outside the root or reserved path' }) }
        // Resolve before writing: a missing/damaged repo must not receive a
        // file that the promised WIP commit cannot record.
        const gwMod = await gw()
        commitPath = gwMod.resolveFreestyleRepo(root.path, path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel), { env, requireHead: false }).repoPath
      } else {
        const found = await resolveWorktree({ env, orgPath: open?.orgPath ?? null, worktreeId: body.worktreeId })
        if (!found) return json(res, 404, { error: 'unknown session worktree' })
        rel = rel.replace(/^\/+/, '')
        for (const r of RESERVED) {
          if (rel === r.replace(/\/$/, '') || rel.startsWith(r)) return json(res, 403, { error: 'reserved path: ' + r })
        }
        try { abs = resolveInside(found.worktreePath, rel) } catch { return json(res, 403, { error: 'outside the worktree' }) }
        commitPath = found.worktreePath
      }
      let before = null
      try { before = fs.statSync(abs) } catch { /* new file */ }
      if (!before && Number.isFinite(body.expectedMtimeMs)) {
        return json(res, 409, { error: 'file changed externally', mtimeMs: null })
      }
      if (before && Number.isFinite(body.expectedMtimeMs) && before.mtimeMs !== body.expectedMtimeMs) {
        return json(res, 409, { error: 'file changed externally', mtimeMs: before.mtimeMs })
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      const tmp = abs + '.arxa-write-' + crypto.randomBytes(4).toString('hex')
      try {
        fs.writeFileSync(tmp, body.content, before ? { mode: before.mode & 0o777 } : undefined)
        fs.renameSync(tmp, abs)
      } finally { try { fs.unlinkSync(tmp) } catch { /* rename consumed it */ } }
      let committed = false
      let warning = null
      try {
        const gwMod = await gw()
        gwMod.wipCommit(commitPath, { message: 'editor save ' + rel, env })
        committed = true
      } catch (err) {
        warning = 'write landed but WIP commit failed: ' + String((err && err.message) || err)
      }
      return json(res, 200, { ok: true, committed, warning, mtimeMs: fs.statSync(abs).mtimeMs })
    } catch (err) {
      return json(res, 500, { error: 'internal error' })
    }
  }
  return { handle }
}
