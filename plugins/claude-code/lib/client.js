/**
 * arxa-claude-code browser half: the "Claude Code (your subscription)" row on Settings → Models
 * (docs/plans/claude-signin-surface-models-page.md).
 *
 * The row itself is stock: index.mjs registers a configurable provider under NS, and
 * dsh-client-ui-settings-models renders every such row as `li.rowCard > div.rowHead + <slot>`
 * with a keyed `settings.models.provider-card` slot inside it (client.js:2040, key = the row's
 * settingsNs). This card registers under that key and REPLACES the stock head: the stock one has
 * a credential dot driven by an API-key ref (CLAUDE_CODE_API_KEY — a subscription has none) and an
 * Edit button the user does not need. The replacement uses the stock classes and grammar
 * (ModelsSection.module.css: rowHead / rowIdentity / rowName / credentialDot / rowActions) so it
 * lays out exactly like DeepSeek's, kimi's and zai's rows: name + dot on the left, one action on
 * the right — Sign out where the others have Delete.
 *
 * D6 (claude-subscription-engine.md): arxa never starts `claude auth login`. Signed out, the row
 * shows the copyable command and polls every 3 s until the terminal sign-in lands. Sign out runs
 * `claude auth logout`, which signs the terminal out too (CLAUDE_CONFIG_DIR is shared), so it asks
 * first and says so.
 */
window.__ModuleLoader__.load({
  id: 'arxa-claude-code',
  factory: (require) => {
    var module = { exports: {} }; var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement

    // Must equal index.mjs NS and lib/account.js ACCOUNT_CHANNEL.
    const NS = 'arxa-claude-code'
    const ACCOUNT_CHANNEL = '/arxa-claude-account'
    const POLL_MS = 3000
    // dsh's own row grammar (ModelsSection.module.css, hashed per build — @deepseek-ai/* is pinned
    // exactly, and selftest.surface.mjs checks each hash still exists in the installed bundle).
    const C = {
      head: 'zGbnIq_rowHead', identity: 'zGbnIq_rowIdentity', name: 'zGbnIq_rowName', actions: 'zGbnIq_rowActions',
      dot: 'zGbnIq_credentialDot', dotOk: 'zGbnIq_credentialDotConfigured', dotMissing: 'zGbnIq_credentialDotMissing',
      btn: 'zGbnIq_secondaryButton', danger: 'zGbnIq_dangerButton',
    }

    const CSS_TAG = 'arxa-claude-code'
    const CSS = [
      '.arxa-cc-sub{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:-4px}',
      '.arxa-cc-err{color:var(--dsw-alias-state-error-primary)}',
      '.arxa-cc-code{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-radius:6px;padding:1px 6px}',
      '.arxa-cc-sub a{color:var(--dsw-alias-label-primary)}',
    ].join('\n')
    if (typeof document !== 'undefined' && !document.querySelector(`style[data-plugin-css="${CSS_TAG}"]`)) {
      const tag = document.createElement('style'); tag.dataset.pluginCss = CSS_TAG; tag.textContent = CSS; document.head.appendChild(tag)
    }

    const tierOf = (t) => (typeof t === 'string' && t.length > 0 ? t[0].toUpperCase() + t.slice(1) : undefined)
    // The probe's "not logged in" is the state the row already renders; anything else is a real
    // cause (no binary, dead sandbox, timeout — F13) and must stay visible in its own words.
    const isPlainSignedOut = (e) => e === undefined || e === '' || /not logged in|please run \/login|unauthoriz|authentication/i.test(e)

    function Card ({ provider }) {
      const connection = provider?.connection
      const [st, setSt] = React.useState(undefined)
      const [err, setErr] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)
      const [confirm, setConfirm] = React.useState(false)
      const [copied, setCopied] = React.useState(false)

      const call = React.useCallback((endpoint, payload) => {
        if (connection === undefined) { setErr('no connection'); return Promise.resolve(null) }
        return connection.call(ACCOUNT_CHANNEL, endpoint, payload ?? {}).then(
          (r) => { if (r && r.ok) { setErr(undefined); return r.value } setErr(r?.error?.message ?? 'no reply'); return null },
          (e) => { setErr(String(e?.message ?? e)); return null },
        )
      }, [connection])
      React.useEffect(() => { call('status', { force: false }).then((v) => { if (v) setSt(v) }) }, [call])
      // Signed out: pick the terminal sign-in up on its own — no button to press (D6 says arxa
      // detects, and the user asked for no "check again").
      const loggedIn = st === undefined ? undefined : st.loggedIn
      React.useEffect(() => {
        if (loggedIn !== false) return
        const id = setInterval(() => { call('status', { force: true }).then((v) => { if (v) setSt(v) }) }, POLL_MS)
        return () => clearInterval(id)
      }, [loggedIn, call])

      const signout = () => {
        setConfirm(false); setBusy(true)
        call('signout').then((v) => { if (v) setSt(v); setBusy(false) })
      }
      const copy = () => {
        const p = navigator.clipboard?.writeText(st.signinCommand)
        if (p) p.then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }, () => {})
      }

      const name = provider?.displayName ?? 'Claude Code (your subscription)'
      const dot = st === undefined ? null : h('span', {
        className: `${C.dot} ${st.loggedIn ? C.dotOk : C.dotMissing}`, role: 'img',
        'aria-label': st.loggedIn ? 'Signed in' : 'Not signed in', title: st.loggedIn ? 'Signed in' : 'Not signed in',
      })
      const actions = st === undefined || !st.loggedIn ? null
        : confirm
          ? [h('span', { key: 'q', className: 'arxa-cc-sub', style: { marginTop: 0 } }, 'Sign the Claude Code CLI out on this Mac? Your terminal signs out too.'),
            h('button', { key: 'y', type: 'button', className: C.danger, disabled: busy, onClick: signout }, 'Sign out'),
            h('button', { key: 'n', type: 'button', className: C.btn, onClick: () => setConfirm(false) }, 'Cancel')]
          : h('button', { type: 'button', className: C.danger, disabled: busy, 'aria-label': `Sign out of ${name}`, onClick: () => setConfirm(true) }, busy ? 'Signing out…' : 'Sign out')

      // Same head as the stock rows, in the stock classes. The stock head of THIS row (its
      // API-key dot and Edit) is hidden on mount: the slot renders inside a wrapper, so the
      // stock head is the `li`'s own child while ours is a grandchild — found by class, hidden
      // with the `hidden` attribute, restored on unmount.
      const headRef = React.useRef(null)
      React.useEffect(() => {
        const li = headRef.current?.closest('li')
        const stock = li === null || li === undefined ? undefined : Array.from(li.children).find((c) => c.classList.contains(C.head) && !c.contains(headRef.current))
        if (stock === undefined) return
        // Inline, not the `hidden` attribute: `.rowHead{display:flex}` is an author rule and
        // beats the UA's `[hidden]{display:none}` (seen live 2026-09-06 — the Edit stayed).
        const before = stock.style.display
        stock.style.display = 'none'
        return () => { stock.style.display = before }
      }, [])
      const head = h('div', { ref: headRef, className: C.head, 'data-arxa-claude-account': st === undefined ? '' : st.loggedIn ? 'in' : 'out' },
        h('span', { className: C.identity }, h('span', { className: C.name }, name), dot),
        h('span', { className: C.actions }, actions))

      let sub = null
      if (st !== undefined && st.loggedIn) {
        sub = h('div', { className: 'arxa-cc-sub' }, [st.email, tierOf(st.subscriptionType), st.version ? `Claude Code ${st.version}` : undefined].filter(Boolean).join(' · '))
      } else if (st !== undefined) {
        sub = h('div', { className: 'arxa-cc-sub' },
          'Not signed in — in a terminal run ', h('code', { className: 'arxa-cc-code' }, st.signinCommand),
          h('button', { type: 'button', className: C.btn, style: { height: 24, padding: '0 8px', fontSize: 12, borderRadius: 12 }, onClick: copy }, copied ? 'Copied' : 'Copy'),
          'then finish the browser sign-in; this row picks it up.',
          h('a', { href: st.installUrl, target: '_blank', rel: 'noreferrer' }, 'Install Claude Code ↗'),
          isPlainSignedOut(st.error) ? null : h('span', { className: 'arxa-cc-err' }, st.error))
      }
      return h(React.Fragment, null, head, sub, err !== undefined ? h('div', { className: 'arxa-cc-sub arxa-cc-err' }, err) : null)
    }

    function apply (ctx) {
      // The keyed slot hands the card `{ provider, configured, keyConfigured }`; `inject` folds
      // the RPC face onto `provider` so the props stay one object the slot already passes.
      ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
        name: 'settings.models.provider-card',
        key: NS,
        inject: () => ({ connection: ctx.connection?.rpc }),
      }, ({ provider, connection, ...rest }) => h(Card, { provider: { ...(provider ?? {}), connection }, ...rest })))
    }
    exports.apply = apply
    exports.inject = ['slots', 'connection']
    return module.exports
  },
})
