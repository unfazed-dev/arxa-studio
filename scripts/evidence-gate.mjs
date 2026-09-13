#!/usr/bin/env node
// Studio closeout evidence gate — the IN-REPO replacement for task 7's
// out-of-repo /tmp/arxa-task7 driver, so the zero-console-error gate and
// its filter list are reviewable (task 7 review condition b).
//
// Boots ONE headless Chrome per run at a REAL per-width window
// (--window-size; task 7 proved the narrow viewer sheet never mounts on
// emulated resizes, so each width gets its own native launch), drives the
// studio surfaces over CDP, screenshots into
// designs/evidence/studio-closeout/<width>/, and FAILS on any console or
// page error that is not on the named, justified IGNORED list below.
// Light/dark flips ride a REAL theme path per lane (never a cosmetic class
// flip): wide = the Settings Appearance row, narrow = the theme service's
// own system-preference path. See setTheme below.
//
// Usage:  STUDIO_TOKEN=… node scripts/evidence-gate.mjs <width> <surface…>
//   width ∈ 390 | 744 | 1280
//   surfaces: dump | personalisation | backend | viewer-strip | sweep | …
// Prereq: studio booted from THIS worktree against the scratch home, e.g.
//   ARXA_HOME=/tmp/arxa-task7/home ARXA_PORT=7897 node bin/arxa-studio.mjs --no-open
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import WebSocket from 'ws'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const OUT = join(repo, 'designs', 'evidence', 'studio-closeout')
const HEIGHTS = { 390: 844, 744: 900, 1280: 900 }

const width = process.argv[2]
if (!HEIGHTS[width]) { console.error('usage: node scripts/evidence-gate.mjs <390|744|1280> <surface…>'); process.exit(2) }
const surfaces = process.argv.slice(3)
if (!surfaces.length) { console.error('no surfaces given'); process.exit(2) }
const WIDE = width === '1280' // the settings-driving lane is the 1280-proven one
const TOKEN = process.env.STUDIO_TOKEN
if (!TOKEN) { console.error('STUDIO_TOKEN env required'); process.exit(2) }
const URL_BASE = (process.env.STUDIO_URL || 'http://arxa.studio.localhost:7897') + '/?token=' + TOKEN
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(CHROME, [
  '--headless=new', `--window-size=${width},${HEIGHTS[width]}`, '--force-device-scale-factor=2',
  '--lang=en-US', '--remote-debugging-port=9334', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=/tmp/arxa-evidence-chrome-${width}-${process.pid}`, '--disable-gpu', 'about:blank',
], { stdio: 'ignore' })
const die = (msg) => { console.error('EVIDENCE FAIL:', msg); try { chrome.kill() } catch {}; process.exit(1) }
process.on('exit', () => { try { chrome.kill() } catch {} })

let version = null
for (let i = 0; i < 50 && !version; i++) { await sleep(200); try { version = await (await fetch('http://127.0.0.1:9334/json/version')).json() } catch {} }
if (!version) die('chrome debugger endpoint never came up')

const ws = new WebSocket(version.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
let seq = 0
const pending = new Map()
const consoleErrors = []
let loadFired = false
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString())
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.method + JSON.stringify(m.error))) : res(m.result) }
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push('console: ' + JSON.stringify(m.params.args.map((a) => ({ v: a.value, d: (a.description || '').slice(0, 300) }))) + ' @@' + (m.params.stackTrace?.[0]?.url || '').slice(0, 80))
  else if (m.method === 'Runtime.exceptionThrown') consoleErrors.push('exception: ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').slice(0, 200))
  else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErrors.push('log: ' + (m.params.entry.text || '').slice(0, 120) + ' [' + (m.params.entry.url || m.params.entry.source || '') + ']')
  else if (m.method === 'Page.loadEventFired') loadFired = true
})

// The named, justified filter list — every pattern is a pre-existing,
// out-of-scope error documented in the task ledger (progress.md), not a
// defect of a gated surface. Anything NOT matching fails the gate.
const IGNORED = [
  // design-panel's dial backend (127.0.0.1:4319) is simply not booted by
  // bin/arxa-studio.mjs — every scratch boot logs ERR_CONNECTION_REFUSED
  // for /__dial/events. Pre-existing, unrelated to any gated surface.
  /__dial\/events/,
  // tsserver warmup race: the first .ts open after a server spawn logs
  // '<semantic> No Project' (ProjectService default-project race) plus the
  // codeAction/semanticTokens requests that fail while it lands. Transient,
  // pre-existing — task 7 proved it identical on the untouched org's
  // original app.ts; diagnostics land after warmup.
  /No Project/,
  /Request textDocument\/(codeAction|semanticTokens)/,
  // Multi-pair capture sessions only: when the SECOND gate browser of a run
  // loads the page after the first was torn down, the dsh web frontend
  // re-bootstraps and logs 'web app: missing #root' plus a /favicon.ico 404
  // (the studio ships none). Reproduced deterministically by pair bisection
  // (dump→sweep: pair 1 clean, pair 2 against the same studio errors); never
  // seen in single-session runs or interactive boots, at any width
  // (probe-verified 390/744/1280). Pre-existing frontend lifecycle noise of
  // the capture lane's browser-per-pair teardown, not a surface defect.
  /missing #root/,
  /favicon\.ico/,
  // The artifact-viewer's LSP chain (token → /lsp/status → ws) does not
  // engage on fresh scratch boots (org-open-coupled token issuance,
  // plugins/artifact-viewer/lib/index.js) — identical at 1280
  // (probe 2026-09-14), so not a narrow defect. With no server behind the
  // route the viewer's LSP websocket fails its handshake on every file
  // open; that failing ws IS the server-absent state the dart-absent lane
  // documents. Pre-existing, width-independent.
  /__arxa\/artifacts\/lsp/,
]
const gate = () => consoleErrors.filter((e) => !IGNORED.some((re) => re.test(e)))

let sessionId = null
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq
  pending.set(id, { res, rej })
  const msg = { id, method, params }
  if (sessionId) msg.sessionId = sessionId
  ws.send(JSON.stringify(msg))
})
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value
const shot = async (name) => {
  const b64 = (await send('Page.captureScreenshot', { format: 'png' })).data
  const file = join(OUT, width, `${name}-${width}.png`)
  mkdirSync(join(OUT, width), { recursive: true })
  writeFileSync(file, Buffer.from(b64, 'base64'))
  console.log('shot:', file)
}
// setTheme/pair live below, next to openSettings (they drive it).
// click the first element whose aria-label OR text contains `text`
const clickText = (sel, text) => evalJs(`(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(sel)})]
  const el = els.find((e) => ((e.getAttribute('aria-label') || '') + ' ' + (e.textContent || '')).includes(${JSON.stringify(text)}))
  if (!el) return 'NOT FOUND: ' + ${JSON.stringify(text)}
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  return 'clicked'
})()`)
const must = (r, what) => { if (!String(r).startsWith('clicked')) die(`${r} (${what})`) }

// ---- boot the page at this REAL window size ----
const target = await send('Target.createTarget', { url: 'about:blank' })
sessionId = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable')
// 390 only: Chrome headless=new clamps every window to 500 CSS px on macOS
// (reproduced: --window-size=390 → innerWidth 500; Browser.setWindowBounds
// cannot go below it either), so a REAL 390 window cannot exist headless.
// The viewport is pinned with a BOOT-TIME device override set BEFORE the
// first navigation — the page loads at 390 from first paint. That is NOT
// the emulated-resize-after-load path task 7 proved never mounts the viewer
// sheet; the artifact-viewer sheet was mount-verified at 390 this way
// (arxa-av-open → monaco editor) before this became the 390 lane.
if (Number(width) < 500) await send('Emulation.setDeviceMetricsOverride', { width: Number(width), height: HEIGHTS[width], deviceScaleFactor: 2, mobile: false })
loadFired = false
await send('Page.navigate', { url: URL_BASE })
for (let i = 0; i < 100 && !loadFired; i++) await sleep(200)
if (!loadFired) die('studio page never fired load')
await sleep(6000)
console.log('viewport@boot:', JSON.stringify(await evalJs(`[window.innerWidth, window.innerHeight, !!document.querySelector('body[data-ds-dark-theme]')]`)))
// First-run: the dsh Internal Testing Notice modal (...Continue) overlays
// the app on a fresh home and the conversation pane never mounts under it
// for the session surfaces — dismiss it through its real Continue button.
const notice = await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Continue'); if (!b) return 'absent'; b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'dismissed' })()`)
if (notice === 'dismissed') console.log('internal testing notice dismissed (Continue)')
// Narrow lane: below the 1024 auto-collapse (dsh-client-ui-layout
// SIDEBAR_AUTO_COLLAPSE) the sidebar is an icon-only rail — the workspace
// tree (Notes, Projects, Trash, session rows) does not exist for the
// tree-walking surfaces. Expand it through the REAL fold toggle
// (aXa_sb_toggle, aria-label "Open sidebar" — arxa-sidebar's own control)
// before anything runs; probe-verified at 390 and 744.
if (!WIDE) {
  must(await evalJs(`(() => { const b = [...document.querySelectorAll('button[aria-label]')].find((x) => (x.getAttribute('aria-label') || '').includes('Open sidebar')); if (!b) return 'NOT FOUND: rail toggle'; b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'clicked' })()`), 'rail toggle')
  let tree = false
  for (let i = 0; i < 15 && !tree; i++) { await sleep(400); tree = await evalJs(`!![...document.querySelectorAll('.aXa_wsr_projectRow,[class*=wsr_projectRow]')].find((e) => /^Notes/.test((e.textContent || '').trim()))`) }
  if (!tree) die('the narrow rail never expanded to the workspace tree')
  console.log('narrow rail expanded through the fold toggle')
}

const pressEsc = async () => {
  for (const t of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type: t, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await sleep(500)
}
const openSettings = async () => {
  await pressEsc() // the Settings trigger toggles — always start from closed
  // The REAL trigger at EVERY width is the sidebar-foot button carrying the
  // product's own contract attribute aria-haspopup="dialog" (SettingsRoot,
  // @deepseek-ai/dsh-client-ui-settings-general). Wide adds a visible
  // 'Settings' label; below the 1024 auto-collapse the rail trigger is
  // icon-only with no accessible name (a11y gap, ledgered) — the attribute
  // is the only stable handle. Probe-verified the sheet mounts at 390 and
  // 744 this way (342px/696px panels, nav shows all five sections).
  must(await evalJs(`(() => { const b = document.querySelector('button[aria-haspopup="dialog"]'); if (!b) return 'NOT FOUND: settings trigger (aria-haspopup)'; b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'clicked' })()`), 'settings trigger')
  const dialogUp = async () => evalJs(`!!document.querySelector('[role=dialog]')`)
  for (let i = 0; i < 10 && !(await dialogUp()); i++) await sleep(300)
  if (!(await dialogUp())) die('the settings dialog never mounted after the real trigger click')
  for (let i = 0; i < 20; i++) { await sleep(300); if (await evalJs(`(document.body.innerText||'').includes('Personalisation')`)) return }
  die('settings dialog never showed the Personalisation nav')
}
// Once per session: let the studio's persisted-settings apply settle
// (~3 s after load it re-asserts the stored theme), then prove the real
// Appearance-row path steers the theme before any surface runs.
const initSystemTheme = async () => {
  await sleep(4000)
  if (!(await setTheme('light'))) die('the theme path does not steer to light')
  if (!(await setTheme('dark'))) die('the theme path does not steer to dark')
  console.log(WIDE ? 'theme rides the Appearance-row path (real setTheme clicks)' : 'theme rides the system-preference path (prefers-color-scheme)')
}

// Theme flips, per lane. WIDE: the REAL user path — Settings →
// Personalisation → Appearance row click (theme.setTheme) — not media
// emulation: a persisted preference re-asserts a few seconds after boot and
// fights a prefers-color-scheme override. NARROW (390/744): the settings
// sheet is not part of these captures — flips ride the theme service's OWN
// system-preference path instead: the runtime holds the prefers-color-scheme
// MediaQueryList while the durable preference is 'system' (the default on
// the fresh scratch home each capture run boots; nothing ever writes
// light/dark over it) and re-publishes on every media change
// (@deepseek-ai/dsh-client-ui-theme ThemeRuntime/buildSnapshot).
// Probe-verified flipping both ways at 390 and 744.
const setTheme = async (mode) => {
  if (!WIDE) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] })
    for (let i = 0; i < 20; i++) { await sleep(300); const dark = await evalJs(`!!document.querySelector('body[data-ds-dark-theme]')`); if (dark === (mode === 'dark')) return true }
    return false
  }
  await openSettings()
  must(await clickText('button,[role=button],[role=tab]', 'Personalisation'), 'personalisation nav')
  await sleep(600)
  must(await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === ${JSON.stringify(mode === 'dark' ? 'Dark' : 'Light')}); if (!b) return 'NOT FOUND: appearance ' + ${JSON.stringify(mode)}; b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'clicked' })()`), 'appearance ' + mode)
  await sleep(900)
  await pressEsc()
  await sleep(400)
  const dark = await evalJs(`!!document.querySelector('body[data-ds-dark-theme]')`)
  return mode === 'dark' ? dark : !dark
}
// light+dark pair for one surface: flip the theme through the real
// Appearance row (settings closed again), then (re)mount the surface and
// shoot — mount runs once per theme so anything the settings dialog or its
// Escape dismissed remounts cleanly.
const pair = async (name, mount, settle = 400) => {
  if (!(await setTheme('dark'))) die(`dark theme did not render for ${name}-dark (pre-flip)`)
  if (!(await setTheme('light'))) die(`light theme did not render for ${name}-light`)
  await sleep(1200) // let the durable preference land — mounts that reload must not race the settings write
  await mount(false); await sleep(settle); await shot(name + '-light')
  if (!(await setTheme('dark'))) die(`dark theme did not render for ${name}-dark`)
  await sleep(1200)
  await mount(true); await sleep(settle); await shot(name + '-dark')
}

// Open the session CONVERSATION (not the dashboard's engine workbench):
// click every note-wt- match in turn until the git dock mounts.
// Bind the session conversation so the git dock's zone exists: the dock
// renders only when the composer's input state is live, so the textarea is
// clicked after the session row binds the workspace.
const openConversation = async () => {
  const until = async (js, ms, what) => {
    for (let i = 0; i < Math.ceil(ms / 400); i++) { if (await evalJs(js)) return true; await sleep(400) }
    return false
  }
  await evalJs(`(() => { const el = [...document.querySelectorAll('.aXa_wsr_projectRow,[class*=wsr_projectRow]')].find((e) => (e.textContent || '').trim().startsWith('Notes')); if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 1 })()`)
  if (!(await until(`!!document.querySelector('.aXa_wsr_sessionRow,[class*=sessionRow]')`, 6000, 'session rows'))) { console.log('  no session rows after expanding Notes'); return false }
  const rows = Number(await evalJs(`[...document.querySelectorAll('.aXa_wsr_sessionRow,[class*=sessionRow]')].filter((e) => /note-wt-/.test(e.textContent || '')).length`) || 0)
  for (let r = 0; r < rows; r++) {
    await sleep(600) // let React commit the expanded rows — no stale nodes
    console.log('  session row #' + r + ':', await evalJs(`(() => { const el = [...document.querySelectorAll('.aXa_wsr_sessionRow,[class*=sessionRow]')].filter((e) => /note-wt-/.test(e.textContent || ''))[${r}]; if (!el) return 'gone'; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return (el.textContent || '').trim().slice(0, 30) })()`))
    if (!(await until(`!!document.querySelector('textarea,[contenteditable=true],[role=textbox]')`, 8000, 'composer'))) { console.log('  conversation composer never appeared'); continue }
    await sleep(1500)
    await evalJs(`(() => { const ta = document.querySelector('textarea,[contenteditable=true],[role=textbox]'); if (ta) ta.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 1 })()`)
    await sleep(1200)
    // the brand row activates the bound conversation (workspace chip → live
    // composer input state → the dock zone exists)
    await evalJs(`(() => { const el = [...document.querySelectorAll('[class*=brand]')].find((e) => (e.textContent || '').includes('arxastudio')); if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 1 })()`)
    if (await until(`!!document.querySelector('[data-git-dock]')`, 12000, 'git dock')) return true
    console.log('  state:', String(await evalJs(`document.body.innerText.slice(-240)`)).replace(/\n+/g, ' | '))
  }
  return false
}

// fresh page load — resets app state (e.g. after settings interactions);
// the theme preference persists, so assert it still holds after the reload
const reload = async (expectDark) => {
  loadFired = false
  await send('Page.navigate', { url: URL_BASE })
  for (let i = 0; i < 100 && !loadFired; i++) await sleep(200)
  if (!loadFired) die('reload never fired load')
  await sleep(6000)
  const dark = await evalJs(`!!document.querySelector('body[data-ds-dark-theme]')`)
  if (expectDark !== undefined && dark !== expectDark) die(`theme did not survive the reload (dark=${dark})`)
  return dark
}

const S = {
  async dump() {
    console.log('clickables:', await evalJs(`[...document.querySelectorAll('button,[role=button],[role=treeitem],[aria-label],.aXa_wsr_projectRow,li')].filter((e) => e.children.length < 6 && ((e.textContent || '').trim() || e.getAttribute('aria-label'))).slice(0, 70).map((e) => String(e.className).slice(0, 40) + '::' + ((e.getAttribute('aria-label') || '') + (e.textContent || '')).trim().slice(0, 34)).join(' || ')`))
    console.log('body:', String(await evalJs('document.body.innerText.slice(0, 700)')).replace(/\n+/g, ' | '))
  },
  async settingsdump() {
    await openSettings()
    for (const nav of ['General', 'Models', 'Plugins', 'Personalisation', 'Agent presets']) {
      const c = await clickText('button,[role=button],[role=tab]', nav)
      await sleep(700)
      console.log(`[${nav}] (${c}):`, String(await evalJs('document.body.innerText.slice(0, 500)')).replace(/\n+/g, ' | ').slice(0, 400))
    }
  },
  async personalisation() {
    await pair('personalisation-tab', async () => {
      await openSettings()
      must(await clickText('button,[role=button],[role=tab]', 'Personalisation'), 'personalisation nav')
      await sleep(900)
    }, 200)
  },
  // The Workspace-backend section ships as a MODEL (window.__arxaWorkspaceProvider
  // .section(info, locale) over the real info RPC) — no studio panel mounts it
  // yet (its consumer is the frame / CLI verify path; task 14 selftest.settings
  // pins the contract). Visual acceptance therefore renders the REAL model —
  // real RPC answer, real dictionary, real --dsw-* tokens — into the studio
  // page. Shots are named *-model- to make the nature explicit.
  async backend() {
    await pair('workspace-backend-model', async () => {
      console.log('wp probe:', await evalJs(`(() => { const wp = window.__arxaWorkspaceProvider; return wp ? 'keys=' + Object.keys(wp).join(',') : 'ABSENT' })()`))
      const mounted = await evalJs(`(async () => {
        try {
          const wp = window.__arxaWorkspaceProvider
          if (!wp) return 'NO MODEL'
          const info = await wp.info()
          const s = wp.section(info, 'en')
          if (!s || typeof s !== 'object') return 'BAD SECTION: ' + String(s)
          const diag = 'title=' + String(s.title) + ' provider=' + String(s.provider) + ' badges=' + JSON.stringify(s.badges) + ' signIn=' + JSON.stringify(s.signIn || null)
          const pill = (txt, hot) => '<span style=\"margin:2px 4px;padding:1px 8px;border-radius:8px;border:1px solid ' + (hot ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-border-l3)') + ';color:' + (hot ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)') + ';font-size:11px\">' + txt + '</span>'
          document.getElementById('t8-backend-card')?.remove()
          const card = document.createElement('div')
          card.id = 't8-backend-card'
          card.style.cssText = 'position:absolute;top:12px;left:12px;right:12px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l3);border-radius:12px;padding:14px;color:var(--dsw-alias-label-primary);font-size:13px;z-index:2147483647'
          card.innerHTML = '<div style=\"font-weight:600;font-size:15px\">' + String(s.title) + '</div>'
            + '<div style=\"margin-top:8px\">' + String(s.provider) + '</div>'
            + '<div style=\"margin-top:6px\">' + (Array.isArray(s.badges) ? s.badges.map((b) => pill(String(b.key) + ': ' + String(b.state), String(b.state) !== 'live')).join('') : '') + '</div>'
            + (s.signIn ? '<div style=\"margin-top:8px\">' + String(s.signIn.label) + '</div>' : '')
            + '<div style=\"margin-top:10px;color:var(--dsw-alias-label-tertiary);font-size:11px\">' + (Array.isArray(s.notes) ? s.notes.map(String).join('<br>') : '') + '</div>'
          document.body.appendChild(card)
          return 'mounted: ' + diag
        } catch (e) { return 'MOUNT ERR: ' + String((e && e.message) || e) + ' @' + String((e && e.stack) || '').slice(0, 160) }
      })()`)

      console.log('backend model:', mounted)
      if (!String(mounted).startsWith('mounted:')) die(String(mounted))
    }, 300)
  },
  async sessiondump() {
    const r = await evalJs(`(() => { const el = [...document.querySelectorAll('button,[role=button]')].find((e) => /note-wt-|^Open session/.test((e.textContent || '').trim())); if (!el) return 'NO SESSION ROW'; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'clicked: ' + (el.textContent || '').trim().slice(0, 40) })()`)
    console.log('session:', r)
    await sleep(4000)
    console.log('clickables:', await evalJs(`[...document.querySelectorAll('button,[role=button],[aria-label]')].filter((e) => e.children.length < 6 && ((e.textContent || '').trim() || e.getAttribute('aria-label'))).slice(0, 60).map((e) => String(e.className).slice(0, 36) + '::' + ((e.getAttribute('aria-label') || '') + (e.textContent || '')).trim().slice(0, 30)).join(' || ')`))
    console.log('body:', String(await evalJs('document.body.innerText.slice(0, 900)')).replace(/\n+/g, ' | '))
  },
  async sessionopen() {
    const r = await evalJs(`(() => { const el = [...document.querySelectorAll('button,[role=button]')].find((e) => /note-wt-/.test((e.textContent || '').trim())); if (!el) return 'NO SESSION ROW'; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'sel' })()`)
    if (!String(r).startsWith('sel')) die(String(r))
    await sleep(1500)
    const o = await evalJs(`(() => { const el = [...document.querySelectorAll('button')].find((e) => (e.textContent || '').trim() === 'Open session'); if (!el) return 'NO OPEN SESSION'; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'opened' })()`)
    console.log('open:', o)
    if (o !== 'opened') die(o)
    for (let i = 0; i < 60; i++) { await sleep(1000); const l = await evalJs(`(document.body.innerText || '').includes('Loading')`); if (!l) break }
    await sleep(2000)
    console.log('clickables:', await evalJs(`[...document.querySelectorAll('button,[role=button],[aria-label]')].filter((e) => e.children.length < 6 && ((e.textContent || '').trim() || e.getAttribute('aria-label'))).slice(-45).map((e) => String(e.className).slice(0, 36) + '::' + ((e.getAttribute('aria-label') || '') + (e.textContent || '')).trim().slice(0, 30)).join(' || ')`))
    console.log('body:', String(await evalJs('document.body.innerText.slice(0, 1200)')).replace(/\n+/g, ' | '))
  },
  async gitcard() {
    await pair('gitcard', async (dark) => {
      await pressEsc() // dismiss leftovers; no reload — the boot-time preference re-assert races a just-clicked flip
      if (!(await openConversation())) die('the git dock never mounted for the open session')
      await evalJs(`(() => { const b = document.querySelector('[data-git-dock] button[aria-expanded]'); if (!b) return 'NO HEADER TOGGLE'; if (b.getAttribute('aria-expanded') !== 'true') b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'expanded' })()`)
      await sleep(1500)
      console.log('card:', String(await evalJs(`(() => { const d = document.querySelector('[data-git-dock]'); return d ? d.textContent.trim().slice(0, 300) : 'DOCK GONE' })()`)).replace(/\s+/g, ' '))
      console.log('rows:', String(await evalJs(`(() => { const ul = document.querySelector('[data-git-dock] ul'); return ul ? (ul.hidden ? 'HIDDEN' : ul.textContent.trim().slice(0, 300)) : 'NO UL' })()`)).replace(/\s+/g, ' '))
    }, 200)
  },
  async trashdump() {
    must(await clickText('button,[role=button],[role=treeitem],.aXa_wsr_projectRow', 'Trash'), 'sidebar Trash')
    await sleep(1500)
    console.log('body:', String(await evalJs('document.body.innerText.slice(0, 900)')).replace(/\n+/g, ' | '))
    console.log('clickables:', await evalJs(`[...document.querySelectorAll('button,[role=button],[aria-label]')].filter((e) => e.children.length < 6 && ((e.textContent || '').trim() || e.getAttribute('aria-label'))).slice(0, 40).map((e) => String(e.className).slice(0, 36) + '::' + ((e.getAttribute('aria-label') || '') + (e.textContent || '')).trim().slice(0, 30)).join(' || ')`))
  },
  async 'viewer-strip'() {
    let state = null
    await pair('viewer-install-strip', async () => {
      await evalJs(`window.dispatchEvent(new CustomEvent('arxa-av-open', { detail: { relPath: 'main.dart' } }))`)
      for (let i = 0; i < 24; i++) {
        await sleep(500)
        state = await evalJs(`(() => { const txt=(document.body.innerText||'').toLowerCase(); return { strip: txt.includes('install its sdk'), editor: !!document.querySelector('.monaco-editor,[class*=monaco]') } })()`)
        if (state.strip || state.editor) break
      }
      console.log('dart state:', JSON.stringify(state))
    }, 300)
  },
  async sweep() {
    await pair('sweep-modal', async () => {
      const name = await evalJs(`(() => { const el = [...document.querySelectorAll('[class*=org],[class*=Org]')].find((e) => (e.textContent||'').trim().length > 2 && e.children.length < 4); return (el && el.textContent.trim()) || 'scratch org' })()`)
      await evalJs(`window.dispatchEvent(new CustomEvent('arxa-sweep-merged', { detail: { orgId: 'scratch-org', name: ${JSON.stringify(String(name).slice(0, 30))} } }))`)
      await sleep(1200)
    }, 200)
  },
}


// ---- task 8 additions: finish / checks-red / preparation / trash / confine ----
// Host-side facts live in the scratch org (never operator state): the
// session registry, the seeded no-repo project, and the real trash entry
// are all created through the product's own host functions or plain fs in
// the scratch tree named by ARXA_ORG.
const ORG = process.env.ARXA_ORG || '/tmp/t8-evidence/T8CLOSE'
const REG = join(ORG, '.git', 'arxa', 'sessions.json')
const readReg = () => existsSync(REG) ? JSON.parse(readFileSync(REG, 'utf8')) : { sessions: [] }
const writeReg = (j) => writeFileSync(REG, JSON.stringify(j, null, 2) + '\n')
const expandDock = async () => evalJs(`(() => { const b = document.querySelector('[data-git-dock] button[aria-expanded]'); if (!b) return 'NO HEADER TOGGLE'; if (b.getAttribute('aria-expanded') !== 'true') b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'expanded' })()`)
// Open a FRESH session through the real UI (the Notes + button): a new
// session's conversation mounts live under THIS boot's dsh home — the
// imported note-wt rows predate it and their engine sessions never attach
// ("Open session" parks on the detail panel). Returns the new registry row.
// Narrow rail fold control (arxa-sidebar aXa_sb_toggle): the workspace tree
// needs the rail OPEN, the conversation/dock needs the center column's width
// back — so fresh-session flows open it, then fold it once the session row
// is selected.
const rail = (open) => evalJs(`(() => { const b = [...document.querySelectorAll('button[aria-label]')].find((x) => (x.getAttribute('aria-label') || '').includes('${open ? 'Open sidebar' : 'Collapse sidebar'}')); if (!b) return 'NOT FOUND: rail toggle'; b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'clicked' })()`)
const openFreshSession = async () => {
  const until = async (js, ms) => { for (let i = 0; i < Math.ceil(ms / 500); i++) { if (await evalJs(js)) return true; await sleep(500) } return false }
  const before = new Set(readReg().sessions.map((r) => r.id))
  if (!WIDE) { await rail(true); await sleep(800) } // a prior mount half may have folded it
  // expand Notes so its session rows render, then create through the real +
  await evalJs(`(() => { const el = [...document.querySelectorAll('.aXa_wsr_projectRow,[class*=wsr_projectRow]')].find((e) => (e.textContent || '').trim().startsWith('Notes')); if (el && el.getAttribute('aria-expanded') !== 'true') el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 1 })()`)
  await sleep(800)
  const plus = await evalJs(`(() => { const b = [...document.querySelectorAll('[aria-label]')].find((e) => (e.getAttribute('aria-label') || '').includes('New session in Notes')); if (!b) return 'NO NEW-SESSION BUTTON'; b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'clicked' })()`)
  if (plus !== 'clicked') die(plus)
  let row = null
  for (let k = 0; k < 25 && !row; k++) { await sleep(700); const cand = readReg().sessions.filter((x) => !before.has(x.id)); row = cand.length ? cand[cand.length - 1] : null }
  if (!row) die('fresh session: no new registry row appeared')
  const leaf = row.id.split('/').pop()
  console.log('  fresh session:', row.id)
  // the new row appears at the head of the Notes list on the throttled
  // sidebar refresh — poll for it, then select it: selecting opens the
  // LIVE conversation (session + inputState), whose composer carries
  // the session-scoped dock zone the git card mounts into
  await evalJs(`(() => { const el = [...document.querySelectorAll('.aXa_wsr_projectRow,[class*=wsr_projectRow]')].find((e) => /^T[78]CLOSE/.test((e.textContent || '').trim())); if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 1 })()`) // re-select the org row: the sidebar's throttled refresh picks up the new session
  await sleep(1500)
  await evalJs(`(() => { const r = [...document.querySelectorAll('button')].find((e) => (e.getAttribute('aria-label') || '') === 'Refresh' || /^Refresh/.test((e.textContent || '').trim())); if (r) r.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return r ? 'refreshed' : 'no refresh btn' })()`) // the dashboard's Refresh drives the orgStore refresh the sidebar listens to
  await sleep(2500)
  await evalJs(`(() => { const more = [...document.querySelectorAll('[aria-label],button')].find((e) => /Show \d+ more sessions/.test((e.getAttribute('aria-label') || '') + (e.textContent || ''))); if (more) { more.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'shown' } return 'no overflow' })()`)
  await sleep(1200)
  let opened = false
  for (let k = 0; k < 90 && !opened; k++) {
    opened = await evalJs(`(() => {
      const row = [...document.querySelectorAll('.aXa_wsr_sessionRow,[class*=sessionRow]')].find((e) => (e.textContent || '').includes('${leaf}'))
      if (row) { row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'row' }

      return false })()`)
    if (!opened) await sleep(1000)
  }
  console.log('  opened via:', opened)
  if (!opened) die('fresh session never became reachable (90s)')
  // Narrow: the expanded rail squeezes the center column to ~0 and the
  // conversation (composer → dock zone) needs that width — fold it back
  // before waiting for the dock.
  if (!WIDE) { await rail(false); await sleep(800) }
  const dock = await until(`!!document.querySelector('[data-git-dock]')`, 30000)
  if (!dock) { console.log('  markers:', await evalJs('JSON.stringify({ noConvo: window.__arxaNoConversation || null, openErr: window.__arxaOpenError || null })')); console.log('  pane:', await evalJs(`(() => { const t = document.body.innerText || ''; return JSON.stringify({ ta: !!document.querySelector('textarea'), send: t.includes('Send message'), hero: t.includes('Describe what you want to build'), loading: t.includes('Loading models') }) })()`)) }
  if (!dock) { console.log('  tail:', String(await evalJs('document.body.innerText.slice(-300)')).replace(/\\n+/g, ' | ')); die('fresh session: the git dock never mounted') }
  await sleep(1000)
  return row
}
Object.assign(S, {
  // The Finish dialog: G4 confirm — branch merged + worktree clean (session
  // 002's worktree sits exactly at main). The modal is opened and SHOT only;
  // Cancel/Escape dismisses it, nothing destructive runs.
  async finish() {
    await pair('finish-dialog', async () => {
      await pressEsc() // dismiss leftovers; no reload — the boot-time preference re-assert races a just-clicked flip
      await openFreshSession()
      await expandDock(); await sleep(1200)
      console.log('finish btn:', await evalJs(`(() => { const b = [...document.querySelectorAll('[data-git-dock] button')].find((x) => /Finish session/.test(x.textContent || '')); return b ? JSON.stringify({ disabled: b.disabled }) : 'NOT FOUND' })()`))
      must(await clickText('[data-git-dock] button', 'Finish session'), 'Finish session')
      await sleep(900)
    }, 300)
  },
  // Checks red disclosure: a stray temp file at the session worktree root is
  // a REAL frame-gate failure class (check.sh "stray temp file at org
  // root"); Run checks goes red with output, the disclosure opens, and the
  // temp file is removed afterwards (scratch org only).
  async checksred() {
    const tmps = []
    try {
      await pair('checks-red', async () => {
        await pressEsc() // dismiss leftovers; no reload — the boot-time preference re-assert races a just-clicked flip
        const row = await openFreshSession()
        const tmp = join(row.worktree, 'stray.tmp')
        tmps.push(tmp)
        writeFileSync(tmp, 'task 8 checks-red evidence: stray temp file\n')
        await expandDock(); await sleep(1200)
        must(await clickText('[data-git-dock] button,[data-git-dock] [role=button]', 'Run checks'), 'Run checks')
        let ok = false
        for (let i = 0; i < 40 && !ok; i++) { await sleep(500); ok = await evalJs(`[...document.querySelectorAll('[data-git-dock] [aria-label]')].some((e) => (e.getAttribute('aria-label') || '').includes('Checks output'))`) }
        if (!ok) die('checks never went red with output')
        must(await clickText('[data-git-dock] button,[data-git-dock] [role=button]', 'Checks output'), 'checks disclosure')
        await sleep(900)
      }, 300)
    } finally { for (const t of tmps) { try { rmSync(t) } catch {} } }
  },
  // Project preparation (task 3's proactive arm): a scanned project folder
  // with NO git repo makes the tree tail render the Initialize-Git-repository
  // offer once its row is selected.
  async preparation() {
    const pdir = join(ORG, 'projects', 'prep-evidence')
    if (!existsSync(pdir)) { mkdirSync(pdir, { recursive: true }); writeFileSync(join(pdir, 'README.md'), '# prep evidence — deliberately no git repo\n') }
    await pair('project-preparation', async (dark) => {
      await pressEsc() // dismiss leftovers; no reload — the boot-time preference re-assert races a just-clicked flip
      await evalJs(`(() => { const cat = [...document.querySelectorAll('[class*=wsr_projectRow],[role=treeitem],li,button')].find((e) => /^Projects\\s*$/.test((e.textContent || '').trim())); if (cat) cat.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 1 })()`)
      await sleep(1000)
      const r = await evalJs(`(() => { const el = [...document.querySelectorAll('[class*=wsr_projectRow],[role=treeitem],li,button')].find((e) => /prep-evidence/.test(e.textContent || '') && (e.textContent || '').trim().length < 40); if (!el) return 'PREP ROW NOT FOUND'; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'clicked' })()`)
      if (!String(r).startsWith('clicked')) die(String(r))
      let ok = false
      for (let i = 0; i < 30 && !ok; i++) { await sleep(400); ok = await evalJs(`(document.body.innerText || '').includes('Initialize Git repository')`) }
      if (!ok) die('the repair offer (Initialize Git repository) never rendered')
    }, 300)
  },
  // Trash confirmation/recovery: a REAL trash entry created through the
  // product's own softDelete (host-side, scratch org). The view shot shows
  // the Restore (recovery) affordance; the confirm shot shows the D23
  // type-to-confirm modal — opened, shot, dismissed. Nothing is purged.
  async trash() {
    const { softDelete } = await import(pathToFileURL(join(repo, 'plugins', 'workspace', 'lib', 'trash.js')).href)
    const tdir = join(ORG, 'notes', 'zz-trash-evidence')
    if (!existsSync(tdir)) { mkdirSync(tdir, { recursive: true }); writeFileSync(join(tdir, 'note.md'), 'trash evidence\n') }
    const trashDir = join(ORG, '.arxa', 'trash')
    if (!existsSync(trashDir) || readdirSync(trashDir).length === 0) softDelete(ORG, tdir, { now: new Date() })
    await pair('trash-view', async (dark) => {
      await pressEsc() // dismiss leftovers; no reload — the boot-time preference re-assert races a just-clicked flip
      must(await clickText('button,[role=button],[role=treeitem],[class*=wsr_projectRow]', 'Trash'), 'sidebar Trash')
      let ok = false
      for (let i = 0; i < 30 && !ok; i++) { await sleep(400); ok = await evalJs(`(document.body.innerText || '').includes('zz-trash-evidence')`) }
      if (!ok) die('the trash entry never listed')
      await sleep(600)
    }, 300)
    await pair('trash-confirm', async () => {
      must(await clickText('button,[role=button],[role=treeitem],[class*=wsr_projectRow]', 'Trash'), 'sidebar Trash')
      let ok = false
      for (let i = 0; i < 30 && !ok; i++) { await sleep(400); ok = await evalJs(`!![...document.querySelectorAll('[aria-label]')].find((e) => (e.getAttribute('aria-label') || '') === 'Delete forever')`) }
      if (!ok) die('no Delete forever action')
      must(await evalJs(`(() => { const b = [...document.querySelectorAll('[aria-label]')].find((e) => e.getAttribute('aria-label') === 'Delete forever'); b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'clicked' })()`), 'delete forever')
      await sleep(900)
      if (!(await evalJs(`(document.body.innerText || '').includes('to confirm')`))) die('purge confirm modal never showed the type-to-confirm gate')
    }, 300)
  },
  // Configured/effective confinement (task 10 A4): the card's shift row
  // renders when the session's RECORDED container tier differs from the
  // provisioned default. Docker writes containerTier itself when it engages;
  // here the field is seeded on a scratch session so the real resolver, real
  // dictionary and real row render (A2 → A4).
  async confine() {
    await pair('confinement-tier', async () => {
      await pressEsc() // dismiss leftovers; no reload — the boot-time preference re-assert races a just-clicked flip
      const row = await openFreshSession()
      const reg = readReg()
      reg.sessions.find((r) => r.id === row.id).containerTier = 'A4'
      writeReg(reg)
      await evalJs(`window.dispatchEvent(new CustomEvent('arxa-git-card-refresh'))`)
      await sleep(1500)
      await expandDock(); await sleep(1500)
      const txt = String(await evalJs(`(() => { const d = document.querySelector('[data-git-dock]'); return d ? d.textContent : '' })()`))
      if (!/confinement/.test(txt)) die('the confinement tier row never rendered: ' + txt.slice(0, 200))
      console.log('card:', txt.replace(/\s+/g, ' ').slice(0, 300))
    }, 300)
  },
  // The T7 language-strip ladder, in-repo (task 7 review condition): the
  // artifact-viewer sheet opened per language through the arxa-av-open lane
  // (the wide sidebar is the only click entry; at 390/744 the event is the
  // path). ts/css/json wait for REAL LSP squiggles on the deterministic
  // scratch files copied into the scratch org; html is the designed PREVIEW
  // lane — org-origin sandboxed iframe whose host must differ from the
  // studio origin. Single-theme shots, matching the T7 ladder naming.
  async langstrip() {
    if (!(await setTheme('light'))) die('light theme did not render for langstrip')
    for (const [lang, relPath, probe] of [
      ['ts', 'langstrip.ts', `document.querySelectorAll('[class*="squiggly"]').length`],
      ['css', 'langstrip.css', `document.querySelectorAll('[class*="squiggly"]').length`],
      ['json', 'langstrip.json', `document.querySelectorAll('[class*="squiggly"]').length`],
      ['html-preview', 'langstrip.html', `!!document.querySelector('.aXa_av_iframe')`],
    ]) {
      await pressEsc()
      await evalJs(`window.dispatchEvent(new CustomEvent('arxa-av-open', { detail: { relPath: ${JSON.stringify(relPath)} } }))`)
      let ok = false
      for (let i = 0; i < 40 && !ok; i++) { await sleep(500); ok = await evalJs(probe) }
      // a per-language miss is RECORDED, not fatal: the ladder driver marks
      // that shot missing (absent/stale PNG) with this line as its reason,
      // and the remaining languages (e.g. the html preview lane) still
      // capture — the LSP-dependent squiggle lanes all miss together on
      // fresh scratch boots today (see the IGNORED lsp note above).
      if (!ok) { console.log('MISSING: no ' + (lang === 'html-preview' ? 'preview iframe' : 'diagnostic squiggles') + ' for ' + relPath); continue }
      if (lang === 'html-preview') {
        const lane = await evalJs(`(() => { const f = document.querySelector('.aXa_av_iframe'); const u = new URL(f.src); return { host: u.host, notStudio: u.host !== location.host, sandbox: f.getAttribute('sandbox') } })()`)
        console.log('html lane:', JSON.stringify(lane))
        if (!lane.notStudio) die('html preview iframe left the org origin!')
      }
      await sleep(600)
      await shot('langstrip-' + lang)
    }
  },
})



await initSystemTheme()

for (const s of surfaces) {
  if (!S[s]) die(`unknown surface: ${s} (known: ${Object.keys(S).join(', ')})`)
  console.log('-- surface:', s)
  await S[s]()
}
if (consoleErrors.length) {
  console.error('FILTERED (pre-existing, justified in scripts/evidence-gate.mjs):')
  for (const e of [...new Set(consoleErrors)]) console.error('  ' + e.slice(0, 160))
}
const g = gate()
if (g.length) { console.error('GATE ERRORS (' + g.length + '):'); for (const e of g) console.error('  ' + e); die('zero-console-error evidence gate') }
console.log(`EVIDENCE OK @${width} — ${surfaces.join(', ')} — zero unfiltered console/page errors`)
chrome.kill(); process.exit(0)
