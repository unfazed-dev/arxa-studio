# Artifact viewer docked column — D88–D93 acceptance runbook

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

## Known follow-ups

- Org-lane artifact fetch inside the sheet returned 403 once mid-session
  (token TTL vs. resize timing) — a fresh open refetches; watch it.
- React #310 console error appears on some loads — investigate.
- Session rows spawned before the unique-id fix keep stale dsh bindings —
  archive those rows.
