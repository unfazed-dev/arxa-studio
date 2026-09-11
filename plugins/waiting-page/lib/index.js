/**
 * arxa-waiting-page (host half) — browser-surface lifecycle for the studio.
 *
 * DESKTOP-FIRST RULE (locked 2026-08-27): while the desktop shell is alive,
 * every browser tab parks on a branded notice — the app IS the studio. The
 * shell webview proves liveness by beating /__arxa/presence/shell-beat from
 * the injected page script (ArxaShell UA branch — no Rust change needed).
 * Browser access exists only through two doors:
 *   - the Settings > General CTA (client half) hits POST
 *     /__arxa/presence/open-browser: a single-use 30s override token is
 *     minted and the default browser is opened on /?arxa-browser=<token>;
 *     a claim carrying a valid token wins even against the shell and takes
 *     over from any current browser tab.
 *   - the desktop app being closed: with no shell beating, plain claims work
 *     again (dev / fallback path), still max one tab across ALL browsers —
 *     the server is the referee, which per-browser Web Locks never could be.
 *
 * A tab that loads while claims are denied first tries window.close()
 * (works for script-opened tabs), then parks — no button; parked tabs
 * re-claim every 2s and auto-promote when allowed. The active tab releases
 * eagerly on pagehide; a stale heartbeat (7s) covers crashes. The presence
 * beat doubles as the server-liveness probe: on server death the active tab
 * overlays the branded "Waiting for main app to start…" page and reloads on
 * recovery (the server cannot render its own death, so the page-side
 * function rides in as a webserver/index-inject row, serialized toString).
 *
 * Presence routes are exact HTTP routes — exact beats the SPA fallback.
 *
 * Config: { intervalMs?: number (beat/poll cadence, default 2000),
 *           failThreshold?: number (consecutive failures before the overlay
 *           shows, default 2), staleMs?: number (claim expiry, default 7000) }
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'arxa-waiting-page'
export const inject = ['webServer']

const here = dirname(fileURLToPath(import.meta.url))
const OVERRIDE_TTL_MS = 30_000

// Palette-following logo (the remnant sweep, 2026-09-11): the brand SVG's
// cyan stops are swapped for the chosen palette's accent family. Default =
// Mystic Evening SOLVED (#C56975/#391A1E/#BC757D), exactly what the app
// paints out of the box. Reads $ARXA_HOME/theme-palette.json — the
// theme-accent store contract (default ~/.arxa); any failure keeps the
// default, never throws. ponytail: a custom palette's derived stops use a
// plain sRGB blend (the engine's oklab solve is client-only); close enough
// on a 72px pulsing boot mark.
const LOGO_DEFAULTS = ['#C56975', '#391A1E', '#BC757D'] // top, bottom, glyph
function tintLogo(raw) {
  let [top, bottom, glyph] = LOGO_DEFAULTS
  try {
    const s = JSON.parse(readFileSync(
      join(process.env.ARXA_HOME || join(homedir(), '.arxa'), 'theme-palette.json'), 'utf8'))
    const acc = String(s.accent || '').replace('#', '')
    if (/^[0-9a-fA-F]{6}$/.test(acc)) {
      top = '#' + acc.toUpperCase()
      const blend = (pct, toward) => {
        const n = parseInt(top.slice(1), 16)
        const t = parseInt(toward.slice(1), 16)
        return '#' + [16, 8, 0].map((sh) => Math.round(
          ((n >> sh & 255) * (100 - pct) + (t >> sh & 255) * pct) / 100)
          .toString(16).padStart(2, '0')).join('')
      }
      bottom = blend(42, '#000000') // the 800-position formula
      glyph = blend(78, '#FFFFFF') // the 400-position formula
    }
  } catch { /* no palette yet — Mystic defaults */ }
  return raw
    .replaceAll('#0EBAE4', top)
    .replaceAll('#08336F', bottom)
    .replaceAll('#0EE4E0', glyph)
}

export function apply(ctx, config = {}) {
  const intervalMs = config.intervalMs ?? 2000
  const failThreshold = config.failThreshold ?? 2
  const staleMs = config.staleMs ?? 7000

  // ---- server-side presence arbitration -----------------------------------
  // In memory, lost on server restart by design: the surviving active tab's
  // next beat re-adopts (only when the shell is not alive — after a restart
  // with the shell up, desktop-first wins and stray tabs park).
  let active = null // { id, lastSeen, ua, viaOverride }
  let shellSeen = 0 // last shell-beat, ms epoch
  const overrideTokens = new Map() // token -> expiry ms
  const alive = () => active && Date.now() - active.lastSeen < staleMs
  const shellAlive = () => Date.now() - shellSeen < staleMs
  const takeOverride = (t) => {
    for (const [k, exp] of overrideTokens) if (exp < Date.now()) overrideTokens.delete(k)
    if (!t || !overrideTokens.has(t)) return false
    overrideTokens.delete(t)
    return true
  }
  const json = (res, body) => {
    res.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(body))
  }
  const params = (req) => new URL(req.url, 'http://x').searchParams

  ctx.webServer.register({
    name: 'arxa-presence-shell-beat',
    path: '/__arxa/presence/shell-beat',
    kind: 'exact',
    handler: (req, res) => {
      shellSeen = Date.now()
      json(res, { ok: true })
    },
  })
  ctx.webServer.register({
    name: 'arxa-presence-claim',
    path: '/__arxa/presence/claim',
    kind: 'exact',
    handler: (req, res) => {
      const q = params(req)
      const id = q.get('id')
      if (!id) return json(res, { granted: false, reason: 'bad-request' })
      const ua = req.headers['user-agent'] || ''
      // Override door: wins against the shell AND any current tab.
      if (takeOverride(q.get('t'))) {
        active = { id, lastSeen: Date.now(), ua, viaOverride: true }
        return json(res, { granted: true })
      }
      // Already the active tab (reload, or override survivor): refresh —
      // unless the shell came alive and this claim never had the override
      // (startup-race winner). Desktop-first evicts it.
      if (alive() && active.id === id) {
        if (shellAlive() && !active.viaOverride) {
          active = null
          return json(res, { granted: false, reason: 'desktop' })
        }
        active = { ...active, lastSeen: Date.now(), ua }
        return json(res, { granted: true })
      }
      // Desktop-first: the app is running — browsers park.
      if (shellAlive()) return json(res, { granted: false, reason: 'desktop' })
      // App closed: single-tab rule across all browsers.
      if (!alive()) {
        active = { id, lastSeen: Date.now(), ua }
        return json(res, { granted: true })
      }
      json(res, { granted: false, reason: 'tab' })
    },
  })
  ctx.webServer.register({
    name: 'arxa-presence-beat',
    path: '/__arxa/presence/beat',
    kind: 'exact',
    handler: (req, res) => {
      const id = params(req).get('id')
      if (!id) return json(res, { ok: false })
      if (alive() && active.id === id) {
        // Desktop-first eviction: the shell came alive and this tab's grant
        // was not via the override CTA — stop renewing, the tab parks.
        if (shellAlive() && !active.viaOverride) {
          active = null
          return json(res, { ok: false, reason: 'desktop' })
        }
        active = { ...active, lastSeen: Date.now(), ua: req.headers['user-agent'] || '' }
        return json(res, { ok: true })
      }
      // Adopt after server restart/expiry — but never past a live shell.
      if (!alive() && !shellAlive()) {
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
        shell: shellAlive() ? { ageMs: Date.now() - shellSeen } : null,
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
      if (active && active.id === params(req).get('id')) active = null
      json(res, { ok: true })
    },
  })
  ctx.webServer.register({
    name: 'arxa-presence-open-browser',
    path: '/__arxa/presence/open-browser',
    kind: 'exact',
    handler: (req, res) => {
      if (req.method !== 'POST') return json(res, { ok: false, reason: 'post-only' })
      const token = globalThis.crypto.randomUUID()
      overrideTokens.set(token, Date.now() + OVERRIDE_TTL_MS)
      // Canonical origin (README/grill-decisions): a 127.0.0.1 URL would open
      // the browser session on a DIFFERENT origin than the served one,
      // splitting sessionStorage/presence state.
      const url = `http://arxa.studio.localhost:${ctx.webServer.port}/?arxa-browser=${token}`
      if (process.platform === 'darwin') {
        spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
        return json(res, { ok: true, url })
      }
      // Non-macOS: hand the URL back; the client shows it instead.
      json(res, { ok: false, reason: 'unsupported-platform', url })
    },
  })

  // ---- page-side injection -------------------------------------------------
  let logo = ''
  try {
    logo = tintLogo(readFileSync(join(here, '..', 'arxa-brand-logo.svg'), 'utf8'))
  } catch {
    // Logo is cosmetic — behaviors still work without it.
  }
  const text = `(${pageSide.toString()})(${JSON.stringify(logo)}, ${intervalMs}, ${failThreshold})`
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'script', placement: 'body', text })
  })
}

/**
 * Runs in every served page. Shell webview (ArxaShell UA): only beats
 * shell-beat so the server knows the app is alive. Browser tabs: claim →
 * PRIMARY (beat loop; server-down ⇒ waiting overlay, recovery ⇒ reload) |
 * DENIED (try close, else park with a reason-specific notice; re-claim
 * loop, grant ⇒ reload). An /?arxa-browser=<token> query is the Settings
 * CTA's override door and is stripped from the URL once granted.
 */
function pageSide(logo, intervalMs, failThreshold) {
  var isShell = /ArxaShell/.test(navigator.userAgent)
    || window.__TAURI__ || window.__TAURI_INTERNALS__
  var base = location.origin + '/__arxa/presence/'

  if (isShell) {
    var shellBeat = function () {
      fetch(base + 'shell-beat', { cache: 'no-store' }).catch(function () {})
    }
    shellBeat()
    setInterval(shellBeat, intervalMs)
    return
  }

  var id = sessionStorage.getItem('__arxaTab')
  if (!id) {
    id = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : String(Date.now()) + '-' + Math.random().toString(36).slice(2)
    sessionStorage.setItem('__arxaTab', id)
  }
  var override = new URLSearchParams(location.search).get('arxa-browser')
  function call(ep, extra) {
    return fetch(base + ep + '?id=' + encodeURIComponent(id) + (extra || ''), { cache: 'no-store' })
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
    if (override) {
      override = null
      history.replaceState(null, '', location.pathname)
    }
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

  function denied(reason) {
    // Locked behavior: no second surface. close() only works for
    // script-opened tabs; fall through to a parked notice otherwise.
    // No button — parked tabs auto-promote when claims open up again.
    window.close()
    var sub = reason === 'desktop'
      ? 'Arxa Studio is running as the desktop app.'
      : 'Already open in another tab or browser.'
    function park() {
      if (!document.documentElement) return
      document.documentElement.innerHTML = ''
      document.documentElement.appendChild(card('Arxa Studio', sub))
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

  call('claim', override ? '&t=' + encodeURIComponent(override) : '').then(function (j) {
    if (j.granted) primary()
    else denied(j.reason)
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
