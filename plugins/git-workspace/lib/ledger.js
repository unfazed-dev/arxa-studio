// Follow-up records (Q14, grilled 2026-09-03) — WHO did WHAT, WHEN, and how
// it turned out, for every stage a session passes through.
//
// The problem this fixes: a merged PR said what changed but not who moved it,
// which stages ran, or which of them the machine did versus a person. Six
// weeks later "why was this merged on a red gate?" had no answer in the repo.
//
// Two surfaces, one source:
//   - the SESSION REGISTRY row carries the ledger (repo-local, travels
//     nowhere, same store as every other session fact)
//   - the PR body carries a rendered table, rewritten at each stage
//
// The registry is authoritative. GitHub is a rendering of it, so an offline
// or local-only org keeps the full record and simply has nowhere to publish
// it — which is the CLAUDE.md contract: every database-shaped feature must
// have a local-only path with the same capability.
//
// Commit trailers carry the same identity into git itself, where it survives
// GitHub entirely.

import { annotateSession, listSessions, sessionRepoFor } from './sessions.js'

/** Stages, in the order a session passes through them. */
export const STAGES = Object.freeze([
  'opened', 'integrated', 'committed', 'pushed', 'checks', 'gate', 'review', 'merged', 'archived', 'cleaned',
])

const pad = (n) => String(n).padStart(2, '0')

/**
 * When a stage happened, in three forms, all captured AT RECORD TIME.
 *
 * The local half has to be stamped here rather than formatted when the table
 * is drawn, because the table is drawn somewhere else — GitHub, in a browser,
 * possibly on another continent. Formatting the instant at render time would
 * show the READER's clock and quietly claim it was the machine's. The zone is
 * stored alongside, because "14:32" means nothing without it.
 *
 * `at` (ISO, UTC) stays the machine-readable instant and the sort key; the
 * other two are for a person reading the PR.
 */
export function stageTime(now = new Date()) {
  const utc = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ` +
    `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`
  const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  let zone
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone } catch { zone = undefined }
  if (!zone) {
    // No IANA name available — a numeric offset still makes the local time
    // readable. getTimezoneOffset is minutes WEST of UTC, hence the negation.
    const off = -now.getTimezoneOffset()
    zone = `UTC${off >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  }
  return { at: now.toISOString(), atUtc: utc, atLocal: local, tz: zone }
}

/**
 * The trailer block for a collapsed session commit.
 *
 * `Arxa-Session:` replaces the old `Arxa-Stage: session <id>`. The rename is
 * deliberate: `Arxa-Stage:` was used for three different things — a session,
 * an org boundary, and a version mint — so the key said nothing about which.
 * Nothing parses it (verified 2026-09-03: the only reference in the tree is a
 * comment noting the FORMAT suits `git interpret-trailers`), so the rename
 * breaks no reader.
 *
 * `Arxa-Author:` replaces `Arxa-Actor:` and `Arxa-Collaborator:` replaces
 * `Co-authored-by:` (grilled 2026-09-03). Everything here happens inside arxa,
 * so the namespace is uniform. The same paragraph above records that nothing
 * in the tree parses these keys, so the rename breaks no reader.
 *
 * KNOWN COST, accepted deliberately: `Co-authored-by:` is the one line GitHub
 * itself parses, so dropping it takes the model off the commit's contributor
 * list. Raised before the decision; the decision stands. Anything that wants
 * model attribution reads `Arxa-Collaborator:` instead.
 *
 * `actor` is still accepted as an alias for `author` so a call site mid-
 * migration keeps working rather than silently dropping the identity.
 */
export function sessionTrailers({ id, container, author, actor, collaborator } = {}) {
  const out = [`Arxa-Session: ${id}`]
  if (container) out.push(`Arxa-Container: ${container}`)
  const who = author ?? actor
  if (who) out.push(`Arxa-Author: ${who}`)
  if (collaborator) out.push(`Arxa-Collaborator: ${collaborator}`)
  return out.join('\n')
}

/**
 * An agent identity as an `Arxa-Collaborator:` value: `<model>@(<effort>)`.
 *
 * The effort half is NOT optional in the rendered string. A model named with
 * no effort recorded renders `@(unspecified)` rather than a level nobody
 * supplied — same rule the card applies to counts it did not measure
 * (arxa-git-card/lib/index.js:305: "zero is a claim, and it would be a lie").
 * `unspecified` is also greppable, so "which commits predate effort tracking"
 * stays answerable.
 */
export const EFFORT_UNSPECIFIED = 'unspecified'

export function agentCollaborator(model, effort) {
  const name = String(model ?? '').trim()
  if (name === '') return null
  const level = String(effort ?? '').trim() || EFFORT_UNSPECIFIED
  return `${name}@(${level})`
}

/**
 * The ledger rows recorded for a session, oldest first.
 *
 * Takes the D98 repo-discovery preamble, because a PROJECT session's registry
 * lives in the project repo while callers naturally hold the org path. Without
 * it, reading through the org found nothing and `recordStage` — which appends
 * to what it reads but WRITES through `annotateSession`, which does resolve —
 * would silently reset the ledger to a single row on every call.
 */
export function readLedger(repoPath, id, env = process.env) {
  const s = listSessions(sessionRepoFor(repoPath, id, env), env).find((x) => x.id === id)
  return Array.isArray(s?.ledger) ? s.ledger : []
}

/**
 * Append one stage event and return the whole ledger.
 *
 * Re-running a stage APPENDS rather than replaces: "checks went red, then
 * green after a fix" is the interesting history, and collapsing it to the last
 * outcome would hide exactly the thing a follow-up wants to see.
 */
export function recordStage(repoPath, id, entry, env = process.env) {
  const stage = String(entry?.stage ?? '').trim()
  if (stage === '') throw new TypeError('recordStage: stage is required')
  const t = stageTime(entry?.now instanceof Date ? entry.now : new Date())
  const row = {
    stage,
    // `author` is a GITHUB USERNAME, never a display name (grilled
    // 2026-09-03) — `unfazed-dev`, not `Evan F Pierre Louis`. `actor` is
    // accepted as an alias so a caller mid-migration still records someone.
    author: entry?.author ? String(entry.author) : (entry?.actor ? String(entry.actor) : null),
    collaborator: entry?.collaborator ? String(entry.collaborator) : null,
    result: entry?.result ? String(entry.result) : 'ok',
    sha: entry?.sha ? String(entry.sha).slice(0, 7) : null,
    detail: entry?.detail ? String(entry.detail) : null,
    at: entry?.at ?? t.at,
    atUtc: t.atUtc,
    atLocal: t.atLocal,
    tz: t.tz,
  }
  const ledger = [...readLedger(repoPath, id, env), row]
  annotateSession(repoPath, id, { ledger }, env)
  return ledger
}

const cell = (v) => (v === null || v === undefined || v === '' ? '—' : String(v).replace(/\|/g, '\\|').replace(/\n+/g, ' '))

/**
 * One human-readable cell: the UTC wall clock, then the clock on the machine
 * that actually did the work, named by its zone.
 *
 * Rows written before this column existed carry only `at`, so the UTC half is
 * recovered from the instant and the local half is left blank rather than
 * guessed — the reader's zone is not the recorder's, and printing it as if it
 * were would be a quiet lie about where the work happened.
 */
export function readableTime(row) {
  const utc = row?.atUtc ?? (typeof row?.at === 'string' ? row.at.replace('T', ' ').replace(/\..*$/, '') : null)
  if (!utc) return null
  const head = `${utc} UTC`
  return row?.atLocal ? `${head} · ${row.atLocal} ${row.tz ?? 'local'}` : head
}

/**
 * Who a row credits. Rows written before the rename carry `actor`, so both are
 * read — otherwise every table published before 2026-09-03 would render its
 * author column as em-dashes.
 */
export function rowAuthor(row) {
  return row?.author ?? row?.actor ?? null
}

/**
 * One stage as a PR comment. THE single builder — the automatic publish path
 * and the manual `card.pr.comment` action both call this, so a hand-triggered
 * comment cannot look different from an automatic one for the same stage
 * (they diverged before 2026-09-03: the manual path emitted stage + detail
 * only, dropping author, result and sha).
 *
 * Takes a RECORDED ROW, never the raw entry handed to `recordStage`. That is
 * deliberate: `recordStage` defaults an absent result to 'ok', and the old
 * builder read the raw entry, so the table said `ok` while the comment said
 * nothing at all.
 *
 * The time line is the reason this exists at all. GitHub stamps a comment with
 * its own posting time and renders it in the READER's zone — the exact lie the
 * `stageTime` docblock above refuses to tell. So the recorded instant travels
 * in the body: UTC, then the clock on the machine that did the work.
 */
export function stageComment(row) {
  const who = [
    rowAuthor(row) ? '_' + rowAuthor(row) + '_' : null,
    row?.result ? String(row.result) : null,
    row?.sha ? '`' + String(row.sha).slice(0, 7) + '`' : null,
  ].filter(Boolean).join(' · ')
  const when = readableTime(row)
  return [
    '**arxa · ' + String(row?.stage ?? '') + '**',
    who,
    row?.collaborator ? 'Collaborator: ' + row.collaborator : null,
    when ? '_' + when + '_' : null,
    row?.detail ? String(row.detail) : null,
  ].filter((x) => x !== null && x !== '').join('\n\n')
}

/**
 * The ledger as a markdown table, plus a `Next:` line naming who picks it up.
 *
 * Rendered fresh from the registry at every stage rather than appended to in
 * place, so the table can never drift from the record it displays.
 */
export function renderLedger(ledger, { sessionId, container, next } = {}) {
  const rows = Array.isArray(ledger) ? ledger : []
  const out = ['### Stage ledger', '']
  if (sessionId) out.push(`**Session** \`${sessionId}\`` + (container ? ` · **Container** \`${container}\`` : ''), '')
  out.push(
    '| stage | author | collaborator | result | sha | when (UTC) | when (readable) | detail |',
    '|---|---|---|---|---|---|---|---|',
  )
  for (const r of rows) {
    out.push(
      `| ${cell(r.stage)} | ${cell(rowAuthor(r))} | ${cell(r.collaborator)} | ${cell(r.result)} ` +
      `| ${r.sha ? '`' + r.sha + '`' : '—'} | ${cell(r.at)} | ${cell(readableTime(r))} | ${cell(r.detail)} |`,
    )
  }
  if (rows.length === 0) out.push('| _no stages recorded yet_ |  |  |  |  |  |  |  |')
  out.push('', `**Next:** ${next ?? 'awaiting review'}`)
  return out.join('\n')
}

const LEDGER_START = '<!-- arxa:ledger -->'
const LEDGER_END = '<!-- /arxa:ledger -->'

/**
 * Put the ledger into a PR body, replacing any previous one.
 *
 * Fenced by HTML comments so a human can edit the prose above and below it
 * freely and still have the next stage update the table in place. Without the
 * fence the choice is append-forever (nine copies by merge) or overwrite the
 * whole body (losing whatever a reviewer wrote).
 */
export function withLedger(body, ledgerMarkdown) {
  const block = `${LEDGER_START}\n${ledgerMarkdown}\n${LEDGER_END}`
  const text = String(body ?? '')
  const start = text.indexOf(LEDGER_START)
  const end = text.indexOf(LEDGER_END)
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(0, start) + block + text.slice(end + LEDGER_END.length)
  }
  return (text.trimEnd() + '\n\n' + block + '\n').trimStart()
}
