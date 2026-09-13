// Browser half of arxa-personalisation. Hand-written in the __ModuleLoader__
// factory shape every dsh client bundle uses (same as arxa-theme-accent).
//
// The Settings > Personalisation tab (0.1.0, user request): the Background
// group had outgrown General, so every look-and-feel row moves to a dedicated
// 4th settings section — nav order 18, between Plugins (15) and Agent
// presets (20). One `settings.section` registration declares the child slot
// `settings.personalisation.item` and renders it exactly like the General
// section renders `settings.general.item` (the shell's SettingsPanel mounts
// whichever section the nav selects; rows arrive through the child slot).
// The ROW OWNERS retarget their registrations: Accent + Editor font
// (arxa-theme-accent, orders 0/10) and the whole Background group
// (arxa-prism, order 20). General keeps behavior rows (Enter behavior,
// Browser session, Pair a device).
//
// The nav ICON for a new section id falls back to the settings gear — the
// shell's navIcon() hardcodes glyphs by id (models/agent-presets/plugins)
// and a second gear next to General's is not harmonious. Swapped to a
// palette glyph in PURE CSS below (no DOM mutation — React owns the nav
// buttons and re-renders them on every tab click, so a replaced svg node
// would be fought by reconciliation). The selector pins the 4th nav button:
// section orders 0/10/15/18/20 make Personalisation 4th BY DESIGN; if a
// future composition adds a section the glyph simply lands on the wrong tab
// (visible, harmless) until the nth-of-type is adjusted.
//
// 0.2.0 (2026-09-12, operator): the Appearance row MOVES here from General,
// to the top (order -10, above the Palette row's 0); 0.2.1 follows with the
// Font size row as the THIRD row (order 5, below Palette, above Editor
// font). The rows are dsh's own features (ui-theme registers ids
// 'appearance'/'font-size' into settings.general.item); the list-slot law
// says same id at a LOWER priority shadows the shipped entry (lowest
// renders) — so this plugin registers the same ids in General at
// priority -1 rendering null (the rows leave General cleanly, no CSS hacks,
// no React fights) and registers the real rows here, speaking ui-theme's OWN
// published contract: reads via theme.getTheme(), writes via
// theme.setTheme(id)/setFontSize(px), continuous sync via the
// 'theme/change' event. Both rows are ui-theme's verbatim module CSS
// recipes + its own icons. 0.3.0 (task 8): the tab speaks through the
// arxa-locale service like every other arxa surface — `locale: NS` on the
// registrations gives the components the bound t (the stock AppearanceRow's
// own composed-props contract), en is the source set and pl/fr carry the
// same keys (parity gate: plugins/locale/selftest.parity.mjs).
window.__ModuleLoader__.load({
  id: 'arxa-personalisation',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement
    const P = require('@deepseek-ai/dsh-client-ui-primitives')

    // The arxa-locale namespace this plugin owns (task 8's tab-wide pass).
    // Product terms kept verbatim per CONTEXT.md; 'px' is a unit, untranslated.
    const NS = 'arxa-personalisation'
    const DICT = {
      en: {
        'section.title': 'Personalisation',
        'appearance.title': 'Appearance',
        'appearance.light': 'Light',
        'appearance.dark': 'Dark',
        'appearance.system': 'System',
        'font.title': 'Font size',
        'font.desc': 'Only affects conversation content',
        'font.increase': 'Increase font size',
        'font.decrease': 'Decrease font size',
      },
      pl: {
        'section.title': 'Personalizacja',
        'appearance.title': 'Wygląd',
        'appearance.light': 'Jasny',
        'appearance.dark': 'Ciemny',
        'appearance.system': 'Systemowy',
        'font.title': 'Rozmiar czcionki',
        'font.desc': 'Dotyczy tylko treści rozmowy',
        'font.increase': 'Zwiększ rozmiar czcionki',
        'font.decrease': 'Zmniejsz rozmiar czcionki',
      },
      fr: {
        'section.title': 'Personnalisation',
        'appearance.title': 'Apparence',
        'appearance.light': 'Clair',
        'appearance.dark': 'Sombre',
        'appearance.system': 'Système',
        'font.title': 'Taille de la police',
        'font.desc': 'Concerne uniquement le contenu des conversations',
        'font.increase': 'Augmenter la taille de la police',
        'font.decrease': 'Réduire la taille de la police',
      },
    }

    // Artist palette: outer ring, three paint dabs, thumb hole. Mask image —
    // alpha only, painted with background:currentColor so it inherits the
    // nav cell's label color exactly like the shell's svg icons.
    const PALETTE_MASK =
      'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 16 16\'%3E' +
      '%3Ccircle cx=\'8\' cy=\'8\' r=\'6.3\' fill=\'none\' stroke=\'black\' stroke-width=\'1.4\'/%3E' +
      '%3Ccircle cx=\'5.7\' cy=\'6.3\' r=\'1.15\'/%3E' +
      '%3Ccircle cx=\'8.7\' cy=\'5.1\' r=\'1.15\'/%3E' +
      '%3Ccircle cx=\'10.8\' cy=\'7.6\' r=\'1.15\'/%3E' +
      '%3Ccircle cx=\'6.6\' cy=\'10.1\' r=\'1.5\' fill=\'none\' stroke=\'black\' stroke-width=\'1.2\'/%3E' +
      '%3C/svg%3E")'

    const cssText =
      // Section chrome: the exact two rules the General section's css-module
      // ships (flex column; the last slot item drops its trailing border so
      // the column doesn't end on a hairline). data-slot names the render site.
      '.arxaPers_section{flex-direction:column;width:100%;display:flex}' +
      '.arxaPers_section>[data-slot="settings.personalisation.item"]>:last-child{border-bottom:none}' +
      // Nav icon harmonisation: hide the fallback gear on the 4th settings
      // nav button (Personalisation) and paint the palette glyph via ::before
      // (a flex item in the same slot the svg occupied).
      'div[role="dialog"] nav [class*="navList"]>button:nth-of-type(4) svg{display:none}' +
      'div[role="dialog"] nav [class*="navList"]>button:nth-of-type(4)::before{' +
      'content:"";width:16px;height:16px;flex:none;background:currentColor;' +
      '-webkit-mask:' + PALETTE_MASK + ' center/contain no-repeat;' +
      'mask:' + PALETTE_MASK + ' center/contain no-repeat}' +
      // The Appearance cubes — ui-theme's own AppearanceRow.module.css recipe,
      // verbatim, under arxaPers_ names (moved here 0.2.0; same UI language).
      '.arxaPers_appearGroup{border-bottom:.5px solid var(--dsw-alias-border-l2);' +
      'flex-direction:column;gap:8px;padding:16px 0;display:flex}' +
      '.arxaPers_appearTitle{color:var(--dsw-alias-label-primary);font-size:14px;' +
      'font-weight:400;line-height:22px}' +
      '.arxaPers_cubeRow{flex-wrap:wrap;align-items:stretch;gap:8px;display:flex}' +
      '.arxaPers_cube{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);' +
      'font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;' +
      'border-radius:20px;flex-direction:column;flex:180px;justify-content:center;' +
      'align-items:center;gap:4px;padding:20px 32px;font-size:14px;line-height:22px;display:flex}' +
      '.arxaPers_cube:hover:not(.arxaPers_cubeSel){background:var(--dsw-alias-interactive-bg-hover)}' +
      '.arxaPers_cubeSel{background:var(--dsw-alias-bg-module-platform);' +
      'border-color:var(--dsw-static-neutral-bluish-400)}' +
      // The Font size row — ui-theme's own FontSizeRow.module.css recipe,
      // verbatim, under arxaFs_ names (moved here 0.2.1, third row).
      '.arxaFs_row{border-bottom:.5px solid var(--dsw-alias-border-l2);' +
      'align-items:center;gap:8px;padding:16px 0;display:flex}' +
      '.arxaFs_rowText{flex-direction:column;flex:1;gap:4px;min-width:0;' +
      'padding-right:48px;display:flex}' +
      '.arxaFs_title{color:var(--dsw-alias-label-primary);font-size:14px;' +
      'font-weight:400;line-height:22px}' +
      '.arxaFs_desc{color:var(--dsw-alias-label-tertiary);font-size:12px;' +
      'font-weight:400;line-height:18px}' +
      '.arxaFs_control{align-items:center;gap:8px;display:inline-flex}' +
      '.arxaFs_stepper{background:var(--dsw-alias-bg-module-platform);' +
      'border-radius:18px;justify-content:center;align-items:center;min-width:72px;' +
      'height:36px;display:inline-flex;position:relative}' +
      '.arxaFs_value{text-align:center;font-variant-numeric:tabular-nums;min-width:18px;' +
      'color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}' +
      '.arxaFs_unit{color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px}' +
      '.arxaFs_arrows{opacity:0;flex-direction:column;gap:2px;display:flex;' +
      'position:absolute;right:8px}' +
      '.arxaFs_stepper:hover .arxaFs_arrows,.arxaFs_stepper:focus-within .arxaFs_arrows{opacity:1}' +
      '.arxaFs_arrow{background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 75%, transparent);' +
      'width:17px;height:12px;color:var(--dsw-alias-label-primary);cursor:pointer;' +
      'border:none;border-radius:3px;justify-content:center;align-items:center;' +
      'padding:0;display:inline-flex}' +
      '.arxaFs_arrow:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1)}' +
      '.arxaFs_arrow:disabled{color:var(--dsw-alias-label-caption);cursor:default}'

    // ── the Appearance row (moved from General, 0.2.0) ──────────────────────
    // Cubes + icons + recipe are ui-theme's own; the service contract is its
    // published one: getTheme() reads, setTheme(id) writes, 'theme/change'
    // syncs (snapshot carries preference/revision/fontSize). The service is
    // read AT RENDER TIME — ui-theme may provide it after our apply (lens-
    // proven live 2026-09-12: an apply-time read left the row rendering null
    // forever; the modal opens long after boot, when it always exists).
    let pluginCtx = null
    const APPEARANCE = [
      { id: 'light', labelKey: 'appearance.light', Icon: P.IconLightOutline16 },
      { id: 'dark', labelKey: 'appearance.dark', Icon: P.IconDarkOutline16 },
      { id: 'system', labelKey: 'appearance.system', Icon: P.IconFollowsystemOutline16 },
    ]

    function AppearanceRow({ t }) {
      const theme = pluginCtx ? pluginCtx.get('theme') : null
      if (!theme) return null // ui-theme absent — nothing to steer
      const [pref, setPref] = React.useState(() => theme.getTheme().preference)
      React.useEffect(() => pluginCtx.on('theme/change', (snapshot) => setPref(snapshot.preference)), [])
      return h('div', { className: 'arxaPers_appearGroup' },
        h('div', { className: 'arxaPers_appearTitle' }, t('appearance.title')),
        h('div', { className: 'arxaPers_cubeRow' },
          APPEARANCE.map(({ id, labelKey, Icon }) => h('button', {
            key: id,
            type: 'button',
            'aria-pressed': pref === id,
            className: 'arxaPers_cube' + (pref === id ? ' arxaPers_cubeSel' : ''),
            onClick: () => theme.setTheme(id),
          }, h(Icon, null), t(labelKey)))))
    }

    // The Font size row (moved from General, 0.2.1, THIRD row — below the
    // Palette, above Editor font). Same published service contract as the
    // Appearance row; bounds 12..17 px are the runtime's own law.
    function FontSizeRow({ t }) {
      const theme = pluginCtx ? pluginCtx.get('theme') : null
      if (!theme) return null // ui-theme absent — nothing to steer
      const [fontSize, setFontSizeState] = React.useState(() => theme.getTheme().fontSize)
      React.useEffect(() => pluginCtx.on('theme/change', (snapshot) => setFontSizeState(snapshot.fontSize)), [])
      return h('div', { className: 'arxaFs_row' },
        h('div', { className: 'arxaFs_rowText' },
          h('div', { className: 'arxaFs_title' }, t('font.title')),
          h('div', { className: 'arxaFs_desc' }, t('font.desc'))),
        h('div', { className: 'arxaFs_control' },
          h('div', { className: 'arxaFs_stepper' },
            h('span', { className: 'arxaFs_value' }, fontSize),
            h('span', { className: 'arxaFs_arrows' },
              h('button', {
                type: 'button',
                className: 'arxaFs_arrow',
                'aria-label': t('font.increase'),
                disabled: fontSize >= 17,
                onClick: () => theme.setFontSize(fontSize + 1),
              }, h(P.IconChevronUpOutline14, { size: 9 })),
              h('button', {
                type: 'button',
                className: 'arxaFs_arrow',
                'aria-label': t('font.decrease'),
                disabled: fontSize <= 12,
                onClick: () => theme.setFontSize(fontSize - 1),
              }, h(P.IconChevronDownOutline14, { size: 9 })))),
          h('span', { className: 'arxaFs_unit' }, 'px')))
    }

    // The section: one column rendering the item contributions, mirroring
    // ui-settings-general's GeneralSection (same owner props: nothing but
    // the slot runtime's renderSlot).
    function PersonalisationSection({ renderSlot }) {
      return h('div', { className: 'arxaPers_section' },
        renderSlot('settings.personalisation.item', {}))
    }

    function apply(ctx) {
      const tag = document.createElement('style')
      tag.dataset.pluginCss = 'arxa-personalisation/section.css'
      tag.textContent = cssText
      document.head.appendChild(tag)

      // The theme service (provided by ui-theme) is read at render time in
      // AppearanceRow — it may not exist yet when this plugin applies.
      pluginCtx = ctx

      // The tab's copy rides the arxa-locale service (0.3.0, task 8). The
      // bound t serves the nav label through the registration's label
      // function — the stock General section's own pattern (the settings
      // shell re-resolves section labels when the locale revision moves).
      ctx.effect(() => ctx.locale.register(NS, { en: DICT.en, pl: DICT.pl, fr: DICT.fr }), 'arxa-personalisation: dictionary')
      const t = ctx.locale.bind(NS)

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register({
          name: 'settings.section',
          id: 'personalisation',
          // Nav position 4: general 0, models 10, plugins 15, agent-presets 20.
          order: 18,
          label: () => t('section.title'),
          locale: NS,
          children: {
            'settings.personalisation.item': { kind: 'list', scope: 'root' },
          },
        }, PersonalisationSection))
      // The move (0.2.0): the Appearance row lives HERE now, at the top
      // (order -10 — above the Palette row's 0), and its General cell is
      // replaced by nothing (same shipped id, per the slot contract).
      ctx.slots.inject('settings.personalisation.item', () =>
        ctx.slots.register({
          name: 'settings.personalisation.item',
          id: 'appearance',
          order: -10,
          locale: NS,
        }, AppearanceRow))
      // The move (0.2.1): Font size follows — the THIRD row (order 5, below
      // the Palette row's 0, above Editor font's 10), its General cell
      // shadowed by nothing the same way.
      ctx.slots.inject('settings.personalisation.item', () =>
        ctx.slots.register({
          name: 'settings.personalisation.item',
          id: 'font-size',
          order: 5,
          locale: NS,
        }, FontSizeRow))
      ctx.slots.inject('settings.general.item', () =>
        ctx.slots.register({
          name: 'settings.general.item',
          id: 'appearance',
          order: 9,
          // priority ≠ order: same id at the same priority throws; a LOWER
          // priority shadows the shipped row (lowest renders — the slot
          // runtime's own law, lens-proven live 2026-09-12).
          priority: -1,
        }, () => null))
      ctx.slots.inject('settings.general.item', () =>
        ctx.slots.register({
          name: 'settings.general.item',
          id: 'font-size',
          order: 10,
          priority: -1,
        }, () => null))
    }
    const inject = ['slots', 'locale']

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
