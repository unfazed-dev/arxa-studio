/**
 * Typed errors for the org lifecycle service. Fail-loud contract: every
 * failure surfaces as one of these (or a library's own typed error wrapped
 * in OrgOpenError with the step that raised it) — never a silent fallback.
 */

/** An openOrg step failed; everything acquired before it was torn down. */
export class OrgOpenError extends Error {
  /**
   * @param {string} orgPath
   * @param {string} step  one of the STEPS values in lifecycle.js
   * @param {Error} cause  the underlying (often library-typed) error
   */
  constructor(orgPath, step, cause) {
    super(`opening organisation "${orgPath}" failed at step "${step}": ${cause?.message ?? cause}`)
    this.name = 'OrgOpenError'
    this.orgPath = orgPath
    this.step = step
    this.cause = cause
  }
}

/** openOrg while another org is open — use switchOrg for transitions. */
export class OrgAlreadyOpenError extends Error {
  constructor(openPath, requestedPath) {
    super(
      `organisation "${openPath}" is already open — close it or use switchOrg to move to "${requestedPath}"`
    )
    this.name = 'OrgAlreadyOpenError'
    this.openPath = openPath
    this.requestedPath = requestedPath
  }
}

/** closeOrg / switchOrg with nothing open (close), or a stale handle. */
export class OrgNotOpenError extends Error {
  constructor(message = 'no organisation is open') {
    super(message)
    this.name = 'OrgNotOpenError'
  }
}

/** Another live process holds the shell lock for this org. */
export class ShellLockError extends Error {
  constructor(orgPath, lockPath, holder) {
    super(
      `organisation "${orgPath}" is open in another arxa-studio process` +
        (holder?.pid ? ` (pid ${holder.pid})` : '') +
        ` — close it there first; if that process already crashed, delete ${lockPath}`
    )
    this.name = 'ShellLockError'
    this.orgPath = orgPath
    this.lockPath = lockPath
    this.holder = holder ?? null
  }
}
