# Freestyle row grammar — conformance passes, 2026-09-09

The Freestyle tab rendered its own row chrome where the Organisations rows
reach for stock dsh classes. Primitives and tokens were already conformant
(15 dsh primitives, 10 stock `Rows_module_css` classes, real `--dsw-*` tokens);
what diverged was the row furniture around them.

Two passes. Round 1 replaced the obvious custom controls. Round 2 — after the
tab still did not read like Organisations side by side — replaced the rest and
reversed one round-1 decision.

## The reference grammar

Every Organisations row, from a project row to the Archives and Trash headers,
is the same shape:

```
div.projectRow (+ .menuOpen)          style: marginLeft/marginTop/borderRadius/cursor[/fontWeight 600]
  span.slot.folder                    the icon
  span.slot.chevron                   IconTriangleRightFill14 + .arrow (+ .arrowOpen)
  span.projectText > span.title       the label
  [span]                              count, style {fontSize:11, opacity:.55, flex:none, marginRight:4}
```

The two slots share one 16×20 box because stock CSS swaps them:

```css
.aXa_wsr_projectRow .aXa_wsr_chevron       { display: none }
.aXa_wsr_projectRow:hover .aXa_wsr_chevron { display: inline-flex }
.aXa_wsr_projectRow:hover .aXa_wsr_folder  { display: none }
```

At rest a row shows its icon; on hover the icon becomes the disclosure arrow in
the same position. Anything that renders both at once is a slot wider than its
Organisations counterpart — which is what Freestyle did.

## Round 1

| Was | Now | Why |
|---|---|---|
| `aXa_fs_more` button, always visible on every row | `Rows.iconButton` inside `Rows.rowActions` | stock CSS hides it until the row is hovered or its menu is open |
| `aXa_fs_pill` "open"/"closed" text badge | removed | the disclosure arrow already carries the state |
| header `+` as a literal text character | `IconProjectAddOutline16` inside the same ghost `Button` | org header actions are glyphs at that size |
| archive/trash row icons rendered bare | wrapped in `Rows.slot`; rows gained `Rows.menuOpen` | matches org icon box |
| `aXa_fs_toggle` duplicating `width:16px;height:20px` | `Rows.slot` + a slim reset | the geometry was already correct — removes duplicated values |

## Round 2

| Was | Now | Why |
|---|---|---|
| root row: arrow slot **then** folder slot, both always visible | folder slot **then** arrow slot, arrow carries `Rows.chevron` | org order + the hover swap; the old order made every Freestyle row one slot wider |
| `button.aXa_fs_disclosure` section headers | `div.projectRow` with folder slot, chevron slot, `projectText > title`, count | the headers were a different element with their own CSS — the single largest reason the tabs did not line up |
| headers had no keyboard activation once they stopped being `<button>` | `tabIndex: 0` + `onKeyDown` for Enter/Space | copied from the org headers; a `div` has none of a button's built-in activation |
| `div.aXa_fs_section` wrapper with its own top border | removed; headers carry org's inline `marginTop: 4` | org has no such wrapper or divider |
| `aXa_fs_subtle` empty states | org's inline `{fontSize:12, color:--dsw-alias-label-tertiary, padding:"4px 8px 2px 26px"}` | same |
| archive entry rows on `sessionRow`, no indent | `projectRow` + org's `{marginLeft:18, marginTop:2}` | org's `entryRow` shape |
| conversation rows: `aXa_fs_sessionIndent` 22px spacer span + bare icon | org's inline `marginLeft: 18`; icon in `Rows.slot` | org indents with a margin, not a spacer element; a bare icon sits at its own size instead of the 16×20 box |
| Organisations tab icon `IconFolderOpen16` | `OrgGlyph` | two near-identical folder glyphs sat side by side and neither tab named its content. `OrgGlyph` is "the building mark every org surface shares" (its own definition) and is already on the org tree row and the trash org group. Freestyle keeps the folder — folders are what it lists. |

Round 1 recorded that `Rows.chevron` was deliberately **not** applied to the
root's disclosure arrow, because carrying it made the arrow `display:none` at
0×0. That reasoning was right about the mechanism and wrong about the goal: the
arrow is *supposed* to be hidden at rest, exactly as it is on every org row.
Round 2 applies `Rows.chevron` and keeps the element a `<button>` so the
hover-revealed arrow stays clickable. The row's own click still selects rather
than firing a `root.open` mutation, and the context menu carries open/close.

Dropped along the way: `.aXa_fs_section`, `.aXa_fs_disclosure`,
`.aXa_fs_disclosure:hover`, `.aXa_fs_subtle`, `.aXa_fs_sessionIndent`.

Kept, with reason: `aXa_fs_meta` / `aXa_fs_reason` (second-line captions — org
rows are single-line and have no equivalent), `aXa_fs_name` / `aXa_fs_inline`
(inline create/rename, no org counterpart), `aXa_fs_toggle` (a border/padding
reset so a `<button>` can wear `Rows.slot`), `aXa_fs_rootName`, and the
`aXa_fs_tab*` strip — no `Tabs`/`SegmentedControl` primitive exists in stock dsh.

## Assertions (headless Chrome via `tool/lens_check.dart`, real engine)

Scratch `ARXA_HOME`, a seeded Freestyle root with files, root open, Freestyle
tab active, 1440×900 (below ~1000px the sidebar is in rail mode and renders no
rows — a 420px capture reports zero rows and proves nothing).

Round 2, at rest — folder shown, chevron hidden, both in the 16×20 box:

```json
{"root":     {"order":["folder","aXa_fs_toggle","projectText"],
              "restFolder":"flex","restChev":"none","fbox":[16,20],"title":true,"tabIndex":-1},
 "archives": {"order":["folder","chevron","projectText"],
              "restFolder":"flex","restChev":"none","fbox":[16,20],"title":true,"tabIndex":0},
 "trash":    {"order":["folder","chevron","projectText"],
              "restFolder":"flex","restChev":"none","fbox":[16,20],"title":true,"tabIndex":0}}
```

The hover half is proved by construction rather than by a synthetic mouse: the
three swap rules ship in `plugins/arxa-sidebar/lib/client.js`, and every one of
the three rows' folder and chevron elements matches the selectors those rules
use — `{"fMatches":true,"cMatches":true}` for root, archives and trash. CSS is
deterministic; a matching element under a shipped rule swaps.

Dead CSS: the four removed class names appear in the shipped bundle only inside
two source comments — no rule, no `className`.

Screenshots: [row-grammar-after.png](row-grammar-after.png) (round 1),
[row-grammar-r2-freestyle.png](row-grammar-r2-freestyle.png) (round 2). The
modal in both is dsh's own first-run notice on a scratch home, not part of the
surface under test.

`node scripts/ci.mjs`: ALL GREEN, including the `arxa-sidebar` byte-diff drift
gate and its "every glyph the sidebar names exists" icon check.

One selftest moved: `trash: header count is the plain org-row count` pinned the
org count span to exactly 3 occurrences. The Freestyle Archives and Trash
headers are now built on that same row and carry the same span, so the pin is 5.
It still fails on a count rendered any other way.
