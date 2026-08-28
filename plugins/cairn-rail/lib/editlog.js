/**
 * Append-only mobile edit log with stable edit IDs (arxa-studio
 * greenfield — cairn only syncs these rows, it does not define them).
 *
 * Storage: `<workspace-root>/.arxa/rail/<org>/editlog.jsonl`, one JSON
 * object per line, fsync'd before return (same durability pattern as the
 * D20 facts writer). This lives OUTSIDE every org repo on purpose: the
 * edit log is rail-native data, and keeping it out of the tree keeps the
 * git rail and the cairn rail disjoint (no double-sync). It is NOT a
 * derived cache — index rebuilds/clears never touch it.
 *
 * Stable edit IDs: `<deviceId>:<seq>` where seq is a per-device
 * monotonic counter derived from the log itself on open. The id never
 * changes once appended — the materializer and the outbox both key on it.
 *
 * Disjointness (D46, load-bearing): appendEdit refuses any row whose
 * `table` is not on RAIL_TABLES. Nothing derivable from the file tree
 * ever enters this log, so nothing derivable ever syncs.
 */

import {
  appendFileSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
} from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { DisjointnessError } from './errors.js'

/** Rail allow-list — the ONLY tables that may ride the rail (D46 scope:
 * index/session state + mobile projection). Everything else is presumed
 * derivable from the tree and rejected. */
export const RAIL_TABLES = ['edit_log', 'session_state']

export const RAIL_DIR = ['.arxa', 'rail']
const LOG_FILE = 'editlog.jsonl'

export function railDir(root, orgSlug) {
  return join(root, ...RAIL_DIR, orgSlug)
}

function logPath(root, orgSlug) {
  return join(railDir(root, orgSlug), LOG_FILE)
}

/** Read every edit in append order. Missing log = empty list. */
export function readEdits(root, orgSlug) {
  const file = logPath(root, orgSlug)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l))
}

/** Next per-device sequence number, derived from the log itself so ids
 * stay monotonic across process restarts. */
export function nextSeq(root, orgSlug, deviceId) {
  let max = 0
  for (const e of readEdits(root, orgSlug)) {
    if (e.deviceId === deviceId && e.seq > max) max = e.seq
  }
  return max + 1
}

/**
 * Append one mobile edit; returns the full edit row including its stable
 * `editId`. `edit` = { table, op, payload, deviceId } (+ optional `at`).
 * Throws DisjointnessError for any table off the rail allow-list.
 */
export function appendEdit(root, orgSlug, edit) {
  if (!edit || typeof edit.deviceId !== 'string' || edit.deviceId === '') {
    throw new Error('appendEdit: edit.deviceId (string) is required')
  }
  if (!RAIL_TABLES.includes(edit.table)) {
    throw new DisjointnessError(edit.table)
  }
  const seq = nextSeq(root, orgSlug, edit.deviceId)
  const row = {
    editId: `${edit.deviceId}:${seq}`,
    seq,
    deviceId: edit.deviceId,
    table: edit.table,
    op: edit.op,
    payload: edit.payload,
    at: edit.at ?? new Date().toISOString(),
  }
  const dir = railDir(root, orgSlug)
  mkdirSync(dir, { recursive: true })
  const fd = openSync(logPath(root, orgSlug), 'a')
  try {
    appendFileSync(fd, JSON.stringify(row) + '\n', 'utf8')
    fsyncSync(fd) // durable before anyone materializes or pushes it
  } finally {
    closeSync(fd)
  }
  return row
}
