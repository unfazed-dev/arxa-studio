# Session naming, agent controls, and the CI/CD git card

Status: GRILLED 2026-09-03 (Q1–Q9 confirmed). Follows
`docs/plans/composer-resume-breadcrumb-sidebar-sync.md` (A/B/C landed, preset
corner shipped `b0d95f3`).

Delivery: **three stages** (Q9=A), run back-to-back without user check-ins
(user is away; explicitly authorised "do A without my input").

## Standing constraint for this run (self-imposed, autonomous session)

The user is away. Outward-facing irreversible actions against their real
GitHub account are **out of bounds** for this run:

- No pushes to `unfazed-dev/RESTO` (or any real org repo).
- No `FRAME_VERSION` rollout onto published repos.
- No cancel/re-run of real workflow runs.

Everything is implemented and smoke-tested against local fixtures
(`/tmp/arxa-smoke`, a throwaway git remote). The real-repo effects happen when
the user drives the UI on their return. This is recorded in the final report.

## Decisions (grilled 2026-09-03)

| # | Decision |
|---|----------|
| Q1 | Header title is the worktree id, pinned via `sessionTitle.rename()` — not generated from the first message. |
| Q2 | Session id template `<prefix>-wt-<YYMMDD>-<NNN>`: prefix from the workspace folder (de-pluralised, as `nextSessionName` already does), YYMMDD date, 3-digit counter scoped **per workspace per day**. Existing `s-*` sessions keep their ids — no migration. |
| Q3 | `name` defaults to the id, so the crumb shows **one** tail segment. A rename adds a second segment (`… / My research / note-wt-260903-001`); the worktree id stays pinned at the tail. Header + sidebar follow `name`. |
| Q4 | Jobs + subagent chips always present — muted placeholders at zero, stock chips take over at >0 — **and** a smoke flow that really spawns one of each. |
| Q5 | Cancel is live everywhere. Pause/Resume is live **only** on continuable subagents (interrupt ↔ prompt-to-continue); disabled-with-reason on one-shot subagents and all jobs. Three surfaces: side panel, dropdown row, hover. |
| Q6 | Add the missing auth retry to the push path; clear `githubStatus` on a successful sync; push the session branch at the stage boundary. |
| Q7 | `ci.yml` push trigger gains `arxa/session/**`. Local gate and local merge unchanged, so offline and local-only orgs are untouched. Costs a `FRAME_VERSION` bump. |
| Q8 | Card reads branch checks with **or without** a PR; adds Re-run, Cancel run, Open on GitHub, mirrored per-row in the CI insight panel. |
| Q9 | Three stages, rebuild after each. |

## Facts (looked up, not assumed)

### Cordis slot contract (`dsh-cordis-client-runner` slot catalogue)

- `conversation.session.header.actions` — **kind: list**, scope session,
  `replaceRisk: none`. Entries render by ascending `order`; negatives are
  reserved for static session context. Current occupants:
  `client-ui-agent-preset AgentPresetLabel id 'agent-preset'` and
  `client-ui-jobs JobListAction id 'job-list'`. Additive — safe to add ids.
- `conversation.session.header.lineage` — **kind: single**. Already occupied
  by `client-ui-subagent SubagentHeaderLineage`. Registering here would
  **replace** the subagent catalog dropdown. Do not use it.
  → Both placeholder chips go on `header.actions`.
- Slot components receive `t`, `useStore`, `actions`; `renderSlot` only for
  root/children-declaring entries. Re-render a stock entry elsewhere via
  `ctx.slots.entriesOfSlot(key)` (the `ArxaPresetCorner` pattern).

### Mode in the header (item 1)

- `agents.create(options)` forwards `options.meta` straight into
  `sessions.prepare(sessionId, { meta })` — `dsh-agent-loop/lib/index.js:1240`.
- `Session.prepare` writes `meta.agentPreset` into the session header —
  `dsh-session/lib/index.js:1667`.
- `SessionSummary.agentPreset` is a header passthrough —
  `dsh-host-apiproxy/lib/types/api/sessions.d.ts:209`.
- `AgentPresetLabel` reads `state.byId[sessionId]?.agentPreset` —
  `dsh-client-ui-agent-preset/lib/client.js:192`.
- Our spawn face (`plugins/arxa-sidebar/lib/index.js:171`) resolves the preset
  but only uses it inside `setup` to mount; it never reaches `meta`.
  **Root cause of the blank mode chip.**

### Empty-state chips (item 2)

- Jobs: `dsh-client-ui-jobs/lib/client.js:139` — `if (jobs.length === 0) return null`.
  Injects only `sessions, slots, locale`; the chip is **read-only**, no actions.
- Subagents: `CatalogDropdown` visibility gate is
  `variant === "switcher" || … || descendantCount > 0`, then `if (!visible) return null`.
  So the affordance exists and hides at zero — nothing to build, only to reveal.

### Job / subagent control surface

- RPC map (`dsh-host-apiproxy/lib/types/api/rpc-map.d.ts`) has
  `subagent.interrupt`, `subagent.list`, `subagent.history`, `subagent.prompt`.
  **No `job.*` method at all.**
- `goal.pause` / `goal.resume` exist — dsh models pause explicitly where it is
  real, and did not for jobs or subagents.
- Jobs status union: `running | stopping | completed | killed | failed`. No
  `paused`. Host-side lever is `ctx.jobs.kill(id, caller, reason)`
  (`dsh-jobs-local/lib/index.js:197`); a job's `cancel` is producer-supplied.
- Subagent `activity: 'running' | 'inactive'`; `mode: 'one-shot' | 'continuable'`.
  → Pause/resume is genuine only for **continuable** children.

### Side panel

- One event: `window.dispatchEvent(new CustomEvent('arxa-av-open', { detail: { kind:'insight', view, sessionId } }))`.
- `plugins/artifact-viewer/lib/client.js:1422` routes it; `:913` sets
  `state = { phase:'insight', view, sessionId, orgId }`; `ctx.layout.openViewer()`
  opens the column. Adding a `view` is a new branch, not new infrastructure.

### GitHub sync (item 4)

- RESTO live state: `main` 1 ahead of `origin/main`, unpushed. The one commit is
  `fcd559e chore(github): record link state` — arxa bookkeeping, no user content.
- Manifest: `publish-failed: … Invalid username or token`.
- Token `accessExpiresAt: 2026-09-02T15:59:48Z`, checked at 16:14Z → already
  expired, so the recorded failure is stale.
- **Defect 1:** `createPrivateRepo`, `renameRepo`, `wireFrame` all do
  `catch (401) → getToken(true) → retry`. `syncRepoNow`
  (`plugins/file-org-shell/lib/lifecycle.js:363`) calls `gitCredentials()` once
  and gives up. A token GitHub rejects while the local clock still reads "alive"
  fails permanently.
- **Defect 2:** `syncRepoNow` writes `githubStatus` on failure but never clears
  it on success, so one blip leaves the message forever.
- Sync runs only on org open + the `org.sync` refresh door. No periodic retry.
- Worktrees are structurally correct: real worktrees, own `arxa/session/*`
  branches, both at `fcd559e`, ahead=0 (nothing committed yet — by design).
- `syncRepoNow` pushes **main only**; session branches never reach GitHub.

### CI frame

- `ci.yml` (`plugins/git-workspace/lib/frame.js:221`) triggers on
  `push: branches: [main]` and `pull_request`. A session-branch push triggers
  **nothing** today.
- Job `frame-check`, `runs-on: [self-hosted, macOS, ARM64, arxa]`, runs `sh check.sh`.
- `sessionStageBoundary` (`plugins/git-workspace/lib/sessions.js:415`) squashes,
  runs the **same `check.sh`** locally, and merges into main locally. Red parks.
- `ci.yml` is written only when a repo is published — a local-only org has no CI.
- `prChecksApi({owner,name,ref})` takes **any ref** (`/commits/<ref>/check-runs`)
  — branch-level checks need no new API.
- `workflowRunsApi({owner,name,branch})` already returns per-run `id`, `status`,
  `conclusion`, `url`, `asleep`.
- Card already polls status + PR every 30s and already has Check PR / Push+open
  PR / Merge (gated green) / Wake runner / Mint.

## Stage 1 — naming, one display name, mode chip

### 1A. Session id template
`plugins/git-workspace/lib/sessions.js`:
- New `nextSessionId(sessions, workspace, now = new Date())` beside
  `nextSessionName`: `<prefix>-wt-<YYMMDD>-<NNN>`.
  - prefix = last path segment of workspace, de-pluralised by the existing rule
    (`len > 3 && endsWith('s') → slice(0,-1)`), fallback `session`.
  - YYMMDD from local date.
  - NNN = 1 + the highest existing counter among sessions **in the same
    workspace with the same date stamp**, zero-padded to 3.
- Collision backstop: if the minted id is already in the registry, increment
  until free (guards a same-day id reused after a drop).
- Must satisfy `^[A-Za-z0-9][A-Za-z0-9._-]*$` — assert in the selftest.
- `openSession` unchanged: it already accepts a caller-supplied `id`.

`plugins/file-org-shell/lib/lifecycle.js:1009` — pass the minted id, and let
`name` default to it (Q3).

### 1B. One display name (Q3)
`plugins/arxa-sidebar/lib/workspace-region.snippet.txt`, `arxaCrumbsFor`:
- Today it always pushes a `session` segment then a `worktree` segment.
- New rule: derive `wt` first; if `row.name` is absent **or equal to `wt`**,
  push only the worktree segment (marked `current`). Otherwise push both.

### 1C. Header title (Q1)
Pin via `sessionTitle.rename(session, title)` at spawn time, `source:{kind:'user'}`
so automatic generation is superseded. Title = the registry `name` (which is the
id by default, or the human name after a rename).

### 1D. Mode chip (item 1)
`plugins/arxa-sidebar/lib/index.js` spawn face: resolve the preset **before**
`agents.create`, and pass `meta: { cwd, agentPreset: resolved.id }`. Keep the
existing `setup` mount. Degrade silently when no preset roster exists.

### Verification
- `node plugins/arxa-sidebar/selftest.mjs` green (+ new checks).
- `node plugins/git-workspace/selftest.mjs` green (+ `nextSessionId` cases:
  first of day, increment, cross-workspace isolation, date rollover, regex).
- Lens: new session in a seeded org → crumb tail, header title, mode chip.

## Stage 2 — subagent + job presence, controls, side panel

### 2A. Placeholder chips (Q4)
Two new entries on `conversation.session.header.actions` (list slot, additive):
- `arxa-subagents-empty`, order 21 — renders only when descendant count is 0.
- `arxa-jobs-empty`, order 19 — renders only when the jobs list is empty.
Each returns `null` when the stock chip is live, so the two never both show.
Muted, non-interactive, opens the panel on click.

### 2B. Controls (Q5)
Host actions (arxa-sidebar server half, `/__arxa/*`):
- `agent.job.cancel` → `ctx.jobs.kill(id, caller, reason)`.
- `agent.subagent.interrupt` → `subagent.interrupt` RPC.
- `agent.subagent.resume` → `subagent.prompt` (continuable only).
Capability map per row: cancel always; pause/resume only when
`mode === 'continuable'`, else disabled with a reason string.

### 2C. Side panel
New insight views `subagent` and `job` in `plugins/artifact-viewer/lib/client.js`
(`state.phase === 'insight'` branch), reached by the existing `arxa-av-open`
event with an extra id field. Renders full detail + the same three actions.

### 2D. Smoke flow
`scripts/smoke-agents.mjs`: seed a fixture org, spawn a real subagent and a real
background job, assert both chips flip from placeholder to stock, exercise
cancel, and assert the panel opens with detail.

## Stage 3 — GitHub sync, session-branch CI, card control

### 3A. Push auth retry (Q6, defect 1)
`syncRepoNow` + `publishRepoOnce`: on a push failure whose text matches the auth
signature (`Invalid username or token` / `Authentication failed` / `403`), mint a
**forced** fresh credential and retry once. Mirrors the REST paths.
Needs `gitCredentials(force)` threaded through `github-bridge` → `github-link`.

### 3B. Clear stale status (Q6, defect 2)
`syncRepoNow`: on `pushed` / `in-sync` / `pulled`, if `manifest.githubStatus`
starts with `publish-failed:` or `sync-conflict:`, rewrite it to `published`.

### 3C. Session-branch push at the stage boundary (Q6)
`sessionStageBoundary` returns the branch it squashed; the card's `card.commit`
handler pushes that branch when the repo is published and linked. Never blocks
the local merge — a failed push is reported, not fatal.

### 3D. CI frame (Q7)
`frame.js`: `ci.yml` push trigger becomes `branches: [main, 'arxa/session/**']`.
Bump `FRAME_VERSION` 2 → 3 so existing published repos heal on their next pass.

### 3E. Card CI control (Q8)
- Read checks against `s.branch` on any session seat, PR or not.
- New github-link APIs: `rerunRunApi` (`POST /actions/runs/{id}/rerun`),
  `cancelRunApi` (`POST /actions/runs/{id}/cancel`).
- New card actions `ci-rerun`, `ci-cancel`, `ci-open`, plus the same three
  per-row in the CI insight panel.

### Verification
- `plugins/arxa-git-card/selftest.mjs` + `selftest.actions.mjs` green.
- `plugins/github-link/selftest.mjs` green (+ mocked rerun/cancel/401-retry).
- Smoke against a **local** bare-repo remote — never the user's GitHub.

## Status — 2026-09-03 (autonomous run)

Full plugin sweep: **29 suites, 0 red.**

### Stage 1 — LANDED and verified live (`61c9e0c`, `f5d96ca`)
Measured on a real engine (`ARXA_HOME=/tmp/arxa-s1`, port 7896):
- `id: note-wt-260903-001`, `name` == id, `branch: arxa/session/note-wt-260903-001`,
  worktree dir `…/worktrees/note-wt-260903-001`, `dshSessionId: arxa-note-wt-260903-001`;
  a second create increments to `-002`.
- Crumb renders `SMOKE / notes / note-wt-260903-001` with `tailDuplicated: false`
  — Q3's collapse confirmed in the DOM.
- `session.list` shows `agentPreset:"arxa"` on **both `arxa-*` sessions** — the exact
  field `AgentPresetLabel` reads. Before the fix this was absent.
- `projections.values.title == "note-wt-260903-001"` on a freshly created session.
- Sidebar row label follows a rename (`Pricing research` observed).

**Design consequence discovered by testing, not planned:** D98's per-repo name
counters cannot survive Q2/Q3. The id is now the dsh session id (`arxa-<id>`)
and dsh keeps ONE session store for the whole app, so two projects minting the
same readable id would put two arxa sessions on one conversation. The mint
therefore reads the cross-registry aggregate and skips taken ids: numbering
inside a container stays natural, the day-namespace is shared. Recorded in
`selftest.routing.mjs`.

### Stage 3 — server half LANDED (`ddf70a7`); card UI NOT built
Done and covered by tests: `pushWithAuthRetry` + `gitCredentials(force)` threaded
through github-bridge → github-link; `clearStaleStatus` on pushed/pulled/in-sync;
session-branch push on a GREEN stage boundary (advisory, never fails the commit);
`ci.yml` watches `arxa/session/**` with `FRAME_VERSION` 2→3; `card.pr.status`
reads branch checks with or without a PR and returns `runs`; `card.ci.rerun` /
`card.ci.cancel` actions plus `rerunRunApi` / `cancelRunApi`.

**Not built:** the card's own Re-run / Cancel / Open-on-GitHub BUTTONS. The
actions and APIs behind them exist and are tested; the snippet UI is not wired.

### Stage 2 — placeholders LANDED; controls and panel NOT built
Done: `ArxaJobsPlaceholder` + `ArxaSubagentsPlaceholder` on
`conversation.session.header.actions` (kind:list, so they sit beside the stock
entries), each returning null once its stock counterpart goes live; muted
`.aXa_emptyChip` styling; en/pl/fr strings.

**Not built:** pause/resume/cancel controls and the subagent/job detail panel.
Stopped deliberately rather than ship dead buttons — see Known gaps.

## Known gaps and exactly where they sit

1. **Agent controls + detail panel (Q5, 2B/2C).** `subagent.interrupt` /
   `subagent.prompt` exist as RPC methods but **no stock client calls them** —
   there is no `interrupt` call site anywhere in `dsh-client-ui-subagent`, and no
   short `connection.request` path was found from a plugin context. Job cancel
   is clearer: `ctx.jobs.kill(id, caller, reason)` needs `caller.id ===
   job.owner.id`, and `job.owner` is the owning **session**, so a host action can
   legitimately pass the live session from the store. Next step is deciding the
   transport (client RPC vs a new `/__arxa/agent.*` host action) before writing
   either.
2. **Region jump on first subagent.** The placeholder sits on `header.actions`;
   the real `CatalogDropdown` lives on `header.lineage`, which is
   **kind:single** and already occupied — registering there would delete the
   dropdown we want to surface. So the affordance moves regions the first time a
   subagent appears. Accepted consciously.
3. **Two Stage 1 DOM claims unverified.** The rename-divergence crumb (two tail
   segments) and the mode chip's rendered pixels. Both were blocked by a harness
   problem, not a product one: fixture sessions have no user message, so every
   fresh client boot **drops them** via the Q3 empty-drop before the probe can
   look. Fix for next run: give the fixture session a real `user/message` so it
   survives, then reuse `/tmp/arxa-s1/lens.mjs`.
4. **Nothing was pushed to the user's GitHub.** By design for an unattended run
   — see the standing constraint above. RESTO is untouched; `main` is still 1
   ahead of `origin/main`. The auth-retry and status-clear fixes take effect on
   the next org open, which happens when the user next launches the app.
5. **Desktop app not rebuilt.** The repo-served engine was used throughout.

## Commits
1. `feat: mint readable session ids and pin the worktree name across sidebar, crumb and header`
2. `feat: record the agent preset on arxa-spawned sessions so the header shows the mode`
3. `feat: keep subagent and job chips present and controllable with a detail panel`
4. `fix: retry the github push on a stale token and clear a healed sync status`
5. `feat: run frame checks on session branches and control runs from the git card`
