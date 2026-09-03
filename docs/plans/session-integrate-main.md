# Session integrate-main — closing the gap tier 3 found

Status: **LANDED 2026-09-03.** Grilled, built, tested and smoke-run against the
live RESTO / kitchen-project repos. Commits `b5f1b29` (feature), `ddffa17`
(advisor-review fixes), `0702cae` (the bug the smoke run found). Card smoke
62/62 green across all 15 actions — results in the last section.

## The gap

Tier 3 part 3 (`/tmp/arxa-s2/tier3-remote-c.mjs`) demonstrated it: session B was
2 commits behind main AND conflicting. arxa had no way out. Everything between
that driver's `--- MANUAL ---` markers is raw `git rebase` a user would today
have to run in a terminal, by hand, inside a worktree arxa created for them.

A grep of `plugins/*/lib` for `rebase` finds exactly one hit —
`allow_rebase_merge: false` in the GitHub repo settings (`frame.js:334`). There
is no `card.rebase`, no `session.integrate`, nothing.

## Research (2026-09-03)

The design question was "how do mature systems continuously integrate trunk into
feature branches without breaking developers." Findings:

- **GitHub "Update branch" / "Automatically update head branches"** operates on
  the branch *on GitHub*, never the local checkout. GitHub's changelog is
  explicit: rebasing rewrites the branch, so "if you are working with the branch
  locally, you will need to fetch it and do a hard reset."
- **GitHub merge queue** builds a temporary branch (base + queued PRs), tests
  that, merges if green. No developer checkout is touched.
- **GitLab merge trains** run "merged results pipelines" against a synthetic
  commit combining the target branch and every MR ahead in the train. Same
  property.
- **DORA** (2016/2017 data): merge to trunk at least once a day, three or fewer
  active branches. Long-lived branches produce bigger, buggier merges — so
  *knowing* fast is the goal.
- **Auto-rebase in the background is a documented trap.** Golden rule: don't
  rebase shared branches; background automation is precisely where you cannot
  guarantee nobody is on it. `--autostash` handles a dirty tree but the pop can
  itself conflict (two conflict layers). `rerere` autoupdate is a known mismerge
  vector.

**The load-bearing conclusion:** every shipped implementation computes the
integration somewhere disposable and never writes to a working tree on its own.
arxa already has the primitive for this and used it in tier 3 —
`git merge-tree --write-tree` (`tier3-remote-b.mjs:52`) detected B's conflict
against main without touching a single file.

Sources:
- https://github.blog/changelog/2022-02-02-more-ways-to-keep-your-pull-request-branch-up-to-date/
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue
- https://docs.gitlab.com/ci/pipelines/merge_trains/
- https://dora.dev/capabilities/trunk-based-development/
- https://www.atlassian.com/git/tutorials/merging-vs-rebasing
- https://jvns.ca/blog/2023/11/06/rebasing-what-can-go-wrong-/

## Decisions (grilled, 2026-09-03)

| # | Decision | Chosen |
|---|---|---|
| 1 | Conflict handling | Leave the merge open; session reads `conflicted`; Commit blocked; separate "Finish integrating" action. The agent resolves markers in the worktree — arxa's own model. |
| 2 | Where `conflicted` lives | **Derived**, every read, from `git rev-parse -q --verify MERGE_HEAD`. Zero stored fields, no migration, cannot desync. |
| 3 | Verb | **Merge**, not rebase. `card.commit` already collapses to one commit above `merge-base('main', branch)` (`prflow.js:114-126`), so both verbs end in an identical commit; merge stops on conflict once, rebase can stop per WIP commit. |
| 4 | Auto-write | **No.** Detection is automatic and free (merge-tree, nothing touched). Writing happens only on a button press or inside `card.commit`. Matches GitHub/GitLab. |
| 5 | Fetch site | Inside the existing 30s `card.status` poll, via `reconcileLocalMain`. |
| 6 | Ledger | One new `integrated` stage in `STAGES`, appended, `result` ∈ `clean \| conflicted \| resolved`. |

### Decisions 7-12 — attribution and stage comments (grilled 2026-09-03, folded in)

| # | Decision | Chosen |
|---|---|---|
| 7 | Stage comments carry time | Comments render the RECORDED time, UTC + the acting machine's local clock + zone, exactly as the table does. |
| 8 | Commit trailers | `Arxa-Author: <github login>` (renamed from `Arxa-Actor:`) and `Arxa-Collaborator: <model>@(<effort>)`, which **replaces** `Co-authored-by:`. |
| 9 | Effort absent | Renders `@(unspecified)`. Never a named level nobody supplied. |
| 10 | `author` is a GitHub username | Never a display name. `Evan F Pierre Louis` → `unfazed-dev`. |
| 11 | Ledger columns | `actor` → `author`; new `collaborator` column beside it. |
| 12 | One comment builder | The manual `card.pr.comment` action and the automatic path share a single builder. |

**Why the `Arxa-` prefix on both:** everything here happens inside arxa, so the
namespace is uniform — `Arxa-Session`, `Arxa-Container`, `Arxa-Author`,
`Arxa-Collaborator`. `ledger.js:61-66` records that `Arxa-Stage:` was already
renamed once for exactly this reason, and confirms nothing in the tree parses
these keys, so a rename breaks no reader.

**Known cost, accepted:** `Co-authored-by:` is the only trailer GitHub itself
parses — dropping it removes the model from the commit's contributor list.
Raised before the decision; the decision stands.

**Where the login comes from:** `github.status().login`, persisted at
`github-link/lib/index.js:117`. NOT `org.json.repoOwner` — that is the repo's
owner, which is not the acting user on an org-owned repo.

**Local-only fallback (CLAUDE.md constraint):** an org with no GitHub link has
no login. Falls back to git `user.name`, which is what authors the commit
anyway. The ledger and comments keep full capability with no remote; only the
name's provenance changes.

**CI rows:** the `checks` stage's author becomes `github-actions[bot]` — the
actual GitHub login — rather than the prose "github actions".

**Backward compatibility:** ledger rows already written carry `actor`, not
`author`. The renderer must read `row.author ?? row.actor` so every existing
PR's table still renders. Rows already published are not rewritten.

**Bug fixed on the way past:** `recordStage` defaults `result` to `'ok'`
(`ledger.js:122`) but the comment builder reads the RAW entry, before the
default — so the table says `ok` while the comment says nothing. That is why
`merged` shows a sha and no result while `checks` shows `green`. The comment is
to be built from the recorded row, not the raw argument.

### Consequences taken without a separate question

- Integrate merges **`origin/main`** and fast-forwards **local `main`** to match.
  The collapse computes `merge-base('main', branch)` against *local* main
  (`prflow.js:126`); leaving it stale would make the collapse reason from an old
  base. `reconcileLocalMain` (`prflow.js:276`) already does exactly fetch + ff +
  divergence report.
- **Dirty worktree** → `wipCommit` first (`commits.js:64`). Already exists,
  commits everything under the WIP identity, no-ops when clean, and `watch.js`
  does the same on a timer. Nothing can be lost; the collapse erases it later.
- If `card.commit` auto-integrates and *that* conflicts, it stops there, leaves
  the merge open, and the session goes conflicted. Next Commit is blocked until
  resolved — same rule as decision 1, reached from a different door.
- "Finish integrating" **refuses while any tracked file still contains conflict
  markers**. Git will commit a staged `<<<<<<<` happily; a grep catches it
  before the gate has to.

## Bug found while grilling (pre-existing, unrelated to this feature)

`card.status` computes `aheadBehind` from `origin/main`
(`arxa-git-card/lib/index.js:294-296`) — a ref that only moves on a fetch. The
only fetch in the codebase is `repos.js:349`, reached through
`reconcileLocalMain`, which runs after an in-app merge and nowhere else. So
"{n} behind" is honest only right after *you* merged something in arxa; a merge
made on github.com or from another machine leaves the card claiming 0 behind
indefinitely. Decision 5 fixes this on the way past.

## Build

### New — `plugins/git-workspace/lib/integrate.js`

```
mergePreview(repoPath, branch, { env })
  → { behind: number, conflicts: boolean|null, files: string[] }
  `git merge-tree --write-tree --name-only main <branch>`, run with
  GIT_OBJECT_DIRECTORY pointed at a throwaway dir and
  GIT_ALTERNATE_OBJECT_DIRECTORIES at the real one.
  exit 1 = conflict, exit 0 = clean. stdout line 1 is the tree OID,
  the lines after it are the conflicted paths.
  MEASURED 2026-09-03, git 2.51: plain --write-tree leaves 2 loose
  objects per call in the repo — unacceptable at a 30s poll across
  every open session. With the ODB redirected: 0 objects added to the
  repo, byte-identical output.

integrateMain(session, { actor, env })
  → { integrated, conflicted, files, onto, wip, reason? }
  1. reconcileLocalMain  (fetch + ff local main)
  2. not behind → { integrated: false, reason: 'current' }
  3. wipCommit if dirty
  4. git merge main
  5. clean    → recordStage integrated/clean
     conflict → leave open, recordStage integrated/conflicted + file list

finishIntegrate(session, { actor, env })
  → { finished, sha, reason? }
  1. no MERGE_HEAD → { finished: false, reason: 'not-integrating' }
  2. tracked files still carrying conflict markers → refuse, name them
  3. git commit --no-edit
  4. recordStage integrated/resolved
```

**Portability guard:** `--write-tree` requires git ≥ 2.38. arxa is distributed
software, so the version is checked. The fallback for older git is the LEGACY
trivial-merge form `git merge-tree <base> <ours> <theirs>` — present in every
git version, writes zero objects (measured), and prints `changed in both` plus
conflict hunks, which yields the same file list.

A detached temp worktree is NOT an acceptable fallback here: it writes to disk
and takes seconds, which a 30s poll cannot afford. If neither form is usable,
the conflict badge is simply omitted and `behind` is still reported from
`rev-list`, which needs no particular git version at all.

**Local-only:** every call above is local git. `reconcileLocalMain` already
returns `reason: 'no-origin'` rather than throwing, and the ledger is repo-local
by construction (`ledger.js:9`), so an org with no remote keeps the full record.
Satisfies the distributed-software constraint in CLAUDE.md.

### Changed

- `git-workspace/lib/ledger.js` — add `integrated` to `STAGES` between `opened`
  and `committed`.
- `git-workspace/lib/prflow.js` `readySession` — insertion point is
  **immediately after subject validation (line 112), before the `dirty` / `tip`
  / `mergeBase` reads at 125-126**. It must precede those: integrating changes
  what `merge-base` is, and every downstream check (`nothing-to-propose` at 129,
  `alreadyCollapsed` at 137) has to see the post-integrate world. An integrate
  necessarily makes `alreadyCollapsed` false, so the branch re-collapses and the
  reviewed sha moves — correct, since the branch genuinely has new content. On
  conflict, return `reason: 'integrate-conflict'` immediately, before any
  collapse touches the branch.
- `git-workspace/lib/index.js` — export the three new functions.
- `arxa-git-card/lib/index.js` — `card.status` gains `reconcileLocalMain`,
  `conflicted` (from MERGE_HEAD) and the `mergePreview` result; two new actions
  `card.integrate` and `card.integrate.finish`.
- `arxa-git-card/lib/client.js` — button beside the existing "{n} behind"
  (`client.js:342`); conflicted state swaps Commit for "Finish integrating";
  locale strings for en/pl/fr, matching the existing pattern. Third card state,
  decided here rather than grilled: when merge-tree reports a conflict and no
  integrate has been attempted yet, the detail line reads "{n} behind ·
  conflicts" with the button still reading "Integrate main". A clean preview
  shows "{n} behind" exactly as today, plus the button.

**SSOT gotcha, hit during the build:** `arxa-git-card/lib/client.js` is
GENERATED from `lib/git-card.snippet.txt` by `scripts/gen-git-card.mjs`, and a
drift gate in `selftest.mjs` asserts the two are byte-identical. Editing
`client.js` directly passes a parse check and is then silently reverted by the
next `--write`. Edit the snippet, then run `node scripts/gen-git-card.mjs
--write`. The snippet is indented 4 columns less than the generated file, since
the generator re-indents it.

### Tests — `plugins/git-workspace/selftest.integrate.mjs`

Staged against real repos, negative controls included:
1. clean integrate on a behind branch → merged, main is ancestor, ledger row
2. conflicting integrate → MERGE_HEAD present, files listed, ledger row
3. `mergePreview` on the same pair → conflicts reported, **worktree byte-identical afterwards**
4. finish with markers still present → refused
5. finish after resolution → committed, MERGE_HEAD gone, ledger `resolved` row
6. `card.commit` on a conflicting behind branch → `integrate-conflict`, no push
7. integrate with no origin → `reason: 'no-origin'`, no throw

## Separate item — the git card was never smoke tested

The card registers **15 actions**. Tier 1–3 exercised **4**: `card.commit`,
`card.pr.create`, `card.pr.status`, `card.pr.merge`.

Never run once:
`card.status`, `card.commit.draft`, `card.push`, `card.pr.comment`,
`card.ci.rerun`, `card.ci.cancel`, `card.runner.wake`, `version.mint`,
`insight.streak`, `insight.ci`, `insight.sessions`.

Insight backends exist and are exported (`commitDays` at `commits.js:181`,
`workflowRuns` at `github-link/lib/index.js:363`), so the card's `unavailable`
fallback would not fire — but that is the wiring being present, not the data
being right. Nothing pulled a single insight end to end.

`card.pr.comment` never ran. The original ask included "comments from different
stages"; what was verified was the stage table in the PR *body*, written by a
different code path. The ledger stood in for comments.

Driver gotchas for the smoke run: insights need a **parked** session
(`index.js:661` does `parkedSessions(...).find(...)`), and every tier-3 session
is archived — so it needs a fresh session.

This run is mechanical, not a design question. It is deliberately separate from
the integrate build above.

## Card smoke run — 2026-09-03, results

All 15 card actions exercised against the live RESTO / kitchen-project repos.
**62/62 checks green** across three drivers, after two fixes.

Verified working, first time exercised: `card.status` (including the new
integrate block), `card.commit.draft`, `card.push`, `card.pr.comment`,
`card.ci.rerun`, `card.ci.cancel`, `card.runner.wake`, `version.mint`,
`insight.streak` (15 commits on 1 day), `insight.ci` (2 real runs),
`insight.sessions` (9 rows), `card.integrate`, `card.integrate.finish`.

The four attribution fixes confirmed on GitHub (kitchen-project#5): author is
`unfazed-dev`, `Collaborator: Claude Opus 5@(high)` present, the recorded time
travels in the body as `… UTC · … Australia/Melbourne`, CI rows read
`github-actions[bot]`, and the manual comment now matches the automatic one
field for field.

### BUG FOUND AND FIXED — `finishIntegrate` was unreachable

`finishIntegrate` blocked while `git diff --diff-filter=U` listed any path.
But in arxa a conflict is resolved by the agent EDITING the file in the
worktree; nothing runs `git add`. So the paths stayed `AA`/unmerged with the
correct resolution sitting in them, and Finish refused forever. Observed live:
"markers ARE resolved" while `--diff-filter=U` still listed both files.

Fix: block on conflict MARKERS only — the content check, which is the real
question — then `git add -A` and commit, because staging is the product's job
and not the user's. A conflict with no markers to find (binary, delete/modify)
is resolved by that `add -A`; if git still refuses, its own message is
reported.

**Why the selftest missed it:** the original test staged the resolution with
`git add` before calling finish, so it exercised a path no user takes. The test
now restores the unmerged state with `checkout --merge`, edits WITHOUT staging,
and asserts git still calls the path unmerged before finishing — 33 assertions.

### Driver bugs, not product bugs

- `prCommentApi` returns `{id, url}` only, no `body` — part A asserted against
  a field that never existed. Re-checked by reading the comment back from
  GitHub; the comment was correct all along.
- `version.mint` states are capitalised (`Draft`, `In review`, `Approved`,
  `Superseded`, `changes-requested`). Passing `draft` is refused with the list,
  which is the right error.
