# Session path identity + CI/CD smoke tiers

Grilled 2026-09-03 (Q1–Q15 below). Supersedes the Q2/Q3 readable-id decisions of
the same morning (`note-wt-260903-001` + `arxa/session/<id>`) and D98's per-repo
counters. Advisor consult: **skipped** (`consult.sh` returned `over_budget`,
session fuse 22/20) — decisions rest on primary sources only.

## 0. The disconnect this fixes

Three things were all called "arxa" and never lined up:

| thing | today | is a |
|---|---|---|
| worktree directory | `.arxa/worktrees/<id>` | folder, hidden, gitignored |
| branch | `arxa/session/<id>` | git ref (not a folder) |
| registry | `.git/arxa/` | internal store, never user-visible |

Plus the opaque `s-mtkul0al-7uwie9` ids seen in the sidebar: those came from the
smoke driver calling `openSession(repo, { name })` directly — the library's
fallback mint (`sessions.js:339`) — not from the product path, which already
minted `note-wt-260903-001`.

## 1. Decisions (naming)

- **Q1 — identity vs label.** One immutable id is the identity; `name` is a label.
  Rename = label only. No cascade (GitHub *closes* an open PR whose head branch is
  renamed — docs.github.com "Renaming a branch").
- **Q2 — identity = relative disk path.** `<org-folder>/<workspace key>/<leaf>`,
  mirroring disk exactly (no dropped `projects/`, numeric prefixes kept):
  - `RESTO/notes/note-wt-260903-001`
  - `RESTO/communications/emails/email-wt-260903-001`
  - `RESTO/projects/kitchen-project/06-build/backoffice-wt-260903-001`
  Workspace keys are exactly today's legal ones (`template.fixedWorkspaces` and
  `projects/<slug>/<container>`); no new hosting rules.
- **Q3 — derived strings.**
  - worktree dir: `<ORG>/.arxa/worktrees/<path>` (nested dirs)
  - branch: `arxa/<path>`
  - dsh conversation key: `arxa-` + path with `/` → `-`
    (dsh stores a conversation as a directory named by its id, so `/` is illegal)
- **Q3a — one worktrees root, at the ORG** (decided while implementing; the
  original wording `<repo>/.arxa/worktrees/` was ambiguous for project
  sessions, whose repo IS the project and would have repeated
  `RESTO/projects/kitchen-project/` twice). A project session's BRANCH and
  REGISTRY stay in the project repo; only its checkout sits under the org's
  single `.arxa/worktrees/`. Git places a worktree anywhere, so this costs
  nothing and keeps the org-move handling that already carries
  `.arxa/worktrees` with the folder. `openSession` gained `orgPath`
  (defaults to `repoPath`). The B2 invariant — a project session belongs to
  the PROJECT repo, not the org repo — is unchanged and still asserted
  through the worktree's git common dir.
- **Q4 — leaf.** `<slug(name) | singular(workspace folder)>-wt-<YYMMDD>-<NNN>`.
  `-wt-` stays. Name typed at creation is kebab-slugged and baked in; no name →
  singular of the last workspace folder. NNN counts per path + day.
- **Q5 — case.** Folder names verbatim (`RESTO`). Git refs are case-sensitive,
  macOS folders are not → the org-add guard (Q6) prevents the only collision.
- **Q6 — org uniqueness.** Adding/creating an org whose folder name matches an
  existing org's, case-insensitively, is refused.
- **Q7 — pinned at birth.** The path is computed once at creation and stored on
  the registry row; the app never re-derives it from the live folder name
  (Docker Compose `name:` / Nx "as-provided" lesson). If the org or project
  folder name on disk no longer matches the stored segment, the org opens in
  `path-moved`: rows visible, resume blocked with the expected folder named;
  restore or archive. Moving the org elsewhere with the same name keeps working.
- **Q8 — library hole.** `openSession` without an `id` throws `id-required`.
  The single mint lives in the app layer. The smoke driver goes through the
  product's `session.new` action.
- **Q9 — display.** Sidebar row + dsh header show the label (defaults to the
  leaf); breadcrumb is the path; row hover shows the full branch.
- **Q10 — migration.** None. Delete all old sessions/branches/worktrees/PRs now
  (RESTO 8 worktrees / 8 local `arxa/session/*` / 6 remote / 2 open PRs; TOPO 1
  stray worktree; LensCo 1). Format stamp bumps so an old-format registry is
  refused loudly rather than misread.
- **Registry row (internal).** `id` = the relative path string. `branch`,
  `worktree`, `dshSessionId` stored, never recomputed.

Research behind Q1/Q7 (2026-09-03): Docker Compose directory-derived project
names orphan volumes on rename → pin `name:`; Nx deprecated path-derived project
names for "as-provided"; URL design keeps the immutable id canonical and the slug
decorative; GitHub branch rename retargets *base* PRs but closes *head* PRs;
xlaude / Claude Code worktrees pick name = branch = dir once at creation.

## 2. Decisions (CI/CD smoke)

- **Q11 — stack.** Flutter/Dart (t3ci's own stack). Toolchain present: fvm 4.1.2,
  Flutter 3.47.2 (also 3.44.9), Dart 3.13.2. Runners registered for RESTO and TOPO.
- **Q12 — tiers.** All in RESTO after the wipe, every step through product
  actions (`session.new` → commit → push → PR → checks → gate → merge → archive →
  cleanup), a stage comment on the PR at each step:
  1. **Simple** — org session `RESTO/notes/note-wt-…`: one markdown file, one
     conventional commit, PR, frame check green, squash-merge, archive; worktree
     and branch verified gone locally and on GitHub.
  2. **Complex** — project session
     `RESTO/projects/kitchen-project/06-build/backoffice-wt-…`: real Flutter
     feature (model + widget + tests, ~6 files). First push deliberately RED
     (failing test + analyzer warning), fix commit → GREEN, lockfile enforced,
     ledger in PR body, merge.
  3. **Very complex** — two parallel project sessions touching the same file
     (conflict); `strict` forces the second to rebase onto main after the first
     merges; resolve → green → merge. One org session + one project session
     linked as one feature (two repos, two PRs cross-referenced). A superseded run
     cancelled by `concurrency`. A retro-CI replay (t3ci `05-retro-ci.sh`
     technique: each commit in a temp `git worktree --detach`, trap-removed) over
     the merged commits. Cleanup verified on disk and on GitHub.
- **Q13 — project CI.** Per Flutter target under `<stage>/<track>/<target>/`:
  `flutter pub get --enforce-lockfile`, `dart analyze --fatal-warnings`,
  `flutter test`; SDK pinned by a `.fvmrc` the scaffold writes and the probe
  honours (`fvm flutter` when `.fvmrc` exists — NOT present today; frame.js
  never mentions fvm). Still one job / one required check. No format check.
- **Q14 — follow-up records.**
  - PR body: ledger table, one row per stage (opened, committed, pushed, checks,
    gate, review, merged, archived, cleaned) with actor (`<name> <email>` or
    `arxa:<agent-preset>`), session path, sha, UTC time, result; a `Next:` line
    naming the follow-up owner. Rewritten on every stage.
  - Commit trailers: `Arxa-Session: <path>`, `Arxa-Container: <workspace key>`,
    `Arxa-Actor: …`, `Co-authored-by:` for the agent. The existing
    `Arxa-Stage: session <id>` trailer (prflow.js:52, means *session*, parsed by
    sweep) is renamed `Arxa-Session:` — the word "stage" is not reused.
  - Stage comments: one short comment per stage, posted by the product (today
    only the manual `card.pr.comment` exists; the 10 comments on the earlier
    smoke PRs came from the driver script).
- **Q15 — what exists vs new.** Exists: attribution line
  (`— written by <model> in arxa studio`), `Arxa-Stage: session <id>` trailer,
  PR body = problem + fix + attribution, `prComment` API, conventional-subject
  check, `flutter test` probe, strict protection + one required check,
  concurrency cancel, self-hosted labels. New: everything in Q13/Q14 beyond that.

## 3. Work order

1. **Naming rewrite** (git-workspace + file-org-shell + sidebar)
   - `sessions.js`: `mintSessionPath({ org, workspace, name, existing, now })`;
     `openSession` requires `id` (path) → throws `id-required`; branch
     `arxa/<id>`; worktree `.arxa/worktrees/<id>` (mkdir -p parents);
     `SESSION_BRANCH_PREFIX = 'arxa/'`; drop `-wt-` regex assumptions on the
     old shape (23 sites across lib + selftests).
   - `lifecycle.js` `newSession`: build the path from `path.basename(org)`,
     `ws`, slug(name)/singular(folder); dsh id `arxa-` + dashed path;
     `path-moved` detection on org open (stored first segment ≠ basename; project
     segment ≠ project folder); org-add duplicate-name guard (case-insensitive).
   - Prefix sites: finish.js:158, frame.js:238 (`arxa/**`, frame v4), prflow.js:206,
     repos.js:274, index.js:54, sessions.js:61/352.
   - Sidebar client: row = label, breadcrumb = path, hover = branch; `-wt-`
     pattern sites.
   - Selftests updated; new checks: mint shape, nested worktree dir, dsh key,
     id-required, duplicate-org refusal, path-moved.
2. **Wipe** (Q10): stop engine; per org remove worktrees, delete local +
   remote `arxa/session/*` branches (closes the 2 PRs), clear registries, remove
   dsh conversation dirs for those ids; verify empty on disk and GitHub.
3. **Project CI + follow-ups** (Q13/Q14) — *BOTH halves LANDED*
   (CI half `7ca2f72`; records half shipped as the stage ledger —
   `plugins/git-workspace/lib/ledger.js`, exported from `lib/index.js:85` as
   `readLedger`/`recordStage`/`renderLedger`/`withLedger`, gated by
   `selftest.ledger.mjs`, and fenced into every PR body by the git card's
   `openPr`. Verified 2026-09-03.)
   - DONE — frame **v5** `projectCheckSh`: `pub get --enforce-lockfile`,
     `analyze --fatal-warnings`, SDK pinned through `fvm`. All three GUARDED —
     no lockfile, no `.fvmrc`, no toolchain and no target each stay green;
     absence is never a failure (CLAUDE.md: distributed software, and a gate
     that reds on a missing optional file is a gate users switch off).
     Verified against a real Flutter target, 7/7 cases: clean→green, analyzer
     warning→red, dep missing from the lock→red, failing test→red, and the
     three absence cases→green.
   - DONE — `.fvmrc` in the project scaffold, pinned to the **detected**
     Flutter version; no Flutter installed writes NO file (a template content
     function may now return null to decline). "stable" was rejected as a pin:
     it moves, which is the opposite of what the pin is for.
   - **A v5, not an edit to v4, and that is the load-bearing part.**
     `writeFrameFiles` keeps any file whose stamp already reads
     `FRAME_VERSION` (`!upgrade || state === 'current'`), so editing v4's body
     in place would have reached new repos only and left every existing one —
     RESTO included, which had just healed to v4 — silently on the old gate.
   - **Correction:** v4's version note already *claimed* these checks. It
     shipped without them; the note was written from this plan rather than
     from the code. v4's comment now says only what v4 did.
   - DONE (`bd87efa`) — Q14 follow-up records, in `git-workspace/lib/ledger.js`:
     - **Trailers** on the collapsed commit: `Arxa-Session:`,
       `Arxa-Container:`, `Arxa-Actor:`, `Co-authored-by:`. `Arxa-Stage:` is
       retired for sessions — it was doing three unrelated jobs (session, org
       boundary, version mint), so reading it told you nothing without also
       parsing its value. **Correction to Q14 as written:** the plan said that
       trailer was "parsed by sweep". Nothing parses it — the only reference in
       the tree is a comment noting the format suits `interpret-trailers` — so
       the rename broke no reader. A bare model name is given a stable
       `<slug>@arxa.invalid` address, because GitHub silently drops a
       co-author without one.
     - **Ledger** on the session registry row: `recordStage` appends, and a
       re-run APPENDS rather than replaces, so "red, then green after a fix"
       survives as history. The registry is authoritative and needs no
       network — an offline org keeps the whole record and simply has nowhere
       to publish it.
     - **PR body** carries the rendered table between `<!-- arxa:ledger -->`
       fences, rewritten in place at each stage (new `prUpdate` PATCH face on
       github-link). Fenced so a reviewer's prose above and below survives, and
       so nine stages leave one table rather than nine.
     - **Stage comments posted by the PRODUCT**, from `card.commit`,
       `card.pr.create`, `card.pr.status`, `card.pr.merge` and
       `archiveSession` — not by a driver script. `checks` records only a
       SETTLED state, and only on change: the status action is polled every
       15s, so recording each call would bury the ledger under forty identical
       "pending" rows.
     - Covered by `git-workspace/selftest.ledger.mjs` (6 checks).

4. **Smoke tier 2** (Q12) — **DONE, green end to end.**
   `RESTO/projects/kitchen-project/06-build/menu-availability-wt-260903-001`
   → PR **unfazed-dev/kitchen-project#1**, merged `c721398`, branch deleted.
   - `newProject` scaffolded the project, published the repo, registered its own
     self-hosted runner (`arxa-unfazed-dev-kitchen-project`, online) and wired
     the frame — `.fvmrc`, `check.sh` and `ci.yml` all tracked in the project repo.
   - The feature is real: a `Menu`/`Dish` model with availability, seasonal-first
     ordering and coverage, under 5 tests.
   - **The deliberate RED was caught LOCALLY and never reached CI** — which is
     the design (D107), not a shortfall of the plan's "first push deliberately
     RED". A red gate never pushes, so a broken branch never burns runner time
     and never opens an unmergeable PR. Both faults were proven to red
     *separately*, because the analyzer runs first and check.sh stops there:
     the unused local reds via `--fatal-warnings`, and the wrong expectation
     reds via `flutter test` (`+4 -1`) once the analyzer is clean.
   - CI then ran green on the project's own runner, for both the pull_request
     and the branch push.
   - The PR body carries the live ledger with both clocks; the four trailers
     (`Arxa-Session`, `Arxa-Container`, `Arxa-Actor`, `Co-authored-by: Claude
     Opus 5`) are on the merged commit and parse as real git trailers.

4b. **Two bugs tier 2 exposed, both fixed**
   - **Project sessions could not open a PR at all** — four handlers refused
     with `project-session-pr-pending: PR flow for project repos lands in Phase
     2`. The plumbing underneath was already repo-agnostic; only the LOOKUP was
     wrong (every handler read the ORG manifest). One resolver (`repoFor`) that
     follows the session's own repo replaced the guards, and `card.ci.rerun` /
     `cancel` / `insight.ci` now target the session's repo too. Caught by the
     sidebar selftest when the first attempt removed a guard without wiring its
     replacement — run control would have acted on the org repo.
   - **A merged session's remote branch was kept forever.** Cleanup asked
     "is the branch TIP merged into main?", but after a merge the tip is
     routinely a WIP auto-save (the watcher, or archive's own snapshot) which by
     definition is not in main. It answered "unmerged" for a session that had
     just merged cleanly. Now asks it of the newest NON-WIP commit
     (`reviewedTip`, git-workspace/lib/commits.js) — verified on the real branch:
     old question said unmerged, new says merged, and a genuinely unmerged
     commit still correctly says no.

5. **Smoke tier 3** (Q12) — **DONE, green end to end.** Four sessions across
   two repos, four PRs, all merged, everything cleaned up.
   - **Parallel conflict.** `happy-hour-wt-260903-002` and
     `allergen-badges-wt-260903-003` were opened from the same kitchen main
     (`3acfcb1`), both rewrote `Dish`'s field block, and both gated green
     alone — the conflict was between them, not inside either. A merged
     (PR #2, `6eb9f88`); B was then 2 commits behind AND conflicting
     (`merge-tree` confirmed a real content conflict, not a lag).
   - **The plan's `strict` premise cannot fire here, and did not need to.**
     `strict` is GitHub's require-branches-up-to-date protection, and
     kitchen-project records `frameProtection: "plan-limited"` — the free
     plan refuses protection on a private repo. What actually blocked B was
     the conflict, which fires regardless of protection. Tier 3 therefore
     tests the mechanism really in play.
   - **Concurrency.** A second push while run #1 was in flight cancelled it:
     run `33719450955`, conclusion `cancelled` (`concurrency.group:
     ci-${{ github.ref }}`, `cancel-in-progress: true`).
   - **Two-repo linked feature.** `RESTO#5` (the allergen policy, org repo)
     and `kitchen-project#4` (the code it needs) cross-reference each other
     via `prUpdate`, written ABOVE the `<!-- arxa:ledger -->` fence.
     Re-checked after both merged: the cross-link survived every ledger
     rewrite, and the ledger is still live in both bodies.
   - **Retro-CI replay** (t3ci `05-retro-ci.sh` technique): 4/4 FEATURE
     commits on kitchen main pass — that is the four `feat(`/`fix(` merges,
     not all of main. Each commit is checked out at its own sha and runs the
     `check.sh` THAT SHA CARRIES, which is the right question ("does history
     still hold") but is not a fixed-script comparison. `3acfcb1`, the
     untrack commit, is outside the subject filter and was not replayed.
     Each ran in its own
     `git worktree --detach`, removed on the way out via an exit trap.
     Note for whoever writes the next one: under D107 a feature lands on
     main AS A MERGE COMMIT carrying the feature's subject, so
     `--first-parent --no-merges` selects precisely the wrong set (it
     returned 0). Replay first-parent commits INCLUDING merges.
   - **Cleanup verified both places**: all four sessions `archived` with
     `remoteBranch: deleted-merged`; RESTO and kitchen-project each show
     exactly one branch on GitHub (`main`), zero stale tracking mirrors,
     zero live checkouts under `.arxa/worktrees`.
   - **Carry-ins from tier 2, both discharged**: `pubspec.lock` is tracked
     (verified with `git ls-files`), and the engine did not hold the org lock.

5b. **Three bugs tier 3 exposed, all fixed**
   - **A target's `build/` output was committed into the user's repo.**
     46 MB in kitchen-project — `unit_test_assets/`, `NOTICES.Z`, shaders,
     `.cache.dill.track.dill` — regenerated and re-committed on every gate
     run. The project ignore scopes build dirs under a PLATFORM folder name
     (`**/ios/build/`, `**/macos/build/`), so a target folder named anything
     else (`backoffice`, a website-track `landing`) was never covered. The
     gate had it right all along and the ignore disagreed: `check.sh` PRUNES
     `-name build` when walking for targets. Fixed with `**/build/` plus
     `!/build/`, which keeps template v2's managed root container and honours
     the SAFETY note in gitignore.js rather than working around it. Verified
     against real `git add` behaviour, with a negative control proving the
     test reds without the fix. `ensureGeneratedIgnored` patches projects
     that predate the rule (`ensureProjectGitignore` never overwrites, so
     without it the fix reached nobody), wired where `ensureFrameUnignored`
     already runs. Existing tracked output needed `git rm -r --cached` too —
     an ignore alone does not untrack.
     **Scope: PROJECT repos only, deliberately.** The org repo tracks zero
     build files today (`git ls-files | grep '/build/'` → 0), but that is
     because no target has ever lived there, NOT because its ignore covers
     it: the org uses a `/*` whitelist, and `!/notes/` re-includes everything
     beneath it — reproduced in a throwaway repo, where `notes/app/build/…`
     was staged. It stays latent because the ORG gate never probes for
     targets at all (`orgCheckSh` checks org.json, top-level dock names and
     stray locks — there is no walk to `pubspec.yaml`/`package.json`, unlike
     `projectCheckSh`). Targets live in projects by design, so the fix is
     project-scoped to match. If org-hosted targets ever become supported,
     the org ignore needs `**/build/` — WITHOUT the `!/build/` negation,
     which exists only to protect template v2's managed project container
     and would wrongly re-include a root `build/` the whitelist excludes.
   - **A merged session left its remote-tracking mirror behind forever.**
     `push --delete` DOES prune `refs/remotes/origin/<branch>` — but only
     when given a remote NAME. `dropRemoteSessionBranch` deletes via a
     token-bearing URL, and a URL has no tracking namespace to prune. Both
     paths measured before the fix was written, because the plausible
     reason (prflow hand-writes that ref, so git does not own it) is NOT
     why — a named-remote delete prunes the hand-written ref perfectly well.
     Fixed with an explicit `update-ref -d`; asserted both ways round in
     selftest.prflow.mjs so a refactor back to `push origin --delete` cannot
     make the line look redundant.
   - **A conflicting PR surfaced as `PR merge failed (405)`.** 409 was named
     ("the head moved since review"); everything else fell through to a bare
     HTTP status. 405 is GitHub's "Pull Request is not mergeable" — an
     ordinary, actionable state, not a crash. Now returns
     `reason: 'not-mergeable'` with GitHub's own message ("Pull Request has
     merge conflicts"), in the same vocabulary the card already uses for
     `checks-red` / `no-pr`. Proven against the real conflicting PR #3
     before and after.

5c. **The gap tier 3 documents rather than fixes**
   - **arxa has no integrate-main machinery.** A grep of `plugins/*/lib` for
     `rebase` finds one hit: `allow_rebase_merge: false`. There is no
     `card.rebase`, no `session.integrate`. When B was blocked, the recovery
     was raw `git rebase origin/main` + hand resolution inside a worktree
     arxa created — 1 conflict stop here, but nothing in the product helps
     with it and nothing tells the user that is what to do. `readySession`
     recomputes its collapse base from the merge-base each time, so the
     product picks up correctly AFTER the rebase; it just cannot get there.
     Whoever picks this up: the driver at `/tmp/arxa-s2/tier3-remote-c.mjs`
     brackets the manual half with `--- MANUAL ---` markers.
   - **Nothing untracks build output that is already committed.**
     `ensureGeneratedIgnored` stops the bleeding; it cannot undo it, because
     git keeps honouring the index no matter what `.gitignore` says. The
     46 MB in kitchen-project came out because I ran
     `git rm -r --cached 06-build/application/backoffice/build` by hand.
     Every existing arxa project carrying committed build output stays
     exactly as heavy after the patch lands. A one-shot repair — untrack
     what the new rules now ignore, in the same place the patch runs — is
     the missing half, and is NOT written.

3b. **Bugs found and fixed while getting the suite green** (all in `7ca2f72`)
   - `renameOrg` repaired only the TOP-LEVEL entries under `.arxa/worktrees`.
     Under path identity that entry is an intermediate folder (the org
     segment), never a checkout, so every worktree kept a gitlink pointing at
     the pre-rename path and the next `git add` died with `fatal: not a git
     repository`. Now walks to the real checkouts (`listWorktreeDirs`, the
     same recursive walker reconcile.js already used — exported rather than
     copied) and repairs each from the repo that OWNS it, which for a project
     session is the project repo, not the org.
   - `.arxa/` was excluded from git only at first `openSession`. An org that
     never opened a session committed `.arxa/locks/<slug>.lock` — a pid, and
     rewritten on every open — into the user's history, leaving the tree
     permanently dirty. Exclusion moved to `git init`, before anything can be
     added. (RESTO escaped this only because its whitelist `.gitignore`
     happened to cover it.)
   Driver: `/tmp/arxa-s2/resto-tiers.mjs`, product actions only; report per
   tier with PR URLs and the on-disk/GitHub cleanup evidence.

## 4. Verification

- `git worktree list` in RESTO shows `.arxa/worktrees/RESTO/...` paths with
  `[arxa/RESTO/...]` branches — same string.
- `ls ~/.arxa/dsh/sessions/*/` shows `arxa-RESTO-...` keys.
- Renaming the RESTO folder in Finder → sidebar shows `path-moved`, resume refused
  with the expected name; renaming back clears it.
- Adding `/tmp/x/resto` while `RESTO` exists is refused.
- `openSession(repo, { name })` throws `id-required`.
- Three PRs on GitHub with ledgers; branches gone after merge; retro-CI output.
