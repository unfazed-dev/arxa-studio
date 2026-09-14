# Task 16 brief — Authenticated and physical acceptance gates (Part A: preparation + scratch-safe legs)

Plan section: docs/superpowers/plans/2026-09-12-arxa-studio-closeout.md ### Task 16 (lines 465–488). Program law overrides everything: **never run a paid, authenticated, credential-bearing, or operator-state-mutating gate without EXPLICIT operator authorization** (each leg named, per-leg yes). Never start the operator's Docker daemon/VM. Never push/tag/release. Canonical checkouts read-only. Scratch ARXA_HOME only. Never print secrets/tokens/.env values.

## Split ruling (controller)

- **Part A (this dispatch, no authorization needed):** Step 1 prep for ALL gates; the evidence matrix with every leg classified; scratch-safe executions only; adjudication of the escalated product findings; fix loop for in-repo failures. Commit + report.
- **Part B (later, per-leg):** authenticated/physical legs run ONLY after the operator explicitly authorizes each. The Part A report ends with the authorization request list; the controller surfaces it to the operator. No implementer ever decides an authenticated leg is "probably fine".

## Deliverables (Part A)

1. **Create `docs/plans/closeout-evidence-2026-09-12.md`** (studio repo) — the redacted evidence matrix. Columns per plan interface: gate id, command (verbatim, runnable), environment class (scratch / authenticated / physical / CI-runner / operator-machine), commit, result (DONE with artifact | PREPARED (not run, authorization/prereq pending) | EXTERNAL (owner + prepared command)), artifact path, unresolved external prerequisite. Every row below must appear; add any the governing runbooks name.
2. **Verify/extend `mobile_flutter/deploy/physical-gates.md`** (arxa worktree) — created by the T12 fix round (review Important 1). Check it covers every Step-6 leg (pair/reconnect/notification presentation+tap/approval decision/unpair+revocation + iOS/APNs + Android/FCM/APK legs + `approvals_e2e_test.dart` shapes + redaction rules); extend only where gaps remain.
3. **Prep-verify every gate script** (Step 1): parse check (`node --check` / `sh -n` / `ruby -c` as fits), scratch-path isolation confirmed by reading the script, secrets only from credential stores/env (assert no hardcoded), log redaction verified (grep the script for print/log of token/key/value shapes), expected quota/network effects stated in the matrix row.
4. **Scratch-safe executions allowed now** (run only these): SBX_PIN checksum measurement for official sbx v0.42.1 (public release-feed metadata fetch; fill pins or record the feed's absence); viewer demo-runbook legs that need no auth IF the escalated findings below don't block them (record per-row); `arxa deploy --self-test` and unsigned/debug artifact legs of mobile Step 8 IF RAM allows (one at a time; disposable keystore created+destroyed in-scratch; iOS stops at `doctor`). Anything touching credentials/network accounts: PREPARED only.
5. **Adjudicate the escalated findings** (diagnosis-first; fix test-first ONLY if the fault is in this branch's diff scope; else documented limitation/external row):
   - **L1/L2 viewer LSP chain dead on fresh boots** (plugins/artifact-viewer/lib/index.js:183-191; token route 403s without `selectedOpenRoot`; ws handshake fails; no ts/css/json squiggles; dart-absent strip never renders). T8-diff-innocent. Either fix (RED on fresh-boot probe → minimal fix → focused suites) or record as pre-existing defect row with owner + trigger.
   - **Fresh-session conversation dock dead on fresh boots at all widths** (arxa-git-card injection slot never mounts; ruled RIDE at T8 re-review — condition: branch must not close on stale dock evidence). Attempt ONE fresh-boot reproduction at HEAD (scratch home, free port). If it reproduces: keep limitation rows + external row (operator's installed studio mounts docks daily = the counter-evidence). If it does NOT reproduce at HEAD: capture the control evidence and close the condition.
   - **L3 `window.__arxaWorkspaceProvider.info()` fails on fresh scratch boots** ("connection: invalid server-response result"). Same treatment: reproduce-or-close at HEAD, fix only if branch-caused.
6. **Fix loop (Step 8)** for any in-repo failure found above: minimal regression test → fix → focused re-run → full relevant suite → separate commit.
7. **Commit:** matrix + runbook + prep under `test: record authenticated and physical closeout evidence` (studio repo; arxa-side files commit in the arxa worktree under the same message); product fixes as their own `fix:` commits. Trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`. Store studio evidence under `designs/evidence/studio-closeout-2026-09-12/`, mobile evidence under `mobile_flutter/deploy/evidence/closeout-2026-09-12/` (arxa worktree).

## Gate inventory (matrix rows; from the SDD ledger)

| id | gate | class | command / prereq |
|---|---|---|---|
| G1 | card-cicd-smoke rerun (T6) | authenticated | `node scripts/card-cicd-smoke.mjs --yes`; prereq: GitHub private-repo Actions minutes restored (quota) |
| G2 | A4 real Docker container leg (T10) | operator-machine | `ARXA_A4_REAL_SMOKE=1` path; prereq: operator starts Docker daemon; watch: row.head reachability mid-fetch throw (devcontainer.js:456) |
| G3 | A5 real sbx leg (T11) | authenticated+mutating | `ARXA_A5_REAL_SMOKE=1` + OAuth device flow + reviewed global deny-all + disposable sandbox lifecycle + recovery ref + cache accounting; prereq: explicit authorization (mutates operator sbx state/policy); SBX_PIN v0.42.1 checksums (scratch-safe part runs in Part A); `sbx ls --json` field-shape reconciliation |
| G4 | Supabase real stack leg (T14) | operator-machine | `node scripts/workspace-provider-supabase-smoke.mjs --real` (or CI `supabase-conformance` job); prereq: Docker daemon + pinned CLI stack; verify `status -o env` key names (SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY) |
| G5 | Claude signed-in smoke (Step 3) | authenticated | full signed-in smoke; Linux resume/Bash-escape rungs N/A on macOS — record; bundled skill-pack set stays empty + test asserting that policy (scratch-safe: write the test in Part A if absent) |
| G6 | Z.ai gate (Step 4) | authenticated | `node scripts/zai-live-smoke.mjs` with authorized credential path; requires actual successful response + intended model/wire params |
| G7 | Viewer gate (Step 5) | scratch (mostly) | complete docs/plans/artifact-viewer-demo-runbook.md legs: expired token, GET-only artifact origin, conflict, LSP diagnostics, autosave, diff, viewport ladder — LSP row blocked by L1/L2 adjudication above |
| G8 | Mobile physical gates (Step 6) | physical | follow mobile_flutter/deploy/physical-gates.md (you write it); `mobile_flutter/integration_test/approvals_e2e_test.dart` + iOS/APNs + Android/FCM/APK legs; prereq: devices + credentials |
| G9 | Release gates (Step 7) | authenticated | notarization (AXS-019: keychain profile `arxa-notary` absent — prep validated) + first live `release-linux` tag + clean-machine manifest/installer verify; prereq: explicit authorization; NEVER mark complete without it |
| G10 | Omarchy VM + container lanes (T15) | operator-machine | runbook + assertions in arxa docs/linux-support.md; prereq: operator VM + daemon; also first desktop/** PR runner pass (AXS-043) |
| G11 | First CI green run + branch protection (T12) | CI-runner | after operator pushes; check.sh `gates` area red = pre-branch repo-wide debt (intake/coverage/advertise-digests/approvalTokens) — separate owner, not this branch |
| G12 | T12 residual Steps 5/8 | scratch(heavy) | simulator integration smoke (Step 5) + release-automation-without-publishing (Step 8) — PENDING T12 task-review adjudication: run in T12 fix round if the reviewer rules them in-scope, else run here under RAM discipline |
| G13 | tree-endpoint 404-in-IGNORED mask (T8 minor) | scratch | decision row: keep-with-justification or tighten filter; one-line either way |

## Constraints

Global constraints verbatim from the plan apply (behavior-TDD, no push/merge/tag/publish, no secrets printed, scratch state only, findings → ledger "New finding:" lines). RAM: one suite/toolchain at a time, kill between; no browsers except the single dock-dead reproduction probe (CDP headless, 480s budget). Disk: system ~2 GiB — caches into the worktree volume. If a hook refuses a compound command, split it. No subagents.

## Report

Full report → `.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-16-report.md` (## Part A): per-deliverable evidence, adjudication outcomes (L1/L2, dock-dead, L3) with probe logs' paths, matrix row statuses, prep-verification table, commits, concerns. Reply under 15 lines: status; adjudication one-liners; scratch-safe legs run; matrix row counts (DONE/PREPARED/EXTERNAL); commits; the authorization request list (gate ids + one-line cost/mutation each); concerns.
