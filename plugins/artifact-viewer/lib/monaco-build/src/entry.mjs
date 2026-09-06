// arxa viewer — Monaco/VS Code entry (G7-G12 phase 1 shape, spike scope).
//
// Built by vite into flat ESM chunks under dist/, served by the host's vendor
// route on the STUDIO origin, and loaded by lib/client.js with a dynamic
// import(). Never a <script> tag: this graph is ESM with workers.
import * as monaco from 'monaco-editor'
import editorWorkerUrl from './editor.worker.js?worker&url'
import extHostWorkerUrl from './extensionHost.worker.js?worker&url'
import textmateWorkerUrl from './textmate.worker.js?worker&url'
import { initialize, getService, IEditorService, ICommandService, INotificationService, IEditorGroupsService } from '@codingame/monaco-vscode-api'
import { setUnexpectedErrorHandler } from '@codingame/monaco-vscode-api/monaco'
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
// The editor PART. attachPart takes ONE part, so this brings VS Code's editor
// area and nothing else — no activity bar, no sidebar, no panel, no status bar.
// It is also what carries webviews and custom editors: the markdown preview and
// media-preview are editor inputs, and without the part there is nowhere for
// them to open.
import getViewsServiceOverride, { attachPart, Parts } from '@codingame/monaco-vscode-views-service-override'
// Everything below is a service the editor part reaches for while it renders.
// The set was derived by booting and reading what initialize() said was
// missing, not guessed from the demo's list — the demo turns on terminal,
// debug, scm, chat and notebooks, none of which a docked artifact pane uses.
import getBaseServiceOverride from '@codingame/monaco-vscode-base-service-override'
import getHostServiceOverride from '@codingame/monaco-vscode-host-service-override'
import getEnvironmentServiceOverride from '@codingame/monaco-vscode-environment-service-override'
import getLifecycleServiceOverride from '@codingame/monaco-vscode-lifecycle-service-override'
import getLogServiceOverride from '@codingame/monaco-vscode-log-service-override'
import getStorageServiceOverride from '@codingame/monaco-vscode-storage-service-override'
import getNotificationsServiceOverride from '@codingame/monaco-vscode-notifications-service-override'
import getDialogsServiceOverride from '@codingame/monaco-vscode-dialogs-service-override'
import getWorkingCopyServiceOverride from '@codingame/monaco-vscode-working-copy-service-override'
import getBulkEditServiceOverride from '@codingame/monaco-vscode-bulk-edit-service-override'
import getMarkersServiceOverride from '@codingame/monaco-vscode-markers-service-override'
import getPreferencesServiceOverride from '@codingame/monaco-vscode-preferences-service-override'
import getOutlineServiceOverride from '@codingame/monaco-vscode-outline-service-override'

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
// The FEATURE layer on top of the grammar. It was removed once, on the reading
// that it needed extension-host plumbing this build did not have. It did not:
// the build was calling getExtensionsServiceOverride({ url, options }) against
// an override that destructures { enableWorkerExtensionHost, iframeAlternateDomain },
// so the extension host was simply never switched on. See the initialize() call
// below. With it on, this extension activates clean and its document-link
// provider underlines markdown links — visible in the check capture.
import '@codingame/monaco-vscode-markdown-language-features-default-extension'
import '@codingame/monaco-vscode-markdown-math-default-extension'
// customEditors — i.e. webviews — for images, audio and video. Only reachable
// once the editor part exists.
import '@codingame/monaco-vscode-media-preview-default-extension'

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
    // getWorkerUrl, NOT getWorker. The webworker extension host runs inside an
    // iframe and constructs its own worker there: it needs a URL it can pass
    // across the frame boundary, and an object from this realm is useless to it.
    // getWorker also cannot serve `extensionHostWorkerMain` at all.
    const workerUrls = {
      editorWorkerService: editorWorkerUrl,
      extensionHostWorkerMain: extHostWorkerUrl,
      TextMateWorker: textmateWorkerUrl,
    }
    self.__arxaWorkerLabels = []
    self.MonacoEnvironment = {
      getWorkerUrl: (_id, label) => {
        self.__arxaWorkerLabels.push(label)
        // An unknown label is still better served by the editor worker than by
        // nothing — same deliberate fallback the constructor map had.
        return workerUrls[label] ?? editorWorkerUrl
      },
      getWorkerOptions: () => ({ type: 'module' }),
    }
    await initialize({
      ...getBaseServiceOverride(),
      ...getLogServiceOverride(),
      ...getEnvironmentServiceOverride(),
      ...getHostServiceOverride(),
      ...getLifecycleServiceOverride(),
      ...getStorageServiceOverride(),
      ...getNotificationsServiceOverride(),
      ...getDialogsServiceOverride(),
      ...getWorkingCopyServiceOverride(),
      ...getBulkEditServiceOverride(),
      ...getMarkersServiceOverride(),
      ...getPreferencesServiceOverride(),
      ...getOutlineServiceOverride(),
      ...getViewsServiceOverride(),
      ...getConfigurationServiceOverride(),
      ...getThemeServiceOverride(),
      ...getTextmateServiceOverride(),
      ...getLanguagesServiceOverride(),
      ...getKeybindingsServiceOverride(),
      ...getQuickAccessServiceOverride({ isKeybindingConfigurationVisible: () => true, shouldUseGlobalPicker: () => true }),
      ...getFilesServiceOverride(),
      ...getModelServiceOverride(),
      // MEASURED: at 36.2.7 this override destructures
      // { enableWorkerExtensionHost, iframeAlternateDomain } — the { url, options }
      // shape it was called with for the whole of phase 1-2 destructured to
      // undefined, so the webworker extension host was silently OFF. That, not
      // webviews, is what made markdown-language-features fail to construct its
      // own Worker: with no host iframe there is no origin its extension files
      // can be fetched from.
      //
      // iframeAlternateDomain is NOT set: the studio is served from a loopback
      // origin and `{{uuid}}.127.0.0.1` is not a resolvable hostname, so there
      // is no alternate domain to move the host to. The extension host iframe is
      // therefore SAME-ORIGIN with the studio — extension code runs with the
      // studio's origin, which is a trust boundary worth naming.
      ...getExtensionsServiceOverride({ enableWorkerExtensionHost: true }),
    // The workbench container. document.body, not the viewer pane: VS Code
    // hangs context menus, hovers and notification toasts off it, and a pane
    // that is routinely dragged to a few hundred pixels would clip all three.
    // The parts themselves go wherever attachEditorPart() puts them.
    }, document.body, {})
    // VS Code signals cancellation by THROWING, and its default unexpected-error
    // handler re-raises onto window.onerror. Closing an editor cancels whatever
    // that editor had in flight, so a plain file switch can surface as
    // `Canceled: Canceled` with no fault behind it — measured, intermittently,
    // in the check harness. Swallow exactly that and nothing else: every other
    // unexpected error still reaches the console, where the lens fails on it.
    // ...and the same signal reaches the page as an UNHANDLED REJECTION, which
    // setUnexpectedErrorHandler never sees. Measured: opening the markdown
    // preview rejects one internal promise with Canceled every single run.
    // preventDefault only for cancellation — anything else still lands in the
    // console, where the lens fails the build on it.
    self.addEventListener('unhandledrejection', (ev) => {
      const r = ev.reason
      const s = String((r && (r.name || r.message)) ?? '')
      if (s === 'Canceled' || s === 'CodeExpectedError') ev.preventDefault()
    })
    setUnexpectedErrorHandler((e) => {
      const name = e && (e.name ?? '')
      const msg = e && (e.message ?? '')
      if (name === 'Canceled' || name === 'CodeExpectedError' || msg === 'Canceled') return
      console.error(e)
    })
    applyTheme(fontFamily)
  })()
  return started.then(() => container)
}

/** The user settings.json this bundle owns.
 *
 *  updateUserConfiguration REPLACES the whole document, so there is exactly one
 *  object and every writer patches it. Two writers used to be enough (theme,
 *  font); the narrow-pane shape is a third, and the first version of that lost
 *  the theme on every resize. */
const userConfig = {
  'editor.fontFamily': 'Fira Code, monospace',
  'workbench.colorTheme': 'Default Dark Modern',
  // Files open by SIDEBAR selection, so the same tab is reused as the user
  // moves between artifacts; a preview or a second pin opens its own.
  'workbench.editor.enablePreview': true,
  // Always two columns. VS Code's default drops to the inline view below
  // 900px, and the viewer pane usually IS below 900px — so every diff came up
  // as one column with two line-number gutters and read as "not a diff"
  // (2026-09-07). Maximising the pane is the user's move, not a mode switch.
  'diffEditor.renderSideBySide': true,
  'diffEditor.useInlineViewWhenSpaceIsLimited': false,
}
function writeConfig (patch) {
  Object.assign(userConfig, patch)
  updateUserConfiguration(JSON.stringify(userConfig))
}

function applyTheme (fontFamily = 'Fira Code') {
  writeConfig({
    'editor.fontFamily': fontFamily + ', monospace',
    'workbench.colorTheme': themeDark ? 'Default Dark Modern' : 'Default Light Modern',
  })
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
    // Held, not discarded: a reopen after an external change has to compare the
    // stored bytes with the caller's and write only when they differ.
    const file = new RegisteredMemoryFile(uri, text)
    fsp.registerFile(file)
    e = { uri, ref: null, file }
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
    'editor.minimap.enabled': width >= 700,
    // Below this a horizontal scrollbar is the only way to read a long line,
    // and in a narrow pane that is a worse trade than wrapping.
    'editor.wordWrap': width < 620 ? 'on' : 'off',
    'editor.folding': width >= 460,
    'editor.glyphMargin': width >= 460,
    'editor.lineNumbers': width >= 360 ? 'on' : 'off',
    // Nothing to scroll horizontally once wrapped; the extra track just eats
    // a line of height.
    'editor.scrollbar.horizontal': width < 620 ? 'hidden' : 'auto',
  }
}

/** Open `uriPath` in `container` and return the handle lib/client.js drives.
 *  Deliberately NOT a monaco object: the client holds one `docRef` that five
 *  call sites read, and leaking monaco's shape there would make phase 4-6 a
 *  rewrite of all of them. */
export async function openFile (container, uriPath, text, opts = {}) {
  const { editable = true, onChange = null, fontFamily = 'Fira Code', dark = true } = opts
  await start(container, { fontFamily, dark })
  applyTheme(fontFamily)
  await attachEditorPart(container)
  await syncFile(uriPath, text)
  writeConfig(layoutFor(container.getBoundingClientRect().width))
  const pane = await openEditor(uriPath, { pinned: false })
  // A text file gives an ICodeEditor; media-preview's image editor gives a
  // webview and no control at all. The caller only opens code here, but a
  // handle that assumes a control would throw on the first .png someone routes
  // through by mistake.
  const editor = pane != null && typeof pane.getControl === 'function' ? pane.getControl() : null
  const model = editor != null && typeof editor.getModel === 'function' ? editor.getModel() : null
  if (editor != null && typeof editor.updateOptions === 'function') {
    // Read-only is a property of THIS view, not of the file: the same path is
    // editable in the org lane and read-only in a worktree diff. Setting it on
    // the provider or through files.readonlyInclude would be global.
    editor.updateOptions({ readOnly: !editable, domReadOnly: !editable })
  }

  // Re-apply the shape on every container resize. The editor part follows its
  // container's SIZE on its own; this is what changes its SHAPE as the pane
  // narrows. Guarded on the computed values, not the pixel width, so a drag
  // does not write settings.json once per frame.
  let shape = JSON.stringify(layoutFor(container.getBoundingClientRect().width))
  const ro = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect?.width ?? 0
    if (w === 0) return                      // a hidden pane measures 0
    const next = layoutFor(w)
    const key = JSON.stringify(next)
    if (key === shape) return
    shape = key
    writeConfig(next)
  })
  ro.observe(container)
  const sub = onChange && model ? model.onDidChangeContent(() => onChange()) : null
  let live = true
  return {
    editor,
    model,
    getText: () => (model ? model.getValue() : ''),
    /** Replace [from, to) with `insert`, keeping cursor and undo history —
     *  what the prettier format action needs (it computes one minimal edit). */
    replaceRange: (from, to, insert) => {
      if (editor == null || model == null) return
      editor.executeEdits('arxa-format', [{
        range: monaco.Range.fromPositions(model.getPositionAt(from), model.getPositionAt(to)),
        text: insert,
      }])
    },
    focus: () => { if (editor != null) editor.focus() },
    dispose: () => {
      if (!live) return
      live = false
      if (sub) sub.dispose()
      ro.disconnect()
      // The markdown preview is a webview: an iframe in a position:fixed
      // overlay on document.body, anchored to its pane with CSS anchor
      // positioning. The client disposes this handle when its host UNMOUNTS
      // (a loading hint sits between two files), and an anchor that has left
      // the DOM resolves to nothing — the overlay falls back to the page's
      // top-left at the iframe default of 300x150, which in the studio is the
      // sidebar. Measured live in Chrome and WebKit, 2026-09-07. The preview is
      // a derived view of this file, so close it here; showMarkdownPreview
      // recreates it on the next open.
      void closeWebviews()
      // The EDITOR is not disposed here. It belongs to the editor part, which
      // owns its own lifecycle — and the part is what keeps the tab, so tearing
      // it down on every React unmount would close the file the user is looking
      // at. The registered file and its model stay for the life of the page
      // (see `open` above), which is what lets undo history survive a round
      // trip. closeAll() is the explicit way to clear the part.
    },
  }
}

/** Close every webview editor (the markdown preview) in the main part. */
async function closeWebviews () {
  const editorService = await getService(IEditorService)
  const groups = await getService(IEditorGroupsService)
  const doomed = []
  for (const g of groups.mainPart.groups) {
    for (const editor of g.editors) {
      if (editor.typeId === 'workbench.editors.webviewInput') doomed.push({ editor, groupId: g.id })
    }
  }
  if (doomed.length) await editorService.closeEditors(doomed)
}

/** Bring the overlay filesystem in line with the bytes the host just read.
 *
 *  Registering is once-per-uri (registerFile THROWS on a uri the provider
 *  already holds), so a reopen writes instead. The comparison matters: the
 *  effect that calls this re-runs on every `text` change, and writing
 *  unconditionally would discard whatever the user had typed since. */
async function syncFile (uriPath, text) {
  const existing = open.get(uriPath)
  if (existing === void 0) { acquire(uriPath, text); return }
  const bytes = new TextEncoder().encode(text)
  const held = await existing.file.read()
  if (held.length === bytes.length && held.every((b, i) => b === bytes[i])) return
  await fsp.writeFile(existing.uri, bytes, { create: false, overwrite: true, unlock: false, atomic: false })
}

/** Put a file in the overlay filesystem WITHOUT opening an editor for it.
 *
 *  The editor part resolves a uri through the file service, so a file has to
 *  exist before openEditor() can be asked for it. openFile() registers as a
 *  side effect of opening; this is the same registration on its own. */
export async function registerFile (uriPath, text) {
  await start()
  acquire(uriPath, text)
}

/** Mount VS Code's editor part in `container`.
 *
 *  This is the surface every non-text viewer arrives on: the markdown preview
 *  and media-preview's image/audio/video editors are editor INPUTS, and an
 *  input needs a part to open into. Returns the part's disposable.
 *
 *  ponytail: one part for the page, attached on first use. attachPart can be
 *  called again with a new container (the demo does exactly that when the
 *  sidebar changes side), so a remount is a re-attach, not a teardown. */
let editorPart = null
let editorPartHost = null
export async function attachEditorPart (container) {
  await start(container)
  // Guarded: openFile() calls this on every open, and attachPart installs a
  // fresh ResizeObserver each time. Re-attaching to a NEW container is still
  // supported — that is a remount, not a teardown.
  if (editorPartHost === container) return editorPart
  if (editorPart !== null) editorPart.dispose()
  editorPartHost = container
  editorPart = attachPart(Parts.EDITOR_PART, container)
  return editorPart
}

/** Open `uriPath` through VS Code's editor service.
 *
 *  Different from openFile(): that one creates a bare monaco editor over a
 *  model and is what the code lane still drives. This one hands the uri to VS
 *  Code and lets it choose the editor — a text editor for source, media-preview's
 *  custom editor for a png, whatever a future extension registers. */
export async function openEditor (uriPath, { pinned = true, readOnly = false } = {}) {
  const editorService = await getService(IEditorService)
  // openEditor(input, options, group) — the third argument is the GROUP, not
  // more options. Passing an options bag there resolves to undefined and opens
  // nothing, with no error to show for it.
  // Open into the MAIN part's active group explicitly. IEditorGroupsService
  // spans every part (main plus any auxiliary window), and openEditor with no
  // group picks the service's active one — which is not necessarily the group
  // inside the part that was attached. Measured: the file opened into a group
  // holding 1 editor while the active group held 0 and painted `content empty`.
  const groups = await getService(IEditorGroupsService)
  return editorService.openEditor({
    resource: monaco.Uri.file(uriPath),
    options: { pinned, ...(readOnly ? { readOnly: true } : {}) },
  }, groups.mainPart.activeGroup)
}

/** Editor-part diagnostics for the spike harness. Not used by the viewer. */
export async function editorPartInfo () {
  const editorService = await getService(IEditorService)
  const groups = await getService(IEditorGroupsService)
  const notifications = await getService(INotificationService)
  return {
    editors: editorService.count,
    active: String(editorService.activeEditor?.resource ?? 'none'),
    paneId: String(editorService.activeEditorPane?.getId() ?? 'none'),
    groups: groups.groups.map((g) => g.id + ':' + g.count + ':' + (g.element?.isConnected ? 'dom' : 'off')).join(' '),
    parts: groups.parts.length,
    mainGroups: groups.mainPart.groups.map((g) => g.id + ':' + g.count).join(' '),
    openRes: editorService.editors.map((e) => String(e.resource)).join(' '),
    groupActive: String(groups.activeGroup?.activeEditor?.resource ?? 'none'),
    notices: (notifications.model?.notifications ?? []).map((n) => String(n.message?.linkedText?.toString?.() ?? n.message)).join(' | '),
  }
}

/** Close every editor in the part.
 *
 *  The viewer shows ONE artifact at a time and drives its own file selection
 *  from the sidebar, so tabs must not accumulate behind it. */
export async function closeAll () {
  const groups = await getService(IEditorGroupsService)
  for (const g of groups.mainPart.groups) await g.closeAllEditors()
}

/** Replace an already-registered file's bytes — an external change on disk.
 *
 *  registerFile() can only be called once per uri (registerFile THROWS on a uri
 *  the provider already holds), so a changed file arrives here. */
export async function updateFile (uriPath, text) {
  await start()
  await syncFile(uriPath, text)
}

/** Open VS Code's diff editor: `uriPath` against `originalText`.
 *
 *  The original side gets its OWN uri (`<path>.arxa-main`) rather than being a
 *  detached model: the diff editor takes two resources, and a second model on
 *  the file's own uri would collide with the one the editor already holds.
 *
 *  Narrow panes get the inline view — side-by-side in a 300px pane is two
 *  useless columns. Same reasoning as the minimap in layoutFor. */
export async function openDiff (uriPath, originalText, { sideBySide = null, editable = true } = {}) {
  const origPath = uriPath + '.arxa-main'
  await syncFile(origPath, originalText)
  if (sideBySide !== null) writeConfig({ 'diffEditor.renderSideBySide': sideBySide })
  const editorService = await getService(IEditorService)
  const groups = await getService(IEditorGroupsService)
  const name = uriPath.slice(uriPath.lastIndexOf('/') + 1)
  const pane = await editorService.openEditor({
    original: { resource: monaco.Uri.file(origPath) },
    modified: { resource: monaco.Uri.file(uriPath) },
    // Without a label the tab reads `notes.md.arxa-main ↔ notes.md`, which
    // leaks the scratch uri the original side needs.
    label: 'main ↔ ' + name,
    options: { pinned: false },
  }, groups.mainPart.activeGroup)
  // VS Code decides readOnly from the file system provider, and our overlay
  // provider is writable — so the modified side comes up editable no matter how
  // the file was opened. It is the file's OWN model, which onChange and the
  // 1.5s auto-save both watch, so leaving it writable makes the diff a back
  // door that saves a file the code editor refused to let you type in.
  const ctl = pane != null && typeof pane.getControl === 'function' ? pane.getControl() : null
  const mod = ctl != null && typeof ctl.getModifiedEditor === 'function' ? ctl.getModifiedEditor() : null
  if (mod != null) mod.updateOptions({ readOnly: !editable, domReadOnly: !editable })
  return pane
}

/** Show VS Code's rendered markdown preview for `uriPath`, as its own tab.
 *
 *  The preview is a WEBVIEW, and a webview is an editor input — which is why it
 *  needs the editor part and could not exist before it. It replaces the vendored
 *  markdown-it + DOMPurify bundle and brings what that never had: VS Code's own
 *  stylesheet, math, checkboxes, and code fences highlighted by the same
 *  grammars the editor uses. */
export async function showMarkdownPreview (uriPath) {
  await openEditor(uriPath, { pinned: false })
  await runCommand('markdown.showPreview')
}

/** Run a VS Code command — `markdown.showPreview` and friends. */
export async function runCommand (id, ...args) {
  const commandService = await getService(ICommandService)
  return commandService.executeCommand(id, ...args)
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
