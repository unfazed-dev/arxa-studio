# CONTEXT — arxa studio ubiquitous language

Glossary of settled domain terms. Decisions and rationale live in
`docs/plans/arxa-studio-grill-decisions.md` (D-numbers); this file is
vocabulary only.

## Terms

- **Recents** — two independent lists: organisation folders in
  `~/.arxa/organisation.json` and Freestyle roots in `~/.arxa/freestyle.json`.
  The organisation list replaces the retired workspace-root tree (D69).
- **Freestyle tab** — the sidebar tab beside Organisations for arbitrary
  folders, files and sessions. It works locally without GitHub or an open
  organisation, and owns its own archives and trash. (D118–D126)
- **Root** — an existing or newly created folder remembered by Freestyle.
  Several roots can be open beside the single open organisation. Its
  `.arxa/freestyle.json` identifies the repo seat; the registry ID travels
  as `rootId` in viewer, tree and watcher requests. (D118, D124)
- **Organisation (org)** — one folder the user picks at creation; the
  org root directly holds `org.json` and the five categories (no nesting
  parent). A company/client the user works for or with. On disk: one git
  repo. Creation requires a linked GitHub account (D69).
- **Category** — one of the five fixed studio-owned folders inside an
  org: `projects/ notes/ meetings/ account/ communications/`. Users
  cannot add top-level categories; free-form folders live inside
  `projects/<name>` and `notes/`. Each category is a workspace with its
  own sessions — org-repo worktrees, light gate, local-only. (D42, D70)
- **Project** — a folder under `projects/`; its own git repo, nested
  inside and ignored by the org repo. Creation publishes a private
  GitHub repo as its remote. The unit of sharing. (D37, D69)
- **Slug** — the kebab-case folder name on disk (e.g. `totem-labs`).
  Collisions get numeric suffixes. Renames move the folder and the
  remote as one git-tracked operation (D72 supersedes D41's
  slug-stability clause).
- **Viewer column** — the docked fourth AppFrame column (D88/D93):
  follows the selected session or an explicitly opened Freestyle root
  file, clamps at 320px, and its dragged width persists.
  Below 1024px viewport it presents as a full-frame sheet (D92).
- **Files section** — the org file tree rows in the sidebar (D90): lazy
  per-directory listing via the artifacts tree route; a file row opens
  the viewer column through the `arxa-av-open` bridge. Only `.git/` and
  `.arxa/` are invisible — every other dot-entry is a row (D94).
- **Produced-file chip** — a stock deliverables chip for a file the agent
  wrote (D91): clicking opens the viewer column, worktree lane first,
  org lane as fallback. Never auto-opens.
- **Manifest** — the folder-local file (`org.json`, `project.json`, or
  `.arxa/freestyle.json`) holding display name and stable id. Renames touch the manifest, not
  the slug. (Q3)
- **Context file** — an `AGENTS.md` in any folder; the folder's
  standing instructions. Discovered natively by both harnesses (dsh,
  PI) via the ancestor chain. Org root's copy is the thin layer
  (D1-capped). (D43)
- **Session** — one work context (chat/agent thread or interactive
  editing surface). Every session owns a git branch and worktree; the live
  dsh conversation runs inside it. Org sessions belong to a category or
  project; Freestyle sessions start at a root or any folder and bind to the
  nearest enclosing repo. Freestyle explorer verbs and editor saves act on
  the root working tree and auto-commit separately. (D38, D71, D122–D123)
- **Workspace** — a sidebar row that owns sessions: an org category or
  project, or a selected Freestyle root/folder. Maps onto the dsh workspace concept
  (registry record over a directory, sessions grouped by cwd).
  (D70, D71)
- **GitHub link** — the user's connected GitHub account: one-click
  browser sign-in (VSCode parity), token in the OS keychain, device
  flow only as fallback. Required before an organisation can be
  created; nothing pushes until a project exists. (D69)
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
- **Archives row** — the sidebar section above Trash listing every
  org's archived sessions grouped by org (D39's sanctioned browse
  face). Entries Restore (bare revival) or Move to Trash — never
  delete. (D117)
- **Session trash entry** — the logical trash tier for sessions
  (`kind: "session"` in `<org>/.arxa/trash`): manifest-only, no
  payload move; the registry row leaves, the branch parks until the
  trash's own purge (remote-first, open-PR-warned). Hard delete of a
  session happens only from this tier. (D117)
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
- **Artifact viewer** — the per-org surface that renders every artifact
  type (view lane) and edits the text family (edit lane). Viewing reads
  main; editing happens in a session. (D7, D78–D87)
- **Stage container** — one of the ten fixed folders inside every project,
  carrying arxa's pipeline order with 2-digit prefixes: `00-moodboard`
  through `08-deploy`, plus unnumbered `notes` (not a stage; D42
  free-form). Scaffolding and migrations both materialise the full set
  (template v3).
- **Target** — the two fixed subfolders of every stage container:
  `website/` and `application/`. A stage without its targets is a
  scaffold defect; selftests pin the pair. (Template v2/v3; named law
  2026-09-01 — docs were silent before.)
- **Sync sweep** — the push + fast-forward pass over a published org's
  every repo (org root + projects): local main commits push immediately
  (D95), remote advances fast-forward (D96), divergence parks as a
  sync-conflict note. Runs detached on open, on the throttled sidebar
  refresh, and via the `org.sync` action.
- **Selected row** — the sidebar tree row the content column is about:
  `{orgId, rowId, kind, label}` on `orgStore.selectedRowId` (D2). `rowId`
  is `""` for the org itself, a dock slug for a dock, `projects/<slug>`
  for a project. Clicking a row still expands or collapses it AND sets
  the selection; the selected row carries the accent, an inset marker
  and `aria-current`. The last selection is persisted client-side and is
  where the app lands on the next boot (D12) — a session is never
  resumed.
- **Dashboard** — what the content column shows for the selected row
  when no session is open (D1): a hero, a range/refresh toolbar, and a
  twelve-column bento of cards that always fills its grid — Sessions
  (a horizontal carousel of session cards with an expanding summary),
  Activity, Repository, Time, Delivery and Engine. Every figure is
  measured, never inferred: an absent unit reads as an em dash, because
  zero is a claim. Delivery is GitHub through the user's own
  `github-link` grant; Engine reads the arxa engine's on-disk file
  contract (D5) and says so when the engine never ran.
