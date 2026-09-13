// Workspace wire errors. The typed set is frozen in contract.js ERROR_CODES;
// every failure crossing the provider boundary surfaces as one of these, so
// callers branch on `code`, never on message text or HTTP status alone.
export class WorkspaceError extends Error {
  constructor (code, message, opts = {}) {
    super(message, { cause: opts.cause })
    this.name = 'WorkspaceError'
    this.code = code
    this.retryable = opts.retryable === true
    this.requestId = opts.requestId // echoes the wire envelope's id when present
    this.status = opts.status // HTTP status when the error came from a response
    this.serverCode = opts.serverCode // preserved raw code when the server used one we don't know
  }
}

export const invalidRequest = (message, opts) => new WorkspaceError('invalid_request', message, opts)
