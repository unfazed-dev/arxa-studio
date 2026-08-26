// Browser half of arxa-waiting-page. Hand-written in the __ModuleLoader__
// factory shape every dsh client bundle uses (same as arxa-design-panel).
//
// Registers ONE row into `settings.general.item` (the slot dsh-client-locale
// fills with its Language row): "Browser session" — a manual CTA that asks
// the host half (POST /__arxa/presence/open-browser) to mint a single-use
// override token and open the default browser on it. This is the only door
// through the desktop-first rule (browser tabs park while the shell runs).
//
// The row renders ONLY inside the desktop shell webview (ArxaShell UA):
// in a browser tab the CTA is meaningless — you are already the session it
// would open. Styling mirrors the Language row's layout and pill button,
// on the same --dsw-alias-* tokens, so the row speaks the UI's language.
window.__ModuleLoader__.load({
  id: 'arxa-waiting-page',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement

    //#region row styles (Language-row metrics, own class names)
    const css = {
      row: 'arxaWp_row',
      rowText: 'arxaWp_rowText',
      title: 'arxaWp_title',
      desc: 'arxaWp_desc',
      button: 'arxaWp_button',
      note: 'arxaWp_note',
    }
    const cssText =
      '.arxaWp_row{border-bottom:1px solid var(--dsw-alias-border-l2);' +
      'align-items:center;gap:8px;padding:16px 0;display:flex}' +
      '.arxaWp_rowText{flex-direction:column;flex:1;gap:4px;min-width:0;' +
      'padding-right:48px;display:flex}' +
      '.arxaWp_title{color:var(--dsw-alias-label-primary);font-size:14px;' +
      'font-weight:400;line-height:22px}' +
      '.arxaWp_desc{color:var(--dsw-alias-label-secondary,#8a8f98);' +
      'font-size:12px;line-height:18px}' +
      '.arxaWp_note{color:var(--dsw-alias-label-secondary,#8a8f98);' +
      'font-size:12px;line-height:18px;margin-right:12px}' +
      '.arxaWp_button{background:var(--dsw-alias-bg-module-platform);' +
      'height:36px;font:inherit;color:var(--dsw-alias-label-primary);' +
      'cursor:pointer;border:none;border-radius:18px;align-items:center;' +
      'gap:12px;padding:0 14px;font-size:14px;line-height:22px;' +
      'display:inline-flex}' +
      '.arxaWp_button:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
      '.arxaWp_button:disabled{cursor:default;opacity:.6}'
    const tagId = 'arxa-waiting-page/BrowserSessionRow.css'
    if (typeof document !== 'undefined'
      && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'arxa-waiting-page'
      tag.dataset.pluginCss = tagId
      tag.textContent = cssText
      document.head.appendChild(tag)
    }
    //#endregion

    function BrowserSessionRow() {
      const [phase, setPhase] = React.useState('idle') // idle|opening|done|error
      // Meaningful only from the desktop shell — a browser tab IS the
      // secondary session this CTA would open.
      if (!/ArxaShell/.test(navigator.userAgent)) return null
      const open = () => {
        setPhase('opening')
        fetch('/__arxa/presence/open-browser', { method: 'POST' })
          .then((r) => r.json())
          .then((j) => { setPhase(j.ok ? 'done' : 'error') })
          .catch(() => { setPhase('error') })
      }
      return h('div', { className: css.row },
        h('div', { className: css.rowText },
          h('div', { className: css.title }, 'Browser session'),
          h('div', { className: css.desc },
            'Open a secondary Arxa Studio session in your default browser. '
            + 'Browser tabs are otherwise parked while the desktop app is running.')),
        phase === 'done' ? h('span', { className: css.note }, 'Opened in your browser') : null,
        phase === 'error' ? h('span', { className: css.note }, 'Could not open') : null,
        h('button', {
          type: 'button',
          className: css.button,
          disabled: phase === 'opening',
          onClick: open,
        }, phase === 'opening' ? 'Opening…' : 'Open in browser'))
    }

    function apply(ctx) {
      ctx.slots.inject('settings.general.item', () =>
        ctx.slots.register({
          name: 'settings.general.item',
          id: 'arxa-browser-session',
          order: 50,
        }, BrowserSessionRow))
    }
    const inject = ['slots']

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
