// Pure-library plugin: the optional cairn DB rail (Phase 6c, D46/D32).
// Everything works with no database and no cairn present (CLAUDE.md
// boundary); the adapter module is the single seam to cairn's pinned
// wire contract.

export const name = 'arxa-cairn-rail'

export {
  DisjointnessError,
  MaterializeError,
  MaterializerClaimError,
  RailOfflineError,
  WireContractError,
} from './errors.js'
export { RAIL_TABLES, RAIL_DIR, railDir, readEdits, nextSeq, appendEdit } from './editlog.js'
export {
  APPLIED_TOPIC,
  CLAIM_TOPIC,
  claimMaterializer,
  appliedEditIds,
  materialize,
} from './materialize.js'
export { ackedEditIds, pendingEdits, pushOutbox } from './outbox.js'
export {
  PINNED_CAIRN_COMMIT,
  toReplicationEvent,
  fromReplicationEvent,
  pushEdits,
} from './adapter.js'
