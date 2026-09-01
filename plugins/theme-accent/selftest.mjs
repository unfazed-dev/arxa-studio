// arxa-theme-accent selftest — run: node plugins/theme-accent/selftest.mjs
// Exercises the host half's routes against a fake ctx (the same shape the
// engine passes at boot: webServer.register + req/res pairs), and the
// persistence seam against a throwaway ARXA_HOME.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAccentStore, accentFilePath, apply } from './lib/index.js'
import * as mod from './lib/index.js'

// 0. D84: webServer is a cordis SERVICE and apply() reads it synchronously —
// the module must declare inject or the engine boot dies cold on profile
// re-materialization ("cannot get property \"webServer\" without inject",
// engine.log 2026-08-30, every boot of payload cf18c6018985).
assert.deepEqual(mod.inject, ['webServer'], 'declares inject: ["webServer"]')

const env = { ...process.env, ARXA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-accent-')) }

// 1. empty store reads null (never chose)
const store = createAccentStore(env)
assert.equal(store.read(), null, 'fresh home reads null')

// 2. write + read round-trip; junk rejected
assert.equal(store.write('#12D49A'), '#12D49A')
assert.equal(store.read(), '#12D49A', 'persisted accent reads back')
assert.throws(() => store.write('#FF0000'), /accent must be one of/, 'off-palette rejected')
assert.throws(() => store.write(undefined), /accent must be one of/, 'missing accent rejected')
assert.equal(fs.readFileSync(accentFilePath(env), 'utf8').includes('"accent": "#12D49A"'), true)

// 3. the route mounts ONCE and dispatches on req.method over fake req/res
// pairs (D84: dsh-host-webserver keys routes by (kind, path) — a second
// exact registration of the same path throws and kills the engine boot).
const routes = {}
const ctx = { webServer: { register(r) { routes[r.path] = r } } }
apply(ctx, { store })
assert.equal(Object.keys(routes).length, 1, 'exactly one registration for the path')
const route = routes['/__arxa/theme-accent']

function fakeRes() {
  let done
  const promise = new Promise((resolve) => { done = resolve })
  const res = {
    statusCode: 0, headers: null, body: '', done: promise,
    writeHead(status, headers) { this.statusCode = status; this.headers = headers },
    end(body) { this.body = body; done(this) },
  }
  return res
}
function fakeReq(raw, method = 'GET') {
  const req = { method, on(ev, fn) { if (ev === 'end') queueMicrotask(fn); if (ev === 'data' && raw) fn(raw) } }
  return req
}

let r1 = fakeRes()
await route.handler(fakeReq(), r1); r1 = await r1.done
assert.equal(r1.statusCode, 200)
assert.deepEqual(JSON.parse(r1.body), { accent: '#12D49A' }, 'GET serves the persisted accent')

let r2 = fakeRes()
await route.handler(fakeReq(JSON.stringify({ accent: '#0EE4E0' }), 'PUT'), r2); r2 = await r2.done
assert.equal(r2.statusCode, 200)
assert.deepEqual(JSON.parse(r2.body), { accent: '#0EE4E0' })

let r3 = fakeRes()
await route.handler(fakeReq(), r3); r3 = await r3.done
assert.deepEqual(JSON.parse(r3.body), { accent: '#0EE4E0' }, 'GET reflects the PUT')

let r4 = fakeRes()
await route.handler(fakeReq(JSON.stringify({ accent: '#FF0000' }), 'PUT'), r4); r4 = await r4.done
assert.equal(r4.statusCode, 400, 'off-palette PUT is 400')

fs.rmSync(env.ARXA_HOME, { recursive: true, force: true })

// 2026-09-03: editor font row — client-source contracts (the row is pure
// client behavior; the host half is unchanged and covered above).
const clientSrc = fs.readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
assert.ok(clientSrc.includes('FONT_STORE_KEY'), 'font choice storage key present')
assert.ok(clientSrc.includes('--arxa-editor-font'), 'font choice applies the editor var')
assert.ok(clientSrc.includes('fira-code-latin.woff2') && clientSrc.includes('fira-code-latin-ext.woff2'), 'both Fira Code subsets @font-faced')
assert.ok(clientSrc.includes('unicode-range:U+0100'), 'latin-ext unicode-range covers pl/fr')
assert.ok(clientSrc.includes('EditorFontRow') && clientSrc.includes("id: 'arxa-theme-accent-font'"), 'font row registered in settings.general.item')
assert.ok(clientSrc.includes('removeProperty'), 'unknown font choice clears the editor var to the css fallback')

// ---- editor-font wiring (2026-09-03 user report: Fira "not wired up") --------
// Root cause: the stack referenced --dsw-font-mono, a token that DOES NOT
// EXIST in dsh (the real mono token is --ds-font-family-code). A var() chain
// ending in an undefined token is invalid at computed-value time, so the
// cm-content font-family declaration silently died and CodeMirror's built-in
// .cm-scroller{font-family:monospace} won — picking Fira changed nothing.
// (2026-09-01 update: the fira stack no longer rides that token either — it
// contains "Fira Code" third, which matched the system-installed Fira and
// made Default == Fira. Both stacks are now explicit; see the Fira-free
// default block below.)
assert.ok(!clientSrc.includes('--dsw-font-mono'), 'no phantom --dsw-font-mono token anywhere')

// ---- desktop-webview preload (2026-09-01 user report: Fira not applied in ---
// the DESKTOP app; fine in Chrome) --------------------------------------------
// Root cause: the CSS @font-face lazy-loads at first use — the exact moment
// the viewer's CodeMirror first paints. macOS 26 (Tahoe) app webviews have a
// WebKit regression in that window: already-laid-out text never re-renders
// when the webfont resolves (Apple FB18869578 class). The FontFace-API
// preload at plugin load closes the race: editors created later paint with
// the real font from the first frame. (Verified in-app: bytes fetch OK,
// FontFace registration OK; lazily-timed faces render fallback forever.)
assert.ok(clientSrc.includes('preloadEditorFont'), 'editor webfont preloads at plugin load')
assert.ok(clientSrc.includes("new FontFace('Fira Code Variable'"), 'faces register through the FontFace API')
assert.ok(clientSrc.includes('f.load()'), 'preload awaits face load, not just fetch')
assert.ok(/preloadEditorFont\(\)/.test(clientSrc.slice(clientSrc.indexOf('function apply(ctx)'))), 'apply() starts the preload at page load')

// ---- live font preview (2026-09-01 follow-up: "toggling shows no change") ----
// The settings modal UNMOUNTS the docked viewer, so a pick had no on-screen
// editor to compare against (verified in-app: .cm-content absent while the
// modal is open). The mechanism itself works end-to-end — user-verified via
// overlay force-buttons that UNFORCE==FORCE-FIRA. The row therefore ships a
// ligature battery preview that re-renders on pick: the feedback the flow
// was missing.
assert.ok(clientSrc.includes('FONT_PREVIEW'), 'font row defines a preview battery')
assert.ok(clientSrc.includes('a => b >= c != d |> 0OoIl1 :: -> =>'), 'battery exercises ligature pairs => >= != |> :: ->')
assert.ok(clientSrc.includes('fontStackFor'), 'preview resolves its font stack per selection')
assert.ok(clientSrc.includes('arxaAc_fontPreview'), 'preview has its own css class')
assert.ok(/fontFamily: fontStackFor\(font\)/.test(clientSrc), 'preview fontFamily follows the selected font reactively')

// ---- Fira-free default stack (2026-09-01: "default renders Fira too") ----
// Render-truthed in-app with a width probe: var(--ds-font-family-code)
// measured IDENTICAL to explicit "Fira Code" (366.61px for a 47-char battery;
// Menlo 367.86px, unmatched family names 242.31px proportional fallback).
// "SF Mono" is unresolvable in a non-Safari WKWebView and JetBrains Mono was
// not installed, so the token's third entry "Fira Code" matched the
// system-installed Fira — Default == Fira, toggle a visual no-op. The editor
// default is now an explicit stack with no Fira name anywhere.
const defLine = clientSrc.split('\n').find((l) => l.includes('const DEFAULT_EDITOR_STACK'))
assert.ok(defLine, 'default editor stack is an explicit const')
assert.ok(!/fira/i.test(defLine), 'default editor stack contains no Fira name')
assert.ok(defLine.includes('Menlo') && defLine.includes('ui-monospace'), 'default stack lands on platform mono')
const firaLine = clientSrc.split('\n').find((l) => l.includes('const FIRA_EDITOR_STACK'))
assert.ok(firaLine && firaLine.includes("'Fira Code Variable'") && firaLine.includes("'Fira Code'") && firaLine.includes('DEFAULT_EDITOR_STACK'), 'fira stack = Variable, static Fira, then the default stack')
assert.ok(clientSrc.includes("id === 'fira' ? FIRA_EDITOR_STACK : DEFAULT_EDITOR_STACK"), 'preview and pills share the two canonical stacks')
assert.ok(!clientSrc.includes('arxaAc_fontPreview{font-size:13px;line-height:20px;' +
  'padding:0 0 14px;color:var(--dsw-alias-label-primary);' +
  'white-space:pre;overflow-x:auto;font-family:var(--ds-font-family-code)}'), 'preview css default no longer rides the Fira-containing token')
assert.ok(!/stack: "'Fira Code Variable', var\(--ds-font-family-code\)"/.test(clientSrc), 'fira pill no longer falls back into the Fira-containing token')

console.log('arxa-theme-accent selftest: ALL GREEN')
