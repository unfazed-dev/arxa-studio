# Artifact viewer → editor — resume brief (2026-08-30)

Companion to `docs/plans/arxa-studio-grill-decisions.md` (decision log) and the two
research files under `docs/research/`. Facts here are verified against the repo.

## 1. Where the artifact-viewer plan stands

- **D7 — Artifact multi-viewer, C with origin separation** (grill-decisions :39-55)
  is the only viewer decision, and it is **settled but UNBUILT and UNPLANNED**:
  no implementation doc covers it (file-organisation-implementation.md traces
  D36–D47 only), no plugin implements it.
  - Types: code, files, pdf, video, images, audio, text, md, mdx, html.
  - Architecture: Google-usercontent/Dropbox-preview pattern — one shared
    renderer; per-org file server rooted at the org folder, spawned on org
    mount, killed on org switch; separate origin per org; type split
    (code/text/md/images direct · html/mdx sandboxed iframe on the org origin ·
    pdf/video/audio/office convert-or-stream, never inline); short-lived
    per-file tokens. Options A (process per org) and B (path guards in code —
    Trail of Bits VS Code webview escapes) rejected.
  - **No edit capability is stated anywhere in D7.** The editor requirement is
    net-new and is what this resumed grill settles.
- **Open mechanics never grilled:** renderer tech, token issuance, per-org port
  allocation, office conversion pipeline, edit-vs-view capability.

## 2. What exists today (verified)

- `plugins/design-panel` — "H4, viewer-first": shell.overlay dock iframing
  `arxa design serve` at the 390/744/1280 rungs, SSE live-reload
  ("reload on the way IN"), and a **deliberately deferred patch overlay**
  awaiting an engine "design patch" verb (package.json:5, client.js:20,383).
- `plugins/gen-ui` — A2UI cards: Diff (line-by-line, "upgrade to LCS if real
  files land here"), Image-by-URL, RungLadder (sandboxed iframe of arbitrary
  URL), Choice (host RPC).
- `plugins/mcp-apps` — sandboxed srcdoc iframe host.
- **Zero viewing/editing dependencies** in package.json (no Monaco,
  CodeMirror, pdf.js, markdown, media libs). Everything viewer-ish is
  iframe-based; nothing renders file content in-process.

## 3. Constraints inherited from settled decisions

| Decision | Constraint on the viewer/editor |
|---|---|
| D18/D19 | Two-tier commits + two-level undo: per-surface Cmd+Z, checkpoint restore via WIP commits |
| D20 | Deliverable versions/variants are the semantic layer; heavy media via LFS/content-addressed storage |
| D30 | Tauri shell, **system webview** (WKWebView/WebView2/WebKitGTK differ — probe codecs, no Chromium-only APIs) |
| D38 | Every "interactive editing surface" is a session: own branch + worktree; main never edited directly |
| D44 | Version chip in project header → D20 timeline; never shows SHAs/stamps |
| D46 | File tree is SSOT; DB only a rebuildable index |
| D75 | "VS Code git-parity is the north star" (composer git card) |
| CLAUDE.md | Local-first: viewer/editor must work with zero DB; identical UX local-only |

## 4. Research (new, verified on disk)

- `docs/research/artifact-viewer-media-research.md` — per-type matrix, 🔥-graded:
  native raster/SVG/audio; HEIC/HEVC gaps in Chromium webviews; pdfjs-dist 6.3.289
  (Worker, hardened); Shiki 4.4.3 / highlight.js 11.12.0; markdown-it 15.0.1 +
  DOMPurify + KaTeX; @google/model-viewer 4.3.1 for 3D; defer notebooks;
  sandbox-iframes/DOMPurify/strict-CSP cross-cutting.
- `docs/research/editor-viewer-to-editor.md` — Monaco 0.54.0 (MIT, ~2-5 MB +
  workers, IntelliSense/diff built in) vs CodeMirror 6 (MIT, ~50-200 kB,
  modular, mobile-friendly; Sourcegraph migrated OFF Monaco). **Recommendation:
  CodeMirror 6 default**; Monaco only if TS IntelliSense + diff editor are hard
  requirements. **File System Access API is Chromium-only → saves via native
  host IPC**; tabs/file tree are shell-side; external-change watching is
  native-host → IPC; read-only toggle instant in both.

## 5. Grill agenda — SETTLED 2026-08-30 → D78–D87 (arxa-studio-grill-decisions.md)

1. **Editable scope v1** — which D7 types gain edit? *Rec: text family only
   (code/text/md/json/yaml + html/mdx as source); media view-only.*
2. **Editor engine** — *Rec: CodeMirror 6; revisit Monaco only for TS
   IntelliSense/diff-editor needs.*
3. **Where edits land** — *Rec: editor is a D38 session surface; edits in the
   session worktree, D18 WIP auto-commits, stage-boundary gate merges.*
4. **Write-path security** — *Rec: keep D7 origins; writes POST engine-side
   with short-lived per-file tokens (read vs write token classes).*
5. **Per-type edit UX** — md source/preview split; html/mdx source-only;
   *Rec: no binary/office editing ever (write-through mirrors stay read-only
   per D45).*
6. **Undo wiring** — *Rec: CM6 history = per-surface Cmd+Z (D19 level 1);
   WIP commits = checkpoints (level 2).*
7. **Diff site** — *Rec: the LCS upgrade of gen-ui's Diff card lands here.*
8. **Version chip** — *Rec: chip in editor header, click → D20 timeline.*
9. **External changes** — *Rec: design-panel doctrine — reload on the way in;
   native watch → IPC → dirty-buffer prompt.*
10. **v1 cut line + acceptance gate** — *Rec: lens-based visual gate + selftest,
    D68-style "not done until demonstrated live".*
