### Task 6: Add the condensed Git-card delivery ledger

**Governing source:** `docs/plans/github-conversations-in-the-insight-panel.md` carried ledger strip.

**Files:**
- Modify: `plugins/git-workspace/lib/ledger.js`
- Modify: `plugins/arxa-git-card/lib/index.js`
- Modify: `plugins/arxa-git-card/lib/git-card.snippet.txt`
- Regenerate: `plugins/arxa-git-card/lib/client.js`
- Test: `plugins/git-workspace/selftest.ledger.mjs`, `plugins/arxa-git-card/selftest.actions.mjs`, `plugins/arxa-git-card/selftest.mjs`
- Smoke: `scripts/card-local-smoke.mjs`, `scripts/card-cicd-smoke.mjs`

**Interfaces:**
- Produces action: `card.ledger.summary { sessionId } -> { lastStage, result, nextOwner, target, url } | null`.
- Consumes: the existing git-workspace ledger and linked PR URL; never refetches or duplicates the full ledger table.

- [ ] **Step 1: Write failing ledger/summary tests.** Cover persisting `next` in new rows, reading old rows without it, no ledger, local session without URL, linked session with PR URL, red gate next owner, target, and merged result.
- [ ] **Step 2: Verify RED.** Require the action to be missing.
- [ ] **Step 3: Persist `next` and implement a pure projection.** Extend new stage ledger rows without breaking old rows, then read the resolved seat repository/session and return only the latest stage, result, next owner, and target.
- [ ] **Step 4: Render the strip.** Place it under the card frame summary; link only when a trusted GitHub URL exists. A local-only session opens a bounded local ledger view. Use existing status tokens, escaped content, and three-locale strings.
- [ ] **Step 5: Regenerate, run focused tests and both smokes, then `npm test`.**
- [ ] **Step 6: Commit.** `feat: show the latest delivery ledger on the git card`.

