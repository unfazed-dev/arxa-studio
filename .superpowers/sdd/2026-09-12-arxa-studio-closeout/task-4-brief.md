### Task 4: Add the local Checks row and complete tree-level decorations

**Governing source:** `docs/plans/local-only-git-parity-and-sidebar-decorations.md` Decisions 3, 6, and 7.

**Files:**
- Modify: `plugins/arxa-git-card/lib/index.js`
- Modify: `plugins/arxa-git-card/lib/git-card.snippet.txt`
- Modify: `scripts/gen-git-card.mjs`
- Regenerate: `plugins/arxa-git-card/lib/client.js`
- Modify: `plugins/arxa-sidebar/lib/workspace-region.snippet.txt`
- Regenerate: `plugins/arxa-sidebar/lib/client.js`
- Test: `plugins/arxa-git-card/selftest.actions.mjs`, `plugins/arxa-git-card/selftest.mjs`, `plugins/arxa-sidebar/selftest.mjs`
- Smoke: `scripts/card-local-smoke.mjs`

**Interfaces:**
- Produces action: `card.gate.run { sessionId } -> { green, kind, configured, output }` using `git-workspace.runGate(session.worktree)`.
- Produces status field: `gate: null | { state: 'green'|'red', kind, configured, output, ranAt, fingerprint }`; the fingerprint covers HEAD plus staged, unstaged, and untracked state, so any worktree mutation makes the historical result stale without rerunning the gate.
- Consumes: existing decoration map and `ARXA_DECO_FOR(relPath, kind, rootId)`.

- [ ] **Step 1: Write failing action tests.** Cover green, red with captured output, absent `check.sh` light gate, unknown session, and stale status after committed, staged, unstaged, and untracked changes.
- [ ] **Step 2: Verify RED.** Run the action selftest and require the missing action/status field.
- [ ] **Step 3: Implement the host action/cache.** Bound execution with the same gate behavior Commit already uses; cache the result without rerunning the script during `card.status`, mark it stale when the cheap Git/content fingerprint changes, and cap the UI payload to the last 64 KiB with an explicit truncation prefix.
- [ ] **Step 4: Build the Checks row.** Render it for local-only sessions in the slot occupied by the remote Actions row for linked sessions. Show state/kind, `Run checks`, busy state, green summary, and red output in a disclosure. It must not start GitHub Actions and must not merge or park the session.
- [ ] **Step 5: Wire top-level decorations.** Apply the existing folded directory mark to `Projects`, project, and stage rows. Do not add Git subprocesses; the current two-call measurement remains the only source.
- [ ] **Step 6: Add UI/source tests.** Pin the new action, busy de-duplication, red output, all three locales, and decoration calls at all three top-level row sites.
- [ ] **Step 7: Regenerate and smoke.** Run `node scripts/gen-git-card.mjs --write`, `node scripts/gen-git-card.mjs --check`, `node scripts/gen-workspace.mjs --write`, and `node scripts/gen-workspace.mjs --check`, then focused suites and `node scripts/card-local-smoke.mjs`. Add a scratch red `check.sh` leg that proves the output appears and the worktree is unchanged.
- [ ] **Step 8: Run `npm test` and commit.** `feat: surface local checks and complete tree decorations`.

