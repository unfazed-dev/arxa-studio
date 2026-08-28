/**
 * v1 online-only outbox.
 *
 * Ships not-yet-acked edit-log rows over the rail via the adapter. If no
 * transport is connected (no cairn, no BYO backend, offline) push()
 * throws RailOfflineError and the edits simply stay pending — the tree
 * and the local edit log are unaffected, per the CLAUDE.md rule that the
 * rail is optional.
 *
 * NO CRDT MERGE IN THE AUTHORITATIVE PATH: this file only appends rows
 * and records acks. cairn's LWW/OR-set merge runs on the rail side
 * (server / other subscribers) only; the tree stays authoritative via
 * the materializer.
 *
 * Acks: `<workspace-root>/.arxa/rail/<org>/acks.jsonl`, append-only,
 * fsync'd — same durability pattern as the edit log. An edit is pending
 * iff its editId has no ack line.
 */

import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { railDir, readEdits } from './editlog.js'
import { RailOfflineError } from './errors.js'
import { pushEdits } from './adapter.js'

const ACKS_FILE = 'acks.jsonl'

function acksPath(root, orgSlug) {
  return join(railDir(root, orgSlug), ACKS_FILE)
}

/** editIds acknowledged by the rail. */
export function ackedEditIds(root, orgSlug) {
  const file = acksPath(root, orgSlug)
  if (!existsSync(file)) return new Set()
  return new Set(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l).editId),
  )
}

/** Edits appended locally but not yet acked by the rail. */
export function pendingEdits(root, orgSlug) {
  const acked = ackedEditIds(root, orgSlug)
  return readEdits(root, orgSlug).filter((e) => !acked.has(e.editId))
}

function recordAcks(root, orgSlug, editIds) {
  mkdirSync(railDir(root, orgSlug), { recursive: true })
  const fd = openSync(acksPath(root, orgSlug), 'a')
  try {
    for (const editId of editIds) {
      appendFileSync(fd, JSON.stringify({ editId }) + '\n', 'utf8')
    }
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/**
 * Push all pending edits through `transport` (the adapter seam). Returns
 * the acked edit ids. Throws RailOfflineError when transport is absent
 * or not connected — v1 has no offline queue beyond "still pending".
 */
export function pushOutbox(root, orgSlug, transport) {
  const pending = pendingEdits(root, orgSlug)
  if (pending.length === 0) return []
  if (!transport || transport.connected !== true) {
    throw new RailOfflineError(pending.length)
  }
  const acked = pushEdits(transport, pending)
  recordAcks(root, orgSlug, acked)
  return acked
}
