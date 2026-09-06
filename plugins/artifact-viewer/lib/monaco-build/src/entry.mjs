// arxa viewer — Monaco/VS Code entry (G7-G12 phase 1 shape, spike scope).
//
// Built by vite into flat ESM chunks under dist/, served by the host's vendor
// route on the STUDIO origin, and loaded by lib/client.js with a dynamic
// import(). Never a <script> tag: this graph is ESM with workers.
import * as monaco from 'monaco-editor'
import EditorWorker from './editor.worker.js?worker'
import extHostWorkerUrl from './extensionHost.worker.js?worker&url'
import { initialize } from '@codingame/monaco-vscode-api'
import getConfigurationServiceOverride, { updateUserConfiguration } from '@codingame/monaco-vscode-configuration-service-override'
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override'
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override'
import getLanguagesServiceOverride from '@codingame/monaco-vscode-languages-service-override'
import getKeybindingsServiceOverride from '@codingame/monaco-vscode-keybindings-service-override'
import getQuickAccessServiceOverride from '@codingame/monaco-vscode-quickaccess-service-override'
import getExtensionsServiceOverride from '@codingame/monaco-vscode-extensions-service-override'
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
    self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
    await initialize({
      ...getConfigurationServiceOverride(),
      ...getThemeServiceOverride(),
      ...getTextmateServiceOverride(),
      ...getLanguagesServiceOverride(),
      ...getKeybindingsServiceOverride(),
      ...getQuickAccessServiceOverride({ isKeybindingConfigurationVisible: () => true, shouldUseGlobalPicker: () => true }),
      ...getFilesServiceOverride(),
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
  const ref = await monaco.editor.createModelReference(uri)
  const editor = monaco.editor.create(container, { model: ref.object.textEditorModel, automaticLayout: true })
  return { editor, ref, dispose: () => { editor.dispose(); ref.dispose(); overlay.dispose() } }
}

export { monaco, MonacoLanguageClient, toSocket, WebSocketMessageReader, WebSocketMessageWriter }
