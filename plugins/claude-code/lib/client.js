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
 * lays out exactly like DeepSeek's, kimi's and zai's rows: name + dot on the left, ONE action on
 * the right — Sign in (like Edit) or Sign out (like Delete). Confirmations open the same Modal
 * the stock Delete uses, never inline in the head (2026-09-06: an inline confirm squeezed the
 * name into two lines).
 *
 * Sign in: the host starts `claude auth login`, the CLI prints its sign-in URL, this card opens
 * it in the browser and takes the code the page shows (the CLI's own paste-a-code flow). The CLI
 * owns the OAuth exchange and the token throughout. Sign out runs `claude auth logout`, which
 * signs the terminal out too (CLAUDE_CONFIG_DIR is shared), so it asks first and says so.
 */
window.__ModuleLoader__.load({
  id: 'arxa-claude-code',
  factory: (require) => {
    var module = { exports: {} }; var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement
    const P = require('@deepseek-ai/dsh-client-ui-primitives')

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
      dialog: 'zGbnIq_deleteDialog', confirm: 'zGbnIq_deleteConfirm', input: 'zGbnIq_input', error: 'zGbnIq_error',
    }

    const CSS_TAG = 'arxa-claude-code'
    const CSS = [
      '.arxa-cc-sub{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:-4px}',
      '.arxa-cc-sub a{color:var(--dsw-alias-label-primary)}',
      '.arxa-cc-code{display:flex;flex-direction:column;gap:8px}',
      `.arxa-cc-code .${C.input}{max-width:none;cursor:text}`,
    ].join('\n')
    if (typeof document !== 'undefined' && !document.querySelector(`style[data-plugin-css="${CSS_TAG}"]`)) {
      const tag = document.createElement('style'); tag.dataset.pluginCss = CSS_TAG; tag.textContent = CSS; document.head.appendChild(tag)
    }

    const tierOf = (t) => (typeof t === 'string' && t.length > 0 ? t[0].toUpperCase() + t.slice(1) : undefined)
    // The probe's "not logged in" is the state the row already renders; anything else is a real
    // cause (no binary, dead sandbox, timeout — F13) and must stay visible in its own words.
    const isPlainSignedOut = (e) => e === undefined || e === '' || /not logged in|please run \/login|unauthoriz|authentication/i.test(e)
    // Same call the git card makes for its run links: the desktop hands _blank to the system browser.
    const openPage = (url) => { try { window.open(url, '_blank', 'noopener') } catch {} }

    function Card ({ provider }) {
      const connection = provider?.connection
      const [st, setSt] = React.useState(undefined)
      const [err, setErr] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)
      // undefined | 'signout' | { url }  — which Modal is open
      const [dialog, setDialog] = React.useState(undefined)
      const [code, setCode] = React.useState('')
      const [dialogErr, setDialogErr] = React.useState(undefined)

      const call = React.useCallback((endpoint, payload) => {
        if (connection === undefined) return Promise.reject(new Error('no connection'))
        return connection.call(ACCOUNT_CHANNEL, endpoint, payload ?? {}).then((r) => {
          if (r && r.ok) return r.value
          throw new Error(r?.error?.message ?? 'no reply')
        })
      }, [connection])
      const refresh = React.useCallback((force) => call('status', { force }).then((v) => { setSt(v); setErr(undefined) }, (e) => setErr(String(e?.message ?? e))), [call])
      React.useEffect(() => { refresh(false) }, [refresh])
      // Signed out: pick a terminal sign-in up on its own, no button to press.
      const loggedIn = st === undefined ? undefined : st.loggedIn
      React.useEffect(() => {
        if (loggedIn !== false) return
        const id = setInterval(() => { refresh(true) }, POLL_MS)
        return () => clearInterval(id)
      }, [loggedIn, refresh])

      const run = (endpoint, payload, after) => {
        setBusy(true); setDialogErr(undefined)
        return call(endpoint, payload).then((v) => { setBusy(false); after(v) }, (e) => { setBusy(false); setDialogErr(String(e?.message ?? e)) })
      }
      const signin = () => run('login', {}, (v) => { openPage(v.url); setCode(''); setDialog({ url: v.url }) })
      const submitCode = () => run('code', { code }, (v) => { setSt(v); setDialog(undefined) })
      const cancelSignin = () => { call('cancel').catch(() => {}); setDialog(undefined); setDialogErr(undefined) }
      const signout = () => run('signout', {}, (v) => { setSt(v); setDialog(undefined) })

      const name = provider?.displayName ?? 'Claude Code (your subscription)'
      const dot = st === undefined ? null : h('span', {
        className: `${C.dot} ${st.loggedIn ? C.dotOk : C.dotMissing}`, role: 'img',
        'aria-label': st.loggedIn ? 'Signed in' : 'Not signed in', title: st.loggedIn ? 'Signed in' : 'Not signed in',
      })
      const action = st === undefined ? null
        : st.loggedIn
          ? h('button', { type: 'button', className: C.danger, disabled: busy, 'aria-label': `Sign out of ${name}`, onClick: () => { setDialogErr(undefined); setDialog('signout') } }, 'Sign out')
          : h('button', { type: 'button', className: C.btn, disabled: busy, 'aria-label': `Sign in to ${name}`, onClick: signin }, busy && dialog === undefined ? 'Starting…' : 'Sign in')

      // Same head as the stock rows, in the stock classes. The stock head of THIS row (its
      // API-key dot and Edit) is hidden on mount: the slot renders inside a wrapper, so the
      // stock head is the `li`'s own child while ours is a grandchild — found by class, hidden
      // inline (the `hidden` attribute loses to `.rowHead{display:flex}`), restored on unmount.
      const headRef = React.useRef(null)
      React.useEffect(() => {
        const li = headRef.current?.closest('li')
        const stock = li === null || li === undefined ? undefined : Array.from(li.children).find((c) => c.classList.contains(C.head) && !c.contains(headRef.current))
        if (stock === undefined) return
        const before = stock.style.display
        stock.style.display = 'none'
        return () => { stock.style.display = before }
      }, [])
      const head = h('div', { ref: headRef, className: C.head, 'data-arxa-claude-account': st === undefined ? '' : st.loggedIn ? 'in' : 'out' },
        h('span', { className: C.identity }, h('span', { className: C.name }, name), dot),
        h('span', { className: C.actions }, action))

      let sub = null
      if (st !== undefined && st.loggedIn) {
        sub = h('div', { className: 'arxa-cc-sub' }, [st.email, tierOf(st.subscriptionType), st.version ? `Claude Code ${st.version}` : undefined].filter(Boolean).join(' · '))
      } else if (st !== undefined) {
        const cause = isPlainSignedOut(st.error) ? undefined : st.error
        sub = h('div', { className: 'arxa-cc-sub' },
          cause !== undefined ? h('span', { className: C.error }, cause) : 'Not signed in',
          /not installed|no claude binary/i.test(cause ?? '') ? h('a', { href: st.installUrl, target: '_blank', rel: 'noreferrer' }, 'Install Claude Code ↗') : null)
      }

      const signoutModal = h(P.Modal, {
        open: dialog === 'signout', onClose: () => setDialog(undefined),
        title: 'Sign out of Claude Code?', closeLabel: 'Close', className: C.dialog,
        description: 'This signs the Claude Code CLI out on this Mac. Your terminal signs out too.',
        footer: h(React.Fragment, null,
          h(P.Button, { variant: 'outline', autoFocus: true, disabled: busy, onClick: () => setDialog(undefined) }, 'Cancel'),
          h(P.Button, { variant: 'outline', className: C.confirm, disabled: busy, onClick: signout }, busy ? 'Signing out…' : 'Sign out')),
      }, dialogErr === undefined ? null : h('p', { className: C.error }, dialogErr))

      const pendingUrl = typeof dialog === 'object' && dialog !== null ? dialog.url : undefined
      const signinModal = h(P.Modal, {
        open: pendingUrl !== undefined, onClose: cancelSignin,
        title: 'Sign in to Claude Code', closeLabel: 'Close', className: C.dialog,
        description: 'Finish signing in on the page that just opened, then paste the code it shows.',
        footer: h(React.Fragment, null,
          h(P.Button, { variant: 'outline', disabled: busy, onClick: cancelSignin }, 'Cancel'),
          h(P.Button, { variant: 'outline', disabled: busy || code.trim() === '', onClick: submitCode }, busy ? 'Signing in…' : 'Continue')),
      }, h('div', { className: 'arxa-cc-code' },
        h('input', {
          className: C.input, type: 'text', autoFocus: true, spellCheck: false, autoComplete: 'off',
          placeholder: 'Paste the code here', 'aria-label': 'Sign-in code', value: code,
          onChange: (e) => setCode(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter' && code.trim() !== '' && !busy) submitCode() },
        }),
        h('a', { href: pendingUrl, target: '_blank', rel: 'noreferrer', onClick: (e) => { e.preventDefault(); openPage(pendingUrl) } }, 'Open the sign-in page again ↗'),
        dialogErr === undefined ? null : h('p', { className: C.error }, dialogErr)))

      return h(React.Fragment, null, head, sub,
        err !== undefined ? h('p', { className: C.error }, err) : null,
        signoutModal, signinModal)
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
