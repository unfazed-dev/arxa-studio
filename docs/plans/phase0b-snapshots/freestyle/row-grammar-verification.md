# Freestyle row grammar — conformance pass, 2026-09-09

The Freestyle tab rendered its own row chrome where the Organisations rows
reach for stock dsh classes. Primitives and tokens were already conformant
(15 dsh primitives, 10 stock `Rows_module_css` classes, real `--dsw-*` tokens);
what diverged was the row furniture around them.

| Was | Now | Why |
|---|---|---|
| `aXa_fs_more` button, always visible on every row | `Rows.iconButton` inside `Rows.rowActions` | stock CSS hides it until the row is hovered or its menu is open — the Organisations reveal |
| `aXa_fs_pill` "open"/"closed" text badge | removed | the disclosure arrow already carries the state; org rows have no equivalent badge |
| `Archives (N)` / `Trash (N)`, no icon | `IconArchiveOutline20` / `IconTrashOutline16` in a `Rows.slot`, no count | org section rows are icon + plain label |
| header `+` as a literal text character | `IconProjectAddOutline16` inside the same ghost `Button` | org header actions are glyphs at that size |
| archive/trash row icons rendered bare | wrapped in `Rows.slot`; rows gained `Rows.menuOpen` | matches org icon box; keeps actions visible while the menu is open |
| `aXa_fs_toggle` duplicating `width:16px;height:20px` | `Rows.slot` + a slim reset | the geometry was already correct — this removes the duplicated values |

`Rows.chevron` is deliberately NOT applied to the root's disclosure arrow.
Stock CSS is `.projectRow .chevron{display:none}` with a `:hover` reveal,
because on an org row the chevron swaps in for the folder icon. Freestyle's
arrow is a persistent control that opens and closes the root, so carrying
`chevron` made it `display:none` at 0x0 — caught by the assertions below and
reverted to `Rows.slot` alone.

## Assertions (headless Chrome via `tool/lens_check.dart`, real engine)

Scratch `ARXA_HOME`, a seeded Freestyle root with files, root open, Freestyle
tab active.

- Disclosure arrow renders: `{toggleW:16, toggleH:20, toggleDisp:"flex"}`.
- Row actions hidden at rest, revealed when the row's menu opens (same rule
  the `:hover` reveal uses): `{actionsBefore:"none", actionsAfter:"flex"}`,
  parent class `aXa_wsr_projectRow`.
- Both row classes honour the reveal — synthetic nodes carrying the shipped
  stylesheet: `{sessionRow:"none->flex", projectRow:"none->flex"}`. This covers
  the archive and trash rows, whose sections are collapsed by default and so
  never appear in a capture.
- Pills gone: `{pills:0}`.

Screenshot: [row-grammar-after.png](row-grammar-after.png) — the modal is dsh's
own first-run notice on a scratch home, not part of the surface under test.

`node scripts/ci.mjs`: ALL GREEN, including the `arxa-sidebar` byte-diff drift
gate and its "every glyph the sidebar names exists" icon check.
