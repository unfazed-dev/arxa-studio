// Browser half of arxa-design-panel (H4, viewer-first). Hand-written in the
// __ModuleLoader__ factory shape every dsh client bundle uses (the factory
// declares its own module/exports and returns module.exports — verified
// against dsh-client-runtime/lib/client.js:1-6).
//
// Registers a right-docked panel into `shell.overlay` — the additive list
// slot dsh-client-ui-layout declares for surfaces floating over the app
// (.overlayLayer children opt into pointer events automatically). The
// `details` slot is deliberately NOT used: it is occupied by the
// conversation DetailsPanel and registering there replaces it.
//
// The panel iframes a live `appbox design serve` and renders the viewport
// ladder (390×844 / 744×1133 / 1280×832) as rung buttons; the iframe keeps
// the rung's true pixel size and is CSS-scaled to fit the dock. Live reload
// comes from the design server itself — the panel only remounts the iframe
// (key bump) on demand. Direct manipulation (drag → engine `design patch`
// verb) is deferred until that verb exists, per H4.
window.__ModuleLoader__.load({
  id: 'arxa-design-panel',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    let React = require('react')

    const RUNGS = [
      { label: 'mobile', w: 390, h: 844 },
      { label: 'tablet', w: 744, h: 1133 },
      { label: 'desktop', w: 1280, h: 832 },
    ]
    const DOCK_WIDTH = 430
    const DEFAULT_URL = 'http://127.0.0.1:4319/'
    const h = React.createElement

    function DesignPanel() {
      const [open, setOpen] = React.useState(false)
      const [rung, setRung] = React.useState(0)
      const [url, setUrl] = React.useState(DEFAULT_URL)
      const [draft, setDraft] = React.useState(DEFAULT_URL)
      const [epoch, setEpoch] = React.useState(0)

      if (!open) {
        return h('button', {
          onClick: () => setOpen(true),
          title: 'arxa design panel',
          style: {
            position: 'fixed', right: 12, bottom: 12, zIndex: 30,
            padding: '6px 12px', borderRadius: 16, border: '1px solid #888',
            background: '#1b1b1f', color: '#eee', cursor: 'pointer',
          },
        }, 'design')
      }

      const r = RUNGS[rung]
      const scale = Math.min(1, (DOCK_WIDTH - 24) / r.w)
      return h('div', {
        style: {
          position: 'fixed', right: 0, top: 0, bottom: 0, width: DOCK_WIDTH,
          zIndex: 30, display: 'flex', flexDirection: 'column',
          background: '#141417', borderLeft: '1px solid #333', color: '#ddd',
          font: '12px system-ui',
        },
      },
        h('div', { style: { display: 'flex', gap: 6, padding: 8, alignItems: 'center' } },
          ...RUNGS.map((x, i) => h('button', {
            key: x.label,
            onClick: () => setRung(i),
            style: {
              padding: '4px 8px', cursor: 'pointer', borderRadius: 4,
              border: '1px solid #555',
              background: i === rung ? '#3b5bdb' : '#222', color: '#eee',
            },
          }, x.label + ' ' + x.w + '×' + x.h)),
          h('button', {
            onClick: () => setEpoch((e) => e + 1),
            title: 'remount the iframe',
            style: { marginLeft: 'auto', padding: '4px 8px', cursor: 'pointer' },
          }, '⟳'),
          h('button', {
            onClick: () => setOpen(false),
            style: { padding: '4px 8px', cursor: 'pointer' },
          }, '×')),
        h('form', {
          onSubmit: (e) => { e.preventDefault(); setUrl(draft) },
          style: { padding: '0 8px 8px' },
        },
          h('input', {
            value: draft,
            onChange: (e) => setDraft(e.target.value),
            spellCheck: false,
            style: {
              width: '100%', boxSizing: 'border-box', padding: 4,
              background: '#0d0d10', color: '#ddd', border: '1px solid #444',
            },
          })),
        h('div', { style: { flex: 1, overflow: 'auto', padding: '0 12px 12px' } },
          h('div', {
            style: {
              width: r.w * scale, height: r.h * scale,
              overflow: 'hidden', border: '1px solid #333',
            },
          },
            h('iframe', {
              key: epoch + ':' + url + ':' + r.label,
              src: url,
              width: r.w, height: r.h,
              style: {
                border: 0, transform: 'scale(' + scale + ')',
                transformOrigin: 'top left',
              },
            }))))
    }

    function apply(ctx) {
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({
          name: 'shell.overlay',
          id: 'arxa-design-panel',
          order: 100,
        }, DesignPanel))
    }
    const inject = ['slots']

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
