/**
 * arxa-waiting-page — dsh cordis plugin: inject browser-tab lifecycle scripts
 * into the served web UI.
 *
 * Two page-side behaviors, BROWSER TABS ONLY (the Tauri desktop shell webview
 * identifies itself with an `ArxaShell` user agent and is skipped — it has its
 * own native Rust watchdog + bundled waiting page, and showing "waiting for
 * main app" inside the main app itself would be nonsense):
 *
 * 1. Connection heartbeat — when the studio server disappears (desktop app
 *    quit tree-kills its child), every open browser tab overlays the branded
 *    "Waiting for main app to start…" page and auto-recovers when the server
 *    returns.
 *
 * 2. Tab singleton — at most one live studio tab per browser. Enforced with
 *    the Web Locks API (held for the tab's lifetime) + a BroadcastChannel.
 *    A duplicate tab makes the existing tab reload (fresh state) and itself
 *    shows a branded "already open" notice with a "Use this tab instead"
 *    takeover button. Scope is per-browser-profile — two different browsers
 *    cannot see each other's locks; the server stays multi-client.
 *
 * Server death cannot be rendered BY the server — the overlay must already
 * live inside the page, so it rides in as a structured index injection row
 * (webserver/index-inject). Rows are pure data; the page-side function is
 * serialized via toString and the logo svg is read from this plugin's dir.
 *
 * Config: { intervalMs?: number (poll cadence, default 2000),
 *           failThreshold?: number (consecutive failures before the
 *           overlay shows, default 2) }
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
  let logo = ''
  try {
    logo = readFileSync(join(here, 'arxa-brand-logo.svg'), 'utf8')
  } catch {
    // Logo is cosmetic — both behaviors still work without it.
  }
  const text = `(${pageSide.toString()})(${JSON.stringify(logo)}, ${intervalMs}, ${failThreshold})`
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'script', placement: 'body', text })
  })
}

/**
 * Runs in the browser. Skips entirely inside the desktop shell webview
 * (ArxaShell UA / __TAURI__ global). Otherwise:
 * - heartbeat: polls the page's own origin; after `failThreshold` consecutive
 *   failures it overlays the waiting page, and on the first successful poll
 *   afterwards it reloads to re-enter the studio cleanly.
 * - singleton: holds the `__arxa-studio-tab` web lock for the tab's lifetime;
 *   a newcomer that cannot get the lock tells the holder to reload and parks
 *   itself on an "already open" notice with a takeover button.
 */
function pageSide(logo, intervalMs, failThreshold) {
  // ---- shell opt-out -------------------------------------------------------
  if (/ArxaShell/.test(navigator.userAgent) || window.__TAURI__ || window.__TAURI_INTERNALS__) {
    return
  }

  function card(title, sub, extraHtml) {
    var el = document.createElement('div')
    el.setAttribute('style',
      'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;' +
      'background:#101014;color:#e5e7eb;text-align:center;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;')
    el.innerHTML =
      '<div><div style="width:72px;height:72px;margin:0 auto 1.25rem;' +
      'animation:__arxaPulse 1.6s ease-in-out infinite;">' + logo + '</div>' +
      '<h1 style="font-size:1.4rem;font-weight:600;margin:0 0 .5rem;">' + title + '</h1>' +
      '<p style="color:#9ca3af;font-size:.95rem;margin:0;">' + sub + '</p>' +
      (extraHtml || '') + '</div>'
    var st = document.createElement('style')
    st.textContent =
      '@keyframes __arxaPulse{0%,100%{transform:scale(1);opacity:1}' +
      '50%{transform:scale(.92);opacity:.6}}' +
      'div svg{width:72px;height:72px}'
    el.appendChild(st)
    return el
  }

  // ---- 2. tab singleton ----------------------------------------------------
  var isPrimary = false
  if (navigator.locks && 'BroadcastChannel' in window) {
    var bc = new BroadcastChannel('__arxa-studio-tab')
    navigator.locks.request('__arxa-studio-tab', { ifAvailable: true }, function (lock) {
      if (lock) {
        isPrimary = true
        bc.onmessage = function (e) {
          if (e.data === 'claim') {
            // A duplicate tab appeared: refresh this (surviving) tab.
            location.reload()
          } else if (e.data === 'takeover') {
            // Yield: park this tab on the notice; the lock frees on unload
            // of our held promise scope via page reload into parked state.
            document.documentElement.innerHTML = ''
            document.documentElement.appendChild(
              card('Arxa Studio', 'This tab was taken over by another Arxa Studio tab.'))
            window.__arxaRelease && window.__arxaRelease()
          }
        }
        // Hold the lock until released or the tab closes.
        return new Promise(function (resolve) { window.__arxaRelease = resolve })
      }
      // Lock busy: another tab is live. Ask it to reload, park this one.
      bc.postMessage('claim')
      var el = card('Arxa Studio',
        'Already open in another tab.',
        '<button id="__arxa-takeover" style="margin-top:1.25rem;padding:.55rem 1.1rem;' +
        'border:1px solid #374151;border-radius:8px;background:#1f2937;color:#e5e7eb;' +
        'font-size:.9rem;cursor:pointer;">Use this tab instead</button>')
      function park() {
        if (!document.documentElement) return
        document.documentElement.innerHTML = ''
        document.documentElement.appendChild(el)
        var btn = document.getElementById('__arxa-takeover')
        if (btn) btn.onclick = function () {
          bc.postMessage('takeover')
          setTimeout(function () { location.reload() }, 250)
        }
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', park)
      } else {
        park()
      }
      return
    })
  } else {
    isPrimary = true // no Web Locks: degrade to old multi-tab behavior
  }

  // ---- 1. connection heartbeat --------------------------------------------
  var fails = 0
  var shown = false
  function show() {
    if (shown || !document.documentElement) return
    shown = true
    var el = card('Arxa Studio', 'Waiting for main app to start…')
    el.id = '__arxa-waiting'
    document.documentElement.appendChild(el)
  }
  function tick() {
    if (!isPrimary && navigator.locks) return // parked tabs don't poll
    fetch(location.origin + '/', { method: 'GET', cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('status ' + r.status)
        fails = 0
        if (shown) location.reload()
      })
      .catch(function () {
        fails += 1
        if (fails >= failThreshold) show()
      })
  }
  setInterval(tick, intervalMs)
}
