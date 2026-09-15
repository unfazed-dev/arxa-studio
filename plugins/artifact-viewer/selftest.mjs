// arxa-artifact-viewer selftest — run: node plugins/artifact-viewer/selftest.mjs
// Task 1 scope: identity, settings guards (D82 cap + D81 token ceiling), and
// the WIRING CROSS-CHECK — the mcp-apps lesson is that a package-name mismatch
// between patch row, profile package.json, BY_NAME_PLUGINS and the packed-mode
// copy list silently loads nothing. These assertions make any of the four
// drifting a loud red.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(dirname(here)) // repo checkout root (selftests never run packed)

const mod = await import('./lib/index.js')

// 1. identity
assert.equal(mod.name, 'arxa-artifact-viewer', 'plugin name')
assert.equal(typeof mod.apply, 'function', 'apply is a function')
assert.equal(mod.TOKEN_TTL_CEILING_SECONDS, 120, 'D81 token ceiling is 120 s')

// 2. settings defaults + guards
assert.deepEqual(mod.defaultSettings(), { maxEditBytes: 5_000_000, tokenTtlSeconds: 120 })
const withDefaults = mod.SCHEMA({})
assert.equal(withDefaults.maxEditBytes, 5_000_000, 'schema applies maxEditBytes default')
assert.equal(withDefaults.tokenTtlSeconds, 120, 'schema applies tokenTtlSeconds default')
let ttlBehavior
try {
  const parsed = mod.SCHEMA({ tokenTtlSeconds: 999 })
  ttlBehavior = parsed.tokenTtlSeconds
} catch {
  ttlBehavior = 'rejected'
}
assert.ok(
  ttlBehavior === 'rejected' || ttlBehavior <= mod.TOKEN_TTL_CEILING_SECONDS,
  'a 999 s TTL must be rejected or clamped to the D81 ceiling, got: ' + ttlBehavior)

// 3. wiring cross-check (patch row <-> launcher <-> package name)
const pkg = JSON.parse(fs.readFileSync(join(here, 'package.json'), 'utf8'))
assert.equal(pkg.name, 'arxa-artifact-viewer')
assert.equal(pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform, 'web',
  'dsh.client declares platform web')
assert.ok(Array.isArray(pkg.dsh && pkg.dsh.client && pkg.dsh.client.inject) &&
  pkg.dsh.client.inject.length > 0, 'dsh.client declares its inject packages')
assert.ok(fs.existsSync(join(here, 'lib', 'client.js')), 'client half exists for discovery')

const patch = fs.readFileSync(join(root, 'profile', 'cordis.patch.yml'), 'utf8')
assert.match(patch, /- id: arxa-artifact-viewer\r?\n    name: arxa-artifact-viewer/,
  'patch row registers the plugin by package name')

const launcher = fs.readFileSync(join(root, 'bin', 'arxa-studio.mjs'), 'utf8')
assert.match(launcher, /\['arxa-artifact-viewer', artifactViewerDir\]/,
  'the plugin is in the one PROFILE_PLUGINS list (profile dep AND packed copy)')
assert.match(launcher, /dependencies: Object\.fromEntries\(PROFILE_PLUGINS\.map/,
  'profile package.json deps are derived from that list, never retyped')
assert.match(launcher, /BY_NAME_PLUGINS = \[[^\]]*'arxa-artifact-viewer'/,
  'BY_NAME_PLUGINS carries the package name')
assert.match(launcher, /\['arxa-artifact-viewer',\s*artifactViewerDir\]/,
  'packed mode copies the plugin directory')

// THE GRAFT (0.1.5 bump, 2026-09-15): the arxa-frame column is RETIRED — the
// stock ui-layout row is back, and the editor renders INSIDE the stock right
// sidebar under two seats. The old generated-frame drift gate went with the
// column; the insight-css lift survives (now single-module: 0.1.5 merged
// ToolDetails into ToolRow).
{
  assert.ok(!fs.existsSync(join(root, 'plugins', 'arxa-frame')), 'arxa-frame is gone (stock ui-layout restored)')
  assert.ok(!fs.existsSync(join(root, 'scripts', 'gen-frame.mjs')), 'the frame generator went with it')
  const genIns = execFileSync(process.execPath, [join(root, 'scripts', 'gen-insight-css.mjs'), '--check'], { cwd: root })
  assert.match(String(genIns), /--check OK/, 'insight-css drift gate: the lifted stock tool copy matches the bundle')
  const clientSrc = fs.readFileSync(join(here, 'lib', 'client.js'), 'utf8')
  assert.doesNotMatch(clientSrc, /inject\('shell\.overlay'/, 'viewer never floats over the frame again (D88)')
  assert.match(clientSrc, /inject\('sidebar\.right\.tab\.document'/, 'editor registers into the stock document-preview seat')
  assert.doesNotMatch(clientSrc, /inject\('sidebar\.right\.pane\.tab'/, "the 'arxa' tab seat is retired — session files ride the stock viewer (0.5.0)")
  assert.match(clientSrc, /ctx\.documentPreviews\.register\(\{/, 'documentPreviews renderer declared')
  assert.match(clientSrc, /priority: 'extension'/, 'renderer rides the extension band (beats the builtin code preview)')
  assert.doesNotMatch(clientSrc, /ctx\.sidebarRightTabs\.register\(\{/, "no arxa page tab in the registry — the stock 'text' kind hosts files")
  const noCommentSrc = clientSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.doesNotMatch(noCommentSrc, /openViewer|closeViewer/, 'no layout viewer-column face survives the retirement (comments may narrate)')
}
// D89/D90 lanes exist server-side
{
  const wt = fs.readFileSync(join(here, 'lib', 'wt-api.js'), 'utf8')
  assert.match(wt, /scope: 'wt-read'/, 'worktree read lane token class (D89)')
  assert.match(wt, /scope: 'tree-read'/, 'tree listing token class (D90)')
  assert.match(wt, /scope: 'changes-read'/, 'session changes token class')
  const idx = fs.readFileSync(join(here, 'lib', 'index.js'), 'utf8')
  for (const p of ['/__arxa/artifacts/wt', '/__arxa/artifacts/tree', '/__arxa/artifacts/session-changes']) {
    assert.ok(idx.includes("'" + p + "'"), 'route registered: ' + p)
  }
  // T5 routing at 0.6.0: every open lands in the arxa strip (the shell owns
  // the rightbar column); stock produced-file cards stay native on the
  // not-owning lane, and the chip capture returns ONLY while the strip owns
  // the column — a stock openResource into the hidden surface is a dead
  // click. The av-open lane keeps worktree-first resolution with the org
  // fallback for tree/file rows.
  const t5client = fs.readFileSync(join(here, 'lib', 'client.js'), 'utf8')
  assert.match(t5client, /data-produced-files-row\] button\[title\]/, 'the chip interceptor is back, scoped to ownership (0.6.0)')
  assert.match(t5client, /if \(!col \|\| !col\.hasAttribute\('data-arxa-owns'\)\) return/, 'chip capture fires only while the strip owns the column')
  assert.match(t5client, /if \(ok\) return/, 'wt lane wins; org lane is the fallback on a miss')
  // Phase 1 conformance rebuild (docs/plans/dsh-plugin-ui-conformance.md):
  // store-based ingress replaces the D93 retry ladder + parked payload.
  assert.match(t5client, /const openArtifact = async \(relPathArg, rootId = null\) => \{/, 'openArtifact takes the relPath and optional root identity')
  assert.match(t5client, /String\(relPathArg \|\| ''\)/, 'the debug path-input form and its draft state are gone')
  const t5code = t5client.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.doesNotMatch(t5code, /__ARXA_AV_PENDING__|for \(const delay of \[0, 120, 400, 1000, 2000\]\)|setInterval\(/,
    'retry ladder, parked window global, and the 4s session poll are all gone (comments may narrate)')
  assert.doesNotMatch(t5code, /__ARXA_AV_CHIP_INTERCEPT__|__ARXA_SESSIONS__|__ARXA_AV_DEBUG__/,
    'window debug globals are gone (ctx.effect disposal replaces the install-once flag)')
  assert.match(t5client, /function createAvStore\(\)/, 'ingress store exists')
  assert.match(t5client, /store\.request\(\{ sessionId: sid, rootId: detail\.rootId \|\| null, relPath: detail\.relPath, t0: Math\.round\(performance\.now\(\)\) \}\)/, 'apply() parks root-aware opens in the store, stamped with the click time (0.6.0: sid resolved with the live-session fallback)')
  assert.match(t5client, /store\.consume\(\)/, 'the ViewerShell consumes the pending open (panels receive their open as a request prop)')
  const saveStart = t5client.indexOf('const save = async (force = false) =>')
  const saveEnd = t5client.indexOf('/** Auto-save:', saveStart)
  const saveSrc = t5client.slice(saveStart, saveEnd)
  assert.ok(saveSrc.indexOf('content = docRef.current.getText()') < saveSrc.indexOf('await fetchToken('),
    'save freezes document bytes before the token wait so navigation cannot cross-write files')
  const saveTokenAt = saveSrc.indexOf('await fetchToken(')
  const savePostAt = saveSrc.indexOf('const res = await fetch(WRITE_ROUTE', saveTokenAt)
  const saveBodyAt = saveSrc.indexOf('const body = await res.json()', savePostAt)
  assert.doesNotMatch(saveSrc.slice(saveTokenAt, savePostAt), /request !== openRequestRef\.current/,
    'navigation does not cancel a frozen autosave before its write reaches the old target')
  assert.match(saveSrc.slice(saveBodyAt), /if \(request !== openRequestRef\.current\) return/,
    'a completed old-target save cannot alter the newly opened viewer UI')
  const changesStart = t5client.indexOf('const refreshChanges = React.useCallback')
  const changesEnd = t5client.indexOf('React.useEffect(() => {', changesStart)
  const changesSrc = t5client.slice(changesStart, changesEnd)
  assert.doesNotMatch(changesSrc, /ensureSession\(/,
    'passive changes refresh never creates an org session when a root file opens')
  assert.match(changesSrc, /if \(!sessionId\) \{ setChanges\(\[\]\); return \}/,
    'changes refresh is empty when no current session already exists')
  // 0.6.0 "own the column": the openResource routing is GONE — every open
  // lands in the shell's strip, session-less, no conversation jump.
  assert.doesNotMatch(t5client, /openResource\(/, 'no openResource routing survives — the strip hosts every file open (0.6.0)')
  assert.doesNotMatch(t5client, /openCreated/, 'the ingress never navigates into a conversation — no teleport, ever')
  assert.doesNotMatch(t5client, /function sessionFileAddress|const dshSessionId =/, 'the dsh address builders died with the openResource lane (parseFileAddress stays for DocumentBody)')
  assert.match(t5client, /function parseFileAddress\(addr\)/, 'DocumentBody still decodes the stock resource address')
  assert.match(t5client, /const live = sessions && sessions\.list \? sessions\.list\.getSnapshot\(\)\.current : null/,
    'a bare org-lane payload borrows the LIVE current session (wt-first resolution, 0.5.1 order)')
  assert.match(t5client, /detail\.sessionId \|\| live \|\| store\.getSnapshot\(\)\.sessionId/,
    'session resolution order: explicit payload, live current session, store fallback')
  assert.match(t5client, /suppressAutoOpenUntil = Date\.now\(\) \+ 10000/,
    'an explicit open suppresses the auto-open observer for 10s — the clicked file takes focus (0.5.1)')
  assert.match(t5client, /if \(Date\.now\(\) < suppressAutoOpenUntil\) \{ armed = false; return \}/,
    'the observer yields to a recent explicit open instead of popping the restored row')
  assert.doesNotMatch(t5client, /openTab\('arxa'\)/, "the arxa tab is retired — no openTab('arxa') survives")
  assert.match(t5client, /bare: true/, 'DocumentBody renders the panel chromeless inside the stock tab (stock chrome owns identity)')
  // 0.6.0 column occupant pins.
  assert.match(t5client, /function ViewerShell\(/, 'the ViewerShell owns the column chrome (tab strip + document header)')
  assert.doesNotMatch(t5client, /aXa_av_sheet|stockChrome/, 'the 0.5.x overlay sheet and its chrome branch are deleted')
  assert.match(t5client, /document\.querySelector\('\[data-rightbar-col\]'\)/, 'the shell locates the frame\'s rightbar track node')
  assert.match(t5client, /ReactDOM\.createPortal\(\s*h\('div', \{ className: 'aXa_av_colHost'/, 'the shell portals into the column — in-flow, no overlap by construction')
  assert.match(t5client, /\[data-rightbar-col\]\[data-arxa-owns\] > :not\(\.aXa_av_colHost\)\{display:none!important\}/, 'ownership CSS: the stock surface hides while the strip holds tabs')
  assert.match(t5client, /colNode\.setAttribute\('data-arxa-owns', ''\)/, 'ownership attribute set on the column node')
  assert.match(t5client, /L\.openRightbar\(true, false\)/, 'opens reveal the stock track (frame owns geometry + drag handle)')
  assert.match(t5client, /L\.closeRightbar\(\)/, 'collapse/last-tab-close reports hidden to the frame')
  assert.match(t5client, /'arxa-av-tabs:v1:'/, 'tabs persist per org in localStorage')
  assert.match(t5client, /P\.MarkdownText/, "md renders through dsh's exact MarkdownText primitive")
  assert.match(t5client, /data-arxa-renderer-menu/, 'the renderer dropdown anchors the stock P.Menu (openWith parity)')
  assert.match(t5client, /IconWrapFill16/, 'the wrap toggle wears the stock wrap glyph')
  assert.match(t5client, /aXa_av_edgeChip/, 'a session-less edge chip is the way back in while collapsed')
  assert.match(t5client, /data-arxa-md/, 'the rendered-md lane is distinguishable in the DOM for probes')
  assert.doesNotMatch(t5client, /aXa_av_head|aXa_av_chip|aXa_av_prettierMark|aXa_av_sheetBar/, 'the old aXa viewer chrome (header/actions/sheet bar) is gone')
  assert.match(t5client, /sessions\.list\.subscribe/, 'session tracking subscribes the dsh sessions snapshot store')
  assert.match(t5client, /MutationObserver/, 'first-produced-file-per-turn auto-open observer present')
  assert.match(t5client, /ctx\.locale\.register\(NS, \{ en, pl, fr \}\)/, 'locale NS registered with en/pl/fr dictionaries')
  assert.match(t5client, /const inject = \['slots', 'connection', 'sessions', 'locale', 'documentPreviews', 'sidebarRight', 'layout'\]/,
    'inject declares the faces the graft still uses (sidebarRightTabs went with the arxa tab; layout stays for openRightbar reveal)')
  assert.ok((t5client.match(/ctx\.effect\(/g) || []).length >= 5, 'every side effect sits inside ctx.effect (>=5)')
  for (const prim of ['P.StateDot', 'P.Tooltip', 'P.Button', 'P.IconCloseOutline16', 'P.IconRefreshOutline16']) {
    assert.ok(t5client.includes(prim), 'primitives aboard: ' + prim)
  }
  // The generated insight-css region is a verbatim stock copy (its #0000 is a transparent scrollbar border) — the rule is about OUR css.
  const handWritten = t5client.replace(/\/\/ >>> insight-css[\s\S]*?\/\/ <<< insight-css/, "")
  const hexes = handWritten.match(/#[0-9a-fA-F]{3,8}\b/g) || []
  assert.deepEqual([...new Set(hexes)].sort(), ['#fff'],
    'no hardcoded hex colors — the only white left is the pdf/iframe document surface')
  assert.match(t5client, /--dsw-alias-border-l2|--dsw-alias-label-error|--dsw-alias-brand-primary/, 'real theme tokens used')
  // ---- Phase 4 A3: the insight branch -----------------------------------------
  // Client-side only. The three insight.* server actions land in the sidebar's
  // lib/index.js on another agent's clock; asserting them here would make this
  // gate red for work that is not this file's.
  assert.match(t5client, /if \(detail\.kind === 'insight'\)/, 'the ingress accepts an insight payload alongside a file open')
  assert.match(t5client, /store\.request\(\{ kind: 'insight', view: detail\.view, sessionId: detail\.sessionId \|\| null, orgId: detail\.orgId \|\| null \}\)/,
    'the insight payload is parked in the SAME store as a file open')
  assert.match(t5client, /if \(!detail\.view\) return/, 'an insight event without a view is refused, not opened blank')
  assert.match(t5client, /if \(p\.kind === 'insight'\)/, 'the panel consumes the insight payload before the file flow')
  assert.match(t5client, /phase: 'insight', view: p\.view/, 'the consume branch sets the insight phase')
  assert.match(t5client, /\} else if \(state\.phase === 'insight'\) \{\n\s*body = h\(InsightPanel,/,
    'the body renders InsightPanel for the insight phase and the file flow otherwise')
  // `given` joined the face when jobs stopped round-tripping: JobView is
  // push-only, so those rows arrive from the sidebar's store via the event.
  assert.match(t5client, /function InsightPanel\(\{ t, view, sessionId, orgId, given \}\)/, 'InsightPanel exists with the five-prop face')
  assert.match(t5client, /body: JSON\.stringify\(\{ action, arg \}\)/, 'InsightPanel posts {action,arg} — the same shape the git card uses')
  assert.match(t5client, /const arg = view === 'sessions' \? \{ orgId \} : \(wantFresh \? \{ sessionId, fresh: true \} : \{ sessionId \}\)/,
    'sessions is org-keyed; every other view is session-keyed, plus the fresh flag the refresh button arms')
  for (const a of ["'insight.' + view"]) assert.ok(t5client.includes(a), 'insight action name is derived from the view: ' + a)
  for (const a of ["'session.open'", "'session.rename'", "'session.archive'"]) {
    assert.ok(t5client.includes(a), 'sessions rows reuse the EXISTING sidebar action, no new one: ' + a)
  }
  assert.match(t5client, /res\.reason === 'unavailable'/, "an 'unavailable' reason renders a sentence, never an empty report")
  assert.match(t5client, /t\('insight\.unavailable'\)/, 'the unavailable string goes through t()')
  assert.match(t5client, /aXa_av_streakGrid/, 'streak renders a CSS grid of day cells')
  assert.ok((t5client.match(/aXa_av_streakCell\[data-level=/g) || []).length === 3
    && t5client.includes(".aXa_av_streakCell{"), 'four streak intensity steps (base + 3 levels), token-derived')
  assert.match(t5client, /h\(P\.StateDot, \{ state: ciState\(run\) \}\)/, 'CI rows carry a StateDot, not a hand-rolled dot')
  // ---- Part B (git-card-stock-dock-rebuild §4): stock tool-details grammar ---
  assert.match(t5client, /const INSIGHT_CSS = "/, 'INSIGHT_CSS is the generated verbatim copy of the stock ToolRow+ToolDetails CSS')
  assert.match(t5client, /tag\.textContent = css \+ INSIGHT_CSS/, 'the copied CSS ships in the same style tag as the panel CSS')
  assert.ok(!t5client.includes('o3BgMG_') && !t5client.includes('xDAfVq_'), 'no stock hashed prefix leaks — every class is aXa_ins_')
  assert.match(t5client, /'data-arxa-insight': view/, 'the insight root carries the single [data-arxa-insight] marker (no per-element markers)')
  assert.match(t5client, /className: I\.cardBody \+ ' ' \+ I\.root/, 'the report container is ToolDetails.cardBody')
  assert.match(t5client, /h\(P\.DisclosureRow, \{\n\s*key, icon, title, open: false, expandable: false/, 'runs and sessions are stock DisclosureRows (non-expanding)')
  assert.match(t5client, /rowClassName: I\.row, leadingClassName: I\.leading, titleClassName: I\.title, chevronClassName: I\.chevron/, 'the row wears the copied ToolRow classes')
  assert.match(t5client, /ioSection\('current', t\('insight\.streak\.current'\)/, 'streak metrics are ToolRow IN/OUT sections')
  assert.match(t5client, /className: I\.empty \}/, 'empty / loading / unavailable use ToolDetails.empty')
  assert.match(t5client, /className: I\.inspectButton/, 'session actions wear the stock inspect-button face')
  for (const dead of ['aXa_av_insightRow', 'aXa_av_insightBtn', 'aXa_av_insightChip', 'aXa_av_insightNums', 'aXa_av_idle\'} }, h(\'div\', { className: \'aXa_av_hint\'} }, t(\'insight']) {
    assert.ok(!t5client.includes(dead), 'hand-rolled insight styling is gone: ' + dead)
  }
  // t5code is the comment-stripped source: the rule is about CODE, and the
  // comment next to the inline field names the banned call to explain itself.
  assert.doesNotMatch(t5code, /window\.prompt/, 'the sessions rename is an inline field — Tauri WKWebView has no window.prompt')
  assert.match(t5client, /className: 'aXa_av_insightInput'/, 'the rename field is a real input in the row')
  // The refresh button has to BYPASS the host's 60s cache, not just re-ask for
  // the value it already has. It arms a ref that load() consumes into the arg;
  // an earlier version only bumped the tick and silently re-served the cache.
  assert.match(t5client, /freshRef\.current = true; setTick/,
    'the review refresh button arms the fresh flag before re-loading')
  assert.match(t5client, /wantFresh \? \{ sessionId, fresh: true \} : \{ sessionId \}/,
    'load() sends fresh:true to the host when the refresh button armed it')
  assert.match(t5client, /if \(open && state\.phase === 'insight'\) \{ setState\(\(st\) => \(\{ \.\.\.st, sessionId: id \}\)\) \}/,
    'a session switch re-points an open insight tab (0.6.0: tabs persist across session switches — the close-on-switch directive died with the single-file column)')
  // `insight.title.ci` is deliberately absent: D4 retired the standalone CI
  // view and the review surface absorbed it. The `insight.ci.*` ROW strings
  // stay — the CI group inside the review view still renders those buttons.
  for (const key of ['insight.title.streak', 'insight.title.review', 'insight.title.sessions', 'insight.loading',
    'insight.unavailable', 'insight.streak.current', 'insight.streak.longest', 'insight.streak.empty', 'insight.streak.days',
    'insight.ci.open', 'insight.ci.rerun', 'insight.ci.cancel', 'insight.sessions.open', 'insight.sessions.rename',
    'insight.sessions.archive', 'insight.sessions.empty', 'insight.seatRequired',
    // the review surface (D1-D7)
    'insight.review.needs', 'insight.review.reviews', 'insight.review.threads', 'insight.review.comments',
    'insight.review.issues', 'insight.review.commits', 'insight.review.ci', 'insight.review.empty',
    'insight.review.nopr', 'insight.review.refresh', 'insight.review.reply', 'insight.review.resolve',
    'insight.review.unresolve', 'insight.review.resolved', 'insight.review.outdated', 'insight.review.bots',
    'insight.review.openPr', 'insight.review.changes-requested', 'insight.review.unresolved-thread',
    'insight.review.mention', 'insight.review.ci-failed']) {
    const n = (t5client.match(new RegExp("'" + key.replace(/\./g, '\\.') + "':", 'g')) || []).length
    assert.equal(n, 3, 'insight string "' + key + '" is in all three dicts (en/pl/fr), found ' + n)
  }
  // The host's org-seat refusal ("insight.<view> serves session seats") is a
  // dev string — the panel translates that one and passes every other fault
  // through verbatim so real errors stay diagnosable.
  assert.match(t5client, /\/serves session seats\/\.test\(m\) \? t\('insight\.seatRequired'\) : m/,
    'insight error phase maps the seat refusal to insight.seatRequired and keeps other messages raw')
  assert.equal((t5client.match(/TODO native review \(conformance decision 4\)/g) || []).length, 2,
    'the machine-drafted pl/fr insight strings are flagged for native review')
  // wt lane accepts an absolute chip path that lives INSIDE the worktree,
  // and still refuses escapes (D91 re-base, escape checks intact)
  assert.match(wt, /path\.isAbsolute\(relPath\)/, 'absolute chip paths are re-based onto the worktree root')
  assert.match(wt, /'escape'\), \{ code: 'ESCAPE' \}\)\n/, 'escape check retained after the re-base')
  // 2026-09-01 user report trio: session-scoped close, toolbar tooltip
  // placement (the maximize button died with the arxa tab, 0.5.0).
  {
    const calls = (t5client.match(/P\.Tooltip, \{/g) || []).length
    const bottom = (t5client.match(/side: 'bottom'/g) || []).length
    assert.ok(calls > 0 && calls === bottom, 'every viewer tooltip pins side bottom (' + bottom + '/' + calls + ') — toolbar tooltips must never cover sibling buttons')
  }
  assert.match(t5client, /seenSessionRef\.current = id/, 'session tracker records every id incl. null (0.6.0: the switch no longer closes tabs — each wt tab carries its own session)')
  assert.doesNotMatch(t5client, /if \(frameProps\.close\) frameProps\.close\(\)\n\s*setOpen\(false\)/, 'the close-on-session-switch reset is gone — tabs persist (0.6.0)')
  // The 0.1.5 retirement: the session mirror no longer calls a layout face —
  // the right sidebar's own per-session tab scoping does the closing now.
  assert.doesNotMatch(t5client, /if \(seenSessionRef\.current && id && seenSessionRef\.current !== id\)/, 'the over-guarded session->session-only reset is gone')
}

console.log('arxa-artifact-viewer selftest: GREEN')

// ---- Task 2: per-org GET-only server --------------------------------------
import http from 'node:http'
import os from 'node:os'
import path2 from 'node:path'
import { createOrgServer, resolveInside } from './lib/org-server.js'
import { readOpenOrg, startOrgFollow } from './lib/follow.js'

function req(port, urlPath, { method = 'GET', host } = {}) {
  return new Promise((resolve, rejectP) => {
    const r = http.request({
      host: '127.0.0.1', port, path: urlPath, method,
      headers: host ? { host } : {},
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'), raw: Buffer.concat(chunks) }))
    })
    r.on('error', rejectP)
    r.end()
  })
}

const org = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-org-'))
fs.mkdirSync(path2.join(org, 'notes'), { recursive: true })
fs.writeFileSync(path2.join(org, 'notes', 'a.md'), '# hello\n')
fs.writeFileSync(path2.join(org, 'app.js'), 'console.log(1)\n')
fs.writeFileSync(path2.join(org, 'img.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
fs.writeFileSync(path2.join(org, 'vid.mp4'), Buffer.alloc(64, 7))

const outside = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-out-'))
fs.writeFileSync(path2.join(outside, 'secret.txt'), 'top secret')
fs.symlinkSync(path2.join(outside, 'secret.txt'), path2.join(org, 'leak.txt'))

// containment unit checks
assert.equal(resolveInside(org, 'notes/a.md'), path2.join(org, 'notes', 'a.md'))
assert.throws(() => resolveInside(org, '../x'), /escape|ESCAPE/i)
assert.throws(() => resolveInside(org, '/etc/passwd'), /escape|ESCAPE/i)

const srv = await createOrgServer({ orgRoot: org, orgSlug: 'test', verify: () => true })
const { port, origin } = srv
assert.ok(origin.startsWith('http://org-test.localhost:'), 'origin uses the org hostname')
const H = 'org-test.localhost:' + port

const r1 = await req(port, '/notes/a.md', { host: H })
assert.equal(r1.status, 200)
assert.equal(r1.headers['content-type'], 'text/markdown; charset=utf-8')
assert.equal(r1.headers['access-control-allow-origin'], '*', 'CORS: studio page reads org-origin responses')
assert.equal(r1.body, '# hello\n')
assert.equal(r1.headers['cache-control'], 'no-store')
// Host match is case-INSENSITIVE (2026-09-01, found live): browsers send the
// Host header lowercased per the URL spec — a case-preserved slug (D79,
// org-RESTO) must still resolve, else every browser file fetch 403'd.
const r1b = await req(port, '/notes/a.md', { host: 'org-TEST.localhost:' + port })
assert.equal(r1b.status, 200, 'lowercased Host header still matches the org server')
const r1c = await req(port, '/notes/a.md', { host: 'evil-TEST.localhost:' + port })
assert.equal(r1c.status, 403, 'a different org host is still rejected')

assert.equal((await req(port, '/img.png', { host: H })).headers['content-type'], 'image/png')
assert.equal((await req(port, '/app.js', { host: H })).status, 200)
assert.equal((await req(port, '/', { host: H })).status, 404, 'directories never list')
assert.equal((await req(port, '/missing.md', { host: H })).status, 404)
assert.equal((await req(port, '/notes/a.md', { method: 'POST', host: H })).status, 405, 'GET-only (D81)')
const srv2 = await createOrgServer({ orgRoot: org, orgSlug: 'test2' }) // verify omitted: deny-default
const H2 = 'org-test2.localhost:' + srv2.port
assert.equal((await req(srv2.port, '/notes/a.md', { host: H2 })).status, 403, 'no verifier -> deny-default')
assert.equal((await req(srv2.port, '/healthz', { host: H2 })).status, 200, 'healthz needs no token')
await srv2.close()
assert.equal((await req(port, '/healthz')).status, 200, 'healthz needs no host/token')
const trav = await req(port, '/%2e%2e/secret.txt', { host: H })
assert.ok(trav.status === 403 || trav.status === 404,
  'encoded traversal never serves content, got: ' + trav.status)
assert.equal((await req(port, '/leak.txt', { host: H })).status, 403, 'symlink escape rejected')
assert.equal((await req(port, '/notes/a.md', { host: 'evil.example:1234' })).status, 403, 'host allowlist')

// Dual-stack loopback (2026-09-01, first-open "Load failed"): macOS answers
// every *.localhost name with ::1 FIRST (synthesized loopback), and the
// desktop WKWebView's first cross-origin fetch to a v4-only listener died on
// the refused v6 address with a raw "TypeError: Load failed" while every
// later fetch reused the warm pool — the "switch to another file and back"
// workaround. The org server must answer over BOTH loopback families.
{
  const v6 = await new Promise((resolve) => {
    const rq = http.request({ host: '::1', port, path: '/healthz', headers: { host: H } }, (res) => {
      res.resume()
      resolve(res.statusCode)
    })
    rq.on('error', () => resolve(0))
    rq.end()
  })
  assert.equal(v6, 200, 'org server answers over ::1 (dual-stack loopback)')
  // Port exclusivity (2026-09-02 flake): the old '::' wildcard let a foreign
  // 127.0.0.1:N listener coexist on our port (BSD dual-stack rule) and steal
  // v4 traffic. With explicit ::1 + 127.0.0.1 binds a second bind of either
  // family on N must fail EADDRINUSE — nobody can sit in front of us.
  for (const fam of ['::1', '127.0.0.1']) {
    const code = await new Promise((resolve) => {
      const probe = http.createServer(() => {})
      probe.once('error', (e) => resolve(e.code))
      probe.once('listening', () => probe.close(() => resolve('LISTENED')))
      probe.listen(port, fam)
    })
    assert.equal(code, 'EADDRINUSE', 'org port is exclusive on ' + fam + ' (got ' + code + ')')
  }
}

const rr = await req(port, '/vid.mp4', { host: H, method: 'GET' })
Object.assign(rr.req ||= {}, {})
const rr2 = await new Promise((resolve, rejectP) => {
  const rq = http.request({ host: '127.0.0.1', port, path: '/vid.mp4',
    headers: { host: H, range: 'bytes=0-3' } }, (res) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers,
      raw: Buffer.concat(chunks) }))
  })
  rq.on('error', rejectP)
  rq.end()
})
assert.equal(rr2.status, 206, 'single range served')
assert.equal(rr2.headers['content-range'], 'bytes 0-3/64')
assert.equal(rr2.raw.length, 4)

await srv.close()
let refused = false
try { await req(port, '/healthz') } catch { refused = true }
assert.ok(refused, 'server actually stops on close()')

// ---- Task 2: open-org follow loop -----------------------------------------
const home = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-home-'))
const orgA = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-a-'))
const orgB = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-b-'))
const env = { ...process.env, ARXA_HOME: home }
fs.writeFileSync(path2.join(home, 'organisation.json'), JSON.stringify({ orgs: [orgA, orgB] }))
const lockOf = (o) => path2.join(o, '.arxa', 'locks', path2.basename(o) + '.lock')
const writeLock = (o, holder) => {
  fs.mkdirSync(path2.join(o, '.arxa', 'locks'), { recursive: true })
  fs.writeFileSync(lockOf(o), JSON.stringify(holder))
}
assert.equal(readOpenOrg(env), null, 'no lock -> nothing open')

const started = []
const closed = []
const fake = { createServer: async ({ orgRoot }) => {
  started.push(orgRoot)
  return { origin: 'fake://' + orgRoot, close: async () => { closed.push(orgRoot) } }
} }
const sleep = (ms) => new Promise((r2) => setTimeout(r2, ms))
writeLock(orgA, { pid: process.pid, orgPath: orgA })
const f = startOrgFollow({ env, intervalMs: 15, createServer: fake.createServer })
await sleep(70)
assert.equal(f.current() && f.current().orgPath, orgA, 'serves the locked org')

writeLock(orgB, { pid: process.pid, orgPath: orgB })
fs.unlinkSync(lockOf(orgA))
await sleep(70)
assert.equal(f.current() && f.current().orgPath, orgB, 'switches org on lock change')
assert.deepEqual(closed, [orgA], 'old org server closed on switch')

writeLock(orgA, { pid: 999999999, orgPath: orgA })
await sleep(70)
assert.equal(f.current() && f.current().orgPath, orgB, 'dead-pid lock is not an open org')

await f.stop()
assert.deepEqual(closed, [orgA, orgB], 'stop() closes the serving org')

console.log('arxa-artifact-viewer selftest: GREEN (server + follow)');

// ---- Task 3: token classes, secret, verify glue, issue route ---------------
import { issueToken, verifyToken, loadOrCreateSecret, readVerifyFor } from './lib/tokens.js'
import { createTokenRoutes } from './lib/index.js'

// identity guard (theme-accent D84 lesson: undeclared inject kills cold boots)
assert.deepEqual(mod.inject, ['webServer'], 'declares inject: ["webServer"]')

// tokens: round-trip + bindings
const secret = 'unit-test-secret'
const tk = issueToken({ secret, scope: 'read', relPath: 'notes/a.md', orgPath: org, ttlSeconds: 30 })
assert.equal(verifyToken(tk, { secret, scope: 'read', relPath: 'notes/a.md', orgPath: org }).ok, true)
assert.equal(verifyToken(tk, { secret, scope: 'read', relPath: 'app.js', orgPath: org }).ok, false, 'wrong rel rejected')
assert.equal(verifyToken(tk, { secret, scope: 'write', worktreeId: 'w1' }).ok, false, 'wrong scope rejected')
assert.equal(verifyToken(tk, { secret, scope: 'read', relPath: 'notes/a.md', orgPath: '/somewhere/else' }).ok, false, 'wrong org rejected')
assert.equal(verifyToken(tk, { secret: 'other', scope: 'read', relPath: 'notes/a.md', orgPath: org }).ok, false, 'wrong secret rejected')
assert.equal(verifyToken(tk.slice(0, -2) + 'xx', { secret, scope: 'read', relPath: 'notes/a.md', orgPath: org }).ok, false, 'tampered rejected')
const past = issueToken({ secret, scope: 'read', relPath: 'x', ttlSeconds: 5, now: () => 1000 })
assert.equal(verifyToken(past, { secret, scope: 'read', relPath: 'x', now: () => 2000 }).reason, 'expired', 'expired rejected')
const clamped = issueToken({ secret, scope: 'read', relPath: 'x', ttlSeconds: 9999, now: () => 1000 })
const body = JSON.parse(Buffer.from(clamped.split('.')[0], 'base64url').toString('utf8'))
assert.ok(body.exp - body.iat <= 120, 'ttl clamped to the D81 ceiling')
const wtk = issueToken({ secret, scope: 'write', worktreeId: 'sess-1', ttlSeconds: 30 })
assert.equal(verifyToken(wtk, { secret, scope: 'write', worktreeId: 'sess-1' }).ok, true)
assert.equal(verifyToken(wtk, { secret, scope: 'write', worktreeId: 'sess-2' }).ok, false, 'write token bound to worktree')

// secret file: created 0600, idempotent
const envHome = { ...process.env, ARXA_HOME: fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-keys-')) }
const s1 = loadOrCreateSecret(envHome)
const s2 = loadOrCreateSecret(envHome)
assert.equal(s1, s2, 'secret idempotent')
assert.equal(fs.statSync(path2.join(envHome.ARXA_HOME, 'keys', 'artifact-viewer-secret')).mode & 0o777, 0o600, 'secret is 0600')

// verify glue against a live server
const vorg = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-vorg-'))
fs.writeFileSync(path2.join(vorg, 'a.md'), 'hello')
const vsrv = await createOrgServer({ orgRoot: vorg, orgSlug: 'vtest', verify: readVerifyFor({ secret, orgPath: vorg }) })
const VH = 'org-vtest.localhost:' + vsrv.port
const goodT = issueToken({ secret, scope: 'read', relPath: 'a.md', orgPath: vorg, ttlSeconds: 30 })
assert.equal((await req(vsrv.port, '/a.md', { host: VH })).status, 403, 'no token -> 403')
assert.equal((await req(vsrv.port, '/a.md?avt=' + goodT, { host: VH })).status, 200, 'valid token -> 200')
const otherT = issueToken({ secret, scope: 'read', relPath: 'b.md', orgPath: vorg, ttlSeconds: 30 })
assert.equal((await req(vsrv.port, '/a.md?avt=' + otherT, { host: VH })).status, 403, 'token for another file -> 403')
const otherOrgT = issueToken({ secret, scope: 'read', relPath: 'a.md', orgPath: '/elsewhere', ttlSeconds: 30 })
assert.equal((await req(vsrv.port, '/a.md?avt=' + otherOrgT, { host: VH })).status, 403, 'token for another org -> 403')
await vsrv.close()

// issue route over a fake ctx
const routeHome = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-route-'))
const routeOrg = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-rorg-'))
const routeEnv = { ...process.env, ARXA_HOME: routeHome }
fs.writeFileSync(path2.join(routeHome, 'organisation.json'), JSON.stringify({ orgs: [routeOrg] }))
fs.mkdirSync(path2.join(routeOrg, '.arxa', 'locks'), { recursive: true })
fs.writeFileSync(path2.join(routeOrg, '.arxa', 'locks', path2.basename(routeOrg) + '.lock'),
  JSON.stringify({ pid: process.pid, orgPath: routeOrg }))
fs.writeFileSync(path2.join(routeOrg, 'doc.md'), 'route')

const routeSecret = 'route-secret'
const routes = createTokenRoutes({ env: routeEnv, secret: routeSecret, getSettings: () => ({ tokenTtlSeconds: 120 }), getOrigin: () => 'http://org-test.localhost:59999' })
function callRoute(payload) {
  return new Promise((resolve, rejectP) => {
    const res = { statusCode: 0, headers: null, body: '',
      writeHead(s, h) { this.statusCode = s; this.headers = h },
      end(b) { this.body = b || '' } }
    const rq = { method: 'POST',
      on(ev, fn) {
        if (ev === 'data') queueMicrotask(() => fn(Buffer.from(JSON.stringify(payload))))
        if (ev === 'end') queueMicrotask(() => fn())
      } }
    routes.handle(rq, res).then(() => resolve(res), rejectP)
  })
}
const ok = await callRoute({ orgPath: routeOrg, relPath: 'doc.md' })
assert.equal(ok.statusCode, 200, 'open org + contained rel -> 200')
const issued = JSON.parse(ok.body).token
assert.equal(verifyToken(issued, { secret: routeSecret, scope: 'read', relPath: 'doc.md', orgPath: routeOrg }).ok, true)
assert.equal((await callRoute({ orgPath: routeOrg, relPath: '../x' })).statusCode, 403, 'escape -> 403')
assert.equal((await callRoute({ orgPath: '/not/open', relPath: 'doc.md' })).statusCode, 403, 'unopened org -> 403')
assert.equal((await callRoute({ orgPath: routeOrg, relPath: 'nope.md' })).statusCode, 404, 'missing file -> 404')
assert.equal((await callRoute({ scope: 'write' })).statusCode, 400, 'write without worktreeId -> 400')
const w = await callRoute({ scope: 'write', worktreeId: 'sess-9' })
assert.equal(w.statusCode, 200, 'write token issued')
assert.equal(verifyToken(JSON.parse(w.body).token, { secret: routeSecret, scope: 'write', worktreeId: 'sess-9' }).ok, true)

console.log('arxa-artifact-viewer selftest: GREEN (tokens + route)');

// ---- Task 4: vendored bundles exist + vendor route serves them ------------
import { createVendorRoutes } from './lib/index.js'
const vendorDir = path2.join(here, 'lib', 'vendor')
// markdown.js is GONE: the rendered preview is VS Code's own webview now, which
// is better than markdown-it ever was (its stylesheet, math, checkboxes, and
// fences highlighted by the same grammars the editor uses) and needs no bundle.
// codemirror.js is GONE too. Its last two readers were the diff surface and the
// 2026 palette; the diff is VS Code's diff editor now, and VS Code paints its
// own theme. What remains vendored is what VS Code has no answer for: a PDF
// viewer, prettier for markdown/yaml, the material icon set and the font.
for (const f of ['pdf.js', 'pdf.worker.js', 'prettier.js', 'icons.js']) {
  assert.ok(fs.existsSync(path2.join(vendorDir, f)), 'vendored bundle present: ' + f)
  const bytes = fs.readFileSync(path2.join(vendorDir, f))
  assert.ok(bytes.length > 50_000, f + ' is a real bundle (' + bytes.length + ' bytes)')
  assert.ok(bytes.toString('utf8').slice(0, 300).includes('GENERATED by lib/vendor.js'), f + ' carries provenance banner')
}
const vr = createVendorRoutes({ vendorDir })
const vhttp = http.createServer((rq, rs) => { void vr.handle(rq, rs) })
await new Promise((r2) => vhttp.listen(0, '127.0.0.1', r2))
const vport = vhttp.address().port
const vget = await req(vport, '/prettier.js')
assert.equal(vget.status, 200, 'vendor route serves prettier.js')
assert.equal(vget.headers['content-type'], 'text/javascript; charset=utf-8')
assert.ok(vget.body.startsWith('/* arxa-artifact-viewer vendored bundle'), 'provenance banner served')
assert.equal((await req(vport, '/prettier.js', { method: 'POST' })).status, 405, 'vendor route GET-only')
const vt = await req(vport, '/%2e%2e/index.js')
assert.ok(vt.status === 404 || vt.status === 403, 'vendor traversal refused, got ' + vt.status)
// Lazy prettier, icon subset, Fira Code woff2 with a real font content-type.
const vfont = await req(vport, '/fira-code-latin.woff2')
assert.equal(vfont.status, 200, 'fira-code woff2 served')
assert.equal(vfont.headers['content-type'], 'font/woff2', 'woff2 content-type')
assert.equal((await req(vport, '/fira-code-latin-ext.woff2')).status, 200, 'latin-ext woff2 served (pl/fr glyphs)')
// Prettier toggle chip: the OFFICIAL brand mark vendored as a binary asset
// (favicon PNG from prettier/prettier website/static/icon.png, MIT).
const vpngBuf = fs.readFileSync(path2.join(vendorDir, 'prettier.png'))
assert.ok(vpngBuf.length > 500 && vpngBuf.length < 20_000, 'prettier.png vendored (' + vpngBuf.length + ' bytes)')
assert.ok(vpngBuf[0] === 0x89 && vpngBuf[1] === 0x50 && vpngBuf[2] === 0x4e, 'prettier.png is a real PNG')
const vpng = await req(vport, '/prettier.png')
assert.equal(vpng.status, 200, 'vendor route serves prettier.png')
assert.equal(vpng.headers['content-type'], 'image/png', 'png content-type')
assert.ok(!fs.existsSync(path2.join(vendorDir, 'themes.js')) && !fs.existsSync(path2.join(vendorDir, 'codemirror.js')),
  'no CodeMirror and no separate themes bundle — VS Code owns the editor, the diff and the palette')

// ---- G12: the route serves the Monaco build dir too -----------------------
// monaco-build/dist is ~200 flat files built at pack time and gitignored, so
// this drives a FAKE second dir: the real one is absent in a fresh checkout
// and a test that needs it would be red on any machine that has not built.
const fakeMonaco = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-monaco-'))
fs.writeFileSync(path2.join(fakeMonaco, 'arxa-monaco.js'), 'export const openFile = 1\n')
fs.writeFileSync(path2.join(fakeMonaco, 'onig-a1b2c3d4.wasm'), Buffer.from([0x00, 0x61, 0x73, 0x6d]))
fs.writeFileSync(path2.join(fakeMonaco, 'style-Ab3dEf9h.css'), 'body{}')
fs.writeFileSync(path2.join(fakeMonaco, 'rust.tmLanguage-Zz9yXw8v.json'), '{}')
fs.writeFileSync(path2.join(fakeMonaco, 'webWorkerExtensionHostIframe.html'), '<!doctype html>')
const vrMon = createVendorRoutes({ vendorDirs: [vendorDir, fakeMonaco] })
const vhttpMon = http.createServer((rq, rs) => { void vrMon.handle(rq, rs) })
await new Promise((r2) => vhttpMon.listen(0, '127.0.0.1', r2))
const vportMon = vhttpMon.address().port
assert.equal((await req(vportMon, '/prettier.js')).status, 200, 'first dir still served')
assert.equal((await req(vportMon, '/arxa-monaco.js')).status, 200, 'second dir served (the monaco entry)')
// THE phase-1 blocker: WebAssembly.instantiateStreaming rejects any
// content-type but application/wasm, so the oniguruma TextMate engine — and
// with it every grammar — dies if this row is missing. The route used to
// default everything to text/javascript.
const vwasm = await req(vportMon, '/onig-a1b2c3d4.wasm')
assert.equal(vwasm.headers['content-type'], 'application/wasm', 'wasm typed for instantiateStreaming')
assert.equal((await req(vportMon, '/style-Ab3dEf9h.css')).headers['content-type'], 'text/css; charset=utf-8')
assert.equal((await req(vportMon, '/rust.tmLanguage-Zz9yXw8v.json')).headers['content-type'], 'application/json; charset=utf-8')
assert.equal((await req(vportMon, '/webWorkerExtensionHostIframe.html')).headers['content-type'], 'text/html; charset=utf-8')
// Content-hashed names cache forever; stable ones must not, or a rebuilt
// bundle would never be picked up.
assert.match(vwasm.headers['cache-control'], /immutable/, 'hashed chunk is immutable')
assert.equal((await req(vportMon, '/arxa-monaco.js')).headers['cache-control'], 'no-store', 'stable entry name stays no-store')
assert.equal((await req(vportMon, '/prettier.js')).headers['cache-control'], 'no-store', 'committed vendor bundle stays no-store')
// The traversal guard must hold PER DIR — a name that escapes one root must
// not be admitted because it happens to sit inside another.
assert.ok([403, 404].includes((await req(vportMon, '/%2e%2e/index.js')).status), 'traversal still refused with two dirs')
assert.equal((await req(vportMon, '/nothing-here.js')).status, 404, 'unknown name 404s across both dirs')
vhttpMon.close()
fs.rmSync(fakeMonaco, { recursive: true, force: true })
const vPrettier = fs.readFileSync(path2.join(vendorDir, 'prettier.js'), 'utf8')
assert.ok(vPrettier.includes('window.ArxaPrettier=') && vPrettier.includes('parserForExt'), 'prettier bundle shape')
assert.ok(vPrettier.includes('typescript') && vPrettier.includes('scss'), 'prettier parser coverage')
const vIcons = fs.readFileSync(path2.join(vendorDir, 'icons.js'), 'utf8')
assert.ok(vIcons.includes('window.ArxaIcons=') && vIcons.includes('folder-open'), 'icons bundle shape')
assert.ok(vIcons.includes('width="16" height="16"'), 'material SVGs pinned to 16px')
assert.ok(/#[0-9a-fA-F]{6}/.test(vIcons), 'material icons carry brand colors (full color)')
await new Promise((r2) => vhttp.close(r2))
const clientSrc = fs.readFileSync(path2.join(here, 'lib', 'client.js'), 'utf8')
// 2026 editor client contracts (grilled 2026-09-03).
assert.ok(clientSrc.includes("'.dart'"), '.dart joins the code lane')
assert.ok(!clientSrc.includes('ArxaCM') && !clientSrc.includes('unifiedMergeView'),
  'nothing in the client reaches for CodeMirror any more')
// Every bare `setX(` call must have a `setX]` useState behind it. The CodeMirror
// removal deleted `previewHtml` but left `setPreviewHtml('')` in resetForOpen,
// which runs BEFORE openArtifact sets phase:'loading' — so every file click
// threw a ReferenceError into a `void` promise and the panel sat at the idle
// hint with nothing on screen or in the log (2026-09-07).
{
  const declared = new Set([...clientSrc.matchAll(/,\s*(set[A-Z]\w*)\]/g)].map((m) => m[1]))
  const called = new Set([...clientSrc.matchAll(/(?<![.\w])(set[A-Z]\w*)\(/g)].map((m) => m[1]))
  const orphans = [...called].filter((n) => !declared.has(n) && n !== 'setTimeout')
  assert.deepStrictEqual(orphans, [], 'every state setter the client calls is declared: ' + orphans.join(', '))
}
assert.match(clientSrc, /ensureVendor\('icons\.js', 'ArxaIcons'\)/, 'client loads the material icon subset')
// G7 phase 1b: the editable lane is Monaco/VS Code, not CodeMirror. Language
// now comes from the uri (the VS Code grammar extensions resolve it), so the
// old `CM.langForExt(ext)` pin is gone with the code it pinned. DiffView is
// still CodeMirror — its pins below stay.
assert.ok(clientSrc.includes("import(VENDOR('arxa-monaco.js'))"), 'monaco bundle loaded by dynamic import (ESM + workers, not a script tag)')
assert.ok(clientSrc.includes('M.openFile(ref.current,'), 'editable lane opens the file in monaco (keyed by the real path — see the G8 block)')
assert.ok(clientSrc.includes('onChange: () => { if (onDirty) onDirty() }'), 'dirty state rides the monaco model')
assert.ok(clientSrc.includes('M.setTheme(dark, studioColors())'), 'palette flip reaches an already-open monaco editor, with the canvas re-read')
assert.ok(clientSrc.includes('if (dead) { handle.dispose(); handle = null; return }'), 'an editor created after unmount is disposed, not leaked into a detached node')
assert.ok(clientSrc.includes('docRef.current.getText()'), 'save reads the live monaco document')
// Shift-Alt-F is NOT rebound in the client any more. addCommand exists only on
// a STANDALONE editor, and files now open in VS Code's editor part, whose
// control is a plain ICodeEditor — the old binding would throw on every open.
// The chord still works, from the keybindings service, mapped to
// editor.action.formatDocument, i.e. through the language server.
assert.ok(!/KeyMod\.Shift \| M\.monaco\.KeyMod\.Alt/.test(clientSrc),
  'the client does not rebind Shift-Alt-F — addCommand does not exist on the editor part\'s control')
// THE 2026-09-06 regression: monaco shipped with NO stylesheet. There is no
// index.html in that build, so vite emits the css as a bare asset and nothing
// links it — the editor's lines escaped their container and painted across the
// top-left of the whole app while the viewer pane sat black. It stayed green
// because the CHECK HARNESS was injecting the <link> itself. Three pins, one
// per way it could come back:
const mbDir = path2.join(here, 'lib', 'monaco-build')
const entrySrc = fs.readFileSync(path2.join(mbDir, 'src', 'entry.mjs'), 'utf8')
const viteSrc = fs.readFileSync(path2.join(mbDir, 'vite.config.mjs'), 'utf8')
const checkSrc = fs.readFileSync(path2.join(mbDir, 'check.mjs'), 'utf8')
const spikeSrc = fs.readFileSync(path2.join(mbDir, 'src', 'spike.html'), 'utf8')
assert.match(entrySrc, /new URL\('arxa-monaco\.css', import\.meta\.url\)/, 'the bundle loads its OWN stylesheet, resolved from its own url')
assert.ok(entrySrc.includes('await ensureStyles()'), 'and does it before any editor mounts')
assert.ok(viteSrc.includes("'arxa-monaco.css'"), 'the stylesheet gets a STABLE name (content-hashed, nothing could reference it)')
assert.ok(!/rel=["']stylesheet/.test(spikeSrc) && !/__CSS__/.test(checkSrc),
  'the check harness must NOT supply the stylesheet — doing so is what hid this bug')
assert.ok(checkSrc.includes("Array.isArray(window.__spike.fail) && window.__spike.fail.length === 0"),
  'check.mjs asserts ONE thing: that the page found nothing wrong, and reads as red when the page never got that far. --expect collapses to a single boolean, so the terms live where they can be named')
assert.ok(spikeSrc.includes('out.contained') && spikeSrc.includes('out.contained === true'),
  'the check asserts the editor renders INSIDE its container')
assert.ok(clientSrc.includes('aXa_av_monaco'), 'the monaco lane has its own wrapper class (monaco owns its scrolling)')
assert.ok(clientSrc.includes("getPropertyValue('--arxa-editor-font')"), 'the editor font setting is PASSED to monaco (it measures glyph width from it)')
// The viewer is a SIDE PANE, routinely dragged narrow. automaticLayout keeps
// the editor the right size; layoutFor changes its shape so the minimap and
// gutters get out of the way and long lines wrap instead of running off.
assert.ok(entrySrc.includes('function layoutFor ('), 'narrow-pane shape is a single table, not scattered conditionals')
assert.ok(entrySrc.includes('new ResizeObserver'), 'the shape is re-applied as the pane resizes')
assert.ok(entrySrc.includes('if (key === shape) return'), 'a drag does not push an updateOptions per frame')
assert.ok(entrySrc.includes('ro.disconnect()'), 'the resize observer is disconnected with the editor')
assert.ok(spikeSrc.includes('out.narrowMinimap === false') && spikeSrc.includes('out.narrowWraps === true'),
  'the check proves the narrow shape in a browser, not just that the code exists')

// ---- G8/G11: file identity is what makes the language service land ---------
// A monaco model keyed at /<relPath> names a path no language server has ever
// heard of, so every diagnostic, hover and definition would be attributed to a
// file that does not exist. The host resolves the real path (it already does,
// for its own path checks) and hands it back with the token.
const hostSrc = fs.readFileSync(path2.join(here, 'lib', 'index.js'), 'utf8')
const lspSrc = fs.readFileSync(path2.join(here, 'lib', 'lsp.js'), 'utf8')
assert.ok(hostSrc.includes("absPath: wtId ? abs : absOf(open.path, body.relPath)"), 'the read token route returns the file\'s real path — the worktree\'s when the token names one')
assert.ok(hostSrc.includes('absPath: wtAbs'), 'the worktree token route returns it too (resolveWorktreeFile already knew it)')
assert.ok(hostSrc.includes("path: '/__arxa/artifacts/lsp'"), 'the lsp socket is registered as an upgrade route')
assert.ok(hostSrc.includes('lspBridge.retainRoots(roots.map((r) => r.path))'),
  'root reconciliation stops language servers only for roots that closed')
assert.ok(hostSrc.includes('resolveAbs: async ({ relPath, session, orgPath })'), 'the HOST resolves paths — the client never names one')
assert.ok(lspSrc.includes('const root = projectRootFor(absFile, orgPath, servers[lang].rootMarkers, exists,'),
  'the server is rooted at the project, not the org (an org has no Cargo.toml, so it would report nothing)')
assert.ok(lspSrc.includes('{ fallbackToFileDir: servers[lang].rootFallback === true }'),
  'a language with no manifest (html, css, json, a loose .ts) roots at the file\'s own directory instead of being denied')
assert.ok(clientSrc.includes("M.openFile(ref.current, absPath || ('/' + relPath), text"), 'the model is keyed on the real path, falling back to the relative one')
assert.ok(clientSrc.includes("fetchTokenRaw({ scope: 'lsp', rootId })"), 'the socket uses the root-bound lsp token class')
assert.ok(clientSrc.includes('M.connectLanguageServer(lang, { url: wsUrl, token, relPath, uriPath: absPath, session, rootId,'),
  'the editor attaches a language client, passing its exact file URI, session and root identity')

// ---- 2c: the rest of the languages + the Install door -----------------------
assert.ok(hostSrc.includes("path: '/__arxa/artifacts/lsp/install'") && hostSrc.includes("path: '/__arxa/artifacts/lsp/status'"),
  'the install door and the status face are both registered')
assert.ok(hostSrc.includes("body.scope === 'lsp-install'"),
  'installing has its own token class — a leaked lsp token starts a server, it must not put new software on the machine')
assert.ok(hostSrc.includes("scope: 'lsp-install', orgPath: openI.path") && hostSrc.includes('selectedOpenRoot(process.env, body.rootId)') && hostSrc.includes('const installing = new Map()'),
  'the install door is root-bound and runs one npm per language at a time')
assert.ok(!hostSrc.includes('void installServer(') && hostSrc.includes('installArgv(lang) === null'),
  'nothing installs on its own: the door refuses any language without an npm row (dart and rust are locate-only)')
for (const ext of ["'.ts'", "'.tsx'", "'.js'", "'.html'", "'.css'", "'.scss'", "'.json'"]) {
  assert.ok(clientSrc.includes(ext + ':'), 'the client routes ' + ext + ' to a language server')
}
assert.ok(clientSrc.includes("fetch(LSP_ROUTE + '/status?avt='"),
  'the editor ASKS whether a server exists before connecting — the 4004 close arrives after the socket opens, too late to decide')
assert.ok(clientSrc.includes("fetchTokenRaw({ scope: 'lsp-install', rootId })") && clientSrc.includes("LSP_ROUTE + '/install'"),
  'the Install button is the only thing that installs, with authority bound to the selected root')
assert.ok(clientSrc.includes('lsp.installable') && clientSrc.includes('install its SDK'),
  'a locate-only language gets a sentence, not a download button')
assert.ok(clientSrc.includes("h('div', { className: 'aXa_av_lspHost', ref })"),
  'the editor host keeps a stable child slot, so showing the strip cannot unmount a live editor')
const entrySrc2c = fs.readFileSync(path2.join(here, 'lib', 'monaco-build', 'src', 'entry.mjs'), 'utf8')
assert.ok(entrySrc2c.includes('(selector ?? [lang]).map((language) => ({') && entrySrc2c.includes("scheme: 'file'"),
  'one root-scoped server can own several monaco language ids (js for ts, scss/less for css, jsonc for json)')
assert.ok(entrySrc2c.includes("import '@codingame/monaco-vscode-markdown-basics-default-extension'"),
  'markdown has a GRAMMAR: with only the feature extension a .md file opened as plaintext')
assert.ok(entrySrc2c.includes("import '@codingame/monaco-vscode-markdown-language-features-default-extension'"),
  'the markdown FEATURE layer is back: it never needed plumbing, only an extension host that was switched on')
// The three lines below are one fact: at 36.2.7 the extensions override
// destructures { enableWorkerExtensionHost, iframeAlternateDomain }, so the
// { url, options } call this build shipped for phases 1-2 left the extension
// host OFF and every extension with real code inert. getWorker cannot replace
// getWorkerUrl either — the host runs in an iframe and needs a URL to cross it.
assert.ok(entrySrc2c.includes('getExtensionsServiceOverride({ enableWorkerExtensionHost: true })'),
  'the webworker extension host is switched ON — { url, options } destructured to undefined and ran no extension at all')
assert.ok(entrySrc2c.includes('getWorkerUrl: (_id, label)') && entrySrc2c.includes('getWorkerOptions:'),
  'workers are handed to monaco as URLs — the extension host iframe cannot receive a Worker object from this realm')
assert.ok(!/\?worker'$/m.test(entrySrc2c),
  'every worker is imported as ?worker&url, not ?worker')
assert.ok(entrySrc2c.includes("import '@codingame/monaco-vscode-scss-default-extension'") &&
  entrySrc2c.includes("import '@codingame/monaco-vscode-less-default-extension'"),
  'scss and less are separate grammars from css — without them those files open as plaintext and the css client is sent nothing')
// ---- phase 7.1: the editor part -----------------------------------------
assert.ok(entrySrc2c.includes("import getViewsServiceOverride, { attachPart, Parts } from '@codingame/monaco-vscode-views-service-override'"),
  'the views service override is in the graph — it is what carries webviews and custom editors')
assert.ok(entrySrc2c.includes('attachPart(Parts.EDITOR_PART, container)'),
  'ONE part is attached. attachPart takes a single part, so no activity bar, sidebar, panel or status bar comes with it')
assert.ok(entrySrc2c.includes('groups.mainPart.activeGroup'),
  'files open into the MAIN part group — IEditorGroupsService spans every part and its active group is not necessarily the attached one')
assert.ok(/unhandledrejection/.test(entrySrc2c) && /'Canceled'/.test(entrySrc2c),
  'cancellation is swallowed: VS Code signals it by rejecting, and the markdown preview does it on every open')
assert.ok(entrySrc2c.includes("if (s === 'Canceled' || s === 'CodeExpectedError') ev.preventDefault()"),
  'and ONLY cancellation is swallowed — loosening this guard would hide every real rejection from the lens')
assert.ok(!fs.existsSync(path2.join(here, 'lib', 'vendor', 'markdown.js')) && !clientSrc.includes('ArxaMD'),
  'nothing loads the vendored markdown bundle any more')
assert.ok(entrySrc2c.includes("original: { resource: monaco.Uri.file(origPath) }"),
  'the diff is VS Code\'s diff editor, with the original side on its OWN uri so it cannot collide with the open file')
assert.ok(entrySrc2c.includes("runCommand('markdown.showPreview')"),
  'the rendered preview is VS Code\'s, opened as an editor input in the part')
// No rendered markdown preview (2026-09-07): it was a second, washed-out copy
// of every .md beside the Monaco one. Markdown is source in Monaco.
assert.ok(!clientSrc.includes('showMarkdownPreview') && !clientSrc.includes('showSource'),
  'the client never opens the webview preview or offers a source/preview toggle')
// A pinned tab outlives the file switch; the strip filled with every file
// ever clicked. Both opens are unpinned, like VS Code's own explorer click.
assert.ok(clientSrc.includes('M.openEditor(uri, { pinned: false })'),
  'the source view opens unpinned so the tab strip does not accumulate')
// Nothing of CodeMirror or markdown-it is left in the stylesheet.
assert.ok(!/'\.cm-|aXa_av_md\b|aXa_av_pal/.test(clientSrc),
  'no CodeMirror or markdown-it selectors survive in the client stylesheet')
assert.ok(entrySrc2c.includes('getKeybindingsServiceOverride()'),
  'the keybindings service is what supplies Shift-Alt-F now that the client no longer binds it')
assert.ok(entrySrc2c.includes("'editor.minimap.enabled': width >= 700"),
  'the narrow-pane shape moved to settings.json — the editor part owns editor construction, so create-options no longer reach it')
assert.ok(entrySrc2c.includes('function writeConfig (patch)') && !/updateUserConfiguration\(JSON\.stringify\(\{/.test(entrySrc2c),
  'and every setting goes through ONE object: updateUserConfiguration REPLACES the document, so a second writer would drop the theme')
assert.ok(entrySrc2c.includes('initializationOptions: init ?? undefined'),
  'the handshake options the host computed reach the language client')
assert.ok(hostSrc.includes("init: typeof def.initOptions === 'function' ? def.initOptions(process.env) : null"),
  'the host computes them — only it knows where arxa installed a compiler')
assert.ok(lspSrc.includes("npm: ['typescript-language-server', 'typescript@^5']"),
  'typescript is pinned to 5: 7 is the native rewrite with no tsserver.js, and an unpinned install kills the row silently')
assert.ok(lspSrc.includes('tsserver: { fallbackPath:'),
  'the ts server is told where a compiler is, as a FALLBACK so a project\'s own typescript still wins')
assert.match(clientSrc, /catch \{ \/\* no language service; the editor is unaffected \*\/ \}/,
  'a missing language service NEVER fails the open — the editor works without one')
assert.ok(entrySrc.includes("['arxa-lsp', token]"), 'the bundle sends the token as a subprotocol (a browser cannot set headers)')
assert.ok(entrySrc.includes('const current = langClients.get(lang)') && entrySrc.includes('pattern: literalPattern')
  && entrySrc.includes("if (ch === '[') return '[[]'")
  && entrySrc.includes('await current.client.stop()'),
  'one client per language is re-pointed with an exact file selector, so retained models cannot cross roots')
// The LSP lane is now proven in a BROWSER, not only by these string pins. A
// splice deleted connectLanguageServer once and the build stayed green, because
// nothing in the bundle imports it — only client.js does, at runtime.
assert.ok(checkSrc.includes('WebSocketServer') && checkSrc.includes("method: 'textDocument/publishDiagnostics'"),
  'the check harness runs a stub language server')
assert.ok(spikeSrc.includes("out.lspMarkers > 0") && spikeSrc.includes("out.lspSource === 'arxa-stub:spike-root-a'")
  && spikeSrc.includes("JSON.stringify(out.lspObserved['spike-root-b'])"),
  'and proves same-language clients sync only their selected root model while diagnostics still reach Monaco')
assert.ok(spikeSrc.includes('out.dialogs === 0') && spikeSrc.includes("out.afterConflict.startsWith('EDITED')"),
  'an external change under unsaved edits raises NO VS Code dialog and keeps the edits — the viewer\'s conflict banner stays the only prompt')
// The 2026 palette vars are gone with CodeMirror: they existed to make the CM
// editor and the markdown preview match, and VS Code paints both from its own
// theme. watchPalette stays — it is what tells VS Code which theme to use.
assert.ok(clientSrc.includes('data-ds-dark-theme'), 'palette follows the dsh dark flag')
assert.ok(clientSrc.includes('--arxa-editor-font'), 'editor font follows the settings choice')
assert.ok(clientSrc.includes('aXa_av_fileIcon'), 'viewer title carries the material file icon')
// 2026-09-03 sweep fixes.
// DiffView is gone: the diff is an editor input in the part, addressed by uri,
// so "receives the file identity" is now structural rather than a prop.
assert.ok(clientSrc.includes("await M.openDiff(uri, diffOriginal, {"),
  'the diff opens through VS Code, which colours both sides from the same grammar the editor uses')
// The diff's modified side is the file's OWN model, and the overlay file system
// is writable, so VS Code hands it over editable. Without this the diff writes
// files the code editor refuses to let you type in (proved in spike.html:
// diffModRO/diffTyped).
// The chat session id and the worktree registry id differ (traced 2026-09-07:
// every session open missed and fell back to the org copy). The resolver
// takes either, so the viewer's mirrored session reaches its worktree.
{
  const wa = fs.readFileSync(path2.join(here, 'lib', 'write-api.js'), 'utf8')
  assert.ok(wa.includes("row.id !== worktreeId && row.dshSessionId !== worktreeId"),
    'resolveWorktree matches the dsh session id as well as the registry id')
  assert.ok(wa.includes('? row.worktree') && wa.includes('matches.set(key, { repoPath, worktreePath, worktree: worktreePath })'),
    'resolveWorktree takes the path from the registry row and returns it under both names wt-api and write-api read')
  const wt = fs.readFileSync(path2.join(here, 'lib', 'wt-api.js'), 'utf8')
  assert.ok(!wt.includes("/[/\\\\]/.test(worktreeId)"), 'resolveWorktreeFile no longer refuses the slash every registry id carries')
}
// First-click cost: the bundle and VS Code's boot are warmed after startup.
// The warm start passes the SHELL's palette + font: the workbench boots once
// and its default is dark, so an args-less start painted dark body-level
// chrome over a light shell (measured 2026-09-15).
assert.ok(clientSrc.includes("'arxa-av: warm editor'") && clientSrc.includes("M.start(document.createElement('div'), { dark: isDarkMode(), fontFamily: studioEditorFont(), colors: studioColors() })"),
  'the editor bundle is warmed before the first click, in the shell\'s palette')
assert.ok(clientSrc.includes("'arxa-av: palette mirror'") && !clientSrc.includes('unwatch = watchPalette'),
  'the palette mirror is armed once at apply, not per editor mount')
assert.ok(clientSrc.includes('function cssColorToHex') && clientSrc.includes('4.0767416621'),
  'studio colors convert oklab/oklch to hex by hand (canvas readback keeps the oklab string; VS Code refuses it)')
// Click-to-paint trace (2026-09-07): one engine-log line per open, with the
// phases the harness cannot see. Stays until the slow first load is explained.
assert.ok(clientSrc.includes("const TRACE_ROUTE = '/__arxa/artifacts/trace'") && clientSrc.includes("trace.end('painted')"),
  'the client traces a click through to the painted editor')
assert.ok(fs.readFileSync(path2.join(here, 'lib', 'index.js'), 'utf8').includes("path: '/__arxa/artifacts/trace'"), 'the host logs the trace line')
// Decision B (2026-09-07): with a session current, a tree open shows the
// SESSION's copy of the file — where the viewer's own saves land (D38) — and
// falls back to the org copy quietly when the session has none.
assert.ok(clientSrc.includes("const sid = rootId ? null : (p.sessionId || store.getSnapshot().sessionId || null)")
  && clientSrc.includes("openWorktreeRef.current(sid, p.relPath, { quiet: true })"),
  'a plain tree open routes through the current session worktree with a quiet org fallback')
assert.ok(/const openWorktree = async \(sessionId, relPath, \{ quiet = false \} = \{\}\)/.test(clientSrc)
  && clientSrc.includes("if (!quiet) setState({ phase: 'error'"),
  'openWorktree can fail quietly so the fallback does not flash an error')
// Typed text must survive a re-open (2026-09-07): the panel remounted the
// CodeView when the "saved" note appeared, and openFile pushed the LOADED
// bytes back over the document. Register once; disk changes use updateFile.
assert.ok(entrySrc.includes('else if (loaded.get(uriPath) !== text) await syncFile(uriPath, text)'),
  'openFile syncs only a NEW load; a re-open with the same loaded bytes leaves the document alone')
assert.ok(/\}, \[relPath, absPath, session, rootId, editable\]\)/.test(clientSrc) && clientSrc.includes('M.updateFile(uri, text)'),
  'the client does not re-open on a text change; a clean-buffer disk change goes through updateFile')
assert.ok(clientSrc.includes("h(CodeView, { key: 'surface'"),
  'the editor surface is keyed so a note appearing above it cannot remount it')
// The markdown preview is a fixed overlay on document.body anchored to its
// pane; when the CodeView host unmounts (the loading hint between two files)
// the anchor is gone and the iframe lands at the page's top-left. Measured
// live in Chrome and WebKit, 2026-09-07. Disposing the handle must close it.
assert.ok(/dispose: \(\) => \{[\s\S]{0,1200}?void closeWebviews\(\)/.test(entrySrc),
  'disposing a file handle closes the preview webview whose anchor is about to leave the DOM')
assert.ok(entrySrc.includes("editor.typeId === 'workbench.editors.webviewInput'"),
  'closeWebviews targets webview inputs, not the text editors that keep undo history')
assert.ok(entrySrc.includes("mod.updateOptions({ readOnly: !editable, domReadOnly: !editable })"),
  'the diff honours read-only on its modified side')
// Always two columns: VS Code's default falls to the inline view below
// 900px, and the viewer pane usually is — one column with two line-number
// gutters read as "not a diff" (2026-09-07).
assert.ok(entrySrc.includes("'diffEditor.useInlineViewWhenSpaceIsLimited': false"),
  'the bundle keeps the diff side by side in a narrow pane')
assert.ok(/openDiff \(uriPath, originalText, \{ sideBySide = null, editable = true \}/.test(entrySrc),
  'openDiff takes the editable flag')
assert.ok(/await M\.openDiff\(uri, diffOriginal, \{[\s\S]{0,400}?\n\s+editable,\n/.test(clientSrc)
  && !clientSrc.includes('sideBySide:'),
  'the client hands the diff the editable flag and leaves side-by-side to VS Code\'s own breakpoint')
assert.ok(clientSrc.includes('data-arxa-vendor'), 'vendor script tags marked for cross-loader reuse')

// Q8 (2026-09-03): the CI insight panel mirrors the card's run control, but
// per row — the card only ever reaches the newest run, this reaches every one.
assert.ok(clientSrc.includes("act('ci-rerun', 'card.ci.rerun', { sessionId, runId: run.id })"), 'CI panel re-runs the row it is on, through the card host action')

// Q5 (2026-09-03): the subagent / job detail panel — the same controls the
// header dropdown carries, on the full record. agent.* is a SIDEBAR action:
// a session's children are not a git concern and must not ride the card route.
assert.ok(clientSrc.includes("const ROUTE_FOR = (action) => (/^agent\\./.test(action) ? SIDEBAR_ROUTE : CARD_ROUTE)"), 'agent.* is routed to the sidebar host, not the card host')
assert.ok(clientSrc.includes("const action = view === 'subagents' ? 'agent.list' : 'insight.' + view"), 'subagents ask agent.list rather than a non-existent insight.subagents')
assert.ok(clientSrc.includes("if (view === 'jobs') { setData({ jobs: given || [] }); setPhase('ready'); return () => {} }"), 'jobs never round-trip: JobView is push-only, the rows ride the open event')
assert.match(clientSrc, /view === 'jobs' \|\| view === 'subagents'/, 'both agent views render')
assert.ok(clientSrc.includes("row.can && row.can[verb] === true"), 'panel verbs are gated by the host capability map, never inferred')
assert.ok(clientSrc.includes("t('agents.why.' + String(why || 'unavailable'))"), 'a disabled panel verb explains itself')
assert.equal(clientSrc.split("'agents.why.no-job-api':").length - 1, 3, 'the job-control gap is stated in en/pl/fr')
assert.ok(clientSrc.includes("if (r && r.ok === false) { setNote(t('agents.why.' + String(r.reason || 'unavailable'))); return }"), 'a refused verb surfaces its reason instead of a silent refresh')
for (const k of ['agents.pause', 'agents.cancel', 'agents.why.no-terminate-verb', 'insight.title.jobs', 'insight.title.subagents']) {
  assert.equal(clientSrc.split("'" + k + "':").length - 1, 3, k + ' present in en/pl/fr')
}

assert.ok(clientSrc.includes("act('ci-cancel', 'card.ci.cancel', { sessionId, runId: run.id })"), 'CI panel cancels the row it is on')
assert.match(clientSrc, /const live = run\.status !== 'completed'/, 'row liveness decides which of the pair is enabled')
assert.ok(clientSrc.includes("trailing(t('insight.ci.rerun'), () => act('ci-rerun'"), 'rerun wears the stock trailing-action face')
for (const k of ['insight.ci.rerun', 'insight.ci.cancel']) {
  assert.equal(clientSrc.split("'" + k + "':").length - 1, 3, k + ' present in en/pl/fr')
}

console.log('arxa-artifact-viewer selftest: GREEN (vendor bundles + route)');

// ---- Task 6: engine write API over a REAL git session worktree ------------
import { createWriteApi, resolveWorktree } from './lib/write-api.js'
import { execFileSync } from 'node:child_process'

const gitEnv = { ...process.env,
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@arxa.invalid',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@arxa.invalid' }
const orgRepo = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-git-'))
const g = (args, cwd) => execFileSync('git', args, { cwd, env: gitEnv })
g(['init', '-b', 'main'], orgRepo)
fs.writeFileSync(path2.join(orgRepo, 'seed.md'), 'seed\n')
g(['add', '.'], orgRepo)
g(['commit', '-m', 'init'], orgRepo)

const sessions = await import(new URL('../git-workspace/lib/sessions.js', import.meta.url).href)
const created = sessions.openSession(orgRepo, { id: 'sess1', name: 'T1', env: gitEnv })
const worktreeOf = (id) => path2.join(orgRepo, '.arxa', 'worktrees', id)
assert.ok(fs.existsSync(worktreeOf('sess1')), 'session worktree exists after openSession')

const wtEnv = { ...process.env, ARXA_HOME: home } // home from Task 2 with orgA? use a fresh route-style open org:
// open-org truth for the write api: point orgA at the git org repo
const gitHome = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-ghome-'))
const gitEnvHome = { ...process.env, ARXA_HOME: gitHome }
fs.writeFileSync(path2.join(gitHome, 'organisation.json'), JSON.stringify({ orgs: [orgRepo] }))
writeLock(orgRepo, { pid: process.pid, orgPath: orgRepo })
assert.equal(readOpenOrg(gitEnvHome) && readOpenOrg(gitEnvHome).orgPath, orgRepo, 'git org reads as open')

assert.equal((await resolveWorktree({ env: gitEnvHome, orgPath: orgRepo, worktreeId: 'sess1' })).worktreePath, worktreeOf('sess1'))
assert.equal(await resolveWorktree({ env: gitEnvHome, orgPath: orgRepo, worktreeId: 'nope' }), null)

const writeApi = createWriteApi({ env: gitEnvHome, secret, getSettings: () => ({ maxEditBytes: 1024 }) })
function callWrite(payload, headers = {}) {
  return new Promise((resolve, rejectP) => {
    const res = { statusCode: 0, headers: null, body: '',
      writeHead(s, h) { this.statusCode = s; this.headers = h || null },
      end(b) { this.body = b || ''; resolve(this) } }
    const rq = { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
      on(ev, fn) {
        if (ev === 'data') queueMicrotask(() => fn(Buffer.from(JSON.stringify(payload))))
        if (ev === 'end') queueMicrotask(() => fn())
      } }
    writeApi.handle(rq, res).then(() => resolve(res), rejectP)
  })
}
const wtok = issueToken({ secret, scope: 'write', worktreeId: 'sess1', ttlSeconds: 30 })
const WH = { 'x-arxa-write-token': wtok }

const w1 = await callWrite({ worktreeId: 'sess1', relPath: 'notes/a.md', content: 'written by the editor\n' }, WH)
assert.equal(w1.statusCode, 200, 'happy write -> 200, got ' + w1.statusCode + ' ' + w1.body)
const w1body = JSON.parse(w1.body)
assert.equal(w1body.committed, true, 'WIP commit ran')
const saved = path2.join(worktreeOf('sess1'), 'notes', 'a.md')
assert.equal(fs.readFileSync(saved, 'utf8'), 'written by the editor\n')
const log = g(['log', '--oneline'], worktreeOf('sess1')).toString()
assert.match(log, /wip:/, 'WIP commit visible in worktree log')

const w2 = await callWrite({ worktreeId: 'sess1', relPath: '../escape.md', content: 'x' }, WH)
assert.equal(w2.statusCode, 403, 'worktree escape -> 403')
const w3 = await callWrite({ worktreeId: 'sess1', relPath: 'account/secret.txt', content: 'x' }, WH)
assert.equal(w3.statusCode, 403, 'account/ reserved -> 403 (D28/D37)')
const w4 = await callWrite({ worktreeId: 'sess1', relPath: '.arxa/x', content: 'x' }, WH)
assert.equal(w4.statusCode, 403, '.arxa/ reserved -> 403')
const expiredW = issueToken({ secret, scope: 'write', worktreeId: 'sess1', ttlSeconds: 5, now: () => 1000 })
const w5 = await callWrite({ worktreeId: 'sess1', relPath: 'notes/a.md', content: 'x' }, { 'x-arxa-write-token': expiredW })
assert.equal(w5.statusCode, 401, 'expired write token -> 401')
const w6 = await callWrite({ worktreeId: 'nope', relPath: 'x.md', content: 'x' }, { 'x-arxa-write-token': issueToken({ secret, scope: 'write', worktreeId: 'nope', ttlSeconds: 30 }) })
assert.equal(w6.statusCode, 404, 'unknown session -> 404')
const first = JSON.parse(w1.body)
const w7 = await callWrite({ worktreeId: 'sess1', relPath: 'notes/a.md', content: 'conflict', expectedMtimeMs: first.mtimeMs + 99999 }, WH)
assert.equal(w7.statusCode, 409, 'stale expectedMtimeMs -> 409 (external change wins)')
const w8 = await callWrite({ worktreeId: 'sess1', relPath: 'notes/a.md', content: 'second save\n', expectedMtimeMs: first.mtimeMs }, WH)
assert.equal(w8.statusCode, 200, 'matching mtime -> 200')
assert.equal(fs.readFileSync(saved, 'utf8'), 'second save\n')
const w9 = await callWrite({ worktreeId: 'sess1', relPath: 'big.md', content: 'x'.repeat(2000) }, WH)
assert.equal(w9.statusCode, 413, 'over-cap content -> 413 (D82 server-side twin)')

console.log('arxa-artifact-viewer selftest: GREEN (write api over real git worktree)');

// ---- Task 9: main-version route (D84 worktree-vs-main) ---------------------
import { createMainVersionRoute } from './lib/write-api.js'
const mv = createMainVersionRoute({ env: gitEnvHome, secret })
function callMain(relPath, token) {
  return new Promise((resolve, rejectP) => {
    const res = { statusCode: 0, headers: null, body: '',
      writeHead(s, h) { this.statusCode = s; this.headers = h || null },
      end(b) { this.body = b || ''; resolve(this) } }
    const rq = { method: 'GET', url: '/?relPath=' + encodeURIComponent(relPath) + '&avt=' + encodeURIComponent(token || '') }
    mv.handle(rq, res).then(() => resolve(res), rejectP)
  })
}
const readT = issueToken({ secret, scope: 'read', relPath: 'seed.md', orgPath: orgRepo, ttlSeconds: 30 })
const m1 = await callMain('seed.md', readT)
assert.equal(m1.statusCode, 200, 'main-version 200')
assert.equal(JSON.parse(m1.body).content, 'seed\n', 'main blob content')
const m2 = await callMain('notes/a.md', issueToken({ secret, scope: 'read', relPath: 'notes/a.md', orgPath: orgRepo, ttlSeconds: 30 }))
assert.equal(m2.statusCode, 200, 'file absent on main still 200')
assert.equal(JSON.parse(m2.body).content, '', 'new-file diff gets empty base')
assert.equal((await callMain('seed.md', null)).statusCode, 403, 'no token -> 403')
const wrongRel = issueToken({ secret, scope: 'read', relPath: 'other.md', orgPath: orgRepo, ttlSeconds: 30 })
assert.equal((await callMain('seed.md', wrongRel)).statusCode, 403, 'relPath-bound token enforced')
const esc = await callMain('../outside.md', issueToken({ secret, scope: 'read', relPath: '../outside.md', orgPath: orgRepo, ttlSeconds: 30 }))
assert.equal(esc.statusCode, 403, 'escape -> 403')
// D84 regression: one org holds several repos that share filenames. A session
// file's relPath is worktree-relative ('seed.md'), so reading 'main:seed.md'
// from the ORG root serves a DIFFERENT repo's same-named file as the base —
// a large, entirely fabricated diff. Observed live on 2026-09-09 (org check.sh
// rendered as the base for a project session's check.sh). The owning repo
// comes from the signed token's worktreeId, never from the query string.
const proj9 = path2.join(orgRepo, 'projects', 'p9')
fs.mkdirSync(proj9, { recursive: true })
g(['init', '-b', 'main'], proj9)
fs.writeFileSync(path2.join(proj9, 'seed.md'), 'project seed\n')
g(['add', '.'], proj9)
g(['commit', '-m', 'project init'], proj9)
sessions.openSession(proj9, { id: 'p9sess', name: 'P9', env: gitEnv })
const mProj = await callMain('seed.md', issueToken({ secret, scope: 'read', relPath: 'seed.md', orgPath: orgRepo, worktreeId: 'p9sess', ttlSeconds: 30 }))
assert.equal(mProj.statusCode, 200, 'project-session main-version 200')
assert.equal(JSON.parse(mProj.body).content, 'project seed\n', 'base comes from the repo that OWNS the file, not the org root')
// A worktreeId nothing owns (a Freestyle 'root:<id>' write id, a session closed
// since the token was minted) must not fall back to the org root's namesake.
const mOrphan = await callMain('seed.md', issueToken({ secret, scope: 'read', relPath: 'seed.md', orgPath: orgRepo, worktreeId: 'root:gone', ttlSeconds: 30 }))
assert.equal(mOrphan.statusCode, 200, 'unresolvable worktree still 200')
assert.equal(JSON.parse(mOrphan.body).content, '', 'unresolvable worktree gets an empty base, not the org file')
assert.equal(JSON.parse(mOrphan.body).branch, null, 'unresolvable worktree names no branch')
// The org repo's own files still read from the org root (no worktreeId).
assert.equal(JSON.parse((await callMain('seed.md', readT)).body).content, 'seed\n', 'org-root file unchanged by repo resolution')
// End-to-end through the REAL token route. The server-side repo resolution is
// inert unless the token actually carries the worktree, and until 2026-09-09
// the diff toggle minted a bare { relPath } — so the base still came from the
// org root. Mint the way the client mints, then read the base with it.
const tokenRoutes = createTokenRoutes({ env: gitEnvHome, secret, getSettings: () => ({ tokenTtlSeconds: 120 }), getOrigin: () => 'http://127.0.0.1:1' })
const callTokenRoute = (payload) => new Promise((resolve, rejectP) => {
  const res = { statusCode: 0, headers: null, body: '', writeHead(st, h) { this.statusCode = st; this.headers = h }, end(b) { this.body = b || '' } }
  const rq = { method: 'POST', on(ev, fn) {
    if (ev === 'data') queueMicrotask(() => fn(Buffer.from(JSON.stringify(payload))))
    if (ev === 'end') queueMicrotask(() => fn())
  } }
  tokenRoutes.handle(rq, res).then(() => resolve(res), rejectP)
})
const tkRes = await callTokenRoute({ relPath: 'seed.md', worktreeId: 'p9sess' })
assert.equal(tkRes.statusCode, 200, 'read token for a worktree file -> 200')
const tkBody = JSON.parse(tkRes.body)
assert.ok(tkBody.absPath && tkBody.absPath.includes('.arxa/worktrees'), 'the token route resolves a session file in its WORKTREE, not the org root')
assert.equal(JSON.parse((await callMain('seed.md', tkBody.token)).body).content, 'project seed\n', 'client-shaped token drives the base to the owning repo')

console.log('arxa-artifact-viewer selftest: GREEN (main-version diff route)');

// ---- Task 10: version chip + timeline route (D20/D44) ----------------------
import { createVersionRoute } from './lib/write-api.js'
import { mintVersion } from '../git-workspace/lib/versions.js'

const vr2 = createVersionRoute({ env: gitEnvHome, secret })
function callVersion(relPath, token) {
  return new Promise((resolve, rejectP) => {
    const res = { statusCode: 0, headers: null, body: '',
      writeHead(s, h) { this.statusCode = s; this.headers = h || null },
      end(b) { this.body = b || ''; resolve(this) } }
    const rq = { method: 'GET', url: '/?relPath=' + encodeURIComponent(relPath) + '&avt=' + encodeURIComponent(token || '') }
    vr2.handle(rq, res).then(() => resolve(res), rejectP)
  })
}
// unminted org repo -> hidden chip, empty timeline (never an error)
const v0 = await callVersion('seed.md', issueToken({ secret, scope: 'read', relPath: 'seed.md', orgPath: orgRepo, ttlSeconds: 30 }))
assert.equal(v0.statusCode, 200)
assert.equal(JSON.parse(v0.body).chip, null)
mintVersion(orgRepo, { name: 'first cut' })
const v1 = await callVersion('seed.md', issueToken({ secret, scope: 'read', relPath: 'seed.md', orgPath: orgRepo, ttlSeconds: 30 }))
const v1body = JSON.parse(v1.body)
assert.equal(v1body.chip.version, 'v1', 'chip shows v1')
assert.equal(v1body.chip.state, 'Draft', 'chip state Draft')
assert.ok(!/^[0-9a-f]{7,}$/i.test(v1body.chip.label), 'chip label carries no SHA (D44)')
assert.equal(v1body.timeline.length, 1, 'timeline carries the mint')
// project repo resolution: projects/p1/** -> that repo's versions
const proj = path2.join(orgRepo, 'projects', 'p1')
fs.mkdirSync(proj, { recursive: true })
mintVersion(proj, { name: 'proj cut', state: 'Approved' })
const v2 = await callVersion('projects/p1/x.md', issueToken({ secret, scope: 'read', relPath: 'projects/p1/x.md', orgPath: orgRepo, ttlSeconds: 30 }))
const v2body = JSON.parse(v2.body)
assert.equal(v2body.chip.state, 'Approved', 'project repo owns its chip')
assert.equal((await callVersion('seed.md', null)).statusCode, 403, 'no token -> 403')
assert.equal((await callVersion('../x', issueToken({ secret, scope: 'read', relPath: '../x', orgPath: orgRepo, ttlSeconds: 30 }))).statusCode, 403, 'escape -> 403')
console.log('arxa-artifact-viewer selftest: GREEN (version chip + timeline route)');

// ---- Task 11: watcher coalescing + SSE push (D86) --------------------------
import { createOrgWatcher, createEventsRoute } from './lib/watcher.js'
const wroot = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-watch-'))
const w11 = createOrgWatcher({ intervalMs: 60 })
const events = []
const off = w11.onChange((rel, mtime) => events.push({ rel, mtime }))
w11.setRoot(wroot)
// fs.watch (FSEvents on macOS) arms asynchronously and delivers with a latency
// that stretches under I/O load. Measured on this suite's flake (2026-09-02):
// a write made right after setRoot is never reported ~1/40 runs (0/40 once the
// watcher has had 300 ms), and under concurrent fs churn 4/20 events arrive
// later than the old fixed 400 ms sleep. Neither touches the product — the org
// root is set at open, edits come later, nothing waits on a deadline — so the
// test proves the watcher is armed with a probe write, then waits on the
// condition (capped) rather than on a fixed sleep, and counts only `a.md`
// events so a late duplicate FSEvents callback for the probe cannot over-count.
const until = async (cond, label, capMs = 5000) => {
  const cap = Date.now() + capMs
  while (!cond() && Date.now() < cap) await sleep(10)
  assert.ok(cond(), label + ' (within ' + capMs + ' ms)')
}
const aEvents = () => events.filter((e) => e.rel === 'a.md')
fs.writeFileSync(path2.join(wroot, 'probe.md'), 'arm\n')
await until(() => events.some((e) => e.rel === 'probe.md'), 'watcher armed: probe write reported')
fs.writeFileSync(path2.join(wroot, 'a.md'), 'one\n')
fs.writeFileSync(path2.join(wroot, 'a.md'), 'two\n')
fs.writeFileSync(path2.join(wroot, 'a.md'), 'three\n')
await until(() => aEvents().length >= 1, 'rapid writes produce an event')
await sleep(200) // > 3x the 60 ms coalescing window: a second flush would have fired by now
assert.equal(aEvents().length, 1, 'rapid writes coalesce to one event, got ' + aEvents().length)
assert.equal(events[events.length - 1].rel, 'a.md')
fs.mkdirSync(path2.join(wroot, '.arxa'), { recursive: true })
fs.writeFileSync(path2.join(wroot, '.arxa', 'x.db'), 'state')
await sleep(200)
assert.equal(events.filter((e) => e.rel.startsWith('.arxa')).length, 0, '.arxa runtime state never pushes')

// SSE route over a real connection. Task 7: the stream is TOKEN-GATED — it
// pushes every file change under the open org, so same-origin code must not
// get it for free (the D7 wall is "explicit, scoped, short-lived, root-bound",
// and an unauthenticated push channel is none of those). Deny-default: no
// verifier, no stream.
const sseSecret = 'sse-gate-secret'
// Fixture wiring mirrors index.js: a ?session= lane is changes-read-bound,
// everything else is tree-read-bound to the verifier's own root (here: the
// watched root — null means "the open org", resolved by the verifier).
const sseVerify = async ({ session, rootId, token }) => {
  if (session) return verifyToken(token, { secret: sseSecret, scope: 'changes-read', worktreeId: session }).ok
  return verifyToken(token, { secret: sseSecret, scope: 'tree-read', orgPath: rootId ?? wroot }).ok
}
const sse = createEventsRoute({ watcher: w11, verify: sseVerify })
const sseSrv = http.createServer((rq, rs) => { void sse.handle(rq, rs) })
await new Promise((r2) => sseSrv.listen(0, '127.0.0.1', r2))
const ssePort = sseSrv.address().port
const sseStatus = (path) => new Promise((resolve) => {
  const rq = http.get({ host: '127.0.0.1', port: ssePort, path }, (rs) => { rs.resume(); resolve(rs.statusCode) })
  rq.on('error', () => resolve(0))
})
assert.equal(await sseStatus('/'), 403, 'no token -> 403 (deny-default, Task 7 trust boundary)')
assert.equal(await sseStatus('/?avt=' + issueToken({ secret: sseSecret, scope: 'read', relPath: 'b.md', orgPath: wroot, ttlSeconds: 30 })), 403,
  'a per-file read token does not open the push channel')
assert.equal(await sseStatus('/?avt=' + issueToken({ secret: sseSecret, scope: 'tree-read', orgPath: '/elsewhere', ttlSeconds: 30 })), 403,
  'a tree-read token for ANOTHER root is refused')
// deny-default: a route wired with no verifier refuses everyone.
{
  const bare = createEventsRoute({ watcher: createOrgWatcher({ intervalMs: 60 }) })
  const bareSrv = http.createServer((rq, rs) => { void bare.handle(rq, rs) })
  await new Promise((r2) => bareSrv.listen(0, '127.0.0.1', r2))
  assert.equal(await new Promise((resolve) => {
    const rq4 = http.get({ host: '127.0.0.1', port: bareSrv.address().port, path: '/?avt=whatever' }, (rs) => { rs.resume(); resolve(rs.statusCode) })
    rq4.on('error', () => resolve(0))
  }), 403, 'a route wired with NO verifier denies (deny-default)')
  bareSrv.close()
}
const sseChunks = []
const sseToken = issueToken({ secret: sseSecret, scope: 'tree-read', orgPath: wroot, ttlSeconds: 30 })
const httpReq = http.get({ host: '127.0.0.1', port: ssePort, path: '/?avt=' + encodeURIComponent(sseToken) }, (rs) => {
  rs.on('data', (c) => sseChunks.push(c.toString()))
})
await until(() => sseChunks.join('').startsWith('retry: 2000'), 'SSE retry frame sent (with a tree-read token)')
fs.writeFileSync(path2.join(wroot, 'b.md'), 'pushed\n')
await until(() => sseChunks.join('').includes('"relPath":"b.md"'), 'external change pushed over SSE')
httpReq.destroy()
// session lane: changes-read class
{
  const sessChunks = []
  const sTok = issueToken({ secret: sseSecret, scope: 'changes-read', worktreeId: 'sess-x', ttlSeconds: 30 })
  const rq3 = http.get({ host: '127.0.0.1', port: ssePort, path: '/?session=sess-x&avt=' + encodeURIComponent(sTok) }, (rs) => {
    rs.on('data', (c) => sessChunks.push(c.toString()))
  })
  await until(() => sessChunks.join('').startsWith('retry: 2000'), 'session lane opens with a changes-read token')
  assert.equal(await sseStatus('/?session=sess-x&avt=' + encodeURIComponent(
    issueToken({ secret: sseSecret, scope: 'tree-read', orgPath: wroot, ttlSeconds: 30 }))), 403,
    'a tree-read token does not open the session lane')
  rq3.destroy()
}
sseSrv.close()
off()
w11.stop()
console.log('arxa-artifact-viewer selftest: GREEN (watcher + SSE)');

// ---- editor-font consumption (2026-09-03, moved to Monaco 2026-09-07) ----
// Monaco measures glyph width from the font it is TOLD, so the var is read
// and passed to openFile. Its fallback is an explicit Fira-free stack landing
// on Menlo: the dsh code token lists "Fira Code" third, and with "SF Mono"
// unresolvable in WKWebView + JetBrains Mono absent it resolved to the
// system-installed Fira Code — the Default pill rendered Fira and the font
// toggle was a visual no-op (render-truthed by in-app width probe).
assert.ok(/getPropertyValue\('--arxa-editor-font'\)\.trim\(\)\s*\|\| '"SF Mono", ui-monospace, "JetBrains Mono", Consolas, "Liberation Mono", Menlo, monospace'/.test(clientSrc),
  'openFile consumes the editor-font var with a Fira-free default fallback')
assert.ok(!clientSrc.includes("|| 'Fira Code'") && !clientSrc.includes('var(--arxa-editor-font,var(--ds-font-family-code))'),
  'editor fallback is neither Fira nor the Fira-containing dsh token')

// ---- Task 11b: worktree-lane events (?session= binds a per-connection watcher)
{
  const wtRoot = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-wtroot-'))
  const orgW = createOrgWatcher({ intervalMs: 60 })
  // Permissive verify: this block tests the session->worktree WATCH wiring,
  // not the token gate (covered above).
  const route = createEventsRoute({ watcher: orgW, resolveSessionRoot: async (id) => id === 'sess-x' ? wtRoot : null, verify: () => true })
  const srv = http.createServer((rq, rs) => { void route.handle(rq, rs) })
  await new Promise((r2) => srv.listen(0, '127.0.0.1', r2))
  const port = srv.address().port
  const wtChunks = []
  const rq1 = http.get({ host: '127.0.0.1', port, path: '/?session=sess-x' }, (rs) => { rs.on('data', (c) => wtChunks.push(c.toString())) })
  await sleep(150)
  fs.writeFileSync(path2.join(wtRoot, 'out.md'), 'agent wrote\n')
  await sleep(400)
  assert.ok(wtChunks.join('').includes('"relPath":"out.md"'), '?session= pushes worktree changes')
  rq1.destroy()
  // unknown session falls back to the org watcher (no worktree events leak)
  const orgChunks = []
  const rq2 = http.get({ host: '127.0.0.1', port, path: '/?session=nope' }, (rs) => { rs.on('data', (c) => orgChunks.push(c.toString())) })
  await sleep(120)
  fs.writeFileSync(path2.join(wtRoot, 'leak.md'), 'x')
  await sleep(300)
  assert.ok(!orgChunks.join('').includes('leak.md'), 'unknown session never watches the worktree')
  rq2.destroy()
  srv.close()
  orgW.stop()
  console.log('arxa-artifact-viewer selftest: GREEN (worktree-lane events)')
}

// ---- Task 7 (closeout 2026-09-13): trust boundaries + runtime freezes -------
{
  // S2: the extension allowlist. Only PINNED VENDORED BUILT-INS registered in
  // monaco-build/src/entry.mjs may execute on the studio origin; arbitrary
  // marketplace and VSIX loading stays disabled until a separately served
  // origin is designed and reviewed. This is the freeze that holds the
  // same-origin extension host (see the threat-model table in
  // docs/plans/artifact-viewer-vscode-monaco.md).
  const PINNED_EXTENSIONS = [
    'theme-defaults', 'dart', 'rust', 'typescript-basics', 'javascript', 'json',
    'html', 'css', 'scss', 'less', 'markdown-basics',
    'markdown-language-features', 'markdown-math', 'media-preview',
  ]
  const imported = [...entrySrc.matchAll(/import '@codingame\/monaco-vscode-([a-z0-9-]+)-default-extension'/g)]
    .map((mm) => mm[1])
  assert.deepEqual([...new Set(imported)].sort(), [...PINNED_EXTENSIONS].sort(),
    'entry.mjs registers exactly the pinned vendored built-ins — nothing else')
  const mbPkg = JSON.parse(fs.readFileSync(path2.join(mbDir, 'package.json'), 'utf8'))
  for (const name of PINNED_EXTENSIONS) {
    assert.equal(mbPkg.dependencies['@codingame/monaco-vscode-' + name + '-default-extension'], '36.2.7',
      'extension ' + name + ' is exact-pinned in the build manifest')
  }
  // No VSIX pipeline, no alternate-domain escape hatch, no runtime extension
  // registration — all three are how the same-origin rule would silently rot.
  // The vite check reads COMMENT-STRIPPED source: the config's prose mentions
  // the vsix plugin while explaining why this build is not one.
  const viteCode = viteSrc.replace(/\/\/[^\n]*/g, '')
  assert.ok(!viteCode.includes('vsix'), 'no vsix plugin in the vite build — VSIX loading stays off')
  // Property-key form, not the word: entry.mjs NARRATES iframeAlternateDomain
  // (why it stays unset) while never passing it.
  assert.ok(!/iframeAlternateDomain\s*:/.test(entrySrc), 'iframeAlternateDomain stays unset (the host is same-origin by record, not by accident)')
  assert.ok(!/registerExtension\s*\(/.test(entrySrc), 'no runtime registerExtension call — the allowlist is the BUILD, not a filter')
  assert.ok(mbPkg.devDependencies['@codingame/monaco-vscode-rollup-vsix-plugin'] !== undefined
    && !viteCode.includes('rollup-vsix'), 'the vsix plugin stays an unused devDependency, never wired')

  // S3/S5: the trust probes and the autoSave ruling are pinned in the browser
  // gate (spike.html runs them); these pins keep the harness honest about it.
  assert.ok(spikeSrc.includes('out.threat.extHostOrigin === location.origin'),
    'the browser gate asserts the ext host iframe is the SAME ORIGIN the threat table records')
  assert.ok(spikeSrc.includes('out.threat.extHostReachesParentDoc === true'),
    'and that it can reach the parent DOM — the recorded residual, held by the allowlist freeze above')
  assert.ok(spikeSrc.includes("out.threat.autoSaveProbe.filesAutoSave === 'afterDelay'")
    && spikeSrc.includes('out.threat.autoSaveProbe.flushedToOverlayMs !== null'),
    'the browser gate records VS Code\'s afterDelay flush into the IN-MEMORY overlay')
  assert.ok(!entrySrc.includes("'files.autoSave'"),
    'the bundle never sets files.autoSave — the tested 1.5s viewer debounce stays the one DISK save owner (ruling 4)')
  assert.ok(entrySrc.includes('export async function overlayBytes') && entrySrc.includes('export async function configValue'),
    'the harness probes exist on the bundle (overlay bytes + resolved config)')

  // S3: no cookie is ever set by a viewer surface (threat-table row).
  assert.equal(r1.headers['set-cookie'], undefined, 'the org origin sets no cookie')
  assert.equal(vget.headers['set-cookie'], undefined, 'the vendor route sets no cookie')

  // S7: pdf.js stays vendored (program ruling 3). The client prettier FORMAT
  // path retired with the aXa header (0.5.0) — the bundle/route lanes above
  // keep guarding the host side; no extension allowlist widening either way.
  assert.ok(clientSrc.includes("ext === '.pdf'") && clientSrc.includes('function PdfView'),
    'the pdf lane stays on the vendored pdf.js (no extension experiment)')
  assert.ok(!PINNED_EXTENSIONS.some((n) => /pdf|prettier/.test(n)),
    'neither pdf nor prettier rides the extension allowlist — they are vendor bundles, not VS Code extensions')

  // S5: one save per settled edit. The debounce coalesces a burst of dirty
  // events into exactly one POST; a later edit gets exactly one more.
  {
    const dirtyStart = clientSrc.indexOf('/** Auto-save:')
    const dirtyEnd = clientSrc.indexOf('React.useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])', dirtyStart)
    assert.ok(dirtyStart >= 0 && dirtyEnd > dirtyStart, 'the onDirty closure is extractable')
    const onDirtySrc = clientSrc.slice(dirtyStart, dirtyEnd)
    const makeOnDirty = new Function('setDirty', 'savePhase', 'setSavePhase', 'saveTimer', 'AUTOSAVE_MS',
      'setTimeout', 'clearTimeout', 'save', onDirtySrc + '\nreturn onDirty')
    const timers = []
    const fired = []
    const fakeSetTimeout = (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length }
    const fakeClearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].live = false }
    const saves = []
    const onDirty = makeOnDirty(
      () => {}, 'idle', () => {},
      { current: null }, 1500, fakeSetTimeout, fakeClearTimeout, () => saves.push(Date.now()))
    onDirty(); onDirty(); onDirty()   // one burst of typing
    assert.equal(timers.length, 3, 'each keystroke re-arms the timer')
    assert.equal(timers.filter((t) => t.live).length, 1, 'the previous timers are cleared — one is live')
    for (const t of timers) if (t.live) { assert.equal(t.ms, 1500, 'the tested 1.5s debounce'); t.fn() }
    assert.equal(saves.length, 1, 'a settled edit saves exactly once')
    onDirty()                         // a later, separate edit
    for (const t of timers) if (t.live) t.fn()
    assert.equal(saves.length, 2, 'the next settled edit saves exactly once more')
  }

  // S8: the gen-ui Diff reconciliation. CONFIRMED: the Diff card receives ONLY
  // model-authored before/after text (the gen_ui tool's components param — no
  // host code reads files into it), so the LCS/Myers upgrade is DEFERRED UNTIL
  // REAL FILE DIFF INPUT. The pins below are the trigger: wiring real file
  // bytes into gen-ui breaks them and forces the bounded renderer + its
  // coverage (insertions, deletions, reordering, hunks, large input, unchanged
  // lines, escaping) instead of a silent upgrade.
  const genClient = fs.readFileSync(path2.join(root, 'plugins', 'gen-ui', 'lib', 'client.js'), 'utf8')
  const genHost = fs.readFileSync(path2.join(root, 'plugins', 'gen-ui', 'lib', 'index.js'), 'utf8')
  assert.match(genClient, /DEFERRED UNTIL REAL FILE DIFF INPUT/,
    'the gen-ui Diff renderer carries the deferral marker where the positional comparison lives')
  // existsSync alone is allowed (it resolves the dsh-tools install, not file
  // content); anything that could READ bytes is the trigger.
  assert.ok(!/readFileSync|readFile\s*\(|createReadStream|execFile|spawn/.test(genHost),
    'TRIGGER: gen-ui reads no file bytes today — the moment it does, this pin breaks and the bounded diff renderer must land (docs/plans/artifact-viewer-implementation.md Task 9)')
  assert.ok(genClient.includes('props.before') && genClient.includes('props.after'),
    'the Diff data contract stays {path,before,after} either way')

  // The events lane now mints its lane token before opening the stream (the
  // S3 close): pin the client side of the gate.
  const evStart = clientSrc.indexOf('// D86 external-change push.')
  const evEnd = clientSrc.indexOf('const resetForOpen', evStart)
  const evSrc = clientSrc.slice(evStart, evEnd)
  assert.ok(evSrc.includes("scope: 'changes-read'") && evSrc.includes("scope: 'tree-read'"),
    'the events stream is opened with a lane-bound token (changes-read for worktrees, tree-read for roots/org)')
  assert.match(evSrc, /es\.onerror[\s\S]{0,400}?setTimeout\(connect/,
    'a failed stream re-mints (the token is short-lived) instead of dying on a stale reconnect URL')
  console.log('arxa-artifact-viewer selftest: GREEN (Task 7 trust boundaries + runtime freezes)')
}
