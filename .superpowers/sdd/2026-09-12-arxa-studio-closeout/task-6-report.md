# Task 6 report — condensed Git-card delivery ledger

**Status: DONE_WITH_CONCERNS** (commit complete and green; one required smoke — `card-cicd-smoke` — is blocked by an account-level GitHub Actions billing condition, root-caused below, code not implicated)

- Base: `7d9e866` · Commit under review: `bd14065` `feat: show the latest delivery ledger on the git card` (predecessor's; exact brief Step 6 message)
- Successor (me) committed **nothing** — the brief's instruction: "If the commit is complete and green, do NOT commit anything."
- Working tree: only the pre-existing `package-lock.json` dirt, untouched, not in any commit.
- Task 4's `card.gate.run` + cached `gate` status untouched (diff shows no changes near them).

## 1. What the predecessor's commit implements (verified step-by-step)

### Step 1 — failing tests (all brief-listed cases present)
- `plugins/git-workspace/selftest.ledger.mjs`: persisting `next`/`target`/`url` in new rows; old rows read as null; no ledger / empty / `null` ledger → `null`; merged result with URL surviving the row that recorded it; untrusted URL rejection (http, non-github.com, embedded space, non-string).
- `plugins/arxa-git-card/selftest.actions.mjs` (new section H): no seat refusal; session with no ledger → `null`; **red gate next owner** (local session, `gate`/`red`, named next owner, `url === null`); linked session with PR URL + `target: 'PR #9'` recorded at `review`; merged row (latest stage/result/next from merged row, URL from the review row).

### Step 2 — RED (reconstructed, see §3)

### Step 3 — persist `next` + pure projection
- `ledger.js recordStage` persists `next`, `target`, `url` with the row (strings, null-safe); rows written before these fields existed simply lack them.
- New `ledgerSummary(ledger)` — pure, takes recorded rows only: returns `{ lastStage, result, nextOwner, target, url }` from the latest row; scans backwards for the most recent `url` matching `TRUSTED_URL_RE = /^https:\/\/github\.com\/\S+$/` (the PR outlives the row that recorded it); `null` for empty/missing ledger. Never refetches, never duplicates the full table.
- `noteStage` in the card host merges `next`/`target`/`url` into the entry one key at a time (an undefined caller option can't clobber an entry-supplied value); `openPr` records `target: 'PR #n'` + `url: pr.html_url` with the review stage; the checks stage records them too. Resolved-seat read: the action resolves the session via `sessionFor` and reads `readLedger(sessionRepoPath(s, sid), sid)` — same resolution every other ledger reader uses, so project sessions read the project repo.

### Step 4 — the strip
- `git-card.snippet.txt`: rendered as row 5, **under the card frame summary**; visible only for `sessionSeat && ledger`. `ledgerUrl` belt-behind-host gate: only `startsWith('https://github.com/')` opens out (`window.open` with `noopener`); everything else gets the **bounded local ledger view** (30vh max, `overflow: auto`, pre-wrap, disclosure that resets on session switch). Content rendered as React text children (escaped); existing status tokens (`S.row`, `S.preview`, `S.actions`, `action()`, existing icons). Loads via `post('card.ledger.summary', { sessionId })` — a registry read, no GitHub traffic; refreshes on expand/30s poll/refresh button; failure hides the strip (no toast spam).
- Eight new `git.ledger.*` keys in **all three** dictionaries (en/pl/fr), asserted ×3 by the static selftest.

### Step 5 — regenerate + run (evidence in §4)

### Step 6 — commit with the exact brief message ✓ (also exported `ledgerSummary` from `git-workspace/lib/index.js`; `client.js` regenerated — byte-identical count to snippet insertions; drift check in sync)

## 2. What I had to fix

Nothing. The commit is complete against the brief. No new commits.

## 3. How RED was evidenced (honest account)

The predecessor died before reporting RED. Reconstructed with the sanctioned pattern — committed work kept, so the missing-action RED was shown on BASE in a temp worktree (`git worktree add --detach /tmp/arxa-t6-red 7d9e866`, then checked out only the three test files from `bd14065`, node_modules symlinked, removed afterwards):

- `selftest.ledger.mjs` on BASE: `SyntaxError: … does not provide an export named 'ledgerSummary'` — the new suite cannot even load.
- `selftest.actions.mjs` on BASE: **4 FAILURE(S)** — all `{"ok":false,"error":"unknown-action","action":"card.ledger.summary"}` (+ the section's later checks unproven).
- `selftest.mjs` on BASE: **4 FAILURE(S)** — host action absent, client wiring absent, trusted-URL gate absent, `git.ledger.*` strings absent (0 of 3 dictionaries).

So the tests demonstrably fail without the implementation — the RED the brief's Step 2 requires. This is reconstruction on BASE, not the predecessor's own pre-implementation run; stated as such.

## 4. Test evidence (commands + key output)

| Command | Result |
|---|---|
| `node plugins/git-workspace/selftest.ledger.mjs` | `ledger selftest: 12 checks passed` (incl. `ok 11/12 - summary: …`) |
| `node plugins/arxa-git-card/selftest.actions.mjs` | `arxa-git-card selftest.actions: ALL GREEN` (all 5 new ledger checks PASS) |
| `node plugins/arxa-git-card/selftest.mjs` | `arxa-git-card selftest: ALL GREEN` (4 new ledger checks PASS) |
| `node scripts/gen-git-card.mjs --check` | `git-card client: in sync (63038 bytes)` |
| `node scripts/card-local-smoke.mjs` | `ALL GREEN — sandbox: /var/folders/.../arxa-card-local-*`; section 6c: `PASS card.ledger.summary: a local-only session surfaces its latest stage, clean, with no URL` + `PASS …a session with no record answers null` |
| `npm test` | exit 0, `arxa-studio CI: ALL GREEN` |
| `node scripts/card-cicd-smoke.mjs --yes` | **6 FAILURE(S)** — environmental, see §6 |

## 5. Files changed (all in `bd14065`)

`plugins/git-workspace/lib/ledger.js` (+47), `plugins/git-workspace/lib/index.js` (export), `plugins/arxa-git-card/lib/index.js` (+34), `plugins/arxa-git-card/lib/git-card.snippet.txt` (+98), `plugins/arxa-git-card/lib/client.js` (regenerated, +98), `plugins/git-workspace/selftest.ledger.mjs` (+45), `plugins/arxa-git-card/selftest.actions.mjs` (+64), `plugins/arxa-git-card/selftest.mjs` (+19), `scripts/card-local-smoke.mjs` (+18), `scripts/card-cicd-smoke.mjs` (+7).

## 6. `card-cicd-smoke` — root cause of the 6 failures (not the commit)

Systematic debugging, root cause found before any fix was considered:

- Three consecutive live runs, identical signature: the smoke's trivial workflow (jobs `quick` = `echo`, `hold` = sleep) concludes `failure` with **no runner assigned, zero steps, no logs**, within ~3-5s.
- Run `34722398415` on kept repo `unfazed-dev/arxa-cicd-card-1789251453524`: jobs API → `{"conclusion":"failure","steps":[]}`, `runner_name: ""`, `--log-failed` → `log not found`.
- **Decisive isolation:** made that same repo **public** and re-ran the same failed run → `quick: success`, `hold: in_progress` within 45s. Identical workflow, same account; only visibility changed. Private-repo Actions minutes are billed; public are free — the account's private Actions minutes are exhausted (or its spending limit is hit). (Billing API confirmation needs the `user` scope — not requested; behavioral proof stands.)
- The other 5 failures are pure cascade: checks never green → `card.pr.merge` correctly refuses (`checks-red`) → not merged → work not on main → Mint unreachable → the new strip check correctly reports the un-merged truth: `{"lastStage":"integrated","result":"clean",…,"url":"https://github.com/…/pull/1"}` — i.e. the failing ledger check's own output demonstrates the feature working faithfully.
- Diagnostic repo deleted afterwards (`gh repo delete --yes`); no other state left on GitHub.

**Operator action needed:** restore Actions minutes / raise the spending limit on the GitHub account, then re-run `node scripts/card-cicd-smoke.mjs --yes`. Recorded as a New finding in the program ledger.

## 7. Self-review

- Contract exactly as specified: `card.ledger.summary { sessionId } -> { lastStage, result, nextOwner, target, url } | null`; consumes the existing ledger + recorded PR URL; no refetch, no table duplication.
- Link safety is double-gated (host `TRUSTED_URL_RE` + client `startsWith('https://github.com/')`); React escapes text children — no injection surface from registry content.
- `recordStage` change is backward-compatible (old rows untouched; missing fields read as null — same rule as `rowAuthor` for pre-rename `actor`).
- Smokes used scratch ARXA_HOME/temp sandboxes (self-sandboxed); no real org or credential state mutated; nothing sensitive printed.
- Task 4's `card.gate.run` and cached gate status untouched.

## 8. Concerns

1. `card-cicd-smoke` cannot pass until the account's GitHub Actions private-repo minutes are restored (§6). Every code-level verification the brief names is green; the live smoke's strip assertion is additionally covered green by `selftest.actions.mjs` (merged + URL + nextOwner) — but the brief's Step 5 asked for both smokes green, and one is not, through no fault of the code.
2. Minor (deferred): the strip's 30s poll effect re-arms its interval whenever `ledger`/`busy` change; harmless (guarded), just slightly chatty deps.
