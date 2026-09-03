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
3. **Project CI + follow-ups** (Q13/Q14): frame v4 `projectCheckSh` Flutter
   branch; `.fvmrc` in project scaffold; ledger renderer + trailers + product
   stage comments in git-card/prflow.
4. **Smoke tiers** (Q12): new driver `/tmp/arxa-s2/resto-tiers.mjs` using only
   product actions; report per tier with PR URLs, ledger screenshots, and the
   on-disk/GitHub cleanup evidence.

## 4. Verification

- `git worktree list` in RESTO shows `.arxa/worktrees/RESTO/...` paths with
  `[arxa/RESTO/...]` branches — same string.
- `ls ~/.arxa/dsh/sessions/*/` shows `arxa-RESTO-...` keys.
- Renaming the RESTO folder in Finder → sidebar shows `path-moved`, resume refused
  with the expected name; renaming back clears it.
- Adding `/tmp/x/resto` while `RESTO` exists is refused.
- `openSession(repo, { name })` throws `id-required`.
- Three PRs on GitHub with ledgers; branches gone after merge; retro-CI output.
