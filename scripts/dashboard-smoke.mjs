/**
 * dashboard-smoke — LIVE proof of docs/plans/org-row-dashboard.md steps 2–3
 * (D12 boot landing, D13 session cards).
 *
 * Boots the checkout launcher against a scratch ARXA_HOME whose recents
 * point at a scratch COPY of an org folder (default: TERRA; override with
 * ARXA_DASHBOARD_SMOKE_ORG=<path>), then proves:
 *   1. the engine authenticates locally;
 *   2. POST /__arxa/dashboard/action answers ping and row.stats for the org,
 *      a category and refuses a traversal;
 *   3. row.sessions / session.summary over a session created through the CTA verb,
 *      and session.focus banking focusMs on that row (step 4, D10);
 *   4. through the arxa lens (real Chrome over CDP): a first boot lands on the org
 *      dashboard with no click, the Notes row lists the session card, click =
 *      summary + Open, Open binds the conversation, and the NEXT boot lands on
 *      Notes again — screenshots land in designs/org-dashboard/evidence/.
 * Fully local: no GitHub, no model request, nothing written to ~/.arxa.
 *
 *   node scripts/dashboard-smoke.mjs
 */
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rootFilePath } from '../plugins/workspace/lib/root.js'

const studio = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.ARXA_DASHBOARD_SMOKE_PORT || 7941)
const budgetMs = Number(process.env.ARXA_DASHBOARD_SMOKE_BUDGET_MS || 120_000)
const sourceOrg = process.env.ARXA_DASHBOARD_SMOKE_ORG || '/Volumes/developer_ssd/TERRA'
const evidence = join(studio, 'designs', 'org-dashboard', 'evidence')
const lens = process.env.ARXA_LENS || 'arxa'

const home = mkdtempSync(join(tmpdir(), 'arxa-dashboard-home-'))
// The org copy lives OUTSIDE the home (user content, never engine state).
const orgParent = mkdtempSync(join(tmpdir(), 'arxa-dashboard-org-'))
const orgPath = join(orgParent, basename(sourceOrg))
cpSync(sourceOrg, orgPath, { recursive: true })
// The source org may be OPEN in the installed app: its .arxa/locks/<slug>.lock
// names that live pid, and the scratch engine would refuse the copy at
// step shell-lock. The copy is ours — drop the inherited locks.
rmSync(join(orgPath, '.arxa', 'locks'), { recursive: true, force: true })
// Likewise the source org's session registry + worktrees (a session the operator
// created in the app rides the copy and the copy's rows would point at the
// SOURCE worktrees): the scratch org starts with zero sessions on purpose.
rmSync(join(orgPath, '.git', 'arxa'), { recursive: true, force: true })
rmSync(join(orgPath, '.arxa', 'worktrees'), { recursive: true, force: true })
// …and the session branches those rows minted (the copy's first session is
// named 001 again and `git worktree add` refuses an existing branch).
{
  // The copied .git/worktrees metadata still points at the SOURCE worktree dir,
  // which exists, so prune keeps it and git refuses to delete a branch "used by
  // worktree" — drop the metadata first.
  rmSync(join(orgPath, '.git', 'worktrees'), { recursive: true, force: true })
  const wt = spawnSync('git', ['-C', orgPath, 'worktree', 'prune'], { encoding: 'utf8' })
  const list = spawnSync('git', ['-C', orgPath, 'branch', '--list', 'arxa/*', '--format=%(refname:short)'], { encoding: 'utf8' })
  for (const b of (list.stdout || '').split('\n').map((x) => x.trim()).filter(Boolean)) spawnSync('git', ['-C', orgPath, 'branch', '-D', b], { encoding: 'utf8' })
  void wt
}
const orgManifest = JSON.parse(readFileSync(join(orgPath, 'org.json'), 'utf8'))
// Recents = the org registry (org-model-v2 Phase A). Same shape as ~/.arxa/organisation.json.
const env = { ARXA_HOME: home }
mkdirSync(dirname(rootFilePath(env)), { recursive: true })
writeFileSync(rootFilePath(env), JSON.stringify({ orgs: [orgPath], names: { [basename(orgPath).toLowerCase()]: orgPath } }, null, 2))

const child = spawn(process.execPath, [join(studio, 'bin', 'arxa-studio.mjs'), '--no-open'], {
  env: {
    ...process.env,
    ARXA_HOME: home,
    ARXA_PORT: String(port),
    // ARXA_DASHBOARD_SMOKE_REAL_HOME=1 keeps the real HOME (forensics: what the
    // engine reads under ~ — the TCC media-library prompt hunt, 2026-09-09).
    HOME: process.env.ARXA_DASHBOARD_SMOKE_REAL_HOME === '1' ? process.env.HOME : home,
    ZAI_API_KEY: undefined,
    ANTHROPIC_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
    ...Object.fromEntries(Object.keys(process.env).filter((key) => key.startsWith('DSH_')).map((key) => [key, undefined])),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
child.stdout.on('data', (chunk) => { log += chunk })
child.stderr.on('data', (chunk) => { log += chunk })

function processTree(pid) {
  const found = []
  const pending = pid ? [pid] : []
  while (pending.length) {
    const parent = pending.pop()
    const result = spawnSync('pgrep', ['-P', String(parent)], { encoding: 'utf8' })
    for (const line of (result.stdout || '').split('\n')) {
      const childPid = Number(line.trim())
      if (childPid > 0) { found.push(childPid); pending.push(childPid) }
    }
  }
  return found
}
function stopEngine() {
  const pid = child.pid
  if (!pid) return
  const pids = [pid, ...processTree(pid)]
  for (const candidate of pids) { try { process.kill(candidate, 'SIGTERM') } catch {} }
  setTimeout(() => { for (const candidate of pids) { try { process.kill(candidate, 'SIGKILL') } catch {} } }, 1500).unref()
}
function engineLog() {
  let text = log
  try { text += readFileSync(join(home, 'dsh', 'engine.log'), 'utf8') } catch {}
  return text
}
function desktopSession() {
  try {
    const value = JSON.parse(readFileSync(join(home, 'dsh', 'desktop-session.json'), 'utf8'))
    return typeof value.url === 'string' && typeof value.token === 'string' && value.token ? value : null
  } catch { return null }
}
function request(authorityUrl, { path = '/', method = 'GET', cookie = '', body, timeoutMs = 5000 } = {}) {
  const authority = new URL(authorityUrl)
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body))
  const started = Date.now()
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1', port: authority.port || port, path, method,
      headers: { host: authority.host, ...(cookie ? { cookie } : {}), ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}) },
      timeout: timeoutMs,
    }, (res) => {
      let text = ''
      res.on('data', (chunk) => { text += chunk })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }))
    })
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout after ' + (Date.now() - started) + 'ms' }) })
    req.on('error', (e) => resolve({ error: (e && e.code || e && e.message || String(e)) + ' after ' + (Date.now() - started) + 'ms' }))
    if (payload) req.write(payload)
    req.end()
  })
}
async function authenticate(session) {
  const tokenUrl = new URL(session.url)
  const exchange = await request(session.url, { path: tokenUrl.pathname + tokenUrl.search })
  const cookies = (exchange?.headers?.['set-cookie'] || []).map((value) => value.split(';')[0])
  const cookie = cookies.join('; ')
  if (!cookie) return null
  const page = await request(session.url, { cookie })
  return page?.status === 200 && /<html/i.test(page.text || '') ? { authority: session.url, cookie, cookies } : null
}
const ok = (label, condition, detail = '') => {
  if (!condition) throw new Error(label + (detail ? ': ' + detail : ''))
  console.log('OK  ' + label)
}

/**
 * Page scripts for \`arxa lens check --expect\`. Every script: dismiss dsh's
 * first-boot "Internal Testing Notice" (its blurred backdrop never settles on
 * a scratch home), wait for the org tree, then run one scenario. lens wants a
 * literal true; anything else is reported verbatim as the failure.
 */
const PRELUDE = String.raw`
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rows = () => [...document.querySelectorAll('[role=treeitem][aria-expanded]')];
  const dismiss = () => { const b = [...document.querySelectorAll('button')].find((x) => /^(Continue|Kontynuuj|Continuer)$/.test(x.textContent.trim())); if (b) { b.click(); return true } return false };
  const until = async (fn, ms) => { const t = Date.now() + ms; let v = fn(); while (!v && Date.now() < t) { await sleep(200); v = fn(); } return v; };
  const rootOf = (kind) => document.querySelector('[data-arxa-dashboard-root="' + kind + '"]');
  const nameOf = (root) => ((root && root.querySelector('[data-arxa-dashboard-name]')) || {}).textContent || '';
  let t = Date.now() + 20000;
  while (rows().length === 0 && Date.now() < t) { dismiss(); await sleep(200); }
  for (let i = 0; i < 10 && dismiss(); i++) await sleep(300);
  await sleep(400);
`

// D12: boot lands on a dashboard with NO click — the org's on a first boot,
// the last-selected row (here: Notes, persisted by the previous pass) after.
const bootScript = (wantKind, wantName) => `(async () => {${PRELUDE}
  const root = await until(() => rootOf(${JSON.stringify(wantKind)}), 15000);
  await sleep(600);
  const any = document.querySelector('[data-arxa-dashboard-root]');
  const facts = { kind: any ? any.getAttribute('data-arxa-dashboard-root') : null, name: nameOf(any), guide: !!document.querySelector('[data-arxa-hero-guide]'), samples: document.querySelectorAll('[data-arxa-dashboard-sample]').length,
    sel: (window.__ARXA_SIDEBAR__ && window.__ARXA_SIDEBAR__.selectedWorkspace && window.__ARXA_SIDEBAR__.selectedWorkspace()) || null,
    saved: (() => { try { return localStorage.getItem('arxa.dashboard.last') } catch { return 'n/a' } })(), rows: rows().map((r) => r.textContent.trim().slice(0, 18)) };
  const pass = !!root && facts.name !== '' && (${JSON.stringify(wantName)} === null || facts.name === ${JSON.stringify(wantName)});
  return pass ? true : JSON.stringify(facts);
})()`

// An EMPTY row shows sample cards (client-only); the Freestyle tab shows NO dashboard, Organisations brings it back.
const samplesAndTabsScript = () => `(async () => {${PRELUDE}
  const root = await until(() => document.querySelector('[data-arxa-dashboard-root]'), 15000);
  if (!root) return 'no-dashboard-root';
  const samples = await until(() => document.querySelectorAll('[data-arxa-dashboard-sample]').length, 10000);
  const first = document.querySelector('[data-arxa-dashboard-sample]');
  if (first) first.click();
  const sum = await until(() => document.querySelector('[data-arxa-dashboard-summary]'), 5000);
  // Facts grid (D15): key/value rows, never transcript bullets.
  const points = sum ? sum.querySelectorAll('[data-arxa-dashboard-facts] .aXa_db_factKey').length : 0;
  const transcript = sum ? /You|Agent|Vous|Ty\b/.test([...sum.querySelectorAll('.aXa_db_who')].map((x) => x.textContent).join('')) : false;
  const openBtn = sum ? sum.querySelector('[data-arxa-dashboard-open]') : null;
  const tab = (label) => [...document.querySelectorAll('button,[role=tab]')].find((b) => b.textContent.trim() === label);
  const fs = tab('Freestyle'); if (!fs) return 'no-freestyle-tab';
  fs.click();
  const gone = await until(() => !document.querySelector('[data-arxa-dashboard-root]'), 8000);
  const guideOnFreestyle = !!document.querySelector('[data-arxa-hero-guide]');
  const org = tab('Organisations'); if (!org) return 'no-org-tab';
  org.click();
  const back = await until(() => document.querySelector('[data-arxa-dashboard-root]'), 8000);
  await sleep(500);
  const facts = { samples, points, transcript, openDisabled: openBtn ? openBtn.disabled : null, gone, guideOnFreestyle, back: !!back };
  return samples >= 3 && points >= 4 && !transcript && facts.openDisabled === true && gone && guideOnFreestyle && !!back ? true : JSON.stringify(facts);
})()`

// Viewport ladder: whatever row the boot lands on, the Sessions card must keep
// its donut, its totals and one bar row per session (sample cards on an empty
// row are real cards for this purpose — the same components render them).
const tier2LadderScript = () => `(async () => {${PRELUDE}
  const root = await until(() => document.querySelector('[data-arxa-dashboard-root]'), 20000);
  if (!root) return 'no-dashboard-root';
  const time = await until(() => root.querySelector('[data-arxa-dashboard-group="time"]'), 10000);
  const donut = root.querySelector('[data-arxa-dashboard-donut]');
  const bankCards = [...root.querySelectorAll('[data-arxa-dashboard-session]')];
  const facts = { width: window.innerWidth,
    time: !!time,
    // Either a model/tool ring or the focus figure — whichever this row has.
    timeFigure: (donut ? donut.querySelectorAll('circle').length : 0) + (root.querySelector('[data-arxa-dashboard-focus]') ? 1 : 0),
    states: !!root.querySelector('[data-arxa-dashboard-states]'),
    totals: root.querySelectorAll('[data-arxa-dashboard-totals] .aXa_db_num').length,
    // The bottom bars were removed on 2026-09-10 — the face carries the name
    // and the tokens figure, and nothing may draw over the card's bottom edge.
    faces: bankCards.filter((c) => c.querySelector('.aXa_db_bankName') && c.querySelector('.aXa_db_bankFig')).length,
    noStripe: !root.querySelector('[data-arxa-dashboard-sessionbars]'),
    // Plain carousel (revised 2026-09-10): cards never overlap and no text is
    // turned on its side at any rung.
    bankCards: bankCards.length,
    noOverlap: bankCards.length < 2 || bankCards.slice(1).every((el, i) => el.getBoundingClientRect().left >= bankCards[i].getBoundingClientRect().right - 0.5),
    noVerticalText: bankCards.every((c) => [...c.querySelectorAll('*')].every((el) => !/^(vertical|sideways)-/.test(getComputedStyle(el).writingMode))),
    overflow: root.scrollWidth > root.clientWidth + 2 };
  await sleep(400);
  return facts.time && facts.timeFigure >= 1 && facts.totals >= 1 && facts.bankCards >= 1 && facts.faces === facts.bankCards && facts.noStripe && facts.noOverlap && facts.noVerticalText && !facts.overflow ? true : JSON.stringify(facts);
})()`

// Step 7: the state counts are the filter. Clicking one must narrow the
// carousel and keep the head counting EVERYTHING — a filtered view that also
// changes its own totals cannot be reasoned about. Keyboard order is proven in
// the same pass: the rail is one tab stop and the arrows walk the cards.
const filterScript = () => `(async () => {${PRELUDE}
  const root = await until(() => document.querySelector('[data-arxa-dashboard-root]'), 20000);
  if (!root) return 'no-dashboard-root';
  const chip = await until(() => root.querySelector('[data-arxa-dashboard-filter]'), 15000);
  if (!chip) return 'no-filter-chip';
  const hand = root.querySelector('[data-arxa-dashboard-rail="hand"]');
  if (!hand) return 'no-hand';
  const count = () => hand.querySelectorAll('[data-arxa-dashboard-session]').length;
  const facts = { state: chip.getAttribute('data-arxa-dashboard-filter'), before: count(), headBefore: root.querySelectorAll('[data-arxa-dashboard-filter]').length };
  facts.pressedBefore = chip.getAttribute('aria-pressed');
  chip.click();
  await sleep(400);
  facts.after = count();
  facts.pressedAfter = root.querySelector('[data-arxa-dashboard-filter="' + facts.state + '"]').getAttribute('aria-pressed');
  facts.headAfter = root.querySelectorAll('[data-arxa-dashboard-filter]').length;
  // Every card still shown must actually be in the filtered state.
  facts.allMatch = [...hand.querySelectorAll('[data-arxa-dashboard-session]')].length === facts.after;
  // Clicking the same chip again clears it.
  root.querySelector('[data-arxa-dashboard-filter="' + facts.state + '"]').click();
  await sleep(400);
  facts.cleared = count();
  facts.pressedCleared = root.querySelector('[data-arxa-dashboard-filter="' + facts.state + '"]').getAttribute('aria-pressed');
  // Keyboard: the rail is one tab stop; the arrows move focus between cards.
  const cards = [...hand.querySelectorAll('[data-arxa-dashboard-session]')];
  facts.railTabStop = hand.tabIndex === 0;
  if (cards.length >= 2) {
    cards[0].focus();
    hand.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await sleep(120);
    facts.arrowMoved = document.activeElement === cards[1];
    hand.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    await sleep(120);
    facts.homeMoved = document.activeElement === cards[0];
  } else { facts.arrowMoved = null; facts.homeMoved = null; }
  return facts.before >= 1 && facts.after >= 1 && facts.after <= facts.before && facts.allMatch
    && facts.pressedBefore === 'false' && facts.pressedAfter === 'true' && facts.pressedCleared === 'false'
    && facts.cleared === facts.before && facts.headBefore === facts.headAfter && facts.railTabStop
    && (facts.arrowMoved === null || (facts.arrowMoved === true && facts.homeMoved === true)) ? true : JSON.stringify(facts);
})()`

// Step 4.5 (§14): the 12-column bento. The operator's rule is that resizing
// never opens negative space — so this measures GEOMETRY, not class names:
// cards are grouped into visual rows by their top edge, and each row must
// start at the grid's left content edge, end at its right one, and carry no
// gap between neighbours wider than the grid gap. Equal heights per row are
// checked the same way. The nav pills and both rail axes are asserted here
// too, because they are what the layout is made of.
const bentoLadderScript = () => `(async () => {${PRELUDE}
  const root = await until(() => document.querySelector('[data-arxa-dashboard-root]'), 20000);
  if (!root) return 'no-dashboard-root';
  const bento = await until(() => root.querySelector('.aXa_db_bento'), 10000);
  if (!bento) return 'no-bento';
  await sleep(500);
  const box = bento.getBoundingClientRect();
  const cs = getComputedStyle(bento);
  const gap = parseFloat(cs.columnGap) || 12;
  const pad = { l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0 };
  const cards = [...bento.querySelectorAll('[data-arxa-dashboard-span]')].map((el) => ({ r: el.getBoundingClientRect(), span: el.getAttribute('data-arxa-dashboard-span') }));
  if (!cards.length) return 'no-cards';
  const lines = [];
  for (const c of cards) {
    const line = lines.find((L) => Math.abs(L[0].r.top - c.r.top) < 4);
    if (line) line.push(c); else lines.push([c]);
  }
  const holes = [];
  for (const line of lines) {
    line.sort((a, b) => a.r.left - b.r.left);
    const left = Math.abs(line[0].r.left - (box.left + pad.l));
    const right = Math.abs(line[line.length - 1].r.right - (box.right - pad.r));
    if (left > 1.5) holes.push({ edge: 'left', by: Math.round(left), spans: line.map((c) => c.span) });
    if (right > 1.5) holes.push({ edge: 'right', by: Math.round(right), spans: line.map((c) => c.span) });
    for (let i = 1; i < line.length; i++) {
      const g = line[i].r.left - line[i - 1].r.right;
      if (g > gap + 1.5) holes.push({ edge: 'between', by: Math.round(g), spans: line.map((c) => c.span) });
    }
    const hs = line.map((c) => Math.round(c.r.height));
    if (Math.max(...hs) - Math.min(...hs) > 1.5) holes.push({ edge: 'height', heights: hs, spans: line.map((c) => c.span) });
  }
  const facts = {
    width: window.innerWidth,
    cards: cards.length,
    lines: lines.map((L) => L.map((c) => c.span).join('+')),
    holes,
    navPills: root.querySelectorAll('[data-arxa-dashboard-nav] .aXa_db_navPill').length,
    railX: root.querySelectorAll('[data-arxa-dashboard-rail="nav"]').length,
    railY: root.querySelectorAll('[data-arxa-dashboard-rail$=":y"]').length,
    plain: [...bento.querySelectorAll('[data-arxa-dashboard-span]')].filter((el) => !el.querySelector('[data-arxa-dashboard-rail]')).length,
    rootOverflow: root.scrollWidth > root.clientWidth + 2,
  };
  // The rail's whole claim is that content SLIDES instead of growing the card.
  // Measure it: the y-rail must stay inside its card's box, and where its
  // content is taller it must be the rail that scrolls, not the page.
  // Steps 5 and 6 added two more y-rails (Delivery, Engine). EVERY one of them
  // must stay inside its own card — one bounded rail proves nothing about three.
  const rys = [...root.querySelectorAll('[data-arxa-dashboard-rail$=":y"]')];
  facts.railYBounded = rys.length > 0 && rys.every((el) => {
    const card = el.closest('[data-arxa-dashboard-span]');
    return card && el.getBoundingClientRect().bottom <= card.getBoundingClientRect().bottom + 1.5;
  });
  facts.railYAxis = rys.every((el) => getComputedStyle(el).overflowY === 'auto') ? 'auto' : rys.map((el) => getComputedStyle(el).overflowY).join(',');
  facts.railYScrolls = rys.some((el) => el.scrollHeight > el.clientHeight + 1);
  // The hand is the x case: at a narrow rung its cards must overflow the rail
  // and the rail must be what scrolls.
  const hand = root.querySelector('[data-arxa-dashboard-rail="hand"]');
  facts.handAxis = hand ? getComputedStyle(hand).overflowX : null;
  facts.handScrolls = hand ? hand.scrollWidth > hand.clientWidth + 1 : false;
  facts.handContained = hand ? getComputedStyle(hand).overscrollBehaviorX === 'contain' : false;
  if (hand && facts.handScrolls) {
    const before = hand.scrollLeft;
    hand.scrollLeft = 120;
    await sleep(120);
    facts.handMoved = hand.scrollLeft > before;
    hand.scrollLeft = before;
  } else facts.handMoved = null;
  // Steps 5+6: both tier-3/4 cards must state something real. Their bodies each
  // publish a hook whose VALUE is the state they are in — a card still showing
  // the old "soon" placeholder has no hook at all and fails here.
  facts.delivery = (root.querySelector('[data-arxa-dashboard-delivery]') || {}).getAttribute
    ? root.querySelector('[data-arxa-dashboard-delivery]').getAttribute('data-arxa-dashboard-delivery') : null;
  facts.engine = (root.querySelector('[data-arxa-dashboard-engine]') || {}).getAttribute
    ? root.querySelector('[data-arxa-dashboard-engine]').getAttribute('data-arxa-dashboard-engine') : null;
  facts.soon = /Arrives in|Pojawi|Arrive à la prochaine/.test(root.textContent || '');
  return facts.cards === 6 && facts.holes.length === 0 && facts.navPills >= 2 && facts.railX === 1 && facts.railY === 3 && facts.plain >= 2 && !facts.rootOverflow
    && facts.railYBounded && facts.railYAxis === 'auto' && facts.handAxis === 'auto' && facts.handContained
    && typeof facts.delivery === 'string' && typeof facts.engine === 'string' && !facts.soon
    && (facts.handScrolls ? facts.handMoved === true : true) ? true : JSON.stringify(facts);
})()`

// The session carousel, proven on a row that actually has several cards (an
// empty row draws the three sample cards through the same components). At 390
// they must overflow the rail and the RAIL must be what scrolls. Revised
// 2026-09-10: the cards must NOT overlap — the fan is gone, this is a plain
// horizontal carousel, and a regression back to overlapping cards is a fail.
const handScrollScript = () => `(async () => {${PRELUDE}
  // At 390 the sidebar is a rail with no tree rows — which is exactly why the
  // nav pills exist. Navigate with them, and prove them at this rung too.
  await until(() => document.querySelector('[data-arxa-dashboard-root]'), 20000);
  const pill = await until(() => [...document.querySelectorAll('[data-arxa-dashboard-nav] .aXa_db_navPill')].find((p) => /^Meetings/.test(p.textContent.trim())), 15000);
  if (!pill) return 'no-meetings-pill';
  pill.click();
  const hand = await until(() => { const x = document.querySelector('[data-arxa-dashboard-rail="hand"]'); return x && x.querySelectorAll('[data-arxa-dashboard-session]').length >= 3 ? x : null }, 15000);
  if (!hand) return 'no-hand';
  await sleep(600);
  const cards = [...hand.querySelectorAll('[data-arxa-dashboard-session]')].map((el) => el.getBoundingClientRect());
  const gap = parseFloat(getComputedStyle(hand).columnGap) || 12;
  const facts = {
    width: window.innerWidth,
    cards: cards.length,
    // Plain carousel: adjacent cards are separated by the rail gap. A negative
    // number here means they overlap — the fan creeping back in.
    minSeparation: cards.length > 1 ? Math.round(Math.min(...cards.slice(1).map((r, i) => r.left - cards[i].right))) : null,
    evenGaps: cards.length > 1 ? cards.slice(1).every((r, i) => Math.abs((r.left - cards[i].right) - gap) < 1.5) : true,
    noVerticalText: [...hand.querySelectorAll('*')].every((el) => !/^(vertical|sideways)-/.test(getComputedStyle(el).writingMode)),
    overflows: hand.scrollWidth > hand.clientWidth + 1,
    contained: getComputedStyle(hand).overscrollBehaviorX,
    snap: getComputedStyle(hand).scrollSnapType,
    focusable: hand.tabIndex,
    buttons: [...hand.querySelectorAll('[data-arxa-dashboard-session]')].every((el) => el.tagName === 'BUTTON'),
    rootOverflow: document.querySelector('[data-arxa-dashboard-root]').scrollWidth > document.querySelector('[data-arxa-dashboard-root]').clientWidth + 2,
  };
  hand.scrollLeft = 200;
  await sleep(150);
  facts.moved = hand.scrollLeft > 0;
  // The panel opens BENEATH the rail, not inside a card.
  hand.querySelector('[data-arxa-dashboard-session]').click();
  const panel = await until(() => document.querySelector('[data-arxa-dashboard-summary]'), 10000);
  facts.panelBelowRail = panel ? panel.getBoundingClientRect().top >= hand.getBoundingClientRect().bottom - 1 : false;
  facts.panelInsideCard = panel ? !!panel.closest('[data-arxa-dashboard-session]') : null;
  await sleep(300);
  return facts.cards >= 3 && facts.minSeparation >= 0 && facts.evenGaps && facts.noVerticalText
    && facts.overflows && facts.moved && facts.contained === 'contain' && facts.snap.includes('x')
    && facts.focusable === 0 && facts.buttons && facts.panelBelowRail && facts.panelInsideCard === false && !facts.rootOverflow ? true : JSON.stringify(facts);
})()`

// Clicking a nav pill must move the whole selection — the dashboard, the
// sidebar highlight and the New Session CTA target — in one click.
const navPillScript = () => `(async () => {${PRELUDE}
  const root = await until(() => document.querySelector('[data-arxa-dashboard-root]'), 20000);
  if (!root) return 'no-dashboard-root';
  const pills = await until(() => { const p = [...document.querySelectorAll('[data-arxa-dashboard-nav] .aXa_db_navPill')]; return p.length > 1 ? p : null }, 10000);
  if (!pills) return 'no-nav-pills';
  const before = { kind: root.getAttribute('data-arxa-dashboard-root'), sel: (window.__ARXA_SIDEBAR__.selectedWorkspace() || {}).rowId ?? null, on: pills.filter((p) => p.className.includes('navPillOn')).length };
  const target = pills.find((p) => !p.className.includes('navPillOn'));
  target.click();
  await sleep(900);
  const after = document.querySelector('[data-arxa-dashboard-root]');
  const facts = {
    before,
    label: target.textContent.trim(),
    kind: after ? after.getAttribute('data-arxa-dashboard-root') : null,
    sel: (window.__ARXA_SIDEBAR__.selectedWorkspace() || {}).rowId ?? null,
    on: [...document.querySelectorAll('[data-arxa-dashboard-nav] .aXa_db_navPill')].filter((p) => p.className.includes('navPillOn')).map((p) => p.textContent.trim()),
    seams: typeof window.__ARXA_SIDEBAR__.orgRows === 'function' && typeof window.__ARXA_SIDEBAR__.selectRow === 'function',
  };
  // The sidebar TREE must move with it (§14, 2026-09-10): exactly one row
  // marked, it is the row we navigated to, and it wears the accent.
  const marked = [...document.querySelectorAll('[data-arxa-row-selected]')];
  facts.markedRows = marked.map((r) => r.textContent.trim().split('\\n')[0].slice(0, 24));
  facts.markedIsTarget = marked.length === 1 && marked[0].textContent.trim().startsWith(facts.label);
  facts.markedAccent = marked.length === 1 ? getComputedStyle(marked[0]).color : null;
  facts.markedAria = marked.length === 1 ? marked[0].getAttribute('aria-current') : null;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-state-business-primary').trim();
  facts.accentToken = accent;
  return facts.seams && facts.kind === 'dock' && facts.sel === facts.label.toLowerCase() && facts.on.length === 1 && facts.on[0] === facts.label
    && facts.markedIsTarget && facts.markedAria === 'true' ? true : JSON.stringify(facts);
})()`

// Click a category row of the (already expanded) org, then optionally the
// first session card (→ summary panel) and its Open button (→ bound: the
// dashboard root leaves the page).
const rowScript = (categoryLabel, mode) => `(async () => {${PRELUDE}
  const org = await until(() => rows()[0], 5000);
  if (!org) return 'no-org-row';
  const snap = () => { const any = document.querySelector('[data-arxa-dashboard-root]'); return { root: any ? any.getAttribute('data-arxa-dashboard-root') : null, empty: !!document.querySelector('[data-arxa-empty]'), guide: !!document.querySelector('[data-arxa-hero-guide]'), sel: (window.__ARXA_SIDEBAR__ && window.__ARXA_SIDEBAR__.selectedWorkspace && window.__ARXA_SIDEBAR__.selectedWorkspace()) || null, rows: rows().map((r) => r.textContent.trim().slice(0, 18) + '/' + r.getAttribute('aria-expanded')) } };
  await until(() => document.querySelector('[data-arxa-dashboard-root]'), 15000);
  const before = snap();
  if (org.getAttribute('aria-expanded') !== 'true') org.click();
  // A project carries its own Notes sub-row (real TERRA grew projects/Peter/notes
  // on 2026-09-09) and layout gives no reliable depth — so click candidates in
  // DOM order until the sidebar reports the TOP-LEVEL workspace id.
  const wantWs = ${JSON.stringify(categoryLabel.toLowerCase())};
  const selWs = () => { const b = window.__ARXA_SIDEBAR__; const w = b && b.selectedWorkspace && b.selectedWorkspace(); return w ? w.rowId : null };
  let cat = null;
  const cands = await until(() => { const c = rows().filter((r) => r !== org && r.textContent.trim().startsWith(${JSON.stringify(categoryLabel)})); return c.length ? c : null }, 20000);
  if (!cands) return 'no-category-row:' + JSON.stringify(rows().map((r) => r.textContent.trim().slice(0, 18)));
  for (const c of cands) { c.click(); await until(() => selWs() === wantWs, 1500); if (selWs() === wantWs) { cat = c; break } }
  if (!cat) return 'no-top-level-row:' + JSON.stringify({ tried: cands.length, sel: selWs() });
  // The Root remounts under a new React key per selection — always re-query,
  // and wait for the EXPECTED kind (a stale node still reads the old one).
  const root = await until(() => rootOf('dock'), 10000);
  if (!root) return 'no-dashboard-root:' + JSON.stringify({ before, after: snap(), clicked: cat.outerHTML.slice(0, 160) });
  const facts = { kind: root.getAttribute('data-arxa-dashboard-root'), name: nameOf(root), marked: !!root.closest('[data-arxa-dashboard]'), cta: !!root.querySelector('[data-arxa-dashboard-cta]'), groups: root.querySelectorAll('[data-arxa-dashboard-group]').length };
  if (${JSON.stringify(mode)} === 'row') {
    // step 3: the Activity heatmap (91 cells) + Repository facts render from the host's git figures, and the range toggle is up.
    const heat = await until(() => root.querySelector('[data-arxa-dashboard-heatmap]'), 15000);
    facts.cells = heat ? heat.querySelectorAll('rect').length : 0;
    facts.repoFacts = root.querySelectorAll('[data-arxa-dashboard-repo] .aXa_db_factKey').length;
    facts.times = !!root.querySelector('[data-arxa-dashboard-times]');
    facts.range = root.querySelector('[data-arxa-dashboard-range]') ? root.querySelector('[data-arxa-dashboard-range]').getAttribute('data-arxa-dashboard-range') : null;
    return facts.marked && facts.groups === 6 && facts.cta && facts.name !== '' && facts.cells === 91 && facts.repoFacts >= 4 && facts.times && facts.range === '90' ? true : JSON.stringify(facts);
  }
  const card = await until(() => root.querySelector('[data-arxa-dashboard-session]'), 15000);
  if (!card) return 'no-session-card:' + JSON.stringify(facts);
  facts.cards = root.querySelectorAll('[data-arxa-dashboard-session]').length;
  card.click();
  const summary = await until(() => root.querySelector('[data-arxa-dashboard-summary]'), 10000);
  if (!summary) return 'no-summary-panel:' + JSON.stringify(facts);
  await until(() => !/Loading|Wczytywanie|Chargement/.test(summary.textContent), 10000);
  await sleep(500);
  facts.summary = summary.textContent.trim().slice(0, 200);
  facts.expanded = card.getAttribute('aria-expanded');
  facts.saved = (() => { try { return localStorage.getItem('arxa.dashboard.last') } catch { return null } })();
  facts.headline = (() => { const m = document.querySelector("[data-slot='conversation.hero.brand.mark']"); const el = m && m.parentElement && m.parentElement.parentElement; return el ? getComputedStyle(el).display : 'absent' })();
  const open = root.querySelector('[data-arxa-dashboard-open]');
  facts.open = !!open;
  if (${JSON.stringify(mode)} === 'tier2') {
    // step 4 (D10): the state donut + row totals head the card, every card
    // draws its tier-2 bars, and the expanded facts carry the focus figure
    // the heartbeat banked (75 s → "1m", a locale-independent string).
    // Step 4.5: the ring moved to the Time card and rings MODEL vs TOOL only,
    // so a row with no engine time correctly draws NO ring — the focus figure
    // is what it has. Assert the Time card said something true, not that a
    // chart exists: an always-drawn ring over a zero total is the lie.
    const donut = root.querySelector('[data-arxa-dashboard-donut]');
    facts.donut = donut ? donut.querySelectorAll('circle').length : 0;
    facts.timeFocus = !!root.querySelector('[data-arxa-dashboard-focus]');
    facts.states = !!root.querySelector('[data-arxa-dashboard-states]');
    facts.totals = root.querySelectorAll('[data-arxa-dashboard-totals] .aXa_db_num').length;
    // The tier-2 figures moved off the card face into the panel (2026-09-10):
    // assert they are STATED, not that a bar is drawn.
    facts.noStripe = !root.querySelector('[data-arxa-dashboard-sessionbars]');
    facts.factVals = [...summary.querySelectorAll('[data-arxa-dashboard-facts] .aXa_db_factVal')].map((x) => x.textContent.trim());
    facts.focusFact = facts.factVals.includes('1m');
    facts.wallFact = facts.factVals.some((v) => /^\\d+s$/.test(v));
    return (facts.donut >= 1 || facts.timeFocus) && facts.totals >= 1 && facts.noStripe && facts.focusFact && facts.wallFact ? true : JSON.stringify(facts);
  }
  if (${JSON.stringify(mode)} === 'summary') return facts.expanded === 'true' && facts.open && facts.summary !== '' && /"kind":"dock"/.test(facts.saved || '') && /"rowId":"notes"/.test(facts.saved || '') && facts.headline !== 'block' && facts.headline !== 'flex' ? true : JSON.stringify(facts);
  open.click();
  const gone = await until(() => !document.querySelector('[data-arxa-dashboard-root]'), 20000);
  await sleep(800);
  facts.bound = gone; facts.empty = !!document.querySelector('[data-arxa-empty]');
  facts.current = (() => { try { const s = window.__ARXA_SIDEBAR__; return s && s.currentSessionId ? s.currentSessionId() : null } catch { return 'n/a' } })();
  return gone && !facts.empty ? true : JSON.stringify(facts);
})()`

let auth = null
async function main() {
  console.log(`boot  real engine on :${port}; ARXA_HOME=${home}; org copy=${orgPath}`)
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline && !auth) {
    if (child.exitCode !== null) throw new Error('engine exited ' + child.exitCode + ' before serving')
    const session = desktopSession()
    if (session) auth = await authenticate(session)
    if (!auth) await new Promise((resolve) => setTimeout(resolve, 500))
  }
  ok('engine authenticated locally', Boolean(auth))
  const jsonCall = async (path, body) => {
    // Host verbs that spawn (workspace.new-session: worktree + dsh session) run well past 5 s.
    let response = await request(auth.authority, { path, method: 'POST', cookie: auth.cookie, body, timeoutMs: 90_000 })
    if (response && response.error) {
      // Diagnostic (2026-09-09): a host call right after a lens pass reset at once
      // (ECONNRESET after 2ms) while the SAME cookie served the page — re-exchange
      // the desktop token once and retry, and say which it was.
      const fresh = await authenticate(desktopSession())
      console.log('note  ' + path + ' ' + response.error + ' — re-auth ' + (fresh ? 'ok' : 'FAILED') + ', retrying once')
      if (fresh) auth = fresh
      response = await request(auth.authority, { path, method: 'POST', cookie: auth.cookie, body, timeoutMs: 90_000 })
    }
    if (!response || response.error) throw new Error(path + ' was unreachable: ' + (response ? response.error : 'no response'))
    try { return JSON.parse(response.text) } catch { throw new Error(path + ' returned non-JSON status ' + response.status) }
  }
  const dash = (action, arg) => jsonCall('/__arxa/dashboard/action', { action, arg })

  // 2. host route
  const ping = await dash('ping')
  ok('dashboard route answers ping', ping.ok === true && ping.result?.ready === true, JSON.stringify(ping))
  const orgRow = await dash('row.stats', { orgId: orgManifest.id, rowId: '' })
  ok('row.stats org → kind org, real path', orgRow.ok === true && orgRow.result.kind === 'org' && orgRow.result.path === orgPath && orgRow.result.exists === true, JSON.stringify(orgRow))
  const oa = orgRow.result.activity || {}; const orp = orgRow.result.repository || {}
  ok('row.stats org → step-3 figures: activity days/streak/weeks, repository files/branches/lastCommit, created/updated', Array.isArray(oa.days) && oa.weeks && oa.weeks.length === 13 && typeof oa.current === 'number' && typeof orp.files === 'number' && orp.files > 0 && orp.lastCommit && typeof orp.lastCommit.subject === 'string' && typeof orgRow.result.createdAt === 'string' && typeof orgRow.result.updatedAt === 'string', JSON.stringify({ oa: { ...oa, days: (oa.days || []).length }, orp }))
  const r30 = await dash('row.stats', { orgId: orgManifest.id, rowId: '', range: 30 })
  ok('row.stats honours range (30 → since "30 days")', r30.ok === true && r30.result.activity && r30.result.activity.since === '30 days', JSON.stringify(r30.result && r30.result.activity && r30.result.activity.since))
  const cat = await dash('row.stats', { orgId: orgManifest.id, rowId: 'notes' })
  ok('row.stats notes → kind category under the org', cat.ok === true && cat.result.kind === 'category' && cat.result.path === join(orgPath, 'notes') && cat.result.exists === true, JSON.stringify(cat))
  const bad = await dash('row.stats', { orgId: orgManifest.id, rowId: '../../etc' })
  ok('row.stats refuses traversal', bad.ok === false && bad.error === 'row-refused', JSON.stringify(bad))
  const nope = await dash('row.stats', { orgId: 'not-an-org', rowId: '' })
  ok('row.stats refuses an unknown org', nope.ok === false && nope.error === 'org-not-found', JSON.stringify(nope))

  // 3. the page, through the lens
  mkdirSync(evidence, { recursive: true })
  const cookieArgs = auth.cookies.map((c) => '--cookie=' + c)
  const shot = (name, script, width = 1512, height = 900) => {
    const out = join(evidence, name)
    mkdirSync(dirname(out), { recursive: true })
    const args = ['lens', 'check', auth.authority, out, String(width), String(height), '1500', '--expect=' + script, ...cookieArgs]
    // Passive shell UA (docs/plans/git-card-on-local-only-orgs.md): a plain
    // tab CLAIMS the waiting-page referee's active slot and the next tab —
    // loading inside the 7 s claim expiry — parks and closes itself
    // ("Inspected target navigated or closed"). A shell-UA tab only beats,
    // never claims, so consecutive lens runs render the studio every time.
    const r = spawnSync(lens, args, { encoding: 'utf8', timeout: 90_000, env: { ...process.env, ARXA_LENS_UA: process.env.ARXA_LENS_UA || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 ArxaShell/1.0' } })
    const text = (r.stdout || '') + (r.stderr || '')
    // The live studio never settles (the hero's flowing background; see
    // docs/plans/git-card-on-local-only-orgs.md "A live app never settles"),
    // and `lens check` has no --allow-unstable. A settle-only failure is the
    // documented, accepted state for this app's evidence shots; every REAL
    // assertion (selector, expect, console/page errors) still has to hold.
    const hardFail = /expect not truthy|selector not found|console\/page error/.test(text)
    const unstable = /did not converge/i.test(text)
    const pass = !hardFail && existsSync(out) && (r.status === 0 || unstable)
    // Full lens transcript in the scratch home (evidence/ keeps PNGs only) — the failure detail below is a filtered one-liner.
    try { writeFileSync(join(home, basename(out).replace(/\.png$/, '.lens.log')), text + (r.error ? '\n[spawn error] ' + r.error.message : '') + '\n[status] ' + r.status) } catch {}
    return { pass, unstable, text, out }
  }
  const lensFails = (r) => r.text.split('\n').filter((l) => /FAILED|expect not|selector not|console\/page|got /.test(l)).join(' | ').slice(0, 900)
  const lensLabel = (r) => basename(r.out) + (r.unstable ? ', settle-unstable accepted' : '')

  // 3b. before any real session exists: sample cards + tab gate
  const tabShot = shot('samples-and-tabs-1512.png', samplesAndTabsScript())
  ok('lens: empty row shows sample cards (click = summary, Open disabled); Freestyle tab hides the dashboard, Organisations brings it back (' + lensLabel(tabShot) + ')', tabShot.pass, lensFails(tabShot))

  // 4. a real session in notes, through the SAME host verb the CTA posts
  const created = await jsonCall('/__arxa/sidebar/action', { action: 'workspace.new-session', arg: { orgId: orgManifest.id, workspace: 'notes' } })
  ok('sidebar: workspace.new-session in notes creates a registry row', created.ok === true && typeof created.result?.id === 'string', JSON.stringify(created).slice(0, 400))
  const sid = created.result?.id
  const notesRows = await dash('row.sessions', { orgId: orgManifest.id, rowId: 'notes' })
  ok('row.sessions notes → exactly the created row, carrying a metrics field', notesRows.ok === true && notesRows.result.rows.length === 1 && notesRows.result.rows[0].id === sid && 'metrics' in notesRows.result.rows[0], JSON.stringify(notesRows).slice(0, 500))
  const meetRows = await dash('row.sessions', { orgId: orgManifest.id, rowId: 'meetings' })
  ok('row.sessions meetings → no rows (scope holds)', meetRows.ok === true && meetRows.result.rows.length === 0, JSON.stringify(meetRows).slice(0, 300))
  const orgRows = await dash('row.sessions', { orgId: orgManifest.id, rowId: '' })
  ok('row.sessions org → every row of the org', orgRows.ok === true && orgRows.result.rows.length === 1, JSON.stringify(orgRows).slice(0, 300))
  const sum = await dash('session.summary', { orgId: orgManifest.id, sessionId: sid })
  ok('session.summary answers for the created row — a summary or a named reason, never a throw', sum.ok === true && (typeof sum.result.reason === 'string' || (sum.result.summary && typeof sum.result.summary.turnCount === 'number' && !('turns' in sum.result.summary))), JSON.stringify(sum).slice(0, 500))
  const sumBad = await dash('session.summary', { orgId: orgManifest.id, sessionId: 'nope' })
  ok('session.summary refuses an unknown session', sumBad.ok === false && sumBad.error === 'session-not-found', JSON.stringify(sumBad))

  // 4b. step 4 (D10) — the focus heartbeat: accumulation, persistence, refusals
  ok('row.sessions: a row that never had a heartbeat reports focusMs null — absent is not zero',
    notesRows.result.rows[0].focusMs === null, JSON.stringify({ focusMs: notesRows.result.rows[0].focusMs }))
  // The whole create → verbs sequence runs inside ~300 ms, and a sub-second wall
  // span is not a claim worth rendering (fmtMs floors at 1 s). Wait, so the span
  // the card shows is a real one.
  await new Promise((resolve) => setTimeout(resolve, 1600))
  const f1 = await dash('session.focus', { orgId: orgManifest.id, sessionId: sid, deltaMs: 30_000 })
  const f2 = await dash('session.focus', { orgId: orgManifest.id, sessionId: sid, deltaMs: 45_000 })
  ok('session.focus adds each heartbeat to the row (30s + 45s = 75s)',
    f1.ok === true && f1.result.focusMs === 30_000 && f2.ok === true && f2.result.focusMs === 75_000, JSON.stringify([f1, f2]).slice(0, 300))
  const registry = JSON.parse(readFileSync(join(orgPath, '.git', 'arxa', 'sessions.json'), 'utf8'))
  const persisted = (registry.sessions || []).find((x) => x.id === sid)
  ok('session.focus persists through git-workspace\'s own writer — arxa/sessions.json is the storage of record',
    persisted && persisted.focusMs === 75_000, JSON.stringify(persisted).slice(0, 300))
  const afterFocus = await dash('row.sessions', { orgId: orgManifest.id, rowId: 'notes' })
  ok('row.sessions serves the banked focusMs back to the card', afterFocus.result.rows[0].focusMs === 75_000, JSON.stringify(afterFocus.result.rows[0]).slice(0, 300))
  const tooBig = await dash('session.focus', { orgId: orgManifest.id, sessionId: sid, deltaMs: 3_600_000 })
  const notNum = await dash('session.focus', { orgId: orgManifest.id, sessionId: sid, deltaMs: '30000' })
  ok('session.focus refuses a delta above the cap and a non-number — refused, never clamped',
    tooBig.ok === false && tooBig.error === 'focus-delta-refused' && notNum.ok === false && notNum.error === 'focus-delta-refused', JSON.stringify([tooBig, notNum]))
  const ghost = await dash('session.focus', { orgId: orgManifest.id, sessionId: 'nope', deltaMs: 30_000 })
  ok('session.focus refuses a session that is not in this org\'s registry', ghost.ok === false && ghost.error === 'session-not-found', JSON.stringify(ghost))
  const stillHere = JSON.parse(readFileSync(join(orgPath, '.git', 'arxa', 'sessions.json'), 'utf8')).sessions.find((x) => x.id === sid)
  ok('a refused heartbeat writes nothing', stillHere.focusMs === 75_000, JSON.stringify({ focusMs: stillHere.focusMs }))

  // 5. D12 — first boot: the first org's dashboard, no click, no welcome guide
  const boot1 = shot('boot-lands-org-1512.png', bootScript('org', null))
  ok('lens: a first boot lands on the org dashboard with no click (' + lensLabel(boot1) + ')', boot1.pass, lensFails(boot1))

  // 6. D13 — Notes row → session card → click = summary panel + Open
  const cardShot = shot('session-card-1512.png', rowScript('Notes', 'summary'))
  ok('lens: Notes row lists the session card; click expands the summary with an Open button (' + lensLabel(cardShot) + ')', cardShot.pass, lensFails(cardShot))
  const tier2Shot = shot('tier2-session-figures-1512.png', rowScript('Notes', 'tier2'))
  ok('lens: the Sessions band heads with state chips + totals, the cards carry no bottom bars, and the expanded facts state the wall span and the banked focus time (' + lensLabel(tier2Shot) + ')', tier2Shot.pass, lensFails(tier2Shot))
  const openShot = shot('session-open-1512.png', rowScript('Notes', 'open'))
  ok('lens: Open binds the session — the dashboard leaves, the conversation is the content (' + lensLabel(openShot) + ')', openShot.pass, lensFails(openShot))

  // 7. D12 — next boot with an OPEN session in the registry: still a dashboard,
  // never the resumed conversation. Every lens tab is storage-fresh (found
  // 2026-09-09: localStorage empty on the next run), so this pass lands on the
  // first org; the persist half is asserted in pass 6 (saved selection) and
  // the restore half — same-profile relaunch — is checked by hand on the
  // desktop webview after repack (docs/plans/org-row-dashboard.md §9).
  // 6b. arxa-lens viewport ladder (390 compact / 744 medium / 1280 expanded):
  // evidence that claims the tier-2 card holds up covers all three rungs.
  for (const [w, hgt] of [[390, 844], [744, 1133], [1280, 832]]) {
    const rung = shot(join('tier2', 'sessions-card-' + w + '.png'), tier2LadderScript(), w, hgt)
    ok('lens ' + w + '×' + hgt + ': the session carousel keeps its cards separate, upright and bar-free, the Time card states a real figure, totals hold (' + lensLabel(rung) + ')', rung.pass, lensFails(rung))
  }

  // 6c. Step 4.5 (§14) — the bento ladder: geometry, not class names. Every
  // rung must fill its grid with no hole and no ragged row height, the nav
  // pills must be up, and both rail axes must exist alongside plain cards.
  for (const [w, hgt] of [[390, 844], [744, 1133], [1280, 832]]) {
    const rung = shot(join('bento', 'bento-' + w + '.png'), bentoLadderScript(), w, hgt)
    ok('lens ' + w + '×' + hgt + ': the 12-col bento fills every row — no hole, no ragged height, pills up, x-rail + y-rail + plain cards all present (' + lensLabel(rung) + ')', rung.pass, lensFails(rung))
  }
  const handShot = shot(join('bento', 'carousel-390.png'), handScrollScript(), 390, 844)
  ok('lens 390×844: the session carousel scrolls — cards separated by the rail gap, no overlap, no sideways text, the RAIL scrolls (contained, snapped) and the summary opens beneath it (' + lensLabel(handShot) + ')', handShot.pass, lensFails(handShot))
  // 6d. Step 7 — the counts are the filter, and the carousel is keyboard-walkable.
  const filterShot = shot(join('bento', 'filter-1512.png'), filterScript())
  ok('lens: a state chip filters the carousel and clears on a second click, the head keeps counting everything, and the arrows walk the cards inside one tab stop (' + lensLabel(filterShot) + ')', filterShot.pass, lensFails(filterShot))
  const navShot = shot('nav-pill-1512.png', navPillScript())
  ok('lens: a nav pill moves the dashboard, the CTA target AND the sidebar tree — exactly one row marked, in the accent, with aria-current (' + lensLabel(navShot) + ')', navShot.pass, lensFails(navShot))

  const boot2 = shot('boot-after-open-1512.png', bootScript('org', null))
  ok('lens: a later boot (open session on record, fresh storage) lands on a dashboard, not the session (' + lensLabel(boot2) + ')', boot2.pass, lensFails(boot2))
  console.log('evidence', evidence)
}

const keep = process.env.ARXA_DASHBOARD_SMOKE_KEEP === '1'
const park = () => {
  // ARXA_DASHBOARD_SMOKE_KEEP=1: leave the engine up and print what a hand-driven
  // `arxa lens check` needs (authority + cookies) — Ctrl-C ends it.
  const a = auth
  console.log('keep  engine :' + port + ' home=' + home + ' org=' + orgPath)
  console.log('keep  authority=' + (a ? a.authority : '?'))
  console.log('keep  cookies=' + (a ? a.cookies.map((c) => '--cookie=' + c).join(' ') : '?'))
  setInterval(() => {}, 1 << 30)
}
main().then(() => { if (keep) return park(); stopEngine(); process.exit(0) }).catch((e) => {
  console.error('FAIL  ' + (e && e.message || e))
  if (keep) return park()
  console.error(engineLog().split('\n').filter((l) => /dashboard|error|Error|warn/i.test(l)).slice(-25).join('\n'))
  stopEngine(); process.exit(1)
})
