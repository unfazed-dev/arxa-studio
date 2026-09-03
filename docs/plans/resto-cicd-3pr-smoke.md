# RESTO CI/CD — 3-PR live smoke (witness the whole flow, catch the bugs)

Date: 2026-09-03. Advisor consult: **skipped — over budget** (recorded via
`consult.sh gate decision --skip`). Designed from primary sources only.

## Why

The user wants to *see* the CI/CD part of the session-naming/CI-card plan run
end-to-end on their real org repo (`unfazed-dev/RESTO`, open in the desktop
app on engine port 7891), not on a throwaway. Three PRs, each exposing a
different stage, with a summary in every PR body and a comment per arxa stage,
so both of us can watch and pick up bugs.

## What exists today (verified 2026-09-03)

| Piece | Where | State |
|---|---|---|
| Card actions over HTTP | `POST /__arxa/git-card/action` (`plugins/arxa-git-card/lib/index.js:167`) | `card.status`, `card.commit.draft`, `card.commit`, `card.push`, `card.pr.create`, `card.pr.status`, `card.ci.rerun`, `card.ci.cancel`, `card.pr.merge`, `version.mint`, `card.runner.wake` |
| Stage boundary | `plugins/git-workspace/lib/sessions.js:461` `sessionStageBoundary` | squash → `check.sh` gate (red → `parked:'gate-red'`) → merge into **local** main (ff, else `--no-ff`; conflict → `parked:'merge-conflict'`) |
| PR body | `card.pr.create` | `problem` + `fix` + "— written by <model> in arxa studio" |
| Merge | `card.pr.merge` → `mergeSessionPr` (prflow) | refuses unless `prChecks` is `green` (D109 gate lives in the API layer) |
| Cleanup | `session.archive` → `archiveSessionBranch` + dsh archive | to be observed: worktree / local branch / remote branch / PR state |
| PR comments | — | **does not exist** (no `issues/*/comments` call anywhere) |
| CI | `RESTO/.github/workflows/ci.yml` → self-hosted runner `arxa-unfazed-dev-RESTO` (online, idle) | **0 runs ever** on RESTO |
| Push auth | `pushWithAuthRetry` + `gitCredentials(true)` refresh | `git push --dry-run` succeeds today; `org.json.githubStatus` still says `publish-failed: Invalid username or token` from 2026-08-30 → **stale status, bug candidate #1** |
| Local vs remote main | `fcd559e` local, `505f3aa` remote | local 1 ahead, never pushed → bug candidate #2 (does open-time `syncRepoNow` heal it?) |
| Session branches | 4 × `arxa/session/*`, all 0 ahead / 0 behind | no session has ever produced a commit on RESTO |

## The three PRs

| PR | Stage it exposes | Script |
|---|---|---|
| **PR 1 — happy path** | new session → real file change → `card.commit` (squash, gate green, local main merge, branch push) → `card.pr.create` (summary body) → CI run on the self-hosted runner → `card.pr.status` green → `card.pr.merge` → main advanced local+remote → `session.archive` cleanup | `scripts/resto-pr-smoke.mjs --pr 1` |
| **PR 2 — red gate, heal, rerun, rename** | session breaks `check.sh` in its worktree (invalid `org.json` copy) → `card.commit` parks `gate-red` (visible in the card) → fix → `card.commit` green → PR → `card.ci.rerun` once → merge. Session is renamed mid-flow (`session.rename`) so the header-title pin is witnessed on the shipped build | `--pr 2` |
| **PR 3 — conflict + close without merge + cleanup** | two sessions edit the same file; after the first merges, the second's boundary hits `merge-conflict` → parked → PR is closed **without** merge, session archived → assert: remote branch gone, PR closed, worktree removed, main untouched | `--pr 3` |

Each stage posts a PR comment `arxa · <stage>: <engine result>` — the body is
the engine's own JSON result for that stage (commit/gate/push, ci, merge,
cleanup), so the comment trail *is* the evidence.

## Work items

1. **Stage comments (new, small).** `prCommentApi` in
   `plugins/github-link/lib/frame.js` (`POST /repos/{o}/{r}/issues/{n}/comments`),
   `prComment` face in `plugins/github-link/lib/index.js`, wrapper in
   `plugins/file-org-shell/lib/github-bridge.js`, `card.pr.comment` action
   in `arxa-git-card`. Selftests: face presence + action key pinned.
2. **Smoke script** `scripts/resto-pr-smoke.mjs` — drives 7891 (env
   `ARXA_BASE`), one `--pr N` at a time, prints `::stage:: result` lines, exits
   non-zero on the first broken contract. Reuses the `org-link-smoke.mjs`
   `post/state` helpers.
3. **Pre-flight** (before PR 1): open RESTO through the engine → does
   `githubStatus` heal and remote main catch up? `card.status` for the org
   seat. Runner online. `gh run list` = 0.
4. **Ship** the comment action + the pending retitle edits into the desktop
   app: `node scripts/pack-sidecar.mjs` → tauri build → user relaunches.
   (The desktop engine runs the packed copy under `~/.arxa/engine/…`, not the
   repo.)
5. Run PR 1 → PR 2 → PR 3, screenshot the app between stages via the lens
   against 7891, collect `gh pr view --comments` per PR.
6. Bug log below, fixed as found, each with its own commit.

## Bug log (filled as we go)

- B1 stale `githubStatus: publish-failed` in `RESTO/org.json` — open.
- B2 local main 1 ahead of origin (`fcd559e`) never pushed — open.
- B3 desktop engine (7891) page in a fresh headless Chrome has no
  `window.__ARXA_SIDEBAR__` after 20 s (s2 engine has it in <5 s) — open,
  may be timing; blocks lens-based witnessing until understood.
- B4 `s2` engine: after an engine restart, clicking a session row or calling
  `openCreated` never loads the conversation (`clientSessionIds` stays `{}`)
  — open. Same client path the desktop uses after a relaunch.
- B5 **"0 runs ever" root cause — FIXED (studio + RESTO).** RESTO's
  create-time whitelist `.gitignore` (`/*` + `!/…`) never un-ignored
  `check.sh` / `.github/`; `git add` refused them (exit 1), the
  `allowFail` runGit swallowed it, the frame commit was empty, and the
  manifest still said `frameWired: true`. GitHub had no workflow, so every
  smoke PR sat at `checks-none` — `card.pr.merge` correctly refused, and
  PRs #1–#3 are still OPEN (the gate held; nothing merged without CI).
  Fix: whitelist generator gains
  `!/check.sh` + `!/.github/`; `ensureFrameUnignored()` patches existing
  orgs; `wireFrameOnce` re-wires when the files are untracked, verifies
  with `git ls-files --error-unmatch`, and upgrades stale stamped files
  (RESTO's `ci.yml` was pre-Q7). RESTO patched by hand the same way.
  Details in `git-card-part-b-implementation.md` (S1 follow-up).

## Verification log

- 2026-09-03 `ab9d69b` on RESTO `main` — `chore(ci): wire the arxa frame`
  (`.gitignore` +2, `check.sh`, `.github/workflows/ci.yml`,
  `.github/pull_request_template.md`). **First workflow run ever:** event
  `push`, `completed` / `success`, runner `arxa-unfazed-dev-RESTO`
  (online, idle after). PR-level runs still unwitnessed — the next session
  PR is the first that will carry a real check.
