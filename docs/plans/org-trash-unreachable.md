# Trashing your last org made the trash unreachable

Date: 2026-09-08. Reported as "the repo just got deleted without moving to
trash and without following the flow arxa studio has" (Omarchy, org PROTONFEW).

## What the user saw vs what happened

The org was **not** hard deleted. It was parked correctly and completely:
`~/Documents/.arxa/trash/20260907T174015495Z-PROTONFEW/PROTONFEW`, 532K, with
the org repo and `projects/poutre`'s repo both intact.

What broke is everything after the move: the app showed no trash row, offered
no restore, and covered the screen with the welcome gate. From the outside that
is indistinguishable from "it deleted my work and skipped its own flow".

## Root cause (Bug A)

A four-step chain, each link reasonable alone:

1. `trashOrg()` ends with `removeRecent(orgPath)` — `lifecycle.js`.
2. `loadWorkspaceRoot()` answers the first valid **recent** — `workspace/lib/root.js:212`.
3. With the last org trashed the recents are empty, so it returns `null`, and
   `getLifecycle()` bails on exactly that — `arxa-sidebar/lib/index.js:560`.
4. Every face then degrades to the stub: `snapshot()` returned `emptySnap`,
   which has no `orgTrash` key at all, and `orgtrash.restore` answered
   `no-workspace`.

So the trash entry written one line before step 1 became unreachable through
the same call that wrote it. Measured live: `state` keys came back as
`seam,root,orgs,rows,tree,trashCount,archives,sessionTrash,selectedProject`
(exactly `emptySnap`) and `orgtrash.restore` → `{"ok":false,"error":"no-workspace"}`.

**It needs a restart, which is why it looked intermittent.** `getLifecycle()`
memoises (`if (lifecycle) return lifecycle`), so the process that trashed the
org keeps working: the cached lifecycle answers everything, trash included.
The seam only goes stub in a process that has to BUILD one with empty recents
— the next engine start, or an app relaunch. Measured both ways on the box
2026-09-08: `orgtrash.purge` succeeded at zero orgs through a warm cache, and
the same engine after a restart served `emptySnap` with no trash at all.

Consequence for the tests below: the in-process smoke exercises the verbs at
zero orgs but generally runs through the WARM cache, so it does not by itself
prove the stubbed branch. That branch is covered by the `S-rescue` source
checks and by the live box evidence (restart, zero recents, trash served).

On top of that, `WelcomeGate` is a full-screen overlay at `orgs.length === 0`
— so even a served trash row would have been behind it.

## Fix

Same class as the existing `preTable` verbs ("valid with ZERO orgs"):

1. `snapshot()` — the `!l` branch now returns `emptySnap` **plus** `orgTrash`,
   read from the global index at `<arxaHome>/org-trash.json`. That index is
   global and each entry carries its own `scope`, so it needs no workspace root
   and no open org.
2. `orgtrash.restore` is answered when there is no lifecycle, using the shell's
   already-exported `restoreFromTrash` / `touchRecent` / `arxaHome`. The restore
   re-adds the org as a recent, so the next state poll builds a real lifecycle
   and the app recovers on its own. Reached **only** when the lifecycle is
   absent — with one, the action table still routes to `l.restoreOrg`, which
   stays the single implementation for the normal case.
3. `WelcomeGate` lists trashed orgs with a Restore button, since it is the only
   thing on screen at zero orgs. `stopPropagation` on click and key: the card
   behind it creates an org.

No new module, no extraction. The duplication is a JSON read and one call,
pinned by tests rather than by a module boundary.

## Tests

- `plugins/arxa-sidebar/smoke.mjs` — drives the real thing end to end: trash
  every org, assert the state still lists the trash with no workspace root,
  restore through the action, assert the org is live again and the entry left
  the trash.
- `plugins/arxa-sidebar/selftest.mjs` `S-rescue` — pins the client half: the
  gate reads `orgTrash`, offers restore, and cannot also create an org.

## Bug B — the husk that blocks restore (NOT fixed, deliberately)

`~/Documents/PROTONFEW` was recreated at 04:02, twenty-two minutes after the
03:40 trash, holding only `.arxa/worktrees/PROTONFEW/projects` — empty
directories, no files. `restoreFromTrash` refuses when the destination exists
(`workspace/lib/trash.js:310`), so that husk blocks restoring this org.

Mechanism, not yet pinned: `trashOrg` calls `closeOrg()` but dsh sessions stay
live in `ctx.sessions` (no close/release on the session store — see
`linux-omarchy-port.md`). Nine live sessions had their cwd under
`<org>/.arxa/worktrees/…`; something in that layer recreated the leading
directories after the org folder moved away.

Deliberately **not** fixed by making restore delete "empty" directories:
restore is the recovery path, and a recovery path that deletes on a heuristic
is the next data-loss bug. The refusal already names the occupied path. The
real fix is upstream — trashing an org must stop the sessions that write into
it — and wants its own pass.

## Still open

- Pin the recreator and stop sessions on trash (Bug B).
- The trash row shows the folder name (`Admitted-Co`), the org row shows the
  display name (`Admitted Co`). Cosmetic, noticed while testing.
