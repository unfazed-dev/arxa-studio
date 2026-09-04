/**
 * arxa-provider-status browser half.
 *
 * Two inputs, deliberately from different places:
 *
 *  - the STATUS comes over Connection RPC (`current`). It used to arrive by session projection —
 *    a live push — but a projection needs a session event, and a `provider/status` event made the
 *    whole conversation unreadable on reopen (see lib/index.js). Connection RPC is unary, so this
 *    is a pull: on mount, whenever the selected provider changes, and while a turn is running.
 *  - the CURRENT PROVIDER comes from `modelDirectories`, the same store dsh's own model picker
 *    renders from. That store updates the instant the user picks a model, so the pill hides and
 *    reappears with the picker rather than waiting for the next turn — and because both surfaces
 *    read one store, the pill and the picker cannot disagree.
 */
window.__ModuleLoader__.load({
  id: 'arxa-provider-status',
  factory: (require) => {
    var module = { exports: {} }; var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement

    const RPC_CHANNEL = '/rpc/arxa-provider-status'

    // Mirrors lib/status.js formatBadge. selftest.mjs extracts this block and proves the two agree.
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

    const COLOR = { ok: 'var(--dsh-color-fg-muted)', info: 'var(--dsh-color-fg-muted)', warn: 'var(--dsh-color-warning-fg)', limit: 'var(--dsh-color-danger-fg)' }

    function ProviderStatusBadge ({ sessionId, connection, directory }) {
      const [status, setStatus] = React.useState(null)
      // The picker's live selection. `directory` is the same snapshot store the model selector
      // uses, so this re-renders the moment a model is chosen — no turn, no poll.
      const selection = React.useSyncExternalStore(
        (fn) => directory === undefined ? () => {} : directory.subscribe(fn),
        () => directory === undefined ? undefined : directory.getSnapshot(),
      )
      const activeProvider = selection?.current?.provider

      const refresh = React.useCallback(() => {
        if (connection === undefined || sessionId === undefined) return
        connection.call(RPC_CHANNEL, 'current', { sessionId }).then(
          (r) => { if (r && r.ok) setStatus(r.value?.status ?? null) },
          () => {}, // a failed status fetch must never surface as a conversation error
        )
      }, [connection, sessionId])

      // Refetch on mount and on every provider switch, then on a slow tick: the status only
      // changes when a turn produces one, and a missed second on a usage pill costs nothing.
      React.useEffect(() => {
        refresh()
        const id = setInterval(refresh, 15000)
        return () => clearInterval(id)
      }, [refresh, activeProvider])

      const badge = formatBadge(status, Date.now(), activeProvider)
      if (badge === undefined) return null
      return h('span', {
        title: badge.title,
        style: { fontSize: '11px', color: COLOR[badge.level] ?? COLOR.ok, whiteSpace: 'nowrap', padding: '0 6px' },
      }, badge.text)
    }

    function apply (ctx) {
      ctx.inject(['slots', 'modelDirectories', 'connection'], (scope) => scope.slots.inject('conversation.input.right', () => scope.slots.register({
        name: 'conversation.input.right',
        id: 'arxa-provider-status',
        order: 20,
        inject: (sessionId) => ({
          sessionId,
          connection: scope.connection.rpc,
          directory: scope.modelDirectories.directoryFor(sessionId).store,
        }),
      }, ProviderStatusBadge)))
    }
    exports.apply = apply
    exports.inject = ['slots', 'modelDirectories', 'connection']
    return module.exports
  },
})
