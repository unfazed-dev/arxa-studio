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
import '@codingame/monaco-vscode-markdown-language-features-default-extension'
import '@codingame/monaco-vscode-markdown-math-default-extension'
import '@codingame/monaco-vscode-media-preview-default-extension'

// Phase 2 (LSP over the host's registerUpgrade websocket) rides these — pulled
// into the graph now so the spike's size number is the honest one.
import { MonacoLanguageClient } from 'monaco-languageclient'
import { toSocket, WebSocketMessageReader, WebSocketMessageWriter } from 'vscode-ws-jsonrpc'

// Vite's `?worker` gives a Worker constructor; `?worker&url` gives the emitted
// chunk's URL, which is what the extensions override wants (WorkerConfig.url).
// Both resolve against vite.config's `base` — pinned to the vendor route.

let started = null
let themeDark = true
export function start (container, { fontFamily = 'Fira Code', dark = true } = {}) {
  themeDark = dark
  started ??= (async () => {
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
  })
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
      // Only the EDITOR goes. The model and its registered file stay for the
      // life of the page (see `open` above) — disposing the model ref makes the
      // text-file service reload a uri whose file is still registered, and
      // keeping it is what lets undo history survive a round trip.
      editor.dispose()
    },
  }
}

export { monaco, MonacoLanguageClient, toSocket, WebSocketMessageReader, WebSocketMessageWriter }
