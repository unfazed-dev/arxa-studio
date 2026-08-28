// Typed errors for the account mirror (D45). Callers get catchable
// names instead of crashes; the remote provider stub throws these
// instead of ever attempting HTTP.

/** Base class for every provider-side failure. */
export class AccountProviderError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AccountProviderError'
  }
}

/**
 * The remote arxa account provider is a stub — the backend does not
 * exist yet and this build never performs HTTP. Thrown by
 * RemoteAccountProvider.fetchArtifacts().
 */
export class ProviderNotImplementedError extends AccountProviderError {
  constructor(message) {
    super(message)
    this.name = 'ProviderNotImplementedError'
  }
}

/**
 * Reserved for the future remote provider: the account credentials were
 * rejected. Shipped now so callers can write their handling today.
 */
export class ProviderAuthError extends AccountProviderError {
  constructor(message) {
    super(message)
    this.name = 'ProviderAuthError'
  }
}

/**
 * Reserved for the future remote provider: the backend could not be
 * reached. The mirror is never authoritative (D45), so callers treat
 * this as "keep the existing mirror" — refresh fetches before touching
 * disk, so a failed fetch leaves the previous mirror intact.
 */
export class ProviderUnavailableError extends AccountProviderError {
  constructor(message) {
    super(message)
    this.name = 'ProviderUnavailableError'
  }
}

/**
 * A provider returned an artifact the mirror refuses to write — bad
 * path (absolute, dot-dot, reserved name) or bad content type. Raised
 * before any file is touched.
 */
export class InvalidArtifactError extends Error {
  constructor(message) {
    super(message)
    this.name = 'InvalidArtifactError'
  }
}
