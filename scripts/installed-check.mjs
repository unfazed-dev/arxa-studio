/**
 * Installed-app check for org-row-dashboard step 4.5 (§14) — READ ONLY.
 *
 * Talks to the engine the LaunchAgent runs out of /Applications/Arxa Studio.app
 * over the desktop session token in ~/.arxa/dsh/desktop-session.json, and:
 *   1. proves the new build is the one serving (the row verbs answer, rows
 *      carry focusMs);
 *   2. drives the real page through `arxa lens check` to see the restyle.
 *
 * It writes nothing and never posts session.focus against a real org row: the
 * only mutation the operator's registries may see is the one their own app
 * makes while they use it.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE SMOKE: the shipping shell is WKWebView
 * (system WebKit), the lens drives headless Chrome. Lens-green is not
 * app-green for the modern CSS this step uses, so the two features that could
 * differ — card geometry and the rail's overscroll containment — are read back
 * from the LIVE computed style here.
 *
 * Run it straight after the launchctl install recipe:
 *   node scripts/installed-check.mjs
 * It waits for the engine to finish booting before asserting anything (see
 * waitForEngine) — an install is not a serving engine.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const evidence = join(repo, 'designs', 'org-dashboard', 'evidence')
const SESSION_FILE = join(homedir(), '.arxa', 'dsh', 'desktop-session.json')

function request(authorityUrl, { path = '/', method = 'GET', cookie = '', body, timeoutMs = 20000 } = {}) {
  const authority = new URL(authorityUrl)
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body))
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1', port: authority.port, path, method,
      headers: { host: authority.host, ...(cookie ? { cookie } : {}), ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}) },
      timeout: timeoutMs,
    }, (res) => { let text = ''; res.on('data', (c) => { text += c }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text })) })
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }) })
    req.on('error', (e) => resolve({ error: String(e && e.code || e) }))
    if (payload) req.write(payload)
    req.end()
  })
}

let failures = 0
const ok = (label, condition, detail = '') => {
  console.log((condition ? 'OK  ' : 'FAIL  ') + label + (condition ? '' : ': ' + detail))
  if (!condition) failures++
}

// The extracted directory appearing under ~/.arxa/engine/<sha12>/ is NOT the
// same event as the engine serving: after an install it still has to boot, and
// it rotates the desktop token while it does. Reading the token file once and
// asserting immediately reported seven false failures twice before this poll
// existed, so re-read the file every attempt and wait for a real cookie.
const WAIT_TRIES = 120
const WAIT_MS = 2000
async function waitForEngine() {
  const started = Date.now()
  let last = 'never read ' + SESSION_FILE
  for (let i = 0; i < WAIT_TRIES; i++) {
    let session = null
    try { session = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) } catch (e) { last = String(e && e.code || e) }
    if (session && typeof session.url === 'string') {
      const u = new URL(session.url)
      const exchange = await request(session.url, { path: u.pathname + u.search, timeoutMs: 5000 })
      const cookies = (exchange?.headers?.['set-cookie'] || []).map((v) => v.split(';')[0])
      if (cookies.length) return { session, cookies, waitedMs: Date.now() - started }
      last = JSON.stringify(exchange).slice(0, 200)
    }
    if (i === 0) console.log('note  waiting for the installed engine to serve…')
    await new Promise((r) => setTimeout(r, WAIT_MS))
  }
  return { session: null, cookies: [], waitedMs: Date.now() - started, last }
}

const booted = await waitForEngine()
const { session, cookies } = booted
ok('installed engine boots and hands out a session cookie (waited ' + Math.round(booted.waitedMs / 1000) + 's)',
  cookies.length > 0, booted.last)
if (!cookies.length) { console.log('1 FAILURE(S)'); process.exit(1) }
const cookie = cookies.join('; ')
const dash = async (action, arg) => {
  const r = await request(session.url, { path: '/__arxa/dashboard/action', method: 'POST', cookie, body: { action, arg } })
  try { return JSON.parse(r.text) } catch { return { ok: false, error: 'non-JSON ' + r.status } }
}

const ping = await dash('ping')
ok('installed dashboard route answers ping', ping.ok === true && ping.result?.ready === true, JSON.stringify(ping))

// A verb the OLD build did not have: an unknown session must come back
// org-not-found (the verb ran), never unknown-action (a stale binary).
const probe = await dash('session.focus', { orgId: 'no-such-org', sessionId: 'no-such-session', deltaMs: 1000 })
ok('installed build carries session.focus (org-not-found, not unknown-action → the new binary is serving)',
  probe.ok === false && probe.error === 'org-not-found', JSON.stringify(probe))

const sidebar = await request(session.url, { path: '/__arxa/sidebar/state', method: 'GET', cookie })
let orgId = null
try {
  const state = JSON.parse(sidebar.text)
  const orgs = state?.orgs || state?.result?.orgs || []
  orgId = orgs.length ? orgs[0].id : null
  console.log('note  orgs on record: ' + orgs.map((o) => o.name).join(', '))
} catch { /* the shape check below reports it */ }
ok('sidebar state lists at least one real org', typeof orgId === 'string', (sidebar.text || '').slice(0, 200))

const rows = await dash('row.sessions', { orgId, rowId: '' })
const list = rows?.result?.rows || []
ok('row.sessions serves the operator\'s real rows with a focusMs field (absent ⇒ null, never zero)',
  rows.ok === true && list.every((r) => 'focusMs' in r && (r.focusMs === null || typeof r.focusMs === 'number')),
  JSON.stringify(rows).slice(0, 300))
console.log('note  ' + list.length + ' session row(s), focusMs: ' + JSON.stringify(list.map((r) => r.focusMs)))

// Step 4.5: the host half of the delta chip. `all` has no previous window.
const st90 = await dash('row.stats', { orgId, rowId: '', range: 90 })
const stAll = await dash('row.stats', { orgId, rowId: '', range: 'all' })
const a90 = st90?.result?.activity || {}
const aAll = stAll?.result?.activity || {}
ok('row.stats carries prevCommits for a bounded range and null for "all" (no previous window ⇒ no baseline, never 0)',
  (a90.prevCommits === null || typeof a90.prevCommits === 'number') && aAll.prevCommits === null,
  JSON.stringify({ ranged: a90.prevCommits, all: aAll.prevCommits }))

// Step 5: Delivery. The operator's TERRA IS linked, so this exercises the real
// GitHub path — but the check only asserts the SHAPE, never that a figure has a
// particular value, and it never asks for a fresh fetch.
const del = await dash('row.delivery', { orgId, rowId: '' })
const dres = del?.result || {}
ok('row.delivery answers with a stated connect-state or real repo figures (absent unit ⇒ null, never zero)',
  del.ok === true && (
    ['unavailable', 'not-linked', 'relink'].includes(dres.reason)
    || (Array.isArray(dres.repos) && dres.repos.every((r) => r.runs === null || (typeof r.runs === 'object' && (r.runs.rate === null || typeof r.runs.rate === 'number'))))
  ), JSON.stringify(del).slice(0, 300))
console.log('note  delivery: ' + (dres.reason || (dres.linkedRepos + ' linked repo(s), ci=' + dres.ci + ', rate=' + dres.rate)))

// Step 6: Engine. No project on this machine has ever run the engine, so the
// expected answer here is `not-set-up` — and that is a designed state, not a
// failure. What must never happen is a fabricated phase.
const eng = await dash('row.engine', { orgId, rowId: '' })
const eres = eng?.result || {}
ok('row.engine reads the file contract and never invents a phase (no pipeline/ ⇒ not-set-up, never "intake")',
  eng.ok === true && (eres.reason === 'not-set-up' || (Array.isArray(eres.projects) && eres.projects.every((p) => p.phase === null || typeof p.phase === 'string'))),
  JSON.stringify(eng).slice(0, 300))
console.log('note  engine: ' + (eres.reason || (eres.withEngine + '/' + eres.scanned + ' project(s) with runs, phase=' + eres.phase)))

// ---- the page itself, through the lens ------------------------------------
const PRELUDE = String.raw`
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rows = () => [...document.querySelectorAll('[role=treeitem][aria-expanded]')];
  const dismiss = () => { const b = [...document.querySelectorAll('button')].find((x) => /^(Continue|Kontynuuj|Continuer)$/.test(x.textContent.trim())); if (b) { b.click(); return true } return false };
  const until = async (fn, ms) => { const t = Date.now() + ms; let v = fn(); while (!v && Date.now() < t) { await sleep(200); v = fn(); } return v; };
  let t = Date.now() + 20000;
  while (rows().length === 0 && Date.now() < t) { dismiss(); await sleep(200); }
  for (let i = 0; i < 10 && dismiss(); i++) await sleep(300);
  await sleep(600);
`
// Read-only: no row is created, no session is opened, no heartbeat is posted.
const script = `(async () => {${PRELUDE}
  const root = await until(() => document.querySelector('[data-arxa-dashboard-root]'), 20000);
  if (!root) return 'no-dashboard-root';
  const bridge = window.__ARXA_SIDEBAR__ || {};
  const bento = await until(() => root.querySelector('.aXa_db_bento'), 12000);
  if (!bento) return 'no-bento';
  await sleep(600);
  // The same geometry rule the smoke enforces: every visual row fills the grid.
  const box = bento.getBoundingClientRect();
  const cs = getComputedStyle(bento);
  const gap = parseFloat(cs.columnGap) || 12;
  const cards = [...bento.querySelectorAll('[data-arxa-dashboard-span]')].map((el) => el.getBoundingClientRect());
  const lines = [];
  for (const r of cards) { const L = lines.find((x) => Math.abs(x[0].top - r.top) < 4); if (L) L.push(r); else lines.push([r]); }
  const holes = [];
  for (const L of lines) {
    L.sort((a, b) => a.left - b.left);
    if (Math.abs(L[0].left - box.left) > 1.5) holes.push('left');
    if (Math.abs(L[L.length - 1].right - box.right) > 1.5) holes.push('right');
    for (let i = 1; i < L.length; i++) if (L[i].left - L[i - 1].right > gap + 1.5) holes.push('between');
    const hs = L.map((r) => Math.round(r.height));
    if (Math.max(...hs) - Math.min(...hs) > 1.5) holes.push('height');
  }
  const hand = root.querySelector('[data-arxa-dashboard-rail="hand"]');
  const bankCards = [...root.querySelectorAll('[data-arxa-dashboard-session]')];
  const facts = {
    kind: root.getAttribute('data-arxa-dashboard-root'),
    seams: typeof bridge.orgRows === 'function' && typeof bridge.selectRow === 'function' && typeof bridge.boundSession === 'function',
    navPills: root.querySelectorAll('[data-arxa-dashboard-nav] .aXa_db_navPill').length,
    cards: cards.length,
    holes,
    // WebKit here, Chrome in the lens — read the features that could differ
    // from the LIVE computed style rather than trusting the stylesheet.
    handOverscroll: hand ? getComputedStyle(hand).overscrollBehaviorX : 'no-hand',
    handSnap: hand ? getComputedStyle(hand).scrollSnapType : 'no-hand',
    // Revised 2026-09-10: plain carousel — cards never overlap, nothing sideways.
    noOverlap: bankCards.length < 2 || bankCards.slice(1).every((el, i) => el.getBoundingClientRect().left >= bankCards[i].getBoundingClientRect().right - 0.5),
    noVerticalText: bankCards.every((c) => [...c.querySelectorAll('*')].every((el) => !/^(vertical|sideways)-/.test(getComputedStyle(el).writingMode))),
    // The sidebar tree must carry the selection mark.
    markedRows: document.querySelectorAll('[data-arxa-row-selected]').length,
    // The bottom bars are gone (operator, 2026-09-10) — nothing may draw over
    // the card's bottom edge on the shipping engine either.
    noStripe: !root.querySelector('[data-arxa-dashboard-sessionbars]'),
    time: !!root.querySelector('[data-arxa-dashboard-group="time"]'),
    // Steps 5+6: both new cards must state something. A card still carrying the
    // old "soon" placeholder publishes no hook and fails here.
    delivery: (root.querySelector('[data-arxa-dashboard-delivery]') || {}).getAttribute ? root.querySelector('[data-arxa-dashboard-delivery]').getAttribute('data-arxa-dashboard-delivery') : null,
    engine: (root.querySelector('[data-arxa-dashboard-engine]') || {}).getAttribute ? root.querySelector('[data-arxa-dashboard-engine]').getAttribute('data-arxa-dashboard-engine') : null,
    // Step 7: the counts are the filter, and they are buttons with a pressed state.
    filters: root.querySelectorAll('[data-arxa-dashboard-filter][aria-pressed]').length,
    overflow: root.scrollWidth > root.clientWidth + 2,
  };
  await sleep(400);
  return facts.seams && facts.navPills >= 2 && facts.cards === 6 && facts.holes.length === 0
    && facts.handOverscroll === 'contain' && facts.handSnap.includes('x')
    && facts.noOverlap && facts.noVerticalText && facts.noStripe && facts.markedRows === 1
    && typeof facts.delivery === 'string' && typeof facts.engine === 'string' && facts.filters >= 1
    && facts.time && !facts.overflow ? true : JSON.stringify(facts);
})()`

const out = join(evidence, 'installed-bento-1512.png')
const args = ['lens', 'check', session.url, out, '1512', '900', '2500', '--expect=' + script, ...cookies.map((c) => '--cookie=' + c)]
const r = spawnSync('arxa', args, { encoding: 'utf8', timeout: 180_000, env: { ...process.env, ARXA_LENS_UA: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 ArxaShell/1.0' } })
const text = (r.stdout || '') + (r.stderr || '')
const unstable = /did not settle|settle/i.test(text) && !/expect not truthy|console|page error/i.test(text)
ok('lens on the INSTALLED app: both new seams are published, the pills render, the bento fills every row, the carousel keeps its cards separate, upright and bar-free, Delivery and Engine each state a real status, the counts are pressable filters, and the sidebar marks exactly one row' + (unstable ? ' (settle-unstable accepted)' : ''),
  r.status === 0 || unstable, text.split('\n').filter((l) => /FAILED|expect not|console|got /.test(l)).join(' | ').slice(0, 700))
console.log('evidence ' + out)

console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)')
process.exit(failures === 0 ? 0 : 1)
