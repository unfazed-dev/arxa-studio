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
// stock shape, refreshed for dsh 0.1.2-rc.1: upstream QueueDock grew
// attachment thumbnails, so the stock class map now ships 14 keys (+thumb,
// +thumbs). This describes the STOCK, not arxa behavior — the card itself
// still uses only the original 12 grammar slots.
check('client: full stock class map present (14 keys, dsh 0.1.2-rc.1)',
  ['action', 'actions', 'chevron', 'count', 'dock', 'editor', 'header', 'lead', 'list', 'panel', 'preview', 'row', 'thumb', 'thumbs'].every((k) => clientSrc.includes('"' + k + '": "aXa_gc_' + k + '"')))
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

console.log(failures === 0 ? '\narxa-git-card selftest: ALL GREEN' : `\narxa-git-card selftest: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
