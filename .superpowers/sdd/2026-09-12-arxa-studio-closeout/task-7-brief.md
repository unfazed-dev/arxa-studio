### Task 7: Close the artifact-viewer security and runtime verification items

**Governing sources:** `docs/plans/artifact-viewer-vscode-monaco.md`, `docs/plans/artifact-viewer-demo-runbook.md`, `docs/plans/artifact-viewer-implementation.md`.

**Files:**
- Modify: `plugins/artifact-viewer/lib/index.js`, `plugins/artifact-viewer/lib/org-server.js`, `plugins/artifact-viewer/lib/tokens.js`, `plugins/artifact-viewer/lib/lsp.js`, `plugins/artifact-viewer/lib/client.js`, `plugins/artifact-viewer/lib/monaco-build/check.mjs`
- Modify: `plugins/artifact-viewer/lib/monaco-build/src/entry.mjs`, `plugins/artifact-viewer/lib/monaco-build/vite.config.mjs`
- Modify: `docs/plans/artifact-viewer-vscode-monaco.md`, `docs/plans/artifact-viewer-demo-runbook.md`
- Test: all `plugins/artifact-viewer/selftest*.mjs`
- Browser gate: `plugins/artifact-viewer/lib/monaco-build/check.mjs`

**Interfaces:**
- Security invariant: extension/webview execution receives no ambient studio cookies, credentials, host bridges, or mutation token; file access remains explicit, scoped, short-lived, and root-bound.
- Runtime invariants: TS/HTML/CSS/JSON LSP install/status works; diagnostics reach the editor; Dart absence gives locate/install guidance without an automatic download; autosave has one owner.

- [ ] **Step 1: Write a threat-model table in the plan doc.** Enumerate iframe origin, sandbox attributes, CSP, cookies, localStorage, parent DOM access, fetch reach, token exposure, navigation, and extension code provenance. For each, record current behavior by test/probe.
- [ ] **Step 2: Freeze the same-origin extension rule.** Add a build-manifest/allowlist test that permits only pinned vendored built-ins registered in `monaco-build/src/entry.mjs`. Arbitrary marketplace and VSIX loading stays disabled until a separately served origin is designed and reviewed.
- [ ] **Step 3: Close every other unsafe ambient capability found by the threat model and rerun the browser spike.** Preserve markdown preview, diff, tabs, settings layout, and diagnostics.
- [ ] **Step 4: Verify the language strip on screen.** Use scratch files with deterministic diagnostics in `.ts`, `.html`, `.css`, and `.json`; capture 390/744/1280 evidence with zero console/page errors.
- [ ] **Step 5: Verify autosave ownership.** Probe `files.autoSave`, retain the existing tested 1.5-second viewer debounce, and assert one save per settled edit. Change ownership only if the probe proves a competing save path and the replacement passes the save-race suite.
- [ ] **Step 6: Exercise Dart discovery.** Test present-on-PATH and absent cases. Copy must say an SDK is required; no downloader is added.
- [ ] **Step 7: Retain pdf.js and Prettier.** Record the decision, pin their existing coverage, and do not add a PDF extension experiment or widen the extension allowlist in this closeout.
- [ ] **Step 8: Reconcile the gen-ui Diff item.** Confirm whether gen-ui currently receives real file diffs. If it still receives only model-authored before/after text, mark the upgrade `DEFERRED UNTIL REAL FILE DIFF INPUT` and add a trigger test/comment. If real file inputs exist, replace the positional comparison with a bounded deterministic Myers/LCS renderer inside gen-ui while preserving `{path,before,after}`; cover insertions, deletions, reordering, hunks/context, large input, unchanged lines, and escaping. Do not mount the artifact viewer's movable singleton into repeated inline cards.
- [ ] **Step 9: Run the clean-build gate and live runbook.** In `plugins/artifact-viewer/lib/monaco-build`, run `npm ci`, `npm run build`, `node check.mjs`, and `node check.mjs --webkit`; then run every `plugins/artifact-viewer/selftest*.mjs`, root `npm test`, and the updated live runbook.
- [ ] **Step 10: Commit.** `fix: close artifact viewer runtime and trust boundaries`.

