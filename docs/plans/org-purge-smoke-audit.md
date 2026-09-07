# Org purge smoke test and audit (2026-09-07)

Request: delete the orgs RESTO, TOPO, TESTO completely — archives, trash,
GitHub — through arxa studio's own path, audit the path for bugs, leave
everything (disk, registries, GitHub, repos) in sync.

## Path exercised

`POST /__arxa/sidebar/action` → `org.trash` → `orgtrash.purge` (the only
org-destructive verbs; `plugins/arxa-sidebar/lib/index.js`, handlers in
`plugins/file-org-shell/lib/lifecycle.js` `trashOrg` / `purgeOrgTrash`).
Driven by `scratchpad/org-purge-smoke.mjs` with the engine's session cookie;
the client typed-name gate of the purge modal is covered by
`plugins/arxa-sidebar/selftest.*.mjs`, not by this run.

## Result per org

| org | trash | purge | GitHub repos deleted | runners removed | sessions swept |
|---|---|---|---|---|---|
| RESTO | 7 ms (current org, heal awaited) | 6.9 s | unfazed-dev/RESTO, unfazed-dev/kitchen-project | 2 (LaunchAgent + dir) | 15 |
| TOPO | **15.0 s** (bug 3) | 5.5 s | unfazed-dev/TOPO, unfazed-dev/project-001 | 2 | 0 |
| TESTO | **15.0 s** (bug 3) | 6.2 s | unfazed-dev/TESTO — created BY the trash step (bug 3), then deleted | 1 (created by bug 3) | 14 |

End state verified: all five repos 404; no `actions.runner.unfazed-dev-{RESTO,TOPO,kitchen-project,TESTO}` plists or `~/.arxa/runners/` dirs; org folders gone; `/Volumes/business_ssd/.arxa/trash` empty; `~/.arxa/org-trash.json` `[]`; 29 dsh session dirs removed, 27 kept (other roots).

## Bugs found and fixed

1. **Purge never tore down self-hosted runners** — the LaunchAgent and
   `~/.arxa/runners/<owner>__<name>` survived every org purge, listening
   for a deleted repo. Fix: `removeRunner` (`plugins/github-link/lib/runner.js`:
   `svc.sh stop/uninstall`, bootout-by-label fallback, dir removal), exposed
   through the bridge, called per deleted repo in `purgeOrgTrash`, reported in
   the result as `runners`. Selftest in `plugins/github-link/selftest.mjs`.
2. **Purge never removed the org's dsh session logs** — the source of the
   "30 orphan sessions" seen in the startup work. Fix:
   `plugins/arxa-sidebar/lib/session-sweep.js` walks dsh's persistence with
   its own helpers and removes session dirs whose header `cwd` is under the
   purged org path (prefix-safe, unreadable header = kept). Wired into the
   `orgtrash.purge` action; result carries `sessions`. Selftest
   `selftest.session-sweep.mjs`.
3. **`trashOrg` read the org folder instead of `org.json`** —
   `readManifest(resolved)` threw EISDIR for every non-current org, so trash
   treated it as bare, PUBLISHED it (repo + runner) and waited out the 15 s
   grace. A local-only org gained a private GitHub repo on its way to the
   trash. Fix: `readManifest(orgManifestPath(resolved))`; regression test
   "a localOnly org is never published on its way to the trash".
4. **Boot prewarm served a stale snapshot** (this session's own regression,
   caught by `selftest.actions.mjs`): the snapshot taken while an action was
   in flight re-armed after the action had nulled it. Fix: mutation counter +
   in-flight counter; the prewarm lands and is served only when no action ran
   or is running.

## Left as found (not bugs, or not in scope)

- `~/.arxa/organisation.json` `names` ledger keeps `resto`/`testo` — append-only by design (`root.js`). Two dead `orgs` recents (`/tmp/arxa-s2/ws/LensCo`, `/Volumes/business_ssd`) were dropped; the second looked like a create-root mistake.
- dsh session dirs under other dead roots remain (`/tmp/arxa-s2`, `/tmp/arxa-d90-smoke`, `/private/tmp/arxa-jobs-uiproof`): not these orgs.
- `orgTrashEntryRepos` skips a project whose `project.json` lacks `repoUrl` (repo would be orphaned on GitHub) — documented, unchanged.
- `listOrgs` silently skips dead recents — unchanged.

## Sync

studio and arxa repos pushed to GitHub after this round; engine payload
synced and restarted (Engine → Restart Engine).

## Follow-up (same day): "fix all the things you found"

| item | fix | commit |
|---|---|---|
| purge left a project's repo alive when `project.json` had no `repoUrl` | `orgTrashEntryRepos` falls back to the folder's own `git remote origin` (GitHub URL parsed; localOnly still skipped); regression test strips Inner's manifest and expects `octocat/Inner` deleted | `6e34aec` |
| create modal offered a vanished sticky root (`/tmp/arxa-smoke/root`) | `create.defaults` ignores a root that no longer exists; `create-root.json` on this machine reset to `/Volumes/business_ssd` | `6e34aec` |
| `create.defaults` and the new sweep answered `no-workspace` with zero orgs | both lifted above the lifecycle gate (persistence-only verbs) | `44e00f6` |
| dsh session logs under dead test roots (`/tmp/...`) | `sessions.sweep-dead-tmp` action: removes sessions whose cwd is under the OS temp dir and gone; a missing cwd anywhere else is only reported (`stranded`) — an unmounted drive looks exactly like a deletion. Ran once: 6 removed, 0 stranded | `6e34aec` |
| **page resurrects a purged org**: dsh's session controller `mkdir -p`s a session cwd on open, and dsh's workspace store still held 24 records under the purged orgs, so the page rebuilt `/Volumes/business_ssd/RESTO/.arxa/worktrees/...` (empty) and a new session at every boot | purge now also deletes workspace records under the org through `workspaceRegistry.delete`, and a purged-org ledger (`~/.arxa/purged-orgs.json`) re-sweeps sessions + workspace records at every boot while the path stays gone, removing an all-empty skeleton as still-dead. Verified: after one boot 15 rows swept, no folder, no session, store 27 → 3 records (all live) | `44e00f6`, `6be2e9a` |
| dead org recents (`/tmp/arxa-s2/ws/LensCo`, `/Volumes/business_ssd` pre-D69 migration leftover) | dropped from `organisation.json` (recents are advisory) | — |

Left alone on purpose: the `names` ledger keeps purged names — its claim check already skips paths that no longer exist, so a purged name is reusable; `listOrgs` skipping a dead recents row stays silent because an org on an unmounted drive must not be forgotten.
