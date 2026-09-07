# Project sessions bind to a track (application / website)

Date: 2026-09-08. Grilled with the user the same day. Supersedes the project
half of `sidebar-workspace-row-new-session.md` (2026-09-02), whose decision 4
put the "+" on the stage container itself.

## Problem

A project session was born at the stage container — `projects/poutre/03-architecture`.
Nothing tied it to the thing it was working on. A project's real subjects are
its **application** and its **website**; the stage is only which phase of work
it is. The user's rule: inside a project, a session must be bound to a track.

## The layout it binds to (facts, read from the code)

- `projects/<project>/<container>/<track>/<target>`;
  containers `00-moodboard 01-intake 02-design 03-architecture 04-diagrams
  05-scaffold 06-build 07-config 08-deploy notes`, tracks exactly
  `website` and `application` (`PROJECT_TRACKS_V4`).
- **Both tracks are scaffolded under every container of every project, in
  every template version** (`projectDirsV2/V3/V4`, `plugins/workspace/lib/template.js`).
  Only *targets* follow the creation-time selection. So track-level binding
  is available in every project that exists, with no migration and no
  scaffolding change.
- Chosen targets are recorded **nowhere but the filesystem** — no manifest
  field. Any rule that keys on "does this project have a website" costs a
  directory listing per sidebar row.
- `resolveSessionRepo` reads only `parts[0]` (`projects`) and `parts[1]`
  (the slug) — `plugins/git-workspace/lib/routing.js:128`. **Depth below that
  is irrelevant to git routing**; a deeper workspace lands in the same project
  repo with no change. Do not re-litigate this.
- Sessions attach to sidebar rows by **exact** workspace string
  (`leafIds`, `workspace-region.snippet.txt:458`) with no fallback row: a
  session whose workspace is not a pushed row does not render anywhere.

## Decisions (user, 2026-09-08)

| # | Question | Answer |
|---|----------|--------|
| 1 | Bind to the track or the target? | **Track** — `…/03-architecture/application`. Targets are optional and can be empty; a target-level rule would brick session creation in any project with no targets chosen. |
| 2 | Does the rule cover `projects/<p>/notes`? | **No** — `notes` is exempt and keeps taking a session at the container itself. It is the one container that is not a pipeline stage (D42, free-form). |
| 3 | Does the rule reach the org docks? | **No, project-scoped.** Docks have no tracks at all; a global rule would end session creation on `notes`, `meetings/*`, `account/*`, `communications/*`. |
| 4 | Existing stage-level sessions? | **None to keep** — the user deleted the org and starts fresh. No migration path is built (nine such sessions existed on the Omarchy box, all test sessions from that day; this Mac had zero). |
| 5 | Which track rows get the "+"? | **Both, always.** Both folders exist unconditionally, so no per-row disk probe and no rule for "project later adds a website". |
| 6 | Default session name under track binding? | **Unchanged** — `workspacePrefix` keeps taking the last segment, so `application-wt-260908-001`. The id already carries the full workspace path and its counter is per-workspace, so nothing collides. |
| 7 | Tracks under `notes`? | **Refused.** One session point per container: nine stages bind to a track, `notes` binds to itself. |

## The closed grammar

Creatable:

- `<dock>` and `<dock>/<subfolder>` — unchanged (`notes`, `notes/ideas`,
  `meetings/scheduler`, …).
- `projects/<slug>/notes`
- `projects/<slug>/<container>/<track>` for the nine numbered stages,
  `track ∈ {website, application}`.

Refused: `projects/<slug>/<stage>` (the change), `projects/<slug>/notes/<track>`,
anything below a track (`…/application/ios`), `projects/<slug>`, `projects`.

## Work

1. **Server — the only real gate.** `plugins/file-org-shell/lib/lifecycle.js`,
   the workspace-shape check in `newSession`. The project branch accepts an
   optional third segment and applies the grammar above. A stage container
   without a track is refused as `workspace-needs-track:` — a distinct code
   from `unknown-workspace:`, because the workspace is not unknown, it is
   incomplete. `POST /__arxa/sidebar/action` has no auth, so this check is
   what actually holds the rule; everything else is cosmetics.
2. **Sidebar row model.** `plugins/arxa-sidebar/lib/workspace-region.snippet.txt`:
   push `<stage>/website` and `<stage>/application` as workspace rows under
   each of the nine stages; the stage row stays (it must stay expandable) but
   stops being creatable. `canCreateSession` mirrors the server rule so no
   button exists that the server would reject (`sidebar-workspace-row-new-session.md`
   decision 4: never a dead button). Regenerate with
   `node scripts/gen-workspace.mjs --write` — the drift gate is byte-exact.
3. **No change** to git routing, to `mintSessionPath`, or to the scaffold.
4. Selftests: the new grammar in `plugins/file-org-shell/selftest.mjs`
   (accept/refuse pairs) and the row model in the sidebar selftest.

## Verification

- Selftests green in both plugins.
- Live on the Omarchy box: creating at `projects/<p>/<stage>` is refused with
  `workspace-needs-track`, creating at `…/<stage>/application` succeeds and the
  session renders under its track row. Deploy target is
  `~/.arxa/dsh/profiles/arxa/node_modules/arxa-sidebar/`, **not** the payload's
  `plugins/` — see `linux-omarchy-port.md`, "the deploy trap".
