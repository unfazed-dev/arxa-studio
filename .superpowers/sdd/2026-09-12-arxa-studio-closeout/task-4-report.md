# Task 4 report — local Checks row + complete tree decorations

Status: DONE. Commit `7d9e866` `feat: surface local checks and complete tree decorations` (10 files, +492/−5). BASE db6de5f, branch closeout-2026-09-12. `package-lock.json` (pre-existing dirt) left untouched and out of the commit.

## What was implemented

### Step 3 — host action/cache (`plugins/arxa-git-card/lib/index.js`)

- **`card.gate.run { sessionId }` → `{ green, kind, configured, output }`** — the local Checks row's verb. Resolves the session like every seat-aware action, runs `gw.runGate(s.worktree)` (the SAME gate Commit's boundary uses — consumed, not duplicated), refuses loud without a session seat and on unknown sessions. It pushes, merges, parks and starts nothing (pinned by a selftest that slices the handler body and asserts the absence of pushSessionBranch/prMerge/parkSession/workflow/rerun/cancel).
- **Module-scope `gateCache`** (worktree → result). `card.status` serves `gate: null | { state: 'green'|'red', kind, configured, output, ranAt, fingerprint }` from the cache, measured only when a cached run exists (a seat that never asked pays no git calls), and only while `gateFingerprint(gw, repoPath) === hit.fingerprint`. The fingerprint is `rev-parse HEAD` + `status --porcelain` — HEAD plus staged/unstaged/untracked — so any committed, staged, unstaged or untracked mutation voids the historical result to `gate: null` ("not run") without rerunning the script.
- **`capGateOutput`** — UI payload capped to the LAST 64 KiB behind the explicit prefix `[output truncated — showing the last 64 KiB]` (the tail is where a failing gate says why).

### Step 4 — the Checks row (`plugins/arxa-git-card/lib/git-card.snippet.txt` → regenerated `lib/client.js`)

- Row 4 in the dock, rendered for `sessionSeat && !(status.linked && !status.localOnly)` — the exact negation of the linked-Approve row's condition, so the two share a slot and never co-render. Different objects by construction: this one is a synchronous local script result, no run id/history/cancellation.
- Shows kind (`check.sh` verbatim / translated "light checks") · state (green/red), `checks not run yet` when `gate` is null, `running checks…` while busy. Actions: `Run checks` (posts `card.gate.run`, then `load()` repaints from the cache) and, on red with output, a disclosure toggle revealing the output in a `<pre>` (aria-labelled, `--dsw-alias-label-secondary` token). Busy de-dup rides the existing `run(key, fn)` machinery — a second click while the script is live is a disabled button, not a second process.
- `checksOpen` resets on session change so a disclosure never leaks across seats. Eight `git.checks.*` keys added to en/pl/fr (pl/fr machine-drafted, marked TODO native review per repo convention).
- Icons reuse already-pinned shipped glyphs (`IconPlayOutline16`, `IconChevronDownOutline14`) — the G5 no-silent-fallback gate stays green.

### Step 5 — top-level decorations (`workspace-region.snippet.txt` + `scripts/gen-workspace.mjs`)

- **Projects row + project row** (`OrgContainerRow`): `decoTop` = `"projects"` for the Projects dock row, `"projects/" + d.slug` for project rows; the title gains the `aXa_decoText aXa_deco_<letter>` classes and `ARXA_DECO_BADGE(decoTop, "dir")` rides after the name — the same folded mark the leaf rows carry. `ARXA_USE_DECO()` added to the component so the mark paints on the map event, not the next poll.
- **Stage rows** (stock `ProjectRowItem` leaf workspace rows — stage containers, tracks, and every other leaf folder): two new gen-workspace deltas (6i) splice `ARXA_USE_DECO();` into the component and add `clsx(..., ARXA_WS_DECO_CLASS(row.workspaceId))` to the title + `ARXA_DECO_BADGE(wsParts(row.workspaceId).ws, "dir")` after it. The region helper `ARXA_WS_DECO_CLASS` reads `ARXA_DECO_FOR(ws, "dir")`.
- Zero new git work: `foldDirs` already rolls every ancestor, and the pins assert `ORG_POST("session.decorations"` remains the single fetch. No git subprocesses were added anywhere.

## TDD evidence

**RED 1 (actions, Step 1→2)** — `node plugins/arxa-git-card/selftest.actions.mjs` before implementation: `11 FAILURE(S)`, e.g.
```
FAIL  card.gate.run: refuses without a session seat  {"ok":false,"error":"unknown-action","action":"card.gate.run"}
FAIL  card.status: no gate run yet answers gate:null, not a claim
```
(the four `stale:` checks passed vacuously — `gate` was undefined; they are gated by the failing recache check and turned meaningful on GREEN).

**RED 2 (card client, Step 4→6)** — `node plugins/arxa-git-card/selftest.mjs`: `4 FAILURE(S)` — slot condition, busy/post wiring, disclosure, three-locale count (host-half checks already green from Step 3).

**RED 3 (sidebar, Step 5→6)** — `node plugins/arxa-sidebar/selftest.mjs`: `4 FAILURE(S)` — the four new `deco closeout:` pins (the fifth, single-fetch, was already held).

**GREEN** — after implementation + regeneration:
```
arxa-git-card selftest.actions: ALL GREEN
arxa-git-card selftest: ALL GREEN
arxa-sidebar selftest: ALL GREEN
node scripts/card-local-smoke.mjs → ALL GREEN
npm test (scripts/ci.mjs) → exit 0, "arxa-studio CI: ALL GREEN"
```

## Step 7 specifics

`gen-git-card.mjs --write`/`--check` and `gen-workspace.mjs --write`/`--check` both run: in sync (57142 / 467841 bytes). Smoke gained section **6b**: writes a red `check.sh` into the SCRATCH session worktree, asserts `card.gate.run` captures `smoke: red on purpose` and `card.status` serves the cached red gate with that output, asserts porcelain + HEAD are byte-identical before/after (the run changed nothing — no commit, park, or merge), then removes the script; the shared-table flows (endOfLife/sweep) still pass after, proving the worktree was returned clean.

## Files changed

| File | Δ |
|---|---|
| `plugins/arxa-git-card/lib/index.js` | `card.gate.run` action, `gateCache`/fingerprint/cap helpers, `gate` on `card.status` |
| `plugins/arxa-git-card/lib/git-card.snippet.txt` | Checks row, `runChecks`, `checksOpen`, 24 locale strings |
| `plugins/arxa-git-card/lib/client.js` | regenerated |
| `plugins/arxa-git-card/selftest.actions.mjs` | section G + G2 (16 checks) |
| `plugins/arxa-git-card/selftest.mjs` | 7 `checks:` pins |
| `plugins/arxa-sidebar/lib/workspace-region.snippet.txt` | `ARXA_WS_DECO_CLASS`, OrgContainerRow deco+subscription |
| `plugins/arxa-sidebar/lib/client.js` | regenerated |
| `plugins/arxa-sidebar/selftest.mjs` | 5 `deco closeout:` pins |
| `scripts/gen-workspace.mjs` | delta 6i (ProjectRowItem hook + title/badge) |
| `scripts/card-local-smoke.mjs` | section 6b (red gate leg) |

## Self-review findings

- Initial light-gate fixture was wrong (org scaffolding ships a `check.sh`, so "absent check.sh" needed a `git rm` + commit in the sandbox); fixed in the test, not the code.
- One test-side iteration: the OrgContainerRow subscription regex window (900) was tighter than the real hook distance (1155 — the row's comment block sits between); widened to 1400. Test bug, no product change.
- Considered decorating all dock rows; kept to exactly the three sites the brief names (Projects, project, stage) — stage rows decorate uniformly via the stock leaf row because Projects/project are the only container rows, so the rule is "all stock leaf rows" with no extra condition (YAGNI-clean).
- `gateCache` is unbounded in age/size, matching the `reviewCache` precedent one screen above it; worktree keys are finite.

## Concerns

None blocking. One observation for a future controller decision (also ledgered): the disclosure chevron does not rotate when open (static icon, matches the row grammar; rotating would need a second class pair — skipped).

## Ledger

- Appended "Task 4: complete" entry plus one **New finding (minor, low)**: `card.runner.wake` reads the org manifest directly and ignores the seat — on a project-session seat it would wake the ORG repo's runner (D98/D99 class). Follow-up: resolve via `sessionFor` + `seatManifest` like the neighbouring handlers. Not touched here.
