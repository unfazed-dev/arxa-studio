# Sidebar: workspace-row "+" → new worktree session

Status: PLAN (grilled 2026-09-02, decisions recorded below). Amends
`org-model-v2-implementation.md` Phase C and `sidebar-org-rethink.md` §3/§5.
Blocks the Git-card phase-4 smoke pass: without a way to start a session
from the tree, the card has nothing to show.

## Problem (found live 2026-09-02)

- The plan chose *click a workspace row → top "New Session" CTA*. Live the CTA
  sits disabled with `selectedRowId: null` and only a tooltip
  ("Select a workspace to start a session"). To the user it reads as
  "sessions cannot be created".
- The client lever `browserInjected.startSession(workspaceId)`
  (`plugins/arxa-sidebar/lib/client.js` ~5533) already states
  *"the ONLY creation path is a workspace row own +"* — the row "+" was the
  intended design. It is rendered only by the stock `ProjectRowItem`
  (`IconPlusOutline16`, aria `actions.newSession.aria` = "New session in {name}").
  arxa's rows never go through `ProjectRowItem`: `OrgContainerRow` (kinds
  `org` / `dock` / `project`) carries only the **New project** plus on the
  Projects dock; sub-folders (dock containers, project stage folders) are
  drawn by `ArxaDirRows.dirRow` — click = expand, no controls.
- Result: no workspace row has a "+"; the stock affordance was dropped by the
  v2 splice, not by a decision.
- Second defect on the same lever: it fire-and-forgets
  (`.catch(() => {})`), no open, no D111 notice.

## Decisions (user, 2026-09-02)

1. **Row "+" AND keep the top CTA.** Both call one create-and-open function.
2. **Stock dsh UI only.** Build with the dsh plugin system and stock
   primitives (`Rows_module_css_default.iconButton`, `IconPlusOutline16`,
   existing dictionary key `actions.newSession.aria`), delivered through the
   established splice route (`scripts/gen-workspace.mjs` +
   `plugins/arxa-sidebar/lib/workspace-region.snippet.txt`). Author per the
   shipped cordis skills:
   `~/.arxa/engine/<hash>/arxa-studio/node_modules/@deepseek-ai/dsh/config/agent-presets/cordis/skills/{editing-cordis-compositions,cordis-plugin-development}/SKILL.md`.
   Never edit the shipped preset install.
3. **Click = create + open immediately.** Server creates branch + worktree;
   client opens the session and focuses the conversation (same as the CTA
   today). Name auto-generated (`01-intake-001`); rename via the row menu.
4. **No "+" on project rows** (nor org / Projects container). The server
   refuses `projects/<slug>` and `projects` (`unknown-workspace`, measured
   live); a dead button is worse than none.

## Which rows get the "+" (mirror the server rule, never guess)

Server rule (`plugins/file-org-shell/lib/lifecycle.js` `newSession`):
a workspace is either a fixed dock (`template.fixedWorkspaces`) or a
project container `projects/<slug>/<container>`. Client-side validity set,
derived once per org in `buildEmit` from the same tree the server reads:

- `tree.docks[].workspace === true` → the dock row itself (e.g. `notes`).
- `tree.docks[].containers[]` → `<dock>/<container>` rows (e.g. `meetings/x`).
- `tree.projects[].containers[]` → `projects/<slug>/<container>` rows
  (`00-moodboard` … `08-deploy`, `notes`).

Exposed as one predicate `canCreateSession(orgId, path)` on the org store and
passed as a prop; rows never recompute it. Path keys are compared exactly as
the server builds them (no trailing slash, `/`-joined).

## UI contract

- Placement: trailing `iconButton` in the row, after the ⋯ menu where one
  exists — identical to stock `ProjectRowItem`.
- Visibility: revealed on row `:hover` **and** `:focus-within` (stock CSS
  class already does hover; add the focus-within rule in the splice). Never
  hover-only — keyboard users must reach it.
- `aria-label` / `title`: `actions.newSession.aria` with the row label.
- Click / Enter: `e.stopPropagation()` (row click selects + toggles; the plus
  must not). Disabled while a create for that row is in flight (no double
  POST from plus+CTA or double-click).
- Rows stay `div role="treeitem"` with nested `<button>`s — the stock pattern;
  no restructure.

## One create-and-open path

`createAndOpen(orgId, ws)` in the region snippet, used by:
- the row "+": `createAndOpen(d.orgId, path)`;
- the top CTA (`injectProps.startSession`): `createAndOpen(sel.orgId, sel.rowId)`;
- the legacy lever `browserInjected.startSession("orgId|ws")` → parse, then
  `createAndOpen` (keeps the stock `SessionTree` contract).

Behaviour: dispatch `arxa-sidebar-notice` `{code:null}` → POST
`/__arxa/sidebar/action` `workspace.new-session` → `{ok:false,error}` →
notice with the server's verbatim error (D111: refusal is VISIBLE; codes
`main-red`, `unknown-workspace: …`, `no-org-open`, `linked-required`) →
`{ok:true,result.id}` → `openCreated(orgId, id)` (session.open + conversation
focus; the mutate-carried refresh lands the new row before focus).

Top CTA: `ctaReady` additionally requires `canCreateSession(sel.orgId,
sel.rowId)`; tooltip on a non-workspace selection: reuse
`newSession.selectFirst` (pick a workspace) — no new copy.

## Locale

Reuse `actions.newSession.aria` (en/zh present; add pl/fr rows in the org
dict if the splice's locale gate requires all three — check
`selftest.mjs` "rows-c: … all three locales").

## Build route (drift gate is byte-exact)

0. Slot check first (cordis-plugin-development rule: "UI must be registered
   in a queried Slot — query `Slots.listSubTree` before writing"). From an
   arxa session run `cordis_inspect_query Slots.listSubTree root:"sidebar.workspaces"`
   and record the result in this file. If stock dsh exposes a row-action /
   row-trailing slot for workspace rows, register the "+" there via a plugin
   row instead of splicing. Expected (from the stock bundle read today): no
   such slot — the workspace rows are the `sidebar.workspaces` registrant's
   own component tree, which arxa already replaces whole via the splice —
   so the splice route below stands.
1. Edit `scripts/gen-workspace.mjs` / `workspace-region.snippet.txt` only;
   regenerate `plugins/arxa-sidebar/lib/client.js`; never hand-edit it.
2. `OrgContainerRow`: add the plus when `d.kind === "dock" && canCreate(d.slug)`.
3. `ArxaDirRows.dirRow(sub, d)`: add the plus when `canCreate(dir ? dir+"/"+sub : sub)`
   (covers dock containers and project stage folders; depth-agnostic).
4. Selftests (`plugins/arxa-sidebar/selftest.mjs`):
   - source asserts: plus emitted in both sites, `createAndOpen` is the only
     caller of `workspace.new-session` in the client, no `.catch(() => {})`
     on that path (extend the D111 regex).
   - behaviour assert (advisor amendment): drive `createAndOpen` in a DOM
     stub — refusal renders the notice; success calls `openCreated`.
   - drift gate + stock package hashes stay green.
5. `smoke.mjs`: unchanged API path already covers dock + stage creation and
   the loud refusals.

## Verification (evidence, not claims)

- `node plugins/arxa-sidebar/selftest.mjs` and `smoke.mjs` — ALL GREEN.
- Launch profile (`env -u DSH_HOME ARXA_HOME=<tmp> node bin/arxa-studio.mjs --no-open`),
  lens capture at 1512 wide of the tree with a dock row and a stage folder
  hovered/focused showing the "+", console-clean
  (`designs/org-sidebar/evidence/new-session/`).
- Click "+" on `projects/rocket/01-intake` → session row appears, conversation
  focused; Git card shows the session seat (unblocks phase-4 card evidence).
- Note: lens is parked while the operator's Brave tab holds the
  single-instance claim; the lens also refuses "never settled" pages — settle
  ≥ 8 s or capture a hovered state via `captureStates`.

## Out of scope

- Session naming form (decided: none).
- Project-row stage picker (decided: none).
- Any change to the server's accept rule.

## Related, already fixed today

- `abedff0` — git-workspace / workspace imports resolve from the pnpm-linked
  sidebar in installed profiles (the live "Cannot find module … .pnpm/…/git-workspace"
  behind every card action and `org.create-at`).
