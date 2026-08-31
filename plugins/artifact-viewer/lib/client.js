// Browser half of arxa-artifact-viewer (D7 + D78-D87). Same hand-written
// __ModuleLoader__ factory shape as design-panel (verified against
// dsh-client-runtime's loader contract). Registers a right-docked panel into
// shell.overlay (additive slot; details is occupied by the conversation
// DetailsPanel).
//
// Task 4 lanes — direct render: markdown via the vendored markdown-it +
// DOMPurify bundle, code/text via the vendored CodeMirror 6 (read-only until
// the Task 7 editor lane), images via <img>, audio/video via native
// elements. Lanes B (sandboxed iframe for html/mdx, pdf.js) land in Task 5;
// the editor in Task 7. All artifact fetches go through the per-org server
// with a short-lived per-file READ token from POST /__arxa/artifacts/token
// (D7/D81) — the token route tells us the org origin; the client never
// guesses it.
window.__ModuleLoader__.load({
  id: 'arxa-artifact-viewer',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement

    const TOKEN_ROUTE = '/__arxa/artifacts/token'
    const VENDOR = (n) => '/__arxa/artifacts/vendor/' + n

    const TEXTY = new Set(['.md', '.mdx', '.txt', '.json', '.yaml', '.yml', '.html', '.htm', '.xml',
      '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.scss', '.py', '.rb', '.go', '.rs',
      '.sh', '.bash', '.zsh', '.sql', '.toml', '.ini', '.cfg', '.env', '.gitignore', '.jsonc'])
    const CODE = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.scss',
      '.py', '.rb', '.go', '.rs', '.sh', '.bash', '.zsh', '.sql', '.toml', '.ini', '.env', '.json', '.jsonc', '.yaml', '.yml'])
    const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.bmp'])
    const AUDIO = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a'])
    const VIDEO = new Set(['.mp4', '.webm', '.mov'])

    function kindFor(name) {
      const ext = (name.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase()
      if (ext === '.md') return { lane: 'markdown', ext }
      if (IMAGE.has(ext)) return { lane: 'image', ext }
      if (AUDIO.has(ext)) return { lane: 'audio', ext }
      if (VIDEO.has(ext)) return { lane: 'video', ext }
      if (ext === '.html' || ext === '.htm' || ext === '.mdx') return { lane: 'iframe', ext }
      if (ext === '.pdf') return { lane: 'pdf', ext }
      if (CODE.has(ext)) return { lane: 'code', ext, lang: ext.replace('.', '') }
      if (TEXTY.has(ext)) return { lane: 'text', ext }
      return { lane: 'unknown', ext }
    }

    const loadedVendors = {}
    function ensureVendor(name, globalName) {
      if (loadedVendors[name]) return loadedVendors[name]
      loadedVendors[name] = new Promise((resolve, rejectP) => {
        if (window[globalName]) return resolve(window[globalName])
        const s = document.createElement('script')
        s.src = VENDOR(name)
        s.onload = () => resolve(window[globalName])
        s.onerror = () => rejectP(new Error('failed to load vendor bundle: ' + name))
        document.head.appendChild(s)
      })
      return loadedVendors[name]
    }

    /** Ask the engine for a per-file read token; returns { token, origin }. */
    async function fetchToken(relPath) {
      const res = await fetch(TOKEN_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ relPath }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || ('token route ' + res.status))
      return body
    }

    function CodeView({ relPath, text }) {
      const ref = React.useRef(null)
      React.useEffect(() => {
        let dead = false
        let view = null
        ensureVendor('codemirror.js', 'ArxaCM').then((CM) => {
          if (dead || !ref.current) return
          const lang = ({ md: 'markdown', markdown: 'markdown', js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'javascript', tsx: 'javascript', jsx: 'javascript', json: 'json', css: 'css', scss: 'css', html: 'html', htm: 'html', yaml: 'yaml', yml: 'yaml' })[(relPath.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase().replace('.', '')]
          const extensions = [...CM.basicSetup, CM.EditorView.editable.of(false)]
          if (lang && CM.langs[lang]) extensions.push(CM.langs[lang]())
          view = new CM.EditorView({ state: CM.EditorState.create({ doc: text, extensions }), parent: ref.current })
        }).catch((e) => { if (ref.current) ref.current.textContent = String(e) })
        return () => { dead = true; if (view) view.destroy() }
      }, [relPath, text])
      return h('div', { ref, style: { border: '1px solid #333', borderRadius: 4, overflow: 'auto', maxHeight: '70vh' } })
    }

    function ArtifactPanel() {
      const [open, setOpen] = React.useState(false)
      const [draft, setDraft] = React.useState('')
      const [state, setState] = React.useState({ phase: 'idle' }) // { phase, kind?, relPath?, url?, text? , note? }

      const openArtifact = async () => {
        const relPath = draft.trim().replace(/^\/+/, '')
        if (!relPath) return
        setState({ phase: 'loading', relPath })
        try {
          const { token, origin } = await fetchToken(relPath)
          const url = origin + '/' + encodeURI(relPath).replace(/%23/g, '%2523') + '?avt=' + encodeURIComponent(token)
          const kind = kindFor(relPath)
          if (kind.lane === 'markdown' || kind.lane === 'code' || kind.lane === 'text') {
            const r = await fetch(url)
            if (!r.ok) throw new Error('fetch ' + r.status)
            const text = await r.text()
            setState({ phase: 'ready', kind, relPath, url, text })
          } else if (kind.lane === 'unknown') {
            const r = await fetch(url, { method: 'HEAD' })
            if (!r.ok && r.status !== 404) throw new Error('fetch ' + r.status)
            setState({ phase: 'ready', kind, relPath, url, note: 'no renderer for this type' })
          } else {
            setState({ phase: 'ready', kind, relPath, url })
          }
        } catch (e) {
          setState({ phase: 'error', relPath, note: String(e && e.message || e) })
        }
      }

      const body = !open ? null
        : h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', padding: '10px 12px', gap: 8 } },
          h('div', { style: { fontWeight: 600 } }, 'artifact viewer'),
          h('form', { onSubmit: (e) => { e.preventDefault(); openArtifact() }, style: { display: 'flex', gap: 6 } },
            h('input', {
              value: draft, onChange: (e) => setDraft(e.target.value),
              placeholder: 'path inside the open org…', spellCheck: false,
              style: { flex: 1, padding: 6, background: 'transparent', color: 'inherit', border: '1px solid #555', borderRadius: 4 },
            }),
            h('button', { type: 'submit', style: { padding: '6px 12px', cursor: 'pointer', borderRadius: 4 } }, 'open')),
          state.phase === 'idle' && h('div', { style: { fontSize: 12, opacity: 0.7 } }, 'open an artifact from the open organisation'),
          state.phase === 'loading' && h('div', { style: { fontSize: 12, opacity: 0.7 } }, 'loading ' + state.relPath + '…'),
          state.phase === 'error' && h('div', { style: { fontSize: 12, color: '#c66' } }, state.note),
          state.phase === 'ready' && h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden', flex: 1 } },
            h('div', { style: { fontSize: 11, opacity: 0.7 } }, state.relPath + ' · ' + state.kind.lane),
            state.kind.lane === 'markdown' && h('div', { className: 'arxa-av-md', style: { overflow: 'auto' },
              dangerouslySetInnerHTML: { __html: window.ArxaMD ? window.ArxaMD.render(state.text) : '<em>markdown bundle loading…</em>' } }),
            (state.kind.lane === 'code' || state.kind.lane === 'text') && h(CodeView, { relPath: state.relPath, text: state.text }),
            state.kind.lane === 'image' && h('img', { src: state.url, alt: state.relPath, style: { maxWidth: '100%' } }),
            state.kind.lane === 'audio' && h('audio', { src: state.url, controls: true, style: { width: '100%' } }),
            state.kind.lane === 'video' && h('video', { src: state.url, controls: true, style: { width: '100%' } }),
            state.kind.lane === 'unknown' && h('div', { style: { fontSize: 12, opacity: 0.7 } }, state.note || 'no renderer'),
            (state.kind.lane === 'iframe' || state.kind.lane === 'pdf') && h('div', { style: { fontSize: 12, opacity: 0.7 } }, 'sandboxed-frame lane lands with Task 5'),
          ))

      return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
        h('div', { style: { display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: open ? '1px solid #333' : 'none' } },
          h('button', {
            onClick: () => setOpen((o) => !o),
            style: { padding: '4px 10px', cursor: 'pointer', borderRadius: 4, border: '1px solid #555', background: 'transparent', color: 'inherit' },
          }, (open ? '▾ ' : '▸ ') + 'artifact viewer')),
        open ? body : null)
    }

    let hostCtx = null
    function apply(ctx) {
      hostCtx = ctx
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'arxa-artifact-viewer', order: 110 }, ArtifactPanel))
    }
    const inject = ['slots', 'connection']
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})