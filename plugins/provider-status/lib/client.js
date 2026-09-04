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
 * That same pull is what refreshes the polled vendors. arxa owns Claude's request path and asks it
 * at turn end; it owns none of zai's, kimi's or deepseek's, so the host reads their quota behind
 * this call. Every 60s tick is therefore also a (TTL-gated) refresh trigger.
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

    const RPC_CHANNEL = '/rpc/arxa-provider-status'

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

    // The two tones the ring is built from, plus the two it escalates through. The track is the
    // accent at low opacity (drawn as stroke-opacity, not color-mix -- one SVG attribute, no
    // dependency on a colour function the host webview may or may not have).
    const ACCENT = 'var(--dsw-static-deepseek-500, #4d6bfe)'
    const AMBER = 'var(--dsw-alias-state-warn-primary, #d08a00)'
    const RED = 'var(--dsw-alias-state-error-primary, #d64545)'
    const MUTED = 'var(--dsw-alias-label-tertiary, #8a8f98)'

    // Colour steps on how much is LEFT, and reads `utilization` directly rather than `level`.
    // Those two disagree on purpose: `level` turns warn at 0.8 used, i.e. 20% left, but the ring
    // is specified to go amber at 30% left. Colouring off `level` would silently move the first
    // step by ten points, which is a whole day of a weekly window.
    // Stepped on the ROUNDED PERCENT, the same integer the ring prints in its centre, so the colour
    // and the number can never disagree — a "30" shown in accent would be a visible contradiction.
    // (It also sidesteps 1 - 0.7 === 0.30000000000000004 landing on the wrong side of a boundary.)
    const RING_COLOR = (utilization) => {
      const left = Math.round((1 - utilization) * 100)
      return left > 30 ? ACCENT : left > 10 ? AMBER : RED
    }

    const SIZE = 18, R = 7, MID = SIZE / 2
    const CIRC = 2 * Math.PI * R

    /**
     * The ring itself. Two circles: a full track, and an arc for the fraction left, started at
     * twelve o'clock. With no `utilization` there is nothing to divide by -- a wallet balance has
     * no denominator, and a failed read has no number at all -- so the arc is dropped and the
     * track goes dashed, which reads as "idle" rather than "empty".
     */
    function Ring ({ utilization, level }) {
      const known = typeof utilization === 'number'
      const left = known ? Math.min(1, Math.max(0, 1 - utilization)) : 0
      const color = known ? RING_COLOR(utilization) : (level === 'limit' ? RED : MUTED)
      const track = h('circle', {
        cx: MID, cy: MID, r: R, fill: 'none', stroke: known ? ACCENT : color, strokeOpacity: known ? 0.15 : 0.45,
        strokeWidth: 2, ...(known ? {} : { strokeDasharray: '2 3' }),
      })
      return h('svg', { width: SIZE, height: SIZE, viewBox: `0 0 ${SIZE} ${SIZE}`, style: { display: 'block', flex: 'none' }, 'aria-hidden': 'true' },
        track,
        known ? h('circle', {
          cx: MID, cy: MID, r: R, fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round',
          strokeDasharray: `${(left * CIRC).toFixed(2)} ${CIRC.toFixed(2)}`,
          transform: `rotate(-90 ${MID} ${MID})`,
        }) : null,
        // Digits only. A `%` glyph does not fit inside 18px, and the number is unambiguous sitting
        // in a ring; the tooltip spells it out for anyone who needs the words.
        known ? h('text', {
          x: MID, y: MID, textAnchor: 'middle', dominantBaseline: 'central',
          fontSize: 8, fontWeight: 600, fill: color,
        }, String(Math.round(left * 100))) : null,
      )
    }

    function ProviderStatusBadge ({ sessionId, connection, directory, load }) {
      const [status, setStatus] = React.useState(null)
      const [now, setNow] = React.useState(Date.now())
      const [index, setIndex] = React.useState(0)
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
        if (connection === undefined || sessionId === undefined) return
        connection.call(RPC_CHANNEL, 'current', { sessionId, provider: activeProvider }).then(
          (r) => { if (r && r.ok) { setStatus(r.value?.status ?? null); setNow(Date.now()) } },
          () => {}, // a failed status fetch must never surface as a conversation error
        )
      }, [connection, sessionId, activeProvider])

      // Refetch on mount and on every provider switch, then on a slow tick. The tick also
      // re-renders the "resets in" text and retires the ring once its window passes.
      React.useEffect(() => {
        refresh()
        const id = setInterval(refresh, 60_000)
        return () => clearInterval(id)
      }, [refresh])

      // A provider's windows: the binding one first, then its siblings. The host folds to decide
      // WHICH binds; the siblings ride along structurally so this can be tapped through them.
      const windows = [status, ...(status?.others ?? [])].filter(Boolean)
      // Reset on a provider switch: index 2 of Claude's three windows is meaningless for GLM's two.
      React.useEffect(() => { setIndex(0) }, [activeProvider])

      // Fall back to the binding window when the cycled-to one formats to nothing. A sibling can
      // expire WHILE it is the one on screen (formatBadge retires a window once its reset passes),
      // and without this the whole ring would vanish until the next tick — invisible, when the
      // binding window is still perfectly live. Degrade visible, never invisible.
      const picked = windows[index % Math.max(1, windows.length)]
      const badge = formatBadge(picked, now, activeProvider) ?? formatBadge(windows[0], now, activeProvider)
      if (badge === undefined) return null
      // The tooltip always names EVERY live window, whichever one is on screen -- the ring shows
      // one number, and a limit the user is never told about is how they get surprised by it.
      const full = formatBadge(status, now, activeProvider)?.title ?? badge.title
      const cycles = windows.length > 1
      const label = cycles ? `${full} · showing ${badge.text}, click to cycle` : full
      const cycle = () => setIndex((i) => (i + 1) % windows.length)

      return h('span', {
        title: label,
        'aria-label': label,
        // The number carries the state, not just the colour: `aria-live` is deliberately absent
        // (a usage figure changing under a screen reader mid-sentence is noise), but the label is
        // read on focus and the digits are visible without relying on hue at all.
        role: cycles ? 'button' : 'img',
        tabIndex: cycles ? 0 : undefined,
        onClick: cycles ? cycle : undefined,
        // Keyboard reaches it too: clicking is the only route to the other window, so a
        // mouse-only affordance would put half the information out of reach.
        onKeyDown: cycles ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cycle() } } : undefined,
        style: {
          display: 'inline-flex', alignItems: 'center', gap: '4px', height: '18px',
          fontSize: '11px', lineHeight: '18px', whiteSpace: 'nowrap',
          color: badge.level === 'limit' ? RED : MUTED,
          cursor: cycles ? 'pointer' : 'default',
        },
      },
      h(Ring, { utilization: badge.utilization, level: badge.level }),
      // With a percentage in the ring there is nothing left to say inline. Without one -- a
      // balance, or a failed read -- the ring has no number, so the text carries it instead.
      typeof badge.utilization === 'number' ? null : h('span', null, badge.text),
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
      ctx.inject(['modelDirectories'], (scope) => { models = scope.modelDirectories })

      ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: 'arxa-provider-status',
        order: 20,
        inject: (sessionId) => ({
          sessionId,
          connection: ctx.connection?.rpc,
          // Resolved at render time, guarded: directoryFor() throws for a session with no scope
          // ("Unknown sessions fail loud") -- a subagent session, or one mid-teardown. A missing
          // directory costs the provider filter, not the ring.
          ...(() => {
            try {
              const d = models?.directoryFor(sessionId)
              // load() is fire-and-forget: a catalog that fails to load costs the provider filter,
              // never the ring and never a conversation error.
              return { directory: d?.store, load: d === undefined ? undefined : () => { d.load().catch(() => {}) } }
            } catch { return { directory: undefined, load: undefined } }
          })(),
        }),
      }, ProviderStatusBadge))
    }
    exports.apply = apply
    exports.inject = ['slots', 'connection']
    return module.exports
  },
})
