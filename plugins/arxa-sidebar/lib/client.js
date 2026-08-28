// Browser half of arxa-sidebar. Hand-written in the __ModuleLoader__ factory
// shape every dsh client bundle uses (same pattern as arxa-brand).
//
// COPIED/ADAPTED FROM: @deepseek-ai/dsh-client-ui-sidebar lib/client.js
// (dsh version 0.1.1-rc.2). Copied pieces, each marked inline:
//   - registrant wiring: NS, service inject list, apply(ctx) with
//     locale.register + slots.register({ name: "sidebar", ... }, Root)
//   - collapse/width handling: collapsed/width slot props from the layout
//     owner (@deepseek-ai/dsh-client-ui-layout — owner state is ONLY
//     collapsed/width), toggleSidebar via injected callback
//   - list rendering: react createElement list pattern of the session tree
// The original package is untouched, byte-identical, reference only
// (selftest.mjs hashes it). All sidebar DATA comes from this plugin's own
// faces (GET /__arxa/sidebar/state, POST /__arxa/sidebar/action) — never
// from dsh session stores. No localStorage: the layout store is transient
// by dsh contract, and this plugin keeps selection in component state only.
// Brand accent rides the existing seams (--dsw-alias-* vars retinted by
// arxa-theme-accent / arxa-brand) — no palette is defined here.
window.__ModuleLoader__.load({
  id: 'arxa-sidebar',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    let react = require('react')
    let jsx = require('react/jsx-runtime')
    const h = (type, props, ...children) =>
      react.createElement(type, props, ...children)

    // ---- styles (namespaced aXa_sb_*; alias vars only — accent flows from
    // the theme-accent/brand seams) ------------------------------------------
    const CSS = `
.aXa_sb_root{display:flex;flex-direction:column;height:100%;overflow:hidden;font-size:13px}
.aXa_sb_org{display:flex;align-items:center;gap:8px;padding:10px 12px;font-weight:600}
.aXa_sb_orgDot{width:10px;height:10px;border-radius:50%;background:var(--dsw-alias-label-primary);flex:none}
.aXa_sb_switch{margin:0 12px 8px;padding:4px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;width:calc(100% - 24px)}
.aXa_sb_tree{flex:1;overflow-y:auto;padding:0 6px}
.aXa_sb_proj{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:6px;cursor:pointer}
.aXa_sb_proj:hover{background:var(--dsw-alias-interactive-bg-hover)}
.aXa_sb_proj[data-selected="true"]{background:var(--dsw-alias-interactive-bg-hover)}
.aXa_sb_chip{font-size:10px;padding:1px 5px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);opacity:.8}
.aXa_sb_badge{font-size:10px;padding:1px 5px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover)}
.aXa_sb_ctas{display:flex;flex-direction:column;gap:6px;padding:10px 12px}
.aXa_sb_cta{padding:6px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;cursor:pointer;text-align:left}
.aXa_sb_cta:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.aXa_sb_cta:disabled{opacity:.45;cursor:default}
.aXa_sb_empty{opacity:.6;padding:8px 12px}
.aXa_sb_root[data-collapsed="true"] .aXa_sb_label{display:none}
`

    // ---- data faces ---------------------------------------------------------
    const fetchState = async (selectedProject) => {
      const q = selectedProject ? `?project=${encodeURIComponent(selectedProject)}` : ''
      const r = await fetch(`/__arxa/sidebar/state${q}`)
      return r.json()
    }
    const postAction = (action, arg) =>
      fetch('/__arxa/sidebar/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, arg }),
      })

    // ---- root component -----------------------------------------------------
    // COPIED (adapted): prop contract from dsh-client-ui-sidebar SidebarRoot
    // (0.1.1-rc.2) — composed slot props: runtime share (collapsed, width, t)
    // + injected callbacks (toggleSidebar). Width/collapse OWNERSHIP stays
    // with dsh-client-ui-layout; this component only reads the two values.
    function SidebarRoot(props) {
      const collapsed = !!props.collapsed
      const [state, setState] = react.useState(null)
      const [selected, setSelected] = react.useState(null)

      const refresh = react.useCallback(() => {
        fetchState(selected).then(setState).catch(() => {})
      }, [selected])

      react.useEffect(() => {
        refresh()
        const t = setInterval(refresh, 5000)
        window.addEventListener('focus', refresh)
        return () => {
          clearInterval(t)
          window.removeEventListener('focus', refresh)
        }
      }, [refresh])

      const act = (action, arg) => postAction(action, arg).then(refresh)

      const org = state?.org
      const projects = state?.projects ?? []
      const ctas = state?.cta ?? []

      // COPIED (adapted): list rendering pattern — keyed createElement rows,
      // as in the dsh sidebar's session tree (0.1.1-rc.2).
      const tree = projects.map((p) =>
        h(
          'div',
          {
            key: p.id,
            className: 'aXa_sb_proj',
            'data-selected': String(selected === p.id),
            onClick: () => setSelected(selected === p.id ? null : p.id),
          },
          h('span', { className: 'aXa_sb_label' }, p.name),
          ...(p.versionChips ?? []).map((c, i) =>
            h('span', { key: `c${i}`, className: 'aXa_sb_chip' }, c)),
          ...(p.sessionBadges ?? []).map((b, i) =>
            h('span', { key: `b${i}`, className: 'aXa_sb_badge' }, b)),
        ))

      return h(
        'div',
        { className: 'aXa_sb_root', 'data-collapsed': String(collapsed) },
        h(
          'div',
          { className: 'aXa_sb_org', onClick: () => props.toggleSidebar?.() },
          h('span', { className: 'aXa_sb_orgDot', 'aria-hidden': 'true' }),
          h('span', { className: 'aXa_sb_label' }, org ? org.name : 'arxa'),
        ),
        !collapsed && (state?.orgs?.length ?? 0) > 1
          ? h(
              'select',
              {
                className: 'aXa_sb_switch',
                value: org?.id ?? '',
                onChange: (e) => act('org.switch', e.target.value),
              },
              ...state.orgs.map((o) =>
                h('option', { key: o.id, value: o.id }, o.name)),
            )
          : null,
        h(
          'div',
          { className: 'aXa_sb_tree' },
          tree.length ? tree : h('div', { className: 'aXa_sb_empty aXa_sb_label' },
            org ? 'No projects yet' : 'No organisation open'),
        ),
        h(
          'div',
          { className: 'aXa_sb_ctas' },
          ...ctas.map((c) =>
            h(
              'button',
              {
                key: c.id,
                className: 'aXa_sb_cta',
                disabled: !!c.disabled,
                title: c.reserved ? 'Reserved (Phase D3)' : undefined,
                onClick: () => act(c.action, selected ?? undefined),
              },
              h('span', { className: 'aXa_sb_label' }, c.label),
            )),
        ),
      )
    }

    // ---- registrant wiring --------------------------------------------------
    // COPIED (adapted): from dsh-client-ui-sidebar lib/client.js (0.1.1-rc.2)
    // "lib/types/client/index.js" region — same slot NAME ("sidebar", so the
    // layout owner mounts us in its slot; exactly one sidebar is active
    // because profile/cordis.patch.yml disables the ui-sidebar entry), same
    // service inject list minus sessions/workspaces (our data comes from our
    // own faces, not dsh session stores).
    const NS = 'arxa-sidebar'
    const inject = ['slots', 'layout', 'locale']
    function apply(ctx) {
      if (typeof document !== 'undefined' && !document.getElementById('arxa-sidebar-css')) {
        const s = document.createElement('style')
        s.id = 'arxa-sidebar-css'
        s.textContent = CSS
        document.head.appendChild(s)
      }
      ctx.effect(() => ctx.locale.register(NS, {
        en: { 'sidebar.title': 'arxa' },
        zh: { 'sidebar.title': 'arxa' },
      }), 'arxa-sidebar: dictionaries')
      // COPIED (adapted): injected-callback + slot registration shape from
      // dsh-client-ui-sidebar (0.1.1-rc.2). Collapse/width stay owned by the
      // layout plugin; toggleSidebar is the only mutation we forward.
      const injectProps = () => ({
        toggleSidebar: () => {
          ctx.layout.toggleSidebar()
        },
      })
      ctx.effect(() => ctx.slots.register({
        name: 'sidebar',
        locale: NS,
        inject: injectProps,
      }, SidebarRoot), 'arxa-sidebar: slot registration')
    }
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
