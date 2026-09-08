# Local-only git parity + VS Code-style sidebar decorations

Grilled 2026-09-08. Seven decisions, all confirmed by the operator. Nothing in
here is implemented yet — this is the agreed shape plus the test matrix.

The thesis being implemented: **a local-only org does the whole git lifecycle —
worktrees, gate, merge to main, cleanup — and the only thing it lacks is
GitHub.** Everything below either makes that true or makes it legible.

---

## 0. The bug that started this

The operator reported "the application wt session has the main branch". The
worktree was never wrong. On disk:

```
git -C projects/Tree worktree list
  .../projects/Tree                                    9894b39 [main]
  .../.arxa/worktrees/.../application-wt-260908-001    9894b39 [arxa/WAW/.../application-wt-260908-001]
```

Own directory, own branch. Textbook.

**Root cause — the card binds to the wrong seat and says nothing.**

`card.status` resolves a session with
`gw.parkedSessions(cur.path).find((s) => s.id === sid || s.dshSessionId === sid)`
(`plugins/arxa-git-card/lib/index.js:513`). The shell injects the dsh
conversation id (`arxa-<id>`) as `sid`. That session's registry row:

```json
{ "dshSessionId": null, "dshStatus": "dsh-unavailable" }
```

It was created while the conversation backend was down, so it has no dsh id.
Both match arms fail, the backend throws `session-not-found`, and the client
catches it (`git-card.snippet.txt:323`), silently refetches as the **org seat**,
and renders `status.seat.branch || 'main'` (`snippet:375`) — printing a branch
name that is not yours, with every session affordance missing.

A comment dated 2026-09-02 in that same function warns about this exact silent
fallback. It was fixed for project sessions; the null-`dshSessionId` case still
lands there.

### Decision 1 — such a session is legitimate

Local git management must not depend on the conversation backend being up.
Refusing creation on a transient dsh outage would lose real work, and it would
make dsh a hard dependency of local-only git, against this repo's local-only
rule.

- Bind on the **stable arxa session id** (the workspace path, which the sidebar
  row already holds); keep `dshSessionId` as a secondary match.
- A session whose conversation is missing must **say so**. Silence is the defect.

**Mechanism, re-traced 2026-09-08 (supersedes the first trace below it).**
Three claims in the first draft of this decision were wrong. They are corrected
here rather than deleted, because each one is a plausible wrong turn a later
session would take again.

*Wrong claim 1 — "the heal seam is not reached from every open path."*
It is reached. `lifecycle.js:1405 resumeSession` ends with
`else if (out?.worktree) { const spawned = await dshBridge.spawn(...); if
(spawned.ok) await annotateSession(..., { dshSessionId: spawned.id }) }`, and all
four open paths route through `session.open` → `resumeSession`. Nothing needs
backfilling. The WAW row has `dshSessionId: null` because `dshStatus` records the
truthful reason: **`dsh-unavailable`**. `createDshBridge({})`
(`dsh-bridge.js:29`) returns `{ ok: false, reason: 'dsh-unavailable' }` for every
face when no dsh services are injected — which is exactly the case in a headless
smoke run. The refusal is correct and there is nothing to heal.

*Wrong claim 2 — "remove the silent org fallback at `git-card.snippet.txt:323`."*
Removing it would be a regression. The dock is injected at
`conversation.input.dock` (`gen-git-card.mjs:118`), so it mounts on **every**
conversation, including ordinary ones that are not sessions at all. For those,
`session-not-found` → org seat is the *correct* answer. The fallback is only
wrong for a session conversation whose link is broken, and the host cannot
distinguish those two without something like the conversation's cwd. Before
building any such discriminator, first establish that the broken-link case is
reachable at all (spawn succeeds but the annotate fails, or a registry rewrite
drops the field). If it is not reachable, there is nothing to fix here.

*Wrong claim 3 — "regenerate through `gen-git-card.mjs`."* Wrong client. The
change is in `workspace-region.snippet.txt`, so the **sidebar** client is the one
that regenerates, via `gen-sidebar.mjs` / `gen-workspace.mjs`.

**What actually produced the screenshot.** The Tree registry holds exactly one
session row, so no other *session's* conversation could have been mounted. The
sequence is:

1. The operator selects `application-wt-260908-001`. `mutate` sets
   `currentSessionId` optimistically (`workspace-region.snippet.txt:257-261`) and
   the row highlights.
2. `session.open` → `resumeSession` succeeds — the git side revives correctly.
3. `arxaOpenConversation` (`:565`) reads the row, finds `dshSessionId` null, and
   hits **`if (!dshId) return;` (`:571`) — a silent bail**. No conversation opens.
4. The content pane keeps whatever conversation was already mounted. That
   conversation has no arxa session, so its card resolves the org seat and prints
   `main · clean` — **accurately, for the conversation it is actually scoped to.**

So the card was right and the sidebar was wrong: a row was marked current while
nothing opened and nothing was said. This is the same class of defect
`ARXA_WS_NEW_REFUSED` (`:1263`) was added for on 2026-09-08 — "the click created
nothing, raised nothing and said nothing … A silent no-op is the dead button D4
set out to prevent, just quieter."

**The fix, scoped honestly:**
1. `arxa-sidebar/lib/index.js:653` — serve `dshStatus` next to `dshSessionId`.
   The client can currently see *that* a conversation is missing but not *why*.
2. `workspace-region.snippet.txt:571` — `arxaOpenConversation` records the miss
   instead of returning silently. One chokepoint covers all four call sites
   (boot `:184-185`, `openCreated:423`, and the two row-click injections at
   `gen-workspace.mjs:347` and `:355`).
3. The session row names the missing conversation, following the
   `ARXA_WS_NEW_REFUSED` precedent.
4. Regenerate the sidebar client (`gen-sidebar.mjs` / `gen-workspace.mjs`).

**What this fix does NOT resolve.** The operator's actual misread was of the
*card pane*, and a mark on the sidebar row does not touch that pane. After this
change the row states its conversation is missing; the stale pane beside it
remains a known gap. Do not record Decision 1 as closing the misread.

The mark's render path is proven only by string assertions on the generated
client — **no one has seen the dot appear on a real dsh-less row.** It needs a
lens pass against WAW before it counts as verified. That gap is not theoretical:
`sessionNode` (`client.js:814`) rebuilds every row as a fresh object literal, so
the first cut of this fix silently stripped both new fields, and every string
assertion still passed. `gen-workspace.mjs` now carries them through and the
guard is strict `=== null` (an explicit null means "served and absent";
`undefined` means the field never arrived and falls through to the normal dot).

**Verification must assert the negative.** A test that checks bind-by-arxa-id and
bind-by-`dshSessionId` passes today and would have passed before the bug. The
discriminating assertion is: with a row whose `dshSessionId` is null and a
`createDshBridge({})` stub, selecting it must leave the tree in a state where the
missing conversation is **named**. Write that test first — if it cannot reach the
`if (!dshId) return` bail, this whole mechanism is wrong.

**Separate item, found while tracing, not part of this fix.** `mutate`
(`workspace-region.snippet.txt:256-271`) sets `currentSessionId` optimistically
before the host call and never reverts it on the `.catch()` path — a failed
`session.open` leaves the row highlighted.



### Decisions 2 + 4 — landed 2026-09-08 (Finish half; Sweep still open)

**Commit now says what it does.** `git.commit` was the bare word "Commit" in all
three dictionaries while `sessionStageBoundary` squashed the WIP run, ran
`check.sh` and merged into main behind it. Relabelled "Commit & land on main".

**Finish is reachable.** New `card.finish` route + a button on the Commit row —
same journey's end: Commit lands the work, Finish clears what is left. It calls
`finishSession`, which already refuses unless the branch is merged AND the
worktree is clean.

- The enabled state is **`finishSession`'s own `dryRun`**, not a second opinion
  computed beside it. A separately derived gate can drift from what the action
  does; this one cannot, and `dryRun`'s `reason` gives the disabled button honest
  copy (`not merged into main yet` / `uncommitted changes in the worktree`)
  instead of going mute. Costs ~2 extra spawns on the 30 s status poll.
- **D40 holds twice.** A parked session gets no Finish button at all
  (`status.finish` is null, so it is absent rather than dark) *and* the route
  refuses `parked-never-deleted`, so a stale card cannot post past the missing
  button.
- Confirm key is `finishSession`, not `finish` — `git.confirm.finish.*` was
  already "Finish integrating". The visible labels stay distinct.

**Two backend bugs found in code that had never had a caller.**

1. `finishSession` looked up its session with a bare `listSessions(repoPath)`
   while `sessionStageBoundary:574` routes through `sessionRepoFor` — so under
   D98/D99 a project session finished from the org path threw `unknown-session`.
   Same preamble added. Two functions in one module sharing a `(repoPath, id)`
   signature while disagreeing on whether they route is a trap for the next
   caller.
2. `sweepMerged` had **no parked guard**. Decision 4 says parked sessions are
   never swept, and that held only by accident: a red gate parks *and* leaves the
   branch unmerged, so the merged filter happened to cover it. A session parked
   after a green land would have had its branch deleted. Explicit guard added,
   plus the test case the guard exists for (parked **and** merged) — the existing
   test used a session that was both parked and unmerged, which is exactly why
   the gap went unnoticed.

**Sweep landed on the sidebar, not the card** (2026-09-08). A batch cleanup on a
seat-scoped card is the wrong surface, so it went to the org and project row
menus (D80 gives both a menu) as `OrgSweepModal`, the seventh in that family.

- **One repo per row, deliberately not a cascade.** An org-row Sweep touches the
  ORG repo only; a project's sessions are swept from the project row. This is the
  opposite of D97's Sync, which sweeps the org *and* every project beneath it —
  and the menu copy says which, so "Sweep" on an org row is never read as "sweep
  everything".
- **The preview is a ceiling, not a suggestion.** Opening the dialog runs
  `dryRun` and lists what would go; confirming posts those **ids back** as
  `only`, and `sweepMerged` acts on nothing outside the list. This closes a race
  nobody had noticed: between the preview and the click, the WIP watcher
  (`lifecycle.js:986`, ~1.5 s) can auto-commit a *refused* worktree clean and
  silently promote a session the operator was never shown. Re-previewing at
  confirm time does not fix that — it just moves the race.
- Uses `ORG_POST` + a manual refresh, not `orgStore.mutate`, for the same reason
  D97's Sync does: `mutate` throws the result away, and the per-session refusal
  reasons *are* the deliverable.

**A third bug in `sweepMerged`, found by writing the dialog.** Its `dryRun`
branch checked only "is the branch merged" and pushed `wouldFinish: true` — it
never asked `finishSession`, so it skipped the *other* refusal (`worktree-dirty`).
A preview for a destructive batch could therefore promise a session the act would
then refuse. The dry branch now calls `finishSession(dryRun: true)`, so the
preview and the act share one refusal path. Three cases added
(`selftest.finish.mjs`, now 11): the dirty-worktree preview, the `only` ceiling,
and a mid-batch refusal leaving earlier successes recorded.

**Also added:** the sidebar had no icon gate. The card has had one since two
invented glyph names shipped and rendered as something else in silence; D113 put
a new name on the sidebar's menus, so the same gate now guards its 18 icons.

**Unverified the same way Decision 1 is:** no one has clicked Finish in a running
app. The gating is proven by `selftest.finish.mjs` (8 cases) and by string
assertions on the generated card; the button appearing, darkening with its reason
and asking before acting all still need a lens pass.

---

## 1. What local-only already does (verified, not assumed)

| Step | Backend | Reachable today |
|---|---|---|
| worktree + own branch | `openSession` | yes — sidebar `+` |
| WIP commit | `card.commit.draft` | yes |
| squash → gate `check.sh` → merge to main | `card.commit` → `sessionStageBoundary` | yes, **unlabelled** |
| catch up main → session | `card.integrate` | yes, when `behind > 0` |
| ahead of main | `wipRun` | yes (`snippet:389`) |
| behind main | `status.integrate.behind` | yes (`snippet:641`) |
| remove worktree + delete branch | `finishSession` | **no route** |
| batch cleanup of merged | `sweepMerged` | **no route** |

`sessionStageBoundary` (`plugins/git-workspace/lib/sessions.js:574`) squashes the
WIP run on the branch, runs `runGate` (which executes `check.sh` when present),
then `merge --ff-only` into main falling back to `--no-ff`, and parks the branch
on red. **Commit is already the land button offline.** Nothing says so.

After a green merge the session stays **open** — the stage base ref advances to
the new main tip and the session continues. A session hits that boundary many
times.

`finishSession` and `sweepMerged` are fully implemented and correct — refuse if
not merged, refuse if the worktree is dirty, then `worktree remove` +
`git branch -d` + prune — and are called by nothing but `selftest.finish.mjs`.

**Correction to an earlier claim in this session:** local-only is *not* missing a
distance readout. `status.aheadBehind` is origin-only and correctly goes quiet
offline, but `wipRun` and `integrate.behind` cover both directions. No work
needed.

---

## 2. Decisions

### Decision 2 — Commit stays atomic; fix the words, add the missing end

Commit keeps doing squash + gate + merge in one press.

Rationale: the atomic form holds an invariant already paid for — main never sees
code that failed the gate. `scripts/e2e-org-seat-gate.mjs` exists precisely
because the org seat once squashed onto main *before* gating and "announced a
failure it had not prevented". Splitting into Commit-then-Land reopens that
window. The symmetry with the GitHub path would be cosmetic: there, the split is
forced by a network round-trip, not chosen.

Work:
- Relabel the Commit action in local-only mode so it states that it merges to
  main.
- Add the reachable Finish (Decision 4).

### Decision 3 — surface the gate as a first-class Checks row

`check.sh` is already the local CI. Its own header says *"Local green = CI green
(the ci.yml runs this exact script)"*, and `frame.js:274` confirms a local-only
org deliberately gets no `ci.yml` — the script is the whole gate offline.

Today `card.commit` returns `{ gate: { green, kind, configured, output } }` and
the client discards all of it. The string "gate" appears in the card UI only
inside a comment. A red gate parks your branch and you are told *that* it parked,
never *why*.

Work:
- A Checks row in the slot the Actions section occupies when linked: last result
  (green/red), `kind` (`check.sh` vs `light`), and `gate.output` on red.
- A **Run checks** button that calls `runGate(worktree)` without committing —
  already exported, pure, needs no GitHub.

Be deliberate: the local Checks row and the remote Actions row are different
objects — one a synchronous local script, the other a remote run with an id,
history and cancellation. They share a slot, not a shape.

### Decision 4 — explicit Finish, plus a Sweep

The worktree guides ([GitWorktree.org](https://www.gitworktree.org/guides/best-practices),
[crystl.dev](https://crystl.dev/blog/git-worktree-workflow/)) say remove the
worktree at merge time and let `git branch -d` prove the merge happened. That
advice assumes **one worktree = one task**. Here a session survives its own merge
and keeps working, so literal application would delete the directory in use.

- **Finish** action on the session: enabled only when the branch is merged and
  the worktree is clean; disabled with the reason otherwise. Wire `finishSession`.
- **Sweep**: expose `sweepMerged` as "review and clean up merged sessions",
  using its existing `dryRun` to preview first. This is what actually addresses
  accumulation — sessions abandoned in a merged state, not the one you are in.
- Both delete directories, so both need the confirm dialog already flagged in the
  earlier grill about important git actions. The dry-run preview is what makes
  Sweep safe to offer.
- Parked (gate-red) sessions are never swept. D40 stands: nothing is deleted on
  red.

### Decision 5 — one parity table, two harnesses

The linked path is already covered by four hand-run smokes, including
`card-cicd-smoke.mjs`, which drives a real PR, Actions run, merge and cleanup
**through the card's own route**. The gap is not coverage, it is drift: nothing
enforces that the two modes stay the same shape.

- Write the flow **once** as a shared table of steps and assertions.
- Run it twice: local-only offline (in `ci.mjs`) and GitHub-linked (hand-run).
- Keep a small **linked-only tail** for the things that genuinely only exist
  there — PR number, run id, cancellation.

This is the test that would have caught the Decision 1 bug, which reproduces
only in local-only mode.

### Decision 6 — decorations are measured against main, not HEAD

`write-api.js:207` fires `wipCommit(worktreePath, 'editor save <path>')` after
every debounced Monaco save (~1.5s), and `wipCommit` runs `git add -A` then
commits (`commits.js:66-68`). **Untracked and modified files both become
committed within about a second and a half.** Inside a session worktree
`git status --porcelain` is empty essentially always.

So a VS Code-literal decoration layer measured against HEAD would render blank
almost 100% of the time. That is not a bug in auto-commit — it is D18 working —
but it means "modified" has to mean something else here.

**Baseline: session vs main.** A file is decorated when it differs from `main` —
"work done in this session that has not landed". It survives auto-commit, and it
falls out of code that already exists: `wt-api.js:45-58` already unions
`git diff --name-only main...HEAD` with `status --porcelain`, then strips the
status code. Switching that first call to **`--name-status`** yields `M`/`A`/`D`/
`R`/`T` directly — the same letter vocabulary VS Code uses. Keep the
`status --porcelain` half for the sub-second window before auto-commit fires.

On **project-tree** rows outside any session, "vs main" is vacuous — those files
*are* main. Those fall back to plain working-tree status, which is rare but real
(`lifecycle.js:986` auto-commits the org too).

### Decision 7 — the selected session decorates the tree

`ArxaDirRows` (`workspace-region.snippet.txt:1806`) takes an **org-relative**
`dir` with modes `"full"` and `"files-only"`; the tree route is org-rooted. There
is no worktree mode. **The sidebar only ever shows main's checkout** — a
session's worktree files are not in the tree at all, and the `application-wt-…`
row is a stock conversation row, not a file mount.

When a session is selected, its `diff --name-status main...HEAD` paths decorate
the existing rows at the same org-relative path, and clicking a decorated row
opens **that session's** copy. With no session selected, rows show plain
project-tree status.

Why this and not the alternatives:

- It deletes the hardest sub-problem. The plumbing survey found no path→worktree
  reverse index anywhere, and every existing resolver runs id→worktree. This
  decision never needs the reverse direction — only worktree→paths, which runs
  forward from the selected session and is already half-written in `wt-api.js`.
- It keeps badge and content in agreement. Decorating project-tree rows with a
  cross-session union would badge a row whose click opens main's read-only copy.
  Under this decision the row opens the file the badge describes, which is also
  the only file that can be edited — `write-api` writes worktrees, `org-server`
  is GET-only.
- A cross-session union is unactionable anyway: one badge for a file changed
  differently in two sessions says nothing.

**The cost to watch:** the tree's meaning becomes selection-dependent — the same
path shows different bytes depending on the active session. That is the same
class of confusion that produced the `main · clean` bug. It must be signposted at
the tree root, not left implicit.

**Verified 2026-09-08 — the click-target half is one field, not new routing.**
`ArxaDirRows`'s `openFile` dispatches `arxa-av-open` with `{ relPath }` only
(`workspace-region.snippet.txt:1806` region, `openFile` at +45). The
artifact-viewer ingress already accepts a `sessionId` on that event
(`artifact-viewer/lib/client.js:1838`), and when one is present the viewer mints
a `wt-read` token and reads from `/__arxa/artifacts/wt?session=…&path=…`
(`client.js:1531-1533`), editable side included. So pointing a decorated row at
the session's copy means passing `sessionId` on the existing event — every route
behind it already exists.

---

## 3. Decoration vocabulary and mechanics

Taken from VS Code's own source, not from summaries.

**Badges and theme colors** (`extensions/git/src/repository.ts`, `Resource`):

| State | Badge | Theme color |
|---|---|---|
| modified (working tree) | `M` | `gitDecoration.modifiedResourceForeground` |
| modified (staged) | `M` | `gitDecoration.stageModifiedResourceForeground` |
| added / intent-to-add | `A` | `gitDecoration.addedResourceForeground` |
| deleted (working tree) | `D` | `gitDecoration.deletedResourceForeground` |
| deleted (staged) | `D` | `gitDecoration.stageDeletedResourceForeground` |
| untracked | `U` | `gitDecoration.untrackedResourceForeground` |
| renamed / copied | `R` | `gitDecoration.renamedResourceForeground` |
| type changed | `T` | `gitDecoration.modifiedResourceForeground` |
| ignored | `I` | `gitDecoration.ignoredResourceForeground` |
| all conflict states | `!` | `gitDecoration.conflictingResourceForeground` |
| submodule | `S` | `gitDecoration.submoduleResourceForeground` |

Monaco here is `@codingame/monaco-vscode-*` 36.2.7 — actual VS Code services — so
these token ids likely already resolve in the active theme. Verify before
inventing new ones.

**Folder propagation** (core `decorationsService.ts`): everything bubbles except
deletions (`propagate = type !== DELETED && type !== INDEX_DELETED`). A folder
with no decoration of its own renders a **generic dot**, not the child's letter.
That maps onto the `countUnder` prefix-sum the sidebar already runs for session
counts — a prefix match over one path→state map, never per-folder git calls.

**Performance**: one `git status` per repo rebuilds the entire decoration map in
a single pass; refresh is watcher-driven and debounced 1s. This is not optional
here — `runGit` is `spawnSync`, one child process per call, with no status
caching, and `runGitAsync` exists specifically because sync calls "blocked the
host for ~10s" on org-open (`run.js:109-111`). One whole-repo call parsed into a
path→state Map is the only viable shape. `createWipWatcher` (`watch.js:67`)
already provides an `fs.watch` recursive debouncer at 3s; it currently only
drives auto-commit and never reaches the UI.

**Two things not to copy from VS Code:**
- Decorations are screen-reader-inaccessible — `tooltip` renders as a bare DOM
  `title` ([#189784](https://github.com/microsoft/vscode/issues/189784)). Add a
  real `aria-label`; colour and a single letter are not sufficient alone.
- `explorer.excludeGitIgnore` has open bugs with nested ignore files and negation
  patterns ([#189951](https://github.com/microsoft/vscode/issues/189951),
  [#151693](https://github.com/microsoft/vscode/issues/151693)). Dim ignored
  files; do not build hiding on a re-implementation of `.gitignore` parsing.

---

## 4. Test matrix

Both columns run the **same shared table** (Decision 5) wherever the step exists
in both modes. Existing suites are extended, not duplicated.

### Tier 1 — unit / selftest (offline, in `ci.mjs`)

| Suite | Add |
|---|---|
| `git-workspace/selftest.finish.mjs` | Finish reachable through a route, not just the library |
| `git-workspace/selftest.<new>.status-map.mjs` | `diff --name-status main...HEAD` ∪ `status --porcelain` → path→state map; every letter in the table above; rename and delete cases |
| `arxa-git-card/selftest.actions.mjs` | seat binds by arxa id; binds by `dshSessionId`; **fallback is visible, not silent**; gate surfaced with output on red |
| `arxa-sidebar/selftest.<new>.decorations.mjs` | prefix rollup — parent shows a dot when a descendant is decorated, deletions do not bubble |

### Tier 2 — integration (offline, in `ci.mjs`)

- Decoration route end to end: selected session → `--name-status` → org-relative
  path map → rows decorated, with the click target pointing at the worktree copy.
- Monaco save → `wipCommit` → decoration **survives** (the Decision 6 regression:
  a HEAD-based implementation would go blank here, and this test is what catches
  a regression back to it).
- Finish refuses on dirty worktree and on unmerged branch, through the route.

### Tier 3 — smoke, the shared table run twice

- `scripts/<new>.flow-table.mjs` — the single source of steps and assertions.
- `scripts/card-local-smoke.mjs` runs it offline. Already in `ci.mjs`.
- `scripts/card-cicd-smoke.mjs` runs it linked, hand-run, plus the linked-only
  tail (PR number, run id, cancellation).

### Tier 4 — pressure

- Extend the existing 30-session pressure block in `selftest.finish.mjs` to drive
  `sweepMerged` through its route, asserting exactly the merged ones are taken
  and parked ones are untouched.
- Decoration map with N sessions × M files: assert **one** `git status`
  invocation, not N. This is the test that keeps the `spawnSync` cost bounded.

### Tier 5 — stress

Extend `scripts/cicd-stress.mjs`, which already runs in `ci.mjs` with three
scenarios attacking three distinct failure modes. Add:

- **S4 — race for main.** Concurrent session commits landing simultaneously:
  `--ff-only` must degrade to `--no-ff` cleanly, conflicts must park with zero
  commits lost.
- **S5 — auto-commit storm.** Rapid Monaco saves while decorations refresh;
  assert the debounce coalesces and no decoration read observes a half-written
  index.

### Tier 6 — E2E on the live app (arxa lens)

- Extend `arxa/tool/lens_studio_smoke.dart`: the card renders the **session
  branch**, not `main`; Checks row present with a result; Finish disabled with a
  reason on an unmerged session; decorated rows carry badge and `aria-label`.
- Linked variant hand-run against a real connected org.

---

## 5. Open item — not part of this plan

The sidebar renders `Organisations` and directly beneath it `Tree`, which is a
**project** (`projects/Tree/project.json`); the only registered org is
`/Volumes/business_ssd/WAW`. `orgTree` (`file-org-shell/lib/lifecycle.js:2214`)
and the client's `buildEmit` always nest org → dock → project three levels deep,
and a grep found no hoisting or single-org special case anywhere.

So the code says a bold `WAW` row and a `Projects` dock row should sit above
`Tree`. Why they do not is **unresolved from source** and needs a live DOM read
of the running app. Recorded here so it is not lost; not fixed by any decision
above.

Also still open and untouched: **Bug B** — sessions writing into a trashed org,
`docs/plans/org-trash-unreachable.md`.
