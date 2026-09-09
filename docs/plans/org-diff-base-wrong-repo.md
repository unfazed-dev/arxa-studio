# The diff that wasn't — `main-version` read the wrong repo

**Spec:** D84 (worktree-vs-main diffs), D117 (sidebar decorations).
**Sibling:** [`freestyle-git-decorations.md`](freestyle-git-decorations.md).

## The report

> "look at the image — there [are] definitely diffs but nothing[,] no badges at
> all in the sidebar"

The screenshot is the **Organisations** tab: org `WAW`, a session on
`projects/Tree`, and the viewer showing `main ↔ check.sh` with most of the file
red/green. The sidebar beside it shows no letters.

Both observations are real. Only one of them is the app behaving correctly, and
it is not the one that looks correct.

## Root cause

### The badges are right — that org has nothing to decorate

Measured, not argued. For the only session in `WAW`
(`WAW/projects/Tree/02-design/application/application-wt-260908-001`):

```
main^{tree}  bb845c501414
HEAD^{tree}  bb845c501414      <- identical
git status --porcelain         <- empty
decorate(worktree, {base:'main'})  ->  ok:true  files:0
```

Five `wip: auto-save (watcher)` commits sit between `main` and `HEAD`, and they
net to nothing — same tree. The org repo itself is equally clean. So the
decoration map is empty because the org **is** clean, and an empty map is the
honest render. The client half was alive the whole time: the viewer opened the
worktree copy of the file, which only happens when `arxaDeco.sessionId` is set,
which only happens after the decoration fetch resolves.

### The diff is wrong — the base came from a different repository

`createMainVersionRoute` (`artifact-viewer/lib/write-api.js`) ran

```js
execFileSync('git', ['show', branch + ':' + relPath], { cwd: rootReal })
```

where `rootReal` is **always the open org root**. But a session file's
`relPath` is *worktree*-relative — `openFile` strips the session prefix
(`workspace-region.snippet.txt`), so `projects/Tree/check.sh` arrives as
`check.sh`.

One org holds several repos that share filenames. `WAW/check.sh` is the org
gate; `WAW/projects/Tree/check.sh` is the project gate. They are different
files. Asking the org root for `main:check.sh` on behalf of a project session
served the **org's** file as the base:

| pane | frame | file |
|---|---|---|
| left (base, red) | `7716539eece0faf0` | `WAW/check.sh` — the org gate |
| right (current, green) | `f043fd57225996e9` | the session's `check.sh` — identical to its own `main` |

Every red and green line on that screen is an artifact of comparing two
unrelated files that happen to share a name. The read lane resolves the
worktree properly (`resolveWorktree`, worktree-scoped tokens); the base lane
never learned to.

## The fix

`write-api.js` — the owning repo comes from the **signed token**, never the
query string (the token already carries `worktreeId`; the client needs no
change and gains no new authority):

| `body.worktreeId` | base repo |
|---|---|
| absent — an org-root file | the org root, as before |
| resolves via `resolveWorktree` | that session's `repoPath` |
| present but unresolvable | `{branch: null, content: ''}` |

The third row matters: falling through to the org root is *how the bug
happened*, and a Freestyle `root:<id>` write id takes exactly that path.
Containment (`resolveInside`) now checks against the repo the `git show`
actually runs in — against the org root it was validating a path unrelated to
what got served.

### Two layers, not one — the server fix alone was inert

The route reads the worktree from the **signed token**, so the token has to
carry one. It did not. `toggleDiff` minted `{ relPath }` and nothing else, and
the token route then resolved that worktree-relative path against the org root
as well — handing back the org file's own `absPath`. The whole chain agreed on
the wrong file, which is why it looked consistent.

| Layer | Change |
|---|---|
| `client.js` `toggleDiff` | mints with `worktreeId: wtRef.current.sessionId` when the open file is a session file. |
| `index.js` token route | an optional `worktreeId` on a read token resolves the file through `resolveWorktreeFile` (in the worktree) instead of `resolveReadFile` (org root), and is recorded in the token. Callers that send none are untouched. |
| `write-api.js` main-version | the base `git show` runs in the repo the token names. |

`toggleDiff` returns early for Freestyle (`if (state.rootId) return`), so the
`root:<id>` branch is defence, not a live path.

`absPath` on a read token now answers with the worktree copy when the token
names one. Checked before changing it: the diff toggle is the only read-scope
caller that sends a `worktreeId` (every other worktree caller uses the separate
`wt-read`/`changes-read` scopes), and it ignores `absPath` — so the value
Monaco keys its model on is untouched.

## Verification

`plugins/artifact-viewer/selftest.mjs` — a project repo whose `seed.md`
differs from the org root's `seed.md`, a session opened on it, and a read token
naming that session. Confirmed to fail on the pre-fix code with the bug's exact
signature:

```
AssertionError: base comes from the repo that OWNS the file, not the org root
  actual:   'seed\n'          <- the org root's file
  expected: 'project seed\n'  <- the file the user is looking at
```

Plus: an unresolvable worktree returns an empty base rather than the org's
namesake, and org-root files (no `worktreeId`) still read from the org root.

The earlier tests all minted tokens without a `worktreeId`, so they exercised
only the one path that was already correct.

## The Organisations badges, finally observed rendering

Last round's doc left this open: *"Not re-verified: that the Organisations tab
renders its own badges live."* A clean org cannot discharge it — zero badges is
what a working implementation and a broken one both produce. So: a scratch org
(`LensOrg`, its own `ARXA_HOME`; the user's real orgs untouched), one session,
two files dirtied against `main`, real engine at 1440×900:

```json
{"decorated":[
  {"letter":"M","label":"Modified in this session","row":"check.sh"},
  {"letter":"M","label":"Modified in this session","row":".gitkeep"}]}
```

`check.sh` — the same row the report's screenshot shows — carries its `M`, the
row text is tinted, and the tooltip is the org wording ("in this session"), not
the Freestyle one. Screenshot:
[org/git-decorations.png](phase0b-snapshots/org/git-decorations.png).

Two harness notes, so the next run does not re-derive them:

- A workspace root inside OS app-data is refused (D36), so the scratch orgs
  live beside the scratchpad while `ARXA_HOME` stays in tmp.
- An org is open iff `<org>/.arxa/locks/<slug>.lock` exists **and** its pid is
  alive. A seeder that opens the org and stays running holds that lock, and the
  engine's `org.open` then correctly refuses. Seed the org, then let the engine
  open it. (Checked before filing: the refusal was a live lock held by the
  seeder, not stale-lock mishandling — no bug there.)
