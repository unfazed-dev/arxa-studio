/**
 * arxa-provider-status browser half.
 *
 * Two inputs, deliberately from different places:
 *
 *  - the STATUS comes over Connection RPC (`current`). It used to arrive by session projection --
 *    a live push -- but a projection needs a session event, and a `provider/status` event made the
 *    whole conversation unreadable on reopen (see lib/index.js). Connection RPC is unary, so this
 *    is a pull: on mount, whenever the selected provider changes, and on a slow tick.
 *  - the CURRENT PROVIDER comes from `modelDirectories`, the same store dsh's own model picker
 *    renders from. That store updates the instant the user picks a model, so the ring hides and
 *    reappears with the picker rather than waiting for a turn -- and because both surfaces read
 *    one store, the ring and the picker cannot disagree.
 *
 * That same pull is what refreshes every provider. The host asks Claude's own child for its
 * `/usage` windows and reads zai's, kimi's and deepseek's quota over their APIs, all behind this
 * call. Every 60s tick is therefore also a (TTL-gated) refresh trigger.
 *
 * SHAPE: the usage rings are built to the same numbers as dsh's own context ring (ContextMeter in
 * @deepseek-ai/dsh-client-ui-conversation 0.1.2-rc.1, the ring that sits beside the model picker):
 * a 28px round trigger holding a 14px ring, r=5.5, 2px stroke, track on --dsw-alias-border-l3, arc
 * on --dsw-alias-label-tertiary from twelve o'clock, and the arc measures what is USED so the two
 * rings read the same way. One trigger per live window -- 5-hour and weekly for Claude -- and a
 * click opens a panel laid out like the context meter's (headline / percent / bar / rows).
 *
 * WIRING RULE (this is what made the pill vanish entirely on 2026-09-05): `exports.inject` is a
 * HARD GATE -- dsh's own contract calls it "service required before the companion can register".
 * `modelDirectories` belongs to another plugin (dsh-client-ui-model-selection), and dsh itself
 * keeps it OUT of that plugin's module-level inject list for exactly this reason. Listing it here
 * makes the whole ring hostage to another plugin's service. So the gate names only core services,
 * and the directory is resolved at RENDER time, defensively: no directory just means no provider
 * filter, which shows the ring rather than hiding it. Degrade visible, never invisible.
 */
window.__ModuleLoader__.load({
  id: 'arxa-provider-status',
  factory: (require) => {
    var module = { exports: {} }; var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement

    // Must equal lib/index.js RPC_CHANNEL. One segment only (dsh CHANNEL_PATTERN).
    const RPC_CHANNEL = '/arxa-provider-status'

    // Mirrors lib/status.js formatBadge. selftest.mjs extracts this block and proves the two
    // agree. The two-limit fold (bindingStatus) stays host-side, so this remains one pure
    // function of one value.
    const relative = (resetsAt, now) => {
      const s = Math.max(0, Math.round(resetsAt - now / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
      return h > 0 ? `${h}h ${m}m` : `${m}m`
    }

    function formatBadge (value, now = Date.now(), activeProvider = undefined) {
      if (!value) return undefined
      if (activeProvider !== undefined && activeProvider !== value.provider) return undefined
      if (value.resetsAt !== undefined && value.resetsAt * 1000 <= now) return undefined
      const reset = value.resetsAt !== undefined && value.level !== 'ok' ? ` · resets in ${relative(value.resetsAt, now)}` : ''
      return { level: value.level, text: `${value.text}${reset}`, title: value.title ?? value.text, utilization: value.utilization }
    }
    // PARITY-END — selftest.mjs slices from `const relative` to this marker and runs the result
    // against the host's own formatBadge. Deliberately a comment and not a variable name: the
    // extractor used to stop at `const COLOR`, which quietly coupled a test to what the next
    // constant happened to be called.

    // RING-COLOR-START — selftest.mjs slices from here to RING-COLOR-END and exercises RING_COLOR
    // directly. Sentinels, not constant names: the extractor used to start at `const ACCENT`, and
    // renaming that constant to match dsh's tokens broke the test in a way that read like a bug.
    // dsh's ContextMeter tokens, with the fallbacks the host webview would paint if a token were
    // ever missing. TRACK/FILL are the context ring's own two tones; AMBER/RED are the two the
    // usage ring escalates through as a window runs down.
    const TRACK = 'var(--dsw-alias-border-l3, #3a3f47)'
    const FILL = 'var(--dsw-alias-label-tertiary, #8a8f98)'
    const AMBER = 'var(--dsw-alias-state-warn-primary, #d08a00)'
    const RED = 'var(--dsw-alias-state-error-primary, #d64545)'
    const MUTED = FILL
    const LABEL = 'var(--dsw-alias-label-primary, #e6e8eb)'
    const LABEL_2 = 'var(--dsw-alias-label-secondary, #b4b9c2)'
    const PANEL_BG = 'var(--dsw-specific-menu, #1e2127)'
    const PANEL_BORDER = 'var(--dsw-alias-border-l1, #2a2e35)'
    const HOVER = 'var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.06))'

    // Colour steps on how much is LEFT, and reads `utilization` directly rather than `level`.
    // Those two disagree on purpose: `level` turns warn at 0.8 used, i.e. 20% left, but the ring
    // is specified to go amber at 30% left. Colouring off `level` would silently move the first
    // step by ten points, which is a whole day of a weekly window.
    // Stepped on the ROUNDED PERCENT, the same integer the panel prints, so the colour and the
    // number can never disagree. (It also sidesteps 1 - 0.7 === 0.30000000000000004 landing on
    // the wrong side of a boundary.)
    const RING_COLOR = (utilization) => {
      const left = Math.round((1 - utilization) * 100)
      return left > 30 ? FILL : left > 10 ? AMBER : RED
    }
    // RING-COLOR-END

    // ContextMeter's geometry, verbatim: viewBox 14, r 5.5, 2px stroke.
    const SIZE = 14, R = 5.5, MID = SIZE / 2
    const CIRC = 2 * Math.PI * R

    /**
     * The ring itself. Two circles: a full track, and an arc for the fraction USED, started at
     * twelve o'clock -- the same direction the context ring fills, so a glance reads both the
     * same way. With no `utilization` there is nothing to divide by -- a wallet balance has no
     * denominator, and a failed read has no number at all -- so the arc is dropped and the track
     * goes dashed, which reads as "idle" rather than "empty".
     */
    function Ring ({ utilization, level }) {
      const known = typeof utilization === 'number'
      const used = known ? Math.min(1, Math.max(0, utilization)) : 0
      const color = known ? RING_COLOR(utilization) : (level === 'limit' ? RED : MUTED)
      return h('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, width: SIZE, height: SIZE, 'aria-hidden': 'true', style: { display: 'block', flex: 'none' } },
        h('circle', {
          cx: MID, cy: MID, r: R, fill: 'none', strokeWidth: 2,
          ...(known ? { stroke: TRACK } : { stroke: color, strokeOpacity: 0.6, strokeDasharray: '2 3' }),
        }),
        known ? h('circle', {
          cx: MID, cy: MID, r: R, fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round',
          strokeDasharray: `${(CIRC * used).toFixed(3)} ${CIRC.toFixed(3)}`,
          transform: `rotate(-90 ${MID} ${MID})`,
        }) : null,
      )
    }

    // A window's human name for the panel. Claude's kinds are the SDK's; a kind this table does
    // not know is shown as-is with its underscores lifted, never hidden.
    const WINDOW_LABEL = { five_hour: '5-hour', seven_day: 'Weekly' }
    const labelOf = (w) => WINDOW_LABEL[w.kind] ?? String(w.kind ?? '').replace(/_/g, ' ')
    const percentOf = (w) => Math.min(100, Math.max(0, Math.round((w.utilization ?? 0) * 100)))

    /** ContextMeter's trigger: a 28px round button holding the ring. */
    function Meter ({ badge, open, onToggle }) {
      return h('button', {
        type: 'button',
        title: badge.title, 'aria-label': badge.title, 'aria-expanded': open, 'aria-haspopup': 'dialog',
        onClick: onToggle,
        style: {
          width: 28, height: 28, borderRadius: 999, border: 'none', padding: 0, flex: 'none',
          background: open ? HOVER : 'transparent', color: MUTED, cursor: 'pointer',
          display: 'grid', placeItems: 'center',
        },
      }, h(Ring, { utilization: badge.utilization, level: badge.level }))
    }

    /** ContextMeter's panel: headline / percent / bar, then one row per live window. Opens
     *  UPWARD -- the composer sits at the bottom of the viewport, so downward would be off-screen. */
    function Panel ({ windows, focus, now, onClose }) {
      const ref = React.useRef(null)
      React.useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose() }
        const onDown = (e) => { if (ref.current && !ref.current.parentNode.contains(e.target)) onClose() }
        document.addEventListener('keydown', onKey); document.addEventListener('mousedown', onDown)
        return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown) }
      }, [onClose])
      const head = focus
      const headPct = percentOf(head)
      const rows = windows.map((w) => {
        const pct = percentOf(w)
        const reset = w.resetsAt !== undefined ? `resets in ${relative(w.resetsAt, now)}` : ''
        return h('div', { key: w.kind, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '2px 0' } },
          h('span', { style: { color: LABEL_2 } }, labelOf(w)),
          h('span', { style: { color: LABEL, fontVariantNumeric: 'tabular-nums' } }, `${pct}% used`),
          h('span', { style: { color: MUTED, whiteSpace: 'nowrap' } }, reset),
        )
      })
      return h('div', {
        ref, role: 'dialog', 'aria-label': head.title ?? head.text,
        style: {
          position: 'absolute', right: 0, bottom: 'calc(100% + 8px)', zIndex: 100, boxSizing: 'border-box', width: 264,
          background: PANEL_BG, border: `1px solid ${PANEL_BORDER}`, borderRadius: 10, padding: '10px 12px',
          boxShadow: 'var(--dsw-elevation-prominent, 0 8px 24px rgba(0,0,0,0.35))', color: LABEL, fontSize: 12, lineHeight: '18px',
        },
      },
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 } },
        h('span', { style: { color: MUTED } }, `${labelOf(head)} window`),
        h('span', { style: { color: LABEL, fontWeight: 500 } }, `${headPct}%`),
        h('span', { style: { color: MUTED } }, 'used'),
      ),
      h('div', { style: { height: 4, borderRadius: 2, background: TRACK, overflow: 'hidden', marginBottom: 8 } },
        h('div', { style: { height: '100%', width: `${headPct}%`, background: RING_COLOR(head.utilization ?? 0), borderRadius: 2 } }),
      ),
      h('div', null, ...rows),
      )
    }

    // Pushes the composer's send button after the rings (see the root span's `order: 1`), so the
    // bottom row reads model · context ring · rings · send. Done by walking the DOM, not by a CSS
    // sibling selector: dsh renders slot entries inside a `display: contents` wrapper, so the
    // rings join the trailing flex row (that is why `order` works) but are NOT DOM siblings of
    // the send button — `~` never matched (2026-09-06, two attempts). `trailing` is the module-CSS
    // key dsh's InputBar uses for that row; if it ever renames, the rings simply stay where the
    // slot put them, left of the picker, and nothing breaks.
    function pushSendAfter (el) {
      const host = el?.closest?.('[class*="trailing"]')
      if (!host) return
      const last = host.lastElementChild
      if (last && last !== el && !last.contains(el)) last.style.order = '2'
    }

    function ProviderStatusBadge ({ sessionId, connection, directory: initialDirectory, load: initialLoad, resolveDirectory, onModels }) {
      const rootRef = React.useRef(null)
      React.useEffect(() => { pushSendAfter(rootRef.current) })
      const [status, setStatus] = React.useState(null)
      const [now, setNow] = React.useState(Date.now())
      const [open, setOpen] = React.useState(null) // the kind whose panel is open, or null
      // The directory usually does NOT exist when this first renders: model-selection registers
      // after the composer mounts, and directoryFor() throws until the session is registered with
      // it. Hold what inject gave us, and re-resolve when the modelDirectories fiber fires
      // (onModels) or, failing that, on a slow tick. Without this the provider filter was inert
      // for every real session (2026-09-06), and the host never fetched.
      const [late, setLate] = React.useState(undefined)
      React.useEffect(() => {
        if (initialDirectory !== undefined || typeof resolveDirectory !== 'function') return
        let stopped = false
        const attempt = () => {
          if (stopped) return true
          const r = resolveDirectory()
          if (r?.directory === undefined) return false
          setLate(r)
          return true
        }
        if (attempt()) return
        const unsubscribe = onModels?.(attempt) ?? (() => {})
        const timer = setInterval(() => { if (attempt()) clearInterval(timer) }, 1000)
        return () => { stopped = true; unsubscribe(); clearInterval(timer) }
      }, [initialDirectory, resolveDirectory, onModels])
      const directory = initialDirectory ?? late?.directory
      const load = initialLoad ?? late?.load
      // dsh's own picker loads the catalog only when it is OPENED, and `current` is null until
      // something loads it. Without this the ring would spend most of its life not knowing which
      // provider is selected, and the provider filter it exists for would be inert.
      React.useEffect(() => { load?.() }, [load])
      // The picker's live selection. `directory` is the same snapshot store the model selector
      // uses, so this re-renders the moment a model is chosen -- no turn, no poll.
      const selection = React.useSyncExternalStore(
        React.useCallback((fn) => (directory === undefined ? () => {} : directory.subscribe(fn)), [directory]),
        React.useCallback(() => (directory === undefined ? undefined : directory.getSnapshot()), [directory]),
      )
      const activeProvider = selection?.current?.provider

      const refresh = React.useCallback(() => {
        if (connection === undefined || sessionId === undefined) return Promise.resolve(null)
        return connection.call(RPC_CHANNEL, 'current', { sessionId, provider: activeProvider }).then(
          (r) => {
            if (!(r && r.ok)) return null
            const next = r.value?.status ?? null
            setStatus(next); setNow(Date.now())
            return next
          },
          () => null, // a failed status fetch must never surface as a conversation error
        )
      }, [connection, sessionId, activeProvider])

      // Refetch on mount and on every provider switch, then on a slow tick. The tick also
      // re-renders the "resets in" text and retires a ring once its window passes.
      // A null answer right after mount usually means the host's cold probe was still running
      // when its bounded wait expired (measured 2026-09-06: first RPC null at 1.5 s, data landed
      // at ~2.5 s, next ask a minute later). Retry on a short ladder before settling on the tick.
      React.useEffect(() => {
        let cancelled = false
        const RETRY_MS = [3_000, 10_000, 30_000]
        let step = 0
        const pending = new Set()
        const tick = () => refresh().then((next) => {
          if (cancelled || next !== null || step >= RETRY_MS.length) return
          const t = setTimeout(() => { pending.delete(t); tick() }, RETRY_MS[step++])
          pending.add(t)
        })
        tick()
        const id = setInterval(tick, 60_000)
        return () => { cancelled = true; clearInterval(id); for (const t of pending) clearTimeout(t) }
      }, [refresh])

      // A provider's windows: the binding one first, then its siblings. The host folds to decide
      // WHICH binds; the siblings ride along structurally so each can have its own ring.
      const windows = [status, ...(status?.others ?? [])].filter(Boolean)
      // Close the panel on a provider switch: Claude's weekly panel is meaningless for GLM.
      React.useEffect(() => { setOpen(null) }, [activeProvider])
      const close = React.useCallback(() => setOpen(null), [])

      // Only windows that format to something are live: formatBadge retires a window once its
      // reset passes and drops any that belong to another provider.
      const live = windows.map((w) => ({ w, badge: formatBadge(w, now, activeProvider) })).filter((x) => x.badge !== undefined)
      if (live.length === 0) return null
      // Rings for windows with a number to divide by; a balance or a failed read has none, and
      // keeps its text.
      const numeric = live.filter((x) => typeof x.badge.utilization === 'number')
      const textual = live.filter((x) => typeof x.badge.utilization !== 'number')
      // Exactly two rings: the 5-hour window and the weekly one (2026-09-06, "should be only 2").
      // Claude's kinds are five_hour / seven_day, the polled vendors' hour:5 / week:1. Every other
      // numeric window — the per-model weekly Fable/Opus limits — is a panel row, not a ring: it
      // is the same weekly allowance sliced by model, and a third ring read as a third limit.
      const RING_RANK = { five_hour: 0, 'hour:5': 0, seven_day: 1, 'week:1': 1 }
      const metered = numeric.filter((x) => x.w.kind in RING_RANK).sort((a, b) => RING_RANK[a.w.kind] - RING_RANK[b.w.kind])
      const focus = numeric.find((x) => x.w.kind === open) ?? metered[0] ?? numeric[0]

      // `order: 1` + the ORDER_CSS rule below: the `conversation.input.right` slot renders BEFORE the
      // model picker, and dsh has no slot between the picker and its context ring. The trailing
      // group is a flex row, so the rings take order 1 and the send button (its last child) order
      // 2, which lands the rings immediately right of the context ring: model · context · rings ·
      // send. Structural selector on this element's own siblings — no hashed class, no locale.
      return h('span', { ref: rootRef, 'data-arxa-provider-status': '', style: { position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 0, whiteSpace: 'nowrap', fontSize: 11, order: 1 } },
        ...metered.map((x) => h(Meter, { key: x.w.kind, badge: x.badge, open: open === x.w.kind, onToggle: () => setOpen((o) => (o === x.w.kind ? null : x.w.kind)) })),
        ...textual.map((x) => h('span', {
          key: x.w.kind, title: x.badge.title, 'aria-label': x.badge.title, role: 'img',
          style: { display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 6px', color: x.badge.level === 'limit' ? RED : MUTED },
        }, h(Ring, { utilization: undefined, level: x.badge.level }), h('span', null, x.badge.text))),
        open !== null && focus !== undefined
          ? h(Panel, { windows: numeric.map((x) => x.w), focus: focus.w, now, onClose: close })
          : null,
      )
    }

    function apply (ctx) {
      // Held, not gated. Reading `modelDirectories` off ctx without declaring it throws outright
      // ("cannot get property without inject", cordis lib/index.js), so it cannot simply be
      // optional-chained at render time -- but declaring it in `exports.inject` makes the whole
      // ring hostage to another plugin. The lazy fiber is the seam dsh itself uses: it fires when
      // model-selection registers its service, and until then the ring renders with no provider
      // filter rather than not at all.
      let models
      const modelsWaiters = new Set()
      ctx.inject(['modelDirectories'], (scope) => {
        models = scope.modelDirectories
        // Wake every mounted pill. A pill that rendered BEFORE this fiber fired is the common case,
        // not the edge: the composer mounts before model-selection registers (measured 2026-09-06 —
        // every real session's pill had resolved its props once, pre-fiber, and so never carried a
        // provider; the host then skipped the fetch and the ring stayed blank for the window's life).
        for (const wake of modelsWaiters) wake()
      })
      // Resolved on demand, guarded: directoryFor() throws for a session with no scope ("Unknown
      // sessions fail loud") -- a subagent session, or one mid-teardown. A missing directory costs
      // the provider filter, not the ring. load() is fire-and-forget: a catalog that fails to load
      // costs the provider filter, never the ring and never a conversation error.
      const resolveDirectory = (sessionId) => {
        try {
          const d = models?.directoryFor(sessionId)
          return { directory: d?.store, load: d === undefined ? undefined : () => { d.load().catch(() => {}) } }
        } catch { return { directory: undefined, load: undefined } }
      }

      // `conversation.input.right` is the composer's trailing group in dsh 0.1.2-rc.1 — the slot
      // rendered immediately left of the model picker, in the same row as the context ring and
      // send button (client-ui-conversation client.js ~line 15642: right · model · ContextMeter ·
      // send). Same `inject: (sessionId) => props` contract as the dock.
      //
      // History: on 2026-09-06 this slot was declared "gone in rc.1" and the pill was moved to
      // `conversation.input.dock` (b0e7ff0). That diagnosis was wrong — the slot exists; the pill
      // was invisible because the client ensure() saw `{ rows: [] }` and the component returns
      // null with no status, which looks identical to "slot never rendered". Fixed in 20832e1.
      ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: 'arxa-provider-status',
        order: 20,
        inject: (sessionId) => ({
          sessionId,
          connection: ctx.connection?.rpc,
          // Resolved now if model-selection is already up. Props are computed ONCE per mount, so
          // when it is not, the pill re-resolves itself through the two hooks below instead of
          // living forever with the undefined this call returned.
          ...resolveDirectory(sessionId),
          resolveDirectory: () => resolveDirectory(sessionId),
          onModels: (wake) => { modelsWaiters.add(wake); return () => { modelsWaiters.delete(wake) } },
        }),
      }, ProviderStatusBadge))
    }
    exports.apply = apply
    exports.inject = ['slots', 'connection']
    return module.exports
  },
})
