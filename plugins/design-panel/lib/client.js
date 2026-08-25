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
          const ta = document.querySelector('textarea')
          if (!ta) return false
          ta.focus()
          ta.dispatchEvent(new ClipboardEvent('paste',
            { clipboardData: dt, bubbles: true, cancelable: true }))
          return true
        } catch (_) { return false }
      }
      const insertIntoComposer = async (sel, origin) => {
        const line = pointerLine(sel, origin)
        const ta = document.querySelector('textarea')
        if (ta) {
          try {
            const setter = Object.getOwnPropertyDescriptor(
              window.HTMLTextAreaElement.prototype, 'value').set
            setter.call(ta, (ta.value ? ta.value.replace(/\s*$/, '\n') : '') + line)
            ta.dispatchEvent(new Event('input', { bubbles: true }))
            ta.focus()
          } catch (_) { /* fall through to clipboard */ }
        } else {
          try { navigator.clipboard.writeText(line) } catch (_) {}
        }
        // The context fetch may still be in flight — the card paints from
        // the thin pointer frame, and a fast click would otherwise read a
        // png-less state and silently skip the snapshot (the race caught by
        // lens_dial_snapshot_race). Await the in-flight promise, bounded;
        // on expiry or failure proceed text-only.
        let ctx = sel
        const rec = selCtxRef.current
        if (rec && rec.id === sel.id && sel.loading !== false) {
          try {
            ctx = await Promise.race([
              rec.promise,
              new Promise((_, rej) => setTimeout(rej, 2500)),
            ])
          } catch (_) { /* slow or expired — text-only */ }
        }
        if (ctx.png && String(ctx.png).startsWith('data:image/')) {
          await pasteSnapshot(ctx.png, ctx.id || sel.id)
        }
      }
      const chipStyle = {
        fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 6,
        background: '#22301a', color: '#c8d8b0',
      }
      const btnStyle = {
        padding: '3px 8px', cursor: 'pointer', borderRadius: 4,
        border: '1px solid #6e884c', background: '#1c2415', color: '#dce8cc',
      }

      // Design Mode's commit socket (locked amendment 2026-08-23, decision
      // 2): the Author clicks 'Request commit' in the dial island, the
      // design server broadcasts the draft as structured patch ops on
      // /__dial/events, and this banner hands them to the agent — it runs
      // `appbox design patch` per op (tokens go to the token sheet) and
      // clears the draft on success. Same cross-origin rule as /__events:
      // one trusted-origin entry covers both streams.
      const [commitReq, setCommitReq] = React.useState(null)
      const [selReq, setSelReq] = React.useState(null)
      // The in-flight selection-context fetch ({id, promise}), so a click on
      // "→ composer" can AWAIT it — the card paints from the thin pointer
      // frame before the context (label · png · styles) resolves, and a
      // click in that window must not silently drop the snapshot.
      const selCtxRef = React.useRef(null)
      React.useEffect(() => {
        if (!open) return
        let es
        try { es = new EventSource(new URL('/__dial/events', url).href) } catch { return }
        es.addEventListener('dial', (ev) => {
          let msg
          try { msg = JSON.parse(ev.data) } catch { return }
          if (msg && msg.kind === 'commit' && msg.data) setCommitReq(msg.data)
          // Selection handoff (2026-08-24, rework slice 7): the dial card's
          // "Ask arxa" registered an organized selection context server-side
          // and broadcast its POINTER. The frame is deliberately thin
          // ({id, fetch}) — the PNG, label, styles and law stay server-side
          // behind the fetch URL, so no 400 KB image ever rides the dial
          // event log (operator decision 2026-08-25: fetch-on-arrival). The
          // context fetch is cross-origin; the same trusted-origins entry
          // that admits this EventSource covers it (CORS headers verified
          // on GET /__dial/selection/*).
          if (msg && msg.kind === 'selection' && msg.data) {
            const ptr = msg.data
            setSelReq({ ...ptr, loading: true })
            const ctxPromise = fetch(new URL(ptr.fetch, url).href)
              .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
            selCtxRef.current = { id: ptr.id, promise: ctxPromise }
            ctxPromise
              .then((ctx) => setSelReq((s) => (s && s.id === ptr.id ? { ...s, ...ctx, loading: false } : s)))
              .catch(() => setSelReq((s) => (s && s.id === ptr.id ? { ...s, loading: false, expired: true } : s)))
          }
        })
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
        selReq && h('div', {
          style: {
            margin: '0 8px 8px', padding: 8, border: '1px solid #6e884c',
            borderRadius: 6, background: '#141a10', color: '#dce8cc',
          },
        },
          h('div', { style: { fontWeight: 600, marginBottom: 4 } },
            '✨ design selection ' + (selReq.id || '')),
          h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 } },
            h('span', chipStyle, selReq.label || 'element'),
            h('span', chipStyle, (selReq.kind || '') + ' · ' + (selReq.group || '')),
            h('span', chipStyle, selReq.route || '/')),
          selReq.loading === true && h('div', {
            style: { fontSize: 10.5, color: '#8a9a76', marginBottom: 6 },
          }, 'fetching selection context (label · styles · snapshot)…'),
          selReq.png && h('div', {
            style: { fontSize: 10.5, color: '#a8b894', marginBottom: 6 },
          }, '📸 snapshot captured — “→ composer” attaches it to the draft'),
          selReq.expired && h('div', {
            style: { fontSize: 10.5, color: '#a88a6d', marginBottom: 6 },
          }, 'context expired (20 min) — pointer line only'),
          (selReq.text || '').length > 0 && h('div', {
            style: { fontSize: 11, color: '#a8b894', marginBottom: 6,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
          }, '"' + selReq.text.slice(0, 90) + '"'),
          h('div', { style: { fontSize: 10.5, color: '#8a9a76', marginBottom: 8 } },
            'the agent fetches the organized context (styles · law · screenshot) from the design server and edits ONLY this element'),
          h('div', { style: { display: 'flex', gap: 6 } },
            h('button', {
              onClick: () => insertIntoComposer(selReq, url),
              style: btnStyle,
            }, '→ composer'),
            h('button', {
              onClick: () => {
                try { navigator.clipboard.writeText(pointerLine(selReq, url)) } catch (_) {}
              },
              style: { ...btnStyle, marginLeft: 'auto' },
            }, 'copy line'),
            h('button', {
              onClick: () => setSelReq(null),
              style: { background: 'none', border: 'none', color: '#8a9a76', cursor: 'pointer' },
            }, '×'))),
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
