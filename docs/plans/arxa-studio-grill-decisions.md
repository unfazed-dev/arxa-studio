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

## Open

- (none — grill closed through D35; all five parked questions from
  agency-backend-provider-abstraction.md settled (D32–D35 + hosted
  note); installation process being nailed down live)
