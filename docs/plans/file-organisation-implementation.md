# File-organisation implementation plan

Build sequence for the workspace file-organisation design settled in
the grill (`arxa-studio-grill-decisions.md`, D36–D47; vocabulary in
`CONTEXT.md`). Ordered by the dependency spine — everything hangs off
the on-disk tree format and the tree-as-SSOT invariant — not by
decision number. Each phase is a vertical slice with a runnable exit
check and lists the decisions it discharges. Phases 1–5 have **zero
company-DB dependency by construction** (CLAUDE.md ownership
boundary); phase 6 is disjoint by design (D46).

If any phase exceeds ~a week of work, split it before starting.

---

## Phase 1 — Tree format: layout, slugs, manifests

The raw on-disk format. No DB, no git, no sync.

**Build**
- Workspace-root picker + persistence (never in app checkout or OS
  app-data).
- Org/category scaffolder: fixed five categories
  (`projects/ notes/ meetings/ account/ communications/`); free-form
  folders only inside `projects/<name>` and `notes/`.
- Slug generation (kebab-case, numeric-suffix collisions) +
  `org.json` / `project.json` manifests (display name, stable id).
  Rename = manifest edit; slug never moves.
- `AGENTS.md` context-file placement (org root thin layer, D1-capped).

**Exit check** — CLI/dev command scaffolds a workspace with one org +
one project; rename an org twice; slugs unchanged, manifest updated;
re-open app resolves everything by id.

**Discharges**: D36, D37 (layout half), D41, D42, D43.

## Phase 2 — DB index as pure derived cache

The SSOT invariant becomes enforceable before anything depends on the
index.

**Build**
- Full-scan indexer: tree → SQLite (search + metadata). Watcher for
  incremental re-index; external file edits are legal by definition.
- D20 facts as append-only files under dot-dirs; DB rows derived.
- **Rebuild gate test**: delete DB → full rescan → query-equivalent
  index. This test is permanent CI, not a one-off.
- Storage-backend seam (local SQLite now; D32 BYO later slots in
  behind the same interface — pluggable per ownership boundary).

**Exit check** — the rebuild gate test passes; deleting the DB from a
populated workspace loses nothing.

**Discharges**: D46 (SSOT + index half).

## Phase 3 — Git rail: repos + two-tier commits

**Build**
- Org repo init at scaffold; nested project repos ignored by the org
  repo (D37). Uses the existing arxa git plugin.
- Two-tier commits: continuous WIP auto-commits; squash at stage
  boundary (D18); history/sharing/CI see stage commits only.
- Version chip data source (D20 semantic version + state), no SHAs
  in UX (D44 surface half).

**Exit check** — edit files in a project; WIP commits accumulate;
stage-boundary squash produces one clean commit; org repo log shows
nothing from inside the project.

**Discharges**: D37 (repo half), D18 wiring, D17 transport unchanged.

**Risk to verify first**: plugin support for nested-repo operations.
If heavy rework is needed, that rework becomes phase 3a.

## Phase 4 — Sessions: branch-per-session worktrees

Highest blast radius (mutates user repos) — lands only on a stable,
tested format.

**Build**
- Session open = branch + worktree; main never edited directly (D38).
- Stage boundary = default gate + merge moment; arxa-cicd `check.sh`
  for code repos, light checks for content (D38).
- Parked branches (red gate / held / archived-unmerged) never
  auto-deleted (D40); archive prunes worktree, revival recreates it
  from the parked branch (D39/D40), dsh `archivedSessionIds` wired.

**Exit check** — open session, edit, hit stage boundary: green merges
to main; force a red gate: branch parks; archive + revive a session
and continue from parked state.

**Discharges**: D38, D39, D40.

**Risk to verify first**: git plugin worktree support on all shipped
targets (mobile is online-only in v1 per M8, so worktrees are
desktop-only initially — confirm the mobile path never needs one).

## Phase 5 — Template, stamp, migrations

**Build**
- Versioned in-app template describing org tree; scaffolder executes
  it and stamps the org (D44).
- Stamp check on open: older app + newer org = clean refusal (D21).
- Migration runner: forward-only, one commit pair per migration in
  the org repo so a crash rewinds via git (D21/D44). Day one ships
  stamp-only unless a pre-existing workspace population exists.

**Exit check** — scaffold at template v1; bump template to v2 with a
migration; open old org → migrated with commit pair; open v2 org in
a v1-templated build → clean refusal.

**Discharges**: D21, D44.

## Phase 6 — Trash, `account/` mirror, cairn rail

Disjoint from phases 1–5 by design; last.

**Build**
- **Trash (D47)**: soft-delete = move to
  `<workspace-root>/.arxa/trash/<timestamp>-<slug>/` + origin
  manifest; restore = move back; in-repo deletes also D18-committed;
  hard delete only from trash with D23-grade confirm; trash excluded
  from indexing and export; auto-expiry off by default. Cross-repo
  moves get the "history won't follow" confirm (D41 boundary).
- **`account/` mirror (D45)**: fetch billing artifacts → plain
  read-only files; empty-but-valid without an arxa account; excluded
  from git (D37).
- **Cairn rail (D46)**: DB rail only — index/session state, mobile
  projection, D32 BYO wire contract. Disjointness rule enforced:
  nothing derivable from the tree ever syncs. Mobile writes =
  append-only edit log with stable edit IDs; single-desktop
  materializer records edit IDs in tree-side facts; materializer
  failure is loud. v1: online-only outbox, no CRDT merge in the
  authoritative path.

**Exit check** — delete a nested project repo → restore from trash
with full history intact; hard delete requires trash + confirm;
mobile edit materializes exactly once with two desktops attached;
rebuild gate test still green with cairn active.

**Discharges**: D45, D47, D46 (rail half), D32 contract.

**Open input**: cairn maturity (spec vs working code) decides whether
this is integration or greenfield — resolve before estimating.

---

## Traceability

| Decision | Phase | | Decision | Phase |
|---|---|---|---|---|
| D36 | 1 | | D41 | 1 |
| D37 | 1, 3 | | D42 | 1 |
| D38 | 4 | | D43 | 1 |
| D39 | 4 | | D44 | 3, 5 |
| D40 | 4 | | D45 | 6 |
| D21 | 5 | | D46 | 2, 6 |
| D18 | 3 | | D47 | 6 |
