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
  'opened', 'committed', 'pushed', 'checks', 'gate', 'review', 'merged', 'archived', 'cleaned',
])

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
 * `Co-authored-by:` is the one line here GitHub itself understands — it puts
 * the agent on the commit's contributor list, which is the honest record when
 * a model wrote the diff.
 */
export function sessionTrailers({ id, container, actor, coAuthor } = {}) {
  const out = [`Arxa-Session: ${id}`]
  if (container) out.push(`Arxa-Container: ${container}`)
  if (actor) out.push(`Arxa-Actor: ${actor}`)
  if (coAuthor) out.push(`Co-authored-by: ${coAuthor}`)
  return out.join('\n')
}

/**
 * An agent identity as a `Co-authored-by:` value. GitHub needs `Name <email>`;
 * a bare model name is silently dropped from the contributor list, so a made-up
 * but STABLE noreply address is better than none — it groups every commit the
 * same agent co-authored instead of scattering them.
 */
export function agentCoAuthor(model) {
  const name = String(model ?? '').trim()
  if (name === '') return null
  if (/<[^>]+>/.test(name)) return name // already Name <email>
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${name} <${slug || 'agent'}@arxa.invalid>`
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
  const row = {
    stage,
    actor: entry?.actor ? String(entry.actor) : null,
    result: entry?.result ? String(entry.result) : 'ok',
    sha: entry?.sha ? String(entry.sha).slice(0, 7) : null,
    detail: entry?.detail ? String(entry.detail) : null,
    at: entry?.at ?? new Date().toISOString(),
  }
  const ledger = [...readLedger(repoPath, id, env), row]
  annotateSession(repoPath, id, { ledger }, env)
  return ledger
}

const cell = (v) => (v === null || v === undefined || v === '' ? '—' : String(v).replace(/\|/g, '\\|').replace(/\n+/g, ' '))

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
  out.push('| stage | actor | result | sha | when (UTC) | detail |', '|---|---|---|---|---|---|')
  for (const r of rows) {
    out.push(`| ${cell(r.stage)} | ${cell(r.actor)} | ${cell(r.result)} | ${r.sha ? '`' + r.sha + '`' : '—'} | ${cell(r.at)} | ${cell(r.detail)} |`)
  }
  if (rows.length === 0) out.push('| _no stages recorded yet_ |  |  |  |  |  |')
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
