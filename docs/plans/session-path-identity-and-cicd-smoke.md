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
3. **Project CI + follow-ups** (Q13/Q14) — *CI half LANDED (`7ca2f72`), records half OPEN*
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

5. **Smoke tier 3** (Q12) — NOT STARTED: two parallel sessions on one file,
   `strict` forcing the second to rebase after the first merges, a two-repo
   linked feature, a run cancelled by `concurrency`, and a retro-CI replay.
   Two things to carry in:
   - Tier 2 must **commit `pubspec.lock`** explicitly. The gate itself writes
     the lock on its first run, so a target scaffolded and committed before
     any `check.sh` run reaches CI without one — and `--enforce-lockfile`,
     guarded on the lock existing, would never fire on GitHub. The
     enforcement would look proven while never having run.
   - Tier 2 scaffolds `kitchen-project` itself (RESTO's `projects/` holds only
     `.gitkeep`), so it picks up the `.fvmrc` pin from the scaffold. There is
     nothing to backfill.

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
