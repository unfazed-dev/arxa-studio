# Task 11 report — A5 Docker Sandbox isolation and safe teardown

Branch `closeout-2026-09-12`, BASE f35389b. Commit: `feat: add Docker Sandbox isolation with recoverable teardown`.
Governing narrative: `docs/plans/arxa-isolation-levels.md` §§21–24/S3/S4 (read in full before coding). Inventory row: AXS-010.

## What shipped, per step

### Step 1 — failing parser/state tests (`plugins/sandbox/selftest.sbx.mjs`)
Every state the plan measured, as a fixture parsed to a truthful row: unauthenticated 401 (`no valid user session`), OAuth device flow failures (Auth0 `Global rate limit exceeded`, cancellation), daemon stopped (rc 0, `Status: stopped` — the TEXT decides, not the exit code), absent global policy (`has not been initialized`), deny-all/allow-all postures, per-sandbox kit rules, empty `sbx ls --json` (`{"sandboxes":[]}`, re-measured 2026-09-13), the version line through the update-banner noise, and the `sbx rm` refusal text. Fixtures are verbatim from §§21/22/24 plus fresh reads of the real CLI (v0.39.0) on this machine.

### Step 2 — sbx packaging (`plugins/sandbox/lib/sbx-install.js`)
`SBX_PIN` (version + per-platform artifact + sha256), `planSbxInstall` (pure; unsupported platform refused; **unmeasured checksum pins fail closed — arxa never downloads-and-runs an unverified binary**), `ensureSbxInstalled` (idempotent stamp → operator-PATH detect-never-modify → pinned download + real-crypto sha256 verify + extract into `<arxaHome>/bin`, the ARXA_HOME convention; tampered bytes refused with nothing installed; stale stamp upgrades in place), `ensureSbxDaemon` (`daemon start` idempotent + `daemon status` text-truth + `diagnose` captured; never throws), `ensureSbxRuntime` (install→daemon→status; **never signs in, never touches policy** — asserted). No Homebrew anywhere; downloader/extract/fs/which/runner all injected; tests never touch `/opt/homebrew/bin/sbx`.

### Step 3 — detection + one-time sign-in (`sbxStatus`, `sbxLoginFlow`)
`sbxStatus` measures CLI/version/update-banner/daemon/auth and returns `runners: { sbx, sbxAuthed, sbxReason }` ready for `resolveEffectiveTier`. `effective-tier.js` A5 branch now honors `sbxReason` exactly like A4's `dockerReason` (a stopped daemon is not "not installed"). `sbxLoginFlow` runs **bare `['sbx','login']`** — never `--username`/`--password-stdin` (asserted; §23a credential refusal), classifies failures into `{signedIn, retryable, degrade:'A4', reason}` with **classified reasons only** (login output carries the device code — an OAuth code arxa must not print), and never throws: cancellation/failure degrade, session never blocks (S3 #4).

### Step 4 — policy planning without touching global state (`ensurePolicy`)
Reads only `sbx policy ls`. Uninitialized → plans exactly `['sbx','policy','init','deny-all']`; wider posture → `[reset, init deny-all]` (init is one-time, §22a); deny-all → compliant, no change; 401 → plans nothing, names the gate; unreadable → plans nothing blind. Per-sandbox rules surfaced separately (lifecycle-bound, §24e). `applied: false` always; the read-only invariant is asserted (the only argv it ever runs is `sbx policy ls`).

### Step 5 — clone/start/Git retrieval (`createSandbox`, `startSandbox`, `resolveGitEndpoint`, `fetchSandboxCommits`)
`createSandbox`: the measured §24 signature `sbx create --clone --name arxa-sbx-<slug> <agent> <path>`; refuses main/master and non-git-alphabet branches before any sbx call; refuses `.git`/`.arxa` reserved paths; idempotent via the registry row (`<repo>/.arxa/sandboxes/<slug>.json`); the row records name/remote/`refs/sandboxes/<name>/<branch>` and **never a port or URL** (asserted). `resolveGitEndpoint`: fresh `sbx ls --json` (or text) per call; follows the changing ephemeral port (49154→49155 asserted); absent sandbox **refuses, never a stale URL** (§24d). `startSandbox`: `sbx exec <name> true` wake BEFORE the port read (argv-order asserted). `fetchSandboxCommits`: wake → in-sandbox `rev-parse HEAD` + branch → remote add/set-url maintenance (sbx does not add it, §24d #3) → fetch `+refs/heads/<branch>:refs/sandboxes/<name>/<branch>` → `merge-base --is-ancestor` verification → row updated. A head outside the ref reports `reachable:false`, never a silent pass.

### Step 6 — Finish/Sweep integration (`removeSandbox` + `unrecoveredSandboxCommits`)
`removeSandbox` mirrors A4's hardened `stopContainer` exactly: recover-first (row.head fallback), **refuse while any commit is unreachable — zero `rm` argv in that state (the binding invariant, asserted)**; `sbx rm --force` only after verified reachability; absence verified via `sbx ls` (unreadable = still present, row stays armed); failed rm + still listed → bookkeeping refusal, row survives; registry row deleted only after verified removal; **`refs/sandboxes/<name>/<branch>` RETAINED after teardown** (asserted post-removal); report separates `retainedImageCache`/`cacheBytes` (measured `du -sk` on the store, ~retained by design, §24e) from `reclaimedWorkspaceBytes`. `unrecoveredSandboxCommits` is the sync seam; wired into `finishSession` (reason `sandbox-work-unrecovered`, dryRun + refusal change nothing) and `dropSession` — the same seam shape as A4's container guard. Plugin entry (`plugins/sandbox/package.json` exports) gained `./sbx` and `./sbx-install`; asserted by test.

## TDD evidence (RED → GREEN per stage)

| Stage | RED (observed) | GREEN |
|---|---|---|
| Step 1/3/4 parsers+flows | `ERR_MODULE_NOT_FOUND …/lib/sbx.js` | 16 checks |
| effective-tier sbxReason | assertion: reason lacked `/daemon/` (generic "not installed" line) | row green; `sandbox/selftest.mjs` 34 still green |
| Step 2 install | `ERR_MODULE_NOT_FOUND …/lib/sbx-install.js` | 11 checks |
| Step 5 lifecycle | `Error: sbx: createSandbox lands with Step 5 (test-first)` from the stub | lifecycle rows green |
| Step 6 teardown | stub throw + refusal rows against unimplemented `removeSandbox` | teardown rows green |
| finish/drop seam | `finishSession` did NOT throw (guard unwired) — assertion diff | `git-workspace/selftest.finish.mjs` 18/18 |

Intermediate honest failures fixed on the TEST side during RED→GREEN (test-double bugs, not product): `await` missing on async probes, macOS `/var`→`/private/var` realpath, runner script-order (script must beat the exec-rev-parse default), deadbeef script corrupting the branch probe too. Final focused suites: `sandbox/selftest.sbx.mjs` **32 green**, `sandbox/selftest.sbx-install.mjs` **11 green**, `git-workspace/selftest.finish.mjs` **18/18**, `sandbox/selftest.mjs` 34 green. **Full `npm test`: ALL GREEN** (both new suites auto-discovered by `scripts/ci.mjs`).

## Task 16 real-gate command plan (disposable; execute only under explicit operator authorization)

Machine truth at handoff: sbx v0.39.0 at `/opt/homebrew/bin/sbx`, daemon running, signed in (`unfazedhuman`), global posture already `deny-all` (read-only `sbx policy ls` confirmed 2026-09-13). ARXA_A5_REAL_SMOKE is the sentinel; this suite stays injected by design.

1. **Runtime probe (read-only):** `node -e "import('./plugins/sandbox/lib/sbx-install.js').then(m=>m.ensureSbxRuntime()).then(console.log)"` — expect `installed:true, managed:'operator-path', daemon:true, authed:true`. NOTE: the `ls` auth probe auto-starts a stopped sandboxd daemon (measured; §23 assigns daemon start to arxa anyway).
2. **Policy plan (read-only):** `node -e "import('./plugins/sandbox/lib/sbx.js').then(m=>m.ensurePolicy()).then(console.log)"` — expect `current:'deny-all', compliant:true, changes:[]`. If `uninitialized`/wider: the gate reviews then runs the planned argv itself.
3. **Fill the pins (blocking for the install leg):** download the v0.42.1 assets from `github.com/docker/sbx-releases`, record official sha256s + the real asset file names into `SBX_PIN` (currently `null` → fail-closed refusals by design). Verify `planSbxInstall({platform:'darwin',arch:'arm64'})` returns `supported:true`, then exercise `ensureSbxInstalled` against a THROWAWAY `stateRoot` (never the operator PATH install).
4. **Disposable lifecycle (scratch repo `/Volumes/business_ssd/_sbxtask16`, branch `arxa/smoke`, sessionId `task16-smoke`):**
   - `createSandbox({repoPath, branch:'arxa/smoke', sessionId:'task16-smoke'})` → expect `sbx create --clone --name arxa-sbx-task16-smoke claude <path>`; capture creation output (ro mount + git-daemon lines) as evidence.
   - Commit inside: `sbx exec arxa-sbx-task16-smoke git -C /Volumes/business_ssd/_sbxtask16 commit …` — **capture the REAL `sbx ls --json` entry shape here and reconcile the tolerant `git://` field parse** (the one unmeasured parser assumption; ponytail-marked in `resolveGitEndpoint`).
   - `fetchSandboxCommits(handle)` → expect remote `sandbox-arxa-sbx-task16-smoke` added, fetch into `refs/sandboxes/arxa-sbx-task16-smoke/arxa/smoke`, `reachable:true`, host `rev-parse` == in-sandbox HEAD.
   - `removeSandbox(handle)` → expect exactly one `sbx rm --force`, absence verified, recovery ref retained, report with `retainedImageCache:true` + cacheBytes/reclaimed separated.
5. **Negative evidence (reuse §24 methods):** write attempt to `/run/sandbox/source` inside → read-only refusal; (optional, AXS-015) egress denial `403` for a non-allowed host.
6. **Cleanup:** delete the scratch repo; retain the recovery ref until evidence is logged, then `git update-ref -d` it. Expected evidence: command + output per row in the Task 16 log.

## Files changed

- Create: `plugins/sandbox/lib/sbx.js`, `plugins/sandbox/lib/sbx-install.js`, `plugins/sandbox/selftest.sbx.mjs`, `plugins/sandbox/selftest.sbx-install.mjs`
- Modify: `plugins/sandbox/lib/effective-tier.js` (A5 `sbxReason` detail), `plugins/git-workspace/lib/finish.js` + `lib/sessions.js` (sandbox-work guard through the exported seam), `plugins/sandbox/package.json` (exports), `plugins/git-workspace/selftest.finish.mjs` (RED rows)

## Self-review findings

- Safety invariant holds by construction and is directly asserted twice (zero-`rm`-while-unrecovered; recovery-ref-retained-after-removal). Failed-verifications keep the registry row armed, mirroring the reviewed A4 pattern.
- No secrets/OAuth codes printed: login reasons classified only; error strings carry bounded sbx/git stderr (never login stdout).
- Honest ceilings, ponytail-marked: tolerant `git://` JSON-field parse (verified at the gate, step 4 above); single-branch fetch of the in-sandbox HEAD branch; null checksum pins (fail-closed, gate fills); artifact file names unmeasured.
- Two daemon probes were unavoidable live reads during fixture capture (`sbx ls` auto-started the stopped daemon) — read-only in sandbox/policy/auth terms, recorded as a ledger finding.
- The A4 freestyle-registry finding from Task 10 applies equally to `<repo>/.arxa/sandboxes/` (same `ensureExcluded` coverage question).

## Concerns

- `SBX_PIN` ships unmeasured (null) checksums: the install leg cannot run anywhere until Task 16 fills it. Deliberate fail-closed design, but it means A5's packaging is mechanism-complete and evidence-pending.
- The `sbx ls --json` per-entry field shape is inferred, not measured (no sandbox exists to list). The parser accepts any `git://` URL on the entry; Task 16 step 4 reconciles.
- Nothing in-product calls the lifecycle yet beyond the finish/drop guard — session-start selection of A5 is the caller's (Task 16/17+) integration, consistent with the brief's interface-only scope.

## Fix round 1

Review finding IMPORTANT 1 (+ tied Minor 5), fixed in commit `e800fe9` (`fix: gate the live sbx probe behind the real-smoke flag`).

- **What changed:** the ungated live probe (`selftest.sbx.mjs` §6) ran real `sbx version/daemon status/ls` on every `npm test` — and `sbx ls` auto-starts a stopped daemon (the ledger's own measurement), a real state mutation from an injected-only suite. The whole probe now sits behind `ARXA_A5_REAL_SMOKE === '1'` like the lifecycle leg; the default path runs ZERO real sbx commands and skips with a printed reason naming the side effect. The block comment no longer claims "read-only"; it names the auto-start. Coverage is untouched: the injected `sbxStatus` parse-shape rows (§1: absent CLI, version-through-banner, stopped daemon rc 0, 401, A5-ready) were already gated-free. Minor 5: `sbx.js`'s `sbxStatus` doc comment now says "never starts the daemon itself" is false — the one measured side effect is that `sbx ls` auto-starts a stopped daemon.
- **Covering test:** the skip line itself (`skip live sbx detection — ARXA_A5_REAL_SMOKE unset …`) plus the pre-existing injected rows and `ok the real gate stays shut without authorization` (`sbxStatus({ which: () => undefined })` → `runners.sbx === false`).
- **Command/output:** `node plugins/sandbox/selftest.sbx.mjs` (env unset) → `arxa sbx selftest: 32 checks green, 1 skipped`, skip line visible, no `live sbx detection:` row. `npm test` → exit 0, `arxa-studio CI: ALL GREEN`, **119 GREEN suites, 0 red**. `package-lock.json` dirt left out of the commit.
