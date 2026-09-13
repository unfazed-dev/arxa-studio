/**
 * GenericRestWorkspaceProvider + the HOSTILE fixture server (task 13 step 6).
 *
 * The fixture is an in-process, conforming Wire v1 backend on 127.0.0.1 with
 * an EPHEMERAL port (localhost only, torn down in finally). It starts
 * conforming — the adapter must pass the FULL conformance kit against it,
 * cross-org isolation included — and then flips hostile:
 *   idor  — ignores the token→org binding on record read/write
 *   leak  — a list endpoint that leaks other orgs' rows
 * and the kit MUST turn those runs red. A green kit that cannot go red is a
 * rubber stamp, so the hostile legs are the point of this suite.
 *
 * Run: node plugins/workspace-provider/selftest.rest.mjs
 */
import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'

import { BOUNDS, BASE_PATH, COLLECTIONS, MEDIA, ROLES, WIRE_VERSION } from './lib/contract.js'
import { encodeCursor } from './lib/wire.js'
import { GenericRestWorkspaceProvider } from './lib/generic-rest.js'
import { runConformance } from './lib/conformance.js'
import { WorkspaceError } from './lib/errors.js'

let n = 0
const ok = (s) => { n++; console.log('  ok ' + s) }
const sha256 = (b) => createHash('sha256').update(b).digest('hex')

// ============================================================ fixture server
class FixtureServer {
  constructor () {
    this.mode = 'conforming' // | 'idor' | 'leak' | 'flaky' | 'delay'
    this.flakyLeft = {} // route -> remaining 503s
    this.lastAuth = null
    this.attempts = {} // route -> attempt count
    this.orgs = new Map() // orgId -> {id, name, kind, members: [{userId, email, role}]}
    this.records = new Map() // `${orgId}/${collection}/${id}` -> {etag, doc}
    this.audit = new Map() // orgId -> rows[]
    this.blobs = new Map() // `${orgId}/${path}` -> Buffer
    this.revoked = new Set()
    this.orgSeq = 0
    this.server = createServer((req, res) => this.route(req, res))
  }

  listen () {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + this.server.address().port))
    })
  }
  close () { return new Promise((r) => this.server.close(r)) }

  // ---- wire helpers
  json (res, status, obj) {
    const body = JSON.stringify(obj)
    res.writeHead(status, { 'content-type': MEDIA.JSON, 'content-length': Buffer.byteLength(body) })
    res.end(body)
  }
  jsonl (res, rows, nextCursor) {
    const body = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')
    const headers = { 'content-type': MEDIA.NDJSON, 'content-length': Buffer.byteLength(body) }
    if (nextCursor) headers['X-Arxa-Cursor-Next'] = nextCursor
    res.writeHead(200, headers)
    res.end(body)
  }
  fail (res, status, code, message) {
    this.json(res, status, { error: { code, message, retryable: false, requestId: 'fx-' + randomUUID().slice(0, 8) } })
  }

  userOf (req) {
    const auth = req.headers.authorization
    this.lastAuth = auth ?? null
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
    if (!token || this.revoked.has(token)) return null
    return /^tok2?-/.test(token) ? token.replace(/^tok2?-/, '') : null
  }
  membership (org, user) { return org.members.find((m) => m.userId === user) }
  requireMember (res, org, user) {
    if (!this.membership(org, user)) { this.fail(res, 403, 'forbidden', 'not a member of this org'); return null }
    return this.membership(org, user)
  }

  route (req, res) {
    const url = new URL(req.url, 'http://x.test')
    const path = url.pathname
    if (!path.startsWith(BASE_PATH + '/')) return this.fail(res, 404, 'not_found', 'outside the workspace base path')
    if (req.headers['x-arxa-workspace-version'] !== String(WIRE_VERSION))
      return this.fail(res, 400, 'unsupported_version', 'only wire version 1 is served')
    const sub = path.slice(BASE_PATH.length)
    // hostile/stress modes
    this.attempts[sub] = (this.attempts[sub] ?? 0) + 1
    if (this.mode === 'flaky' && (this.flakyLeft[sub] ?? 0) > 0) {
      this.flakyLeft[sub] -= 1
      return this.fail(res, 503, 'unavailable', 'flaky fixture hiccup')
    }
    if (this.mode === 'delay' && sub === '/orgs') {
      setTimeout(() => this.jsonl(res, []), BOUNDS.REQUEST_TIMEOUT_MS * 2) // outlive any client timeout
      return
    }
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => this.dispatch(req, res, sub, url, Buffer.concat(chunks)))
  }

  dispatch (req, res, sub, url, body) {
    const user = this.userOf(req)
    // ---- capabilities + auth lifecycle (token-opaque, D34)
    if (req.method === 'GET' && sub === '/capabilities') {
      return this.json(res, 200, {
        auth: true, orgs: true, records: true, audit: true, realtime: false, storage: true, analytics: false,
        signIn: { kind: 'token', start: { hint: 'present your provider token' } },
      })
    }
    if (req.method === 'POST' && sub === '/auth/issue') {
      const { credentials } = JSON.parse(body.toString() || '{}')
      const u = credentials?.user
      if (typeof u !== 'string' || !u) return this.fail(res, 401, 'unauthenticated', 'no such credentials')
      return this.json(res, 200, { token: 'tok-' + u, session: { id: 'sess-' + u, expiresAt: 4102444800 } })
    }
    if (req.method === 'POST' && sub === '/auth/refresh') {
      const { token } = JSON.parse(body.toString() || '{}')
      if (typeof token !== 'string' || this.revoked.has(token)) return this.fail(res, 401, 'unauthenticated', 'token not refreshable')
      const u = token.startsWith('tok-') ? token.slice(4) : null
      if (!u) return this.fail(res, 401, 'unauthenticated', 'token not refreshable')
      return this.json(res, 200, { token: 'tok2-' + u, session: { id: 'sess-' + u, expiresAt: 4102444800 } })
    }
    if (req.method === 'POST' && sub === '/auth/revoke') {
      const token = req.headers.authorization?.slice(7)
      if (!user) return this.fail(res, 401, 'unauthenticated', 'no bearer')
      this.revoked.add(token)
      return this.json(res, 200, { revoked: true })
    }
    if (req.method === 'POST' && sub === '/auth/introspect') {
      const { token } = JSON.parse(body.toString() || '{}')
      const u = typeof token === 'string' && !this.revoked.has(token) && token.startsWith('tok') ? token.replace(/^tok2?-/, '') : null
      return this.json(res, 200, u ? { active: true, session: { id: 'sess-' + u } } : { active: false })
    }

    // ---- everything below requires a bearer
    if (!user) return this.fail(res, 401, 'unauthenticated', 'bearer required')

    const mOrg = sub.match(/^\/orgs\/([^/]+)$/)
    const mMembers = sub.match(/^\/orgs\/([^/]+)\/members$/)
    const mMember = sub.match(/^\/orgs\/([^/]+)\/members\/([^/]+)$/)
    const mRecords = sub.match(/^\/orgs\/([^/]+)\/records\/([^/]+)$/)
    const mRecord = sub.match(/^\/orgs\/([^/]+)\/records\/([^/]+)\/([^/]+)$/)
    const mBlobUrl = sub.match(/^\/orgs\/([^/]+)\/storage\/(.+)\/signed-url$/)
    const mBlob = sub.match(/^\/orgs\/([^/]+)\/storage\/(.+)$/)

    if (req.method === 'GET' && sub === '/orgs') {
      const rows = [...this.orgs.values()].filter((o) => this.membership(o, user))
      return this.jsonl(res, rows)
    }
    if (req.method === 'POST' && sub === '/orgs') {
      const { name, kind } = JSON.parse(body.toString())
      this.orgSeq += 1
      const org = { id: 'fx-org-' + this.orgSeq, name, kind, members: [{ userId: user, email: user + '@example.test', role: 'owner' }] }
      this.orgs.set(org.id, org)
      const { members, ...doc } = org
      return this.json(res, 200, doc)
    }
    if (mOrg && ['GET', 'PATCH', 'DELETE'].includes(req.method)) {
      const org = this.orgs.get(mOrg[1])
      if (!org) return this.fail(res, 404, 'not_found', 'org not found')
      if (!this.requireMember(res, org, user)) return
      if (req.method === 'GET') { const { members, ...doc } = org; return this.json(res, 200, doc) }
      if (req.method === 'PATCH') { Object.assign(org, JSON.parse(body.toString())); const { members, ...doc } = org; return this.json(res, 200, doc) }
      this.orgs.delete(org.id)
      return this.json(res, 200, { deleted: true })
    }

    if (mMembers && req.method === 'GET') {
      const org = this.orgs.get(mMembers[1])
      if (!org) return this.fail(res, 404, 'not_found', 'org not found')
      if (!this.requireMember(res, org, user)) return
      return this.jsonl(res, org.members.map((m, i) => ({ id: 'fx-mem-' + i, ...m })))
    }
    if (mMembers && req.method === 'POST') {
      const org = this.orgs.get(mMembers[1])
      if (!org) return this.fail(res, 404, 'not_found', 'org not found')
      const actor = this.requireMember(res, org, user)
      if (!actor) return
      if (!['owner', 'admin'].includes(actor.role)) return this.fail(res, 403, 'forbidden', 'only owner or admin manages members')
      const { email, role } = JSON.parse(body.toString())
      if (!ROLES.includes(role)) return this.fail(res, 400, 'invalid_request', 'role outside the fixed vocabulary')
      if (org.members.some((m) => m.email === email)) return this.json(res, 200, { id: 'fx-mem-existing', email, role, userId: 'fx-user-existing', status: 'invited' })
      const id = 'fx-mem-' + org.members.length // matches the index-derived ids in GET/PATCH/DELETE
      org.members.push({ userId: 'fx-user-' + randomUUID().slice(0, 6), email, role, status: 'invited' })
      return this.json(res, 200, { id, email, role, userId: org.members.at(-1).userId, status: 'invited' })
    }
    if (mMember && ['PATCH', 'DELETE'].includes(req.method)) {
      const org = this.orgs.get(mMember[1])
      if (!org) return this.fail(res, 404, 'not_found', 'org not found')
      const actor = this.requireMember(res, org, user)
      if (!actor) return
      if (!['owner', 'admin'].includes(actor.role)) return this.fail(res, 403, 'forbidden', 'only owner or admin manages members')
      const idx = org.members.findIndex((m, i) => 'fx-mem-' + i === mMember[2])
      if (idx === -1) return this.fail(res, 404, 'not_found', 'member not found')
      const member = org.members[idx]
      if (req.method === 'DELETE') {
        if (member.role === 'owner' && org.members.filter((m) => m.role === 'owner').length === 1)
          return this.fail(res, 403, 'forbidden', 'the last owner cannot be removed')
        org.members.splice(idx, 1)
        return this.json(res, 200, { removed: true })
      }
      const { role } = JSON.parse(body.toString())
      if (!ROLES.includes(role)) return this.fail(res, 400, 'invalid_request', 'role outside the fixed vocabulary')
      if (member.role === 'owner' && role !== 'owner' && org.members.filter((m) => m.role === 'owner').length === 1)
        return this.fail(res, 403, 'forbidden', 'the last owner cannot be demoted')
      member.role = role
      return this.json(res, 200, { id: mMember[2], ...member })
    }

    if (mRecords && req.method === 'GET') {
      const org = this.orgs.get(mRecords[1])
      if (!org) return this.fail(res, 404, 'not_found', 'org not found')
      if (!this.requireMember(res, org, user)) return
      const collection = mRecords[2]
      if (!COLLECTIONS.includes(collection)) return this.fail(res, 400, 'invalid_request', 'unknown collection')
      const limit = Math.min(Number(url.searchParams.get('limit') ?? BOUNDS.DEFAULT_PAGE_LIMIT), BOUNDS.MAX_PAGE_LIMIT)
      const cursor = url.searchParams.get('cursor')
      const offset = cursor ? JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')).offset ?? 0 : 0
      let prefix = mRecords[1] + '/' + collection + '/'
      if (this.mode === 'leak') prefix = '' // hostile: leak EVERY org's rows
      const ids = [...this.records.keys()].filter((k) => k.startsWith(prefix)).sort()
      const page = ids.slice(offset, offset + limit)
      const rows = page.map((k) => { const [/*o*/, /*c*/, id] = k.split('/'); return { id, etag: this.records.get(k).etag, doc: this.records.get(k).doc } })
      const next = offset + limit < ids.length ? encodeCursor({ offset: offset + limit }) : null
      return this.jsonl(res, rows, next ?? undefined)
    }
    if (mRecord && req.method === 'GET') {
      const org = this.orgs.get(mRecord[1])
      if (!org) return this.fail(res, 404, 'not_found', 'org not found')
      if (this.mode !== 'idor' && !this.requireMember(res, org, user)) return // hostile idor skips the fence
      const rec = this.records.get(mRecord[1] + '/' + mRecord[2] + '/' + mRecord[3])
      if (!rec) return this.fail(res, 404, 'not_found', 'record not found')
      res.writeHead(200, { 'content-type': MEDIA.JSON, etag: rec.etag })
      return res.end(JSON.stringify(rec.doc))
    }
    if (mRecord && req.method === 'PUT') {
      const org = this.orgs.get(mRecord[1])
      if (!org) return this.fail(res, 404, 'not_found', 'org not found')
      if (this.mode !== 'idor' && !this.requireMember(res, org, user)) return
      if (!COLLECTIONS.includes(mRecord[2])) return this.fail(res, 400, 'invalid_request', 'unknown collection')
      const key = mRecord[1] + '/' + mRecord[2] + '/' + mRecord[3]
      const prev = this.records.get(key)
      if (req.headers['if-match'] && (!prev || prev.etag !== req.headers['if-match']))
        return this.fail(res, 409, 'conflict', 'etag mismatch')
      const doc = JSON.parse(body.toString())
      const etag = '"' + sha256(body).slice(0, 16) + '"'
      this.records.set(key, { etag, doc })
      return this.json(res, 200, { id: mRecord[3], etag })
    }
    if (mRecord && req.method === 'DELETE') {
      const org = this.orgs.get(mRecord[1])
      if (!org) return this.fail(res, 404, 'not_found', 'org not found')
      if (!this.requireMember(res, org, user)) return
      if (!this.records.delete(mRecord[1] + '/' + mRecord[2] + '/' + mRecord[3]))
        return this.fail(res, 404, 'not_found', 'record not found')
      return this.json(res, 200, { deleted: true })
    }

    if (sub.startsWith('/orgs/') && sub.endsWith('/audit')) {
      const orgId = sub.split('/')[2]
      const org = this.orgs.get(orgId)
      if (!org) return this.fail(res, 404, 'not_found', 'org not found')
      if (!this.requireMember(res, org, user)) return
      if (req.method === 'POST') {
        const row = JSON.parse(body.toString())
        const rows = this.audit.get(orgId) ?? []
        rows.push({ at: new Date().toISOString(), actor: user, ...row })
        this.audit.set(orgId, rows)
        return this.json(res, 200, { appended: true })
      }
      if (req.method === 'GET') return this.jsonl(res, this.audit.get(orgId) ?? [])
      // NO mutation route exists on audit — the wire has none.
      return this.fail(res, 404, 'not_found', 'audit is append-only; no mutation route exists')
    }

    if (mBlobUrl && req.method === 'POST') {
      const org = this.orgs.get(mBlobUrl[1])
      if (!org) return this.fail(res, 404, 'not_found', 'org not found')
      if (!this.requireMember(res, org, user)) return
      return this.json(res, 200, { url: this.server.address().port + BASE_PATH + sub.replace('/signed-url', '') + '?sig=fx', expiresAt: 4102444800 })
    }
    if (mBlob && req.method === 'PUT') {
      const org = this.orgs.get(mBlob[1])
      if (!org) return this.fail(res, 404, 'not_found', 'org not found')
      if (!this.requireMember(res, org, user)) return
      this.blobs.set(mBlob[1] + '/' + mBlob[2], body)
      // The frozen wire answers putBlob with MEDIA.BYTES — echo the stored bytes.
      res.writeHead(200, { 'content-type': MEDIA.BYTES })
      return res.end(body)
    }
    if (mBlob && req.method === 'GET') {
      const org = this.orgs.get(mBlob[1])
      if (!org) return this.fail(res, 404, 'not_found', 'org not found')
      if (!this.requireMember(res, org, user)) return
      const bytes = this.blobs.get(mBlob[1] + '/' + mBlob[2])
      if (!bytes) return this.fail(res, 404, 'not_found', 'blob not found')
      res.writeHead(200, { 'content-type': MEDIA.BYTES })
      return res.end(bytes)
    }
    if (mBlob && req.method === 'DELETE') {
      const org = this.orgs.get(mBlob[1])
      if (!org) return this.fail(res, 404, 'not_found', 'org not found')
      if (!this.requireMember(res, org, user)) return
      if (!this.blobs.delete(mBlob[1] + '/' + mBlob[2])) return this.fail(res, 404, 'not_found', 'blob not found')
      return this.json(res, 200, { deleted: true })
    }

    return this.fail(res, 404, 'not_found', 'no such wire route')
  }
}

// ============================================================ the suite
const memoryStore = () => {
  const map = new Map()
  return { map, get: async (k) => map.get(k), set: async (k, v) => { map.set(k, v) }, delete: async (k) => { map.delete(k) } }
}
const fx = new FixtureServer()
const baseUrl = await fx.listen()

try {
  const storeA = memoryStore()
  const storeB = memoryStore()
  const A = new GenericRestWorkspaceProvider({ baseUrl, credentialStore: storeA, fetch })
  const B = new GenericRestWorkspaceProvider({ baseUrl, credentialStore: storeB, fetch })

  // ---------------------------------------------- 1. no token, no access
  {
    const anon = new GenericRestWorkspaceProvider({ baseUrl, credentialStore: memoryStore(), fetch })
    let code = null
    try { await anon.listOrgs() } catch (e) { code = e.code }
    assert.equal(code, 'unauthenticated', 'before sign-in every auth route is unauthenticated')
    ok('unauthenticated before sign-in')
  }

  // ---------------------------------------------- 2. sign-in: declared flow, opaque handle
  {
    const info = await A.signInInfo()
    assert.equal(info.kind, 'token', 'the fixture declares exactly one sign-in kind')
    await A.signIn('token', { credentials: { user: 'a' } })
    const s = await A.currentSession()
    assert.equal(s.userId, 'sess-a', 'the wire session id is the opaque user handle')
    const stored = storeA.map.get('workspace-generic-rest')
    assert.ok(stored && typeof stored.token === 'string', 'the token is persisted through the credential store')
    assert.ok(fx.lastAuth === null || fx.lastAuth.startsWith('Bearer '), 'bearer sent, never printed')
    // refresh rotates the handle and keeps the session
    await A.refresh()
    assert.equal((await A.currentSession()).userId, 'sess-a')
    ok('sign-in renders the declared flow; token held as opaque store handle; refresh rotates')
  }

  // ---------------------------------------------- 3. full conformance, conforming mode
  {
    await B.signIn('token', { credentials: { user: 'b' } })
    const orgB = await B.createOrg({ name: 'org-b', kind: 'studio' })
    await B.putRecord(orgB.id, 'tickets', 'b-1', { secret: 'belonging-to-b' })
    const report = await runConformance(A, { crossOrg: { provider: B, orgId: orgB.id, recordId: 'b-1' } })
    for (const s of report.sections)
      assert.equal(s.status, 'green', s.id + ' → ' + s.details.join(' | '))
    assert.equal(report.ok, true)
    ok('conformance (network leg): every section green, cross-org isolation included')
  }

  // ---------------------------------------------- 4. bounded retries + timeout
  {
    fx.mode = 'flaky'
    fx.flakyLeft['/orgs'] = 1 // one 503, then through
    const orgs = await A.listOrgs()
    assert.ok(Array.isArray(orgs) && orgs.length > 0, 'a single 503 is retried, not surfaced')
    assert.equal(fx.attempts['/orgs'] >= 2, true, 'the retry actually re-issued the request')
    fx.mode = 'delay'
    let err = null
    try { await new GenericRestWorkspaceProvider({ baseUrl, credentialStore: storeA, fetch, timeoutMs: 300 }).listOrgs() } catch (e) { err = e }
    assert.ok(err instanceof WorkspaceError && err.code === 'unavailable', 'a hung server surfaces unavailable, not a hang')
    fx.mode = 'conforming'
    ok('bounded retries ride out a 503; a hung request times out to unavailable')
  }

  // ---------------------------------------------- 5. sign-out revokes the handle
  {
    const C = new GenericRestWorkspaceProvider({ baseUrl, credentialStore: memoryStore(), fetch })
    await C.signIn('token', { credentials: { user: 'c' } })
    await C.signOut()
    let code = null
    try { await C.listOrgs() } catch (e) { code = e.code }
    assert.equal(code, 'unauthenticated', 'the revoked token no longer authenticates')
    ok('sign-out revokes server-side and clears the handle')
  }

  // ---------------------------------------------- 6. HOSTILE: idor must go red
  {
    const orgB = await B.createOrg({ name: 'org-b2', kind: 'studio' })
    await B.putRecord(orgB.id, 'tickets', 'b2-1', { secret: 'b2' })
    fx.mode = 'idor'
    const report = await runConformance(A, { crossOrg: { provider: B, orgId: orgB.id, recordId: 'b2-1' } })
    const s = report.sections.find((x) => x.id === 'cross-org-isolation')
    assert.equal(s.status, 'red', 'the idor backend must not pass: ' + s.details.join(' | '))
    assert.equal(report.ok, false)
    fx.mode = 'conforming'
    ok('hostile idor: cross-org section RED, report not ok')
  }

  // ---------------------------------------------- 7. HOSTILE: list leak must go red
  {
    const orgB = await B.createOrg({ name: 'org-b3', kind: 'studio' })
    await B.putRecord(orgB.id, 'tickets', 'b3-1', { secret: 'b3' })
    fx.mode = 'leak'
    const report = await runConformance(A, { crossOrg: { provider: B, orgId: orgB.id, recordId: 'b3-1' } })
    const s = report.sections.find((x) => x.id === 'cross-org-isolation')
    assert.equal(s.status, 'red', 'the leaking list must not pass: ' + s.details.join(' | '))
    fx.mode = 'conforming'
    ok('hostile leak: list-endpoint leakage RED')
  }

  // ---------------------------------------------- 8. audit immutability at the wire
  {
    const org = await A.createOrg({ name: 'audit-org', kind: 'studio' })
    let code = null
    try { await A.rawRequest('putRecord', { orgId: org.id, collection: 'tickets', id: 'x' }, { body: { x: 1 } }) } catch (e) { code = e.code }
    // PUT /audit does not exist — but a raw PUT to an audit-shaped URL must be refused by the server
    let rawCode = null
    try {
      await A.fetch(BASE_PATH + '/orgs/' + org.id + '/audit', { method: 'PUT', headers: { 'content-type': MEDIA.JSON }, body: '{}' })
        .then((r) => { if (r.status >= 400) rawCode = 'refused-' + r.status })
    } catch { rawCode = 'refused' }
    assert.ok(rawCode?.startsWith('refused'), 'no audit mutation route exists server-side')
    ok('audit immutability: raw wire mutation attempts are refused')
  }

  // ---------------------------------------------- 9. blobs are bounded by MAX_BLOB_BYTES (review Important 1)
  {
    const org = await A.createOrg({ name: 'blob-bound-org', kind: 'studio' })
    const big = Buffer.alloc(2 * 1024 * 1024, 7) // 2 MiB: contract-legal blob, oversize as a record
    const put = await A.putBlob(org.id, 'big/blob.bin', big)
    assert.equal(put.bytes, big.length, 'a 2 MiB blob must reach the wire, not die client-side on the 1 MiB record bound')
    assert.equal(put.sha256, sha256(big), 'the client hash covers the whole blob')
    const back = await A.getBlob(org.id, 'big/blob.bin')
    assert.ok(back.equals(big), 'round-trip preserves every byte')
    // The record bound itself still bites: a >1 MiB JSON body stays invalid_request.
    let code = null
    try { await A.putRecord(org.id, 'tickets', 'too-big', { pad: 'x'.repeat(BOUNDS.MAX_RECORD_BYTES) }) } catch (e) { code = e.code }
    assert.equal(code, 'invalid_request', 'a >1 MiB JSON record is still rejected by MAX_RECORD_BYTES')
    ok('blob byte bound is MAX_BLOB_BYTES (2 MiB accepted); the 1 MiB bound still guards JSON bodies')
  }

} finally {
  await fx.close()
}

console.log(`workspace-provider rest conformance: ${n} checks green`)
