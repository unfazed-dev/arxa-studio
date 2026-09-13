/**
 * LocalWorkspaceProvider (task 13 step 5) — the DEFAULT provider and the
 * local-first parity law made code: the same contract, the same conformance
 * kit, the same UX, with ZERO network, account, database, or environment
 * variable. What a free user with no backend runs.
 *
 * Storage (the account-mirror convention, §1 local table):
 *   <home>/workspace/<orgId>/org.json        atomic JSON document
 *   <home>/workspace/<orgId>/members.json    atomic JSON document
 *   <home>/workspace/<orgId>/<collection>/<id>.json   atomic JSON documents
 *   <home>/workspace/<orgId>/audit.jsonl     append-only JSONL
 *   <home>/workspace/<orgId>/storage/<path>  blobs
 * The workspace root and every org dir are mode 0700 — "equivalent security"
 * for a single-user store is the OS's own file permissions plus the fact that
 * nothing leaves the machine.
 */
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { BOUNDS, COLLECTIONS, ROLES } from './contract.js'
import { encodeCursor, decodeCursor } from './wire.js'
import { WorkspaceError, invalidRequest } from './errors.js'
import { LOCAL_CAPABILITIES } from './capabilities.js'

const LOCAL_USER_ID = 'local-operator'
const LOCAL_USER_EMAIL = 'operator@local.invalid'
const WORKSPACE_MODE = 0o700

let tmpCounter = 0

/** Atomic write: temp file in the same dir, then rename over the target. */
function writeAtomic (target, content) {
  tmpCounter += 1
  const tmp = join(dirname(target), `.ws-tmp-${process.pid}-${tmpCounter}`)
  writeFileSync(tmp, content)
  renameSync(tmp, target)
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const etagOf = (doc) => '"' + sha256(JSON.stringify(doc)).slice(0, 16) + '"'

const code = (c, message) => new WorkspaceError(c, message)
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

export class LocalWorkspaceProvider {
  constructor ({ home, root } = {}) {
    // ARXA_HOME is the launcher's own relocation convention (sandbox
    // verification), never a requirement: absent → ~/.arxa. `root` is the
    // §5 config override for the workspace directory itself.
    this.home = home ?? (process.env.ARXA_HOME?.trim() || join(homedir(), '.arxa'))
    this.root = root ?? join(this.home, 'workspace')
    this.userId = LOCAL_USER_ID
    this.authListeners = new Set()
    this.subscribers = new Map() // `${orgId} ${collection}` -> Set<cb>
  }

  capabilities () { return Promise.resolve({ ...LOCAL_CAPABILITIES }) }

  // ------------------------------------------------------------- auth
  // §1 local row: one user, the machine's operator. signIn/signOut are no-ops
  // that still fire onAuthStateChange; currentSession always returns it.
  async signIn () { this.emitAuth({ userId: this.userId, email: LOCAL_USER_EMAIL }) }
  async signOut () { this.emitAuth(null) }
  currentSession () { return Promise.resolve({ userId: this.userId, email: LOCAL_USER_EMAIL }) }
  onAuthStateChange (cb) {
    this.authListeners.add(cb)
    return () => this.authListeners.delete(cb)
  }
  emitAuth (ev) { for (const cb of this.authListeners) cb(ev) }

  // ------------------------------------------------------------- layout
  orgDir (orgId) {
    const dir = join(this.root, orgId)
    if (!existsSync(dir)) throw code('not_found', 'org not found')
    return dir
  }
  ensureOrgDir (orgId) {
    const dir = join(this.root, orgId)
    mkdirSync(dir, { recursive: true })
    chmodSync(dir, WORKSPACE_MODE)
    return dir
  }

  // ------------------------------------------------------------- orgs
  async createOrg ({ name, kind }) {
    mkdirSync(this.root, { recursive: true })
    chmodSync(this.root, WORKSPACE_MODE)
    const id = 'org-' + randomUUID().slice(0, 8)
    this.ensureOrgDir(id)
    const org = { id, name, kind: kind ?? 'studio', createdAt: new Date().toISOString() }
    writeAtomic(join(this.root, id, 'org.json'), JSON.stringify(org, null, 2) + '\n')
    writeAtomic(join(this.root, id, 'members.json'), JSON.stringify([{
      id: 'mem-' + randomUUID().slice(0, 8), userId: this.userId, email: LOCAL_USER_EMAIL,
      role: 'owner', status: 'active',
    }], null, 2) + '\n')
    return org
  }

  async getOrg (orgId) { return readJson(join(this.orgDir(orgId), 'org.json')) }

  async listOrgs () {
    if (!existsSync(this.root)) return []
    return readdirSync(this.root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(this.root, e.name, 'org.json')))
      .map((e) => readJson(join(this.root, e.name, 'org.json')))
  }

  async updateOrg (orgId, patch) {
    const file = join(this.orgDir(orgId), 'org.json')
    const org = { ...readJson(file), ...patch, id: orgId } // id is not patchable
    writeAtomic(file, JSON.stringify(org, null, 2) + '\n')
    return org
  }

  async archiveOrg (orgId) {
    this.orgDir(orgId)
    rmSync(join(this.root, orgId), { recursive: true, force: true })
    return { archived: true }
  }

  // ------------------------------------------------------------- members
  memberFile (orgId) { return join(this.orgDir(orgId), 'members.json') }
  readMembers (orgId) { return readJson(this.memberFile(orgId)) }

  actorRole (orgId, userId = this.userId) {
    return this.readMembers(orgId).find((m) => m.userId === userId)?.role
  }

  requireOwnerOrAdmin (orgId) {
    if (!['owner', 'admin'].includes(this.actorRole(orgId) ?? ''))
      throw code('forbidden', 'member management requires owner or admin')
  }

  async addMember (orgId, { email, role }) {
    if (!ROLES.includes(role)) throw invalidRequest('role must be one of: ' + ROLES.join(', '))
    this.requireOwnerOrAdmin(orgId)
    const file = this.memberFile(orgId)
    const members = this.readMembers(orgId)
    // Idempotent: re-adding the same email with the same role is a no-op.
    const existing = members.find((m) => m.email === email)
    if (existing) {
      if (existing.role !== role) throw code('conflict', 'member already exists with a different role')
      return existing
    }
    const member = { id: 'mem-' + randomUUID().slice(0, 8), userId: 'user-' + randomUUID().slice(0, 8), email, role, status: 'invited' }
    writeAtomic(file, JSON.stringify([...members, member], null, 2) + '\n')
    return member
  }

  async listMembers (orgId) { return this.readMembers(orgId) }

  async setRole (orgId, memberId, role) {
    if (!ROLES.includes(role)) throw invalidRequest('role must be one of: ' + ROLES.join(', '))
    this.requireOwnerOrAdmin(orgId)
    const file = this.memberFile(orgId)
    const members = this.readMembers(orgId)
    const m = members.find((x) => x.id === memberId)
    if (!m) throw code('not_found', 'member not found')
    if (m.role === 'owner' && role !== 'owner' && members.filter((x) => x.role === 'owner').length === 1)
      throw code('forbidden', 'the last owner cannot be demoted')
    m.role = role
    writeAtomic(file, JSON.stringify(members, null, 2) + '\n')
    return m
  }

  async removeMember (orgId, memberId) {
    this.requireOwnerOrAdmin(orgId)
    const file = this.memberFile(orgId)
    const members = this.readMembers(orgId)
    const m = members.find((x) => x.id === memberId)
    if (!m) throw code('not_found', 'member not found')
    if (m.role === 'owner' && members.filter((x) => x.role === 'owner').length === 1)
      throw code('forbidden', 'the last owner cannot be removed')
    writeAtomic(file, JSON.stringify(members.filter((x) => x.id !== memberId), null, 2) + '\n')
    return { removed: true }
  }

  // ------------------------------------------------------------- records
  recordFile (orgId, collection, id) {
    if (!COLLECTIONS.includes(collection)) throw invalidRequest('collection is not part of the fixed Wire v1 collection list')
    return join(this.orgDir(orgId), collection, encodeURIComponent(id) + '.json')
  }

  async putRecord (orgId, collection, id, doc, { etag } = {}) {
    const file = this.recordFile(orgId, collection, id)
    let prev = null
    if (existsSync(file)) prev = readJson(file)
    if (etag !== undefined && (!prev || prev.etag !== etag))
      throw code('conflict', 'etag mismatch — the record changed since it was read')
    const next = { etag: etagOf(doc), doc, updatedAt: new Date().toISOString() }
    mkdirSync(dirname(file), { recursive: true })
    writeAtomic(file, JSON.stringify(next, null, 2) + '\n')
    this.emit(orgId, collection, { type: 'put', id, doc })
    return { id, etag: next.etag }
  }

  async getRecord (orgId, collection, id) {
    const file = this.recordFile(orgId, collection, id)
    if (!existsSync(file)) throw code('not_found', 'record not found')
    const { etag, doc } = readJson(file)
    return { id, etag, doc }
  }

  async listRecords (orgId, collection, { cursor, limit = BOUNDS.DEFAULT_PAGE_LIMIT } = {}) {
    const dir = join(this.orgDir(orgId), collection)
    if (!Number.isInteger(limit) || limit < 1 || limit > BOUNDS.MAX_PAGE_LIMIT)
      throw invalidRequest('limit must be an integer between 1 and MAX_PAGE_LIMIT')
    const offset = cursor ? decodeCursor(cursor).offset ?? 0 : 0
    const ids = existsSync(dir)
      ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => decodeURIComponent(f.slice(0, -5))).sort()
      : []
    const page = ids.slice(offset, offset + limit)
    const records = page.map((id) => {
      const { etag, doc } = readJson(join(dir, encodeURIComponent(id) + '.json'))
      return { id, etag, doc }
    })
    const nextCursor = offset + limit < ids.length ? encodeCursor({ offset: offset + limit }) : null
    return { records, nextCursor }
  }

  async deleteRecord (orgId, collection, id) {
    const file = this.recordFile(orgId, collection, id)
    if (!existsSync(file)) throw code('not_found', 'record not found')
    rmSync(file, { force: true })
    this.emit(orgId, collection, { type: 'delete', id })
    return { deleted: true }
  }

  // ------------------------------------------------------------- audit
  // Append-only by construction: the ONLY method, an append to a JSONL file.
  // No update/delete exists at any layer — the wire has no mutation route and
  // the interface has no mutation method.
  async appendAudit (orgId, event) {
    const dir = this.orgDir(orgId)
    const line = JSON.stringify({ at: new Date().toISOString(), actor: this.userId, ...event })
    appendFileSync(join(dir, 'audit.jsonl'), line + '\n')
    return { appended: true }
  }

  async readAudit (orgId) {
    const file = join(this.orgDir(orgId), 'audit.jsonl')
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  }

  // ------------------------------------------------------------- storage
  blobPath (orgId, path) {
    const segs = Array.isArray(path) ? path : String(path).split('/')
    if (segs.some((s) => s === '' || s === '.' || s === '..')) throw invalidRequest('blob path is not a plain path')
    return join(this.orgDir(orgId), 'storage', ...segs)
  }

  async putBlob (orgId, path, bytes) {
    const file = this.blobPath(orgId, path)
    mkdirSync(dirname(file), { recursive: true })
    writeAtomic(file, bytes)
    return { sha256: sha256(bytes), bytes: bytes.length }
  }

  async getBlob (orgId, path) {
    const file = this.blobPath(orgId, path)
    if (!existsSync(file)) throw code('not_found', 'blob not found')
    return readFileSync(file)
  }

  async deleteBlob (orgId, path) {
    const file = this.blobPath(orgId, path)
    if (!existsSync(file)) throw code('not_found', 'blob not found')
    rmSync(file, { force: true })
    return { deleted: true }
  }

  // §1: local signedUrl returns a file: URL.
  signedUrl (orgId, path) {
    this.blobPath(orgId, path) // validate org + path
    return Promise.resolve({ url: 'file://' + this.blobPath(orgId, path), mode: 'local' })
  }

  /** Blob enumeration for export (local-only: the wire has no list route). */
  listBlobs (orgId) {
    const dir = join(this.orgDir(orgId), 'storage')
    const out = []
    const walk = (rel, d) => {
      if (!existsSync(d)) return
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk([...rel, e.name], join(d, e.name))
        else out.push([...rel, e.name].join('/'))
      }
    }
    walk([], dir)
    return Promise.resolve(out)
  }

  // ------------------------------------------------------------- realtime
  // In-process emitter — strictly better than the polling degradation.
  subscribe (orgId, collection, cb) {
    const key = orgId + ' ' + collection
    let set = this.subscribers.get(key)
    if (!set) { set = new Set(); this.subscribers.set(key, set) }
    set.add(cb)
    return () => set.delete(cb)
  }
  emit (orgId, collection, event) {
    for (const cb of this.subscribers.get(orgId + ' ' + collection) ?? []) cb(event)
  }

  // ------------------------------------------------------------- analytics
  // No-op sink: nothing user-visible, so nothing is advertised.
  track () {}
}
