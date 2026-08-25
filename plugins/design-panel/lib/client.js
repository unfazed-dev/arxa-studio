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
// lives in the served page's Design Dial island (Design Mode); this panel
// additionally subscribes to /__dial/events and surfaces 'commit' frames —
// the Author's request for the agent to patch artifact source (locked
// amendment 2026-08-23, decision 2).
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
      // One live document per rung, mounted lazily and then kept alive. An
      // iframe has exactly one scroll offset, so a shared frame can hold at
      // most one rung's place — per-rung scroll is unimplementable without
      // per-rung frames. Verified in Chrome over CDP: a rung scrolled to
      // 600px, hidden behind another and shown again, came back at 600px.
      const [mounted, setMounted] = React.useState({ 0: true })
      const [epochs, setEpochs] = React.useState({})
      const [stale, setStale] = React.useState({})
      // The SSE effect below is created once per (open, url) and would close
      // over a stale `rung`. The ref is what lets a reload frame know which
      // rung is actually on screen when it lands.
      const rungRef = React.useRef(0)
      React.useEffect(() => { rungRef.current = rung }, [rung])

      const show = (i) => {
        setRung(i)
        setMounted((m) => (m[i] ? m : { ...m, [i]: true }))
        // A rung hidden through a reload is showing pre-reload content — a
        // preview that lies. Reload it on the way IN. Do not "simplify" this
        // into reloading every rung when the reload lands: that discards the
        // scroll position of rungs the operator is not looking at, which is
        // the whole point of keeping them alive.
        if (stale[i]) {
          setEpochs((e) => ({ ...e, [i]: (e[i] ?? 0) + 1 }))
          setStale((sx) => { const n = { ...sx }; delete n[i]; return n })
        }
      }
      const [url, setUrl] = React.useState(DEFAULT_URL)
      const [draft, setDraft] = React.useState(DEFAULT_URL)
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
        es.addEventListener('reload', () => {
          const cur = rungRef.current
          setEpochs((e) => ({ ...e, [cur]: (e[cur] ?? 0) + 1 }))
          setStale((sx) => {
            const n = { ...sx }
            RUNGS.forEach((_, i) => { if (i !== cur) n[i] = true })
            return n
          })
        })
        es.onerror = () => setLive(opened ? 'reconnecting' : 'blocked')
        return () => es.close()
      }, [open, url])

      // Selection handoff helpers (rework slice 7, 2026-08-24; snapshot
      // attach 2026-08-25). The pointer line is the text the draft carries;
      // the organized context (styles, law, screenshot) is fetched into the
      // card on frame arrival (see the dial listener above).
      // TEXT: no public composer-prefill API exists in the DSH packages
      // (verified against dsh-client-ui-conversation/attachment contracts —
      // the SessionInput facade that owns the draft is package-private, and
      // the attachment plugin only RENDERS the rail it is handed), so the
      // write uses the native value setter + a bubbling input event — the
      // documented technique for React-controlled textareas — and degrades
      // to the clipboard when no composer is mounted.
      //
      // IMAGE: the same conversation bundle's composer onPaste routes
      // clipboard FILES through its validation path (intakeImages →
      // addImages → the draft image rail), so a constructed DataTransfer
      // carrying the selection PNG, dispatched as a paste on the textarea,
      // lands the snapshot in the rail. Lens-verified live in this studio
      // before wiring (lens_dial_snapshot_probe: blob thumbnail appeared);
      // a clipboard with no text/plain inserts ONLY the image, so the two
      // writes never collide.
      // The COMPOSER, not "a textarea" (2026-08-26 live failure): the
      // studio page carries other textareas — the commit banner's ops
      // box in this very dock, gen-ui cards above the composer — and
      // querySelector('textarea') handed them the compose insert: the
      // card said ✓ while the composer stayed empty. The DSH
      // SessionInput is the one textarea with the semantic data-phase
      // attribute (dsh-client-ui-conversation InputBar sets it on every
      // phase); fall back to the last VISIBLE textarea, else null (the
      // honest inserted:false path).
      const composerTextarea = () => {
        const visible = (t) => !!(t.offsetWidth || t.offsetHeight ||
          t.getClientRects().length)
        const tas = [...document.querySelectorAll('textarea')]
        return tas.filter((t) => t.hasAttribute('data-phase') && visible(t)).pop() ||
          tas.filter(visible).pop() || null
      }
      const pointerLine = (sel, origin) =>
        'design selection #' + (sel.id || '') + ' · ' + (sel.label || 'element') +
        ' · ' + (sel.route || '/') +
        ' · fetch ' + (origin || '') + (sel.fetch || '/__dial/selection/' + (sel.id || '')) +
        ' — edit ONLY this element via the design patch contract; structure is locked.'
      const pasteSnapshot = async (png, id) => {
        try {
          const blob = await (await fetch(png)).blob()
          const file = new File([blob], 'selection-' + (id || 'snapshot') + '.png',
            { type: 'image/png' })
          const dt = new DataTransfer()
          dt.items.add(file)
          const ta = composerTextarea()
          if (!ta) return false
          ta.focus()
          ta.dispatchEvent(new ClipboardEvent('paste',
            { clipboardData: dt, bubbles: true, cancelable: true }))
          return true
        } catch (_) { return false }
      }
      // Returns what LANDED ({text, image}) — the ack and the
      // destination chip both speak from this, never from hope
      // (honest-failure law, 2026-08-26): a studio page with no open
      // composer cannot take the insert, and saying otherwise sends the
      // operator hunting for a line that is not there.
      const insertIntoComposer = async (sel, origin) => {
        const line = pointerLine(sel, origin)
        const ta = composerTextarea()
        let textOk = false
        if (ta) {
          try {
            const setter = Object.getOwnPropertyDescriptor(
              window.HTMLTextAreaElement.prototype, 'value').set
            setter.call(ta, (ta.value ? ta.value.replace(/\s*$/, '\n') : '') + line)
            ta.dispatchEvent(new Event('input', { bubbles: true }))
            ta.focus()
            textOk = true
          } catch (_) { /* fall through to clipboard */ }
        }
        if (!textOk) {
          try { await navigator.clipboard.writeText(line) } catch (_) {}
        }
        // The caller passes the fetched context (the compose handler
        // awaits it before calling); a png-less or expired context
        // simply means pointer-line-only.
        let imgOk = false
        if (sel.png && String(sel.png).startsWith('data:image/')) {
          imgOk = await pasteSnapshot(sel.png, sel.id)
        }
        return { text: textOk, image: imgOk }
      }

      // Design Mode's commit socket (locked amendment 2026-08-23, decision
      // 2): the Author clicks 'Request commit' in the dial island, the
      // design server broadcasts the draft as structured patch ops on
      // /__dial/events, and this banner hands them to the agent — it runs
      // `appbox design patch` per op (tokens go to the token sheet) and
      // clears the draft on success. Same cross-origin rule as /__events:
      // one trusted-origin entry covers both streams.
      const [commitReq, setCommitReq] = React.useState(null)

      // Destination-side confirmation (operator, 2026-08-26): a transient
      // moss chip at the bottom of the studio page + a brief highlight on
      // the composer textarea — where the operator's eyes go next.
      const confirmInsert = (res) => {
        const ta = composerTextarea()
        if (ta && res.text) {
          const prev = ta.style.outline
          ta.style.outline = '2px solid #8ea36a'
          ta.style.outlineOffset = '2px'
          setTimeout(() => { ta.style.outline = prev; ta.style.outlineOffset = '' }, 1400)
        }
        let chip = document.getElementById('arxa-compose-chip')
        if (chip) chip.remove()
        chip = document.createElement('div')
        chip.id = 'arxa-compose-chip'
        chip.textContent = !res.text
          ? '⚠ no studio composer is open — click into a session, then send again'
          : res.image
            ? '✓ pointer line + snapshot inserted into the composer'
            : '✓ pointer line inserted into the composer'
        chip.style.cssText = 'position:fixed;bottom:64px;left:50%;transform:translateX(-50%);' +
          'background:#1c2415;color:#dce8cc;' +
          'border:1px solid ' + (res.text ? '#6e884c' : '#a68a3a') + ';' +
          'font-size:12px;font-weight:600;padding:6px 12px;border-radius:8px;' +
          'z-index:2147483000;pointer-events:none;transition:opacity .4s'
        document.body.appendChild(chip)
        setTimeout(() => { chip.style.opacity = '0' }, 2800)
        setTimeout(() => { chip.remove() }, 3400)
      }

      // The dial event stream is ALWAYS-ON now (operator, 2026-08-26):
      // the floating card's Arxa tab drives the composer from the design
      // iframe, and the insert must land whether or not this panel dock
      // is expanded. The green selection card retired — its markup moved
      // INTO the floating card (tabs: Customise / Arxa) and this side
      // keeps only the machinery: compose → insert → ack.
      React.useEffect(() => {
        let es
        try { es = new EventSource(new URL('/__dial/events', url).href) } catch { return }
        es.addEventListener('dial', (ev) => {
          let msg
          try { msg = JSON.parse(ev.data) } catch { return }
          if (msg && msg.kind === 'commit' && msg.data) setCommitReq(msg.data)
          // Compose request (2026-08-26): the floating card's "→ composer"
          // button POSTed /compose and the server broadcast the THIN
          // pointer ({id, fetch, label, route}). Fetch the full context
          // (the PNG rides it, never the event log — operator
          // 2026-08-25), insert line + snapshot, ACK back with what
          // LANDED so the card shows a VERIFIED ✓ or the truth, and
          // confirm at the destination.
          const deliver = async (ptr) => {
            let ctx = ptr
            try {
              const r = await fetch(new URL(ptr.fetch, url).href)
              if (r.ok) ctx = await r.json()
            } catch { /* expired or refused — pointer-line only */ }
            const res = await insertIntoComposer({ ...ptr, ...ctx,
              route: ctx.route || ptr.route, label: ctx.label || ptr.label }, url)
            confirmInsert(res)
            try {
              await fetch(new URL('/__dial/compose-ack', url).href, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: ptr.id, inserted: res.text }),
              })
            } catch { /* the insert landed; the ack is best-effort */ }
          }
          if (msg && msg.kind === 'compose' && msg.data && msg.data.id) {
            deliver(msg.data)
          }
          // Legacy bridge (version-skew law, 2026-08-26): a design tab
          // loaded before the tabbed card still runs the OLD island,
          // whose ask POSTs /selection with NO v marker — and that ask
          // WAS the whole flow. The green card that used to confirm it
          // is retired, so deliver straight to the composer. A v2 Send
          // (store-only; → composer decides, no auto-send law) carries
          // the marker and is NOT delivered here.
          if (msg && msg.kind === 'selection' && msg.data && msg.data.id &&
              msg.data.v !== 2) {
            deliver(msg.data)
          }
        })
        return () => es.close()
      }, [url])

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
            onClick: () => show(i),
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
            onClick: () => setEpochs((e) => ({ ...e, [rung]: (e[rung] ?? 0) + 1 })),
            title: 'reload this rung only',
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
        commitReq && h('div', {
          style: {
            margin: '0 8px 8px', padding: 8, border: '1px solid #8a6d3b',
            borderRadius: 6, background: '#1f1a12', color: '#e8d9b8',
          },
        },
          h('div', { style: { fontWeight: 600, marginBottom: 4 } },
            'commit requested — ' + (commitReq.ops || []).length + ' ops · '
              + Object.keys(commitReq.tokens || {}).length + ' tokens'),
          h('div', { style: { color: '#a89f8a', fontSize: 11, marginBottom: 6 } },
            (commitReq.artifact || 'artifact')
              + ' — copy the ops for the agent; it runs design patch, re-runs gates, clears the draft'),
          h('div', { style: { display: 'flex', gap: 6 } },
            h('button', {
              onClick: () => {
                try { navigator.clipboard.writeText(JSON.stringify(commitReq, null, 2)) } catch (_) {}
              },
              style: {
                padding: '3px 8px', cursor: 'pointer', borderRadius: 4,
                border: '1px solid #666', background: '#222', color: '#eee',
              },
            }, 'copy ops'),
            h('button', {
              onClick: () => setCommitReq(null),
              style: {
                marginLeft: 'auto', padding: '3px 8px', cursor: 'pointer',
                background: 'none', border: 'none', color: '#a89f8a',
              },
            }, 'dismiss'))),
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
          ...RUNGS.map((x, i) => {
            if (!mounted[i]) return null
            const sc = Math.min(1, (DOCK_WIDTH - 24) / x.w)
            return h('div', {
              key: 'rung:' + i,
              style: {
                display: i === rung ? 'block' : 'none',
                width: x.w * sc, height: x.h * sc,
                margin: '0 auto',
                overflow: 'hidden', border: '1px solid #333',
              },
            },
              // Keyed per rung and per rung-epoch: bumping one rung's epoch
              // remounts THAT frame and leaves the others untouched. The rung
              // index is in the key on purpose here — each rung is a separate
              // document, not the same document resized.
              h('iframe', {
                key: (epochs[i] ?? 0) + ':' + url + ':' + i,
                src: url,
                width: x.w, height: x.h,
                style: {
                  border: 0, transform: 'scale(' + sc + ')',
                  transformOrigin: 'top left',
                },
              }))
          })))
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
