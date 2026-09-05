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

- **D12 — Payment gate provider: B, merchant of record → Paddle.**
  - Paddle handles checkout, global sales tax/VAT; ~5% + $0.50 fees
    accepted as the cost of not being the merchant. arxa issues its own
    entitlement tokens (Paddle Billing has no licence-key primitive).
  - Lemon Squeezy REMOVED (2026-09-02): its CEO's 28 Jan 2026 post names
    Stripe Managed Payments "the future" and says the goal is to migrate
    LS users onto it. Building on LS = building on a product its owner
    is retiring. Research: `arxa/docs/research/payment-architecture/
    mor-provider-comparison.md`.
  - Switch condition: if the seller entity ends up Australian (or EU)
    AND Stripe confirms Managed Payments eligibility in writing, go
    Stripe MP directly instead of Paddle → skips the later migration.
    A Mauritius entity closes that door (Stripe MP regions: NA/EU/APAC,
    Mauritius not expected) → Paddle stays. Polar is the fallback if
    Paddle rejects the account.
  - OPEN (gates the contract, not the design): seller-of-record legal
    entity is undecided between Mauritius and Australia. Payout facts
    either way: Paddle pays monthly (1st → by 15th), $100 minimum, wire
    in AUD/EUR/USD (no MUR; $15 wire fee off local rails).
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
  - The D12 merchant of record (Paddle; Stripe Managed Payments if the
    D12 switch condition is met) is the single money pipe for everything: one-time kit/tier purchases in arxa AND the
    Agency subscription. arxa.dev issues/holds entitlements only — it
    never touches money.
  - The existing plans-paywall flow gets retrofitted onto MoR checkout.
  - Pricing shape: Studio free; Agency subscription; arxa freemium with
    one-time premium kit purchases (matches boilerplate-market norms:
    base kits free, premium one-time $199–$599 range).
  - ~~Free tier must still produce a complete usable scaffold — never a
    crippled one.~~ Superseded by D104 (2026-09-02): scaffold is paid;
    the "never crippled" rule applies to a Pro user's scaffold on base
    kits — premium kits add, never repair.

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
- ~~kit/cairn README "push pattern" paragraph~~ — RESOLVED 2026-08-29
  (arxa kit commit: "The push pattern" in the README Push section).
- ~~sidebar pendingInteraction producer wiring~~ — RESOLVED 2026-08-29,
  by verification rather than construction: dsh 0.1.1-rc.2's
  client-runtime SessionManager IS the producer (classifies
  question/requested mux frames into SessionSummary.pendingInteraction,
  replay-deduped, connection-generation scoped), and the sidebar's
  ui-workspace-derived client already consumes it in all three sites.
  arxa-sidebar selftest section 8 now pins the chain (runtime producer
  present + rows/search spread + closed-union switch) so regeneration
  cannot strand the union again. Approvals surface as the generic
  pending pill per D64 one-class; dsh's separate approval/requested
  frames are its own mechanism, deliberately not adopted in v1.

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
- **D73 — GitHub publish: BOTH orgs and projects, pushed.** The GitHub
  unit is the repo at BOTH levels: the org folder publishes as one
  private repo (`<slug>`), each project as its own nested private repo
  (org `.gitignore` already excludes `projects/` — no overlap; D37
  whitelist governs what an org repo contains). Publish = linked? →
  repo exists? (origin reuse counts) → create → origin → push the
  PRIMARY branch (`main`→`master`; session branches `arxa/session/*`
  are local working state and NEVER publish) → manifest annotation
  (repoOwner/repoName/repoUrl/githubStatus). The push token rides the
  push command line ONLY — never persisted, never in `.git/config`.
  Any GitHub-shaped failure is a loud manifest annotation, never a
  throw — the local repo is the source of truth (CLAUDE.md local-first).
  Root cause this fixes (measured 2026-08-30): the sidebar built the
  lifecycle WITHOUT github faces, so the throw-proof stub answered
  `github-unavailable` for every publish while the account WAS linked
  (TOPO project-001 manifest carried it). Projects also scaffold a
  `.gitignore` (noise + secrets only; `build/` is a managed container
  and never ignored).
- **D74 — Hybrid heal.** Existing orgs/projects created before D73 heal
  on org OPEN: a detached, bounded waiter (condition-polled hasHead,
  240×250 ms) publishes once HEAD lands — never blocks the open, never
  blocks create (same discipline as the detached initial snapshot).
  PLUS a manual control: the org menu's "Publish to GitHub" row routes
  `github.publish` → the open-org handle's `publishGithub()`, which
  awaits the in-flight heal (never races it) and is idempotent
  (`skipped: 'published'` when the manifest already carries repoUrl).
- **D76 — Refresh tokens or the link dies in hours (found live 2026-08-30).**
  GitHub OAuth-app tokens (ghu_) EXPIRE (~8 h); the device flow returns
  refresh_token + expires_in and the original link threw both away —
  measured: the linked account 401'd the day after linking, so every
  publish failed even after D73's wiring. Now: link persists the refresh
  token in the KEYRING (`<login>#refresh` — a secret, never the state
  file) and the expiry clock in the state file; getToken() refreshes
  through `grant_type=refresh_token` when inside the 60 s window, persists
  ROTATED refresh tokens, and a 401 forces one refresh+retry (clocks lie).
  Legacy links without a stored refresh token get a loud
  sign-in-again instruction. One human re-link is unavoidable (the old
  refresh token is gone) — after it, tokens renew themselves forever.
- **D75 — Composer git card (DESIGN BRIEF, not built).** A collapsible,
  dsh-goals-style card over the text composer in EVERY arxa session,
  worktree-aware (resolves the org repo vs project repo it serves).
  STAGED AUTONOMY: auto = status/diff refresh, LLM commit-message
  drafts, publish/heal, PR-description drafts; one-click confirm
  (pre-filled, no typing) = commit, push, PR create, merge; NEVER auto
  = approve, merge to protected branches, force-push/recover-
  destructive ops, conflict-resolution choices. v1 = core loop + PR
  (status, LLM commit, push, publish/heal, PR create). v2 = review /
  auto-review / approve, CI status, conflict flows, recover. VS Code
  git-parity is the north star; manual triggers always available.

Build riders (user, this session): keep using the stock DSH workspace UI
via the splice pattern (gen-workspace.mjs — depend-don't-fork); compose
and validate plugin surfaces in Creator mode (Cordis preset) per the
integration plan's UI-harmony rule.
## D77 — Publish feedback modal + create-at placement (the PLATO incident, 2026-08-30)

User created an org named PLATO; nothing appeared on GitHub and nothing was shown. Root-cause chain, each link fixed:

1. **Placement trap**: the create modal collects a NAME and a LOCATION, but org.create-at scaffolded AT the picked folder and ignored the name (D69 in-place). Picking a volume root made the ROOT the org: git init + snapshot over the whole disk, scaffold commit choked on the size, stale index.lock, zero commits forever. Fixed: the picked folder becomes the org only when its basename already slugifies to the org name; otherwise the org is a NEW subfolder named for the org inside the picked location (scaffoldOrg(target, nm)). D69 survives whenever the folder already carries the org’s name.
2. **Silence**: the menu’s publish row was mutate().catch(() => {}) — a refused publish (no HEAD, not linked) was invisible. Fixed: the row dispatches arxa-publish-org; OrgPublishModal runs confirm / busy / done / error over the real publish result (ORG_POST, not mutate — mutate discards the body), localised en + zh.
3. **Stale profile serving** (packaging lesson): dsh profile materialization rewrites the payload file: paths each boot, but pnpm never re-copies a plugin whose version string is unchanged — payload updates were silently NOT served. Lesson: bump the plugin version on every shipped plugin change (all five bumped to 0.1.1 with D77).

Verified live: PLATO created at /Volumes/business_ssd/plato (subfolder), auto-published by the heal to unfazed-dev/plato (private), modal confirm + already-published success captured by lens.

## Artifact viewer → editor grill (2026-08-30) — D78–

Grounded in: docs/plans/artifact-viewer-editor-brief.md,
docs/research/artifact-viewer-media-research.md,
docs/research/editor-viewer-to-editor.md. D7 stays the viewing
architecture; this grill settles the editor extension it never covered.

- **D78 — Editable scope v1: text family only.** The viewer-editor edits
  code/text/md/json/yaml; html/mdx editable as source only; all media
  (pdf/video/audio/images/office) stays view-only in v1. Matches VS Code's
  own view/edit split and keeps D7's direct-render lane the edit lane.
- **D79 — Editor engine: CodeMirror 6.** MIT, ~50–200 kB tree-shaken, no
  workers required, best system-webview behavior under D30. Diff view via
  @codemirror/merge; LSP deliberately absent in v1. Monaco revisitable only
  if TS IntelliSense / built-in diff becomes a hard requirement.
- **D80 — Saves land in the session worktree, transparently.** Toggling edit
  ensures the current workspace's session worktree (auto-created when none is
  open); saves write the worktree, D18 WIP auto-commits capture them, the
  stage-boundary gate merges per D38. Viewing always reads main/the real
  tree — never a worktree. No quick-edit-to-main mode exists.
- **D81 — Write path: read-only org origin + engine write API.** The per-org
  file server serves GET only, forever — rendered content can never write.
  Editor saves POST the trusted studio origin's engine API carrying a
  short-lived WRITE token scoped to one session worktree; the engine
  re-validates path containment (inside the worktree root) server-side
  before writing and the D18 WIP commit. Read tokens (D7) and write tokens
  are separate classes with separate lifetimes.
- **D82 — Text edit UX: md source|preview split; hard guards.** Markdown
  gets a source|preview split reusing D7's direct md renderer. The editor
  refuses binary and oversized files (configurable cap, default ~5 MB) into
  read-only view. html/mdx preview = D7's view mode, no split pane.
- **D83 — Undo: CM6 history + D18 checkpoints, nothing new.** CodeMirror's
  undo history is D19 level 1 (per-surface Cmd+Z, session-local). D18's WIP
  auto-commits are D19 level 2 — checkpoint restore via the existing rewind
  machinery. No custom undo stack, no manual snapshot affordance.
- **D84 — Diff: one engine, two surfaces.** @codemirror/merge is the only
  diff implementation: editor worktree-vs-main per-file diffs, and gen-ui's
  Diff card upgraded onto it when real file diffs land in conversation. The
  line-by-line card is retired once the upgrade ships.
- **D85 — Editor header: D44 version chip + session badge.** The chip opens
  the D20 timeline (never SHAs/stamps); a session badge names the session
  whose worktree receives saves, so 'edits are not on main' is always
  visible.
- **D86 — External changes: native watch → push, live color indicators.**
  The file-org-shell watchers push change events. Clean buffer auto-reloads
  (design-panel doctrine); dirty buffer prompts with a @codemirror/merge
  view (keep mine / take theirs / diff). Live color state throughout:
  colored gutter marks for unsaved lines, dirty dot on modified tabs, and a
  distinct conflict color for externally-modified-under-dirty-buffer files.
- **D87 — v1 = full text-family editor; done = live-demo gate.** v1 ships
  D78–D86 whole — no slim cut, no v1.1 split. Acceptance per the D68
  precedent: selftests green, lens visual gate at the 390/744/1280 ladder,
  and the owner demonstrates the live loop: open → edit → save → WIP
  commit → stage-gate merge visible in the D20 timeline; a real agent edit
  triggers the conflict prompt; an expired write token is rejected; the org
  origin is proven GET-only.

## Open (viewer-editor)

- ~~Write `docs/plans/artifact-viewer-implementation.md` from D7 +
  D78–D87~~ — WRITTEN 2026-08-30 (12 tasks, acceptance gate per D87).
  Build pending — nothing is built yet.
- **D88 — Docked viewer column: clone details' mechanics, not its seat.**
  The artifact viewer becomes a fourth AppFrame column (sidebar | center |
  details | viewer), shipped as a generated, drift-gated patch of
  ui-layout (`scripts/gen-frame.mjs`, the gen-sidebar.mjs pattern) — never
  by registering into the `details` seat (single slot: we would shadow the
  stock DetailsPanel + its tool seat) and never as a `shell.overlay` float
  (the full-inset pointer-events:auto overlay that blocked all UI is
  retired). Session-bound presence mirrors details: renders only while a
  non-blank session is current, closes on session switch. Org-bound scope:
  the column opens anything in the org tree; editing stays D80 (session
  worktree + D18 WIP commit) with the D85 badge.
- **D89 — Worktree read lane.** Produced files live in session worktrees
  (`.arxa/worktrees/<id>`), not on main; the viewer reads them through a
  dedicated studio-origin route `GET /__arxa/artifacts/wt` with a read
  token bound to worktreeId (mirroring the D81 write binding). The org
  origin (D7) is unchanged — no `.arxa` exposure changes; worktree files
  are served by token, not by accident.
- **D90 — Org file tree lives in the arxa sidebar.** The sidebar's tree
  gains the real filesystem layer: all folders/files of the open org, lazy
  per-directory (`GET /__arxa/artifacts/tree?dir=…`, served by the
  artifact-viewer plugin; excludes `.arxa/`, `.git/`, dotfiles;
  `account/` viewable). Click a file → opens the viewer column (org lane).
  Sidebar navigates; the column views/edits — one authority per concern.
- **D91 — Artifact cards = stock deliverables.** The per-turn produced-file
  chips (dsh-client-ui-deliverables `turnTail`, sourced from tool
  locations, not prose) plus composer file-mentions are THE artifact cards;
  clicking one opens the viewer column on that file (worktree lane first,
  org fallback). gen-ui stays a rich-surface system and is untouched.
  Never auto-open: cards light up, the column opens only on click.
- **D92 — Narrow = full-frame sheet at dsh's own breakpoint.** Below
  AppFrame's narrow flag (< 1024 px) the viewer renders as a full-frame
  sheet (back arrow returns to chat); same panel component, one container
  branch. ≥ 1024 px it is the draggable column. Width preference is ignored
  while narrow, remembered across the boundary.
- **D93 — Geometry persistence + entry points.** The generated layout store
  gains `viewer` + set/open/close actions (one authority for frame
  geometry; clamp min 320 px). ⤢ maximize = viewport − sidebar − details(if
  open) − 640 px center floor, details yields first if the floor cannot
  hold; maximized is ephemeral, width persists. Entry points: deliverables
  card, sidebar file, column path input, and an "Artifacts" toggle beside
  "Session log". Session switch while open: the column follows the new
  session (artifact resets to empty state, session-changes list rebinds).
- **D94 — Sidebar tree: only `.git/` and `.arxa/` are invisible.** (Grilled
  2026-09-01 after the sync/visibility audit.) The tree route's blanket
  dotfile filter is retired: every dot-entry except the two internal state
  dirs — `.github/`, `.gitignore`, `.env.example`, everything — is a real
  sidebar row. Generated files must be visible in the sidebar exactly as
  they are on GitHub; a filter that hides what the studio itself generates
  (the CI frame) reads as "the file was never created". Amends D90's
  exclusion list from "dotfiles" to ".git/, .arxa/ only".
- **D95 — Every studio commit on main pushes to GitHub immediately.** (Same
  grill.) The publish-time push alone let frame/link/migration annotate
  commits pile up locally — measured live: project-001 sat 3 commits ahead
  of its remote with no signal. Law: any commit the studio makes on a
  published repo's main (frame wiring, link state, migrations, merges,
  sync notes) pushes in the same breath. A published repo that CANNOT push
  (credentials gone) reports it — never a silent skip. Session WIP
  auto-commits are untouched (D18 two-tier: WIP stays local until the
  stage boundary).
- **D96 — Remote advances fast-forward on open + refresh; divergence
  parks.** (Same grill.) The open-time heal and the snapshot-poll refresh
  (throttled to one sweep per minute, plus the `org.sync` door) fetch and
  fast-forward each published repo of the org — org root and every project
  — so files that moved on GitHub land in the local tree the sidebar
  reads. `--ff-only` always: a history where local and GitHub both moved
  is never auto-merged — it parks as a committed `sync-conflict` manifest
  note for the operator to resolve. Local-only orgs (TESTO-style
  disconnects) are skipped by design.


- **D97 — The manual sync door gets a visible affordance, and its
  refusals are visible too.** (Follow-up to D95/D96, 2026-09-01.) `org.sync`
  existed only as an engine action — no way to reach it from the UI. Org
  rows now carry a `Sync with GitHub` menu item (org rows ONLY: the action
  sweeps the org repo *and* every project under it, so on a project row the
  label would promise far less than it does). The result lands as a badge
  beside the GitHub mark. Two laws about that badge: (a) a failure ANYWHERE
  in the sweep wins the label — a green "In sync" painted over a refused
  push is the exact failure a manual sync door exists to prevent; (b) the
  engine's raw per-repo status words (`push-failed: …`, `diverged`,
  `no-creds`) ride the tooltip untranslated — diagnostic vocabulary, not UI
  copy. Implementation note: the item calls `ORG_POST("org.sync", …)`
  directly rather than `orgStore.mutate`, because `mutate` discards the
  result (`.then((r) => refresh())`) and the per-repo status IS the
  deliverable; the refresh is then done by hand.

- **D98 — Engine ships locally; ship-vs-host is closed with revisit
  triggers.** (Confirms D30 and consolidate #11, 2026-09-02.) The engine
  (13 MB Dart AOT) stays a Tauri sidecar on the customer's disk; kits are
  delivered from a static signed bucket (not bundled, not computed); hosted
  conveniences (kit CDN, resold cloud builds, later Totem Cloud) are the
  growth path and never sit between the user and a scaffold. Licence stays
  the offline-verified Ed25519 JWT with grace — the Unity/JetBrains shape.
  The question was reopened on an install-size worry; measured, the engine
  is 13 MB and the 193 MB harness is 116 MB of node runtime, so size is not
  an argument for hosting. Reopen ONLY if one fires: verified piracy >10 %
  of paid seats in a quarter; a feature that cannot run on a laptop
  (non-BYO model, >8 GB, GPU); a contract demanding sub-TTL revocation the
  customer won't take as a shorter TTL; a second operator to hold on-call.
  Full analysis: `arxa/docs/research/payment-architecture/engine-distribution-options.md`.
  Fallout work (not hosting arguments): kit distribution (engine currently
  needs a repo checkout via `findRepoRoot()`), Linux build (no linux triple
  anywhere), optional harness slimming.

- **D99 — Offline window for paid scaffold: 30 days of grace after token
  expiry.** (2026-09-02.) Token TTL stays ~7 days with refresh at <48 h
  left; after `exp` the engine keeps unlocking for 30 days
  (`entitlement.dart:93 gracePeriod = Duration(days: 30)` — already in
  code, now a decision rather than a default). Cached kits stay valid for
  the same window. Licence sharing inside that window is accepted (D98).
  Air-gapped-forever is out of scope; no manual activation path.

- **D100 — Agency is the Studio binary in an entitlement-gated mode.**
  (2026-09-02.) One Studio artifact per D14 channel; no separate Agency
  build, download, or launcher. The Agency sidebar sections (admin,
  business, clients, …) render only when the signed entitlement token
  (D10/D99 JWT) carries the `agency` claim; a company buys the D15
  subscription and the sections appear at the next token refresh. Agency
  UI code therefore ships to every Studio user (not secret, just gated) —
  accepted, because enforcement is server-issued tokens, not hidden code
  (D12 "inherently crackable"). Rejected: separate build launched from
  Studio (four release pipelines for no enforcement gain); hosted Agency in
  a webview (contradicts D13 local-first SQLite and D98 engine-local).
  "Only via Studio" = there is no other artifact; nothing to reach outside
  it.

- **D101 — Supabase is the entitlement authority and nothing else.**
  (2026-09-02.) Supabase holds arxa.dev accounts and the entitlements
  ledger. Paddle webhooks land in ONE edge function that writes
  `subscriptions`/entitlements; `/activate` signs the Ed25519 JWT from that
  table (D99 TTL/grace). Supabase never holds customers' agency/business
  data (D13: local SQLite, pluggable remote) and never touches money
  (D15: Paddle is the only money pipe). The two existing migration trees
  that both write `subscriptions` must be reconciled into this one ledger
  before the Paddle webhook is built. Rejected: Supabase as the Agency
  multi-seat remote now (customer data on arxa's Supabase before a
  tenancy/RLS design — security research's top Supabase failure mode;
  revisit when a paying company asks); Supabase-runs-everything
  (contradicts D98 static kit bucket; single lock-out point).
  Diagram: `arxa/docs/research/payment-architecture/architecture-diagram.md`.

- **D102 — Agency subscription is per-seat; the buyer is org owner and
  invites members.** (2026-09-02.) The Paddle subscription carries
  `quantity = seats`. The purchasing arxa.dev account becomes the org's
  owner; owner invites members by email; a member's own `/activate` token
  carries `agency` (+ org id) only while they hold a seat. Ledger gains
  `orgs` and `org_members` next to entitlements — still entitlement data,
  inside D101's boundary; no business data. Seat count is enforced at
  invite time (owner cannot exceed quantity) and at token issue (member
  without a seat gets no `agency` claim). Webhook `subscription.updated`
  with a lower quantity marks the org over-limit; owner must remove
  members before new invites, existing members keep access until their
  token's D99 window ends. Rejected: flat per-company (no lever for a
  50-person agency vs a freelancer); per-user with no org (companies can't
  buy centrally or get one invoice; would push every company deal into
  Paddle's sales-gated invoicing).

- **D103 — Agency has a 14-day trial, card required, run by Paddle.**
  (2026-09-02.) The trial is a Paddle trial subscription: Paddle collects
  the card, owns the disclosure/reminder obligations (its trial-compliance
  requirements apply to arxa's checkout copy), and converts or cancels on
  day 14. The ledger gains a `trialing` state fed by the same webhook;
  `/activate` issues `agency` on `trialing` exactly as on `active`, so
  trial and paid are indistinguishable to the Studio. Seats during trial =
  the quantity chosen at checkout (D102). Rejected: no trial (pay before
  seeing the business sections — weak for an unknown product); card-less
  trial minted by arxa.dev (arxa would own trial logic, abuse controls and
  conversion nags — work Paddle does, plus a fraud surface flagged in
  `security-research.md`).

- **D104 — Solo free/paid line: scaffold is paid (kit-picker decision 17
  stands; D15's free-scaffold bullet superseded).** (2026-09-02.) Free =
  intake, design, eject (the take-away htmx artifact, kit-picker 11),
  fully anonymous and local (D16). Scaffold and every stage after it
  require the Pro entitlement — per-seat, recurring (kit-picker 19's
  Pro, ~$20–40/seat/mo, price band still open). One-time premium kits
  ($199–$599, D15) sit on top of Pro, never replace it; a Pro user's
  scaffold on base kits is complete. The engine gate stays where it is
  (`gates.dart:50` — scaffold is the only gate consuming
  `~/.arxa/entitlement.jwt`); the Studio paywall surface is the
  `arxa-plan` dsh plugin (D106) — NOT the earlier `plans_viewmodel.js`
  design artifact under `designs/arxa-studio/`, which predates the dsh
  Studio and is stale (its state names signedout | free | entitled and
  pay outcomes succeed | decline | cancel | error | timeout carry over
  as the plugin's vocabulary, nothing else does). Rejected: free scaffold
  funded by one-time kits + paid operate-for-you stages (moat ships free
  again — the regret recorded in 17; no recurring solo revenue; gate
  moves back to deploy); free scaffold with a monthly cap (caps on an
  offline fingerprint-bound engine reset trivially — abuse controls D103
  refused). Open: exact Pro price. Checkout hand-off: D105.

- **D105 — Checkout happens in the system browser on an arxa.dev page;
  Studio gets the result by deep link + `/activate` poll.** (2026-09-02.)
  From the `plans` view, Studio (or the CLI, which prints the URL) opens
  `https://arxa.dev/checkout?price=<paddle price id>&uid=<arxa.dev user>`
  in the default browser. That page is arxa's, runs Paddle.js overlay
  checkout, and on Paddle's `checkout.completed` event redirects to
  `arxa://checkout/done`; Studio meanwhile polls `/activate` until the
  D101 webhook has written the entitlement, then refreshes the token.
  Card data never enters the desktop webview; same loopback/deep-link
  shape as D18's PKCE sign-in. Sources read: Paddle "Handle checkout
  success" (Paddle.js `checkout.completed` event callback or redirect;
  provision via webhooks) and "Hosted checkout URL query parameters"
  (hosted no-page links require additional approval from Paddle —
  sellers@paddle.com — sandbox only until granted). Rejected: Paddle.js
  inside the Tauri webview (3DS/bank redirects and wallet pay in an
  embedded WebKit/WebView2 are unsupported territory; Paddle's guidance
  for apps is purchase-outside-the-app); Paddle Hosted Checkout links as
  the launch plan (approval-gated — acceptable later simplification).

- **D106 — The paywall is a new dsh/cordis plugin, `arxa-plan`: host +
  client, sidebar plan card + overlay wall.** (2026-09-02.) Corrects the
  stale premise that the Studio paywall lives in
  `designs/arxa-studio/.../plans_viewmodel.js` — the Studio is dsh now,
  and UI is contributed only by cordis plugins (`profile/cordis.patch.yml`
  insert/disable rows; `docs/plans/dsh-plugin-ui-conformance.md`).
  Host half: shells `arxa entitlement status` (one JSON line —
  entitled | unentitled | none, `features`, `expires`, honest `reason`;
  `entitlement_cli.dart`) and `arxa entitlement refresh`; exposes
  `POST /__arxa/plan/action` with actions `checkout` (opens the D105 URL
  in the system browser), `refresh`, `sign-in`; observes the scaffold
  gate's refusal so the wall opens at the moment Run is denied. Client
  half: hand-written zero-dep bundle (conformance decision 3), en/pl/fr
  via arxa-locale, light + dark; a plan card in the `sidebar.footer.action`
  hole (signed-out | Free | Pro | Scale, upgrade CTA) and a wall in the
  `shell.overlay` slot (kind:list, scope:root — the slot WelcomeGate is
  moving to) that shows the engine's `reason` verbatim — the verdict text
  is the one source of truth, the plugin never re-verifies tokens. Own
  row after arxa-sidebar; delete the row → stock dsh, package untouched.
  Rejected: a plan section inside arxa-sidebar's generated snippet (welds
  billing into a sidebar scoped "surgical only"; wall still homeless);
  host-only extension of arxa-gate (a refusal string is not a paywall).
  Wall position (which action is refused for Free — Run after a fully
  usable picker, vs entry to the scaffold stage) is still OPEN; it was
  asked against stale references and must be re-asked against the dsh
  scaffold flow.

- **D107 — Agency is NOT the Scale tier: two SKUs on two value axes;
  D30 and D102 both stand.** (2026-09-03, from
  `arxa/docs/research/payment-architecture/pricing-unit-seat-vs-org-vs-usage.md`,
  27 sources.) Pro = per developer seat (D104). Scale = D30 unchanged:
  $149/mo per org flat, unlimited seats, 3 released apps, +$49/app/mo
  beyond, 50,000 OTA installs, $1.50 per 2,500 over — billed on
  app-fleet volume because released apps and installs are the only things
  that cost arxa money and seats are not a cost driver. Agency = D102
  unchanged: per member seat, quantity bought by the org owner — billed
  on headcount because a 12-person agency gets ~12× a freelancer's value
  from the business sections. Agency sits beside the ladder, not on it:
  a Pro or a Scale customer can each add it. D30's "never per-seat" is
  scoped to the app-output ladder, not a company-wide rule. Paddle shape:
  Pro and Agency = subscription with `quantity = seats`; Scale = quantity
  1 plus a recurring per-app price; install overage cannot use a Paddle
  usage meter (no usage-records API) — meter externally and bill via
  `POST /subscriptions/{id}/charge` or a custom line item. Rejected:
  Agency folded into Scale per-org flat (no expansion lever on the
  business module — the documented flat-unlimited leak); per-org with
  seat bands (per-seat with extra steps; drags Scale back onto the seat
  axis). Open, in the research §6: Agency price band; minimum Agency
  seats (5 vs 10 in comparables); free viewer seats; whether a Pro seat
  and an Agency seat for the same person are one seat or two; Shorebird's
  current raw rate unverified (site unreadable 2026-09-02).

- **D108 — The wall is the engine gate at `arxa emit scaffold`, and only
  there; the plan card is always visible.** (2026-09-03; closes D106's
  open item.) Free users can run intake, design, eject and plan a
  scaffold with the agent; the stop is `gate_scaffold.dart:54`'s
  refusal (fail-closed, already in code). The `arxa-plan` host half
  observes that refusal and raises the `shell.overlay` wall carrying the
  verdict `reason` verbatim; the `sidebar.footer.action` plan card shows
  Free/Pro state throughout, so the wall is never a surprise. One gate,
  one source of truth. Rejected: also gating the scaffolder skill's
  methodology via D18's `arxa brief <stage>` (verb never built; moves the
  wall before the user has seen what arxa inferred — earlier than the
  value); refusing the tool call in the harness's arxa-gate row
  (duplicates the Dart verdict in JavaScript on the customer's machine —
  two sources of truth). Consequence: D18's stub-skill methodology
  protection is NOT in force for the scaffolder skill; the methodology
  text ships with the skill. Reopen only if skill-text piracy becomes
  measurable.

- **D109 — Pro and Agency stay separate seats; a bundled Pro+Agency seat
  price exists for the same person holding both.** (2026-09-03.) Claims
  stay distinct (`pro`-tier scaffold entitlement vs `agency`) on distinct
  axes, so D107 holds; an org owner can buy a combined seat at one Paddle
  price id below the sum of the two. A business-only member (accountant,
  PM) buys Agency alone and never pays for the pipeline; a developer
  without business duties buys Pro alone. Ledger: two claims, one price
  id. Rejected: Agency seat includes Pro (accountant pays for scaffold;
  Agency stops being "beside the ladder"; undercuts Pro for mixed teams);
  fully separate with no bundle (the double charge the research names as
  the churn trigger for agencies with in-house developers). Bundle
  discount size is a pricing number — see the price-band decisions.

- **D110 — Pro seat: $29/mo monthly, $24/mo billed annually.**
  (2026-09-03, from
  `arxa/docs/research/payment-architecture/pricing-bands-pro-and-agency.md`,
  19 readable pricing pages.) Generic per-developer tools cluster
  $10–20/seat (Cursor, Copilot, Retool; median $16); FlutterFlow — the
  one comparable doing the same design-to-app job — is $39 Basic / $80
  Growth per seat, and is the relevant comp. $29 sits in the upper half
  of the monetization plan's $20–40 assumption and under FlutterFlow
  Basic, so the pitch is "same job, cheaper, ships Flutter you own".
  ~17% annual discount matches the comparables. Leaves room for a
  Pro+Agency bundle (D109) under $50. Rejected: $39 (price-match
  FlutterFlow — peer positioning, weaker switch argument, bundle lands
  $55–60); $19 (IDE-assistant cluster — anchors arxa as a code helper,
  halves margin on the product's core value). USD; other currencies are
  Paddle's localized pricing, not separate decisions.

- **D111 — Agency seat: $19/mo monthly, $16/mo annually. Pro+Agency
  bundled seat (D109): $39/mo monthly, $32/mo annually.** (2026-09-03,
  same research file.) Agency internal-ops comparables (Productive,
  Scoro, Harvest, Teamwork, Float, Bonsai, Monday, ClickUp, Notion)
  median ~$19.50/seat, IQR $14.50–$25; Agency is a module inside the
  Studio, not a standalone PSA suite, so it prices at the median, not
  the top. A business-only member pays less than a developer, matching
  value. Bundle = $48 sum − $9 (−19%), landing on FlutterFlow Basic's $39
  for a seat that does both jobs. Rejected: $25 (top of IQR — earned
  only once accounting-lite and HR-lite ship, which are later phases);
  $14 (bottom of IQR — leaves the most on the table from 10+-seat
  agencies, whose seats scale with headcount). Paddle: three prices —
  `pro_seat`, `agency_seat`, `pro_agency_seat` — each monthly + annual.

- **D112 — No Agency seat minimum; free Viewer seats for clients and
  stakeholders.** (2026-09-03, same research file.) Agency turns on at 1
  paid seat — a freelancer can add it (D107) and the 14-day card trial
  (D104-era decision) converts on the smallest yes. None of 9 readable
  comparables require 10 seats (Productive's "10" is a wire-transfer
  threshold only); only Scoro floors at 5. Free viewer/guest seats are
  common (6 of 19: Float, Monday, ClickUp, Vercel, Figma, Webflow) and
  are the growth loop into paid seats. Viewer = a member role in the
  seat ledger with no `agency` claim and a read-only `viewer` claim:
  sees approvals, invoices, project status; cannot edit; never counted in
  Paddle `quantity`. Rejected: 3-seat minimum (no comparable does it;
  kills the freelancer path); no free seats (forces agencies to pay for
  read-only stakeholders — the per-head friction the research flags).
  This closes research §6's open pricing items: Pro band (D110), Agency
  band and bundle (D111), minimum seats and viewer seats (D112),
  one-seat-or-two (D109).

- **D113 — Scale replaces Pro seats: a Scale org has no Pro seats, every
  member scaffolds. Agency still stacks per seat on a Scale org, at the
  plain $19 (no D111 bundle, since scaffold is already org-wide).**
  (2026-09-03; advisor gap — D107 left stacking unstated.) The ladder is
  Free → Pro (per developer) → Scale (per org: everyone scaffolds, plus
  released apps and installs). The crossover — a 6+ developer team is
  cheaper on Scale ($149) than on Pro seats (6 × $29 = $174) — is
  intended: D30 holds that seats are not a cost driver and released apps
  are, and Scale orgs pay +$49/app beyond 3. Claim model: Scale grants
  the scaffold entitlement at org level, so the per-member `pro` seat
  claim is absent and the engine gate (D108) accepts the org-level
  claim. Rejected: Scale stacks on Pro seats (10 devs pay $290 + $149;
  contradicts D30's "unlimited seats"; Scale becomes a fourth line item,
  not a tier); Scale includes N seats then per-seat (the seat-band model
  D107 rejected). Ledger consequence: upgrading Pro → Scale cancels the
  org's `pro_seat` lines and starts one `scale` line; Paddle proration
  handles the mid-cycle switch.

- **D114 — Viewer is strictly read-only; approving, commenting,
  uploading and editing are paid-seat actions.** (2026-09-03; advisor
  gap — "sees approvals" in D112 was ambiguous.) A Viewer reads
  approvals, invoices and project status and nothing else. Client
  sign-off on a deliverable uses the existing per-item, token-scoped
  approval link (the approvals rail already carries per-item tokens),
  not the Viewer role — so a client can still approve without Viewer
  becoming a workable free seat. Rejected: read + approve items
  addressed to them (the owner names Viewers as approvers on
  everything and runs the shop on free seats); read + comment (the
  thread is where work happens; first step to the same leak). Matches
  Figma's View seat and Float's viewer. Enforcement: `viewer` claim
  grants read routes only; every mutating route requires `agency`.

- **D115 — Install overage becomes prepaid install packs; auto-buy is an
  opt-in toggle, off by default. Amends D30's overage line only; amounts
  unchanged.** (2026-09-03; advisor gap — Paddle has no usage-meter API,
  so post-hoc overage meant arxa reconciling usage itself and pushing a
  surprise one-time charge onto a tier sold as "flat".) Installs are
  sold in advance as one-time Paddle charges at D30's rate — e.g. a
  25,000-install pack at $15 ($1.50 per 2,500). When an org's allowance
  (50,000 bundled on Scale) runs out, OTA installs for that org pause
  until a pack is bought; the billing page offers "auto-buy a pack when I
  run out", off by default. Consent lands before the charge; "flat" stays
  true; the only Paddle primitive needed is the one-time charge that
  exists. Rejected: post-hoc overage as written (needs a reconciliation
  job and a customer-visible usage ledger first; chargeback bait above
  ~10% of orgs tripping the allowance); folding installs into the
  +$49/app fee with a hard cap (a viral app hits the cap with no way to
  buy more). Engine consequence: the install counter that gates OTA
  delivery must be server-side (Supabase, per org), not in the customer
  binary — the same fail-closed rule as the scaffold gate.

- **D117 — The Archives row: every org's archived sessions, trash-tiered
  deletion, one destructive door.** (2026-09-05 grill.) The sidebar gains
  an Archives section directly ABOVE the Trash row (lifecycle order
  top-down: tree → archives → trash), listing every org's archived
  sessions grouped by org — D39's sanctioned browse face; active views
  still never include archived rows. Entries carry exactly the trash row's
  two-button shape: **Restore** (bare `reviveSession` — the worktree is
  recreated from the parked branch, the row returns under its workspace;
  no dsh attach, that is the row click's job) and **Move to Trash**
  (reversible, normal ink). Archives never destroys. A trashed session is
  a LOGICAL trash entry (`kind: "session"` in `<org>/.arxa/trash` — its
  body is a registry row plus a parked branch, neither of which can move
  into a directory); the branch parks, D40's never-auto-deleted holds.
  The Trash row gains a Sessions group across ALL orgs (D82's own
  principle: the destructive door is visible the moment it exists) with
  Restore (row re-written verbatim, branch verified — loud typed refusals
  for repo-gone and branch-gone) and **Delete forever**: the ONE
  destructive door for a session, typed-name modal, remote-first branch
  delete when the owning repo is published (failure keeps the entry,
  idempotent retry; a live `prListForHead` check names the open PR the
  deletion would close — the CI/CD integration point), then local branch
  + squash-base ref + entry. Unpublished repos purge local-only, no link
  required. Rejected: purging from the Archives row directly (two
  destructive doors); remote-branch deletion at Move-to-Trash time
  (unmerged branches may back open PRs — closing them must be a
  deliberate, warned act). Consequences: folder-restore paths refuse
  session entries loudly (`trash.restore` routes them, `projecttrash
  .purge` refuses); the session-id mint feeds the trash's ghost rows so a
  newborn session never collides with a parked branch (the collision was
  live-caught in the probe — `worktree add` died on the re-minted name);
  dsh's `archivedSessionIds` keeps its no-unarchive-API residue (D39
  upstream note) — the arxa rows world ignores the set, so revived rows
  render regardless.
