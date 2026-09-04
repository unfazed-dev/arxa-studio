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
 *    renders from. That store updates the instant the user picks a model, so the pill hides and
 *    reappears with the picker rather than waiting for a turn -- and because both surfaces read
 *    one store, the pill and the picker cannot disagree.
 *
 * WIRING RULE (this is what made the pill vanish entirely on 2026-09-05): `exports.inject` is a
 * HARD GATE -- dsh's own contract calls it "service required before the companion can register".
 * `modelDirectories` belongs to another plugin (dsh-client-ui-model-selection), and dsh itself
 * keeps it OUT of that plugin's module-level inject list for exactly this reason. Listing it here
 * makes the whole pill hostage to another plugin's service. So the gate names only core services,
 * and the directory is resolved at RENDER time, defensively: no directory just means no provider
 * filter, which shows the pill rather than hiding it. Degrade visible, never invisible.
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
      const s = Math.max(0, Math.round(resetsAt - now / 1000)); const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60)
      return hh > 0 ? `${hh}h ${mm}m` : `${mm}m`
    }
    function formatBadge (value, now, activeProvider) {
      if (!value) return undefined
      if (activeProvider !== undefined && activeProvider !== value.provider) return undefined
      if (value.resetsAt !== undefined && value.resetsAt * 1000 <= now) return undefined
      const reset = value.resetsAt !== undefined && value.level !== 'ok' ? ` · resets in ${relative(value.resetsAt, now)}` : ''
      return { level: value.level, text: `${value.text}${reset}`, title: value.title ?? value.text }
    }

    const COLOR = { ok: 'var(--dsw-text-muted, #8a8f98)', info: 'var(--dsw-text-muted, #8a8f98)', warn: 'var(--dsw-warning, #d08a00)', limit: 'var(--dsw-danger, #d64545)' }

    function ProviderStatusBadge ({ sessionId, connection, directory }) {
      const [status, setStatus] = React.useState(null)
      const [now, setNow] = React.useState(Date.now())
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

      // Refetch on mount and on every provider switch, then on a slow tick: the host only learns
      // a new number when the SDK reports one, and a missed minute on a usage pill costs nothing.
      // The tick also re-renders the "resets in" text and retires the pill once its window passes.
      React.useEffect(() => {
        refresh()
        const id = setInterval(refresh, 60_000)
        return () => clearInterval(id)
      }, [refresh])

      const badge = formatBadge(status, now, activeProvider)
      if (badge === undefined) return null
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
        inject: (sessionId) => ({
          sessionId,
          connection: ctx.connection?.rpc,
          // Resolved here, at render time, not at apply time: model-selection may register its
          // service after this plugin, and directoryFor() throws outright for a session with no
          // scope (subagent sessions, a session mid-teardown). Either way the pill keeps working
          // without a provider filter -- a visible pill beats a crash inside the composer row.
          directory: (() => {
            try { return ctx.modelDirectories?.directoryFor(sessionId)?.store } catch { return undefined }
          })(),
        }),
      }, ProviderStatusBadge))
    }
    exports.apply = apply
    exports.inject = ['slots', 'connection']
    return module.exports
  },
})
