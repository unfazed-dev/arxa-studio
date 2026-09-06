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
export function start (container, { fontFamily = 'Fira Code', dark = true } = {}) {
  started ??= (async () => {
    // getWorker is asked for SEVERAL labels, not just the editor's. Handing
    // the editor worker to every label is what produced
    // "Missing method $init on worker thread channel default".
    const workers = { TextEditorWorker: EditorWorker, TextMateWorker }
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
    updateUserConfiguration(JSON.stringify({
      'editor.fontFamily': fontFamily + ', monospace',
      'workbench.colorTheme': dark ? 'Default Dark Modern' : 'Default Light Modern',
    }))
  })()
  return started.then(() => container)
}

export async function openFile (container, uriPath, text) {
  await start(container)
  const uri = monaco.Uri.file(uriPath)
  const fsp = new RegisteredFileSystemProvider(false)
  fsp.registerFile(new RegisteredMemoryFile(uri, text))
  const overlay = registerFileSystemOverlay(1, fsp)
  // Second argument writes the content into the virtual filesystem first.
  // The overlay alone was not enough here — createModelReference threw
  // "Model not found". Phase 1 needs the overlay anyway (write-through
  // provider, phase 5), so this is a spike shortcut, not the final shape.
  // ponytail: 2-arg form for the spike; the overlay path is phase 1's problem.
  const ref = await monaco.editor.createModelReference(uri, text)
  const editor = monaco.editor.create(container, { model: ref.object.textEditorModel, automaticLayout: true })
  return { editor, ref, dispose: () => { editor.dispose(); ref.dispose(); overlay.dispose() } }
}

export { monaco, MonacoLanguageClient, toSocket, WebSocketMessageReader, WebSocketMessageWriter }
