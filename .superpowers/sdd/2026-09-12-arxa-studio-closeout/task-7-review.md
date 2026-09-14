⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set and takes precedence over your claude.ai login · Unset it to load your organization's connectors
[claude-code:unrecognized_model] {"model":"glm-5.3[1m]","query_source":"sdk"}
### Spec Compliance

**❌ Issues found** (one partial step, ruled below; everything else compliant)

- **S1 threat table** ✅ — `docs/plans/artifact-viewer-vscode-monaco.md:871` "Threat model (Task 7)": all ten required rows (origin, sandbox, CSP, cookies, localStorage, parent DOM, fetch reach, token exposure, navigation, provenance), each with *measured* behavior + holder + residual. Not narration — the probes run in `spike.html` and `check.mjs` asserts them (verified live, both engines).
- **S2 allowlist freeze** ✅ — `selftest.mjs:1220` ff.: set-equality of imports extracted from `entry.mjs` against 14 pinned names + exact `36.2.7` per-name in the build manifest + negatives (no vsix in comment-stripped vite config, no `iframeAlternateDomain:` property, no `registerExtension(`, vsix plugin must remain an unwired devDep). An arbitrary added import breaks the `deepEqual` — that's the pin. Runtime bypass checked: only narrative comments mention vsix/`iframeAlternateDomain` anywhere in `src/`; no runtime registration exists.
- **S3 ambient closures** ✅ — the real find: SSE `/__arxa/artifacts/events` was an unauthenticated org-wide change channel; now token-gated, deny-default (`watcher.js:96`), lane-class-bound verify in `index.js`, client mints + re-mints on error; sidebar source-of-truth fixed and regenerated. Cookies/CSP/localStorage/parent-access/navigation pinned by the spike gate. The same-origin mint route remains — honestly recorded as "the one ambient door" held by provenance; the invariant (no *ambient* token) holds.
- **S4 language strip** ⚠️ **partial — ruled acceptable-deferred-to-Task-8.** 1280 delivered and genuine (verified in the PNGs: real squiggle under `"no"`; exact dart strip copy, no download button). 744 = dart strip only (attempt-2 code, copy selftest-pinned); **390 = nothing**. Ruling: deferral is legitimate — Task 8 owns the full ladder for all touched surfaces in the same `designs/evidence/studio-closeout/` tree, and the blocker (sheet won't mount on emulated resize; no headless narrow entry) is a product gap Task 8 must fix for every surface anyway. It is a letter-of-spec miss for this task, but documented, ledgered, and not closable in-scope without that product fix. Task 8 must treat 390-for-viewer as open, not inherited-as-done.
- **S5 autosave** ✅ — probe on record and gate-asserted (`files.autoSave === 'afterDelay'`, flush ~1257–1260 ms into the *in-memory* overlay, not disk); bundle-never-sets-it pin; debounce-coalescing pin (one save per settled edit); ownership unchanged per ruling 4 — the correct branch.
- **S6 Dart** ✅ — `selftest.lsp.mjs` present/absent blocks (ran green, incl. `installArgv` null, no npm row); live shots verified; strip copy pre-pinned at `selftest.mjs:692`.
- **S7 pdf.js + Prettier** ✅ — retained and pinned (`client.js` `ext === '.pdf'`/`PdfView`, `'md','yaml','yml'`, neither in allowlist); recorded in the plan doc.
- **S8 gen-ui** ✅ — DEFERRED branch, correctly evidenced: marker at `plugins/gen-ui/lib/client.js:307`, trigger test (any file-read API in gen-ui host breaks the pin), `{path,before,after}` contract pinned. Meets that branch's requirements exactly.
- **S9 gates + runbook** ✅ — re-run independently below, all green; runbook §7 added with closed checkboxes, amended html row, honest BLOCKED notes.
- **S10** ✅ — commit message exact.

**⚠️ Cannot verify from diff:** the zero-console-error filter list (driver lives in `/tmp/arxa-task7`, outside the repo — see Minor 3); the 744 shot's attempt-2 provenance (accepted: strip copy is selftest-pinned).

### Independent Verification Results

| Command | Exit | Key line |
|---|---|---|
| `npm ci` (monaco-build) | 0 | clean install |
| `npm run build` | 0 | `✓ built in 1.98s` |
| `node check.mjs` (Chrome) | 0 | `check: GREEN`, `fail:[]` |
| `node check.mjs --webkit` | 0 | `check (webkit): GREEN`, `fail:[]` |
| 7× `selftest*.mjs` | 0 | `selftest.lsp: 55 ok` incl. `LIVE: a reconnect after the last socket left gets a fresh server`; `GREEN (Task 7 trust boundaries + runtime freezes)` |
| root `npm test` | 0 | `arxa-studio CI: ALL GREEN` |

Gate report JSON confirms the probes are real: `extHostOrigin` = same origin, `extHostReachesParentDoc: true`, `cookie: ""`, `localStorageKeys: []`, `autoSaveProbe {filesAutoSave: "afterDelay", flushedToOverlayMs: 1260/1257, typedKept: true}`, webview frames carry `default-src 'none'` CSP.

**Evidence tree:** exactly the 8 committed PNGs — 7×`1280/`, 1×`744/`, **no `390/`**. `langstrip-ts-1280.png` (2560×1800) shows the squiggle under `"no"` in `const n: number = "no"` plus the problem-pane entry, no error overlays; `dart-absent-strip-1280.png` shows the exact strip copy with no install button.

### Strengths
- The threat model is *measured*, not narrated — and wired into the Chrome+WebKit gate so the boundary is regression-pinned forever.
- The SSE close is proper security work: deny-default, token-class confusion tests (read ≠ tree-read, wrong-root tree-read refused, tree-read ≠ changes-read), and catching the collateral break in the *sidebar's* source of truth before shipping it.
- The LSP wedge fix is textbook: TDD'd live reconnect (RED on base, `spawned === 2`), double-stop guarded (`lsp.js:498`), rationale recorded against the comment it reverses.
- The report is unusually honest — concerns disclosed, not buried.

### Issues
#### Critical (Must Fix)
None.

#### Important (Should Fix)
None — both real gaps are ruled below as deferred/scoped, with conditions.

#### Minor (Nice to Have)
1. **Narrow-rung gap carries to Task 8 (condition on the deferral):** 390 is empty and 744 is dart-only. Acceptable per the ruling above only if Task 8 captures the viewer ladder in the same tree — the ledger entry must not be closed until then.
2. **Stale comment contradicts its own assertions** — `spike.html:597` ff.: "files.autoSave defaults to 'off' … typed bytes staying out of the provider proves no competing save path" sits directly above assertions requiring `'afterDelay'` and `flushedToOverlayMs !== null` (my runs: flush at ~1260 ms). A future reader re-deriving ruling 4 from the comment gets it backwards. One-line comment fix.
3. **Un-auditable console-error filters** — the filter list lives in the out-of-repo driver. The scoping is disclosed and the filtered items named/proven pre-existing, so I judge it honest, not masking (the React #310 error is tracked, not filtered); but for Task 8 the driver and its filter patterns should land in-repo so the gate is reviewable.
4. **Theoretical double-`onerror` retry overwrite** — `arxa-sidebar/lib/client.js:7554` / `freestyle-region.snippet.txt:301` (and same shape at `artifact-viewer/lib/client.js:1525`): a second `onerror` before close settles overwrites the retry timer without clearing it; two connects could leak an extra open EventSource. Spec says no events fire after `close()`, so low risk; symmetric `clearTimeout` before re-arm would close it.

### Assessment
**Task quality:** Approved
**Reasoning:** Every gate re-ran green independently, the trust-boundary work is real and regression-pinned in both engines, and the two spec deviations (narrow rungs, html squiggle) are correctly-judged documented deferrals — the first owned by Task 8 by plan, the second verified unsatisfiable by design (`client.js:115` routes `.html` to the preview lane). Remaining findings are polish.
