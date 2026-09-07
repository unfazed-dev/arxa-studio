# Open work inventory — 2026-09-07

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
- `plugins/claude-code/selftest.account.mjs` is RED (pre-existing; cause not captured).
- `claude-signin-and-effort-selector.md` — F15 `claude auth status` probe swap deliberately deferred. (SDK vendoring blocker ✔ closed: `@anthropic-ai/claude-agent-sdk` 0.3.259 is in the payload.)
- `claude-subscription-engine.md` — phase 2 "Claude Code `plugins:` loading of arxa skill packs" not started.
- `composer-resume-breadcrumb-sidebar-sync.md` — proposed `pack-sidecar --check` for pack-list drift, not built.
- `mobile-flutter-migration-spec.md` — 11 unchecked build items (pairing screen, QR, iroh client, loopback proxy, reconnect, revocation, push relay, app identity…).
- `file-organisation-implementation.md` — Phase 6 has no completion marker (trash ✔ exists and was exercised today; cairn rail ✔ exists; `account/` mirror unverified).
- `agency-backend-provider-abstraction.md` — "PLAN ONLY — no code or schema changes".
- `git-card-sessions-worktree-rewire.md` — "Latent, not yet a bug" section.
- `artifact-viewer-docked-column.md` — T4 anchor "PENDING".

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
- **Direction question:** the `designs/arxa-studio(-v2)` web design-tool cluster (inspector-hover-uniform-widgets, provenance-routed-text-editing, studio-v2-boot-sequence-wiring, screen-vocabulary rename) is untouched since 2026-08-26/27 while desktop (Tauri) and kit/showcase_app (Flutter+Cairn) are the active tracks. Paused or abandoned? Answers whether ~20 unchecked items there are real.

### Code work still open
- `b2-sync-first-phase1.md` — cairn-infra mirror/sync, every TDD step unchecked.
- `arxa-kit-cairn.md` — Phases 0–6 backend port; Phase 6 deferred; open risks.
- `inspector-everything-as-widgets.md` / `inspector-hover-hit-testing-and-identity.md` — all steps unchecked (design-tool track, see direction question).
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
