# Org model v2 — implementation plan

Builds the model grilled and locked 2026-08-29 (session 2): decisions
D69–D72 in docs/plans/arxa-studio-grill-decisions.md. Supersedes the
placement halves of file-organisation-implementation.md and
sidebar-org-rethink.md (rows-world Q4); their machinery (scaffold,
stamp/migrate, index, lock, trash) carries over unchanged.

Evidence base:
- dsh structure exploration (this session): dsh workspace = registry
  record over a canonical directory, sessions grouped by cwd; arxa's
  sidebar shows git-registry rows only; the dsh↔worktree bridge was
  never built (git-workspace/lib/sessions.js:32-37 stub).
- research/github-auth-desktop-report.md — GitHub auth for desktop:
  browser+PKCE (supported since 2025-07-14) for VSCode-parity UX,
  device flow as fallback; keyring crate for macOS Keychain; least
  privilege via GitHub App installation tokens.

## Phase A — org root = picked folder (D69 placement half)

- workspace lib: scaffoldOrg targets the picked folder DIRECTLY
  (org.json + five categories inside it); root validation (D36 rules)
  applies to the org folder itself; .arxa state moves per-org
  (<org>/.arxa: index, locks, trash, worktrees — trash becomes org-local).
- Recents: ~/.arxa/organisation.json becomes { orgs: [paths] }
  (most-recent-first, capped); loadWorkspaceRoot/loadX APIs replaced by
  recents faces; sidebar serves recents for the org switcher.
- arxa-sidebar: create modal Location = org folder (browse/typed, D36
  rules); org.create scaffolds in place; discovery = recents + any
  opened folder containing org.json.
- selftests: workspace (scaffold-in-place, recents), file-org-shell
  (open by folder, per-org .arxa), sidebar smoke (create/open flows).

## Phase B — GitHub link + project publish (D69 gate half)

- plugins/github-link (host): link state (linked: bool, login, scopes),
  browser one-click sign-in via system browser + authorization code +
  PKCE; device-flow fallback when no browser; token via keyring crate
  (Rust side faces the Keychain, node reads through the shell bridge).
  Registration type per research report (GitHub App preferred; final
  client id owned by Arxa Digital Solutions).
- Gate: org.create returns linked-required unless linked; the modal
  surfaces a Sign in with GitHub step BEFORE the name/location fields.
- Project publish: on project creation, create a PRIVATE repo under the
  user's account via API, wire as origin, first push at stage boundary
  (never before — D18 WIP stays local).
- Riders: token refresh; unlink (token deleted, orgs stay local, pushes
  fail loud per D23 indicator); offline = link cached, publish queues.

## Phase C — sidebar = workspace rows (D70/D71 UI half)

- gen-workspace splice v2: rows = the five categories + projects
  (projects indented under the Projects row); New Session requires a
  selected workspace row (disabled+tooltip otherwise — stock state).
- The Folders section shipped 2026-08-29 (OrgTreeSection) dissolves:
  the rows ARE the tree now; the host tree face survives as the
  workspace enumeration source.
- Sessions per workspace: category sessions = org-repo worktrees,
  light gate, local-only; project sessions = project-repo worktrees,
  full CI/CD, push at stage boundary.

## Phase D — the dsh bridge (D71 core)

- newSession(workspace): create branch+worktree (existing), THEN spawn
  the dsh session with cwd = worktree path (sessions.create cwd
  contract); resume re-attaches; archive parks + prunes (existing D39).
- Sidebar session rows become LIVE dsh sessions (titles, running state,
  pendingInteraction pills D63) — the registry stays the durable
  worktree/branch record, dsh stays the conversation record.
- archivedSessionIds contract: arxa D39 archive drives dsh's archive set.

## Phase E — proper rename (D72)

- renameOrg/renameProject: display name + folder move as one
  git-tracked operation (mv + commit pair, D44-style), registry rekey,
  recents update; project rename also renames the GitHub repo via API
  (old URLs redirect); worktrees revive from parked branches.

## Phase F — verification + ship

- Full selftest sweep + new suites (github-link, bridge).
- arxa-lens evidence ladder on a booted evidence server: first-run →
  link → create org (in-place) → category session → project + publish
  → rename. Console-clean, viewport ladder, in-DOM click-throughs.
- pack-sidecar + tauri build + install, live-verify on the real app.

## Order

A → B → C → D (C/D parallelizable after A) → E → F. Each phase lands
green with its selftests; no phase depends on unbuilt later phases.
