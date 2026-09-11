// Browser half of arxa-pairing. Hand-written in the __ModuleLoader__
// factory shape every dsh client bundle uses (same as arxa-waiting-page).
//
// Registers ONE row into `settings.general.item`: "Pair a device" — a CTA
// that asks the desktop shell to open its QR pairing window via the Tauri
// command `open_pairing_window`. The remote-studio capability grants this
// localhost studio origin core IPC in the main window; withGlobalTauri puts
// `window.__TAURI__` on the page.
//
// The row renders ONLY inside the desktop shell webview (ArxaShell UA with
// the Tauri global present): in a browser tab there is no shell to host the
// pairing window. Styling mirrors the Language row's layout and pill button,
// on the same --dsw-alias-* tokens, so the row speaks the UI's language.
window.__ModuleLoader__.load({
  id: 'arxa-pairing',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement

    //#region row styles (Language-row metrics, own class names)
    const css = {
      row: 'arxaPair_row',
      rowText: 'arxaPair_rowText',
      title: 'arxaPair_title',
      desc: 'arxaPair_desc',
      button: 'arxaPair_button',
      note: 'arxaPair_note',
    }
    const cssText =
      '.arxaPair_row{border-bottom:1px solid var(--dsw-alias-border-l2);' +
      'align-items:center;gap:8px;padding:16px 0;display:flex}' +
      '.arxaPair_rowText{flex-direction:column;flex:1;gap:4px;min-width:0;' +
      'padding-right:48px;display:flex}' +
      '.arxaPair_title{color:var(--dsw-alias-label-primary);font-size:14px;' +
      'font-weight:400;line-height:22px}' +
      '.arxaPair_desc{color:var(--dsw-alias-label-secondary,#8a8f98);' +
      'font-size:12px;line-height:18px}' +
      '.arxaPair_note{color:var(--dsw-alias-label-secondary,#8a8f98);' +
      'font-size:12px;line-height:18px;margin-right:12px}' +
      '.arxaPair_button{background:var(--dsw-alias-bg-module-platform);' +
      'height:36px;font:inherit;color:var(--dsw-alias-label-primary);' +
      'cursor:pointer;border:none;border-radius:18px;align-items:center;' +
      'gap:12px;padding:0 14px;font-size:14px;line-height:22px;' +
      'display:inline-flex}' +
      '.arxaPair_button:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
      '.arxaPair_button:disabled{cursor:default;opacity:.6}'
    const tagId = 'arxa-pairing/PairDeviceRow.css'
    if (typeof document !== 'undefined'
      && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'arxa-pairing'
      tag.dataset.pluginCss = tagId
      tag.textContent = cssText
      document.head.appendChild(tag)
    }
    //#endregion

    function PairDeviceRow() {
      const [phase, setPhase] = React.useState('idle') // idle|opening|error
      const [detail, setDetail] = React.useState('')
      // Meaningful only from the desktop shell — the pairing window (QR
      // ticket mint + iroh host) lives in the Tauri app, not the browser.
      if (!/ArxaShell/.test(navigator.userAgent)) return null
      const tauri = window.__TAURI__
      if (!tauri || !tauri.core || typeof tauri.core.invoke !== 'function') return null
      const open = () => {
        setPhase('opening')
        tauri.core.invoke('open_pairing_window')
          .then(() => { setPhase('idle') })
          .catch((e) => {
            // Surface the real reason (ACL denial, window error, …) — an
            // opaque catch here once made a stale-build failure undiagnosable.
            const msg = typeof e === 'string' ? e : (e && e.message) || ''
            console.error('[arxa-pairing] open_pairing_window failed:', e)
            setDetail(msg)
            setPhase('error')
          })
      }
      return h('div', { className: css.row },
        h('div', { className: css.rowText },
          h('div', { className: css.title }, 'Pair a device'),
          h('div', { className: css.desc },
            'Connect the Arxa Studio mobile app by scanning a QR code. '
            + 'Pairing is direct and end-to-end encrypted; no account needed.')),
        phase === 'error'
          ? h('span', { className: css.note },
              'Could not open pairing' + (detail ? ': ' + detail : ''))
          : null,
        h('button', {
          type: 'button',
          className: css.button,
          disabled: phase === 'opening',
          onClick: open,
        }, phase === 'opening' ? 'Opening…' : 'Pair a device'))
    }

    //#region theme relay (shell windows can't read this origin's theme)
    // The pairing window renders on the shell's bundled origin — different
    // origin, no shared localStorage, no shared stylesheet. Report the live
    // theme (accent hex from arxa-theme-accent's store + the dark flag on
    // <body data-ds-dark-theme>) to the shell via `report_theme`; it caches
    // and rebroadcasts to its own windows. Same ArxaShell/IPC gate as the row.
    function installThemeRelay() {
      if (!/ArxaShell/.test(navigator.userAgent)) return
      const tauri = window.__TAURI__
      if (!tauri || !tauri.core || typeof tauri.core.invoke !== 'function') return
      let last = ''
      const report = () => {
        let accent = null
        // 0.3.0: the accent rides the palette state, not a bare hex key.
        try { accent = JSON.parse(localStorage.getItem('arxa.themePalette') || 'null')?.accent ?? null } catch { /* private mode */ }
        const dark = !!(document.body && document.body.hasAttribute('data-ds-dark-theme'))
        const key = (accent || '') + '|' + dark
        if (key === last) return // observers fire in bursts; only send changes
        last = key
        tauri.core.invoke('report_theme', { accent, dark }).catch(() => {})
      }
      const start = () => {
        report()
        // Same-window changes: accent lands as an inline style on <body>,
        // dark mode as the data attribute — one observer covers both.
        new MutationObserver(report).observe(document.body, {
          attributes: true,
          attributeFilter: ['style', 'data-ds-dark-theme'],
        })
        // Other-window changes arrive as storage events (theme-accent's own
        // cross-window sync channel).
        window.addEventListener('storage', (e) => {
          if (e.key === 'arxa.themePalette') report()
        })
      }
      if (document.body) start()
      else document.addEventListener('DOMContentLoaded', start, { once: true })
    }
    //#endregion

    function apply(ctx) {
      installThemeRelay()
      ctx.slots.inject('settings.general.item', () =>
        ctx.slots.register({
          name: 'settings.general.item',
          id: 'arxa-pair-device',
          order: 60,
        }, PairDeviceRow))
    }
    const inject = ['slots']

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
