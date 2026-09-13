// Browser half of arxa-theme-accent. Hand-written in the __ModuleLoader__
// factory shape every dsh client bundle uses (same as arxa-waiting-page).
//
// 0.3.6 (2026-09-12, operator: 20% was "too much — lower to a strict
// minimum"): the ink fold sits at 15% — the smallest step that still reads
// palette-hued (10% read un-themed black, 20% read loud).
//
// 0.3.5 (2026-09-12, operator: "raise it"): the label-ink stops of the
// neutral wash fold the accent at 20% (surfaces stay 10%) — app text now
// reads visibly palette-hued instead of near-stock black. Both the inline
// painter and the solveStudio contrast mirror use the same per-stop mix.
//
// 0.3.0 (2026-09-11, grilled): the Accent row became the PALETTE row.
// Three built-in coolors palettes — Mystic Evening (the default, for
// everyone out of the box), Earthy Green, Light Steel — plus ONE custom
// slot: paste a coolors URL (or a bare hex list), 2–10 unique swatches.
// Tapping a strip swatch picks the accent inside that palette; the default
// accent is the most-saturated swatch (monochrome → 2nd-darkest). The old
// three fixed hexes are GONE; a stored legacy choice is simply ignored and
// the default palette takes over (remove + migrate, operator ruling).
//
// The chosen accent re-derives the dsh accent scale (--dsw-static-deepseek-*
// and --dsw-static-blue-*) as color-mix() tints set INLINE on <body> — inline
// beats both token blocks in the theme bundle (:root light +
// body[data-ds-dark-theme] dark) and the brand stylesheet — plus the whole
// 19-stop neutral-bluish surface ramp (10% accent wash over the fixed
// lightness ladder). Same mechanism as 0.2.5, palette-fed.
//
// CONTRAST (the engine): every palette — built-in or pasted — is computed
// before it paints, against WCAG 2.2 AA pairs (4.5:1 body, 3:1 non-text;
// APCA advisory readout only). The engine lives in lib/contrast.js (ported
// from arxa/arxa/lib/palette_contrast.dart, locked 2026-09-11) and is
// served by the host half at /__arxa/theme-accent/contrast.js — ONE copy,
// dynamically imported here, so host and client can never drift. The solve
// moves the DERIVED accent's lightness only (hue/chroma preserved, smallest
// step clearing every pair at once; polarity-flip to the palette's far end
// when no lightness can). The pasted swatches are anchors and never move;
// surfaces never move (scope A ruling). What cannot clear is reported
// honestly in the row's readout, never silently painted.
//
// Reactivity: same tab applies on click; other tabs/windows follow via the
// `storage` event; other devices converge on the 5s engine poll (the engine
// file is the source of truth, localStorage the instant cache). A pick's PUT
// is tracked (`landing`) so a poll that predates it can never converge the
// older choice back over it (the deselect race, live-caught 2026-09-11).
window.__ModuleLoader__.load({
  id: 'arxa-theme-accent',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement

    const STORE_KEY = 'arxa.themePalette'
    const SERVER_PATH = '/__arxa/theme-accent/palette'
    const ENGINE_URL = '/__arxa/theme-accent/contrast.js'
    // Editor font choice (2026-09-03): localStorage-backed (the editor is a
    // desktop-first surface; the palette's engine-file cross-device sync does
    // not extend to it). Applied as body-inline --arxa-editor-font, which the
    // artifact-viewer's cm-content consumes with the same Fira-free default
    // stack as its var() fallback.
    const FONT_STORE_KEY = 'arxa.editorFont'
    const FONT_SRC = '/__arxa/artifacts/vendor/'
    // Default must NEVER resolve to a Fira design or Default == Fira visually.
    // Lands on Menlo (macOS) / Consolas (Windows) / Liberation Mono (Linux).
    const DEFAULT_EDITOR_STACK = '"SF Mono", ui-monospace, "JetBrains Mono", Consolas, "Liberation Mono", Menlo, monospace'
    const FIRA_EDITOR_STACK = "'Fira Code Variable', 'Fira Code', " + DEFAULT_EDITOR_STACK
    const FONTS = [
      // Fira Code is a product (font) name — untranslated; Default's label
      // rides the dictionary (labelKey; render falls back to `label`).
      { id: 'default', labelKey: 'font.default', label: 'Default', stack: DEFAULT_EDITOR_STACK },
      { id: 'fira', label: 'Fira Code', stack: FIRA_EDITOR_STACK },
    ]

    // The arxa-locale namespace this plugin owns (task 8's tab-wide pass —
    // docs/plans/palette-personalisation.md said the en/pl/fr rider covers
    // the whole tab; this is it for these two rows). en is the source set,
    // pl/fr carry the same keys (parity gate: plugins/locale/selftest.parity.mjs).
    // Product terms kept verbatim per CONTEXT.md: coolors (the URL/domain),
    // Fira Code, AA/APCA (contrast standards), artifact viewer.
    const NS = 'arxa-theme-accent'
    const DICT = {
      en: {
        'palette.title': 'Palette',
        'palette.desc': 'Color palette of the studio. Tap a strip for the palette, tap a swatch to set its accent.',
        'palette.custom': 'Custom',
        'palette.addAria': 'Add a custom palette',
        'palette.pasteHint': 'paste a coolors URL below',
        'palette.swatchesAria': '{name} swatches',
        'palette.inputPlaceholder': 'coolors.co/palette/… or 2–10 hex codes',
        'palette.inputAria': 'Custom palette',
        'palette.add': 'Add',
        'palette.err': 'Paste a coolors URL or 2–10 hex codes (e.g. 1a1423-b75d69).',
        'palette.noteMarks': 'marks ',
        'palette.noteAA': 'contrast AA · ',
        'palette.noteAdjusted': 'accent adjusted for contrast · ',
        'palette.noteBelowAA': ' · below AA: ',
        'palette.noteOffline': 'contrast engine offline',
        'font.title': 'Editor font',
        'font.desc': 'Monospace used by the artifact viewer editor. Fira Code adds ligatures.',
        'font.aria': 'Editor font',
        'font.default': 'Default',
        'font.defaultTitle': 'Default monospace',
      },
      pl: {
        'palette.title': 'Paleta',
        'palette.desc': 'Paleta kolorów studia. Dotknij paska, by wybrać paletę; dotknij próbki, by ustawić akcent.',
        'palette.custom': 'Własna',
        'palette.addAria': 'Dodaj własną paletę',
        'palette.pasteHint': 'wklej poniżej adres coolors',
        'palette.swatchesAria': 'próbki: {name}',
        'palette.inputPlaceholder': 'coolors.co/palette/… lub 2–10 kodów hex',
        'palette.inputAria': 'Własna paleta',
        'palette.add': 'Dodaj',
        'palette.err': 'Wklej adres coolors lub 2–10 kodów hex (np. 1a1423-b75d69).',
        'palette.noteMarks': 'osiąga ',
        'palette.noteAA': 'kontrast AA · ',
        'palette.noteAdjusted': 'akcent dostosowany dla kontrastu · ',
        'palette.noteBelowAA': ' · poniżej AA: ',
        'palette.noteOffline': 'silnik kontrastu niedostępny',
        'font.title': 'Czcionka edytora',
        'font.desc': 'Monospace używany przez edytor artifact viewer. Fira Code dodaje ligatury.',
        'font.aria': 'Czcionka edytora',
        'font.default': 'Domyślna',
        'font.defaultTitle': 'Domyślny monospace',
      },
      fr: {
        'palette.title': 'Palette',
        'palette.desc': 'Palette de couleurs du studio. Touchez une bande pour choisir la palette, une pastille pour définir l’accent.',
        'palette.custom': 'Personnalisée',
        'palette.addAria': 'Ajouter une palette personnalisée',
        'palette.pasteHint': 'collez une URL coolors ci-dessous',
        'palette.swatchesAria': 'pastilles de {name}',
        'palette.inputPlaceholder': 'coolors.co/palette/… ou 2 à 10 codes hex',
        'palette.inputAria': 'Palette personnalisée',
        'palette.add': 'Ajouter',
        'palette.err': 'Collez une URL coolors ou 2 à 10 codes hex (p. ex. 1a1423-b75d69).',
        'palette.noteMarks': 'atteint ',
        'palette.noteAA': 'contraste AA · ',
        'palette.noteAdjusted': 'accent ajusté pour le contraste · ',
        'palette.noteBelowAA': ' · sous AA : ',
        'palette.noteOffline': 'moteur de contraste hors ligne',
        'font.title': 'Police de l’éditeur',
        'font.desc': 'Monospace utilisée par l’éditeur de l’artifact viewer. Fira Code ajoute des ligatures.',
        'font.aria': 'Police de l’éditeur',
        'font.default': 'Par défaut',
        'font.defaultTitle': 'Monospace par défaut',
      },
    }
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
    // out with the fallback never re-renders when the webfont resolves.
    // Registering the faces eagerly at plugin load means any editor created
    // later measures and paints with the real font from the first frame.
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

    // ── palettes ────────────────────────────────────────────────────────────
    // The three built-ins are named in coolors' own data (verified live via
    // the lens, 2026-09-11); a custom paste names itself "Custom" unless the
    // host's best-effort fetch extracts the page's <h1> (offline is fine).
    const PRESETS = [
      { id: 'mystic-evening', name: 'Mystic Evening', palette: '1a1423-372549-774c60-b75d69-eacdc2' },
      { id: 'earthy-green', name: 'Earthy Green', palette: 'cad2c5-84a98c-52796f-354f52-2f3e46' },
      { id: 'light-steel', name: 'Light Steel', palette: 'f8f9fa-e9ecef-dee2e6-ced4da-adb5bd-6c757d-495057-343a40-212529' },
    ]
    const DEFAULT = PRESETS[0]
    // Cross-DEVICE convergence cadence: the engine is the source of truth.
    const POLL_MS = 5000
    // Same-tab localStorage writes never fire the storage event — row UI
    // (and any other listener) learns about converges through this set.
    const listeners = new Set()

    /** Parse a pasted coolors URL or bare hex list → normalized unique
     * 6-digit lowercase hexes, or null. Bounds 2–10 are coolors' own
     * (lens-verified 2026-09-11: 1 → 404, 2 ✓, 10 ✓, 11+ refused). */
    function parsePaletteInput(text) {
      const t = String(text || '').trim()
      if (!t) return null
      const m = /\/palette\/([0-9a-fA-F#-]+)/.exec(t)
      const body = m ? m[1] : t
      const raw = body.split(/[-\s,]+/).map((x) => x.replace(/^#/, '')).filter(Boolean)
      const norm = []
      for (const r of raw) {
        let hx = r.toLowerCase()
        if (/^[0-9a-f]{3}$/.test(hx)) hx = hx.split('').map((c) => c + c).join('')
        if (!/^[0-9a-f]{6}$/.test(hx)) return null
        if (!norm.includes(hx)) norm.push(hx)
      }
      return norm.length >= 2 && norm.length <= 10 ? norm : null
    }

    const paletteHexes = (palette) => String(palette || '').split('-').filter(Boolean)
    /** Anchors must reach paintRamps as #-prefixed uppercase hexes — a
     *  bare hex is an INVALID CSS color at use time (live-caught 2026-09-11:
     *  palette 000814-…-ffd60a, whose anchor the solve never moves, painted
     *  `--dsw-static-deepseek-500: ffd60a` and the whole accent ramp broke). */
    const withHash = (hx) => (/^#?[0-9a-fA-F]{6}$/.test(String(hx || '')) ? '#' + String(hx).replace(/^#/, '').toUpperCase() : hx)

    /** Default accent: most-saturated swatch; a monochrome palette (all
     * chroma < 0.04) falls to the 2nd-darkest (ascending by L puts the
     * darkest FIRST — index 1, never length-2 which reads the 2nd-lightest).
     * Tapping a swatch overrides. */
    function autoAccent(palette, E) {
      const labs = paletteHexes(palette).map((hx) => ({ hx, ok: E.toOklch(E.hexToRgb(hx)) }))
      const maxC = labs.reduce((mx, x) => Math.max(mx, x.ok.c), 0)
      if (maxC >= 0.04) return labs.sort((a, b) => b.ok.c - a.ok.c)[0].hx
      const sorted = labs.sort((a, b) => a.ok.l - b.ok.l)
      return sorted[1].hx
    }

    // Tint ladders mirroring the stock lightness curves. oklab keeps hue
    // steady across mixes. ponytail: eyeballed percentages, tune per-stop if
    // design asks. BOTH accent ramps are owned here: the frontend's accent
    // aliases resolve through --dsw-static-blue-* AND --dsw-static-deepseek-*.
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
    // Surface hue: the neutral-bluish ramp (every background surface in the
    // app) re-derived from the accent — a light accent wash folded into a
    // pure gray of matching value. The LIGHTNESS ladder is fixed (scope A
    // ruling: palettes repaint hue, never surface depth).
    const NEUTRAL_L = {
      '00': 254, 50: 250, 60: 245, 75: 241, 100: 238, 150: 236, 200: 230,
      300: 209, 400: 177, 500: 156, 600: 132, 700: 100, 750: 68, 800: 53,
      850: 44, 875: 35, 900: 27, 950: 21, 1000: 16,
    }
    const NEUTRAL_MIX = 10 // % of accent folded into each gray stop
    // Ink stops fold harder (operator, 2026-09-12: "raise it", then "too
    // much — strict minimum") — the label
    // aliases read 50/200/300/400/600/700/750/1000 across the two themes
    // (measured map: light primary/secondary/tertiary/caption/dimmed =
    // 1000/700/600/400/200, dark = 50/300/400/600/750), and a 10% fold into
    // near-black reads un-themed black while 20% reads loud. 15% is the
    // strict minimum that still shows the hue, and keeps every label pair
    // far above target (light ink ≈ oklab L .26 on the .94 bg). Surfaces
    // keep 10% —
    // depth never moves (scope A); solveStudio mirrors this exactly so the
    // contrast readout describes what actually paints.
    const INK_MIX = 15
    const INK_STOPS = new Set(['50', '200', '300', '400', '600', '700', '750', '1000'])
    const mixFor = (stop) => (INK_STOPS.has(stop) ? INK_MIX : NEUTRAL_MIX)
    const grayHex = (g) => '#' + [g, g, g].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
    // Stock PLAIN-neutral stops the scrollbar aliases consume (light:
    // 200/300, dark: 550/600/700) + 850 (dark bg-multi-select). The bluish
    // ramp gets the wash below; this ramp never did, so scrollbars stayed
    // stock gray while every other surface carried the palette.
    const SCROLLBAR_NEUTRALS = { 200: '#e5e5e5', 300: '#d4d4d4', 550: '#65676b', 600: '#545557', 700: '#3c3c3d', 850: '#212123' }

    // The one engine import — cached. Served by the host half, so lib/
    // contrast.js is the ONLY copy (host and client cannot drift).
    let engineReady = null
    const engine = () => (engineReady ??= import(ENGINE_URL))

    /** The studio pair contract — the REAL token map, measured from
     *  @deepseek-ai/dsh-client-ui-theme (2026-09-11), not guessed:
     *    light theme: bg-layer-1/2/3 ALL read neutral-00; the accent
     *      alias reads deepseek-400; labels read neutral-1000/400.
     *    dark theme: bg-layer-1/2/3 read neutral-875/850/800; the accent
     *      reads deepseek-500; labels read neutral-50/600.
     *  business-primary is consumed as TEXT + focus + marks (5 color: uses,
     *  ZERO background uses in the shipped CSS) — so the accent pairs gate
     *  at 3:1 (SC 1.4.11 non-text/marks; stock light accent #679efe on #fff
     *  is itself 2.66:1 — the solve IMPROVES on stock, never enforces
     *  4.5:1 text on it). Labels pair at body/3:1. The engine's Radix law
     *  holds: each accent slot carries its whole pair set at once. alt =
     *  the palette's far end in lightness (the polarity escape — e.g. a
     *  near-black anchor on the dark surfaces flips to the palette's light
     *  end). Labels and surfaces are scope-A-fixed: any engine move on them
     *  is reverted, the residue re-reported honestly. */
    function solveStudio(palette, accentHex, E) {
      const washed = {}
      for (const stop of Object.keys(NEUTRAL_L)) {
        washed[stop] = E.mixOklab(accentHex, mixFor(stop), grayHex(NEUTRAL_L[stop]))
      }
      const slots = {
        accentDark: withHash(accentHex), // the deepseek-500 position — the dark accent (always paintable)
        accentLight: E.mixOklab(accentHex, 78, '#FFFFFF'), // deepseek-400 = ACC 78%
        bgL: washed['00'], // light: every bg layer reads neutral-00
        bgD1: washed['875'], bgD2: washed['850'], bgD3: washed['800'],
        labelPL: washed['1000'], labelPD: washed['50'],
        labelTL: washed['400'], labelTD: washed['600'],
      }
      const pairs = [
        { fg: 'accentLight', bg: 'bgL', level: 'nontext' },
        { fg: 'labelPL', bg: 'bgL', level: 'body' },
        { fg: 'labelTL', bg: 'bgL', level: 'nontext' },
        { fg: 'accentDark', bg: 'bgD1', level: 'nontext' },
        { fg: 'accentDark', bg: 'bgD2', level: 'nontext' },
        { fg: 'accentDark', bg: 'bgD3', level: 'nontext' },
        { fg: 'labelPD', bg: 'bgD1', level: 'body' },
        { fg: 'labelTD', bg: 'bgD1', level: 'nontext' },
      ]
      const anchorL = E.toOklch(E.hexToRgb(accentHex)).l
      const alt = (slot) => {
        if (slot !== 'accentDark') return null
        let best = null
        for (const hx of paletteHexes(palette)) {
          if (hx.toUpperCase() === accentHex.toUpperCase()) continue
          const l = E.toOklch(E.hexToRgb(hx)).l
          if (best === null || Math.abs(l - anchorL) > Math.abs(best.l - anchorL)) best = { l, hx }
        }
        return best ? withHash(best.hx) : null
      }
      const { hexes: solved } = E.solveContrast(slots, pairs, alt)
      // Honest residue against the ORIGINAL slots (labels + surfaces never move).
      const passes = (pair) => (E.contrastRatio(solved[pair.fg], slots[pair.bg]) ?? 0) >= E.pairTarget(pair.level)
      const unsolved = pairs.filter((p) => !passes(p)).map((p) => p.fg + ' on ' + p.bg)
      return {
        accentDark: solved.accentDark,
        accentLight: solved.accentLight,
        moved: solved.accentDark.toUpperCase() !== accentHex.toUpperCase()
          || solved.accentLight.toUpperCase() !== slots.accentLight.toUpperCase(),
        unsolved,
        ratios: {
          light: E.contrastRatio(solved.accentLight, washed['00']),
          dark: E.contrastRatio(solved.accentDark, washed['800']),
        },
      }
    }

    /** Paint the solved accents through the ramps + wash (0.2.5 mechanism;
     *  the two accent-alias positions take the SOLVED hexes — every other
     *  stop stays the stock ladder formula off the dark anchor). */
    function paintRamps(accentDark, accentLight) {
      const body = document.body
      if (!body) {
        document.addEventListener('DOMContentLoaded', () => paintRamps(accentDark, accentLight), { once: true })
        return
      }
      for (const ramp of Object.keys(RAMPS)) {
        for (const stop of RAMPS[ramp]) {
          const value = stop === 400
            ? accentLight // the deepseek-400/blue-400 position = the light accent
            : TINTS[stop].replace('ACC', accentDark)
          body.style.setProperty('--dsw-static-' + ramp + '-' + stop, value)
        }
      }
      for (const stop of Object.keys(NEUTRAL_L)) {
        const g = NEUTRAL_L[stop]
        body.style.setProperty(
          '--dsw-static-neutral-bluish-' + stop,
          'color-mix(in oklab, ' + accentDark + ' ' + mixFor(stop) + '%, rgb(' +
            g + ', ' + g + ', ' + g + '))')
      }
      // Scrollbars ride the PLAIN neutral ramp — wash it too (same 10%,
      // stock values kept as-is: depth never moves, scope A). The remnant
      // sweep, 2026-09-11: bars used to stay stock gray mid-palette.
      for (const [stop, stock] of Object.entries(SCROLLBAR_NEUTRALS)) {
        body.style.setProperty(
          '--dsw-static-neutral-' + stop,
          'color-mix(in oklab, ' + accentDark + ' ' + NEUTRAL_MIX + '%, ' + stock + ')')
      }
    }

    // ── state + convergence ────────────────────────────────────────────────
    const validState = (v) => {
      if (!v || typeof v !== 'object') return null
      const hexes = parsePaletteInput(v.palette)
      if (!hexes) return null
      const accent = typeof v.accent === 'string' && hexes.includes(v.accent.replace(/^#/, '').toLowerCase())
        ? '#' + v.accent.replace(/^#/, '').toLowerCase() : null
      return { palette: hexes.join('-'), accent, name: typeof v.name === 'string' && v.name && v.name !== 'Palette' ? v.name.slice(0, 60) : null }
    }
    const stored = () => {
      try {
        const v = validState(JSON.parse(localStorage.getItem(STORE_KEY) || 'null'))
        return v || { palette: DEFAULT.palette, accent: null, name: DEFAULT.name }
      } catch { return { palette: DEFAULT.palette, accent: null, name: DEFAULT.name } }
    }

    /** Apply a palette everywhere THIS document tracks it: solve, paint,
     *  localStorage cache, in-tab listeners. No server I/O. */
    async function applyPalette(state) {
      const s = validState(state) || stored()
      const anchor = s.accent || autoAccentFallback(s.palette)
      try {
        const E = await engine()
        const a = s.accent || autoAccent(s.palette, E)
        const r = solveStudio(s.palette, a, E)
        paintRamps(r.accentDark, r.accentLight)
      } catch {
        // Engine unreachable (offline first boot): paint the anchor raw —
        // the ramps still apply; the solve lands on the next convergence.
        paintRamps(withHash(anchor), withHash(anchor))
      }
      return s
    }
    // Regex-only auto fallback when the engine import failed — the engine
    // path is the real one; this just paints SOMETHING sane offline.
    // ponytail: crude (2nd swatch), the solve corrects it on convergence.
    function autoAccentFallback(palette) {
      const hexes = paletteHexes(palette)
      return hexes[Math.min(hexes.length - 1, 1)]
    }

    async function converge(state) {
      const s = validState(state)
      if (!s) return
      if (landing) return // this GET predates our in-flight pick — never revert it
      const cur = stored()
      if (s.palette === cur.palette && s.accent === cur.accent) {
        // The fetched NAME catching up (palette+accent already match): adopt
        // it into the cache + listeners — no repaint needed.
        if (s.name && s.name !== cur.name) {
          try { localStorage.setItem(STORE_KEY, JSON.stringify(s)) } catch { /* name is cosmetic */ }
          for (const fn of listeners) fn(s)
        }
        return
      }
      try { localStorage.setItem(STORE_KEY, JSON.stringify(s)) } catch { /* still applies */ }
      await applyPalette(s)
      for (const fn of listeners) fn(s)
    }

    // The engine file is the source of truth; localStorage is the instant
    // cache. Divergence means another device chose — follow it.
    async function syncFromServer() {
      try {
        const res = await fetch(SERVER_PATH, { cache: 'no-store' })
        if (!res.ok) return
        const v = await res.json()
        if (v && validState(v)) {
          await converge(v) // engine has a choice: it wins
        } else {
          // Migration: the engine file starts empty while this device may
          // already carry a choice — promote it to the source of truth once.
          const local = stored()
          if (local.palette !== DEFAULT.palette) pushToServer(local)
        }
      } catch { /* engine unreachable — the cached palette keeps rendering */ }
    }

    // A pick's PUT in flight — stale GETs (the 5s poll, a forced
    // visibilitychange pass) must not converge an OLDER engine state over
    // it. Cleared when the PUT settles; the host also writes the choice
    // before its name fetch now, so the window is closed at both ends.
    let landing = null
    function pushToServer(state) {
      landing = fetch(SERVER_PATH, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ palette: state.palette, accent: state.accent }),
      }).catch(() => { /* offline: local stays, converges on a later poll */ })
        .finally(() => { landing = null })
    }

    // ── row styles ─────────────────────────────────────────────────────────
    const css = {
      row: 'arxaAc_row',
      rowText: 'arxaAc_rowText',
      title: 'arxaAc_title',
      desc: 'arxaAc_desc',
      cards: 'arxaAc_cards',
      card: 'arxaAc_card',
      selCard: 'arxaAc_selCard',
      cardName: 'arxaAc_cardName',
      strip: 'arxaAc_strip',
      chip: 'arxaAc_chip',
      chipSel: 'arxaAc_chipSel',
      phCard: 'arxaAc_phCard',
      phStrip: 'arxaAc_phStrip',
      inputRow: 'arxaAc_inputRow',
      input: 'arxaAc_input',
      err: 'arxaAc_err',
      note: 'arxaAc_note',
      swatches: 'arxaAc_swatches',
      selected: 'arxaAc_selected',
      btn: 'arxaAc_btn',
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
      '.arxaAc_selected{color:var(--dsw-alias-label-primary);' +
      'background:var(--dsw-alias-button-ghost-active-fill);' +
      'box-shadow:inset 0 0 0 1px var(--dsw-alias-button-ghost-active-border)}' +
      '.arxaAc_btn{height:28px;padding:0 14px;border:none;border-radius:14px;' +
      'font-size:13px;line-height:20px;cursor:pointer;' +
      'color:var(--dsw-alias-label-primary-foreground);' +
      'background:var(--dsw-alias-button-primary-fill)}' +
      '.arxaAc_btn:hover{background:var(--dsw-alias-button-primary-hover)}' +
      '.arxaAc_btn:active{background:var(--dsw-alias-interactive-bg-active)}' +
      '.arxaAc_cards{display:flex;flex-direction:column;gap:8px;padding:0 0 14px}' +
      '.arxaAc_card{display:flex;flex-direction:column;gap:6px;border:1px solid ' +
      'var(--dsw-alias-border-l2);border-radius:8px;padding:10px 12px;cursor:pointer;' +
      'background:transparent;text-align:left}' +
      '.arxaAc_card:hover{border-color:var(--dsw-alias-label-secondary,#8a8f98)}' +
      '.arxaAc_selCard{border-color:var(--dsw-alias-label-primary)}' +
      '.arxaAc_cardName{color:var(--dsw-alias-label-primary);font-size:13px;' +
      'line-height:18px;font-weight:500}' +
      '.arxaAc_strip{display:flex;gap:0;border-radius:4px;overflow:hidden;' +
      'height:24px}' +
      '.arxaAc_chip{flex:1;border:none;cursor:pointer;padding:0;height:100%;' +
      'outline:2px solid transparent;outline-offset:-2px}' +
      '.arxaAc_chip:hover{outline-color:var(--dsw-alias-label-primary)}' +
      '.arxaAc_chipSel{outline-color:var(--dsw-alias-label-primary)}' +
      '.arxaAc_phCard{border-style:dashed;cursor:pointer}' +
      '.arxaAc_phCard:hover{border-color:var(--dsw-alias-label-secondary,#8a8f98)}' +
      '.arxaAc_phStrip{display:flex;align-items:center;justify-content:center;height:24px;' +
      'border:1px dashed var(--dsw-alias-border-l2);border-radius:4px;color:' +
      'var(--dsw-alias-label-secondary,#8a8f98);font-size:11px}' +
      '.arxaAc_inputRow{display:flex;gap:8px;padding:0 0 6px}' +
      '.arxaAc_input{flex:1;min-width:0;height:28px;border:1px solid ' +
      'var(--dsw-alias-border-l2);border-radius:6px;background:transparent;' +
      'color:var(--dsw-alias-label-primary);font-size:12px;padding:0 10px}' +
      '.arxaAc_input:focus{outline:none;border-color:var(--dsw-alias-label-primary)}' +
      '.arxaAc_err{color:var(--dsw-alias-state-error-primary);font-size:12px;' +
      'line-height:18px;padding:0 0 6px}' +
      '.arxaAc_note{color:var(--dsw-alias-label-secondary,#8a8f98);font-size:11px;' +
      'line-height:16px;padding:0 0 14px}' +
      // Pills + buttons speak the MEASURED dsh recipes (dist CSS
      // _pill_e3ygd_1 / _active_e3ygd_23 / _primary_cfgyt_38) — same UI
      // language as the app, never a hand-rolled look (2026-09-12).
      '.arxaAc_fontPill{height:24px;padding:0 8px;border:none;' +
      'border-radius:12px;font-size:12px;line-height:18px;cursor:pointer;' +
      'color:var(--dsw-alias-label-secondary);' +
      'background:var(--dsw-alias-bg-layer-2)}' +
      '.arxaAc_fontPill:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
      '.arxaAc_fontPreview{font-size:13px;line-height:20px;' +
      'padding:0 0 14px;color:var(--dsw-alias-label-primary);' +
      'white-space:pre;overflow-x:auto;font-family:var(--arxa-editor-font,Menlo,monospace)}'
    const tagId = 'arxa-theme-accent/PaletteRow.css'
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
      // out before a lazy @font-face resolves).
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

    function PaletteRow({ t }) {
      const [state, setState] = React.useState(stored)
      const [input, setInput] = React.useState('')
      const [err, setErr] = React.useState('')
      const [note, setNote] = React.useState('')
      const inputRef = React.useRef(null)
      // Cross-tab AND cross-device: another window picked — follow it live.
      React.useEffect(() => {
        const onStorage = (e) => {
          if (e.key === STORE_KEY) {
            const s = validState(JSON.parse(e.newValue || 'null')) || stored()
            setState(s); applyPalette(s)
          }
        }
        const onConverge = (s) => { setState(s); setErr('') }
        window.addEventListener('storage', onStorage)
        listeners.add(onConverge)
        return () => {
          window.removeEventListener('storage', onStorage)
          listeners.delete(onConverge)
        }
      }, [])
      // The contrast readout: solved live for the CURRENT palette (engine +
      // solve + ratios; APCA advisory). Recomputed on every state change.
      React.useEffect(() => {
        let live = true
        setNote('…')
        engine().then((E) => {
          if (!live) return
          const anchor = state.accent || autoAccent(state.palette, E)
          const r = solveStudio(state.palette, anchor, E)
          const bits = [
            t('palette.noteMarks') + r.ratios.light.toFixed(1) + ':' + r.ratios.dark.toFixed(1) + ':1',
            'APCA ' + E.apcaLc(r.accentDark, '#2c2c2c').toFixed(0) + ' Lc',
          ]
          setNote((r.moved ? t('palette.noteAdjusted') : t('palette.noteAA'))
            + bits.join(' · ')
            + (r.unsolved.length ? t('palette.noteBelowAA') + r.unsolved.join(', ') : ''))
        }).catch(() => live && setNote(t('palette.noteOffline')))
        return () => { live = false }
      }, [state])
      const pick = (palette, name, accentOverride) => {
        const s = validState({ palette, accent: accentOverride, name })
        if (!s) return
        try { localStorage.setItem(STORE_KEY, JSON.stringify(s)) } catch { /* still applies locally */ }
        setState(s); setErr('')
        applyPalette(s)
        pushToServer(s)
      }
      const addCustom = () => {
        const hexes = parsePaletteInput(input)
        if (!hexes) {
          setErr(t('palette.err'))
          return
        }
        setErr('')
        setInput('')
        pick(hexes.join('-'), null, null)
      }
      const cards = PRESETS.slice()
      const isPreset = PRESETS.some((p) => p.palette === state.palette)
      // The 4th slot is ALWAYS present: a real card while a custom palette
      // is active, a dashed PLACEHOLDER otherwise — the seat a paste lands
      // in must be visible before anything is pasted (operator, 2026-09-11).
      if (!isPreset) cards.push({ id: 'custom', name: state.name || t('palette.custom'), palette: state.palette })
      else cards.push({ id: 'custom', placeholder: true, name: t('palette.custom') })
      const focusInput = () => { if (inputRef.current) inputRef.current.focus() }
      return h('div', null,
        h('div', { className: css.row },
          h('div', { className: css.rowText },
            h('div', { className: css.title }, t('palette.title')),
            h('div', { className: css.desc },
              t('palette.desc')))),
        h('div', { className: css.cards },
          cards.map((card) => card.placeholder
            ? h('div', {
                key: card.id,
                role: 'button',
                tabIndex: 0,
                'aria-label': t('palette.addAria'),
                className: css.card + ' ' + css.phCard,
                onClick: focusInput,
                onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusInput() } },
              },
                h('div', { className: css.cardName }, card.name),
                h('div', { className: css.phStrip }, t('palette.pasteHint')))
            : h('div', {
                key: card.id,
                role: 'radio',
                'aria-checked': state.palette === card.palette,
                tabIndex: 0,
                className: css.card + (state.palette === card.palette ? ' ' + css.selCard : ''),
                onClick: () => pick(card.palette, card.name, null),
                onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(card.palette, card.name, null) } },
              },
                h('div', { className: css.cardName }, card.name),
                h('div', { className: css.strip, role: 'group', 'aria-label': t('palette.swatchesAria', { name: card.name }) },
                  paletteHexes(card.palette).map((hx) => h('button', {
                    key: hx,
                    type: 'button',
                    title: '#' + hx,
                    'aria-pressed': (state.accent || '') === '#' + hx,
                    className: css.chip + ((state.accent || '') === '#' + hx ? ' ' + css.chipSel : ''),
                    style: { background: '#' + hx },
                    onClick: (e) => { e.stopPropagation(); pick(card.palette, card.name, '#' + hx) },
                  })))))),
        h('div', { className: css.inputRow },
          h('input', {
            ref: inputRef,
            className: css.input,
            type: 'text',
            value: input,
            placeholder: t('palette.inputPlaceholder'),
            'aria-label': t('palette.inputAria'),
            onChange: (e) => setInput(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') addCustom() },
          }),
          h('button', {
            type: 'button',
            className: css.btn,
            onClick: addCustom,
          }, t('palette.add'))),
        err !== '' && h('div', { className: css.err, role: 'alert' }, err),
        h('div', { className: css.note }, note))
    }

    // Live sample rendered under the Editor font row. The settings modal
    // unmounts the artifact viewer, so a font pick has no on-screen editor
    // to compare against — this preview IS that feedback.
    const FONT_PREVIEW = 'a => b >= c != d |> 0OoIl1 :: -> =>'
    const fontStackFor = (id) => (id === 'fira' ? FIRA_EDITOR_STACK : DEFAULT_EDITOR_STACK)

    function EditorFontRow({ t }) {
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
            h('div', { className: css.title }, t('font.title')),
            h('div', { className: css.desc },
              t('font.desc'))),
          h('div', { className: css.swatches, role: 'radiogroup', 'aria-label': t('font.aria') },
            FONTS.map((f) => h('button', {
              key: f.id,
              type: 'button',
              role: 'radio',
              'aria-checked': font === f.id,
              title: f.id === 'fira' ? 'Fira Code' : t('font.defaultTitle'),
              className: css.fontPill + (font === f.id ? ' ' + css.selected : ''),
              style: f.id === 'fira' ? { fontFamily: "'Fira Code Variable', monospace" } : undefined,
              onClick: () => pick(f.id),
            }, f.labelKey ? t(f.labelKey) : f.label)))),
        h('div', {
          className: css.fontPreview,
          style: { fontFamily: fontStackFor(font) },
          'aria-live': 'polite',
        }, FONT_PREVIEW))
    }

    function apply(ctx) {
      // Every page, not just Settings: solve + paint the stored palette on
      // load and track other windows even while the row is unmounted.
      applyPalette(stored())
      window.addEventListener('storage', (e) => {
        if (e.key === STORE_KEY) {
          const s = validState(JSON.parse(e.newValue || 'null'))
          if (s) applyPalette(s)
        }
        if (e.key === FONT_STORE_KEY) applyFont(e.newValue || 'default')
      })
      applyFont((() => {
        try { return localStorage.getItem(FONT_STORE_KEY) || 'default' } catch { return 'default' }
      })())
      // The preload must start at page load, not at first editor paint.
      preloadEditorFont()
      // Cross-device sync: resolve the engine's choice immediately (the
      // cached paint above avoids a flash), then keep converging on the poll
      // cadence and whenever the page becomes visible again.
      syncFromServer()
      setInterval(syncFromServer, POLL_MS)
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) syncFromServer()
      })
      // Personalisation tab: both rows live in settings.personalisation.item
      // (the slot the arxa-personalisation section declares); orders 0/10
      // with the prism Background group at 20 behind them. The rows' copy
      // rides the arxa-locale service (task 8): `locale: NS` gives the
      // components the bound t through composed slot props, the stock
      // AppearanceRow's own contract.
      ctx.effect(() => ctx.locale.register(NS, { en: DICT.en, pl: DICT.pl, fr: DICT.fr }), 'arxa-theme-accent: dictionary')
      ctx.slots.inject('settings.personalisation.item', () =>
        ctx.slots.register({
          name: 'settings.personalisation.item',
          id: 'arxa-theme-accent',
          order: 0,
          locale: NS,
        }, PaletteRow))
      ctx.slots.inject('settings.personalisation.item', () =>
        ctx.slots.register({
          name: 'settings.personalisation.item',
          id: 'arxa-theme-accent-font',
          order: 10,
          locale: NS,
        }, EditorFontRow))
    }
    const inject = ['slots', 'locale']

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
