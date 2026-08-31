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
// Writes land in the SESSION WORKTREE only (D80): main is never touched.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { verifyToken } from './tokens.js'
import { resolveInside } from './org-server.js'
import { readOpenOrg } from './follow.js'
import { listSessions, SESSIONS_DIR } from '../../git-workspace/lib/sessions.js'
import { wipCommit } from '../../git-workspace/lib/commits.js'

const RESERVED = ['.arxa/', '.git/', 'account/']

/** Resolve a worktreeId against the open org: the org repo itself plus every
 * project repo under projects/* (D37 nested repos). Loud null when unknown. */
export function resolveWorktree({ env = process.env, orgPath, worktreeId }) {
  const candidates = [orgPath]
  try {
    for (const name of fs.readdirSync(path.join(orgPath, 'projects'))) {
      const p = path.join(orgPath, 'projects', name)
      if (fs.statSync(p).isDirectory()) candidates.push(p)
    }
  } catch { /* no projects dir — org repo only */ }
  for (const repoPath of candidates) {
    let rows = []
    try { rows = listSessions(repoPath, env) } catch { continue }
    const row = rows.find((r) => r && r.id === worktreeId && r.state === 'open')
    if (!row) continue
    const worktreePath = path.join(repoPath, ...SESSIONS_DIR.split('/'), worktreeId)
    if (fs.existsSync(worktreePath)) return { repoPath, worktreePath }
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

export function createWriteApi({ env = process.env, secret }) {
  async function handle(req, res) {
    try {
      if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
      let body
      try { body = JSON.parse((await readBody(req)) || '{}') } catch { return json(res, 400, { error: 'bad json' }) }
      const token = String(req.headers['x-arxa-write-token'] || '')
      const verdict = verifyToken(token, { secret, scope: 'write', worktreeId: body.worktreeId ?? null })
      if (!verdict.ok) return json(res, 401, { error: 'write token ' + verdict.reason })
      const open = readOpenOrg(env)
      if (!open) return json(res, 403, { error: 'no org open' })
      if (typeof body.worktreeId !== 'string' || body.worktreeId === '') return json(res, 400, { error: 'worktreeId required' })
      if (typeof body.relPath !== 'string' || body.relPath === '') return json(res, 400, { error: 'relPath required' })
      if (typeof body.content !== 'string') return json(res, 400, { error: 'content required' })
      const found = resolveWorktree({ env, orgPath: open.orgPath, worktreeId: body.worktreeId })
      if (!found) return json(res, 404, { error: 'unknown session worktree for this org' })
      const rel = body.relPath.replace(/^\/+/, '')
      for (const r of RESERVED) {
        if (rel === r.replace(/\/$/, '') || rel.startsWith(r)) return json(res, 403, { error: 'reserved path: ' + r })
      }
      let abs
      try { abs = resolveInside(found.worktreePath, rel) } catch { return json(res, 403, { error: 'outside the worktree' }) }
      let before = null
      try { before = fs.statSync(abs) } catch { /* new file */ }
      if (before && Number.isFinite(body.expectedMtimeMs) && Math.abs(before.mtimeMs - body.expectedMtimeMs) > 1) {
        return json(res, 409, { error: 'file changed externally', mtimeMs: before.mtimeMs })
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      const tmp = abs + '.arxa-write-' + crypto.randomBytes(4).toString('hex')
      fs.writeFileSync(tmp, body.content)
      fs.renameSync(tmp, abs)
      let committed = false
      let warning = null
      try {
        wipCommit(found.worktreePath, { message: 'editor save ' + rel, env })
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
