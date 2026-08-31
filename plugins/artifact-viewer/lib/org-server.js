// Per-org READ-ONLY artifact file server (D7 lanes 2-3 + D81).
//
// - Binds 127.0.0.1:0 (ephemeral); the studio references it through the
//   org-<slug>.localhost hostname so rendered content NEVER shares an origin
//   with the studio (cookies are port-agnostic — a bare port would weaken
//   the D7 wall).
// - GET/HEAD only: 405 for everything else. The org origin can never write.
// - Every path is resolved against the org root and rejected on escape
//   (.., encoded traversal, absolute, symlink landing outside the root):
//   the server "cannot express an outside path" (D7).
// - verify(req, relPath) gates every file read — Task 3 plugs the HMAC read
//   token in; a null verify DENIES everything except /healthz (deny-default).
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.mdx': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8', '.yml': 'text/yaml; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.flac': 'audio/flac', '.m4a': 'audio/mp4',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
}

/** Escape-proof resolution: relPath must stay inside root. Throws when it escapes. */
export function resolveInside(rootReal, relPath) {
  const rel = path.normalize(relPath)
  if (rel === '..' || rel.startsWith('..' + path.sep) || rel.startsWith('..\\') ||
      path.isAbsolute(rel)) {
    throw Object.assign(new Error('escape'), { code: 'ESCAPE' })
  }
  const abs = path.resolve(rootReal, rel)
  if (abs !== rootReal && !abs.startsWith(rootReal + path.sep)) {
    throw Object.assign(new Error('escape'), { code: 'ESCAPE' })
  }
  return abs
}

/**
 * Spin up the read-only server for one open org.
 * Resolves { port, origin, close() } once listening.
 */
export function createOrgServer({ orgRoot, orgSlug, verify = null }) {
  const rootReal = fs.realpathSync(path.resolve(orgRoot))
  const server = http.createServer(async (req, res) => {
    try {
      const addr = server.address()
      const allowedHosts = new Set([
        'org-' + orgSlug + '.localhost:' + addr.port,
        '127.0.0.1:' + addr.port,
        'localhost:' + addr.port,
      ])
      if (!allowedHosts.has(String(req.headers.host || ''))) {
        return reject(res, 403, 'host not allowed')
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return reject(res, 405, 'the org origin is read-only (D81)')
      }
      const url = new URL(req.url, 'http://x')
      if (url.pathname === '/healthz') {
        res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
        return res.end('ok')
      }
      let abs
      try {
        abs = resolveInside(rootReal, decodeURIComponent(url.pathname).replace(/^\/+/, ''))
      } catch (err) {
        if (err.code === 'ESCAPE') return reject(res, 403, 'outside the org root')
        return reject(res, 400, 'bad path')
      }
      let st
      try { st = fs.statSync(abs) } catch { return reject(res, 404, 'not found') }
      if (st.isDirectory()) return reject(res, 404, 'not found') // never list the tree
      const rel = path.relative(rootReal, abs)
      const allowed = verify ? await verify(req, rel) : false
      if (!allowed) return reject(res, 403, 'missing or invalid token')
      // Symlink re-check: the REAL file must still live under the org root.
      const real = fs.realpathSync(abs)
      if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
        return reject(res, 403, 'outside the org root')
      }
      const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream'
      const base = { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
      const range = parseRange(req.headers.range, st.size)
      if (range) {
        res.writeHead(206, {
          ...base,
          'content-range': 'bytes ' + range.start + '-' + range.end + '/' + st.size,
          'content-length': range.end - range.start + 1,
          'accept-ranges': 'bytes',
        })
        if (req.method === 'HEAD') return res.end()
        return fs.createReadStream(abs, { start: range.start, end: range.end }).pipe(res)
      }
      res.writeHead(200, { ...base, 'content-length': st.size, 'accept-ranges': 'bytes' })
      if (req.method === 'HEAD') return res.end()
      fs.createReadStream(abs).pipe(res)
    } catch (err) {
      try { reject(res, 500, 'internal error') } catch { /* socket gone */ }
      server.emit('orgServer:error', err)
    }
  })
  return new Promise((resolve, rejectP) => {
    server.once('error', rejectP)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      resolve({
        port,
        origin: 'http://org-' + orgSlug + '.localhost:' + port,
        close: () => new Promise((done) => {
          try { server.closeAllConnections?.() } catch { /* older node */ }
          server.close(() => done())
        }),
      })
    })
  })
}

function reject(res, status, message) {
  if (res.headersSent) return res.destroy()
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  res.end(status + ' ' + message)
}

/** Single byte-range only; null when absent/malformed/unsatisfiable-simple. */
function parseRange(header, size) {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header))
  if (!m || (m[1] === '' && m[2] === '')) return null
  let start, end
  if (m[1] === '') { start = size - Number(m[2]); end = size - 1 } else {
    start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= size) return null
  return { start, end }
}
