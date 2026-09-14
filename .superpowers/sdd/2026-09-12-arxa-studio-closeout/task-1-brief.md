### Task 1: Establish the truthful baseline and retire stale work

**Governing sources:** `docs/plans/open-work-inventory-2026-09-07.md`, `docs/plans/project-sessions-physical.md`, `docs/plans/mobile-flutter-migration-spec.md`, `docs/plans/claude-subscription-engine-implementation.md`, `docs/plans/artifact-viewer-implementation.md`, `docs/plans/arxa-studio-vocabulary-collisions.md`.

**Files:**
- Create: `docs/plans/open-work-inventory-2026-09-12.md`
- Modify: the six governing sources above, status/front-matter and supersession notes only
- Test: repository status plus the commands below

**Interfaces:**
- Consumes: current source, tests, and git history in both repositories.
- Produces: one inventory with IDs `AXS-001` onward and states `OPEN`, `DEFERRED`, `EXTERNAL`, or `CLOSED`; every open row maps to exactly one Task 2–16 work package in the SDD ledger.

- [ ] **Step 1: Record immutable starting facts.** Capture `git rev-parse HEAD`, `git status --short --branch`, `node --version`, package pins, `git -C ../arxa rev-parse HEAD`, and sibling worktree status in the SDD ledger. Do not clean either checkout.
- [ ] **Step 2: Run the studio baseline.** Run `npm test`; require exit 0 and the final `arxa-studio CI: ALL GREEN` line.
- [ ] **Step 3: Prove later closures.** Use source plus focused tests to record project-repo routing, version minting, project stamp removal, leaf/session/lister Git decorations, GitHub authorization mounting, Claude SDK packaging, sbx research/login evidence, Freestyle, dashboard, and palette as closed. Keep top-level project/stage decoration rollups open under Task 4.
- [ ] **Step 4: Audit mobile in its own worktree.** From the isolated arxa worktree run `flutter analyze` and `flutter test` under `mobile_flutter`; map every old unchecked migration item to current code/test evidence. Record only genuine residuals such as Android release signing or physical-device gates.
- [ ] **Step 5: Write the new inventory.** Each row must contain ID, owner repo, source plan, current evidence, remaining deliverable, dependency, closure command, and owning Task 2–16 number. Historical plans get a dated banner pointing to this inventory; do not rewrite their narrative history. If any genuine open row has no task, revise and review this master plan before implementation begins; do not leave an orphan row.
- [ ] **Step 6: Verify the inventory.** Search it for bare `TBD`, `TODO`, "maybe", and unowned open rows. Require zero matches except quoted historical text. Have the task reviewer cross-check every row against source.
- [ ] **Step 7: Commit.** Commit only documentation with `docs: reconcile the arxa studio closeout inventory`.
