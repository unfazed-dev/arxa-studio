# Sidebar tree harmony — G1/G2/G3 implementation (2026-09-06)

First branch of `docs/plans/sidebar-git-card-viewer-harmony-grill.md`. Scope is
the sidebar only: icons (G1), the Notes hierarchy + the duplicate project row
(G2), the active glyph + the current-session dot (G3). The git card and the
artifact viewer are separate commits.

## What is actually broken (verified, not assumed)

1. **Two icon systems.** Tree rows (org / dock / project / leaf) use dsh
   primitives; `ArxaDirRows` paints BOTH its file rows and its directory rows
   with the Material Icon Theme pack (`matIcons.folder(...)`,
   snippet :1687). So a folder's look depends on which of the two row systems
   drew it.
2. **`kitchen-project` twice.** `ARXA_ROW_HIDDEN` (snippet :1585) is a STATIC
   table of the fixed template vocabulary. The Projects dock's children are
   dynamic (`ARXA_ROW_HIDDEN.docks.projects` is `{}`), so every project
   directory renders once as a tree row and again as a lister directory row.
3. **Notes has no hierarchy.** `notes` is a *bare dock* (`orgTree`:
   `workspace: true`, `containers: []`), so `orgItems` (:412) pushes ONE leaf
   for it and sessions bind to `notes` itself. Its subfolders only ever exist
   as lister rows — they cannot hold sessions and they do not read as tree
   levels.
4. **Active glyph.** Traced end-to-end and it is already live on leaf rows:
   `buildGroup(workspace.workspaceId, workspace.workspaceId, …)` makes
   `g.key === workspaceId`, the spliced `open:` lever calls
   `orgStore.mutate("session.open", …)` which sets `currentSessionId`
   synchronously, `deriveGroups` sets `containsCurrent`, and `ProjectRowItem`
   applies `folderActive`. What is missing is the row-level marker for the
   session itself (G3's accent dot).

## Changes

### Host — `plugins/file-org-shell/lib/lifecycle.js`

- `orgTree`: a bare dock reports `folders` — its first-level subdirectory names
  on disk (sorted, dotfiles skipped). Container docks and `projects` are
  unchanged.
- `newSession`: accept `<bareDock>/<sub>` when `<org>/<bareDock>/<sub>` is a real
  directory and `<sub>` matches the segment shape. `routeDock` already routes
  `notes/**` to the org repo, and `mintSessionPath` already mints a clean id
  (`RESTO/notes/ideas/idea-wt-260906-001`, verified). `account/**` stays refused
  by the routing table.
- `plugins/workspace/lib/template.js` is NOT touched: `fixedWorkspaces` is
  pinned at 10 entries by `plugins/workspace/selftest.mjs:252`, and the
  allowance is a disk fact, not template vocabulary.

### Region — `plugins/arxa-sidebar/lib/workspace-region.snippet.txt`

- **`orgItems`**: a bare dock pushes a leaf per `d.folders` entry
  (`notes/<sub>`, label = the raw folder name, sessions = `leafIds`).
- **`arxaRowChildren(workspaceId)`** replaces `ARXA_ROW_HIDDEN`: the names that
  already exist as tree rows one level under a row, derived from
  `workspacesView.items` (the same list that builds the tree). Static table
  deleted. Applied to org rows, dock rows and leaf rows (`ARXA_LEAF_FILES`).
  **Project rows keep `hideDirs: null`** — D94 settled that stage containers,
  targets and `.github/` are real sidebar content, and overturning it is not in
  the confirmed scope.
- **`leafHidden`**: a *leaf* ancestor (Notes holding its subfolder rows) is
  opened by the stock row's own chevron, whose truth lives in the dsh view
  store, not in arxa's `expanded` map. Mirror `groupExpansion` into
  `arxaGroupExpanded` and consult it for non-container ancestors only —
  container ancestors stay on arxa's map alone, so a stale dsh expansion can
  never reopen a collapsed org.
- **`dirRow`**: dsh `IconFolderOpen16` / `IconFolderClose16`. `matIcons` keeps
  file rows only.
- **CSS**: the current session's row gets an accent dot, painted as a
  `background-image` radial gradient rather than a pseudo-element — `::before`
  and `::after` on `.sessionRow` are taken by the drag markers. Selector carries
  one extra step of specificity (`div.aXa_wsr_sessionRow.aXa_wsr_selected`) so
  it does not depend on style-tag order.

### Generator — `scripts/gen-workspace.mjs`

- Splice 6e also assigns `arxaGroupExpanded = groupExpansion;` in
  `WorkspaceBrowser` — the parent of `SessionTree`, so the mirror is set before
  the group map reads `ARXA_WS_HIDDEN`.

## Order

Snippet + generator → `node scripts/gen-workspace.mjs --write` →
`plugins/arxa-sidebar/selftest.mjs` (drift gate) + `plugins/workspace/selftest.mjs`
+ `plugins/file-org-shell/selftest.mjs` → screen check. `lib/client.js` is never
hand-edited.

## Known ceiling

A reload that restores the Notes group expanded in the dsh store shows Notes'
sessions but not its subfolder rows until the row is clicked once (arxa's map
and the dsh store re-sync on that click). Not worth a persistence layer.

On the very first render after mount `state.emit` is still `{}`, so
`ARXA_IS_CONTAINER_GROUP` reads false for every ancestor and the dsh mirror
gates them all. It cannot actually show anything: `leafHidden` returns early on
`!x[orgId]`, and no org is expanded in arxa's map at mount. Single frame, no
visible effect — recorded so it is not rediscovered as a bug.

Org ids are `randomUUID()` (manifest.js:36), so a `|` can never appear in one
and `wsParts` cannot mis-attribute a leaf of one org to another.
