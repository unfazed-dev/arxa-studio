# Task 10 report — Implement A4 Docker/devcontainer isolation

**Status: DONE_WITH_CONCERNS** (complete, TDD throughout, all suites green; concerns are forward-looking, listed below)
**Commit:** `62ee8d5` `feat: add automatic Docker project isolation` (18 files, +1846/−20; `package-lock.json` dirt untouched and excluded)

## Detection results (this machine, 2026-09-13)

| Probe | Result |
|---|---|
| `command -v docker` | `/usr/local/bin/docker` |
| Docker daemon | **NOT reachable** (`Cannot connect … docker.sock`) → A4 unavailable, truthful reason recorded everywhere |
| `command -v supabase` | `/opt/homebrew/bin/supabase` (2.67.1) — CLI present, but a local stack needs the daemon → per-project DB degrades to the sqlite floor here |
| `command -v devcontainer` | absent → `detectDevcontainerCli()` honest-absence path is the live one |

## What was implemented, per step

**Step 1 — failing command-construction tests.** `plugins/sandbox/selftest.devcontainer.mjs` created: detection truthfulness (absent CLI vs dead daemon vs available), resolved config JSON (target-aware `build` + hardened `runArgs`), secret-free image/config invariants, frame stamping/never-clobber, absence behavior. RED: `Error [ERR_MODULE_NOT_FOUND] … lib/devcontainer.js` (module absent).

**Step 2 — detection + declarative generation.** `plugins/sandbox/lib/devcontainer.js`: `detectDocker(deps)` (CLI presence → `docker version` probe; distinguishes daemon-down from not-installed; never constructs an install command — pinned), `detectDevcontainerCli(deps)`, `ensureDevcontainer(projectRepo, target, deps)` (target derived from repo shape: package.json→node, pubspec.yaml→flutter, else plain; refuses `.git`/`.arxa` and `.devcontainer` symlink escape; realpath before mutation). Generation goes ONLY through the owned frame functions: `plugins/git-workspace/lib/frame.js` gained `DEVCONTAINER_TARGETS`, `devcontainerRunArgs()` (the ONE source of L1 hardening — `--read-only --tmpfs /tmp --cap-drop=ALL --security-opt no-new-privileges --memory=4g --cpus=2 --pids-limit=512 --network none`), `devcontainerJson(target)`, `devcontainerDockerfile(target)`; `writeFrameFiles`/`frameStatus` gained a `devcontainer` option; **FRAME_VERSION 6→7** (both v6 pins in `git-workspace/selftest.mjs` updated to v7 with the v7 story); JSON stamping added (`"_arxaFrame"` key — strict JSON has no comments). `effective-tier.js`: A4 degrade reason now carries the measured `dockerReason` (a dead daemon is not "Docker is not present"), and configured A5 with sbx missing falls back to **A4** when Docker can run containers (S3 #4 — highest tier actually available).

**Step 3 — lifecycle on an injected runner.** `startContainer({repoPath, branch, sessionId, target, secretMount})`: refuses `main`/`master` and non-git-alphabet branches before any docker call; refuses a host worktree's pointer-style `.git`; clones the exact branch via a host-side `git bundle` (the ONLY host path mounted, read-only, into the one-shot clone helper); private named volume `arxa-a4-<slug>-work`; image BUILT from the generated Dockerfile (`arxa-a4-<target>:frame`) so spec and runner share one truth; work container runs with the same `devcontainerRunArgs()`, mounting only the volume. `execContainer` (argv-only, structured, bounded), `fetchContainerCommits` (in-container `git bundle create --all` → `docker cp` → host `git fetch` into `refs/arxa/container-recovery/<slug>` → `merge-base --is-ancestor` verify), `stopContainer` (recovers first; **refuses teardown while any container commit is unreachable from the recovery ref**; idempotent). Per-repo registry `<repo>/.arxa/containers/<slug>.json` + the SYNC guard `unrecoveredContainerCommits(repoPath, sessionId)` wired into `finishSession` (typed `FinishRefusedError`, dryRun reason `container-work-unrecovered`, refusal changes nothing) and `dropSession` (same gate before the forced drop).

**Step 4 — file-based secret injection.** `prepareSecretMount({orgId, projectId, envSopsPath}, deps)`: consumes Task 9's keychain key (`accountFor`), sops-decrypts host-side with the identity ONLY in the sops child's env, writes a bounded 0600 file inside a 0700 `mkdtemp` dir, returns `{source, target: /run/secrets/arxa-env, secretDir, cleanup}`. `startContainer` mounts it `--mount type=bind,…,readonly` on the work container ONLY (never the clone helper), records `secretDir` for `stopContainer` cleanup, and removes the plaintext on the failed-start path. Negative tests: canary value absent from every recorded argv (no `-e`/`--env-file`/`--build-arg` anywhere), from the docker-inspect shape, from captured output, from devcontainer.json + Dockerfile bytes; sibling sessions never see another's secret dir; plaintext gone after cleanup/teardown/failed start.

**Step 5 — per-project database.** `plugins/sandbox/lib/project-database.js`: `detectSupabase` (detect-only), `allocatePortBlock` (5-port blocks from 54321 step 10, persisted by stable project id in a JSON registry, deterministic re-allocation, registry-overlap + live-bind collision checks), `ensureProjectDatabase` (`supabase init` INSIDE the isolated clone, config.toml ports patched per-section onto the block, `project_id` pinned to the stable slug; missing Docker or CLI → **sqlite floor** (`node:sqlite` under the project's reserved `.arxa/`) with the truthful reason), `startProjectDatabase` (**one active stack**: stops every other arxa-managed active stack first), `stopProjectDatabase` (`stop --project-id`, allocation retained). `supabase link` has no code path and is asserted against in the suite.

**Step 6 — smoke (DEGRADED, recorded).** See below.

**Step 7 — card.** `card.status` gains `confinement: {configured, effective, reason}` (configured = the provisioned default — **no second settings taxonomy**; effective = the session's recorded `containerTier` when A4 engaged, else `resolveEffectiveTier` with 30s-TTL-cached measured runners incl. `dockerReason`) and `container: {tier, unrecovered}` (§24e's "unfetched work exists"). Client detail line (existing card/status language): `confinement A2 → A4`-style shift part when they differ + `container work unfetched` part; i18n keys added in en/pl/fr; client regenerated (`gen-git-card.mjs --write`, drift check green).

**Step 8 — suites + commit.** Below.

## TDD evidence (RED → GREEN per step)

| Step | RED (command + excerpt) | GREEN |
|---|---|---|
| 1 | `node plugins/sandbox/selftest.devcontainer.mjs` → `Error [ERR_MODULE_NOT_FOUND]: Cannot find module …/plugins/sandbox/lib/devcontainer.js` | `… selftest: 15 checks green, 1 skipped` |
| 3 | same file (lifecycle rows added) → `SyntaxError: … does not provide an export named 'execContainer'` | `… 25 checks green, 1 skipped` (after GREEN; final 31/35 with steps 4/6) |
| 4 | same file (secret rows) → `SyntaxError: … does not provide an export named 'prepareSecretMount'` | `… 31 checks green, 1 skipped` |
| 5 | `node plugins/sandbox/selftest.project-database.mjs` → `ERR_MODULE_NOT_FOUND … lib/project-database.js` | `… 12 checks green` |
| tier | `node plugins/sandbox/selftest.mjs` → `AssertionError: the reason carries the measured truth, not a generic absent-Docker line` (actual: `'Docker is not present — …'`) | `arxa-sandbox selftest: 34 checks green` |
| finish guard | `node plugins/git-workspace/selftest.finish.mjs` → `assert.throws` failed (finishSession succeeded with an unrecovered registry row present) | `# 15 passed` |
| lifecycle | `node plugins/file-org-shell/selftest.mjs` → `AssertionError: A4: the container bridge ran once for the new session` | `file-org-shell selftest: 234 checks passed` |
| card | `node plugins/arxa-git-card/selftest.mjs` → `FAIL card: card.status carries confinement configured/effective (host half)` (+2 FAILs) | `arxa-git-card selftest: ALL GREEN` (+actions/freestyle/seat-manifest/relink) |

Honest-RED note: two mid-task RED runs initially "passed" because my `ok()` helper did not `await` async bodies — fixed by making every row awaited, then re-verified failures properly (the mis-ordering also hid a real fixture bug: `git add .` committing the `.arxa` registry row, which a later `reset --hard` deleted; production gitignores `.arxa/`, so the fixture now does too).

## Step 6 smoke path

**DEGRADED (injected runner) — recorded in the suite output:**
`smoke path: DEGRADED (injected runner) — Docker is installed (/usr/local/bin/docker) but its daemon is not reachable — …`
Reason: the daemon is down; the brief mandates detect-not-install and no daemon start on this RAM-constrained machine. The docker surface was doubled (argv recorded); the **host git surface ran for real** (bundle → fetch → `refs/arxa/container-recovery/*` → `merge-base` verify), as did port allocation/bind checks and registry persistence. Smoke rows: hardened start of node- and flutter-shaped scratch projects on their own branches, checks via exec, two database fixtures with distinct collision-free port blocks, a commit made inside the isolated clone fetched to the host recovery ref, full teardown, sentinels outside the namespace untouched. A REAL-container leg exists behind `daemon reachable && ARXA_A4_REAL_SMOKE=1` (image builds pull GBs; no test run may surprise-pull).

## Files changed

New: `plugins/sandbox/lib/devcontainer.js`, `plugins/sandbox/lib/project-database.js`, `plugins/sandbox/selftest.devcontainer.mjs`, `plugins/sandbox/selftest.project-database.mjs`.
Modified: `plugins/sandbox/lib/effective-tier.js`, `plugins/sandbox/package.json` (exports `./devcontainer`, `./project-database`), `plugins/sandbox/selftest.mjs`, `plugins/git-workspace/lib/frame.js` (v7 + generators + JSON stamping), `plugins/git-workspace/lib/finish.js` + `lib/sessions.js` (teardown guard), `plugins/git-workspace/selftest.finish.mjs` + `selftest.mjs`, `plugins/file-org-shell/lib/lifecycle.js` (sandbox bridge at session start) + `selftest.mjs`, `plugins/arxa-git-card/lib/index.js` + `git-card.snippet.txt` + regenerated `client.js` + `selftest.mjs`.

## Test summary

- Focused: sandbox devcontainer 35 (+1 honest skip) · project-database 12 · sandbox 34 · filesystem 15 · project-secrets 4(+1 skip) · git-workspace main 78/78 · finish 15/15 · file-org-shell 234 · git-card 5 suites ALL GREEN · gen-git-card drift check in sync.
- Full `npm test`: **ALL GREEN** (every suite, incl. preset-check, pack-list-check, mirror-drift-check, cicd-stress, card-local-smoke).

## Self-review findings

- One source of truth for hardening: `frame.devcontainerRunArgs()` feeds BOTH the declarative `devcontainer.json` and the `docker run` argv — spec and runner cannot drift (pinned by two suites).
- Secrets discipline held: no secret value ever printed by a green run; all assertions are presence/shape/absence.
- Namespacing held: every docker name/volume/container is `arxa-a4-*`; tests touch only scratch dirs + doubled docker; no real Supabase project, no `link` argv anywhere; sentinels verified untouched.
- YAGNI: no second settings taxonomy (configured stays the provisioned default); the devcontainer CLI is detected and reported but the lifecycle uses raw docker because `devcontainer up --workspace-folder` bind-mounts a host path — forbidden by the invariants.

## Concerns

1. **The real-container path has never executed end-to-end here** (daemon down). First real run should be watched for: base-image pull size (flutter image is ~2 GB), the `chown -R 1000:1000` assumption for the non-root user on fresh volumes, and `sleep infinity` under `--read-only` (expected fine — no rootfs writes). The degraded smoke covers the git/recovery/refusal logic for real; the docker argv is construction-pinned only.
2. **Session-create now starts a container on Docker-present machines** (S3 "automatic"). Cost model on low-RAM machines is untested; the bridge fails soft (annotate, never break the session), and the DB tier already enforces one-stack-at-a-time — but container-per-session density is a live question for the operator.
3. `--network none` is the explicit default (egress off until a phase split exists): correct per plan, but toolchain installs inside the container will fail offline by design; the honest path is a future supervised install phase, not a quiet flag flip.
4. The card's `configured` tier is always the provisioned default today; the shift line will show `A2 → A4` on Docker machines (A4 engaging automatically per S3) and `A4/A5 → A3` style degrades only once a configured-tier surface exists upstream. The payload already carries both values + reason so no client change will be needed then.

## Fix round 1

Fixing the six review findings (1 Critical + 5 Important, review of 62ee8d5). Every fix was written test-first; each covering row was watched RED against the unfixed product before the fix landed, then GREEN.

### What changed, per finding

**F1 (Critical) — `stopContainer` ignored `docker rm`/`volume rm` exit codes** (`lib/devcontainer.js`)
- A failed `docker rm` is now a refusal, not a shrug: on non-zero, `objectGone()` runs a `docker container inspect` (resp. `volume inspect`); exit 0 → the object still exists → refuse; "No such" → verified absent → proceed (idempotent against an already-removed object); a daemon/connection error → UNVERIFIED → refuse. On any refusal the registry row and the recorded `secretDir` survive, so `unrecoveredContainerCommits` stays armed and `finishSession`/`dropSession` cannot delete the branch while commits sit in an orphaned volume.
- Covering row: `stopContainer keeps the registry row when the daemon is down (rm fails)` — pre-condition is a *good* fetch (work recovered), so the only failure left is the rm itself; RED was `Missing expected rejection` (it silently returned `{stopped:true}` and deleted the row). An earlier draft of the row passed for the wrong reason (the preceding 'unrecovered' row had poisoned `row.head`); fixed by re-fetching inside the row.

**F2 — `ARXA_A4_REAL_SMOKE` never selected a real runner** (`selftest.devcontainer.mjs`)
- Code fix chosen (per dispatch preference). Hoisted `smokeRunnerFor(real, repo, branch)`: the real leg returns `{ run: undefined }` → `deps.runner ?? defaultRunner` → REAL docker subprocesses for build/volume/run/exec/cp/rm; the degraded leg returns the hybrid double. The smoke's `runnerFor` now goes through it, so with a live daemon + flag set the Step-6 lifecycle genuinely runs containers; when the flag is set but the daemon is down, the run prints `ARXA_A4_REAL_SMOKE=1 requested — the real leg is SKIPPED: <reason>`. Task 16 enables the leg by setting the env var on a daemon-up machine.
- Covering row: `ARXA_A4_REAL_SMOKE genuinely selects the real runner, never a double`. RED: `smokeRunnerFor(true, …).run` was the double's `run`.

**F3 — `startProjectDatabase` read the registry before `allocatePortBlock` persisted it** (`lib/project-database.js`)
- The registry read moved AFTER `allocatePortBlock`: the fresh read sees the just-persisted project row (no `TypeError` on a brand-new project id) and the final whole-file write can no longer clobber rows allocated in between.
- Covering row: `start of a brand-new project id (no pre-allocation) works and clobbers nothing` — starts `freshproj` with only a pre-allocated `neighborproj` in the registry, asserts the fresh row is persisted AND the neighbor row survives. RED was exactly the reviewer's `TypeError: Cannot set properties of undefined (setting 'active')`.

**F4 — `deps.docker ?? { available: true }` assumed Docker** (`lib/project-database.js`)
- The exported default now DETECTS: `deps.docker ?? detectDocker()` (imported from `lib/devcontainer.js`; no import cycle — nothing in `lib/` imports back). The no-deps path degrades to the sqlite floor with the measured reason instead of throwing through a fabricated `available:true`.
- Covering row: `with no injected docker dep the machine is DETECTED, never assumed` — machine-independent: asserts `tier === 'file'` with `detectDocker().reason` when Docker is measured absent (this machine: RED, it provisioned `supabase-local` on the assumption), `supabase-local` when measured present.

**F5 — `startContainer` was not idempotent** (`lib/devcontainer.js`)
- After the repo/pointer guards, `startContainer` now checks the session's registry row first and returns it as the live handle — a re-start clones nothing, builds nothing, and cannot collide on the container name or clone into the session's own non-empty volume (brief Step 3).
- Covering row: `startContainer is idempotent: a re-start returns the live handle from the registry row` — RED: the re-start re-issued the full docker sequence (`a re-start builds nothing, clones nothing, starts nothing` failed).

**F6 — no signal-path cleanup for the plaintext temp dir** (`lib/devcontainer.js`)
- `sweepStaleSecretDirs()` exported and run once at module boot (guarded try/catch — a boot sweep must never break boot): removes every `arxa-secret-*` dir under `os.tmpdir()`. At boot no lifecycle is live yet, so any such dir is stale by definition — this is the SIGINT/SIGKILL-between-`prepareSecretMount`-and-registry-write path. Known ceiling (marked `ponytail:`): a second concurrently-running arxa process would lose its live dir to the sweep; per-session locks if that ever matters. The normal/teardown/failed-start paths were already covered, and `stopContainer`'s registry-recorded `secretDir` cleanup stays.
- Covering row: `the boot sweep removes stale plaintext dirs a killed process left behind` — fake tmpdir seeded with `arxa-secret-leftbykill/arxa-env` plus unrelated entries; asserts exactly 1 swept, plaintext gone, neighbours untouched. RED: ESM link error `does not provide an export named 'sweepStaleSecretDirs'`.

Findings 7–10 (Minor) deferred per dispatch.

### Verification

```
node plugins/sandbox/selftest.devcontainer.mjs   → arxa devcontainer selftest: 39 checks green, 1 skipped   (exit 0)
node plugins/sandbox/selftest.project-database.mjs → arxa project-database selftest: 14 checks green          (exit 0)
node plugins/sandbox/selftest.mjs                → arxa-sandbox selftest: 34 checks green                    (exit 0)
npm test                                         → arxa-studio CI: ALL GREEN                                 (exit 0)
```

Check deltas: devcontainer 35→39 (4 new rows), project-database 12→14 (2 new rows). The 1 skip is the honest live-daemon row (daemon down on this machine). No real docker was invoked (daemon down; hybrid doubles as before); the real leg is now genuinely reachable behind `ARXA_A4_REAL_SMOKE=1`.
