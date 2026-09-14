# Task 5 report — the two missing CI/CD stress scenarios (S4, S5)

Commit: `82296f8` `test: cover main races and auto-commit storms` (BASE `bd14065`, branch `closeout-2026-09-12`). `package-lock.json` pre-existing dirt untouched and excluded.

## What was implemented

### S4 — race for main (`scripts/cicd-stress.mjs`)
Two sessions in one scratch repo (real git, local bare remote as `origin`) are landed from **real child processes released by a parent-controlled barrier** (children write ready-files; parent waits for both, then writes the release file — concurrency is never simulated in-process). Each child runs the real product land flow: `readySession` (integrate main first) then `sessionStageBoundary` (ff-only degrading to --no-ff). Two rounds:

- **clean** (different files): every child classified; ≥1 lands first; a race-parked loser lands cleanly on retry through the product verbs (revive → ready → boundary); both sessions' content on main; the second land degraded cleanly (--no-ff merge commit on main OR park-and-retry); main clean (no half merge, no markers).
- **conflict** (same line of `shared.md`): exactly one lands; main holds the winner's content only; the loser conflicts loudly (SessionMergeError parked / mid-merge integrate conflict); the loser's commit survives on its branch (zero lost); loser parked in registry or mid-merge; main clean.

`ARXA_STRESS_GW_LIB` lets a negative-control fixture be injected without touching the worktree.

### S5 — auto-commit storm (`scripts/cicd-stress.mjs`)
The **production save coordinator is sliced verbatim out of the viewer source** (`plugins/artifact-viewer/lib/client.js` — `save` and `onDirty` extracted by the same string-slice technique the shipped `selftest.client-save-race.mjs` uses) and driven with its own real 1500 ms debounce intact (program ruling 4 respected — nothing removed or disabled; no sleep fakes it, the coordinator's own timer fires the saves). Saves go through the **real write API** (`createWriteApi` + `issueToken` + req/res shim, real worktree resolution via the open-org trick, real atomic write + `wipCommit`). 60 dirty marks (2 bursts × 10 keystrokes × 3 files). A **real second process** polls `decorate()` + `rev-parse HEAD` throughout — required because a synchronous `wipCommit` blocks the parent's event loop, so only another process can observe mid-commit moments (self-terminating at 30 s so it can never orphan).

Assertions: coalescing (60 marks → exactly 2 saves/file, 6 total), every save succeeded, no dropped final write (disk == final document bytes), tree clean after quiet, WIP tier converged (no duplicate boundary tree; simultaneous saves may legitimately share one commit), decoration map converged (all three files `A` — new files), every concurrent read parseable (reads ≥ 60, zero failures, zero index read failures).

## RED evidence

### S4 — a REAL product defect surfaced (not just a red test)
First barrier run (before any fix): children `race-a → BOUNDARY merged:true`, `race-b → THREW SessionMergeError | … merge conflict with main` in the CLEAN round (files never overlapped), and the repo's main worktree left permanently dirty:

```
FAIL  S4/clean: a simultaneous second land degraded --ff-only to a --no-ff merge commit
FAIL  S4/clean: main is clean after the race (no half merge, no markers)
$ git status --porcelain → "D  a.md\n?? a.md"   (plus staged "A  b.md" earlier in the run)
```

Diagnosis (repro preserved in /tmp/s4-repro during the session): the loser's `merge --no-ff` had already **staged its result into main's index** before losing the ref race; its `merge --abort` then failed on the winner's locks. Residue `A b.md` / `D a.md` / `?? a.md` made every later land refuse ("Your local changes … would be overwritten") while the failure was mislabeled "merge conflict with main". Git-probed to confirm both halves: residue blocks `merge --no-ff`; `reset -q` alone still blocks (untracked twin).

### Focused regression (RED → GREEN), written FIRST
`plugins/git-workspace/selftest.land-race.mjs` — deterministic core of the race, plus a second half pinning the genuine-conflict guard unchanged. On BASE (fix absent):

```
AssertionError: the raced loser lands instead of parking: session "lose-b" could not merge
to main — merge conflict with main. The session branch is parked with all commits intact…
```

After the fix: `arxa-git-workspace land-race selftest: GREEN (12 checks)` (both halves).

### S5 — no product defect; initial reds were my assertion bugs
First run red on two of my assertions; corrected after verifying actual product behavior is right: (1) new files decorate as **`A`**, not `M`; (2) the write API's `wipCommit` may sweep a simultaneously-arriving second save's write into the same commit (`committed:false` while the tree is clean) — coalescing at the commit layer, no loss; asserted `1 ≤ wipCount ≤ 6` with no duplicate boundary instead. Also fixed two harness bugs of mine (missing `await` on the AsyncFunction builder — shipped selftest pattern requires it; non-async `.map`).

### Mutation-test negative controls (both scenarios passed against real product, so controls were required)
- **S4**: scratch copy of `git-workspace/lib/*.js` with the integrate/conflict guard (abort + park + throw) disabled; run with `ARXA_STRESS_GW_LIB` → **4 FAILs** (`exactly one session landed first` — both children "merged" through a conflict; loser not loud; loser not parked; main not clean). Worktree never touched.
- **S5**: scratch copy of `artifact-viewer/lib` with `fs.renameSync(tmp, abs)` dropped (git-workspace symlinked beside it for the relative import fallback); run with `ARXA_STRESS_AV_LIB` → **red** (`every fired save reached the write API and succeeded — 0/6`).

## Product fix

`plugins/git-workspace/lib/sessions.js` — `sessionStageBoundary`, merge moment only:

- A `--no-ff` failure **without** a conflict (`MERGE_HEAD` absent) is now recognized as a land race: heal the raced index (`reset -q` — index only, no worktree file touched; untracked twins removed only when byte-identical to the incoming branch's blob — unknown bytes are never deleted) and retry up to 6 attempts with 25 ms backoff (`Atomics.wait`; the function stays synchronous).
- Genuine conflicts behave exactly as before: break out, `merge --abort`, park `merge-conflict`, throw `SessionMergeError` — pinned by the second half of the focused test.
- Raced-out after 6 attempts still parks loudly, but the throw message is now honest: `main moved mid-merge (lost a land race) — the branch is intact, retry the land`.

## Files changed

- `scripts/cicd-stress.mjs` — S4 + S5 scenarios, header updated (five failure modes), +366 lines.
- `plugins/git-workspace/lib/sessions.js` — land-race retry + heal (above), +49/−9.
- `plugins/git-workspace/selftest.land-race.mjs` — NEW focused regression (12 checks), auto-discovered by `ci.mjs`.

## Verification

- Focused: `node plugins/git-workspace/selftest.land-race.mjs` GREEN.
- 5 consecutive `node scripts/cicd-stress.mjs`: all exit 0, 50 PASS / 0 FAIL each.
- `npm test` once: exit 0, `arxa-studio CI: ALL GREEN` (both `git-workspace/selftest.land-race.mjs` and `scripts/cicd-stress.mjs` GREEN inside it).

## Self-review findings

- The fix's `reset -q` unstages whatever is staged in the org main worktree before a retrying merge. Pre-fix such a land refused loudly; post-fix it lands, with the user's staged files unstaged but byte-intact on disk. In arxa's model the org root is arxa-managed (D18 WIP sweeps it), so landing is the better behavior; noted as a deliberate tradeoff, not silent.
- `parkedReason` for the rare raced-out park stays `merge-conflict` (display passthrough only — verified no consumer switches on it) while the thrown message distinguishes the race; kept to preserve state-machine vocabulary.
- S4 retry path uses the product verbs (revive → ready → boundary) rather than asserting a specific merge shape, because the second lander legitimately lands either via --no-ff on the spot or via integrate-then-ff after a parked race; the assertion accepts exactly those two shapes.
- S5's onDirty shim pins `savePhase` at build time (the phase check only drives UI cosmetics, never the write path); save(), the timer, the mtime contract and the write API are fully real.
- Test output: pristine except pre-existing house noise (`[arxa-boot] …` lines, same class S3 already prints).

## Concerns

- S4's race outcome distribution is nondeterministic by design; the assertions are outcome-class-based and held across 5 consecutive runs plus the runs inside `npm test`, but a pathological lock pattern could still park both children in the clean round — covered by the retry assertions, not impossible to flake in slow CI.
- The two `New finding:` entries appended to `progress.md` (unlocked registry read-modify-write on parks; write-api `committed:false` while a neighbor commit carried the write) are recorded, not fixed — outside this task's demonstrated-defect scope.

## Ledger

`progress.md` appended: Task 5 completion line + two `New finding:` entries (severity low, follow-up paths named).
