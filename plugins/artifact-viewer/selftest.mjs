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

// D88-D93: the generated arxa-frame module must match its generator (drift
// gate) and the client must never register into shell.overlay again.
{
  const gen = execFileSync(process.execPath, [join(root, 'scripts', 'gen-frame.mjs'), '--check'], { cwd: root })
  assert.match(String(gen), /--check OK/, 'arxa-frame drift gate: generated client matches gen-frame.mjs')
  const genIns = execFileSync(process.execPath, [join(root, 'scripts', 'gen-insight-css.mjs'), '--check'], { cwd: root })
  assert.match(String(genIns), /--check OK/, 'insight-css drift gate: the lifted ToolRow/ToolDetails copy matches the stock bundle')
  const clientSrc = fs.readFileSync(join(here, 'lib', 'client.js'), 'utf8')
  assert.doesNotMatch(clientSrc, /inject\('shell\.overlay'/, 'viewer never floats over the frame again (D88)')
  assert.match(clientSrc, /inject\('viewer'/, 'viewer registers into the docked viewer seat')
  const frameSrc = fs.readFileSync(join(root, 'plugins', 'arxa-frame', 'lib', 'client.js'), 'utf8')
  assert.match(frameSrc, /renderSlot\("viewer"/, 'frame renders the viewer seat')
  assert.match(frameSrc, /session-maybe/, 'viewer seat is session-scoped (D88 presence)')
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
  // T5/D91 card routing: chips open the docked column, wt lane first, org fallback
  const t5client = fs.readFileSync(join(here, 'lib', 'client.js'), 'utf8')
  assert.match(t5client, /\[data-produced-files-row\] button\[title\]/, 'interceptor targets stock produced-file chips only')
  assert.match(t5client, /CustomEvent\('arxa-av-open', \{ detail: sessionId \? \{ sessionId, relPath: path \}/, 'chip click dispatches the arxa-av-open bridge')
  assert.match(t5client, /path === '\.'\) return/, 'stock show-in-folder affordance stays stock')
  assert.match(t5client, /if \(ok\) return/, 'wt lane wins; org lane is the fallback on a miss')
  // Phase 1 conformance rebuild (docs/plans/dsh-plugin-ui-conformance.md):
  // store-based ingress replaces the D93 retry ladder + parked payload.
  assert.match(t5client, /const openArtifact = async \(relPathArg\) => \{/, 'openArtifact takes the relPath argument')
  assert.match(t5client, /String\(relPathArg \|\| ''\)/, 'the debug path-input form and its draft state are gone')
  const t5code = t5client.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.doesNotMatch(t5code, /__ARXA_AV_PENDING__|for \(const delay of \[0, 120, 400, 1000, 2000\]\)|setInterval\(/,
    'retry ladder, parked window global, and the 4s session poll are all gone (comments may narrate)')
  assert.doesNotMatch(t5code, /__ARXA_AV_CHIP_INTERCEPT__|__ARXA_SESSIONS__|__ARXA_AV_DEBUG__/,
    'window debug globals are gone (ctx.effect disposal replaces the install-once flag)')
  assert.match(t5client, /function createAvStore\(\)/, 'ingress store exists')
  assert.match(t5client, /store\.request\(\{ sessionId: detail\.sessionId \|\| null, relPath: detail\.relPath \}\)/, 'apply() parks opens in the store')
  assert.match(t5client, /store\.consume\(\)/, 'the mounted panel consumes the pending open')
  assert.match(t5client, /ctx\.layout\.openViewer\(\)/, 'the listener opens the column through the layout face')
  assert.match(t5client, /sessions\.list\.subscribe/, 'session tracking subscribes the dsh sessions snapshot store')
  assert.match(t5client, /MutationObserver/, 'first-produced-file-per-turn auto-open observer present')
  assert.match(t5client, /ctx\.locale\.register\(NS, \{ en, pl, fr \}\)/, 'locale NS registered with en/pl/fr dictionaries')
  assert.match(t5client, /const inject = \['slots', 'connection', 'layout', 'sessions', 'locale'\]/, 'inject declares locale')
  assert.ok((t5client.match(/ctx\.effect\(/g) || []).length >= 5, 'every side effect sits inside ctx.effect (>=5)')
  for (const prim of ['P.StateDot', 'P.Tooltip', 'P.Menu', 'P.Button', 'P.writeClipboard', 'P.IconCloseOutline16', 'P.IconCopyOutline16']) {
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
  assert.match(t5client, /if \(state\.phase === 'insight'\) \{ setState\(\(st\) => \(\{ \.\.\.st, sessionId: id \}\)\); return \}/,
    'a session switch re-points an open insight panel instead of closing the column')
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
  // 2026-09-01 user report trio: session-scoped close, maximize glyph,
  // toolbar tooltip placement.
  assert.match(t5client, /IconFullscreenOutline16/, 'maximize uses the fullscreen glyph')
  assert.doesNotMatch(t5client, /iconBtn\('max'[^]*?IconBrowseOutline16/, 'maximize no longer carries the browse glyph')
  {
    const calls = (t5client.match(/P\.Tooltip, \{/g) || []).length
    const bottom = (t5client.match(/side: 'bottom'/g) || []).length
    assert.ok(calls > 0 && calls === bottom, 'every viewer tooltip pins side bottom (' + bottom + '/' + calls + ') — toolbar tooltips must never cover sibling buttons')
  }
  assert.match(t5client, /seenSessionRef\.current = id/, 'session tracker records every id incl. null (null->X must close a stale viewer)')
  assert.match(t5client, /wtRef\.current\.sessionId === id\) return/, 'a shown file bound to the new current session survives the switch')
  assert.match(t5client, /if \(frameProps\.close\) frameProps\.close\(\)\n\s*setOpen\(false\)/, 'the session-switch reset closes the LAYOUT column, not only panel state')
  assert.match(t5client, /typeof l\.closeViewer === 'function'/, 'the session mirror enforces the close at the layout level — the seat remount outlives any in-panel close')
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
for (const f of ['codemirror.js', 'markdown.js', 'pdf.js', 'pdf.worker.js',
  'prettier.js', 'icons.js']) {
  assert.ok(fs.existsSync(path2.join(vendorDir, f)), 'vendored bundle present: ' + f)
  const bytes = fs.readFileSync(path2.join(vendorDir, f))
  assert.ok(bytes.length > 50_000, f + ' is a real bundle (' + bytes.length + ' bytes)')
  assert.ok(bytes.toString('utf8').slice(0, 300).includes('GENERATED by lib/vendor.js'), f + ' carries provenance banner')
}
const vr = createVendorRoutes({ vendorDir })
const vhttp = http.createServer((rq, rs) => { void vr.handle(rq, rs) })
await new Promise((r2) => vhttp.listen(0, '127.0.0.1', r2))
const vport = vhttp.address().port
const vget = await req(vport, '/codemirror.js')
assert.equal(vget.status, 200, 'vendor route serves codemirror.js')
assert.equal(vget.headers['content-type'], 'text/javascript; charset=utf-8')
assert.ok(vget.body.startsWith('/* arxa-artifact-viewer vendored bundle'), 'provenance banner served')
assert.equal((await req(vport, '/markdown.js')).status, 200)
assert.equal((await req(vport, '/codemirror.js', { method: 'POST' })).status, 405, 'vendor route GET-only')
const vt = await req(vport, '/%2e%2e/index.js')
assert.ok(vt.status === 404 || vt.status === 403, 'vendor traversal refused, got ' + vt.status)
// 2026 editor (grilled 2026-09-03): theme port, lazy prettier, icon subset,
// Fira Code woff2 with a real font content-type. ArxaTheme rides INSIDE the
// codemirror bundle — a second IIFE would duplicate @codemirror/state and
// break every extension instanceof check (measured live 2026-09-03).
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
assert.ok(!fs.existsSync(path2.join(vendorDir, 'themes.js')), 'no separate themes bundle (single @codemirror instance)')
const vThemes = fs.readFileSync(path2.join(vendorDir, 'codemirror.js'), 'utf8')
assert.ok(vThemes.includes('ArxaTheme='), 'codemirror bundle sets ArxaTheme')
assert.ok(vThemes.includes('2026 Dark') && vThemes.includes('2026 Light'), 'both 2026 palettes vendored')
assert.ok(vThemes.includes('#121314'), '2026 Dark editor background in palette')
assert.ok(vThemes.includes('#ff7b72'), 'GitHub keyword red in palette')
assert.ok(vThemes.includes('cm-selectionBackground') && vThemes.includes('cm-gutters'), 'editor chrome mapped')
const vCM = fs.readFileSync(path2.join(vendorDir, 'codemirror.js'), 'utf8')
for (const key of ['langForExt', 'syntaxHighlighting', 'Compartment', 'indentUnit', 'legacy']) {
  assert.ok(vCM.includes(key), 'ArxaCM exports ' + key)
}
for (const key of ['parsers:', 'resolveTag:', 'highlightTree:']) {
  assert.ok(vCM.includes(key), 'ArxaCM exports ' + key + ' (single lezer instance for the md preview)')
}
const vMD = fs.readFileSync(path2.join(vendorDir, 'markdown.js'), 'utf8')
assert.ok(!vMD.includes('pythonLanguage') && !vMD.includes('@lezer/highlight'), 'md bundle carries no second lezer/parsers copy')
const vPrettier = fs.readFileSync(path2.join(vendorDir, 'prettier.js'), 'utf8')
assert.ok(vPrettier.includes('window.ArxaPrettier=') && vPrettier.includes('parserForExt'), 'prettier bundle shape')
assert.ok(vPrettier.includes('typescript') && vPrettier.includes('scss'), 'prettier parser coverage')
const vIcons = fs.readFileSync(path2.join(vendorDir, 'icons.js'), 'utf8')
assert.ok(vIcons.includes('window.ArxaIcons=') && vIcons.includes('folder-open'), 'icons bundle shape')
assert.ok(vIcons.includes('width="16" height="16"'), 'material SVGs pinned to 16px')
assert.ok(/#[0-9a-fA-F]{6}/.test(vIcons), 'material icons carry brand colors (full color)')
await new Promise((r2) => vhttp.close(r2))
// Markdown lane contract: the view reads window.ArxaMD, so the client must
// actually kick the vendored markdown.js load (else the placeholder hangs).
const clientSrc = fs.readFileSync(path2.join(here, 'lib', 'client.js'), 'utf8')
assert.ok(clientSrc.includes("ensureVendor('markdown.js', 'ArxaMD')"), 'client loads the vendored markdown bundle (window.ArxaMD)')
// 2026 editor client contracts (grilled 2026-09-03).
assert.ok(clientSrc.includes("'.dart'"), '.dart joins the code lane')
assert.match(clientSrc, /ensureVendor\('codemirror\.js', 'ArxaCM'\)[\s\S]{0,120}CM\.ArxaTheme/, 'palette read from the single CM bundle')
assert.match(clientSrc, /ensureVendor\('icons\.js', 'ArxaIcons'\)/, 'client loads the material icon subset')
assert.match(clientSrc, /ensureVendor\('prettier\.js', 'ArxaPrettier'\)/, 'prettier stays lazy (loaded only on format)')
assert.ok(clientSrc.includes('CM.langForExt(ext)'), 'language routing rides the bundle map')
assert.ok(clientSrc.includes('detectIndent('), 'indentation detected per file (VS Code detectIndentation)')
assert.ok(clientSrc.includes('FORMAT_EXTS'), 'format-visible extension list present')
assert.ok(clientSrc.includes("'Shift-Alt-F'"), 'VS Code format chord bound')
assert.match(clientSrc, /IconEnhanceOutline16/, 'format action uses the enhance glyph')
assert.ok(clientSrc.includes('aXa_av_palMd'), 'markdown preview adopts the palette chrome')
assert.ok(clientSrc.includes("'--aXa_av_pal-bg'"), 'palette CSS vars set on the root')
assert.ok(clientSrc.includes('data-ds-dark-theme'), 'palette follows the dsh dark flag')
assert.ok(clientSrc.includes('--arxa-editor-font'), 'editor font follows the settings choice')
assert.ok(clientSrc.includes('aXa_av_fileIcon'), 'viewer title carries the material file icon')
// 2026-09-03 sweep fixes.
assert.ok(clientSrc.includes('unwatchPal'), 'panel palette subscription unsubscribes on remount')
assert.match(clientSrc, /h\(DiffView, \{ relPath: state\.relPath/, 'diff surface receives the file identity')
assert.ok(clientSrc.includes('langComp.of(CM.langForExt(relPath)'), 'diff pane colors by language')
assert.ok(clientSrc.includes('window.ArxaMD.setParsers'), 'preview highlighter fed from the single CM instance')
assert.ok(clientSrc.includes('data-arxa-vendor'), 'vendor script tags marked for cross-loader reuse')
// Prettier viewer toggle: ON by default, persisted, gates every format path.
assert.ok(clientSrc.includes("'arxa.av.prettier'"), 'prettier toggle persists its choice')
assert.ok(clientSrc.includes("!== 'off'"), 'prettier defaults ON (unset key = on)')
assert.ok(clientSrc.includes('FORMAT_EXTS.has(formatExt) && prettierOn'), 'prettier toggle gates the format action (button + Shift-Alt-F)')
assert.ok(clientSrc.includes("'aria-pressed'"), 'prettier toggle exposes pressed state')
assert.ok(clientSrc.includes('aXa_av_prettierMark'), 'prettier brand chip rides the top bar')
assert.ok(clientSrc.includes("'action.prettier.off'"), 'prettier toggle locales wired')

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

// SSE route over a real connection
const sse = createEventsRoute({ watcher: w11 })
const sseSrv = http.createServer((rq, rs) => { void sse.handle(rq, rs) })
await new Promise((r2) => sseSrv.listen(0, '127.0.0.1', r2))
const ssePort = sseSrv.address().port
const sseChunks = []
const httpReq = http.get({ host: '127.0.0.1', port: ssePort, path: '/' }, (rs) => {
  rs.on('data', (c) => sseChunks.push(c.toString()))
})
await until(() => sseChunks.join('').startsWith('retry: 2000'), 'SSE retry frame sent')
fs.writeFileSync(path2.join(wroot, 'b.md'), 'pushed\n')
await until(() => sseChunks.join('').includes('"relPath":"b.md"'), 'external change pushed over SSE')
httpReq.destroy()
sseSrv.close()
off()
w11.stop()
console.log('arxa-artifact-viewer selftest: GREEN (watcher + SSE)');

// ---- editor-font consumption (2026-09-03): the cm-content rule's fallback
// must ride the REAL dsh mono token (--ds-font-family-code). --dsw-font-mono
// never existed; a var() chain ending in an undefined token is invalid at
// computed-value time, the declaration dies, and CM's built-in monospace
// inherits — the editor-font setting silently did nothing.
assert.ok(!clientSrc.includes('--dsw-font-mono'), 'no phantom --dsw-font-mono token in the viewer css')
// 2026-09-01: the fallback must NOT be --ds-font-family-code either — that
// token lists "Fira Code" third, and with "SF Mono" unresolvable in WKWebView
// + JetBrains Mono absent it resolved to the system-installed Fira Code:
// the Default pill rendered Fira and the font toggle was a visual no-op
// (render-truthed by in-app width probe: token == "Fira Code" at 366.61px).
// The editor default is an explicit Fira-free stack landing on Menlo.
assert.ok(clientSrc.includes('font-family:var(--arxa-editor-font,"SF Mono",ui-monospace,"JetBrains Mono",Consolas,"Liberation Mono",Menlo,monospace)'), 'cm-content consumes the editor-font var with a Fira-free default fallback')
assert.ok(!clientSrc.includes('var(--arxa-editor-font,var(--ds-font-family-code))'), 'editor fallback no longer rides the Fira-containing dsh token')

// ---- Task 11b: worktree-lane events (?session= binds a per-connection watcher)
{
  const wtRoot = fs.mkdtempSync(path2.join(os.tmpdir(), 'arxa-av-wtroot-'))
  const orgW = createOrgWatcher({ intervalMs: 60 })
  const route = createEventsRoute({ watcher: orgW, resolveSessionRoot: async (id) => id === 'sess-x' ? wtRoot : null })
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
