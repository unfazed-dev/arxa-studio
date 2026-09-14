# Artifact viewer docked column — D88–D93 acceptance runbook

> **Outcome 2026-09-14 (Task 17):** the unchecked boxes below are closed or dispositioned —
> HTTP-semantics legs (expired token, GET-only origin, conflict, SSE deny-default, tree-read
> mint) are asserted green by the artifact-viewer selftest suites inside `npm test`; autosave /
> diff / dart-present evidence (2026-09-13 §7) stands marked env-coupled (fresh-boot
> reproduction blocked by the E1 LSP chain, AXS-063); the person-driven legs §§1–§5 are
> PREPARED — an operator walkthrough, no authorization needed (AXS-068). Row-level detail:
> `closeout-evidence-2026-09-12.md` §G7-notes.

Supersedes the D87 overlay-panel runbook. The viewer is a docked,
session-bound column (D88) with org-wide reach (D90), card routing (D91),
and a narrow-viewport sheet (D92).

## 0. Preconditions

- [ ] `node scripts/ci.mjs` → ALL GREEN (includes the sidebar selftest
      with T4 file-section checks and the artifact-viewer selftest with
      T5 card-routing checks).
- [ ] Boot: `ARXA_PORT=7897 node bin/arxa-studio.mjs` (Node 24). Boot log
      shows the profile materialized and
      `[arxa-artifact-viewer] org server serving <org>`.
- [ ] Open http://arxa.studio.localhost:7897 — one client per engine
      (a second tab shows the "Already open" shield).

## 1. Session + docked column (D88/D93)

- [ ] Sidebar: open the org, expand categories to a workspace row; the
      newest session auto-opens (resume) or click a session row.
- [ ] The viewer column opens only while a non-blank session is current:
      send one message first (blank flips on accepted send).
- [ ] Dispatch or click an entry point (card, sidebar file row, path
      input) → the column docks at 360px with the panel header
      (⤢ maximize, ✕ close) and the details seat is untouched.
- [ ] Drag the left handle: width follows, stops at the 320px clamp.
- [ ] Reload → reopen → the dragged width is kept (localStorage
      write-through in the generated layout store).
- [ ] ⤢ maximize → viewer = viewport − sidebar − 640 center floor
      (1600 viewport → 680). Maximized is ephemeral.

## 2. Sidebar Files section (D90/T4)

- [ ] Under the org tree, expand **Files** → the org root lists lazily;
      each directory expands on click (dot-entries and .arxa/ never
      listed).
- [ ] Click a file row → the docked column opens that file (org lane).

## 3. Deliverables cards (D91/T5)

- [ ] After an agent turn that wrote files, the turn-tail chips appear.
- [ ] Click a chip → the viewer opens on the worktree lane (the chip's
      absolute path is re-based onto the session worktree); org lane is
      the fallback on a miss. The stock "show in folder" affordance is
      untouched. Chips never auto-open the column.

## 4. Sheet mode (D92)

- [ ] Below 1024px viewport (744/390 rungs) the viewer presents as a
      full-frame sheet with a "← artifacts" back button; same panel
      component. Evidence: sheet-744.png / sheet-390.png.

## 5. Session switch while open (D93)

- [ ] With the column open, switch sessions → the column follows the new
      session and the artifact resets to the empty state; the
      session-changes list rebinds.

## 6. Evidence

- [ ] Lens captures archived under
      `designs/artifact-viewer/evidence/lens/`: conversation-agent-live-1280.png
      (live agent + docked column), sheet-744.png, sheet-390.png,
      session-open-1280.png, and T6-GATES.md (gate table).
- [ ] Closeout evidence (2026-09-13, Task 7) archived under
      `designs/evidence/studio-closeout/{390,744,1280}/` — the artifact-viewer
      subset of the evidence tree. See §7.

## 7. Closeout runtime verification (Task 7, 2026-09-13)

Scratch `ARXA_HOME` + scratch org only — never the operator's real state.

- [x] **Boot**: `ARXA_HOME=<scratch> ARXA_PORT=7897 node bin/arxa-studio.mjs`;
      boot log shows `[arxa-artifact-viewer] root server serving <org>`.
- [x] **Install door (person-pressed, never automatic)**: the four npm
      rows (`typescript-language-server`, `vscode-langservers-extracted`
      for html/css/json) installed into the scratch home;
      `/__arxa/artifacts/lsp/status` answered `available:true` for all four
      (live query, 2026-09-13).
- [x] **Language strip on screen** (evidence 2026-09-13, headless Chrome + CDP):
      deterministic-diagnostic scratch files — `.ts` (`const n: number = "no"`),
      `.css` (`.a { colr: red; }`), `.json` (`{"a": 1,}`) — each opened in the
      viewer shows its squiggle, zero console/page errors on viewer surfaces:
      `1280/langstrip-{ts,css,json}-1280.png`.
      `.html` is the PREVIEW lane by design (implementation plan: org-origin
      `<iframe sandbox="allow-scripts">`, never the studio origin) — a
      squiggle-on-screen row cannot exist for it; evidence is the rendered
      lane plus its origin property (`1280/langstrip-html-preview-1280.png`,
      measured `host org-<slug>.localhost ≠ studio host`), and
      `lsp/status` `available:true`. vscode-html-language-server publishes no
      diagnostics for any of the classic error inputs by default (measured at
      the bridge) — see the ledger.
      **Narrow rungs (744/390) are BLOCKED for headless evidence, not skipped
      by choice**: the sheet does not mount on emulated resize (the T6-era
      known issue resurfaced) and the wide-only sidebar is the only headless
      file entry — a narrow-mode artifact open has no reachable entry point
      for a driver. 744 keeps `744/dart-absent-strip-744.png`. Follow-up: see
      the ledger (sheet/emulated-resize entry gap).
- [x] **Dart discovery**: present case — dart on PATH, `main.dart` opens the
      editor, language service, NO strip (`1280/dart-present-service-1280.png`).
      Absent case — boot with `ARXA_LSP_DART=/nonexistent`: the strip reads
      *"install its SDK"*, and there is NO download button
      (`1280/dart-absent-strip-1280.png`, plus the 744 shot above).
- [x] **Autosave ownership**: a typed burst settles to exactly ONE
      "Saved · WIP committed" note (measured live: one note transition at
      ~1 s after the poll began; steady state after — no second save):
      `1280/autosave-one-per-settled-edit-1280.png`. `files.autoSave` is
      recorded as afterDelay-into-memory in the vscode-monaco plan's threat
      model — the worktree write stays the debounce's alone
      (selftest.client-save-race.mjs + the debounce-coalescing pin).
- [x] **Browser gate rerun**: `node check.mjs` and `node check.mjs --webkit`
      GREEN in `lib/monaco-build/` (the threat-model probes ride the spike).
- Runtime fix that this run surfaced and closed: a language server kept alive
  after its last socket left wedged permanently (tsserver answered nothing on
  every reopen past the first — diagnostics died at the first remount). Server
  lifetime is now last-socket-scoped (`lib/lsp.js`, selftest.lsp.mjs LIVE
  reconnect block).

## Known follow-ups

- Org-lane artifact fetch inside the sheet returned 403 once mid-session
  (token TTL vs. resize timing) — a fresh open refetches; watch it.
- React #310 console error appears on some loads — investigate.
- Session rows spawned before the unique-id fix keep stale dsh bindings —
  archive those rows.
