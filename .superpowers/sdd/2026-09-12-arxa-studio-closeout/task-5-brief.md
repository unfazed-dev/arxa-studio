### Task 5: Add the two missing CI/CD stress scenarios

**Governing source:** `docs/plans/local-only-git-parity-and-sidebar-decorations.md` S4/S5.

**Files:**
- Modify: `scripts/cicd-stress.mjs`
- Modify if product defects surface: only the owning `plugins/git-workspace/lib/*.js` or viewer/watcher module, with a new failing focused test first
- Test: `scripts/cicd-stress.mjs` plus affected plugin selftests

**Interfaces:**
- Produces S4: two sessions integrate against moving `main`; exactly one lands first and the second must integrate or conflict loudly without losing its commit.
- Produces S5: rapid viewer saves across at least three files while WIP auto-commit and decoration refresh run; final files, WIP history, and decoration map converge.

- [ ] **Step 1: Add S4 as a failing scenario.** Launch two child processes against the same scratch repository/local bare remote and release both merge attempts from a parent-controlled barrier. Do not simulate concurrency in one process.
- [ ] **Step 2: Run and classify RED.** If current product behavior passes immediately, mutation-test only an injected temporary fixture with the integrate/conflict guard disabled and prove the scenario turns red; never alter the implementation worktree for the negative control.
- [ ] **Step 3: Add S5 as a failing scenario.** Drive the actual Monaco save/debounce coordinator, or extract that production coordinator for direct use, while WIP commits and decoration reads run concurrently. Count coalesced saves and WIP boundaries; assert no dropped final write, no dirty tree after quiet, no duplicate WIP boundary, and that every concurrent read sees a parseable complete Git index and decoration map.
- [ ] **Step 4: Fix only demonstrated product defects.** Every fix gets its own focused regression before changing production code.
- [ ] **Step 5: Verify repeatability.** Run `node scripts/cicd-stress.mjs` five consecutive times, then `npm test` once.
- [ ] **Step 6: Commit.** `test: cover main races and auto-commit storms`.

