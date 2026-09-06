# Artifact viewer → VS Code (Monaco + LSP) — phased plan (2026-09-06)

Third and last branch of `docs/plans/sidebar-git-card-viewer-harmony-grill.md`:
G7 (Monaco), G8 (host-spawned language servers), G9 (media lanes via VS Code
extensions), G10 (what leaves), G11 (Dart / Rust / JS-TS / HTML-CSS-JSON),
G12 (built at pack time into the engine payload).

User's ask, verbatim: *"i want the whole artifact viewer to be exactly like the
viewer in vs code, same gaps and lsp for dart, rust, js, html etc"*.

This is the largest of the three branches by an order of magnitude. It is
phased, and **each phase is its own commit, verified on screen before the
next**.

---

## What the viewer is today (verified, not assumed)

- `plugins/artifact-viewer/lib/client.js` — 107 KB, **hand-written**. Unlike
  `arxa-sidebar` and `arxa-git-card` there is no generator and no drift gate on
  it; `selftest.mjs` only runs the drift gates of *other* plugins
  (`gen-frame.mjs`, `gen-insight-css.mjs`). It is safe to edit directly.
- `lib/vendor.js` — a **dev-time esbuild script** that bundles CodeMirror,
  markdown-it + DOMPurify, pdf.js, prettier, material-icon-theme and Fira Code
  into IIFE files under `lib/vendor/`. Those outputs are **committed** (~4.9 MB).
- The client loads them with a plain `<script>` tag (`ensureVendor(name, global)`)
  from `/__arxa/artifacts/vendor/<name>` on the **studio origin**, reading
  `window.ArxaCM` / `ArxaMD` / `ArxaPDF` / `ArxaPrettier` / `ArxaTheme` /
  `ArxaIcons`.
- Lanes today (`client.js:56-63`): `markdown`, `image`, `audio`, `video`,
  `iframe` (html/htm/mdx), `pdf`, `code`, `text`.
- `lib/org-server.js` is a **read-only** per-org origin (GET/HEAD only, 405 on
  anything else, D7/D81). It serves rendered artifact bytes into an iframe. The
  editor does **not** live there and never will — it stays on the studio origin
  exactly where CodeMirror is today.

## Phase 0 — feasibility spike (must pass before phase 1)

Four questions, in "kills the branch if wrong" order.

### 0.1 Does the host webserver support WebSocket upgrade? — **YES**

`monaco-languageclient` + `vscode-ws-jsonrpc` speak LSP over a WebSocket, but
every arxa host route so far is `ctx.webServer.register({path, handler})`, which
is plain HTTP. Checked the engine:

```
node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js
  176: register(route)
  190: registerUpgrade(route)      ← exact-path HTTP upgrade route
  260: this.server.on("upgrade", …)
  283: this.upgradedSockets.add(socket)
  312: …awaited on shutdown
```

So the LSP bridge is `registerUpgrade({ path: '/__arxa/artifacts/lsp' })` on the
studio origin, and open sockets are already tracked for graceful shutdown. No
second ephemeral-port server needed.

### 0.2 Can the client `import()` ESM off the vendor route, and spawn workers? — **YES, with a small route change**

`@codingame/monaco-vscode-api` is ESM-only, ships `?worker` / `?raw` imports and
a rollup vsix plugin — it is a **Vite/Rollup/Webpack** library. esbuild-IIFE (the
shape `lib/vendor.js` produces) is not a supported output. So the bundle becomes
ESM chunks loaded by `import(url)`, not a `<script>` tag.

- **Vendor route** (`lib/index.js:137 createVendorRoutes`) resolves
  `path.basename(pathname)` against a flat `vendorDir`, so flat-named chunks
  work unchanged. Two things must change: the `EXT_TYPES` table only knows
  `.woff2` and `.png` and defaults everything else to `text/javascript` — it
  needs `.css`, `.wasm`, `.ttf`, `.svg`, `.json`, `.map`; and `cache-control:
  no-store` on a few hundred chunks is wasteful, so hashed chunk names get
  `immutable`.
- **CSP**: there is **no** `Content-Security-Policy` on the studio origin (the
  only CSP in the tree is the one `plugins/mcp-apps` writes into its own
  sandboxed iframe). Nothing blocks `new Worker()` or a dynamic `import()`.
- **Rollup output must be flat**: `entryFileNames` / `chunkFileNames` /
  `assetFileNames` all `'[name]-[hash][extname]'`, no directories — the vendor
  route cannot serve subpaths.
- ⚠️ The webworker extension host runs extensions in an iframe of its own —
  **confirmed by the spike output**, see 0.4.

### 0.3 Are the VS Code extensions available without .vsix sourcing? — **YES, except PDF**

The `@codingame/monaco-vscode-rollup-vsix-plugin` is a **build-time** plugin, so
any extension has to exist on disk at build time; there is no network in pack.
But CodinGame publishes the built-in extensions as npm packages at the same
version, which removes the .vsix sourcing problem for everything G9 named except
one. Verified present at `36.2.7`:

`media-preview`, `markdown-language-features`, `markdown-math`, `dart`, `rust`,
`typescript-basics`, `javascript`, `json`, `html`, `css`, `theme-defaults`,
`configuration-editing` — all as
`@codingame/monaco-vscode-<name>-default-extension`.

`tomoki1207.pdf` is a marketplace extension with no npm mirror: it needs the
.vsix vendored with a sha256 pin (the discipline `lib/vendor-build/themes/`
already uses), and it stays behind the existing pdf.js lane until the worker-host
test passes.

### 0.4 How big is the bundle? — **MEASURED: 30 MB on disk, 8.5 MB gzipped**

The spike builds. `plugins/artifact-viewer/lib/monaco-build/` is an isolated npm
root (same reason `vendor-build` is isolated): 382 packages, 1.3 GB of
`node_modules`, `vite build` in 1.2 s.

| | |
|---|---|
| `dist/` on disk | **30 MB**, 201 files, **0 subdirectories** ✅ |
| gzipped (what `payload.tar.gz` costs) | **8.5 MB** |
| source maps inside it | 8.2 MB — droppable, takes disk to ~22 MB |
| committed vendor today (retired by phase 6) | 4.9 MB |

Largest pieces: the main chunk 8.7 MB, `editor` 3.4 MB, `extensionHost.worker`
1.9 MB, the markdown extension 1.9 MB, `serverWorkerMain` 1.1 MB, oniguruma
wasm 467 KB.

**This is the product call.** The desktop sidecar grows by roughly 8.5 MB
compressed, net of the ~5 MB of vendor bundles phase 6 deletes. The number goes
to the user before phases 2-6 are scheduled.

Build gotchas found and fixed in the spike, so phase 1 does not rediscover them:

- Vite 8 / rolldown, not esbuild. `?worker` (constructor) and `?worker&url`
  (WorkerConfig.url, which is what the extensions override takes).
- `?worker` **cannot ride a bare specifier** through an exports map — the query
  string never matches. One-line local re-export modules (`src/editor.worker.js`)
  give the suffix a relative path to attach to.
- monaco-vscode-api's exports map is `"./*" → "./*.js"`, so the worker specifier
  must be written **without** `.js`: `…/workers/editor.worker`.
- `overrides` alone does not materialise the `monaco-editor` alias — it must
  also be a direct dependency (`"monaco-editor": "npm:@codingame/monaco-vscode-editor-api@36.2.7"`).
- `base: '/__arxa/artifacts/vendor/'` is pinned in the vite config so emitted
  worker and asset URLs point at the route that serves them.
- `assetsInlineLimit: 0` — a `data:` URI cannot be served by the vendor route.

`node_modules/` and `dist/` are gitignored; **the lockfile is committed** — G12
keeps build script + lockfile in the repo and nothing else.

#### What the vendor route must learn (measured from the real output)

`EXT_TYPES` currently knows `.woff2` and `.png` and defaults everything to
`text/javascript`. The build emits, and the route must type correctly:

`.js` (33) · `.json` (62) · `.css` · `.wasm` (2, the oniguruma TextMate engine) ·
`.ttf` (21) · `.woff` (20) · `.woff2` (20) · `.svg` (17) · `.html` (1) ·
`.txt` · `.md` · `.map` · `.tmLanguage` · `.code-snippets`

A `.wasm` served as `text/javascript` fails `WebAssembly.instantiateStreaming`
outright, so this is a phase-1 blocker, not a nicety.

⚠️ That one `.html` asset is `webWorkerExtensionHostIframe.html` — **confirmed**:
the extension host does run in an iframe, and served from our vendor route it is
**same-origin with the studio**. VS Code's own web build puts that iframe on a
separate CDN origin precisely to isolate it. Extensions here are vendored and
version-pinned at build time so nothing third-party loads at runtime, but this
widens what executes on the studio origin and phase 3 must look at it directly.

### The fallback rung — declared up front, NOT taken

**Phase 0 passed on all four questions**, so this rung is not being used. It
stays written down because the only remaining way the branch dies is the user
judging 8.5 MB too expensive, and a dead end is worse than a smaller answer.

If it had failed on size, on workers, or on the extension-host iframe: drop to
plain `monaco-editor` + `monaco-languageclient` (no `monaco-vscode-api`). That
still delivers **all of G11** — Dart, Rust, JS/TS, HTML/CSS/JSON with
diagnostics, hover, completion, go-to-definition — and real Monaco feel, gaps
and gutters included. What is lost is G9's extension-driven media lanes, so the
existing markdown / pdf / image / audio / video lanes stay as they are. G7 is
not re-opened otherwise; the user confirmed it.

---

## Phases

Each phase = one commit, verified on screen before the next starts.

### Phase 1 — Monaco code lane

Replace the CodeMirror `code` and `text` lanes. Services: base, host, files,
configuration, theme, textmate, languages, keybindings, quickaccess. Themes come
from `theme-defaults` (real VS Code theme JSON, retiring the hand-compiled
HighlightStyle table in `vendor.js`). `editor.fontFamily` keeps Fira Code.
Grammars: dart, rust, typescript-basics, javascript, json, html, css.

Diff lane moves to Monaco's `DiffEditor` (retires `@codemirror/merge`).

### Phase 2 — LSP bridge (G8, G11)

- Host: `registerUpgrade({ path: '/__arxa/artifacts/lsp' })`. One server per
  language per open org, spawned **lazily on first file of that language**,
  rooted at the org folder, through the confining spawner, **killed on org
  switch** (the same lifecycle `org-server.js` already has).
- `routeLang(ext) → server` table: `dart language-server`, `rust-analyzer`,
  `typescript-language-server --stdio`, `vscode-langservers-extracted`
  (html/css/json). Unknown extension → no server, editor still works.
- Missing binary → the lane still opens, with an **Install** button that
  downloads into `~/.arxa`. Never automatic. Dart is the exception: its server
  ships inside the Dart/Flutter SDK, so the button can only *locate* an
  installed SDK on PATH — there is no download path and the copy must say so.

### Phase 3 — markdown + media (G9)

`markdown-language-features` (+ `markdown-math`) takes the markdown lane;
`media-preview` takes image / audio / video. Retires `markdown.js` (markdown-it
+ DOMPurify). html/mdx stay in the sandboxed iframe on the org origin — that is
the D7 wall and it does not move.

### Phase 4 — PDF + formatting

PDF: `tomoki1207.pdf` .vsix, sha256-pinned, **only if** the worker extension
host runs it. pdf.js stays until then. Formatting: `prettier-vscode` web build
replaces the 2.1 MB vendored `prettier.js`; Shift-Alt-F routes through VS Code's
format command instead of `formatActionRef`.

### Phase 5 — autosave + dirty state

A write-through VS Code filesystem provider over the existing
`/__arxa/artifacts/write` route, so VS Code models own dirty state. `files.autoSave`
if monaco-vscode-api honours the setting override; otherwise a 1 s
`afterDelay`-equivalent debounce. **Unverified — it is on the carried-items list.**

### Phase 6 — vendor cleanup

Delete `lib/vendor/codemirror.js`, `markdown.js`, `prettier.js`, `pdf.js`,
`pdf.worker.js` and the parts of `lib/vendor.js` that built them. `icons.js`
(Material icons, used by the sidebar too) and the Fira Code woff2 stay. Net
repo change should be a **reduction** — the monaco bundle is not committed.

---

## Carried unknowns (from the grill, still open)

- `tomoki1207.pdf` under the webworker extension host — test before retiring pdf.js.
- `files.autoSave` under monaco-vscode-api — verify; fallback is the debounce.
- Dart server discovery on PATH — no download path exists.
- **New (0.2):** the extension-host iframe is same-origin with the studio.
