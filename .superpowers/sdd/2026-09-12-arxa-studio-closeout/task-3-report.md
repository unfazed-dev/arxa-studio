# Task 3 report — Add an explicit repair path for repo-less projects

**Status:** DONE_WITH_CONCERNS (one minor, documented below; behavior complete)
**Commit:** `db6de5f` `feat: prepare imported projects for sessions` (9 files, +443/−6; `package-lock.json` dirt untouched and excluded)
**BASE:** 8f10a08, branch closeout-2026-09-12

## What was implemented

Closes the D115 gap ("Gap left open" in `docs/plans/git-card-sessions-worktree-rewire.md`): a hand-created project (valid `project.json`, no `.git`) refused sessions with the org-snapshot wording and nothing ever attached a repo — `initProjectRepo` ran only from `newProject`.

1. **Lifecycle** (`plugins/file-org-shell/lib/lifecycle.js`)
   - `prepareProjectRepo(projectSlug)` on the **open-org handle** (beside `trashProject`). Resolves ONLY a scanned project of the open org (`scanWorkspace` + `orgId` + slug; `unknown-project: <slug>` otherwise). Belt-and-braces confinement before mutation: reserved `.git`/`.arxa` basename refused, symlinked project refused (`lstatSync`), realpath containment inside the realpathed org refused on escape (`repo-repair-refused: …`). Existing repo → idempotent no-op `{ ok, repoPath, head, frame: null }` with zero commits. Repair path: inherit `localOnly` from the org manifest and annotate the project manifest **before** init (so it rides the same commit), `writeFrameFiles(path, 'project')` (missing-only; never clobbers a human edit — custom files report `kept`), then ONE `initProjectRepo` so existing contents + frame + annotation land in a single initial commit. Returns `{ ok: true, repoPath, head, frame }` (`frame` = the writeFrameFiles result).
   - `orgTree` project rows gain `hasRepo: isRepo(projectPath, env)` — the client's proactive "routed project has no repo" signal.

2. **Host action** (`plugins/arxa-sidebar/lib/index.js`)
   - `'project.repair-repo': { orgId, projectSlug }` — `ensureOpen(orgId)` then `cur.prepareProjectRepo(slug)`; loud `project-slug-required` / `unknown-project` refusals.

3. **UI** (`workspace-region.snippet.txt` + `scripts/gen-workspace.mjs`, `client.js` regenerated)
   - `ARXA_REPO_REPAIR_AFTER_ORGS()` rides the grouped tree tail (above Archives/Trash, splice 6z): renders the "Initialize Git repository" offer (dsh `Button` outline + `.aXa_repoRepair` CSS, tokens only) when **(a)** the selected row routes into a project with `hasRepo === false` (proactive arm), or **(b)** a session create was just refused with `initial-snapshot-pending` for a `projects/…` workspace (reactive arm — covers a repo with no HEAD too). Click → `orgStore.mutate("project.repair-repo")` → on success clears the armed retry and, if a create was refused, **retries the original `workspace.new-session` exactly once** (open → reveal → conversation focus, the row-+ chain); the retry's own failure only notices — never re-arms (no loop).
   - The row-+ create splice's silent `.catch(() => {})` is now `.catch((e) => ARXA_WS_CREATE_FAILED(e, orgId, workspace))` — the refusal rides the shared `arxa-sidebar-notice` event (D111 grammar) and arms the offer. `orgStore` exposes `emit` (documented, additive) so the armed offer re-renders immediately.
   - Locale: `newSession.repoNeeded` / `newSession.initRepo` in en/pl/fr (zh falls back per key, same as neighbours).
   - Ruling 2 held: no repo is ever attached on org open or session start — only this explicit action (plus `project.create`) attaches.

## TDD evidence

- **RED (lifecycle):** `node plugins/file-org-shell/selftest.mjs` →
  `AssertionError: repair: the tree face reports the hand-made project repo-less` (missing `hasRepo`; the `typeof prepareProjectRepo === 'function'` check fails next — the missing-interface class the brief's Step 2 names).
- **RED (action):** `node plugins/arxa-sidebar/selftest.actions.mjs` →
  `FAIL  R: repair answers ok with repoPath + head  {"ok":false,"error":"unknown-action","action":"project.repair-repo"}` (+3 more R failures).
- **RED (UI):** `node plugins/arxa-sidebar/selftest.mjs` → 4 repair-marker FAILs + `drift gate … byte drift` FAIL before regeneration.
- **GREEN:** after each minimal implementation step, the same commands pass: lifecycle selftest `228 checks passed` (18 new repair checks incl. branch `main`, exactly one commit, byte-identical user + customized frame files, localOnly inherited+committed, no-op, 3 refusals); actions selftest `ALL GREEN` (6 new); sidebar selftest `ALL GREEN` (4 new markers + drift gate byte-identical after `node scripts/gen-workspace.mjs --write`); smoke `ALL GREEN` (10 new).

## Smoke (Step 6 — the user flow, route harness)

Fresh scratch org → hand-made `projects/handmade` (project.json + user file, no repo) → tree face `hasRepo:false` → `workspace.new-session` refuses `initial-snapshot-pending` → `project.repair-repo` → HEAD landed, exactly ONE commit on `main`, `localOnly` inherited+committed → retried create succeeds with `branch === 'arxa/'+id` resolvable **from the project repo** and worktree under the org's `.arxa/worktrees/`; the user file rides the initial commit.

## Files changed

`plugins/file-org-shell/lib/lifecycle.js`, `plugins/file-org-shell/selftest.mjs`, `plugins/arxa-sidebar/lib/index.js`, `plugins/arxa-sidebar/lib/workspace-region.snippet.txt`, `plugins/arxa-sidebar/lib/client.js` (regenerated), `plugins/arxa-sidebar/selftest.actions.mjs`, `plugins/arxa-sidebar/selftest.mjs`, `plugins/arxa-sidebar/smoke.mjs`, `scripts/gen-workspace.mjs`.

## Self-review findings

- Pre-existing marker check "trash: rides the grouped tree tail…" pinned the old tail order; updated to the new order (intent — trash still rides the tail — unchanged).
- The unreachable-by-scan confinement checks (reserved name, symlink, realpath escape) are belt-and-braces per the binding constraint; the reachable refusals (missing/unknown, symlinked → never scanned) are tested.
- `npm test` (scripts/ci.mjs) — **ALL GREEN** on the committed tree.

## Concerns

1. **Minor:** the SHELL CTA door (gen-sidebar.mjs `startSession`) still shows only the text notice on refusal; the clickable offer relies on the proactive `hasRepo` arm. A project with an UNBORN repo (interrupted init: `hasRepo` true, no HEAD) refused via the shell door shows no offer. Fixing needs a gen-sidebar.mjs splice — outside this brief's file list, so recorded as a New finding in the ledger instead of done here.
2. Unborn-repo repair itself is deliberately out of scope ("an existing repo is a no-op" per brief Step 1); the no-op honestly reports `head: false`.
