#!/usr/bin/env node
/**
 * arxa-git-card selftest (static) — docs/plans/git-card-stock-dock-rebuild.md.
 * Source-shape checks over the host half (the card.* engine rules that moved
 * out of arxa-sidebar on 2026-09-02) and over the seam it depends on: the
 * sidebar must publish its org shell (sidebarHost + orgContext) and must no
 * longer own any card.* / insight.* action. Behaviour lives in
 * selftest.actions.mjs. Run: node plugins/arxa-git-card/selftest.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
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
check('seam: card host serves POST /__arxa/git-card/action and dispatches every action it registers',
  hostSrc().includes("path: '/__arxa/git-card/action'") && ['card.status', 'card.commit.draft', 'card.commit', 'card.push', 'card.pr.create', 'card.pr.status', 'card.pr.comment', 'card.pr.merge', 'version.mint', 'card.runner.wake', 'insight.streak', 'insight.review', 'insight.sessions', 'insight.reply', 'insight.resolve', 'card.integrate', 'card.integrate.finish'].every((a) => hostSrc().includes("'" + a + "': async")))

// ---- engine rules (moved verbatim from arxa-sidebar/selftest.mjs) ---------
// F8 (2026-09-04): a revoked GitHub grant failed every push/PR on this card as
// a bare 401 with nothing naming the recovery. The flag has to survive BOTH
// halves — the host must read it off github-link's status(), and the generated
// client must render it — so both are asserted here, not just the host.
check('card: card.status carries github.relinkRequired (host half)',
  hostSrc().includes('relinkRequired: ghState?.relinkRequired === true') && hostSrc().includes('g.status()'))

// Task 10 (A4): the card reports the EFFECTIVE confinement, not the
// configured one, whenever they differ (S3 corollary), and surfaces
// unfetched container work (§24e: "worth surfacing in the card as
// 'unfetched work exists'"). No second settings taxonomy: configured stays
// the provisioned default, effective is measured + the session's recorded
// container tier.
check('card: card.status carries confinement configured/effective (host half)',
  hostSrc().includes('confinement:') && hostSrc().includes('resolveEffectiveTier') && hostSrc().includes('DEFAULT_CONFIGURED_TIER'))
check('card: card.status carries the container tier + unfetched-work guard (host half)',
  hostSrc().includes('unrecoveredContainerCommits') && hostSrc().includes('containerTier'))
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

check('card: the detail line shows the tier shift and unfetched container work (client half)',
  clientSrc.includes('git.tier.shift') && clientSrc.includes('git.containerUnfetched'))
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
let drift = ''
try { execFileSync(process.execPath, [join(here, '..', '..', 'scripts', 'gen-git-card.mjs'), '--check'], { stdio: ['ignore', 'pipe', 'pipe'] }) }
catch (e) { drift = String(e.stderr || e.stdout || e.message).trim() }
check('client: lib/client.js is byte-identical to gen-git-card.mjs output (drift gate)', drift === '', drift)
check('client: package exports ./client and declares dsh.client (runtime + ui-conversation + locale)',
  pkg.exports['./client'] === './lib/client.js' && Array.isArray(pkg.dsh?.client?.inject) && ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-client-locale'].every((d) => pkg.dsh.client.inject.includes(d)))
check('client: stock QueueDock CSS carried under its own identity (tag + prefix), stock prefix absent',
  clientSrc.includes("CSS_TAG = 'arxa-git-card/GitDock.module.css'") && clientSrc.includes('.aXa_gc_dock{') && !clientSrc.includes('_7yHdaG_'))
// stock shape, refreshed for dsh 0.1.5-rc.2: QueueDock grew the attachment/
// file rows (+attachments, +file, +fileIcon, +fileName, +fileSize,
// +pendingRow, +status; thumbs merged into the singular thumb). This
// describes the STOCK, not arxa behavior — the card still uses only the
// grammar slots its tree mirrors below.
check('client: full stock class map present (20 keys, dsh 0.1.5-rc.2)',
  ['action', 'actions', 'attachments', 'chevron', 'count', 'dock', 'editor', 'file', 'fileIcon', 'fileName', 'fileSize', 'header', 'lead', 'list', 'panel', 'pendingRow', 'preview', 'row', 'status', 'thumb'].every((k) => clientSrc.includes('"' + k + '": "aXa_gc_' + k + '"')))
check('client: registers conversation.input.dock id=git order=15 between goal(10) and queue(20), locale-scoped',
  clientSrc.includes("ctx.slots.inject('conversation.input.dock'") && clientSrc.includes("id: 'git'") && clientSrc.includes('order: 15') && clientSrc.includes('locale: NS'))
check('client: tree mirrors QueueDock — dock > panel > header[lead,count,chevron] + list > row[preview|editor, actions > action]',
  ['S.dock', 'S.panel', 'S.header', 'S.lead', 'S.count', 'S.chevron', 'S.list', 'S.row', 'S.preview', 'S.editor', 'S.actions', 'S.action'].every((s) => clientSrc.includes(s)) && clientSrc.includes("'data-git-dock': ''") && clientSrc.includes("'aria-controls': listId"))
check('client: seat-aware status with org fallback; commit/push+PR/merge ride the one host route',
  clientSrc.includes("CARD_ROUTE = '/__arxa/git-card/action'") && clientSrc.includes("post('card.status'") && clientSrc.includes('session-not-found') && ["post('card.commit'", "post('card.push'", "post('card.pr.create'", "post('card.pr.status'", "post('card.pr.merge'"].every((s) => clientSrc.includes(s)))

// ---- G4 / G5 / G6 (grilled 2026-09-06) ------------------------------------
// docs/plans/git-card-confirmations-icons-relink.md

// G5. `Icon(name, fallback)` falls back SILENTLY, so a glyph that does not
// exist has always rendered as something else and nothing said so. Two did:
// IconGitBranchOutline14 (the card head) and IconUploadOutline16 (Mint). Pin
// every name the card asks for against the primitives the frontend actually
// ships. The bundle filename carries a build hash, so it is globbed — and a
// haystack that cannot be found is a RED check, never a silently skipped one.
const assetsDir = join(here, '..', '..', 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'assets')
let bundleName
try { bundleName = readdirSync(assetsDir).find((f) => /^index-.*\.js$/.test(f)) } catch { bundleName = undefined }
check('G5 icons: the shipped primitives bundle is findable (the haystack for the pin below)',
  bundleName !== undefined, 'no index-*.js under ' + assetsDir)
if (bundleName !== undefined) {
  const shipped = new Set(readFileSync(join(assetsDir, bundleName), 'utf8').match(/Icon[A-Za-z0-9]+/g) || [])
  const named = [...new Set((clientSrc.match(/Icon\('[A-Za-z0-9]+', '[A-Za-z0-9]+'/g) || [])
    .flatMap((m) => (m.match(/'[A-Za-z0-9]+'/g) || []).map((s) => s.slice(1, -1))))]
  const missing = named.filter((n) => !shipped.has(n))
  check('G5 icons: every glyph the card names exists — no silent fallback ships again',
    named.length >= 14 && missing.length === 0, 'named ' + named.length + ', missing: ' + missing.join(', '))
}
check('G5 icons: one glyph per meaning — refresh and check stop standing in for five things each',
  ["Icon('IconDownloadOutline16'", "Icon('IconPlayOutline16'", "Icon('IconSparkle16'", "Icon('IconListPenOutline16'",
    "Icon('IconSendOutline16'", "Icon('IconGoalOutline16'", "Icon('IconStopFill16'", "Icon('IconRightUpOutline16'",
    "Icon('IconRefreshOutline14'", "Icon('IconLinkOutline16'"].every((s) => clientSrc.includes(s)))
check('G5 icons: the two names that never existed are gone',
  !clientSrc.includes('IconGitBranchOutline14') && !clientSrc.includes('IconUploadOutline16'))

// ---- D113: Finish is REACHABLE, and its refusals are legible ----
// finishSession + sweepMerged were fully implemented and called by nothing but
// their own selftest. What is new here is the route, so these assert the
// GATING, not the function: a test that only proves "Finish appears on a merged
// clean session" never shows that either refusal reaches the operator.
check('D113: the card has a finish route at all',
  hostSrc().includes("'card.finish': async () => {"))
check('D113: the enabled state comes from finishSession\'s OWN dryRun, not a second opinion',
  hostSrc().includes("gw.finishSession(primaryRepoPath, sessionRow.id, { env: process.env, dryRun: true })")
  && hostSrc().includes("finish = { can: dry.wouldFinish === true, reason: dry.reason ?? null }"))
// D40: parked is never deleted — absent, not merely disabled, and the route
// refuses too so a stale card cannot post its way past the missing button.
check('D113: a parked session is never offered Finish, and the route refuses it',
  hostSrc().includes("if (sessionRow && sessionRow.state !== 'parked' && health === 'ok')")
  && hostSrc().includes("if (s.state === 'parked') throw new Error('parked-never-deleted: ' + sid)"))
check('D113: both refusals are named on the button, never a mute dark one',
  clientSrc.includes("t('git.finish.' + status.finish.reason)")
  && ["'git.finish.not-merged'", "'git.finish.worktree-dirty'"].every((k) => clientSrc.includes(k)))
check('D113: Finish asks before acting, like the other unwalkable moves',
  clientSrc.includes("onClick: ask('finishSession', finishSession)")
  && clientSrc.includes("'git.confirm.finishSession.ok'"))
check('D113: an org seat has no Finish (status.finish is null there)',
  clientSrc.includes('status.finish\n') || clientSrc.includes('status.finish ?'))
check('D113: every locale answers the finish strings',
  (clientSrc.match(/'git\.confirm\.finishSession\.ok':/g) || []).length
    === (clientSrc.match(/'git\.confirm\.mint\.ok':/g) || []).length
  && (clientSrc.match(/'git\.finish':/g) || []).length
    === (clientSrc.match(/'git\.confirm\.mint\.ok':/g) || []).length)
// Decision 2: Commit has always squashed the WIP run, run the gate and merged
// into main (sessionStageBoundary). The button said "Commit" and nothing else.
check('D113: Commit says that it lands on main',
  clientSrc.includes("'git.commit': 'Commit & land on main'")
  && !/'git\.commit': 'Commit',/.test(clientSrc))

// G4. The four moves that are hard to walk back pause on the stock Modal.
check('G4: merge, integrate, finish and mint ask before acting',
  ["onClick: ask('merge', mergePr)", "onClick: ask('mint', mint)", "onClick: ask('integrate',", "onClick: ask('finish',"]
    .every((s) => clientSrc.includes(s)) && clientSrc.includes('h(P.Modal, {'))
check('G4: commit and create-PR keep text entry as the pause; cancel-CI stays one click',
  clientSrc.includes("onClick: () => setEditing({ kind: 'commit', text: '' })")
  && clientSrc.includes("onClick: () => setEditing({ kind: 'pr', text: '' })")
  && clientSrc.includes('onClick: cancelCi'))
check('G4: a dialog holds the card open, like an editor or a busy action',
  clientSrc.includes('|| confirm !== null || relink !== null'))
check('G4: confirm copy in all three dictionaries',
  ['git.confirm.merge.title', 'git.confirm.integrate.body', 'git.confirm.finish.ok', 'git.confirm.mint.title']
    .every((k) => (clientSrc.split("'" + k + "':").length - 1) === 3))

// G6. The expired grant becomes a door instead of a sentence, and the
// GitHub-backed controls hide rather than throw github-unavailable.
check('G6: the card serves its own device flow (host half)',
  ["'card.github.link'", "'card.github.device'"].every((a) => hostSrc().includes(a))
  && hostSrc().includes('g.link()') && hostSrc().includes('g.deviceCode()'))
check('G6: the status row grows a re-link action that runs the device flow',
  clientSrc.includes('const startRelink = ()') && clientSrc.includes("post('card.github.link')")
  && clientSrc.includes("post('card.github.device')") && clientSrc.includes('relinkRequired ? relinkAction() : null'))
check('G6: GitHub-backed controls are HIDDEN while the grant is dead, never left to throw',
  clientSrc.includes('runnerAsleep && !relinkRequired ? wakeAction() : null')
  && clientSrc.includes(': relinkRequired ? [] : ['))
check('G6: the approve row keeps its place and says what is wrong',
  clientSrc.includes("status.github.relinkRequired")
  && clientSrc.includes("const prText = relinkRequired ? t('git.relinkNeeded')"))
// The dialog the user could not close (reported 2026-09-06). These pin the
// WIRING; the reopen loop itself is a timing behaviour no static check can
// see, so selftest.relink.mjs drives the real functions against a real clock.
check('G6 fix: Cancel goes through stopRelink, which kills the poll and drops the run token',
  clientSrc.includes('const stopRelink = ()')
  && clientSrc.includes('relinkRun.current = null')
  && /stopRelink = \(\) => \{[^}]*clearInterval/s.test(clientSrc))
check('G6 fix: BOTH ways out of the modal use it — the X and the button',
  clientSrc.includes('onClose: stopRelink') && clientSrc.includes('onClick: stopRelink'))
check('G6 fix: a late poll tick cannot write state for a flow that was cancelled',
  clientSrc.includes('relinkRun.current === run && d && d.userCode'))
check('G6 fix: the unmount effect clears the timer, not just the alive flag',
  /alive\.current = false\s*\n\s*const run = relinkRun\.current/.test(clientSrc))
check('G6 fix: the host runs ONE device flow at a time (GitHub slow_down + one deviceCode slot)',
  hostSrc().includes('let linkInFlight = null')
  && hostSrc().includes('linkInFlight = Promise.resolve(g.link()).finally('))

check('G6: relink copy in all three dictionaries',
  ['git.relink', 'git.relinkNeeded', 'git.relink.title', 'git.relink.open', 'git.relink.failed']
    .every((k) => (clientSrc.split("'" + k + "':").length - 1) === 3))
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

// ---- Decision 3 (local-only git parity): the local Checks row -------------
// The remote Actions row occupies the slot on linked sessions; local-only
// sessions get THIS row instead — a synchronous local script with a result,
// not a remote run with an id. These pin the wiring at both ends.
check('checks: host serves card.gate.run (the no-commit gate verb)',
  hostSrc().includes("'card.gate.run': async () =>")
  && hostSrc().includes('gw.runGate(s.worktree)'))
check('checks: the run is cached per worktree and served only on a fingerprint match',
  hostSrc().includes('const gateCache = new Map()')
  && hostSrc().includes('gateFingerprint(gw, repoPath) === hit.fingerprint'))
check('checks: output capped to the last 64 KiB behind an explicit prefix',
  hostSrc().includes('const GATE_OUTPUT_MAX = 64 * 1024')
  && hostSrc().includes('[output truncated — showing the last 64 KiB]'))
check('checks: the row occupies the Actions slot for local-only sessions only',
  clientSrc.includes('!(status.linked && !status.localOnly)'))
check('checks: Run checks rides run() — the busy key de-dupes concurrent clicks',
  clientSrc.includes("run('gate'") && clientSrc.includes("post('card.gate.run'"))
check('checks: red output renders in a disclosure, not a toast that scrolls away',
  clientSrc.includes("gate.state === 'red' && gate.output")
  && clientSrc.includes('checksOpen && redOut'))
{
  // "Must not start GitHub Actions and must not merge or park the session"
  // (Step 4): slice the handler body and pin what may and may not be in it.
  const slice = hostSrc().split("'card.gate.run': async () => {")[1].split(/\n {12}'/)[0]
  check('checks: the verb only runs the gate — no push, PR, merge, park or Actions',
    slice.includes('gw.runGate(s.worktree)')
    && !/pushSessionBranch|prMerge|parkSession|workflowRuns|rerunRun|cancelRun/.test(slice))
}
check('checks: every row string in all three dictionaries',
  ['git.checks.run', 'git.checks.none', 'git.checks.green', 'git.checks.red', 'git.checks.light',
    'git.checks.running', 'git.checks.output', 'git.checks.failed']
    .every((k) => (clientSrc.split("'" + k + "':").length - 1) === 3))

// ---- AXS-005: the condensed delivery ledger strip --------------------------
// The full ledger table stays on the PR; the card renders only the latest
// stage, its result, the next owner and the target, read from the registry
// record through the strip's own action — never a refetch or a re-render of
// the table.
check('ledger: host serves card.ledger.summary as a pure read of the record',
  hostSrc().includes("'card.ledger.summary': async () => {")
  && hostSrc().includes('gw.ledgerSummary(gw.readLedger('))
check('ledger: the strip loads through its own action and renders for session seats with a record',
  clientSrc.includes("post('card.ledger.summary'")
  && clientSrc.includes('sessionSeat && ledger'))
check('ledger: only a trusted github.com URL opens out; everything else gets the bounded local view',
  clientSrc.includes("startsWith('https://github.com/')")
  && clientSrc.includes('ledgerOpen && ledger && !ledgerUrl'))
check('ledger: strip strings in all three dictionaries',
  ['git.ledger.summary', 'git.ledger.next', 'git.ledger.open', 'git.ledger.view',
    'git.ledger.stage', 'git.ledger.result', 'git.ledger.nextOwner', 'git.ledger.target']
    .every((k) => (clientSrc.split("'" + k + "':").length - 1) === 3))

console.log(failures === 0 ? '\narxa-git-card selftest: ALL GREEN' : `\narxa-git-card selftest: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
