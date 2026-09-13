/**
 * Wire v1 FREEZE (task 13 step 2, D32–D35). Golden tests pinning the
 * workspace-provider protocol exactly: routes, verbs, headers, media types,
 * envelopes, bounds, pagination, token lifecycle, capability-driven sign-in
 * dispatch, error taxonomy, abort signals, request IDs, and the rule that
 * config cannot name executable code.
 *
 * Any change to anything asserted here is a wire change and requires a NEW
 * PROTOCOL VERSION. This file is the contract's executable form; part B
 * (providers, REST adapter, conformance kit) implements against it.
 */
import { strict as assert } from 'node:assert'
import * as contract from './lib/contract.js'
import { WorkspaceError } from './lib/errors.js'
import * as wire from './lib/wire.js'
// Part B pins (checkpoint obligations): the token/session RESPONSE envelope and
// the X-Arxa-Cursor-Next consume semantics. Part A pinned the REQUEST side
// (routes, headers, codecs); these two sections pin the response decodes the
// adapters build on. Same freeze rule: any change here is a wire change.
import { consumeListPage, decodeIntrospection, decodeSessionEnvelope } from './lib/generic-rest.js'

let n = 0; const ok = (s) => { n++; console.log('  ok ' + s) }
const throwsCode = (code, fn) => {
  try { fn() } catch (e) {
    assert.ok(e instanceof WorkspaceError, 'typed WorkspaceError, got ' + e)
    assert.equal(e.code, code, `code ${code}, got ${e.code}`)
    return e
  }
  assert.fail('expected WorkspaceError ' + code + ', nothing thrown')
}
const TOKEN = 'opaque-secret-token-do-not-print-in-real-life'

// ---------------------------------------------- 1. frozen scalar constants
{
  assert.equal(contract.WIRE_VERSION, 1)
  assert.equal(contract.BASE_PATH, '/arxa-workspace/v1')
  assert.equal(contract.HEADER.VERSION, 'X-Arxa-Workspace-Version')
  assert.equal(contract.HEADER.REQUEST_ID, 'X-Request-Id')
  assert.equal(contract.HEADER.AUTHORIZATION, 'Authorization')
  assert.equal(contract.HEADER.ETAG, 'ETag')
  assert.equal(contract.HEADER.IF_MATCH, 'If-Match')
  assert.equal(contract.HEADER.NEXT_CURSOR, 'X-Arxa-Cursor-Next')
  assert.equal(contract.MEDIA.JSON, 'application/json')
  assert.equal(contract.MEDIA.NDJSON, 'application/x-ndjson')
  assert.equal(contract.MEDIA.BYTES, 'application/octet-stream')
  assert.deepEqual(contract.PROVIDERS, ['local', 'supabase', 'generic-rest'])
  assert.deepEqual(contract.ROLES, ['owner', 'admin', 'billing', 'member'])
  // The fixed §1 collection list — anything else is rejected before I/O.
  assert.deepEqual(contract.COLLECTIONS, [
    'tickets', 'ticket_messages', 'chat_conversations', 'chat_messages',
    'feedback', 'requirements', 'user_prefs',
  ])
  assert.deepEqual(contract.SIGN_IN_KINDS, ['email-form', 'browser', 'device-code', 'token'])
  // Token-opaque identity (D34): auth lifecycle is issue/refresh/revoke/introspect;
  // email/password is NOT a sign-in kind, NOT a wire concept.
  assert.ok(!contract.SIGN_IN_KINDS.includes('email+password'))
  assert.deepEqual(contract.CAPABILITY_KEYS,
    ['auth', 'orgs', 'records', 'audit', 'realtime', 'storage', 'analytics'])
  ok('scalars: version, base path, headers, media types, providers, roles, collections, sign-in kinds, capabilities')
}

// ---------------------------------------------- 2. bounds + polling (D35, D9)
{
  assert.deepEqual(contract.BOUNDS, {
    DEFAULT_PAGE_LIMIT: 100,
    MAX_PAGE_LIMIT: 500,
    MAX_RECORD_BYTES: 1_048_576,       // 1 MiB per JSON document / bounded body
    MAX_JSONL_BYTES: 33_554_432,       // 32 MiB per decoded JSONL page/stream
    MAX_BLOB_BYTES: 1_073_741_824,     // 1 GiB per storage blob
    REQUEST_TIMEOUT_MS: 15_000,
    MAX_ATTEMPTS: 3,
    RETRYABLE_STATUSES: [408, 425, 429, 500, 502, 503, 504],
  })
  assert.deepEqual(contract.POLLING, {
    ACTIVE_MS: 3000, IDLE_MS: 30000, BACKGROUND_MS: 120000,
    IMMEDIATE_AFTER_WRITE: true,
  })
  ok('bounds: page limits, body/blob/stream caps, timeout, retries, retryable statuses; D35 polling 3s/30s/120s + immediate-after-write')
}

// ---------------------------------------------- 3. THE route table (verbatim)
// Every route, verb, media type, auth requirement, query param. This object
// literal IS the Wire v1 table from the task brief, character for character.
{
  const J = 'application/json', L = 'application/x-ndjson', B = 'application/octet-stream'
  assert.deepEqual(contract.OPERATIONS, {
    capabilities:  { method: 'GET',    path: '/capabilities', req: null, res: J, auth: false },
    authIssue:     { method: 'POST',   path: '/auth/issue', req: J, res: J, auth: false },
    authRefresh:   { method: 'POST',   path: '/auth/refresh', req: J, res: J, auth: false },
    authRevoke:    { method: 'POST',   path: '/auth/revoke', req: J, res: J, auth: true },
    authIntrospect:{ method: 'POST',   path: '/auth/introspect', req: J, res: J, auth: false },
    listOrgs:      { method: 'GET',    path: '/orgs', req: null, res: L, auth: true },
    createOrg:     { method: 'POST',   path: '/orgs', req: J, res: J, auth: true },
    getOrg:        { method: 'GET',    path: '/orgs/{orgId}', req: null, res: J, auth: true },
    patchOrg:      { method: 'PATCH',  path: '/orgs/{orgId}', req: J, res: J, auth: true },
    deleteOrg:     { method: 'DELETE', path: '/orgs/{orgId}', req: null, res: J, auth: true },
    listMembers:   { method: 'GET',    path: '/orgs/{orgId}/members', req: null, res: L, auth: true },
    addMember:     { method: 'POST',   path: '/orgs/{orgId}/members', req: J, res: J, auth: true },
    patchMember:   { method: 'PATCH',  path: '/orgs/{orgId}/members/{memberId}', req: J, res: J, auth: true },
    removeMember:  { method: 'DELETE', path: '/orgs/{orgId}/members/{memberId}', req: null, res: J, auth: true },
    listRecords:   { method: 'GET',    path: '/orgs/{orgId}/records/{collection}', req: null, res: L, auth: true, query: ['cursor', 'limit'] },
    getRecord:     { method: 'GET',    path: '/orgs/{orgId}/records/{collection}/{id}', req: null, res: J, auth: true },
    putRecord:     { method: 'PUT',    path: '/orgs/{orgId}/records/{collection}/{id}', req: J, res: J, auth: true },
    deleteRecord:  { method: 'DELETE', path: '/orgs/{orgId}/records/{collection}/{id}', req: null, res: J, auth: true },
    appendAudit:   { method: 'POST',   path: '/orgs/{orgId}/audit', req: J, res: J, auth: true },
    readAudit:     { method: 'GET',    path: '/orgs/{orgId}/audit', req: null, res: L, auth: true },
    putBlob:       { method: 'PUT',    path: '/orgs/{orgId}/storage/{path}', req: B, res: B, auth: true },
    getBlob:       { method: 'GET',    path: '/orgs/{orgId}/storage/{path}', req: null, res: B, auth: true },
    deleteBlob:    { method: 'DELETE', path: '/orgs/{orgId}/storage/{path}', req: null, res: J, auth: true },
    signedUrl:     { method: 'POST',   path: '/orgs/{orgId}/storage/{path}/signed-url', req: J, res: J, auth: true },
    events:        { method: 'GET',    path: '/orgs/{orgId}/events', req: null, res: L, auth: true, optional: true, query: ['cursor'] },
  })
  // Audit immutability at the route level: NO mutation route on audit exists.
  const auditRoutes = Object.values(contract.OPERATIONS)
    .filter((o) => o.path.includes('/audit') && ['PUT', 'PATCH', 'DELETE'].includes(o.method))
  assert.equal(auditRoutes.length, 0, 'no audit mutation route may exist')
  ok('OPERATIONS table: 25 routes verbatim; audit has append+read only')
}

// ---------------------------------------------- 4. request building: headers, ids, abort, token
{
  const signal = new AbortController().signal
  const r = contract.buildRequest('listRecords',
    { orgId: 'org-1', collection: 'tickets', limit: 25 },
    { requestId: 'req-abc', token: TOKEN, signal })
  assert.equal(r.method, 'GET')
  assert.equal(r.url, '/arxa-workspace/v1/orgs/org-1/records/tickets?limit=25')
  assert.equal(r.headers[contract.HEADER.VERSION], '1')
  assert.equal(r.headers[contract.HEADER.REQUEST_ID], 'req-abc')
  assert.equal(r.headers[contract.HEADER.AUTHORIZATION], 'Bearer ' + TOKEN)
  assert.equal(r.signal, signal, 'abort signal forwarded untouched')
  assert.equal(r.media, contract.MEDIA.NDJSON)
  // Fresh request ID minted when the caller supplies none, and it is a UUID.
  const a = contract.buildRequest('capabilities', {}, {})
  const b = contract.buildRequest('capabilities', {}, {})
  assert.notEqual(a.headers[contract.HEADER.REQUEST_ID], b.headers[contract.HEADER.REQUEST_ID])
  assert.match(a.headers[contract.HEADER.REQUEST_ID], /^[0-9a-f-]{36}$/)
  // capabilities carries no bearer token even if one is in context
  const caps = contract.buildRequest('capabilities', {}, { token: TOKEN })
  assert.equal(contract.HEADER.AUTHORIZATION in caps.headers, false)
  // path segments are URI-encoded; blob paths keep their slashes
  const blob = contract.buildRequest('putBlob', { orgId: 'org 1', path: ['a b', 'c.png'] }, {})
  assert.equal(blob.url, '/arxa-workspace/v1/orgs/org%201/storage/a%20b/c.png')
  // ETag optimistic concurrency: PUT carries If-Match when an etag is supplied
  const put = contract.buildRequest('putRecord',
    { orgId: 'o', collection: 'feedback', id: 'r1', etag: 'W/"1"' }, {})
  assert.equal(put.headers[contract.HEADER.IF_MATCH], 'W/"1"')
  assert.equal(put.media, contract.MEDIA.JSON)
  ok('buildRequest: version+request-id headers, bearer on auth routes only, fresh UUID ids, abort passthrough, URI encoding, If-Match')
}

// ---------------------------------------------- 5. reject BEFORE I/O
{
  // Unknown collection: throws at build time — no request exists to send.
  let built = null
  try { built = contract.buildRequest('listRecords', { orgId: 'o', collection: 'passwords' }, {}) }
  catch (e) { assert.ok(e instanceof WorkspaceError); assert.equal(e.code, 'invalid_request') }
  assert.equal(built, null, 'no request spec may escape an unknown collection')
  // Unknown operation name is a programming error, not a wire error
  assert.throws(() => contract.buildRequest('dropTable', {}), /unknown operation/)
  // Unknown version: the typed code exists and decodes (server side of the
  // contract returns it; client side surfaces it).
  const e = wire.decodeErrorBody(JSON.stringify({
    error: { code: 'unsupported_version', message: 'wire version 2 not supported', retryable: false, requestId: 'rq-1' },
  }), {})
  assert.ok(e instanceof WorkspaceError)
  assert.equal(e.code, 'unsupported_version')
  assert.equal(e.retryable, false)
  ok('pre-I/O guards: unknown collection rejected at build; unsupported_version is a typed code')
}

// ---------------------------------------------- 6. pagination
{
  // default limit applied when omitted
  const d = contract.buildRequest('listRecords', { orgId: 'o', collection: 'tickets' }, {})
  assert.equal(d.url, '/arxa-workspace/v1/orgs/o/records/tickets?limit=100')
  // over-max, zero, negative, non-integer all rejected before I/O
  for (const limit of [501, 0, -1, 2.5, 'many'])
    throwsCode('invalid_request', () => contract.buildRequest('listRecords', { orgId: 'o', collection: 'tickets', limit }, {}))
  // cursor must decode; a garbage cursor is rejected before I/O
  throwsCode('invalid_request', () => contract.buildRequest('listRecords', { orgId: 'o', collection: 'tickets', cursor: '%%%not-base64%%%' }, {}))
  const c = contract.buildRequest('listRecords',
    { orgId: 'o', collection: 'tickets', cursor: wire.encodeCursor({ offset: 100 }) }, {})
  assert.match(c.url, /cursor=[^&]+&limit=100$/)
  ok('pagination: default 100, limit bounds validated pre-I/O, opaque cursor required valid')
}

// ---------------------------------------------- 7. cursor codec
{
  const cur = wire.encodeCursor({ v: 1, offset: 40, collection: 'tickets' })
  assert.equal(typeof cur, 'string')
  assert.ok(!cur.includes(' '), 'cursor is URL-safe')
  assert.deepEqual(wire.decodeCursor(cur), { v: 1, offset: 40, collection: 'tickets' })
  // malformed / wrong-version cursors are invalid_request, never a crash
  throwsCode('invalid_request', () => wire.decodeCursor('nonsense'))
  throwsCode('invalid_request', () => wire.decodeCursor(wire.encodeCursor({ v: 2 })))
  ok('cursor: base64url JSON round-trip; malformed and v!=1 rejected')
}

// ---------------------------------------------- 8. JSON + JSONL codecs with bounds
{
  const body = wire.encodeJsonBody({ id: 'r1', title: 'x' })
  assert.deepEqual(wire.decodeJsonBody(body), { id: 'r1', title: 'x' })
  throwsCode('invalid_request', () => wire.encodeJsonBody({ big: 'x'.repeat(1_048_577) }))
  throwsCode('invalid_request', () => wire.decodeJsonBody('{"broken"'))
  // JSONL: one JSON object per line, trailing newline allowed, junk rejected
  const text = wire.encodeJsonl([{ id: 'a' }, { id: 'b' }])
  assert.deepEqual(wire.decodeJsonl(text), [{ id: 'a' }, { id: 'b' }])
  // encodeJsonl's own trailing newline is legal (covered above); ONE blank
  // line — a double newline mid-stream or at the end — is not a record.
  assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), 'encoded stream ends with exactly one newline')
  throwsCode('invalid_request', () => wire.decodeJsonl(text + '\n'), 'a second trailing newline is a blank line')
  throwsCode('invalid_request', () => wire.decodeJsonl('{"id":"a"}\nnot-json'))
  throwsCode('invalid_request', () => wire.decodeJsonl('{"id":"a"}\n\n{"id":"b"}'), 'blank line is not a record')
  throwsCode('invalid_request', () => wire.decodeJsonl('x'.repeat(33_554_433)))
  ok('codecs: bounded JSON singleton encode/decode; strict JSONL with byte cap')
}

// ---------------------------------------------- 9. error taxonomy
{
  assert.deepEqual(contract.ERROR_CODES, [
    'unsupported_version', 'invalid_request', 'unauthenticated', 'forbidden',
    'not_found', 'conflict', 'unavailable',
  ])
  // full envelope, request-id echo and fallback to the caller's id
  const e1 = wire.decodeErrorBody(
    JSON.stringify({ error: { code: 'conflict', message: 'etag mismatch', retryable: false, requestId: 'srv-9' } }),
    { requestId: 'cli-1' })
  assert.equal(e1.code, 'conflict'); assert.equal(e1.requestId, 'srv-9')
  const e2 = wire.decodeErrorBody(
    JSON.stringify({ error: { code: 'unavailable', message: 'overloaded', retryable: true } }),
    { requestId: 'cli-1' })
  assert.equal(e2.requestId, 'cli-1', 'envelope requestId absent -> caller request id')
  assert.equal(e2.retryable, true)
  // malformed envelope is itself invalid_request, never a raw parse crash
  throwsCode('invalid_request', () => wire.decodeErrorBody('{"oops":true', {}))
  throwsCode('invalid_request', () => wire.decodeErrorBody('{"no":"error key"}', {}))
  // unknown server code maps to unavailable with the server's code preserved
  const e3 = wire.decodeErrorBody(JSON.stringify({ error: { code: 'teapot', message: 'brewing', retryable: false, requestId: 'r' } }), {})
  assert.equal(e3.code, 'unavailable'); assert.equal(e3.serverCode, 'teapot')
  // retryable status set is the frozen set
  for (const s of [408, 425, 429, 500, 502, 503, 504]) assert.equal(wire.isRetryableStatus(s), true)
  for (const s of [400, 401, 403, 404, 409, 422]) assert.equal(wire.isRetryableStatus(s), false)
  ok('errors: 7 typed codes, envelope shape, requestId echo/fallback, unknown->unavailable+serverCode, retryable set')
}

// ---------------------------------------------- 10. no secrets in messages
{
  // Every error our codecs/builders raise is a fixed literal; neither the
  // bearer token nor hostile payload values may leak into .message.
  let leaked = null
  try { contract.buildRequest('listRecords', { orgId: 'o', collection: TOKEN }, {}) } catch (e) { leaked = e }
  assert.ok(leaked && !leaked.message.includes(TOKEN), 'builder errors never echo values')
  const hostile = wire.decodeErrorBody(JSON.stringify({
    error: { code: 'unauthenticated', message: 'bad token ' + TOKEN, retryable: false, requestId: 'r' },
  }), { token: TOKEN })
  // The server's message is the SERVER's; our envelope fields stay clean, and
  // any occurrence of the session token in a surfaced message is redacted.
  assert.ok(!hostile.message.includes(TOKEN), 'the session token is redacted from surfaced messages')
  assert.ok(hostile.message.length > 0)
  ok('secrecy: token never appears in any client-produced or client-surfaced error message')
}

// ---------------------------------------------- 11. capabilities + sign-in dispatch (D34)
{
  const caps = wire.decodeCapabilities({
    auth: true, orgs: true, records: true, audit: true,
    realtime: false, storage: true, analytics: false,
    signIn: { kind: 'browser', start: { url: 'https://backend.example.test/oauth/start' } },
  })
  assert.equal(caps.realtime, false); assert.equal(caps.storage, true)
  assert.equal(caps.signIn.kind, 'browser')
  assert.deepEqual(caps.signIn.start, { url: 'https://backend.example.test/oauth/start' })
  // every declared kind is legal
  for (const kind of contract.SIGN_IN_KINDS)
    assert.equal(wire.decodeCapabilities({ auth: true, signIn: { kind, start: {} } }).signIn.kind, kind)
  // an undeclared kind is a contract violation
  throwsCode('invalid_request', () => wire.decodeCapabilities({ signIn: { kind: 'email+password', start: {} } }))
  throwsCode('invalid_request', () => wire.decodeCapabilities({ signIn: { kind: 'email-form' } }), 'start metadata is required')
  throwsCode('invalid_request', () => wire.decodeCapabilities({}), 'signIn block is required')
  ok('capabilities: booleans + signIn{kind,start}; dispatch renders only the declared kind')
}

// ---------------------------------------------- 12. config cannot name executable code (D32)
{
  // the three fixed providers pass
  for (const provider of ['local', 'supabase', 'generic-rest'])
    assert.doesNotThrow(() => contract.assertProviderConfig({
      provider,
      local: { root: '~/.arxa/workspace' },
      supabase: { url: 'https://x.test', anonKey: 'k' },
      'generic-rest': { baseUrl: 'https://x.test' },
    }))
  assert.doesNotThrow(() => contract.assertProviderConfig({}), 'empty config defaults to local (zero-config)')
  // custom provider, adapter key, module/file-path values, env-style adapter
  assert.throws(() => contract.assertProviderConfig({ provider: 'custom' }))
  assert.throws(() => contract.assertProviderConfig({ provider: 'local', custom: { adapter: './adapters/my-backend.mjs' } }))
  assert.throws(() => contract.assertProviderConfig({ provider: 'local', adapter: './x.mjs' }))
  assert.throws(() => contract.assertProviderConfig({ provider: 'local', 'generic-rest': { baseUrl: './adapters/local.mjs' } }))
  assert.throws(() => contract.assertProviderConfig({ provider: 'require("child_process")' }))
  // and the thrown reason names executable code as the problem
  let why = ''; try { contract.assertProviderConfig({ provider: 'local', adapter: './x.mjs' }) } catch (e) { why = e.message }
  assert.match(why, /executable code/i)
  ok('config guard: 3 fixed providers only; adapter keys/paths/module strings rejected')
}

// ---------------------------------------------- 13. token/session RESPONSE envelope (D34)
// POST /auth/issue and /auth/refresh answer with ONE shape: an opaque token
// plus a session block. Pin it here — routes were pinned in part A; the
// response decode was not. The token is an opaque string the adapter stores
// and sends, never inspects; the session identifies the signer's user.
{
  const good = decodeSessionEnvelope(JSON.stringify({
    token: 'opq_ab_3', session: { id: 'sess-1', expiresAt: 1893456000 },
  }), {})
  assert.deepEqual(good, { token: 'opq_ab_3', session: { id: 'sess-1', expiresAt: 1893456000 } })
  // expiresAt is optional; unknown top-level keys are dropped (decode is exact,
  // forward-compat means tolerating extras server-side, not leaking them on)
  assert.deepEqual(
    decodeSessionEnvelope(JSON.stringify({ token: 't', session: { id: 's' }, extra: 1 }), {}),
    { token: 't', session: { id: 's' } })
  // malformed bodies are typed invalid_request, never a parse crash
  throwsCode('invalid_request', () => decodeSessionEnvelope('{"broken"', {}))
  throwsCode('invalid_request', () => decodeSessionEnvelope('null', {}))
  // token: required, non-empty string
  throwsCode('invalid_request', () => decodeSessionEnvelope(JSON.stringify({ session: { id: 's' } }), {}))
  throwsCode('invalid_request', () => decodeSessionEnvelope(JSON.stringify({ token: '', session: { id: 's' } }), {}))
  throwsCode('invalid_request', () => decodeSessionEnvelope(JSON.stringify({ token: 7, session: { id: 's' } }), {}))
  // session: required object with non-empty string id; expiresAt if present is a number
  throwsCode('invalid_request', () => decodeSessionEnvelope(JSON.stringify({ token: 't' }), {}))
  throwsCode('invalid_request', () => decodeSessionEnvelope(JSON.stringify({ token: 't', session: {} }), {}))
  throwsCode('invalid_request', () => decodeSessionEnvelope(JSON.stringify({ token: 't', session: { id: '' } }), {}))
  throwsCode('invalid_request', () => decodeSessionEnvelope(JSON.stringify({ token: 't', session: { id: 's', expiresAt: 'soon' } }), {}))
  // secrecy: a rejected envelope never echoes the (hostile) body back
  const hostile = 'opq-hostile-token-value'
  let leaked = null
  try { decodeSessionEnvelope(JSON.stringify({ token: hostile, session: 'x' }), {}) } catch (e) { leaked = e }
  assert.ok(leaked && !leaked.message.includes(hostile), 'envelope decode errors never echo the body')
  // introspection answers {active} + session only when active
  assert.deepEqual(decodeIntrospection(JSON.stringify({ active: true, session: { id: 's' } }), {}),
    { active: true, session: { id: 's' } })
  assert.deepEqual(decodeIntrospection(JSON.stringify({ active: false, session: { id: 's' } }), {}),
    { active: false })
  throwsCode('invalid_request', () => decodeIntrospection(JSON.stringify({ active: 'yes' }), {}))
  throwsCode('invalid_request', () => decodeIntrospection(JSON.stringify({ active: true }), {}))
  ok('auth response envelope: {token, session:{id, expiresAt?}} exact decode; introspection {active[, session]}; malformed typed; no echo')
}

// ---------------------------------------------- 14. X-Arxa-Cursor-Next consume semantics
// JSONL list pages keep the body PURE records; the resume cursor rides the
// X-Arxa-Cursor-Next response header. Consume rule (pinned): a present,
// non-empty header is the next request's `cursor` VERBATIM (opaque — the
// adapter never inspects inside it); an absent OR EMPTY header ends the
// stream; a garbage cursor value is invalid_request; a cursor in the body is
// ignored (it is not part of the contract).
{
  const body = wire.encodeJsonl([{ id: 'a' }, { id: 'b' }])
  // present header → returned verbatim, body stays pure records
  const page = consumeListPage({ 'x-arxa-cursor-next': wire.encodeCursor({ offset: 2 }) }, body)
  assert.deepEqual(page.records, [{ id: 'a' }, { id: 'b' }])
  assert.equal(typeof page.nextCursor, 'string')
  // absent header = end of stream
  assert.equal(consumeListPage({}, body).nextCursor, null)
  // empty-string header = end of stream too (a server may send an empty value)
  assert.equal(consumeListPage({ 'X-Arxa-Cursor-Next': '' }, body).nextCursor, null)
  // header lookup is case-insensitive (HTTP/1.1 title case, HTTP/2 lowercase)
  assert.equal(consumeListPage({ 'X-ARXA-CURSOR-NEXT': wire.encodeCursor({ offset: 9 }) }, body)
    .nextCursor, consumeListPage({ 'x-arxa-cursor-next': wire.encodeCursor({ offset: 9 }) }, body).nextCursor)
  // the cursor must DECODE as a Wire v1 cursor — garbage is invalid_request
  throwsCode('invalid_request', () => consumeListPage({ 'x-arxa-cursor-next': '%%garbage%%' }, body))
  throwsCode('invalid_request', () => consumeListPage({ 'x-arxa-cursor-next': wire.encodeCursor({ v: 2 }) }, body))
  // a cursor riding the BODY is ignored — never consumed
  const sneaky = wire.encodeJsonl([{ id: 'a', cursor: wire.encodeCursor({ offset: 5 }) }])
  assert.equal(consumeListPage({}, sneaky).nextCursor, null)
  // and the loop: nextCursor feeds the next buildRequest cursor param verbatim,
  // stopping at null — two pages then end
  const pages = []
  let cursor = undefined
  for (let i = 0; i < 3; i++) {
    const req = contract.buildRequest('listRecords', { orgId: 'o', collection: 'tickets', cursor }, {})
    const hdr = pages.length < 2 ? { 'x-arxa-cursor-next': wire.encodeCursor({ offset: (pages.length + 1) * 2 }) } : {}
    const p = consumeListPage(hdr, wire.encodeJsonl([{ id: 'r' + pages.length }]))
    pages.push({ url: req.url, n: p.records.length })
    if (p.nextCursor === null) break
    cursor = p.nextCursor
  }
  assert.equal(pages.length, 3, 'the loop stops exactly at the header-less page')
  assert.ok(!pages[0].url.includes('cursor=') && pages[1].url.includes('cursor=') && pages[2].url.includes('cursor='))
  ok('cursor-next consume: header verbatim, absent/empty = end, garbage rejected, body cursor ignored, loop terminates')
}

console.log(`workspace-provider contract freeze: ${n} checks green`)
