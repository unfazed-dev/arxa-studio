/**
 * SupabaseWorkspaceProvider + the in-memory PROTOCOL fake (task 14, steps 1+4).
 *
 * The fake is an injected `fetch` — zero ports, zero sockets — speaking the
 * exact Supabase surface the adapter is allowed to touch (GoTrue auth,
 * PostgREST tables + the workspace RPCs, Storage) WITH row-level-security
 * emulation: the bearer token resolves to a user, org-scoped reads/writes are
 * refused for non-members exactly the way the shipped RLS policies refuse
 * them. The adapter is untrusted client code; isolation that only worked in
 * the adapter would prove nothing, so the fake enforces it server-side and
 * the conformance kit's cross-org section runs for real against that fence.
 *
 * It also flips hostile (idor: drops the membership fence on records; leak:
 * list ignores the org filter) so the kit's cross-org section provably goes
 * RED — a green kit that cannot go red is a rubber stamp (selftest.rest.mjs
 * carries the same law for the generic adapter).
 *
 * The REAL local Supabase stack (docker daemon required) is exercised by
 * scripts/workspace-provider-supabase-smoke.mjs and the dedicated CI job —
 * this file stays offline and daemon-free on purpose.
 *
 * Run: node plugins/workspace-provider/selftest.supabase.mjs
 */
import { strict as assert } from 'node:assert'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BOUNDS } from './lib/contract.js'
import { WorkspaceError } from './lib/errors.js'
import { SupabaseWorkspaceProvider, SUPABASE_CAPABILITIES, CREDENTIAL_HANDLE } from './lib/supabase.js'
import { runConformance } from './lib/conformance.js'
import { exportBundle, importBundle } from './lib/export-bundle.js'
import { LocalWorkspaceProvider } from './lib/local.js'

let n = 0
const ok = (s) => { n++; console.log('  ok ' + s) }
const sha256 = (b) => createHash('sha256').update(b).digest('hex')

const code = (e) => (e instanceof WorkspaceError ? e.code : 'not-a-workspace-error')

// ============================================================ the protocol fake
// PostgREST maps SQLSTATE → HTTP; the fake mirrors the mapping the real stack
// gives the workspace functions (42501→403, 40001→409, P0002→404, 22xxx→400).
const PG_STATUS = { 42501: 403, 40001: 409, 'P0002': 404, 22023: 400, '22P02': 400, 23505: 409 }

class FakeSupabase {
  constructor ({ hangMs = 60_000 } = {}) {
    this.mode = 'conforming' // | 'idor' | 'leak' | 'flaky' | 'delay'
    this.flakyLeft = {} // path -> remaining 503s
    this.attempts = {} // path -> attempt count
    this.hangMs = hangMs
    this.users = new Map() // userId -> {id, email, password}
    this.tokens = new Map() // access token -> userId
    this.refresh = new Map() // refresh token -> userId
    this.revoked = new Set()
    this.orgs = new Map() // orgId -> {id, name, kind, created_at}
    this.members = new Map() // memberId -> {id, org_id, user_id, email, role, status, created_at}
    this.records = new Map() // `${org}|${collection}|${id}` -> {etag, doc(text), created_at, updated_at}
    this.audit = new Map() // orgId -> [{id, at, actor, payload}]
    this.blobs = new Map() // `${org}|${path}` -> Buffer
    this.auditSeq = 0
    this.preferLog = [] // [method, path, Prefer] — the wire the adapter speaks
  }

  // ---- user seeding + sign-up surface (auto-confirm, like the local stack)
  addUser (email, password = 'pw-' + email) {
    const id = 'usr-' + randomUUID().slice(0, 8)
    this.users.set(id, { id, email, password })
    return { id, email, password }
  }

  // ---- RLS emulation (the point of the fake)
  member (orgId, userId) {
    for (const m of this.members.values()) if (m.org_id === orgId && m.user_id === userId) return m
    return null
  }
  isMember (orgId, userId) { return this.member(orgId, userId) !== null }

  json (status, body) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
  pgError (sqlstate, message) {
    return this.json(PG_STATUS[sqlstate] ?? 400, { code: sqlstate, message })
  }

  async handle (url, init = {}) {
    const u = new URL(url)
    const path = u.pathname + (u.search || '')
    this.attempts[u.pathname] = (this.attempts[u.pathname] ?? 0) + 1
    this.preferLog.push([init.method ?? 'GET', u.pathname, init.headers?.Prefer ?? null])

    if (this.mode === 'delay') {
      // The hang timer stays REF'd: AbortSignal.timeout is unref'd by design,
      // so without a live handle the process would exit before the client's
      // abort ever fired. Cleared on abort so nothing lingers.
      await new Promise((r) => {
        const t = setTimeout(r, this.hangMs)
        if (init.signal) {
          if (init.signal.aborted) { clearTimeout(t); return r() }
          init.signal.addEventListener('abort', () => { clearTimeout(t); r() }, { once: true })
        } else t.unref?.()
      })
      if (init.signal?.aborted) throw new Error('The operation was aborted') // real fetch honors the signal; so does the fake
    }
    if (this.mode === 'flaky' && (this.flakyLeft[u.pathname] ?? 0) > 0) {
      this.flakyLeft[u.pathname] -= 1
      return this.json(503, { message: 'flaky hiccup' })
    }

    const body = init.body !== undefined ? String(init.body) : ''
    const rawBody = init.body !== undefined && Buffer.isBuffer(init.body) ? init.body : null
    const bearer = (init.headers?.Authorization ?? '').replace(/^Bearer /, '')
    const user = this.tokens.has(bearer) && !this.revoked.has(bearer)
      ? this.tokens.get(bearer) : null

    try {
      // ---------------------------------------------------------- auth/v1
      if (u.pathname === '/auth/v1/token') {
        const grant = u.searchParams.get('grant_type')
        const creds = body ? JSON.parse(body) : {}
        let userId = null
        if (grant === 'password') {
          for (const [id, usr] of this.users)
            if (usr.email === creds.email && usr.password === creds.password) userId = id
        } else if (grant === 'refresh_token') {
          if (this.refresh.has(creds.refresh_token)) {
            userId = this.refresh.get(creds.refresh_token)
            this.refresh.delete(creds.refresh_token) // rotated: single-use
          }
        }
        if (!userId) return this.json(401, { error: 'invalid_grant', error_description: 'no such credentials' })
        const tok = 'tok-' + randomUUID(), rt = 'rt-' + randomUUID()
        this.tokens.set(tok, userId); this.refresh.set(rt, userId)
        return this.json(200, {
          access_token: tok, token_type: 'bearer', expires_in: 3600, expires_at: 4102444800,
          refresh_token: rt, user: { id: userId, email: this.users.get(userId).email },
        })
      }
      if (u.pathname === '/auth/v1/user') {
        if (!user) return this.json(401, { message: 'no bearer' })
        return this.json(200, { id: user, email: this.users.get(user).email })
      }
      if (u.pathname === '/auth/v1/logout') {
        if (!user) return this.json(401, { message: 'no bearer' })
        this.revoked.add(bearer)
        return new Response(null, { status: 204 })
      }
      if (u.pathname === '/auth/v1/signup') { // the local stack auto-confirms
        const { email, password } = body ? JSON.parse(body) : {}
        for (const usr of this.users.values()) if (usr.email === email) return this.json(400, { message: 'already registered' })
        const u2 = this.addUser(email, password)
        const tok = 'tok-' + randomUUID(), rt = 'rt-' + randomUUID()
        this.tokens.set(tok, u2.id); this.refresh.set(rt, u2.id)
        return this.json(200, { id: u2.id, email, access_token: tok, refresh_token: rt, expires_at: 4102444800 })
      }

      // ---------------------------------------------------------- rest/v1
      if (u.pathname.startsWith('/rest/v1/')) {
        if (!user) return this.json(401, { message: 'bearer required' })
        return this.rest(u, init, body, user)
      }

      // ---------------------------------------------------------- storage/v1
      if (u.pathname.startsWith('/storage/v1/object')) {
        if (!user) return this.json(401, { message: 'bearer required' })
        return this.storage(u, init, user, rawBody ?? Buffer.from(body, 'utf8'))
      }

      return this.json(404, { message: 'no such route' })
    } catch (e) {
      return this.json(500, { message: 'fake broke: ' + e.message })
    }
  }

  async rest (u, init, body, user) {
    // PostgREST Prefer semantics, enforced server-side so the fake is not
    // blind to them: inserts/PATCH/DELETE hand the row back ONLY under
    // return=representation; return=minimal answers 204 with no body.
    const prefer = String(init.headers?.Prefer ?? '')
    const wantsRow = prefer.includes('return=representation')
    const rpc = u.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/)
    if (rpc) return this.rpc(rpc[1], JSON.parse(body || '{}'), user, prefer)

    const table = u.pathname.split('/')[3]
    if (table === 'orgs') {
      if (init.method === 'POST') {
        const { name, kind } = JSON.parse(body || '{}')
        const id = 'org-' + randomUUID().slice(0, 8)
        this.orgs.set(id, { id, name, kind: kind ?? 'studio', created_at: new Date().toISOString() })
        // the shipped trigger inserts the creator as owner
        const ownerId = 'mem-' + randomUUID().slice(0, 8)
        this.members.set(ownerId, {
          id: ownerId, org_id: id, user_id: user,
          email: this.users.get(user).email, role: 'owner', status: 'active',
          created_at: new Date().toISOString(),
        })
        if (!wantsRow) return new Response(null, { status: 201 }) // PostgREST's insert default: no row back
        return this.json(201, [this.orgs.get(id)])
      }
      const id = u.searchParams.get('id')?.replace(/^eq\./, '')
      const org = id ? this.orgs.get(id) : null
      if (init.method === 'GET') {
        if (u.searchParams.has('id')) return this.json(200, org && this.isMember(id, user) ? [org] : [])
        const mine = [...this.orgs.values()].filter((o) => this.isMember(o.id, user))
        return this.json(200, mine)
      }
      if (!org || !this.isMember(id, user)) return this.json(404, { message: 'not found' }) // PATCH/DELETE on 0 rows
      if (init.method === 'PATCH') {
        const patch = JSON.parse(body || '{}'); delete patch.id
        Object.assign(org, patch)
        if (!wantsRow) return new Response(null, { status: 204 })
        return this.json(200, [org])
      }
      if (init.method === 'DELETE') {
        this.orgs.delete(id)
        for (const [mid, m] of [...this.members]) if (m.org_id === id) this.members.delete(mid)
        for (const k of [...this.records.keys()]) if (k.startsWith(id + '|')) this.records.delete(k)
        if (!wantsRow) return new Response(null, { status: 204 })
        return this.json(200, [org])
      }
    }
    if (table === 'org_members' && init.method === 'GET') {
      const orgId = u.searchParams.get('org_id')?.replace(/^eq\./, '')
      const rows = [...this.members.values()]
        .filter((m) => m.org_id === orgId && this.isMember(orgId, user))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
      return this.json(200, rows)
    }
    if (table === 'records') {
      const q = (k) => u.searchParams.get(k)?.replace(/^eq\./, '')
      const orgId = q('org_id'), collection = q('collection'), id = q('id')
      const key = `${orgId}|${collection}|${id}`
      const rec = this.records.get(key)
      const fenced = this.mode !== 'idor' && !this.isMember(orgId, user) // RLS hides foreign rows
      if (init.method === 'GET') return this.json(200, rec && !fenced ? [{ id, etag: rec.etag, doc: rec.doc }] : [])
      if (init.method === 'DELETE') {
        if (!rec || fenced) return this.json(404, { message: 'not found' })
        this.records.delete(key)
        if (!wantsRow) return new Response(null, { status: 204 })
        return this.json(200, [{ id, etag: rec.etag }])
      }
    }
    if (table === 'audit_log' && init.method === 'POST') {
      const { org_id, payload } = JSON.parse(body || '{}')
      if (!this.isMember(org_id, user)) return this.pgError('42501', 'new row violates row-level security')
      this.auditSeq += 1
      const rows = this.audit.get(org_id) ?? []
      rows.push({ id: this.auditSeq, at: new Date().toISOString(), actor: user, payload })
      this.audit.set(org_id, rows)
      if (!wantsRow) return new Response(null, { status: 201 })
      return this.json(201, { appended: true })
    }
    return this.json(404, { message: 'no such table route' })
  }

  async rpc (fn, p, user, prefer = '') {
    const res = await this.rpcDo(fn, p, user)
    // PostgREST: return=minimal on an RPC answers 204 with no body; errors pass through
    if (/return=minimal/.test(prefer) && res.status >= 200 && res.status < 300)
      return new Response(null, { status: 204 })
    return res
  }

  async rpcDo (fn, p, user) {
    const ROLES4 = ['owner', 'admin', 'billing', 'member']
    if (fn === 'put_record') {
      const { p_org: org, p_collection: collection, p_id: id, p_doc: doc, p_expected_etag: expected } = p
      if (typeof doc !== 'string') return this.pgError('22023', 'doc must be text')
      try { JSON.parse(doc) } catch { return this.pgError('22023', 'doc is not valid JSON') }
      if (this.mode !== 'idor' && !this.isMember(org, user)) return this.pgError('42501', 'not a member of this org')
      const key = `${org}|${collection}|${id}`
      const etag = '"' + createHash('md5').update(doc).digest('hex') + '"'
      const prev = this.records.get(key)
      if (prev) {
        if (expected !== null && expected !== undefined && prev.etag !== expected)
          return this.pgError('40001', 'conflict: etag mismatch')
        prev.etag = etag; prev.doc = doc; prev.updated_at = new Date().toISOString()
        return this.json(200, { id, etag })
      }
      if (expected !== null && expected !== undefined) return this.pgError('40001', 'conflict: record does not exist')
      this.records.set(key, { etag, doc, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      return this.json(200, { id, etag })
    }
    if (fn === 'list_records') {
      const { p_org: org, p_collection: collection, p_offset: off = 0, p_limit: lim = 100 } = p
      if (!this.isMember(org, user)) return this.pgError('42501', 'not a member of this org')
      const keys = this.mode === 'leak'
        // hostile leak: the org fence is gone, so EVERY org's rows match
        ? [...this.records.keys()].filter((k) => k.includes('|' + collection + '|')).sort()
        : [...this.records.keys()].filter((k) => k.startsWith(org + '|' + collection + '|')).sort()
      const page = keys.slice(off, off + lim)
      const rows = page.map((k) => {
        const [, , id] = k.split('|'); const r = this.records.get(k)
        return { id, etag: r.etag, doc: r.doc }
      })
      return this.json(200, { rows, more: off + lim < keys.length })
    }
    if (fn === 'read_audit') {
      if (!this.isMember(p.p_org, user)) return this.pgError('42501', 'not a member of this org')
      // the SQL function returns {at, actor} || payload per row — payload wins
      return this.json(200, (this.audit.get(p.p_org) ?? []).map((r) => ({ at: r.at, actor: r.actor, ...r.payload })))
    }
    if (fn === 'add_member') {
      const { p_org: org, p_email: email, p_role: role } = p
      const actor = this.member(org, user)
      if (!actor || !['owner', 'admin'].includes(actor.role)) return this.pgError('42501', 'only owner or admin manages members')
      if (!ROLES4.includes(role)) return this.pgError('22023', 'role outside the fixed vocabulary')
      const existing = [...this.members.values()].find((m) => m.org_id === org && m.email === email)
      if (existing) {
        if (existing.role !== role) return this.pgError('40001', 'member already exists with a different role')
        return this.json(200, existing)
      }
      const m = { id: 'mem-' + randomUUID().slice(0, 8), org_id: org, user_id: null, email, role, status: 'invited', created_at: new Date().toISOString() }
      this.members.set(m.id, m)
      return this.json(200, m)
    }
    if (fn === 'set_member_role') {
      const m = this.members.get(p.p_member)
      if (!m) return this.pgError('P0002', 'member not found')
      const actor = this.member(m.org_id, user)
      if (!actor || !['owner', 'admin'].includes(actor.role)) return this.pgError('42501', 'only owner or admin manages members')
      if (!ROLES4.includes(p.p_role)) return this.pgError('22023', 'role outside the fixed vocabulary')
      if (m.role === 'owner' && p.p_role !== 'owner' && this.ownersOf(m.org_id).length === 1)
        return this.pgError('42501', 'the last owner cannot be demoted')
      m.role = p.p_role
      return this.json(200, m)
    }
    if (fn === 'remove_member') {
      const m = this.members.get(p.p_member)
      if (!m) return this.pgError('P0002', 'member not found')
      const actor = this.member(m.org_id, user)
      if (!actor || !['owner', 'admin'].includes(actor.role)) return this.pgError('42501', 'only owner or admin manages members')
      if (m.role === 'owner' && this.ownersOf(m.org_id).length === 1)
        return this.pgError('42501', 'the last owner cannot be removed')
      this.members.delete(m.id)
      return this.json(200, m)
    }
    return this.json(404, { message: 'no such function' })
  }

  ownersOf (orgId) { return [...this.members.values()].filter((m) => m.org_id === orgId && m.role === 'owner') }

  async storage (u, init, user, bytes) {
    const m = u.pathname.match(/^\/storage\/v1\/object\/((?:list|sign)\/)?arxa-workspace\/?(.*)$/)
    if (!m) return this.json(404, { message: 'no such bucket route' })
    const listMode = m[1] === 'list/'
    const signMode = m[1] === 'sign/'
    const rest = m[2]
    if (listMode && init.method === 'POST') {
      const { prefix = '' } = JSON.parse(bytes.toString('utf8') || '{}')
      // prefix arrives as the object path 'org/<orgId>/…'; blob keys are '<org>|<rel>'
      const pm = prefix.match(/^org\/([^/]+)\/?(.*)$/)
      if (!pm) return this.json(200, [])
      const relPrefix = pm[2] ?? ''
      const out = []
      for (const k of this.blobs.keys()) {
        if (!k.startsWith(pm[1] + '|') || !k.slice(pm[1].length + 1).startsWith(relPrefix)) continue
        const rel = k.slice(pm[1].length + 1 + relPrefix.length)
        if (rel === '') continue
        const segs = rel.split('/')
        if (segs.length === 1) out.push({ name: segs[0], id: 'obj-' + randomUUID().slice(0, 6), metadata: { size: this.blobs.get(k).length } })
        else if (!out.some((e) => e.name === segs[0] + '/')) out.push({ name: segs[0] + '/', id: null, metadata: null })
      }
      return this.json(200, out)
    }
    // every remaining route is org/<orgId>/<path…>
    const segs = rest.split('/')
    const org = segs[1]
    const rel = segs.slice(2).join('/')
    const key = `${org}|${rel}`
    const member = this.isMember(org, user)
    if (signMode && init.method === 'POST') {
      if (!member || !this.blobs.has(key)) return this.json(400, { error: 'Object not found' })
      return this.json(200, { signedURL: `/object/sign/arxa-workspace/${rest}?token=fake`, signedURLExpiry: 4102444800 })
    }
    if (init.method === 'POST' || init.method === 'PUT') {
      if (!member) return this.json(403, { error: 'row-level security' })
      this.blobs.set(key, bytes)
      return this.json(200, { Key: rest })
    }
    if (init.method === 'GET') {
      if (!member || !this.blobs.has(key)) return this.json(400, { error: 'Object not found' })
      return new Response(this.blobs.get(key), { status: 200, headers: { 'content-type': 'application/octet-stream' } })
    }
    if (init.method === 'DELETE') {
      if (!member || !this.blobs.has(key)) return this.json(400, { error: 'Object not found' })
      this.blobs.delete(key)
      return this.json(200, { message: 'deleted' })
    }
    return this.json(404, { message: 'no such storage route' })
  }

  fetch (url, init) { return this.handle(url, init) }
}

// ============================================================ helpers
const memoryStore = () => {
  const map = new Map()
  return { map, get: async (k) => map.get(k), set: async (k, v) => { map.set(k, v) }, delete: async (k) => { map.delete(k) } }
}
const BASE = 'https://proj-fake.supabase.test'
const deadFetch = () => { throw new Error('ECONNREFUSED all sockets dark') }

const expectCode = async (codes, fn) => {
  try { await fn() } catch (e) {
    if (e instanceof WorkspaceError && codes.includes(e.code)) return e
    throw new Error('wrong error: expected ' + codes.join('|') + ', got ' + (e?.code ?? '') + ': ' + e?.message)
  }
  throw new Error('expected ' + codes.join('|') + ', nothing thrown')
}

const fake = new FakeSupabase()
const userA = fake.addUser('a@example.test')
const userB = fake.addUser('b@example.test')

// ============================================================ the suite
try {
  // ---------------------------------------------- 1. constructor: the frozen provider config
  {
    let e = null
    try { new SupabaseWorkspaceProvider({}) } catch (x) { e = x }
    assert.equal(code(e), 'invalid_request', 'missing url/anonKey/credentialStore rejected as invalid_request')
    const p = new SupabaseWorkspaceProvider({ url: BASE, anonKey: 'anon', credentialStore: memoryStore(), fetch: deadFetch })
    assert.equal(p.url, BASE, 'the project URL is the only endpoint ever named')
    ok('constructor requires url + anonKey + injected credential store (typed rejection otherwise)')
  }

  // ---------------------------------------------- 2. unavailable service
  {
    const store = memoryStore()
    // seed a handle so the transport itself (not the missing session) is exercised
    await store.set(CREDENTIAL_HANDLE, { token: 'tok-x', refresh: 'rt-x', session: { id: 'usr-x' } })
    const p = new SupabaseWorkspaceProvider({ url: BASE, anonKey: 'anon', credentialStore: store, fetch: deadFetch })
    const e = await expectCode(['unavailable'], () => p.listOrgs())
    assert.equal(e.retryable, true, 'a dead socket is a retryable unavailable, not a crash')
    ok('unavailable service: network death surfaces as WorkspaceError(unavailable)')
  }

  // ---------------------------------------------- 3. bounded retries + timeout
  {
    const store = memoryStore()
    const p = new SupabaseWorkspaceProvider({ url: BASE, anonKey: 'anon', credentialStore: store, fetch: (...a) => fake.fetch(...a) })
    await p.signIn('email-form', userA)
    await p.createOrg({ name: 'retry-org', kind: 'studio' }) // something to list once the flake clears
    fake.mode = 'flaky'
    fake.flakyLeft['/rest/v1/orgs'] = 1 // one 503, then through
    const orgs = await p.listOrgs()
    assert.ok(Array.isArray(orgs) && orgs.length > 0, 'a single 503 is retried, not surfaced')
    assert.ok(fake.attempts['/rest/v1/orgs'] >= 2, 'the retry actually re-issued the request')
    const slow = new SupabaseWorkspaceProvider({ url: BASE, anonKey: 'anon', credentialStore: memoryStore(), fetch: (...a) => fake.fetch(...a), timeoutMs: 200 })
    await slow.signIn('email-form', userA)
    fake.mode = 'delay'
    await expectCode(['unavailable'], () => slow.listOrgs())
    fake.mode = 'conforming'
    ok('bounded retries ride out a 503; a hung request times out to unavailable')
  }

  // ---------------------------------------------- 4. reference email sign-in, declared kind only
  {
    const store = memoryStore()
    const p = new SupabaseWorkspaceProvider({ url: BASE, anonKey: 'anon', credentialStore: store, fetch: (...a) => fake.fetch(...a) })
    await expectCode(['unauthenticated'], () => p.listOrgs())
    assert.equal((await p.signInInfo()).kind, 'email-form', 'the capabilities declare the reference email flow')
    await expectCode(['invalid_request'], () => p.signIn('browser', userA)) // D34: render only the declared kind
    await expectCode(['unauthenticated'], () => p.signIn('email-form', { email: userA.email, password: 'wrong' }))
    const s = await p.signIn('email-form', userA)
    assert.equal(s.userId, userA.id, 'the Supabase user id is the opaque contract userId')
    assert.equal(s.email, userA.email)
    ok('email-form sign-in: declared kind only, bad credentials unauthenticated, opaque userId')
  }

  // ---------------------------------------------- 5. token lifecycle: opaque handle, rotate, revoke
  {
    const store = memoryStore()
    const p = new SupabaseWorkspaceProvider({ url: BASE, anonKey: 'anon', credentialStore: store, fetch: (...a) => fake.fetch(...a) })
    const events = []
    const stop = p.onAuthStateChange((ev) => events.push(ev))
    await p.signIn('email-form', userA)
    const handle = store.map.get(CREDENTIAL_HANDLE)
    assert.ok(handle && typeof handle.token === 'string' && typeof handle.refresh === 'string',
      'the session handle carries token+refresh through the credential store — shape, never the value')
    await p.refresh()
    const after = store.map.get(CREDENTIAL_HANDLE)
    assert.notEqual(after.token, handle.token, 'refresh rotates the handle')
    assert.equal((await p.currentSession()).userId, userA.id, 'rotation keeps the session')
    await p.refresh() // the rotated refresh token is single-use; the adapter must store the new one
    await p.signOut()
    assert.equal(events.at(-1), null, 'sign-out fires onAuthStateChange(null)')
    await expectCode(['unauthenticated'], () => p.listOrgs())
    stop()
    ok('token lifecycle: opaque store handle, refresh rotates (twice), sign-out revokes + clears')
  }

  // ---------------------------------------------- 6. SQL row mapping → contract objects
  {
    const store = memoryStore()
    const p = new SupabaseWorkspaceProvider({ url: BASE, anonKey: 'anon', credentialStore: store, fetch: (...a) => fake.fetch(...a) })
    await p.signIn('email-form', userA)
    const org = await p.createOrg({ name: 'mapping', kind: 'agency' })
    assert.ok(org.id && org.name === 'mapping' && org.kind === 'agency' && typeof org.createdAt === 'string',
      'createOrg returns the contract org object, not the row')
    assert.equal((await p.getOrg(org.id)).name, 'mapping')
    const updated = await p.updateOrg(org.id, { name: 'mapped-2' })
    assert.equal(updated.name, 'mapped-2')
    assert.equal(updated.id, org.id, 'the id is not patchable')
    assert.ok((await p.listOrgs()).some((o) => o.id === org.id))
    await p.archiveOrg(org.id)
    await expectCode(['not_found'], () => p.getOrg(org.id))
    // byte-exact doc round-trip: key ORDER must survive the jsonb-style store
    const org2 = await p.createOrg({ name: 'docs', kind: 'studio' })
    const doc = { zeta: 1, alpha: { omega: true, beta: [1, 2] }, mid: 'x' }
    await p.putRecord(org2.id, 'tickets', 'k-1', doc)
    const got = await p.getRecord(org2.id, 'tickets', 'k-1')
    assert.equal(JSON.stringify(got.doc), JSON.stringify(doc), 'the stored document text is preserved byte-for-byte')
    ok('row mapping: org CRUD objects; record docs survive byte-exact (key order intact)')
  }

  // ---------------------------------------------- 7. member invitation + role rules
  {
    const store = memoryStore()
    const p = new SupabaseWorkspaceProvider({ url: BASE, anonKey: 'anon', credentialStore: store, fetch: (...a) => fake.fetch(...a) })
    await p.signIn('email-form', userA)
    const org = await p.createOrg({ name: 'members', kind: 'studio' })
    const m1 = await p.addMember(org.id, { email: 'b@example.test', role: 'billing' })
    const m2 = await p.addMember(org.id, { email: 'b@example.test', role: 'billing' }) // idempotent replay
    assert.equal(m1.id, m2.id, 're-adding the same email+role returns the SAME member row')
    assert.equal((await p.listMembers(org.id)).filter((m) => m.email === 'b@example.test').length, 1)
    await expectCode(['conflict'], () => p.addMember(org.id, { email: 'b@example.test', role: 'member' }))
    await expectCode(['invalid_request'], () => p.addMember(org.id, { email: 'x@example.test', role: 'superuser' }))
    assert.equal(m1.status, 'invited', 'an invitation is invited, not active — identities re-join, they are not copied')
    await p.setRole(org.id, m1.id, 'member')
    assert.equal((await p.listMembers(org.id)).find((m) => m.id === m1.id).role, 'member')
    const sole = (await p.listMembers(org.id)).find((m) => m.role === 'owner')
    await expectCode(['forbidden'], () => p.removeMember(org.id, sole.id))
    const second = await p.addMember(org.id, { email: 'c@example.test', role: 'member' })
    await p.removeMember(org.id, second.id)
    ok('members: idempotent invite, role vocabulary fixed, last owner protected, remove works')
  }

  // ---------------------------------------------- 8. pagination, conflict, idempotent etag
  {
    const store = memoryStore()
    const p = new SupabaseWorkspaceProvider({ url: BASE, anonKey: 'anon', credentialStore: store, fetch: (...a) => fake.fetch(...a) })
    await p.signIn('email-form', userA)
    const org = await p.createOrg({ name: 'pages', kind: 'studio' })
    for (let i = 0; i < 3; i++) await p.putRecord(org.id, 'feedback', 'pg-' + i, { i })
    const p1 = await p.listRecords(org.id, 'feedback', { limit: 2 })
    assert.equal(p1.records.length, 2)
    assert.ok(typeof p1.nextCursor === 'string' && p1.nextCursor.length > 0, 'page 1 is cursored')
    const p2 = await p.listRecords(org.id, 'feedback', { cursor: p1.nextCursor })
    const ids = [...p1.records, ...p2.records].map((r) => r.id).sort()
    assert.equal(ids.join(), 'pg-0,pg-1,pg-2')
    assert.equal(p2.nextCursor, null, 'the stream ends with a null cursor')
    const r = await p.putRecord(org.id, 'user_prefs', 'cf-1', { v: 1 })
    await p.putRecord(org.id, 'user_prefs', 'cf-1', { v: 2 })
    await expectCode(['conflict'], () => p.putRecord(org.id, 'user_prefs', 'cf-1', { v: 3 }, { etag: r.etag }))
    const a = await p.putRecord(org.id, 'requirements', 'idem-1', { replay: true })
    const b = await p.putRecord(org.id, 'requirements', 'idem-1', { replay: true })
    assert.equal(a.etag, b.etag, 'identical documents replay to the identical etag')
    ok('records: cursor pagination, optimistic conflict, idempotent replay')
  }

  // ---------------------------------------------- 9. audit: append-only by shape
  {
    const store = memoryStore()
    const p = new SupabaseWorkspaceProvider({ url: BASE, anonKey: 'anon', credentialStore: store, fetch: (...a) => fake.fetch(...a) })
    await p.signIn('email-form', userA)
    const org = await p.createOrg({ name: 'audit', kind: 'studio' })
    await p.appendAudit(org.id, { action: 't1', note: 'x' })
    await p.appendAudit(org.id, { action: 't2' })
    const rows = await p.readAudit(org.id)
    assert.deepEqual(rows.map((r) => r.action), ['t1', 't2'])
    assert.ok(typeof rows[0].at === 'string' && typeof rows[0].actor === 'string')
    for (const m of ['updateAudit', 'patchAudit', 'deleteAudit'])
      assert.equal(p[m], undefined, 'no audit mutation method may exist on the interface')
    ok('audit: append + ordered read; no mutation method exists')
  }

  // ---------------------------------------------- 10. storage blobs
  {
    const store = memoryStore()
    const p = new SupabaseWorkspaceProvider({ url: BASE, anonKey: 'anon', credentialStore: store, fetch: (...a) => fake.fetch(...a) })
    await p.signIn('email-form', userA)
    const org = await p.createOrg({ name: 'blobs', kind: 'studio' })
    const bytes = Buffer.from('supabase-blob-bytes')
    const up = await p.putBlob(org.id, ['conf', 'x.bin'], bytes)
    assert.equal(up.sha256, sha256(bytes))
    assert.equal(up.bytes, bytes.length)
    assert.ok((await p.getBlob(org.id, ['conf', 'x.bin'])).equals(bytes))
    const url = await p.signedUrl(org.id, ['conf', 'x.bin'])
    assert.ok(typeof url.url === 'string' && url.url.length > 0, 'a signed url came back')
    const big = Buffer.alloc(2 * 1024 * 1024, 7) // 2 MiB: contract-legal blob, oversize as a record
    await p.putBlob(org.id, ['big', 'b.bin'], big)
    assert.ok((await p.getBlob(org.id, ['big', 'b.bin'])).equals(big))
    await p.deleteBlob(org.id, ['conf', 'x.bin'])
    await expectCode(['not_found'], () => p.getBlob(org.id, ['conf', 'x.bin']))
    ok('storage: hash round-trip, signed url, blob bound ≠ record bound')
  }

  // ---------------------------------------------- 11. realtime absent → truthful caps + adaptive poll
  {
    const store = memoryStore()
    const p = new SupabaseWorkspaceProvider({ url: BASE, anonKey: 'anon', credentialStore: store, fetch: (...a) => fake.fetch(...a) })
    await p.signIn('email-form', userA)
    const caps = await p.capabilities()
    assert.deepEqual(SUPABASE_CAPABILITIES, caps, 'the static declaration is the capability answer')
    assert.equal(caps.realtime, false, 'no realtime is ADVERTISED — the badge stays truthful (degraded)')
    assert.equal(caps.storage, true)
    const org = await p.createOrg({ name: 'live', kind: 'studio' })
    const seen = []
    const stop = p.subscribe(org.id, 'chat_conversations', (ev) => seen.push(ev))
    await p.putRecord(org.id, 'chat_conversations', 'rt-1', { live: true })
    await new Promise((r) => setTimeout(r, 500)) // D35 IMMEDIATE_AFTER_WRITE, not the 3 s tick
    assert.ok(seen.some((e) => e.type === 'put' && e.id === 'rt-1'), 'the immediate-after-write poll delivered the write')
    await p.deleteRecord(org.id, 'chat_conversations', 'rt-1')
    await new Promise((r) => setTimeout(r, 500))
    assert.ok(seen.some((e) => e.type === 'delete' && e.id === 'rt-1'), 'deletes surface through the poller too')
    stop()
    ok('realtime absent: caps say so; adaptive polling (immediate-after-write) delivers puts and deletes')
  }

  // ---------------------------------------------- 12. tenant isolation at the RPC fence
  {
    const storeA = memoryStore()
    const storeB = memoryStore()
    const A = new SupabaseWorkspaceProvider({ url: BASE, anonKey: 'anon', credentialStore: storeA, fetch: (...a) => fake.fetch(...a) })
    const B = new SupabaseWorkspaceProvider({ url: BASE, anonKey: 'anon', credentialStore: storeB, fetch: (...a) => fake.fetch(...a) })
    await A.signIn('email-form', userA)
    await B.signIn('email-form', userB)
    const orgA = await A.createOrg({ name: 'org-a', kind: 'studio' })
    const orgB = await B.createOrg({ name: 'org-b', kind: 'studio' })
    await A.putRecord(orgA.id, 'tickets', 'a-1', { secret: 'belongs-to-a' })
    await B.putRecord(orgB.id, 'tickets', 'b-1', { secret: 'belongs-to-b' })
    await expectCode(['not_found'], () => A.getRecord(orgB.id, 'tickets', 'b-1'))
    await expectCode(['forbidden'], () => A.putRecord(orgB.id, 'tickets', 'idor-probe', { x: 1 }))
    await expectCode(['forbidden'], () => A.listRecords(orgB.id, 'tickets'))
    await expectCode(['not_found'], () => A.getOrg(orgB.id))
    assert.ok(!(await A.listOrgs()).some((o) => o.id === orgB.id), 'A listOrgs contains no B org')
    assert.ok((await A.listRecords(orgA.id, 'tickets')).records.every((r) => r.id !== 'b-1'))
    ok('tenant isolation: cross-org get/put/list/org access all refused or invisible')
  }

  // ---------------------------------------------- 13. FULL conformance kit, network leg
  {
    const storeA = memoryStore()
    const storeB = memoryStore()
    const A = new SupabaseWorkspaceProvider({ url: BASE, anonKey: 'anon', credentialStore: storeA, fetch: (...a) => fake.fetch(...a) })
    const B = new SupabaseWorkspaceProvider({ url: BASE, anonKey: 'anon', credentialStore: storeB, fetch: (...a) => fake.fetch(...a) })
    await A.signIn('email-form', userA)
    await B.signIn('email-form', userB)
    const orgB = await B.createOrg({ name: 'conf-org-b', kind: 'studio' })
    await B.putRecord(orgB.id, 'tickets', 'b-1', { secret: 'b' })
    const report = await runConformance(A, {
      crossOrg: { provider: B, orgId: orgB.id, recordId: 'b-1' },
    })
    for (const s of report.sections)
      assert.equal(s.status, 'green', s.id + ' → ' + s.details.join(' | '))
    assert.equal(report.ok, true)
    ok('conformance kit: EVERY section green against the protocol fake, cross-org isolation included')
  }

  // ---------------------------------------------- 14. HOSTILE idor → the kit must go red
  {
    const storeA = memoryStore()
    const storeB = memoryStore()
    const A = new SupabaseWorkspaceProvider({ url: BASE, anonKey: 'anon', credentialStore: storeA, fetch: (...a) => fake.fetch(...a) })
    const B = new SupabaseWorkspaceProvider({ url: BASE, anonKey: 'anon', credentialStore: storeB, fetch: (...a) => fake.fetch(...a) })
    await A.signIn('email-form', userA)
    await B.signIn('email-form', userB)
    const oB = await B.createOrg({ name: 'idor-b', kind: 'studio' })
    await B.putRecord(oB.id, 'tickets', 'idor-1', { secret: 'idor' })
    fake.mode = 'idor'
    const report = await runConformance(A, { crossOrg: { provider: B, orgId: oB.id, recordId: 'idor-1' } })
    const s = report.sections.find((x) => x.id === 'cross-org-isolation')
    assert.equal(s.status, 'red', 'the idor backend must not pass: ' + s.details.join(' | '))
    assert.equal(report.ok, false)
    fake.mode = 'conforming'
    ok('hostile idor: cross-org section RED, report not ok')
  }

  // ---------------------------------------------- 15. HOSTILE leak → the kit must go red
  {
    const storeA = memoryStore()
    const storeB = memoryStore()
    const A = new SupabaseWorkspaceProvider({ url: BASE, anonKey: 'anon', credentialStore: storeA, fetch: (...a) => fake.fetch(...a) })
    const B = new SupabaseWorkspaceProvider({ url: BASE, anonKey: 'anon', credentialStore: storeB, fetch: (...a) => fake.fetch(...a) })
    await A.signIn('email-form', userA)
    await B.signIn('email-form', userB)
    const oB = await B.createOrg({ name: 'leak-b', kind: 'studio' })
    await B.putRecord(oB.id, 'tickets', 'leak-1', { secret: 'leak' })
    fake.mode = 'leak'
    const report = await runConformance(A, { crossOrg: { provider: B, orgId: oB.id, recordId: 'leak-1' } })
    const s = report.sections.find((x) => x.id === 'cross-org-isolation')
    assert.equal(s.status, 'red', 'the leaking list must not pass: ' + s.details.join(' | '))
    fake.mode = 'conforming'
    ok('hostile leak: list-endpoint leakage RED')
  }

  // ---------------------------------------------- 16. migration: local → supabase → local, portable hashes equal
  {
    const tmp = mkdtempSync(join(tmpdir(), 'arxa-ws-sb-'))
    try {
      const src = new LocalWorkspaceProvider({ home: join(tmp, 'src') })
      const srcOrg = await src.createOrg({ name: 'migrating', kind: 'agency' })
      await src.putRecord(srcOrg.id, 'tickets', 'm-1', { title: 'one', zeta: 1, alpha: 2 })
      await src.putRecord(srcOrg.id, 'chat_messages', 'm-2', { text: 'two' })
      await src.addMember(srcOrg.id, { email: 'mate@example.test', role: 'member' })
      await src.appendAudit(srcOrg.id, { action: 'migrated' })
      await src.putBlob(srcOrg.id, ['m', 'b.bin'], Buffer.from('blob-bytes'))

      const store = memoryStore()
      const sb = new SupabaseWorkspaceProvider({ url: BASE, anonKey: 'anon', credentialStore: store, fetch: (...a) => fake.fetch(...a) })
      await sb.signIn('email-form', userA)
      await exportBundle(src, srcOrg.id, join(tmp, 'bundle1'))
      const { orgId: sbOrg } = await importBundle(sb, join(tmp, 'bundle1'))

      // members are re-invited on the target, never copied: email+role match, identity is new
      const sbMembers = await sb.listMembers(sbOrg)
      assert.ok(sbMembers.some((m) => m.email === 'mate@example.test' && m.role === 'member'))
      assert.equal(sbMembers.filter((m) => m.email === 'mate@example.test').length, 1)
      assert.ok(!sbMembers.some((m) => m.email === 'mate@example.test' && m.userId === 'user-'),
        'invited member carries no copied local identity')

      const back = new LocalWorkspaceProvider({ home: join(tmp, 'back') })
      await exportBundle(sb, sbOrg, join(tmp, 'bundle2'))
      const { orgId: backOrg } = await importBundle(back, join(tmp, 'bundle2'))

      // portable data = records {id,doc} + members {email,role} + audit actions + blob hashes
      const readAll = async (p, orgId, c) => {
        const out = []; let cursor
        do { const page = await p.listRecords(orgId, c, { cursor }); out.push(...page.records); cursor = page.nextCursor } while (cursor)
        return out
      }
      const portable = async (p, orgId, blobRoot) => {
        const collections = {}
        for (const c of ['tickets', 'ticket_messages', 'chat_conversations', 'chat_messages', 'feedback', 'requirements', 'user_prefs'])
          collections[c] = (await readAll(p, orgId, c)).map((r) => ({ id: r.id, doc: r.doc })).sort((a, b) => a.id.localeCompare(b.id))
        // identities are not portable (§6): each provider's own org owner rides
        // the bundle as a re-invite, so owners are excluded from the portable set
        const members = (await p.listMembers(orgId)).filter((m) => m.role !== 'owner')
          .map((m) => ({ email: m.email, role: m.role })).sort((a, b) => a.email.localeCompare(b.email))
        const audit = (await p.readAudit(orgId)).map((r) => r.action).sort()
        const blobs = {}
        for (const path of await p.listBlobs(orgId)) blobs[path] = sha256(await p.getBlob(orgId, path))
        return sha256(JSON.stringify({ collections, members, audit, blobs }))
      }
      const h1 = await portable(src, srcOrg.id)
      const h2 = await portable(back, backOrg)
      assert.equal(h1, h2, 'local → supabase → local is hash-equivalent over portable data')
      ok('migration: local → supabase → local; portable-data hashes equal; members re-invited not copied')
    } finally { rmSync(tmp, { recursive: true, force: true }) }
  }

  // ---------------------------------------------- 17. Prefer semantics: the wire the adapter actually speaks
  {
    // The fake now enforces PostgREST Prefer behavior server-side (204 on
    // minimal RPCs, no row on writes that did not ask for one), so every
    // consuming call above passed only because it asked for
    // return=representation. This row pins the per-call header map itself:
    // RPCs state representation (except remove_member, which reads nothing →
    // minimal), table writes state their intent, reads carry none, and
    // auth/storage — not PostgREST — carry none at all.
    const RPC_PREFER = {
      put_record: 'return=representation', list_records: 'return=representation',
      read_audit: 'return=representation', add_member: 'return=representation',
      set_member_role: 'return=representation', remove_member: 'return=minimal',
    }
    const TABLE_PREFER = {
      'POST /rest/v1/orgs': 'return=representation',
      'PATCH /rest/v1/orgs': 'return=representation',
      'DELETE /rest/v1/orgs': 'return=representation',
      'DELETE /rest/v1/records': 'return=representation',
      'POST /rest/v1/audit_log': 'return=minimal',
    }
    for (const [method, path, prefer] of fake.preferLog) {
      if (path.startsWith('/rest/v1/rpc/')) {
        const fn = path.slice('/rest/v1/rpc/'.length)
        assert.equal(prefer, RPC_PREFER[fn], `${method} ${path} Prefer must be ${RPC_PREFER[fn]}, got ${prefer}`)
      } else if (path.startsWith('/rest/v1/')) {
        const expected = TABLE_PREFER[method + ' ' + path] ?? null
        assert.equal(prefer, expected, `${method} ${path} Prefer must be ${expected}, got ${prefer}`)
      } else {
        assert.equal(prefer, null, `${method} ${path} is not PostgREST and must carry no Prefer header`)
      }
    }
    const seenRpc = new Set(fake.preferLog.filter(([, p]) => p.startsWith('/rest/v1/rpc/')).map(([, p]) => p.slice('/rest/v1/rpc/'.length)))
    for (const fn of Object.keys(RPC_PREFER))
      assert.ok(seenRpc.has(fn), 'the suite must exercise rpc ' + fn + ' for its Prefer to be pinned')
    ok('prefer semantics: every /rest/v1 call states representation/minimal exactly; auth+storage carry none')
  }

} catch (e) {
  console.error(e)
  process.exitCode = 1
  throw e
}

console.log(`workspace-provider supabase conformance: ${n} checks green`)
