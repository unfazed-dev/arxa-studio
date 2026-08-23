/**
 * arxa-gen-ui, browser half — stage 2 (+ stage 3's client end) of
 * docs/plans/inline-generative-ui-in-dsh.md (app-box).
 *
 * Registers ONE keyed toolview: `tool.call.toolview` with `key: 'gen_ui'`.
 * That slot is dispatched by wire tool name inside the turn, so our tool's
 * card becomes arbitrary React while every other tool keeps its shipped row.
 * Registering our own key is purely additive — no shipped UI is shadowed.
 *
 * Durability, which is the whole point: the settled node carries the surface
 * on `block.meta` (written host-side by `output.presentationMeta`), and this
 * component is a pure function of it. Reload, replay, scrollback — identical
 * render, forever. React state here is view-local only and is EXPECTED to be
 * lost; anything that must outlive the page goes through the RPC channel.
 *
 * What this deliberately does NOT do: stream. A toolview does not exist until
 * the model has finished emitting the call's arguments — verified, not
 * assumed — so there is no partial-payload path to render and no half-parsed
 * JSON to defend against. The running state renders from the complete
 * `argsRaw` instead, which makes the surface appear immediately rather than
 * after `execute` settles.
 *
 * Hand-written in the __ModuleLoader__ factory shape every dsh client bundle
 * uses (same as plugins/design-panel and plugins/brand).
 */
window.__ModuleLoader__.load({
  id: 'arxa-gen-ui',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement

    // Must match the host half exactly; dsh constrains a channel to one URL
    // path segment (/^\/[A-Za-z0-9._~-]+$/) and reserves "/api".
    const RPC_CHANNEL = '/arxa-gen-ui'
    const DEFAULT_RUNGS = [
      { label: 'mobile', w: 390, h: 844 },
      { label: 'tablet', w: 744, h: 1133 },
      { label: 'desktop', w: 1280, h: 832 },
    ]

    // Set by apply(); slot components render without props we control, so the
    // connection reaches the renderers through module scope. Same shape the
    // design panel's settings card uses.
    let hostCtx = null

    // ---- shared chrome ----------------------------------------------------
    const card = {
      border: '1px solid var(--dsw-alias-border-l2, #333)',
      borderRadius: 8,
      background: 'var(--dsw-alias-bg-layer-1, transparent)',
      padding: 12,
      margin: '6px 0',
      font: '13px/1.5 system-ui, sans-serif',
      color: 'var(--dsw-alias-label-primary, inherit)',
    }
    const muted = { color: 'var(--dsw-alias-label-tertiary, #888)' }
    const accent = 'var(--dsw-static-deepseek-450, rgb(122,149,87))'

    // ---- the pending glow --------------------------------------------------
    //
    // An accent outline that travels around a surface while it is still
    // filling in. Two honest caveats about WHEN it can show:
    //
    //  - NOT during reasoning. A toolview does not exist until the tool/call
    //    node does; measured in session e0b1b8ce the card mounts 37ms after
    //    the call and 26s after the user hit enter. Those 26s are the model
    //    thinking, and no card exists to glow.
    //  - The window that IS real is a genuinely slow execution: the block is
    //    still running and nothing is arriving. That is the only time this
    //    ring shows (!settled && !arriving at the toolview below). The
    //    RungLadder iframe boot glows per-rung on its own state, and the
    //    stepwise-assembly gap is covered by the entrance rings themselves.
    //
    // Technique: a masked conic-gradient on ::after paints ONLY the 1px ring
    // (mask-composite cuts the interior out), and the sweep is an animated
    // @property angle — a plain custom property is a string to the animation
    // engine and would jump, not travel. Falls back to a static accent ring
    // where @property is unsupported, and honours prefers-reduced-motion.
    const GLOW_CLASS = 'arxa-genui-pending'
    const GLOW_TAG = 'arxa-gen-ui/glow'
    const GLOW_CSS = `
@property --arxa-glow-angle { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
.${GLOW_CLASS} { position: relative; box-shadow: 0 0 16px -7px ${accent}; }
.${GLOW_CLASS}::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit;
  padding: 1px; pointer-events: none;
  background: conic-gradient(from var(--arxa-glow-angle),
    transparent 0 55%, ${accent} 78%, transparent 92% 100%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
  animation: arxa-glow-sweep 2.4s linear infinite;
}
@keyframes arxa-glow-sweep { to { --arxa-glow-angle: 360deg; } }
@media (prefers-reduced-motion: reduce) {
  .${GLOW_CLASS}::after { animation: none; background: ${accent}; opacity: 0.45; }
}`

    /**
     * Append the glow stylesheet once. Returns true only when it actually
     * inserted — HMR re-runs apply(), and N copies of an animated rule is a
     * real cost, so the guard is the same one arxa-brand uses.
     */
    function installGlow () {
      if (typeof document === 'undefined') return false
      const sel = 'style[data-plugin-css=' + JSON.stringify(GLOW_TAG) + ']'
      if (document.querySelector(sel) !== null) return false
      const tag = document.createElement('style')
      tag.setAttribute('data-plugin-css', GLOW_TAG)
      tag.textContent = GLOW_CSS
      document.head.appendChild(tag)
      return true
    }

    // ---- the arrival window ------------------------------------------------
    //
    // A fresh arrival OWNS the accent: its ring sweeps (600ms) and its content
    // rises (250ms). While that plays, the card-level ring stands down — two
    // rings of different sizes at once is the double-ring the operator kept
    // reporting (clip 10.22.28; runs call_6015227 and call_c944d223).
    //
    // There is deliberately NO warm/tail clock. The warmth window this
    // replaced (1500ms after the last change) only ever manifested as a TAIL
    // PULSE: the measured cadence (705ms, session e0b1b8ce) is shorter than
    // the arrival window, so the card ring never bridged a real gap — it
    // fired exactly once per surface, right after the LAST node finished, and
    // read as that node getting a second ring (operator report, run
    // call_c944d223). What remains is the honest signal: the card ring means
    // THIS BLOCK IS STILL EXECUTING (a genuinely slow gen_ui call — the
    // RungLadder iframe boot glows per-rung on its own), always yielding to
    // an arrival. Sub-second executions never show it, which is correct: the
    // entrance rings ARE the loading choreography.
    const ARRIVAL_MS = 850
    function surfaceArriving (lastChangeAt, now) {
      return typeof lastChangeAt === 'number' && now - lastChangeAt < ARRIVAL_MS
    }

    // ---- the entrance animation -------------------------------------------
    //
    // One 250ms fade+rise per newly arriving component plus one ring sweep,
    // driven entirely by CSS — there is no JS clock anywhere in the tree. The
    // values are researched, not guessed (app-box docs/plans/entrance-animation-research.md):
    //
    //  - EASING: Material 3 "emphasized decelerate", cubic-bezier(0.05, 0.7,
    //    0.1, 1) — the curve M3 assigns to elements ENTERING the screen
    //    (MotionTokens.EasingEmphasizedDecelerateCubicBezier, AOSP source).
    //  - DURATION: 250ms is M3 DurationMedium1, the short end of the medium
    //    band M3 gives small components; entrances over ~500ms read as slow,
    //    under ~100ms as a glitch.
    //  - PROPERTIES: transform + opacity only — they run on the compositor
    //    and cannot trigger layout. The element itself has occupied its final
    //    box since frame one (fill both), so nothing needs to move but pixels.
    //  - DISTANCE: 8px. FlutterFlow's Slide spans whole screens, but for
    //    item-level entrances the consensus is a small rise (4-16px); larger
    //    reads as a notification arriving, not a surface assembling.
    //
    // `both` holds the first frame until the animation starts and the last
    // after it ends — the element occupies its final box the whole time, so
    // nothing else moves. The media query is the WHOLE reduced-motion
    // stand-down: with animation removed the cascade delays are inert, and
    // there is no JS clock left that could keep slicing the paint.
    //
    // The accent GLOW joins the arrival: each entering node sweeps the ring
    // around ITSELF once (600ms, fading out), not just the card container —
    // a ring that only circles the outer card while children pop inside reads
    // as "the card glows, nothing inside does" (operator report 2026-08-23).
    // The ring LEADS, strictly (operator directive, same day: the clip showed
    // ring and content playing TOGETHER — "the ring must always be before the
    // node ui"): the sweep runs [delay, delay+600ms], the rise only starts
    // when the sweep completes. The ring therefore orbits the node's final
    // box while the content is still invisible (fill both holds frame one) —
    // the classic shimmer-then-content order, per node.
    //
    // TWO BOXES, because of a compositing fact: a pseudo-element shares its
    // host's OPACITY. The first version of this put the rise on the ring's
    // own wrapper — fill:both then held the whole box at opacity 0 until the
    // rise started, and the "leading" ring swept inside an invisible element:
    // the ring simply vanished (operator report, third clip). So the ring
    // host NEVER carries an animation, and the fade+rise lives on an inner
    // box. The delay var inherits (custom properties inherit by default), so
    // the inner calc reads the outer's --arxa-enter-delay untouched.
    // Reduced motion hides the ring outright and stops the rise: a static
    // substitute for a one-shot accent is just noise.
    const ENTER_CLASS = 'arxa-genui-enter'
    const RISE_CLASS = 'arxa-genui-enter-rise'
    const ENTER_MS = 250
    const ENTER_TAG = 'arxa-gen-ui/enter'
    const ENTER_CSS = `
@keyframes arxa-genui-enter {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}
.${ENTER_CLASS} { position: relative; }
.${RISE_CLASS} {
  animation: arxa-genui-enter ${ENTER_MS}ms cubic-bezier(0.05, 0.7, 0.1, 1) both;
  animation-delay: calc(var(--arxa-enter-delay, 0ms) + 600ms);
}
.${ENTER_CLASS}::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit;
  padding: 1px; pointer-events: none;
  /* base opacity 0 is the ghost guard: the ::after paints whenever content
     is set, so without it every pending slot would show a static arc
     fragment for its whole pre-sweep window (seen in the lens recording).
     The keyframes fade the ring IN — nothing exists before its sweep — and
     fill forwards holds the faded-out end. */
  opacity: 0;
  background: conic-gradient(from var(--arxa-glow-angle),
    transparent 0 55%, ${accent} 78%, transparent 92% 100%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
  animation: arxa-enter-ring 600ms linear forwards;
  animation-delay: var(--arxa-enter-delay, 0ms);
}
@keyframes arxa-enter-ring {
  0% { --arxa-glow-angle: 0deg; opacity: 0; }
  12% { opacity: 1; }
  82% { opacity: 1; }
  100% { --arxa-glow-angle: 360deg; opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .${RISE_CLASS} { animation: none; }
  .${ENTER_CLASS}::after { content: none; }
}`

    /**
     * Append the entrance stylesheet once. Mirrors installGlow deliberately:
     * the selftest pins that shape, and two small copies beat one shared
     * helper the source-slice tests cannot see whole.
     */
    function installEnter () {
      if (typeof document === 'undefined') return false
      const sel = 'style[data-plugin-css=' + JSON.stringify(ENTER_TAG) + ']'
      if (document.querySelector(sel) !== null) return false
      const tag = document.createElement('style')
      tag.setAttribute('data-plugin-css', ENTER_TAG)
      tag.textContent = ENTER_CSS
      document.head.appendChild(tag)
      return true
    }

    // Mirrors `sandboxFor` in lib/catalog.js — this factory cannot import it
    // (the ModuleLoader gives us `require('react')` and nothing else), the same
    // reason DEFAULT_RUNGS is duplicated above. selftest.mjs runs ONE table
    // against both copies, so drift fails the suite rather than the browser.
    const STRICT_SANDBOX = 'allow-scripts allow-forms'
    const SAME_ORIGIN_SANDBOX = 'allow-scripts allow-forms allow-same-origin'
    function sandboxFor (url, selfHref) {
      if (typeof url !== 'string' || url.trim() === '') return STRICT_SANDBOX
      let target, self
      try {
        target = new URL(url, selfHref)
        self = new URL(selfHref)
      } catch { return STRICT_SANDBOX }
      if (target.protocol !== 'http:' && target.protocol !== 'https:') return STRICT_SANDBOX
      if (target.hostname === '' || target.hostname === self.hostname) return STRICT_SANDBOX
      return SAME_ORIGIN_SANDBOX
    }

    // The scale factor for one rung: fit the measured width, never upscale
    // past 1:1 (a blurry 390px mobile stretched to 700 is a lie about the
    // design), and never let the frame run taller than HEIGHT_CAP of the
    // window — a tablet rung is 1133px and would shove the whole thread.
    // Capping the FACTOR keeps it proportional; clipping would not.
    // Module scope and pure so selftest.mjs runs this exact code.
    const HEIGHT_CAP = 0.7
    function rungScale (w, hgt, avail, vh) {
      return Math.min(
        1,
        vh > 0 ? (HEIGHT_CAP * vh) / hgt : 1,
        avail > 0 ? avail / w : 320 / w)
    }

    // ---- the catalogue renderers -----------------------------------------
    // One function per catalogue entry in lib/catalog.js. Every prop is
    // treated as untrusted and defaulted: the payload is model-authored, so a
    // missing or mistyped prop must degrade, never throw — one bad prop would
    // otherwise blank the whole surface (and, on replay, blank it forever).

    function Heading (props) {
      const level = props.level === 1 ? 1 : props.level === 3 ? 3 : 2
      const size = level === 1 ? 18 : level === 2 ? 15 : 13
      return h('div', {
        style: { fontSize: size, fontWeight: 600, margin: '8px 0 4px' },
      }, String(props.text ?? ''))
    }

    function Text (props) {
      return h('p', {
        style: { margin: '4px 0', ...props.tone === 'muted' ? muted : null },
      }, String(props.text ?? ''))
    }

    function Diff (props) {
      const before = String(props.before ?? '').split('\n')
      const after = String(props.after ?? '').split('\n')
      const rows = []
      const max = Math.max(before.length, after.length)
      // Line-by-line, not a real LCS diff: the payload is small and
      // author-controlled, and a wrong-but-pretty diff is worse than an
      // obvious one. ponytail: upgrade to LCS if real files land here.
      for (let i = 0; i < max; i++) {
        const b = before[i]
        const a = after[i]
        if (b === a) { rows.push(['  ', b ?? '', 'same']); continue }
        if (b !== undefined) rows.push(['- ', b, 'del'])
        if (a !== undefined) rows.push(['+ ', a, 'add'])
      }
      const tone = {
        same: {},
        del: { background: 'rgba(190,80,80,0.14)' },
        add: { background: 'rgba(122,149,87,0.16)' },
      }
      return h('div', { style: { margin: '6px 0' } },
        h('div', { style: { ...muted, fontSize: 12, marginBottom: 4 } }, String(props.path ?? 'diff')),
        h('pre', {
          style: {
            margin: 0, padding: 8, overflowX: 'auto', borderRadius: 6,
            background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.25))',
            font: '12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
          },
        }, rows.map(([sign, line, kind], i) => h('div', {
          key: i, style: { ...tone[kind], whiteSpace: 'pre' },
        }, sign + line))))
    }

    function RungLadder (props) {
      const rungs = Array.isArray(props.rungs) && props.rungs.length > 0
        ? props.rungs
        : DEFAULT_RUNGS
      const [active, setActive] = React.useState(0)
      const [epoch, setEpoch] = React.useState(0)
      const url = typeof props.url === 'string' ? props.url : ''

      // Fill the width the thread actually gives us. This was a hardcoded
      // `Math.min(1, 320 / w, 420 / hgt)`, which pinned the desktop rung to
      // 320x208 inside a ~700px card — a quarter scale for the rung that most
      // needs the room. The cap has to be MEASURED, not guessed: the usable
      // width changes when the sidebar collapses or the details panel opens,
      // so a one-shot read would be wrong for the rest of the session.
      const boxRef = React.useRef(null)
      const [avail, setAvail] = React.useState(0)
      React.useLayoutEffect(() => {
        const el = boxRef.current
        if (!el || typeof ResizeObserver !== 'function') return
        const ro = new ResizeObserver((entries) => {
          const px = entries[0]?.contentRect?.width ?? 0
          // Ignore a transient 0 (collapsed/hidden ancestor) rather than
          // collapsing the frame to nothing and flashing on the way back.
          if (px > 0) setAvail(px)
        })
        ro.observe(el)
        return () => ro.disconnect()
      }, [])
      // The height ceiling. A tablet rung is 1133px tall and at width-fit
      // scale runs to ~1069px — taller than the window, so the card shoves the
      // whole thread around. Cap the FACTOR, not the box: clipping or
      // letterboxing would lie about the design, shrinking does not. Tracked
      // live because the window can be resized.
      const [vh, setVh] = React.useState(
        typeof window === 'undefined' ? 0 : window.innerHeight)
      React.useEffect(() => {
        if (typeof window === 'undefined') return
        const onResize = () => setVh(window.innerHeight)
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [])
      // ONE LIVE DOCUMENT PER RUNG, booted at its own size and never
      // navigated again. This is the only shape that can keep a rung's scroll
      // position: an iframe has exactly one scroll offset, so a shared frame
      // can hold at most one rung's place, and switching necessarily loses the
      // other two. Verified in a real browser (Chrome, CDP): a rung scrolled
      // to 600px, hidden behind another rung and shown again, came back at
      // 600px — display:none preserves both the scroll offset and the live
      // document. Narrow claim on purpose: that was measured against a design
      // with a fixed shell and an inner scroller. A design driven by an
      // IntersectionObserver or ResizeObserver sees display:none as zero-size
      // and may not come back identical.
      //
      // Mounted LAZILY and then kept alive. Booting every rung up front is a
      // live app instance for each viewport nobody has looked at — precisely
      // the cost that made a single shared frame attractive in the first
      // place. Lazy mounting is what makes one-frame-per-rung affordable.
      const [mounted, setMounted] = React.useState(() => ({ [active]: true }))
      const [epochs, setEpochs] = React.useState({})
      const [stale, setStale] = React.useState({})
      const [loaded, setLoaded] = React.useState({})
      const keyOf = (i) => (epochs[i] ?? 0) + ':' + url + ':' + i

      const show = (i) => {
        setActive(i)
        setMounted((m) => (m[i] ? m : { ...m, [i]: true }))
        // A rung that was hidden while the design reloaded is showing
        // pre-reload content — a preview that lies. Reloading it on the way IN
        // is what keeps a refresh scoped to one rung without leaving the
        // others quietly wrong. Do not "simplify" this into reloading them all
        // at reload time: that throws away the scroll position of two rungs
        // the operator is not even looking at, which is the whole feature.
        if (stale[i]) {
          setEpochs((e) => ({ ...e, [i]: (e[i] ?? 0) + 1 }))
          setStale((sx) => { const n = { ...sx }; delete n[i]; return n })
        }
      }

      // ponytail: a frame that never fires load (server down mid-boot) would
      // glow forever and read as broken. 20s ceiling, then give up quietly.
      // Only the rung on screen is worth waiting on.
      const activeKey = keyOf(active)
      const activeLoaded = !!loaded[activeKey]
      React.useEffect(() => {
        if (activeLoaded) return
        const t = setTimeout(
          () => setLoaded((l) => ({ ...l, [activeKey]: true })), 20000)
        return () => clearTimeout(t)
      }, [activeKey, activeLoaded])

      if (!url) return h('div', { style: muted }, 'RungLadder: no url')
      return h('div', { style: { margin: '6px 0' } },
        h('div', { style: { display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' } },
          ...rungs.map((r, i) => h('button', {
            key: (r.label ?? i) + ':' + i,
            onClick: () => show(i),
            style: {
              padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
              border: '1px solid ' + (i === active ? accent : 'var(--dsw-alias-border-l2, #444)'),
              background: i === active ? accent : 'transparent',
              color: i === active ? '#fff' : 'inherit',
            },
          }, `${r.label ?? i} ${r.w}\u00d7${r.h}`)),
          h('button', {
            // Reloads THIS rung only. The others keep their documents and
            // their scroll positions.
            onClick: () => setEpochs((e) => ({ ...e, [active]: (e[active] ?? 0) + 1 })),
            title: 'reload this rung only',
            style: { marginLeft: 'auto', padding: '3px 8px', cursor: 'pointer', fontSize: 12 },
          }, '\u27f3')),
        // The measured element is a full-width block and stays mounted whatever
        // the rungs do, so a hidden rung can never feed a 0 width back into the
        // scale. Measuring a rung box itself would feed its own width into its
        // own scale and oscillate.
        h('div', { ref: boxRef, style: { width: '100%' } },
          ...rungs.map((r, i) => {
            if (!mounted[i]) return null
            const rw = Number(r.w) || 390
            const rh = Number(r.h) || 844
            const rs = rungScale(rw, rh, avail, vh)
            const k = keyOf(i)
            return h('div', {
              key: 'rung:' + i,
              className: loaded[k] ? undefined : GLOW_CLASS,
              style: {
                display: i === active ? 'block' : 'none',
                width: rw * rs, height: rh * rs, overflow: 'hidden',
                // A rung narrower than the card is centred, not left-hugged.
                margin: '0 auto',
                border: '1px solid var(--dsw-alias-border-l2, #333)', borderRadius: 6,
              },
            },
            h('iframe', {
              key: k,
              src: url,
              onLoad: () => setLoaded((l) => ({ ...l, [k]: true })),
              width: rw,
              height: rh,
              // `url` arrives in model-supplied tool args, so it is sandboxed —
              // unlike the design panel's iframe, whose URL the operator typed.
              //
              // Decision 19 said allow-same-origin "would silently mean no
              // sandbox at all". That is true ONLY when the frame is same-origin
              // with us (MDN: the escape is conditional), and withholding it
              // unconditionally gave the frame an OPAQUE origin — which is why
              // every ladder rendered black while the panel rendered fine: a
              // server-rendered artifact cannot boot without its own origin.
              // sandboxFor grants it only for a genuinely foreign http(s) host
              // and fails closed on everything else.
              sandbox: sandboxFor(url, window.location.href),
              style: {
                border: 0, transform: `scale(${rs})`, transformOrigin: 'top left',
                background: '#fff',
              },
            }))
          })))
    }

    function Choice (props, ctxProps) {
      const options = Array.isArray(props.options) ? props.options : []
      const multiple = props.allowMultiple === true
      const { surfaceId, componentId } = ctxProps
      const [picked, setPicked] = React.useState(multiple ? [] : null)
      const [phase, setPhase] = React.useState('idle')

      // Restore the durable selection (stage 3). React state does not survive
      // reload; the host-side record does, so the card re-renders showing what
      // the user already chose instead of silently forgetting it.
      React.useEffect(() => {
        let live = true
        ;(async () => {
          try {
            const res = await hostCtx.connection.rpc.call(RPC_CHANNEL, 'state', { surfaceId })
            if (!live || !res?.ok) return
            const prior = res.value?.selections?.[componentId]
            if (prior !== undefined) setPicked(prior)
          } catch { /* no prior selection; the fresh card stands */ }
        })()
        return () => { live = false }
      }, [surfaceId, componentId])

      const commit = async (next) => {
        setPicked(next)
        setPhase('saving')
        try {
          const res = await hostCtx.connection.rpc.call(
            RPC_CHANNEL, 'select', { surfaceId, componentId, value: next })
          setPhase(res?.ok ? 'saved' : 'error')
        } catch { setPhase('error') }
      }

      const isPicked = (id) => multiple
        ? Array.isArray(picked) && picked.includes(id)
        : picked === id
      const toggle = (id) => commit(multiple
        ? (Array.isArray(picked) && picked.includes(id)
            ? picked.filter((x) => x !== id)
            : [...(Array.isArray(picked) ? picked : []), id])
        : id)

      return h('div', { style: { margin: '6px 0' } },
        h('div', { style: { fontWeight: 600, marginBottom: 6 } }, String(props.prompt ?? 'Choose')),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
          ...options.map((opt, i) => {
            const id = String(opt?.id ?? i)
            const on = isPicked(id)
            return h('button', {
              key: id,
              onClick: () => toggle(id),
              style: {
                textAlign: 'left', padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                border: '1px solid ' + (on ? accent : 'var(--dsw-alias-border-l2, #444)'),
                background: on ? 'rgba(122,149,87,0.16)' : 'transparent',
                color: 'inherit', font: 'inherit',
              },
            },
              h('div', { style: { fontWeight: on ? 600 : 400 } },
                (multiple ? (on ? '☑ ' : '☐ ') : (on ? '◉ ' : '○ ')) + String(opt?.label ?? id)),
              opt?.description
                ? h('div', { style: { ...muted, fontSize: 12 } }, String(opt.description))
                : null)
          })),
        // The selection is recorded, not sent. Telling the agent is the user's
        // move — typing it. Auto-injecting a synthetic user turn on click is
        // exactly the conflation that corrupts transcript replay (plan
        // decision 15), so this card does not do it.
        h('div', { style: { ...muted, fontSize: 12, marginTop: 6 } },
          phase === 'saving' ? 'saving…'
            : phase === 'error' ? 'could not record that selection'
              : picked === null || (Array.isArray(picked) && picked.length === 0)
                ? 'Pick one, then tell the agent your choice.'
                : 'Recorded. Tell the agent to continue.'))
    }

    /**
     * Whether to DRESS something as pending. Not the same question as "is it
     * pending": a skeleton shown for a load that resolves in 200ms flashes and
     * reads as a glitch, which is the documented reason our first glow was
     * never visible. So the treatment is withheld until the wait has actually
     * earned it. Under the threshold the component simply appears.
     */
    const PENDING_AFTER_MS = 400
    function usePending (ready) {
      const [late, setLate] = React.useState(false)
      React.useEffect(() => {
        if (ready) { setLate(false); return }
        const t = setTimeout(() => setLate(true), PENDING_AFTER_MS)
        return () => clearTimeout(t)
      }, [ready])
      return !ready && late
    }

    // ---- the staggered entrance --------------------------------------------
    //
    // The materials all arrive at once (measured: tool arguments come in ONE
    // chunk on this provider, and that is provider-dependent, so nothing is
    // built on it). This is therefore an ENTRANCE ANIMATION, not streaming —
    // worth saying plainly, because calling it streaming would be a lie about
    // where the data came from.
    //
    // Every node of a LIVE surface enters INDIVIDUALLY: the fold ledger
    // records when each component id first joined the surface (firstSeen:
    // id -> call ordinal), and a render cascades each batch — the initial
    // snapshot is one batch, each fold step's additions another — with
    // per-node animation-delay steps in depth-first reading order. Nodes
    // from older batches keep their original delay VALUES, so a growth
    // re-render never restarts a finished animation; replay gets
    // reveal=false and paints bare (claimReveal). Heights are real from the
    // first commit — the element itself occupies its final box while
    // fill:both holds frame one — so nothing jumps and no stand-in slots or
    // JS clocks are needed anywhere in the tree. The CSS media query is the
    // whole reduced-motion stand-down: with animation:none the delays are
    // inert.
    //
    // The numbers are researched, not tuned by feel (app-box
    // docs/plans/entrance-animation-research.md): 90ms sits inside the 50-100ms
    // stagger consensus (FlutterFlow exposes the same knob as a per-widget
    // Delay; Material choreographs menus the same way), and the cap keeps a
    // 20-component surface near 0.7s because excessive motion measurably
    // RAISES perceived delay (streaming-generative-ui-research.md §6).
    const STAGGER_MS = 90
    const STAGGER_MAX_MS = 720

    /**
     * Delay for the batchIndex-th node of a mounting batch. The cap keeps a
     * large batch near 0.7s total rather than stretching with the surface.
     */
    function cascadeDelay (batchIndex) {
      return Math.min(batchIndex * STAGGER_MS, STAGGER_MAX_MS)
    }

    // Animate a surface ONCE, and only when it happened while this page was
    // open. Scrollback and reload must paint instantly: the toolview is a pure
    // function of persisted meta and "identical render forever" is the whole
    // point of stage 2. A surface whose call predates this page load is
    // history, not news.
    const LIVE_SINCE = Date.now()
    const revealed = new Set()
    // Claims the id as it answers. Deciding and remembering must be ONE
    // operation: split across predicate-and-caller, a second call site would
    // quietly re-animate a surface that had already assembled.
    function claimReveal (callId, callTime) {
      if (typeof callId !== 'string' || callId === '') return false
      if (revealed.has(callId)) return false
      if (typeof callTime !== 'number' || callTime < LIVE_SINCE) return false
      revealed.add(callId)
      return true
    }

    /** A reserved slot: real height, so nothing jumps when content lands. */
    function Slot ({ height, label, pending }) {
      return h('div', {
        className: pending ? GLOW_CLASS : undefined,
        style: {
          height: height || 120, borderRadius: 6,
          border: '1px dashed var(--dsw-alias-border-l2, #444)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          ...muted, fontSize: 12,
        },
      }, label || '')
    }

    const GLYPHS = {
      check: '✓', warn: '⚠', info: 'ℹ', error: '✕', star: '★',
      arrow: '→', external: '↗', file: '▤', folder: '▸', play: '▶',
    }
    function Icon (props) {
      const size = Number(props.size) || 16
      // An unknown name is a neutral dot, never a broken glyph box: the name
      // is model-authored and the catalogue only constrains the COMPONENT.
      return h('span', {
        style: { fontSize: size, lineHeight: 1, display: 'inline-block' },
        title: String(props.name ?? ''),
      }, GLYPHS[String(props.name)] ?? '•')
    }

    function Button (props) {
      const primary = props.tone === 'primary'
      // Inert by design: a button that silently did nothing would be worse
      // than one that says so. Choice is the component that records an answer.
      return h('button', {
        type: 'button',
        disabled: true,
        title: 'display only — use Choice for an answer the agent can read',
        style: {
          padding: '5px 12px', borderRadius: 6, cursor: 'default',
          border: '1px solid ' + (primary ? accent : 'var(--dsw-alias-border-l2, #444)'),
          background: primary ? accent : 'transparent',
          color: primary ? '#0d0d10' : 'inherit',
          fontWeight: primary ? 600 : 400, font: 'inherit',
        },
      }, String(props.label ?? 'Button'))
    }

    function Image (props) {
      const src = typeof props.src === 'string' ? props.src : ''
      const height = Number(props.height) || 0
      const [state, setState] = React.useState('loading')
      const pending = usePending(state !== 'loading')
      if (!src) return h(Slot, { height, label: 'Image: no src' })
      return h('div', { style: { position: 'relative' } },
        state !== 'ready'
          ? h(Slot, {
            height,
            pending,
            label: state === 'error' ? 'image did not load' : '',
          })
          : null,
        h('img', {
          src,
          alt: String(props.alt ?? ''),
          onLoad: () => setState('ready'),
          onError: () => setState('error'),
          style: {
            display: state === 'ready' ? 'block' : 'none',
            maxWidth: '100%', borderRadius: 6,
            ...height ? { height } : {},
          },
        }))
    }

    function Card (props, ctx) {
      const kids = Array.isArray(props.children) ? props.children : []
      return h('div', {
        style: {
          border: '1px solid var(--dsw-alias-border-l2, #333)',
          borderRadius: 8, padding: 12, margin: '6px 0',
          display: 'flex', flexDirection: 'column', gap: 8,
        },
      },
        props.title ? h('div', { style: { fontWeight: 600 } }, String(props.title)) : null,
        ...kids.map((id) => ctx.renderChild(String(id))))
    }

    const RENDERERS = { Heading, Text, Choice, Diff, RungLadder, Card, Button, Icon, Image }

    // ---- surface rendering -------------------------------------------------

    /**
     * Fold canonical A2UI v0.9 envelopes into the component list to draw.
     * Tolerant by design: an unknown verb or a malformed envelope is skipped,
     * never thrown, because this runs on replay against payloads written by
     * older builds.
     */
    function componentsFrom (messages) {
      if (!Array.isArray(messages)) return []
      let components = []
      for (const msg of messages) {
        if (typeof msg !== 'object' || msg === null) continue
        const body = msg.updateComponents ?? msg.surfaceUpdate // v0.8 alias
        if (body && Array.isArray(body.components)) components = body.components
      }
      return components
    }

    // Components whose visible ink is smaller than their block box: Text and
    // Heading render full-width blocks for one left-aligned line, Icon a
    // 16px glyph, Button an inline-block PILL (no width in its style — the
    // "full-width CTA bar" assumption came from the sim fixture's block div,
    // not the real renderer; measured against client.js Button 2026-08-23).
    // A block wrapper would sweep the ring around the whole ROW regardless
    // of content — the ring must be the size of the NODE (operator
    // directive), so fit-content shrinks the wrapper to the ink.
    // Deliberately NOT: Card (a growing container — it rises ringless, see
    // renderEntry), Choice/Diff (full-width widgets by design), RungLadder
    // (measures its container — shrink-wrap breaks the scale math), Image
    // (pre-load there is no intrinsic size — the wrapper would collapse).
    const FIT_RING = new Set(['Text', 'Heading', 'Icon', 'Button'])

    // Renderers needing surface identity get it as a second argument rather
    // than as props, so a model-authored prop can never shadow surfaceId or
    // componentId — the two keys the durable selection record is stored under.
    function renderEntry (surfaceId, entry, i, index, reveal, firstSeen, batchCounts) {
      const id = String(entry?.id ?? i)
      const Renderer = RENDERERS[entry?.component]
      if (!Renderer) {
        // A component outside the catalogue. The host rejects these at execute
        // time, so reaching here means a payload written by a build whose
        // catalogue differed — say so instead of rendering nothing.
        return h('div', { key: id, style: { ...muted, fontSize: 12, fontStyle: 'italic' } },
          `[${String(entry?.component)} — not in this build's catalogue]`)
      }
      const { id: _id, component: _c, ...props } = entry
      const hostProps = { Renderer, props, surfaceId, componentId: id, index, reveal, firstSeen, batchCounts }
      // Only a LIVE surface earns motion: replay and scrollback must paint
      // identically forever, which is why claimReveal decided once. The class
      // is inert without ENTER_CSS, and ENTER_CSS is inert under reduced
      // motion — each layer fails safe on its own.
      //
      // Every node enters INDIVIDUALLY: the delay is its position within its
      // BATCH (the ordinal of the call that first added this id to the
      // surface), counted depth-first in reading order across the whole
      // surface render. Synchronized per-node animations are
      // indistinguishable from one block animation — the operator's report —
      // so the batch steps at the researched STAGGER_MS instead. Nodes from
      // older batches keep the same delay VALUES on every re-render (batch
      // membership and pre-order position are stable under growth), so a
      // finished animation never restarts; a fold step's additions form
      // their own batch and cascade from their own mount.
      if (reveal !== true) return h(RendererHost, { key: id, ...hostProps })
      const seenAt = firstSeen instanceof Map ? firstSeen.get(id) : undefined
      let delay = 0
      if (typeof seenAt === 'number') {
        const n = batchCounts.get(seenAt) ?? 0
        batchCounts.set(seenAt, n + 1)
        delay = cascadeDelay(n)
      }
      // A Card rises RINGLESS. Its box at mount is not the node it produces:
      // in a stepwise assembly the first call lands an EMPTY card (children:[]
      // — measured, run call_c944d223) whose 26px sliver gets a ring, and the
      // card the user ends up with never does. The ring must be the size of
      // the node it announces (operator directive), a growing container has
      // no honest size at mount, and its children each ring on their own
      // arrival — so the container simply rises, at its batch delay with NO
      // 600ms ring offset (there is no ring to wait for).
      if (entry?.component === 'Card') {
        return h('div', {
          key: id, className: RISE_CLASS,
          style: { animationDelay: delay + 'ms' },
        }, h(RendererHost, hostProps))
      }
      // Ring host outside, rise box inside — the host must NEVER fade or it
      // takes its ::after ring down with it (pseudo-elements share host
      // opacity; the ring would sweep inside an invisible box, which is
      // exactly the regression this split fixes).
      return h('div', {
        key: id, className: ENTER_CLASS,
        // The delay is a custom property, not animationDelay: the ring on
        // ::after must read it too, and a shorthand delay on the wrapper
        // cannot reach a pseudo-element. React passes custom properties
        // through style untouched, and the rise box INHERITS the var.
        // fit-content is the ring's size contract (FIT_RING above).
        style: {
          ...(delay > 0 ? { '--arxa-enter-delay': delay + 'ms' } : null),
          ...(FIT_RING.has(entry?.component)
            ? { width: 'fit-content', maxWidth: '100%' } : null),
        },
      }, h('div', { className: RISE_CLASS }, h(RendererHost, hostProps)))
    }

    function RendererHost ({ Renderer, props, surfaceId, componentId, index, reveal, firstSeen, batchCounts }) {
      // A Card names its children by id; resolution happens here so a renderer
      // never sees the whole surface — it can draw its own children and
      // nothing else. A missing id says so rather than rendering blank.
      const renderChild = (id) => {
        const child = index instanceof Map ? index.get(id) : undefined
        if (child === undefined) {
          return h('div', {
            key: id,
            style: { ...muted, fontSize: 12, fontStyle: 'italic' },
          }, `[${id} — no such component in this surface]`)
        }
        return renderEntry(surfaceId, child, id, index, reveal, firstSeen, batchCounts)
      }
      return Renderer(props, { surfaceId, componentId, renderChild, reveal })
    }

    /**
     * Mirrors `claimedChildren` in lib/catalog.js — this factory cannot import
     * it, the same two-list contract as DEFAULT_RUNGS and sandboxFor.
     * selftest.mjs runs ONE table against both so they cannot drift.
     */
    function claimedChildren (components) {
      const claimed = new Set()
      if (!Array.isArray(components)) return claimed
      for (const entry of components) {
        if (entry?.component !== 'Card' || !Array.isArray(entry.children)) continue
        for (const kid of entry.children) if (typeof kid === 'string') claimed.add(kid)
      }
      return claimed
    }

    /**
     * Draw one surface. Top level holds every component EXCEPT those a Card
     * claims — those are drawn inside their card instead, never twice.
     * Tolerant like componentsFrom: this also runs on replay against payloads
     * from builds whose validation differed, so a dangling id must draw a note
     * rather than throw the whole card away.
     */
    function renderSurface (surfaceId, components, reveal, firstSeen) {
      if (!Array.isArray(components)) return []
      const index = new Map(components.map((e, i) => [String(e?.id ?? i), e]))
      const claimed = claimedChildren(components)
      // One batch-count map per RENDER: the cascade counts within each batch
      // across the whole surface in pre-order, and a re-render with
      // unchanged content recomputes identical delays — StrictMode's double
      // render and the warmth lapse tick both stay harmless.
      const batchCounts = new Map()
      return components
        .filter((e, i) => !claimed.has(String(e?.id ?? i)))
        .map((e, i) => renderEntry(surfaceId, e, i, index, reveal, firstSeen, batchCounts))
    }

    // ---- the surface fold --------------------------------------------------
    //
    // glm-5.3 (measured 2026-08-23, session e0b1b8ce) answers "assemble the
    // card stepwise" with N rapid gen_ui calls, each a PREFIX SNAPSHOT of the
    // next — and zai does not stream tool arguments (0 tool-call-chunks rows,
    // the §7 measurement), so per-call granularity is the only kind there is.
    // Without a fold that renders as N disjoint cards; with it, as ONE card
    // assembling in place — streaming-generative-ui-research.md §8.2.
    //
    // Two fold paths:
    //  - EXPLICIT: the model passed a surfaceId (the schema offers one and the
    //    result receipt echoes it). Identity match, replace semantics — any
    //    shape, even a shrink. A surfaceId equal to this call's OWN callId is
    //    the host's default stamping, not a choice, and is treated as absent;
    //    one naming an existing surface's HOST callId folds home, because
    //    that is exactly the id the receipt taught the model.
    //  - HEURISTIC (no usable surfaceId): same title + the surface's current
    //    snapshot is an (id, component) prefix of the new call's — the
    //    observed stepwise pattern. The newest candidate wins. An equal
    //    snapshot folds (a resend); an empty one never does.
    //
    // Determinism: everything keys off persisted callIds and times, so a
    // reload re-folds identically. Registration is idempotent per callId
    // because StrictMode double-invokes initializers.
    function isPrefixChain (prev, next) {
      if (!Array.isArray(prev) || !Array.isArray(next)) return false
      if (next.length < prev.length) return false
      for (let i = 0; i < prev.length; i++) {
        if (String(prev[i]?.id) !== String(next[i]?.id)) return false
        if (prev[i]?.component !== next[i]?.component) return false
      }
      return true
    }

    function foldCall (surfaces, call) {
      const { callId, surfaceId, title, components, time } = call
      for (const surface of surfaces.values()) {
        if (surface.callIds.has(callId)) {
          return {
            key: surface.key, hostCallId: surface.hostCallId,
            renderId: surface.renderId,
            ordinal: surface.ordinals.get(callId), title: surface.title,
            components: surface.components, changed: false,
            lastChangeAt: surface.lastChangeAt, firstSeen: surface.firstSeen,
          }
        }
      }
      const usableId = typeof surfaceId === 'string' && surfaceId !== '' &&
        surfaceId !== callId ? surfaceId : null
      let surface = null
      if (usableId !== null) {
        surface = surfaces.get('id:' + usableId) ?? null
        if (surface === null) {
          for (const s of surfaces.values()) {
            if (s.hostCallId === usableId) { surface = s; break }
          }
        }
      } else if (components.length > 0) {
        let best = null
        for (const s of surfaces.values()) {
          if (s.title !== title) continue
          if (!(s.lastTime <= time)) continue
          if (!isPrefixChain(s.components, components)) continue
          if (best === null || s.lastTime > best.lastTime) best = s
        }
        surface = best
      }
      if (surface === null) {
        const key = usableId !== null ? 'id:' + usableId : 'auto:' + callId
        surface = {
          key, title, hostCallId: callId, renderId: usableId ?? callId,
          components, lastTime: time, lastChangeAt: time,
          callIds: new Set(), ordinals: new Map(), firstSeen: new Map(),
        }
        surfaces.set(key, surface)
      } else if (!(surface.lastTime > time)) {
        surface.components = components
        surface.lastTime = time
        surface.lastChangeAt = time
      }
      surface.callIds.add(callId)
      const ordinal = surface.callIds.size
      surface.ordinals.set(callId, ordinal)
      // Stamp ids that joined with THIS call — the batch the entrance
      // cascade groups them into. Ids that were already here keep their
      // original stamp, which is what stops growth re-renders from
      // restarting finished animations. Idempotent like the rest of the
      // fold: a re-registered callId returns above before reaching this.
      for (let ci = 0; ci < surface.components.length; ci++) {
        const cid = String(surface.components[ci]?.id ?? ci)
        if (!surface.firstSeen.has(cid)) surface.firstSeen.set(cid, ordinal)
      }
      return {
        key: surface.key, hostCallId: surface.hostCallId,
        renderId: surface.renderId, ordinal,
        title: surface.title, components: surface.components, changed: true,
        lastChangeAt: surface.lastChangeAt, firstSeen: surface.firstSeen,
      }
    }

    // The ledger is module state: every gen_ui toolview on the page folds
    // into it, which is what lets a LATER call grow an EARLIER block's card.
    // Notification is deferred a tick — foldCall runs during a render, and a
    // listener setState landing mid-render is React's classic warning.
    const SURFACES = new Map()
    const SURFACE_LISTENERS = new Map() // surface key -> Set<listener>
    function subscribeToSurface (key, fn) {
      let set = SURFACE_LISTENERS.get(key)
      if (set === undefined) { set = new Set(); SURFACE_LISTENERS.set(key, set) }
      set.add(fn)
      return () => set.delete(fn)
    }
    function notifySurface (key) {
      setTimeout(() => {
        const set = SURFACE_LISTENERS.get(key)
        if (set !== undefined) for (const fn of [...set]) fn()
      }, 0)
    }

    // ---- the toolview ------------------------------------------------------

    function GenUiToolView ({ block, toolName }) {
      // Decided once per mount and remembered per callId: a surface assembles
      // the first time it appears and never again. Scrollback, reload and
      // replay paint instantly — "identical render forever" is stage 2's whole
      // promise, and an animation that re-ran on every scroll would break it.
      // `callTime` is `previous?.time ?? null` host-side: a call whose head
      // was dropped (window truncation, or a sub-call whose dispatch-start did
      // not survive) carries null and would silently never animate. The node's
      // own `time` is always set, so fall back to it rather than fail closed
      // into a feature that looks implemented and never runs. The fold reads
      // the same fallback, so both decide on one clock.
      const callTime = typeof block?.callTime === 'number' ? block.callTime : block?.time
      const [reveal] = React.useState(() => claimReveal(block?.callId, callTime))
      const [, setFoldVersion] = React.useState(0)
      // Settled nodes carry `kind: 'tool-result'`; running ones have no `kind`
      // at all (the discriminant is asymmetric — conversation.d.ts:161-276).
      const settled = block && block.kind === 'tool-result'

      const failed = settled && block.isError

      let title = ''
      let surfaceId = ''
      let components = []

      if (!failed && settled) {
        // The durable path: everything comes from persisted presentation meta.
        const meta = block.meta
        if (meta && typeof meta === 'object') {
          title = typeof meta.title === 'string' ? meta.title : ''
          surfaceId = typeof meta.surfaceId === 'string' ? meta.surfaceId : block.callId
          components = componentsFrom(meta.messages)
        } else if (block.call) {
          // No meta. Two ways to get here, both real:
          //  - a SUB-call — the host only projects presentationMeta when
          //    `exec.parent === undefined` (dsh-tools/lib/index.js:3417), and
          //    the sub-call projection never sets meta at all
          //    (ui-conversation childResult, ~:8381);
          //  - window truncation that dropped the meta-bearing event.
          // The call head survives in both cases, so rebuild from the args
          // rather than rendering a blank card.
          try {
            const args = JSON.parse(block.call.argsRaw || '{}')
            title = typeof args.title === 'string' ? args.title : ''
            surfaceId = typeof args.surfaceId === 'string' ? args.surfaceId : block.callId
            components = Array.isArray(args.components) ? args.components : []
          } catch { /* nothing recoverable; the empty card stands */ }
        }
      } else if (!failed && block) {
        // Running: args are already complete (argsRaw is assigned whole from
        // the tool/call event), so the surface can be drawn before `execute`
        // settles rather than showing a spinner. Host-side validation has not
        // run yet, so unknown components simply render their placeholder.
        try {
          const args = JSON.parse(block.argsRaw || '{}')
          title = typeof args.title === 'string' ? args.title : ''
          surfaceId = typeof args.surfaceId === 'string' ? args.surfaceId : block.callId
          components = Array.isArray(args.components) ? args.components : []
        } catch { /* args not parseable yet; fall through to the empty card */ }
      }

      // Fold this call into the surface ledger. An ERROR call never folds —
      // its (invalid) args would anchor a junk surface — it gets a
      // pass-through identity and renders its own card below.
      const fold = failed
        ? {
          key: 'own:' + block.callId, hostCallId: block.callId,
          renderId: block.callId, ordinal: 1, title,
          components: [], changed: false, lastChangeAt: 0,
          firstSeen: new Map(),
        }
        : foldCall(SURFACES, { callId: block.callId, surfaceId, title, components, time: callTime })
      if (fold.changed) notifySurface(fold.key)
      React.useEffect(
        () => subscribeToSurface(fold.key, () => setFoldVersion((v) => v + 1)),
        [fold.key])
      // The arrival window is time-based, so the card must re-render when it
      // ENDS: while this block is still executing, that is the moment the
      // card ring may switch on. Growth already re-renders via the
      // subscription above. One timeout per change, never an interval.
      const [clockNow, setClockNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        const arriveEnds = fold.lastChangeAt + ARRIVAL_MS - Date.now()
        if (arriveEnds <= 0) return undefined
        const t = setTimeout(() => setClockNow(Date.now()), arriveEnds + 30)
        return () => clearTimeout(t)
      }, [fold.lastChangeAt])
      const arriving = surfaceArriving(fold.lastChangeAt, clockNow)

      if (failed) {
        const text = (block.content ?? [])
          .map((c) => (c && c.type === 'text' ? c.text : '')).join('\n').trim()
        return h('div', { style: { ...card, borderColor: 'rgba(190,80,80,0.5)' } },
          h('div', { style: { fontWeight: 600, marginBottom: 4 } }, 'gen_ui failed'),
          h('pre', { style: { margin: 0, whiteSpace: 'pre-wrap', ...muted, font: '12px/1.5 ui-monospace, monospace' } },
            text || 'no detail'))
      }

      if (fold.hostCallId !== block.callId) {
        // A folded-away step. The surface lives in its first call's card,
        // which is already drawing this call's components — one muted line,
        // not a second card. (The disjointed-pieces bug was N of these each
        // rendering the full prefix it carried.)
        return h('div', { style: { ...muted, fontSize: 12, padding: '2px 0' } },
          `↑ assembled into "${fold.title}" — step ${fold.ordinal}`)
      }

      // The host renders the LEDGER's current snapshot, not this block's own:
      // later folded calls grow this card in place, each new child arriving
      // with the enter animation.
      // The card ring means EXECUTING, and even then it yields to an
      // arrival: exactly one accent ring plays at a time — the node's own
      // while it enters, the card's only while the tool runs and nothing is
      // entering. No tail pulse: once the block settles, the surface is
      // done and says so by standing still (run call_c944d223).
      return h('div', { className: !settled && !arriving ? GLOW_CLASS : undefined, style: card },
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 8,
            marginBottom: fold.components.length > 0 ? 8 : 0,
          },
        },
          h('span', { style: { fontWeight: 600 } }, fold.title || toolName || 'gen_ui'),
          settled ? null : h('span', { style: { ...muted, fontSize: 12 } }, '…')),
        h('div', null, ...renderSurface(fold.renderId, fold.components, reveal, fold.firstSeen)))
    }

    function apply (ctx) {
      hostCtx = ctx
      installGlow()
      installEnter()
      ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
        name: 'tool.call.toolview',
        key: 'gen_ui',
      }, GenUiToolView))
    }
    const inject = ['slots', 'connection']

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
