/**
 * arxa-claude-code browser half: the account card inside the "Claude Code (your subscription)"
 * row on Settings → Models (docs/plans/claude-signin-surface-models-page.md).
 *
 * The row itself is stock: index.mjs registers a configurable provider under NS, and
 * dsh-client-ui-settings-models renders every such row with a keyed `settings.models.provider-card`
 * slot inside it (client.js:2040, key = the row's settingsNs). This card registers under that key.
 *
 * D6 (claude-subscription-engine.md): arxa never starts `claude auth login`. The card shows the
 * state the CLI is in, the copyable command, checks again on request and every 3 s while signed
 * out, and can sign the CLI out — which signs the terminal out too (CLAUDE_CONFIG_DIR is shared),
 * so it asks first and says so.
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
    // dsh's own row buttons (ModelsSection.module.css, hashed per build — @deepseek-ai/* is pinned
    // exactly, and selftest.surface.mjs checks the hash still exists in the installed bundle).
    const BTN = 'zGbnIq_secondaryButton'
    const DANGER = 'zGbnIq_dangerButton'

    const CSS_TAG = 'arxa-claude-code'
    const CSS = [
      '.arxa-cc-card{display:flex;flex-direction:column;gap:8px;margin-top:10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.arxa-cc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.arxa-cc-ok{color:var(--dsw-alias-label-primary)}',
      '.arxa-cc-err{color:var(--dsw-alias-label-danger,#e5484d)}',
      '.arxa-cc-code{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-radius:6px;padding:2px 6px}',
      '.arxa-cc-card a{color:var(--dsw-alias-label-primary)}',
    ].join('\n')
    if (typeof document !== 'undefined' && !document.querySelector(`style[data-plugin-css="${CSS_TAG}"]`)) {
      const tag = document.createElement('style'); tag.dataset.pluginCss = CSS_TAG; tag.textContent = CSS; document.head.appendChild(tag)
    }

    const tierOf = (t) => (typeof t === 'string' && t.length > 0 ? t[0].toUpperCase() + t.slice(1) : undefined)
    // The probe's "not logged in" is the state the card already renders; anything else is a real
    // cause (no binary, dead sandbox, timeout — F13) and must stay visible as its own words.
    const isPlainSignedOut = (e) => e === undefined || e === '' || /not logged in|please run \/login|unauthoriz|authentication/i.test(e)

    function Card ({ connection }) {
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
      const refresh = React.useCallback((force) => {
        setBusy(true)
        return call('status', { force: force === true }).then((v) => { if (v) setSt(v); setBusy(false) })
      }, [call])
      React.useEffect(() => { refresh(false) }, [refresh])
      // While signed out, pick the terminal sign-in up on its own (the old authorization flow
      // polled the same way; nothing rendered it).
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

      const errLine = err !== undefined ? h('div', { className: 'arxa-cc-err' }, err) : null
      if (st === undefined) {
        return h('div', { className: 'arxa-cc-card', 'data-arxa-claude-account': '' }, errLine ?? 'Checking the Claude Code sign-in…')
      }
      const again = h('button', { type: 'button', className: BTN, disabled: busy, onClick: () => refresh(true) }, busy ? 'Checking…' : 'Check again')

      if (st.loggedIn) {
        const who = [st.email, tierOf(st.subscriptionType), st.version ? `Claude Code ${st.version}` : undefined].filter(Boolean).join(' · ')
        return h('div', { className: 'arxa-cc-card', 'data-arxa-claude-account': 'in' },
          h('div', { className: 'arxa-cc-ok' }, `Signed in as ${who}`),
          confirm
            ? h('div', { className: 'arxa-cc-row' },
              'Sign the Claude Code CLI out on this Mac? Your terminal signs out too.',
              h('button', { type: 'button', className: DANGER, disabled: busy, onClick: signout }, 'Sign out'),
              h('button', { type: 'button', className: BTN, onClick: () => setConfirm(false) }, 'Cancel'))
            : h('div', { className: 'arxa-cc-row' }, again,
              h('button', { type: 'button', className: DANGER, disabled: busy, onClick: () => setConfirm(true) }, 'Sign out')),
          errLine)
      }
      return h('div', { className: 'arxa-cc-card', 'data-arxa-claude-account': 'out' },
        h('div', null, 'Not signed in. In a terminal run ',
          h('code', { className: 'arxa-cc-code' }, st.signinCommand),
          ' and finish the browser sign-in. This card checks every 3 s and picks it up.'),
        isPlainSignedOut(st.error) ? null : h('div', { className: 'arxa-cc-err' }, st.error),
        h('div', { className: 'arxa-cc-row' },
          h('button', { type: 'button', className: BTN, onClick: copy }, copied ? 'Copied' : 'Copy command'),
          again,
          h('a', { href: st.installUrl, target: '_blank', rel: 'noreferrer' }, 'Install Claude Code ↗')),
        errLine)
    }

    function apply (ctx) {
      ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
        name: 'settings.models.provider-card',
        key: NS,
        inject: () => ({ connection: ctx.connection?.rpc }),
      }, Card))
    }
    exports.apply = apply
    exports.inject = ['slots', 'connection']
    return module.exports
  },
})
