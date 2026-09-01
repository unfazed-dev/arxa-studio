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
window.__ModuleLoader__.load({
  id: 'arxa-personalisation',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement

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
      'mask:' + PALETTE_MASK + ' center/contain no-repeat}'

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

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register({
          name: 'settings.section',
          id: 'personalisation',
          // Nav position 4: general 0, models 10, plugins 15, agent-presets 20.
          order: 18,
          label: 'Personalisation',
          children: {
            'settings.personalisation.item': { kind: 'list', scope: 'root' },
          },
        }, PersonalisationSection))
    }
    const inject = ['slots']

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
