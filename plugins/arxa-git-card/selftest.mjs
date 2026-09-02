#!/usr/bin/env node
/**
 * arxa-git-card selftest (static) — docs/plans/git-card-stock-dock-rebuild.md.
 * Source-shape checks over the host half (the card.* engine rules that moved
 * out of arxa-sidebar on 2026-09-02) and over the seam it depends on: the
 * sidebar must publish its org shell (sidebarHost + orgContext) and must no
 * longer own any card.* / insight.* action. Behaviour lives in
 * selftest.actions.mjs. Run: node plugins/arxa-git-card/selftest.mjs
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const hostSrc = () => readFileSync(join(here, 'lib', 'index.js'), 'utf8')
const sidebarSrc = readFileSync(join(here, '..', 'arxa-sidebar', 'lib', 'index.js'), 'utf8')
let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}

// ---- seam: the sidebar publishes, the card consumes ----------------------
check('seam: sidebar exports sidebarHost + publishes it under Symbol.for(\'arxa.sidebar.host\')',
  sidebarSrc.includes('export const sidebarHost = { ready: false }') && sidebarSrc.includes("Symbol.for('arxa.sidebar.host')") && sidebarSrc.includes('globalThis[SIDEBAR_HOST_KEY] = sidebarHost'))
check('seam: sidebar host object carries orgContext + getGithub + mainChecksFor + importGitWorkspace',
  ['orgContext: async () =>', 'getGithub,', 'mainChecksFor,', 'importGitWorkspace,'].every((s) => sidebarSrc.includes(s)))
check('seam: sidebar no longer owns any card.* / insight.* / version.mint action',
  !/'(card|insight)\.[a-z.]+': async/.test(sidebarSrc) && !sidebarSrc.includes("'version.mint'"))
check('seam: card host reads the published object first, imports as fallback',
  hostSrc().includes("Symbol.for('arxa.sidebar.host')") && hostSrc().includes("import('arxa-sidebar')") && hostSrc().includes('../../arxa-sidebar/lib/index.js'))
check('seam: card host serves POST /__arxa/git-card/action and dispatches the twelve actions',
  hostSrc().includes("path: '/__arxa/git-card/action'") && ['card.status', 'card.commit.draft', 'card.commit', 'card.push', 'card.pr.create', 'card.pr.status', 'card.pr.merge', 'version.mint', 'card.runner.wake', 'insight.streak', 'insight.ci', 'insight.sessions'].every((a) => hostSrc().includes("'" + a + "': async")))

// ---- engine rules (moved verbatim from arxa-sidebar/selftest.mjs) ---------
check('card: engine exposes the six card actions (S3)', ['card.status', 'card.commit.draft', 'card.commit', 'card.push', 'card.pr.create', 'card.pr.status'].every((a) => hostSrc().includes("'" + a + "'")))
check('card: commit validates the conventional-subject law (Q7)', hostSrc().includes('subject-not-conventional') && hostSrc().includes('SUBJECT_RE.test(subject)'))
check('card: draft returns evidence only — the engine never drafts (Q6)', hostSrc().includes('card.commit.draft') && hostSrc().includes('EVIDENCE ONLY'))
check('card: PR title validated (becomes the squash subject, Q7/Q8)', hostSrc().includes('title-not-conventional'))
check('card: PR create dedupes before opening (file-pr rule 1)', hostSrc().includes('prListForHead') && hostSrc().includes('existing: true'))
check('card: session-branch push is PR-purpose only (D73 relaxation)', hostSrc().includes('card.push serves session seats'))

// ---- browser half: generated from the stock QueueDock grammar (A3) --------
import { execFileSync } from 'node:child_process'
const clientPath = join(here, 'lib', 'client.js')
const clientSrc = readFileSync(clientPath, 'utf8')
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
let drift = ''
try { execFileSync(process.execPath, [join(here, '..', '..', 'scripts', 'gen-git-card.mjs'), '--check'], { stdio: ['ignore', 'pipe', 'pipe'] }) }
catch (e) { drift = String(e.stderr || e.stdout || e.message).trim() }
check('client: lib/client.js is byte-identical to gen-git-card.mjs output (drift gate)', drift === '', drift)
check('client: package exports ./client and declares dsh.client (runtime + ui-conversation + locale)',
  pkg.exports['./client'] === './lib/client.js' && Array.isArray(pkg.dsh?.client?.inject) && ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-client-locale'].every((d) => pkg.dsh.client.inject.includes(d)))
check('client: stock QueueDock CSS carried under its own identity (tag + prefix), stock prefix absent',
  clientSrc.includes("CSS_TAG = 'arxa-git-card/GitDock.module.css'") && clientSrc.includes('.aXa_gc_dock{') && !clientSrc.includes('_7yHdaG_'))
check('client: full stock class map present (12 keys)',
  ['action', 'actions', 'chevron', 'count', 'dock', 'editor', 'header', 'lead', 'list', 'panel', 'preview', 'row'].every((k) => clientSrc.includes('"' + k + '": "aXa_gc_' + k + '"')))
check('client: registers conversation.input.dock id=git order=15 between goal(10) and queue(20), locale-scoped',
  clientSrc.includes("ctx.slots.inject('conversation.input.dock'") && clientSrc.includes("id: 'git'") && clientSrc.includes('order: 15') && clientSrc.includes('locale: NS'))
check('client: tree mirrors QueueDock — dock > panel > header[lead,count,chevron] + list > row[preview|editor, actions > action]',
  ['S.dock', 'S.panel', 'S.header', 'S.lead', 'S.count', 'S.chevron', 'S.list', 'S.row', 'S.preview', 'S.editor', 'S.actions', 'S.action'].every((s) => clientSrc.includes(s)) && clientSrc.includes("'data-git-dock': ''") && clientSrc.includes("'aria-controls': listId"))
check('client: seat-aware status with org fallback; commit/push+PR/merge ride the one host route',
  clientSrc.includes("CARD_ROUTE = '/__arxa/git-card/action'") && clientSrc.includes("post('card.status'") && clientSrc.includes('session-not-found') && ["post('card.commit'", "post('card.push'", "post('card.pr.create'", "post('card.pr.status'", "post('card.pr.merge'"].every((s) => clientSrc.includes(s)))
check('client: renders nothing without an org (no-org-open / no-workspace / sidebar-not-ready), like the empty queue',
  clientSrc.includes('no-org-open|no-workspace|sidebar-not-ready') && clientSrc.includes('if (absent || status === null) return null'))
// Q8 (2026-09-03): the card CONTROLS the run, it does not merely report it.
// Re-run/cancel are mutually exclusive on one run (`runLive` gates both), and
// neither invents a run id — both take the one card.pr.status surfaced.
check('client: CI run control wired to the newest run on the branch (rerun/cancel/open)',
  ["post('card.ci.' + which", 'const latestRun =', "latestRun.status !== 'completed'", "action('ci-rerun'", "action('ci-cancel'", "action('ci-open'"].every((x) => clientSrc.includes(x)))
check('client: rerun waits for the run to finish and cancel waits for it to be live (never both enabled)',
  clientSrc.includes('disabled: runLive, onClick: rerunCi') && clientSrc.includes('disabled: !runLive, onClick: cancelCi'))
check('client: run control passes the seat AND the run id, never guesses either',
  clientSrc.includes('{ ...seatArg(), runId: latestRun.id }') && clientSrc.includes("if (!latestRun) return"))
check('client: a 409 on cancel reads as already-finished, not an error',
  clientSrc.includes("r.outcome === 'already-finished'") && clientSrc.includes('git.ci.alreadyFinished'))
check('client: ci locale keys in all three dictionaries',
  ['git.ci.rerun', 'git.ci.cancel', 'git.ci.open', 'git.ci.failed'].every((k) => (clientSrc.split("'" + k + "':").length - 1) === 3))

check('client: en/pl/fr dictionaries registered under NS', ['const en = {', 'const pl = {', 'const fr = {'].every((s) => clientSrc.includes(s)) && clientSrc.includes('ctx.locale.register(NS, { en, pl, fr })'))

console.log(failures === 0 ? '\narxa-git-card selftest: ALL GREEN' : `\narxa-git-card selftest: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
