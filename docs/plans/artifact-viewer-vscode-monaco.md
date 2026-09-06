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
