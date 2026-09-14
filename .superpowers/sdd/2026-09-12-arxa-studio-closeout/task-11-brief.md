### Task 11: Implement A5 Docker Sandbox isolation and safe teardown

**Governing source:** `docs/plans/arxa-isolation-levels.md` §§21–24/S3/S4.

**Files:**
- Create: `plugins/sandbox/lib/sbx.js`, `plugins/sandbox/lib/sbx-install.js`, `plugins/sandbox/selftest.sbx.mjs`, `plugins/sandbox/selftest.sbx-install.mjs`
- Modify: `plugins/sandbox/lib/effective-tier.js`, plugin entry/status UI
- Modify: Git/session finish and sweep integration only through an exported sandbox lifecycle seam

**Interfaces:**
- Produces: `sbxStatus`, `sbxLoginFlow`, `ensurePolicy`, `createSandbox`, `startSandbox`, `resolveGitEndpoint`, `fetchSandboxCommits`, `removeSandbox`.
- Safety invariant: never pass `sbx rm --force` until all sandbox commits are reachable from a host ref and verified; retain `refs/sandboxes/<name>/<branch>` as recovery evidence.

- [ ] **Step 1: Write failing parser/state tests.** Cover unauthenticated 401, OAuth device flow, daemon stopped, absent global policy, changing ephemeral ports, auto-stopped sandbox, missing host remote, unfetched work, and retained image-cache accounting.
- [ ] **Step 2: Package/provision `sbx`.** Support a bundled or official checksum-pinned artifact for each shipped platform and an idempotent updater; do not assume Homebrew. Start/diagnose the daemon automatically. Unit tests use an injected downloader/filesystem and never alter the operator install.
- [ ] **Step 3: Implement detection and one-time sign-in surface.** This is the only confinement tier allowed to require a Docker account. Cancellation/failure falls back cleanly and never blocks a session.
- [ ] **Step 4: Implement policy planning without touching global state.** Parse current policy, build the exact deny-all/per-sandbox change, and surface it for the authenticated external gate. Unit/integration fixtures use an isolated fake state root. A real `sbx policy init` is global and belongs to Task 16 after explicit authorization.
- [ ] **Step 5: Implement clone/start/Git retrieval.** Resolve the port every start, wake before fetch, add/maintain the remote, fetch into a host recovery ref, and verify object reachability.
- [ ] **Step 6: Integrate Finish/Sweep.** Refuse teardown with unfetched commits; once reachable, remove non-interactively and report retained cache separately from reclaimed workspace bytes.
- [ ] **Step 7: Run injected/fake-state tests only.** Prepare the exact disposable real-sbx command and expected evidence for Task 16; do not sign in, change global policy, or mutate the operator's Docker Sandbox state here.
- [ ] **Step 8: Run `npm test`; commit.** `feat: add Docker Sandbox isolation with recoverable teardown`.

