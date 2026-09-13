/**
 * GenericRestWorkspaceProvider — the Wire v1 adapter over any conforming
 * backend (task 13 step 6). `fetch` is injected, the session token is an
 * opaque handle kept in the injected credential store, only Wire v1 routes
 * are ever rendered, and every response crosses one of the frozen codecs.
 *
 * This first block is the pure response-decode half, pinned golden by
 * selftest.contract.mjs sections 13–14: the token/session envelope (D34) and
 * the X-Arxa-Cursor-Next consume rule. The wire client (fetch, retries,
 * timeouts) lives below and is exercised through the conformance kit.
 */
import { createHash, randomUUID } from 'node:crypto'
import { BOUNDS, HEADER, MEDIA, OPERATIONS, buildRequest } from './contract.js'
import { decodeCapabilities, decodeCursor, decodeErrorBody, decodeJsonBody, decodeJsonl, isRetryableStatus } from './wire.js'
import { WorkspaceError, invalidRequest } from './errors.js'
import { AdaptivePoller } from './polling.js'
import { normalizeCapabilities } from './capabilities.js'

/**
 * POST /auth/issue and /auth/refresh answer with ONE envelope: an opaque
 * token plus a session block. Exact decode — unknown keys are dropped. The
 * token is stored and re-sent verbatim; nothing ever inspects inside it.
 */
export function decodeSessionEnvelope (text, opts = {}) {
  const body = decodeJsonBody(text, opts)
  if (!body || typeof body !== 'object') throw invalidRequest('session envelope is not an object')
  const { token, session } = body
  if (typeof token !== 'string' || token.length === 0) throw invalidRequest('session envelope has no token')
  if (!session || typeof session !== 'object') throw invalidRequest('session envelope has no session block')
  if (typeof session.id !== 'string' || session.id.length === 0) throw invalidRequest('session block has no id')
  if (session.expiresAt !== undefined && typeof session.expiresAt !== 'number')
    throw invalidRequest('session expiresAt is not a number')
  return { token, session: { id: session.id, ...(session.expiresAt !== undefined ? { expiresAt: session.expiresAt } : {}) } }
}

/**
 * POST /auth/introspect answers {active} with the session block only when
 * active — an inactive introspection carries no session to leak.
 */
export function decodeIntrospection (text, opts = {}) {
  const body = decodeJsonBody(text, opts)
  if (!body || typeof body !== 'object') throw invalidRequest('introspection body is not an object')
  if (typeof body.active !== 'boolean') throw invalidRequest('introspection has no active boolean')
  if (!body.active) return { active: false }
  if (!body.session || typeof body.session !== 'object' || typeof body.session.id !== 'string')
    throw invalidRequest('active introspection has no session block')
  return { active: true, session: { id: body.session.id } }
}

const headerOf = (headers, name) => {
  if (!headers || typeof headers !== 'object') return undefined
  if (typeof headers.get === 'function') return headers.get(name) // fetch Headers
  const lower = String(name).toLowerCase()
  for (const [k, v] of Object.entries(headers)) if (String(k).toLowerCase() === lower) return v
  return undefined
}

/**
 * JSONL list-page consume rule (pinned): the body is PURE records, the resume
 * cursor rides X-Arxa-Cursor-Next, a present non-empty header value is the
 * next request's cursor VERBATIM (it must decode as a Wire v1 cursor — the
 * adapter validates but never inspects it), and an absent or empty header
 * ends the stream. A cursor inside the body is not part of the contract.
 */
export function consumeListPage (headers, bodyText, opts = {}) {
  const raw = headerOf(headers, HEADER.NEXT_CURSOR)
  const nextCursor = typeof raw === 'string' && raw.length > 0 ? raw : null
  if (nextCursor !== null) decodeCursor(nextCursor) // garbage dies HERE, before the next request
  return { records: decodeJsonl(bodyText, opts), nextCursor }
}

/** The opaque credential handle name in the injected credential store. */
export const CREDENTIAL_HANDLE = 'workspace-generic-rest'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * The Wire v1 adapter: fetch is INJECTED (never a global by contract), the
 * session token lives only in the injected credential store as an opaque
 * handle, every request is built by the frozen buildRequest, every response
 * crosses a frozen codec. Timeouts and bounded retries use the contract
 * bounds; no provider path or JavaScript module is ever accepted.
 */
export class GenericRestWorkspaceProvider {
  constructor ({ baseUrl, credentialStore, fetch = globalThis.fetch, timeoutMs = BOUNDS.REQUEST_TIMEOUT_MS, attempts = BOUNDS.MAX_ATTEMPTS } = {}) {
    if (!baseUrl || typeof baseUrl !== 'string') throw invalidRequest('generic-rest requires a baseUrl')
    if (!credentialStore || typeof credentialStore.get !== 'function' || typeof credentialStore.set !== 'function')
      throw invalidRequest('generic-rest requires an injected credential store')
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.credentialStore = credentialStore
    this.fetchImpl = fetch
    this.timeoutMs = timeoutMs
    this.attempts = attempts
    this.session = null // {token, session} once signed in
    this.authListeners = new Set()
    this.capsCache = null
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

  // ---- the one transport: build (frozen) → fetch (injected) → decode (frozen)
  async request (name, params = {}, { body, bytes } = {}) {
    const op = OPERATIONS[name]
    const token = op.auth ? (await this.loadSession())?.token : undefined
    const spec = buildRequest(name, params, { requestId: randomUUID(), token })
    const url = this.baseUrl + spec.url
    const payload = bytes ?? (body !== undefined ? JSON.stringify(body) : undefined)
    if (payload !== undefined && Buffer.byteLength(payload) > BOUNDS.MAX_RECORD_BYTES)
      throw invalidRequest('body exceeds the Wire v1 byte bound')

    let lastError = null
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      const signal = this.timeoutMs > 0 ? AbortSignal.timeout(this.timeoutMs) : undefined
      let res
      try {
        res = await this.fetchImpl(url, {
          method: spec.method,
          headers: { ...spec.headers, ...(payload !== undefined ? { 'content-type': op.req === MEDIA.BYTES ? MEDIA.BYTES : MEDIA.JSON } : {}) },
          body: payload,
          signal,
        })
      } catch (e) {
        lastError = new WorkspaceError('unavailable', 'request failed or timed out', { cause: e })
        if (attempt < this.attempts) { await sleep(100 * attempt); continue }
        throw lastError
      }
      if (res.status >= 200 && res.status < 300) return this.decodeSuccess(name, res)
      const text = await res.text().catch(() => '')
      if (isRetryableStatus(res.status) && attempt < this.attempts) { await sleep(100 * attempt); continue }
      throw decodeErrorBody(text, { requestId: spec.headers[HEADER.REQUEST_ID], token })
    }
    throw lastError ?? new WorkspaceError('unavailable', 'request failed')
  }

  async decodeSuccess (name, res) {
    const op = OPERATIONS[name]
    if (op.res === MEDIA.JSON) {
      const body = decodeJsonBody(await res.text())
      // GET record: the doc rides the body, the etag rides the ETag header.
      if (name === 'getRecord') return { doc: body, etag: headerOf(res.headers, HEADER.ETAG) }
      return body
    }
    if (op.res === MEDIA.BYTES) return Buffer.from(await res.arrayBuffer())
    return consumeListPage(res.headers, await res.text())
  }

  /** Raw escape hatch for conformance probes (cross-org replay, immutability). */
  rawRequest (name, params, opts) { return this.request(name, params, opts) }

  // ---- capabilities + sign-in dispatch (D34: render ONLY the declared kind)
  async capabilities () {
    if (!this.capsCache) this.capsCache = normalizeCapabilities(decodeCapabilities(await this.request('capabilities')))
    return { ...this.capsCache }
  }

  async signInInfo () {
    const caps = decodeCapabilities(await this.request('capabilities'))
    return caps.signIn
  }

  async signIn (method, credentials = {}) {
    const declared = await this.signInInfo()
    if (method !== declared.kind)
      throw invalidRequest('this backend declares a different sign-in flow: ' + declared.kind)
    // The issue body is provider-defined JSON (D34); the adapter carries the
    // caller's material through unchanged, adding only the method.
    const body = await this.request('authIssue', {}, { body: { method, ...credentials } })
    this.session = decodeSessionEnvelope(typeof body === 'string' ? body : JSON.stringify(body))
    await this.credentialStore.set(CREDENTIAL_HANDLE, this.session)
    this.emitAuth({ userId: this.session.session.id, expiresAt: this.session.session.expiresAt })
    return this.currentSession()
  }

  async refresh () {
    const token = await this.token()
    const body = await this.request('authRefresh', {}, { body: { token } })
    this.session = decodeSessionEnvelope(typeof body === 'string' ? body : JSON.stringify(body))
    await this.credentialStore.set(CREDENTIAL_HANDLE, this.session)
    return this.currentSession()
  }

  async signOut () {
    try { await this.request('authRevoke') } catch { /* a dead token is still signed out */ }
    this.session = null
    await this.credentialStore.delete?.(CREDENTIAL_HANDLE)
    this.emitAuth(null)
  }

  async currentSession () {
    const s = await this.loadSession()
    if (!s) return null
    const body = await this.request('authIntrospect', {}, { body: { token: s.token } })
    const intro = decodeIntrospection(typeof body === 'string' ? body : JSON.stringify(body))
    if (!intro.active) { this.session = null; return null }
    return { userId: intro.session.id }
  }

  // ---- orgs
  async createOrg ({ name, kind }) { return this.request('createOrg', {}, { body: { name, kind } }) }
  async getOrg (orgId) { return this.request('getOrg', { orgId }) }
  async listOrgs () { return (await this.request('listOrgs')).records }
  async updateOrg (orgId, patch) { return this.request('patchOrg', { orgId }, { body: patch }) }
  async archiveOrg (orgId) { return this.request('deleteOrg', { orgId }) }

  // ---- members
  async addMember (orgId, { email, role }) { return this.request('addMember', { orgId }, { body: { email, role } }) }
  async listMembers (orgId) { return (await this.request('listMembers', { orgId })).records }
  async setRole (orgId, memberId, role) { return this.request('patchMember', { orgId, memberId }, { body: { role } }) }
  async removeMember (orgId, memberId) { return this.request('removeMember', { orgId, memberId }) }

  // ---- records (If-Match optimistic concurrency rides the frozen headers)
  async putRecord (orgId, collection, id, doc, { etag } = {}) {
    const out = await this.request('putRecord', { orgId, collection, id, etag }, { body: doc })
    this.writeNotify(orgId, collection)
    return out
  }

  async getRecord (orgId, collection, id) {
    const { doc, etag } = await this.request('getRecord', { orgId, collection, id })
    return { id, doc, etag }
  }

  async listRecords (orgId, collection, { cursor, limit } = {}) {
    return this.request('listRecords', { orgId, collection, cursor, limit })
  }

  async deleteRecord (orgId, collection, id) {
    const out = await this.request('deleteRecord', { orgId, collection, id })
    this.writeNotify(orgId, collection)
    return out
  }

  // ---- audit (append + read only; no mutation route exists to call)
  async appendAudit (orgId, event) { return this.request('appendAudit', { orgId }, { body: event }) }
  async readAudit (orgId) { return (await this.request('readAudit', { orgId })).records }

  // ---- storage
  async putBlob (orgId, path, bytes) {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    await this.request('putBlob', { orgId, path }, { bytes: buf }) // res is BYTES media; the hash is ours
    return { sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length }
  }
  async getBlob (orgId, path) { return this.request('getBlob', { orgId, path }) }
  async deleteBlob (orgId, path) { return this.request('deleteBlob', { orgId, path }) }
  async signedUrl (orgId, path) { return this.request('signedUrl', { orgId, path }, { body: {} }) }

  // ---- realtime degradation: D35 adaptive polling over listRecords.
  // Delivery starts from an EMPTY snapshot, so the first poll delivers the
  // current page as `put` events (initial state) — no silent baseline pass to
  // race a write against; the poller coalesces overlapping polls.
  subscribe (orgId, collection, cb) {
    const key = orgId + ' ' + collection
    let prev = new Map()
    const poller = new AdaptivePoller({
      poll: async () => {
        const { records } = await this.listRecords(orgId, collection, { limit: BOUNDS.MAX_PAGE_LIMIT })
        const now = new Map(records.map((r) => [r.id, r]))
        for (const [id, rec] of now) {
          if (prev.get(id)?.etag !== rec.etag) cb({ type: 'put', id, doc: rec.doc })
        }
        for (const id of prev.keys()) if (!now.has(id)) cb({ type: 'delete', id })
        prev = new Map(now)
      },
    })
    poller.start()
    if (!this.pollers.has(key)) this.pollers.set(key, new Set())
    this.pollers.get(key).add(poller)
    return () => { poller.stop(); this.pollers.get(key)?.delete(poller) }
  }

  /** D35: every local write polls immediately, not on the next tick. */
  writeNotify (orgId, collection) {
    for (const p of this.pollers.get(orgId + ' ' + collection) ?? []) void p.notifyWrite()
  }

  track () {} // analytics: no-op sink
}
