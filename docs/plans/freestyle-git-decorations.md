# Freestyle git decorations — the badge that never rendered

**Spec:** [`local-only-git-parity-and-sidebar-decorations.md`](local-only-git-parity-and-sidebar-decorations.md)
(D117, decisions 6-7) and [`freestyle-section.md`](freestyle-section.md) F9 / Task 13.

## The report

> "there was in the plan mentions of git icons for status next to the file —
> i do not see any of that feature in the sidebar next to the files"

Correct. In the Freestyle tab the feature was never rendered, and no amount of
seeding would have produced it.

## Root cause — two gaps, not one

Both plans record the same claim. `freestyle-section.md` Task 13:

> Consumes … the decorations plan's status map (`git diff --name-status
> main...HEAD`) which keys by repo-relative path: Freestyle rows pass `rootId`
> and `relPath` by `ArxaDirRows` path.

and `local-only-git-parity-and-sidebar-decorations.md:946`:

> Freestyle rows use the same `ArxaDirRows` decoration path, with `rootId` and
> repo-relative `relPath`.

Both say Freestyle needs no code of its own. Neither is true.

**Gap 1 — the row component diverged.** `ArxaDirRows` has two branches. The
Organisations branch renders the badge (`workspace-region.snippet.txt:2156-2157`
for files, `2180-2181` for folders). The `rootId` branch delegates to
`FreestyleEntryRow` (2006-2049), which contains **zero** `ARXA_DECO` references
— no badge, no `aXa_decoText` class on the title. Freestyle rows never had the
markup. The shared path the plans relied on stops at the `if (rootId)`.

**Gap 2 — the map has no Freestyle source.** `arxaDeco` is fetched by
`arxaRefreshDeco` from `ORG_POST("session.decorations", {orgId, sessionId})`,
keyed on `orgStore.currentSessionId`. A Freestyle root is not an org session's
worktree, so the map is empty on that tab by construction. Even with Gap 1
fixed, every lookup would miss.

`ARXA_USE_DECO()` at 2062 already repaints the subtree, and
`git-workspace/lib/decorations.js` already computes maps for any repo path.
What was missing is a Freestyle source and the two call sites.

## Baseline — what a Freestyle badge measures

Not the org answer. Org decorates session-vs-`main` because the row *is* a
session file. Freestyle session worktrees live in `.arxa/worktrees/<id>` with
their own `.git` (`arxa-freestyle/lib/sessions.js:21`), so the tab's rows are
always the **root working tree**, never a session's.

The honest baseline is therefore `HEAD`: what changed on disk that arxa has not
committed yet. `decorate(path, { base: 'HEAD' })` gives exactly that — the
three-dot diff collapses to empty and `status --porcelain` is the whole answer,
with the same M/A/D/R letters and the same folder rollup.

**A known blind spot, stated rather than hidden:** anything arxa itself writes
commits immediately — file create/rename/trash (`arxa-freestyle/lib/files.js:12`)
and viewer saves (`artifact-viewer/lib/write-api.js:261`) both `wipCommit`. So
an edit made *inside* arxa decorates for about a second and then clears. What
decorates durably is work done outside arxa — your editor, your terminal, an
agent writing into the folder — which is the case a Freestyle root exists for.

And `wipCommit` stages `-A`, so it clears the *whole* root, not just the file it
was called for: trashing one file also commits every pending external edit and
takes their badges with it. Measured, not assumed — the first verification run
came back with an empty map for exactly this reason, because the seed trashed a
file after dirtying the tree. Narrowing that would mean changing `wipCommit`'s
contract, which the WIP net depends on; out of scope here and recorded instead.

## The fix

| Layer | Change |
|---|---|
| `arxa-freestyle/lib/index.js` | `state()` carries `deco: { files, dirs, ok }` per **open** root, from `decorate(root.path, {base:'HEAD'})` + `foldDirs`. No new route, no new poll — the tree already refreshes on this payload. |
| `workspace-region.snippet.txt` | `arxaFsDeco` map; `ARXA_DECO_FOR`/`ARXA_DECO_BADGE` take an optional `rootId` and read it; `FreestyleEntryRow` gains the badge and the title classes. |
| `freestyle-region.snippet.txt` | the store's `refresh()` fills `arxaFsDeco` and fires `ARXA_DECO_EVENT` only when the map moved; the watcher stream re-fetches state on a 500ms trailing timer. |
| locales ×3 | `rows.deco.local.*` — the org strings say "in this session", which a root with no session does not have. |

Nested repos inside a root report from the root repo's side only (one entry for
the whole nested tree). Marked `ponytail:` at the source; per-nested-repo maps
if anyone actually keeps repos in there.

### The half that would have shipped broken

The state payload is fetched on mount and after mutations. A file changing
*under* the sidebar is neither — and that is the only case these letters exist
for, since anything arxa does to a file commits it. Worse, editing a file's
**content** changes no directory listing, so the existing
`arxa-freestyle-tree-refresh` could not stand in: `M`, the commonest letter,
would never have appeared on its own. Every check above still passes in that
world, because a lens capture is a fresh page load.

The watcher stream (`/__arxa/artifacts/events`, already driving the tree) now
also re-fetches state on a 500ms trailing timer — it speaks once per changed
file, so a branch switch touching two hundred files is one map rebuild.

## Verification

- `plugins/arxa-freestyle/selftest.decorations.mjs` (13 checks) — a dirty file,
  a new file and a deleted file in a real root produce `M`/`A`/`D`, folders roll
  up, nothing under `.arxa` decorates, a non-repo root reports `ok:false` rather
  than "all clean", and the state route's baseline is pinned to `HEAD`.
- `plugins/arxa-sidebar/selftest.mjs` — four new D117 pins: the badge call site
  in the Freestyle row, the per-root map, the map riding the state payload
  (still exactly one `session.decorations` fetch), and the local title table
  present in all three dictionaries.
- **Lens, real engine, 1440×900** — a root dirtied from outside arxa, Freestyle
  tab, root open:

```json
{"rows":6,"decorated":[
  {"text":"hello.md",     "letter":"M","label":"Modified, not committed yet"},
  {"text":"untracked.md", "letter":"A","label":"New, not committed yet"},
  {"text":"docs",         "letter":"M","label":"Modified, not committed yet"}]}
```

  File letters, the folder rollup on a collapsed `docs`, and the tinted row text
  — and no label claiming "in this session". Screenshot:
  [git-decorations.png](phase0b-snapshots/freestyle/git-decorations.png).

- **Lens, live repaint** — the test the capture above cannot do. Root seeded
  **clean**, page loaded (assertion: zero badges on screen, or a later badge
  proves nothing), then `hello.md` edited on disk 7s after load with no reload
  and no interaction: `M` appeared. This is the path that would otherwise have
  shipped broken.

`node scripts/ci.mjs`: ALL GREEN, drift gate included.

**Not re-verified:** that the Organisations tab renders its own badges live.
Its path is unchanged here and carries twelve D117 pins, but no capture in this
round put a dirty org session on screen.

## Correction to the two plans

Task 13's "needs no Freestyle-specific code" and the decorations plan's line 946
are wrong as written and are corrected in place, pointing here.
