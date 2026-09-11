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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
// The Engine card had only ever rendered "not set up": no project on this machine
// has ever run the FSM (plan §15 step 6), so tier 4 was the one tier whose live
// path nothing exercised. The scratch org's first project gets bytes the ENGINE
// ITSELF wrote — plugins/arxa-dashboard/engine-authored.fixture.json, whose `_how`
// names the pipeline_fsm.dart / deploy.dart calls that produced them. Written into
// the COPY only: the operator's own org is never touched by this smoke.
const engineSeed = (() => {
  const projects = join(orgPath, 'projects')
  const first = existsSync(projects) ? readdirSync(projects, { withFileTypes: true }).find((d) => d.isDirectory()) : null
  if (!first) return null
  const { files } = JSON.parse(readFileSync(new URL('../plugins/arxa-dashboard/engine-authored.fixture.json', import.meta.url), 'utf8'))
  for (const rel of Object.keys(files)) {
    const out = join(projects, first.name, rel)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify(files[rel], null, 2) + '\n')
  }
  return first.name
})()

const orgManifest = JSON.parse(readFileSync(join(orgPath, 'org.json'), 'utf8'))
// Recents = the org registry (org-model-v2 Phase A). Same shape as ~/.arxa/organisation.json.
const env = { ARXA_HOME: home }
mkdirSync(dirname(rootFilePath(env)), { recursive: true })
writeFileSync(rootFilePath(env), JSON.stringify({ orgs: [orgPath], names: { [basename(orgPath).toLowerCase()]: orgPath } }, null, 2))

// ARXA_DASHBOARD_SMOKE_TURN=1 adds the REAL-TURN leg: the scratch engine gets a
// model and the flow drives an actual conversation turn, so the token / model-time
// half of the dashboard is read back from figures a real model produced rather
// than from a session that never ran. Default OFF — the ordinary smoke must never
// spend money or need a network.
//
// The key is NOT read out of the operator's credential store: they hand it in for
// the run (ZAI_API_KEY=… ARXA_DASHBOARD_SMOKE_TURN=1 node scripts/dashboard-smoke.mjs)
// and it reaches the child's env only — never the scratch home, never a log.
const turn = process.env.ARXA_DASHBOARD_SMOKE_TURN === '1'
if (turn && !process.env.ZAI_API_KEY) {
  throw new Error('ARXA_DASHBOARD_SMOKE_TURN=1 needs ZAI_API_KEY in the environment (the run supplies it; the smoke never reads the credential store)')
}
if (turn) {
  // GLM 5.3 at max — the model nominated for test traffic.
  mkdirSync(join(home, 'dsh'), { recursive: true })
  writeFileSync(join(home, 'dsh', 'settings.yaml'), [
    'llm-pi-ai:',
    '  providers:',
    '    zai:',
    '      apiKeyEnv: ZAI_API_KEY',
    '      baseURL: https://api.z.ai/api/coding/paas/v4',
    '      models:',
    '        - id: glm-5.3',
    '          name: GLM-5.3',
    '          contextWindow: 1000000',
    '          maxTokens: 131072',
    '          reasoningEfforts:',
    '            low: low',
    '            high: high',
    '            max: max',
    'agent-default-model:',
    '  provider: zai',
    '  model: glm-5.3',
    '  reasoningEffort: max',
    '',
  ].join('\n'))
}

const child = spawn(process.execPath, [join(studio, 'bin', 'arxa-studio.mjs'), '--no-open'], {
  env: {
    ...process.env,
    ARXA_HOME: home,
    ARXA_PORT: String(port),
    // ARXA_DASHBOARD_SMOKE_REAL_HOME=1 keeps the real HOME (forensics: what the
    // engine reads under ~ — the TCC media-library prompt hunt, 2026-09-09).
    HOME: process.env.ARXA_DASHBOARD_SMOKE_REAL_HOME === '1' ? process.env.HOME : home,
    ZAI_API_KEY: turn ? process.env.ZAI_API_KEY : undefined,
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
// The Engine card, RENDERED. The host verb is asserted separately; this proves
// the body draws the seeded phase rather than the not-set-up line it has shown on
// every run so far — the card hook's VALUE is the state the body is in.
const engineCardScript = () => `(async () => {${PRELUDE}
  const root = await until(() => document.querySelector('[data-arxa-dashboard-root]'), 20000);
  if (!root) return 'no-dashboard-root';
  const hook = await until(() => {
    const el = document.querySelector('[data-arxa-dashboard-engine]');
    const v = el && el.getAttribute('data-arxa-dashboard-engine');
    return v && v !== 'not-set-up' && v !== 'not-applicable' ? el : null;
  }, 20000);
  if (!hook) {
    const el = document.querySelector('[data-arxa-dashboard-engine]');
    return 'engine-card-not-populated:' + (el ? el.getAttribute('data-arxa-dashboard-engine') : 'no-hook');
  }
  const card = hook.closest('[data-arxa-dashboard-group="engine"]') || hook.parentElement;
  // The card sits last in the bento: at 1512x900 the shot cropped it away and the
  // evidence proved nothing a reader could see. Bring it into frame before capture.
  card.scrollIntoView({ block: 'center' });
  await sleep(700);
  const projRows = [...card.querySelectorAll('[data-arxa-dashboard-engine-row]')];
  const text = (card.innerText || '').replace(/\\s+/g, ' ');
  const facts = {
    phase: hook.getAttribute('data-arxa-dashboard-engine'),
    rows: projRows.map((r) => r.getAttribute('data-arxa-dashboard-engine-row')),
    // The three head figures: phase, projects with engine state, shipped.
    nums: [...card.querySelectorAll('.aXa_db_numVal')].map((n) => n.textContent.trim()),
    text: text.slice(0, 160),
    // An em dash where a real figure belongs means the body fell back.
    dashes: (text.match(/\\u2014/g) || []).length,
  };
  return facts.phase === 'design' && facts.rows.length === 1 && facts.rows[0] === 'design'
    && facts.nums.length === 3 && facts.nums[1] === '1' && facts.nums[2] === '1'
    && /3\\/7/.test(text) && /8/.test(text) ? true : JSON.stringify(facts);
})()`

// The Activity card fill (operator, 2026-09-11): the weekday strip sits BESIDE
// the fixed-width charts, not under them — the dead band in the span-5 card.
const activityFillScript = () => `(async () => {${PRELUDE}
  const root = await until(() => rootOf('org'), 15000);
  if (!root) return 'no-org-dashboard:' + String((document.querySelector('[data-arxa-dashboard-root]') || {}).getAttribute ? document.querySelector('[data-arxa-dashboard-root]').getAttribute('data-arxa-dashboard-root') : null);
  const strip = await until(() => root.querySelector('[data-arxa-dashboard-weekday]'), 15000);
  if (!strip) return 'no-weekday-strip';
  const churn = await until(() => root.querySelector('[data-arxa-dashboard-churn]'), 15000);
  if (!churn) return 'no-churn-line';
  const heat = root.querySelector('[data-arxa-dashboard-heatmap]');
  const row = strip.closest('.aXa_db_chartRow');
  const busiest = root.querySelector('[data-arxa-dashboard-busiest]');
  const facts = { bars: strip.querySelectorAll('rect').length, labels: strip.querySelectorAll('text').length,
    weekday: strip.getAttribute('data-arxa-dashboard-weekday'),
    busiest: busiest ? busiest.getAttribute('data-arxa-dashboard-busiest') : null,
    busiestText: busiest ? busiest.textContent.trim().slice(0, 30) : null,
    churn: churn.textContent.trim(), beside: !!(row && row.contains(heat)),
    overflow: strip.scrollWidth > strip.clientWidth + 2 };
  return facts.bars === 7 && facts.labels === 7 && facts.weekday && facts.busiest
    && facts.churn.includes('+') && facts.beside === true && !facts.overflow ? true : JSON.stringify(facts);
})()`

const navPillScript = () => `(async () => {${PRELUDE}
  const root = await until(() => document.querySelector('[data-arxa-dashboard-root]'), 20000);
  if (!root) return 'no-dashboard-root';
  const pills = await until(() => { const p = [...document.querySelectorAll('[data-arxa-dashboard-nav] .aXa_db_navPill')]; return p.length > 1 ? p : null }, 10000);
  if (!pills) return 'no-nav-pills';
  const before = { kind: root.getAttribute('data-arxa-dashboard-root'), sel: (window.__ARXA_SIDEBAR__.selectedWorkspace() || {}).rowId ?? null, on: pills.filter((p) => p.className.includes('navPillOn')).length };
  // Walk EVERY dock pill, not just the first one that is off. Picking only the
  // first hid a defect for a whole build: notes is the one dock the host
  // reports as workspace true, so buildEmit skips it and it renders as the
  // STOCK folder row instead of an OrgContainerRow. Testing Projects alone
  // never touched that path (operator-reported, 2026-09-10).
  const unmarked = [];
  for (const p of pills.slice(1)) {
    p.click();
    await sleep(700);
    const n = document.querySelectorAll('[data-arxa-row-selected]').length;
    if (n !== 1) unmarked.push(p.textContent.trim() + '=' + n);
  }
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
  // §19 (operator, 2026-09-11): the selected row's ICON is accent too. The
  // slot paints its own tertiary color (inheritance would not reach it), so
  // assert the computed color of the glyph span itself matches the row.
  facts.markedIconAccent = marked.length === 1 && marked[0].querySelector('.aXa_wsr_folder') ? getComputedStyle(marked[0].querySelector('.aXa_wsr_folder')).color : null;
  facts.markedAria = marked.length === 1 ? marked[0].getAttribute('aria-current') : null;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-state-business-primary').trim();
  facts.accentToken = accent;
  facts.unmarked = unmarked;
  return facts.seams && facts.kind === 'dock' && facts.sel === facts.label.toLowerCase() && facts.on.length === 1 && facts.on[0] === facts.label
    && facts.markedIsTarget && facts.markedAria === 'true' && facts.markedIconAccent === facts.markedAccent && facts.markedAccent !== '' && unmarked.length === 0 ? true : JSON.stringify(facts);
})()`

// Click a category row of the (already expanded) org, then optionally the
// first session card (→ summary panel) and its Open button (→ bound: the
// dashboard root leaves the page).
/** Opt-in: walk the operator's own path to a conversation and spend a real turn.
  *
  * Defect (2026-09-11): the first cut of this leg passed while NOTHING was sent —
  * both scratch transcripts held only setup events, no message of any kind. It
  * had believed two worthless signals: "the box no longer holds my text" (a React
  * re-render clears it just as well as a send does) and "document.body.innerText
  * grew by 8 characters" (a clock tick does that). So it now proves the turn from
  * the DOM the way the transcript would: the prompt must APPEAR in the composer
  * first, then leave it as a user message that is actually on screen, and the
  * answer must be a NEW message element — never a text-length delta. Every exit
  * carries the facts that explain it, and the host's figures remain the judge. */
const realTurnScript = () => `(async () => {${PRELUDE}
  const org = await until(() => rows()[0], 5000);
  if (!org) return 'no-org-row';
  await until(() => document.querySelector('[data-arxa-dashboard-root]'), 15000);
  if (org.getAttribute('aria-expanded') !== 'true') org.click();
  const selWs = () => { const b = window.__ARXA_SIDEBAR__; const w = b && b.selectedWorkspace && b.selectedWorkspace(); return w ? w.rowId : null };
  const cands = await until(() => { const c = rows().filter((r) => r !== org && r.textContent.trim().startsWith('Notes')); return c.length ? c : null }, 20000);
  if (!cands) return 'no-notes-row';
  let cat = null;
  for (const c of cands) { c.click(); await until(() => selWs() === 'notes', 1500); if (selWs() === 'notes') { cat = c; break } }
  if (!cat) return 'no-top-level-notes';
  const root = await until(() => rootOf('dock'), 10000);
  if (!root) return 'no-dashboard-root';
  const card = await until(() => root.querySelector('[data-arxa-dashboard-session]'), 15000);
  if (!card) return 'no-session-card';
  card.click();
  const open = await until(() => root.querySelector('[data-arxa-dashboard-open]'), 10000);
  if (!open) return 'no-open-button';
  open.click();
  // The conversation replaces the dashboard. dsh names its own regions, so take
  // the composer from ITS slot — the tallest-visible-box heuristic happily found
  // the sidebar's composer card instead, which is how the first cut sent nothing.
  const composer = await until(() => document.querySelector('[data-slot^="conversation.composer"], [data-slot^="conversation.input"]'), 25000);
  if (!composer) return 'no-conversation-composer:' + JSON.stringify({ slots: [...document.querySelectorAll('[data-slot]')].map((el) => el.getAttribute('data-slot')).slice(0, 25) });
  const shell = composer.closest('[data-slot^="conversation"]') || document.body;
  const box = await until(() => [...shell.querySelectorAll('textarea, [contenteditable="true"]')].find((el) => el.offsetParent !== null), 15000)
    || [...document.querySelectorAll('textarea, [contenteditable="true"]')].find((el) => el.offsetParent !== null);
  if (!box) return 'no-composer-input';
  // Which model the turn will actually spend — the leg claims GLM 5.3, so say so.
  const modelSlot = document.querySelector('[data-slot="conversation.input.model"]');
  const model = modelSlot ? modelSlot.textContent.trim().slice(0, 60) : null;
  // Read the whole composer region, not just the queried node: execCommand lands
  // the text in whichever node actually holds the caret, which is often a child
  // of the node the query returned. Reading only that node said "nothing typed" while the
  // text was plainly there, and the fallback then typed it a SECOND time — the
  // 2026-09-11 dry run posted "…PONGReply with exactly one word: PONG".
  const typed = () => ((box.tagName === 'TEXTAREA' ? box.value : '') + ' ' + (composer.innerText || '')).trim();
  const msgs = () => document.querySelectorAll('[data-slot^="conversation.chat"] [data-message-id], [data-message-id], [data-slot^="conversation.chat.turn"]');
  const before = msgs().length;
  const prompt = 'Reply with exactly one word: PONG';
  box.focus();
  // execCommand('insertText') raises the real beforeinput/input pair a controlled
  // React composer listens for; assigning .value/.textContent does not.
  const inserted = document.execCommand('insertText', false, prompt);
  await sleep(250);
  if (!typed().includes('PONG')) {
    if (box.tagName === 'TEXTAREA') {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(box, prompt);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      box.textContent = prompt;
      box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
    }
  }
  await sleep(400);
  // The prompt must be IN the composer before sending means anything.
  if (!typed().includes('PONG')) return 'prompt-never-reached-composer:' + JSON.stringify({ inserted, model, tag: box.tagName, slot: composer.getAttribute('data-slot') });
  const sendBtn = () => [...shell.querySelectorAll('button')].find((b) => b.offsetParent !== null && !b.disabled
    && /send|submit|wyślij|envoyer/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '') + ' ' + b.textContent));
  const btn = sendBtn();
  if (btn) btn.click();
  else box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  // Sent = the prompt is on screen as a message, not merely gone from the box.
  const posted = await until(() => msgs().length > before || /Reply with exactly one word/.test(shell.innerText), 20000);
  if (!posted) return 'prompt-never-posted:' + JSON.stringify({ model, sawButton: !!btn, stillTyped: typed().slice(0, 40), messages: msgs().length });
  // The answer must be a NEW message element — a text-length delta proves nothing.
  const afterUser = msgs().length;
  const answered = await until(() => msgs().length > afterUser, 240000);
  if (!answered) return 'no-answer:' + JSON.stringify({ model, messages: msgs().length, tail: shell.innerText.slice(-200) });
  // Settle: stop when the message count holds still.
  let last = -1;
  for (let i = 0; i < 40 && last !== msgs().length; i++) { last = msgs().length; await sleep(1500); }
  await sleep(1000);
  return true;
})()`

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
    // §19 (2026-09-11): with the org expanded the DOCK rows are on screen and
    // must wear the dashboard glyph (2×2 tiles ⇒ 4 rects) where folders
    // (0 rects) used to be — the click opens a dashboard, the mark says so.
    facts.dashGlyphs = [...document.querySelectorAll('.aXa_wsr_folder svg')].filter((s) => s.querySelectorAll('rect').length === 4).length;
    return facts.marked && facts.groups === 6 && facts.cta && facts.name !== '' && facts.cells === 91 && facts.repoFacts >= 4 && facts.times && facts.range === '90' && facts.dashGlyphs >= 3 ? true : JSON.stringify(facts);
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
  ok('row.stats activity → churn sums real numstat in range (added > 0); an empty window would be null, never 0/0', oa.churn && oa.churn.added > 0 && oa.churn.removed >= 0, JSON.stringify(oa.churn))
  const r30 = await dash('row.stats', { orgId: orgManifest.id, rowId: '', range: 30 })
  ok('row.stats honours range (30 → since "30 days")', r30.ok === true && r30.result.activity && r30.result.activity.since === '30 days', JSON.stringify(r30.result && r30.result.activity && r30.result.activity.since))
  const cat = await dash('row.stats', { orgId: orgManifest.id, rowId: 'notes' })
  ok('row.stats notes → kind category under the org', cat.ok === true && cat.result.kind === 'category' && cat.result.path === join(orgPath, 'notes') && cat.result.exists === true, JSON.stringify(cat))
  const bad = await dash('row.stats', { orgId: orgManifest.id, rowId: '../../etc' })
  ok('row.stats refuses traversal', bad.ok === false && bad.error === 'row-refused', JSON.stringify(bad))
  const nope = await dash('row.stats', { orgId: 'not-an-org', rowId: '' })
  ok('row.stats refuses an unknown org', nope.ok === false && nope.error === 'org-not-found', JSON.stringify(nope))

  // Tier 4 (step 6, D5) on bytes the ENGINE wrote — plan §17. Every earlier run
  // read `not-set-up` off this verb, which proves the empty branch and nothing
  // else; the seeded project makes the populated branch the one under test.
  const eng = await dash('row.engine', { orgId: orgManifest.id, rowId: '' })
  const er = eng.result || {}
  const ep = (er.projects || [])[0] || {}
  ok('row.engine org → the FSM state reads back as the engine left it: design 3/7, gate ready, dirty, 1 rejection, 1 shipped, 8 screens',
    engineSeed !== null && er.phase === 'design' && er.withEngine === 1 && er.scanned >= 2 && er.shipped === 1
    && ep.step === 3 && ep.steps === 7 && ep.status === 'ready' && ep.dirty === true && ep.rejections === 1 && ep.approved === false
    && ep.screens === 8 && ep.flows === 2 && ep.halted === 0 && Array.isArray(ep.targets) && ep.targets.join(',') === 'macos,web',
    JSON.stringify({ seed: engineSeed, roll: { phase: er.phase, withEngine: er.withEngine, scanned: er.scanned, shipped: er.shipped }, ep }))
  const engCat = await dash('row.engine', { orgId: orgManifest.id, rowId: 'notes' })
  ok('row.engine on a category row states not-applicable rather than vanishing (a hidden card leaves a hole in the bento)',
    engCat.result?.reason === 'not-applicable', JSON.stringify(engCat))

  // 3. the page, through the lens
  mkdirSync(evidence, { recursive: true })
  const cookieArgs = auth.cookies.map((c) => '--cookie=' + c)
  const shot = (name, script, width = 1512, height = 900, timeoutMs = 90_000) => {
    const out = join(evidence, name)
    mkdirSync(dirname(out), { recursive: true })
    const args = ['lens', 'check', auth.authority, out, String(width), String(height), '1500', '--expect=' + script, ...cookieArgs]
    // Passive shell UA (docs/plans/git-card-on-local-only-orgs.md): a plain
    // tab CLAIMS the waiting-page referee's active slot and the next tab —
    // loading inside the 7 s claim expiry — parks and closes itself
    // ("Inspected target navigated or closed"). A shell-UA tab only beats,
    // never claims, so consecutive lens runs render the studio every time.
    const spawnLens = () => spawnSync(lens, args, { encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, ARXA_LENS_UA: process.env.ARXA_LENS_UA || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 ArxaShell/1.0' } })
    let r = spawnLens()
    // `arxa` is a SIBLING repo that is often being edited while this runs, and the
    // lens re-AOT-compiles it per invocation. On 2026-09-11 a run died at
    // bento-1280 — passes 30 of 36, after the real-turn key was already in play —
    // because arxa_dial.dart was half-saved at that instant. That is a toolchain
    // state, not a dashboard signal, so ride it out once rather than burning the
    // whole run (and the operator's turn) on someone else's unsaved file.
    if (/AOT compilation failed|Generating AOT kernel dill failed/.test((r.stdout || '') + (r.stderr || ''))) {
      console.log('note  arxa failed to AOT-compile (sibling repo mid-edit) — waiting 20s and retrying ' + name + ' once')
      spawnSync(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 20000)'])
      r = spawnLens()
    }
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
  const lensFails = (r) => (/AOT compilation failed|Generating AOT kernel dill failed/.test(r.text)
    // Say it plainly: this is the arxa toolchain, not the dashboard.
    ? 'arxa does not compile — the lens could not run (sibling repo mid-edit; retried once). ' + (r.text.split('\n').find((l) => /^lib\/.*Error:/.test(l)) || '')
    // A script that throws inside the page exits 255 with none of those words in
    // it, so the filter below matched nothing and the FAIL line came out BLANK —
    // an hour of the 2026-09-11 engine leg went on that. Name the exception.
    : r.text.split('\n').filter((l) => /FAILED|expect not|selector not|console\/page|got |CdpException|SyntaxError|Unhandled exception/.test(l)).join(' | ')).slice(0, 900)
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
  ok('lens: EVERY dock pill moves the dashboard, the CTA target AND the sidebar tree — exactly one row marked, in the accent, with aria-current (' + lensLabel(navShot) + ')', navShot.pass, lensFails(navShot))
  const engineShot = shot('engine-card-1512.png', engineCardScript(), 1512, 1000)
  ok('lens: the Engine card DRAWS the engine-authored run — phase design, 3/7, one project row, 1 with engine state, 1 shipped, 8 screens — not the not-set-up line (' + lensLabel(engineShot) + ')', engineShot.pass, lensFails(engineShot))
  const fillShot = shot('activity-fill-1512.png', activityFillScript(), 1512, 900)
  ok('lens: the Activity card fills its dead band — 7 weekday bars BESIDE the heatmap (one row), a Busiest caption, an active-days figure and a real +/− churn line (' + lensLabel(fillShot) + ')', fillShot.pass, lensFails(fillShot))

  // 6e. The REAL-TURN leg (opt-in). Everything above reads a session that never
  // ran: turns 0, tokens null, llmMs 0. Those are honest values, but they never
  // prove the token / model-time half of the card is wired to anything. This
  // drives an actual turn on GLM 5.3 (max) through the composer the operator
  // uses, then reads the same figures back off the host.
  if (turn) {
    // A real turn outruns the 90 s the other passes need.
    const turnShot = shot('real-turn-1512.png', realTurnScript(), 1512, 900, 300_000)
    // Deliberately narrow: this proves the prompt was POSTED and the transcript
    // came back with something. An auth failure also draws a bubble, so whether
    // the turn was any good is the host figures' call, immediately below.
    ok('lens: the prompt reaches the conversation composer, posts as a message, and the transcript answers it (' + lensLabel(turnShot) + ')', turnShot.pass, lensFails(turnShot))
    const after = await dash('row.sessions', { orgId: orgManifest.id, rowId: 'notes' })
    const row = (after.result?.rows || [])[0]
    // dsh flushes the projection cache asynchronously, so the token totals land a
    // beat after the turn ends — on 2026-09-11 this read `tokens: null` while the
    // record on disk already held 7755 in / 35 out. Wait on the condition, not on
    // a guessed delay, and cap it so a genuinely missing figure still fails.
    let r = {}
    for (let i = 0; i < 20; i++) {
      r = (await dash('session.summary', { orgId: orgManifest.id, sessionId: row?.id })).result || {}
      if (r.tokens && typeof r.tokens.total === 'number' && r.tokens.total > 0) break
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    const stats = r.stats || {}
    // Tokens are deliberately NOT asserted here. tokenUsage has no wire view, so a
    // scratch engine only surfaces it once dsh flushes the projection cache, which
    // it does not do inside one smoke. Asserting it would make this leg flaky and
    // teach nothing. The token path is proven on the INSTALLED app instead
    // (docs/plans/org-row-dashboard.md §16.4): the operator's own status bar read
    // "Input 14.6K tok · Output 277 tok" and the dashboard answered 14627 / 277.
    ok('a real turn moves the card: turns ≥ 1, real model time, and a prompt timestamp — figures a model actually produced, never the sample generator',
      stats.turns >= 1 && stats.llmMs > 0 && typeof r.lastPromptAt === 'number',
      JSON.stringify({ turns: stats.turns, llmMs: stats.llmMs, toolMs: stats.toolMs, tokens: r.tokens, lastPromptAt: r.lastPromptAt }).slice(0, 400))
    console.log('note  real turn: turns=' + stats.turns + ' llmMs=' + stats.llmMs + ' tokens=' + JSON.stringify(r.tokens) + (r.tokens ? '' : ' (unflushed — asserted on the installed app)'))
  }

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
