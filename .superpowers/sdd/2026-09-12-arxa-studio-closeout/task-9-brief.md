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

