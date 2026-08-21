/**
 * arxa-mcp-apps, browser half — stage 4's renderer.
 *
 * Renders an MCP server's UI template in a sandboxed iframe and speaks
 * JSON-RPC 2.0 over postMessage with it, per SEP-1865.
 *
 * ISOLATION — the load-bearing lines in this file:
 *  - `sandbox="allow-scripts"` and NOT `allow-same-origin`. With both, a
 *    same-origin document can reach up and remove its own sandbox attribute,
 *    which MDN describes as no more secure than not sandboxing at all. This
 *    is the single most common real-world mistake in this area, and it is
 *    exactly the mistake that would be tempting if something "didn't work".
 *  - `srcdoc`, so the document is opaque-origin: no access to our cookies,
 *    storage or DOM.
 *  - A CSP `<meta>` built HOST-side from the resource's declared metadata,
 *    injected into the document head. Deny-by-default when nothing is
 *    declared. The host only tightens; a template cannot widen its own CSP.
 *  - The message bridge is a fixed verb allowlist. CSP does not govern a
 *    capability bridge, so its narrowness is the actual control.
 *
 * Single sandboxed iframe, not MCP Apps' double-iframe "sandbox proxy": that
 * architecture defends multi-tenant hosts against cross-tenant confusion,
 * which a single-user localhost harness does not have. If arxa ever serves
 * more than one user, adopt the full architecture wholesale — the shared
 * origin becomes a real cross-user leak at that point.
 */
window.__ModuleLoader__.load({
  id: 'arxa-mcp-apps',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement

    const RPC_CHANNEL = '/arxa-mcp-apps'
    let hostCtx = null

    /** Inject the host-built CSP and a <base> lockdown into the template. */
    function withCsp (html, csp) {
      const meta = `<meta http-equiv="Content-Security-Policy" content="${String(csp).replace(/"/g, '&quot;')}">`
      // Prepending inside <head> when present keeps the policy ahead of any
      // markup that could fetch; otherwise prepend to the document so it still
      // precedes every element.
      if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + meta)
      return meta + html
    }

    function McpAppFrame ({ template, toolName }) {
      const ref = React.useRef(null)
      const [height, setHeight] = React.useState(
        Number(template.preferredSize?.height) || 240)
      const [note, setNote] = React.useState('')

      React.useEffect(() => {
        // Stream-identity guard: every mount gets a token, and a late reply
        // from a torn-down frame is dropped rather than setting state on a
        // dead component. Without this, switching sessions mid-call is the
        // classic stale-closure bug.
        let live = true

        const onMessage = async (event) => {
          const frame = ref.current
          // Only accept messages from OUR iframe's window. An opaque-origin
          // srcdoc frame reports origin "null", so the source check is the
          // real identity test here — not the origin string.
          if (!live || !frame || event.source !== frame.contentWindow) return
          const msg = event.data
          if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return

          const reply = (result) => {
            if (!live || msg.id === undefined) return
            frame.contentWindow?.postMessage({ jsonrpc: '2.0', id: msg.id, result }, '*')
          }
          const fail = (message) => {
            if (!live || msg.id === undefined) return
            frame.contentWindow?.postMessage(
              { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message } }, '*')
          }

          switch (msg.method) {
            case 'ui/initialize':
              reply({
                hostCapabilities: { availableDisplayModes: ['inline'] },
                host: { name: 'arxa studio', version: '0.1.0' },
              })
              return
            case 'ui/notifications/size-changed': {
              const next = Number(msg.params?.height)
              // Clamp: a template must not be able to push the rest of the
              // conversation off-screen, deliberately or by accident.
              if (Number.isFinite(next)) setHeight(Math.max(80, Math.min(720, next)))
              return
            }
            case 'tools/call': {
              // Proxied host-side, where it is allowlisted to this server's
              // own tools. Surfaced in the card so a UI-initiated call is
              // never invisible to the user.
              setNote(`called ${String(msg.params?.name)}`)
              try {
                const res = await hostCtx.connection.rpc.call(RPC_CHANNEL, 'call', {
                  name: msg.params?.name, arguments: msg.params?.arguments,
                })
                if (res?.ok) reply(res.value)
                else fail(res?.error?.message ?? 'call refused')
              } catch (e) { fail(String(e)) }
              return
            }
            default:
              // ui/message and ui/update-model-context are the other two
              // sanctioned channels. Not wired: injecting a synthetic user
              // turn from a click is the conflation that corrupts transcript
              // replay, and it needs a composer seam a toolview does not have.
              fail(`arxa: ${msg.method} is not supported by this host`)
          }
        }

        window.addEventListener('message', onMessage)
        return () => { live = false; window.removeEventListener('message', onMessage) }
      }, [template.resourceUri])

      return h('div', {
        style: {
          border: '1px solid var(--dsw-alias-border-l2, #333)', borderRadius: 8,
          margin: '6px 0', overflow: 'hidden',
          font: '13px/1.5 system-ui, sans-serif',
        },
      },
        h('div', {
          style: {
            display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px',
            borderBottom: '1px solid var(--dsw-alias-border-l2, #333)',
            fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #888)',
          },
        },
          h('span', null, toolName),
          h('span', { style: { marginLeft: 'auto' } }, note || template.resourceUri)),
        h('iframe', {
          ref,
          srcDoc: withCsp(template.html, template.csp),
          // NEVER add allow-same-origin here. See the file header.
          sandbox: 'allow-scripts allow-forms',
          style: { display: 'block', width: '100%', height, border: 0, background: '#fff' },
        }))
    }

    function makeToolView (toolName, template) {
      return function McpAppToolView ({ block }) {
        const settled = block && block.kind === 'tool-result'
        if (!settled) {
          return h('div', { style: { padding: '6px 0', color: 'var(--dsw-alias-label-tertiary, #888)' } },
            `${toolName}…`)
        }
        if (block.isError) {
          const text = (block.content ?? [])
            .map((c) => (c && c.type === 'text' ? c.text : '')).join('\n').trim()
          return h('div', { style: { padding: '6px 0', color: '#c66' } }, text || `${toolName} failed`)
        }
        return h(McpAppFrame, { template, toolName })
      }
    }

    function apply (ctx) {
      hostCtx = ctx
      // Which tool names carry UI is only knowable from the server, so the
      // registration set is discovered at boot and registered late. Slots are
      // reactive — a registration after apply re-renders the affected cards —
      // so this is a supported ordering, not a race.
      ;(async () => {
        try {
          const res = await ctx.connection.rpc.call(RPC_CHANNEL, 'templates', {})
          if (!res?.ok) return
          for (const [toolName, template] of Object.entries(res.value.templates ?? {})) {
            ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
              name: 'tool.call.toolview',
              key: toolName,
            }, makeToolView(toolName, template)))
          }
        } catch { /* no MCP Apps server configured; nothing to claim */ }
      })()
    }
    const inject = ['slots', 'connection']

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
