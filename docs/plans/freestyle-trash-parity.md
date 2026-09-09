# Freestyle Archives/Trash — the same rows as Organisations, and a real folder trash

**Prior art:** [`org-delete-trash-reachability.md`](org-delete-trash-reachability.md)
(the round that removed the welcome gate and left one open question),
[`freestyle-section.md`](freestyle-section.md) F9.

## The report

Two screenshots, side by side — Organisations with one org, Freestyle with
none:

> "the freestyle archives and trash rows are still not identical to the
> organisations"

and, answering the question left open last round:

> "address the still open from last round"

The open question was whether deleting a Freestyle **folder** should move it to
a trash or keep the non-destructive "Forget folder". The user's round-1
directive already answered it — *"when user deletes anything in the sidebar,
for orgs and freestyle they must always just move to their respective trash"* —
so Forget is gone.

## Root cause — the header was copied, the section was not

`FreestyleArchivesRows` and `FreestyleTrashRows` carry the Organisations header
markup verbatim: same `Rows_module_css_default.projectRow`, same icon slot,
same chevron, same `{ marginLeft: 4, marginTop: 4, borderRadius: 6, cursor:
"pointer", fontWeight: 600 }`. The comment at
`freestyle-region.snippet.txt:572` even says so.

What they did **not** copy is the wrapper the org sections sit in
(`workspace-region.snippet.txt:1842` and `:1942`, identical in both):

```js
style: { borderTop: "1px solid var(--dsw-alias-border-l2)", marginTop: 8, padding: "0 0 8px", opacity: total === 0 ? 0.45 : 1 }
```

Freestyle returned a bare `react_jsx_runtime.Fragment`. That one missing div is
every difference visible in the two screenshots:

| Organisations | Freestyle (before) | From |
|---|---|---|
| divider line above each section | none | `borderTop` |
| 8px above, 8px below | rows butt together | `marginTop` / `padding` |
| grey while empty | full-strength ink | `opacity: total === 0 ? 0.45 : 1` |

A fourth difference is not in the screenshots but is the same class of bug as
last round: org sections **auto-open while they hold something**
(`const open = manual === null ? total > 0 : manual`), Freestyle's were
`useState(false)` and stayed shut. A Trash row that is closed by default is a
door you have to know about.

## The folder trash

`forgetRoot()` spliced the registry row and said "The folder stays on disk."
That promise is the right one — **arxa did not create a Freestyle folder, so
arxa never deletes one** — but "forget" gave it no way back.

`trashRoot` / `restoreRoot` / `purgeRoot` keep the promise and add the door:

| Verb | What moves | What happens on disk |
|---|---|---|
| `root.trash` | row → `reg.rootTrash` | nothing |
| `roottrash.restore` | row → `reg.roots` (closed) | nothing |
| `roottrash.purge` | row dropped | nothing |

**This is the one place Freestyle deliberately differs from an organisation.**
An org's trash owns the folder it scaffolded, so its purge really deletes it
(and the GitHub repos). A Freestyle root is the user's own directory, so purge
means "stop tracking it", and the confirm copy says exactly that
(`freestyle.confirm.rootPurgeBody`) rather than diverging silently.

Two consequences, decided rather than discovered:

- A trashed root contributes no entry-trash to the Trash section — `state()`
  builds `trash` from `roots.flatMap(listTrash)`. Its `<root>/.arxa/trash` is
  untouched and comes back with it on restore. Nothing is lost, and the whole
  folder is one row instead of a scatter of orphaned file rows.
- `readRegistry` returns a literal `{ roots, ui }` and **`mutate` writes back
  what it returns**, so a key the reader omits is erased on the next write, not
  preserved. `rootTrash` had to be added to `EMPTY()` and to the reader or the
  first rename after a delete would have quietly eaten the trash. Pinned by
  `plugins/arxa-freestyle/selftest.mjs` — "the trashed row survives an
  unrelated registry write".

## The fix

| File | Change |
|---|---|
| `arxa-freestyle/lib/roots.js` | `rootTrash` in `EMPTY()` + `readRegistry`; `listRootTrash`; `forgetRoot` → `trashRoot`/`restoreRoot`/`purgeRoot` |
| `arxa-freestyle/lib/index.js` | `rootTrash` on the state payload; `root.trash`, `roottrash.restore`, `roottrash.purge` replace `root.forget` |
| `freestyle-region.snippet.txt` | both sections get the org wrapper + org auto-open; Trash `total = rootTrash.length + trash.length` and lists trashed folders above trashed files; the folder menu trashes |
| locales ×3 | `-freestyle.menu.forget`, `-freestyle.confirm.forget`, `-freestyle.confirm.forgetBody`; `+freestyle.trash.removeFolder`, `+freestyle.confirm.rootTrash`, `+rootTrashBody`, `+rootPurge`, `+rootPurgeBody`. `freestyle.menu.trash` ("Move to Trash") already existed for entries and is reused |

## Verification

- `plugins/arxa-freestyle/selftest.mjs` — 4 new checks: trash moves the row and
  never touches the folder, restore returns it closed, purge drops the row and
  **still** leaves the folder, and the trashed row survives an unrelated
  registry write.
- `plugins/arxa-sidebar/selftest.mjs` — 9 `S-parity` pins, the load-bearing one
  being `(gen.split(SECTION).length - 1) === 4`: the section wrapper string
  appears exactly four times, so org Archives, org Trash, Freestyle Archives and
  Freestyle Trash cannot drift apart again without going red.
- `plugins/arxa-sidebar/selftest.freestyle.mjs` — locale parity extended to the
  five new keys.
- `node scripts/ci.mjs`: ALL GREEN, drift gate included.

### Lens, real engine, 1440×900

A scratch Studio holding exactly what the two screenshots hold: one org, one
Freestyle folder, both Archives/Trash sections empty. The four section wrappers
measured from the live DOM:

```json
{"same": true,
 "orgs":      {"Archives": {"borderTop":"1px solid rgba(0, 0, 0, 0.1)","marginTop":"8px","paddingBottom":"8px","opacity":"0.45"},
               "Trash":    {"borderTop":"1px solid rgba(0, 0, 0, 0.1)","marginTop":"8px","paddingBottom":"8px","opacity":"0.45"}},
 "freestyle": {"Archives": {"borderTop":"1px solid rgba(0, 0, 0, 0.1)","marginTop":"8px","paddingBottom":"8px","opacity":"0.45"},
               "Trash":    {"borderTop":"1px solid rgba(0, 0, 0, 0.1)","marginTop":"8px","paddingBottom":"8px","opacity":"0.45"}}}
```

Screenshots: [sections-organisations.png](phase0b-snapshots/freestyle/sections-organisations.png),
[sections-freestyle.png](phase0b-snapshots/freestyle/sections-freestyle.png).

**The folder round trip, same engine.** `root.trash` on the live root:
registry `roots 1 → 0`, `rootTrash 0 → 1`; the folder's own contents
(`hello.md`, `check.sh`) still on disk, untouched. On the next load the
Freestyle Trash section reads:

```json
{"Trash":    {"opacity":"1","header":"Trash1","rows":["Scratchpad · <path>"]},
 "Archives": {"opacity":"0.45","header":"Archives","rows":[]}}
```

— un-dimmed because it holds something, auto-opened without a click, count 1,
the folder named with its path as secondary text. `roottrash.restore` then put
it back closed, `rootTrash` empty again.

**One thing measured and rejected as evidence:** driving the trash by POSTing
the route directly leaves the sidebar showing the old rows, because the repaint
hangs off `freestyleStore.mutate` (which always refreshes) and not off the
route. That is the harness bypassing the store, not a stale UI —
`selftest.freestyle.mjs` already pins "every mutation refreshes state". The
numbers above are from a fresh load for that reason.

**Unrelated error seen in ~1 of 3 lens runs:** `Error: web app: missing #root`
from `node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-Df-65__b.js`
— a stock boot race in the vendored bundle, present on both tabs, in no file
this round touched.
