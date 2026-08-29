# CONTEXT — arxa studio ubiquitous language

Glossary of settled domain terms. Decisions and rationale live in
`docs/plans/arxa-studio-grill-decisions.md` (D-numbers); this file is
vocabulary only.

## Terms

- **Workspace root** — the single folder the user picks at first run
  (e.g. `~/Arxa`) that holds the whole organisations tree. Never inside
  the app checkout, never in OS app-data. (D36)
- **Organisation (org)** — one top-level unit under the workspace root;
  a company/client the user works for or with. On disk: one git repo.
  (D37)
- **Category** — one of the five fixed studio-owned folders inside an
  org: `projects/ notes/ meetings/ account/ communications/`. Users
  cannot add top-level categories; free-form folders live inside
  `projects/<name>` and `notes/`. (D42)
- **Project** — a folder under `projects/`; its own git repo, nested
  inside and ignored by the org repo. The unit of sharing. (D37)
- **Slug** — the kebab-case folder name on disk (e.g. `totem-labs`).
  Stable across renames; collisions get numeric suffixes. (D41)
- **Manifest** — the folder-local file (`org.json` / `project.json`)
  holding display name and stable id. Renames touch the manifest, not
  the slug. (Q3)
- **Context file** — an `AGENTS.md` in any folder; the folder's
  standing instructions. Discovered natively by both harnesses (dsh,
  PI) via the ancestor chain. Org root's copy is the thin layer
  (D1-capped). (D43)
- **Session** — one work context (chat/agent thread or interactive
  editing surface). Every session owns a git branch + worktree; main
  is never edited directly. Sessions never end — they are archived.
  (D38)
- **Org-level session** — a session with no project scope (registry
  `project: null`). Branch and worktree live on the org repo; it is
  visible and resumable from every project selection.
- **Project session** — a session scoped to the project selected at
  creation (registry `project: <slug>`, the slug at creation time).
  Scope resolves resume/merge before the org-level fallback.
- **Stage boundary** — the moment continuous WIP auto-commits are
  squashed into one clean commit (D18); also the default gate + merge
  moment (D38).
- **Gate** — the arxa-cicd check run on a stage-boundary commit before
  it may merge to main. Code repos run their `check.sh`; content repos
  get light checks. Green merges; red parks. (D38)
- **Parked branch** — a session branch whose work has not merged
  (gate red, user held it, or session archived unmerged). Never
  auto-deleted. (D38/D40)
- **Archive** — flagging a session out of active views
  (dsh `archivedSessionIds`). Transcripts persist; the branch parks;
  the worktree is pruned. Revival recreates the worktree from the
  parked branch. (D39/D40)
- **Template** — versioned data shipped inside the app describing the
  org tree (folders, initial files, repo boundaries). Scaffolding
  executes it and stamps the org with its version. (D44)
- **Stamp** — the format-version marker every org carries so an older
  app refuses a newer org format cleanly and migrations know their
  starting point. Written at scaffold from the template version.
  (D21/D44)
- **Migration** — explicit forward-only transform from one org format
  version to the next, run as its own commit pair in the org repo so a
  crash rewinds via git. (D21/D44)
- **Version chip** — the clickable pill in project/variant surfaces
  showing the current D20 semantic version + state (e.g.
  `v4 · Approved`); rendered by the arxa git plugin; never shows git
  SHAs or the format stamp. (D44)
- **Two-tier commits** — continuous local-only WIP auto-commits
  underneath; clean squashed stage commits on top; only stage commits
  are ever seen by history, sharing, or CI. (D18)
- **Write-through mirror** — the `account/` population model: billing
  artifacts fetched from arxa and written as plain read-only files;
  offline-usable and exportable, never authoritative, always
  re-fetchable. (D45)
- **Sync rail** — one of the two disjoint replication channels: git
  carries file content between desktops; cairn carries the DB index,
  session state, and mobile's projection. A datum travels on exactly
  one rail. (D46)
- **Materialize** — turning a mobile edit-log entry into a real file
  change in the tree, performed by exactly one desktop; the edit ID is
  recorded in tree-side facts so other replicas suppress a second
  materialization. (D46)
- **Trash** — `<workspace-root>/.arxa/trash/`, the soft-delete tier;
  items move there with an origin manifest and move back on restore.
  Excluded from indexing and export. Hard delete happens only from
  trash. (D47)
- **Seeded profile** — a config file (dsh `settings.yaml`, pi
  `models.json`) the launcher writes once on first boot and the
  operator owns thereafter; template changes never propagate to
  already-seeded homes. (D48)
- **Catalog-owned compat** — vendor wire flags (`zaiToolStream`,
  `maxTokensField`, `thinkingFormat`) belong to the installed pi-ai
  catalog, never to settings compat blocks; configured model entries
  merge over their catalog entry and inherit them. (D50)
- **TTFT (time to first token)** — elapsed from dispatching a turn to
  the first streamed token of any kind, thinking included. The studio's
  headline latency number. (D55)
- **Decode throughput** — output tokens per second after first token;
  thinking tokens count in both the numerator and the window. What the
  stats line calls tok/s. (D55)
- **Coding endpoint / Wallet endpoint** — Z.ai's two API surfaces:
  plan-quota keys work only on the coding endpoint, wallet-funded keys
  on the general one; a key on the wrong surface fails with
  insufficient balance. (D58)
- **Pending interaction** — a dsh session paused awaiting human input
  (the `ask_user_question` mechanism). Kinds: approval, plan-review,
  question. The sidebar's `pendingInteraction` union displays it; the
  approvals feature is its first engine-side producer. (D63)
- **Approval** — a pending interaction of kind approval, surfaced to the
  phone as a *derived projection* over dsh session state — never a
  first-class stored record. Deciding (approve/deny) = remotely answering
  the session's pending question; the projection is rebuildable by scan,
  so it lives in the index tier per D46. (D61, D63)
- **Doorbell** — the push notification that tells the owner a session
  needs them: engine-side caller (`notifyApprovalRequested`) → desktop
  pushd `POST /v1/send` → paired phone. Text-only, best-effort, never a
  data path. (doorbell decision 2026-08-29; D65–D66)
