⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set and takes precedence over your claude.ai login · Unset it to load your organization's connectors
[claude-code:unrecognized_model] {"model":"glm-5.3[1m]","query_source":"sdk"}
### Spec Compliance
✅ **Spec compliant**

- All 8 interfaces exported (`sbx.js`): `sbxStatus`, `sbxLoginFlow`, `ensurePolicy`, `createSandbox`, `startSandbox`, `resolveGitEndpoint`, `fetchSandboxCommits`, `removeSandbox` + `unrecoveredSandboxCommits` seam. Package exports asserted (selftest.sbx.mjs:556).
- Step 1 matrix — all 9 states covered: 401 (selftest.sbx.mjs:196), device flow (229–261), daemon-stopped rc-0-text-truth (183), absent policy (267), port change 49154→49155 (278), stopped sandbox refuses endpoint (282), remote add/set-url (307–327), unfetched-work refusal (309), cache accounting (325).
- Never-force invariant: `--force` constructed at exactly one site (`sbx.js:460`), gated by `merge-base --is-ancestor` refusal at `sbx.js:456`; null/never-fetched head → git errors → refusal (fail-closed). Recovery ref never deleted; retention asserted post-removal (selftest.sbx.mjs:446–448).
- Policy: only argv ever run is `sbx policy ls` (`sbx.js:191`), asserted at argv level (selftest.sbx.mjs:300). No `policy init` execution path in diff — appears only as returned data/fixtures.
- Port per start, wake-before-fetch (argv-order asserted), row never persists port/URL (asserted), remote maintained, fetch into `refs/sandboxes/<name>/<branch>`.
- Finish/drop guards (`finish.js:116`, `sessions.js:768`) — dryRun refuses change-free; mirrors A4 seam.
- Retained cache vs reclaimed bytes separated (`sbx.js:466–471`).
- Task 16 runbook: present, concrete (6 sections, sentinel, disposable repo, evidence expectations).
- A5 interface-only lifecycle: matches brief scope (integration "only through an exported seam").

### Independent Verification Results
- `node plugins/sandbox/selftest.sbx.mjs` → **32 green**, exit 0
- `node plugins/sandbox/selftest.sbx-install.mjs` → **11 green**, exit 0
- `node plugins/sandbox/selftest.mjs` → **34 green**, exit 0 (A5 rows at lines 269–295)
- `node plugins/git-workspace/selftest.finish.mjs` → **18/18 passed**, exit 0 (sandbox rows 16–18 green)
- `npm test` → exit 0, **119/119 suites GREEN** ("arxa-studio CI: ALL GREEN"); both new suites auto-discovered
- Fail-closed pin check (real `SBX_PIN`, injected downloader that throws): `{installed:false, reason:"…unmeasured…refuses to download…"}`, **0 downloader calls, nothing installed** — genuinely fails, not skips
- `command -v sbx` → **PRESENT**: `/opt/homebrew/bin/sbx` → Caskroom 0.39.0. Not "expected absent" — but all real paths stay gated (operator install detected-never-modified; lifecycle only under Task 16 sentinel)

### Strengths
- Fail-closed pinning independently verified — arxa provably cannot download-and-run unverified bytes
- Single rm-construction site, structural (not scattered) invariant; failed-rm + unverifiable absence = bookkeeping refusal, row stays armed
- Hybrid runner: real git fetch/refspec/merge-base, only daemon transport simulated — the guard is tested against real git
- Secrets discipline: login output classified, never echoed; bare `['sbx','login']` asserted
- Honest null pins + ledgered inferred-shape assumption + concrete Task 16 reconciliation steps

### Issues
#### Critical (Must Fix)
None.

#### Important (Should Fix)
1. **Live probe in a "fake-state only" suite** — `selftest.sbx.mjs:549` runs real `sbx version/status/ls` on every `npm test` when sbx is installed. Implementer's own ledger: `sbx ls` auto-starts a stopped daemon — a real state mutation from a suite Step 7 constrains to injected-only. Comment calls it "read-only" (selftest.sbx.mjs:541) — contradicted by the measured side effect. Ruling item (ledgered, daemon-start is §23-assigned to arxa, ran harmlessly here) but should sit behind `ARXA_A5_REAL_SMOKE` like the lifecycle leg.

#### Minor (Nice to Have)
2. `sbx.js:456` checks reachability against `row.recoveryRef` read *before* the recovery fetch, which may land and record a different ref (`sbx.js:391`). Mismatch is safe-direction only (false refusal, never false pass); re-read the row post-fetch for exactness.
3. `reclaimedWorkspaceBytes` (`sbx.js:470`) is the du-delta of the whole cache store — coarse proxy under a precise label.
4. `sandboxGone` (`sbx.js:398–407`) shares the inferred `name`-field assumption; wrong shape → false "gone" after failed rm (row deleted while listed). Contained: failed-rm path only, lifecycle unwired in-product, Task 16 step 4 reconciles. ⚠️ reconciliation item.
5. `sbx.js:91` claims status "never starts the daemon itself" — true of arxa, not of the measured `sbx ls` side effect; comment ties to Issue 1.

### Assessment
**Task quality:** Approved
**Reasoning:** Safety invariant verified structural and independently exercised; all suites green (119/119). Issues are honesty/precision polish plus one gated-live-probe ruling item — none undermines trust in the teardown path.
