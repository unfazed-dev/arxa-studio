# Git capability audit — phases 3–4 of file-organisation-implementation

**Date:** 2026-08-29. Read-only audit answering: what git capability already
exists in this stack, and does anything support nested repos (D37) and
worktree-per-session (D38)?

## Headline finding

**The "existing arxa git plugin" does not exist.**
`docs/plans/file-organisation-implementation.md:60` ("Uses the existing arxa
git plugin") and the D44 version chip note
(`docs/plans/arxa-studio-grill-decisions.md:439`, "pill chip rendered by the
arxa git plugin") reference a plugin that is not present in this repo, the
sibling `arxa` repo, or any dsh package. Phase 3's stated risk ("plugin
support for nested-repo operations") is moot in the way the plan didn't
expect: there is no plugin to have or lack that support. It must be built
from scratch — the plan's "phase 3a heavy-rework" contingency is the real
path.

## What exists

### arxa-studio's own code — zero git usage

- `plugins/` = brand, design-panel, gen-ui, mcp-apps, memory, pairing,
  pi-delegate, theme-accent, waiting-page. None touch git.
- `bin/` = arxa-studio.mjs, arxa-explore.mjs, isolation-check.mjs,
  loopback-localhost-patch.mjs; `pi/arxa-memory.ts`; `scripts/pack-sidecar.mjs`.
  The only "git" hit is a comment (`bin/arxa-studio.mjs:253` — payload
  provenance note; it also warns **end-user machines have no pnpm**, a
  distribution constraint that applies equally to assuming a system `git`).
- `bin/arxa-explore.mjs`'s `getBranch`/`branches` is the **conversation-tree**
  branch model (session forking UI), not git. Don't conflate the two when
  naming APIs.
- `organisations/organisation-a` and `-b` are template trees
  (`account/ communications/ meetings/ notes/ projects/`) with **no `.git`**
  — nothing is a repo yet, so phase 3 starts from a blank slate (good:
  no migration of existing history).

### dsh (`@deepseek-ai/*`, 0.1.1-rc.2) — no git, but the right seams

Searched every package under `node_modules/@deepseek-ai/`: **no git binary
invocation, no worktree/branch/commit API anywhere**. dsh's "workspace" and
"session" are not VCS concepts:

- `dsh-workspace` (`lib/types/index.d.ts`) — `WorkspaceRegistry`
  (`ctx.workspaceRegistry`): durable cwd-keyed workspace records with
  `archiveSession(sessionId): Promise<void>` and
  `get archivedSessionIds(): readonly SessionId[]`. **This is the exact
  wiring point phase 4 names** ("dsh `archivedSessionIds` wired"): archive is
  dsh-native and durable; the git plugin must *subscribe* to archive/revive
  to prune/recreate worktrees (D39/D40). Also throws
  `WorkspaceUnknownSessionError` — revival paths must handle it.
- `dsh-client-ui-workspace` (`lib/client.js:187–223`) — `deriveGroups` /
  `deriveFlat` render the archived set in the session list UI. UI honors
  archives for free once the registry is updated.
- `dsh-session`, `dsh-session-persistence-jsonl`,
  `dsh-session-checkpoint-policy` — event-sourced session durability
  (checkpoints before model/tool side effects). This is dsh's crash-safety
  layer; it does **not** replace D18's WIP auto-commit layer (which protects
  the *user's file tree*, not the session log), but it means the git plugin
  need not checkpoint conversation state.
- `dsh-skill-filesystem` — passive git awareness only: "project root is the
  nearest ancestor containing `.git`". Under D37 nesting this resolves a
  session cwd inside `projects/<name>` to the **inner** repo — which is the
  desired scoping, but worth a test once nesting lands.
- `dsh-file-reference-local` / `dsh-tool-fs-search` — merely exclude/respect
  `.git` dirs. Incidental.

### Sibling `arxa` repo — also nothing

No plugin dir, no worktree/auto-commit code in `harness/`, `kit/`,
`desktop/`; no "git plugin" mention in its docs. Only `.gitignore` files.

## What's missing (all of it) for D17/D18/D37/D38

| Decision | Needed | Exists? |
|---|---|---|
| D17 tree sharing (org = git repo, auto-commit/pull, conflict UI, raw git for CLI) | full plugin | No |
| D18 two-tier commits (local-only WIP layer, stage-boundary squash, CI sees stage commits only) | commit engine | No |
| D37 nested repos (org repo ignores `projects/<name>` inner repos; `account/` excluded entirely) | scaffold-time repo init + ignore management | No (`organisations/*` aren't even repos) |
| D38 session = branch + worktree, main advances only by gated merge (arxa-cicd `check.sh` / light content checks) | session↔git lifecycle | No |
| D39/D40 archive prunes worktree, parked branches never auto-deleted, revival recreates | hooks on `WorkspaceRegistry` archive/revive | Seam exists (`archivedSessionIds`), consumer doesn't |
| D44 (surface half) version chip, no SHAs in UX | data source from stage commits | No |

## Recommendation

**Build a new `plugins/git-workspace/` cordis plugin.** There is nothing to
extend — "extend existing plugin" is not an option. Shape it like the
existing plugins (own `package.json` + `lib/`, registered/configured through
`profile/cordis.patch.yml`, which already documents the patch-row
conventions).

- **Engine:** shell out to system `git` (worktrees, squash, ignores all need
  real git). Distribution caveat: end-user machines are assumed minimal
  (`bin/arxa-studio.mjs:253`); add a startup probe for `git` with a clear
  degrade path. `isomorphic-git` is not a fallback for worktrees — if git is
  absent, the tree rail must run without the git rail, not emulate it.
- **Layering:** three sub-modules matching the phases —
  (1) *repos*: org init at scaffold, nested project init, ignore rules
  (small); (2) *two-tier commits*: WIP auto-commit loop + stage-boundary
  squash + version-chip data (medium; squash-with-never-pushed-WIP-layer is
  the fiddly part); (3) *session lifecycle*: branch+worktree per session,
  gated merge, parked branches, archive/revive hooks into
  `ctx.workspaceRegistry` (largest; highest blast radius, mutates user
  repos — matches phase 4's warning).
- **Scope guard:** worktrees desktop-only in v1 (mobile online-only per M8)
  — confirmed nothing in the mobile path needs one today, since nothing in
  the stack uses git at all.

**Effort:** this is the largest single plugin in the repo — roughly 2–3×
`plugins/memory`-class work; expect the plan's phase 3a to absorb the repo +
commit engine, with phase 4 unchanged in sequence but starting from zero
rather than from an existing plugin.
