# Arxa Studio Closeout Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. The lead controller dispatches a fresh implementer subagent and then a fresh independent verifier/reviewer subagent for every task; implementer subagents do not dispatch their own helpers. The verifier reruns the task's focused tests, smoke tests, and required full gate rather than trusting the implementer's report. Use `superpowers:using-git-worktrees` before implementation, `superpowers:test-driven-development` for every behavior change, and `superpowers:verification-before-completion` before every completion claim. Steps use checkbox (`- [ ]`) syntax for durable tracking.

**Goal:** Close every currently evidenced arxa-studio plan item, correct stale plan status, finish release and live-verification gates, and leave one truthful zero-open-items ledger.

**Architecture:** Execute serially on one arxa-studio integration worktree, with a second isolated worktree for the sibling `arxa` repository only when a task explicitly names it. Small correctness and Git-flow work lands first, followed by confinement, the new provider data plane, localization, release-surface validation, live evidence, and documentation closeout. Every task begins by proving that the gap still exists; current source and later dated evidence override stale unchecked boxes.

**Tech Stack:** Node.js 24, ESM, Cordis/dsh `0.1.2-rc.1`, Tauri v2/Rust, Flutter/Dart, Git/GitHub Actions, Docker/devcontainers, Docker Sandboxes (`sbx`), Supabase/Postgres provider adapter, arxa lens, and the repository's selftest/smoke harnesses.

**Spec:** `docs/plans/open-work-inventory-2026-09-07.md`, reconciled by the task-specific source plans named below. This document is the execution authority where an older plan conflicts with current source or a later dated plan amendment.

## Global Constraints

- The canonical source repositories are `/Volumes/business_ssd/arxa_digital_solutions/arxa-studio` and `/Volumes/business_ssd/arxa_digital_solutions/arxa`. Record their `pwd -P` values in the ledger and read `/Volumes/business_ssd/arxa_digital_solutions/arxa/AGENTS.md` before any sibling-repo work.
- Never implement on `main` or in the currently dirty canonical arxa checkout. Create the studio worktree at `/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout` and the sibling worktree at `/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-closeout`, verify neither path is inside either repository, and keep commits separate by repository. Copy this plan into the studio worktree before Task 1; copy no other untracked file.
- Baseline at plan creation: arxa-studio `967b2cc`, `main == origin/main`, and `npm test` reports `arxa-studio CI: ALL GREEN` across 110 suites.
- Preserve the depend-don't-fork rule: never edit installed `@deepseek-ai/dsh` package bytes. Extend through Cordis rows, generated snippets, or existing public service seams.
- Preserve local-first parity. A database, GitHub account, Docker account, API key, or network connection must never be required for core local operation.
- Preserve root confinement and path identity. Resolve and realpath paths before mutation; reject symlink escape and reserved `.git`/`.arxa` paths.
- Generated clients are never edited directly. Change their generator or snippet, regenerate, and pass the byte-drift selftest.
- UI uses shipped dsh primitives and real `--dsw-*` tokens. Add every user-facing key in English, Polish, and French unless the whole owning surface is explicitly queued for the localization task.
- Every behavior change follows RED -> verify the expected failure -> minimal GREEN -> focused tests -> full `npm test` -> commit.
- Run socket/watcher tests in an environment that permits localhost binds and native filesystem watchers. A sandbox `EPERM` is an environment failure, not a product failure.
- Use scratch `ARXA_HOME` directories for smoke tests. Never mutate the operator's real organisations, credentials, registries, sessions, Docker state, or GitHub repositories.
- Never print tokens, API keys, OAuth codes, signing material, `.env` values, or credential-store contents.
- Do not push, merge, tag, publish a release, delete a remote, submit to a store, or run a paid authenticated smoke without the operator's explicit authorization at that final external-action step. Prepare every reviewable artifact first.
- A task may be marked `CLOSED BY EVIDENCE` without code only when the controller records exact source locations, fresh verification output, and reviewer approval in the SDD ledger.
- Do not carry newly found unrelated work into this program. Record it under `New finding:` in the ledger with severity and a concrete follow-up path; fix it immediately only if it blocks this plan or is a correctness/security regression in touched code.

## Lead-controller operating contract

- [ ] Run the subagent-driven-development workspace helper for this exact plan and create `.superpowers/sdd/<plan>/progress.md` with the plan path on line 1.
- [ ] Create one todo per task and a preflight dependency table covering every shared file/interface pair.
- [ ] Dispatch tasks serially. Read-only investigations may run in parallel; implementation subagents may not.
- [ ] For each task, record `BASE=$(git rev-parse HEAD)`, generate the task brief, dispatch one fresh implementer, inspect its report and commits, generate a review package for `BASE..HEAD`, and dispatch a separate verifier/reviewer.
- [ ] The verifier/reviewer independently runs every focused test and smoke named by the task plus the required full gate, inspects generated artifacts and `git diff --check`, and returns separate verdicts for verification, spec compliance, and code quality. Resume the implementer for fixes, then dispatch a scoped re-verification.
- [ ] Record one of `Task N: complete`, `Task N: closed by evidence`, or `Task N: external gate prepared` in the ledger. Never use “mostly done”.
- [ ] After all tasks, run a whole-branch final review on the combined diff with the most capable available reviewer, address its findings, rerun all gates, then use `superpowers:finishing-a-development-branch`.

## Required implementation order

Dispatch the numbered tasks in this dependency order, not simple numeric order:

1. **Truth:** Task 1.
2. **Core correctness and Git flow:** Tasks 2, 3, 4, 6, 5, then 7.
3. **Confinement:** Tasks 9, 10, then 11. A0–A3 establishes the fallback before A4 and A5 can degrade to it.
4. **Agency data plane:** Tasks 13 then 14. The contract/local/generic-REST work freezes the seam before Supabase implements it.
5. **Final desktop UI pass:** Task 8 after every UI-producing task above.
6. **Existing release surfaces:** Task 15, then Task 12. This validates the final packed runtime and plugin set after confinement and provider work.
7. **External evidence and closeout:** Tasks 16 then 17.

Do not begin a later wave while a required earlier task is red. Read-only source audits for the next wave may run concurrently, but their results cannot mutate the active implementation worktree.

## Program rulings

These decisions make the plan executable without pausing on questions already answerable from the repository:

1. **Organisation trash fails closed.** Stop/quiesce every live session whose canonical cwd is inside the organisation before moving it. If any session cannot be stopped within the bounded close operation, leave the organisation in place and return a loud error naming only session IDs, never paths outside the org.
2. **Hand-created project repair is explicit.** Offer `Initialize Git repository`; never silently attach Git while opening an org or starting a session.
3. **Prettier and pdf.js remain.** Remove either only after a replacement passes feature-parity tests. Avoiding a 2.1 MB bundle does not justify losing Markdown/YAML formatting; an unverified PDF extension does not replace a working viewer.
4. **The viewer's tested 1.5-second save debounce remains the autosave owner.** Remove or disable it only if a browser probe demonstrates a second active save owner and the replacement passes the save-race suite.
5. **Claude skill packs remain opt-in and none ship by default.** The loading mechanism stays; adding a bundled pack requires its own reviewed manifest and security test.
6. **Agency provider v1 uses the locked HTTP/JSONL wire contract.** Ship only in-repo first-party `local`, generic REST, and Supabase implementations. Do not load arbitrary local JavaScript adapters and do not publish a public npm package in this closeout. Exotic backends integrate through a server-side shim verified by `arxa-studio provider verify`.
7. **BYO support is export-mediated.** No Totem/arxa staff backdoor is required. Support receives an operator-created diagnostic/export bundle.
8. **Provider identity is token-opaque.** The wire contract covers token issue, refresh, revoke, and introspect. A provider owns how a user obtains the token; Supabase email/password remains the reference UI, while local mode represents the machine operator without remote auth.
9. **Realtime fallback is adaptive.** Poll every 3 seconds while the relevant thread/composer is focused and active, every 30 seconds while focused and idle, every 120 seconds in the background, and immediately after a local write.
10. **Mobile migration is presumed implemented until disproved.** Current `../arxa/mobile_flutter` contains the generated app, iroh transport, pairing, webview, persistence, push, approvals, conversations, and tests. Task 12 audits and closes the stale checklist; it must not rebuild those features.
11. **Commercial entity remains an external business/legal gate.** Code must accept product/price/seller configuration and may not encode Australia or Mauritius. Store/release activation waits for the operator's legal decision.

---

### Task 1: Establish the truthful baseline and retire stale work

**Governing sources:** `docs/plans/open-work-inventory-2026-09-07.md`, `docs/plans/project-sessions-physical.md`, `docs/plans/mobile-flutter-migration-spec.md`, `docs/plans/claude-subscription-engine-implementation.md`, `docs/plans/artifact-viewer-implementation.md`, `docs/plans/arxa-studio-vocabulary-collisions.md`.

**Files:**
- Create: `docs/plans/open-work-inventory-2026-09-12.md`
- Modify: the six governing sources above, status/front-matter and supersession notes only
- Test: repository status plus the commands below

**Interfaces:**
- Consumes: current source, tests, and git history in both repositories.
- Produces: one inventory with IDs `AXS-001` onward and states `OPEN`, `DEFERRED`, `EXTERNAL`, or `CLOSED`; every open row maps to exactly one Task 2–16 work package in the SDD ledger.

- [ ] **Step 1: Record immutable starting facts.** Capture `git rev-parse HEAD`, `git status --short --branch`, `node --version`, package pins, `git -C ../arxa rev-parse HEAD`, and sibling worktree status in the SDD ledger. Do not clean either checkout.
- [ ] **Step 2: Run the studio baseline.** Run `npm test`; require exit 0 and the final `arxa-studio CI: ALL GREEN` line.
- [ ] **Step 3: Prove later closures.** Use source plus focused tests to record project-repo routing, version minting, project stamp removal, leaf/session/lister Git decorations, GitHub authorization mounting, Claude SDK packaging, sbx research/login evidence, Freestyle, dashboard, and palette as closed. Keep top-level project/stage decoration rollups open under Task 4.
- [ ] **Step 4: Audit mobile in its own worktree.** From the isolated arxa worktree run `flutter analyze` and `flutter test` under `mobile_flutter`; map every old unchecked migration item to current code/test evidence. Record only genuine residuals such as Android release signing or physical-device gates.
- [ ] **Step 5: Write the new inventory.** Each row must contain ID, owner repo, source plan, current evidence, remaining deliverable, dependency, closure command, and owning Task 2–16 number. Historical plans get a dated banner pointing to this inventory; do not rewrite their narrative history. If any genuine open row has no task, revise and review this master plan before implementation begins; do not leave an orphan row.
- [ ] **Step 6: Verify the inventory.** Search it for bare `TBD`, `TODO`, “maybe”, and unowned open rows. Require zero matches except quoted historical text. Have the task reviewer cross-check every row against source.
- [ ] **Step 7: Commit.** Commit only documentation with `docs: reconcile the arxa studio closeout inventory`.

### Task 2: Stop live sessions before organisation trash and preserve display names

**Governing source:** `docs/plans/org-trash-unreachable.md` Bug B.

**Files:**
- Modify: `plugins/arxa-sidebar/lib/session-sweep.js`
- Modify: `plugins/arxa-sidebar/lib/index.js`
- Modify: `plugins/file-org-shell/lib/dsh-bridge.js`
- Modify: `plugins/file-org-shell/lib/lifecycle.js`
- Test: `plugins/file-org-shell/selftest.mjs`
- Test: `plugins/arxa-sidebar/selftest.actions.mjs`
- Test: `plugins/arxa-sidebar/selftest.session-sweep.mjs`
- Create: `plugins/arxa-sidebar/selftest.trash-live-sessions.mjs`
- Smoke: `scripts/org-purge-smoke.mjs`

**Interfaces:**
- Produces: a retained handle/controller map beside `ctx.agents.create` in `arxa-sidebar/lib/index.js`; `makeDshFaces` exposes only `stopAgentIds(ids, { timeoutMs })` through `dsh-bridge.js`.
- Produces: `quiesceSessionsUnder({ sessions, sessionPersistence, agentControl }, orgPath, { timeoutMs }) -> Promise<{ stopped: string[], alreadyStopped: string[] }>` in `session-sweep.js`.
- Consumes: persisted session rows to identify dsh agent IDs beneath the org, the narrow agent-control face, canonical cwd values, and `lifecycle.trashOrg`.
- Changes: `trashOrg(orgPath, { displayName? } = {})`; its trash index stores manifest display name and retains the original folder slug separately for restore.

- [ ] **Step 1: Write failing host tests.** Cover two live sessions inside the org, one outside, one already stopped, a stop timeout, and a cwd that only shares a textual prefix. Assert the inside sessions stop, the outside session is untouched, and any timeout prevents `softDelete`.
- [ ] **Step 2: Verify RED.** Run the new focused selftest and require failure because no quiesce seam exists.
- [ ] **Step 3: Implement bounded quiescence.** Stop discarding the `AgentHandle` created beside `ctx.agents.create` in `arxa-sidebar/lib/index.js`; retain it or recover it through `ctx.agents.get`, then expose the narrow stop operation through `makeDshFaces`/`dsh-bridge.js`. Resolve cwd and org with canonical path semantics, await termination with a 5-second total bound, and never delete session history during trash.
- [ ] **Step 4: Wire `org.trash`.** Quiesce before calling `l.trashOrg`. On failure return the standard `{ok:false,error}` action response and leave the org directory, recents, GitHub state, and trash index unchanged. Sessions stopped before a later timeout remain resumable from persistence; report their IDs rather than claiming an impossible live-state rollback.
- [ ] **Step 5: Preserve identity.** Read `org.json.name` before the move, store `name` plus `slug`, render the display name, and restore to the original slug/path.
- [ ] **Step 6: Add the husk regression.** Trash an org with a live fake session, let the fake attempt its post-stop write, then assert the original path remains absent and restore succeeds.
- [ ] **Step 7: Verify.** Run the four focused suites, `node scripts/org-purge-smoke.mjs`, and `npm test`.
- [ ] **Step 8: Commit.** `fix: stop organisation sessions before trash`.

### Task 3: Add an explicit repair path for repo-less projects

**Governing source:** `docs/plans/git-card-sessions-worktree-rewire.md` D115 gap.

**Files:**
- Modify: `plugins/file-org-shell/lib/lifecycle.js`
- Modify: `plugins/arxa-sidebar/lib/index.js`
- Modify: `plugins/arxa-sidebar/lib/workspace-region.snippet.txt`
- Modify: `scripts/gen-workspace.mjs` only if a new transform anchor is required
- Regenerate: `plugins/arxa-sidebar/lib/client.js`
- Test: `plugins/file-org-shell/selftest.mjs`, `plugins/arxa-sidebar/selftest.actions.mjs`, `plugins/arxa-sidebar/selftest.mjs`, `plugins/arxa-sidebar/smoke.mjs`

**Interfaces:**
- Produces: `prepareProjectRepo(projectSlug) -> { ok: true, repoPath, head, frame }` on the open lifecycle.
- Produces action: `project.repair-repo { orgId, projectSlug }`.
- Consumes: `initProjectRepo`, `writeFrameFiles`, `hasHead`, `runGit`, the project manifest, and existing project path confinement.

- [ ] **Step 1: Write failing lifecycle tests.** A hand-created valid project with `project.json` but no `.git` becomes a repo with branch `main`, exactly one initial commit, inherited `localOnly`, and frame files; an existing repo is a no-op; a missing/escaped/symlinked project refuses. Assert user files and customized frame files are byte-identical after repair.
- [ ] **Step 2: Verify RED.** Require `prepareProjectRepo is not a function` or the equivalent missing-action failure.
- [ ] **Step 3: Implement the lifecycle method.** Resolve only a scanned project belonging to the open org, inherit/annotate its `localOnly` setting, write missing frame files without overwriting user-customized files, then call `initProjectRepo` once so the existing contents and new frame land in one initial commit. An existing usable repo remains an idempotent no-op.
- [ ] **Step 4: Add the action and UI.** When session creation returns `initial-snapshot-pending` or the routed project has no repo, show an `Initialize Git repository` action in the existing error/notice surface. Clicking it calls `project.repair-repo`; success retries the original new-session action exactly once.
- [ ] **Step 5: Regenerate and verify drift.** Run `node scripts/gen-workspace.mjs --write`, then the sidebar selftests.
- [ ] **Step 6: Smoke the user flow.** Seed a repo-less project under a scratch org, click the action through the route/browser harness, start a session, and assert its branch/worktree belong to the project repo.
- [ ] **Step 7: Run `npm test` and commit.** Commit as `feat: prepare imported projects for sessions`.

### Task 4: Add the local Checks row and complete tree-level decorations

**Governing source:** `docs/plans/local-only-git-parity-and-sidebar-decorations.md` Decisions 3, 6, and 7.

**Files:**
- Modify: `plugins/arxa-git-card/lib/index.js`
- Modify: `plugins/arxa-git-card/lib/git-card.snippet.txt`
- Modify: `scripts/gen-git-card.mjs`
- Regenerate: `plugins/arxa-git-card/lib/client.js`
- Modify: `plugins/arxa-sidebar/lib/workspace-region.snippet.txt`
- Regenerate: `plugins/arxa-sidebar/lib/client.js`
- Test: `plugins/arxa-git-card/selftest.actions.mjs`, `plugins/arxa-git-card/selftest.mjs`, `plugins/arxa-sidebar/selftest.mjs`
- Smoke: `scripts/card-local-smoke.mjs`

**Interfaces:**
- Produces action: `card.gate.run { sessionId } -> { green, kind, configured, output }` using `git-workspace.runGate(session.worktree)`.
- Produces status field: `gate: null | { state: 'green'|'red', kind, configured, output, ranAt, fingerprint }`; the fingerprint covers HEAD plus staged, unstaged, and untracked state, so any worktree mutation makes the historical result stale without rerunning the gate.
- Consumes: existing decoration map and `ARXA_DECO_FOR(relPath, kind, rootId)`.

- [ ] **Step 1: Write failing action tests.** Cover green, red with captured output, absent `check.sh` light gate, unknown session, and stale status after committed, staged, unstaged, and untracked changes.
- [ ] **Step 2: Verify RED.** Run the action selftest and require the missing action/status field.
- [ ] **Step 3: Implement the host action/cache.** Bound execution with the same gate behavior Commit already uses; cache the result without rerunning the script during `card.status`, mark it stale when the cheap Git/content fingerprint changes, and cap the UI payload to the last 64 KiB with an explicit truncation prefix.
- [ ] **Step 4: Build the Checks row.** Render it for local-only sessions in the slot occupied by the remote Actions row for linked sessions. Show state/kind, `Run checks`, busy state, green summary, and red output in a disclosure. It must not start GitHub Actions and must not merge or park the session.
- [ ] **Step 5: Wire top-level decorations.** Apply the existing folded directory mark to `Projects`, project, and stage rows. Do not add Git subprocesses; the current two-call measurement remains the only source.
- [ ] **Step 6: Add UI/source tests.** Pin the new action, busy de-duplication, red output, all three locales, and decoration calls at all three top-level row sites.
- [ ] **Step 7: Regenerate and smoke.** Run `node scripts/gen-git-card.mjs --write`, `node scripts/gen-git-card.mjs --check`, `node scripts/gen-workspace.mjs --write`, and `node scripts/gen-workspace.mjs --check`, then focused suites and `node scripts/card-local-smoke.mjs`. Add a scratch red `check.sh` leg that proves the output appears and the worktree is unchanged.
- [ ] **Step 8: Run `npm test` and commit.** `feat: surface local checks and complete tree decorations`.

### Task 5: Add the two missing CI/CD stress scenarios

**Governing source:** `docs/plans/local-only-git-parity-and-sidebar-decorations.md` S4/S5.

**Files:**
- Modify: `scripts/cicd-stress.mjs`
- Modify if product defects surface: only the owning `plugins/git-workspace/lib/*.js` or viewer/watcher module, with a new failing focused test first
- Test: `scripts/cicd-stress.mjs` plus affected plugin selftests

**Interfaces:**
- Produces S4: two sessions integrate against moving `main`; exactly one lands first and the second must integrate or conflict loudly without losing its commit.
- Produces S5: rapid viewer saves across at least three files while WIP auto-commit and decoration refresh run; final files, WIP history, and decoration map converge.

- [ ] **Step 1: Add S4 as a failing scenario.** Launch two child processes against the same scratch repository/local bare remote and release both merge attempts from a parent-controlled barrier. Do not simulate concurrency in one process.
- [ ] **Step 2: Run and classify RED.** If current product behavior passes immediately, mutation-test only an injected temporary fixture with the integrate/conflict guard disabled and prove the scenario turns red; never alter the implementation worktree for the negative control.
- [ ] **Step 3: Add S5 as a failing scenario.** Drive the actual Monaco save/debounce coordinator, or extract that production coordinator for direct use, while WIP commits and decoration reads run concurrently. Count coalesced saves and WIP boundaries; assert no dropped final write, no dirty tree after quiet, no duplicate WIP boundary, and that every concurrent read sees a parseable complete Git index and decoration map.
- [ ] **Step 4: Fix only demonstrated product defects.** Every fix gets its own focused regression before changing production code.
- [ ] **Step 5: Verify repeatability.** Run `node scripts/cicd-stress.mjs` five consecutive times, then `npm test` once.
- [ ] **Step 6: Commit.** `test: cover main races and auto-commit storms`.

### Task 6: Add the condensed Git-card delivery ledger

**Governing source:** `docs/plans/github-conversations-in-the-insight-panel.md` carried ledger strip.

**Files:**
- Modify: `plugins/git-workspace/lib/ledger.js`
- Modify: `plugins/arxa-git-card/lib/index.js`
- Modify: `plugins/arxa-git-card/lib/git-card.snippet.txt`
- Regenerate: `plugins/arxa-git-card/lib/client.js`
- Test: `plugins/git-workspace/selftest.ledger.mjs`, `plugins/arxa-git-card/selftest.actions.mjs`, `plugins/arxa-git-card/selftest.mjs`
- Smoke: `scripts/card-local-smoke.mjs`, `scripts/card-cicd-smoke.mjs`

**Interfaces:**
- Produces action: `card.ledger.summary { sessionId } -> { lastStage, result, nextOwner, target, url } | null`.
- Consumes: the existing git-workspace ledger and linked PR URL; never refetches or duplicates the full ledger table.

- [ ] **Step 1: Write failing ledger/summary tests.** Cover persisting `next` in new rows, reading old rows without it, no ledger, local session without URL, linked session with PR URL, red gate next owner, target, and merged result.
- [ ] **Step 2: Verify RED.** Require the action to be missing.
- [ ] **Step 3: Persist `next` and implement a pure projection.** Extend new stage ledger rows without breaking old rows, then read the resolved seat repository/session and return only the latest stage, result, next owner, and target.
- [ ] **Step 4: Render the strip.** Place it under the card frame summary; link only when a trusted GitHub URL exists. A local-only session opens a bounded local ledger view. Use existing status tokens, escaped content, and three-locale strings.
- [ ] **Step 5: Regenerate, run focused tests and both smokes, then `npm test`.**
- [ ] **Step 6: Commit.** `feat: show the latest delivery ledger on the git card`.

### Task 7: Close the artifact-viewer security and runtime verification items

**Governing sources:** `docs/plans/artifact-viewer-vscode-monaco.md`, `docs/plans/artifact-viewer-demo-runbook.md`, `docs/plans/artifact-viewer-implementation.md`.

**Files:**
- Modify: `plugins/artifact-viewer/lib/index.js`, `plugins/artifact-viewer/lib/org-server.js`, `plugins/artifact-viewer/lib/tokens.js`, `plugins/artifact-viewer/lib/lsp.js`, `plugins/artifact-viewer/lib/client.js`, `plugins/artifact-viewer/lib/monaco-build/check.mjs`
- Modify: `plugins/artifact-viewer/lib/monaco-build/src/entry.mjs`, `plugins/artifact-viewer/lib/monaco-build/vite.config.mjs`
- Modify: `docs/plans/artifact-viewer-vscode-monaco.md`, `docs/plans/artifact-viewer-demo-runbook.md`
- Test: all `plugins/artifact-viewer/selftest*.mjs`
- Browser gate: `plugins/artifact-viewer/lib/monaco-build/check.mjs`

**Interfaces:**
- Security invariant: extension/webview execution receives no ambient studio cookies, credentials, host bridges, or mutation token; file access remains explicit, scoped, short-lived, and root-bound.
- Runtime invariants: TS/HTML/CSS/JSON LSP install/status works; diagnostics reach the editor; Dart absence gives locate/install guidance without an automatic download; autosave has one owner.

- [ ] **Step 1: Write a threat-model table in the plan doc.** Enumerate iframe origin, sandbox attributes, CSP, cookies, localStorage, parent DOM access, fetch reach, token exposure, navigation, and extension code provenance. For each, record current behavior by test/probe.
- [ ] **Step 2: Freeze the same-origin extension rule.** Add a build-manifest/allowlist test that permits only pinned vendored built-ins registered in `monaco-build/src/entry.mjs`. Arbitrary marketplace and VSIX loading stays disabled until a separately served origin is designed and reviewed.
- [ ] **Step 3: Close every other unsafe ambient capability found by the threat model and rerun the browser spike.** Preserve markdown preview, diff, tabs, settings layout, and diagnostics.
- [ ] **Step 4: Verify the language strip on screen.** Use scratch files with deterministic diagnostics in `.ts`, `.html`, `.css`, and `.json`; capture 390/744/1280 evidence with zero console/page errors.
- [ ] **Step 5: Verify autosave ownership.** Probe `files.autoSave`, retain the existing tested 1.5-second viewer debounce, and assert one save per settled edit. Change ownership only if the probe proves a competing save path and the replacement passes the save-race suite.
- [ ] **Step 6: Exercise Dart discovery.** Test present-on-PATH and absent cases. Copy must say an SDK is required; no downloader is added.
- [ ] **Step 7: Retain pdf.js and Prettier.** Record the decision, pin their existing coverage, and do not add a PDF extension experiment or widen the extension allowlist in this closeout.
- [ ] **Step 8: Reconcile the gen-ui Diff item.** Confirm whether gen-ui currently receives real file diffs. If it still receives only model-authored before/after text, mark the upgrade `DEFERRED UNTIL REAL FILE DIFF INPUT` and add a trigger test/comment. If real file inputs exist, replace the positional comparison with a bounded deterministic Myers/LCS renderer inside gen-ui while preserving `{path,before,after}`; cover insertions, deletions, reordering, hunks/context, large input, unchanged lines, and escaping. Do not mount the artifact viewer's movable singleton into repeated inline cards.
- [ ] **Step 9: Run the clean-build gate and live runbook.** In `plugins/artifact-viewer/lib/monaco-build`, run `npm ci`, `npm run build`, `node check.mjs`, and `node check.mjs --webkit`; then run every `plugins/artifact-viewer/selftest*.mjs`, root `npm test`, and the updated live runbook.
- [ ] **Step 10: Commit.** `fix: close artifact viewer runtime and trust boundaries`.

### Task 8: Finish localization and visual acceptance for touched desktop surfaces

**Governing sources:** `docs/plans/dsh-plugin-ui-conformance.md`, `docs/plans/palette-personalisation.md`, and unfinished visual notes in the local Git plan.

**Files:**
- Modify: locale dictionaries/generators owned by `plugins/locale`, `plugins/personalisation`, `plugins/theme-accent`, `plugins/arxa-git-card`, `plugins/arxa-sidebar`, `plugins/sandbox`, and `plugins/workspace-provider`
- Test: corresponding plugin selftests and generated drift checks
- Evidence: `designs/evidence/studio-closeout/{390,744,1280}/`

**Interfaces:**
- Produces: complete EN/PL/FR key parity for the Personalisation tab and every desktop surface changed by Tasks 2–14.
- Consumes: existing `arxa-locale` service and browser-language persistence.

- [ ] **Step 1: Add a failing key-set parity test.** English is the source set; Polish and French must contain the same keys for the full Personalisation tab and touched surfaces.
- [ ] **Step 2: Translate missing strings.** Preserve product terms from `CONTEXT.md`; do not translate IDs, paths, branch names, model IDs, or commands.
- [ ] **Step 3: Run a native-speaker review subagent separately for Polish and French.** Each reviewer writes a report; implement only corrections that preserve the source meaning and UI length constraints.
- [ ] **Step 4: Capture desktop evidence.** Include Finish, Sweep, Checks red disclosure, project preparation, trash confirmation/recovery, viewer install strip, configured/effective confinement, Workspace backend/sign-in states, and Personalisation at 390/744/1280 in light and dark where the component differs.
- [ ] **Step 5: Run locale/plugin tests and `npm test`.**
- [ ] **Step 6: Commit.** `feat: complete studio locale and visual acceptance`.

### Task 9: Implement automatic A0–A3 confinement and B1–B2 integrity

**Governing source:** `docs/plans/arxa-isolation-levels.md` S1–S4.

**Files:**
- Modify: `plugins/sandbox/lib/index.js`, `plugins/sandbox/selftest.mjs`
- Create: `plugins/sandbox/lib/provision.js`, `plugins/sandbox/lib/effective-tier.js`, `plugins/sandbox/lib/filesystem.js`, `plugins/sandbox/lib/project-secrets.js`
- Create: `plugins/sandbox/selftest.filesystem.mjs`, `plugins/sandbox/selftest.project-secrets.mjs`
- Modify: `plugins/git-workspace/lib/frame.js` and its focused tests
- Modify: `profile/cordis.patch.yml` to replace the stock FileSystem provider with the arxa read/write-confined provider
- Modify: `bin/arxa-studio.mjs` and its materialization tests to seed `permission.defaultPreset: workspace-write` and a launcher-owned settings-version marker
- Test: `scripts/s1-sandbox-verify.mjs`, `scripts/mirror-drift-check.mjs`, relevant frame suites

**Interfaces:**
- Produces: `resolveEffectiveTier({ configured, platform, runners }) -> { configured, effective, reason }`.
- Produces: `provisionLocalConfinement({ env, platform }) -> { preset, filesystem, subprocessEgress, integrity }`.
- Produces an arxa FileSystem provider whose `readText`, `streamText`, write, and edit operations resolve/realpath through the active session root and reject sibling-project and symlink escapes.
- Produces per-project age/SOPS storage: one keychain key per project, committed `.env.sops`, and decryption scoped to one spawned command; no plaintext `.env`, shell-string keychain call, command-line secret, `-e`, `--env-file`, `--build-arg`, or ambient engine/agent environment.
- Integrity: lockfile-enforced/script-free dependency install and base-branch diff policy are generated into every applicable project frame.

- [ ] **Step 1: Write failing pure tests for tier resolution.** Cover macOS Seatbelt, Linux bwrap/Landlock, unsupported Windows ACL, missing runners, inherited A5 fallback, and no-toolchain hosts.
- [ ] **Step 2: Verify RED, then implement the pure resolver.** The effective tier can only decrease from configured capability; every decrease carries a user-readable reason.
- [ ] **Step 3: Add failing FileSystem tests.** Exercise read/stream/write/edit inside the session root and deny sibling-project, parent, symlink, and reserved-root access through the real Cordis provider row.
- [ ] **Step 4: Add failing provisioning tests.** Assert idempotence, safe preset materialization, no manual prerequisite, and no widening beyond workspace/temp/measured toolchain roots. New profiles get `workspace-write`. Existing profiles migrate only when a launcher-owned version/fingerprint proves the old value was generated; an indistinguishable operator value remains untouched and receives a visible remediation notice.
- [ ] **Step 5: Implement A0–A3.** Keep the existing ArxaSandboxProvider for subprocess writes, add the arxa FileSystem provider for in-process reads/writes, and report configured/effective scope precisely. A3 means subprocess egress only; WebFetch, MCP, web search, and model-provider traffic remain outside that claim.
- [ ] **Step 6: Implement per-project encrypted environment handling test-first.** Reuse the bounded platform keyring ladder, scope keys by stable org/project ID, use age/SOPS ciphertext committed as `.env.sops`, inject decrypted values into one spawned command or a file-based container secret, and zero/remove temporary material on exit and signal paths.
- [ ] **Step 7: Add integrity gates test-first.** Generate `npm ci --ignore-scripts` where a lockfile exists, `dart pub get --enforce-lockfile` where supported, OSV scanning when installed with an honest unavailable result, and a base-branch diff-policy gate. Do not run irrelevant stack commands.
- [ ] **Step 8: Run real confinement probes.** Prove reads/writes inside workspace and required toolchain caches succeed; a sibling project, sibling secret, and outside sentinel remain unreadable/unchanged. Prove status does not overstate host-tool egress coverage.
- [ ] **Step 9: Run focused suites and `npm test`; commit.** `feat: provision local confinement and project integrity`.

### Task 10: Implement A4 Docker/devcontainer isolation

**Governing source:** `docs/plans/arxa-isolation-levels.md` L1/A4 and worktree corrections.

**Files:**
- Create: `plugins/sandbox/lib/devcontainer.js`, `plugins/sandbox/lib/project-database.js`, `plugins/sandbox/selftest.devcontainer.mjs`, `plugins/sandbox/selftest.project-database.mjs`
- Modify: `plugins/sandbox/lib/effective-tier.js`, plugin entry/configuration
- Modify: session start/finish integration at the existing file-org-shell/git-workspace seam
- Generate per-project: `.devcontainer/devcontainer.json` and target-aware Dockerfile only through owned frame/scaffold functions

**Interfaces:**
- Produces: `detectDocker()`, `ensureDevcontainer(projectRepo, target)`, `startContainer({ repoPath, branch, sessionId })`, `execContainer(handle, argv)`, `fetchContainerCommits(handle)`, `stopContainer(handle)`.
- Each session branch is cloned into a private named volume. Results return to a host recovery ref through Git before teardown; the container never runs on project `main` and never mounts sibling projects, the organisation root, or a host worktree's pointer-style `.git` file.
- Produces per-project Supabase lifecycle with a stable project ID, separately allocated/persisted port block, own containers/volume, one active local stack at a time, and local file/SQLite as the zero-Docker floor.

- [ ] **Step 1: Write failing command-construction tests.** Pin `@devcontainers/cli`, resolved config JSON, target-specific image/Dockerfile selection, no secret baked into image/config, and absence behavior.
- [ ] **Step 2: Implement Docker detection and declarative generation.** Detect, never install Docker. A missing daemon degrades to A0–A3 with the effective reason.
- [ ] **Step 3: Implement lifecycle against an injected runner.** Clone the exact session branch into a private volume; ensure/start/exec/fetch/stop are idempotent, bounded, and structured. Refuse teardown until every container commit is reachable from a host recovery ref.
- [ ] **Step 4: Implement file-based secret injection.** Consume Task 9's project key and `.env.sops`, decrypt host-side to a bounded temporary file, mount it as a Compose secret under `/run/secrets`, and clean it on every exit path. Add negative tests for Docker inspect, process arguments, logs, and sibling projects.
- [ ] **Step 5: Implement per-project database provisioning.** Detect the Supabase CLI rather than installing it in this task; run `supabase init/start/stop` inside the isolated project clone, allocate a collision-free port block, persist it by stable project ID, and never link the vendor's Supabase project. Missing Docker/CLI degrades to the local file/SQLite floor with a truthful reason.
- [ ] **Step 6: Run a real disposable container smoke.** Create scratch Node and Flutter-shaped projects, run checks, start/stop two separately identified database fixtures without port collision, commit inside the isolated branch clone, fetch the commit to the host recovery ref, and tear down without touching sentinels.
- [ ] **Step 7: Add effective-tier UI using the existing card/status language.** Show configured/effective when they differ; no second settings taxonomy.
- [ ] **Step 8: Run focused tests and `npm test`; commit.** `feat: add automatic Docker project isolation`.

### Task 11: Implement A5 Docker Sandbox isolation and safe teardown

**Governing source:** `docs/plans/arxa-isolation-levels.md` §§21–24/S3/S4.

**Files:**
- Create: `plugins/sandbox/lib/sbx.js`, `plugins/sandbox/lib/sbx-install.js`, `plugins/sandbox/selftest.sbx.mjs`, `plugins/sandbox/selftest.sbx-install.mjs`
- Modify: `plugins/sandbox/lib/effective-tier.js`, plugin entry/status UI
- Modify: Git/session finish and sweep integration only through an exported sandbox lifecycle seam

**Interfaces:**
- Produces: `sbxStatus`, `sbxLoginFlow`, `ensurePolicy`, `createSandbox`, `startSandbox`, `resolveGitEndpoint`, `fetchSandboxCommits`, `removeSandbox`.
- Safety invariant: never pass `sbx rm --force` until all sandbox commits are reachable from a host ref and verified; retain `refs/sandboxes/<name>/<branch>` as recovery evidence.

- [ ] **Step 1: Write failing parser/state tests.** Cover unauthenticated 401, OAuth device flow, daemon stopped, absent global policy, changing ephemeral ports, auto-stopped sandbox, missing host remote, unfetched work, and retained image-cache accounting.
- [ ] **Step 2: Package/provision `sbx`.** Support a bundled or official checksum-pinned artifact for each shipped platform and an idempotent updater; do not assume Homebrew. Start/diagnose the daemon automatically. Unit tests use an injected downloader/filesystem and never alter the operator install.
- [ ] **Step 3: Implement detection and one-time sign-in surface.** This is the only confinement tier allowed to require a Docker account. Cancellation/failure falls back cleanly and never blocks a session.
- [ ] **Step 4: Implement policy planning without touching global state.** Parse current policy, build the exact deny-all/per-sandbox change, and surface it for the authenticated external gate. Unit/integration fixtures use an isolated fake state root. A real `sbx policy init` is global and belongs to Task 16 after explicit authorization.
- [ ] **Step 5: Implement clone/start/Git retrieval.** Resolve the port every start, wake before fetch, add/maintain the remote, fetch into a host recovery ref, and verify object reachability.
- [ ] **Step 6: Integrate Finish/Sweep.** Refuse teardown with unfetched commits; once reachable, remove non-interactively and report retained cache separately from reclaimed workspace bytes.
- [ ] **Step 7: Run injected/fake-state tests only.** Prepare the exact disposable real-sbx command and expected evidence for Task 16; do not sign in, change global policy, or mutate the operator's Docker Sandbox state here.
- [ ] **Step 8: Run `npm test`; commit.** `feat: add Docker Sandbox isolation with recoverable teardown`.

### Task 12: Reconcile and finish the Flutter mobile deliverable

**Governing sources:** `docs/plans/mobile-flutter-migration-spec.md`, `docs/plans/shell-language-decision.md`, current `../arxa/mobile_flutter`.

**Required task skills:** `arxa-cicd` for the one-root CI frame and `arxa-deployer` for Fastlane/Shorebird command shapes. The decisions below are already recorded for this product; do not ask the operator to repeat the generic bootstrap grill.

**Files:**
- Modify in isolated arxa worktree: `mobile_flutter/android/app/build.gradle.kts`, `mobile_flutter/ios/**` only where signing validation requires it, `mobile_flutter/deploy/**`, and mobile docs/tests demonstrated by Task 1
- Create through `arxa-cicd`: `scripts/check.sh`, `.github/workflows/ci.yml`, `.github/pull_request_template.md`, and `docs/ci/{decisions,setup}.md`; generate `docs/ci/explainer.html` from the skill template
- Create through `arxa-deployer`: `.github/workflows/mobile-release.yml`, `mobile_flutter/fastlane/{Appfile,Fastfile,Matchfile}`, and the accepted `mobile_flutter/shorebird.yaml` extension point if OTA remains in scope
- Modify in studio: `docs/plans/mobile-flutter-migration-spec.md`
- Test in arxa: `mobile_flutter/test/**`, `mobile_flutter/integration_test/approvals_e2e_test.dart`, `kit/studio_transport/**`

**Interfaces:**
- Consumes current `TransportService`/`IrohTransportService`, `arxa_kit_studio_transport`, push bridge, approvals/conversation repositories, and native runners.
- Produces a checked parity table mapping every legacy Tauri behavior to Flutter code plus automated or physical evidence.

- [ ] **Step 1: Prove the existing app before editing.** Run formatting check, `flutter analyze`, `flutter test`, and the transport package tests in the isolated arxa worktree.
- [ ] **Step 2: Map all twelve old migration boxes.** Pairing screen, QR, manual ticket, flow contract, iroh, loopback proxy, persistence, revocation, push, device name, identity/config, and build facts each need source and test evidence.
- [ ] **Step 3: Fix only failed parity rows test-first.** Do not recreate existing transport/push/approval work. Preserve the Rust-owned iroh/loopback seam already selected by current code.
- [ ] **Step 4: Close Android signing residue.** Keep the existing `solutions.arxadigital.arxa.mobile` application ID. Load release signing from gitignored `key.properties` or CI secrets and fail a release build clearly when signing inputs are absent; debug builds alone may use the debug key. Confirm the existing iOS team, bundle ID, and entitlements against the release configuration.
- [ ] **Step 5: Run simulator integration smoke.** Exercise pairing through the real pairhost/iroh route, reconnect, webview, push registration, approval decision, and conversation send.
- [ ] **Step 6: Bootstrap the canonical one-root CI frame.** Record the existing product decisions in `docs/ci/decisions.md`: private monorepo, `main` trunk, GitHub-hosted Ubuntu Android lane, existing self-hosted macOS/ARM64 labels for iOS, per-job timeouts, concurrency cancellation, `arxa gate --all` plus Flutter format/analyze/test, and deploy jobs that prepare then halt at the human approval gate. `scripts/check.sh` is the one local/CI root; do not duplicate arxa validators in YAML.
- [ ] **Step 7: Add release automation through `arxa-deployer`.** Prepare Fastlane lanes for TestFlight, App Store, Play internal, and Play production with credential presence checks and no checked-in secrets. Prepare Shorebird release/patch lanes if the current mobile release plan still requires OTA; otherwise record its dated deferral and trigger in the inventory.
- [ ] **Step 8: Exercise release automation without publishing.** Validate workflow syntax, `arxa deploy --self-test`, Fastlane configuration, unsigned debug artifacts, and a release-shaped Android AAB/APK signed with a disposable test-only keystore created and destroyed inside the smoke. With no Apple release identity, validate iOS archive/export configuration and stop at `doctor`; never substitute development signing for a release claim. Verify artifact names, checksums, and secret redaction.
- [ ] **Step 9: Prepare physical gates.** Write `mobile_flutter/deploy/physical-gates.md` with exact iPhone/APNs and Android/FCM/APK commands and redaction rules. Execute only if devices/credentials are available and authorized.
- [ ] **Step 10: Update the migration plan with checked evidence and retain the legacy Tauri scaffold through the first accepted iOS and Android releases.** Archive/remove it later in a separate reviewed cleanup.
- [ ] **Step 11: Commit arxa and studio changes separately.** Suggested messages: `fix(mobile): close Flutter release configuration`; `ci(mobile): add mobile gates and release lanes`; `docs: reconcile Flutter mobile migration`.

### Task 13: Implement the fixed WorkspaceProvider wire contract, local provider, and generic REST adapter

**Governing source:** `docs/plans/agency-backend-provider-abstraction.md`.

**Files:**
- Create: `plugins/workspace-provider/package.json`
- Create: `plugins/workspace-provider/lib/{index,client,contract,wire,capabilities,errors,local,generic-rest,polling,export-bundle,conformance}.js`
- Create: `plugins/workspace-provider/selftest.{contract,local,rest,polling,export}.mjs`
- Create: `bin/arxa-studio-provider.mjs`
- Modify: `bin/arxa-studio.mjs` to add the plugin directory constant, `PROFILE_PLUGINS`, `BY_NAME_PLUGINS`, packed/materialization checks, and dispatch `provider verify`, `workspace export`, `workspace import`, and `diagnose` before normal studio boot
- Modify: `profile/cordis.patch.yml` to register the host/client service row
- Modify: `scripts/ci.mjs` to include the new focused suites
- Modify: `docs/plans/agency-backend-provider-abstraction.md` with the program rulings

**Interfaces:**
- Produces an in-process `WorkspaceProvider` used only by first-party modules, with versioned capabilities and collection/blob/member/audit operations from the source plan.
- Produces a versioned HTTP/JSONL protocol for the generic REST backend. Authentication is token-opaque: issue, refresh, revoke, and introspect; email/password is not part of the wire contract.
- Produces `LocalWorkspaceProvider` with zero network/auth dependency.
- Produces `GenericRestWorkspaceProvider({ baseUrl, credentialStore, fetch })`; no provider path or JavaScript module is accepted from user configuration.
- Produces portable export/import bundle: versioned `manifest.json`, one JSONL per collection, `storage/`, `members.json`, hashes, and no credentials/entitlements/subscriptions.

**Wire v1 (freeze before implementation):**

| Surface | Contract |
|---|---|
| Version/request | Base path `/arxa-workspace/v1`; every request carries `X-Arxa-Workspace-Version: 1` and `X-Request-Id`; authenticated requests carry `Authorization: Bearer <opaque-token>`. Unknown versions return typed `unsupported_version`. |
| Capability/sign-in | `GET /capabilities` returns capability booleans plus `signIn.kind: email-form | browser | device-code | token` and the matching start metadata. `POST /auth/issue`, `/auth/refresh`, `/auth/revoke`, and `/auth/introspect` exchange JSON and return opaque token/session envelopes; providers own credential verification and may redirect/hand off according to the declared kind. |
| Orgs/members | `GET /orgs` and `GET /orgs/{orgId}/members` return `application/x-ndjson`; `POST /orgs`, `GET|PATCH|DELETE /orgs/{orgId}`, and `POST|PATCH|DELETE` member resources use bounded JSON. Roles are `owner | admin | billing | member`. |
| Records/audit | `GET /orgs/{orgId}/records/{collection}?cursor=&limit=` returns JSONL; `PUT|GET|DELETE /orgs/{orgId}/records/{collection}/{id}` uses JSON plus ETag/`If-Match` for conflicts. `POST /orgs/{orgId}/audit` appends JSON; `GET` streams JSONL; no audit mutation route exists. Collection names are the fixed §1 list. |
| Blobs/realtime | `PUT|GET|DELETE /orgs/{orgId}/storage/{path}` streams bytes; `POST .../signed-url` returns bounded JSON. Optional `GET /orgs/{orgId}/events?cursor=` streams JSONL events and resumes from a cursor. |
| Errors/bounds | Non-2xx JSON is `{error:{code,message,retryable,requestId}}` with the fixed typed codes. Default/max page sizes, body/blob limits, timeouts, retryable status set, and cursor encoding are constants in `contract.js` and golden-tested; messages never contain tokens or cross-org data. |

- [ ] **Step 1: Rewrite the stale source-plan status and config examples.** Record D32–D35 as the later authority: local remains zero-config, remote choices are `generic-rest` and `supabase`, `custom.adapter` and `ARXA_WORKSPACE_ADAPTER` are invalid, support is bundle-only, identity is token-opaque, and fallback polling is 3s active/30s idle/120s background plus immediate after write.
- [ ] **Step 2: Freeze the contract and wire protocol in failing golden tests.** Encode the Wire v1 table above as exact routes, verbs, headers, media types, envelopes, bounds, pagination, token lifecycle, capability-driven sign-in dispatch, error taxonomy, abort signals, and request IDs. Assert config cannot name executable code. Stop for task review before writing either adapter; any wire change after this checkpoint requires a new protocol version.
- [ ] **Step 3: Verify RED, then implement contract/types/errors and protocol codecs.** JSON responses cover bounded singleton operations; record/audit streams and export use JSONL. Reject unknown versions and collections before I/O.
- [ ] **Step 4: Build the reusable conformance kit.** Cover CRUD, watch/poll degradation, adaptive polling transitions, optimistic conflict, pagination, audit immutability, blob hashes, member roles, idempotent replay, and migration round-trip. Network providers must also pass cross-org raw-request/IDOR tests; local reports that section `n/a (single-user local store)`.
- [ ] **Step 5: Implement the local provider.** Store atomic JSON documents and append-only JSONL under `<ARXA_HOME>/workspace/<orgId>/`, with mode `0700` on the workspace root; it must pass the same applicable conformance sections without network, account, database, or environment variables.
- [ ] **Step 6: Implement the generic REST adapter and sign-in dispatch.** Inject `fetch`, read its opaque credential handle through the credential service, render only the declared email/browser/device-code/token flow, enforce timeouts and bounded retries, and map only Wire v1. Add a hostile fixture server that proves tenant and IDOR failures become red conformance results.
- [ ] **Step 7: Implement export/import and the canonical CLI.** `arxa-studio workspace export|import`, `arxa-studio provider verify`, and `arxa-studio diagnose` are the only command spellings in this repository. Stream JSONL, verify hashes before mutation, preserve IDs where accepted, write an ID map otherwise, re-invite members through provider operations, and import audit rows as read-only history. `provider verify` prints every conformance section and exits nonzero on any required red row.
- [ ] **Step 8: Add `arxa-studio diagnose`.** Produce a user-inspectable bundle containing versions, redacted config shape, provider-verify results, and bounded error logs; include no tokens, secrets, or client records.
- [ ] **Step 9: Prove runtime and package inclusion.** Materialize a scratch profile and boot host/client settings; pack the sidecar, inspect its manifest for `arxa-workspace-provider`, and boot the packed engine before running focused conformance, migration pressure tests, CLI smokes, and `npm test`.
- [ ] **Step 10: Commit.** `feat: add fixed workspace providers and local storage`.

### Task 14: Implement the first-party Supabase/Postgres provider

**Governing source:** `docs/plans/agency-backend-provider-abstraction.md` plus Task 13's frozen contract.

**Files:**
- Create: `plugins/workspace-provider/lib/supabase.js`
- Create: `plugins/workspace-provider/migrations/*.sql`
- Create: `plugins/workspace-provider/selftest.supabase.mjs`
- Create: `plugins/workspace-provider/supabase/config.toml`, `scripts/workspace-provider-supabase-smoke.mjs`
- Modify: `plugins/workspace-provider/lib/index.js`, `plugins/workspace-provider/package.json`, `bin/arxa-studio-provider.mjs`, and `scripts/ci.mjs`
- Modify: `.github/workflows/ci.yml` with a separate disposable local-Supabase conformance job
- Modify: `plugins/workspace-provider/lib/client.js`, `plugins/workspace-provider/package.json`, and provider selftests for a dedicated Workspace backend settings section; integrate its EN/PL/FR keys through the existing `arxa-locale` service

**Interfaces:**
- Implements Task 13 `WorkspaceProvider`.
- The contract exposes no staff/support-access capability; diagnostics remain operator-exported.
- Supabase Auth supplies the reference email/password UX, but callers consume only the Task 13 opaque-token session surface.
- Realtime absence or failure degrades to Task 13 adaptive polling.

- [ ] **Step 1: Write failing adapter contract tests.** Cover SQL row mapping, RLS/tenant isolation, token lifecycle, reference email sign-in, member invitation, storage, realtime and adaptive-poll fallback, audit append-only behavior, retry/idempotency, and unavailable service.
- [ ] **Step 2: Build the disposable local-Supabase harness.** Pin the Supabase CLI version in the script/workflow, require Docker, start under `plugins/workspace-provider/supabase` with a scratch state directory and reserved ports, create two users/two orgs, and guarantee stop/volume cleanup on success, failure, and signal. The ordinary offline `npm test` uses an injected protocol fake; the dedicated CI job runs this real local stack.
- [ ] **Step 3: Write migrations with a reversible local test.** Apply to an empty local stack, apply twice, exercise rows, reset only the disposable database, and replay raw authenticated requests proving each user cannot list/read/write the other org.
- [ ] **Step 4: Implement the adapter.** Keep provider-specific row shapes inside this module; callers see only contract objects.
- [ ] **Step 5: Implement configuration/status.** Store credentials through the existing credential service, never environment files. Local stays the zero-config default; settings may select only `local`, `generic-rest`, or `supabase`, dispatch the declared sign-in kind, and show truthful live/degraded capability badges.
- [ ] **Step 6: Run all three providers through one conformance suite and export local -> Supabase -> local.** Hash-equivalent portable data is required; provider identities are re-invited, not copied. Run `node scripts/workspace-provider-supabase-smoke.mjs` and require the RLS/IDOR section green.
- [ ] **Step 7: Run `npm test`; commit.** `feat: add the first-party Supabase workspace provider`.

### Task 15: Close macOS/Linux distribution and preserve the Windows deferral

**Governing sources:** `docs/plans/desktop-shell-scaffold.md`, `docs/plans/linux-install-script.md`, `docs/plans/linux-omarchy-port.md`, and `../arxa/desktop/README.md`.

**Files:**
- Modify in isolated arxa worktree: `.github/workflows/desktop-release.yml`, `.github/workflows/desktop-gate.yml`, `desktop/scripts/**`, and `desktop/README.md`
- Create in isolated arxa worktree: `desktop/scripts/install-macos.sh` and its focused shell test
- Create in isolated arxa worktree: `docs/linux-support.md`
- Modify in studio: Linux harness/tests/docs only where the engine payload owns them

**Interfaces:**
- Produces locally validated macOS and Linux artifacts plus release workflows that refuse an unsigned or unnotarized stable release.
- External release remains gated on credentials and explicit authorization.
- Windows remains `DEFERRED` under D23 until its recorded demand/customer trigger fires; research is evidence, not authorization to build it.

- [ ] **Step 1: Close already-built rows by evidence.** Verify macOS entitlements and branded icons, Linux AppImage/deb/PKGBUILD, `/usr/libexec` engine layout, systemd user unit, Wayland/HiDPI fixes, `.desktop`/icon install and uninstall, and checksum/updater manifest generation. Correct the stale plan line claiming no `.desktop` story.
- [ ] **Step 2: Make stable releases fail closed.** In `desktop-release.yml`, a `studio-v*` job must fail before publication unless Developer ID signing, notarization, Tauri updater signing, and required release credentials all succeed. A `studio-beta-v*` job may produce a clearly labelled unnotarized beta with a workflow warning and matching manifest metadata; never label it stable.
- [ ] **Step 3: Add the macOS installer twin.** Fetch the channel manifest, verify the updater signature/checksum, install per-user, preserve channel choice, and support uninstall. Test syntax, local-file override, tampered artifact refusal, idempotent upgrade, and clean uninstall without network publication.
- [ ] **Step 4: Retry the Omarchy user path.** In a disposable Omarchy VM and disposable user/home, run `ARXA_CHANNEL=beta curl -fsSL https://raw.githubusercontent.com/unfazed-dev/arxa-releases/main/install.sh | sh` rather than `ARXA_STUDIO_APPIMAGE`; assert Wayland/X11 choice, stable copied engine path, systemd restart, tray, session composer, logs, and the previously observed `cannot prepare session while it is live` resume flow. Fix a reproduced product fault test-first.
- [ ] **Step 5: Run workflow logic without publishing.** Use actionlint, manifest generators/check modes, the Arch and Ubuntu container lanes, AppImage/deb extraction, installed layout checks, and packed-engine boot. Record the still-external first `desktop/**` PR runner pass and first signed `studio-v*` `release-linux` pass.
- [ ] **Step 6: Prepare notarization.** Validate signing identities, entitlements, hardened runtime, updater signatures, and `notarytool` command shape using a non-secret profile reference. Do not read or create the operator's app-specific password.
- [ ] **Step 7: Preserve the Windows decision.** Update the inventory with `DEFERRED (D23)` plus the exact demand/Scale-customer revisit trigger and link `../arxa/docs/research/windows-packaging.md`. Do not add Windows sidecars, Credential Manager, picker, service, installer, workflow, or PowerShell installer in this program.
- [ ] **Step 8: Run both repositories' full local gates and commit separately.** No tag, release upload, or store submission in this task.

### Task 16: Execute authenticated and physical acceptance gates

**Governing sources:** `docs/plans/claude-subscription-engine.md`, `docs/plans/zai-wire-params-test-battery.md`, `docs/plans/artifact-viewer-demo-runbook.md`, `mobile_flutter/deploy/physical-gates.md` created by Task 12, and the release plans.

**Files:**
- Modify only failing product/test code, test-first
- Create: `docs/plans/closeout-evidence-2026-09-12.md`
- Create/store studio logs and screenshots under `designs/evidence/studio-closeout-2026-09-12/`
- Store mobile logs/screenshots under `mobile_flutter/deploy/evidence/closeout-2026-09-12/` in the isolated arxa worktree

**Interfaces:**
- Consumes operator-provided sign-in/credentials through normal credential stores.
- Produces a redacted evidence matrix with command, environment class, commit, result, artifact path, and unresolved external prerequisite.

- [ ] **Step 1: Prepare every gate before requesting operator action.** Verify scripts parse, scratch paths are isolated, secrets are read only from credential stores/env, logs redact them, and expected quota/network effects are stated.
- [ ] **Step 2: Docker Sandbox gate.** After explicit authorization, let the product provision/start `sbx`, complete the OAuth device flow, apply the reviewed global deny-all plan, create a disposable sandbox with a scratch repository, prove policy denials and allowed model traffic, fetch its commit to a host recovery ref, remove it, and record retained-cache accounting. Restore the prior global policy if the approved runbook says it is reversible; otherwise leave the reviewed deny-all policy and record it.
- [ ] **Step 3: Claude gates.** Run the full signed-in smoke when authorized; on Linux run resume and Bash escape after `claude setup-token`; on Windows measure the ACL rung. The default bundled skill-pack set remains empty and gets a test asserting that policy.
- [ ] **Step 4: Z.ai gate.** Run `node scripts/zai-live-smoke.mjs` with the authorized credential path and require an actual successful response plus the intended model/wire parameters.
- [ ] **Step 5: Viewer gate.** Complete `docs/plans/artifact-viewer-demo-runbook.md`, including expired token, GET-only artifact origin, conflict, LSP diagnostics, autosave, diff, and viewport ladder.
- [ ] **Step 6: Mobile physical gates.** Follow `mobile_flutter/deploy/physical-gates.md` and run `mobile_flutter/integration_test/approvals_e2e_test.dart` plus its iOS/APNs and Android/FCM/APK legs when devices and credentials are available; verify pair, reconnect, notification presentation/tap, approval decision, and unpair/revocation.
- [ ] **Step 7: Release gates.** After explicit authorization, run notarization and the first live `release-linux` tag, verify published manifests/installers from a clean machine, and record URLs/checksums. If authorization or credentials are absent, mark `EXTERNAL` with the prepared command and owner; never mark complete.
- [ ] **Step 8: Fix failures through the task loop.** Any failure gets a minimal regression test, product fix, focused re-run, full relevant suite, separate review, and commit.
- [ ] **Step 9: Write the evidence matrix and commit.** `test: record authenticated and physical closeout evidence`.

### Task 17: Final documentation, vocabulary, and zero-open-items closeout

**Governing sources:** every plan cited above, `README.md`, `CONTEXT.md`, `CLAUDE.md`.

**Files:**
- Modify: `docs/plans/open-work-inventory-2026-09-12.md`
- Modify: completed source plans with dated outcome/status blocks
- Modify: `README.md` and `CONTEXT.md` only where shipped behavior changed
- Create: `docs/plans/arxa-studio-closeout-2026-09-12.md`

**Interfaces:**
- Produces one final matrix in which every `AXS-*` item is `CLOSED`, `DEFERRED` with a trigger, or `EXTERNAL` with an owner and prepared command.
- Vocabulary alignment: studio retains `changes-requested`; the sibling arxa side records `supersededBy` only if its governing design/version contract accepts it during review.

- [ ] **Step 1: Re-read all cited plans and the SDD ledger.** Map every original open claim to its implementing commit and evidence, or to a named deferral/external gate.
- [ ] **Step 2: Reconcile vocabulary.** Remove claims that studio lacks `changes-requested` or version minting. Record the remaining cross-product `supersededBy` decision in the correct arxa plan/contract; do not add an unconsumed field merely to satisfy prose.
- [ ] **Step 3: Close stale checklists.** Mark mobile, project routing, Claude implementation, artifact viewer, Git decorations, GitHub sign-in, sbx research, Freestyle, dashboard, and palette according to current evidence. Preserve history with dated outcome notes.
- [ ] **Step 4: Record intentional deferrals with triggers.** Freestyle multi-select/clipboard/compact folders/file nesting/sort, viewer edit-with-agent, dashboard-inside-open-chat, biometric approvals, and dsh cold-boot work each need a concrete trigger; none may remain as an ambiguous unchecked box.
- [ ] **Step 5: Run documentation consistency searches.** Search for superseded “PLAN ONLY”, “nothing built”, “still open”, and unchecked acceptance boxes in cited plans; each match must be historical context, an inventory row, or carry a dated resolution pointer.
- [ ] **Step 6: Run final verification.** Studio: `npm test`, focused smokes from Tasks 2–7, packed engine boot/check. Arxa: the changed package tests, Flutter analyze/test, Rust/Tauri checks, and workflow syntax checks. Read every exit code and final summary.
- [ ] **Step 7: Dispatch whole-program review.** Reviewer receives merge-base-to-HEAD diffs for both repositories, the final inventory, evidence matrix, and this plan. Resolve all high/medium findings and adjudicate every low finding in the ledger.
- [ ] **Step 8: Write the closeout report.** Include commits by repository, tests, visual/physical evidence, retained deferrals, external gates, and rollback notes.
- [ ] **Step 9: Commit documentation.** `docs: close the arxa studio implementation program`.

## Final definition of done

- [ ] Every Task 1 inventory row has an implementation commit and fresh evidence, or is explicitly `DEFERRED`/`EXTERNAL` with owner and trigger.
- [ ] Organisation trash cannot be followed by a session-created restore-blocking husk.
- [ ] Repo-less imported projects have a visible, explicit preparation path.
- [ ] Local checks, tree-level decorations, stress S4/S5, and the Git ledger strip are shipped and exercised.
- [ ] Artifact viewer trust boundaries and runtime behaviors are verified; retained pdf.js/Prettier choices are documented.
- [ ] The gen-ui Diff row is either implemented with the bounded Myers/LCS renderer against real file-diff input or carries the explicit real-input trigger and owner in the inventory.
- [ ] EN/PL/FR key parity and viewport evidence cover all touched desktop surfaces.
- [ ] New installs receive A0–A4 automatically and truthfully; existing profiles migrate only with proven launcher provenance or show a remediation action. A5 degrades safely and never discards unfetched work.
- [ ] Flutter mobile parity is evidenced from current code, the existing application ID is retained, and release builds cannot use the debug signing key.
- [ ] Local and Supabase workspace providers pass the same conformance and migration suites; local remains the default.
- [ ] Distribution artifacts and workflows are locally verified; external publishing/signing gates are clearly separated.
- [ ] Both repositories pass their full relevant suites from clean isolated worktrees.
- [ ] The final whole-program reviewer reports no unresolved high or medium findings.
- [ ] The closeout inventory contains no ambiguous open item and is the linked successor to the 2026-09-07 inventory.
