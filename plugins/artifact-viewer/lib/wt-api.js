// Worktree read lane + tree listing + session changes (D89/D90, 2026-08-31).
//
// D89: produced files live in session worktrees (.arxa/worktrees/<id>), not
// on main; the viewer reads them through GET /__arxa/artifacts/wt with a
// short-lived READ token bound to (worktreeId, relPath) — the same per-file
// doctrine as the D7 org lane, mirrored for worktrees. The org origin is
// unchanged; .arxa is still never served from it.
// D90: GET /__arxa/artifacts/tree?dir=… lists one directory of the OPEN org
// (account/ viewable — write-reserved, not read-forbidden), token bound to
// the open orgPath. D94 (2026-09-01): only the two internal state dirs
// (.git/, .arxa/) stay unlisted — every other dot-entry (.github/,
// .gitignore, …) is a real row, so studio-generated files are visible in
// the sidebar exactly as they are on GitHub.
// Session changes: GET /__arxa/artifacts/session-changes?session=… unions
// the session branch diff-vs-main with dirty worktree state.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { MIME, parseRange } from './org-server.js'
import { readOpenOrg } from './follow.js'
import { resolveWorktree } from './write-api.js'
import { verifyToken } from './tokens.js'

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}
function deny(res, status, msg) {
  json(res, status, { error: msg })
}
function q(req, name) {
  try { return new URL(req.url, 'http://x').searchParams.get(name) } catch { return null }
}
/** Escape-proof relPath inside rootReal; returns abs or throws {code}. */
function inside(rootReal, relPath) {
  if (typeof relPath !== 'string' || relPath === '') throw Object.assign(new Error('bad path'), { code: 'BAD' })
  const rel = path.normalize(relPath)
  if (rel === '..' || rel.startsWith('..' + path.sep) || rel.startsWith('..\\') || path.isAbsolute(rel)) {
    throw Object.assign(new Error('escape'), { code: 'ESCAPE' })
  }
  const abs = path.resolve(rootReal, rel)
  if (abs !== rootReal && !abs.startsWith(rootReal + path.sep)) {
    throw Object.assign(new Error('escape'), { code: 'ESCAPE' })
  }
  return abs
}
function runGit(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : String(stdout))
    })
  })
}

/** Resolve one file inside a session worktree; throws {code} on any miss.
 * D91: produced-file chips carry the ABSOLUTE path the agent wrote; an
 * absolute relPath is accepted only when it lives inside THIS worktree —
 * it is then re-based onto the root, so the escape checks stay in force. */
export async function resolveWorktreeFile({ env, orgPath, worktreeId, relPath }) {
  // Registry ids carry slashes (`RESTO/notes/note-wt-…`). The id is a lookup
  // key, never a path segment — resolveWorktree takes the path from the row —
  // so only the shapes that could never be an id are refused.
  if (typeof worktreeId !== 'string' || worktreeId === '' || worktreeId.includes('\\') || path.isAbsolute(worktreeId) || /(^|\/)\.\.(\/|$)/.test(worktreeId)) {
    throw Object.assign(new Error('bad session'), { code: 'BAD' })
  }
  if (typeof relPath !== 'string' || relPath === '') throw Object.assign(new Error('bad path'), { code: 'BAD' })
  const found = await resolveWorktree({ env, orgPath, worktreeId })
  if (!found) throw Object.assign(new Error('no worktree'), { code: 'NO_SESSION' })
  const rootReal = fs.realpathSync(found.worktree)
  let effRel = relPath
  if (path.isAbsolute(relPath)) {
    let absGiven
    try { absGiven = fs.realpathSync(path.resolve(relPath)) } catch { throw Object.assign(new Error('not a file'), { code: 'NOT_FILE' }) }
    if (absGiven !== rootReal && !absGiven.startsWith(rootReal + path.sep)) {
      throw Object.assign(new Error('escape'), { code: 'ESCAPE' })
    }
    effRel = path.relative(rootReal, absGiven) || '.'
  }
  const abs = inside(rootReal, effRel)
  const st = fs.statSync(abs)
  if (!st.isFile()) throw Object.assign(new Error('not a file'), { code: 'NOT_FILE' })
  const real = fs.realpathSync(abs)
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    throw Object.assign(new Error('escape'), { code: 'ESCAPE' })
  }
  return { abs, size: st.size }
}

/**
 * GET /__arxa/artifacts/wt?session=<id>&path=<rel>&avt=<token>
 * Token class 'wt-read' bound to exactly (worktreeId, relPath), short TTL.
 */
export function createWorktreeRoute({ env = process.env, secret }) {
  async function handle(req, res) {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return deny(res, 405, 'GET/HEAD only')
      const session = q(req, 'session')
      const relPath = q(req, 'path')
      const ok = verifyToken(q(req, 'avt'), { secret, scope: 'wt-read', worktreeId: session, relPath })
      if (!ok.ok) return deny(res, 403, 'missing or invalid token (' + (ok.reason || '?') + ')')
      const open = readOpenOrg(env)
      let file
      const t0 = Date.now()
      try {
        file = await resolveWorktreeFile({ env, orgPath: open ? open.orgPath : null, worktreeId: session, relPath })
        // Server-side cost only; the trace line on the client shows the wait.
        if (Date.now() - t0 > 100) console.log('[arxa-artifact-viewer] wt-read resolve took ' + (Date.now() - t0) + 'ms ' + String(relPath).slice(0, 80))
      } catch (err) {
        const map = { BAD: 400, ESCAPE: 403, NO_SESSION: 404, NOT_FILE: 404 }
        const code = map[err.code] || 500
        return deny(res, code, code === 500 ? 'internal error' : (err.message || 'unresolvable'))
      }
      const type = MIME[path.extname(file.abs).toLowerCase()] || 'application/octet-stream'
      const base = { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
      const range = parseRange(req.headers.range, file.size)
      if (range) {
        res.writeHead(206, {
          ...base,
          'content-range': 'bytes ' + range.start + '-' + range.end + '/' + file.size,
          'content-length': range.end - range.start + 1,
          'accept-ranges': 'bytes',
        })
        if (req.method === 'HEAD') return res.end()
        return fs.createReadStream(file.abs, { start: range.start, end: range.end }).pipe(res)
      }
      res.writeHead(200, { ...base, 'content-length': file.size, 'accept-ranges': 'bytes' })
      if (req.method === 'HEAD') return res.end()
      fs.createReadStream(file.abs).pipe(res)
    } catch {
      try { deny(res, 500, 'internal error') } catch { /* socket gone */ }
    }
  }
  return { handle }
}

/**
 * GET /__arxa/artifacts/tree?dir=<rel>&avt=<token>
 * Token class 'tree-read' bound to the open orgPath. One directory per call
 * (the sidebar lazy-loads per expand). D94: only .git/ and .arxa/ are never
 * listed; all other dot-entries are (GitHub-parity visibility).
 */
export function createTreeRoute({ env = process.env, secret }) {
  async function handle(req, res) {
    try {
      if (req.method !== 'GET') return deny(res, 405, 'GET only')
      const dir = q(req, 'dir') || ''
      const open = readOpenOrg(env)
      if (!open) return deny(res, 403, 'no org open')
      const ok = verifyToken(q(req, 'avt'), { secret, scope: 'tree-read', orgPath: open.orgPath })
      if (!ok.ok) return deny(res, 403, 'missing or invalid token (' + (ok.reason || '?') + ')')
      let abs
      try {
        const rootReal = fs.realpathSync(path.resolve(open.orgPath))
        abs = dir === '' ? rootReal : inside(rootReal, dir)
        const st = fs.statSync(abs)
        if (!st.isDirectory()) return deny(res, 404, 'not a directory')
      } catch (err) {
        const code = err.code === 'ESCAPE' ? 403 : err.code === 'BAD' ? 400 : 404
        return deny(res, code, 'unresolvable dir')
      }
      let names = []
      try { names = fs.readdirSync(abs) } catch { return deny(res, 404, 'unreadable') }
      const dirs = []
      const files = []
      for (const name of names.sort()) {
        // D94: hide ONLY the two internal state dirs — .git/ and .arxa/.
        // Everything else (including .github/, .gitignore, dotfiles) is a
        // real sidebar row: generated files must be visible here, not only
        // in the GitHub repo (the 2026-09-01 sync/visibility grill).
        if (name === '.git' || name === '.arxa') continue
        let isDir = false
        try { isDir = fs.statSync(path.join(abs, name)).isDirectory() } catch { continue }
        ;(isDir ? dirs : files).push(name)
      }
      json(res, 200, { dir, dirs, files })
    } catch {
      try { deny(res, 500, 'internal error') } catch { /* socket gone */ }
    }
  }
  return { handle }
}

/**
 * GET /__arxa/artifacts/session-changes?session=<id>&avt=<token>
 * Token class 'changes-read' bound to the worktree. Union of branch-vs-main
 * changed paths and dirty worktree paths (first-seen order, no duplicates).
 */
export function createSessionChangesRoute({ env = process.env, secret }) {
  async function handle(req, res) {
    try {
      if (req.method !== 'GET') return deny(res, 405, 'GET only')
      const session = q(req, 'session')
      const ok = verifyToken(q(req, 'avt'), { secret, scope: 'changes-read', worktreeId: session })
      if (!ok.ok) return deny(res, 403, 'missing or invalid token (' + (ok.reason || '?') + ')')
      const open = readOpenOrg(env)
      let root
      try {
        const found = await resolveWorktree({ env, orgPath: open ? open.orgPath : null, worktreeId: session })
        if (!found) return deny(res, 404, 'no worktree')
        root = found.worktree
      } catch {
        return deny(res, 404, 'no worktree')
      }
      const committed = await runGit(root, ['diff', '--name-only', 'main...HEAD'])
      const dirty = await runGit(root, ['status', '--porcelain'])
      const files = []
      const seen = new Set()
      const add = (p) => {
        if (typeof p !== 'string' || p === '' || seen.has(p)) return
        seen.add(p)
        files.push(p)
      }
      for (const line of String(committed || '').split('\n')) add(line.trim())
      for (const line of String(dirty || '').split('\n')) {
        const t = line.trim()
        if (t === '') continue
        add(t.slice(3).trim())
      }
      json(res, 200, { session, files })
    } catch {
      try { deny(res, 500, 'internal error') } catch { /* socket gone */ }
    }
  }
  return { handle }
}
