⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set and takes precedence over your claude.ai login · Unset it to load your organization's connectors
[claude-code:unrecognized_model] {"model":"glm-5.3[1m]","query_source":"sdk"}
### Spec Compliance

❌ **Issues found** — core architecture sound; two defects + one false report claim need fixing before trust.

Per step (all file:line against the worktree):
- **S1–S2 ✅** Detection truthful (absent CLI vs dead daemon vs available, `devcontainer.js:107-127`); generation only via owned frame fns (`frame.js:736-790`, stamped, JSON-stamp for devcontainer.json, never-clobber, FRAME_VERSION 6→7).
- **S3 ⚠️** Six interfaces exact ✅; private named volume ✅ (`:310`); main/master refused pre-docker ✅ (`:279`); pointer-`.git` refused ✅ (`:286-290`); mounts = ro bundle + volume + secret bind only ✅ (`:317-336`); refusal on unreachable commits ✅ (`finish.js:96-104`, `sessions.js:758`). **But `startContainer` is not idempotent** (re-start errors on non-empty volume / `--name` conflict) and `stopContainer` mishandles docker failures (below).
- **S4 ⚠️** 0600-in-0700 mkdtemp ✅, identity only in sops child env ✅, `--mount …target=/run/secrets/arxa-env,readonly` ✅, cleanup on normal/teardown/failed-start ✅ — **no signal-path cleanup** (zero `SIGINT/SIGTERM` handlers; grep-verified). Four negatives present (inspect-shape, argv, captured output, sibling).
- **S5 ⚠️** Port blocks collision-checked (registry overlap + live bind) & persisted by stable id ✅; one-active-stack ✅; no `link` ✅ (asserted); sqlite floor + truthful reason ✅. Defects below (default docker assumed; stale registry crash).
- **S6 ⚠️ Cannot verify live** (daemon down — environmental, confirmed myself). Injected-runner coverage genuinely pins the docker argv surface. **But the claimed real leg does not exist** (below).
- **S7–S8 ✅** Card configured/effective + unfetched via existing detail-line language, no second taxonomy; commit message exact (`62ee8d5`).

### Independent Verification Results

| Command | Exit | Key line |
|---|---|---|
| `node plugins/sandbox/selftest.devcontainer.mjs` | 0 | 35 green, 1 skipped; skip honest (`daemon=false`, live rows printed) |
| `node plugins/sandbox/selftest.project-database.mjs` | 0 | 12 green |
| `node plugins/sandbox/selftest.mjs` | 0 | 34 green (A5→A4, daemon-truth rows included) |
| `node plugins/file-org-shell/selftest.mjs` | 0 | 234 passed |
| `npm test` | 0 | `arxa-studio CI: ALL GREEN`, 117 GREEN suites |
| `docker info` | 1 | `Cannot connect to the Docker daemon at unix:///Users/unfazed-mac/.docker/run/docker.sock` |

Degradation claim is **environmental, confirmed**. `git diff --check` clean (nothing above the trailer in the package).

### Strengths
- One hardening source of truth: `devcontainerRunArgs()` feeds both devcontainer.json and `docker run` — spec/runner can't drift; dual-pinned by tests.
- Host-git recovery loop (bundle→fetch→recovery ref→`merge-base`) runs **for real** in tests, not doubled; refusal mutates nothing.
- Secret discipline is real: buffer zeroing, identity never in argv, canary-absence asserted over argv/inspect-shape/config/sibling.
- Degrade-never-breaks: bridge fails soft, daemon truth (`dockerReason`) reaches card reason text; A5→A4 fallback is a correct S3#4 improvement.

### Issues

#### Critical (Must Fix)
1. `devcontainer.js:424-427` — `stopContainer` ignores `docker rm`/`volume rm` exit codes, then **unconditionally deletes the registry row and returns `{stopped:true}`**. With the daemon down (this machine's normal state): row deleted, container+volume leak, and `unrecoveredContainerCommits` now returns 0 → `finishSession`/`dropSession` will delete the branch while container-only commits sit in an orphaned volume. Combined with the stale `row.head` fallback (`:413-418`, misses commits made after the last fetch), this disarms the exact guard the task exists to enforce. Fix: treat non-zero rm as refusal (or verify container absence), keep the row on failure.

#### Important (Should Fix)
2. Report overclaim — "real-container leg exists behind `ARXA_A4_REAL_SMOKE=1`": `selftest.devcontainer.mjs:515-516` use `real` **only in a log string**; every runner is `hybridRunner` unconditionally. Setting the flag with a live daemon prints "REAL containers" while still running doubles. Task 16 has no leg to enable; fix the code or the claim.
3. `project-database.js:189-198` — `startProjectDatabase` reads the registry **before** `allocatePortBlock` persists it; first start of a new project id throws `TypeError` on `reg.projects[projectId].active` (stale copy), and the stale whole-file write clobbers rows allocated in between. Hidden because the selftest pre-allocates.
4. `project-database.js:161` — `deps.docker ?? {available: true}` violates detect-never-assume on the exported default (supabase *is* detected by default; docker isn't); the no-deps path then throws via the default runner instead of degrading to the sqlite floor. Use `detectDocker()`.
5. `startContainer` not idempotent (brief S3 demands it): an existing session re-start errors (clone into non-empty volume / name conflict) instead of returning the live handle from the registry row.
6. No signal-path cleanup for the plaintext temp dir (constraint says "every exit path"): SIGINT between `prepareSecretMount` and registry write leaves plaintext in tmpdir. Registry-recorded `secretDir` + later `stopContainer` covers most paths; add a boot sweep of stale `arxa-secret-*`.

#### Minor (Nice to Have)
7. `devcontainer.js:373` — dead expression `handle.repoPath ?? resolveRepoGuarded(handle.registryPath ? handle.repoPath : '.')` silently falls back to **cwd**.
8. Mount-negative assertion hole: `src.startsWith('/')` passes any absolute source (`selftest.devcontainer.mjs:286-296`) — the secret bind passes via the catch-all, not by being named.
9. Branch guard misses ref-spelled mains (`refs/heads/main` passes BRANCH_RE; `clone -b` would fail anyway).
10. For the Task 16 watch list (beyond the report's own chown/pull notes): bind-mount target `/run/secrets/arxa-env` on a **read-only rootfs** — docker must create the mountpoint on the RO root; may fail in a real run.

### Assessment

**Task quality:** Needs fixes
**Reasoning:** Architecture and invariants are genuinely well-built and all 117 suites pass, but `stopContainer`'s ignored-failure path disarms the teardown data-loss guard (Critical), and the report's "real-container leg exists" claim is false in code — both must be fixed before this can be trusted or handed to Task 16.
