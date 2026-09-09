// Token classes for the artifact viewer (D7: short-lived per-file READ
// tokens on viewer URLs; D81: worktree-scoped WRITE tokens, separate class,
// separate lifetime). HMAC-SHA256, zero dependencies, TTL hard-capped at the
// D81 ceiling no matter what settings say.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Inline (pnpm virtual-store copies break cross-package relative imports in
// installed profiles — measured 2026-08-31, same as follow.js).
function arxaHome(env = process.env) {
  return env.ARXA_HOME || path.join(os.homedir(), '.arxa')
}

export const TOKEN_TTL_CEILING_SECONDS = 120

const b64u = (buf) => Buffer.from(buf).toString('base64url')

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url')
}

/** Issue a token. ttlSeconds is clamped into [1, TOKEN_TTL_CEILING_SECONDS].
 * Freestyle-section Task 8: the orgPath claim now means "root path" — it
 * binds a token to any open root (the org or a Freestyle root), not only
 * the org. No behavior change here: verifyToken below still does exact
 * string equality against whatever path the caller passes in. */
export function issueToken({ secret, scope, relPath = null, orgPath = null, worktreeId = null, ttlSeconds = 120, now = () => Math.floor(Date.now() / 1000) }) {
  if (!secret || typeof scope !== 'string') throw new TypeError('issueToken: secret and scope are required')
  const ttl = Math.max(1, Math.min(Number(ttlSeconds) || 120, TOKEN_TTL_CEILING_SECONDS))
  const body = { scope, relPath, orgPath, worktreeId, iat: now(), exp: now() + ttl }
  const payload = b64u(JSON.stringify(body))
  return payload + '.' + sign(payload, secret)
}

/** Verify one token against the expected class and bindings. Never throws. */
export function verifyToken(token, { secret, scope, relPath = null, orgPath = null, worktreeId = null, now = () => Math.floor(Date.now() / 1000) } = {}) {
  try {
    if (typeof token !== 'string' || !token.includes('.')) return { ok: false, reason: 'malformed' }
    const dot = token.indexOf('.')
    const payload = token.slice(0, dot)
    const mac = token.slice(dot + 1)
    const expected = sign(payload, secret)
    const a = Buffer.from(mac)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad-signature' }
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (body.scope !== scope) return { ok: false, reason: 'scope' }
    if (relPath !== null && body.relPath !== relPath) return { ok: false, reason: 'path' }
    if (orgPath !== null && body.orgPath !== orgPath) return { ok: false, reason: 'org' }
    if (worktreeId !== null && body.worktreeId !== worktreeId) return { ok: false, reason: 'worktree' }
    if (typeof body.exp !== 'number' || now() >= body.exp) return { ok: false, reason: 'expired' }
    return { ok: true, body }
  } catch {
    return { ok: false, reason: 'malformed' }
  }
}

/** Per-boot secret at $ARXA_HOME/keys/artifact-viewer-secret (created 0600). */
export function loadOrCreateSecret(env = process.env) {
  const dir = path.join(arxaHome(env), 'keys')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'artifact-viewer-secret')
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
    const secret = crypto.randomBytes(32).toString('hex')
    fs.writeFileSync(file, secret + '\n', { flag: 'wx', mode: 0o600 })
    return secret
  }
}

/** The org-server verify closure: READ token from the ?avt= query param,
 * bound to exactly this org + this relative path (D7 per-file tokens). */
export function readVerifyFor({ secret, orgPath }) {
  return async function verify(req, rel) {
    try {
      const t = new URL(req.url, 'http://x').searchParams.get('avt')
      if (!t) return false
      return verifyToken(t, { secret, scope: 'read', relPath: rel, orgPath }).ok
    } catch {
      return false
    }
  }
}
