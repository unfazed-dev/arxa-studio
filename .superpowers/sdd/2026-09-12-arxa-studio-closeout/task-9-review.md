⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set and takes precedence over your claude.ai login · Unset it to load your organization's connectors
[claude-code:unrecognized_model] {"model":"glm-5.3[1m]","query_source":"sdk"}
### Spec Compliance
❌ Issues found (report-level, not code-level) — code is spec compliant.

- **Step 1–2** ✅ `resolveEffectiveTier({configured, platform, runners}) → {configured, effective, reason}` at `plugins/sandbox/lib/effective-tier.js:50`. Decrease-only enforced by `Math.min(configuredIdx, ceiling)` (`:81`); reason is always a non-empty string. Tests cover darwin/Seatbelt, linux bwrap vs Landlock (A2 cap, network reason), win32 ACL A1/A0, missing runners, A5 inherited fallback (no-sbx / unauthed / ready), A4-no-docker, no-toolchain, never-widen, unknown-tier→A0.
- **Step 3** ✅ `ArxaFileSystem` (`plugins/sandbox/lib/filesystem.js:66`) mounted via the real Cordis row: `fs-sandbox` disabled + `arxa-filesystem` inserted (`profile/cordis.patch.yml:2044-2048`). Read fence on readText/streamText/readBytes/stat/listDir judged at realpath'd `targetKey`; symlink escape tested (`selftest.filesystem.mjs` `escape-link`); reserved `.git`/`.arxa` mutation rejection with below-root judging (worktree lives under `<org>/.arxa/`).
- **Step 4** ✅ Idempotence (deepEqual double-call), `manualSteps: []`, preset from one source; migration guard genuinely distinguishes: marker==value→migrate, marker≠value→operator wins, no marker→kept byte-for-byte + notice, operator-set-to-target not retroactively claimed. Pure + e2e through real `--materialise-only` (4 states).
- **Step 5** ✅ A0–A3 as specified; A3 = subprocess egress only, `enforced: false`, `doesNotCover` names WebFetch/MCP/web search/model-provider. No overclaim in any status string.
- **Step 6** ✅ Reuses the keyring ladder (verified `execFile`-based, no shell strings, `plugins/github-link/lib/keyring.js:22,146,172`); identity reaches only the sops child's `SOPS_AGE_KEY` env; plaintext zeroed in `finally`; no temp files by construction; no `-e`/`--env-file`/`--build-arg`/argv secret anywhere in the hunks. Skip is honest (verified below).
- **Step 7** ✅ `npm ci --ignore-scripts` only where `package-lock.json` exists (`frame.js:424-426`); `--enforce-lockfile` retained (v5, still asserted); OSV honest note on absence; base-branch diff gate PR-only; gates nested in stack-marker cases. Functional red/green test included.
- **Step 8** ✅ Probes are real (kernel-decided, ran them — see below).
- **Step 9** ✅ Commit message exactly `feat: provision local confinement and project integrity`; `git diff --check` clean.
- **Interface deviation (minor):** brief writes `provisionLocalConfinement({ env, platform })`; implementation takes `{ platform, runners }` (`provision.js:36`) — output shape exact, semantics preserved (runners ARE the env facts).

### Independent Verification Results

| Command | Exit | Key line |
|---|---|---|
| `node plugins/sandbox/selftest.mjs` | 0 | `arxa-sandbox selftest: 33 checks green` |
| `node plugins/sandbox/selftest.filesystem.mjs` | 0 | `arxa-filesystem selftest: 15 checks green` |
| `node plugins/sandbox/selftest.project-secrets.mjs` | 0 | `4 checks green, 1 skipped` — skip names the missing tool; `command -v sops` → exit 1 (genuinely absent), age-keygen present |
| `node bin/selftest.launcher-settings.mjs` | 0 | `10 checks green` incl. 4 e2e states |
| `node scripts/mirror-drift-check.mjs` | 0 | `PASS mirror drift gate: … no NEW drift` |
| `node plugins/git-workspace/selftest.mjs` | 0 | `selftest: 78/78 passed` |
| `node scripts/s1-sandbox-verify.mjs` | 0 | All 18 rows + 3 aggregate rows PASS; sibling secret `DENIED` (content not leaked), outside sentinel unchanged, org `.git/HEAD` readable, `git add` denied exit 128, egress `enforced=false` honest |
| `npm test` | 0 | `arxa-studio CI — 115 suites` / **115 GREEN, 0 RED** / `arxa-studio CI: ALL GREEN` |

**43-vs-110 reconciliation (TOP PRIORITY):** The report's "43 suites" is **wrong**. Actual: `ci.mjs` prints **115**. Independently recomputed discovery per commit (plugin `selftest*.mjs` + sidebar smoke + hand-wired pushes): `4d1b924` (Task 1 baseline HEAD) = **110** — matches Task 1 exactly; `78c1654` = 112; `fd6fd5f` = **115**. Tasks 2–8 added 2 selftest topic files; task 9 added 3 (`selftest.filesystem`, `selftest.project-secrets`, `bin/selftest.launcher-settings`). **No suite was dropped — the Critical scenario is ruled out.** The 43 is an unexplained false number in the report.

### Strengths
- Probes are kernel-decided with leak-content checks, not just exit codes: denial verdicts compare bait file content before/after, sibling-secret row asserts the secret string is absent from stdout, sentinel-unchanged row (`scripts/s1-sandbox-verify.mjs:2233-2240`).
- Two real bugs found by the probes and fixed test-first: the org-root literal allow for git's ownership check (`index.js:1048`), and the loud refusal of unawaited `resolve()` Promises (`filesystem.js:874-879`).
- Migration guard is the strongest version of the rule — operator-set-to-target is never retroactively claimed; every branch prints a notice.
- Secrets tests hit the REAL keychain through a namespaced scratch service with verified cleanup; assertions are shape-only, no values printed.
- Honest-reporting discipline throughout: freestyle no-fence pinned as behaviour, A3 ceiling named, OSV/gitleaks absence is a note never a red.

### Issues
#### Critical (Must Fix)
None. (Silently dropped suites ruled out; no secret channel; no overclaimed confinement.)

#### Important (Should Fix)
1. **Report states "ALL GREEN (43 suites)" — actual count is 115** (`task-9-report.md:129-130`). The run was green, but the number is materially false and a reviewer trusting it would conclude 72 suites vanished. Correct the report (or record the true source of 43).
2. **`bin/.arxa-cell-launcher.mjs:210` still seeds `defaultPreset: danger-full-access`** — verified present. Out of the brief's file list, not in `BIN_FILES` (doesn't ship packed), correctly ledgered by the implementer — but any home booted through it stays A0. Belongs in the whole-branch review.

#### Minor (Nice to Have)
1. Report claims the unfenced `lstat` path is "noted in the provider header" — no `lstat` mention exists in `filesystem.js`. The limitation is disclosed in the report, but the citation is false.
2. `parseEnvBuffer` stringifies the plaintext (`String(bytes)`, `project-secrets.js`); only the Buffer is zeroed — the string copy is unzeroable in V8. Unavoidable for env injection; worth a header sentence.
3. sops skip message says "sops/age-keygen not installed" though the guard is OR and age-keygen is present — slightly over-broad message.
4. `provision.js` `subprocessWritableRoots` is a prose string asserted by regex, not data — the real no-widening proof lives (correctly) in the argv/selftest rows; the string is decorative.
5. Flagged concern (2), agent `git add`/`commit` denied under workspace-write: judged **correct confinement, not a regression** — the index lives in `<org>/.git/worktrees/<id>`; allowing it would grant `.git`-adjacent writes and hook authorship, breaking the §11 reserved-path invariant. Host-side auto-commit is the session's commit path and is unaffected. Flagged concern (3), freestyle read-unfenced: symmetric across both fences and pinned — accepted.

### Assessment
**Task quality:** Approved
**Reasoning:** The code matches every brief step with real, independently reproduced confinement probes and clean secret discipline; the only substantive defects are in the report itself (false 43-suite count) and a correctly-ledgered out-of-scope residual (cell launcher), neither of which undermines the implementation.
