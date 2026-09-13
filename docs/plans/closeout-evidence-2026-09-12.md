# Closeout evidence matrix — 2026-09-12 program (Task 16)

Every acceptance gate the closeout program names, one row per leg. Classes:
`scratch` (no credentials, no operator state) · `authenticated` (needs an
account/credential the operator must authorize per-leg) · `physical` (needs a
device) · `CI-runner` (needs the pushed branch on a runner) ·
`operator-machine` (needs a daemon/VM only the operator starts).

Results: **DONE** (run, artifact stored) · **PREPARED** (not run —
authorization or prerequisite pending; command is verbatim-runnable) ·
**EXTERNAL** (owner outside this branch; prepared command recorded). No
authenticated/physical leg is ever marked DONE without the operator's
explicit per-leg authorization (program law).

Studio HEAD at Part A execution: `8e3bc01` (`closeout-2026-09-12`).
Arxa worktree HEAD: `5930302d` (`closeout-2026-09-12`). All Part A legs ran
2026-09-14.

| id | gate | class | command (verbatim) | commit | result | artifact | unresolved external prerequisite |
|---|---|---|---|---|---|---|---|
| G1 | card-cicd-smoke rerun (T6) | authenticated | `node scripts/card-cicd-smoke.mjs --yes` | studio 8e3bc01 | PREPARED | — | operator authorization; GitHub private-repo Actions minutes restored (quota) |
| G2 | A4 real Docker container leg (T10) | operator-machine | `ARXA_A4_REAL_SMOKE=1 node plugins/sandbox/selftest.devcontainer.mjs` | studio 8e3bc01 | PREPARED | — | operator starts Docker daemon (never the agent); watch `row.head` reachability mid-fetch (`plugins/sandbox/lib/devcontainer.js:456`) |
| G3 | A5 real sbx leg (T11) | authenticated + mutating | `ARXA_A5_REAL_SMOKE=1 node plugins/sandbox/selftest.sbx.mjs` (after `sbx login` OAuth device flow; reviewed global deny-all; disposable sandbox lifecycle; recovery ref; cache accounting) | studio 8e3bc01 | EXTERNAL (owner: operator) | — | explicit per-leg authorization — mutates operator sbx state/policy; `sbx ls --json` field-shape reconciliation rides the same authorized session |
| G3a | sbx v0.42.1 official release-feed measurement (SBX_PIN fill) | scratch | sandboxed fetch of `api.github.com/repos/docker/sbx-releases/releases/tags/v0.42.1` (asset names + server-computed sha256 digests; darwin tar.gz cross-checked by streamed hash) | studio 8e3bc01 | DONE | this file §G3-notes; `plugins/sandbox/lib/sbx-install.js` `SBX_PIN` | — |
| G4 | Supabase real stack leg (T14) | operator-machine | `node scripts/workspace-provider-supabase-smoke.mjs --real` (CI: `supabase-conformance` job) | studio 8e3bc01 | PREPARED | — | operator starts Docker daemon; pinned CLI 2.67.1; verify `status -o env` key names (`SUPABASE_URL`/`ANON_KEY`/`SERVICE_ROLE_KEY`) on first live run |
| G5 | Claude signed-in smoke (Step 3) | authenticated | `node scripts/claude-code-smoke.mjs --yes` | studio 8e3bc01 | PREPARED | — | operator authorization + signed-in `claude`. Linux resume/Bash-escape rungs are **N/A on macOS** (recorded, not skipped silently) |
| G5a | bundled skill-pack set stays empty — policy test | scratch | `node plugins/claude-code/selftest.skill-packs.mjs` | studio 8e3bc01 | DONE | `plugins/claude-code/selftest.skill-packs.mjs` (bundled-root-empty row) | — |
| G6 | Z.ai live smoke (Step 4) | authenticated | `ZAI_API_KEY=<resolved by operator, never printed> node scripts/zai-live-smoke.mjs` | studio 8e3bc01 | PREPARED | — | authorized credential path; requires a real successful response + intended model/wire params |
| G7 | Viewer gate (Step 5) | scratch (mostly) | `node scripts/evidence-capture-narrow.mjs --width 1280 --surface finish --surface backend --surface langstrip --surface viewer-strip` (the Part A fresh-boot probe; one studio boot per run, sequential single-Chrome pairs) + per-leg rows in §G7-notes | studio 8e3bc01 | DONE (fresh-boot legs, 2026-09-14; per-leg rows in §G7-notes) | `designs/evidence/studio-closeout-2026-09-12/` | LSP-diagnostics live row = limitation per §Escalated E1 (owner + trigger recorded) |
| G8 | Mobile physical gates (Step 6) | physical | per-leg commands in `mobile_flutter/deploy/physical-gates.md` (arxa worktree) | arxa 5930302d | PREPARED (per-leg) | `mobile_flutter/deploy/evidence/closeout-2026-09-12/` (dir created Part A) | devices + credentials; every leg incl. `PHASE=phone` real-APNs doorbell |
| G9 | Release gates (Step 7) | authenticated | `bash desktop/scripts/sign-and-notarize.sh` (script lives in the ARXA worktree; `bash -n` green Part A) + first live `release-linux` tag + clean-machine installer verify | studio 8e3bc01 | EXTERNAL (owner: operator) | — | explicit authorization (never mark complete without it); keychain profile `arxa-notary` absent (AXS-019) |
| G10 | Omarchy VM + container lanes (T15) | operator-machine | runbook + assertions in arxa `docs/linux-support.md`; container lane `DISTRO=ubuntu scripts/linux/run-container.sh` | studio 8e3bc01 | EXTERNAL (owner: operator) | — | operator VM + daemon; first `desktop/**` PR runner pass (AXS-043) |
| G11 | First CI green run + branch protection (T12) | CI-runner | operator pushes branch → runner executes `check.sh`; then branch protection per `docs/ci/setup.md` contexts | studio 8e3bc01 | EXTERNAL (owner: operator) | — | operator push; `check.sh gates` area red = pre-existing repo-wide debt (intake/coverage/advertise-digests/approvalTokens — separate owner) |
| G12 | T12 residual Step 5 — simulator integration smoke | scratch (heavy) | `fvm flutter test integration_test/approvals_e2e_test.dart -d <disposable-sim-id> --dart-define=PHASE=smoke` (see §G12-notes) | arxa 5930302d | PREPARED (RAM-discipline deferral, §G12-notes) | §G12-notes | — |
| G12b | T12 residual Step 8 — `arxa deploy --self-test` | scratch | `arxa deploy --self-test` (arxa worktree `.build/arxa`) | arxa 5930302d | DONE (2026-09-14, exit 0, 12/12 — incl. `deploy halts without approval`) | `mobile_flutter/deploy/evidence/closeout-2026-09-12/g12b-deploy-selftest.log` (arxa worktree) | — |
| G12c | T12 residual Step 8 — release-automation without publishing | scratch (heavy) | disposable-keystore `flutter build appbundle --release` + `flutter build apk --release`; iOS stops at `fastlane ios doctor` | arxa 5930302d | PREPARED (RAM-discipline deferral, §G12-notes) | §G12-notes | — |
| G13 | tree-endpoint 404 in IGNORED mask (T8 minor) | scratch (decision) | decision row — keep-with-justification (see §G13-notes) | studio 8e3bc01 | DONE (decision) | this file §G13-notes | — |
| E1 | Escalated: L1/L2 viewer LSP chain dead on fresh boots | scratch (adjudication) | fresh-boot probe (G7 command, `langstrip`/`viewer-strip` pairs) | studio 8e3bc01 | DONE (adjudicated: REPRODUCED → pre-existing defect, keep rows; §Escalated) | `designs/evidence/studio-closeout-2026-09-12/` | product fix = artifact-viewer owner (external) |
| E2 | Escalated: conversation dock dead on fresh boots | scratch (adjudication) | fresh-boot probe (G7 command, `finish` pair — FAILURE-STATE row if `[data-git-dock]` never mounts) | studio 8e3bc01 | DONE (adjudicated: REPRODUCED → keep limitation + external rows; §Escalated) | `designs/evidence/studio-closeout-2026-09-12/` | operator's installed studio = daily counter-evidence (RIDE condition); product fix = arxa-git-card + dsh conversation-input owners |
| E3 | Escalated: L3 `window.__arxaWorkspaceProvider.info()` fails on fresh boots | scratch (adjudication) | fresh-boot probe (G7 command, `backend` pair) | studio 8e3bc01 | DONE (adjudicated: REPRODUCED → keep limitation + external rows; §Escalated) | `designs/evidence/studio-closeout-2026-09-12/` | product fix = workspace-provider owner (external) |

## G3-notes — sbx v0.42.1 feed measurement (2026-09-14)

Feed EXISTS: `github.com/docker/sbx-releases` tag `v0.42.1`, published
2026-09-07. 22 assets; no `checksums.txt` asset, but every asset carries a
server-computed `sha256:` digest in the release API — that is the
authoritative measurement source (same trust root the provenance/SBOM
attachments ride). The shipped `SBX_PIN` had assumed Go-style
`sbx_<ver>_<os>_<arch>.tar.gz` names; the real darwin artifact is a single
universal `DockerSandboxes-darwin.tar.gz` (no arch suffix). Pins filled
accordingly (darwin-amd64 and darwin-arm64 share the universal file):

| pin key | file | sha256 |
|---|---|---|
| darwin-arm64 | DockerSandboxes-darwin.tar.gz | `3c5738c489fbeac8f6c85533101c7229f4ce39106f823afde66d70469b758df1` |
| darwin-amd64 | DockerSandboxes-darwin.tar.gz | `3c5738c489fbeac8f6c85533101c7229f4ce39106f823afde66d70469b758df1` |
| linux-arm64 | DockerSandboxes-linux-arm64.tar.gz | `285b36cdb46ce65f792f006869698f2664fcde8adc1e8524357f150f9368dd4c` |
| linux-amd64 | DockerSandboxes-linux-amd64.tar.gz | `fe46facba420d1cb8b1dad57d5b182d6df9dadd46c324c2ca3ef574fb7eada6f` |

Network effect: read-only public GitHub fetches (API + one streamed
darwin-tar.gz hash cross-check); no operator state touched; nothing
downloaded onto operator paths (hash computed from the stream, bytes
discarded). Quota effect: none metered.

## G7-notes — viewer gate legs

Fresh-boot probe legs (DONE 2026-09-14 at HEAD `8e3bc01`; one studio boot
per wrapper run against a `mkdtemp` scratch ARXA_HOME; sequential
single-Chrome pairs; token-redacted logs):

| leg | runbook face | result | evidence |
|---|---|---|---|
| finish | §Escalated E2 | FAILURE STATE recorded honestly — session creates, opens via row, conversation binds, composer activates; `[data-git-dock]` never mounts | `narrow-capture-logs/1280-finish.log`; `1280/finish-failed-{light,dark}-1280.png` |
| backend | §Escalated E3 | FAILURE STATE card — provider keys (`info,section,namespace`) present; model errors `connection: invalid server-response result` | `narrow-capture-logs/1280-backend.log`; `1280/workspace-backend-model-{light,dark}-1280.png` |
| langstrip | §Escalated E1 | MISSING — no diagnostic squiggles for ts/css/json, no html preview iframe | `narrow-capture-logs/1280-langstrip.log` |
| viewer-strip | §Escalated E1 | MISSING product state — `dart state: {"strip":false,"editor":true}` light+dark: the editor mounts, the "install its SDK" strip never renders | `narrow-capture-logs/1280-viewer-strip.log`; `1280/viewer-install-strip-{light,dark}-1280.png` |

Runbook legs beyond the probe:

- HTTP-semantics legs (expired token 403, GET-only artifact origin, conflict
  refusal, SSE deny-default, tree-read mint) — asserted green by the
  artifact-viewer selftest suites inside the full `npm test` run (report §Part
  A); the runbook defines no live demo leg for them.
- Autosave / diff / dart-present — the 2026-09-13 evidence (demo-runbook §7)
  stands but is env-coupled: captured on a boot whose LSP servers came through
  the person-pressed install door, which fresh scratch boots cannot reproduce
  (the E1 chain). Fresh-boot reproduction = blocked by E1.
- Person-driven demo legs (§1–§5: dock/drag/maximize/sheet/session-switch) —
  interactive; the headless sheet-entry gap is documented in §7 → PREPARED
  (operator demo; no authorization needed, just a person).
- LSP-diagnostics live row — limitation per §Escalated E1; not closable in
  this branch (pre-existing at BASE).

## G12-notes — T12 residual legs

G12 and G12c **deferred to PREPARED** under RAM discipline (the brief's
ruling): two OOM-killed workers hit this machine on 2026-09-14 (an earlier
capture worker and Task 16 attempt 1), and a booted iOS simulator + Gradle
daemon are exactly the toolchain class that OOM'd. Rerun on an idle machine —
commands verbatim. **G12b ran** (light, toolchain-free by design — §17):
exit 0, 12/12 shapes passed including the `deploy halts without approval`
invariant; evidence `mobile_flutter/deploy/evidence/closeout-2026-09-12/g12b-deploy-selftest.log`.

| leg | command |
|---|---|
| G12 simulator smoke | `xcrun simctl boot "iPhone 16"` (disposable sim) → `cd mobile_flutter && fvm flutter test integration_test/approvals_e2e_test.dart -d "iPhone 16" --dart-define=PHASE=smoke` (scratch engine boot per `mobile_flutter/deploy/physical-gates.md` §0) |
| G12b deploy self-test | `arxa deploy --self-test` (arxa worktree CLI) |
| G12c release automation, no publishing | `keytool -genkeypair -v -keystore /tmp/arxa-t16-disposable.jks -alias arxa -keyalg RSA -keysize 2048 -validity 10 -storepass disposable-t16` → wire via scratch signing config → `fvm flutter build appbundle --release` + `fvm flutter build apk --release` → `cd ios && fastlane ios doctor` (STOPS THERE — no submit); keystore destroyed after |

None of the three touches credentials or publishes anything — they stay
scratch legs whenever they run.

## G13-notes — tree-endpoint 404 mask (decision)

**KEEP, with justification.** The IGNORED entry is path-anchored
(`/__arxa\/artifacts\/tree/`, `scripts/evidence-gate.mjs:103-107`) and
documents its own cause: the same org-open-coupled chain as E1 makes
expanding a tree dir on a fresh boot answer 404. It masks exactly that shape,
not 404s in general — unfiltered 404s still fail the gate, and today's fresh
runs never even triggered this mask (the filtered lists show only the dial
4319 + favicon lines). Tightening it now would fail unrelated surfaces on a
pre-existing upstream defect owned by E1's follow-up. One-line decision:
keep — narrow, justified, self-documenting, currently inert; revisit
alongside the E1 fix.

## Escalated adjudications

All three findings reproduced at HEAD `8e3bc01` on fresh scratch boots,
2026-09-14. Probe logs: `designs/evidence/studio-closeout-2026-09-12/
probe-launch.log` (finish + backend legs) and `probe-launch-2.log`
(viewer-strip + langstrip legs); pair logs `…/studio-closeout/narrow-capture-logs/1280-*.log`;
structured rows `…/narrow-capture-log.json`.

- **E1 — L1/L2 viewer LSP chain dead on fresh boots**
  (`plugins/artifact-viewer/lib/index.js:183-191`): **REPRODUCED — keep as
  pre-existing defect row** (owner: artifact-viewer owner; trigger: any fresh
  scratch boot — the token→`/lsp/status`→ws chain 403s without the
  person-pressed install door). No ts/css/json squiggles, no html preview
  iframe; dart-absent boots mount the editor with no strip
  (`strip:false, editor:true`, light+dark shots). T8-diff-innocent
  (established at escalation; identical at HEAD). The committed 2026-09-13
  §7 evidence stands as richer-env evidence, marked env-coupled in the ledger
  — the branch does not close on it.
- **E2 — conversation dock dead on fresh boots: REPRODUCED — keep limitation
  rows + external row.** The finish leg's fresh session creates, opens via
  row, binds (`__ARXA_SIDEBAR__.boundSession()` answers the fresh session),
  activates the composer — and the `conversation.input.dock` slot never
  renders, so no `[data-git-dock]` and finish/checks-red/confinement cannot
  mount. The RIDE condition is respected: the operator's installed studio
  mounts docks daily (counter-evidence); the branch records honest
  FAILURE-STATE rows instead of closing on stale dock evidence.
- **E3 — L3 `window.__arxaWorkspaceProvider.info()` fails on fresh boots:
  REPRODUCED — keep limitation + external row** (owner: workspace-provider
  owner). Provider keys are present (`info,section,namespace`); the live
  model errors `connection: invalid server-response result`; failure-state
  card captured light+dark. T8-innocent (4 locale lines).
- Fix loop: none of the three is branch-caused (each measured pre-existing at
  BASE during escalation; the T8 diffs are literals→`t()` only) → documented
  limitation/external rows per brief deliverable 5's else-branch. No product
  fix attempted in this task.

## Prep verification (Step 1)

2026-09-14, Part A. Every gate script named in the matrix:

| check | result |
|---|---|
| parse | `node --check` green: `scripts/card-cicd-smoke.mjs`, `plugins/sandbox/selftest.{devcontainer,sbx}.mjs`, `scripts/workspace-provider-supabase-smoke.mjs`, `scripts/claude-code-smoke.mjs`, `scripts/zai-live-smoke.mjs`, `scripts/evidence-gate.mjs`, `scripts/evidence-capture-narrow.mjs`. `bash -n` green: `desktop/scripts/sign-and-notarize.sh` (arxa worktree). `approvals_e2e_test.dart` present, line-cites re-verified (see G8). |
| path fix | the draft G9 row cited `desktop/src-tauri/sign-and-notarize.sh`, which does not exist in the studio tree — the real script is `desktop/scripts/sign-and-notarize.sh` in the arxa worktree; row corrected. |
| scratch isolation | capture wrapper boots the studio under a `mkdtemp` scratch ARXA_HOME and kills the process tree after; the real-leg smokes gate behind env flags (`ARXA_A4_REAL_SMOKE` / `ARXA_A5_REAL_SMOKE` / `--real` / `--yes`) so their default runs stay fake/safe. |
| secrets | no hardcoded secret shapes in any script (grep `sk-…`/`AKIA…`/`ghp_…`/`xox…`/`BEGIN PRIVATE KEY`: none); `zai-live-smoke.mjs` reads `ZAI_API_KEY` from env only; notarization rides `--keychain-profile arxa-notary`, never a printed secret. |
| log redaction | the wrapper redacts `token=` in every persisted log (`evidence-capture-narrow.mjs:217,336`); Part A's nohup probe logs were re-redacted after the redirect bypassed the wrapper's stdout path (ledger row). |
| quota / network effects | per row: G3a = read-only public GitHub API fetches (§G3-notes); G1 consumes private-repo Actions minutes; G6 makes one metered Z.ai call; physical/CI rows mutate nothing outside their device/runner. |
