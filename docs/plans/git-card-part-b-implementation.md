# Composer git card — PART B implementation plan

Spec: docs/plans/git-card-part-b-grill.md (Q1–Q10, riders, verifications).
Convention: vertical slices, each with a runnable exit check. If a slice
exceeds ~a week of work, split it before starting. Every shipped plugin
change bumps the plugin version (D77 packaging lesson).

## S0 — Build-time verifications (de-risk, half a day)

Live on a throwaway GitHub repo under unfazed-dev (deleted after):

1. **V1 token scopes** — D76 keyring token must cover: PUT
   branches/{main}/protection, PATCH repo settings (merge methods), POST
   actions/runners/registration-token, PR create + squash merge. If a
   scope is missing, the device-flow link scope list changes FIRST
   (re-link unavoidable — measure before building).
2. **V2 PR resolve** — push main containing a PR's head commits; observe
   GitHub marks the PR merged/closed. Pins Q2's "PR as share artifact".
3. **V4 protection vs machine commits** — strict:true + enforce_admins
   false + admin token: direct snapshot/manifest pushes to main succeed
   and trigger push-CI.

Exit: three facts recorded in this file's Verification log section.

## S1 — CI frame (scaffold + publish wiring)

**Build**
- `plugins/git-workspace/lib/frame.js` (new) — the frame SSOT:
  - `orgCheckSh()` / `projectCheckSh()` — day-zero `check.sh` bodies:
    content-light org checks (org.json parses, top-level dirs slug-valid,
    no stray index.lock/temp files, stages well-formed) and stack-probe
    project checks (pubspec/package.json/Cargo.toml/pyproject → that
    stack's test command; light otherwise). BOTH append the REQUIRED
    conventional-subject check (`git rev-list --no-merges`, window
    `origin/main..HEAD` when remote exists else last boundary) — the
    subject regex is duplicated in sh; a comment points at the JS twin
    (S3) as the other half of the SSOT pair.
  - `ciYml(jobs)` — `on: push[main] + pull_request`, concurrency
    ci-${{ github.ref }} cancel-in-progress, job-per-area,
    timeout-minutes always, `runs-on: [self-hosted, macOS, ARM64, arxa]`.
  - `prTemplate()` — .github/pull_request_template.md (problem/fix/
    attribution fields).
  - `protectionPayload(contexts)` — strict:true, enforce_admins:false,
    allow_force_pushes/deletions:false.
  - `settingsPayload()` — allow_squash_merge only.
- `plugins/workspace/lib/scaffold.js` — scaffoldOrg/scaffoldProject emit
  executable `check.sh` (+ pr template). No network, no runner: frame
  files are local day-zero.
- `plugins/file-org-shell/lib/github-bridge.js` — new faces:
  `wireFrame(owner, name)` (settings PUT + protection PUT),
  `ensureRunner(owner, name)` (probe registered runners; register one
  instance per repo under `~/.arxa/runners/<owner>__<name>` via the
  register-runner.sh pattern — config.sh unattended + svc.sh LaunchAgent
  `dev.arxa.runner.<owner>.<name>`; idempotent; throw-proof).
- `publishRepoOnce`/heal — after push: wireFrame + ensureRunner,
  best-effort, manifest gains `frameWired: true` on success.

**Exit check** — create a test org via the app → publish → repo has
check.sh + ci.yml + template + protection + squash-only + live runner;
first workflow run green (`gh run watch`); local `sh check.sh` exit 0
on the fresh scaffold (green by absence); commit a bad subject locally →
check.sh exit 1.

**Discharges**: Q3, Q4, Q5, Q7 (enforcement half), Q8 (settings lock).
**Risk**: runner-per-repo multiplication on one Mac — register lazily at
first publish, one dir + one LaunchAgent each; measure. Version-bump
both plugins.

## S2 — WIP watcher (D18 completion)

**Build**
- `plugins/git-workspace/lib/watch.js` (new) —
  `createWipWatcher(paths, { debounceMs = 3000 })`: recursive fs.watch
  per path, ignore `.git` + `node_modules`, debounce, `wipCommit` on
  quiet; returns stop(). No fs polling.
- `lifecycle.js` openOrg — start watcher over the primary worktree;
  session open/revive/archive reconfigures the path set; stop() rides the
  handle's _undo list (closeOrg teardown). Comment records the relaxed
  no-watcher invariant (Q9).

**Exit check** — with a test org open in the shipped app, edit a file in
Finder: a `wip:` commit lands within ~5s; session worktree edits likewise;
closeOrg → further edits produce no commits.

**Discharges**: Q9. **Risk**: V3 — watcher cost on business_ssd-scale
trees; measure debounce budget before freezing 3s.

## S3 — Card engine actions + commit-law plumbing

**Build**
- `plugins/git-workspace/lib/subjects.js` (new) — conventional-subject
  validator (regex + types list) shared by card + selftests; comment-pair
  with the sh twin in frame.js.
- `commits.js`/`sessions.js` — stage commits: drop the `stage:` subject
  prefix; add `Arxa-Stage: <session|org>` trailer via commit-tree -m
  (second -m line). Message plumbing: caller-supplied conventional
  subject required for card paths; machine fallbacks get chore() style.
- `lifecycle.js` — migrate the 5 machine commit sites to
  `chore(<scope>): …` (publish/rename×2/local-only/disconnect).
- `plugins/arxa-sidebar/lib/index.js` — actions (all over the open-org
  handle, session-worktree aware):
  - `card.status` → dirty counts (porcelain v2 -z), ahead/behind vs
    origin/main, wipRun length, last boundary time, version chip
    (versions.js), localOnly, linked, runner state (queued detection).
  - `card.commit.draft` → evidence: diff --stat summary + recent stage
    subjects (for the session model to draft; Q6 — the MODEL drafts,
    engine never calls an LLM).
  - `card.commit` → sessionStageBoundary with validated conventional
    subject + trailer; gate runs (strictest-gate Q2 local half).
  - `card.push` → pushRepo of the session branch (PR-purpose only —
    comment records the D73 relaxation).
  - `card.pr.create` / `card.pr.status` → REST: dedupe by head, title
    validated, body template + attribution, real-not-draft; checks rollup
    with queued→runner-asleep classification.

**Exit check** — selftest green: subject validator table (good/bad/
merge-excluded), trailer present, machine-commit migration pins, every
action stubbed end-to-end; `node scripts/ci.mjs` 15 suites.

**Discharges**: Q2 (local half), Q6, Q7 (plumbing half). **Risk**: none
new; pure engine, no UI yet.

## S4 — Card UI (Creator mode, harmonious)

**Build**
- Compose in the Cordis preset (Creator mode, `profile/cordis.patch.yml`)
  FIRST; iterate; freeze; ship arxa's own composition (integration-plan
  UI-harmony rule). Stock preset stays read-only.
- Surface: collapsible dsh-goals-style card over the composer in every
  arxa session. Regions: status cluster (Q10 items), version chip,
  commit-draft confirm field (pre-filled, editable, one-click), tiered
  CTAs (Commit / Push / Publish / PR) each with confirm, runner-asleep
  wake CTA, local-only Connect CTA. i18n en + zh.
- Layout coordination: artifact-viewer docked column owns the right
  column; the card owns the strip above the composer. Verify no
  collision via lens at 1280 + 390 ladder.
- gen-workspace splice ONLY where dsh-owned surfaces must change
  (depend-don't-fork); prefer an arxa-owned region like the viewer did.

**Exit check** — lens captures: card collapsed/expanded, all states
(local-only org, linked org, runner asleep, dirty/clean); structural
selftest pins (Fragment eval, i18n keys); CI green.

**Discharges**: Q1 (surface), Q10. **Risk**: turf with the artifact-viewer
session — sync before landing.

## S5 — PR flow end-to-end + smoke + ship

**Build**
- Full loop wiring: card → commit (boundary) → push branch → pr.create →
  checks green → squash-merge (auto) → local main advance (pull) → PR
  resolved (V2). Update-branch before merge when behind (strict:true).
- `scripts/org-link-smoke.mjs` — extend: frame assertions (check.sh,
  protection, squash-only, runner registered), session→PR→merge→advance,
  bad-subject refusal, runner-asleep classification (stubbed).
- Docs: CONTEXT.md vocabulary entries (seat/card/stage boundary/heal/
  confirm-tier), grill-decisions cross-link.

**Exit check** — smoke green against a live throwaway repo (deleted
after); CI 15 suites; pack-sidecar + tauri build + install + relaunch;
verified live in the shipped app end-to-end.

**Discharges**: Q1–Q10 end-to-end. **Risk**: V5 — token refresh mid-flow
(long PR waits); bounded waiter + one refresh+retry like D76's 401 path.

## Verification log

- **S2 (2026-08-31):** watcher verified in selftests — out-of-band edit
  lands a `wip:` commit within seconds; closeOrg stops it; `.git`
  ignored; unborn repos never committed into (the deferred-snapshot race
  found by arxa-sidebar's rows-snap test and fixed by booting the net
  only once HEAD exists).
- **S3 (2026-08-31):** `stage:` subject prefix dead; conventional
  subjects + `Arxa-Stage:` trailers (selftest asserts trailer present,
  subject conventional); the six `card.*` actions pinned in the sidebar
  selftest; PR faces (create/list/merge/checks with runner-asleep) live.
- **S4 (2026-08-31):** ArxaGitCard portal-mounted above the composer bar
  (`data-arxa-card-host` insertBefore the composer slot), session-bound,
  collapsible, i18n en+zh; "Ask the session to draft" prefills the
  composer with the evidence + rule (Q6: the engine never drafts).
  Creator-mode iteration in the running app remains the follow-up once
  the artifact-viewer column turf settles — the card's logic, actions and
  i18n are placement-agnostic.
- **S5 (2026-08-31):** org-link-smoke extended with the full card loop
  (5e): publish → session → out-of-band edit → watcher wip → status →
  subject law refusal → boundary commit → session-branch push → PR +
  dedupe → squash merge on GitHub → runner cleanup → disconnect.

- **S0 (2026-08-31, live, throwaway repos deleted after):**
  - **V1 token scopes** — app token (repo, read:user, delete_repo) covers:
    repo create 201; settings PATCH squash-only 200; runner
    registration-token 201; PR create 201 + squash merge 200.
    **EXCEPTION: branch-protection PUT on PRIVATE repos = 403
    "Upgrade to GitHub Pro or make this repository public"** (account is
    free plan; same PUT returns 200 on a public repo). Design amendment:
    wireFrame attempts protection and degrades to
    `protection: 'plan-limited'` in the manifest — the card enforces
    gates client-side regardless (Q2 already makes the local gate
    authoritative for the card's merge path; GitHub-side blocking is
    defense-in-depth when the plan allows it).
  - **V2 PR resolve** — pushing main that contains a PR's head commits
    flips the PR to closed+merged=true (measured live, PR #2). Q2's
    "PR as share artifact" holds.
  - **V4 protection vs machine commits** — protection 200 on public
    (strict + required checks + enforce_admins:false); admin direct push
    of a machine commit succeeds ("Bypassed rule violations" notice).
    Canon behavior confirmed.
- **S1 (2026-08-31, live, `Arxa-S1-Frame` repo — deleted after):** frame
  end-to-end GREEN on real GitHub: open emits check.sh (committed, clean
  tree), heal publishes + wires, **squash-only settings locked**,
  **ci.yml pushed**, **real self-hosted runner registered (canon labels,
  LaunchAgent)**, **first workflow run completed success** on the runner,
  cleanup verified (repo + runner + agent removed; tarball cache kept).
  **New fact found live (missed by S0):** GitHub REFUSES OAuth-token pushes
  of workflow files without the `workflow` scope — SCOPES now includes
  `workflow`; links created before it record `missingScopes` via status()
  and need ONE re-link (same unavoidable class as D76). Frame failures
  annotate the manifest and retry on next publish/heal.

## Traceability

| Decision | Slice | | Decision | Slice |
|---|---|---|---|---|
| Q1 | S4/S5 | | Q6 | S3 |
| Q2 | S3/S5 | | Q7 | S1/S3 |
| Q3 | S1 | | Q8 | S1/S5 |
| Q4 | S1 | | Q9 | S2 |
| Q5 | S1 | | Q10 | S4 |
