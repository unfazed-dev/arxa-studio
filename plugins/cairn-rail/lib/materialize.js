/**
 * Single-desktop materializer: applies mobile edits from the rail edit
 * log to the file tree, exactly once.
 *
 * Exactly-once mechanics:
 * - Applied edit IDs are recorded as TREE-SIDE facts
 *   (`<org>/.arxa/facts/rail-applied.jsonl` via the workspace-index D20
 *   facts writer). The facts travel with the tree over the git rail, so
 *   even a fresh desktop that re-attaches the same org can never
 *   re-materialize an already-applied edit.
 * - Ordering: file write is atomic (tmp + rename), the applied fact is
 *   appended (fsync'd) only AFTER the write lands. A crash in the gap
 *   re-applies one edit — legal because every v1 op is state-based
 *   (same payload ⇒ same bytes), so the *effect* is exactly-once.
 * - Single-desktop rule: the first materializer claims the org via a
 *   tree-side fact; any other device throws MaterializerClaimError.
 *
 * Failure is LOUD: any edit that cannot be applied throws
 * MaterializeError (with the edit id and cause) and stops the run. There
 * is no silent skip and no partial fact for the failed edit.
 *
 * v1 op set (all state-based / idempotent by construction):
 * - `set-file`: { project: <slug path rel. to org>, path, content } —
 *   writes content at `<org>/<project>/<path>`; `path` must be relative
 *   with no `..` segments.
 */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  appendFact,
  deriveFactState,
} from '../../workspace-index/lib/index.js'
import { readEdits } from './editlog.js'
import { MaterializeError, MaterializerClaimError } from './errors.js'

export const APPLIED_TOPIC = 'rail-applied'
export const CLAIM_TOPIC = 'rail-materializer'

/** Claim the org for `deviceId`, or verify an existing claim. Another
 * holder ⇒ loud MaterializerClaimError (single-desktop rule). */
export function claimMaterializer(root, orgSlug, deviceId) {
  const state = deriveFactState(root, orgSlug)
  const holder = state[CLAIM_TOPIC]?.holder
  if (holder && holder !== deviceId) {
    throw new MaterializerClaimError(orgSlug, holder, deviceId)
  }
  if (!holder) {
    appendFact(root, orgSlug, CLAIM_TOPIC, { key: 'holder', value: deviceId })
  }
  return deviceId
}

/** Set of edit ids already applied to this tree (from tree-side facts). */
export function appliedEditIds(root, orgSlug) {
  const state = deriveFactState(root, orgSlug)
  return new Set(Object.keys(state[APPLIED_TOPIC] ?? {}))
}

function safeJoin(orgDir, project, relPath) {
  const parts = String(relPath).split('/')
  if (parts.some((p) => p === '..' || p === '' || p === '.')) {
    throw new Error(`unsafe path '${relPath}'`)
  }
  return join(orgDir, project, ...parts)
}

function applyOne(root, orgSlug, edit) {
  const { op, payload } = edit
  if (op === 'set-file') {
    const target = safeJoin(join(root, orgSlug), payload.project, payload.path)
    mkdirSync(dirname(target), { recursive: true })
    const tmp = target + '.rail-tmp'
    writeFileSync(tmp, payload.content, 'utf8')
    renameSync(tmp, target) // atomic on the same volume
    return
  }
  throw new Error(`unknown op '${op}'`)
}

/**
 * Apply every not-yet-applied `edit_log` edit to the tree, in
 * deterministic (at, editId) order. Returns the list of edit ids applied
 * this run. Throws on the first failure — loud, never a silent skip.
 */
export function materialize(root, orgSlug, deviceId) {
  claimMaterializer(root, orgSlug, deviceId)
  const done = appliedEditIds(root, orgSlug)
  const pending = readEdits(root, orgSlug)
    .filter((e) => e.table === 'edit_log' && !done.has(e.editId))
    .sort((a, b) =>
      a.at === b.at
        ? a.editId.localeCompare(b.editId)
        : a.at.localeCompare(b.at),
    )
  const applied = []
  for (const edit of pending) {
    try {
      applyOne(root, orgSlug, edit)
    } catch (cause) {
      throw new MaterializeError(edit.editId, cause.message, cause)
    }
    // Fact lands only after the tree write: re-materialization impossible
    // from here on, on this or any future desktop.
    appendFact(root, orgSlug, APPLIED_TOPIC, {
      key: edit.editId,
      value: { at: new Date().toISOString() },
    })
    applied.push(edit.editId)
  }
  return applied
}
