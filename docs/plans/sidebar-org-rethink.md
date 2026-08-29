# Sidebar rethink — Organisations replace the Workspaces section

Grill session (blessed): the sidebar's organisations experience must work
exactly like the stock Workspaces sidebar — same section, same buttons,
re-pointed at org data. Recorded here rather than in
arxa-studio-grill-decisions.md / CONTEXT.md because those files carry a
parallel session's uncommitted edits.

## Decisions

1. **Replace entirely.** The stock dsh Workspaces section
   (`dsh-client-ui-workspace`, the `sidebar.workspaces` slot content) is
   superseded: one section, titled Organisations, listing orgs. The old
   custom `OrgSection` block (org dropdown select, project list, CTA
   stack incl. Run CI) is deleted. Run CI stays reserved for phase D3 and
   is now invisible.
2. **Rows.** Org = the workspace-analogue row (name, counts, emphasis on
   the open org). Sessions are leaves grouped under project labels inside
   the expanded org; org-level sessions group under "Org" (D48/D50
   vocabulary). Clicking a project label selects that scope (consumption
   semantics per earlier Q4). Clicking the org row opens/switches to it.
3. **Buttons.**
   - "+" → **New organisation…** only — prompts a name, calls the
     existing `createOrg` (template v1: five fixed categories D42,
     AGENTS.md stubs D43, stamped org.json D41/D44; `initOrgRepo`
     attaches the git repo on first open). No folder-picker attach.
   - Row ⋯ menu → **Rename** / **Close organisation** / **New session** /
     **Trash (n)** (disabled at 0; inline list with per-entry Restore and
     Restore all). **Delete-org is deferred** — an org row is the user's
     real git repo; stock Delete's honest semantics (detach, folder kept)
     do not exist for orgs.
   - Search = honest name-match over sessions, orgs and project names
     (no content search — we hold no message index).
   - View options: Group by **Project / In one list**; Order by
     **Last updated / Name** (Manual order would need new persistence;
     traded for Name in v1).
4. **Pills.** Registry state verbatim: **Open / Parked** (tooltip =
   parkedReason). Archived sessions are not listed (D39:
   archivedSessionIds contract). Counts are derived badges ("{n}
   sessions" per org, "{n}" per project). No invented agent states —
   live dsh agent state is unreachable from the plugin by design.
5. **Shell New Session.** The stock top CTA creates a session in the
   open org at the selected project scope; disabled with an
   "Open an organisation first" tooltip when no org is open.
6. **Build route.** Copy-whole transform of the stock
   `dsh-client-ui-workspace` bundle — the gen-sidebar pattern:
   `scripts/gen-workspace.mjs` keeps the stock code whole, splices the
   org data layer over its data faces and relabels via its own locale
   dict; committed snippets; selftest byte drift gate; rc-bump policy as
   in gen-sidebar.
7. **New lifecycle verb.** `renameOrg` — display-name-only: rewrite
   `name` in org.json via the existing `renameInManifest` (D41: the
   slug/folder on disk never changes; the docs discipline caught this —
   the originally proposed folder+slug rename would have broken D41).
   The open-org handle's cached manifest refreshes in place. Everything
   else composes existing verbs.

## Verification contract

- `npm test` green: file-org-shell selftest (+renameOrg), workspace
  selftest untouched, arxa-sidebar selftest (transform drift gate + row
  scope cases), arxa-sidebar smoke (route-level rows/actions).
- arxa-lens smoke + e2e on a booted evidence server (ARXA_PORT=7894,
  isolated ARXA_HOME): console-clean captures of empty → created → open
  → sessions/trash → search/view-options states, plus an in-DOM asserted
  UI click-through (create org via UI, open via row click). Evidence
  under `designs/org-sidebar/evidence/…`.
