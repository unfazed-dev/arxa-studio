# Freestyle visual verification — 2026-09-09

Captured through arxa `CdpSession` against the real Studio engine. Each run
asserted its visible result and checked console/page errors. Screenshots were
visually inspected. Normal and wide viewports are 1280×900 and 1920×900 with a
280px sidebar; the collapsed rail is 56px wide and was captured after settling.

| Surface | Default viewport | Wide viewport | Collapsed rail |
|---|---|---|---|
| Organisations | [default](org-default.png) | [wide](org-wide.png) | [rail](org-rail.png) |
| Freestyle empty | [default](empty-default.png) | [wide](empty-wide.png) | [rail](empty-rail.png) |
| Freestyle root and live session | [default](root-session-default.png) | [wide](root-session-wide.png) | [rail](root-session-rail.png) |

The [local-only welcome](welcome-local-only.png) shows the first-launch path
into Freestyle with no organisation or GitHub account.

## Organisation pixel gate

No historical PNG goldens existed in the named snapshot directory. Controlled
before-change captures are preserved in [reference-org](reference-org/).
All compared pixels below are exact (RGB difference bounding box is empty).
Coordinates use `(left, top, right, bottom)` on the sidebar clip.

| Capture | Reference region | Current region | Result |
|---|---|---|---|
| Default/wide header | `(0,0,280,120)` | same | Exact |
| Default/wide body | `(0,125,280,310)` | `(0,166,280,351)` | Exact after required 41px tab strip |
| Default/wide footer | `(0,840,280,900)` | same | Exact |
| Rail header/actions above tabs | `(0,0,56,106)` | same | Exact |
| Rail existing org actions | `(0,111,56,200)` | `(0,191,56,280)` | Exact after two 40px tabs |
| Rail footer | `(0,840,56,900)` | same | Exact |

The reference org is a closed recent with no sessions, matching the original
fixture state. The required new tabs are excluded from the unchanged-content
comparison. The animated home background prevents full-page pixel convergence;
this gate compares the sidebar itself.

## Interaction evidence

- [Tree files](tree-files.png): root and nested create; expanded folders remain
  mounted while refreshing.
- [Inline rename](inline-rename.png): existing row edits its name in place.
- [Drag hover](drag-hover.png): valid destination feedback; the browser flow
  moved the source into the selected folder. A separate cross-root attempt was
  refused with a notice and the source remained.
- [Trash confirmation](trash-confirm.png), [file Trash](trash-entries.png),
  [Archives](archives-entry.png), [session Trash](trash-session.png): one browser
  flow exercised create → rename → trash → restore → duplicate → move → new
  conversation → archive → session Trash → restore. Repeated confirmations and
  owning-root labels were verified in the same mount.
- [Root editor autosave](viewer-root-save.png): actual Monaco editing with no
  open organisation, a precise first-read mtime, HTTP 200, WIP commit and clean
  repository; no incidental organisation session was created.
- [External deletion conflict](viewer-conflict.png): the pending save returned
  409 and did not recreate the missing file. Explicit **Overwrite with mine**
  then returned 200 and committed the recreated file.

External filesystem create/delete and empty-directory create/delete refreshed
visible rows through SSE; nested expansion survived. Focused behavioral tests
also cover delayed saves across navigation and event isolation between roots.
