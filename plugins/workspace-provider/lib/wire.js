/**
 * Wire v1 protocol codecs (task 13 step 3). Pure encode/decode over strings
 * and buffers — no fetch, no sockets. Bounded JSON covers singleton
 * operations; JSONL covers record/audit/event streams and export bundles.
 * Every decode failure is a typed WorkspaceError('invalid_request'), never a
 * raw parse crash, and never a message that echoes the payload.
 */
import { BOUNDS, CAPABILITY_KEYS, ERROR_CODES, SIGN_IN_KINDS, WIRE_VERSION } from './contract.js'
import { WorkspaceError, invalidRequest } from './errors.js'

const byteLen = (s) => Buffer.byteLength(s, 'utf8')
const REDACTED = '[redacted]'

// ------------------------------------------------------------- cursors
// Opaque to callers, boring underneath: base64url JSON, version-tagged.
export function encodeCursor (state) {
  return Buffer.from(JSON.stringify({ v: WIRE_VERSION, ...state }), 'utf8')
    .toString('base64url')
}

export function decodeCursor (cursor) {
  let parsed
  try {
    parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'))
  } catch { throw invalidRequest('cursor is not a decodable Wire v1 cursor') }
  if (!parsed || typeof parsed !== 'object' || parsed.v !== WIRE_VERSION)
    throw invalidRequest('cursor is not a Wire v1 cursor')
  return parsed
}

// --------------------------------------------------------- bounded JSON
export function encodeJsonBody (value, { maxBytes = BOUNDS.MAX_RECORD_BYTES } = {}) {
  const text = JSON.stringify(value)
  if (text === undefined) throw invalidRequest('value is not JSON-encodable')
  if (byteLen(text) > maxBytes) throw invalidRequest('body exceeds the Wire v1 byte bound')
  return text
}

export function decodeJsonBody (text, { maxBytes = BOUNDS.MAX_RECORD_BYTES } = {}) {
  if (byteLen(text) > maxBytes) throw invalidRequest('body exceeds the Wire v1 byte bound')
  try { return JSON.parse(text) } catch { throw invalidRequest('body is not valid JSON') }
}

// ------------------------------------------------------------- JSONL
export function encodeJsonl (records) {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n'
}

export function decodeJsonl (text, { maxBytes = BOUNDS.MAX_JSONL_BYTES } = {}) {
  if (byteLen(text) > maxBytes) throw invalidRequest('stream exceeds the Wire v1 byte bound')
  let lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop() // trailing newline is legal
  return lines.map((line) => {
    if (line.trim() === '') throw invalidRequest('blank line in JSONL stream')
    try { return JSON.parse(line) } catch { throw invalidRequest('line is not valid JSON') }
  })
}

// ------------------------------------------------------------- errors
// Server messages are surfaced (they carry no secrets by contract) minus any
// occurrence of the caller's session token, which a hostile or buggy server
// must never be able to bounce back into a log.
const redact = (message, token) =>
  typeof token === 'string' && token.length > 0 && message.includes(token)
    ? message.split(token).join(REDACTED)
    : message

export function decodeErrorBody (text, { requestId, token } = {}) {
  let body
  try { body = JSON.parse(text) } catch { throw invalidRequest('error body is not valid JSON') }
  const err = body && body.error
  if (!err || typeof err !== 'object' || typeof err.code !== 'string')
    throw invalidRequest('error body is not a Wire v1 envelope')

  const known = ERROR_CODES.includes(err.code)
  return new WorkspaceError(known ? err.code : 'unavailable', redact(String(err.message ?? 'workspace provider error'), token), {
    retryable: err.retryable === true,
    requestId: typeof err.requestId === 'string' ? err.requestId : requestId,
    serverCode: known ? undefined : err.code,
  })
}

// ------------------------------------------------------- capabilities
// D34 sign-in dispatch: GET /capabilities declares one signIn kind plus its
// start metadata; studio renders exactly that flow and nothing else.
export function decodeCapabilities (body) {
  const caps = body && typeof body === 'object' ? body : null
  if (!caps) throw invalidRequest('capabilities body is not an object')
  const { signIn } = caps
  if (!signIn || typeof signIn !== 'object')
    throw invalidRequest('capabilities must declare a signIn block')
  if (!SIGN_IN_KINDS.includes(signIn.kind))
    throw invalidRequest('signIn.kind is not a Wire v1 sign-in kind')
  if (!signIn.start || typeof signIn.start !== 'object')
    throw invalidRequest('signIn.start metadata is required')

  const out = { signIn: { kind: signIn.kind, start: signIn.start } }
  for (const key of CAPABILITY_KEYS) out[key] = caps[key] === true
  return out
}

export const isRetryableStatus = (status) => BOUNDS.RETRYABLE_STATUSES.includes(status)
