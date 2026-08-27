// Browser half of arxa-theme-accent. Hand-written in the __ModuleLoader__
// factory shape every dsh client bundle uses (same as arxa-waiting-page).
//
// Registers ONE row into `settings.general.item`: "Accent" — three fixed
// swatches (#0EBAE4 / #0EE4E0 / #12D49A). The chosen hex re-derives the
// dsh accent scale (--dsw-static-deepseek-50…900) as color-mix() tints,
// set INLINE on <body>: inline style beats both token blocks in the theme
// bundle (:root light + body[data-ds-dark-theme] dark), so every alias
// token built on the scale — sidebar active accent, links, selection —
// follows in both themes with no per-consumer patching.
//
// Reactivity: same tab applies on click; other tabs/windows (desktop shell
// + browser session share the origin) follow via the `storage` event.
window.__ModuleLoader__.load({
  id: 'arxa-theme-accent',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement

    const STORE_KEY = 'arxa.themeAccent'
    const SWATCHES = ['#0EBAE4', '#0EE4E0', '#12D49A']
    const DEFAULT = SWATCHES[0]

    // Tint ladders mirroring the stock lightness curves. oklab keeps hue
    // steady across mixes. ponytail: eyeballed percentages, tune per-stop if
    // design asks. BOTH accent ramps are owned here: the frontend's accent
    // aliases resolve through --dsw-static-blue-* AND --dsw-static-deepseek-*
    // (arxa-brand repaints both to moss by source order; inline-on-<body>
    // outranks any stylesheet, so this wins over brand AND the theme bundle).
    const TINTS = {
      50: 'color-mix(in oklab, ACC 8%, white)',
      '50p': 'color-mix(in oklab, ACC 9%, white)',
      75: 'color-mix(in oklab, ACC 12%, white)',
      100: 'color-mix(in oklab, ACC 15%, white)',
      200: 'color-mix(in oklab, ACC 24%, white)',
      300: 'color-mix(in oklab, ACC 40%, white)',
      400: 'color-mix(in oklab, ACC 78%, white)',
      450: 'color-mix(in oklab, ACC 90%, white)',
      500: 'ACC',
      600: 'color-mix(in oklab, ACC 72%, black)',
      800: 'color-mix(in oklab, ACC 42%, black)',
      900: 'color-mix(in oklab, ACC 30%, black)',
      950: 'color-mix(in oklab, ACC 24%, black)',
    }
    // Exact stop sets defined by @deepseek-ai/dsh-client-ui-theme:
    const RAMPS = {
      deepseek: [50, 100, 200, 300, 400, 450, 500, 600, 800, 900],
      blue: [50, '50p', 75, 100, 300, 400, 450, 500, 600, 800, 900, 950],
    }

    const stored = () => {
      try {
        const v = localStorage.getItem(STORE_KEY)
        return SWATCHES.includes(v) ? v : DEFAULT
      } catch { return DEFAULT }
    }

    function applyAccent(hex) {
      const body = document.body
      if (!body) {
        // `immediately: true` bundles can run before <body> parses — retry
        // once the document is ready or the initial accent silently no-ops.
        document.addEventListener('DOMContentLoaded',
          () => applyAccent(hex), { once: true })
        return
      }
      for (const ramp of Object.keys(RAMPS)) {
        for (const stop of RAMPS[ramp]) {
          body.style.setProperty(
            '--dsw-static-' + ramp + '-' + stop,
            TINTS[stop].replace('ACC', hex))
        }
      }
    }

    //#region row styles (Language-row metrics, own class names)
    const css = {
      row: 'arxaAc_row',
      rowText: 'arxaAc_rowText',
      title: 'arxaAc_title',
      desc: 'arxaAc_desc',
      swatches: 'arxaAc_swatches',
      swatch: 'arxaAc_swatch',
      selected: 'arxaAc_selected',
    }
    const cssText =
      '.arxaAc_row{border-bottom:1px solid var(--dsw-alias-border-l2);' +
      'align-items:center;gap:8px;padding:16px 0;display:flex}' +
      '.arxaAc_rowText{flex-direction:column;flex:1;gap:4px;min-width:0;' +
      'padding-right:48px;display:flex}' +
      '.arxaAc_title{color:var(--dsw-alias-label-primary);font-size:14px;' +
      'font-weight:400;line-height:22px}' +
      '.arxaAc_desc{color:var(--dsw-alias-label-secondary,#8a8f98);' +
      'font-size:12px;line-height:18px}' +
      '.arxaAc_swatches{align-items:center;gap:12px;display:flex}' +
      '.arxaAc_swatch{width:24px;height:24px;border-radius:50%;' +
      'border:none;cursor:pointer;padding:0;' +
      'outline:2px solid transparent;outline-offset:2px}' +
      '.arxaAc_swatch:hover{outline-color:var(--dsw-alias-border-l2)}' +
      '.arxaAc_selected{outline-color:var(--dsw-alias-label-primary)}'
    const tagId = 'arxa-theme-accent/AccentRow.css'
    if (typeof document !== 'undefined'
      && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'arxa-theme-accent'
      tag.dataset.pluginCss = tagId
      tag.textContent = cssText
      document.head.appendChild(tag)
    }
    //#endregion

    function AccentRow() {
      const [accent, setAccent] = React.useState(stored)
      // Cross-tab: another window picked a swatch — follow it live.
      React.useEffect(() => {
        const onStorage = (e) => {
          if (e.key === STORE_KEY && SWATCHES.includes(e.newValue)) {
            setAccent(e.newValue)
          }
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
      }, [])
      const pick = (hex) => {
        try { localStorage.setItem(STORE_KEY, hex) } catch { /* still applies locally */ }
        applyAccent(hex)
        setAccent(hex)
      }
      return h('div', { className: css.row },
        h('div', { className: css.rowText },
          h('div', { className: css.title }, 'Accent'),
          h('div', { className: css.desc },
            'Theme accent color. Tints across the app follow your choice.')),
        h('div', { className: css.swatches, role: 'radiogroup', 'aria-label': 'Accent color' },
          SWATCHES.map((hex) => h('button', {
            key: hex,
            type: 'button',
            role: 'radio',
            'aria-checked': accent === hex,
            'aria-label': 'Accent ' + hex,
            title: hex,
            className: css.swatch + (accent === hex ? ' ' + css.selected : ''),
            style: { background: hex },
            onClick: () => pick(hex),
          }))))
    }

    function apply(ctx) {
      // Every page, not just Settings: restore the stored accent on load and
      // track other windows even while the row is unmounted.
      applyAccent(stored())
      window.addEventListener('storage', (e) => {
        if (e.key === STORE_KEY && SWATCHES.includes(e.newValue)) {
          applyAccent(e.newValue)
        }
      })
      ctx.slots.inject('settings.general.item', () =>
        ctx.slots.register({
          name: 'settings.general.item',
          id: 'arxa-theme-accent',
          order: 40,
        }, AccentRow))
    }
    const inject = ['slots']

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
