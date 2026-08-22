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
    //  - The window that IS real is the iframe boot: a RungLadder frames a
    //    live `appbox design serve`, and that app takes seconds to come up.
    //    That is the wait the user actually watches, so that is what glows.
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
      const rung = rungs[Math.min(active, rungs.length - 1)] ?? DEFAULT_RUNGS[0]
      const w = Number(rung.w) || 390
      const hgt = Number(rung.h) || 844

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
      // Never scale ABOVE 1:1 — upscaling a 390px mobile rung to fill 700px
      // renders a blurry lie about how the design looks at that viewport.
      // Height follows the same factor, so the frame stays proportional.
      const scale = rungScale(w, hgt, avail, vh)
      // Keyed by the frame's identity, not a boolean: switching rung or
      // hitting ⟳ remounts the iframe but NOT this component, so a boolean
      // would stay true and the new frame would never glow.
      const frameKey = epoch + ':' + url + ':' + (rung.label ?? active)
      const [loadedKey, setLoadedKey] = React.useState('')
      // ponytail: a frame that never fires load (server down mid-boot) would
      // glow forever and read as broken. 20s ceiling, then give up quietly.
      React.useEffect(() => {
        if (loadedKey === frameKey) return
        const t = setTimeout(() => setLoadedKey(frameKey), 20000)
        return () => clearTimeout(t)
      }, [frameKey, loadedKey])
      const framePending = loadedKey !== frameKey
      if (!url) return h('div', { style: muted }, 'RungLadder: no url')
      return h('div', { style: { margin: '6px 0' } },
        h('div', { style: { display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' } },
          ...rungs.map((r, i) => h('button', {
            key: (r.label ?? i) + ':' + i,
            onClick: () => setActive(i),
            style: {
              padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
              border: '1px solid ' + (i === active ? accent : 'var(--dsw-alias-border-l2, #444)'),
              background: i === active ? accent : 'transparent',
              color: i === active ? '#fff' : 'inherit',
            },
          }, `${r.label ?? i} ${r.w}×${r.h}`)),
          h('button', {
            onClick: () => setEpoch((e) => e + 1),
            title: 'reload this preview',
            style: { marginLeft: 'auto', padding: '3px 8px', cursor: 'pointer', fontSize: 12 },
          }, '⟳')),
        // The measured element is a full-width block; the framed box inside it
        // takes the scaled size. Measuring the scaled box itself would feed its
        // own width back into the scale and oscillate.
        h('div', { ref: boxRef, style: { width: '100%' } },
          h('div', {
            className: framePending ? GLOW_CLASS : undefined,
            style: {
              width: w * scale, height: hgt * scale, overflow: 'hidden',
              // A rung narrower than the card is centred, not left-hugged.
              // No-op once the rung fills the card (desktop at scale 1).
              margin: '0 auto',
              border: '1px solid var(--dsw-alias-border-l2, #333)', borderRadius: 6,
            },
          },
          h('iframe', {
            key: frameKey,
            src: url,
            onLoad: () => setLoadedKey(frameKey),
            width: w,
            height: hgt,
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
              border: 0, transform: `scale(${scale})`, transformOrigin: 'top left',
              background: '#fff',
            },
          }))))
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

    // ---- the staggered reveal ---------------------------------------------
    //
    // The materials all arrive at once (measured: tool arguments come in ONE
    // chunk on this provider, and that is provider-dependent, so nothing is
    // built on it). This is therefore an ENTRANCE ANIMATION, not streaming —
    // worth saying plainly, because calling it streaming would be a lie about
    // where the data came from.
    //
    // What it buys: a surface that assembles instead of blinking into place,
    // and a pending outline that is actually on screen long enough to read.
    // What it costs: content that is ready is deliberately shown late — so it
    // is fast, bounded, and never runs on replay (see shouldReveal).
    const STAGGER_MS = 90
    const STAGGER_MAX_MS = 720

    /**
     * How many of `count` children are on screen at `elapsed` ms.
     * The step shrinks as the surface grows: a 20-component card must not
     * take two seconds to assemble, so the WHOLE reveal is capped.
     * @returns {number} revealed count; the first child is always immediate.
     */
    function revealedCount (count, elapsed) {
      if (!(count > 0)) return 0
      if (!(elapsed >= 0)) return 1
      const step = Math.min(STAGGER_MS, STAGGER_MAX_MS / count)
      return Math.min(count, Math.floor(elapsed / step) + 1)
    }

    // Stand-in heights per component, so an unrevealed child reserves roughly
    // the room it will take. Image and RungLadder carry their own size; the
    // rest are single-line widgets and get a line.
    const SLOT_H = {
      Heading: 26, Text: 20, Icon: 20, Button: 30,
      Diff: 80, Choice: 80, Card: 60, Image: 120, RungLadder: 200,
    }
    function slotHeightFor (entry) {
      if (entry?.component === 'Image') return Number(entry.height) || SLOT_H.Image
      return SLOT_H[entry?.component] ?? 24
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

    /**
     * Drive the reveal clock. Returns how many children may be drawn.
     * `enabled` false means "all of them, now" — the replay path.
     */
    function useReveal (count, enabled) {
      const [elapsed, setElapsed] = React.useState(enabled ? 0 : Infinity)
      React.useEffect(() => {
        if (!enabled) return
        const t0 = Date.now()
        const step = Math.min(STAGGER_MS, STAGGER_MAX_MS / Math.max(1, count))
        const timer = setInterval(() => {
          const dt = Date.now() - t0
          setElapsed(dt)
          if (revealedCount(count, dt) >= count) clearInterval(timer)
        }, Math.max(16, step / 2))
        return () => clearInterval(timer)
      }, [count, enabled])
      return enabled ? revealedCount(count, elapsed) : count
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
      const shown = useReveal(kids.length, ctx.reveal === true)
      return h('div', {
        style: {
          border: '1px solid var(--dsw-alias-border-l2, #333)',
          borderRadius: 8, padding: 12, margin: '6px 0',
          display: 'flex', flexDirection: 'column', gap: 8,
        },
      },
        props.title ? h('div', { style: { fontWeight: 600 } }, String(props.title)) : null,
        ...kids.map((id, i) => (i < shown
          ? ctx.renderChild(String(id))
          : h(Slot, {
            key: 'slot:' + id,
            height: ctx.slotHeightOf(String(id)),
            pending: true,
          }))))
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

    // Renderers needing surface identity get it as a second argument rather
    // than as props, so a model-authored prop can never shadow surfaceId or
    // componentId — the two keys the durable selection record is stored under.
    function renderEntry (surfaceId, entry, i, index, reveal) {
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
      return h(RendererHost, {
        key: id, Renderer, props, surfaceId, componentId: id, index, reveal,
      })
    }

    function RendererHost ({ Renderer, props, surfaceId, componentId, index, reveal }) {
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
        return renderEntry(surfaceId, child, id, index, reveal)
      }
      const slotHeightOf = (id) =>
        slotHeightFor(index instanceof Map ? index.get(id) : undefined)
      return Renderer(props, {
        surfaceId, componentId, renderChild, slotHeightOf, reveal,
      })
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
    function renderSurface (surfaceId, components, reveal) {
      if (!Array.isArray(components)) return []
      const index = new Map(components.map((e, i) => [String(e?.id ?? i), e]))
      const claimed = claimedChildren(components)
      return components
        .filter((e, i) => !claimed.has(String(e?.id ?? i)))
        .map((e, i) => renderEntry(surfaceId, e, i, index, reveal))
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
      // into a feature that looks implemented and never runs.
      const [reveal] = React.useState(() => claimReveal(
        block?.callId,
        typeof block?.callTime === 'number' ? block.callTime : block?.time))
      // Settled nodes carry `kind: 'tool-result'`; running ones have no `kind`
      // at all (the discriminant is asymmetric — conversation.d.ts:161-276).
      const settled = block && block.kind === 'tool-result'

      if (settled && block.isError) {
        const text = (block.content ?? [])
          .map((c) => (c && c.type === 'text' ? c.text : '')).join('\n').trim()
        return h('div', { style: { ...card, borderColor: 'rgba(190,80,80,0.5)' } },
          h('div', { style: { fontWeight: 600, marginBottom: 4 } }, 'gen_ui failed'),
          h('pre', { style: { margin: 0, whiteSpace: 'pre-wrap', ...muted, font: '12px/1.5 ui-monospace, monospace' } },
            text || 'no detail'))
      }

      let title = ''
      let surfaceId = ''
      let components = []

      if (settled) {
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
            surfaceId = block.callId
            components = Array.isArray(args.components) ? args.components : []
          } catch { /* nothing recoverable; the empty card stands */ }
        }
      } else if (block) {
        // Running: args are already complete (argsRaw is assigned whole from
        // the tool/call event), so the surface can be drawn before `execute`
        // settles rather than showing a spinner. Host-side validation has not
        // run yet, so unknown components simply render their placeholder.
        try {
          const args = JSON.parse(block.argsRaw || '{}')
          title = typeof args.title === 'string' ? args.title : ''
          surfaceId = block.callId
          components = Array.isArray(args.components) ? args.components : []
        } catch { /* args not parseable yet; fall through to the empty card */ }
      }

      // Running: the surface is drawn from args but execute has not returned.
      // Brief for gen_ui (validation only) — it earns its keep for any surface
      // whose host half does real work before settling.
      return h('div', { className: settled ? undefined : GLOW_CLASS, style: card },
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 8,
            marginBottom: components.length > 0 ? 8 : 0,
          },
        },
          h('span', { style: { fontWeight: 600 } }, title || toolName || 'gen_ui'),
          settled ? null : h('span', { style: { ...muted, fontSize: 12 } }, '…')),
        h('div', null, ...renderSurface(surfaceId, components, reveal)))
    }

    function apply (ctx) {
      hostCtx = ctx
      installGlow()
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
