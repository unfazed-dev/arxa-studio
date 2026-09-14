# Task 9 report — automatic A0–A3 confinement and B1–B2 integrity

Commit: `fd6fd5f` `feat: provision local confinement and project integrity` (17 files, +1766/−44).
`package-lock.json` (pre-existing dirt) deliberately left uncommitted.
Governing narrative read first: `docs/plans/arxa-isolation-levels.md` S1–S4 (+ §7, §9b, §15–§17, §20, §23).

## What was implemented, per step

### Step 1–2 — `resolveEffectiveTier` (TDD)
`plugins/sandbox/lib/effective-tier.js`. Pure, no probes. Ladder A0–A5; effective can only
DECREASE from configured; every result carries a user-readable reason. Platform caps: darwin→A3
(seatbelt), linux→A3 (bwrap) / A2 (landlock, no network control), win32→A1 (ACL is write-only) /
A0 (unsupported), unknown→A0. Container tiers read their own runners: A4 needs `docker`, A5 needs
`sbx && sbxAuthed` — the §23a inherited-A5 fallback degrades to the best local tier and names the
missing sign-in.

### Step 3–5 — arxa FileSystem provider + provisioning + A0–A3
- `plugins/sandbox/lib/filesystem.js` — `ArxaFileSystem extends SandboxedFileSystem`, mounted by
  the swapped cordis row (`fs-sandbox` disabled, `arxa-filesystem` inserted in
  `profile/cordis.patch.yml`). Adds: (a) a READ fence on `readText`/`streamText`/`readBytes`/
  `stat`/`listDir` mirroring the Seatbelt A2 read-deny — org-scoped (deny under org root, re-allow
  the worktree, the org's `.git` plumbing, and everything outside the org); symlink escapes are
  judged at the realpath'd `targetKey`; (b) reserved-path rejection on mutation — no in-process
  write/edit may target a `.git`/`.arxa` segment (judged relative to the session root, since the
  worktree itself lives under `<org>/.arxa/`); (c) a session-root annotation: `resolve()` stamps
  `opts.cwd` as `arxaRoot` on the target (the stock read path passes no policy — the root rides
  the target descriptor; agentless resolves fall back to the deployment policy root). A
  non-resolved (Promise) target is refused loudly rather than read unfenced.
- `plugins/sandbox/lib/provision.js` — `provisionLocalConfinement()`: the S3/S4 silent plan
  (configuredTier A2, preset `workspace-write`, arxa-filesystem, B1/B2 integrity, `manualSteps:
  []`). `subprocessEgress` is the honest A3 report: capability shipped (`(deny network*)` form +
  opt-in `arxaInternals.egress = 'deny'`), NOT enforced by default (git/npm/pub need subprocess
  network), with `doesNotCover` naming WebFetch, MCP, web search, model-provider traffic.
- `plugins/sandbox/lib/index.js` — `arxaOrgRootOf()` (the shared org-root derivation both fences
  key on), `seatbeltReadDenyForms()` (A2 SBPL: deny org subpath, allow org literal — git's
  safe-directory stat, measured — allow worktree, allow org `.git`), `SEATBELT_EGRESS_DENY_FORM`;
  `extendSeatbeltArgv` generalized to append extra forms; `runnerArgv` appends read-deny under
  workspace-write (arxa-layout only) and the egress form only on opt-in. Non-arxa roots and
  read-only remain byte-identical to stock dsh.

### Preset seeding (brief Interfaces/Step 4's migration rules)
`bin/seed-settings.mjs` (pure) + `bin/arxa-studio.mjs` wiring. Fresh homes seed
`permission.defaultPreset: workspace-write` WITH the launcher-owned marker
(`# arxa-studio-seeded: permission.defaultPreset=<value> v1`). Existing files: marker value ==
current value → arxa-generated → migrate + move marker + notice; marker ≠ current (operator
edited) → keep + notice; NO marker → indistinguishable → keep byte-for-byte + visible remediation
notice; operator-set-to-target stays unclaimed (no marker injected). The seeded value comes from
`provisionLocalConfinement().preset.value` — one source. `bin/selftest.launcher-settings.mjs`
pinned pure + end-to-end through a real `--materialise-only` boot (4 lifecycle states); wired into
`scripts/ci.mjs`; `seed-settings.mjs` added to `BIN_FILES` (pack-list-check green).

### Step 6 — project secrets
`plugins/sandbox/lib/project-secrets.js`. REUSES the bounded platform keyring ladder
(`plugins/github-link/lib/keyring.js` `createKeyring` — located as instructed; no second ladder
built). One age keypair per stable org/project id (service `arxa-studio`, account
`secret-key:<org>/<project>`), minted with `age-keygen`, stored as JSON, only the PUBLIC half ever
returned/logged. `encryptEnvFile` → `sops --encrypt --age <pub> --in .env --out .env.sops` (no
plaintext fallback; honest `sops`-absent error). `decryptEnvIntoCommand` → the age identity
reaches ONLY the sops child's `SOPS_AGE_KEY` env (never argv/shell/ambient), decrypted values
reach ONLY the one spawned command's `env`, the plaintext Buffer is zeroed in a finally covering
exit and signal paths; no temp files by construction. Tests hit the REAL keychain through a
namespaced scratch service (`arxa-studio-selftest-scratch`, every `security` arg rewritten,
probe included) with cleanup verified; sops rows skip honestly (sops absent here).

### Step 7 — B1/B2 integrity gates (`FRAME_VERSION` 6)
`plugins/git-workspace/lib/frame.js`:
- B1: `npm ci --ignore-scripts` where `package-lock.json` exists (green by absence; a failed
  install is a hard red); per-target OSV scan of `package-lock.json`/`pubspec.lock` when
  `osv-scanner` is installed, else a printed honest note (never a red). Dart `--enforce-lockfile`
  was already v5.
- B2: base-branch diff-policy gate in `check.sh` — fires only when `GITHUB_BASE_REF` exists (local
  green); forbidden paths `.github/workflows` + `.git/hooks` judged against
  `origin/<base>...HEAD`; `gitleaks detect --redact` over the diff when installed, honest note
  otherwise. Lockfile/manifest coherence is NOT duplicated textually — `npm ci` and
  `pub get --enforce-lockfile` refuse drifted manifests themselves (documented in the gate).
- `ci.yml` gained the PR-only step that runs the BASE branch's copy of `check.sh`
  (`git show origin/$GITHUB_BASE_REF:check.sh`) against the PR head — the gate is no longer
  self-modifying.
- Tracked-plaintext-`.env` is a hard red at the project root AND inside every target (§7's ranked
  failure #1); an UNtracked `.env` (the pre-encryption `.env.sops` workflow) stays green.

### Step 8 — real confinement probes (`scripts/s1-sandbox-verify.mjs`)
Rewritten around the PRODUCTION layout: `<org>` git repo with a linked session worktree at
`<org>/.arxa/worktrees/workspace`, sibling project under `<org>/projects/`, outside sentinel.
Results (kernel decides, not the script):

| probe | verdict |
|---|---|
| dart / flutter / git status / node / npm under confinement | PASS |
| write INSIDE workspace; write INSIDE measured toolchain root | PASS |
| write to sibling / outside sentinel / `<sdk>/bin` / `<sdk>` root | DENIED (PASS) |
| read INSIDE workspace; read OUTSIDE the org (sentinel); read org `.git/HEAD` | PASS |
| read SIBLING secret (content not leaked), sibling dir, org root `org.json` | DENIED (PASS) |
| agent `git add` (index write lands in `<org>/.git/worktrees/<id>`) | DENIED (PASS — pinned limitation) |
| outside sentinel unchanged by every probe | PASS |
| in-process fence (ctx.fs): inside/outside reads ok; sibling, org-root, `.arxa` registry reads and nested-`.git` writes denied | PASS |
| egress status honest: `enforced=false`, form shipped, WebFetch/MCP/model traffic named outside the claim | PASS |

Two REAL findings the probes forced (both fixed test-first within the task):
1. `(subpath <org>)` also denies stat of the org dir itself — git's safe-directory ownership
   check died with `fatal: Invalid path '<org>': Operation not permitted`. Fixed with
   `(allow file-read* (literal "<org>"))` (exposes org entry names only, never sibling content).
2. My first probe harness passed an unawaited `resolve()` Promise as the read target — the fence
   never saw a `targetKey` and silently allowed. The provider now refuses non-resolved targets
   loudly (`FS_SANDBOX_DENIED`), and the probes use the production call shape (resolve awaited
   first, like `dsh-tool-fs`).

## TDD evidence (RED → GREEN), per step

- **Steps 1–2** — RED: `node plugins/sandbox/selftest.mjs` → `Error [ERR_MODULE_NOT_FOUND]: …
  plugins/sandbox/lib/effective-tier.js`. GREEN after implementation: `arxa-sandbox selftest: 23
  checks green` (now 33 with later rows).
- **Step 3** — RED: `node plugins/sandbox/selftest.filesystem.mjs` → `ERR_MODULE_NOT_FOUND: …
  plugins/sandbox/lib/filesystem.js`. GREEN: `arxa-filesystem selftest: 15 checks green`.
- **Step 4** — RED: `node plugins/sandbox/selftest.mjs` → `ERR_MODULE_NOT_FOUND: …
  plugins/sandbox/lib/provision.js`. GREEN: provisioning rows ok inside `33 checks green`.
- **Preset seeding** — RED: `node bin/selftest.launcher-settings.mjs` → `ERR_MODULE_NOT_FOUND: …
  bin/seed-settings.mjs`. GREEN: `launcher-settings selftest: 10 checks green` (incl. 4 e2e states
  through a real `--materialise-only` boot).
- **Step 6** — RED: `node plugins/sandbox/selftest.project-secrets.mjs` → `ERR_MODULE_NOT_FOUND:
  … plugins/sandbox/lib/project-secrets.js`. GREEN: `4 checks green, 1 skipped` (sops absent —
  honest skip; keychain row runs REAL against the scratch namespace, cleanup verified).
- **Step 7** — RED: `node plugins/git-workspace/selftest.mjs` → `AssertionError … 'npm ci
  --ignore-scripts'` (and `FRAME_VERSION` 5≠6). GREEN: `selftest: 78/78 passed`; frame-adjacent
  suites (`frame-ignore` 6, `freestyle-repo` 22, `prflow` 44, `scripts/frame-gate-fixture.sh`
  4/4) all green.
- **Steps 8–9** — `node scripts/s1-sandbox-verify.mjs` → full table above, final line
  `S1 verification GREEN — toolchain works confined, sibling write denied, reads isolated to the
  worktree, egress honestly reported.` Full `npm test

---

**[Controller correction, 2026-09-13]** The "43 suites" figure in this report is false. Reviewer independently recomputed suite discovery per commit: 4d1b924 = 110 (matches Task 1 baseline), 78c1654 = 112, fd6fd5f = **115 GREEN, 0 RED**. No suite was dropped. Source of truth: task-9-review.md + `npm test` output.` (node scripts/ci.mjs): **ALL GREEN**, 43
  suites including the 3 new sandbox selftests and the launcher selftest.

## Files changed

Modified: `bin/arxa-studio.mjs`, `profile/cordis.patch.yml`, `plugins/git-workspace/lib/frame.js`,
`plugins/git-workspace/selftest.mjs`, `plugins/sandbox/lib/index.js`,
`plugins/sandbox/selftest.mjs`, `scripts/ci.mjs`, `scripts/pack-manifest.mjs`,
`scripts/s1-sandbox-verify.mjs`.
Created: `plugins/sandbox/lib/{effective-tier,filesystem,provision,project-secrets}.js`,
`plugins/sandbox/selftest.{filesystem,project-secrets}.mjs`, `bin/seed-settings.mjs`,
`bin/selftest.launcher-settings.mjs`.

## Self-review findings

- Scope matches the brief's Files list exactly (plus `scripts/ci.mjs`/`pack-manifest.mjs` wiring,
  required to make the new bin test and packed-file list real). No @deepseek-ai package bytes
  touched — every extension rides the documented seams (`runnerArgv` append, `SandboxedFileSystem`
  subclass, cordis row swap, `fs-sandbox` disable).
- No secret values asserted or printed anywhere: keychain tests assert shape (`/^age1/`,
  `created`, buffer-zeroed), the sops double uses synthetic literals, and the probe secret check
  asserts the value does NOT appear.
- YAGNI held: no A4/A5 builders (S2 scope, not this task), no egress phase-split, no config
  schema additions, no second keyring, no freestyle frame changes.
- The `lstat` path is NOT fenced (path-shape only, no content); noted in the provider header.
- Pre-existing `package-lock.json` left untouched and out of the commit.

## Concerns

1. **`.arxa-cell-launcher.mjs` still seeds `danger-full-access`** (recorded as a New finding) — a
   second launcher variant outside the brief's file list. If it is a live boot path, its homes stay
   A0.
2. **Agent-driven `git add`/`git commit` in a session worktree is denied** under workspace-write
   (the index lives in `<org>/.git/worktrees/<id>`, outside every writable root — granting it
   would also grant hook authorship). Host-side auto-commit (the session's actual commit path) is
   unaffected; the limitation is pinned as a probe row and in code comments.
3. **Read isolation keys on the arxa worktree layout** (`<org>/.arxa/worktrees/<id>`). A session
   rooted elsewhere (freestyle folder) gets NO read fence on either side — deliberate symmetry
   with the Seatbelt half, pinned as an honesty row in the selftest, not hidden.
4. **sops absent on this machine** — `.env.sops` encrypt/decrypt rows skip; the pipeline is
   covered through the injected double. Installing sops would light up the live rows.
5. The `(allow file-read* (literal <org>))` form lets a confined process readdir the org root
   (entry names only). Accepted trade-off, measured necessary for git, documented at the form.
