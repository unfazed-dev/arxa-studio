### Task 2: Stop live sessions before organisation trash and preserve display names

**Governing source:** `docs/plans/org-trash-unreachable.md` Bug B.

**Files:**
- Modify: `plugins/arxa-sidebar/lib/session-sweep.js`
- Modify: `plugins/arxa-sidebar/lib/index.js`
- Modify: `plugins/file-org-shell/lib/dsh-bridge.js`
- Modify: `plugins/file-org-shell/lib/lifecycle.js`
- Test: `plugins/file-org-shell/selftest.mjs`
- Test: `plugins/arxa-sidebar/selftest.actions.mjs`
- Test: `plugins/arxa-sidebar/selftest.session-sweep.mjs`
- Create: `plugins/arxa-sidebar/selftest.trash-live-sessions.mjs`
- Smoke: `scripts/org-purge-smoke.mjs`

**Interfaces:**
- Produces: a retained handle/controller map beside `ctx.agents.create` in `arxa-sidebar/lib/index.js`; `makeDshFaces` exposes only `stopAgentIds(ids, { timeoutMs })` through `dsh-bridge.js`.
- Produces: `quiesceSessionsUnder({ sessions, sessionPersistence, agentControl }, orgPath, { timeoutMs }) -> Promise<{ stopped: string[], alreadyStopped: string[] }>` in `session-sweep.js`.
- Consumes: persisted session rows to identify dsh agent IDs beneath the org, the narrow agent-control face, canonical cwd values, and `lifecycle.trashOrg`.
- Changes: `trashOrg(orgPath, { displayName? } = {})`; its trash index stores manifest display name and retains the original folder slug separately for restore.

- [ ] **Step 1: Write failing host tests.** Cover two live sessions inside the org, one outside, one already stopped, a stop timeout, and a cwd that only shares a textual prefix. Assert the inside sessions stop, the outside session is untouched, and any timeout prevents `softDelete`.
- [ ] **Step 2: Verify RED.** Run the new focused selftest and require failure because no quiesce seam exists.
- [ ] **Step 3: Implement bounded quiescence.** Stop discarding the `AgentHandle` created beside `ctx.agents.create` in `arxa-sidebar/lib/index.js`; retain it or recover it through `ctx.agents.get`, then expose the narrow stop operation through `makeDshFaces`/`dsh-bridge.js`. Resolve cwd and org with canonical path semantics, await termination with a 5-second total bound, and never delete session history during trash.
- [ ] **Step 4: Wire `org.trash`.** Quiesce before calling `l.trashOrg`. On failure return the standard `{ok:false,error}` action response and leave the org directory, recents, GitHub state, and trash index unchanged. Sessions stopped before a later timeout remain resumable from persistence; report their IDs rather than claiming an impossible live-state rollback.
- [ ] **Step 5: Preserve identity.** Read `org.json.name` before the move, store `name` plus `slug`, render the display name, and restore to the original slug/path.
- [ ] **Step 6: Add the husk regression.** Trash an org with a live fake session, let the fake attempt its post-stop write, then assert the original path remains absent and restore succeeds.
- [ ] **Step 7: Verify.** Run the four focused suites, `node scripts/org-purge-smoke.mjs`, and `npm test`.
- [ ] **Step 8: Commit.** `fix: stop organisation sessions before trash`.
