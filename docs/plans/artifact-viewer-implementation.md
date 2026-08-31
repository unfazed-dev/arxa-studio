# Artifact Viewer-Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the D7 artifact multi-viewer with the D78–D87 editor extension: a per-org, origin-separated viewer for all artifact types whose text family edits like a minimal VS Code inside session worktrees.

**Architecture:** One new dsh plugin (`plugins/artifact-viewer/`), host half + client half, following the `design-panel`/`approvals` precedents. Host half owns: the per-org READ-ONLY file server (spawned on org open, killed on org switch, served under `org-<slug>.localhost` so rendered content never shares an origin — cookies are port-agnostic — with the studio), short-lived HMAC read/write tokens, the engine write API on the trusted studio origin, and an org watcher that pushes external-change events. Client half owns: type detection, the three D7 render lanes, the CodeMirror 6 editor with md source|preview split, diff via @codemirror/merge, version chip + session badge, and live color state.

**Tech Stack:** Vendored prebuilt bundles (ADR-0009 "categorized vendored libraries"): codemirror@6 + @codemirror/merge, markdown-it@15 + dompurify@3, pdfjs-dist@6 (worker + viewer). Host: node:http file server, node:crypto HMAC tokens, fs.watch, git plumbing via existing file-org-shell D18 machinery. No DB anywhere (CLAUDE.md boundary).

**Spec:** docs/plans/artifact-viewer-editor-brief.md · docs/plans/arxa-studio-grill-decisions.md (D7 :39-55, D78–D87 :819-872) · docs/research/artifact-viewer-media-research.md · docs/research/editor-viewer-to-editor.md

## Global Constraints

- Local-first: zero database dependency; identical UX with no backend (CLAUDE.md ownership boundary).
- Org origin is **GET-only forever** (D81); every read URL carries a token (D7); token TTL ≤ 120 s.
- All writes go through the studio-origin engine API with a separate write-token class; the engine re-validates path containment server-side (D81).
- Editing lands only in the session worktree (D80); viewing reads main; main is never edited directly (D38).
- Version chip never shows git SHAs or format stamps (D44).
- Plugin version bumped on every shipped change (D77 lesson).
- Deps exact-pinned; vendored bundles carry a provenance header (source pkg + exact version + vendored-by command).
- D1 org lock: the server can never express a path outside the open org root.
- CI: `node scripts/ci.mjs` auto-discovers `plugins/artifact-viewer/selftest.mjs` — every task's test rides it.
- Keep stock dsh workspace UI via the splice pattern; no Flutter; Tauri system webview is the target (WKWebView/WebView2/WebKitGTK — probe codecs at runtime, never assume Chromium).

## File Structure

```
plugins/artifact-viewer/
├── package.json                  # dsh.client declaration (client inject: runtime, ui-layout), exact-pinned
├── selftest.mjs                  # host-side suite: server, tokens, write API, watcher, containment
├── lib/
│   ├── index.js                  # host half: settings ns, org lifecycle hooks, routes, server+watcher lifecycle
│   ├── org-server.js             # per-org GET-only static server (bind 127.0.0.1:0, Host-routed org-<slug>.localhost)
│   ├── tokens.js                 # HMAC issue/verify, two classes (read/write), TTL, per-org+per-worktree scopes
│   ├── write-api.js              # POST /__arxa/artifacts/write: containment check, write, D18 WIP commit
│   ├── watcher.js                # fs.watch on open org root → debounced change events
│   ├── vendor.js                 # esbuild vendor script (runs at dev time, NOT at boot): emits lib/vendor/*.js
│   └── vendor/
│       ├── codemirror.js         # CM6 core + languages + @codemirror/merge, IIFE, pinned
│       ├── markdown.js           # markdown-it + dompurify + katex, IIFE, pinned
│       └── pdf.js                # pdfjs-dist worker + viewer, pinned
└── lib/client.js                 # browser half: lanes, editor, badges, color state, conflict prompt
```

Profile wiring: one `- insert:` row in `profile/cordis.patch.yml` registering the plugin **by package name** (it has a client half), mirroring row 7 (design-panel).

---

### Task 1: Plugin scaffold + profile wiring

**Files:**
- Create: `plugins/artifact-viewer/package.json`, `lib/index.js`, `selftest.mjs`
- Modify: `profile/cordis.patch.yml` (append insert row)

**Steps:**
- [x] Write package.json copying design-panel's shape (name `arxa-artifact-viewer`, version 0.1.0, dsh.client inject runtime+ui-layout, platform web).
- [x] Write lib/index.js host skeleton: `export const name`, settings namespace `arxa-artifact-viewer` (settings: maxEditBytes 5_000_000, tokenTtlSeconds 120) via installSettingsSection — design-panel/lib/index.js is the template.
- [x] Write selftest.mjs skeleton asserting the settings section describes itself.
- [x] Append profile insert row by package name; boot the studio once; assert the plugin appears in settings.describe output.
- [x] `node scripts/ci.mjs` → GREEN including the new suite. Commit: "artifact-viewer: plugin scaffold + profile row".

### Task 2: Per-org read-only file server (D7 lanes 2–3)

**Files:** Create `lib/org-server.js`; modify `lib/index.js` (lifecycle wiring), `selftest.mjs`.

**Interfaces:**
- Produces: `startOrgServer({ orgRoot, orgSlug }) → { port, origin, close() }` where origin = `http://org-<slug>.localhost:<port>`.
- Consumes: org open/close from file-org-shell lifecycle (DISCOVERY STEP: read `plugins/file-org-shell/lib/lifecycle.js` exports for the open/close event or hook seam; if none exists, subscribe to the same workspace-index scan completion the sidebar uses — do NOT modify lifecycle.js in this task).

**Steps:**
- [x] Discovery: locate the org open/close seam; note it in the task commit message.
- [x] Implement org-server: GET-only (405 otherwise), path containment via path.resolve + prefix check (reject `..`, absolute, symlink escapes via realpath), MIME map (MDN guide), range requests for video/audio (206), `Cache-Control: no-store`.
- [x] Every URL except /healthz requires a valid read token (Task 3 wires issuance; until then accept a test-mode bypass flag OFF in prod).
- [x] Selftest: fake org tree → server up → GET file 200; POST 405; `../etc/passwd` rejected; symlink escape rejected; close() kills server (connection refused after).
- [x] Commit: "artifact-viewer: per-org GET-only file server with containment".

### Task 3: Tokens (D7 rider + D81 classes)

**Files:** Create `lib/tokens.js`; modify `lib/index.js` (`POST /__arxa/artifacts/token` on studio origin), `selftest.mjs`.

**Steps:**
- [x] HMAC-SHA256, payload `{orgId, relPath, scope: 'read'|'write', worktreeId?, exp}`, secret per boot from $ARXA_HOME/keys (reuse `keys/` dir convention; create per boot if absent, 0600).
- [x] Route issues read tokens for open-org paths (validates containment before signing) and write tokens scoped to one worktree id.
- [x] Selftest: round-trip; expired → rejected; wrong org → rejected; containment failure at issue → 403.
- [x] Commit: "artifact-viewer: short-lived read/write token classes".

### Task 4: Client lane A — direct render (text/code/md/images/audio/video)

**Files:** Create `lib/client.js`, `lib/vendor.js` + vendored bundles; modify package.json (exports ./client already declared).

**Steps:**
- [x] Vendor script: esbuild → IIFE for codemirror@6 (read-only preset first), markdown-it@15+dompurify@3+katex@0.18; provenance headers. Record exact versions in the header (verify with `npm view <pkg> version` first — docs/research numbers are the hypothesis, registry is the proof).
- [x] Type detection by extension + sniff (binary refusal: null-byte within first 8 KB → lane B refusal, read-only notice).
- [x] Lanes: code/text → CM6 read-only; md → markdown-it+DOMPurify render; images → `<img>` via tokened org-origin URL; audio/video → native elements, `canPlayType` probe with HEVC fallback message.
- [x] Client smoke (manual + lens): open a sample org artifact of each type; assert render, no console errors.
- [x] Commit: "artifact-viewer: direct-render lanes + vendored bundles".

### Task 5: Client lane B — sandboxed iframe + pdf (D7 lane 3)

**Files:** Modify `lib/client.js`, `lib/vendor.js` (pdf.js vendored), `selftest.mjs` (serves fixture html/pdf).

**Steps:**
- [x] html/mdx → `<iframe sandbox="allow-scripts" src="http://org-<slug>.localhost:<port>/<tokened-path>">` — never srcdoc, never studio origin.
- [x] pdf → pdf.js in worker, scripts/launch actions disabled, worker same package version.
- [x] Selftest: fixture html served on org origin; assert iframe src host ≠ studio host in served page HTML; pdf fixture streams with 206 on range.
- [x] Commit: "artifact-viewer: sandboxed iframe + pdf lanes".

### Task 6: Engine write API (D81)

**Files:** Create `lib/write-api.js`; modify `lib/index.js` (`inject: ['webServer', ...]` + route), `selftest.mjs`.

**Interfaces:**
- Produces: `POST /__arxa/artifacts/write` body `{ worktreeId, relPath, content, expectedMtimeMs? }`, header `x-arxa-write-token`. → 200 `{ committed: <WIP sha-less ack>, mtimeMs }` | 401/403/409.
- Consumes: file-org-shell worktree registry for worktree root resolution (DISCOVERY: locate registry API; if it cannot resolve, fail LOUDLY, never guess a path).

**Steps:**
- [x] Containment: resolve relPath inside worktree root; realpath the parent; reject escapes. Reject account/ paths (D28/D37) and .arxa/ internals.
- [x] Write atomically (tmp+rename), then D18 WIP auto-commit in that worktree via the existing two-tier commit machinery (DISCOVERY: find the D18 helper in file-org-shell; reuse, don't reimplement).
- [x] Selftest: happy path (file changed + WIP commit exists in `git log`); `../` → 403; expired token → 401; account/ path → 403; concurrent mtime mismatch → 409.
- [x] Commit: "artifact-viewer: engine write API with containment + WIP commits".

### Task 7: Editor lane (D78–D80)

**Files:** Modify `lib/client.js` (CM6 editable mode, save flow, session badge placeholder), `lib/vendor.js`.

**Steps:**
- [x] Edit toggle on text-family types (D78): requests write token for the session worktree (D80: transparent session ensure — DISCOVERY: sidebar/session surface that owns session creation; reuse it; if none open, create the session silently through the same API the sidebar uses).
- [x] Save = CM6 changes → POST write API; failure paths surface inline (401 → re-issue; 409 → conflict prompt placeholder).
- [x] Header: session badge (workspace name + session label) so edits-not-on-main is visible (D85, badge half).
- [x] Lens check: live loop on a fixture org — open → edit → save → `git log` shows WIP commit in the worktree.
- [x] Commit: "artifact-viewer: CM6 editor lane with session-backed saves".

### Task 8: md source|preview split + hard guards (D82)

**Files:** Modify `lib/client.js`, `selftest.mjs`.

**Steps:**
- [x] Split pane: CM6 source | rendered preview (markdown lane renderer reused); preview re-renders debounced on change.
- [x] Guards: binary sniff + maxEditBytes (settings) → editor refused into read-only view with a notice.
- [x] Selftest: oversized + binary fixtures refused; md renders sanitized (script tag stripped — assert).
- [x] Commit: "artifact-viewer: md split preview + edit guards".

### Task 9: Diff (D84)

**Files:** Modify `lib/vendor.js` (@codemirror/merge into the CM bundle), `lib/client.js`, `plugins/gen-ui/lib/client.js` + catalog (card upgrade), selftests.

**Steps:**
- [x] Editor diff view: worktree file vs main via `git show main:<path>` through a new `GET /__arxa/artifacts/main-version` (read-token gated, containment-checked).
- [ ] gen-ui Diff card: swap line-by-line for the same merge view when a real file diff lands (keep the card's data contract; this is the LCS retirement note finally paid).
- [x] Selftest: main-version route returns main's blob; missing file on main → empty-base diff.
- [x] Commit: "artifact-viewer: one diff engine, editor + gen-ui surfaces".

### Task 10: Header context (D85)

**Files:** Modify `lib/client.js`.

**Steps:**
- [x] Version chip: D44 pill (named version + state) from the D20 timeline data the git plugin already renders; click → timeline surface; NEVER a SHA/stamp.
- [x] Lens check: chip + badge visible in the 390 rung without overflow.
- [x] Commit: "artifact-viewer: version chip + session badge in editor header".

### Task 11: External changes (D86)

**Files:** Create `lib/watcher.js`; modify `lib/index.js` (push channel — reuse the approvals registerUpgrade WS pattern), `lib/client.js`, `selftest.mjs`.

**Steps:**
- [x] fs.watch on open org root (recursive; WebKitGTK fallback: poll on focus), debounce 250 ms, push `{relPath, mtimeMs}` to clients with the file open.
- [x] Client: clean buffer → auto-reload; dirty buffer → conflict prompt (keep mine / take theirs / @codemirror/merge view).
- [x] Color state: gutter marks for unsaved lines, dirty dot on tab, conflict color for external-under-dirty.
- [x] Selftest: touch file → event within 2 s; two rapid writes coalesce.
- [x] Commit: "artifact-viewer: watcher push + live color state + conflict prompt".

### Task 12: Acceptance gate (D87) — GREEN 2026-08-31 (CI + lens 3-rung loaded-state + live engine-side demo; owner on-screen walkthrough per runbook remains available)

**Files:** Modify `selftest.mjs` (full suite), create `docs/plans/artifact-viewer-demo-runbook.md`.

**Steps:**
- [ ] `node scripts/ci.mjs` GREEN with the new suite.
- [ ] Lens visual gate: viewer + editor at 390/744/1280, zero console/page errors.
- [ ] Live demo per runbook: open → edit → save → WIP commit → stage-gate merge visible in D20 timeline; agent edits the open file → conflict prompt; expired token rejected; org origin proven GET-only (curl -X POST → 405).
- [ ] Bump plugin version (D77). Commit: "artifact-viewer: D87 acceptance gate green".

---

## Explicitly deferred

- Image markup editing, media trimming, PDF forms (outside D78 text family).
- Notebooks (research: defer), 3D (add `model-viewer` lane when an org actually produces glTF).
- LSP / IntelliSense (D79 revisitable only on hard demand).
- Mobile projection of the viewer (cairn rail, M7/M8 world).
