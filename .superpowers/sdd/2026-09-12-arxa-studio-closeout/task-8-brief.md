### Task 8: Finish localization and visual acceptance for touched desktop surfaces

**Governing sources:** `docs/plans/dsh-plugin-ui-conformance.md`, `docs/plans/palette-personalisation.md`, and unfinished visual notes in the local Git plan.

**Files:**
- Modify: locale dictionaries/generators owned by `plugins/locale`, `plugins/personalisation`, `plugins/theme-accent`, `plugins/arxa-git-card`, `plugins/arxa-sidebar`, `plugins/sandbox`, and `plugins/workspace-provider`
- Test: corresponding plugin selftests and generated drift checks
- Evidence: `designs/evidence/studio-closeout/{390,744,1280}/`

**Interfaces:**
- Produces: complete EN/PL/FR key parity for the Personalisation tab and every desktop surface changed by Tasks 2–14.
- Consumes: existing `arxa-locale` service and browser-language persistence.

- [ ] **Step 1: Add a failing key-set parity test.** English is the source set; Polish and French must contain the same keys for the full Personalisation tab and touched surfaces.
- [ ] **Step 2: Translate missing strings.** Preserve product terms from `CONTEXT.md`; do not translate IDs, paths, branch names, model IDs, or commands.
- [ ] **Step 3: Run a native-speaker review subagent separately for Polish and French.** Each reviewer writes a report; implement only corrections that preserve the source meaning and UI length constraints.
- [ ] **Step 4: Capture desktop evidence.** Include Finish, Sweep, Checks red disclosure, project preparation, trash confirmation/recovery, viewer install strip, configured/effective confinement, Workspace backend/sign-in states, and Personalisation at 390/744/1280 in light and dark where the component differs.
- [ ] **Step 5: Run locale/plugin tests and `npm test`.**
- [ ] **Step 6: Commit.** `feat: complete studio locale and visual acceptance`.

