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

