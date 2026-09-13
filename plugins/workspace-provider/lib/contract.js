/**
 * Wire v1 — the frozen workspace-provider protocol (task 13 step 3, D32–D35).
 *
 * This module is CONSTANTS plus a pure request builder. It performs no I/O.
 * The golden suite selftest.contract.mjs pins every value here character for
 * character: any change is a wire change and requires a new protocol version.
 * The providers and the generic-REST adapter (part B) implement against this
 * file; they may not invent routes, verbs, codes, or bounds.
 */
import { randomUUID } from 'node:crypto'
import { invalidRequest } from './errors.js'
import { decodeCursor } from './wire.js' // cycle is call-time only; both modules finish evaluating first

export const WIRE_VERSION = 1
export const BASE_PATH = '/arxa-workspace/v1'

export const HEADER = Object.freeze({
  VERSION: 'X-Arxa-Workspace-Version',
  REQUEST_ID: 'X-Request-Id',
  AUTHORIZATION: 'Authorization',
  NEXT_CURSOR: 'X-Arxa-Cursor-Next', // JSONL list pages: body stays pure records, the resume cursor rides the header
  ETAG: 'ETag',
  IF_MATCH: 'If-Match',
})

export const MEDIA = Object.freeze({
  JSON: 'application/json', // bounded singletons: orgs, members, records by id, auth envelopes, errors
  NDJSON: 'application/x-ndjson', // streams: org/member/record/audit/event lists
  BYTES: 'application/octet-stream', // storage blobs
})

// D32: the fixed provider set. `custom` does not exist; a BYO backend is a
// server implementing Wire v1, reached through `generic-rest`.
export const PROVIDERS = Object.freeze(['local', 'supabase', 'generic-rest'])

export const ROLES = Object.freeze(['owner', 'admin', 'billing', 'member'])

// The fixed §1 collection list (source plan §1 "records"). Providers may not
// add collections; unknown names are rejected before any I/O.
export const COLLECTIONS = Object.freeze([
  'tickets', 'ticket_messages', 'chat_conversations', 'chat_messages',
  'feedback', 'requirements', 'user_prefs',
])

// D34: token-opaque identity. The wire carries only the session-token
// lifecycle; how a user authenticates is the provider's business, declared
// here and rendered by exactly one studio flow.
export const SIGN_IN_KINDS = Object.freeze(['email-form', 'browser', 'device-code', 'token'])

export const CAPABILITY_KEYS = Object.freeze(
  ['auth', 'orgs', 'records', 'audit', 'realtime', 'storage', 'analytics'])

// The complete typed error set. `invalid_request` covers contract violations
// (bad cursor, oversized body, unknown collection); `unsupported_version` is
// what a conforming server returns for an unknown X-Arxa-Workspace-Version.
export const ERROR_CODES = Object.freeze([
  'unsupported_version', 'invalid_request', 'unauthenticated', 'forbidden',
  'not_found', 'conflict', 'unavailable',
])

export const BOUNDS = Object.freeze({
  DEFAULT_PAGE_LIMIT: 100,
  MAX_PAGE_LIMIT: 500,
  MAX_RECORD_BYTES: 1_048_576, // 1 MiB — one JSON document / bounded request body
  MAX_JSONL_BYTES: 33_554_432, // 32 MiB — one decoded JSONL page or stream
  MAX_BLOB_BYTES: 1_073_741_824, // 1 GiB — one storage blob
  REQUEST_TIMEOUT_MS: 15_000,
  MAX_ATTEMPTS: 3, // bounded retries on the retryable status set below
  RETRYABLE_STATUSES: Object.freeze([408, 425, 429, 500, 502, 503, 504]),
})

// D35: adaptive polling when realtime is absent. Contract constants, not
// provider hints.
export const POLLING = Object.freeze({
  ACTIVE_MS: 3000, // focused-and-active (thread/composer open)
  IDLE_MS: 30000, // focused-idle
  BACKGROUND_MS: 120000, // app in background
  IMMEDIATE_AFTER_WRITE: true, // poll immediately after any local write
})

// req/res media: J = bounded JSON, L = JSONL stream, B = raw bytes.
// `auth` = requires Authorization: Bearer. `query` = accepted query params.
// `optional` = a capability a provider may not implement.
const J = MEDIA.JSON, L = MEDIA.NDJSON, B = MEDIA.BYTES
export const OPERATIONS = Object.freeze({
  capabilities:   { method: 'GET',    path: '/capabilities', req: null, res: J, auth: false },
  // Token lifecycle (D34). issue/refresh/introspect carry their material in
  // the body; revoke revokes the bearer itself.
  authIssue:      { method: 'POST',   path: '/auth/issue', req: J, res: J, auth: false },
  authRefresh:    { method: 'POST',   path: '/auth/refresh', req: J, res: J, auth: false },
  authRevoke:     { method: 'POST',   path: '/auth/revoke', req: J, res: J, auth: true },
  authIntrospect: { method: 'POST',   path: '/auth/introspect', req: J, res: J, auth: false },
  listOrgs:       { method: 'GET',    path: '/orgs', req: null, res: L, auth: true },
  createOrg:      { method: 'POST',   path: '/orgs', req: J, res: J, auth: true },
  getOrg:         { method: 'GET',    path: '/orgs/{orgId}', req: null, res: J, auth: true },
  patchOrg:       { method: 'PATCH',  path: '/orgs/{orgId}', req: J, res: J, auth: true },
  deleteOrg:      { method: 'DELETE', path: '/orgs/{orgId}', req: null, res: J, auth: true },
  listMembers:    { method: 'GET',    path: '/orgs/{orgId}/members', req: null, res: L, auth: true },
  addMember:      { method: 'POST',   path: '/orgs/{orgId}/members', req: J, res: J, auth: true },
  patchMember:    { method: 'PATCH',  path: '/orgs/{orgId}/members/{memberId}', req: J, res: J, auth: true },
  removeMember:   { method: 'DELETE', path: '/orgs/{orgId}/members/{memberId}', req: null, res: J, auth: true },
  listRecords:    { method: 'GET',    path: '/orgs/{orgId}/records/{collection}', req: null, res: L, auth: true, query: Object.freeze(['cursor', 'limit']) },
  getRecord:      { method: 'GET',    path: '/orgs/{orgId}/records/{collection}/{id}', req: null, res: J, auth: true },
  putRecord:      { method: 'PUT',    path: '/orgs/{orgId}/records/{collection}/{id}', req: J, res: J, auth: true },
  deleteRecord:   { method: 'DELETE', path: '/orgs/{orgId}/records/{collection}/{id}', req: null, res: J, auth: true },
  // Audit: append + read only. There is deliberately no mutation route.
  appendAudit:    { method: 'POST',   path: '/orgs/{orgId}/audit', req: J, res: J, auth: true },
  readAudit:      { method: 'GET',    path: '/orgs/{orgId}/audit', req: null, res: L, auth: true },
  putBlob:        { method: 'PUT',    path: '/orgs/{orgId}/storage/{path}', req: B, res: B, auth: true },
  getBlob:        { method: 'GET',    path: '/orgs/{orgId}/storage/{path}', req: null, res: B, auth: true },
  deleteBlob:     { method: 'DELETE', path: '/orgs/{orgId}/storage/{path}', req: null, res: J, auth: true },
  signedUrl:      { method: 'POST',   path: '/orgs/{orgId}/storage/{path}/signed-url', req: J, res: J, auth: true },
  events:         { method: 'GET',    path: '/orgs/{orgId}/events', req: null, res: L, auth: true, optional: true, query: Object.freeze(['cursor']) },
})

// Path segments that must be filled from params. `{path}` is multi-segment
// (an array or a '/'-joined string) — everything else is a single segment.
const PATH_PARAMS = /\{(\w+)\}/g

/**
 * Pure request builder — the only way a Wire v1 request spec exists. Throws
 * WorkspaceError('invalid_request') for every contract violation (unknown
 * collection, bad limit, undecodable cursor) BEFORE any request can be sent.
 */
export function buildRequest (name, params = {}, context = {}) {
  const op = OPERATIONS[name]
  if (!op) throw new Error('unknown operation: ' + name) // programming error, not a wire error

  if (op.path.includes('{collection}')) {
    if (!COLLECTIONS.includes(params.collection))
      throw invalidRequest('collection is not part of the fixed Wire v1 collection list')
  }

  let path = op.path.replace(PATH_PARAMS, (_, key) => {
    const v = params[key]
    if (v === undefined) throw invalidRequest('missing path parameter: ' + key)
    // {path} is multi-segment: an array of segments, or a '/'-joined string.
    const segs = Array.isArray(v) ? v.map(String)
      : key === 'path' ? String(v).split('/')
        : [String(v)]
    return segs.map((s) => encodeURIComponent(s)).join('/')
  })

  const query = []
  if (op.query) {
    for (const key of op.query) {
      if (key === 'limit') {
        const limit = params.limit ?? BOUNDS.DEFAULT_PAGE_LIMIT
        if (!Number.isInteger(limit) || limit < 1 || limit > BOUNDS.MAX_PAGE_LIMIT)
          throw invalidRequest('limit must be an integer between 1 and MAX_PAGE_LIMIT')
        query.push('limit=' + limit)
      } else if (params[key] !== undefined) {
        if (key === 'cursor') decodeCursor(params[key]) // undecodable cursor dies HERE, before I/O
        query.push(key + '=' + encodeURIComponent(params[key]))
      }
    }
  }
  if (query.length) path += '?' + query.join('&')

  const headers = {
    [HEADER.VERSION]: String(WIRE_VERSION),
    [HEADER.REQUEST_ID]: context.requestId ?? randomUUID(),
  }
  if (op.auth && context.token !== undefined) headers[HEADER.AUTHORIZATION] = 'Bearer ' + context.token
  if (params.etag !== undefined) headers[HEADER.IF_MATCH] = params.etag

  return { method: op.method, url: BASE_PATH + path, headers, media: op.res, signal: context.signal }
}

const looksLikeCode = (v) =>
  typeof v === 'string' &&
  (/^\.{0,2}\//.test(v) || /\.(mjs|cjs|js|ts|json)\b/.test(v) ||
    /\brequire\s*\(/.test(v) || /\bimport\s*\(/.test(v))

/**
 * D32 guard: config may select one of three fixed providers and set their
 * endpoints — nothing else. It may never name executable code, so any
 * adapter key or module/file-path value is rejected at load. An empty config
 * is valid and means `local` (zero-config, local-first parity).
 */
export function assertProviderConfig (config = {}) {
  const provider = config.provider ?? 'local'
  if (!PROVIDERS.includes(provider))
    throw invalidRequest('workspaceBackend.provider must be one of: ' + PROVIDERS.join(', ') + ' — config cannot name executable code')
  for (const [key, value] of Object.entries(config)) {
    if (key === 'adapter')
      throw invalidRequest('workspaceBackend.adapter is invalid — config cannot name executable code (D32)')
    if (looksLikeCode(value))
      throw invalidRequest('workspaceBackend.' + key + ' names executable code — invalid under D32')
    if (value && typeof value === 'object')
      for (const [k2, v2] of Object.entries(value)) {
        if (k2 === 'adapter')
          throw invalidRequest('workspaceBackend adapter key is invalid — config cannot name executable code (D32)')
        if (looksLikeCode(v2))
          throw invalidRequest('workspaceBackend.' + key + '.' + k2 + ' names executable code — invalid under D32')
      }
  }
}
