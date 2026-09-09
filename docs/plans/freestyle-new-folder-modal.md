# Freestyle "Create new folder…" did nothing — root cause and fix

**Report (2026-09-09):** "I just created a test repo in Freestyle and got absolutely
nothing, no errors, no success — nothing."

## Root cause

The Freestyle `+` menu has two entries. "Open existing folder…" goes straight from
the native picker to `root.add`. "Create new folder…" went native picker →
**`window.prompt("New folder name")`** → `root.new`.

The desktop app is a Tauri shell over WKWebView. WKWebView does not implement
`window.prompt`: it returns `null` immediately and shows no dialog. The flow then hit
`if (name) …` with `null`, returned, and threw nothing — so there was no folder, no
error line, and no sign anything had been clicked.

This is the *same* bug the Organisations tab had and fixed (Q3, the in-bundle
`OrgCreateModal`, comment at `workspace-region.snippet.txt` "replaces window.prompt,
which WKWebView (the Tauri shell) does not implement"). Freestyle copied the picker
but not the modal, and the sidebar selftest **pinned the leftover** rather than
removing it:

> `rows: window.prompt remains isolated to Freestyle new-folder naming`

Evidence: the user's registry after the attempt, `~/.arxa/freestyle.json` at 17:08,
held `roots: []` — the host never received a `root.new`. The installed engine
`267abe53b73d` was byte-identical to the repo, so this was not a stale build.

Why the smoke tests never caught it: the arxa lens drives headless Chrome, where
`window.prompt` also returns `null` without a dialog. No harness on either shell
could type into that prompt, so the name step was invisible to every automated pass.

## Fix

Ponytail: reuse what exists. The Freestyle tab already owns a confirm modal
(`FreestyleConfirmModal`, used for Trash/purge questions). It now takes an optional
`target.input` field name:

| piece | change |
|---|---|
| `FreestyleConfirmModal` | optional `input`: a dsh `Input` (class `aXa_fs_name`, same validation as inline rename via `validFreestyleName`), Enter submits, primary button disabled until the name is valid; the typed value is merged into the action argument; a failed action shows its message inside the modal through the shared `ErrorNote` instead of only the sidebar CTA notice |
| `addNew` | native picker for the parent (unchanged), then `setConfirmTarget({ action: "root.new", arg: { parent }, input: "name", … })` — no `window.prompt` |
| modal ownership | the confirm state moves from `FreestyleRoots` up to `FreestyleBrowser`, so the `+` menu and the rows share one modal; `FreestyleRoots` takes `ask` as a prop |
| locales ×3 | `freestyle.add.submit` — "Create folder" / "Utwórz folder" / "Créer le dossier" |
| selftest pin | inverted: `window.prompt(` must not appear in the bundle at all; five `S-newfolder` pins keep the modal path; two `selftest.freestyle.mjs` pins retargeted from the removed explicit `mutate("archive.trash")` / `mutate("trash.purge")` branches to the `ask({ action: … })` calls that remain |

The explicit `trash.purge` / `archive.trash` branches in the modal were dead
duplication of the generic `mutate(target.action, target.arg)` line and are gone.

## Verification

- `node scripts/ci.mjs` — ALL GREEN. `window.prompt(` count in `client.js`: 0.
- Live, scratch engine on port 7958, headless Chrome via the arxa lens. The picker
  route was answered page-side (headless Chrome cannot show osascript's panel), then
  the real `+` → "Create new folder…" → modal → "Create folder" path was driven.
  `--expect` returned `true` on every condition:
  - primary button disabled while the name is empty, enabled once typed
  - modal closes on success; host state gains one root at `<parent>/lens-new-folder`;
    the folder exists on disk with the day-zero scaffold
  - the same name again: modal stays open, `exists: <path>` shown inline, root count
    unchanged
- Capture: `docs/plans/phase0b-snapshots/freestyle/new-folder-modal.png` — the modal
  with the parent path, the name field, and the inline "exists" error; the new
  `lens-new-folder` root already listed in the sidebar behind it.

## Not changed

- "Open existing folder…" was already prompt-free and works; its errors still go to
  the sidebar CTA notice line (`arxa-sidebar-notice` → `.aXa_sb_ctaNotice`), which is
  rendered on both tabs.
- The picker itself (`/__arxa/sidebar/pick-folder`, osascript `choose folder`) is
  shared with org creation and was not touched.

## Installed

- Commit `cb54244` on `main`, pushed. CI all green.
- Sidecar 241.1 MB, payload sha12 `e5a77b90169b`; bundled binary `95ee8f3cd5204f44` matches the packed sidecar.
- Installed engine `~/.arxa/engine/e5a77b90169b` — `client.js` sha `c6369e8ef2fd` byte-identical to the repo, zero `window.prompt(` calls, modal pin present. Only engine dir on disk (old `267abe53b73d` and a dead `.tmp-77537` pruned). LaunchAgent count 1, state route answering on 7891.
- Rollback: `/Applications/Arxa Studio.app.bak`.
