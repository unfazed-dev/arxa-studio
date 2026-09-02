// Per-org READ-ONLY artifact file server (D7 lanes 2-3 + D81).
//
// - Binds ::1 + 127.0.0.1 on one ephemeral port (never the '::' wildcard —
//   see the listen block); the studio references it through the
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

export const MIME = {
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
  let server // bound per listen attempt — see the dual-stack start below
  const handler = async (req, res) => {
    try {
      const addr = server.address()
      // Case-INSENSITIVE host match (2026-09-01, found live): browsers
      // lowercase the Host header per the URL spec, so a case-preserved slug
      // (D79: org-RESTO) arrived as org-resto and every browser file fetch
      // 403'd while curl (case preserved) succeeded. Slugs keep their case
      // everywhere else — only this host comparison normalizes.
      const allowedHosts = new Set([
        ('org-' + orgSlug + '.localhost:' + addr.port).toLowerCase(),
        '127.0.0.1:' + addr.port,
        'localhost:' + addr.port,
      ])
      if (!allowedHosts.has(String(req.headers.host || '').toLowerCase())) {
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
      const base = { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*' }
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
  }
  // Explicit dual-loopback listen (2026-09-01 "Load failed", root-fixed
  // 2026-09-02): macOS answers every *.localhost name with ::1 FIRST
  // (synthesized loopback), and the desktop WKWebView's FIRST cross-origin
  // fetch to the old v4-only listener died on the refused v6 address with a
  // raw "TypeError: Load failed" — later fetches reused the warm pool, which
  // is why "switch file and come back" healed it. The first fix listened on
  // the '::' wildcard; that inherits IPV6_V6ONLY's per-OS default (off on
  // Linux/macOS, ON on Windows) and let a foreign 127.0.0.1:N listener
  // coexist on the same port (BSD dual-stack rule) — the selftest flaked
  // exactly that way. Now: bind ::1:0 first (v6 is the family more likely to
  // be missing), then 127.0.0.1 on the SAME port; retry on EADDRINUSE with a
  // fresh ephemeral port; on a v6-less host (EADDRNOTAVAIL/EAFNOSUPPORT) run
  // v4-only — browsers get RST on ::1 and fall through to 127.0.0.1 in ms.
  // Never persist the port: the token-bearing URL carries it each launch.
  const MAX_ATTEMPTS = 10
  const closeOne = (s) => new Promise((done) => {
    try { s.closeAllConnections?.() } catch { /* older node */ }
    s.close(() => done())
  })
  const bind = (host, port) => new Promise((ok, bad) => {
    const s = http.createServer(handler)
    s.once('error', (err) => { try { s.close() } catch { /* never listened */ } bad(err) })
    s.once('listening', () => { s.removeAllListeners('error'); ok(s) })
    s.listen(port, host)
  })
  const attempt = async (n, lastErr) => {
    if (n >= MAX_ATTEMPTS) throw lastErr
    let v6 = null
    try {
      v6 = await bind('::1', 0)
    } catch (err) {
      if (err?.code !== 'EADDRNOTAVAIL' && err?.code !== 'EAFNOSUPPORT') throw err
      if (n === 0) console.warn('[artifact-viewer] ::1 unavailable (' + err.code + '); org server is 127.0.0.1-only')
    }
    try {
      const v4 = await bind('127.0.0.1', v6 ? v6.address().port : 0)
      return { v4, v6 }
    } catch (err) {
      if (v6) await closeOne(v6)
      if (v6 && err?.code === 'EADDRINUSE') return attempt(n + 1, err)
      throw err
    }
  }
  return attempt(0, null).then(({ v4, v6 }) => {
    server = v4 // the handler's allowed-host list reads server.address()
    const sockets = v6 ? [v4, v6] : [v4]
    const port = v4.address().port
    const close = () => Promise.all(sockets.map(closeOne)).then(() => undefined)
    // A later listener error on either family takes the whole pair down —
    // half a dual-loopback server is the exact bug this block exists to fix.
    for (const s of sockets) s.on('error', (err) => { server.emit('orgServer:error', err); close() })
    return {
      port,
      origin: 'http://org-' + orgSlug + '.localhost:' + port,
      close,
    }
  })
}

function reject(res, status, message) {
  if (res.headersSent) return res.destroy()
  // ACAO *: the token IS the auth (D7) — the studio page must be able to
  // read cross-origin responses from the org origin.
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' })
  res.end(status + ' ' + message)
}

/** Single byte-range only; null when absent/malformed/unsatisfiable-simple. */
export function parseRange(header, size) {
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
