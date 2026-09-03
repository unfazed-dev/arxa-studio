/**
 * Heal dsh's workspace store so it satisfies `validateStoredState`.
 *
 * WHY THIS EXISTS AT ALL. dsh validates the workspace domain at BOOT
 * (`@deepseek-ai/dsh-workspace/lib/types/index.js`, `validateStoredState`) and
 * every failure is a hard `throw`. The engine dies before any UI exists, so a
 * user whose store has one duplicated session id cannot fix it from inside the
 * product — the product will not start. That happened on 2026-09-03: a legacy
 * bare-leaf id (`arxa-note-wt-260903-001`, from the retired `nextSessionId`
 * mint) was claimed by two workspace records, and recovery meant hand-editing
 * the user's JSON.
 *
 * dsh is a DEPENDENCY, not a fork (CLAUDE.md: depend-don't-fork), so the
 * validator itself is off-limits. The repair therefore runs on arxa's side,
 * in the launcher, before dsh boots.
 *
 * The rules below mirror the validator clause for clause, and every one is
 * conservative: a workspace whose path still exists on disk is never deleted,
 * sessions are merged rather than dropped, and the only thing ever removed is
 * a DUPLICATE claim — the session survives under exactly one owner.
 *
 * Pure: the input store is never mutated. Callers own the backup and the
 * write (see `bin/arxa-studio.mjs`).
 */
import fs from 'node:fs'

/**
 * @param store   the parsed workspace.json
 * @param exists  path-liveness probe, injected so the selftest can fake a disk
 * @returns {{ store: object, changes: string[] }} — `changes` empty means the
 *          store was already healthy and must NOT be rewritten (a heal that
 *          rewrote a good file would churn it on every boot).
 */
export function healWorkspaceStore(store, { exists = fs.existsSync } = {}) {
  const out = structuredClone(store)
  const changes = []
  const table = out?.tables?.workspaces
  const global = out?.global
  if (!table || !global || !Array.isArray(global.workspaceIds)) return { store: out, changes }

  // Order is the tie-break authority throughout, so read it once up front —
  // later clauses rewrite `workspaceIds` and must not re-derive from it.
  const rank = new Map(global.workspaceIds.map((id, i) => [id, i]))
  const at = (id) => (rank.has(id) ? rank.get(id) : Number.MAX_SAFE_INTEGER)
  const sessionsOf = (id) => (Array.isArray(table[id]?.sessionIds) ? table[id].sessionIds : [])

  // ---- clause: no two workspaces may claim the same path -------------------
  // The loser's sessions are MERGED into the winner rather than deleted: both
  // records described the same directory, so the sessions genuinely belong to
  // the survivor. Deleting them would lose real conversations.
  const byPath = new Map()
  for (const id of Object.keys(table)) {
    const p = table[id]?.path
    if (typeof p !== 'string') continue
    const prev = byPath.get(p)
    if (prev === undefined) { byPath.set(p, id); continue }
    // More sessions wins (it is the better-populated record); ties go to the
    // earlier position in the registry order.
    const [keep, drop] = sessionsOf(prev).length !== sessionsOf(id).length
      ? (sessionsOf(prev).length > sessionsOf(id).length ? [prev, id] : [id, prev])
      : (at(prev) <= at(id) ? [prev, id] : [id, prev])
    const merged = [...sessionsOf(keep)]
    for (const s of sessionsOf(drop)) if (!merged.includes(s)) merged.push(s)
    table[keep].sessionIds = merged
    delete table[drop]
    byPath.set(p, keep)
    changes.push(`path '${p}': merged workspace '${drop}' into '${keep}' (same directory claimed twice)`)
  }

  // ---- clause: a session may be accounted by at most ONE workspace ---------
  // Preference: a workspace whose path still exists on disk is the live owner;
  // a dead path is almost always the stale half of the collision. With no live
  // path (or several) the earliest registry position wins, so the repair is
  // deterministic and idempotent rather than dependent on object key order.
  const holders = new Map()
  for (const id of Object.keys(table).sort((a, b) => at(a) - at(b))) {
    for (const s of sessionsOf(id)) {
      if (!holders.has(s)) holders.set(s, [])
      holders.get(s).push(id)
    }
  }
  for (const [sessionId, ids] of holders) {
    if (ids.length < 2) continue
    const winner = ids.find((id) => { try { return exists(table[id].path) } catch { return false } }) ?? ids[0]
    for (const id of ids) {
      if (id === winner) continue
      table[id].sessionIds = sessionsOf(id).filter((s) => s !== sessionId)
      changes.push(`session '${sessionId}': dropped duplicate claim by workspace '${id}' (kept '${winner}')`)
    }
  }

  // ---- clause: registry order is a deduped, complete index of the table ----
  const seen = new Set()
  const order = []
  for (const id of global.workspaceIds) {
    if (seen.has(id)) { changes.push(`registry order: dropped repeated workspace '${id}'`); continue }
    if (table[id] === undefined) { changes.push(`registry order: dropped missing workspace '${id}'`); continue }
    seen.add(id)
    order.push(id)
  }
  for (const id of Object.keys(table)) {
    if (seen.has(id)) continue
    seen.add(id)
    order.push(id)
    changes.push(`registry order: appended unlisted workspace '${id}'`)
  }
  global.workspaceIds = order

  return { store: out, changes }
}
