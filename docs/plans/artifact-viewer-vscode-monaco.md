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

### 0.4 How big is the bundle, and does it RUN? — **31 MB / 8.5 MB gzipped, and yes**

`plugins/artifact-viewer/lib/monaco-build/` is an isolated npm root (same reason
`vendor-build` is isolated): 383 packages, 1.3 GB of `node_modules`, `vite build`
in ~1.2 s.

| | |
|---|---|
| `dist/` on disk | **31 MB**, 203 files, **0 subdirectories** ✅ |
| gzipped (what `payload.tar.gz` costs) | **8.5 MB** |
| source maps inside it | 8.2 MB — droppable, takes disk to ~23 MB |
| committed vendor today (retired by phase 6) | 4.9 MB |

Largest pieces: the entry 8.7 MB, `editor` 3.4 MB, `extensionHost.worker`
1.9 MB, the markdown extension 1.9 MB, `serverWorkerMain` 1.1 MB, oniguruma
wasm 467 KB.

**It executes.** `node check.mjs` serves `dist/` on a throwaway port and drives
it with `arxa lens check`; console and page errors auto-fail the lens. Green:
Monaco boots, a `.rs` file resolves to language `rust` (so the VS Code Rust
grammar extension actually loaded), Dark Modern paints `rgb(31,31,31)`, the
minimap and indent guides render, zero console errors.

That check is committed, because **three separate defects all exited 0**:

1. An application entry has its exports tree-shaken away — the bundle built
   clean and then threw `openFile is not a function` in the browser.
2. `build.lib` fixes the exports but silently turns **off code splitting**: one
   45.7 MB chunk that the browser cannot parse inside a 30 s navigate budget.
   `rollupOptions.preserveEntrySignatures: 'strict'` keeps both.
3. The real `ITextModelService` lives in
   `@codingame/monaco-vscode-model-service-override`, **not** in the files
   override. Without it Monaco silently falls back to the standalone service,
   whose `createModelReference` rejects every uri with `Model not found`.

None of the three is visible from a build exit code. Phase 1 keeps this check
running.

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
- `MonacoEnvironment.getWorker` is asked for **several labels**, not just the
  editor's. Returning the editor worker for every label gives
  `Missing method $init on worker thread channel default`. The entry routes
  `TextEditorWorker` / `TextMateWorker` and records unrequested labels in
  `self.__arxaWorkerLabels` — **the green run requested none**, so the routing
  itself is written but not yet exercised. Phase 1 must open a file that forces
  an editor-worker round trip (a diff, or a find-all-references).

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

#### 1a. Delivery plumbing — **DONE** (`8949286` + `38561a6`)

The bundle had to exist on other machines before any client change, and the
survey found a bug that had **already shipped**.

**`bin/arxa-engine-sync.mjs` put 1.3 GB into a live engine payload.** `hashDir`
skips `node_modules`; the `cpSync` on the very next line did not. So what landed
in `~/.arxa/engine/<sha>/arxa-studio` was not what the hash certified, and
because the hash never walked those bytes, nothing could report the difference.
monaco-build is simply the first plugin dir to carry a nested `node_modules`;
any plugin with one trips it. One `SKIP` list now drives both the walk and the
copy. `selftest.engine-sync.mjs` asserts the landed tree hashes equal to the
source and carries no `node_modules` — verified red with the filter removed.
Fixed **as its own commit**: it is independently true and would be invisible to
anyone bisecting for it inside a Monaco change.

The rest, then:

- **`pack-sidecar.mjs` refuses to pack** when `monaco-build/dist/arxa-monaco.js`
  is missing, naming the build command. It does **not** run `npm ci` itself —
  that installs 383 packages / 1.3 GB and needs network, which packing must not
  require. It also `--exclude`s `*/lib/monaco-build/node_modules` from the
  payload tar: `plugins/` is tarred whole, so without it the payload took that
  entire tree. Measured: 0 `node_modules` entries, 206 `dist/` entries, 36 MB.
- **The vendor route takes `vendorDirs`**, an ordered list — `lib/vendor/` plus
  `monaco-build/dist`. Not merged into one dir: `dist/` is a gitignored build
  product of a separate npm root and merging would drop 200 untracked files into
  a tracked directory. The traversal guard runs **per dir**; a joined-list check
  would let a name escape one root while satisfying another.
- **`EXT_TYPES` grew every row the real output emits.** `.wasm` was the blocker
  it looks like: `WebAssembly.instantiateStreaming` rejects any content-type but
  `application/wasm`, so the oniguruma TextMate engine — and every grammar with
  it — dies without that row. Hashed chunks now answer `immutable`; stable names
  stay `no-store`.
- Verified against the **real** build, not a fixture: all **205 files in `dist/`
  reachable**, `.wasm`/`.css`/`.ttf`/`.json`/`.html` each correctly typed.
- `check.mjs` now serves its harness page from memory and writes its screenshot
  to a temp dir. It used to write `spike.html`/`spike.png` into `dist/`, which
  is the shipped bundle — check artefacts would have become shipped files.

**Divergence from the sketch above:** `dist/` stays where Vite writes it rather
than moving to a `lib/monaco/` sibling. Vite disables `emptyOutDir` when `outDir`
is outside the project root, so a moved output would accumulate stale chunks
across builds. Pointing the route at `monaco-build/dist` needs no file move, no
vite change and no `check.mjs` change, and the tar exclude was required either
way.

#### 1b. The editable lane is Monaco — **DONE**

`CodeView` — the surface behind `code`, `text` and markdown source — is now real
VS Code. `DiffView` stays on CodeMirror this commit: Monaco's `DiffEditor` is a
different UX (side-by-side vs the current inline merge) and deserves its own
visual pass, and the CodeMirror bundle is loaded anyway for the markdown
preview's fence parsers.

**The seam.** `docRef.current` had seven consumers reading
`.state.doc.toString()`. It now holds the bundle's own handle —
`getText` / `replaceRange` / `dispose` — deliberately NOT a monaco object, so
phases 4-6 do not become a rewrite of all seven. One `docText()` accessor
serves the read sites; two of them run during **render** (markdown preview, diff
surface), so it answers with the loaded bytes before the bundle has landed
rather than throwing.

**Three things were wrong and only the browser said so:**

1. **A provider per open file does not work.** `registerFileSystemOverlay(1, fsp)`
   STACKS, so the second open of a path left the first overlay in place and
   `createModelReference` returned the first model with its stale text.
2. **Disposing the overlay to compensate is worse.** The text-file service still
   holds the uri and reloads it, so closing a file produced `Unable to resolve
   nonexistent file` and the next open threw. Fixed by ONE provider and ONE
   overlay for the page, files added to it, models cached.
3. **`registerFile` throws on a uri it already holds** rather than replacing, so
   fresh bytes on a reopen arrive through the model (`setValue`), not by
   re-registering.

**The worker label map was wrong.** Phase 0 recorded it as "written but not
exercised", and it was also *incorrect*: monaco asks for `editorWorkerService`
and `TextMateWorker`. The map keyed the editor worker as `TextEditorWorker` —
a label nothing ever requests — so that entry was dead and only the `??`
fallback kept it working. Both real labels are now keyed and **asserted by
name**, because `workerAsked === true` alone cannot tell the map from its
fallback.

**The check is now 16 assertions in the browser**, not one: open rust → switch
to dart (a second extension's grammar) → reopen rust with CHANGED bytes (the
stale-model regression) → `replaceRange` + `onChange` (format and dirty state)
→ a diff that forces the editor worker → the live dark/light flip. A
single-file green never covered any of this.

`arxa-engine-sync` now warns when `dist/` is missing (pack-sidecar refuses; a
dev sync only warns, since the rest of the payload is still worth advancing).

**Still open in the lane:** verified on screen by the user is the remaining
step. `files.autoSave`, the PDF extension and prettier→VS Code formatting stay
where the plan already puts them (phases 4-5).

#### Carried from 1a — now resolved

Both things 1a handed forward were done above: the engine-sync `dist/` warning,
and the worker routing, which turned out to be wrong rather than merely
untested. Original notes:

- **`arxa-engine-sync` has no equivalent of pack-sidecar's refusal.** If `dist/`
  is absent (fresh checkout, never built) the sync copies the plugin as normal
  and the monaco chunks 404 at runtime with nothing saying why. Packed builds are
  guarded; synced dev builds are not. It only bites once `client.js` actually
  `import()`s `arxa-monaco.js`, which is 1b — so the warning lands with the lane.
- **The worker-label routing is still written on faith.** The phase-0 green run
  requested no workers at all, so `MonacoEnvironment.getWorker`'s label map has
  never executed. 1b's screen check must force an editor-worker round trip — a
  diff, or find-all-references — or this stays untested behind a green.

Then: replace the CodeMirror `code` and `text` lanes. Services: base, host, files,
configuration, theme, textmate, languages, keybindings, quickaccess. Themes come
from `theme-defaults` (real VS Code theme JSON, retiring the hand-compiled
HighlightStyle table in `vendor.js`). `editor.fontFamily` keeps Fira Code.
Grammars: dart, rust, typescript-basics, javascript, json, html, css.

Diff lane moves to Monaco's `DiffEditor` (retires `@codemirror/merge`).

### Phase 2 — LSP bridge (G8, G11)

#### 2a. The host bridge — **DONE**

`lib/lsp.js` + `selftest.lsp.mjs` (26 assertions). Everything below is proven
against a REAL `rust-analyzer`, which answers `initialize` through the socket.

**Why the browser check cannot reach this.** monaco-build's `check.mjs` serves
`dist/` from a throwaway static server — no host, no `ctx.webServer`, no
`registerUpgrade`, no spawner. The bridge is the first thing in this branch the
lens cannot test at all, so it gets a host selftest instead. Said plainly rather
than left as an implied gap.

**Auth was the constraint that shaped the route.** A browser `WebSocket` cannot
set headers, so `x-arxa-write-token` — the pattern every other viewer route uses
— does not transfer. The token rides `Sec-WebSocket-Protocol` instead: the
client offers `['arxa-lsp', <token>]` and the server accepts only the marker
back, so the token is never echoed and never lands in a URL that gets logged.
This works because the token is `base64url + '.'`, every character of which is a
legal protocol token — asserted, because a single illegal character would make
browsers fail the handshake silently.

A **separate `lsp` scope**, bound to the open org exactly like `tree-read`. Not
reusing `read`: this token opens a socket that spawns a process, so a leaked
per-file read token must not be able to do it. Proven refused: no org, no token,
a forged token, a token for a different org, a `read` token presented as an
`lsp` one, and an unserved language.

**Framing is byte-counted, not character-counted.** LSP's `Content-Length` is in
bytes; any non-ascii in a message (an accented path, a diagnostic quoting the
user's source) makes byte and character length disagree, and a character-counting
reader desynchronises the stream permanently. Asserted with a multi-byte body,
with frames delivered one byte at a time.

**Lifecycle.** One server per (org, language), spawned lazily, killed on org
switch through the same `onServing` signal the watcher already uses — verified
that signal is reachable rather than assumed. The child deliberately OUTLIVES
its last socket so reopening a file does not pay for a cold rust-analyzer index
again; the org switch is what ends it. A missing binary fails asynchronously
(ENOENT on the error event, not a throw) and is not cached as running.

`ws` is now a direct dependency — it was transitive, which meant an unrelated
bump could remove it. Confirmed present in the payload tar (21 entries), not
assumed.

**Rows only for servers that have been RUN**: rust and dart. The plan also names
`typescript-language-server` and `vscode-langservers-extracted`, neither
installed on this machine — a routing row nobody has ever exercised is a
liability, not a head start, so they arrive with the install flow in 2c.

#### 2b. File identity + the editor connected — **DONE**

**The model is keyed on the file's REAL path.** A model at `/<relPath>` names a
path no language server has ever heard of, so every diagnostic, hover and
definition would be attributed to a file that does not exist. The host already
resolved the real path for its own path checks in both lanes — the org lane
computed `abs` to validate it, and the worktree lane called
`resolveWorktreeFile` and threw the answer away. Both now hand it back with the
token, so the client never joins path fragments itself.

**The server is rooted at the PROJECT, not the org.** This is the difference
between the language service working and silently doing nothing: an arxa org
holds notes, meetings and projects, so it has no `Cargo.toml` at its root and a
server started there reports nothing at all, with no error to explain the
silence. `projectRootFor` walks up from the file to the nearest manifest,
**bounded by the org root** — a manifest above the open org must never become a
server root. Session worktrees live at `<repo>/.arxa/worktrees/<id>`, inside the
org, so the same walk finds the project copy inside the worktree, which is the
right root for a file being edited there.

The client names a **relative** path and (for a worktree file) a session; the
host says where that is. Nothing the client sends is used as a filesystem path.

**Failure is silent by design.** No server for the language, no manifest above
the file, no installed binary — each closes the socket and the editor carries on
exactly as before. A language service must never turn opening a file into an
error.

**36 assertions**, ending with a real `rust-analyzer` in a real temp cargo
project, asserted to be rooted at `projects/demo` rather than the org above it.

Two of the edits that built this **silently did nothing** and were caught only
because the live test went red: the file used a NUL key separator where the
patch expected a space, so `createLspBridge`'s new parameters and `ensureServer`'s
rename were both no-ops. Every patch here now asserts it matched.

#### 2b-bis. Finding the binary at all — DONE

Measured before handing the user a test to run: **the engine cannot see either
language server.** `ps eww -p <engine pid>` reports its entire PATH as
`/usr/bin:/bin:/usr/sbin:/sbin` — launchd's default, because the desktop
launches the engine and a GUI process inherits no shell environment. On this
machine `dart` lives under fvm (`~/fvm/default/bin`) and `rust-analyzer` under a
CARGO_HOME on a different volume (`/Volumes/developer_ssd/dev/.cargo/bin`), so a
hardcoded list of well-known directories would have found NEITHER.

Left alone, 2b does everything right and then spawns a binary that is not there:
ENOENT on the async error event, socket closed 4004, no diagnostics, and nothing
anywhere saying why — indistinguishable from a broken bridge.

`resolveBin(cmd, { env, exists, extraPath })` searches, in order: an absolute
override taken as given, the engine's own PATH, then the login shell's PATH.
`readShellPath()` runs `$SHELL -lic 'printf "@ARXA_PATH@%s@END@" "$PATH"'` —
**interactive** because PATH is set in `.zshrc` as often as in `.zprofile`, and
**marker-fenced** because an interactive shell also prints banners, greetings
and a prompt. Plain-ASCII markers, not `\x01`: POSIX printf is not required to
understand hex escapes. It is probed at most once per bridge and off the first
upgrade, not at startup, so a slow shell cannot delay the engine booting; a
shell that hangs, fails or throws yields `''`, never an exception.
`ARXA_LSP_RUST` / `ARXA_LSP_DART` override everything — the knob for a toolchain
no shell exports either.

Proven end to end under the engine's exact environment
(`env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin SHELL=/bin/zsh`):

```
dart          -> engine PATH: null | + shell PATH: /Users/unfazed-mac/fvm/default/bin/dart
rust-analyzer -> engine PATH: null | + shell PATH: /Volumes/developer_ssd/dev/.cargo/bin/rust-analyzer
```

The same bug lives one layer down: the **child** inherits the engine's stripped
PATH unless told otherwise, and `rust-analyzer` shells out to `cargo` (metadata,
check) for every diagnostic. Measured: `cargo` is missing under
`/usr/bin:/bin:/usr/sbin:/sbin`. Left alone the server starts, answers
`initialize`, holds a healthy socket and reports nothing forever — a worse
failure than the one above, and the live test cannot catch it because the test
process has the full shell PATH. The child is now spawned with
`PATH = engine PATH + toolchain PATH`; with nothing to add, the env is passed
straight through rather than rebuilt.

`SHELL` was confirmed present in the live engine environment (`/bin/zsh`), so
the probe is reachable there; `readShellPath` still answers `''` rather than
throwing if it ever is not.

**42 assertions** now: the missing-binary case split in two (not on the PATH →
never reaches spawn; resolved but broken → still fails asynchronously and is not
cached), marker fencing against a shell that prints noise, the real login shell
on this machine, and the child's own PATH.

#### 2c. The rest of the languages + install door — DONE

Rows added: **typescript** (`.ts .tsx .mts .cts .js .jsx .mjs .cjs`), **html**,
**css** (`.css .scss .less`), **json** (`.json .jsonc`). All four are npm
packages, so `npm` on the row is both the install instruction and the marker
that an Install door may offer them; dart and rust carry no `npm` and are
locate-only, which is the plan's own carve-out.

**Install** = `npm install --prefix <arxa home>/lsp` — npm is already on the
machine and does its own integrity checking, so there is no download, extract or
hash-pinning code here to get wrong. Its own prefix, never a global install: it
must not change what the user's `npm -g` holds, and it has to be removable by
deleting one directory. `resolveBin` searches that directory FIRST, so what the
Install door just put there is never shadowed by a stale global. Nothing installs
on its own — the route runs only because a person pressed the button, and it
refuses any language without an npm row.

Four things measured rather than assumed, each of which would have shipped a
dead row:

1. **The npm servers are `#!/usr/bin/env node` scripts.** Under the engine's own
   PATH that shebang dies with `env: node: No such file or directory` — an
   instant exit that looks like a healthy spawn, not a missing binary. `childPath`
   now ends with `dirname(process.execPath)`, so arxa's own node is the last
   resort and a machine with no node installed at all still runs them.
2. **`typescript@7` is the native rewrite.** Its `lib/` holds `tsc.js` and
   `getExePath.js` and no `tsserver.js` at all, and `typescript-language-server`
   drives tsserver. Unpinned, npm installs 7 and every `.ts` file silently gets
   nothing. The row pins `typescript@^5`.
3. **There is no `--tsserver-path` flag.** Read out of the installed `cli.mjs`,
   the whole CLI is `--stdio` and `--log-level`; the knob is
   `initializationOptions.tsserver.fallbackPath`, and `findTypescriptVersion()`
   tries the user path, then the WORKSPACE, then the fallback — so a project with
   its own TypeScript still uses it and arxa's copy only fills the gap. The host
   computes it (only it knows where arxa installed one) and the editor sends it.
4. **One server owns several monaco language ids.** A `.js` file is language
   `javascript`, not `typescript`; the css server owns scss and less, the json
   server owns jsonc. A selector of just the row name would have connected a
   client that then ignored every `.js`, `.scss` and `.jsonc` document it was
   started for.

5. **`.scss` and `.less` opened as `plaintext`.** Caught only by asking the
   RUNNING editor for `getLanguageId()` of every extension the rows claim, and
   reading the answers off the capture — `scss` and `less` are separate default
   extensions from `css`, and the build had only `css`. Two dead rows: the css
   server would have started and then been sent nothing, because a
   documentSelector matches on the language id. `check.mjs` now asserts all
   fourteen ids, so a future row that claims an extension the build cannot
   colour goes red instead of silent.

**`projectRootFor` gained a fallback.** html, css and json normally have no
manifest above them, and a loose `.ts` analyses fine on its own — denying those
would have made "no diagnostics" the normal case for three of the five languages.
With `rootFallback`, a file with no manifest roots at its own directory; the org
bound still applies first, so the fallback can never point outside the open org.

**The editor ASKS instead of reading the close code.** `/lsp/status` reports
availability per language. The host accepts the upgrade FIRST and only then
closes 4004 when there is no binary, so "did the socket open" and "is there a
server" are different questions and the close arrives too late to decide whether
to offer an Install. Status carries `installable` too, so dart and rust get a
sentence ("install its SDK") rather than a download button.

`lsp-install` is its own token class: a leaked `lsp` token starts a server the
user already has, and must not be able to put new software on the machine. One
npm per language at a time, so a double-click cannot run two into one prefix.

**51 assertions**, including a LIVE `typescript-language-server` answering
`initialize` through the bridge on a loose `.ts` with no manifest, asserted to be
rooted at the file's own folder. That block is gated on the binary resolving, so
CI never downloads from npm — it becomes a real check the moment the Install door
has run once.

#### Still open after 2c

`MonacoLanguageClient` 10.7.0 takes `{ id, name, clientOptions, messageTransports }`
— confirmed from the installed types, not from memory.

**Unverified on screen:** the Install strip and the four new languages are proven
host-side (51 assertions, one of them a live server) and by static pins on the
client. Whether the strip renders where it should, and whether underlines appear
for a `.ts`/`.html`/`.css`/`.json` file, needs a restart and a look.

`eslint` is deliberately not a row: `vscode-langservers-extracted` ships
`vscode-eslint-language-server`, but it needs an eslint config resolved out of
the project, which is a different problem from the four here.

Original plan below.


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

### Phase 3 — markdown grammar — DONE (`f1b227f`)

Probing the running editor for `getLanguageId()` of a `.md` file returned
**`plaintext`** — the build carried `markdown-language-features` (the feature
layer) but not `markdown-basics`, which is what declares the language and its
grammar. Adding it fixes colouring and shows more than markdown-it ever did:
headings, emphasis and links coloured, and a fenced ```` ```rs ```` block
highlighted as Rust through VS Code's embedded-language injection.

#### Two claims in the first draft of this section were WRONG

1. *"there is no `webview-service-override` at 36.2.7, so webviews mean the
   whole VS Code workbench layout — adopting that is a rewrite of the docked
   pane."* The E404 is real; the conclusion is not. `views-service-override`
   exports `attachPart(part, container)`, which takes **one** part. Attaching
   `Parts.EDITOR_PART` alone renders no activity bar, sidebar, panel or status
   bar. The pane keeps its shape.
2. *"`markdown-language-features` needs extension-host worker plumbing this
   build does not have."* It needed a **config fix**, not plumbing — see below.

### Phase 7 — full VS Code adoption (user directive, 2026-09-06)

> "adopt all of vscode remove the previous stuff - have monaco manage all"

#### 7.0 The extension host was silently OFF — **DONE, measured**

`getExtensionsServiceOverride({ url, options })` is what phases 1-2 called. At
36.2.7 that override destructures
`{ enableWorkerExtensionHost, iframeAlternateDomain }`, so both arguments
landed as `undefined`, `enableWorkerExtensionHost` was falsy, and
`extHostWorkerUrl` was dead code that nothing ever read. **No extension host
ran.** Grammars and themes still worked because they are declarative — the
textmate service reads them straight out of the extension's files — so the
build looked healthy and every extension with actual code was inert.

That, not webviews, is what killed `markdown-language-features`.

Fixed by three coupled changes:

- `getExtensionsServiceOverride({ enableWorkerExtensionHost: true })`.
- `MonacoEnvironment.getWorker` → `getWorkerUrl` / `getWorkerOptions`. The
  extension host runs in an **iframe** and constructs its own worker there: it
  needs a URL that crosses the frame boundary, and a `Worker` object from this
  realm cannot. `getWorker` can never serve `extensionHostWorkerMain`.
- All three workers imported as `?worker&url`, not `?worker`.

Verified on screen: the extension-host iframe exists, `markdown-language-features`
activates with no console error, and `[link](x.md)` renders **underlined** in the
capture — an underline is the extension's document-link provider, which the
grammar alone cannot draw.

`iframeAlternateDomain` is deliberately **not** set. The studio is served from a
loopback origin and `{{uuid}}.127.0.0.1` is not a resolvable hostname, so there
is no alternate domain to move the host to. **The extension host iframe is
same-origin with the studio, and extension code now actually runs.** That was a
carried unknown; it is now a stated trust boundary.

#### 7.0-bis The dependency tree carried two major versions — **DONE**

`monaco-languageclient@10.7.0` pins `^25.1.2` for **thirty** `@codingame/*`
packages. The committed lockfile therefore held 710 entries at `25.1.2` and 26
nested duplicate trees, including a second `extensions-service-override` and a
second `views-service-override`. Harmless while nothing imported them; fatal the
moment `views` is adopted, because two workbench layout services would be live.

`overrides` widened from 2 entries to 32, forcing every `@codingame/*` to
`36.2.7`. Install drops **376 packages → 124**, zero duplicates, zero `25.1.2`.
No stable `monaco-languageclient` targets 36.x (11.0.0-next targets `^35`), so
the override is the only route.

#### 7.1 The editor part — **DONE in the bundle, measured**

`views-service-override` + `attachPart(Parts.EDITOR_PART, container)`, plus the
thirteen services the part reaches for while it renders (base, host, environment,
lifecycle, log, storage, notifications, dialogs, working-copy, bulk-edit, markers,
preferences, outline). Derived by booting and reading what was missing, not
copied from the demo — the demo also turns on terminal, debug, scm, chat and
notebooks, none of which a docked artifact pane uses.

Verified in the check harness, and visible in the capture: **two tabs
(`notes.md`, `Preview notes.md`) and VS Code's own markdown preview rendering
inside a webview** — h1, italics, a live link, and a fenced rust block
highlighted.

Three things had to be measured, none of which were guessable:

1. **`attachPart` brings no chrome.** `partChrome` — the parts that actually
   paint a box — is `[]`. The claim that adopting `views` costs the whole
   workbench layout was wrong.
2. **A standalone editor wins over the part, forever.** `wrapOpenEditor` in the
   api's `service-override/tools/editor.js` looks for an existing
   `StandaloneEditor` whose model uri equals the resource, and if it finds one
   it focuses THAT and never touches the editor part. First run: the file landed
   in standalone group `-4` while the part's group `0` painted `content empty`,
   with no error anywhere. **The two lanes cannot share a uri**, which is
   precisely why `openFile`'s `monaco.editor.create` has to go.
3. **`IEditorGroupsService` spans every part.** `openEditor` with no group picks
   the service's active group, not the attached part's. Files now open into
   `groups.mainPart.activeGroup` explicitly.

And one behaviour that will outlive the spike: **VS Code signals cancellation by
rejecting**, and the markdown preview leaves exactly one such rejection unhandled
on every open. It reaches the page as `unhandledrejection`, which
`setUnexpectedErrorHandler` never sees, and the lens fails any console error. A
listener now calls `preventDefault()` for `Canceled`/`CodeExpectedError` and
nothing else, so every real rejection still fails the build.

#### 7.1-ter The code lane moved onto the part — **DONE**

`openFile()` no longer calls `monaco.editor.create`. It attaches the part, syncs
the file into the overlay filesystem, and opens through `IEditorService`; the
handle `client.js` drives (`editor`, `model`, `getText`, `replaceRange`, `focus`,
`dispose`, `onChange`) is unchanged, so no call site moved. Every phase-1
assertion — line count, grammar, reopen with fresh bytes, the editor worker, the
theme flip, containment, and all four narrow-pane breakpoints — is still green,
now running through VS Code's `textFileEditor`.

Four things changed shape underneath:

- **The narrow-pane table speaks settings.json.** The part owns editor
  construction, so `minimap`/`wordWrap`/`folding`/`glyphMargin`/`lineNumbers`/
  `scrollbar.horizontal` became `editor.*` settings written on container resize.
  `lineDecorationsWidth` had no setting and was dropped — it was 10px of
  padding, and nothing asserted it.
- **One config object.** `updateUserConfiguration` REPLACES the whole document,
  so theme, font and shape all patch a single `userConfig` and re-write it. The
  first version lost the colour theme on every resize.
- **`dispose()` no longer disposes the editor.** The part owns it, and the part
  is what holds the tab — tearing it down on a React unmount would close the file
  the user is reading. `closeAll()` is the explicit clear.
- **`Shift-Alt-F` is not rebound.** `addCommand` exists only on a standalone
  editor. The chord now comes from the keybindings service as
  `editor.action.formatDocument`, i.e. through the language server;
  `formatActionRef` in `client.js` went with it.

Tabs stay, at the user's call: the markdown preview and every media preview
arrive AS tabs, so hiding them would remove the only way back to the source. With
`workbench.editor.enablePreview` on, sidebar selection reuses one preview tab and
only an edited or pinned file keeps its own — the spike opens four files and ends
with two tabs.

**The near-miss worth recording:** the splice that moved `openFile` onto the part
deleted `connectLanguageServer` — the entire phase-2 LSP lane — and the build
stayed green, because nothing in the bundle imports it; only `client.js` does, at
runtime. `selftest.mjs` caught it on a `documentSelector` pin. Source pins are
what stand between a silent deletion and a shipped one.

#### 7.1-bis Custom editors, and the file cycle — **DONE, measured**

`media-preview`'s image viewer opens a png built in the page:
`RegisteredMemoryFile` takes `string | Uint8Array`, so a binary artifact reaches
a webview-backed custom editor. `paneId` is `WebviewEditor`, and the capture
shows the image centred with `spike > pic.png` breadcrumbs. **That is the same
door the PDF question sits behind** — a `.vsix` custom editor would open the
same way.

The file cycle the viewer actually drives — close everything, reopen, then
change the bytes underneath an open editor — works: `closeAll()` leaves zero
tabs, reopening shows the file, and **an external change reaches the open editor
with no reload call at all**, because the fs provider fires the change and VS
Code re-reads. The D86 external-change lane becomes a `writeFile` on the
provider.

Two harness fixes came out of it, both worth keeping:

- `--expect` collapses to ONE boolean, so a 60-term conjunction that comes back
  false names nothing. The assertions moved into `src/spike.html`, which
  evaluates them one at a time into `out.fail`; `check.mjs` asserts only
  `out.fail.length === 0`, and `--dump` paints the failing list. It found its own
  first bug immediately.
- That bug: **monaco renders every space in `.view-lines` as U+00A0**, so
  `innerText.startsWith('# Title')` is false for text that reads `# Title`. Two
  assertions were red about correct behaviour.

#### 7.2 Deletions, each only after its replacement is green on screen

| vendored bundle | size | replaced by | site in `lib/client.js` |
|---|---|---|---|
| ~~`markdown.js`~~ | ~~146 KB~~ | **DONE** — VS Code's preview webview | deleted |
| ~~`codemirror.js`~~ | ~~886 KB~~ | **DONE** — VS Code's diff editor | deleted |
| `prettier.js` | 2.1 MB | LSP formatting (`textDocument/formatting`) | `:1652` |
| `pdf.js` + worker | 1.7 MB | **nothing — stays** | `:878` |

#### 7.2-b codemirror.js is gone — **DONE**

Its last two readers were `DiffView` and the 2026 palette. The diff is now VS
Code's own diff editor, opened as an editor input like everything else, with the
original side on its own `<path>.arxa-main` uri (a second model on the file's own
uri would collide with the one the editor holds) and a `label` so the tab does
not leak that scratch name. Inline below 800px, side-by-side above — the same
reasoning as the minimap in `layoutFor`.

What it replaced it with is bigger than a swap: the capture shows word-level
insert/delete highlighting, the next/previous-change toolbar, whitespace and
swap-sides controls, and the change overview in the right gutter.
`unifiedMergeView` had none of that.

The 2026 palette went with it. It existed because CM6 has no TextMate engine, so
`lib/vendor.js` compiled `tokenColors` from the vendored VS Code theme JSONs into
static CM6 `HighlightStyle` specs. VS Code's own build has the engine and paints
its own themes, so the whole port — `stripJSONC`, the scope→tag map,
`readTheme`, `buildThemesEntry`, `CM_LINES`, `CM_ENTRY`, the two theme JSONs and
21 `@codemirror/*` dependencies — is deleted. `watchPalette` stays: it is what
tells VS Code which theme to use.

#### 7.2-a markdown.js is gone — **DONE**

The rendered preview is VS Code's own webview. The source/preview toggle stopped
being a swap of React subtrees and became a **prop on the one `CodeView`**:
both are editor inputs on the same file inside the part, so switching is
`markdown.showPreview` / `openEditor` on the same uri.

Deleted with it: `previewHtml`, `mdReady`, the two `ArxaMD` effects, the
`setParsers`/`setTheme` wiring in the palette effect, `MD_ENTRY` and the
`markdown-it` + `dompurify` dependencies of `lib/vendor-build`. The `parsers:`
export inside `codemirror.js` existed only to feed that highlighter and now has
no reader; it goes when that bundle does.

What replaced it is better, not equal: VS Code's own preview stylesheet, math,
task-list checkboxes, and fenced code highlighted by the same TextMate grammars
the editor uses.

#### 7.3 What "remove the previous stuff" cannot cover

- **PDF.** VS Code ships no built-in PDF viewer. `tomoki1207.pdf` is a
  marketplace `.vsix` with no npm mirror; it would need vendoring with a sha256
  pin. `pdf.js` **stays** — deleting it would silently remove a working feature.
- **Formatting.** The concrete diff, `FORMAT_EXTS` in `client.js` against the
  server table in `lsp.js`:

  | | extensions |
  |---|---|
  | formatted today, and a server covers it | `js` `mjs` `cjs` `jsx` `ts` `tsx` `json` `jsonc` `css` `scss` |
  | formatted today, **no server — would be lost** | `md` `yaml` `yml` |
  | not formatted today, a server would add it | `rs` `dart` `html` `htm` `less` |

  So retiring the 2.1 MB `prettier.js` loses formatting for **markdown, yaml and
  yml**, and gains it for **rust, dart, html and less**. Net three lost, five
  gained. The user rules on whether markdown/yaml formatting is worth keeping a
  2.1 MB bundle for.
- **Bundle size.** dist was 15 MB before 7.0, 29 MB after it, and **33 MB**
  after 7.1. It ships in the engine payload. Against that, `lib/vendor/` lost
  **1.03 MB of committed bundles** (`markdown.js` 146 KB + `codemirror.js`
  886 KB) and `lib/vendor-build` lost 23 dependencies.
- **The media lanes stay as they are.** `image`, `audio` and `video` render with
  `<img>` / `<audio>` / `<video>` against the org origin. `media-preview` is
  proven to work (7.1-bis) and would add zoom and a transparency checkerboard for
  images — but every one of those files would first have to be copied into the
  in-memory overlay filesystem. For a video that is a straight regression, and
  for an image it buys a widget. Streaming from the origin is the right call;
  this is a deliberate stop, not an oversight.

#### 7.4 Dirty state and autosave (was phase 5)

Folds in here: `working-copy-service-override` is what the editor part already
needs, and it is also what owns dirty state. A write-through VS Code filesystem
provider over `/__arxa/artifacts/write` replaces the hand-rolled save path.

---

#### 7.5 The LSP lane, proven in a browser

The language client attaches by `documentSelector` on language id, and documents
are now created by VS Code's `textFileEditor` instead of `monaco.editor.create`.
Nothing proved a client still syncs one in that lane — and `connectLanguageServer`
had already been deleted once by an editing slip, caught only by a source pin on
a string.

`check.mjs` now runs a **stub language server** on the same origin: it answers
`initialize`, waits for the `didOpen` the client should send for the open file,
and publishes one diagnostic back. The spike asserts the diagnostic became a
**marker on the model**, with the stub's own `source`. Client started, document
synced, diagnostic applied — the whole path, in a browser.

Verified it can fail: changing the stub's diagnostic `source` turns the check RED.

#### 7.6 One conflict prompt, not two

The viewer has its own conflict banner. VS Code's text-file service has its own
opinions about a file changing on disk under unsaved edits, and two prompts for
one event would be a regression. Measured rather than assumed: with edits in the
model and new bytes written to the provider, **no VS Code dialog appears and the
user's edits are kept**. The viewer's banner stays the only prompt. Pinned in the
spike (`dialogs === 0`, `afterConflict` still starts with the edit).

### Where phase 7 stands

| | |
|---|---|
| **Adopted** | editor part, webviews, custom editors, markdown preview, diff editor, tabs, settings-driven layout, extension host |
| **Deleted** | `markdown.js`, `codemirror.js`, the 2026 theme port, 23 vendor-build deps, `DiffView`, the palette state and vars |
| **Kept, with a reason** | `pdf.js` (VS Code ships no PDF viewer), `prettier.js` (markdown/yaml have no server), `icons.js` + Fira Code (the studio's own chrome), the `<img>`/`<audio>`/`<video>` lanes (streaming beats an in-memory copy) |
| **Open for the user** | whether markdown/yaml formatting is worth keeping a 2.1 MB bundle for — see the table in 7.3 |

## Carried unknowns — CLOSED by the closeout trust-boundary work (2026-09-13)

The four unknowns this section carried are now measured facts; the threat
model below is the record. Live probes: `src/spike.html` (the `threat` step),
asserted by `check.mjs` on every build, Chrome AND WebKit.

### Threat model (Task 7)

Every row records MEASURED behavior, the thing that holds it, and the residual
if any. The invariant: **extension/webview execution receives no ambient studio
cookies, credentials, host bridges or mutation token; file access stays
explicit, scoped, short-lived and root-bound.**

| Capability | Current behavior (measured) | Held by | Residual |
|---|---|---|---|
| **Extension-host iframe origin** | `webWorkerExtensionHostIframe-*.html` served by OUR vendor route ⇒ **same-origin with the studio** (`extHostOrigin === location.origin`, spike `threat` step). `iframeAlternateDomain` unset — no resolvable loopback wildcard exists. | Recorded by spike assertion; frozen by the pinned-extension allowlist (selftest.mjs Task 7 block: entry.mjs imports exactly the 14 vendored built-ins, each exact-pinned `36.2.7` in the build manifest; no vsix plugin wired; no runtime `registerExtension`). | Extension CODE shares the studio origin. Accepted, because nothing third-party can register: marketplace/VSIX loading stays off until a separately served origin is designed and reviewed. |
| **Sandbox attributes** | Ext host iframe: `sandbox="allow-scripts allow-same-origin"` (VS Code's own bootstrap — `allow-same-origin` is required so the frame can spawn its same-origin worker). Webview content iframe: `allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-downloads`. | Spike asserts every executing frame carries `allow-scripts` — an UNSANDBOXED frame trips the gate. | `allow-same-origin` on both frames: same residual as the row above. |
| **CSP** | No CSP on the studio origin itself (0.2). Ext host frame ships VS Code's bootstrap CSP (`default-src 'none'; child-src 'self' data: blob:; script-src 'self' 'unsafe-eval' 'sha256-…'`). Webview frame ships `default-src 'none'` with `script-src` pinned to VS Code's own bootstrap hash. | Spike asserts every webview frame's CSP contains `default-src 'none'`. | The outer page (dsh shell) is not ours to lock; recorded, not closed. |
| **Cookies** | None set by any viewer surface (org origin, vendor route, all APIs — asserted `set-cookie` absent). `document.cookie` is `''` in the harness. Nothing ambient to inherit. | selftest.mjs pins on response headers; spike pins the empty jar. | Studio cookies (if the shell ever sets any) are same-origin readable by extension code — same residual as row 1. |
| **localStorage** | VS Code writes **zero** keys (`localStorageKeys: []` — the storage service override is in-memory). The viewer writes only `arxa.av.prettier` and the layout store's width key — preferences, never tokens or file bytes. | Spike asserts the empty key list. | Same-origin code could read/write the studio's localStorage — preferences only, no credentials exist there. |
| **Parent DOM access** | The ext host frame CAN walk into the parent document (`extHostReachesParentDoc: true`) — direct consequence of `allow-same-origin`. | Spike pins the measurement so the boundary moving in EITHER direction forces a re-derivation. | The whole trust question collapses into row 1: provenance of the code that runs there. |
| **Fetch reach** | Same-origin code can POST `/__arxa/artifacts/token` and mint read/write tokens (ambient same-origin authority — no CSRF-style check exists or is meaningful for a loopback single-user app). The org read lane, `wt`, `tree`, `main-version`, `write` all still demand THEIR token per request — the mint route is the one ambient door, usable only by code already trusted on the origin. | The allowlist freeze is the control (row 1). The **events** push route no longer trusts origin alone: since 2026-09-13 it requires a lane token (`changes-read` for `?session=`, `tree-read` for a root/org stream) and denies by default — an unauthenticated channel listing every file change under the org was a real ambient capability, now closed (selftest.mjs Task 11 block). The gate's first cut broke the SIDEBAR's own live tree/decoration stream (it had opened the same route with no token since D117) — the freestyle region now mints its own tree-read token and re-mints on error (selftest.freestyle.mjs pins, drift-gated). | `/__arxa/artifacts/roots` still lists root ids/names to same-origin callers — metadata only, accepted. |
| **Token exposure** | Write/mutation tokens live in client closures, never localStorage/URLs; LSP tokens ride `Sec-WebSocket-Protocol` and are never echoed (selftest.lsp.mjs); read/wt/tree tokens ride short URLs with TTL ≤ 120 s, HMAC-bound to org+relPath. The events token is connect-time only (connection-scoped authority, like the org read). | tokens.js class tests; lsp selftest (`ws.protocol === 'arxa-lsp'` only). | — |
| **Navigation** | The viewer never navigates the top window (`topIsSelf` true; artifacts render in lanes/iframes). Media/webview frames load vendor-route or org-origin URLs only. | Spike assertion. | — |
| **Extension code provenance** | Build-time static imports of `@codingame/monaco-vscode-*-default-extension` at exact `36.2.7`, registered in `monaco-build/src/entry.mjs`. No marketplace, no VSIX, no runtime registration, no network at pack time. | selftest.mjs Task 7 allowlist freeze (verified RED with a smuggled `tomoki1207-pdf` import — the test caught it only after the name matcher accepted digits; fixed and re-verified). | Adding an extension = a code change that fails the allowlist test on purpose. |

### Runtime verification records (Task 7)

- **`files.autoSave` (was: "verify; fallback is the debounce")** — measured:
  monaco-vscode-api defaults it to **`afterDelay`** and VS Code flushes the
  model into the **in-memory overlay** ~1.0–1.3 s after a keystroke (Chrome
  1009 ms / WebKit 1255 ms, spike `autoSaveProbe`). That is NOT a disk save:
  the overlay is memory, and the worktree write stays single-owner — the
  tested **1.5 s viewer debounce → POST /write → WIP commit** path
  (selftest.client-save-race.mjs; the new debounce-coalescing test proves one
  save per settled edit). Ruling 4 therefore holds with the probe on record:
  ownership unchanged. The bundle never writes `files.autoSave`
  (selftest pin), and the spike asserts the flush exists — if either changes,
  the ruling must be re-derived.
- **Dart discovery (was: "no download path exists")** — present case: dart
  resolves via the login-shell PATH (fvm) and the lane just gets a server;
  absent case (launchd PATH, no toolchain): `resolveBin` → null, the strip
  says *"No Dart language server — install its SDK (`dart`) to get one."*
  and there is no Install button (`installable:false`, no `npm` row —
  locate-only by design). selftest.lsp.mjs pins both cases; the client copy is
  pinned in selftest.mjs.
- **pdf.js / Prettier (ruling 3)** — both REMAIN, pinned: the pdf lane stays
  on the vendored bundle (no PDF extension experiment; neither name appears in
  the extension allowlist), prettier keeps `md/yaml/yml` — the lanes no
  language server covers — as a lazy vendor bundle behind the viewer-level
  toggle.
- **gen-ui Diff (implementation plan Task 9's open box)** — confirmed: the
  card still receives ONLY model-authored `before/after` strings (the `gen_ui`
  tool's `components` param; the host reads no file bytes). Marked **DEFERRED
  UNTIL REAL FILE DIFF INPUT** in `plugins/gen-ui/lib/client.js`, with a
  trigger test in selftest.mjs (any file-reading API in gen-ui's host breaks
  the pin) so the bounded Myers/LCS renderer lands WITH its coverage the
  moment real input does — not silently.
- **`tomoki1207.pdf` under the extension host** — moot for this closeout: the
  PDF extension is not in the allowlist (ruling 3), so it never runs.
- **Live evidence run (2026-09-13, scratch org, headless Chrome + CDP)** —
  squiggles on screen at 1280 for `.ts`/`.css`/`.json`
  (`designs/evidence/studio-closeout/1280/`), the css one proving the
  workspace/configuration middleware unsticks the css linter on a real open;
  `.html` shows its designed PREVIEW lane (org-origin sandboxed iframe —
  measured `host ≠ studio origin`); dart present/absent and the
  one-save-per-settled-edit autosave note captured the same day. Narrow rungs:
  the sheet does not mount on emulated resize and the wide-only sidebar is the
  only headless file entry — a narrow-mode artifact open has no reachable
  entry point for a driver (744 keeps the dart strip shot). Both recorded in
  the closeout ledger. The run also surfaced and closed a real runtime wedge:
  a language server kept alive past its last socket answered nothing ever
  again (every reopen past the first lost tsserver diagnostics permanently) —
  server lifetime is now last-socket-scoped (`lib/lsp.js`, LIVE reconnect
  block in selftest.lsp.mjs: the reconnect must answer initialize with a
  FRESH spawn, `spawned === 2`).
