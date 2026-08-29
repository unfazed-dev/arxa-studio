# Project sessions — the physical design (deferred, decision Q3)

Status: **deferred by decision** (grill Q3, file-org handoff session). What
shipped is annotation-only: sessions live on the org repo and carry a
`project` slug in the registry (CONTEXT.md: project session). This note
records the design for the PHYSICAL step so the deferral is actionable, not
just forgotten.

## What changes

- `newSession(name, project)` on a selected project calls
  `openSession(projectPath, …)` — branch + worktree attach to the **project
  repo**, so project history actually receives session commits (the project
  is the unit of sharing, D37).
- The registry stays repo-local (D38, "repo-local state, travels nowhere"):
  one `sessions.json` per repo. `project` becomes DERIVABLE from the
  registry's location, but is kept as the stored annotation for stable
  display across aggregation.
- `parkedSessions()` aggregates org + all project registries, tagging origin.
- The resolution ladder moves into the storage layer: exact id → sole
  project match (discovered by scanning project registries first) → sole
  org-level parked → ambiguous.

## What it touches

- git-workspace: no schema change, but every face gains a repo-discovery
  preamble (resume/merge/archive/revive/stage-boundary must find WHICH
  registry holds the id).
- file-org-shell lifecycle: the session faces re-scan `projects()` per call;
  the open-org handle holds the org path plus the scanned project paths.
- Stage boundary + gate: already run inside the session worktree, so they
  follow the worktree's repo — verify, don't rewrite (D18/D38).

## Open questions for its own grill round

1. Migration: existing org-repo session worktrees park where they are; do we
   move open ones (worktree re-attach) or freeze them as org-level legacy?
2. Cross-repo merge semantics: merging a project session merges into the
   PROJECT's main — the sidebar's merge CTA then reports per-repo results.
3. Trash/restore interplay: a trashed project with live session registries
   in its git dir — park, follow, or refuse?

## Why deferred

The annotation change unblocked scoping, CTA resolution and display with a
small, tested diff (c5c2720). Physical reattachment rewrites where work
happens and moves the ambiguity ladder into storage — a distinct decision
deserving its own grill round, not a rider on this session.
