/**
 * Typed errors for the cairn rail. Every failure mode the spec calls
 * "loud" surfaces as one of these — callers can switch on class, and
 * nothing in this plugin ever swallows an error silently.
 */

/** The disjointness rule (D46) was violated: an attempt was made to put
 * tree-derivable data on the rail. This is a programming error, never a
 * runtime condition to retry. */
export class DisjointnessError extends Error {
  constructor(table) {
    super(
      `disjointness rule (D46): table '${table}' is not on the rail ` +
        `allow-list — anything derivable from the file tree is rebuilt ` +
        `locally and never syncs over the cairn rail`,
    )
    this.name = 'DisjointnessError'
    this.table = table
  }
}

/** Materializer failure — an edit could not be applied to the tree.
 * Carries the edit id; the run stops here, nothing is skipped. */
export class MaterializeError extends Error {
  constructor(editId, message, cause) {
    super(`materialize failed at edit ${editId}: ${message}`, { cause })
    this.name = 'MaterializeError'
    this.editId = editId
  }
}

/** A second desktop tried to materialize while another holds the claim.
 * Single-desktop rule: exactly one materializer per org, ever. */
export class MaterializerClaimError extends Error {
  constructor(orgSlug, holder, claimant) {
    super(
      `org '${orgSlug}' already has materializer '${holder}'; ` +
        `'${claimant}' must not materialize (single-desktop rule)`,
    )
    this.name = 'MaterializerClaimError'
    this.holder = holder
    this.claimant = claimant
  }
}

/** v1 outbox is online-only: pushing without a live transport is a typed
 * failure, and the edits simply stay pending. */
export class RailOfflineError extends Error {
  constructor(pending) {
    super(`rail offline: ${pending} edit(s) stay pending (v1 is online-only)`)
    this.name = 'RailOfflineError'
    this.pending = pending
  }
}

/** The wire payload did not match the pinned cairn contract shape. */
export class WireContractError extends Error {
  constructor(message) {
    super(`cairn wire contract violation: ${message}`)
    this.name = 'WireContractError'
  }
}
