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
 * rings read the same way. ONE ring, for the window the host says binds (worst of 5-hour /
 * weekly / per-model); hover shows dsh's Tooltip, a click opens a card built from ContextMeter's
 * own stylesheet (header / percent / bar / rows) that lists every live window.
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
    const P = require('@deepseek-ai/dsh-client-ui-primitives')

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
    // The healthy arc is the ACCENT -- dsh's button-info-fill, the send button's own blue, which
    // arxa's theme-accent plugin remaps with the rest of the palette -- drawn at low opacity
    // (ACCENT_SOFT, below) so the usage ring reads as a tinted sibling of the grey context ring
    // rather than a copy of it (2026-09-06).
    const ACCENT = 'var(--dsw-alias-button-info-fill, #4d8ef7)'
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
      return left > 30 ? ACCENT : left > 10 ? AMBER : RED
    }
    // RING-COLOR-END

    // ContextMeter's geometry, verbatim: viewBox 14, r 5.5, 2px stroke.
    const SIZE = 14, R = 5.5, MID = SIZE / 2
    const ACCENT_SOFT = 0.55 // arc opacity while healthy; amber/red draw solid so a warning is never faint
    const CIRC = 2 * Math.PI * R

    // The card and trigger are ContextMeter's own stylesheet, rule for rule (JObwrW_* in
    // dsh-client-ui-conversation 0.1.2-rc.1) on dsh's tokens, so the two cards are twins: same
    // hover wash on the trigger, same 264px card, radius, elevation, header, bar and dl rows.
    // Injected once, the way dsh injects module CSS: a tagged <style>, skipped if already present.
    const CSS_TAG = 'arxa-provider-status'
    const CSS = [
      '.arxa-ps-root{display:inline-flex;align-items:center;position:relative;white-space:nowrap;font-size:11px;order:1;margin-left:-6px}',
      '.arxa-ps-trigger{width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;border-radius:999px;flex:none;place-items:center;display:grid}',
      '.arxa-ps-trigger:hover,.arxa-ps-trigger[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover)}',
      '.arxa-ps-panel{z-index:100;box-sizing:border-box;background:var(--dsw-specific-menu);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);width:264px;box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;border-radius:12px;padding:14px 16px;font-size:12px;line-height:20px;position:absolute;bottom:calc(100% + 8px);right:0}',
      '.arxa-ps-header{align-items:center;gap:6px;display:flex}',
      '.arxa-ps-figures{font-variant-numeric:tabular-nums;color:var(--meter-tint,var(--dsw-alias-label-primary));margin-left:auto;font-weight:500}',
      '.arxa-ps-percent{color:var(--dsw-alias-label-primary);font-weight:500}',
      '.arxa-ps-headline{color:var(--dsw-alias-label-tertiary)}',
      '.arxa-ps-bar{background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;gap:1px;height:4px;margin:12px 0 14px;display:flex;overflow:hidden}',
      '.arxa-ps-segment{background:var(--meter-tint,var(--dsw-alias-label-tertiary));border-radius:1px;flex:none;min-width:2px;height:100%}',
      '.arxa-ps-swatch{background:var(--meter-tint,var(--dsw-alias-label-tertiary));vertical-align:baseline;border-radius:2px;width:8px;height:8px;margin-right:6px;display:inline-block}',
      '.arxa-ps-rows{margin:8px 0 0}',
      '.arxa-ps-row{justify-content:space-between;align-items:center;gap:16px;padding:4px 0;display:flex}',
      '.arxa-ps-row dt{color:var(--dsw-alias-label-secondary)}',
      '.arxa-ps-row dd{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin:0}',
    ].join('\n')
    if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG}"]`) === null) {
      const tag = document.createElement('style'); tag.dataset.pluginCss = CSS_TAG; tag.textContent = CSS; document.head.appendChild(tag)
    }

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
          strokeOpacity: color === ACCENT ? ACCENT_SOFT : 1,
          strokeDasharray: `${(CIRC * used).toFixed(3)} ${CIRC.toFixed(3)}`,
          transform: `rotate(-90 ${MID} ${MID})`,
        }) : null,
      )
    }

    // A window's human name for the card. Claude's kinds are the SDK's, the polled vendors' are
    // hour:5 / week:1, a per-model bucket (model_scoped:fable) shows its model name, and a kind
    // this table does not know is shown as-is with its underscores lifted, never hidden.
    const WINDOW_LABEL = { five_hour: '5-hour', 'hour:5': '5-hour', seven_day: 'Weekly', 'week:1': 'Weekly' }
    const labelOf = (w) => {
      const kind = String(w.kind ?? '')
      if (kind in WINDOW_LABEL) return WINDOW_LABEL[kind]
      const scoped = /^model_scoped:(.+)$/.exec(kind)
      if (scoped) return scoped[1].charAt(0).toUpperCase() + scoped[1].slice(1) + ' weekly'
      return kind.replace(/_/g, ' ')
    }
    const percentOf = (w) => Math.min(100, Math.max(0, Math.round((w.utilization ?? 0) * 100)))
    // Reads like ContextMeter's own "12% of context used".
    const hoverLabel = (w) => `${percentOf(w)}% of ${labelOf(w)} window used`
    // One tint per window, the way ContextMeter tints System / Tools / Messages -- its own three
    // tokens, so the two cards share a palette: 5-hour blue, weekly violet, per-model bluish grey.
    // A window running low keeps the ring's amber/red instead, so the card never contradicts it.
    const WINDOW_TINT = {
      'five_hour': 'var(--dsw-static-blue-450, #3b82f6)', 'hour:5': 'var(--dsw-static-blue-450, #3b82f6)',
      'seven_day': '#a78bfa', 'week:1': '#a78bfa',
    }
    const tintOf = (w) => {
      const c = RING_COLOR(w.utilization ?? 0)
      if (c !== ACCENT) return c
      const kind = String(w.kind ?? '')
      return WINDOW_TINT[kind] ?? (kind.startsWith('model_scoped:') ? 'var(--dsw-static-neutral-bluish-400, #8b98ad)' : FILL)
    }

    /** ContextMeter's trigger, verbatim: the 28px round button (its CSS above) holding the ring,
     *  dsh's own Tooltip on hover -- same side, same 200 ms delay, muted while the card is open --
     *  and a click for the card. */
    function Meter ({ window: w, badge, open, onToggle }) {
      const label = hoverLabel(w)
      return h(P.Tooltip, { label, side: 'top', delayMs: 200, disabled: open },
        h('button', {
          type: 'button', className: 'arxa-ps-trigger',
          'aria-label': label, 'aria-expanded': open, 'aria-haspopup': 'dialog',
          onClick: onToggle,
        }, h(Ring, { utilization: badge.utilization, level: badge.level })))
    }

    /** ContextMeter's card: header (percent · headline · figures), the bar, then one dl row per
     *  live window with a swatch. Bar and swatches tint by RING_COLOR, so amber/red in the card
     *  match the ring. Opens UPWARD -- the composer sits at the bottom of the viewport. */
    function Panel ({ windows, focus, now, onClose }) {
      const ref = React.useRef(null)
      React.useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose() }
        const onDown = (e) => { if (ref.current && !ref.current.parentNode.contains(e.target)) onClose() }
        document.addEventListener('keydown', onKey); document.addEventListener('mousedown', onDown)
        return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown) }
      }, [onClose])
      const pct = percentOf(focus)
      // Countdown only -- "35% / 31m" -- the words cost room the card does not have (2026-09-06).
      const reset = (w) => (w.resetsAt !== undefined ? relative(w.resetsAt, now) : '')
      const tint = (w) => ({ '--meter-tint': tintOf(w) })
      return h('div', { ref, role: 'dialog', 'aria-label': hoverLabel(focus), className: 'arxa-ps-panel' },
        h('div', { className: 'arxa-ps-header' },
          h('span', { className: 'arxa-ps-percent' }, `${pct}%`),
          h('span', { className: 'arxa-ps-headline' }, `of ${labelOf(focus)} window used`),
          h('span', { className: 'arxa-ps-figures', style: tint(focus) }, reset(focus)),
        ),
        h('div', { className: 'arxa-ps-bar' },
          pct > 0 ? h('div', { className: 'arxa-ps-segment', style: { width: `${pct}%`, ...tint(focus) } }) : null,
        ),
        h('dl', { className: 'arxa-ps-rows' },
          ...windows.map((w) => h('div', { key: w.kind, className: 'arxa-ps-row' },
            h('dt', null, h('span', { className: 'arxa-ps-swatch', 'aria-hidden': 'true', style: tint(w) }), labelOf(w)),
            h('dd', null, [`${percentOf(w)}%`, reset(w)].filter(Boolean).join(' / ')),
          )),
        ),
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
      const [open, setOpen] = React.useState(false)
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
      React.useEffect(() => { setOpen(false) }, [activeProvider])
      const close = React.useCallback(() => setOpen(false), [])

      // Only windows that format to something are live: formatBadge retires a window once its
      // reset passes and drops any that belong to another provider.
      const live = windows.map((w) => ({ w, badge: formatBadge(w, now, activeProvider) })).filter((x) => x.badge !== undefined)
      if (live.length === 0) return null
      // Rings for windows with a number to divide by; a balance or a failed read has none, and
      // keeps its text.
      const numeric = live.filter((x) => typeof x.badge.utilization === 'number')
      const textual = live.filter((x) => typeof x.badge.utilization !== 'number')
      // ONE ring (2026-09-06, "no need to have 2 of them rings"): the window the host says binds
      // -- its fold picks the worst level, ties on utilization -- comes first in `windows`, so it
      // is numeric[0]. The card lists every live window; the tooltip names the one on the ring.
      const focus = numeric[0]

      // `order:1` (root CSS) + pushSendAfter: the `conversation.input.right` slot renders BEFORE
      // the model picker, and dsh has no slot between the picker and its context ring. The trailing
      // group is a flex row with a 12px gap, so the ring takes order 1 and the send button (its
      // last child) order 2: model · context ring · usage ring · send, evenly spaced by the row.
      return h('span', { ref: rootRef, 'data-arxa-provider-status': '', className: 'arxa-ps-root' },
        focus !== undefined ? h(Meter, { window: focus.w, badge: focus.badge, open, onToggle: () => setOpen((o) => !o) }) : null,
        ...textual.map((x) => h('span', {
          key: x.w.kind, title: x.badge.title, 'aria-label': x.badge.title, role: 'img',
          style: { display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 6px', color: x.badge.level === 'limit' ? RED : MUTED },
        }, h(Ring, { utilization: undefined, level: x.badge.level }), h('span', null, x.badge.text))),
        open && focus !== undefined
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
