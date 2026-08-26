/**
 * arxa-waiting-page — dsh cordis plugin: browser-tab lifecycle for the studio.
 *
 * Two page-side behaviors, BROWSER TABS ONLY (the Tauri desktop shell webview
 * identifies itself with an `ArxaShell` user agent and is skipped — it has its
 * own native Rust watchdog + bundled waiting page):
 *
 * 1. Single live tab, enforced SERVER-SIDE — the server holds the one active
 *    presence claim, so the rule spans browsers (Web Locks could not: they are
 *    per-browser-profile). A tab that loads while another holds the claim is
 *    denied: it first tries window.close() (works for script-opened tabs),
 *    otherwise parks on a branded "already open" notice — no button. Parked
 *    tabs re-claim every 2s and auto-promote (reload into the studio) the
 *    moment the active tab closes or dies; the active tab releases its claim
 *    eagerly with a pagehide beacon so handoff is instant, and a stale
 *    heartbeat (7s) covers crashed tabs.
 *
 * 2. Connection heartbeat — the active tab's presence beat doubles as the
 *    server liveness probe. When the studio server disappears (desktop app
 *    quit tree-kills its child), the active tab overlays the branded
 *    "Waiting for main app to start…" page and reloads when the server
 *    returns.
 *
 * Server death cannot be rendered BY the server — the overlay must already
 * live inside the page, so the page-side function rides in as a structured
 * index injection row (webserver/index-inject) serialized via toString.
 * Presence arbitration lives on exact HTTP routes (exact beats the SPA
 * prefix/fallback): /__arxa/presence/{claim,beat,release}?id=<tabId>.
 *
 * Config: { intervalMs?: number (beat/poll cadence, default 2000),
 *           failThreshold?: number (consecutive failures before the overlay
 *           shows, default 2), staleMs?: number (claim expiry, default 7000) }
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'arxa-waiting-page'
export const inject = ['webServer']

const here = dirname(fileURLToPath(import.meta.url))

export function apply(ctx, config = {}) {
  const intervalMs = config.intervalMs ?? 2000
  const failThreshold = config.failThreshold ?? 2
  const staleMs = config.staleMs ?? 7000

  // ---- server-side presence arbitration -----------------------------------
  // One claim, in memory. Lost on server restart by design: the surviving
  // active tab's next beat auto-adopts the claim (first beat wins).
  let active = null // { id, lastSeen, ua }
  const alive = () => active && Date.now() - active.lastSeen < staleMs
  const json = (res, body) => {
    res.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(body))
  }
  const tabId = (req) =>
    new URL(req.url, 'http://x').searchParams.get('id') || ''

  ctx.webServer.register({
    name: 'arxa-presence-claim',
    path: '/__arxa/presence/claim',
    kind: 'exact',
    handler: (req, res) => {
      const id = tabId(req)
      if (!id) return json(res, { granted: false })
      if (!alive() || active.id === id) {
        active = { id, lastSeen: Date.now(), ua: req.headers['user-agent'] || '' }
        return json(res, { granted: true })
      }
      json(res, { granted: false })
    },
  })
  ctx.webServer.register({
    name: 'arxa-presence-beat',
    path: '/__arxa/presence/beat',
    kind: 'exact',
    handler: (req, res) => {
      const id = tabId(req)
      if (!id) return json(res, { ok: false })
      if (!alive() || active.id === id) {
        // adopt after restart/expiry
        active = { id, lastSeen: Date.now(), ua: req.headers['user-agent'] || '' }
        return json(res, { ok: true })
      }
      json(res, { ok: false })
    },
  })
  ctx.webServer.register({
    name: 'arxa-presence-status',
    path: '/__arxa/presence/status',
    kind: 'exact',
    handler: (req, res) => {
      json(res, {
        active: alive()
          ? { id: active.id, ageMs: Date.now() - active.lastSeen, ua: active.ua }
          : null,
      })
    },
  })
  ctx.webServer.register({
    name: 'arxa-presence-release',
    path: '/__arxa/presence/release',
    kind: 'exact',
    handler: (req, res) => {
      if (active && active.id === tabId(req)) active = null
      json(res, { ok: true })
    },
  })

  // ---- page-side injection -------------------------------------------------
  let logo = ''
  try {
    logo = readFileSync(join(here, 'arxa-brand-logo.svg'), 'utf8')
  } catch {
    // Logo is cosmetic — behaviors still work without it.
  }
  const text = `(${pageSide.toString()})(${JSON.stringify(logo)}, ${intervalMs}, ${failThreshold})`
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'script', placement: 'body', text })
  })
}

/**
 * Runs in the browser; exits immediately inside the desktop shell webview.
 * State machine: claim → PRIMARY (beat loop; server-down ⇒ waiting overlay,
 * recovery ⇒ reload) | DENIED (try close, else parked notice; re-claim loop,
 * grant ⇒ reload).
 */
function pageSide(logo, intervalMs, failThreshold) {
  if (/ArxaShell/.test(navigator.userAgent) || window.__TAURI__ || window.__TAURI_INTERNALS__) {
    return
  }

  var id = sessionStorage.getItem('__arxaTab')
  if (!id) {
    id = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : String(Date.now()) + '-' + Math.random().toString(36).slice(2)
    sessionStorage.setItem('__arxaTab', id)
  }
  var base = location.origin + '/__arxa/presence/'
  function call(ep) {
    return fetch(base + ep + '?id=' + encodeURIComponent(id), { cache: 'no-store' })
      .then(function (r) { return r.json() })
  }

  function card(title, sub) {
    var el = document.createElement('div')
    el.setAttribute('style',
      'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;' +
      'background:#101014;color:#e5e7eb;text-align:center;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;')
    el.innerHTML =
      '<div><div style="width:72px;height:72px;margin:0 auto 1.25rem;' +
      'animation:__arxaPulse 1.6s ease-in-out infinite;">' + logo + '</div>' +
      '<h1 style="font-size:1.4rem;font-weight:600;margin:0 0 .5rem;">' + title + '</h1>' +
      '<p style="color:#9ca3af;font-size:.95rem;margin:0;">' + sub + '</p></div>'
    var st = document.createElement('style')
    st.textContent =
      '@keyframes __arxaPulse{0%,100%{transform:scale(1);opacity:1}' +
      '50%{transform:scale(.92);opacity:.6}}' +
      'div svg{width:72px;height:72px}'
    el.appendChild(st)
    return el
  }

  var overlay = null
  function showOverlay(title, sub) {
    if (overlay || !document.documentElement) return
    overlay = card(title, sub)
    document.documentElement.appendChild(overlay)
  }

  function primary() {
    var fails = 0
    var down = false
    window.addEventListener('pagehide', function () {
      // Eager handoff so a next tab can claim instantly.
      navigator.sendBeacon && navigator.sendBeacon(base + 'release?id=' + encodeURIComponent(id))
    })
    setInterval(function () {
      call('beat').then(function (j) {
        if (!j.ok) { location.reload(); return } // claim lost → re-arbitrate
        fails = 0
        if (down) location.reload() // server came back → clean re-entry
      }).catch(function () {
        fails += 1
        if (fails >= failThreshold) {
          down = true
          showOverlay('Arxa Studio', 'Waiting for main app to start…')
        }
      })
    }, intervalMs)
  }

  function denied() {
    // Requested behavior: do not open a second surface at all.
    // close() only works for script-opened tabs; fall through to a parked
    // notice otherwise. No button — parked tabs auto-promote when the live
    // tab goes away.
    window.close()
    function park() {
      if (!document.documentElement) return
      document.documentElement.innerHTML = ''
      document.documentElement.appendChild(
        card('Arxa Studio', 'Already open in another tab or browser.'))
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', park)
    } else {
      park()
    }
    var t = setInterval(function () {
      call('claim').then(function (j) {
        if (j.granted) { clearInterval(t); location.reload() }
      }).catch(function () { /* server down: keep parked, keep retrying */ })
    }, intervalMs)
  }

  call('claim').then(function (j) {
    if (j.granted) primary()
    else denied()
  }).catch(function () {
    // Server unreachable at load (e.g. app just quit): overlay + retry.
    showOverlay('Arxa Studio', 'Waiting for main app to start…')
    var t = setInterval(function () {
      call('claim').then(function (j) {
        if (j.granted) { clearInterval(t); location.reload() }
      }).catch(function () {})
    }, intervalMs)
  })
}
