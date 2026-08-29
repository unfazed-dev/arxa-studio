# arxa-studio grill — running decision log

Grilling session, one question at a time. Decisions recorded as settled;
open questions tracked at the bottom.

## Settled

- **D1 — Org/folder context lock.** Chat composer, threads, and context are
  self-contained per folder inside an org. Hierarchical thin-root model:
  each org carries a thin global context layer (<~30 lines), everything
  else lives folder-local. No allowlist escape hatch — lock is strict (A).
- **D2 — Ancestor context chain.** Option C: folder inherits down the
  ancestor chain within the org only; no cross-org reads ever.
- **D3 — CI/CD.** Enforced from the very beginning of a project's life,
  not bolted on. Semi-automated with a manual UI trigger (CTA) built as a
  dsh plugin. Risk-split hybrid (C): deterministic checks automated,
  judgment steps behind the manual trigger.
- **D4 — Distribution + payments.** arxa studio and arxa (incl.
  /read-the-damn-docs) are public products. Payment gates and distribution
  are first-class requirements, not afterthoughts.
- **D5 — Harness build.** arxa-studio is built on dsh + PI together (dsh
  under the hood via creator mode; PI already present in the arxa repo as
  the second harness). arxa remains its own standalone product.
- **D6 — arxa memory: keep and finish.** The per-project fact store
  (`arxa memory add|recall|why`, `<project>/memory/facts/<topic>.json`)
  stays. Required fixes:
  - Wire the missing write path: pipeline stages (`gate_intake`,
    `design_draft`, `decision_log`, and peers in `arxa/lib/`) must emit
    facts automatically — today the store is hand-curated only and
    arxa-studio's store is empty.
  - Add consolidation/expiry so stale facts stop being injected forever
    (plan doc already sketches this: deterministic writers append raw
    events; a cheap-tier consolidation stage promotes durable lessons,
    gated like any artifact).
  - Injection adapters stay read-only as-is: `plugins/memory/index.mjs`
    (dsh, system-prompt section at mount, 4096-byte cap) and
    `pi/arxa-memory.ts` (Pi, `before_agent_start`).

- **D7 — Artifact multi-viewer: C with origin separation.** Types: code,
  files, pdf, video, images, audio, text, md, mdx, html. Architecture
  (Google usercontent / Dropbox preview pattern):
  1. One shared renderer codebase.
  2. Per-org serving root: file server rooted at the org folder, spawned
     on org mount, killed on org switch — cannot express an outside path.
  3. Separate origin per org for rendered content (per-org localhost port
     or `org-<id>.localhost`) so rendered HTML/SVG never reaches studio
     cookies or another org's viewer.
  4. Type split: code/text/md/images → direct render; html/mdx →
     sandboxed iframe on the org origin; pdf/video/audio/office →
     convert or stream from the org-rooted server, never inline.
  5. Short-lived per-file tokens on viewer URLs.
  Option B (shared viewer, path checks in code) rejected — VS Code
  webview escapes (Trail of Bits) show path-guard-in-code fails. Option A
  (process per org for the whole viewer) rejected as heavier than the
  industry wall.

- **D8 — Product split: arxa studio vs arxa agency.**
  - **arxa studio (base):** orgs + projects only. No Supabase, no
    external DB dependency — file-only, works standalone for any user.
    No account/communications/business folders.
  - **arxa agency (paid tier):** payment-gated upgrade that adds the
    business layer to the studio — communications, account/client
    folders, client management. This is where Supabase lives (the
    operator's client DB), not in studio. Evan's own use of Supabase is
    an *agency* concern, not a studio feature.
  - **Launcher:** arxa studio opens with a chooser view/page: Studio or
    Agency.
  - **Agency-business instance:** a second studio-like instance for
    running the agency itself as a business — HR, Accounting, Vendors,
    Finance, Investments, Marketing, etc.
  - Prior Supabase SSOT question is re-scoped: it applies to the agency
    tier only; studio never touches it.

- **D9 — Packaging (refines D8): one app, two versions.**
  - Versions: **arxa studio** (free/base) and **arxa studio agency**
    (name locked — not "pro"; word overused). Agency is NOT a plugin
    pack; it is a second instance of arxa studio with the agency layer,
    both living in the one studio app.
  - Pay gate sits on the agency version.
  - **Intro chooser:** a view/page at app start to choose which to open
    and serve — Studio or Agency. The chooser lives in arxa studio's dsh
    itself (dsh-served view, not an external launcher).

- **D10 — Agency data model: C, split by role, entitlement-gated at the
  mount point.**
  - Client orgs/projects are one tree, shared by both versions: Studio
    sees them plain; Agency mounts the client-facing folder kinds
    (communications, account) inside those same orgs.
  - The agency-business side (HR, Accounting, Vendors, Finance,
    Investments, Marketing) is a dedicated root that Studio mode never
    mounts.
  - **Pay gate = entitlement check at the mount point** in dsh: one
    enforcement point decides which folder kinds mount and whether the
    business root exists. Entitlements are billing-driven and separate
    from feature flags; no UI-hiding, no scattered `if(paid)` checks.
  - Downgrade is non-destructive: on lapse, agency folder kinds stop
    mounting; files remain on disk.
  - Research basis: agency two-tree convention (per-client spaces +
    internal business workspace), AWS silo-vs-pool tenant isolation,
    entitlement-vs-flag separation (Schematic/Monetizely).

- **D11 — Supabase SSOT split (agency tier): C, split by kind.**
  - Folder-owned: documents, artifacts, context (briefs, designs,
    context.md, deliverables) — human-authored, versioned, portable.
  - DB-owned (Supabase): transactional/event facts — payments, invoices,
    auth, comm threads. These need ACID + append-only audit trails that
    filesystems cannot provide.
  - Hard rule: **no fact lives in both places.** Every new data type must
    declare its kind up front. The dual-write problem is the #1 documented
    failure mode.
  - Comm threads are DB-owned (event-generated) but scoped by folder key,
    so the D1 folder-lock still governs where they surface.
  - Cost accepted: a real reconcile/sync layer between DB and tree is
    infrastructure to build and maintain, not just a convention.
  - Research basis: git-based vs API-driven CMS consensus (who-writes-it
    dividing line), ACID/audit-trail requirements for money, GitOps
    derived-index pattern + dual-write warnings.

- **D12 — Payment gate provider: B, merchant of record.**
  - Paddle or Lemon Squeezy handles checkout, global sales tax/VAT, and
    issues license keys; ~5% fees accepted as the cost of not being the
    merchant.
  - dsh validates the license key inside the same mount-point enforcer
    from D10; offline-tolerant cached check (grace window).
  - Enforcement goal is honest-user + server-side issuance, not DRM — the
    check runs on customer hardware and is inherently crackable.

- **D13 — Public customers' DB: C, SQLite by default with pluggable
  remote.**
  - Agency ships local-first: DB-owned facts (D11) live in an embedded
    SQLite file per install; zero setup, offline, no Supabase required.
  - The data layer is written against an adapter abstraction from day
    one; teams can point the same schema at Supabase/Postgres later.
  - Evan's own Supabase-backed instance is just the first remote-adapter
    config, not a special case.
  - Cost accepted: every DB-owned feature is tested against both backends.

- **D14 — Form factor: C, one core, two artifacts.**
  - CLI channel: npm/script install, dsh-served local web UI — the dev
    channel.
  - Desktop channel: signed/notarized shell (Electron/Tauri) wrapping the
    same dsh server + studio UI, auto-update, license-key prompt (D12) —
    the paid retail channel.
  - Cost accepted: two release pipelines maintained forever.

- **D15 — One billing system for the whole family.**
  - Corrected premise: arxa already has a designed freemium gate at the
    scaffold kit picker (`designs/arxa-studio/evidence/plans-paywall/`,
    `plans_viewmodel.js` with `attemptCheckout`/`applyUpgrade`, arxa.dev
    sign-in; prior decisions in
    `docs/plans/scaffold-shell-kit-picker-decisions.md`).
  - The D12 merchant of record (Paddle/Lemon Squeezy) is the single money
    pipe for everything: one-time kit/tier purchases in arxa AND the
    Agency subscription. arxa.dev issues/holds entitlements only — it
    never touches money.
  - The existing plans-paywall flow gets retrofitted onto MoR checkout.
  - Pricing shape: Studio free; Agency subscription; arxa freemium with
    one-time premium kit purchases (matches boilerplate-market norms:
    base kits free, premium one-time $199–$599 range).
  - Free tier must still produce a complete usable scaffold — never a
    crippled one.

- **D16 — Accounts: C, anonymous free with optional early link.**
  - Free Studio and free arxa kits run fully anonymous and local.
  - A visible sign-in affordance exists for users who want roaming
    entitlements before buying.
  - Purchase always creates/requires the arxa.dev account — MoR license
    keys need an owner for re-issue and multi-device use.
  - Matches the already-designed `plans-signedout` state.

- **D17 — Tree sharing: C, git under the hood.**
  - Every org is a git repo; the app auto-commits/pulls and surfaces
    conflicts in UI; power users can use raw git directly.
  - CLI channel gets raw git for free.
  - Works in tandem with the CI/CD stage: pushes to the org remote are
    the trigger surface for the hybrid pipeline (local checks + external
    CI + manual CTA, per the earlier ci/cd lock).

- **D18 — Commit policy: C, two-tier.**
  - Continuous WIP auto-commits on a local-only layer (never pushed) —
    crash-safety and the substrate for undo.
  - Squashed into clean stage-boundary commits on push; CI sees only
    stage commits, triggers map to pipeline stages.
  - Requirement rider: undo/redo across the whole arxa lineup.

- **D19 — Undo/redo: C, two-level.**
  - Per-surface Cmd+Z for live editing (session-local).
  - Checkpoint restore for everything bigger: WIP commits = per-save
    file restore points ("rewind to before the agent ran"); DB undo =
    compensating event at the same checkpoint (facts stay append-only).
  - Non-invertible operations (deploys, payments) explicitly excluded
    and labeled as such in UI.

- **D20 — Deliverable versioning: C, versions + variants (with riders).**
  - Linear named version timeline per deliverable is the spine; versions
    auto-mint at stage transitions and client approvals.
  - Variants = Figma-minimal parallel explorations (git branches under
    the hood): explore → promote into mainline or archive; never nested.
  - Approval = locked version + audit trail (who/what/when); superseded
    versions archived, never deleted.
  - arxa owns the semantic layer (versions/variants/approvals/audit);
    git is the invisible substrate; remote hosting delegated to the
    user's git remote (per D17).
  - Heavy media (video/PDF/images) goes through LFS or content-addressed
    storage, not plain git.
  - Research: Figma branching model, Zeplin, Filestage, nesbitt.io
    (git-as-database), agency approval-workflow practice.

- **D21 — Updates: C, channels + stamped org format.**
  - Stable/beta channels; staged rollout on stable.
  - Every org folder carries a format version stamp; older app refuses
    newer org format cleanly.
  - Migrations are explicit, forward-only, and checkpointed via
    D18/D19 machinery — failed migration = rewind, not corruption.

- **D22 — Inference supply: C, hybrid.**
  - Default lane: BYO API keys / local models — free, anonymous,
    private; consistent with D16 local-first.
  - Optional managed credits on the paid account (D15/D16 rails) for
    zero-setup users; clearly labeled as transiting arxa's gateway.
  - Accepted cost: operating a metered gateway with abuse controls.

- **D23 — Backups: C, local export + loud nagging.**
  - One-click portable org export (files + DB snapshot, format-stamped
    per D21) to any user-chosen destination; restore = import.
  - Persistent unmissable "no remote / no recent backup" indicator.
  - Remote setup remains the recommended path; arxa stays out of the
    storage business.
  - Export format doubles as the org portability/offboarding story
    (anti-lock-in selling point).

- **D24 — Telemetry: C, tiered consent.**
  - Opt-in prompt at first run: crash reports + migration
    success/failure only; anonymous; never file contents or client
    data; payload inspectable before send.
  - Beta channel requires telemetry (fair exchange, gives D21 rollout
    signal); stable stays opt-in.
  - Managed-gateway lane (D22) carries service-side operational
    metrics as part of that labeled service.

- **D25 — Seats/team licensing.** Per-seat on the agency tier, keyed
  to arxa.dev accounts (D16), small device-count grace per seat;
  studio free tier uncounted.
- **D26 — Trial + refunds.** 14-day full agency trial via the
  existing entitlement flags (D10/D15); refunds delegated to the
  MoR's standard policy (D12).
- **D27 — Source license.** Source-available (FSL/BUSL-style) for
  studio core, proprietary for agency modules; packs/deliverables a
  user produces for their clients are the user's IP.
- **D28 — Client secrets.** OS-keychain-backed store scoped per org
  (D1); never in the git tree (D17/D18); excluded from
  exports/backups (D23).
- **D29 — Support channel.** Public docs + issue tracker for free
  tier; email support as an agency-tier entitlement (D10).

- **D30 — Desktop app tech: C, Tauri shell over the dsh engine.**
  - System webview, few-MB binary; the dsh + PI engine
    (`bin/arxa-studio.mjs`) runs as sidecar and stays the single
    core — CLI and desktop are the same engine (D14).
  - Studio UI stays the existing web UI (`arxa.studio.localhost:7891`);
    no Flutter rewrite. Flutter remains arxa's stack (client-facing
    product with native-SDK kits); arxa and studio share protocol
    (D17 trees, entitlement JWTs), not UI.
  - First milestone: single installer — `arxa-studio` CLI on PATH +
    shell app in /Applications, both hitting the same engine.
  - Confirmed against 2026 web findings (Tauri = named best practice
    for wrapping a local-server web UI; Flutter explicitly wrong tool
    for wrapping): the compiled `arxa` Dart CLI ships as a second
    bundled sidecar — shell reads entitlement status via its JSON
    output, no Rust reimplementation of entitlement logic.
  - Tauri's built-in delta updater (1–5 MB) is the delivery mechanism
    for the D21 stable/beta channels.
- **D31 — Tier naming reconciliation.** Live schema
  (`arxa/deploy/supabase/schema.sql`) checked `tier in
  ('pro','scale')`; the grill (D8/D9) names the studio paid tier
  "agency". Resolution: one billing family (D15) with a unified tier
  vocabulary — `'pro'`/`'scale'` stay arxa's tiers, `'agency'` added
  for arxa studio. Migration extends the check constraint; power-user
  seed uses `'agency'`.

- **D32 — BYO workspace adapters: B, wire contract, zero foreign
  code.**
  - The `WorkspaceProvider` contract is a fixed HTTP/JSONL wire
    protocol the BYO *backend* implements server-side; arxa ships only
    two first-party adapters — Supabase (default) and generic-REST
    (the contract itself).
  - No third-party code ever executes inside the app; no plugin
    signing/review pipeline exists or is promised. Exotic backends
    integrate by writing a server-side shim and passing
    `arxa studio provider verify`.
  - Settles "adapter signing" + "contract packaging" from
    agency-backend-provider-abstraction.md (both moot under B).

- **D33 — Support on BYO backends: A, diagnostics bundle, never
  access.**
  - Staff never hold credentials/tokens to customer-run
    infrastructure; no support-token capability enters the wire
    contract.
  - `arxa studio diagnose` emits a redacted, user-inspectable bundle
    (versions, config shape, provider-verify results, error logs — no
    client data) attached to tickets; mirrors D24's
    inspectable-payload rule and D28's secrets posture.
  - Settles "staff support access on BYO" from
    agency-backend-provider-abstraction.md.

- **D34 — BYO identity methods: C, token-opaque contract.**
  - The wire contract specifies only the session-token lifecycle —
    issue, refresh, revoke, introspect; how the user authenticates to
    obtain the token is entirely the provider's business
    (email+password, OIDC/SSO, device code, …).
  - Supabase email+password stays the reference flow and the default
    UX (`arxa login`); `provider verify` tests token behavior, never
    login UX.
  - Studio login UI gains one indirection: a provider may declare its
    own sign-in flow instead of the email form.
  - Settles "minimum identity methods" from
    agency-backend-provider-abstraction.md.

- **NOTE — Future hosted workspace offering (planned, not scheduled).**
  - Arxa Digital Solutions will offer arxa studio agency customers a
    fully hosted workspace backend — self-hosted Supabase operated by
    Arxa Digital Solutions on AWS/VPS — for a subscription fee.
  - Architecturally free under D32/D34: the hosted product is just
    Arxa Digital Solutions running a conforming `WorkspaceProvider`
    (the Supabase reference adapter pointed at managed infra); no new
    contract surface.
  - Rails already in place: subscription billing via the D15 billing
    family + D31 tier vocabulary (new tier when scheduled);
    workspace-data plane stays separate from the license plane per
    the abstraction plan's §0 split.
  - When scheduled, revisit: D33 support posture (arxa-hosted infra
    IS ours to access — diagnostics-bundle rule relaxes for this lane
    only), data residency/backup SLAs (D23), and telemetry labeling
    (D24 managed-lane precedent).

- **D35 — Realtime fallback on BYO: B, adaptive polling.**
  - When a provider lacks the optional realtime capability, studio
    degrades to adaptive polling: 3s focused-and-active (thread/
    composer open), 30s focused-idle, 120s background, immediate
    poll after any local write.
  - Settles "polling default" from
    agency-backend-provider-abstraction.md — parked queue now empty.

- **D36 — Organisations tree location: user-chosen root.**
  - The runtime `organisations/` tree lives in a workspace root the user
    picks (e.g. `~/Arxa`, chosen at first run) — never inside the
    arxa-studio checkout, never buried in an OS app-data dir.
  - The empty `organisations/` skeleton currently sitting in the
    arxa-studio repo (organisation-a/b: projects/, notes/,
    meetings/{scheduler,notes}, account/{receipts,invoices,
    subscriptions,profile}, communications/{emails,messages,comments})
    is a template/spec only: the studio scaffolds a fresh org from it
    into the user-chosen root. User data never lives in the app repo.
  - Consistent with D13 (local-first) and the ownership boundary in
    CLAUDE.md (no feature may depend on the hosted DB).

- **D37 — Repo boundaries: org repo + nested per-project repos.**
  - Org root is one git repo (notes, meetings, communications, org
    context); each `projects/<name>` is its own repo, ignored by the
    org repo. `account/` excluded from version control entirely
    (billing mirrors + D28 secrets never enter git history).
  - Projects clone/share cleanly per D17; org history stays private;
    D18/D19 machinery covers org-level content.

- **D38 — Session = branch + worktree; main only advances by gated
  merge.**
  - Every work context (chat/agent thread and interactive editing
    surface) gets its own git branch + worktree; main is never edited
    directly.
  - Default merge hook: the D18 stage-boundary squash — the clean
    commit is gate-checked by arxa-cicd (project `check.sh` for code;
    light content checks — clean merge, valid files, no
    `account/`/secret paths — for org repos); green merges to main,
    red parks on the branch with the failure surfaced.
  - Worktrees live hidden at
    `<workspace-root>/.arxa/worktrees/<repo>/<session-id>/` — never
    inside a repo's tree, skipped by D23 export.
  - A **git-session plugin** (arxa-studio/plugins pattern, like
    pairing/theme-accent) adds composer buttons: branch/merge/park/
    discard — manual overrides of the defaults, not replacements.

- **D39 — Archived-session access: plugin now, upstream later.**
  - dsh fact base: `dsh-workspace` has durable `archivedSessionIds` +
    `archiveSession()`, transcripts persist as JSONL forever, but no
    `unarchiveSession` ships (0.1.1-rc.2) and the UI excludes archived
    sessions everywhere. Data model anticipates unarchive
    ("unarchiving must restore the position").
  - A session-archive plugin browses archived sessions (registry +
    JSONL, read-only) and offers Unarchive by writing the registry set
    directly; propose `unarchiveSession` upstream to dsh in parallel.
    Honors depend-don't-fork.

- **D40 — Archive git lifecycle: merge-try, park branch, prune
  worktree.**
  - Archive = final squash → gate → merge attempt; worktree deleted
    either way; unmerged branch parked, never auto-deleted.
  - Revival = `git worktree add` from the parked branch + rebase onto
    current main; conflicts surface in the git-session plugin.
    Nothing lost; disk stays clean.

- **D41 — Naming: kebab slugs on disk + manifest identity.**
  - Kebab-case slug is the folder name on disk and in git remotes;
    stable across renames; collisions get numeric suffixes.
  - Display name + stable id live in a folder-local manifest
    (`org.json` / `project.json`); renames touch the manifest, never
    the path, so git history and context references survive.

- **D42 — Org categories: fixed five, studio-owned.**
  - `projects/ notes/ meetings/ account/ communications/` is a fixed
    vocabulary features hang off (scheduler, billing mirrors, comms
    ingestion). No user-added top-level categories — extensibility
    there breaks D2 ancestor-chain semantics.
  - Free-form folders live inside `projects/<name>` and `notes/`.

- **D43 — Context files: `AGENTS.md`, native discovery.**
  - The folder context file is `AGENTS.md` (not a custom name): both
    harnesses (dsh, PI) discover it natively via the ancestor chain —
    no adapter layer. Org root's copy is the thin layer, D1-capped.
  - Threads/conversations live beside content under dot-dirs so they
    travel with the folder in git (D17) without cluttering the tree.

- **D44 — Template mechanics: versioned in-app manifest + stamped
  scaffold.** *(Copier-validated: versioned template + stamp in the
  generated tree + explicit migrations is the proven shape.)*
  - The org template ships inside the app as versioned data (folders,
    initial files, repo boundaries). Scaffolding executes it and
    writes the template version into the org's D21 format stamp — one
    stamp, two consumers. The repo's empty `organisations/` skeleton
    is documentation only (git cannot track empty dirs at all).
  - Evolution = new template version + explicit forward-only
    migration. Each migration runs as its own commit pair in the org
    repo, so a crash rolls back via git (no half-migrated trees).
  - Requirements: migration chains tested from every historical
    version (CI fixture trees per version); migrations declare
    owned paths (manifests, stamps, category folders) vs never-touch
    (user content) up front.
  - A clonable template repo is not precluded — layer it on only if
    user-authored templates become a product goal.
  - **Version chip**: pill chip rendered by the arxa git plugin,
    powered by the D20 semantic layer — project header shows current
    named version + state (e.g. `v4 · Approved`), variant views show
    the variant name; clickable → opens the D20 version timeline.
    Never shows git SHAs or the D21/D44 format stamp (that stays in
    About/diagnostics/export). Two version axes, never merged:
    D20 = user-facing deliverable versions; D21/D44 = internal org
    format schema.

- **D45 — `account/` population: write-through local mirror.**
  - Studio fetches billing artifacts (D12 MoR + D15) and writes them
    as plain files (PDF/JSON): offline-usable, D23-exportable, never
    authoritative, always re-fetchable. Read-only — no local edits
    flow back (users don't edit their own invoices).
  - Excluded from git per D37; empty-but-valid folder for users with
    no arxa account (CLAUDE.md ownership boundary).

- **D46 — SSOT: tree authoritative; DB rebuildable index; git and
  cairn as disjoint sync rails.**
  - File tree is SSOT for all content, including D20 facts stored as
    append-only files under dot-dirs. DB (SQLite default or BYO via
    D32) is a search/metadata index, always rebuildable by full scan;
    external edits to files are legal by definition; DB loss =
    re-index, not data loss.
  - **Cairn placement**: git = file-content rail (desktop↔desktop,
    D17/D18); cairn = DB rail — index/session state, mobile's
    projection of the tree (M7/M8), and the concrete implementation
    of the D32 BYO wire contract (local SQLite ↔ user's Postgres).
  - **Disjointness rule** (split-brain guard): cairn never syncs
    anything derivable from the tree — that's rebuilt locally. Inbound
    edits (mobile) travel as an append-only edit log with stable edit
    IDs; exactly one desktop materializes an edit into the tree and
    records the edit ID in tree-side facts so other replicas suppress
    re-materialization. Same edit must never arrive twice via two
    rails with different merge semantics (git textual vs cairn LWW).
  - v1 keeps it boring: mobile online-only (M8) → writes are an
    outbox → materialize → done; cairn CRDT merge stays out of the
    authoritative path until offline-first ships. Materializer
    failure must be loud, not a silent queue.
  - No-BYO users: local inbox file, identical code path — equivalent
    local fallback per the ownership boundary.

- **D47 — Deletion: workspace trash + git, two tiers.**
  - Soft-delete = move to `<workspace-root>/.arxa/trash/<timestamp>-<slug>/`
    with a manifest (origin path, deleted-when, kind). Restore = move
    back. Plain move ⇒ nested project repos and `account/` survive
    intact — the cases git-in-the-parent cannot cover.
  - In-repo deletions additionally get the D18 commit treatment
    (restore = revert) — two independent tiers.
  - Hard delete only *from* trash, with D23-grade loud confirm.
    Trash excluded from indexing (D46) and export (D23); auto-expiry
    optional, off by default.
  - Renames stay safe via D41 (slug stability). Cross-repo *moves*
    get a "history won't follow" confirm dialog, no extra machinery.

## Z.ai wire-params grill (2026-08-29) — D48–D54

- **D48 — Seed templates never set catalog-owned compat keys.** The
  launcher's seed template carried `zaiToolStream: true` inside a settings
  compat block; dsh withholds that key and hard-errors at route resolution
  (proven empirically red on the old template, green without it). Fresh
  installs since 2026-08-21 would not boot. Rule: vendor compat flags belong
  to the installed pi-ai catalog; settings entries stay compat-clean.
- **D49 — tool_stream via a temporary pi-ai override.** dsh 0.1.1-rc.2 pins
  pi-ai ^0.82.1 (<0.83 on a 0.x range); pi-ai 0.84.4's catalog serves
  glm-5.3/glm-5.3-flash with zaiToolStream. arxa pins pi-ai 0.84.4 via npm
  `overrides` — explicitly temporary until a dsh release bumps llm-pi-ai
  (issue drafted at docs/upstream/dsh-llm-pi-ai-bump-request.md). The gate
  reclassification PR (option C) was declined as contrary to dsh's design;
  "wait for upstream" (A) runs in parallel via the issue; "accept nothing"
  (D) declined.
- **D50 — Config entries merge with the catalog; keep minimal entries.**
  dsh's resolveRouteModels replaces the served catalog when a route declares
  a `models:` list, but merges a configured entry OVER the catalog entry of
  the same id (compat inherited when not restated). Since glm-4.6v (absent
  from the 0.84.4 catalog) must stay listable, the 5.3 entries remain as
  MINIMAL entries — id/name/windows/effort maps, zero compat keys — so the
  catalog owns maxTokensField, zaiToolStream, thinkingFormat. This supersedes
  the handoff's literal "delete the hand-written entries" advice.
- **D51 — Default model: zai / glm-5.3-flash / effort max.** Z.ai's own
  recommended settings for the flash tier (near-Opus-4.8 at ~10x lower
  cost; text+image input). Applied to the seed template and the live
  operator file. glm-5.3 stays configured, non-default.
- **D52 — Delegated Pi follows; personal ~/.dsh does not.** piHome
  models.json gains glm-5.3-flash (first position); pi-delegate's default
  model flips to match. The operator's personal ~/.dsh is a separate
  dependency tree (npx-resolved), not the product — untouched.
- **D53 — temperature/top_p: closed as a non-issue.** Z.ai's OpenAPI spec
  states server defaults temperature 1, top_p 0.95 for the GLM-5.3 series —
  identical to the documented recommendations. Omit both from the wire and
  inherit the defaults. No adapter plugin, proxy, or upstream PR (§5 of the
  handoff closed).
- **D54 — Acceptance gate and its limits.** Override accepted only after:
  route-validation proof against installed dsh code (red→green), a
  wire-capture test through pi-ai 0.84.4's real stream path (tool_stream
  true, max_tokens field, effort max, sampling params omitted — 8/8), and a
  full web boot (HTTP 200, plugins active). The published dsh-llm-pi-ai
  tarball ships no selftest harness, so the "selftest sweep" resolved to the
  route-validation proof. The live authenticated smoke is delivered as
  scripts/zai-live-smoke.mjs (environment-blocked in the grill sandbox:
  no appbox, no env key). No migration machinery: the landmine never
  shipped in a release.

## File-organisation grill — COMPLETE (Q1–Q9 → D39–D47)

## Open

- Write `docs/plans/file-organisation-implementation.md` from
  D39–D47, then build.
- Glossary of settled terms now lives in `CONTEXT.md` (repo root).

## Z.ai latency grill — COMPLETE (2026-08-29, Q1–Q9 → D55–D59)

- **D55 — The 7.7s/40 vs 5.5s/62 gap is model tier, not harness.**
  Controlled A/B against Z.ai (`scripts/zai-ab-bench.mjs`, 22 runs):
  flash+tools @ max = 7.3–7.4s TTFT / 26–50 tok/s (arxa's numbers
  reproduced exactly); glm-5.3+tools = 2.3–2.9s / 85–89 tok/s
  (stock's numbers once diluted by dsh's full tool-schema prefill).
  Same instrument on both sides (client.js: TTFT = dispatch → first
  delta, reasoning included; tok/s = completion_tokens ÷ decode
  wall). `tool_stream` showed no consistent effect (run-to-run
  variance dominates); system prompt, plugins, credential
  resolution, context growth, and endpoint all ruled out. The
  "100+ tok/s era" ended the day the default flipped to flash
  (2026-08-21) — flash is currently Z.ai's slow tier.
- **D56 — Default flips to glm-5.3 @ max; flash stays routed for
  vision.** Live settings + seed template. Flash remains first-class
  for text+image turns and stays pi-delegate's default model.
- **D57 — Effort vocabulary becomes low/high/max.** `off: null`
  dropped — fake off (thinking cannot be disabled on the 5.3 series;
  selecting it sent nothing, the model still thought at default).
  `low` added — bench: low eliminates thinking entirely (0 thinking
  tokens, first delta = content) and cuts total response time ~3×;
  the only real speed lever.
- **D58 — baseURL pinned to the coding endpoint everywhere;
  provider renamed zai-coding.** The stored key is coding-plan
  scoped (general endpoint → 429 insufficient balance,
  bench-verified). Live settings zai route, live models.json, and
  seed template all pin `https://api.z.ai/api/coding/paas/v4` with
  a wallet-flip comment. models.json provider id `zai-wallet` →
  `zai-coding` (swept through README, arxa-explore, pi-delegate);
  the live file also carried a pre-rename `!appbox` credential shim
  (dead — `appbox` is not on PATH) now `!arxa credentials exec`,
  which resolves via inherited env inside the studio process tree.
- **D59 — zai-coding-cn provider dropped from the seed.** After the
  pin it duplicated the zai route (same endpoint, same key) with
  only historical labels; dead config removed.

## Open (latency)

- Restart the running studio (booted 15:07, before the settings
  edit) to load the new default. The `~/.arxa/engine` copy of the
  launcher carries the old seed until the next engine build — no
  live impact (seeds only fire on fresh homes).
- Repo changes from this grill are uncommitted (the operator's
  parallel session is mid-flight); commit when clear.
- If a wallet-funded key ever exists, flip baseURL to
  `https://api.z.ai/api/paas/v4` per the pinned comment.

## Approvals-loop grill — COMPLETE (2026-08-29, Q1–Q9 → D60–D68)

Closes the doorbell decision memo's open caller question
(arxa/docs/plans/doorbell-decision-2026-08-29.md, B1): what the
approvals feature is, how it reaches the phone, and what "done"
means. Term definitions live in CONTEXT.md (Pending interaction,
Approval, Doorbell).

- **D60 — v1 loop shape: full loop.** Approvals are actionable on the
  phone: native approvals_shell lists pending approvals, the owner
  approves/denies there, the agent unblocks. A list you can't act on
  trains the owner to ignore the buzz — worse than no buzz.
- **D61 — data path: engine HTTP over the iroh tunnel, cairn-shaped.**
  `GET` pending approvals as JSON from the studio engine through the
  existing loopback proxy; the mobile kit entity caches the response
  as the phone's projection. Payload fields ARE the future cairn row
  (same ids, same columns) so B2 (desktop hosts cairn-server,
  approvals ride sync, visible push → silent wake) is a transport
  swap, not a model migration. Refresh = foreground / pull-to-refresh
  / post-decision; no polling. D46 stays intact: approvals are
  session state, not tree-derivable; the HTTP fetch is the
  projection's v1 transport per D46's own "mobile online-only" v1
  note.
- **D62 — decision path: direct engine POST, loud failure, no queue.**
  `POST` the decision through the loopback proxy (tunnel-layer AUTH
  already gates the caller); on dead tunnel redial once via
  `resume()`, then fail loudly inline ("reconnect to act"). Never a
  silent queue. The cairn-rail edit log is NOT used — it exists to
  materialize tree edits, and an approval decision is session state;
  shoehorning it in would blur the D46 disjointness the rail
  protects.
- **D63 — model: derived projection, not first-class records.** An
  Approval IS a dsh session's pending human-input request
  (`ask_user_question`). The approvals list is computed from dsh
  session state; deciding = remotely answering that session. No new
  durable store — the pending question is the record, the projection
  is rebuildable by scan (index tier per D46). Side effect:
  `pendingInteraction` (sidebar union, until now producerless) gets
  its first engine-side producer. Build must first verify dsh exposes
  (1) server-side listing of sessions with pending interactions and
  (2) an answer-submission API — the web UI has both; if host plugins
  cannot reach them, first-class records (rejected here) return as
  the fallback.
- **D64 — one class in practice.** Every pending question IS the
  approval in v1; `kind` ships in the record but stays `'approval'`.
  plan-review/question split only when a real second class emerges
  (doorbell memo: later classes join after approvals prove the UX).
  No heuristic classifier over prompt text.
- **D65 — copy: fixed generic English, content-free, engine-side.**
  Caller passes `{id}` only; plugin defaults stand ("Approval needed"
  / "Open Arxa Studio on your phone to review."). The rail learns
  THAT an approval exists; the summary rides the encrypted tunnel,
  never APNs/FCM (ADR-0038 §2 caller-side templates; D8 privacy
  posture). Locale-aware copy is a future additive registration
  field, not a redesign.
- **D66 — placement: new `plugins/approvals` (studio) + app-owned
  mobile slice.** Engine: host half injects dsh `webServer`, owns the
  session-state seam, registers `/__arxa/approvals` routes
  (sidebar-style convention), fires `notifyApprovalRequested`
  (push-doorbell stays a pure never-throwing library) on new pendings
  via cheap polling with dedup by session+id. Mobile: entity +
  repository over ArxaKitRepository ports + tunnel API client live in
  mobile_flutter (the app is the only consumer); entity registers at
  boot through kit/data, not as a new kit package. This slice does
  NOT touch the sidebar plugin.
- **D67 — repo hygiene: push before building.** arxa (11 ahead) and
  arxa-studio (8 ahead, including the push-doorbell foundation) push
  BEFORE the slice lands, so its diff reviews in isolation — same
  pin-visibility discipline as the kit audit. The unrelated dirty
  sidebar WIP (5 files, +314/−27) stays untouched and unswept, with a
  named warning in the slice's commit message.
- **D68 — done: simulated gates AND phone demo.** Merging requires
  the simulated suite green (plugin selftest riding ci.mjs with fake
  fetch; route contract tests; mobile analyze + tests with mocked
  transport). The feature is NOT done until the owner demonstrates
  the full loop on the physical phone (arm ARXA_DOORBELL_PUSH=true,
  pair, raise a pending, assert buzz → list → decide → agent
  unblocks) — the ADR-0041 D5 pattern with teeth: tracked as a
  closing condition, dark-gated off-default until then.
  **CLOSING CONDITION MET 2026-08-29 (same day):** the full loop ran
  green on the owner's physical iPhone 15 with REAL APNs delivery —
  cairn-pushd armed with the operator .p8 (sandbox env), buzz presented
  on-hardware (title 'Approval needed', asserted off the native
  willPresent event), Approve tapped on the phone, agent unblocked
  engine-side, pushd receipts outcome:"delivered" with duplicate rings
  coalesced by collapse_key. Phone leg built app-side (no engine
  change): Runner entitlements + raw-APNs native bridge +
  ApnsNotificationsBackend + PHASE=phone integration test; pairhost
  gained the pushd forward it was missing. Full record + evidence:
  arxa/docs/plans/doorbell-decision-2026-08-29.md (PHONE LEG COMPLETE).
  The ARXA_DOORBELL_PUSH gate stays off-default by design — arming is
  an operator choice.

### Open (approvals)

- ~~dsh seam verification (D63's precondition)~~ — VERIFIED while
  building: `ctx.apiProxy.events.mux(request, signal)` is a public
  host face (async frame iterable; replays every pending question on
  attach, then live requested/resolved), and `ctx.apiProxy.respond`
  settles a pending wait first-claimant-wins (dsh-host-apiproxy). The
  fallback (first-class records) was never needed.
- kit/cairn README "push pattern" paragraph (doorbell memo item A)
  — undecided rider; its own trivial commit if taken.

## Org model v2 — sidebar/workspace reshape (grilled 2026-08-29, session 2)

Grounded in: dsh-structure exploration (two parallel unconnected session
worlds measured — sidebar shows git-registry rows only; dsh conversations
persist under ~/.arxa/dsh/sessions keyed by launch cwd, never inside orgs)
and research/github-auth-desktop-report.md (official-docs current).

- **D69 — Org model v2: location = org root; GitHub link gate; project
  publish.** The folder picked at creation IS the organisation root:
  org.json + the five categories land directly inside it (MIRA/projects,
  not MIRA/<org>/projects). The workspace-root tree (D36) is retired —
  ~/.arxa/organisation.json becomes a recents index of opened org
  folders. Creating an organisation requires a linked GitHub account
  (one-click browser sign-in, VSCode parity; token in the OS keychain;
  device flow only where no browser can open). Project creation
  publishes a private GitHub repo as the project remote. Supersedes D36,
  D37's placement rider, and D16's anonymity rider at org-creation
  scope (the app itself still runs anonymous until an org is wanted).
- **D70 — Categories are workspaces.** Each of the five categories
  behaves like a dsh workspace: its own sessions as org-repo worktrees
  (branch per session, D18 machinery), light gate (D38 content-repo
  clause), local-only — never pushed to GitHub. Notes/meetings content
  stays private to the org repo.
- **D71 — Sessions live only in workspaces; dsh bridge is the product.**
  Every session belongs to exactly one workspace (category or project);
  the floating org-level session (registry project:null) is retired —
  glossary term removed, supersedes sidebar-org-rethink Q4. The
  dsh-session ↔ worktree bridge gets built: a session's live dsh
  conversation runs with cwd inside the worktree and appears in the
  sidebar (current state: registry stubs only, measured).
- **D72 — Proper rename.** Rename = display name + folder on disk +
  GitHub repo name (projects), executed as one git-tracked move with
  registry rekey; worktrees revive from parked branches. Supersedes
  D41's slug-stability clause. Display-name-only remains available when
  a remote you don't own makes moving unsafe.

Build riders (user, this session): keep using the stock DSH workspace UI
via the splice pattern (gen-workspace.mjs — depend-don't-fork); compose
and validate plugin surfaces in Creator mode (Cordis preset) per the
integration plan's UI-harmony rule.
