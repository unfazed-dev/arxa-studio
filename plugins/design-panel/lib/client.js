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
// the rung's true pixel size and is CSS-scaled to fit the dock. The panel
// remounts the iframe when the design server pushes a `reload` frame on its
// /__events SSE stream (cross-origin — see the effect below for the
// --trusted-origin it requires), and on demand via ⟳. Direct manipulation
// (drag → engine `design patch` verb) is deferred until that verb exists,
// per H4.
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
      const [live, setLive] = React.useState('off')

      // Adopt the configured URL (settings card / arxa-design-panel ns) once,
      // unless the user already typed their own.
      React.useEffect(() => {
        let live = true
        ;(async () => {
          try {
            const { result } = await hostCtx.connection.api.settings.describe({})
            const row = result.ok && result.value.namespaces.find((n) => n.ns === NS)
            if (live && row && row.value?.url && url === DEFAULT_URL) {
              setUrl(row.value.url); setDraft(row.value.url)
            }
          } catch { /* composed default stands */ }
        })()
        return () => { live = false }
      }, [])

      // Live reload. The design server pushes an SSE frame on /__events once a
      // hot reload has settled AND its route table has re-registered, so
      // remounting on it can never land in the 404 window a naive timer would.
      // EventSource reconnects on its own (the server sends `retry: 500`), so
      // there is no retry loop here on purpose.
      //
      // This is a CROSS-ORIGIN subscription — the panel is served from
      // arxa.studio.localhost, the design server from 127.0.0.1 — so that
      // server must be started with:
      //   appbox design serve … --trusted-origin http://arxa.studio.localhost:7891
      // Without it the request is refused 403 and this drops to 'blocked';
      // the ⟳ button still works.
      React.useEffect(() => {
        if (!open) return
        let es
        try { es = new EventSource(new URL('/__events', url).href) } catch { setLive('blocked'); return }
        // EventSource fires onerror for a REFUSED subscription and for every
        // ordinary reconnect alike, and it reconnects after each server hot
        // reload (retry: 500). Without this flag the dot would go grey on the
        // first successful reload and stay grey, reading as "misconfigured"
        // while live reload works perfectly.
        let opened = false
        es.onopen = () => { opened = true; setLive('live') }
        es.addEventListener('reload', () => setEpoch((e) => e + 1))
        es.onerror = () => setLive(opened ? 'reconnecting' : 'blocked')
        return () => es.close()
      }, [open, url])

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
          h('span', {
            title: live === 'live'
              ? 'live reload connected (/__events)'
              : live === 'reconnecting'
                ? 'live reload reconnecting…'
                : 'no live reload — add ' + window.location.origin
                  + ' to ~/.appbox/trusted-origins and restart the design server',
            style: {
              marginLeft: 'auto', width: 8, height: 8, borderRadius: 4,
              background: live === 'live'
                ? '#7a9557'
                : live === 'reconnecting' ? '#8a7a3a' : '#555',
            },
          }),
          h('button', {
            onClick: () => setEpoch((e) => e + 1),
            title: 'remount the iframe',
            style: { padding: '4px 8px', cursor: 'pointer' },
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
        // Still scrolls; just no bar. The design server hides the scrollbars
        // INSIDE the frame (it injects CSS for a framed navigation, which we
        // cannot do from here — the frame is cross-origin); this is the dock's
        // own scroller, which is ours to style.
        h('div', {
          style: {
            flex: 1, overflow: 'auto', padding: '0 12px 12px',
            scrollbarWidth: 'none',
          },
        },
          h('div', {
            style: {
              width: r.w * scale, height: r.h * scale,
              margin: '0 auto',
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

    // Set by apply; the card reaches the connection API through it (slot
    // components render without props we control).
    let hostCtx = null
    const NS = 'arxa-design-panel'

    // The card in Settings → Plugins → Plugin configuration. The tab renders
    // one card per SERVED namespace that a client plugin claims by key in
    // `settings.plugin.item`; the host half serves ours via
    // installSettingsSection. Read via settings.describe, write via
    // settings.update {ns, patch, expectedRevision}.
    function SettingsCard() {
      const [phase, setPhase] = React.useState('loading')
      const [note, setNote] = React.useState('')
      const [revision, setRevision] = React.useState(undefined)
      const [draft, setDraft] = React.useState('')

      React.useEffect(() => {
        let live = true
        ;(async () => {
          try {
            const { result } = await hostCtx.connection.api.settings.describe({})
            if (!result.ok) throw new Error(result.error.message)
            const row = result.value.namespaces.find((n) => n.ns === NS)
            if (!row) throw new Error('namespace not served')
            if (!live) return
            setDraft(row.value?.url ?? '')
            setRevision(row.revision)
            setPhase('ready')
          } catch (e) {
            if (!live) return
            setPhase('error'); setNote(String(e?.message ?? e))
          }
        })()
        return () => { live = false }
      }, [])

      const save = async () => {
        setPhase('saving'); setNote('')
        try {
          const { result } = await hostCtx.connection.api.settings.update({
            ns: NS, patch: { url: draft },
            ...revision === undefined ? {} : { expectedRevision: revision },
          })
          if (!result.ok) throw new Error(result.error.message)
          setRevision(result.value.revision)
          setPhase('ready'); setNote('saved')
        } catch (e) {
          setPhase('ready'); setNote(String(e?.message ?? e))
        }
      }

      return h('li', { style: { listStyle: 'none', padding: '12px 0' } },
        h('div', { style: { fontWeight: 600, marginBottom: 2 } }, 'arxa design panel'),
        h('div', { style: { fontSize: 12, opacity: 0.7, marginBottom: 8 } },
          'Live appbox design server the panel iframes. arxa registers '
          + window.location.origin + ' in ~/.appbox/trusted-origins at boot, '
          + 'which is what lets this panel frame it and subscribe to reloads.'),
        phase === 'loading'
          ? h('div', { style: { fontSize: 12, opacity: 0.7 } }, 'loading…')
          : phase === 'error'
            ? h('div', { style: { fontSize: 12, color: '#c66' } }, note)
            : h('form', {
              onSubmit: (e) => { e.preventDefault(); save() },
              style: { display: 'flex', gap: 8, alignItems: 'center' },
            },
              h('input', {
                value: draft,
                onChange: (e) => setDraft(e.target.value),
                spellCheck: false,
                style: {
                  flex: 1, padding: 6, background: 'transparent',
                  color: 'inherit', border: '1px solid #555', borderRadius: 4,
                },
              }),
              h('button', {
                type: 'submit',
                disabled: phase === 'saving',
                style: { padding: '6px 14px', cursor: 'pointer', borderRadius: 4 },
              }, phase === 'saving' ? 'saving…' : 'Save'),
              note ? h('span', { style: { fontSize: 12, opacity: 0.7 } }, note) : null))
    }

    function apply(ctx) {
      hostCtx = ctx
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({
          name: 'shell.overlay',
          id: 'arxa-design-panel',
          order: 100,
        }, DesignPanel))
      ctx.slots.inject('settings.plugin.item', () =>
        ctx.slots.register({
          name: 'settings.plugin.item',
          id: 'arxa-design-panel',
          key: NS,
          order: 10,
        }, SettingsCard))
    }
    const inject = ['slots', 'connection']

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
