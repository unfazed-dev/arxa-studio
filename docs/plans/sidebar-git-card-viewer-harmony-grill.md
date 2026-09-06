# Sidebar, git card and artifact viewer harmony — grill decisions (2026-09-06)

Grilled with the user on 2026-09-06. Findings first, then the decisions (G1–G13),
then the delivery order. Implementation plans for each branch are written
separately when that branch starts (G13).

## Findings that shaped the questions

Sidebar (`plugins/arxa-sidebar`, generated `lib/client.js` from
`scripts/gen-workspace.mjs` + `lib/workspace-region.snippet.txt`):

- Two icon systems: org/dock/project rows use dsh primitives
  (`IconFolderOpen16`/`IconFolderClose16`, `OrgGlyph`); files and subfolders inside
  `ArxaDirRows` use the Material Icon Theme colour pack (`/__arxa/artifacts/vendor/icons.js`).
- `kitchen-project` is listed twice under Projects: `ARXA_ROW_HIDDEN.docks` has no
  `projects` entry (snippet :1587), so the "files-only" lister on the Projects dock
  row repeats every project directory that is already a tree row.
- Notes is a "bare dock" (`orgItems`, snippet :412): sessions bind to `notes`
  itself; its subfolders are painted flat by the lister, never as tree rows.
- dsh's stock tree colours the folder glyph of the group holding the current
  session (`group.expanded && group.containsCurrent` → `folderActive`,
  `color: var(--dsw-alias-state-business-primary)`, dsh-client-ui-workspace
  client.js :656/:682). arxa's `OrgContainerRow` never applies it.

Git card (`plugins/arxa-git-card`, generated from `scripts/gen-git-card.mjs` +
`lib/git-card.snippet.txt`):

- `Icon(name, fallback)` falls back silently. `IconUploadOutline16` (Mint) and
  `IconGitBranchOutline14` (head) do not exist in the frontend bundle
  (dsh-web-frontend/dist/assets/index-*.js exposes 74 `Icon*` names). Refresh is
  reused for Integrate/Wake/Re-run, Check for Commit/Merge/Finish/Save.
- No confirmation on any action. Errors are toasts carrying raw reason codes.
- The head shows `re-link GitHub — the session expired`
  (`status.github.relinkRequired`); every GitHub-backed action then fails with
  `github-unavailable`. The text is inert.

Artifact viewer (`plugins/artifact-viewer`):

- Lanes: markdown, code, text, image, video, iframe (html/mdx), pdf. Code = CodeMirror 6
  vendored as one 885 KB IIFE (js/ts, css, html, json, yaml, python, go, rust, sql,
  sass, toml, shell, Dart via legacy clike). Also pdf.js, markdown-it, prettier
  (2.1 MB), Fira Code, icons.js. ~4.9 MB committed under `lib/vendor/`. No LSP.
- Root font 14px, scroll padding 10px 12px — not VS Code's 12px / ~18px line
  height / gutter-tight layout.
- dsh ships no viewer/editor: `dsh-client-ui-deliverables` hands paths to the
  host opener. Community `dsh-file-viewer` is read-only preview and patches the
  stock workspace bundle for a menu entry. Nothing to reuse for editing or LSP.
- Docs read: `@codemirror/lsp-client` 6.1.0 (official, transport-agnostic);
  `monaco-languageclient` 10.7.0 + `@codingame/monaco-vscode-api` 36.2.7
  (VS Code services on Monaco; web-worker extension host; default extensions as
  npm packages incl. `media-preview`, `markdown-language-features`, `dart`,
  `rust`; `.vsix` loading via rollup plugin; node extensions need the remote
  agent = a full VS Code server). Open VSX: `tomoki1207.pdf` 1.2.2 (.vsix; worker
  compatibility unverified), `esbenp.prettier-vscode` 12.4.0 (has a `browser`
  entry → runs in the worker host). VS Code Marketplace terms exclude
  non-VS Code products; Open VSX or vendored vsix only.

## Decisions

- **G1 Icons.** dsh glyphs for folders (org/dock/project/note rows and lister
  directories), Material colour icons for files only. The lister's directory rows
  switch from Material folder glyphs to `IconFolderOpen16`/`IconFolderClose16`.
- **G2 Notes.** Every first-level subfolder of Notes becomes a real tree row (like
  a project): sessions bind to `notes/<sub>`, its files list under it when
  expanded. Deeper folders stay lister rows. (Also: add `projects` to
  `ARXA_ROW_HIDDEN.docks` so project rows are not listed twice.)
- **G3 Active glyph.** dsh rule verbatim: only the row the current session binds
  to gets `folderActive`. Plus an accent dot on the current session's own row,
  next to the stock selected background.
- **G4 Card confirmations.** Stock `P.Modal` (same as the Claude row / Delete)
  on Merge PR, Integrate main, Finish integrating, Mint version. Create PR and
  Commit keep their text entry as the pause. Cancel CI stays one click.
- **G5 Card icons.** Head `IconBranchOutline16`; Refresh/PR refresh
  `IconRefreshOutline16`; Integrate `IconDownloadOutline16`; Finish
  `IconCheckOutline16`; Wake `IconPlayOutline16`; Draft `IconSparkle16`; Commit
  `IconListPenOutline16`; Create PR `IconSendOutline16`; Merge
  `IconCheckOutline16`; Mint `IconGoalOutline16`; Re-run `IconRefreshOutline14`;
  Cancel CI `IconStopFill16`; Open run `IconRightUpOutline16`; insight trio and
  editor Save/Cancel unchanged. Every name must exist in the frontend bundle
  (selftest pins the list).
- **G6 Card error.** The relink text becomes a button that starts the GitHub
  sign-in; GitHub-backed actions are hidden (not failing) while
  `relinkRequired`.
- **G7 Editor engine.** Monaco via `@codingame/monaco-vscode-api` +
  `monaco-languageclient`. CodeMirror lanes retired.
- **G8 Language servers.** Host spawns one server per language per open org,
  lazily on first file, rooted at the org folder, killed on org switch, through
  the confining spawner. Missing binary → editor still works; an Install button
  downloads into `~/.arxa` (never automatic). Dart's server ships in the
  Dart/Flutter SDK: the button can only locate an installed SDK on PATH.
- **G9 Media lanes.** VS Code built-in extensions: `media-preview` (image, audio,
  video), `markdown-language-features` (preview), `dart` and `rust` grammars.
  PDF via `tomoki1207.pdf` .vsix, pdf.js kept as fallback until the worker-host
  test passes. html/mdx stay in the sandboxed iframe. LSP via
  monaco-languageclient to host-spawned servers, not the Dart-Code /
  rust-analyzer extensions (node extensions; would need a VS Code server).
- **G10 What leaves the viewer.** Moves to VS Code machinery: code + diff lanes,
  markdown lane, image/audio/video lanes, PDF, formatting (`prettier-vscode`
  web build), autosave + dirty state (VS Code models + a write-through
  filesystem provider on the existing write route; `files.autoSave` if the
  override honours it, else a 1 s after-delay save), themes (VS Code theme JSON).
  Stays arxa: docked column shell, iframe lane, insight surfaces, tree/token/
  write/version/session-changes routes, the filesystem provider, Material icons
  (sidebar only), Fira Code via `editor.fontFamily`. Vendored codemirror.js,
  markdown.js, prettier.js, pdf.js and `lib/vendor.js` go once replaced.
- **G11 Servers in scope.** Dart (`dart language-server`), Rust
  (`rust-analyzer`), JS/TS (`typescript-language-server`), HTML/CSS/JSON
  (`vscode-langservers-extracted`). Features: diagnostics, hover, completion,
  go-to-definition inside the viewer, formatting where offered.
- **G12 Bundle location.** Built at pack time (pack-sidecar) into the engine
  payload under `~/.arxa`; repo keeps build script + lockfile only.
- **G13 Order.** Sidebar branch, then git card branch (one plan + one commit
  each, verified on screen), then the viewer as its own phased plan: Monaco code
  lane → LSP bridge → markdown + media → pdf + formatting → autosave → vendor
  cleanup.

## Open items carried

- `tomoki1207.pdf` worker-host compatibility: test before retiring pdf.js.
- `files.autoSave` under monaco-vscode-api: verify; fallback is the debounce.
- Dart server discovery on PATH (`dart`/`flutter` SDK) — no download path.
