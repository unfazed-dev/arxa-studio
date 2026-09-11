// Browser half of arxa-brand. Hand-written in the __ModuleLoader__ factory
// shape every dsh client bundle uses (same pattern as arxa-design-panel).
//
// Three moves, all CSS/DOM — the frontend dist is a built artifact and is
// never edited:
//  1. Accent: the frontend's accent aliases resolve through the static
//     `--dsw-static-blue-*` and `--dsw-static-deepseek-*` palettes, which
//     the bundle defines on `body` / `body[data-ds-dark-theme]` (NOT :root
//     — a bare :root override is shadowed by inheritance). This stylesheet
//     redefines both ramps on the same selectors, appended to <head> after
//     the bundle CSS so it wins by source order. Since the palette
//     personalisation (0.3.1) the DEFAULT it paints is Mystic Evening's
//     SOLVED accent pair (dark #C56975 / light #BC757D — engine-solved,
//     WCAG AA) — the legacy cyan is gone; theme-accent's inline palette
//     paint beats this sheet the moment a choice exists.
//  2. Wordmark: the sidebar brand button renders BrandWordmark — a single
//     decorative aria-hidden SVG (dsh-client-ui-primitives). Hide the SVG,
//     paint "arxa" via ::before. Class names are hash-prefixed
//     ("hHd-Xa_brand"), so attribute-contains selectors target the stable
//     suffix. Same treatment for the boot screen's "HARNESS" text card.
//  3. Tab identity: title + favicon. The app captures the base title at
//     first render, after client plugins load, so writing early sticks.
window.__ModuleLoader__.load({
  id: 'arxa-brand',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement

    const MOSS = `
body, body[data-ds-dark-theme] {
  --dsw-static-blue-50: color-mix(in oklab, #C56975 8%, white);
  --dsw-static-blue-50p: color-mix(in oklab, #C56975 9%, white);
  --dsw-static-blue-75: color-mix(in oklab, #C56975 12%, white);
  --dsw-static-blue-100: color-mix(in oklab, #C56975 15%, white);
  --dsw-static-blue-300: color-mix(in oklab, #C56975 40%, white);
  --dsw-static-blue-400: #BC757D;
  --dsw-static-blue-450: color-mix(in oklab, #C56975 90%, white);
  --dsw-static-blue-500: #C56975;
  --dsw-static-blue-600: color-mix(in oklab, #C56975 72%, black);
  --dsw-static-blue-800: color-mix(in oklab, #C56975 42%, black);
  --dsw-static-blue-900: color-mix(in oklab, #C56975 30%, black);
  --dsw-static-blue-950: color-mix(in oklab, #C56975 24%, black);
  --dsw-static-deepseek-50: color-mix(in oklab, #C56975 8%, white);
  --dsw-static-deepseek-100: color-mix(in oklab, #C56975 15%, white);
  --dsw-static-deepseek-200: color-mix(in oklab, #C56975 24%, white);
  --dsw-static-deepseek-300: color-mix(in oklab, #C56975 40%, white);
  --dsw-static-deepseek-400: #BC757D;
  --dsw-static-deepseek-450: color-mix(in oklab, #C56975 90%, white);
  --dsw-static-deepseek-500: #C56975;
  --dsw-static-deepseek-600: color-mix(in oklab, #C56975 72%, black);
  --dsw-static-deepseek-800: color-mix(in oklab, #C56975 42%, black);
  --dsw-static-deepseek-900: color-mix(in oklab, #C56975 30%, black);
  /* The page's ambient cast: every background alias resolves through the
     neutral-BLUISH ramp (bg-base in dark = bluish-1000 rgb(15,17,21)), which
     reads as a blue haze behind the hero text. Same values, cast flipped to
     moss — green is the max channel, luminance kept. */
  --dsw-static-neutral-bluish-00: color-mix(in oklab, #C56975 10%, rgb(254, 254, 254));
  --dsw-static-neutral-bluish-50: color-mix(in oklab, #C56975 10%, rgb(250, 250, 250));
  --dsw-static-neutral-bluish-60: color-mix(in oklab, #C56975 10%, rgb(245, 245, 245));
  --dsw-static-neutral-bluish-75: color-mix(in oklab, #C56975 10%, rgb(241, 241, 241));
  --dsw-static-neutral-bluish-100: color-mix(in oklab, #C56975 10%, rgb(238, 238, 238));
  --dsw-static-neutral-bluish-150: color-mix(in oklab, #C56975 10%, rgb(236, 236, 236));
  --dsw-static-neutral-bluish-200: color-mix(in oklab, #C56975 10%, rgb(230, 230, 230));
  --dsw-static-neutral-bluish-300: color-mix(in oklab, #C56975 10%, rgb(209, 209, 209));
  --dsw-static-neutral-bluish-400: color-mix(in oklab, #C56975 10%, rgb(177, 177, 177));
  --dsw-static-neutral-bluish-500: color-mix(in oklab, #C56975 10%, rgb(156, 156, 156));
  --dsw-static-neutral-bluish-600: color-mix(in oklab, #C56975 10%, rgb(132, 132, 132));
  --dsw-static-neutral-bluish-700: color-mix(in oklab, #C56975 10%, rgb(100, 100, 100));
  --dsw-static-neutral-bluish-750: color-mix(in oklab, #C56975 10%, rgb(68, 68, 68));
  --dsw-static-neutral-bluish-800: color-mix(in oklab, #C56975 10%, rgb(53, 53, 53));
  --dsw-static-neutral-bluish-850: color-mix(in oklab, #C56975 10%, rgb(44, 44, 44));
  --dsw-static-neutral-bluish-875: color-mix(in oklab, #C56975 10%, rgb(35, 35, 35));
  --dsw-static-neutral-bluish-900: color-mix(in oklab, #C56975 10%, rgb(27, 27, 27));
  --dsw-static-neutral-bluish-950: color-mix(in oklab, #C56975 10%, rgb(21, 21, 21));
  --dsw-static-neutral-bluish-1000: color-mix(in oklab, #C56975 10%, rgb(16, 16, 16));
}
/* dsh 0.1.1-rc.2 restructured the sidebar brand button from ONE element
   holding a single SVG into FOUR nested ones:
       button._brand > span._brandIdentity > (span._brandMark + span._brandName)
   The old class-contains selector on the bare _brand token is a SUBSTRING
   match, so it hit all four and painted "arxa"+"studio" once per element,
   stacking into the mangled "arxaarxa arxa...tstlid" header. The _brand token
   is a PREFIX of its own children tokens — never target a class token that
   prefixes a sibling token. The child-SVG rule also stopped matching: the mark
   is DIV-wrapped now, not a direct child SVG. So: target the leaf that carries
   the wordmark text, and repaint the marks beside it.
   Brand marks: since dsh 0.1.2-rc.1 the expanded header (_brandMark) AND the
   collapsed rail (_railMark) both render the sidebar.brand.mark slot
   (dsh-client-ui-sidebar README, "Brand and New Session"), which ArxaBrandMark
   below fills with a masked, accent-tinted span. Do NOT mask these containers
   as well: a masked child inside a masked parent paints NOTHING in WKWebView
   (2026-09-05, blank top-left corner while every computed style looked right).
   The svg hide stays only as a belt for the unfilled-slot fallback whale. */
[class*="_brandMark"] svg, [class*="_railMark"] svg { display: none !important; }
[class*="_brandName"] > * { display: none !important; }
[class*="_brandName"]::before {
  content: "arxa";
  font: 700 21px/1 ui-sans-serif, system-ui, sans-serif;
  letter-spacing: 0.03em;
  color: var(--dsw-alias-label-primary, #e8e8e8);
}
[class*="_brandName"]::after {
  content: "studio";
  font: 400 21px/1 ui-sans-serif, system-ui, sans-serif;
  letter-spacing: 0.03em;
  /* No margin here. _brandName is display:flex with gap:6px, so ::before and
     ::after are flex ITEMS and the gap already separates them; the old
     margin-left stacked on top of it (6px gap + 6.72px margin = ~13px) and
     read as a broken word space. rc.7 painted these into an inline box where
     no gap applied, which is why the margin was needed then and is wrong now. */
  color: var(--dsw-static-deepseek-400, #BC757D);
}
[class*="_previewBadge"] { display: none !important; }
/* The last stale cyan: native focus rings default to the platform blue
   (the settings modal autofocuses its X — every shot showed it). Tint them
   to the accent; the business-primary alias is contrast-SOLVED for exactly
   this non-text use (SC 1.4.11 rings/marks, one of the palette contract's
   eight pairs). Color only — width/offset stay native. */
:focus-visible { outline-color: var(--dsw-alias-state-business-primary); }
/* Hero lockup: the fishHitbox span wraps the brand.mark slot (FishLogo
   fallback). Hide the fallback svg and paint the arxa glyph in its place —
   the same accent-tinted mask treatment as the sidebar marks, so it follows
   accent rewrites. The mark beside the headline is dsh's brand.mark seat. */
[class*="_fishHitbox"] svg { display: none !important; }
[class*="_fishHitbox"]::before {
  content: "";
  display: block;
  width: 30px; height: 30px;
  background: var(--dsw-static-deepseek-450, #C56975);
  -webkit-mask: var(--arxa-brand-mark-white) center / contain no-repeat;
          mask: var(--arxa-brand-mark-white) center / contain no-repeat;
}
/* HeroGlow: the blurred backdrop ellipse behind the composer is a hardcoded
   figma blue (#6187D8 @ .08) on the SVG, not a token. CSS fill beats the
   presentation attribute. Same for the reference chips' #6187d838 wash. */
[class*="_heroGlow"] ellipse { fill: var(--dsw-static-deepseek-450, #C56975); }
[class*="_refChip"] { background: color-mix(in srgb, var(--dsw-static-deepseek-450, #C56975) 22%, transparent) !important; }
`

    // Real brand mark (desktop/arxa-brand-logo.svg), inlined so the tab icon
    // matches the app. Palette-fed (the remnant sweep, 2026-09-11): rebuilt
    // from the LIVE painted ramp — theme-accent sets the stops inline on
    // <body>, so top=500, bottom=800, glyph=400 speak the app's own accent
    // language. Defaults = Mystic Evening SOLVED (engine-verified).
    // ponytail: same-tab picks refresh on tab refocus / next storage event,
    // not instantly — good enough for a tab icon.
    const FAVICON_DEFAULTS = ['#C56975', '#391A1E', '#BC757D'] // top, bottom, glyph
    function faviconSvg(top, bottom, glyph) {
      return 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" fill="none">'
        + '<path d="M391.437 195.736C445.636 104.088 578.25 104.088 632.448 195.736L922.178 685.662C977.368 778.988 910.095 896.926 801.672 896.926H222.214C113.791 896.926 46.518 778.988 101.708 685.662L391.437 195.736Z" fill="url(#g)"/>'
        + '<path d="M381.907 718.494L314.406 832.413H272.492C208.932 832.413 165.181 775.677 173.312 718.491L381.907 718.494ZM850.647 718.502C858.771 775.684 815.022 832.413 751.466 832.413H439.174L506.675 718.496L850.647 718.502ZM797.076 613.222L569.057 613.218L683.065 420.814L797.076 613.222ZM425.948 277.272C464.679 211.908 559.279 211.907 598.01 277.271L620.681 315.531L444.29 613.215L226.887 613.212L425.948 277.272Z" fill="' + glyph + '"/>'
        + '<defs><linearGradient id="g" x1="511.943" y1="127" x2="511.943" y2="896.926" gradientUnits="userSpaceOnUse">'
        + '<stop stop-color="' + top + '"/><stop offset="1" stop-color="' + bottom + '"/>'
        + '</linearGradient></defs></svg>')
    }
    // The 500 stop is always a PLAIN hex (paintRamps and the MOSS default
    // both set it so), read straight off the computed style; the derived
    // stops are COMPUTED with the ONE engine (import — same module the
    // host serves) using the ramp's own formulas (400 = 78% white,
    // 800 = 42% black over the 500 anchor). A CSSOM var() probe does NOT
    // substitute in WKWebView-class engines (lens-proven), so probing is
    // out; these formulas are exactly what the ramp paints.
    function refreshFavicon(icon) {
      const cs = getComputedStyle(document.body)
      const top = (cs.getPropertyValue('--dsw-static-deepseek-500').trim().match(/^#[0-9a-fA-F]{6}$/) || [])[0] || FAVICON_DEFAULTS[0]
      icon.href = faviconSvg(top, FAVICON_DEFAULTS[1], FAVICON_DEFAULTS[2])
      import('/__arxa/theme-accent/contrast.js').then((E) => {
        icon.href = faviconSvg(top, E.mixOklab(top, 42, '#000000'), E.mixOklab(top, 78, '#FFFFFF'))
      }).catch(() => { /* engine unreachable — the defaults stay */ })
    }

    // Monochrome variant for the collapsed rail: glyph path only, solid
    // white — the badge fill would read as a blank triangle at rail size.
    const MARK_WHITE = 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" fill="none">'
      + '<path d="M381.907 718.494L314.406 832.413H272.492C208.932 832.413 165.181 775.677 173.312 718.491L381.907 718.494ZM850.647 718.502C858.771 775.684 815.022 832.413 751.466 832.413H439.174L506.675 718.496L850.647 718.502ZM797.076 613.222L569.057 613.218L683.065 420.814L797.076 613.222ZM425.948 277.272C464.679 211.908 559.279 211.907 598.01 277.271L620.681 315.531L444.29 613.215L226.887 613.212L425.948 277.272Z" fill="#FFFFFF"/>'
      + '</svg>')

    // dsh 0.1.2-rc.1 moved the sidebar mark and wordmark into slots
    // (`sidebar.brand.mark` / `sidebar.brand.name`) and ships
    // dsh-client-ui-brand-official to fill them with its own artwork — an
    // element the class-suffix CSS above never sees, so it painted over the
    // arxa mark. Fill the slots ourselves (that plugin is disabled in the
    // profile). Same mask + background-color treatment, so it re-tints live.
    function ArxaBrandMark ({ size = 24 } = {}) {
      return h('span', {
        'aria-hidden': 'true',
        className: 'arxa-brand-slot-mark',
        style: {
          display: 'inline-block', width: size, height: size, flex: '0 0 auto',
          background: 'var(--dsw-static-deepseek-450, #C56975)',
          WebkitMask: 'var(--arxa-brand-mark-white) center / contain no-repeat',
          mask: 'var(--arxa-brand-mark-white) center / contain no-repeat',
        },
      })
    }
    function ArxaBrandName () {
      return h('span', { className: 'arxa-brand-slot-name', style: { display: 'inline-flex', gap: 6, alignItems: 'baseline' } },
        h('span', { style: { font: '700 21px/1 ui-sans-serif, system-ui, sans-serif', letterSpacing: '0.03em', color: 'var(--dsw-alias-label-primary, #e8e8e8)' } }, 'arxa'),
        h('span', { style: { font: '400 21px/1 ui-sans-serif, system-ui, sans-serif', letterSpacing: '0.03em', color: 'var(--dsw-static-deepseek-400, #BC757D)' } }, 'studio'))
    }

    function apply(ctx) {
      // Slots first: the mark seat is the thing the user sees at every boot.
      // The register API is the same one dsh-client-ui-brand-official uses.
      // Shape is byte-for-byte what dsh-client-ui-brand-official does: a
      // declaration-aware registration set; bare register() outside it is
      // not a supported seam.
      try {
        ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.inject('sidebar.brand.name', function* () {
          yield ctx.slots.register({ name: 'sidebar.brand.mark' }, ArxaBrandMark)
          yield ctx.slots.register({ name: 'sidebar.brand.name' }, ArxaBrandName)
        }))
      } catch (err) {
        console.warn('[arxa-brand] slot registration failed; CSS fallback only', err)
      }

      const style = document.createElement('style')
      style.dataset.arxaBrand = ''
      style.textContent = MOSS
        + '\nbody{--arxa-brand-mark-white:url("' + MARK_WHITE + '")}'
      document.head.appendChild(style)

      // rc.2 writes the base title AFTER client plugins load, so the one-shot
      // assignment this used to be was silently overwritten back to "DeepSeek
      // Harness". Re-assert it the same way the headline is re-asserted; the
      // inequality guard keeps the observer from feeding itself.
      const TITLE = 'arxa studio'
      const swapTitle = () => { if (document.title !== TITLE) document.title = TITLE }
      swapTitle()
      new MutationObserver(swapTitle).observe(document.head,
        { childList: true, subtree: true, characterData: true })
      let icon = document.querySelector('link[rel="icon"]')
      if (!icon) {
        icon = document.createElement('link')
        icon.rel = 'icon'
        document.head.appendChild(icon)
      }
      icon.type = 'image/svg+xml'
      // Palette-following favicon: refresh when another tab picks (storage)
      // and on refocus (covers same-tab picks made while hidden).
      const refreshIcon = () => refreshFavicon(icon)
      refreshIcon()
      window.addEventListener('storage', (e) => {
        if (e.key === 'arxa.themePalette') refreshIcon()
      })
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshIcon()
      })

      // Hero headline ("Into the Unknown") comes from a locale dictionary
      // whose namespace+locale is already registered — register() throws on
      // duplicates, so there is no override seam. Swap the text in the DOM
      // instead; the observer re-applies after React re-renders. The
      // textContent guard keeps the observer from feeding itself.
      const HEADLINE = 'Flowing High'
      const swapHeadline = () => {
        for (const el of document.querySelectorAll('[class*="_headlineText"]')) {
          if (el.textContent !== HEADLINE) el.textContent = HEADLINE
        }
      }
      swapHeadline()
      new MutationObserver(swapHeadline)
        .observe(document.body, { childList: true, subtree: true })
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
