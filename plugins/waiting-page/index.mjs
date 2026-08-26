/**
 * arxa-waiting-page — dsh cordis plugin: inject a connection heartbeat into
 * the served web UI. When the studio server disappears (desktop app quit
 * tree-kills its child), every already-open browser tab overlays the branded
 * "Waiting for main app to start…" page and auto-recovers when the server
 * returns.
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
    // Logo is cosmetic — the overlay still works without it.
  }
  const text = `(${pageSide.toString()})(${JSON.stringify(logo)}, ${intervalMs}, ${failThreshold})`
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'script', placement: 'body', text })
  })
}

/**
 * Runs in the browser. Polls the page's own origin; after `failThreshold`
 * consecutive failures it overlays the waiting page, and on the first
 * successful poll afterwards it reloads to re-enter the studio cleanly.
 * The desktop webview keeps its native Rust watchdog — this overlay is the
 * browser-tab equivalent and is harmless if both fire.
 */
function pageSide(logo, intervalMs, failThreshold) {
  var fails = 0
  var shown = false
  function show() {
    if (shown || !document.documentElement) return
    shown = true
    var el = document.createElement('div')
    el.id = '__arxa-waiting'
    el.setAttribute('style',
      'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;' +
      'background:#101014;color:#e5e7eb;text-align:center;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;')
    el.innerHTML =
      '<div><div style="width:72px;height:72px;margin:0 auto 1.25rem;' +
      'animation:__arxaPulse 1.6s ease-in-out infinite;">' + logo + '</div>' +
      '<h1 style="font-size:1.4rem;font-weight:600;margin:0 0 .5rem;">Arxa Studio</h1>' +
      '<p style="color:#9ca3af;font-size:.95rem;margin:0;">Waiting for main app to start…</p></div>'
    var st = document.createElement('style')
    st.textContent =
      '@keyframes __arxaPulse{0%,100%{transform:scale(1);opacity:1}' +
      '50%{transform:scale(.92);opacity:.6}}' +
      '#__arxa-waiting svg{width:72px;height:72px}'
    el.appendChild(st)
    document.documentElement.appendChild(el)
  }
  function tick() {
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
