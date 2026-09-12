#!/usr/bin/env node
/**
 * arxa-git-card action selftest (docs/plans/git-card-stock-dock-rebuild.md
 * A2; cases from the D116 phase-4 suite, moved with their actions out of
 * arxa-sidebar on 2026-09-02). Real Phase A lifecycle, fake webServer +
 * fake github (same harness as the sidebar's smoke.mjs), fully sandboxed
 * (temp ARXA_HOME + workspace). Applies BOTH host halves on one fake
 * webServer — the sidebar publishes the org shell, this plugin's route
 * runs over it — and covers: the route itself, card.pr.merge (refuse
 * non-green / merge on green), version.mint, card.runner.wake (unlinked /
 * linked), insight.streak / insight.ci (unavailable + real shape),
 * insight.sessions.
 * Exit 0 = every assertion held.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const sandbox = mkdtempSync(path.join(tmpdir(), 'arxa-git-card-actions-'))
process.env.ARXA_HOME = path.join(sandbox, 'home')
const root = path.join(sandbox, 'ws')
mkdirSync(root, { recursive: true })
mkdirSync(process.env.ARXA_HOME, { recursive: true })

const here = path.dirname(new URL(import.meta.url).pathname)
const shell = await import(path.join(here, '..', 'file-org-shell', 'lib', 'index.js'))
shell.saveWorkspaceRoot(root)
const gw = await import(path.join(here, '..', 'git-workspace', 'lib', 'index.js'))
const ws = await import(path.join(here, '..', 'workspace', 'lib', 'index.js'))

const routes = {}
const host = await import(path.join(here, '..', 'arxa-sidebar', 'lib', 'index.js'))
const card = await import(path.join(here, 'lib', 'index.js'))
// Mutable fake github: swapped per-scenario. Every org below is created
// with `link: false` (skips the D69 gate entirely), so `status`/`link` are
// never exercised here — smoke.mjs already covers that gate.
const fakeGh = {
  prListForHead: async () => [],
  prChecks: async () => ({ state: 'unknown', asleep: false, runs: [] }),
  prMerge: async () => ({ merged: false }),
  ensureRunner: async () => ({ ok: false, reason: 'not-wired' }),
}
host.apply({ webServer: { register: (r) => { routes[r.path] = r.handler } } }, { github: fakeGh })
card.apply({ webServer: { register: (r) => { routes[r.path] = r.handler } } })

const call = (p, { method = 'GET', body, url = p } = {}) => new Promise((res) => {
  const req = { url, method, _h: {}, on(ev, fn) { this._h[ev] = fn } }
  routes[p](req, { writeHead() {}, end: (s) => res(JSON.parse(s)) })
  queueMicrotask(() => {
    if (body && req._h.data) req._h.data(JSON.stringify(body))
    if (req._h.end) req._h.end()
  })
})
/** card.* / insight.* / version.* → the git-card route; org/session setup → the sidebar route. */
const act = (action, arg) => call(/^(card|insight|version)\./.test(action) ? '/__arxa/git-card/action' : '/__arxa/sidebar/action', { method: 'POST', body: { action, arg } })

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}

/** Fresh org (unlinked at birth — no repoOwner/repoName), auto-open. */
async function makeOrg(name) {
  const r = await act('org.create', { name, link: false })
  if (!r.ok) throw new Error('org.create failed: ' + r.error)
  // The just-created org is the open handle — read its path off state.
  const s = await call('/__arxa/sidebar/state')
  const org = s.orgs.find((o) => o.open)
  return { id: org.id, path: org.path }
}

/** Directly patch org.json the way the action table itself reads it — the
  * only way to simulate a "published/linked" repo without a real GitHub
  * round trip. */
async function patchManifest(orgPath, patch) {
  const fs = await import('node:fs')
  const p = path.join(orgPath, 'org.json')
  const cur = JSON.parse(fs.readFileSync(p, 'utf8'))
  fs.writeFileSync(p, JSON.stringify({ ...cur, ...patch }, null, 2))
}

async function makeSession(org, workspace = 'notes') {
  const r = await act('workspace.new-session', { orgId: org.id, workspace })
  if (!r.ok) throw new Error('workspace.new-session failed: ' + r.error)
  return r.result.id
}

/** Scaffold a project WITH its own repo (D98/D99) — the same fixture shape
  * smoke.mjs uses for 'projects/<slug>/<container>' sessions. */
async function makeProject(org, slug) {
  const proj = ws.scaffoldProject(org.path, slug)
  if (!proj?.path) throw new Error('scaffoldProject failed for ' + slug)
  gw.initProjectRepo(proj.path)
  return proj
}

/** Same idea as patchManifest but for a PROJECT's own project.json — a
  * project repo has its own repoOwner/repoName, independent of its org's. */
async function patchProjectManifest(projPath, patch) {
  const fs = await import('node:fs')
  const p = path.join(projPath, 'project.json')
  const cur = JSON.parse(fs.readFileSync(p, 'utf8'))
  fs.writeFileSync(p, JSON.stringify({ ...cur, ...patch }, null, 2))
}

// ============================================================

// 0. Route present + reaches the sidebar's org shell (plan §6: the one test
//    that fails if the route or the published host object is missing).
{
  check('git-card: route /__arxa/git-card/action registered', typeof routes['/__arxa/git-card/action'] === 'function')
  const r = await act('card.nope', {})
  check('git-card: unknown action is loud through the shared org shell', r.ok === false && r.error === 'unknown-action', JSON.stringify(r))
}

// A. card.pr.merge — refuse on non-green, merge on green
// ============================================================
{
  const org = await makeOrg('PR Co')
  const sid = await makeSession(org)
  await patchManifest(org.path, { repoOwner: 'acme', repoName: 'widgets', localOnly: false })

  fakeGh.prListForHead = async () => [{ number: 7, title: 'feat: land the thing', head: { sha: 'deadbeef' }, html_url: 'https://x/7' }]
  fakeGh.prChecks = async () => ({ state: 'pending', asleep: false, runs: [] })
  let r = await act('card.pr.merge', { sessionId: sid })
  check('card.pr.merge refuses on non-green checks (reason string)',
    r.ok === true && r.result.ok === false && r.result.reason === 'checks-pending', JSON.stringify(r))

  fakeGh.prChecks = async () => ({ state: 'green', asleep: false, runs: [] })
  fakeGh.prMerge = async (owner, name, { number, sha, subject }) =>
    ({ merged: true, sha: 'merged-sha-123', number, owner, name, subject })
  r = await act('card.pr.merge', { sessionId: sid })
  check('card.pr.merge merges on green (merged true, mergeSha, reconcile present)',
    r.ok === true && r.result.ok === true && r.result.merged === true &&
    r.result.mergeSha === 'merged-sha-123' && r.result.reconcile && typeof r.result.reconcile === 'object',
    JSON.stringify(r))
}

// ============================================================
// B. version.mint — returns a chip
// ============================================================
{
  const org = await makeOrg('Version Co')
  const sid = await makeSession(org)
  const s = gw.parkedSessions(org.path).find((x) => x.id === sid)
  writeFileSync(path.join(s.worktree, 'notes.txt'), 'first draft\n')

  const r = await act('version.mint', { sessionId: sid, name: 'Widgets', state: 'Draft' })
  check('version.mint squashes the dirty worktree and returns a chip',
    r.ok === true && r.result.ok === true && r.result.squashed === true &&
    typeof r.result.sha === 'string' && r.result.chip && r.result.chip.name === 'Widgets' && r.result.chip.state === 'Draft',
    JSON.stringify(r))
}

// ============================================================
// C. card.runner.wake — unlinked path, then linked path with a fake api
// ============================================================
{
  const org = await makeOrg('Runner Co')
  let r = await act('card.runner.wake', {})
  check('card.runner.wake: unlinked repo refuses loud (no throw)',
    r.ok === true && r.result.ok === false && r.result.reason === 'unlinked', JSON.stringify(r))

  await patchManifest(org.path, { repoOwner: 'acme', repoName: 'widgets', localOnly: false })
  fakeGh.ensureRunner = async (owner, name) => ({ ok: true, woke: true, owner, name })
  r = await act('card.runner.wake', {})
  check('card.runner.wake: linked repo returns the api result verbatim',
    r.ok === true && r.result.ok === true && r.result.woke === true &&
    r.result.owner === 'acme' && r.result.name === 'widgets', JSON.stringify(r))
}

// ============================================================
// E. insight.streak / insight.ci / insight.sessions
// ============================================================
{
  const org = await makeOrg('Insight Co')
  const sid = await makeSession(org)

  // insight.streak: shape depends on whether gw.commitDays has landed
  // (another agent's concurrent addition) — check both branches live
  // rather than assuming either state.
  let r = await act('insight.streak', { sessionId: sid })
  if (typeof gw.commitDays === 'function') {
    check('insight.streak: commitDays landed — real shape served',
      r.ok === true && Array.isArray(r.result.days) && typeof r.result.current === 'number' && typeof r.result.longest === 'number',
      JSON.stringify(r))
  } else {
    check('insight.streak: commitDays not yet landed — unavailable shape',
      r.ok === true && r.result.reason === 'unavailable' &&
      Array.isArray(r.result.days) && r.result.days.length === 0 &&
      r.result.current === 0 && r.result.longest === 0,
      JSON.stringify(r))
  }

  // ---- insight.review (D4: this ABSORBED the retired insight.ci) ----------
  // The old action is gone on purpose. Pin its absence, so a future edit that
  // quietly reinstates it re-creates the two-surfaces-disagree bug D4 removed.
  r = await act('insight.ci', { sessionId: sid })
  check('insight.ci is RETIRED — the review view owns CI now (D4)',
    r.ok === false && r.error === 'unknown-action', JSON.stringify(r))

  // No prConversation on the fake → the documented unavailable shape, never a throw.
  r = await act('insight.review', { sessionId: sid })
  check('insight.review: missing prConversation export — unavailable shape, card survives',
    r.ok === true && r.result.reason === 'unavailable' &&
    Array.isArray(r.result.threads) && r.result.threads.length === 0 &&
    Array.isArray(r.result.needs) && r.result.needs.length === 0,
    JSON.stringify(r))

  await patchManifest(org.path, { repoOwner: 'acme', repoName: 'widgets', localOnly: false })
  fakeGh.workflowRuns = async ({ owner, name, branch, perPage }) => ({ runs: [{ id: 1, owner, name, branch, perPage, status: 'completed', conclusion: 'failure', createdAt: '2026-09-03T10:00:00Z' }] })

  // A session with no PR is NOT an error — it is the empty state that carries
  // the Create PR button (plan: Degradation).
  fakeGh.prListForHead = async () => []
  fakeGh.prConversation = async () => { throw new Error('should not be reached without a PR') }
  r = await act('insight.review', { sessionId: sid, fresh: true })
  check('insight.review: no PR yet is an empty state, not an error',
    r.ok === true && r.result.reason === 'no-pr' && r.result.pr === null, JSON.stringify(r))

  // The real shape: ranking is what this view exists for, so assert the BAND,
  // not just that data arrived.
  fakeGh.prListForHead = async () => ([{ number: 7, state: 'open', html_url: 'https://gh/pr/7', title: 'feat: x' }])
  fakeGh.status = async () => ({ login: 'evan-dev' })
  fakeGh.runJobs = async () => ({ jobs: [{ id: 9, name: 'test', conclusion: 'failure', failedSteps: [{ name: 'flutter test', number: 4 }] }] })
  fakeGh.prConversation = async ({ number }) => ({
    number, url: 'https://gh/pr/7', title: 'feat: x', state: 'OPEN',
    comments: [
      { id: 'c1', url: 'u1', body: 'nice work', createdAt: '2026-09-03T09:00:00Z', login: 'someone', bot: false },
      { id: 'c2', url: 'u2', body: 'cc @evan-dev take a look', createdAt: '2026-09-03T09:30:00Z', login: 'someone', bot: false },
      { id: 'c3', url: 'u3', body: 'my own note @evan-dev', createdAt: '2026-09-03T09:40:00Z', login: 'evan-dev', bot: false },
      { id: 'c4', url: 'u4', body: 'replied\n\n<!-- arxa-session: ' + sid + ' -->', createdAt: '2026-09-03T09:50:00Z', login: 'evan-dev', bot: false },
    ],
    reviews: [
      { id: 'r1', url: 'ur1', body: 'please fix', state: 'CHANGES_REQUESTED', createdAt: '2026-09-03T08:00:00Z', login: 'reviewer', bot: false },
      { id: 'r2', url: 'ur2', body: 'ok', state: 'COMMENTED', createdAt: '2026-09-03T08:10:00Z', login: 'bot-x', bot: true },
    ],
    threads: [
      { id: 'T1', resolved: false, outdated: false, path: 'a.dart', line: 3, replyTo: 111, comments: [{ id: 'tc1', url: 'ut1', body: 'why this?', createdAt: '2026-09-03T07:00:00Z', login: 'reviewer', bot: false }] },
      { id: 'T2', resolved: true, outdated: false, path: 'b.dart', line: 9, replyTo: 222, comments: [{ id: 'tc2', url: 'ut2', body: 'done', createdAt: '2026-09-03T07:10:00Z', login: 'reviewer', bot: false }] },
      { id: 'T3', resolved: false, outdated: true, path: 'c.dart', line: 1, replyTo: 333, comments: [{ id: 'tc3', url: 'ut3', body: 'stale', createdAt: '2026-09-03T07:20:00Z', login: 'reviewer', bot: false }] },
    ],
    issues: [{ number: 12, title: 'the bug', url: 'ui', state: 'OPEN', comments: [] }],
    commitNotes: [],
  })
  r = await act('insight.review', { sessionId: sid, fresh: true })
  const d = r.result
  check('insight.review: serves the PR and every group D2 named',
    r.ok === true && d.pr.number === 7 && d.reviews.length === 2 && d.threads.length === 3 &&
    d.comments.length === 4 && d.issues.length === 1 && d.ci.length === 1, JSON.stringify(r).slice(0, 300))
  check('needs-you: a CHANGES_REQUESTED review is in the band',
    d.needs.some((x) => x.kind === 'changes-requested' && x.by === 'reviewer'), JSON.stringify(d.needs))
  check('needs-you: an UNRESOLVED thread is in the band; a resolved one is not',
    d.needs.some((x) => x.kind === 'unresolved-thread' && x.threadId === 'T1') &&
    !d.needs.some((x) => x.threadId === 'T2'), JSON.stringify(d.needs))
  check('needs-you: an OUTDATED unresolved thread stays out — the line it marked is gone',
    !d.needs.some((x) => x.threadId === 'T3'), JSON.stringify(d.needs))
  check('needs-you: a mention of the linked login is in the band',
    d.needs.some((x) => x.kind === 'mention' && x.url === 'u2'), JSON.stringify(d.needs))
  check('needs-you: the user\'s OWN mention is never flagged back at them',
    !d.needs.some((x) => x.url === 'u3'), JSON.stringify(d.needs))
  check('needs-you: a failing CI step is in the band, named',
    d.needs.some((x) => x.kind === 'ci-failed' && x.job === 'test' && x.steps[0].name === 'flutter test'),
    JSON.stringify(d.needs))
  check('needs-you: sorted newest first',
    d.needs.map((x) => String(x.at ?? '')).every((v, i, a) => i === 0 || a[i - 1] >= v), JSON.stringify(d.needs.map((x) => x.at)))
  // D7: the marker is bookkeeping. A reader must never see it, and the session
  // it names must survive as structured data.
  const own = d.comments.find((c) => c.id === 'c4')
  check('D7: the session marker is stripped from the rendered body and kept as a field',
    own.body === 'replied' && own.session === sid, JSON.stringify(own))
  check('D7: a comment with no marker reports no session',
    d.comments.find((c) => c.id === 'c1').session === null)
  check('bots are labelled so the panel can collapse them',
    d.reviews.find((x) => x.id === 'r2').bot === true && d.reviews.find((x) => x.id === 'r1').bot === false)
  // D5: 60s cache. A second call without `fresh` must not re-hit the provider.
  let hits = 0
  const prev = fakeGh.prConversation
  fakeGh.prConversation = async (a) => { hits++; return prev(a) }
  await act('insight.review', { sessionId: sid })
  check('D5: a second open inside 60s is served from cache, not the provider', hits === 0, 'hits=' + hits)
  await act('insight.review', { sessionId: sid, fresh: true })
  check('D5: an explicit refresh bypasses the cache', hits === 1, 'hits=' + hits)
  // The cache key must carry the REPO. Session ids are minted per workspace per
  // day, so two orgs routinely hold the SAME id at once — measured live on
  // 2026-09-03, where `note-wt-260903-001` existed in both RESTO and TESTO and
  // took the engine down. Keyed on the session alone, the second org would be
  // served the first org's pull-request conversation for a full minute.
  await act('insight.review', { sessionId: sid })          // warm under acme/widgets
  const before = hits
  await patchManifest(org.path, { repoOwner: 'other', repoName: 'repo', localOnly: false })
  await act('insight.review', { sessionId: sid })          // same sid, DIFFERENT repo
  check('the cache is keyed by repo+session — a second org is never served the first org\'s PR',
    hits === before + 1, 'hits ' + before + ' -> ' + hits)
  await patchManifest(org.path, { repoOwner: 'acme', repoName: 'widgets', localOnly: false })

  // ---- the write verbs (D1) ------------------------------------------------
  const posted = []
  fakeGh.prComment = async (owner, name, a) => { posted.push({ kind: 'pr', owner, name, ...a }); return { id: 1, url: 'https://gh/c/1' } }
  fakeGh.prThreadReply = async (a) => { posted.push({ kind: 'thread', ...a }); return { id: 2, url: 'https://gh/c/2' } }
  fakeGh.setThreadResolved = async ({ threadId, resolved }) => ({ id: threadId, resolved })

  r = await act('insight.reply', { sessionId: sid, number: 7, text: 'on it' })
  check('insight.reply: a bare PR comment goes to prComment, marked with the session (D7)',
    r.ok === true && r.result.ok === true && posted.length === 1 && posted[0].kind === 'pr' &&
    posted[0].body === 'on it\n\n<!-- arxa-session: ' + sid + ' -->', JSON.stringify(posted[0]))
  r = await act('insight.reply', { sessionId: sid, number: 7, commentId: 111, text: 'because of X' })
  check('insight.reply: a thread reply is addressed to the thread\'s first comment id',
    r.ok === true && posted[1].kind === 'thread' && posted[1].commentId === 111 &&
    posted[1].body.startsWith('because of X'), JSON.stringify(posted[1]))
  r = await act('insight.reply', { sessionId: sid, number: 7, text: '   ' })
  check('insight.reply: an empty message is refused BEFORE GitHub is touched',
    r.result.ok === false && r.result.reason === 'message-required' && posted.length === 2, JSON.stringify(r))
  r = await act('insight.reply', { sessionId: sid, text: 'no pr number' })
  check('insight.reply: a missing PR number is refused, never guessed',
    r.result.ok === false && r.result.reason === 'pr-required', JSON.stringify(r))
  r = await act('insight.resolve', { sessionId: sid, threadId: 'T1' })
  check('insight.resolve: marks the thread resolved', r.result.ok === true && r.result.resolved === true, JSON.stringify(r))
  r = await act('insight.resolve', { sessionId: sid, threadId: 'T1', resolved: false })
  check('insight.resolve: unresolve is the same verb, not a second action',
    r.result.ok === true && r.result.resolved === false, JSON.stringify(r))
  r = await act('insight.resolve', { sessionId: sid })
  check('insight.resolve: a missing thread id is refused', r.result.ok === false && r.result.reason === 'thread-required', JSON.stringify(r))
  // A write must drop its own cache entry, or the repaint shows the old thread.
  hits = 0
  await act('insight.review', { sessionId: sid })
  check('a write invalidates the cache so the repaint shows the reply', hits === 1, 'hits=' + hits)

  r = await act('insight.sessions', { orgId: org.id })
  check('insight.sessions: rows include the created session',
    r.ok === true && Array.isArray(r.result.rows) && r.result.rows.some((x) => x.id === sid),
    JSON.stringify(r))
}

// ============================================================
// F. card.status seat lookup — the shell injects the dsh conversation id
//    (`arxa-<id>`, stored on the row as dshSessionId), not the bare registry
//    id. Matching only `id` answered session-not-found for every live seat
//    and the client fell back to the org seat ("main") (2026-09-02).
// ============================================================
{
  const org = await makeOrg('Seat Co')
  const sid = await makeSession(org)
  // Session identity is now the relative disk path (2026-09-03), e.g.
  // 'Seat-Co/notes/note-wt-260903-001'. The dsh conversation key flattens
  // it — 'arxa-' + every non-empty segment joined by '-' — matching both
  // git-workspace's dshSessionKey and the shell's inlined `wanted` (pinned
  // literally here, not via gw.dshSessionKey, so a drift in either
  // algorithm still shows up as a fixture that no longer resembles what
  // the shell actually stores).
  const dshId = 'arxa-' + sid.split('/').filter(Boolean).join('-')
  gw.annotateSession(org.path, sid, { dshSessionId: dshId })

  let r = await act('card.status', { sessionId: sid })
  check('card.status: bare registry id resolves the session seat',
    r.ok === true && r.result.seat && r.result.seat.kind === 'session' && r.result.seat.branch === 'arxa/' + sid,
    JSON.stringify(r).slice(0, 300))

  r = await act('card.status', { sessionId: dshId })
  check('card.status: dsh conversation id (dshSessionId) resolves the same seat',
    r.ok === true && r.result.seat && r.result.seat.kind === 'session' && r.result.seat.branch === 'arxa/' + sid,
    JSON.stringify(r).slice(0, 300))

  r = await act('card.status', { sessionId: 'arxa-s-nope' })
  check('card.status: unknown id still answers session-not-found',
    r.ok === false && /^session-not-found/.test(String(r.error)),
    JSON.stringify(r).slice(0, 300))

  // The resolver sits at the action boundary, so handlers that hand the id
  // down into git-workspace get a registry id too — version.mint is the
  // cheapest such handler (card.commit would need a WIP run + gate).
  r = await act('version.mint', { sessionId: dshId, name: 'Seatlets', state: 'Draft' })
  check('version.mint: dsh conversation id reaches git-workspace as the registry id',
    r.ok === true && r.result && typeof r.result === 'object' && !/unknown session/.test(JSON.stringify(r)),
    JSON.stringify(r).slice(0, 300))
}

// ============================================================
// G. card.gate.run + card.status.gate — the local Checks row's engine
//    (Decision 3, local-only git parity): runGate WITHOUT committing,
//    cached per worktree, voided by any mutation (committed / staged /
//    unstaged / untracked) without rerunning the script.
// ============================================================
{
  const org = await makeOrg('Gate Co')
  const sid = await makeSession(org)
  const row = gw.parkedSessions(org.path).find((x) => x.id === sid)
  const wt = row.worktree
  const gateOf = async () => {
    const r = await act('card.status', { sessionId: sid })
    return r.ok ? (r.result.gate ?? null) : 'ERR:' + r.error
  }

  // Loud refusals first.
  let r = await act('card.gate.run', {})
  check('card.gate.run: refuses without a session seat',
    r.ok === false && /serves session seats/.test(r.error), JSON.stringify(r))
  r = await act('card.gate.run', { sessionId: 'nope-wt-260913-999' })
  check('card.gate.run: unknown session is session-not-found',
    r.ok === false && /^session-not-found/.test(r.error), JSON.stringify(r))

  // No cached run yet: gate is null — "not run" is never "green".
  r = await act('card.status', { sessionId: sid })
  check('card.status: no gate run yet answers gate:null, not a claim',
    r.ok === true && r.result.gate === null, JSON.stringify(r.result.gate))

  // GREEN with captured output.
  writeFileSync(path.join(wt, 'check.sh'), '#!/bin/sh\necho "gate green output"\n')
  r = await act('card.gate.run', { sessionId: sid })
  check('card.gate.run: green check.sh returns green/kind/configured + output',
    r.ok === true && r.result.green === true && r.result.kind === 'check.sh' &&
    r.result.configured === true && r.result.output.includes('gate green output'),
    JSON.stringify(r))
  r = await act('card.status', { sessionId: sid })
  const g1 = r.result.gate
  check('card.status: serves the cached run without rerunning (state/kind/output/ranAt/fingerprint)',
    g1 && g1.state === 'green' && g1.kind === 'check.sh' && g1.configured === true &&
    g1.output.includes('gate green output') && typeof g1.ranAt === 'number' &&
    typeof g1.fingerprint === 'string' && g1.fingerprint.length > 0,
    JSON.stringify(g1))

  // Staleness: each mutation kind voids the cached result. A fresh green
  // run precedes each so the cache is warm, then the mutation alone must
  // void it — the whole point is that a historical green never outlives
  // the bytes it was measured on.
  await act('card.gate.run', { sessionId: sid })
  writeFileSync(path.join(wt, 'untracked.txt'), 'x\n')
  check('stale: an UNTRACKED file voids the cached result', (await gateOf()) === null,
    JSON.stringify(await gateOf()))
  await act('card.gate.run', { sessionId: sid })
  check('rerun recaches while the tree is unchanged', (await gateOf())?.state === 'green')
  gw.runGit(['add', 'untracked.txt'], { cwd: wt })
  check('stale: a STAGED change voids the cached result', (await gateOf()) === null,
    JSON.stringify(await gateOf()))
  await act('card.gate.run', { sessionId: sid })
  writeFileSync(path.join(wt, 'untracked.txt'), 'changed\n')
  check('stale: an UNSTAGED change voids the cached result', (await gateOf()) === null,
    JSON.stringify(await gateOf()))
  await act('card.gate.run', { sessionId: sid })
  gw.runGit(['commit', '-m', 'chore: gate fixture'], { cwd: wt })
  check('stale: a COMMIT (HEAD move) voids the cached result', (await gateOf()) === null,
    JSON.stringify(await gateOf()))

  // RED with captured output — the parked-branch mystery this row exists for.
  writeFileSync(path.join(wt, 'check.sh'), '#!/bin/sh\necho "boom-red-line" >&2\nexit 1\n')
  r = await act('card.gate.run', { sessionId: sid })
  check('card.gate.run: red check.sh captures the output, still kind check.sh',
    r.ok === true && r.result.green === false && r.result.kind === 'check.sh' &&
    r.result.output.includes('boom-red-line'),
    JSON.stringify(r).slice(0, 300))
  r = await act('card.status', { sessionId: sid })
  check('card.status: the cached red gate carries state red + the same output',
    r.result.gate?.state === 'red' && r.result.gate?.output.includes('boom-red-line'),
    JSON.stringify(r.result.gate ?? null).slice(0, 300))

  // The 64 KiB payload cap: a wall of output keeps only the last 64 KiB,
  // with an explicit prefix saying so.
  writeFileSync(path.join(wt, 'check.sh'),
    '#!/bin/sh\ni=0\nwhile [ $i -lt 20000 ]; do echo "line $i filler text"; i=$((i+1)); done\necho "final-line-19999"\nexit 1\n')
  r = await act('card.gate.run', { sessionId: sid })
  check('cap: output is the LAST 64 KiB behind an explicit truncation prefix',
    r.ok === true && /^.{0,80}truncat/i.test(r.result.output) &&
    r.result.output.length <= 64 * 1024 + 120 &&
    r.result.output.includes('final-line-19999') && !r.result.output.includes('line 0 filler'),
    'len=' + r.result?.output?.length + ' head=' + String(r.result?.output).slice(0, 60))
}

// ============================================================
// G2. card.gate.run on a worktree with NO check.sh — the light gate
// ============================================================
{
  const org = await makeOrg('Light Gate Co')
  const sid = await makeSession(org)
  /* Org scaffolding SHIPS check.sh (the stack probe), so the light path
   * needs it gone — and the tree clean again, or the light gate reports
   * the dirt (which is its job) instead of the absent-script state. */
  const wt2 = gw.parkedSessions(org.path).find((x) => x.id === sid).worktree
  gw.runGit(['rm', '-q', 'check.sh'], { cwd: wt2 })
  gw.runGit(['commit', '-m', 'chore: drop check.sh'], { cwd: wt2 })
  const r = await act('card.gate.run', { sessionId: sid })
  check('light: an absent check.sh is a configuration state, not an error',
    r.ok === true && r.result.green === true && r.result.kind === 'light' &&
    r.result.configured === false, JSON.stringify(r))
  const s = await act('card.status', { sessionId: sid })
  check('light: the cached gate reports kind light through card.status',
    s.result.gate?.kind === 'light' && s.result.gate?.state === 'green',
    JSON.stringify(s.result.gate ?? null))
}

// ---- Q14: the PRODUCT posts the stage record, not a driver script ---------
// Everything above proves the actions work. This proves the ledger they leave
// behind reaches GitHub: the table lands in the PR BODY (replaced in place,
// never appended) and each stage adds ONE comment.
{
  const posted = []       // comments
  const bodies = []       // successive PR bodies
  let prBody = 'Problem\n\nFix'
  Object.assign(fakeGh, {
    prListForHead: async () => [{ number: 9, state: 'open', html_url: 'u', body: prBody, head: { sha: 'deadbee' } }],
    prComment: async (o, n, { body }) => { posted.push(body); return { id: 1 } },
    prUpdate: async (o, n, num, { body }) => { prBody = body; bodies.push(body); return { number: num } },
  })

  const org = await act('org.create', { name: 'Ledger Co', link: false })
  const orgId = org.result?.id ?? org.result?.orgId
  const made = await act('workspace.new-session', { orgId, workspace: 'notes' })
  const sid = made.result?.id
  // The worktree is `<org>/.arxa/worktrees/<identity>`, so the org path is
  // everything before the marker — one of the conveniences of the identity
  // being the path.
  const repoPath = made.result?.repoPath ?? made.result.worktree.split('/.arxa/worktrees/')[0]

  gw.recordStage(repoPath, sid, { stage: 'committed', actor: 'Evan', sha: 'abcdef1234', detail: 'feat: a thing' })
  const table = gw.renderLedger(gw.readLedger(repoPath, sid), { sessionId: sid, container: 'notes', next: 'review' })
  prBody = gw.withLedger(prBody, table)

  check('Q14: the ledger table sits inside the PR body fence',
    prBody.includes('<!-- arxa:ledger -->') && prBody.includes('| stage |') && prBody.startsWith('Problem'),
    prBody.slice(0, 120))

  // A second stage must REPLACE the table, not add another.
  gw.recordStage(repoPath, sid, { stage: 'checks', actor: 'github actions', result: 'green' })
  prBody = gw.withLedger(prBody, gw.renderLedger(gw.readLedger(repoPath, sid), { sessionId: sid }))
  check('Q14: a second stage rewrites the table in place (one fence, both rows)',
    prBody.match(/<!-- arxa:ledger -->/g).length === 1 && /\| committed \|/.test(prBody) && /\| checks \|/.test(prBody),
    String(prBody.match(/<!-- arxa:ledger -->/g)?.length))

  check('Q14: the record is a REGISTRY fact, readable with no network at all',
    gw.readLedger(repoPath, sid).map((e) => e.stage).join(',') === 'committed,checks',
    JSON.stringify(gw.readLedger(repoPath, sid).map((e) => e.stage)))

  // A PROJECT session's registry lives in the PROJECT repo, not the org. If
  // the lookup noteStage uses did not aggregate across both, every project
  // session — which is all of tiers 2 and 3 — would record locally and then
  // silently fail to publish, because a failed publish is swallowed by design.
  const projPath = ws.scaffoldProject(repoPath, 'kitchen').path
  gw.initProjectRepo(projPath)
  const pmade = await act('workspace.new-session', { workspace: 'projects/kitchen/02-design/application' })
  const psid = pmade.result?.id
  const prow = gw.parkedSessions(repoPath).find((x) => x.id === psid)
  check('Q14: a project session is visible from the ORG path, with the fields the ledger publishes',
    !!prow && prow.repoPath === projPath && prow.workspace === 'projects/kitchen/02-design/application' && typeof prow.branch === 'string',
    JSON.stringify({ found: !!prow, repoPath: prow?.repoPath, expected: projPath, workspace: prow?.workspace }))

  gw.recordStage(prow.repoPath, psid, { stage: 'committed', actor: 'Evan', sha: 'facefeed99' })
  // Readable through EITHER path. The write half resolves the owning repo, so
  // the read half must too: if reading through the org came back empty,
  // recordStage would append to nothing and reset the ledger every call.
  check('Q14: its ledger reads the same through the project path and the org path',
    gw.readLedger(prow.repoPath, psid).length === 1 && gw.readLedger(repoPath, psid).length === 1,
    JSON.stringify({ viaProject: gw.readLedger(prow.repoPath, psid).length, viaOrg: gw.readLedger(repoPath, psid).length }))
  gw.recordStage(repoPath, psid, { stage: 'checks', actor: 'github actions', result: 'green' })
  check('Q14: recording through the ORG path appends rather than resetting',
    gw.readLedger(prow.repoPath, psid).map((e) => e.stage).join(',') === 'committed,checks',
    JSON.stringify(gw.readLedger(prow.repoPath, psid).map((e) => e.stage)))
}

// ============================================================
// H. card.ledger.summary — the condensed delivery strip's engine (AXS-005).
// A READ of the registry record only: no refetch, no GitHub call, and a URL
// only when a trusted github.com link was already recorded with a stage.
// ============================================================
{
  // No ledger yet: null, never an invented stage.
  const org = await makeOrg('Ledger Sum Co')
  const sid = await makeSession(org)
  let r = await act('card.ledger.summary', {})
  check('card.ledger.summary: refuses without a session seat',
    r.ok === false && /serves session seats/.test(r.error), JSON.stringify(r))
  r = await act('card.ledger.summary', { sessionId: sid })
  check('card.ledger.summary: a session with no ledger answers null',
    r.ok === true && r.result === null, JSON.stringify(r))

  // LOCAL session, no URL anywhere: the strip's facts come from the recorded
  // rows alone. The row below is the one the red-gate park writes
  // (card.commit's prflow path): result red, next owner NAMED.
  const repoPath = gw.parkedSessions(org.path).find((x) => x.id === sid).repoPath
  gw.recordStage(repoPath, sid, {
    stage: 'gate', author: 'unfazed-dev', result: 'red', sha: 'abc1234',
    detail: 'parked — nothing is lost, the collapsed commit stays on the branch',
    next: 'unfazed-dev — fix the gate and re-commit',
  })
  r = await act('card.ledger.summary', { sessionId: sid })
  check('local session: the strip names the latest stage, its result and the next owner, with no URL',
    r.ok === true && r.result.lastStage === 'gate' && r.result.result === 'red'
      && r.result.nextOwner === 'unfazed-dev — fix the gate and re-commit' && r.result.url === null,
    JSON.stringify(r.result))

  // LINKED session: the PR URL is recorded WITH the review stage by openPr,
  // and the summary links exactly that — never a refetch.
  const org2 = await makeOrg('Ledger Link Co')
  const sid2 = await makeSession(org2)
  await patchManifest(org2.path, { repoOwner: 'acme', repoName: 'widgets', localOnly: false })
  Object.assign(fakeGh, {
    prListForHead: async () => [],
    prCreate: async (o, n, a) => ({ number: 9, html_url: 'https://github.com/acme/widgets/pull/9', ...a }),
    prUpdate: async () => ({ number: 9 }),
    prComment: async () => ({ id: 1 }),
    status: async () => ({ login: 'evan-dev' }),
  })
  r = await act('card.pr.create', { sessionId: sid2, title: 'feat(x): the thing', problem: 'P', fix: 'F' })
  let s = await act('card.ledger.summary', { sessionId: sid2 })
  check('linked session: the strip carries the PR URL recorded at review, with its target',
    r.ok === true && s.ok === true && s.result.lastStage === 'review'
      && s.result.nextOwner === 'a human reviewer' && s.result.target === 'PR #9'
      && s.result.url === 'https://github.com/acme/widgets/pull/9',
    JSON.stringify({ pr: r.result?.pr, summary: s.result }))

  // MERGED: the latest stage/result/next come from the merged row; the URL
  // still comes from the row that recorded it.
  fakeGh.prListForHead = async () => [{ number: 9, state: 'open', html_url: 'https://github.com/acme/widgets/pull/9', head: { sha: 'deadbeef' }, title: 'feat(x): the thing' }]
  fakeGh.prChecks = async () => ({ state: 'green', asleep: false, runs: [] })
  fakeGh.prMerge = async () => ({ merged: true, sha: 'merged-sha-9' })
  r = await act('card.pr.merge', { sessionId: sid2 })
  s = await act('card.ledger.summary', { sessionId: sid2 })
  check('merged: latest stage/result/next from the merged row, URL from the row that recorded it',
    r.ok === true && r.result.ok === true && s.result.lastStage === 'merged' && s.result.result === 'ok'
      && s.result.nextOwner === 'archive the session' && s.result.url === 'https://github.com/acme/widgets/pull/9',
    JSON.stringify(s.result))
}

console.log(failures === 0 ? '\narxa-git-card selftest.actions: ALL GREEN' : `\narxa-git-card selftest.actions: ${failures} FAILURE(S)`)
rmSync(sandbox, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
