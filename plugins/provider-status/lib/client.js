/**
 * arxa-provider-status browser half: a small pill in the composer's trailing row
 * (slot conversation.input.right, beside the model name and dsh's context meter).
 * Reads the host-computed `providerStatus` projection through the standard
 * `useProjection` slot prop — live push, replay on reconnect, no polling.
 * __ModuleLoader__ factory shape, like plugins/gen-ui/lib/client.js.
 */
window.__ModuleLoader__.load({
  id: 'arxa-provider-status',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement

    // Duplicated from lib/status.js on purpose: the client bundle is a plain browser
    // file with no module graph into lib/. Keep the two in step (selftest asserts parity).
    const relative = (resetsAt, now) => { const s = Math.max(0, Math.round(resetsAt - now / 1000)); const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60); return hh > 0 ? `${hh}h ${mm}m` : `${mm}m` }
    function formatBadge (value, now) {
      if (!value) return undefined
      if (value.resetsAt !== undefined && value.resetsAt * 1000 <= now) return undefined
      const reset = value.resetsAt !== undefined && value.level !== 'ok' ? ` · resets in ${relative(value.resetsAt, now)}` : ''
      return { level: value.level, text: `${value.text}${reset}`, title: value.title ?? value.text }
    }
    const COLOR = { ok: 'var(--dsw-text-muted, #8a8f98)', info: 'var(--dsw-text-muted, #8a8f98)', warn: 'var(--dsw-warning, #d08a00)', limit: 'var(--dsw-danger, #d64545)' }

    function ProviderStatusBadge ({ useProjection }) {
      const value = useProjection('providerStatus')
      const [now, setNow] = React.useState(Date.now())
      React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t) }, []) // re-renders the "resets in" text, and hides the badge once resetsAt passes
      const badge = formatBadge(value, now)
      if (!badge) return null
      return h('span', {
        title: badge.title, 'aria-label': badge.title,
        style: { fontSize: '11px', lineHeight: '18px', padding: '0 6px', borderRadius: '9px', border: `1px solid ${COLOR[badge.level]}`, color: COLOR[badge.level], whiteSpace: 'nowrap' },
      }, badge.text)
    }

    function apply (ctx) {
      ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: 'arxa-provider-status',
        order: 20,
      }, ProviderStatusBadge))
    }
    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
