// Browser half of arxa-theme-accent. Hand-written in the __ModuleLoader__
// factory shape every dsh client bundle uses (same as arxa-waiting-page).
//
// Registers TWO rows into `settings.personalisation.item` (the Settings >
// Personalisation tab since 0.2.5; `settings.general.item` before): "Accent"
// — three fixed
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
    const SERVER_PATH = '/__arxa/theme-accent'
    // Editor font choice (2026-09-03): localStorage-backed (the editor is a
    // desktop-first surface; the accent's engine-file cross-device sync does
    // not extend to it). Applied as body-inline --arxa-editor-font, which the
    // artifact-viewer's cm-content consumes with the same Fira-free default
    // stack as its var() fallback. (2026-09-01 render-truthed: the dsh
    // --ds-font-family-code token can no longer be the editor fallback — it
    // lists "Fira Code" third, and with "SF Mono" unresolvable in this
    // WKWebView + JetBrains Mono absent, it resolved to the system-installed
    // Fira Code: Default rendered Fira and the toggle was a visual no-op.
    // Measured: token stack == explicit "Fira Code" at 366.61px, Menlo
    // 367.86px, unmatched names 242.31px.)
    const FONT_STORE_KEY = 'arxa.editorFont'
    const FONT_SRC = '/__arxa/artifacts/vendor/'
    // Default must NEVER resolve to a Fira design or Default == Fira visually.
    // Lands on Menlo (macOS) / Consolas (Windows) / Liberation Mono (Linux).
    const DEFAULT_EDITOR_STACK = '"SF Mono", ui-monospace, "JetBrains Mono", Consolas, "Liberation Mono", Menlo, monospace'
    const FIRA_EDITOR_STACK = "'Fira Code Variable', 'Fira Code', " + DEFAULT_EDITOR_STACK
    const FONTS = [
      { id: 'default', label: 'Default', stack: DEFAULT_EDITOR_STACK },
      { id: 'fira', label: 'Fira Code', stack: FIRA_EDITOR_STACK },
    ]
    function applyFont(id) {
      const body = document.body
      if (!body) {
        document.addEventListener('DOMContentLoaded', () => applyFont(id), { once: true })
        return
      }
      const f = FONTS.find((x) => x.id === id && x.stack)
      if (f) body.style.setProperty('--arxa-editor-font', f.stack)
      else body.style.removeProperty('--arxa-editor-font')
    }

    // Editor webfont PRELOAD (2026-09-01, desktop-webview fix). The CSS
    // @font-face below lazy-loads on FIRST USE — which is exactly when the
    // artifact-viewer's CodeMirror first paints. macOS 26 (Tahoe) app
    // webviews have a WebKit regression in that window: text already laid
    // out with the fallback never re-renders when the webfont resolves
    // (Apple FB18869578 class; Chromium swaps fine). Registering the faces
    // eagerly at plugin load — bytes fetched via fetch() and added through
    // the FontFace API — means any editor created later measures and paints
    // with the real font from the first frame.
    let editorFontReady = null
    function preloadEditorFont() {
      if (editorFontReady !== null) return editorFontReady
      const LATIN_EXT_RANGE = 'U+0100-024F,U+0259,U+1E00-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'
      const load = (file, range) => fetch(FONT_SRC + file)
        .then((r) => { if (!r.ok) throw new Error('font ' + file + ' ' + r.status); return r.arrayBuffer() })
        .then((b) => {
          const f = new FontFace('Fira Code Variable', b,
            range ? { weight: '300 700', style: 'normal', unicodeRange: range } : { weight: '300 700', style: 'normal' })
          return f.load().then(() => f)
        })
        .then((f) => { document.fonts.add(f) })
        .catch(() => { /* CSS @font-face stays as the secondary path */ })
      editorFontReady = Promise.all([
        load('fira-code-latin.woff2'),
        load('fira-code-latin-ext.woff2', LATIN_EXT_RANGE),
      ])
      return editorFontReady
    }
    const SWATCHES = ['#0EBAE4', '#0EE4E0', '#12D49A']
    const DEFAULT = SWATCHES[0]
    // Cross-DEVICE convergence cadence: the engine is the source of truth,
    // so a desktop-side change reaches the phone's webview within one tick.
    const POLL_MS = 5000
    // Same-tab localStorage writes never fire the storage event - row UI
    // (and any other listener) learns about converges through this set.
    const listeners = new Set()

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

    // Surface hue: arxa-brand repaints the ENTIRE neutral-bluish ramp (every
    // background surface in the app) with green-tinted neutrals, so the
    // studio's overall hue stayed moss no matter which accent was picked —
    // only accent-alias consumers (buttons, links, sidebar) reacted.
    // Re-derive the same lightness ladder from the chosen accent instead:
    // a light accent wash folded into a pure gray of matching value.
    // ponytail: gray values eyeballed from the moss ladder's luminance;
    // tune NEUTRAL_MIX per-stop if design asks.
    const NEUTRAL_L = {
      '00': 254, 50: 250, 60: 245, 75: 241, 100: 238, 150: 236, 200: 230,
      300: 209, 400: 177, 500: 156, 600: 132, 700: 100, 750: 68, 800: 53,
      850: 44, 875: 35, 900: 27, 950: 21, 1000: 16,
    }
    const NEUTRAL_MIX = 10 // % of accent folded into each gray stop

    const stored = () => {
      try {
        const v = localStorage.getItem(STORE_KEY)
        return SWATCHES.includes(v) ? v : DEFAULT
      } catch { return DEFAULT }
    }

    // Apply an accent everywhere THIS document tracks it: CSS vars,
    // localStorage cache, and in-tab listeners. No server I/O.
    function converge(hex) {
      if (!SWATCHES.includes(hex) || hex === stored()) return
      try { localStorage.setItem(STORE_KEY, hex) } catch { /* still applies */ }
      applyAccent(hex)
      for (const fn of listeners) fn(hex)
    }

    // The engine is the source of truth; localStorage is the instant cache.
    // Divergence means another device chose - follow it.
    async function syncFromServer() {
      try {
        const res = await fetch(SERVER_PATH, { cache: 'no-store' })
        if (!res.ok) return
        const hex = (await res.json())?.accent
        if (SWATCHES.includes(hex)) {
          // Engine has a choice: it wins (localStorage is only a cache).
          converge(hex)
        } else {
          // Migration: the engine file starts empty while this device may
          // already carry a choice - promote it to the source of truth once.
          const local = stored()
          if (local !== DEFAULT) pushToServer(local)
        }
      } catch { /* engine unreachable - the cached accent keeps rendering */ }
    }

    function pushToServer(hex) {
      fetch(SERVER_PATH, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accent: hex }),
      }).catch(() => { /* offline: local stays, converges on a later poll */ })
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
      for (const stop of Object.keys(NEUTRAL_L)) {
        const g = NEUTRAL_L[stop]
        body.style.setProperty(
          '--dsw-static-neutral-bluish-' + stop,
          'color-mix(in oklab, ' + hex + ' ' + NEUTRAL_MIX + '%, rgb(' +
            g + ', ' + g + ', ' + g + '))')
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
      fontPill: 'arxaAc_fontPill',
      fontPreview: 'arxaAc_fontPreview',
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
      '.arxaAc_selected{outline-color:var(--dsw-alias-label-primary)}' +
      '.arxaAc_fontPill{width:auto;height:28px;border-radius:14px;' +
      'font-size:12px;color:var(--dsw-alias-label-primary);' +
      'background:var(--dsw-alias-bg-layer-2);padding:0 12px;' +
      'font-family:var(--ds-font-family-code)}' +
      '.arxaAc_fontPreview{font-size:13px;line-height:20px;' +
      'padding:0 0 14px;color:var(--dsw-alias-label-primary);' +
      'white-space:pre;overflow-x:auto;font-family:var(--arxa-editor-font,Menlo,monospace)}'
    const tagId = 'arxa-theme-accent/AccentRow.css'
    if (typeof document !== 'undefined'
      && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'arxa-theme-accent'
      tag.dataset.pluginCss = tagId
      tag.textContent = cssText
      document.head.appendChild(tag)
      // Fira Code (SIL OFL, vendored variable woff2 by the artifact-viewer
      // vendor route) — SECONDARY path: the FontFace-API preload above is
      // the primary (macOS 26 app webviews never re-render text that laid
      // out before a lazy @font-face resolves). latin-ext covers pl/fr.
      const face = document.createElement('style')
      face.dataset.plugin = 'arxa-theme-accent'
      face.dataset.pluginCss = 'arxa-theme-accent/EditorFont.css'
      face.textContent =
        "@font-face{font-family:'Fira Code Variable';font-style:normal;font-weight:300 700;" +
        'font-display:swap;src:url(' + FONT_SRC + "fira-code-latin.woff2) format('woff2');}" +
        "@font-face{font-family:'Fira Code Variable';font-style:normal;font-weight:300 700;" +
        'font-display:swap;unicode-range:U+0100-024F,U+0259,U+1E00-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF;' +
        'src:url(' + FONT_SRC + "fira-code-latin-ext.woff2) format('woff2');}"
      document.head.appendChild(face)
    }
    //#endregion

    function AccentRow() {
      const [accent, setAccent] = React.useState(stored)
      // Cross-tab AND cross-device: another window picked a swatch - follow
      // it live (storage event covers other tabs; converge() covers the
      // engine-pulled value landing in this tab).
      React.useEffect(() => {
        const onStorage = (e) => {
          if (e.key === STORE_KEY && SWATCHES.includes(e.newValue)) {
            setAccent(e.newValue)
          }
        }
        const onConverge = (hex) => setAccent(hex)
        window.addEventListener('storage', onStorage)
        listeners.add(onConverge)
        return () => {
          window.removeEventListener('storage', onStorage)
          listeners.delete(onConverge)
        }
      }, [])
      const pick = (hex) => {
        try { localStorage.setItem(STORE_KEY, hex) } catch { /* still applies locally */ }
        applyAccent(hex)
        setAccent(hex)
        pushToServer(hex)
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

    // Live sample rendered under the Editor font row. The settings modal
    // unmounts the artifact viewer, so a font pick has no on-screen editor
    // to compare against — this preview IS that feedback: ligature pairs
    // fuse in Fira, stay plain in the default stack, instantly on click.
    const FONT_PREVIEW = 'a => b >= c != d |> 0OoIl1 :: -> =>'
    const fontStackFor = (id) => (id === 'fira' ? FIRA_EDITOR_STACK : DEFAULT_EDITOR_STACK)

    function EditorFontRow() {
      const storedFont = () => {
        try { return localStorage.getItem(FONT_STORE_KEY) || 'default' } catch { return 'default' }
      }
      const [font, setFont] = React.useState(storedFont)
      React.useEffect(() => {
        const onStorage = (e) => {
          if (e.key === FONT_STORE_KEY) setFont(e.newValue || 'default')
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
      }, [])
      const pick = (id) => {
        try { localStorage.setItem(FONT_STORE_KEY, id) } catch { /* still applies locally */ }
        applyFont(id)
        setFont(id)
      }
      return h('div', null,
        h('div', { className: css.row },
          h('div', { className: css.rowText },
            h('div', { className: css.title }, 'Editor font'),
            h('div', { className: css.desc },
              'Monospace used by the artifact viewer editor. Fira Code adds ligatures.')),
          h('div', { className: css.swatches, role: 'radiogroup', 'aria-label': 'Editor font' },
            FONTS.map((f) => h('button', {
              key: f.id,
              type: 'button',
              role: 'radio',
              'aria-checked': font === f.id,
              title: f.id === 'fira' ? 'Fira Code' : 'Default monospace',
              className: css.swatch + ' ' + css.fontPill + (font === f.id ? ' ' + css.selected : ''),
              style: f.id === 'fira' ? { fontFamily: "'Fira Code Variable', monospace" } : undefined,
              onClick: () => pick(f.id),
            }, f.label)))),
        h('div', {
          className: css.fontPreview,
          style: { fontFamily: fontStackFor(font) },
          'aria-live': 'polite',
        }, FONT_PREVIEW))
    }

    function apply(ctx) {
      // Every page, not just Settings: restore the stored accent on load and
      // track other windows even while the row is unmounted.
      applyAccent(stored())
      window.addEventListener('storage', (e) => {
        if (e.key === STORE_KEY && SWATCHES.includes(e.newValue)) {
          applyAccent(e.newValue)
        }
        if (e.key === FONT_STORE_KEY) applyFont(e.newValue || 'default')
      })
      applyFont((() => {
        try { return localStorage.getItem(FONT_STORE_KEY) || 'default' } catch { return 'default' }
      })())
      // The preload must start at page load, not at first editor paint —
      // see preloadEditorFont(). Swapping the stored font later (clicks)
      // re-applies instantly: the faces are already in the document set.
      preloadEditorFont()
      // Cross-device sync: resolve the engine's choice immediately (the
      // cached paint above avoids a flash), then keep converging on the poll
      // cadence and whenever the page becomes visible again.
      syncFromServer()
      setInterval(syncFromServer, POLL_MS)
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) syncFromServer()
      })
      // Personalisation tab (0.2.5): both rows moved from
      // settings.general.item to settings.personalisation.item (the slot the
      // arxa-personalisation section declares/renders); orders restart at
      // 0/10 with the prism Background group at 20 behind them.
      ctx.slots.inject('settings.personalisation.item', () =>
        ctx.slots.register({
          name: 'settings.personalisation.item',
          id: 'arxa-theme-accent',
          order: 0,
        }, AccentRow))
      ctx.slots.inject('settings.personalisation.item', () =>
        ctx.slots.register({
          name: 'settings.personalisation.item',
          id: 'arxa-theme-accent-font',
          order: 10,
        }, EditorFontRow))
    }
    const inject = ['slots']

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
