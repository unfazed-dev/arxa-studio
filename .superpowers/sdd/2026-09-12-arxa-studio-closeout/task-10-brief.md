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

