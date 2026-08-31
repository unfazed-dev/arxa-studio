// Browser half of arxa-artifact-viewer (D7 + D78-D87 + D88-D93). Registers
// the panel into the AppFrame's docked "viewer" seat (arxa-frame generated
// column: session-bound presence, drag handle, maximize, narrow sheet).
// NEVER shell.overlay again — the full-inset overlay blocked all UI (fixed).
//
// Lanes: markdown (vendored markdown-it+DOMPurify), code/text via vendored
// CodeMirror 6 — READ-ONLY until the D80 edit toggle, then EDITABLE with
// saves through POST /__arxa/artifacts/write (write token + session
// worktree + D18 WIP commit). html/mdx render in a sandboxed iframe
// (allow-scripts only, opaque origin) on the per-org origin; pdf via the
// vendored pdf.js worker. Images + audio/video native.
//
// D80 transparent ensure: toggling edit resolves a session worktree WITHOUT
// ceremony — an open session of the open org (most recently updated) is
// reused; when none exists, one is created through the sidebar's
// workspace.new-session action in the 'notes' dock (sessions are born in a
// WORKSPACE per org-model v2 — org-level sessions are gone). The session
// badge keeps 'edits are not on main' visible (D85).
window.__ModuleLoader__.load({
  id: 'arxa-artifact-viewer',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement

    const TOKEN_ROUTE = '/__arxa/artifacts/token'
    const WRITE_ROUTE = '/__arxa/artifacts/write'
    const STATE_ROUTE = '/__arxa/sidebar/state'
    const ACTION_ROUTE = '/__arxa/sidebar/action'
    const VENDOR = (n) => '/__arxa/artifacts/vendor/' + n
    const EDITABLE_LANES = new Set(['markdown', 'code', 'text'])

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
      return { lane: 'text', ext }
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

    async function fetchTokenRaw(payload) {
      const res = await fetch(TOKEN_ROUTE, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || ('token route ' + res.status))
      return body
    }

    async function fetchToken(relPath, writeFor) {
      const payload = writeFor
        ? { scope: 'write', worktreeId: writeFor }
        : { relPath }
      const res = await fetch(TOKEN_ROUTE, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || ('token route ' + res.status))
      return body
    }

    /** D80 transparent ensure: an open session of the open org — the most
     * recently updated open row — else a fresh session in the 'notes' dock
     * via the sidebar action. Throws loud when no org is open. */
    async function ensureSession() {
      const res = await fetch(STATE_ROUTE)
      const state = await res.json().catch(() => ({}))
      const orgs = state.orgs || []
      const open = orgs.find((o) => o.open) || orgs[0]
      if (!open) throw new Error('no org open — open an organisation first')
      const rows = (open.sessions || []).filter((s) => s.state === 'open')
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      if (rows.length > 0) return rows[0]
      const mk = await fetch(ACTION_ROUTE, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'workspace.new-session', arg: { workspace: 'notes' } }),
      })
      const mkBody = await mk.json().catch(() => ({}))
      if (!mkBody.ok) throw new Error('session create failed: ' + (mkBody.error || mk.status))
      const after = await (await fetch(STATE_ROUTE)).json().catch(() => ({}))
      const fresh = ((after.orgs || []).find((o) => o.open || o === open) || open).sessions || []
      const freshOpen = fresh.filter((s) => s.state === 'open')
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      if (freshOpen.length === 0) throw new Error('session created but registry row not visible')
      return freshOpen[0]
    }

    function CodeView({ relPath, text, editable, docRef, onDirty }) {
      const ref = React.useRef(null)
      React.useEffect(() => {
        let dead = false
        let view = null
        ensureVendor('codemirror.js', 'ArxaCM').then((CM) => {
          if (dead || !ref.current) return
          const ext = (relPath.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase().replace('.', '')
          const lang = ({ md: 'markdown', markdown: 'markdown', js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'javascript', tsx: 'javascript', jsx: 'javascript', json: 'json', css: 'css', scss: 'css', html: 'html', htm: 'html', yaml: 'yaml', yml: 'yaml' })[ext]
          const extensions = [
            ...CM.basicSetup,
            CM.EditorView.editable.of(!!editable),
            CM.EditorState.readOnly.of(!editable),
            CM.EditorView.updateListener.of((u) => { if (u.docChanged && onDirty) onDirty() }),
          ]
          if (lang && CM.langs[lang]) extensions.push(CM.langs[lang]())
          view = new CM.EditorView({ state: CM.EditorState.create({ doc: text, extensions }), parent: ref.current })
          if (docRef) docRef.current = view
        }).catch((e) => { if (ref.current) ref.current.textContent = String(e) })
        return () => { dead = true; if (view) view.destroy() }
      }, [relPath, text, editable])
      return h('div', { ref, style: { border: '1px solid #333', borderRadius: 4, overflow: 'auto', maxHeight: '70vh' } })
    }

    function PdfView({ url }) {
      const wrapRef = React.useRef(null)
      const canvasRef = React.useRef(null)
      const docRef = React.useRef(null)
      const [pages, setPages] = React.useState(0)
      const [page, setPage] = React.useState(1)
      const [note, setNote] = React.useState('')
      React.useEffect(() => {
        let dead = false
        ;(async () => {
          try {
            const P = await ensureVendor('pdf.js', 'ArxaPDF')
            const buf = await (await fetch(url)).arrayBuffer()
            if (dead) return
            const doc = await P.getDocument({ data: buf }).promise
            docRef.current = doc
            setPages(doc.numPages)
            setPage(1)
          } catch (e) { if (!dead) setNote(String((e && e.message) || e)) }
        })()
        return () => { dead = true }
      }, [url])
      React.useEffect(() => {
        let dead = false
        ;(async () => {
          try {
            const doc = docRef.current
            const canvas = canvasRef.current
            if (!doc || !canvas) return
            const pg = await doc.getPage(page)
            if (dead) return
            const base = pg.getViewport({ scale: 1 })
            const scale = Math.max(0.2, Math.min(3, ((wrapRef.current ? wrapRef.current.clientWidth : 600) - 4) / base.width))
            const viewport = pg.getViewport({ scale })
            canvas.width = Math.floor(viewport.width)
            canvas.height = Math.floor(viewport.height)
            await pg.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
          } catch (e) { if (!dead) setNote(String((e && e.message) || e)) }
        })()
        return () => { dead = true }
      }, [url, page, pages])
      return h('div', { ref: wrapRef, style: { overflow: 'auto', flex: 1 } },
        note ? h('div', { style: { fontSize: 12, color: '#c66' } }, note) : null,
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', padding: '4px 0' } },
          h('button', { onClick: () => setPage((p) => Math.max(1, p - 1)), disabled: page <= 1,
            style: { cursor: 'pointer', borderRadius: 4, border: '1px solid #555', background: 'transparent', color: 'inherit' } }, '‹ prev'),
          h('span', { style: { fontSize: 12, opacity: 0.8 } }, 'page ' + page + ' / ' + (pages || '…')),
          h('button', { onClick: () => setPage((p) => Math.min(pages || 1, p + 1)), disabled: !pages || page >= pages,
            style: { cursor: 'pointer', borderRadius: 4, border: '1px solid #555', background: 'transparent', color: 'inherit' } }, 'next ›')),
        h('canvas', { ref: canvasRef, style: { border: '1px solid #333', background: '#fff', display: 'block', margin: '0 auto' } }))
    }

    /** D84: worktree-vs-main on @codemirror/merge — the ONE diff engine
     *  shared with gen-ui's card. Read-only: the merge view shows changes
     *  and chunk controls without letting the diff surface edit. */
    function DiffView({ original, text }) {
      const ref = React.useRef(null)
      React.useEffect(() => {
        let dead = false
        let view = null
        ensureVendor('codemirror.js', 'ArxaCM').then((CM) => {
          if (dead || !ref.current) return
          view = new CM.EditorView({
            state: CM.EditorState.create({
              doc: text,
              extensions: [
                ...CM.basicSetup,
                CM.EditorView.editable.of(false),
                CM.unifiedMergeView({ original, highlightChanges: true }),
              ],
            }),
            parent: ref.current,
          })
        }).catch((e) => { if (ref.current) ref.current.textContent = String(e) })
        return () => { dead = true; if (view) view.destroy() }
      }, [original, text])
      return h('div', { ref, style: { border: '1px solid #333', borderRadius: 4, overflow: 'auto', maxHeight: '70vh' } })
    }

    function ArtifactPanel(props) {
      const frameProps = props || {}
      const [open, setOpen] = React.useState(false)
      const [draft, setDraft] = React.useState('')
      const [state, setState] = React.useState({ phase: 'idle' })
      const [session, setSession] = React.useState(null)   // D85 session badge
      const [editing, setEditing] = React.useState(false)  // D80 toggle
      const [dirty, setDirty] = React.useState(false)
      const [saveNote, setSaveNote] = React.useState('')
      const [savePhase, setSavePhase] = React.useState('idle') // idle|saving|saved|error|conflict
      const docRef = React.useRef(null)
      const mtimeRef = React.useRef(null)
      const dirtyRef = React.useRef(false)
      const previewTimer = React.useRef(null)
      const [previewHtml, setPreviewHtml] = React.useState('')
      const [showDiff, setShowDiff] = React.useState(false)
      const [mainText, setMainText] = React.useState('')
      const [chip, setChip] = React.useState(null)
      const [timeline, setTimeline] = React.useState([])
      const [showTimeline, setShowTimeline] = React.useState(false)
      const maxBytesRef = React.useRef(5 * 1024 * 1024)
      React.useEffect(() => { dirtyRef.current = dirty }, [dirty])
      // D82 cap arrives from the host settings namespace when available.
      const externalRef = React.useRef(null)
      const openArtifactRef = React.useRef(null)
      // D90/D91: session-changes list (idle state) + wt lane + bridges.
      const [changes, setChanges] = React.useState([])
      const wtRef = React.useRef(null) // { sessionId } when the open artifact came from the worktree lane
      const openWorktreeRef = React.useRef(null)
      const refreshChanges = React.useCallback(async () => {
        try {
          const s = await ensureSession()
          const { token } = await fetchTokenRaw({ scope: 'changes-read', worktreeId: s.id })
          const r = await fetch('/__arxa/artifacts/session-changes?session=' + encodeURIComponent(s.id) + '&avt=' + encodeURIComponent(token))
          const body = await r.json().catch(() => ({}))
          if (r.ok) setChanges(body.files || [])
        } catch { setChanges([]) }
      }, [])
      React.useEffect(() => { void refreshChanges() }, [refreshChanges])
      // D91 card bridge + D90 sidebar-file bridge: window event
      // 'arxa-av-open' { relPath } (org lane) | { sessionId, relPath } (wt lane).
      React.useEffect(() => {
        const onOpen = (ev) => {
          try {
            const d = ev.detail || {}
            if (d.sessionId && d.relPath) { void openWorktreeRef.current && openWorktreeRef.current(d.sessionId, d.relPath) }
            else if (d.relPath) { setDraft(d.relPath); void (openArtifactRef.current && openArtifactRef.current(d.relPath)) }
          } catch { /* bad payload ignored */ }
        }
        // D93: the module-level apply() bridge opens the column, then
        // forwards the payload here (the panel is mounted by then).
        window.addEventListener('arxa-av-open-detail', onOpen)
        return () => window.removeEventListener('arxa-av-open-detail', onOpen)
      }, [])
      // D93 session switch while open: the column follows the new session —
      // the artifact resets to the empty state; changes list re-binds.
      const seenSessionRef = React.useRef(null)
      React.useEffect(() => {
        const rebind = async () => {
          try {
            const s = await ensureSession()
            if (seenSessionRef.current && seenSessionRef.current !== s.id) {
              setOpen(false); setState({ phase: 'idle' }); setSession(null); setEditing(false)
              setDirty(false); wtRef.current = null; setChip(null); setTimeline([]); setShowDiff(false)
              void refreshChanges()
            }
            seenSessionRef.current = s.id
          } catch { /* no org open — nothing to follow */ }
        }
        const t = setInterval(() => { void rebind() }, 4000)
        void rebind()
        return () => clearInterval(t)
      }, [refreshChanges])
      React.useEffect(() => {
        let live = true
        ;(async () => {
          try {
            const conn = hostCtx && hostCtx.connection
            const { result } = await conn.api.settings.describe({})
            const row = result.ok && result.value.namespaces.find((n) => n.ns === 'arxa-artifact-viewer')
            if (live && row && row.value && Number(row.value.maxEditBytes) > 0) maxBytesRef.current = Number(row.value.maxEditBytes)
          } catch { /* default cap stands */ }
        })()
        return () => { live = false }
      }, [])
      // D86: external-change push. Clean buffer auto-reloads ('a preview that
       // lies — reload it on the way IN'); dirty buffer raises the conflict
       // prompt instead. Conflict color rides the save-note line; the dirty
       // dot rides the session badge.
      React.useEffect(() => {
        if (!open || !state.relPath) return
        const es = new EventSource('/__arxa/artifacts/events')
        es.onmessage = (m) => {
          try {
            const ev = JSON.parse(m.data)
            if (!ev || ev.relPath !== state.relPath) return
            if (dirtyRef.current) {
              externalRef.current = ev.mtimeMs
              setSavePhase('conflict')
              setSaveNote('changed externally while you edited')
            } else {
              void (async () => {
                try {
                  const { token, origin } = await fetchToken(state.relPath)
                  const r = await fetch(origin + '/' + encodeURI(state.relPath) + '?avt=' + encodeURIComponent(token))
                  if (!r.ok) return
                  const text = await r.text()
                  mtimeRef.current = ev.mtimeMs
                  setState((s) => ({ ...s, text }))
                } catch { /* transient */ }
              })()
            }
          } catch {}
        }
        return () => es.close()
      }, [open, state.relPath])
      const refreshPreview = () => {
        if (previewTimer.current) clearTimeout(previewTimer.current)
        previewTimer.current = setTimeout(() => {
          try {
            if (docRef.current && window.ArxaMD) setPreviewHtml(window.ArxaMD.render(docRef.current.state.doc.toString()))
          } catch { /* preview is best-effort */ }
        }, 400)
      }

      const openArtifact = async () => {
        const relPath = draft.trim().replace(/^\/+/, '')
        if (!relPath) return
        setEditing(false); setDirty(false); setSession(null); setSaveNote(''); setSavePhase('idle'); mtimeRef.current = null; setPreviewHtml(''); setShowDiff(false); setMainText(''); setChip(null); setTimeline([]); setShowTimeline(false)
        setOpen(true)
        wtRef.current = null
        setState({ phase: 'loading', relPath })
        try {
          const { token, origin } = await fetchToken(relPath)
          const url = origin + '/' + encodeURI(relPath) + '?avt=' + encodeURIComponent(token)
          const kind = kindFor(relPath)
          void (async () => {
            try {
              const t = await fetchToken(relPath)
              const r = await fetch('/__arxa/artifacts/version?relPath=' + encodeURIComponent(relPath) + '&avt=' + encodeURIComponent(t.token))
              const body = await r.json().catch(() => ({}))
              if (r.ok) { setChip(body.chip || null); setTimeline(body.timeline || []) }
            } catch { /* chip stays hidden — never blocks the artifact */ }
          })()
          if (kind.lane === 'markdown' || kind.lane === 'code' || kind.lane === 'text') {
            const r = await fetch(url)
            if (!r.ok) throw new Error('fetch ' + r.status)
            const len = Number(r.headers.get('content-length') || '0')
            const cap = maxBytesRef.current
            let readOnly = false
            let guardNote = ''
            if (len > cap) { readOnly = true; guardNote = 'file is ' + Math.round(len / 1048576 * 10) / 10 + ' MB — over the ' + Math.round(cap / 1048576 * 10) / 10 + ' MB edit cap; read-only (D82)' }
            const text = await r.text()
            if (!readOnly && text.slice(0, 8192).includes('\u0000')) {
              readOnly = true; guardNote = 'binary file — view only (D82)'
            }
            setState({ phase: 'ready', kind, relPath, url, text, readOnly, guardNote })
          } else if (kind.lane === 'unknown') {
            setState({ phase: 'ready', kind, relPath, url, note: 'no renderer for this type' })
          } else {
            setState({ phase: 'ready', kind, relPath, url })
          }
        } catch (e) {
          setState({ phase: 'error', relPath, note: String(e && e.message || e) })
        }
      }

      // D89 worktree lane: produced files open from the session worktree with
      // the session PREBOUND — edit is immediately available (no ensure dance).
      const openWorktree = async (sessionId, relPath) => {
        if (!sessionId || !relPath) return
        setEditing(false); setDirty(false); setSaveNote(''); setSavePhase('idle'); mtimeRef.current = null; setPreviewHtml(''); setShowDiff(false); setMainText(''); setChip(null); setTimeline([]); setShowTimeline(false)
        setDraft(relPath)
        setOpen(true)
        setState({ phase: 'loading', relPath })
        wtRef.current = { sessionId }
        try {
          setSession({ id: sessionId, name: sessionId })
          const { token } = await fetchTokenRaw({ scope: 'wt-read', worktreeId: sessionId, relPath })
          const url = '/__arxa/artifacts/wt?session=' + encodeURIComponent(sessionId) + '&path=' + encodeURIComponent(relPath) + '&avt=' + encodeURIComponent(token)
          const kind = kindFor(relPath)
          if (kind.lane === 'markdown' || kind.lane === 'code' || kind.lane === 'text') {
            const r = await fetch(url)
            if (!r.ok) throw new Error('fetch ' + r.status)
            const len = Number(r.headers.get('content-length') || '0')
            const cap = maxBytesRef.current
            let readOnly = false
            let guardNote = ''
            if (len > cap) { readOnly = true; guardNote = 'file is over the edit cap; read-only (D82)' }
            const text = await r.text()
            if (!readOnly && text.slice(0, 8192).includes('\u0000')) {
              readOnly = true; guardNote = 'binary file — view only (D82)'
            }
            setState({ phase: 'ready', kind, relPath, url, text, readOnly, guardNote, wt: sessionId })
          } else {
            setState({ phase: 'ready', kind, relPath, url, wt: sessionId })
          }
        } catch (e) {
          setState({ phase: 'error', relPath, note: String(e && e.message || e) })
        }
      }
      openWorktreeRef.current = openWorktree
      openArtifactRef.current = openArtifact

      const startEditing = async () => {
        setSaveNote(''); setSavePhase('idle')
        if (state.readOnly) { setSavePhase('error'); setSaveNote(state.guardNote || 'read-only'); return }
        try {
          const s = await ensureSession()
          setSession(s)
          setEditing(true)
        } catch (e) {
          setSavePhase('error'); setSaveNote(String(e && e.message || e))
        }
      }

      const save = async (force = false) => {
        if (!session || !state.relPath || !docRef.current) return
        setSavePhase('saving'); setSaveNote('')
        try {
          const { token } = await fetchToken(null, session.id)
          const res = await fetch(WRITE_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-arxa-write-token': token },
            body: JSON.stringify({
              worktreeId: session.id,
              relPath: state.relPath,
              content: docRef.current.state.doc.toString(),
              ...(!force && mtimeRef.current != null ? { expectedMtimeMs: mtimeRef.current } : {}),
            }),
          })
          const body = await res.json().catch(() => ({}))
          if (res.status === 409) {
            setSavePhase('conflict'); setSaveNote('file changed externally — reload to pick up their version')
            if (body.mtimeMs) mtimeRef.current = body.mtimeMs
            return
          }
          if (!res.ok) throw new Error(body.error || ('write ' + res.status))
          mtimeRef.current = body.mtimeMs
          setDirty(false)
          setSavePhase('saved')
          setSaveNote(body.committed ? 'saved · wip committed to ' + session.name : 'saved (WIP commit pending: ' + (body.warning || 'why?') + ')')
        } catch (e) {
          setSavePhase('error'); setSaveNote(String(e && e.message || e))
        }
      }

      const lane = state.kind ? state.kind.lane : null
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
            h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
              h('span', { style: { fontSize: 11, opacity: 0.7 } }, state.relPath + ' · ' + lane + (state.readOnly ? ' · ' + state.guardNote : '')),
              chip && h('button', {
                onClick: () => setShowTimeline((v) => !v), title: chip.name || chip.label,
                style: { fontSize: 11, padding: '2px 8px', borderRadius: 10, border: '1px solid #555', background: 'transparent', color: 'inherit', cursor: 'pointer' },
              }, chip.label),
              showTimeline && h('span', { style: { fontSize: 11, opacity: 0.85, border: '1px solid #555', borderRadius: 4, padding: '2px 8px' } },
                (timeline || []).length === 0 ? 'no versions minted'
                  : (timeline || []).map((v) => v.version + ' · ' + v.state).join('  |  '))),
              EDITABLE_LANES.has(lane) && !editing && !state.readOnly && h('button', {
                onClick: () => { void startEditing() },
                style: { marginLeft: 'auto', padding: '3px 10px', cursor: 'pointer', borderRadius: 4, border: '1px solid #555', background: 'transparent', color: 'inherit', fontSize: 12 },
              }, 'edit'),
              EDITABLE_LANES.has(lane) && h('button', {
                onClick: () => {
                  if (showDiff) { setShowDiff(false); return }
                  void (async () => {
                    try {
                      const { token } = await fetchToken(state.relPath)
                      const r = await fetch('/__arxa/artifacts/main-version?relPath=' + encodeURIComponent(state.relPath) + '&avt=' + encodeURIComponent(token))
                      const body = await r.json().catch(() => ({}))
                      if (!r.ok) throw new Error(body.error || ('main-version ' + r.status))
                      setMainText(body.content || '')
                      setShowDiff(true)
                    } catch (e) { setSavePhase('error'); setSaveNote(String(e && e.message || e)) }
                  })()
                },
                style: { padding: '3px 10px', cursor: 'pointer', borderRadius: 4, border: '1px solid #555', background: 'transparent', color: 'inherit', fontSize: 12 },
              }, showDiff ? 'editing view' : 'diff vs main'),
              editing && h('span', {
                'data-arxa-session-badge': session ? session.name : 'ensuring…',
                style: { fontSize: 11, padding: '2px 8px', borderRadius: 10, border: '1px solid #555', opacity: 0.85 },
              }, 'session: ' + (session ? session.name : 'ensuring…')),
              editing && h('button', {
                onClick: () => { void save() },
                disabled: !dirty || savePhase === 'saving',
                style: { padding: '3px 10px', cursor: dirty ? 'pointer' : 'default', borderRadius: 4, border: '1px solid #555', background: dirty ? '#2d4a2d' : 'transparent', color: 'inherit', fontSize: 12 },
              }, savePhase === 'saving' ? 'saving…' : 'save'),
              editing && h('span', { style: { fontSize: 11, opacity: 0.8, color: savePhase === 'error' || savePhase === 'conflict' ? '#c66' : 'inherit' } },
                saveNote || (dirty ? 'unsaved changes' : ''))),
            lane === 'markdown' && !editing && h('div', { className: 'arxa-av-md', style: { overflow: 'auto', flex: 1 },
              dangerouslySetInnerHTML: { __html: window.ArxaMD ? window.ArxaMD.render(state.text) : '<em>markdown bundle loading…</em>' } }),
            lane === 'markdown' && editing && h('div', { style: { display: 'flex', gap: 8, flex: 1, overflow: 'hidden' } },
              h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' } },
                h('div', { style: { fontSize: 11, opacity: 0.7, padding: '2px 0' } }, 'source'),
                h(CodeView, { relPath: state.relPath, text: state.text, editable: true, docRef, onDirty: () => { setDirty(true); refreshPreview() } })),
              h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' } },
                h('div', { style: { fontSize: 11, opacity: 0.7, padding: '2px 0' } }, 'preview'),
                h('div', { className: 'arxa-av-md', style: { overflow: 'auto', flex: 1, border: '1px solid #333', borderRadius: 4, padding: 8 },
                  dangerouslySetInnerHTML: { __html: previewHtml || '<em>preview…</em>' } }))),
            showDiff && EDITABLE_LANES.has(lane) && h(DiffView, { original: mainText, text: (docRef.current && editing) ? docRef.current.state.doc.toString() : state.text }),
            !showDiff && (lane === 'code' || lane === 'text') && h(CodeView, { relPath: state.relPath, text: state.text, editable: editing, docRef, onDirty: () => setDirty(true) }),
            lane === 'image' && h('img', { src: state.url, alt: state.relPath, style: { maxWidth: '100%' } }),
            lane === 'audio' && h('audio', { src: state.url, controls: true, style: { width: '100%' } }),
            lane === 'video' && h('video', { src: state.url, controls: true, style: { width: '100%' } }),
            lane === 'unknown' && h('div', { style: { fontSize: 12, opacity: 0.7 } }, state.note || 'no renderer'),
            lane === 'iframe' && h('iframe', {
              src: state.url, sandbox: 'allow-scripts', title: state.relPath,
              style: { width: '100%', height: '60vh', border: '1px solid #333', background: '#fff' },
            }),
            lane === 'pdf' && h(PdfView, { url: state.url }))

      return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderBottom: '1px solid #333' } },
          h('span', { style: { fontWeight: 600, fontSize: 13 } }, 'artifact viewer'),
          frameProps.maximize && h('button', {
            onClick: () => frameProps.maximize(), title: 'maximize — take the max available width (D93)',
            style: { padding: '2px 8px', cursor: 'pointer', borderRadius: 4, border: '1px solid #555', background: 'transparent', color: 'inherit', fontSize: 12 },
          }, '\u29e2'),
          frameProps.close && !frameProps.sheet && h('button', {
            onClick: () => frameProps.close(), title: 'close the viewer column',
            style: { marginLeft: 'auto', padding: '2px 8px', cursor: 'pointer', borderRadius: 4, border: '1px solid #555', background: 'transparent', color: 'inherit', fontSize: 12 },
          }, '\u2715')),
        body)
    }

    let hostCtx = null
    function apply(ctx) {
      hostCtx = ctx
      // D93 open bridge: the panel mounts INSIDE the viewer column, so it
      // cannot hear 'arxa-av-open' while the column is 0px wide. This
      // module-level listener opens the column first (the ctx.layout face),
      // then forwards the payload to the mounted panel on a detail event.
      window.addEventListener('arxa-av-open', (ev) => {
        try { if (ctx.layout && typeof ctx.layout.openViewer === 'function') ctx.layout.openViewer() } catch { /* face not wired yet */ }
        try { window.dispatchEvent(new CustomEvent('arxa-av-open-detail', { detail: (ev && ev.detail) || {} })) } catch { /* bad payload ignored */ }
      })
      // Diagnostic levers (2026-08-31): the dsh sessions service as seen
      // from a peer plugin ctx — lets the console test open() end-to-end
      // while the sidebar resume path is under diagnosis.
      try {
        const sessions = ctx.get('sessions')
        window.__ARXA_SESSIONS__ = sessions || null
        try { window.__ARXA_WORKSPACES__ = ctx.get('workspaces') || null } catch { window.__ARXA_WORKSPACES__ = null }
        window.__ARXA_AV_DEBUG__ = {
          hasLayout: !!ctx.layout,
          layoutKeys: ctx.layout ? Object.keys(ctx.layout) : null,
          sessionsOpen: !!(sessions && typeof sessions.open === 'function'),
        }
      } catch (e) { window.__ARXA_AV_DEBUG__ = { err: String(e && e.message || e) } }
      ctx.slots.inject('viewer', () =>
        ctx.slots.register({ name: 'viewer', id: 'arxa-artifact-viewer' }, ArtifactPanel))
    }
    const inject = ['slots', 'connection', 'layout', 'sessions']
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})