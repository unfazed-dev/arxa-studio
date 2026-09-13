/**
 * SupabaseWorkspaceProvider (task 14) — the first-party BYO-database adapter.
 *
 * For users who bring their OWN Supabase project (project law: the Arxa
 * Digital Solutions database is never a dependency of arxa studio — no
 * Arxa-owned URL or key appears anywhere in this module or may ever enter its
 * config). The adapter speaks only Supabase's own HTTP surface — GoTrue auth,
 * PostgREST tables/RPC, Storage — with the row-level-security fences that
 * ship in migrations/. All Supabase row shapes STAY in this module: callers
 * see only Task 13 contract objects. The Wire v1 contract is untouched.
 *
 * Rulings honored:
 *   R8/D34 — Supabase Auth supplies the reference email/password UX, but the
 *     app consumes only the opaque-token session surface: the access+refresh
 *     pair lives as one opaque handle in the injected credential store
 *     (never an environment file) and is never printed.
 *   R9/D35 — realtime is not wired; capabilities() says so truthfully and
 *     subscribe() degrades to Task 13 adaptive polling over listRecords.
 *   D33 — no staff/support-access capability exists here; diagnostics stay
 *     operator-exported (arxa-studio diagnose).
 *
 * The migrations define the server contract this adapter codes against:
 *   tables  orgs, org_members, records (doc kept as byte-exact TEXT, etag =
 *           md5 of the document text), audit_log (insert/select only)
 *   rpcs    put_record, list_records, read_audit, add_member,
 *           set_member_role, remove_member — SQLSTATE→HTTP per PostgREST:
 *           42501→403 forbidden, 40001→409 conflict, P0002→404 not_found
 *   storage bucket "arxa-workspace", objects under org/<orgId>/…
 */
import { createHash } from 'node:crypto'

import { BOUNDS, COLLECTIONS, ROLES } from './contract.js'
import { encodeCursor, decodeCursor } from './wire.js'
import { WorkspaceError, invalidRequest } from './errors.js'
import { AdaptivePoller } from './polling.js'
import { normalizeCapabilities } from './capabilities.js'

/** The opaque credential-handle name in the injected credential store. */
export const CREDENTIAL_HANDLE = 'workspace-supabase'

/** D34: the one sign-in flow this provider declares (email/password). */
export const SIGN_IN = Object.freeze({ kind: 'email-form', start: Object.freeze({ email: true, password: true }) })

/**
 * Truthful capability declaration: everything works except realtime (absent —
 * adaptive polling covers it) and analytics (no-op sink, nothing user-facing).
 */
export const SUPABASE_CAPABILITIES = Object.freeze(normalizeCapabilities({
  auth: true, orgs: true, records: true, audit: true, storage: true,
  realtime: false, analytics: false,
}))

const STORAGE_BUCKET = 'arxa-workspace'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const redact = (message, token) =>
  typeof token === 'string' && token.length > 0 && message.includes(token)
    ? message.split(token).join('[redacted]')
    : message

// Supabase status → contract error code. PostgREST maps the RLS/CAS
// SQLSTATEs onto these statuses (42501→403, 40001→409, P0002→404), so the
// adapter never needs to know a Postgres code.
const STATUS_CODE = { 400: 'invalid_request', 401: 'unauthenticated', 403: 'forbidden', 404: 'not_found', 409: 'conflict' }

export class SupabaseWorkspaceProvider {
  constructor ({ url, anonKey, credentialStore, fetch = globalThis.fetch, timeoutMs = BOUNDS.REQUEST_TIMEOUT_MS, attempts = BOUNDS.MAX_ATTEMPTS } = {}) {
    if (!/^https?:\/\//.test(String(url ?? ''))) throw invalidRequest('supabase requires an http(s) project url')
    if (typeof anonKey !== 'string' || anonKey.length === 0) throw invalidRequest('supabase requires the project anonKey (the publishable key, never a service key)')
    if (!credentialStore || typeof credentialStore.get !== 'function' || typeof credentialStore.set !== 'function')
      throw invalidRequest('supabase requires an injected credential store')
    this.url = String(url).replace(/\/+$/, '')
    this.anonKey = anonKey
    this.credentialStore = credentialStore
    this.fetchImpl = fetch
    this.timeoutMs = timeoutMs
    this.attempts = attempts
    this.session = null // {token, refresh, session:{id, expiresAt}} once signed in
    this.authListeners = new Set()
    this.pollers = new Map() // `${orgId} ${collection}` -> Set<AdaptivePoller>
  }

  onAuthStateChange (cb) {
    this.authListeners.add(cb)
    return () => this.authListeners.delete(cb)
  }
  emitAuth (ev) { for (const cb of this.authListeners) cb(ev) }

  async loadSession () {
    if (!this.session) this.session = await this.credentialStore.get(CREDENTIAL_HANDLE) ?? null
    return this.session
  }
  async token () {
    const s = await this.loadSession()
    if (!s) throw new WorkspaceError('unauthenticated', 'not signed in')
    return s.token
  }

  // ---- one transport: apikey always, bearer whenever a session exists
  async call (path, { method = 'GET', body, bytes, prefer, expect = 'json' } = {}) {
    const s = await this.loadSession()
    const headers = { apikey: this.anonKey }
    if (s) headers.Authorization = 'Bearer ' + s.token
    const payload = bytes ?? (body !== undefined ? JSON.stringify(body) : undefined)
    if (payload !== undefined)
      headers['content-type'] = bytes !== undefined ? 'application/octet-stream' : 'application/json'
    if (prefer) headers.Prefer = prefer
    // Prefer is explicit per call, never a blanket default: PostgREST's
    // insert/PATCH/DELETE default is minimal (no row back) and return=minimal
    // on an RPC answers 204 with no body — every call that consumes its
    // response must ask for return=representation. Auth/Storage are not
    // PostgREST and carry no Prefer at all.

    let lastError = null
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      const signal = this.timeoutMs > 0 ? AbortSignal.timeout(this.timeoutMs) : undefined
      let res
      try {
        res = await this.fetchImpl(this.url + path, { method, headers, body: payload, signal })
      } catch (e) {
        lastError = new WorkspaceError('unavailable', 'request failed or timed out', { retryable: true, cause: e })
        if (attempt < this.attempts) { await sleep(100 * attempt); continue }
        throw lastError
      }
      if (res.status >= 200 && res.status < 300) {
        if (expect === 'bytes') return Buffer.from(await res.arrayBuffer())
        const text = await res.text()
        return text ? JSON.parse(text) : null
      }
      const text = await res.text().catch(() => '')
      if (BOUNDS.RETRYABLE_STATUSES.includes(res.status) && attempt < this.attempts) { await sleep(100 * attempt); continue }
      throw this.decodeError(res.status, text, s?.token)
    }
    throw lastError ?? new WorkspaceError('unavailable', 'request failed')
  }

  decodeError (status, text, token) {
    let message = 'supabase request failed with status ' + status
    try {
      const b = JSON.parse(text)
      message = String(b.message ?? b.error_description ?? b.error ?? b.msg ?? message)
    } catch { /* non-JSON error bodies keep the status line */ }
    return new WorkspaceError(STATUS_CODE[status] ?? 'unavailable', redact(message, token), {
      retryable: BOUNDS.RETRYABLE_STATUSES.includes(status),
      status,
    })
  }

  // ---------------------------------------------------------- auth (R8/D34)
  capabilities () { return { ...SUPABASE_CAPABILITIES } }
  signInInfo () { return { kind: SIGN_IN.kind, start: { ...SIGN_IN.start } } }

  async signIn (method, credentials = {}) {
    if (method !== SIGN_IN.kind)
      throw invalidRequest('this backend declares a different sign-in flow: ' + SIGN_IN.kind)
    const { email, password } = credentials
    if (typeof email !== 'string' || typeof password !== 'string')
      throw invalidRequest('email-form sign-in needs an email and a password')
    const body = await this.call('/auth/v1/token?grant_type=password', {
      method: 'POST', body: { email, password },
    })
    this.session = {
      token: body.access_token,
      refresh: body.refresh_token,
      session: { id: body.user.id, ...(body.expires_at !== undefined ? { expiresAt: body.expires_at } : {}) },
    }
    await this.credentialStore.set(CREDENTIAL_HANDLE, this.session)
    this.emitAuth({ userId: this.session.session.id, email: body.user.email, expiresAt: this.session.session.expiresAt })
    return this.currentSession()
  }

  async refresh () {
    const s = await this.loadSession()
    if (!s) throw new WorkspaceError('unauthenticated', 'not signed in')
    const body = await this.call('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', body: { refresh_token: s.refresh },
    })
    this.session = {
      token: body.access_token,
      refresh: body.refresh_token,
      session: { id: body.user.id, ...(body.expires_at !== undefined ? { expiresAt: body.expires_at } : {}) },
    }
    await this.credentialStore.set(CREDENTIAL_HANDLE, this.session)
    return this.currentSession()
  }

  async signOut () {
    try { await this.call('/auth/v1/logout', { method: 'POST', body: {} }) } catch { /* a dead token is still signed out */ }
    this.session = null
    await this.credentialStore.delete?.(CREDENTIAL_HANDLE)
    this.emitAuth(null)
  }

  async currentSession () {
    const s = await this.loadSession()
    if (!s) return null
    try {
      const user = await this.call('/auth/v1/user')
      return { userId: user.id, email: user.email, expiresAt: s.session.expiresAt }
    } catch (e) {
      if (e instanceof WorkspaceError && (e.code === 'unauthenticated' || e.code === 'unavailable')) {
        // an introspection that cannot prove the session answers nothing
        if (e.code === 'unauthenticated') { this.session = null; return null }
        return { userId: s.session.id, email: undefined, expiresAt: s.session.expiresAt }
      }
      throw e
    }
  }

  // ---------------------------------------------------------- orgs (row map)
  mapOrg (row) { return { id: row.id, name: row.name, kind: row.kind, createdAt: row.created_at } }
  mapMember (row) {
    return { id: row.id, email: row.email, role: row.role, status: row.status, ...(row.user_id ? { userId: row.user_id } : {}) }
  }

  async createOrg ({ name, kind }) {
    const rows = await this.call('/rest/v1/orgs', { method: 'POST', body: { name, kind: kind ?? 'studio' }, prefer: 'return=representation' })
    return this.mapOrg(rows[0])
  }
  async getOrg (orgId) {
    const rows = await this.call(`/rest/v1/orgs?id=eq.${encodeURIComponent(orgId)}&select=*`)
    if (!rows?.length) throw new WorkspaceError('not_found', 'org not found')
    return this.mapOrg(rows[0])
  }
  async listOrgs () {
    const rows = await this.call('/rest/v1/orgs?select=*&order=created_at.asc')
    return (rows ?? []).map((r) => this.mapOrg(r))
  }
  async updateOrg (orgId, patch) {
    const { id, ...body } = patch // id is not patchable
    const rows = await this.call(`/rest/v1/orgs?id=eq.${encodeURIComponent(orgId)}`, { method: 'PATCH', body, prefer: 'return=representation' })
    if (!rows?.length) throw new WorkspaceError('not_found', 'org not found')
    return this.mapOrg(rows[0])
  }
  async archiveOrg (orgId) {
    const rows = await this.call(`/rest/v1/orgs?id=eq.${encodeURIComponent(orgId)}`, { method: 'DELETE', prefer: 'return=representation' })
    if (!rows?.length) throw new WorkspaceError('not_found', 'org not found')
    return { archived: true }
  }

  // ---------------------------------------------------------- members
  async addMember (orgId, { email, role }) {
    if (!ROLES.includes(role)) throw invalidRequest('role must be one of: ' + ROLES.join(', '))
    const row = await this.call('/rest/v1/rpc/add_member', {
      method: 'POST', body: { p_org: orgId, p_email: email, p_role: role },
      prefer: 'return=representation', // the row is consumed below
    })
    return this.mapMember(row)
  }
  async listMembers (orgId) {
    const rows = await this.call(`/rest/v1/org_members?org_id=eq.${encodeURIComponent(orgId)}&select=*&order=created_at.asc`)
    return (rows ?? []).map((r) => this.mapMember(r))
  }
  async setRole (orgId, memberId, role) {
    if (!ROLES.includes(role)) throw invalidRequest('role must be one of: ' + ROLES.join(', '))
    const row = await this.call('/rest/v1/rpc/set_member_role', {
      method: 'POST', body: { p_member: memberId, p_role: role },
      prefer: 'return=representation', // the row is consumed below
    })
    return this.mapMember(row)
  }
  async removeMember (orgId, memberId) {
    await this.call('/rest/v1/rpc/remove_member', { method: 'POST', body: { p_member: memberId }, prefer: 'return=minimal' }) // nothing is read back
    return { removed: true }
  }

  // ---------------------------------------------------------- records
  async putRecord (orgId, collection, id, doc, { etag } = {}) {
    if (!COLLECTIONS.includes(collection)) throw invalidRequest('collection is not part of the fixed Wire v1 collection list')
    const docText = JSON.stringify(doc) // stored byte-exact server-side; key order survives
    if (Buffer.byteLength(docText) > BOUNDS.MAX_RECORD_BYTES)
      throw invalidRequest('body exceeds the Wire v1 byte bound')
    const out = await this.call('/rest/v1/rpc/put_record', {
      method: 'POST',
      body: { p_org: orgId, p_collection: collection, p_id: id, p_doc: docText, p_expected_etag: etag ?? null },
      prefer: 'return=representation', // out.id / out.etag are consumed below
    })
    this.writeNotify(orgId, collection)
    return { id: out.id, etag: out.etag }
  }
  async getRecord (orgId, collection, id) {
    const rows = await this.call(`/rest/v1/records?org_id=eq.${encodeURIComponent(orgId)}&collection=eq.${encodeURIComponent(collection)}&id=eq.${encodeURIComponent(id)}&select=id,etag,doc`)
    if (!rows?.length) throw new WorkspaceError('not_found', 'record not found')
    return { id: rows[0].id, etag: rows[0].etag, doc: JSON.parse(rows[0].doc) }
  }
  async listRecords (orgId, collection, { cursor, limit = BOUNDS.DEFAULT_PAGE_LIMIT } = {}) {
    if (!COLLECTIONS.includes(collection)) throw invalidRequest('collection is not part of the fixed Wire v1 collection list')
    if (!Number.isInteger(limit) || limit < 1 || limit > BOUNDS.MAX_PAGE_LIMIT)
      throw invalidRequest('limit must be an integer between 1 and MAX_PAGE_LIMIT')
    const offset = cursor ? decodeCursor(cursor).offset ?? 0 : 0
    const out = await this.call('/rest/v1/rpc/list_records', {
      method: 'POST',
      body: { p_org: orgId, p_collection: collection, p_offset: offset, p_limit: limit },
      prefer: 'return=representation', // out.rows / out.more are consumed below
    })
    const records = (out.rows ?? []).map((r) => ({ id: r.id, etag: r.etag, doc: JSON.parse(r.doc) }))
    return { records, nextCursor: out.more === true ? encodeCursor({ offset: offset + limit }) : null }
  }
  async deleteRecord (orgId, collection, id) {
    const rows = await this.call(`/rest/v1/records?org_id=eq.${encodeURIComponent(orgId)}&collection=eq.${encodeURIComponent(collection)}&id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', prefer: 'return=representation' })
    if (!rows?.length) throw new WorkspaceError('not_found', 'record not found')
    this.writeNotify(orgId, collection)
    return { deleted: true }
  }

  // ---------------------------------------------------------- audit (append-only)
  async appendAudit (orgId, event) {
    await this.call('/rest/v1/audit_log', { method: 'POST', body: { org_id: orgId, payload: event }, prefer: 'return=minimal' }) // fire-and-forget insert
    return { appended: true }
  }
  async readAudit (orgId) {
    return (await this.call('/rest/v1/rpc/read_audit', { method: 'POST', body: { p_org: orgId }, prefer: 'return=representation' })) ?? []
  }

  // ---------------------------------------------------------- storage
  blobUrl (orgId, path) {
    const segs = Array.isArray(path) ? path : String(path).split('/')
    if (segs.some((s) => s === '' || s === '.' || s === '..')) throw invalidRequest('blob path is not a plain path')
    return `/storage/v1/object/${STORAGE_BUCKET}/org/${encodeURIComponent(orgId)}/${segs.map((s) => encodeURIComponent(s)).join('/')}`
  }
  async putBlob (orgId, path, bytes) {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    if (buf.length > BOUNDS.MAX_BLOB_BYTES) throw invalidRequest('blob exceeds the Wire v1 blob byte bound')
    await this.call(this.blobUrl(orgId, path), { method: 'POST', bytes: buf })
    return { sha256: sha256(buf), bytes: buf.length }
  }
  async getBlob (orgId, path) {
    try {
      return await this.call(this.blobUrl(orgId, path), { expect: 'bytes' })
    } catch (e) {
      // Storage answers missing/invisible objects with 400 — the contract word is not_found.
      if (e instanceof WorkspaceError && ['not_found', 'invalid_request', 'forbidden'].includes(e.code))
        throw new WorkspaceError('not_found', 'blob not found')
      throw e
    }
  }
  async deleteBlob (orgId, path) {
    try {
      await this.call(this.blobUrl(orgId, path), { method: 'DELETE' })
    } catch (e) {
      if (e instanceof WorkspaceError && ['not_found', 'invalid_request'].includes(e.code))
        throw new WorkspaceError('not_found', 'blob not found')
      throw e
    }
    return { deleted: true }
  }
  async signedUrl (orgId, path) {
    const signPath = this.blobUrl(orgId, path).replace('/object/', '/object/sign/')
    const out = await this.call(signPath, { method: 'POST', body: { expiresIn: 3600 } })
    return { url: this.url + out.signedURL, expiresAt: out.signedURLExpiry, mode: 'supabase' }
  }

  /** Blob enumeration for export: recursive walk of the org/ prefix. */
  async listBlobs (orgId) {
    const root = `org/${orgId}/`
    const walk = async (prefix) => {
      const entries = await this.call(`/storage/v1/object/list/${STORAGE_BUCKET}`, {
        method: 'POST',
        body: { prefix, limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } },
      })
      const out = []
      for (const e of entries ?? []) {
        if (e.metadata === null || e.metadata === undefined) out.push(...await walk(prefix + e.name)) // folder marker
        else out.push(prefix + e.name)
      }
      return out
    }
    const paths = await walk(root)
    return paths.map((p) => p.slice(root.length)).sort()
  }

  // ---------------------------------------------------------- realtime (R9/D35: absent → adaptive polling)
  subscribe (orgId, collection, cb) {
    const key = orgId + ' ' + collection
    let prev = new Map()
    const poller = new AdaptivePoller({
      poll: async () => {
        const { records } = await this.listRecords(orgId, collection, { limit: BOUNDS.MAX_PAGE_LIMIT })
        const now = new Map(records.map((r) => [r.id, r]))
        for (const [id, rec] of now)
          if (prev.get(id)?.etag !== rec.etag) cb({ type: 'put', id, doc: rec.doc })
        for (const id of prev.keys()) if (!now.has(id)) cb({ type: 'delete', id })
        prev = new Map(now)
      },
    })
    poller.start()
    if (!this.pollers.has(key)) this.pollers.set(key, new Set())
    this.pollers.get(key).add(poller)
    return () => { poller.stop(); this.pollers.get(key)?.delete(poller) }
  }
  writeNotify (orgId, collection) {
    for (const p of this.pollers.get(orgId + ' ' + collection) ?? []) void p.notifyWrite()
  }

  track () {} // analytics: no-op sink
}
