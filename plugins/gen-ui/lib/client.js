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
      // Never scale ABOVE 1:1 — upscaling a 390px mobile rung to fill 700px
      // renders a blurry lie about how the design looks at that viewport.
      // Height follows the same factor, so the frame stays proportional.
      const scale = avail > 0 ? Math.min(1, avail / w) : Math.min(1, 320 / w)
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
            style: {
              width: w * scale, height: hgt * scale, overflow: 'hidden',
              // A rung narrower than the card is centred, not left-hugged.
              // No-op once the rung fills the card (desktop at scale 1).
              margin: '0 auto',
              border: '1px solid var(--dsw-alias-border-l2, #333)', borderRadius: 6,
            },
          },
          h('iframe', {
            key: epoch + ':' + url + ':' + (rung.label ?? active),
            src: url,
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

    const RENDERERS = { Heading, Text, Choice, Diff, RungLadder }

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
    function renderEntry (surfaceId, entry, i) {
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
      return h(RendererHost, { key: id, Renderer, props, surfaceId, componentId: id })
    }

    function RendererHost ({ Renderer, props, surfaceId, componentId }) {
      return Renderer(props, { surfaceId, componentId })
    }

    // ---- the toolview ------------------------------------------------------

    function GenUiToolView ({ block, toolName }) {
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

      return h('div', { style: card },
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 8,
            marginBottom: components.length > 0 ? 8 : 0,
          },
        },
          h('span', { style: { fontWeight: 600 } }, title || toolName || 'gen_ui'),
          settled ? null : h('span', { style: { ...muted, fontSize: 12 } }, '…')),
        h('div', null, ...components.map((entry, i) => renderEntry(surfaceId, entry, i))))
    }

    function apply (ctx) {
      hostCtx = ctx
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
