// arxa viewer — Monaco/VS Code entry (G7-G12 phase 1 shape, spike scope).
//
// Built by vite into flat ESM chunks under dist/, served by the host's vendor
// route on the STUDIO origin, and loaded by lib/client.js with a dynamic
// import(). Never a <script> tag: this graph is ESM with workers.
import * as monaco from 'monaco-editor'
import EditorWorker from './editor.worker.js?worker'
import extHostWorkerUrl from './extensionHost.worker.js?worker&url'
import TextMateWorker from './textmate.worker.js?worker'
import { initialize } from '@codingame/monaco-vscode-api'
import getConfigurationServiceOverride, { updateUserConfiguration } from '@codingame/monaco-vscode-configuration-service-override'
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override'
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override'
import getLanguagesServiceOverride from '@codingame/monaco-vscode-languages-service-override'
import getKeybindingsServiceOverride from '@codingame/monaco-vscode-keybindings-service-override'
import getQuickAccessServiceOverride from '@codingame/monaco-vscode-quickaccess-service-override'
import getExtensionsServiceOverride from '@codingame/monaco-vscode-extensions-service-override'
// The real ITextModelService lives HERE, not in the files override. Without
// it monaco falls back to the standalone service, whose createModelReference
// rejects with "Model not found" for any uri it did not create itself.
import getModelServiceOverride from '@codingame/monaco-vscode-model-service-override'
import getFilesServiceOverride, {
  RegisteredFileSystemProvider, RegisteredMemoryFile, registerFileSystemOverlay,
} from '@codingame/monaco-vscode-files-service-override'

// Grammars + themes ship as npm-published built-in extensions at the same
// version — no .vsix sourcing, no network at pack time (G9).
import '@codingame/monaco-vscode-theme-defaults-default-extension'
import '@codingame/monaco-vscode-dart-default-extension'
import '@codingame/monaco-vscode-rust-default-extension'
import '@codingame/monaco-vscode-typescript-basics-default-extension'
import '@codingame/monaco-vscode-javascript-default-extension'
import '@codingame/monaco-vscode-json-default-extension'
import '@codingame/monaco-vscode-html-default-extension'
import '@codingame/monaco-vscode-css-default-extension'
// scss and less are SEPARATE extensions from css. Measured in the running
// editor: without these a .scss or .less file opens as `plaintext`, which means
// no grammar AND no language client — documentSelector matches on the language
// id, so the css server would have started and then been sent nothing.
import '@codingame/monaco-vscode-scss-default-extension'
import '@codingame/monaco-vscode-less-default-extension'
import '@codingame/monaco-vscode-markdown-basics-default-extension'
// markdown-language-features, markdown-math and media-preview are NOT here.
// Measured, in order:
//   1. with only the features extension, a .md file opened as `plaintext` —
//      it is markdown-BASICS that declares the language and its grammar.
//   2. adding the grammar made the features extension finally activate
//      (onLanguage:markdown) and it failed immediately:
//        Failed to construct 'Worker': Script at
//        'extension-file://vscode.markdown-language-features/extension/dist/
//         browser/serverWorkerMain.js' cannot be accessed from origin ...
//      It needs extension-host worker plumbing this build does not have.
//   3. media-preview declares `customEditors`, which are WEBVIEWS. There is no
//      webview-service-override at 36.2.7 — webviews live in the `views`
//      family, i.e. the whole VS Code workbench layout.
// So the markdown PREVIEW and the media preview stay on the vendored
// markdown-it + DOMPurify bundle until a workbench adoption is on the table.
// Shipping the feature extensions anyway bought one console error per markdown
// file and nothing else.

// Phase 2 (LSP over the host's registerUpgrade websocket) rides these — pulled
// into the graph now so the spike's size number is the honest one.
import { MonacoLanguageClient } from 'monaco-languageclient'
import { toSocket, WebSocketMessageReader, WebSocketMessageWriter } from 'vscode-ws-jsonrpc'

// Vite's `?worker` gives a Worker constructor; `?worker&url` gives the emitted
// chunk's URL, which is what the extensions override wants (WorkerConfig.url).
// Both resolve against vite.config's `base` — pinned to the vendor route.

/** Load the bundle's OWN stylesheet.
 *
 *  Nothing else will. There is no index.html in this build, so vite emits the
 *  css as a bare asset with no <link> generated for it, and the host page
 *  (lib/client.js) has no way to know its name. Shipped without this and monaco
 *  rendered completely unstyled: the editor's lines escaped their container and
 *  painted across the top-left of the whole app, while the viewer pane sat
 *  black. The check harness was injecting the <link> itself, so it stayed green
 *  the entire time — see check.mjs.
 *
 *  Resolved from import.meta.url, not from a hardcoded route, so the bundle
 *  works wherever it is served. Awaited: mounting an editor before the
 *  stylesheet applies is the same flash of broken layout, briefly. */
function ensureStyles () {
  const href = new URL('arxa-monaco.css', import.meta.url).href
  const existing = document.querySelector('link[data-arxa-monaco]')
  if (existing) return existing.__arxaLoaded ?? Promise.resolve()
  return new Promise((resolve) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.dataset.arxaMonaco = '1'
    // Resolve either way: a missing stylesheet is a visible bug, not a reason
    // to leave the caller hanging forever with no editor at all.
    const done = () => resolve()
    link.addEventListener('load', done, { once: true })
    link.addEventListener('error', done, { once: true })
    link.__arxaLoaded = new Promise((r) => {
      link.addEventListener('load', r, { once: true })
      link.addEventListener('error', r, { once: true })
    })
    document.head.appendChild(link)
  })
}

let started = null
let themeDark = true
export function start (container, { fontFamily = 'Fira Code', dark = true } = {}) {
  themeDark = dark
  started ??= (async () => {
    await ensureStyles()
    // getWorker is asked for SEVERAL labels, not just the editor's. Handing
    // the editor worker to every label is what produced
    // "Missing method $init on worker thread channel default".
    //
    // These are the labels MEASURED in the browser, not guessed: the spike
    // page asks for `TextMateWorker` and `editorWorkerService`. The first
    // version of this map keyed the editor worker as `TextEditorWorker`, which
    // is never requested — that entry was dead and only the ?? fallback below
    // kept it working. The fallback stays, deliberately: an unknown label is
    // better served by the editor worker than by nothing.
    const workers = { editorWorkerService: EditorWorker, TextMateWorker }
    self.__arxaWorkerLabels = []
    self.MonacoEnvironment = {
      getWorker: (_id, label) => {
        self.__arxaWorkerLabels.push(label)
        const W = workers[label] ?? EditorWorker
        return new W()
      },
    }
    await initialize({
      ...getConfigurationServiceOverride(),
      ...getThemeServiceOverride(),
      ...getTextmateServiceOverride(),
      ...getLanguagesServiceOverride(),
      ...getKeybindingsServiceOverride(),
      ...getQuickAccessServiceOverride({ isKeybindingConfigurationVisible: () => true, shouldUseGlobalPicker: () => true }),
      ...getFilesServiceOverride(),
      ...getModelServiceOverride(),
      ...getExtensionsServiceOverride({ url: extHostWorkerUrl, options: { type: 'module' } }),
    })
    applyTheme(fontFamily)
  })()
  return started.then(() => container)
}

function applyTheme (fontFamily = 'Fira Code') {
  updateUserConfiguration(JSON.stringify({
    'editor.fontFamily': fontFamily + ', monospace',
    'workbench.colorTheme': themeDark ? 'Default Dark Modern' : 'Default Light Modern',
  }))
}

/** Live dark/light flip. The viewer's palette can change under an open editor
 *  (the studio theme toggle), and start() only runs once. */
export function setTheme (dark) {
  if (dark === themeDark) return
  themeDark = dark
  if (started) applyTheme()
}

/** ONE provider and ONE overlay for the whole page; files are added to it.
 *
 *  The obvious shape — a provider per open file, disposed on close — does not
 *  work. registerFileSystemOverlay(1, fsp) STACKS, so a second open of the same
 *  path left the first overlay in place and createModelReference handed back
 *  the first model with its stale text. Disposing the overlay to compensate is
 *  worse: the text-file service still holds the uri and reloads it, so closing
 *  a file produced "Unable to resolve nonexistent file" and the next open threw.
 *  Both were measured, not reasoned about.
 *
 *  One overlay has neither failure. The viewer reopens paths constantly — switch
 *  files and come back, an external change, reloadTheirs — so this is the normal
 *  path, not an edge.
 *
 *  ponytail: models are cached for the life of the page, which is what makes
 *  undo history survive a round trip. If a long session's file count ever
 *  matters, evict by least-recently-opened here — nothing else needs to know. */
let fsp = null
const open = new Map()

function acquire (uriPath, text) {
  const uri = monaco.Uri.file(uriPath)
  if (fsp === null) {
    fsp = new RegisteredFileSystemProvider(false)
    registerFileSystemOverlay(1, fsp)
  }
  let e = open.get(uriPath)
  if (e === void 0) {
    // ONCE per path: registerFile THROWS on a uri it already holds
    // ("file 'file:///…' already exists") rather than replacing it. Fresh bytes
    // on a reopen therefore arrive through the model (setValue in openFile),
    // not by re-registering — the model is what the editor reads anyway.
    fsp.registerFile(new RegisteredMemoryFile(uri, text))
    e = { uri, ref: null }
    open.set(uriPath, e)
  }
  return e
}

/** What the editor should look like at a given container width.
 *
 *  The viewer is a side pane, not a window: it is routinely dragged down to a
 *  few hundred pixels, and at that size the minimap and the gutters cost more
 *  than they give while long lines run off the side with no way back. VS Code
 *  itself only adapts the minimap, but VS Code's editor is rarely this narrow.
 *
 *  Breakpoints are container width in CSS px, chosen against the real chrome:
 *  the minimap is ~110px, the folding + glyph gutter ~22px, line numbers ~40px.
 *
 *  ponytail: fixed thresholds, no setting. If someone wants the minimap back at
 *  600px, that is a viewer preference passed through openFile — not a reason to
 *  build a preference system now. */
function layoutFor (width) {
  return {
    minimap: { enabled: width >= 700 },
    // Below this a horizontal scrollbar is the only way to read a long line,
    // and in a narrow pane that is a worse trade than wrapping.
    wordWrap: width < 620 ? 'on' : 'off',
    folding: width >= 460,
    glyphMargin: width >= 460,
    lineNumbers: width >= 360 ? 'on' : 'off',
    lineDecorationsWidth: width >= 460 ? 10 : 0,
    // Nothing to scroll horizontally once wrapped; the extra track just eats
    // a line of height.
    scrollbar: { horizontal: width < 620 ? 'hidden' : 'auto' },
  }
}

/** Open `uriPath` in `container` and return the handle lib/client.js drives.
 *  Deliberately NOT a monaco object: the client holds one `docRef` that five
 *  call sites read, and leaking monaco's shape there would make phase 4-6 a
 *  rewrite of all of them. */
export async function openFile (container, uriPath, text, opts = {}) {
  const { editable = true, onChange = null, fontFamily = 'Fira Code', dark = true } = opts
  await start(container, { fontFamily, dark })
  const e = acquire(uriPath, text)
  e.ref ??= await monaco.editor.createModelReference(e.uri, text)
  const model = e.ref.object.textEditorModel
  // The caller owns the bytes on disk; the model is only a view of them. A
  // reopen after an external change arrives with new text and the same uri.
  if (model.getValue() !== text) model.setValue(text)
  const editor = monaco.editor.create(container, {
    model, automaticLayout: true, readOnly: !editable, domReadOnly: !editable,
    // Per-editor, NOT through start()'s user configuration: start() runs once
    // and the viewer's font setting can change between files. Monaco measures
    // character width from the font it is TOLD about, so overriding this with
    // css instead would misplace the cursor.
    fontFamily: fontFamily + ', monospace',
    ...layoutFor(container.getBoundingClientRect().width),
  })

  // Re-apply on every container resize. automaticLayout already keeps the
  // editor the right SIZE; this is what changes its SHAPE as the pane narrows.
  // Guarded on the computed values, not the pixel width, so a drag does not
  // push an updateOptions per frame.
  let shape = ''
  const ro = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect?.width ?? 0
    if (w === 0) return                      // a hidden pane measures 0
    const next = layoutFor(w)
    const key = JSON.stringify(next)
    if (key === shape) return
    shape = key
    editor.updateOptions(next)
  })
  ro.observe(container)
  const sub = onChange ? model.onDidChangeContent(() => onChange()) : null
  let live = true
  return {
    editor,
    model,
    getText: () => model.getValue(),
    /** Replace [from, to) with `insert`, keeping cursor and undo history —
     *  what the prettier format action needs (it computes one minimal edit). */
    replaceRange: (from, to, insert) => {
      editor.executeEdits('arxa-format', [{
        range: monaco.Range.fromPositions(model.getPositionAt(from), model.getPositionAt(to)),
        text: insert,
      }])
    },
    focus: () => editor.focus(),
    dispose: () => {
      if (!live) return
      live = false
      if (sub) sub.dispose()
      ro.disconnect()
      // Only the EDITOR goes. The model and its registered file stay for the
      // life of the page (see `open` above) — disposing the model ref makes the
      // text-file service reload a uri whose file is still registered, and
      // keeping it is what lets undo history survive a round trip.
      editor.dispose()
    },
  }
}

/** Attach a language server to the editor over the host's LSP socket.
 *
 *  One client per language for the life of the page. The socket is opened with
 *  ['arxa-lsp', token] as its subprotocol list — a browser cannot set headers
 *  on a WebSocket, so that is how the host's token travels.
 *
 *  Every failure here is SILENT by design: the editor is fully usable without a
 *  language server, and a missing rust-analyzer must not degrade opening a file
 *  into an error. The returned promise resolves to false when no service could
 *  be attached, so the caller can say so if it wants to. */
const langClients = new Map()
export async function connectLanguageServer (lang, { url, token, relPath, session = null, selector = null, init = null } = {}) {
  if (langClients.has(lang)) return true
  await start()
  const q = new URLSearchParams({ lang, path: relPath ?? '' })
  if (session) q.set('session', session)
  const socket = new WebSocket(url + '?' + q.toString(), ['arxa-lsp', token])
  const opened = await new Promise((resolve) => {
    socket.addEventListener('open', () => resolve(true), { once: true })
    // 4004 is the host saying "no server for this" — not an error, just no
    // service. Any other close before open is equally not worth a dialog.
    socket.addEventListener('close', () => resolve(false), { once: true })
    socket.addEventListener('error', () => resolve(false), { once: true })
  })
  if (!opened) return false
  const rpc = toSocket(socket)
  const client = new MonacoLanguageClient({
    id: 'arxa-' + lang,
    name: 'arxa ' + lang,
    clientOptions: {
      // ONE server can own SEVERAL monaco language ids — typescript-language-server
      // serves javascript too, the css server serves scss and less, the json
      // server serves jsonc. A selector of just `lang` would connect a client
      // that then ignores every .js, .scss and .jsonc document it was started
      // for, with no error to show for it.
      documentSelector: (selector ?? [lang]).map((language) => ({ language })),
      // Handshake options the HOST computed — typescript-language-server
      // refuses to start unless it is told where a compiler is, and only the
      // host knows where arxa put one.
      initializationOptions: init ?? undefined,
      // The server decides its own root (the host resolved the project
      // directory); the client must not fight it with a second opinion.
      workspaceFolder: undefined,
      errorHandler: { error: () => ({ action: 1 }), closed: () => ({ action: 1 }) },
    },
    messageTransports: {
      reader: new WebSocketMessageReader(rpc),
      writer: new WebSocketMessageWriter(rpc),
    },
  })
  socket.addEventListener('close', () => {
    langClients.delete(lang)
    try { client.stop() } catch {}
  }, { once: true })
  langClients.set(lang, client)
  try {
    await client.start()
    return true
  } catch {
    langClients.delete(lang)
    return false
  }
}

/** Which languages currently have a live server, for the client to show. */
export function languageServers () {
  return [...langClients.keys()]
}

export { monaco, MonacoLanguageClient, toSocket, WebSocketMessageReader, WebSocketMessageWriter }
