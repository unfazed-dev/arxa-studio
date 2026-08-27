// Browser half of arxa-brand. Hand-written in the __ModuleLoader__ factory
// shape every dsh client bundle uses (same pattern as arxa-design-panel).
//
// Three moves, all CSS/DOM — the frontend dist is a built artifact and is
// never edited:
//  1. Accent: the frontend's accent aliases resolve through the static
//     `--dsw-static-blue-*` and `--dsw-static-deepseek-*` palettes, which
//     the bundle defines on `body` / `body[data-ds-dark-theme]` (NOT :root
//     — a bare :root override is shadowed by inheritance). This stylesheet
//     redefines both ramps to moss green on the same selectors; appended to
//     <head> after the bundle CSS, so it wins by source order.
//  2. Wordmark: the sidebar brand button renders BrandWordmark — a single
//     decorative aria-hidden SVG (dsh-client-ui-primitives). Hide the SVG,
//     paint "arxa" via ::before. Class names are hash-prefixed
//     ("hHd-Xa_brand"), so attribute-contains selectors target the stable
//     suffix. Same treatment for the boot screen's "HARNESS" text card.
//  3. Tab identity: title + favicon. The app captures the base title at
//     first render, after client plugins load, so writing early sticks.
window.__ModuleLoader__.load({
  id: 'arxa-brand',
  factory: () => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const MOSS = `
body, body[data-ds-dark-theme] {
  --dsw-static-blue-50: rgb(244, 247, 240);
  --dsw-static-blue-75: rgb(238, 243, 232);
  --dsw-static-blue-100: rgb(227, 235, 216);
  --dsw-static-blue-300: rgb(178, 198, 148);
  --dsw-static-blue-400: rgb(143, 168, 106);
  --dsw-static-blue-450: rgb(126, 152, 90);
  --dsw-static-blue-500: rgb(110, 136, 76);
  --dsw-static-blue-600: rgb(90, 113, 61);
  --dsw-static-blue-800: rgb(60, 78, 41);
  --dsw-static-blue-900: rgb(44, 58, 30);
  --dsw-static-blue-950: rgb(32, 43, 22);
  --dsw-static-deepseek-50: rgb(243, 246, 238);
  --dsw-static-deepseek-100: rgb(229, 237, 217);
  --dsw-static-deepseek-200: rgb(214, 227, 197);
  --dsw-static-deepseek-300: rgb(186, 204, 158);
  --dsw-static-deepseek-400: rgb(139, 165, 101);
  --dsw-static-deepseek-450: rgb(122, 149, 87);
  --dsw-static-deepseek-500: rgb(106, 133, 74);
  --dsw-static-deepseek-600: rgb(88, 110, 62);
  --dsw-static-deepseek-800: rgb(56, 70, 42);
  --dsw-static-deepseek-900: rgb(42, 52, 33);
  /* The page's ambient cast: every background alias resolves through the
     neutral-BLUISH ramp (bg-base in dark = bluish-1000 rgb(15,17,21)), which
     reads as a blue haze behind the hero text. Same values, cast flipped to
     moss — green is the max channel, luminance kept. */
  --dsw-static-neutral-bluish-00: rgb(254, 255, 252);
  --dsw-static-neutral-bluish-50: rgb(249, 251, 247);
  --dsw-static-neutral-bluish-60: rgb(245, 247, 243);
  --dsw-static-neutral-bluish-75: rgb(241, 245, 238);
  --dsw-static-neutral-bluish-100: rgb(236, 242, 232);
  --dsw-static-neutral-bluish-150: rgb(234, 242, 230);
  --dsw-static-neutral-bluish-200: rgb(227, 238, 222);
  --dsw-static-neutral-bluish-300: rgb(208, 214, 203);
  --dsw-static-neutral-bluish-400: rgb(175, 184, 169);
  --dsw-static-neutral-bluish-500: rgb(153, 166, 147);
  --dsw-static-neutral-bluish-600: rgb(131, 140, 125);
  --dsw-static-neutral-bluish-700: rgb(99, 107, 93);
  --dsw-static-neutral-bluish-750: rgb(68, 74, 63);
  --dsw-static-neutral-bluish-800: rgb(53, 56, 50);
  --dsw-static-neutral-bluish-850: rgb(44, 46, 41);
  --dsw-static-neutral-bluish-875: rgb(35, 37, 33);
  --dsw-static-neutral-bluish-900: rgb(27, 29, 25);
  --dsw-static-neutral-bluish-950: rgb(21, 23, 19);
  --dsw-static-neutral-bluish-1000: rgb(15, 19, 13);
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
   the wordmark text, and hide the mark beside it. */
[class*="_brandMark"] { display: none !important; }
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
  color: var(--dsw-static-deepseek-400, rgb(139, 165, 101));
}
[class*="_fishHitbox"], [class*="_previewBadge"] { display: none !important; }
/* HeroGlow: the blurred backdrop ellipse behind the composer is a hardcoded
   figma blue (#6187D8 @ .08) on the SVG, not a token. CSS fill beats the
   presentation attribute. Same for the reference chips' #6187d838 wash. */
[class*="_heroGlow"] ellipse { fill: rgb(122, 149, 87); }
[class*="_refChip"] { background: color-mix(in srgb, var(--dsw-static-deepseek-450, rgb(122, 149, 87)) 22%, transparent) !important; }
`

    const FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
      + '<rect width="24" height="24" rx="6" fill="rgb(106,133,74)"/>'
      + '<text x="12" y="17.5" font-family="system-ui" font-size="15" font-weight="700" text-anchor="middle" fill="rgb(243,246,238)">a</text>'
      + '</svg>')

    function apply() {
      const style = document.createElement('style')
      style.dataset.arxaBrand = ''
      style.textContent = MOSS
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
      icon.href = FAVICON

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
    exports.inject = []
    return module.exports
  },
})
