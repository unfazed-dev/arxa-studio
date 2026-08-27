# File-organisation grill — resumption agenda

> **Handoff:** grill paused after D36 (user-chosen root). Awaiting the
> user's answer to Q2 below; nothing built, no decisions pre-taken.
> Resume by asking Q2, one question at a time.

Prepared while the grill is paused (after D36, before Q2). Nothing here is
decided; each question carries my recommendation so the resumed session can
move one answer at a time. Settled context: D1/D2 (folder context lock +
ancestor chain), D13 (SQLite default, pluggable), D17 (git under the hood),
D18 (two-tier commits), D19 (undo/redo), D20 (versions+variants), D28
(per-org secrets), D32 (BYO wire contract), D36 (user-chosen root; repo
skeleton = template/spec).

## Q2 — Git repo boundaries in the tree (pending, asked)

Where do git repos sit: org root, per project, or both?

- **Recommended: org repo + nested per-project repos.** Org root is one git
  repo (notes, meetings, communications, org context); each
  `projects/<name>` is its own repo, ignored by the org repo; `account/`
  excluded from version control entirely (billing mirrors + D28 secrets
  never enter git). Projects clone/share cleanly on their own (D17); org
  history stays private; D18/D19 commit machinery still covers org-level
  content.
- Alternatives: one repo per org (sharing a project drags org history);
  project-repos-only (org-level content loses D18/D19 undo coverage).

## Q3 — Naming: slugs vs display names

Folder names are load-bearing on disk and in git remotes.

- **Recommended:** kebab-case slug on disk, display name + stable id in a
  folder-local manifest (e.g. `org.json` / `project.json`). Renames touch
  the manifest, not the path, so git history and context references
  survive. Slug collisions resolved with numeric suffix.

## Q4 — Org-level categories: fixed vs extensible

Skeleton has `projects/ notes/ meetings/ account/ communications/`.

- **Recommended:** the five are a fixed, studio-owned vocabulary (features
  hang off them: scheduler, billing mirrors, comms ingestion); users get
  free-form folders *inside* `projects/<name>` and `notes/`, not new
  top-level categories. Extensibility at the top level breaks the D2
  ancestor-chain semantics that features rely on.

## Q5 — Context file placement and format (D1/D2)

Thin org root layer (<~30 lines) + folder-local context.

- **Recommended:** `context.md` at org root (thin layer, hard-capped) and
  optional `context.md` in any folder; threads/chat stored beside it under
  a dot-dir (e.g. `.arxa/threads/`) so context and conversations travel
  with the folder in git (D17) while staying out of the user's way.
  Precise cap enforcement (lines vs tokens) is a user call.

## Q6 — `account/` population

Receipts, invoices, subscriptions, profile — from the D12 MoR + D15
billing system.

- **Recommended:** write-through local mirror: studio fetches billing
  artifacts and writes them as plain files (PDF/JSON) so the tree is
  useful offline and exportable (D23); never authoritative, always
  re-fetchable; excluded from git (Q2) and from tree sharing.

## Q7 — FS ↔ backend mapping (D13/D32)

What is SSOT: the file tree or the database?

- **Recommended:** the file tree is SSOT for content; SQLite (or BYO
  backend via the D32 wire contract) is an index/cache (search, metadata,
  sync state), always rebuildable by a full scan. Equivalent-capability
  local fallback is mandatory per the ownership boundary in CLAUDE.md.

## Q8 — Template mechanics (D36 follow-through)

The repo skeleton becomes a scaffolding template.

- **Recommended:** ship the template as a versioned manifest inside the
  app (not loose empty dirs — git can't even track those); stamp the
  scaffolded org with the template version (rhymes with D21 stamped org
  format) so later template evolution can offer additive migrations.

## Q9 — Deletion, trash, and rename safety

- **Recommended:** soft-delete to a workspace-level `.arxa/trash/` with
  restore, backed by the D18/D19 commit machinery where the folder is
  git-covered; hard delete only from trash, loudly (D23 nagging applies).

## Order of resolution

Q2 → Q3 → Q4 → Q5 (these shape the tree) → Q8 (template encodes them) →
Q6, Q7, Q9 (features on top). After all answered: write the
implementation plan doc and only then build.
