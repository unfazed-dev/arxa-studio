# Open work inventory — 2026-09-07

> **Superseded 2026-09-12** by [`open-work-inventory-2026-09-12.md`](open-work-inventory-2026-09-12.md).
> Every row below was re-verified against current source and tests; several that read as open here
> closed since (Z.ai capability handoff, the cicd-card live GitHub smoke, the Claude sign-in surface),
> and the rest were re-evidenced with their owning closeout task. This file is kept as the historical
> read of 2026-09-07 — do not update it further.

Read of all 185 plan files (arxa-studio 65, arxa 120). Only items that still
read as open are listed; where a reader's claim was checkable in code it was
checked (noted as ✔ verified / ✘ still open).

## arxa-studio

### Blocked on a decision (yours)
- `arxa-studio-vocabulary-collisions.md` — "inventory complete, resolutions proposed, not yet decided".
- `zai-wire-params-capability-handoff.md` — `tool_stream` options A–D unresolved; temperature/top_p options open.
- `file-organisation-grill-agenda.md` — Q2 "Git repo boundaries in the tree (pending, asked)".
- `mobile-flutter-migration-spec.md` — "Biometric approvals… in-scope for v1 or deferred?"
- `sidebar-org-rethink.md` — "Delete-org is deferred" (org trash/purge now exists; the *direct* delete verb stays deferred).
- `project-sessions-physical.md` — whole design "deferred by decision (grill Q3)".
- `studio-startup-ready-when-open.md` — client bundle diet: measured not worth it (round 8); dsh core boot is upstream.

### Needs a human at the keyboard
- `desktop-shell-scaffold.md` / `mobile-grill-decisions.md` — notarization credentials ✘ (`xcrun notarytool store-credentials arxa-notary` fails: no profile); updater endpoint hosting placeholder.
- `claude-subscription-engine.md` — live quota smoke "the operator's call"; Linux token runs pending `claude setup-token`; Windows ACL rung unmeasured.
- `claude-signin-surface-models-page.md` — "NOT exercised live: a full Sign in"; stock Edit form for the binary field.
- `arxa-isolation-levels.md` — needs `sbx login`, then network posture / skill sharing / `--clone` checks; L4 "pending research".
- `zai-wire-params-test-battery.md` — "Live authenticated smoke remains the one open item".
- `artifact-viewer-demo-runbook.md` / `artifact-viewer-implementation.md` — acceptance checklist unrun; Lens visual gate re-run; live demo + version bump.
- `artifact-viewer-vscode-monaco.md` — worker routing "written but not yet exercised"; user on-screen verification; phase 3 same-origin extension-host iframe security review; phases 4–5 (autoSave, PDF, prettier→VS Code) deferred.
- `session-naming-agent-controls-and-cicd-card.md` — "NOT executed: any GitHub call" against a real repo; header pixels unobserved (headless binding).

### Code work still open
- `mobile-flutter-migration-spec.md` — 11 unchecked build items (pairing screen, QR, iroh client, loopback proxy, reconnect, revocation, push relay, app identity…).
- `agency-backend-provider-abstraction.md` — "PLAN ONLY — no code or schema changes".
- `artifact-viewer-docked-column.md` — T4 anchor "PENDING" (sidebar Files rows over the T3 tree route). **Held:** it lands on exactly the sidebar surface the coming grill covers.
- `claude-signin-and-effort-selector.md` — F15 `claude auth status` probe swap deliberately deferred. (SDK vendoring blocker ✔ closed: `@anthropic-ai/claude-agent-sdk` 0.3.259 is in the payload.)
- `claude-subscription-engine.md` — packaging half of phase 2: WHICH skill packs ship in the bundle (the loading mechanism is done, below). Grill material.

### Closed 2026-09-07 (this session)
- `plugins/claude-code/selftest.account.mjs` RED ✔ — it hung, it did not fail: the login harness's fake child only exited on a stdin write or a kill, so `signout` after a login awaited a `close` that never came. Harness fixed, and the product gap it exposed closed with it — `run()` is now bounded (a wedged `claude auth logout` is killed and surfaces a timeout instead of spinning the card forever). 10 ok.
- `composer-resume-breadcrumb-sidebar-sync.md` pack-list drift ✔ — `scripts/pack-manifest.mjs` (BIN_FILES + a scan of what the launcher actually loads), `pack-sidecar --check`, CI suite `scripts/pack-list-check.mjs`. Catches the 2026-09-02 regression (`missing: ['materialise-preset.mjs']` against the old list). Built static, not as the proposed boot-the-binary check.
- `claude-subscription-engine.md` phase 2 mechanism ✔ — `plugins/claude-code/lib/skill-packs.js` + the SDK `plugins:` option on every turn, `skipMcpDiscovery: true`, roots `ARXA_SKILL_PACKS` → `$ARXA_HOME/skill-packs` → bundled. 5-case selftest.
- `git-card-sessions-worktree-rewire.md` "Latent, not yet a bug" ✔ — no tie exists: dsh's dock rows are `todo` 0 and `queue` 20, the arxa card is 15. Nothing to change.
- `file-organisation-implementation.md` Phase 6 `account/` mirror ✔ — built and wired as an OPTIONAL rail in `file-org-shell/lib/lifecycle.js` (default absent, attaches only when a provider is configured); both states covered in `plugins/file-org-shell/selftest.mjs`. The plugin is a pure library, so its absence from `profile/cordis.patch.yml` is correct, not a gap.

### Blocked upstream (dsh / Flutter)
- No resume verb until dsh has a contentless wake; no `job.*` RPC (dsh-side API).
- dsh core boot ~1.2 s module I/O (startup plan).

### Stale bookkeeping, not real work (verified)
- `open-items-completion.md` / `session-execution-log.md` — Wave 1 ✔, Wave 2 sidebar wiring ✔ (`card.pr.merge`, `version.mint`, runner wake, D111, asleep chips in code), Phase 0b snapshots ✔ (3 files); Wave 3 e2e + S1 flip unverified. TOPO/TESTO registries are gone (purged today).
- `claude-subscription-engine-implementation.md` — 89 unchecked boxes but D1–D10 shipped per its own tail.
- `HANDOFF-file-org-shell.md` — Phase C ✔ DONE (d80ff9f). `entitlement-auto-refresh.md` — test ✔ exists.
- `git-card-phase-4-card-rebuild.md` superseded by `git-card-stock-dock-rebuild.md`.

## arxa

### Ship-blockers (baseline `arxa-remaining-work.md`, 2026-08-05, still open per `entitlement-backend-runbook.md` 2026-09-01)
- Replace `Entitlement.publicKey`, delete `mint --dev` (dev-key swap).
- Stripe products/webhook; `arxa login` + PKCE refresh; Google/Apple OAuth (external dev accounts, "dashboard-manual").
- Self-service deactivation "not yet deployed or exercised"; air-gapped buyers unaddressed.
- `stub-remediation.md` — payments stub needs Merchant ID + CSR (external cert); `monetization-and-entitlements.md` — Stripe/JWT dunning-clock desync untested.
- Business: holdco/opco setup, Stripe + Apple Developer accounts.

### Blocked on a decision (yours)
- `inline-generative-ui-in-dsh.md` — "decisions proposed (not yet ratified)".
- `flows-answers-ssot-and-canvas-undo.md` OPEN-1; `scaffold-shell-spine-verification.md` "composer is broken on both scaffold screens… pending lead's call"; `q13-parallel-run-design-shell.md`; `intake-build-project-aware.md`; `widget-panel-vocabulary-reconciliation.md` "execution pending go-ahead"; `screen-vocabulary-identifier-rename.md` (migrate v1 or pin it).
- `arxa-memory-and-payment.md` / `consolidate-one-app-plus-daemon.md` — price point O2 still open.
- **Direction question — ANSWERED 2026-09-07 (abandoned).** arxa studio is now a dsh fork, so the studio no longer designs itself through the design tool. `designs/arxa-studio-v2` is archived to `archives/arxa-studio-v2/` (arxa `cbf4e82b`); `GateContext.studioDesignDir` now points at the in-tree v1 tree, which arxa's own gates, probes and flow-services parity suite still run against. The ~20 unchecked items in inspector-hover-uniform-widgets, provenance-routed-text-editing, studio-v2-boot-sequence-wiring, inspector-everything-as-widgets, inspector-hover-hit-testing-and-identity and screen-vocabulary-identifier-rename are therefore NOT real work — superseded, pending the docs pass after the grill.

### Code work still open
- `b2-sync-first-phase1.md` — cairn-infra mirror/sync, every TDD step unchecked.
- `arxa-kit-cairn.md` — Phases 0–6 backend port; Phase 6 deferred; open risks.
- `arxa-engine-llm-fabric.md` — "decided 2026-07-29, not yet built".
- `arxa-harness-and-distribution.md` — dictionary + gates (W4) not built; section H deferred.
- `arxa-dart-only-tooling.md` — `generate_view` flow not started.
- `distribution-and-platforms.md` — Windows/Linux packaging "unresearched".
- `native-glass-theme-propagation.md` — "one instrumented device run" outstanding.
- Showcase app on-device passes: `glass-chrome-root-cause-fixes.md` (4 boxes), `snackbar-native-scrim-tier-split.md` (impl, tests, video).
- `fidelity-mode-config.md` — kit impl + tests, lint/gate updates, Android strict-floor SDK decision.
- `provenance-routed-text-editing-and-font-menu.md` — router "no route or view yet".
- `arxa-data-model-decisions.md` — "code-complete, not deployed"; follow-ups flagged.
- `design-filename-law.md` — naming gate not enforced mechanically.
- `handoff-l10n-w7.json` — Dart locale lookup wiring.
- `showcase-law-application.md` — "B (Search): title pill absent at rest — OPEN".
- Enterprise tier: org seat policy, permission-matrix enforcement in Edge Functions, admin/business shell surfaces; 4 shells `surface: null`; 3 pre-existing selftest failures.

### Blocked upstream
- `liquid-glass-reappear-on-back.md` — Flutter #93757 / #148639 open.
- `htmx-no-reload-interaction.md` — swap-state loss items; `<details>` won't-fix.
