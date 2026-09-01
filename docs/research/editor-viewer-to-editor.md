# Web Research: Artifact Viewer -> Code/Text Editor (Monaco vs CodeMirror 6)

Grades: FIRE=verified official docs/npm/first-party (2025/2026) · WARM=credible secondary/slightly dated · COLD=community/anecdotal.

## 1. Comparison table

| Dimension | Monaco Editor | CodeMirror 6 |
|---|---|---|
| Current version | 0.54.0 [WARM: npm/newreleases] | 6.0.x per-package (codemirror convenience ~6.0.2; @codemirror/state 6.5.x) [WARM] |
| License | MIT [FIRE: npm] | MIT for all @codemirror/* [FIRE: npm] |
| Steward | Microsoft (VS Code engine) [FIRE] | Marijn Haverbeke (ProseMirror author) [FIRE] |
| Bundle size | ~2-5 MB total, 1 MB+ gzipped even trimmed; needs workers [FIRE/WARM] | ~50-200 kB tree-shaken for a usable editor; tiny core [FIRE/WARM] |
| Architecture | Monolithic-ish; global monaco namespace/models; per-language modules + web workers for TS/JSON/CSS/HTML | Modular packages: @codemirror/state, view, language, commands, search, autocomplete, lang-*; everything is an extension [FIRE] |
| Languages | Ships tokenizers for ~all VS Code languages; built-in TS/JS/CSS/HTML/JSON smart workers [FIRE] | Per-package Lezer grammars (lang-javascript, -python, -sql, -markdown, -json, -html, -css, -cpp, -java, -rust, -php, ...) [FIRE] |
| IntelliSense / LSP | TS worker built in; any LSP via monaco-languageclient v10.x (10.6.0 current, TypeFox) + vscode-languageserver-protocol [FIRE] | No built-in LSP; codemirror-languageserver or DIY facets [WARM] |
| Diff editor | Built-in DiffEditor [FIRE] | @codemirror/merge / community [WARM] |
| Mobile/touch | Limited, desktop-first [WARM] | First-class mobile + excellent a11y reputation [FIRE] |
| Large-file perf | Heavy, memory-hungry; minimap/workers add cost [WARM] | Very good; Lezer incremental parsing [WARM] |
| React wrapper | @monaco-editor/react [FIRE] | @uiw/react-codemirror; trivial vanilla embedding [FIRE] |
| SSR | Not SSR-safe; lazy-load required [WARM] | Fine in any DOM/webview [WARM] |

## 2. Who embeds what

- Monaco: VS Code itself (vscode.dev), Azure Portal, TypeScript Playground, StackBlitz, GitLab Web IDE [WARM/COLD]
- CodeMirror 6: Firefox DevTools, Chrome DevTools (new frontend), Replit, Jupyter/JupyterLab 7, Sourcegraph (migrated away from Monaco), react.dev examples via Sandpack (whose editor layer is CodeMirror 6) [FIRE/WARM]
- Sourcegraph migration post: Monaco was 40% of their external dep weight, hard to trim, global model made multi-instance painful; 90% of Monaco functionality replaced in 2 days with CodeMirror [WARM] - https://sourcegraph.com/blog/migrating-monaco-codemirror
- Neutral 2026 comparison - https://www.pkgpulse.com/guides/monaco-editor-vs-codemirror-6-vs-sandpack-in-browser-2026 [WARM]: 'Monaco for full-IDE/TS IntelliSense; CodeMirror 6 for most custom editor integrations.'

## 3. Embedding guidance for a webview shell (React or non-React)

- Both are framework-agnostic at core; React wrappers optional. Load the editor lazily (dynamic import on first open of a code artifact); Monaco must never be in the initial bundle [WARM].
- Monaco in webviews: requires web workers (MonacoWebpackPlugin / vite-plugin-monaco-editor / manual). In some webview sandboxes worker loading needs MonacoEnvironment.getWorkerUrl with blob URLs [WARM/COLD] - test early in your exact shell.
- CodeMirror 6: no workers, no global namespace, multiple instances trivial, arbitrary theming via EditorView.theme - best fit for a pane inside an artifact viewer [WARM].
- Rule of thumb: need TS IntelliSense / LSP / diff editor out of the box, desktop-only -> Monaco. Need light weight, fast load, touch-friendly, custom chrome -> CodeMirror 6.

## 4. Viewer -> editor: requirement checklist

File tree and tabs are NOT provided by either editor (Monaco has no tab UI outside VS Code; Sandpack has tabs but is a playground) [WARM] - build them in the shell.

1. Save flow: File System Access API (showSaveFilePicker + writable handles) is Chromium-only; no Safari/WebKit (open WebKit bug 231706) and Firefox partial [FIRE] - https://web-platform-dx.github.io/web-features-explorer/features/file-system-access/ . In WKWebView/Safari webviews it is unavailable; in WebView2 it works but passing handles across the host boundary has issues (WebView2Feedback #3706) [WARM]. Desktop shell: prefer native host saves via IPC bridge; FS Access API only as browser fallback; web.dev pattern https://web.dev/patterns/files/save-a-file [FIRE].
2. Dirty state: derive from editor change events (Monaco onDidChangeModelContent; CM6 updateListener + docChanged) vs last-saved snapshot; tab dot + Cmd/Ctrl+S binding (Monaco addCommand; CM6 keymap); confirm before close [WARM].
3. Undo: both ship undo/redo (CM6 history in basicSetup; Monaco built-in). Keep undo across save; decide reset-vs-merge on external reload (prior art: Zed PR #51037 'reload after undo when file changed while dirty') [COLD].
4. External-change watching: no web API watches files after load; FS Access API has no stable watcher in webviews. In a desktop shell, watch via native host (FSEvents/ReadDirectoryChangesW/inotify) -> IPC -> if buffer dirty prompt overwrite/compare, else re-set model/doc [WARM].
5. Large files: CM6 handles multi-MB docs well; Monaco struggles past a few MB (disable minimap). Suggest view-only fallback above ~5-10 MB [WARM/COLD].
6. Read-only <-> editable toggle: Monaco editor.updateOptions({readOnly}) per model; CM6 reconfigure EditorState.readOnly / EditorView.editable via Compartment - instant toggle, no remount [WARM].
7. Multi-model tabs: Monaco: one editor, swap models per tab (models keep view state + undo) - canonical approach [WARM]. CM6: per-tab EditorState, swap via view.setState, or one EditorView per tab swapping DOM.
8. Syntax detection: map file extension -> language id (Monaco) / lang package (CM6); plain-text fallback for unknown extensions.

## 5. Recommendation for this artifact viewer/editor

- CodeMirror 6 is the better default for a viewer-that-edits: tiny core, instant load in view mode, modular languages, superb webview behavior, no workers [WARM].
- Pick Monaco only if TS/JS IntelliSense or the built-in diff editor is a hard requirement and desktop-only payload is acceptable [WARM].
- Either way: tabs/file tree/save IPC belong to the shell; treat the editor as a swappable pane component (interface: open(doc), setReadOnly, onDirty, save()).

## Sources

- https://www.npmjs.com/package/monaco-editor · https://newreleases.io/project/npm/monaco-editor/release/0.54.0
- https://www.typefox.io/blog/monaco-languageclient-v10/ · https://app.unpkg.com/monaco-languageclient@10.6.0/files/CHANGELOG.md
- https://codemirror.net/docs/ · https://www.npmjs.com/package/codemirror
- https://sourcegraph.com/blog/migrating-monaco-codemirror
- https://www.pkgpulse.com/guides/monaco-editor-vs-codemirror-6-vs-sandpack-in-browser-2026
- https://web-platform-dx.github.io/web-features-explorer/features/file-system-access/ · https://web.dev/patterns/files/save-a-file
- https://bugs.webkit.org/show_bug.cgi?id=231706 · https://github.com/MicrosoftEdge/WebView2Feedback/issues/3706
- https://github.com/zed-industries/zed/pull/51037
