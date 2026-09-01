# Git card, sessions and worktrees — rewire

Grilled 2026-09-01. Supersedes nothing; extends `git-card-part-b-*`,
`project-sessions-physical.md`, and `arxa-studio-grill-decisions.md`.

The ask was "a complete git card with horizontal slides covering all the CI/CD
git things". Research (11 subagents, evidence in
`/private/tmp/claude-501/.../scratchpad/research-0*.md`) found the machinery
underneath the card does not do what the card would be advertising. This plan
fixes the machinery first and rebuilds the card on top of it.

---

## 1. Verified defects

Every line below was reproduced or read this session. `file:line` is exact.

| # | Defect | Evidence |
|---|--------|----------|
| B1 | **`card.status` reports a MISSING worktree as clean.** `runGit(..., allowFail:true)` returns `null` on ENOENT (`git-workspace/lib/run.js:76`); `?? ''` at `arxa-sidebar/lib/index.js:751` turns that into 0 staged / 0 unstaged / 0 untracked. Polled every 30s (`client.js:3143`). Indistinguishable from genuinely clean. | Reproduced live: `git status` in a missing cwd throws ENOENT → `null` → `''` → zero counts |
| B2 | **Project-scoped sessions cannot see their project.** `openSession` is called once, always with the ORG path (`file-org-shell/lib/lifecycle.js:973`). Org `.gitignore` excludes `/projects/*/` (`git-workspace/lib/repos.js:33-37`), and `git worktree add` only materialises tracked content, so the worktree contains no `projects/` at all. `workspace` is never appended to the session cwd (`dsh-bridge.js:27`, `lifecycle.js:978`). | Reproduced with plain git AND confirmed on live data: TESTO's 4 open "Fads / 02-design" sessions contain `.gitignore AGENTS.md communications meetings notes org.json` and no `projects/` |
| B3 | **Org-seat gate is decorative.** `arxa-sidebar/lib/index.js:803-805` squashes onto main FIRST (`commits.js:119` moves `refs/heads/main`), THEN gates. A red gate returns `parked:true` and calls nothing — no rewind, no `parkSession`. The commit is on main either way. Contradicts D38. The session path (`sessions.js:336→344`) gets the order right. | boundary-pipeline trace |
| B4 | **Resume hands back stale work silently.** `reviveSession` (`git-workspace/lib/sessions.js:412-424`) is a literal `git worktree add <dir> <branch>` with zero reference to main. No fetch, merge, rebase or staleness check. Surfaces later as a hard merge conflict. | session-endstates trace |
| B5 | **Auto-sync discards results.** `arxa-sidebar/lib/index.js:318` is `void l.syncOrgRepos(...).catch(()=>{})`. `diverged` (`lifecycle.js:382`) has no field in the payload; `connected` still reads `true`. (D97 fixed the *manual* Sync door only.) | wiring-audit |
| B6 | **Session branches are never deleted.** Repo-wide search for `branch -d`/`-D`/`deleteBranch` finds only selftest assertions that branches persist. ~250 dead refs/year at daily use. | session-endstates |
| B7 | **No worktree/branch reconciliation exists.** Candidates ruled out: `bin/arxa-engine-sync.mjs` syncs plugin payloads; `watch.js` is fed paths from the registry. TESTO has 5 dirs under `.arxa/worktrees` but 4 in `git worktree list`. | wiring-audit, live disk |
| B8 | **Runner-asleep wake CTA does not exist.** `card.status` returns `frame.wired`/`frame.runner`/`frame.protection` (`index.js:774`); `client.js:3171` renders only `protection`. The `asleep` classification exists in `card.pr.status` (`prChecksApi`) with zero UI consumers. Mandated by grill Q5/Q10. | ci-frame |
| B9 | **`--dsw-alias-label-error` is a dead token** (defined 0×, used 3×). Real token: `--dsw-alias-state-error-primary` (`red-400` light / `red-600` dark). 6 instances remain in the sidebar snippet. | Fixed in D97 badge, commit `8f186ef`; remainder is conformance decision #10 scope |
| B10 | **Data drift on live orgs.** TOPO has archived session rows for project `POLO`, which does not exist (only `project-001`). TESTO has an archived session (`s-mth1nxi9-6l9sba`) whose worktree directory survives as an empty husk. | live disk |
| B11 | **The project CI gate cannot fail for code reasons.** `projectCheckSh()` probes stack markers at the project ROOT, but code lives at `<NN-stage>/{website,application}/`, so no probe ever fires. The gate validates commit hygiene and nothing else. `orgCheckSh` is NOT affected (its dir whitelist / NN-kebab / temp-file rules do fail). | **Proven live on a copy of TOPO/project-001:** broken Dart in `05-scaffold/application/` + a valid conventional subject → `sh check.sh` exit **0**, while `dart` 3.12.2 IS installed and `dart analyze` in that dir reports **5 issues**. Control: a bad commit subject → exit 1, so the gate can fail — only on subjects. See §9 B11 / D113 |

### Non-defects (audited, cleared)

`orgTrash` rides the change signature with its reason inline; `scanWorkspace` is
uncached so the tree cannot stale; the gitignore gitlink guard is correct;
`updatedAt` is set on every annotation. `next.tree` is outside the signature but
is dead payload — only `o.tree` is read (`client.js:3014`, `3315`).

### Latent, not yet a bug

`conversation.input.dock` is `kind:'list'`, `scope:'session'`. The renderer sorts
with `a.order - b.order` (`dsh-client-ui-renderer/lib/client.js:844`) and JS sort
is stable, so the arxa card's `order:20` tie with dsh's own `queueDockEntry`
(`dsh-client-ui-conversation/lib/client.js:6927`) resolves by registration order —
correct today by accident. Reordering rows in `profile/cordis.patch.yml` would
silently move the card. Fix: give the card `order: 30`.

---

## 2. The flow, as built vs as believed

**Believed:** worktree → CI/CD → pull request → review → merge → main → cleanup.

**Built** (`git-workspace/lib/sessions.js:323-372`):

1. Squash the WIP run onto the session branch (`:330` → `commits.js:114-120`,
   `commit-tree` + `update-ref` plumbing — `git merge --squash` is never used)
2. Gate in the worktree (`:336` → `runGate` `:273-296`)
3. Red → park; no merge, no push (`:337-340`)
4. Green → `git merge --ff-only` into main (`:344`)
5. `git push -u origin main` (`:367`)

No pull request gates any of it. `card.pr.create` posts a PR and returns;
`card.pr.status` is read-only with no consumer; `prSquashMergeApi` is plumbed
through three layers (`github-link/lib/frame.js:102`, `index.js:305`,
`github-bridge.js:133`) with **zero product callers**; there is no `card.pr.merge`
in the action registry. GitHub closes those PRs as a side effect of the main push.

Review is off by configuration — `frame.js:168` sets
`required_pull_request_reviews: null`, `:167` sets `enforce_admins: false` — and
mostly unavailable anyway, since protected branches on private repos need GitHub
Pro. This was deliberate: `git-card-part-b-implementation.md:213-218` states "the
local gate authoritative for the card's merge path" and "PR as share artifact".

**The gate already IS the CI check.** `runGate` runs `sh check.sh`
(`sessions.js:273`); `ci.yml`'s only real step is `run: sh check.sh`
(`frame.js:144`). Same file, same command. What is missing is the human.

---

## 3. Decisions taken in this grill

**D98 — Fix session→repo routing before any card work.** The card's
"org or project the session is in" scope is fiction until a project-scoped
session actually attaches to the project repo. Card work is blocked on this.

**D99 — Dock routing table, explicit and data-driven, fail-loud.**

```
projects/<slug>/**              -> projects/<slug>/.git
notes|meetings|communications/** -> <org>/.git
account/**                      -> REFUSE
unknown dock                    -> REFUSE
```

`account/` is gitignored on purpose (D37 — billing artefacts must never enter org
history); it gets no repo and no sessions. The refusal message says so. The
unknown-dock refusal is the anti-bug rule: **the silent org fallback IS B2.**

**D100 — Business data path: server-side git read.** arxa business runs
server-side with its own GitHub token, fetches the ADS client repos, computes
aggregates there, and stores them in its own Supabase. **Studio publishes nothing
and holds no database write credentials.** The CLAUDE.md ownership boundary is
never crossed; credentials stay server-side rather than on developer laptops.

`account/` remains exactly as D45 designed it — database-authoritative, read-only
derived mirror, gitignored. Separate outstanding work:
`RemoteAccountProvider.fetchArtifacts()` currently throws
`ProviderNotImplementedError` (`account-mirror/lib/providers.js`). Finishing it is
what puts client billing info in front of a dev inside studio.

**Known limit of this choice — per-project aggregates need a published repo.**
Business reads from GitHub, and D99 puts project sessions in
`projects/<slug>/.git`, so a project is visible to business only once that repo
has a remote. Measured today: `TOPO/projects/project-001` has
`origin https://github.com/unfazed-dev/project-001`; `TESTO/projects/Fads` has
**no remote at all** (3 local commits). `syncRepoNow` returns `'local'` for any
repo without `repoUrl` (`lifecycle.js:362-363`), so nothing pushes it.
Consequence: **unpublished projects are invisible to arxa business by
construction** — their streaks and analytics simply do not exist server-side. The
in-studio card is unaffected (D101 reads local git directly, published or not).
If business must see unpublished project work, that is a different data path and
a different decision; it is not covered here.

**D101 — Streaks derive live from git.** `git log --date=short --pretty=%ad`
against the authoritative repo, bucketed by day, short-lived per-open cache. No
persisted index, no shared store. Rationale: this codebase's dominant bug class is
stale caches (D88's ghost rows, D96's reconciliation, B7's absent reconciliation);
git is authoritative and always true. Business computes its own aggregates
server-side under D100 — the two never share storage. Escalate to a persisted
index only on a measurement, not a hunch.

**D102 — Full GitHub pull-request flow.** ⚠️ **PARTLY SUPERSEDED by D107 (§9)** —
the PR flow stands; the *squash* merge does not. Read §9 before implementing.
 A session boundary pushes the session
branch and opens a PR; CI runs on the self-hosted runner; the card shows checks
and diff; merging happens through the provider API. `main` is never advanced by a
local merge.

*Correction to an earlier draft of this plan, which recommended a local-only
approve step on the grounds that a real PR flow "needs GitHub Pro". That was
wrong and the user caught it.* Verified against GitHub's docs:

- Pull requests, reviews and merges are **free** on private repos, with unlimited
  private repos and collaborators.
- **Self-hosted runners do not consume the 2,000-minute quota** — that quota is
  scoped to GitHub-*hosted* runners. arxa's `runs-on: [self-hosted, macOS, ARM64,
  arxa]` jobs cost nothing.
- Pro gates only **enforcement** — rulesets/branch protection on private repos,
  i.e. making GitHub *refuse* a direct push to `main`.

Enforcement is optional here because **the app is the only client**. Studio opens
the PR and studio merges it; there is no untrusted pusher to forbid. Protection
becomes worth buying the day a second human with a terminal might push by hand.

Consequence of running without protection: there is no *required* check, so an
asleep self-hosted runner means "no CI result yet", not "merge blocked forever".
The card must therefore represent pending/absent checks honestly and let a human
decide, rather than assuming a verdict will arrive.

**D103 — Resume detects staleness, human decides.** ⚠️ **SUPERSEDED by D108 (§9)** —
the behind-count is proven not to track conflict risk; use a `merge-tree` dry run,
continuously. Read §9 before implementing.
 On revive, compute
`git rev-list --count <branch>..main` and surface it: "N commits behind main",
with *bring main in* / *continue anyway*. Nothing moves without a click.
Needs a new helper — `mainSyncState` (`repos.js:297-303`) is hardcoded to local
main vs `origin/main` and takes no branch argument.

**D104 — Merge is a checkpoint; Finish cleans up.** ⚠️ **REVISED by D107 (§9)** —
under collapse-then-`--no-ff`, ancestry works again, so `git branch --merged` /
`branch -d` are valid and the PR-`merged:true` gate and `rev-list` fallback are no
longer needed for correctness. Read §9 before implementing.
 The merge path stays
repeatable and does not archive. A new **Finish** action archives the session,
prunes the worktree and deletes the branch *if its PR was merged*, refusing with a
reason otherwise. A **Sweep** action clears the backlog of dead
`arxa/session/*` refs.

**Merged-ness test — read this before implementing.** Under D102 the merge is a
GitHub *squash* merge, which creates a new commit whose ancestry does not include
the session branch. `git branch --merged main` therefore reports nothing, and the
obvious implementation of Finish/Sweep silently refuses every branch. Gate on the
provider's PR state (`merged: true`) instead. For the pre-existing backlog, which
has no PRs at all, fall back to "branch has zero commits ahead of main"
(`rev-list --count main..<branch>` = 0) — which is exactly the condition measured
across all three orgs for 14 of 15 branches.

**D105 — Card geometry: actions in the strip, insights in the column.** The dock
card carries only what is touched constantly — status, commit, approve/merge — as
2–3 slides, plus a one-line teaser. Streak charts, CI run history and session
management open in the right column (full-screen at 390px). Honours the standing
rule that the card owns the strip and the viewer owns the right column, and avoids
forcing two-dimensional charts into a one-dimensional 390px strip.

**D106 — Auto-commit checkpoints; human writes the squash subject.** Checkpoints
land on the session branch automatically with throwaway generated messages and are
squashed away. The human writes or confirms exactly one subject — the squash
subject at the boundary — at the moment they are already approving the merge.
Consistent with Q6 (the session model drafts, the engine never calls an LLM) and
Q7 (conventional subject + `Arxa-Stage:` trailer).

---

## 4. Phases

Ordered by dependency. Each phase ships green with its own verification.

### Phase 0 — Stop the card lying (no design dependency, do first)

- **B1**: `card.status` must distinguish *missing worktree* from *clean*. Return an
  explicit `worktree: 'missing' | 'ok'`; the card renders an error state, never a
  clean one. Do not paper over `runGit`'s `null` with `?? ''`.
- **B3**: reorder the org-seat path to gate BEFORE moving `refs/heads/main`, and
  make a red gate actually park. Match the session path's ordering.
- **B5**: `syncOrgRepos` results reach the payload, including `diverged`;
  `connected` stops reading `true` when the last sweep failed.
Verify: selftest per fix; a deliberate missing-worktree case must render an error.

### Phase 0b — Data cleanup (DESTRUCTIVE — gated, not implied)

**This step deletes live state and is deliberately not folded into Phase 0.**
An approved plan must not authorise it implicitly.

Preconditions, all required:
1. Explicit user confirmation naming this step.
2. **The engine is stopped.** At time of writing, the engine on port 7891 belongs
   to another session (`cairn-de`) and four of the target sessions are
   `state: open` with live worktrees. Deleting worktrees under a running engine
   is not safe.
3. A recorded `git branch -a` + `git worktree list` per org, taken first.

Then: drop the 13 project-annotated husk sessions (all verified 0 commits ahead
of main), the TOPO `POLO` ghost rows, and TESTO's orphan worktree directory
`s-mth1nxi9-6l9sba`.

### Phase 1 — Session→repo routing (D98, D99)

- New routing module: path → repo, table-driven, refusing unknown docks loudly.
- `lifecycle.js:973` repo selection; `:978`/`:1014` cwd.
- Every id-keyed function in `sessions.js` (`listSessions`, `archivedSessionIds`,
  `annotateSession`, `nextSessionName`, `reviveSession`, `archiveSession`,
  `sessionStageBoundary`) gains a repo-discovery preamble.
- New `parkedSessions()` aggregator across org + project registries.
- Sidebar merges per-repo results; session ids must stay unique across repos.
- Migration: none needed. All 13 project-annotated sessions have zero commits.
- **Handle "target repo has no HEAD" explicitly.** `git worktree add` needs a
  commit to branch from. A project directory created moments ago may have none
  yet — the same condition `publishGithub()` already refuses with
  `initial-snapshot-pending: the first git snapshot is still running`
  (`lifecycle.js:786-787`). The first session opened in a fresh project will hit
  this. Routing must detect it and either wait for the initial snapshot or refuse
  with that same human reason — never let `worktree add` fail raw.
  (Measured: both existing project repos do have HEAD — Fads 3 commits,
  project-001 5 — so this is a fresh-project path, not a migration blocker.)

Verify: a project-scoped session's worktree contains the project; a file edited
there is seen by `git status` and survives archive.

### Phase 2 — Pull-request flow (D102 as revised by D107, D106, D109)

> ⚠️ Build the §9 shape, not the §3 shape: collapse-on-branch then `merge_method:
> merge`, gate inside the merge call, send the reviewed `sha`.

Replaces the local `merge --ff-only` + `push origin main` at `sessions.js:344`/`:367`.

1. **Local gate first, as pre-flight.** Keep `runGate` in the worktree and fail
   fast — never open a PR for work that already fails locally. This preserves the
   fast local signal; the same `check.sh` then runs again on the runner.
2. **Publish the branch.** Push `arxa/session/<id>` to origin instead of merging.
3. **Open the PR** via `card.pr.create` (exists, `arxa-sidebar/lib/index.js:825`),
   titled with the human-confirmed squash subject from D106, validated against Q7
   (conventional subject + `Arxa-Stage:` trailer).
4. **Surface PR + check state** in the card via `card.pr.status` (`:847`) and
   `prChecksApi` — which already classifies `asleep: r.status==='queued'` and today
   has no UI consumer. Pending and absent checks must read as pending/absent, never
   as pass or fail.
5. **Merge on the human's click** — build `card.pr.merge`. `prSquashMergeApi` is
   already plumbed through `github-link/lib/frame.js:102`, `index.js:305` and
   `github-bridge.js:133` with zero callers; this phase supplies the caller.
6. **Reconcile local main.** After a remote squash-merge, fetch and fast-forward
   local `main` so it matches the remote. Until this runs, local main is behind
   and `card.status` will mis-report ahead/behind.

Also in this phase: **B3** — fix the org-seat ordering so the gate runs *before*
`refs/heads/main` moves, and a red gate actually parks.

> **Squash-merge breaks `git branch --merged`.** A squash merge creates a NEW
> commit on `main`; the session branch's commits are not its ancestors, so
> `git branch --merged main` will **not** list the branch as merged. D104's
> Finish and Sweep must therefore gate on the **provider's PR state**
> (`merged: true`), not on git ancestry. This is a direct consequence of choosing
> D102 and it silently breaks the obvious implementation of D104 — noted here so
> it is not discovered at runtime.

Verify: a red local gate never pushes; a green one opens exactly one PR (the
existing dedupe against an open PR for the branch must still hold); merging
through the card lands a squash commit on remote main and local main
fast-forwards to it.

### Phase 3 — Session lifecycle (D103 as replaced by D108, D104 as revised by D107)

> ⚠️ Also in scope: worktree reconciliation via `git worktree list --porcelain`,
> `worktree remove`/`prune` instead of `rm -rf`, and revive showing the branch's own
> tip SHA. See §9 implementation items 4–6.

- `behindMain(branch)` helper — `rev-list --count <branch>..main`.
- Revive surfaces the behind-count with the two choices.
- `Finish` action: archive + prune + delete branch, gated on merged-into-main.
- `Sweep` action over `git branch --merged main`.
- **B7**: a reconciliation pass for worktree ↔ registry ↔ git drift.
- **B4** is closed by the behind-count; **B6** by Finish and Sweep.

### Phase 4 — Card rebuild (D105, D101, B8)

- Action strip: status / commit / approve slides, hand-built (no carousel
  primitive exists anywhere in the install — confirmed).
- Insight surface in the right column: streak from `git log`, CI run history,
  session management.
- **B8**: surface `frame.wired` and `frame.runner`; add the runner-asleep wake CTA.
- Card `order: 30` to make the dock position intentional.

**Collision warning:** `ArxaGitCardDock` lives inside `arxa-sidebar`'s generated
bundle, which session `cairn-de` is concurrently rewriting for full UI
conformance (`dsh-plugin-ui-conformance.md`, Phase 2 "arxa-sidebar surgical").
Sequence Phase 4 against that work or it will conflict badly.

All new card UI is bound by the conformance contract: real `--dsw-*` tokens,
shipped primitives, `ctx.locale.register` + `t()` for every string, side effects
in `ctx.effect()` disposers, hand-written zero-dep. Edits go through
`workspace-region.snippet.txt` + `gen-workspace.mjs --write`, never `client.js`.

### Phase 5 — Separate work, not blocking

- `RemoteAccountProvider.fetchArtifacts()` (D45 stub → real).
- arxa business server-side aggregation (D100).

---

## 5. Prerequisites outside the code

**1. Re-link GitHub for the `workflow` scope — now a hard blocker for Phase 2.**
The scope is already in `SCOPES` (`github-link/lib/auth.js:29`); links authorised
before it was added do not backfill, and GitHub rejects any push touching
`.github/workflows/*` without it. `frame.js` writes `ci.yml` into every published
repo, so **every** framed repo fails to push until this is done. Under D102 the
PR flow depends on CI actually running, so this stops being an annoyance and
becomes a dependency. One-time user action, no code change.

**2. The self-hosted runner must be reachable.** `ci.yml` is
`runs-on: [self-hosted, macOS, ARM64, arxa]`, so with no runner online a job sits
queued indefinitely. Without branch protection this does not *block* a merge, but
it does mean the card can sit showing pending checks forever — which is precisely
why B8's runner-asleep wake CTA moves from nice-to-have to required (Phase 4).

**3. Repos must be published for the PR flow to apply at all.** A project repo
with no remote cannot have a PR. Measured today: `TOPO/projects/project-001` has
an origin; `TESTO/projects/Fads` has **no remote** (3 local commits). Sessions in
an unpublished repo need a defined behaviour — see §7.

---

## 6. Doc drift to correct while in here

- git-card docs say locale is "en + zh" (`git-card-part-b-implementation.md:133`,
  `:177`); conformance says en/pl/fr with zh dropped; the shipped selftest agrees
  with en/pl/fr. The git-card docs are stale.
- Q10 is logged as discharged but half its UI was never built (B8).
- D38's worktree path `<workspace-root>/.arxa/worktrees/<repo>/<session-id>/`
  (`:377`) is dead; D89's `.arxa/worktrees/<id>` (`:886`) is current.
- Pre-existing: `file-organisation-implementation.md:21` (D36/D69 placement);
  `sidebar-org-rethink.md:51-54` (D41/D72 rename).

---

## 7. Not settled

- **The org/project primary seat has no branch, so no PR.** D102 covers session
  seats. The primary seat advances main by `stageBoundarySquash` committing
  directly (`arxa-sidebar/lib/index.js:803-805`). Either it keeps going direct to
  main (gate ordering fixed per B3) or it gets an ephemeral branch and a PR too.
  Undecided — needs its own question.
- **Sessions in an unpublished repo.** A repo with no remote cannot have a PR.
  Refuse the boundary, fall back to a local merge, or prompt to publish first?
  Undecided; affects `TESTO/projects/Fads` today.
- Which of the three action slides is the default view.
- Whether the insight surface is a viewer lane or its own overlay.
- Cross-repo merge semantics for the sidebar CTA once sessions live in project
  repos (flagged open in `project-sessions-physical.md`).
- Trash/restore interplay with per-repo registries (same source).

---

## 8. Note — other git providers (Gitea / GitLab / Bitbucket / plain remote)

Not scheduled. Recorded now because every choice in §3 either keeps this door
open or nails it shut, and the research says the door is cheaper to keep open
than expected. Source: `scratchpad/research-12-git-providers.md` (read-only
audit of the live tree + official provider docs, 2026-09-01).

**The engine is already provider-neutral.** `plugins/git-workspace/lib/` is
1505 lines across 50 `runGit()` call sites with **zero network calls and zero
GitHub references**. Worktrees, branches, squash-via-`commit-tree`, the gate
runner, the registry — all of it is plain git and ports untouched. The whole
provider-specific surface is 16 faces on one object at
`plugins/github-link/lib/index.js:317-334`.

**A premise we had wrong.** Linking is *not* primarily device flow.
`github-link/lib/auth.js:4-11` documents loopback + authorization code + PKCE
S256 as the primary path, with device flow only as the no-browser fallback.
That inverts the usual portability worry: loopback+PKCE is supported by GitHub,
GitLab and Gitea alike, so "provider X has no device grant" blocks nothing.

**Four hardcoded `github.com` leaks must die first** — one-liners, and nothing
else is testable until they are gone. Three are loud, one is silent and is the
dangerous one:

| Leak | Site | Effect |
|---|---|---|
| Push credentials | `file-org-shell/lib/lifecycle.js:180` | Non-GitHub remote silently gets a credential-free push URL. **Silent failure — worst shape.** |
| Browser allowlist | `arxa-sidebar/lib/index.js:487-488` | A GitLab/Gitea authorize URL cannot be opened. Blocks linking outright. |
| Runner URL | `github-link/lib/runner.js:80` | Runner always registers against github.com. |
| Sidebar push URL | `arxa-sidebar/lib/index.js:820-821` | Injects a GitHub token into whatever origin is set. |

**Cost per provider.**

- **Gitea / Forgejo — cheapest, and the right second provider.** It mirrors
  GitHub's REST route shapes (`/user/repos`, `/repos/{o}/{r}/pulls`,
  `/login/oauth/authorize`) and uses loopback+PKCE S256. The adapter is close to
  URL-base substitution. Its Actions is `act`-based; `WORKFLOW_DIRS` defaults to
  `.gitea/workflows,.github/workflows`, so **our `ci.yml` path ports unchanged**
  (never emit both dirs — `.gitea/` wins). One confirmed breakage: Gitea accepts
  only `runs-on: xyz` or `runs-on: [xyz]`, so our
  `[self-hosted, macOS, ARM64, arxa]` must collapse to a single label.
- **GitLab — cheap-to-moderate.** Every operation exists and is documented, and
  it is the one non-GitHub provider that *also* has a device grant (17.1+). Costs
  are vocabulary (project/MR/pipeline, numeric project IDs) and a separate
  `.gitlab-ci.yml` generator — though the body is still one line, `sh check.sh`.
- **Bitbucket Cloud — expensive, deprioritise.** Two independent problems. No
  device grant *and* no public-client/PKCE path in the official OAuth docs; the
  documented exchange is `curl -u "client_id:secret"`, and a distributed desktop
  app cannot ship a secret (`auth.js:69-72` refuses to, by design). That forces a
  different auth *UX*, not just a different adapter. Plus
  `bitbucket-pipelines.yml` shares nothing with GHA syntax.
- **Plain git remote — nearly free, and it is the CLAUDE.md fallback.** Because
  `git-workspace` has no provider coupling, "bring your own remote" (any SSH or
  HTTPS host, no forge at all) works the moment `lifecycle.js:180` stops gating
  credentials on the hostname. No PRs, no CI, no protection; everything else
  identical.

**The hardest incompatibility, and it lands squarely on §3's CI gate.** GitHub's
Checks API plus *named* required contexts has no equivalent anywhere else.
Reading status is a solvable normalisation (`check-runs` vs commit-statuses vs
pipelines → `green|red|pending|none`). **Requiring a named context is where it
breaks.** GitLab's `protected_branches` API carries access levels and no
status-context field at all; the nearest gate is the project-wide
`only_allow_merge_if_pipeline_succeeds`, which cannot name a job, and requiring a
named external check is Ultimate-tier. Gitea and Bitbucket are *unconfirmed* —
Gitea is widely reported to carry `status_check_contexts` but that traces only to
a search result, not an official page; verify against Gitea's Swagger before
relying on it. **Consequence for us: `requiredContexts` must be a declared
capability that degrades, not an assumption.**

**Seam shape when we build it.** Model on `file-org-shell/lib/github-bridge.js`
(injected faces, default unavailable stub, `{ok, reason}` returns, never throws)
plus `account-mirror`'s `createLocalProvider()` default. Rename
`plugins/github-link` → a `forge-link` host with per-provider adapters. Two rules
carried from what already works: (1) typed non-throwing failures, extending the
existing reason vocabulary with `'unsupported'` alongside `'plan-limited'` —
`frame.js:44-52` already proves we model "the provider said no" as a measured
state, not an error; (2) a `plain-git` default provider that declares almost no
capabilities and degrades everything else. A startup `capabilities()` call is
what the card feature-flags from — which is also the honest fix for GitHub
free-tier repos that cannot enforce protection.

**What this note obliges us to do now, while building §3 — and nothing more:**

1. Keep the PR/checks/merge calls behind the existing `github-bridge`-shaped
   seam rather than reaching into `github-link` from the card.
2. Treat `requiredContexts` and `managed-runners` as capabilities that may be
   absent, not as guarantees. (We need this for free-tier GitHub anyway.)
3. Normalise CI state to `green|red|pending|none|asleep` at the boundary, so the
   card never sees the word `check-run`.
4. Do **not** build adapters. `plain-git` and Gitea are the first two candidates
   when this is scheduled; Bitbucket is explicitly deprioritised.

---

## 9. Grill round 2 — decisions revised against industry research + t3ci

Research: `scratchpad/bp-0{1..6}` + `bp-07-scorecard.md`. Prior art: `/Volumes/developer_ssd/Developer/totem_labs/t3ci`.

### D107 — Sessions collapse on the branch, then merge with `--no-ff`. SUPERSEDES the GitHub squash-merge in D102.

**Why the old shape was wrong.** GitHub's squash-merge creates a commit on `main`
whose *content* is the branch's but whose *ancestry* is not. Reproduced, four
failures: `git branch -d` refuses forever; `merge-base --is-ancestor` is false
forever; ahead/behind counts lie in both directions; and **a revived merged
session re-proposes its own landed work and conflicts against itself,
permanently**. D103 (revive) and D104 (Finish) were mutually corrupting.

**The shape.** At "ready": soft-reset the session branch to its merge-base and
recommit as ONE commit carrying the human's subject and an attribution body.
Push → PR → CI on that exact commit → human reviews one clean diff → merge with
`merge_method: merge` (`--no-ff`).

**Verified in a scratch repo, both halves.** Plain merge commits fix all four
ancestry bugs but leave every `wip:` checkpoint in `main` forever. Collapse-then-
merge gets both:

```
042225b Merge session abc: feat: the thing
fa1dc2b other work on main
cc50734 feat: the thing          <- one clean commit, no wip
7b9a9b5 base
```

`branch --merged` lists it · `branch -d` deletes cleanly · counts `2 0` ·
`--is-ancestor` YES · revive + bring-main-in CLEAN · `log --no-merges` (what
bisect walks) never lands on a checkpoint.

**Costs, accepted:** one merge commit per session (`log --first-parent` hides
them); the collapse rewrites the branch, so a force-push if already pushed —
therefore **the collapse must happen before the human reviews**, so they read the
exact commit that lands; revert becomes `revert -m 1`.

**Consequences elsewhere:**
- `settingsPayload()` (`git-workspace/lib/frame.js`) flips to
  `allow_merge_commit: true, allow_squash_merge: false, allow_rebase_merge: false`.
- Attribution now rides in the collapsed commit's body. The
  `squash_merge_commit_message: 'PR_BODY'` workaround is **not needed** — drop it.
- Finish may use `git branch --merged` / `branch -d` again. The PR-`merged:true`
  gate and the `rev-list --count` fallback in the old D104 are no longer required
  for correctness (keep the PR flag only as a UI signal).

### Verified corrections to §1 and §3 — the plan was wrong on these

1. **"Nothing re-tests the merge result" — FALSE.** This repo:
   `.github/workflows/ci.yml` `on: push: branches: [master]`. The emitted
   template: `git-workspace/lib/frame.js:129` `on: push: branches: [main]`.
   Post-merge verification already exists in both. The real gap is that **nothing
   consumes the verdict** — a red post-merge run notifies no one.
2. **Branch protection is not "unavailable in some cases" — it 403s always.**
   Live, this account, both a t3ci-era repo and an arxa-managed one:
   `gh api repos/unfazed-dev/app-box/branches/master/protection` and
   `.../project-001/branches/main/protection` both return
   `403 "Upgrade to GitHub Pro or make this repository public"`.
   So `protectionPayload()`'s `strict: true` + required `frame-check` **can never
   apply**, and `planLimited` (`github-link/lib/frame.js:44-49`) is not an edge
   case — it is the only path that ever executes. **The app is the only gate that
   can exist.** This promotes "the merge call refuses a non-green PR" from a
   nice-to-have to the sole control.
3. **t3ci's branch-protection plan never worked.** `t3ci/CI/04-branch-protection.md`
   (2026-08-12) documents the exact `PUT .../protection` call and claims "merge
   button is blocked until … green". On this Free account that call 403s. arxa
   studio inherited a design that assumes an enforcement layer that has never
   existed here. Worth stating plainly so it is not re-inherited a third time.
4. **`timeout-minutes` already present** (`frame.js:138`, value 15), as is
   `concurrency: { cancel-in-progress: true }`. Not gaps.
5. **Attribution is not absent** — `prTemplate()` already ends
   `— written by <model> in arxa studio`. Under the old squash it evaporated
   (`app-box` live: `squash_merge_commit_message: COMMIT_MESSAGES`). Under D107 it
   survives in the commit body.

### Prior art to reuse rather than reinvent (t3ci)

- `t3ci/CI/05-retro-ci.sh` already uses `git worktree add --detach` +
  `git worktree remove --force` under a `trap`. "Remove, never `rm -rf`" is
  already the house pattern — match it in Finish/Sweep.
- `t3ci/model-communication/files/skills/file-pr/` and `babysit-pr/` encode the PR
  rules this plan is re-deriving: conventional title as the merge subject, problem-
  first body, no drafts, and **"runner asleep/offline → the check queues, it is not
  red — wait or wake the machine, don't 'fix' it"**, which is exactly B8's wake CTA.

### D108 — Drift is measured by a dry-run merge, continuously. REPLACES the behind-count in D103.

**The count does not track risk.** Verified in a scratch repo:

| main's change | `rev-list --left-right --count` | real risk |
|---|---|---|
| touched an unrelated file | `1 5` | none — merges clean |
| touched the same line | `1 6` | certain conflict in `f.txt` |

Nearly identical numbers, opposite outcomes. A number that is scary-or-reassuring
independently of risk trains the user to stop reading it (bp-01 #3).

**The signal.** `git merge-tree --write-tree <session> main` (git 2.51 present) —
a real merge performed in the object store, no checkout, no working tree touched.
Non-zero exit = conflict; `--name-only` lists the exact conflicted paths.

- clean → revive silently; show the count only as soft context, never as a warning
- conflict → name the files and offer **bring main in now**, which is nearly free
  because the session already owns a worktree: main integrates in a separate
  directory without disturbing session state. The plan already built the mechanism
  that makes this cheap; it just was not used this way.

**Run it on the existing 30 s snapshot poll, not only at revive.** Research's
sharpest point on D103 was not the metric but the timing — a single gate at
wake-up checks at the moment it matters least. Continuous evaluation is what
integration-frequency doctrine actually asks for.

### D109 — The merge gate lives in the API layer, with a logged override.

Branch protection 403s on every private repo on this account (verified live), so
no server-side control will ever exist. `prSquashMergeApi` currently PUTs the
merge and consults no check state; it and `prChecksApi` are independent
functions. The gate therefore goes **inside the merge function**, so every present
and future caller inherits it — not in the card, where a second call site, the
org-seat path, or any later automation bypasses it silently. That is exactly how
the org-seat gate (B3) already became decorative.

- Resolve check state inside the merge call; refuse unless green.
- **Send the reviewed head `sha`** in the merge body. GitHub 409s if the branch
  moved; surface that as "the branch changed, re-review". Without it, an agent
  commit landing between "CI green / human read the diff" and "human clicks merge"
  is merged unreviewed under a stale green check — with a background agent that is
  normal operation, not a rare race.
- Keep `{force: true}` as an explicit path that **records who overrode and why**, so
  a bypass is an auditable decision rather than an accident. Without an in-app
  escape hatch the escape becomes `gh pr merge` in a terminal, which is worse
  because it is invisible.
- The refusal must distinguish **red** (block) from **runner-asleep** (block + wake
  CTA) from **pending** (wait). Otherwise a sleeping runner is an unmergeable trap:
  a queued job auto-cancels at 24 h and `cancelled` satisfies nothing. This is why
  B8's wake CTA is load-bearing, not cosmetic — and `t3ci/.../babysit-pr` already
  states the rule: "runner asleep/offline → the check queues, it is not red — wait
  or wake the machine, don't 'fix' it".

### D110 — The org repo tracks a projects manifest. Projects stay independent, gitignored repos.

The polyrepo split is correct and research defended it — blast-radius isolation,
per-client access control, independent cadence. The defect is that the org repo
records *nothing* about its projects.

**Correction to the research on the way in.** bp-06 claimed an ignored nested repo
is deleted by ordinary `git clean`. Verified false on git 2.51:
`git clean -fdx` prints **"Would skip repository projects/Fads"** and leaves it.
Only `git clean -ffdx` (double force) removes it. The data-loss vector is real but
requires `-ff`; it is not the ordinary path. The surviving — and stronger —
argument is **provenance**: with `/projects/*/` ignored, the org can never say
"Fads was at commit Z when the org was at X".

**The manifest.** The org commits a small `projects.json`: slug, path, remote (or
`null`), last-known commit, refreshed on project commits. No git-nesting mechanics
— no submodules, no gitlinks, no `--recurse-submodules`, no detached HEADs, and no
second commit in the parent for every project commit. Chosen over real submodules
because arxa studio controls both sides as a desktop app and does not need git
itself to enforce the pin.

**It also fixes the aggregation blind spot.** `TESTO/projects/Fads` has 3 local
commits and no remote, so it is invisible to anything reading GitHub. The manifest
makes org/project activity a **local `git log` walk** — which the CLAUDE.md
boundary requires anyway, since a feature may not depend on a hosted service to
function. GitHub publish becomes an optional sync path, not the source of truth.
(This also sidesteps the GitHub stats API's per-repo rate limits, 202-caching and
10k-commit cap.)

### B11 — NEW, verified: the project CI gate cannot fail for code reasons. It is green by construction.

Found while grilling the toolchain question; no research agent found it, because it
needs the emitted `check.sh` read against the real project layout.

`projectCheckSh()` probes for stack markers **at the project root**:
`[ -f package.json ]`, `[ -f pubspec.yaml ]`, `[ -f Cargo.toml ]`,
`[ -f pyproject.toml ]`. But a project root only ever holds `AGENTS.md`,
`check.sh`, `project.json` and the ten stage containers. Code lives at
`<NN-stage>/website/` and `<NN-stage>/application/` (CONTEXT.md: **Target** — "the
two fixed subfolders of every stage container"). **No marker is ever at the root,
so no probe can ever fire.**

Live on `TOPO/projects/project-001`:

```
package.json / pubspec.yaml / Cargo.toml / pyproject.toml at root : ABSENT (all four)
the same markers anywhere under the project                       : none
sh check.sh                                                       : exit=0
```

**Proven, not merely inferred** — on a scratch copy, a *deliberately broken* Dart
target with a *valid* conventional subject:

```
05-scaffold/application/lib/main.dart  = "void main() { this is not valid dart ;;; }"
git commit -m "feat: add a deliberately broken dart target"
sh check.sh                            -> exit=0        (GREEN)
dart --version                         -> 3.12.2        (toolchain IS installed)
cd 05-scaffold/application && dart analyze -> 5 issues found
```

The tool is present, the code is broken, dart catches it in a second — and the gate
is green because it never looks inside the target. **Control, to prove the gate is
not merely inert:** a non-conventional commit subject → `exit=1`. So it *can* fail,
but only on commit-message formatting.

**Scope precision:** this is project-specific. `orgCheckSh()` genuinely can fail —
top-level directory whitelist, NN-kebab stage names, stray temp files, `org.json`
parse. Do not widen B11 to org repos.

What actually executes: four dead branches, an `.git/index.lock` check, and
`subjectCheckSh()`. **Nothing about the project's code is tested, ever.**

**Severity: this is the foundation of the whole PR flow.** Under D109 the gate's
green is what authorises the merge, and `frame-check` is the context that
protection would require if protection were available. A gate that cannot fail
makes every downstream control decorative.

Also mis-aimed in kind, not only in place: arxa emits exactly two target types —
`website/` (HTML/JS, htmx, arxa-designer) and `application/` (Dart,
arxa-scaffolder/builder). The Cargo and pytest branches are speculative generality
for stacks arxa never produces.

### D113 — The project gate walks targets, and a declared-but-untestable target is RED.

- Walk `<stage>/website/` and `<stage>/application/`; probe **there**, not at the root.
- Probe only the two kinds arxa emits. **Delete the Cargo and pytest branches.**
- A stage with a real Dart application and no `dart` on the runner → **fail red**,
  not skip. Green must mean tested. Rejected the third "skipped" state: it adds an
  exit code, a card state and a merge-gate branch to express something that should
  simply block.
- **The load-bearing implementation constraint:** most of the ten stages are empty
  scaffolding, and "green by absence" (`checkShHead()`) must survive for them. So
  the walk must reliably distinguish an empty `application/` from a real one — that
  discrimination is now what the whole gate rests on, and it is the thing to test
  hardest. Getting it wrong in one direction makes every project red forever; in
  the other it restores B11.

### Implementation items settled by evidence, not needing a decision

1. **Fork-guard the emitted `ci.yml`.** It pairs unqualified `pull_request:` with
   `runs-on: [self-hosted, macOS, ARM64, arxa]`, in a template written into every
   repo arxa creates. Harmless today (solo private repos, no fork vector); silently
   dangerous the day one goes public or takes an outside PR. Gate the job on
   `github.event.pull_request.head.repo.full_name == github.repository`. The guard
   must live in the template — a user cannot be expected to add it.
2. **`actions/checkout@v4` → `@v7`.** v7 refuses to check out fork PR code by
   default under `pull_request_target`/`workflow_run`. Note our trigger is plain
   `pull_request`, which is already the safer choice. v5+ needs runner ≥ 2.327.1.
3. **Do not add `timeout-minutes` or `concurrency`** — already present
   (`frame.js:138`, and `cancel-in-progress: true`). bp-04 recommended both; both
   are done.
4. **Worktree reconciliation reads `git worktree list --porcelain`,** which
   annotates `prunable: gitdir file points to non-existent location`. Do not
   hand-roll disk-vs-registry diffing (B7). This exact bug class is filed against
   Claude Code's own worktree feature (#45645, #57767, #26725), so it is a known
   trap, not an arxa mistake.
5. **Finish calls `git worktree remove`; Sweep calls `git worktree prune` before
   diffing. Never `rm -rf`.** Removing a worktree directory outside git leaves stale
   `.git/worktrees/<id>` admin state, blocks same-path re-add without `--force`, and
   keeps refs alive past gc. `t3ci/CI/05-retro-ci.sh` already uses
   `worktree add --detach` + `worktree remove --force` under a `trap` — match the
   house pattern.
6. **Revive shows the session branch's own last SHA,** not only drift. Claude Code's
   own `--worktree` reuse resets to the default branch rather than the old tip; the
   user must see what is about to be checked out.
7. **`actions/checkout` defaults to `clean: true` = `git clean -ffdx && git reset
   --hard HEAD`.** That is the same double-force that removes nested project repos.
   Harmless because the runner works in `_work/`, never a real org directory — but
   record it, because D110 keeps `projects/*` gitignored inside the org repo and
   anything that ever points a clean at an org root destroys unpushed project work.
8. **Verify before writing Phase 3:** bp-pr reports no branch-deletion code exists
   anywhere (the only `DELETE` is `auth.js:347`, token revocation), so Finish's
   delete step may be unimplemented rather than merely wrong.

### D114 — Collapse is step 1 of the merge action, and the guard is tree identity. REFINES D107.

D107 left "collapse at ready" unspecified against D18, which keeps auto-committing.
A post-collapse agent commit is *normal*, and both outcomes were bad: `main` gets a
collapsed commit **plus** a trailing checkpoint, or D109's `sha` check 409s forever.

**The branch keeps its checkpoints throughout.** Pushed, PR opened, CI running on
each one. The merge action then does, in order:

1. `reset --soft <merge-base>` + recommit with the human's subject and attribution body
2. **verify the collapsed commit's tree == the tree of the tip the human reviewed**
3. `merge_method: merge` (`--no-ff`)

**Why this costs no test coverage:** `reset --soft` changes no files, so the
collapsed commit's tree is byte-identical to the branch tip's. CI green on the last
checkpoint is therefore valid for the collapsed commit — collapsing late is free.

**Tree comparison supersedes the raw `sha` parameter from D109 and is strictly
stronger.** The `sha` check cannot survive a collapse (the head SHA legitimately
changes), but the *tree* does not change on collapse and *does* change if an agent
commit landed mid-review. So it refuses exactly the case D109 was protecting
against, and tolerates exactly the case D109 would have false-positived on. Keep
`sha` on the API call as the final race guard between step 2 and step 3.

Side benefit: the human reviews the real progression of the work rather than one
opaque commit, and there is no window in which a post-collapse commit can exist.

### Open, deliberately not decided in this grill

Raised in review, not blocking Phase 0, but must be settled before the phase named.

1. **D110 × D95 write amplification** (before Phase 1). "last-known commit, refreshed
   on project commits" + push-always means every project checkpoint triggers an org
   commit *and* an org push. Options: refresh on project *merge* only, or derive the
   SHA live and keep it out of the tracked file. The manifest's *existence* is
   settled; its refresh cadence is not.
2. **`merge-tree` exit codes** (before Phase 3). D108's test treated any non-zero as
   CONFLICT. It exits 1 on conflict but **128 on error** (bad ref, unrelated
   histories). For a signal that gates revive, "couldn't determine" must render
   distinctly from "conflicts" — never as a false alarm.
3. **D111 red-main vs never-completed** (before Phase 4). The merge gate separates
   red / asleep / pending, but the new-session block does not. A run cancelled at the
   24 h queue limit would block new sessions for an infrastructure reason.
4. **`settingsPayload` flip ordering** (before Phase 2). D107 changes
   `allow_merge_commit`/`allow_squash_merge` on **existing** repos at the next
   frame-apply, including any with open PRs. Decide whether the flip is gated on
   having no open PRs.
5. **D113 needs a positive test case** (before Phase 2). There is currently no
   `pubspec.yaml` anywhere under any project, so "real Dart target vs empty scaffold"
   would be written against an empty set — while being the discriminator the entire
   gate now rests on. Scaffold one real Dart target into `05-scaffold/application/`
   first, so the walk has a true case and not only ten empty ones.
6. **Carried from §7, still unsettled:** the org/project primary seat has no branch
   so no PR (direct-to-main or an ephemeral branch?), and sessions in an unpublished
   repo such as `TESTO/projects/Fads` (refuse, local-merge fallback, or prompt to
   publish?).

---

## §10 — D113 unblocked: the gate fixture exists, and it found a second bug

**Status:** D113's stated prerequisite ("no positive Dart test case exists") is
**cleared**. Two fixtures now exist, one synthetic and one real.

### The real-app evidence (decisive)

A source-only copy of arxa's `kit/showcase_app` (482 files / 19 MB; `build/`,
`.dart_tool/`, `ios/Pods/` excluded) now sits at:

```
TOPO/projects/project-001/05-scaffold/application/ios/
```

Its 27 `path: ../<kit>` deps were rewritten **in the copy only** to absolute
paths into `arxa/kit/` (original kept as `pubspec.yaml.orig`). `dart pub get`
resolves all 27 — exit 0. **arxa's own tree is untouched: `git status
--porcelain -- kit/showcase_app` reports 0 modified files.**

With a genuine type error planted in `lib/`:

| | result |
|---|---|
| `dart analyze` in the target | **exit 3** — `invalid_assignment`, 1 issue |
| `sh ./check.sh` at project root | **exit 0 in 0.033 s** |

The gate does not analyze the app. It does not fail to analyze it — it never
reaches it. 0.033 s is the cost of not looking. **B11 is confirmed against real
arxa code, not just a scaffold.**

### B15 (new) — `[ -d test ]` ANDs away the analyzer

`frame.js:103`:

```sh
if [ -f pubspec.yaml ] && command -v dart >/dev/null 2>&1 && [ -d test ]; then
  dart pub get >/dev/null 2>&1 || fail "dart pub get"
  dart analyze || fail "dart analyze"
  dart test    || fail "dart test"
fi
```

A target with a `pubspec.yaml` but no `test/` directory is skipped **entirely** —
no `pub get`, no `analyze`. Analysis does not require tests. Every freshly
scaffolded target is in exactly this state, so the gate is green precisely when
a project is youngest and most likely to be broken.

Fix — split the condition:
- `pubspec.yaml` present → `pub get` + `analyze` (**always**)
- `test/` also present → `dart test`

This is independent of B11's depth bug and must be fixed with it; fixing depth
alone still leaves every test-less target unanalyzed.

### The fixture

`scripts/frame-gate-fixture.sh` — self-contained, no network beyond one
`test` dev-dep, builds a two-package Dart workspace and runs the **real**
generated `projectCheckSh()` in four states:

| state | want | today |
|---|---|---|
| S1 clean target | 0 | **0** ok |
| S2 broken Dart, `test/` present | 1 | **1** ok |
| S3 broken Dart, no `test/` | 1 | **0** ← B15 |
| S4 broken Dart nested under `<stage>/<track>/<target>/` | 1 | **0** ← B11 |

It exits non-zero until both bugs are fixed, so it is a regression test, not a
demo. Wire it into `plugins/git-workspace/selftest.mjs` as part of the fix.

### Two harness traps worth remembering

1. `check.sh` line 6 is `cd "$(dirname "$0")"` — it runs relative to **its own**
   location, not the caller's cwd. A test that invokes it from outside the
   fixture silently tests an empty directory and passes by absence. This
   produced a full round of false results before it was caught.
2. Copying a Dart package away from its `path:` siblings breaks dependency
   resolution, and the gate reports that as `FAIL: dart pub get` — a red that
   looks like a real finding but is a fixture defect. Keep siblings together.

### Verified environment facts

- `dart` on PATH is fvm's, **3.12.2 stable** (`macos_arm64`).
- Plain `dart pub get` **does** resolve `flutter: {sdk: flutter}` here, so the
  gate's use of `dart` rather than `flutter` is not a defect on this runner.
  It would break on a runner with a standalone Dart and no Flutter SDK.

### §10.1 — the fixture surfaced D110×D95 as an accident

Dropping a real target into `project-001` exposed a live gap, unrelated to the
gate:

- **`project-001` has no root `.gitignore` at all.** The org repo is safe — TOPO
  uses a `/*` allowlist (D37) and reports 0 entries — but the **project** repo is
  a separate `.git`, and there `git add -A` stages **447 files**.
- The only ignore rules in play arrived by luck: the copied Flutter app ships its
  own `.gitignore` (`.dart_tool/`, `build/`). A target scaffolded by studio would
  not necessarily bring one, and nothing at the project root supplies it.
- No secrets were among the 447 (the `key` matches are `asset_keys_test.dart`),
  but `pubspec.yaml` carries absolute `/Volumes/developer_ssd/...` paths that
  would become permanent history on the first auto-commit.

This is the open **D110 × D95 write-amplification** question arriving as an
accident rather than a decision. **A scaffolded project must ship a root
`.gitignore` before any auto-commit action is wired**, or D95's first sweep
commits build output and machine-local paths.

The copy is deliberately left untracked at
`TOPO/projects/project-001/05-scaffold/application/ios/` so the B11/B15 fix can
be verified against a real app. It is disposable test data. To revert its deps:
`sed -i '' -E 's#path: /Volumes/.*/arxa/kit/#path: ../#' pubspec.yaml`
(or restore the sibling `pubspec.yaml.orig`).

### §10.2 — decide before writing the B15 fix

Splitting `[ -d test ]` makes `dart analyze` run on targets where `pub get` has
never succeeded. Unresolved imports then produce a wall of analyzer errors — a
red for the wrong reason, which is how teams learn to ignore a gate. The S3
fixture has resolvable deps and will **not** catch this, so the chosen semantics
needs its own case (S5).

### §10.3 — B11/B15 fixed, and the fix found B16

`projectCheckSh()` now walks to every stack marker and probes inside that
target's own directory, pruning `node_modules`, `.dart_tool`, `build`, `Pods`,
`vendor`, `.symlinks`, `ephemeral`, `.git`, `.arxa` so a dependency is never
mistaken for a target. Analysis no longer sits behind `[ -d test ]`; only the
test run does. An unresolvable pubspec is a hard red (decided).

**B16 — `dart test` reds a healthy Flutter app.** The first run of the fixed
gate against the real target failed with `Could not find package test`. Flutter
targets carry `flutter_test` (an SDK dep), not `test`, and cannot be driven by
`dart` — `dart test` cannot load `dart:ui`. The gate now picks its runner per
target by grepping the pubspec for an `sdk: flutter` dep and uses `flutter
pub get` / `flutter analyze` / `flutter test` accordingly. Without this the gate
would have gone red on every Flutter target it newly reached — the exact failure
that teaches a team to ignore a gate.

### §10.4 — measured, on the real 106 MB arxa app

| | before | after |
|---|---|---|
| clean target | exit 0 in 0.033 s (never looked) | **exit 0 in 84 s, 169 Flutter tests pass** |
| broken target | **exit 0 in 0.033 s** | **exit 1 in 12 s** |

The red names the defect and the target:
`FAIL: flutter analyze (./05-scaffold/application/ios)` with file, line and rule.

0.033 s was the cost of not looking. 84 s is the cost of the gate meaning
something — worth pricing into the 15-minute CI timeout when several targets
land in one project.

`selftest.mjs` 48/48. Three new structural tests pin the walk, the ungated
analyze, and the per-target runner choice; the pre-existing "tool-presence
guards" assertion was updated (not weakened) because the dart guard is now
`command -v "$run"`. End-to-end coverage stays in `scripts/frame-gate-fixture.sh`.
