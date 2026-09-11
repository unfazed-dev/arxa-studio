# Organisation row dashboard — grill decisions and build plan

**Status:** decisions grilled and confirmed by the operator 2026-09-09.
Steps 1 (spike, §7), 2 (skeleton + selection bridge, §8), 3 (tier-1
Activity + Repository cards, §12, 2026-09-09) and 4 (tier-2 figures + focus
heartbeat, §13, 2026-09-10) DONE.
Step 2b (§9, 2026-09-09 operator asks: boot lands on the last dashboard, no
session resume, clickable session cards with a concise summary + Open) DONE,
repacked and installed. Step 2c (§10, Freestyle gate + sample cards) and 2d (§11, facts summary,
contrast, TCC prompt work) DONE and installed. Step 4.5 (§14, the reference
restyle: nav pills, 12-col bento, session carousel, Time card, motion — the fan
was replaced by a plain carousel during the build, D145) DONE 2026-09-10,
installed as 65bf77a93127. Steps 5–8 (Delivery, Engine, filters, docs, §15)
DONE 2026-09-10 — repacked 387abbb38417, installed, CI / smoke /
installed-check green. The Sessions card of step 3 landed early in §9.

**Ask (verbatim intent):** clicking a row in the Organisations tab (the org
header such as TERRA, or Projects / Notes / Meetings / Account /
Communications, or a project) currently only expands the row. The content
column (the "Flowing High" hero) should instead show an interactive dashboard
for that row: created / updated, streak, files and folders, sessions open and
closed, CI/CD, git stats, time per session, tokens, charts, cards.

**Advisor:** `consult.sh --domain architecture` returned `over_budget`
(session fuse 28/20) before this file was written. Recorded as a skipped
consult per `~/.claude/rules/advisor-conventions.md`; re-run before build.

---

## 1. Verified facts the decisions rest on

Everything below was read from source this session, not remembered.

### Sidebar and content column
- Org header and category rows call `orgStore.toggleExpand(d.key)` on click;
  an org also fires `org.open` when opening
  (`plugins/arxa-sidebar/lib/workspace-region.snippet.txt`, OrgContainerRow
  `onClick`, ~line 76 of the component). Nothing touches the content column.
- The shell "New Session" button reads `orgStore.get().selectedRowId`
  (`{ orgId, rowId } | null`) through `window.__ARXA_SIDEBAR__.selectedWorkspace()`
  and posts `POST /__arxa/sidebar/action { action: "workspace.new-session",
  arg: { orgId, workspace: rowId } }`; on success `openCreated(orgId, id)`
  runs `session.open` then `arxaOpenConversation` (`scripts/gen-sidebar.mjs:80-105`,
  snippet `openCreated` ~line 436). Selection exists today only for category
  and project rows.
- A session's worktree is created by the host under
  `<org>/.arxa/worktrees/<id>` (`plugins/git-workspace/lib/sessions.js:11,71`).
  There is no worktree before a session exists; row selection is the only input.
- In the no-session state the conversation root renders
  `root[data-phase=hero] > body > scrollBody[data-conversation-scroll]
  (justify-content:center) > composerSeat[data-composer-seat] >
  composerStack.composerHero (width-capped to the chat content width) >
  [HeroShell brand, heroWorkspaceRow > slot conversation.hero.workspace,
  input dock, input bar]`
  (`node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js:14406-14500`).
- `conversation.hero.workspace` is `kind: single, scope: root` (same file
  :16085). arxa-sidebar already occupies it with `ArxaHeroGuide`
  (`scripts/gen-workspace.mjs:438-441`; snippet ~line 748). That component
  walks three parents up to the composer stack and sets `data-arxa-empty`,
  and the region injects a `<style>` tag (snippet ~line 1208). This is the
  precedent for reshaping the hero without stock class selectors.
- `conversation.view` is `kind: list, scope: session`, rendered only when a
  session is active, with a tab bar (`id`, `order`, `label`) — the legal
  place for a later "Dashboard" tab inside a session (same file :14638, :16117;
  chat registers there in `dsh-client-ui-chat/lib/client.js:8082`).
- The git card is the precedent for a second plugin: `require('react')`,
  `React.createElement`, `ctx.slots.inject(...)`, host route
  `POST /__arxa/git-card/action { action, arg }`, row in
  `profile/cordis.patch.yml` (:254), package `dsh.client.inject` list
  (`plugins/arxa-git-card/package.json`).
- Existing window bridges: `arxa-av-open`, `arxa-create-project`,
  `arxa-sidebar-state`, `arxa-sidebar-notice`, `arxa-publish-org`, … The
  file-change decoration event (`ARXA_DECO_EVENT`) is what lights M/A/D marks.

### Data already available
- Sessions: `.git` common dir `arxa/sessions.json` rows carry `id, name,
  branch, worktree, state (open|parked|archived), parkedReason, project,
  workspace, createdAt, updatedAt, dshSessionId, dshStatus` plus a stage
  ledger (`plugins/git-workspace/lib/sessions.js:107-124`, `ledger.js`).
- Streak: `gw.commitDays(repoPath, { since: '90 days' })` already feeds the
  git card's Streak insight (`plugins/arxa-git-card/lib/index.js:1167`).
- CI/PR: `insight.review` reads workflow runs and PR conversations through
  `github-link` (`arxa-git-card/lib/index.js` `reviewFor`), session-seat
  scoped, 60 s cache, manual refresh (D5 of
  `docs/plans/github-conversations-in-the-insight-panel.md`).
- dsh projections on Host: `@deepseek-ai/dsh-session-stats` folds
  `turns, steps, llmMs, toolMs, ttftMs, decodeMs, decodeTokens` per session;
  `@deepseek-ai/dsh-token-meter` derives exact per-turn
  `uncachedInputTokens, outputTokens, totalTokens, cacheRead/Write,
  reasoningTokens, routes[{provider, model}]`. Both hang off the
  `sessionProjections` service (`dsh-token-meter/lib/index.js:588`). Logs
  persist as `~/.arxa/dsh/sessions/<cwd-key>/<session>/session.jsonl.zstd`.
  **Not yet verified:** the exact read API of `sessionProjections` from a
  plugin host half. First build task.
- Account usage (`plugins/claude-code/lib/usage.js`) is account-wide
  rate-limit windows, not per row. Not a dashboard source.
- No charting library is installed anywhere (`package.json`, `plugins/*`).

### arxa engine (sibling repo `../arxa`) — file contract
- Pipeline FSM: `arxa/lib/engine.dart` (`Stage`, `StageRun` with
  `tokensIn/tokensOut`, USD cost via `fabric.dart:154 costFor`). Runs leave a
  manifest and scorecard line under `pipeline/state/`
  (`run.state.json` live, `default.state.json` read-only; `gates.dart:120-138`).
  Current phase: `phases.dart`.
- Gates: `arxa gate --all` → passed / failed / skipped summary
  (`gate_runner.dart:93`); `config/evidence.json` is the ledger of suites
  that ran (`gate_advertise.dart:20,222`).
- Deploys: `pipeline/state/deploy-ledger.json`, rows `shipped | halted`
  per target (`deploy.dart:379`).
- Intake/design: `intake/registry.json`, `intake/flows.json`,
  `story-map.json`, `brief.md`, design journal, decision log (ADRs), lens
  evidence shots, Arxa Dial pins with kanban status (`arxa_dial.dart`).
- The engine glossary already names this surface: **Clients panel** —
  "Clients → project → pipeline stages, rendered from the engine's project
  registry and gate status" (`../arxa/CONTEXT.md`).

---

## 2. Decisions (grilled, confirmed)

| # | Decision | Chosen | Rejected |
|---|----------|--------|----------|
| D1 | Placement | Hero replacement: dashboard shows in the no-session content column. An open chat is never displaced. | Page mode over `conversation.view` (would fight the session view, needs a back affordance). |
| D2 | Click semantics | Click keeps expand/collapse **and** sets selection; dashboard follows selection. | Chevron-only expand (breaks habit and selftests). |
| D3 | Row kinds | Org, category, project rows. Files keep opening the viewer; sessions keep opening chat; free folders only expand. | Org+category only; every row incl. files. |
| D4 | Data scope | All three tiers in v1, shipped in order: local git/files → dsh projections → GitHub (connect-state fallback). Plus the engine tier (D5). | Tier 1 only / defer GitHub. |
| D5 | Engine hook | Sources with a **file contract**: the engine source reads the on-disk files in §1 when present, renders "engine not set up for this project" otherwise; swaps to invoking the binary when the hook lands. | Shell out to `arxa` now (PATH fragility proven by the monaco work); placeholder card. |
| D6 | Charts | Hand-rolled inline SVG: heatmap, bars, sparkline, donut; theme tokens; hover + click handlers. | Bundled uPlot/Chart.js via esbuild. |
| D7 | Refresh | Load on select; reload local tiers when the org watcher fires for that row; GitHub fetch-on-open + 60 s cache; **manual refresh button on every card group** (A + B). | Polling. |
| D8 | Composer | Hidden by CSS while a row is selected. Dashboard header carries "New session in <row>" wired to `workspace.new-session` with the sidebar CTA's enable rules. Org rows: no CTA (org-level creation stays removed). | Composer as trigger with draft carry (dsh carries drafts only through its own picker, which arxa bypasses — a spike, not a path). |
| D9 | Code home | New plugin `plugins/arxa-dashboard` (host + hand-written client). arxa-sidebar changes in exactly two places: hero guide renders the dashboard component when a row is selected; row clicks set selection (extend `selectedRowId` to org rows). | Everything inside arxa-sidebar's generated client. |
| D10 | Time per session | Three measured numbers from dsh (model time, tool time, wall span first→last event) **plus** a client focus timer (A + C): heartbeat while the session is visible, persisted as `focusMs` on the session row in the per-repo `arxa/sessions.json`. Local only, no DB. | Wall span only. |
| D12 | Boot landing (2026-09-09, operator) | **No session resume.** Once the org list settles the content column is cleared and the last container row the user selected before quitting (persisted client-side under `localStorage["arxa.dashboard.last"]` by `selectRow`) is selected again, so the app opens on that client's dashboard. Saved org gone / nothing saved → first org's dashboard. No orgs → welcome guide. A session dsh reconnects on its own at boot is a rider and is cleared; only a user open keeps content. The hero headline ("Flowing High") is hidden while a dashboard is up. | Keep resuming the newest session (operator: "no more resume sessions"); host-side file for the landing (one-liner suffices, per-webview storage is the right scope). |
| D13 | Session cards (2026-09-09, operator) | The Sessions card lists every registry session of the row as a clickable card (name, live/state chip, turns, tokens, age). Click = expand to point-form: the latest 3 turns' prompt/response previews from dsh's own `turnOutline` projection unit, plus **Open session** = the sidebar's `openCreated` flow (server `session.open` → reveal → focus). Scope: org = all; `projects` = project-scoped; another category = its workspace + sub-workspaces; project = that project. | Decoding the session log for a summary (dsh already keeps bounded previews); a private open path. |
| D14 | Workspace docks (found live 2026-09-09) | Notes / Meetings / Account / Communications are STOCK workspace rows, not container rows — their click reaches `ARXA_SELECT_WS`, which now tags a top-level workspace as `kind: "dock"` so the category dashboard shows. Deeper workspaces (e.g. meetings/scheduler) stay leaf picks (guide + CTA target, D3). | Treating every workspace as a dashboard row (`resolveRow` only knows the five categories and `projects/<slug>`). |
| D11 | Interactivity | Fixed drill-down set **plus** full client-side filters and date ranges over already-fetched series (A + C). | Read-only cards. |

Cross-cutting, inherited from repo rules: no feature may require the Arxa
Digital Solutions database (`arxa-studio/CLAUDE.md`); plain JS, no JSX, no
undeclared globals, every effect returns a disposer (cordis skill); en/pl/fr
dictionaries for every string; a `selftest.mjs` per plugin auto-discovered
by `scripts/ci.mjs`; visual evidence via the arxa lens under
`designs/org-dashboard/evidence/`.

Follow-up parked, not in v1: a "Dashboard" tab in `conversation.view` inside
an open session (D1 option C).

---

## 3. Architecture

```
sidebar row click ──► orgStore.selectedRowId = {orgId, rowId | org}
                      └─ emits arxa-sidebar-state (existing)
ArxaHeroGuide (arxa-sidebar) ──► selected? render window.__ARXA_DASHBOARD__.Root
                                           : existing guide text
Root (arxa-dashboard client) ──► POST /__arxa/dashboard/action
                                   { action: "row.stats", arg: { orgId, rowId, range } }
host (arxa-dashboard) ──► sources: git · files · sessions · projections · github · engine
                          each returns owned JSON; absent backend ⇒ { reason: "unavailable" }
```

### Host: `plugins/arxa-dashboard/lib/index.js`
- One route `POST /__arxa/dashboard/action`, verbs:
  - `row.stats` — everything local (git, files, sessions, projections,
    engine) for a row; `range: 30 | 90 | 365 | all` days.
  - `row.github` — CI runs, PRs, checks; 60 s module cache; `fresh: true`
    bypasses.
  - `session.focus` — `{ sessionId, deltaMs }` heartbeat; adds to `focusMs`
    on the session row (atomic write via the existing sessions writer).
- Sources are plain functions `(scope) => Promise<json>`, where `scope` is
  `{ kind: 'org'|'category'|'project', orgPath, repoPath, projectPath? }`.
  An org scope rolls up its projects' engine and git figures; a category
  scope is the org repo filtered by the category folder; a project scope is
  its own repo.
- Reuse: `git-workspace` (`commitDays`, commits, sessions, ledger),
  `github-link` (`reviewFor`'s fetchers), the sidebar's `repoFor` manifest
  resolution. No new git plumbing.
- Engine source reads: `pipeline/state/*.state.json`, `config/evidence.json`,
  `pipeline/state/deploy-ledger.json`, `intake/registry.json`, `flows.json`,
  `story-map.json`, the decision log. Missing files ⇒ `reason: "not-set-up"`.
- Leaf values only cross the wire: strings, numbers, booleans, ISO dates.
  Never a snapshot object (cordis live-data rule).

### Client: `plugins/arxa-dashboard/lib/client.js`
- `apply(ctx)`: publish `window.__ARXA_DASHBOARD__ = { Root }` and remove it
  on dispose; inject a `<style>` tag (removed on dispose); register locale
  dicts via `ctx.locale.register`.
- `Root({ selection })`: header (row name, kind glyph, created / updated,
  CTA, refresh, range toggle), then card groups:
  - **Activity** — streak heatmap, commits per week bars, activity sparkline.
  - **Sessions** — open / parked / archived donut, per-session bars (tokens,
    model+tool time, focus time), list with open-session drill-down.
  - **Repository** — files / folders counts, branches, contributors, last
    commit, diff summary, decorations count.
  - **Delivery** (GitHub) — CI runs and pass rate, PRs open / merged, checks;
    connect-state when unlinked.
  - **Engine** (project and org roll-up) — stage progress strip, gate
    pass/fail/skip, cost per stage, deploy history, design feedback backlog;
    not-set-up state otherwise.
- Filters: range toggle (30/90/365/all), session state, model/route, branch.
  All client-side over the fetched series.
- Drill-downs per D11: session → `arxaOpenConversation`-equivalent through
  the sidebar bridge; commit → `arxa-av-open` (viewer) or GitHub URL; CI/PR
  → GitHub URL; gate/deploy row → evidence file via `arxa-av-open`; project
  tile → set selection to that project row.
- Focus timer: `document.visibilityState === 'visible'` && a bound session ⇒
  heartbeat every 30 s to `session.focus`; paused on hidden. Uses the
  `timer` service (`inject: ['timer']`), never a global timer.

### arxa-sidebar edits (two, both in `workspace-region.snippet.txt` + regen)
1. OrgContainerRow `onClick`: after `toggleExpand`, set
   `selectedRowId = { orgId, rowId: d.key, kind }` for org rows too (category
   and project rows already do this for the CTA).
2. `ArxaHeroGuide`: when `selectedRowId` is set and no session is bound,
   set `data-arxa-dashboard` on the stack (same walk as `data-arxa-empty`)
   and render `window.__ARXA_DASHBOARD__?.Root` with the selection; fall
   back to the guide text when the dashboard plugin is absent.
   CSS in the dashboard plugin: `[data-arxa-dashboard]` widens the stack,
   top-aligns `[data-conversation-scroll]`, hides the input bar and dock.

### Registration
- `profile/cordis.patch.yml` insert row `arxa-dashboard` after
  `arxa-git-card`; `bin/arxa-studio.mjs` copy list + `BY_NAME_PLUGINS`;
  `scripts/preset-check.mjs` composition check; `package.json`
  `dsh.client.inject` mirrors the git card's.

---

## 4. Build order (each step shippable, each with its selftest)

1. **Spike — DONE 2026-09-09.** Answer in §7; code in
   `plugins/arxa-dashboard/lib/projections.js`, proven by
   `plugins/arxa-dashboard/selftest.projections.mjs` (13 checks, incl. a
   real-cache smoke: 85/85 rows readable on this machine).
2. **Plugin skeleton + selection bridge — DONE 2026-09-09.** See §8.
   Evidence: `designs/org-dashboard/evidence/{org-row,category-row}-1512.png`
   from `scripts/dashboard-smoke.mjs` (live engine + lens).
3. **Tier 1 cards — DONE 2026-09-09.** Activity + Repository (§12); Sessions
   landed early (§9).
4. **Tier 2 cards:** tokens, model/tool/wall time per session; focus
   heartbeat + `focusMs` persistence.
5. **Tier 3 cards:** Delivery via `github-link`; connect-state; 60 s cache;
   manual refresh.
6. **Engine cards** from the file contract; org roll-up.
7. **Filters, ranges, drill-downs,** tooltips; keyboard focus order.
8. **Docs:** `CONTEXT.md` gains "Dashboard" and "Selected row";
   `arxa-studio-grill-decisions.md` gets the D-numbers.

Selftests (byte-level, like the sidebar's): route verbs present, every
source degrades to `reason` shapes without throwing, locale keys in all
three dicts, no `setTimeout`/`fetch(` outside the sanctioned helpers, the
snippet still contains both anchors, generated client regenerates clean.

---

## 5. Risks and open items

- **Hero reshape depends on stock structure.** Mitigated by using only
  `data-*` hooks (`data-phase`, `data-conversation-scroll`,
  `data-composer-seat`) and the parent-walk precedent; a selftest asserts
  the anchors exist in the installed dsh version.
- **`sessionProjections` read surface unverified** (step 1). Fallback is the
  on-disk log decode, which needs a zstd decoder on Host — check whether dsh
  already ships one before adding a dependency.
- **Focus timer write contention:** `sessions.json` is also written by
  session create/park/archive. Use the existing atomic writer and merge by
  id; never rewrite from a stale read.
- **Org roll-up cost:** an org with many projects means many git reads on
  select. Cache per repo for the watcher interval; measure before
  optimising.
- **GitHub rate limit:** the 60 s cache is per row; a user clicking across
  ten projects still spends ten calls. Acceptable per the git card's
  precedent; revisit if the 5 000/hr limit is ever hit.
- **Engine paths are per project.** Category rows have no engine data by
  construction; the Engine group is hidden there, not shown empty.

---

## 6. Docs consulted

dsh (installed 0.1.2-rc.1) client sources named in §1; the shipped
`cordis-plugin-development` skill; `CONTEXT.md` (studio) and
`../arxa/CONTEXT.md` (engine); `docs/plans/github-conversations-in-the-insight-panel.md`;
`docs/plans/freestyle-section.md` §1.1; `plugins/arxa-git-card` as the
second-plugin precedent.

---

## 7. Spike result — reading dsh session stats and tokens (2026-09-09)

**Answer: no new tracker, no log decoding.** dsh already folds per-session
stats and exact token usage, and persists them as plain JSON.

- **Units and their values** (verified on a 25-turn real session):
  - `sessionStats` → `{ turns, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }`
  - `tokenUsage` → `{ totals: { uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }, last: {…} }`
  - `sessionListMetadata` → `{ blank, lastPromptAt }`; `title` → string.
- **Closed sessions — file contract:** `<dshHome>/storages/session_projcache/sessions/<dshSessionId>.json`
  = `{ version, record: { identity: { createdAt, cwd, isSeeded, inheritedEventCount }, rows: { <key>: { ver, seq, val } } } }`.
  Written by `@deepseek-ai/dsh-session-projection-cache` on a debounced timer
  (`lib/index.js:266`). `dshHome` = `dirname(persistence.root)`, the same
  derivation `plugins/arxa-sidebar/lib/session-header-index.js:35` uses.
  arxa sessions are keyed by their `dshSessionId` (`arxa-<ORG>-<category>-<name>`),
  the value `sessions.json` already stores per row.
- **Live sessions — service path:** `ctx.sessions.get(id)` (the sidebar host
  already injects `sessions`) → `ctx.sessionProjections.cachedSnapshot(session)`
  → `{ asOfSeq, values }`. Same normaliser as the file path
  (`metricsFromValues`). Live wins when loaded because the disk row can lag.
  This is exactly how dsh's own session list column does it
  (`dsh-api-session-controller/lib/index.js:1896 projectionsFor`).
- **Composition:** both units are active in this build — their rows are
  present in every cached session on this machine (85 files), so no
  profile change is needed.
- **Per-turn series (tokens per turn, event-time wall span):** NOT in the
  cache. When a card needs them, use `ctx.get('sessionQuery').listEvents(id)`
  (`dsh-session-query`, sqlite-backed). Do not decode `session.jsonl.zstd`
  directly: it is a concatenated-frame zstd container, Node's one-shot and
  streaming decoders stop after frame 1 ("Unknown frame descriptor"), and
  dsh keeps its frame scanner private (`dsh-session-persistence-jsonl`
  `scanZstdFrames`, not exported). Measured: 944 KB log = 2 367 frames,
  3 138 records; usage arrives as `assistant/chunk {chunk:{type:"usage"}}`
  and every record carries `time` (ms epoch).
- **Wall span for v1:** `identity.createdAt` → `lastPromptAt` (cache) or the
  `sessions.json` row's `updatedAt`. Good enough until per-turn series land.
- **Focus time (D10-C):** confirmed absent everywhere; stays a new field on
  the `sessions.json` row.

Plan §5 risk "`sessionProjections` read surface unverified" is closed. The
zstd fallback risk is replaced by the `sessionQuery` path above.

---

## 8. Step 2 result — skeleton, selection bridge, live proof (2026-09-09)

**Shipped**
- `plugins/arxa-dashboard/lib/index.js` — host half. `POST /__arxa/dashboard/action`
  with `ping` and `row.stats`; orgs resolved by id through the sidebar seam's
  `lifecycle.listOrgs()`, rows limited to the five category slugs or
  `projects/<slug>` (`resolveRow`, traversal refused). Never a browser path.
- `plugins/arxa-dashboard/lib/client.js` — browser half. Owns no slot: publishes
  `window.__ARXA_DASHBOARD__ = { Root }` inside `ctx.effect` (withdrawn on
  dispose), announces `arxa-dashboard-ready`, injects CSS keyed only on
  `data-*` hooks (`[data-conversation-scroll]:has([data-arxa-dashboard])`
  lifts the hero centring; brand mark, preset chip and input dock hidden).
  Root = header (kind · org, name, path, Refresh, "New session in <row>"
  wired to the SAME `workspace.new-session` + `openCreated` as the shell
  button, no CTA on org rows) + five placeholder group cards. en/pl/fr.
- arxa-sidebar (snippet, regenerated): OrgContainerRow click also
  `selectRow({ orgId, rowId, kind, label })` (org rowId `""`); the CTA levers
  refuse an empty rowId; ArxaHeroGuide renders the published Root for
  org|dock|project while unbound and marks the stack `data-arxa-dashboard`.
- Registration: `profile/cordis.patch.yml` (after arxa-git-card),
  `bin/arxa-studio.mjs` (dir const, copy list, BY_NAME_PLUGINS).
- Gates: `plugins/arxa-dashboard/selftest.mjs` (24 checks incl. resolveRow
  behaviour and both sidebar seams), sidebar selftest 325 green (drift gate
  passed on the regenerated client), git-card 52 green, `scripts/ci.mjs`
  105 suites green, preset-check green.
- Live proof: `scripts/dashboard-smoke.mjs` boots the checkout engine on a
  scratch home with a COPY of TERRA registered in recents, proves the route
  (ping, org, category, traversal refused, unknown org refused), then drives
  the real page through the arxa lens: org click → dashboard root, marked
  stack, 5 groups, no CTA; Projects click → category dashboard with its CTA.
  No console/page errors. Shots at 1512×900 in `designs/org-dashboard/evidence/`.

**Lens learnings worth keeping**
- `lens check` asserts `--selector` BEFORE `--expect` runs; a surface that
  only exists after the expect script interacts must be asserted inside the
  expect (return literal `true`).
- With no desktop shell alive, the first lens tab CLAIMS the waiting-page
  slot and the next tab (inside the 7 s claim expiry) parks and closes
  itself as "Inspected target navigated or closed". `ARXA_LENS_UA=… ArxaShell/1.0`
  (the documented passive door) fixes consecutive runs.
- The hero's flowing background never settles; `lens check` has no
  `--allow-unstable`, so the smoke accepts a settle-only failure while every
  real assertion must hold (same stance as the git-card evidence pass).
- dsh's first-boot "Internal Testing Notice" modal sits over a scratch home;
  the expect script dismisses it (Continue / Kontynuuj / Continuer).
- The Root remounts per selection (React key `orgId|rowId`): re-query the
  node after a click; a held reference reads the OLD selection.

**Not in step 2 (by design)**
- Project-row shot: the TERRA copy has no projects; the code path is the
  same OrgContainerRow branch (`kind: "project"`, rowId `projects/<slug>`)
  and is covered by `resolveRow` + the seam selftests. A project fixture
  joins the smoke when step 3 needs project git stats anyway.
- The `[data-arxa-dashboard]` mark also hides `conversation.input.dock`, so
  the git card is not shown under the dashboard — nothing is bound there.

---

## 9. Step 2b — boot landing, session cards, repack (2026-09-09)

**Operator asks (verbatim intent).** Repack always and smoke test before
moving on, fix any defect found; the empty welcome ("Flowing High" + guide) is
replaced by the last org dashboard that was open before quitting; no more
session resume; a session card click gives an extremely concise summary of
the session's latest turns and opens the session. Decisions D12–D14.

**What changed**
- `plugins/arxa-sidebar/lib/workspace-region.snippet.txt` (+ regenerated
  `client.js`): `LAST_ROW_KEY`; `selectRow` persists container rows;
  `maybeResume` is now the landing (clear → restore saved / first org → reveal
  → best-effort `org.open`); the boot rider kill no longer spares org
  sessions; `ARXA_SELECT_WS` tags top-level workspaces as docks.
- `plugins/arxa-sidebar/lib/index.js`: host seam `sessionsOf(l, org)` =
  the tree's own session lister (registry ⋈ dsh live).
- `plugins/arxa-dashboard/lib/index.js`: verbs `row.sessions` and
  `session.summary`; `scopeSessions`; dsh faces read through optional
  `ctx.get` (sessions, sessionProjections, sessionPersistence).
- `plugins/arxa-dashboard/lib/projections.js`: `readValues`,
  `readCachedValues`, `summaryFromValues` (turnOutline → last 3 turns).
- `plugins/arxa-dashboard/lib/client.js`: Sessions card (full width, last),
  `SessionCard` (click = expand, summary points, Close / Open session),
  hero headline hidden under a dashboard, 26 new locale keys × en/pl/fr.
- Selftests: sidebar pins rewritten for D12 (resume pins removed), dashboard
  selftest +14 checks (verbs, scope filter, card seams, dock tagging).
- `scripts/dashboard-smoke.mjs`: creates a real session through the CTA
  verb, checks `row.sessions` scope + `session.summary`, then four lens
  passes: boot lands on the org dashboard with no click; Notes row → card →
  summary + Open; Open binds the conversation (dashboard leaves); a later
  boot with an open session on record still lands on a dashboard.
  `ARXA_DASHBOARD_SMOKE_KEEP=1` parks the engine and prints the lens auth
  for hand-driven checks.

**Defects found by the smoke, fixed**
1. Host verbs that spawn (`workspace.new-session`) run past the smoke's 5 s
   HTTP timeout → 90 s for host calls. (Smoke bug.)
2. The TERRA copy carried `.arxa/locks/<slug>.lock` naming the LIVE app's
   pid; the scratch engine refused it at step `shell-lock` → the smoke drops
   inherited locks after the copy. (Smoke bug.)
3. dsh's startup policy re-bound the freshly created org session and the boot
   clear deliberately spared org sessions (`orgIds.has(cur)`) — the exact
   "resume" the operator wants gone → exemption removed; only a user open
   (`currentSessionId`) keeps content. (Product bug vs D12.)
4. Notes / Meetings / Account / Communications never showed a dashboard —
   stock workspace rows select without a `kind` (`ARXA_SELECT_WS`), so the
   hero kept the guide; step 2 only ever proved Projects (a container dock).
   → D14. (Product bug, present since step 2.)
5. "Flowing High" headline stayed above the dashboard (the brand slot lives
   outside the composer stack, the old selector never reached it) → hidden
   through `body:has([data-arxa-dashboard])`.

**Lens learning.** Every `arxa lens check` tab is storage-fresh
(`localStorage` empty on the next run), so the restore half of D12 cannot be
proven by consecutive lens runs; the smoke asserts the persist half (saved
selection after the Notes click) and the fresh-profile landing. The restore
half is verified on the desktop webview (WKWebView persists storage) after
repack — see "Installed" below.

**Proof**
- Evidence: `designs/org-dashboard/evidence/boot-lands-org-1512.png`,
  `session-card-1512.png` (card expanded: "No turns yet — the session is
  empty.", Close / Open session), `session-open-1512.png` (conversation
  bound), `boot-after-open-1512.png`.
- Smoke: `node scripts/dashboard-smoke.mjs` 16/16 OK (6 host verbs incl. session
  create + scope + summary, 4 lens passes; settle-unstable accepted as in §8).
- CI: `node scripts/ci.mjs` 105 suites ALL GREEN (sidebar selftest 326, dashboard
  selftest 43 + projections 13).

**Installed**
- `node scripts/pack-sidecar.mjs` → 241.1 MB, payload sha12 `3af3cab35906`;
  bundled binary sha256 `582f308940f06e3b…`; rollback `/Applications/Arxa Studio.app.bak`.
- Installed engine `~/.arxa/engine/3af3cab35906`: the seven touched files
  (dashboard client/index/projections, sidebar client/index, launcher, cordis
  patch) are byte-identical to the repo. Engine serving 7891, `ready=true`,
  45-session list served, TERRA root server up.
- **Install lesson (2026-09-09).** `cp` OVER the existing bundled binary keeps
  its inode and the kernel then refuses the file ("load code signature error
  2", exit 137) — the shell respawns it every 5 s and the window parks on
  "Reconnecting…". Install = `rm` the old file, `cp` the new one, then
  `codesign --force --sign - <binary>` (ad-hoc, like bun's linker signature).
  The first dsh child after that hung idle before any plugin applied (no
  `[arxa-boot]` line for 4 min, socket accepted then reset); killing it let
  the desktop watchdog respawn a clean engine that booted in ~1.5 s. Observed
  once; the earlier refusal loop is the likely cause, not reproduced after.
- Real webview, real data (screen captures, scratchpad only): first boot after
  install lands on the **TERRA organisation dashboard** — no welcome, no
  resumed session; quit + relaunch lands there again. The restore of a
  category row could not be driven from the terminal (System Events click is
  refused without Accessibility access), so the operator sees that half on the
  next relaunch after clicking any row: persist is asserted in the smoke,
  restore is the `maybeResume` path pinned by the sidebar selftest.
- Seen on relaunch, not touched: macOS asked whether "arxa-studio" may access
  Apple Music / media library. Not from this change; left for the operator.
- TERRA shows "Sessions 0": the org folder has no `.git/arxa/sessions.json`
  and no projects, so the registry lister truthfully lists nothing; the 45
  dsh sessions on this machine belong to other (smoke) orgs.

**Not in step 2b (by design)**
- Summary of a session with real turns: the smoke's scratch home has no model
  key, so its session has zero turns (the "empty" branch is what the shot
  shows). `summaryFromValues` is unit-checked against both the cached fold
  state and the live view shape; a real-turn shot comes from the installed
  app (below).
- Sub-workspace rows (e.g. meetings/scheduler) keep the guide (D3/D14).

---

## 10. Step 2c — Freestyle gate, sample cards (2026-09-09, operator)

**Asks.** "I navigated to Freestyle and could still see the dashboard of one
of the orgs — this cannot happen" and "add fake sessions so that I can see the
clickable cards before continuing".

**Fix 1 — Freestyle gate.** `ArxaHeroGuide`'s `showDash` now also requires
`freestyle.ui.activeTab !== "freestyle"`; the Freestyle tab keeps its own
guide, the Organisations tab brings the dashboard back with the selection
untouched. (Defect: the gate only looked at selection + bound state.)

**Fix 2 — sample cards.** A row with zero registry sessions renders three
SAMPLE cards (dashed "Sample" chip, a note under the empty-state line). They
are client-only: nothing written, nothing posted — the summary rides inline so
click = expand works without a host verb; Open session is disabled with a
tooltip. The first real session in the row replaces them (the count in the
card title counts real rows only).

**Proof.** New lens pass `samples-and-tabs-1512.png`: ≥3 sample cards, click →
≥2 summary points, Open disabled, Freestyle tab → dashboard gone + guide up,
Organisations → dashboard back. Smoke: `node scripts/dashboard-smoke.mjs` 17/17 OK (new lens pass + the six of §9). CI: 105 suites ALL GREEN (dashboard selftest 45).
Installed: payload sha12 `9705c0992c40` (rm + cp + `codesign --force --sign -`,
engine ready in ~24 s), dashboard + sidebar client byte-identical to the repo;
the real app relaunched on the Freestyle tab and showed Freestyle's guide, no
org dashboard. Rollback `/Applications/Arxa Studio.app.bak`.

**Smoke hardening this round (all smoke-side, no product change).** The
operator's real TERRA now carries a session (`notes/note-wt-260909-001`, its
branch + worktree) and a project (`Peter`): the copy scrubs `.git/arxa`,
`.arxa/worktrees`, `.git/worktrees` (its gitdir pointed at the SOURCE
worktree, so prune kept it and `branch -D` was refused) and every
`arxa/*` branch; the Notes click walks candidates until the sidebar reports
top-level `notes` (a project's own Notes sub-row comes first in DOM order).
The post-lens `ECONNRESET` on the first host call is the lens tab
re-exchanging the token in the authority URL (cookie rotates); the smoke
re-auths once and says so.

---

## 11. Step 2d — facts summary, card contrast, the macOS media prompt (2026-09-09, operator)

**Asks.** (1) "fix this macOS ask" (the "arxa-studio would like to access
Apple Music…" prompt); (2) the session summary must be what was last done,
never transcript text the operator can read by opening the session; (3) the
cards need a background contrast step.

**Summary = facts (D15).** `session.summary` now returns
`summary: { turnCount, goal, todos: { done, open, lastDone, nextOpen } }` from
dsh's `goal` / `todos` / `turnOutline` units, plus
`activity: { toolCalls, tools[{name,n}], files, filesTotal, commands,
lastCommand, lastTool, lastToolAt }` folded from the session's `tool/call`
surface events (`sessionQuery.readSurface`, optional face) — only leaf strings
leave the host, path args are shortened to their last two segments. The card
renders a key/value facts grid: Goal · Last done · Next · N done / M open ·
Files touched · Commands · Last command · Tools · Last tool · Turns. No prompt
or response text anywhere (pinned: `turn.prompt` / `turn.response` absent from
the client). Sample cards carry the same shape.

**Contrast (D16).** Page ← stat card `--dsw-alias-bg-layer-1` ← session card
`--dsw-alias-bg-layer-2` ← hover / expanded `--dsw-alias-bg-layer-3`, plus a
1 px shadow on each card.

**The macOS prompt — what was established.**
- tccd: subject and responsible process are the sidecar binary
  (`/Applications/Arxa Studio.app/Contents/MacOS/arxa-studio`); prompts recur
  because every repack changes bun's ad-hoc cdhash and tccd logs "Failed to
  match existing code requirement" → the earlier answer is forgotten.
- The prompt has fired all day (17:05, 17:06, 17:23 … before this feature
  existed) — not introduced here.
- Not reproduced from the checkout engine with the REAL home and an fs spy
  preload on every node in the tree (0 reads under `~/Music`, 17/17 smoke,
  no tccd request), nor on the last app relaunch with the spy injected through
  `launchctl setenv` (child spawns logged: git, /usr/bin/security keyring
  probes, which flutter/dart, sandbox-exec probes, `arxa memory recall`; none
  touched Music; no prompt in that 45 s window). `arxa memory recall
  --project /` run by hand: no prompt. A trivial bun-compiled binary: no prompt.
- What that leaves: a non-node child during a phase the spy did not cover, or
  the desktop shell's own request attributed to the sidecar. Pinning it needs a
  root file trace (`sudo fs_usage -w -f filesys | grep Music` while the app
  boots) — outside what this session can run.
- Done anyway: `scripts/pack-sidecar.mjs` signs the sidecar after the build
  with `ARXA_CODESIGN_IDENTITY` when set (a self-signed code-signing cert or a
  Developer ID keeps TCC's answer across repacks) and ad-hoc with a fixed
  identifier otherwise. The app needs no media-library access, so "Don't Allow"
  is safe and sticks until the next repack.

**Proof.** Smoke: 17/17 OK (facts grid asserted, no transcript text in the summary panel). CI: 105 suites ALL GREEN (dashboard selftest 46, projections 17). payload sha12 `3fb961fddfb3`, dashboard + sidebar files byte-identical, engine
serving 7891. Seen on this relaunch: a DIFFERENT prompt — "access files on a
removable volume" — legitimate (TERRA and MIMI live on external SSDs) and
required; boot parks on "Getting things ready…" until it is answered. Same
mechanism as the media prompt: a repack = a new ad-hoc cdhash = every stored
answer forgotten. A self-signed code-signing identity "Arxa Engine Dev" is
being created in the login keychain so `ARXA_CODESIGN_IDENTITY="Arxa Engine Dev"`
makes the designated requirement certificate-based (stable across repacks).

## 12. Step 3 — tier-1 Activity + Repository cards (2026-09-09)

**Advisor:** consult-mode was over its session budget (28/20) at §9 and no
key budget was restored since; consult skipped and recorded, built on the
plan's own D4/D6/D7 decisions and the git-workspace precedents.

### What landed
- `plugins/arxa-dashboard/lib/repo.js` (new, 120 lines): pure readers over an
  injected `run(args, cwd)` git runner — `reposFor(row)` (org = org repo +
  every `projects/<x>/.git`; category = org repo with the folder as pathspec;
  project = own repo), `dayCounts`, `streaks` (commitDays' rule: today, else
  the run ending yesterday), `weekly` (13 seven-day buckets), `activityOf`,
  `repositoryOf` (files incl. untracked-not-ignored, folders, branches,
  contributors in range, last commit, dirty M/A/D/?, repo count), `timesOf`
  (folder birth time, newest of mtime / last commit), `sinceFor(range)`.
- Host `row.stats` now returns `createdAt, updatedAt, activity, repository`
  and honours `arg.range` (30 | 90 | 365 | all, default 90). Git runs through
  the sidebar host's `importGitWorkspace()` → `runGit` with `allowFail`
  and an 8 s timeout; without git-workspace or a missing folder both groups
  are `{ reason: 'unavailable' }`.
- Client: Activity card = current / longest streak + commits, a 13-week
  heatmap (91 `<rect>`s, fill opacity by count, `<title>` tooltips) and
  weekly bars — inline SVG on theme tokens, no library (D6). Repository card
  = facts grid (same classes as the session facts). Header gains
  "Created <date> · updated <age>" and a 30d / 90d / 1y / All range group
  that refetches `row.stats`. Delivery and Engine still say "soon".
- 27 dictionary keys ×3 (en/pl/fr). `window.__ARXA_DASHBOARD__.version` = 3.

### Defects met while building
- The org repo lists a nested project repo as one untracked entry
  (`projects/peter/`, and `git status` collapses it further to `projects/`
  when nothing under projects/ is tracked) → double-counted files and a
  phantom "1 untracked". Fix: `--untracked-files=all` for status and skip
  any `dir/` entry that holds a `.git` (it is its own repo in the roll-up).
- `runGit` pins the committer identity ("arxa studio"), so a fixture cannot
  set the author through env; the selftest asserts a non-empty author only.
- A doc comment saying "native <title> tooltips" tripped the selftest's
  JSX detector; reworded.

### Proof
- `selftest.repo.mjs` 17 checks over a temp org repo + nested project repo
  + an empty repo + a missing path; `selftest.mjs` +6 pins (73);
  `selftest.projections.mjs` unchanged (17).
- Real TERRA read (read-only, 103 ms for org + Peter): 13 commits / 90 d,
  streak 2, 39 files, 30 folders, 3 branches, repos 2.
- Live smoke: 21/21 OK, two new host asserts (figures present, range
  honoured). Evidence `designs/org-dashboard/evidence/boot-lands-org-1512.png`
  shows the org dashboard with both cards populated from the scratch copy.
- CI + repack + install: see the closing lines of this section.

### Deliberate simplifications (ponytail)
- Heatmap rows are day-of-window, not weekdays (Monday alignment when asked).
- The heatmap and bars always show the last 13 weeks; the range toggle
  drives the numbers (commits, contributors, streak window) — step 7 owns
  the full filter set (D11).
- Git reads are synchronous on the host (same as the git card's streak); an
  org with many projects means one `git log` + `ls-files` + `status` per
  project on select. Measure before caching (§5 risk).

### Closing (2026-09-09)
- CI: `node scripts/ci.mjs` ALL GREEN (incl. the new `selftest.repo.mjs`).
- Repack: payload sha12 `1912a76f0948` (239.7 MB, ad-hoc signed).
- Install: `/Applications/Arxa Studio.app/Contents/MacOS/arxa-studio` replaced
  (rm + cp + chmod + xattr -c + `codesign --force --sign -`), byte-identical
  to the pack; engine extracted to `~/.arxa/engine/1912a76f0948`, the three
  dashboard files identical to the checkout, 7891 serving, no process left
  on the old payload. The real app booted onto project Peter with Activity
  (streak 1 d, 7 commits, heatmap) and Repository (27 files, 22 folders,
  1 branch, clean) populated from the real repo.
- Install lesson: `find Contents -name 'arxa-studio*'` matched a stray
  `arxa-studio.cstemp` (a codesign temp file left by an earlier signing run)
  before the real sidecar — the first copy went into the wrong file. The
  sidecar is exactly `Contents/MacOS/arxa-studio`; address it by name. The
  stray temp was removed from the live app (the `.app.bak` still carries
  its own older copy).

---

## 13. Step 4 — tier-2 figures + the focus heartbeat (2026-09-10)

**Advisor:** consult-mode still over its session budget (28/20, unchanged
since §9); consult skipped and recorded, built on D6/D10/D13.

### What landed
- **Host** `lib/index.js`: verb `session.focus { orgId, sessionId, deltaMs }`.
  It resolves the org through `lifecycle.listOrgs`, proves the id is in THAT
  org's registry through the sidebar's own `sessionsOf` lister, then writes
  through git-workspace's `annotateSession(orgPath, id, { focusMs })` — the
  registry stays the storage of record and no path ever comes from the
  browser. `focusTotal(prev, deltaMs)` is exported and pure: a delta over
  `FOCUS_MAX_MS` (120 s, four heartbeat slices) is **refused**, never
  clamped — a clamp banks the lie. Rows now carry `focusMs`, null when the
  row predates the heartbeat (absent ⇒ null, never zero).
- **Seams (two, both additive):** the sidebar host's picked session `shape()`
  carries `focusMs`, and `window.__ARXA_SIDEBAR__.boundSession()` returns
  `{ orgId, sessionId } | null` for whatever the content area shows (matching
  either dsh's session id or arxa's registry id). The dashboard is never on
  screen while a session is bound, so this is the only way the heartbeat can
  know what the operator is looking at. Snippet + `gen-workspace.mjs --write`.
- **Client** `lib/client.js`: `figuresOf(row)` (tokens, model, tool, engine =
  model + tool, wall span, focus) and `scaleOf(figs)`; every session card
  draws tokens / engine / focus bars scaled across the card; the expanded
  facts add model time, tool time, wall span, focus time and the token split;
  the Sessions card heads with an open / parked / archived donut (inline SVG,
  circumference 100 ⇒ one dash pair is a percent) and the row's three totals.
  14 dictionary keys ×3 (en/pl/fr).
- **The heartbeat** lives beside `Root`, not inside it: it samples on the
  sidebar's own `arxa-sidebar-state` event (~5 s) and on `visibilitychange`,
  banks a slice every 30 s of visible + bound time, flushes on hide and on a
  session switch, and drops anything under a second or over two minutes.
  Registered as one `ctx.effect`; both listeners come off on dispose.

### Defects met while building
- **The plan said `inject: ['timer']`. There is no `timer` service on the
  client.** `@deepseek-ai/cordis-plugin-timer` is a dependency of
  `dsh-app-boot` / `dsh-base` / `dsh-cordis-host-runner` only — nothing on
  the client side provides it, so injecting it would have parked the whole
  dashboard plugin in "waiting" and the Root seam would never publish. The
  constraint behind the line ("never a global timer") is kept more strictly
  instead: the heartbeat owns no timer at all, it rides an event the sidebar
  already emits.
- `annotateSession` stamps `updatedAt` as an **ms number** while creation
  writes ISO, and `figuresOf` fed it to `Date.parse` → `NaN` → no wall span
  ever. Fixed with the same both-shapes read `fmtAge` already used.
- The smoke's page scripts are built with template literals, where `\d` and
  `\s` collapse to `d` and `s`: the new assertions silently tested
  `/^d+s$/` and stripped every "s" from the bar text (`focu 1m`). The
  PRELUDE uses `String.raw` for exactly this reason; the new blocks now
  escape as `\\d` / `\\s`. Found by the lens, not by review.
- **The lens ladder earned its keep.** At 390 px the card grids asked for
  260/300 px tracks and the root scrolled sideways; the header actions sat on
  top of the title. Fixed with `minmax(min(260px,100%),1fr)` and a
  `flex:1 1 240px` title basis so the actions wrap to their own line.
- At 390/744 the lens tab rendered in the **light** theme and the heatmap
  vanished: zero cells were `--dsw-alias-bg-layer-3` on a layer-1 card. Now
  `--dsw-alias-label-primary` at 10 % opacity, which reads on both themes.

### Proof
- `selftest.focus.mjs` (new, 19 checks): `focusTotal` accumulation and every
  refusal, then the heartbeat itself **run** in a stubbed browser with a
  frozen clock — nothing bound ⇒ nothing posted, partial slice held, 30 s
  slice posted, hide banks the open slice, hidden time never claimed, session
  switch flushes first, a six-hour gap dropped, dispose leaves no listener.
- `selftest.mjs` +9 pins (61); `selftest.projections.mjs` 17;
  `selftest.repo.mjs` 16. `node scripts/ci.mjs` ALL GREEN.
- Live smoke `scripts/dashboard-smoke.mjs` 30/30 OK (was 21), with eight new
  asserts: focusMs null before any heartbeat, 30 s + 45 s accumulating to
  75 s, the figure persisted in `.git/arxa/sessions.json`, served back by
  `row.sessions`, a delta over the cap and a non-number both refused, a
  session outside the org refused, and **nothing written by a refused
  heartbeat**.
- Lens evidence in `designs/org-dashboard/evidence/`:
  `tier2-session-figures-1512.png` (donut + totals + bars + the banked focus
  and wall-span facts) and the viewport ladder `tier2/sessions-card-{390,744,
  1280}.png` (donut, totals, bars, no sideways scroll at any rung).
- Installed app (read-only check, no write to a real registry):
  `session.focus` answers `org-not-found` rather than `unknown-action` (the
  new binary is serving), `row.sessions` carries `focusMs` on the real TERRA
  row (`null` — no heartbeat has run yet), the page publishes
  `boundSession()`, and `installed-tier2-1512.png` shows the tier-2 card on
  the real app.

### Deliberate simplifications (ponytail)
- Focus is wall-clock attention on a visible window, not eye tracking: a
  visible window behind another app still counts. Idle detection when it
  matters.
- A slice is dropped, not shortened, when the gap exceeds two minutes; the
  operator loses at most one slice per sleep/wake.
- Bars scale across the cards of one row, so a single-session row always
  draws full-width bars — the value sits beside every bar.
- The wall span is `createdAt → lastPromptAt/updatedAt`, so any annotation
  (including a heartbeat) extends it. Per-turn spans wait for
  `sessionQuery.listEvents` (§7).

### Closing (2026-09-10)
- Repack: payload sha12 `a3dfd44e721a` (239.8 MB, ad-hoc signed).
- Install: the engine runs under the user LaunchAgent
  `solutions.arxadigital.arxa.engine`, whose `KeepAlive.PathState` respawns
  it the moment it dies — killing the process just restarts it. The install
  is `launchctl bootout gui/$UID/…` → copy → `chmod 755` → `xattr -c` →
  `codesign --force --sign - --identifier solutions.arxadigital.arxa.engine`
  → `launchctl bootstrap gui/$UID …`. No `.cstemp` stray this time.
- The operator's own registry is untouched: the first real focus slice lands
  when they next sit in a session for 30 s.

---

## 14. Step 4.5 — the reference restyle (grilled 2026-09-10, operator)

The operator brought a reference dashboard (bank/finance layout: hero +
chip toolbar, unequal cards, one accent-filled card, payment cards as a
horizontally scrolling stack, big figures with delta chips) and asked for its
*grammar* — layout, motion, card shapes — over arxa studio's own palette.
Grilled question by question; every answer below is theirs.

**Sequencing (Q1).** The restyle lands BEFORE plan steps 5–8. Steps 5–8 add
cards; born into the old grid they would be written twice.

**Scope.** Visual + interaction only. No host verb changes, no new data —
except the two additive sidebar seams the nav pills need.

### Decisions

- **Q2 — header splits in two.** Hero row: eyebrow (`ORGANISATION · TERRA`),
  name at 28px, `created · updated`, and exactly one filled pill
  (`+ New session`) on the right. Toolbar row beneath: range chips + Refresh;
  step-7 filters land here. No search box (the sidebar owns search).
- **Q3 — the reference's top nav pills become in-org dashboard navigation**:
  `Overview · Projects · Notes · Meetings · Account · Communications` — the org
  plus its five fixed docks, a fixed row that never reflows. A project
  selection lights `Projects`; projects are reached through the sidebar (that
  list is unbounded). Active pill = `--dsw-alias-label-primary` fill +
  `--dsw-alias-label-primary-inverted` text — the reference's black pill. NOT
  the accent: cyan is spoken for.
- **Q4 — a 12-column bento, and it must sum to 12 at every rung.** 1280:
  Sessions `12` / Activity `5` + Repository `4` + Time `3` / Delivery `6` +
  Engine `6`. 744: `12` / `6+6` / `6+6` / `12`. 390: everything `12`.
  Operator's rule, verbatim intent: *no negative space between cards when
  resizing — they must all fit the grid, height and width*. Rows stretch to a
  common height (`align-items:stretch`) and each card is a flex column whose
  last block takes `margin-top:auto`, so a short card fills instead of leaving
  a dead bottom. The lens ladder asserts it.
- **Q5 — session cards are a fanned hand.** 264×166 (credit-card ratio) tiles
  overlapping ~28px, each next card ON TOP, so what peeks from behind is each
  card's LEFT spine — and every peeking card is a real session, never a
  decorative ghost. The session name runs vertically up that spine
  (`writing-mode: vertical-rl`, Baseline since 2017; `sideways-lr` is still
  experimental on MDN, so it rides `@supports` as an upgrade). Full name always
  in `title` + `aria-label` — rotated text is never the only copy. Face: state
  chip, big tokens figure, `turns · age`, and a 3-segment magstripe
  (tokens/engine/focus) bled into the bottom corners.
- **Q7 — the expanded summary opens BENEATH the rail**, full width of the
  Sessions band, one at a time, `grid-template-rows: 0fr→1fr`. Inline
  expansion would have to shove the fan apart; an overlay would hide the
  dashboard the operator clicked from.
- **Operator addition — one rail, three consumers.** `Card({title, span,
  scroll:'x'|'y'|'none'})` is reusable and any card whose content outgrows its
  bento height SLIDES rather than growing or truncating ("so that we have good
  white space"). The same `aXa_db_rail` primitive serves the nav pills'
  overflow, the session hand, and card content, on either axis.
- **Q6 — the 3-col card is Time, not Totals.** Ring = model / tool / focus,
  centre = the row's total in human units. Org, dock and project rows all roll
  up over their own sessions. The open/parked/archived donut demotes to count
  chips in the Sessions header: three small integers never earned a chart, and
  it was sitting in the slot the durations should have had. Streak stays in
  Activity with the heatmap.
- **Q8 — six motion moves, nothing else**: card mount (fade + 6px rise, 30 ms
  stagger, capped at 6), row switch cross-fade, scroll-driven lift on the
  snapped card, detail-panel slide, card hover lift, and bars/gauge filling
  from zero ONCE on first paint (never on refresh). House grammar only —
  `var(--ds-ease-in-out)`, 0.12–0.2 s — and every stylesheet ends in the
  `prefers-reduced-motion: reduce` block the sidebar already established.
  **Number count-up refused**: theatre over real figures, and a rAF loop for
  zero information.
- **Q9 — the reference's signatures, only where they are honest.** Delta chip
  = commits this window vs the previous EQUAL window (`—` when there is no
  prior window). The weekly bars become the reference's area line with one
  label pill on the peak week — same series, re-skinned. **Accent fill means
  LIVE and nothing else**: the running session card is filled, and the Time
  card fills only while something is running in that row. A permanently
  coloured card is decoration that lies about status.
- **Q10 — tokens ship as the four-bucket split** (uncached input / output /
  cache read / cache write), which is what we actually have per session and
  per row.

### Read before answering the per-model question (`read-the-damn-docs`)

The operator asked whether per-model token usage could come from the usage
ring. Sources read, not remembered:

- `@deepseek-ai/dsh-token-meter/lib/index.js:305-341` — the `tokenUsage`
  projection. State is `{totals, last}`; `apply()` consumes
  `assistant/chunk`(usage) and `assistant/message`, buckets into four
  counters, and **discards every other field on the event — there is no model
  dimension**. `wire.view = (state) => state.totals`.
- `@deepseek-ai/dsh-api-session-controller/lib/index.js:1625` —
  `sessionListMetadata` is `{blank, lastPromptAt}`. No model.
- `@deepseek-ai/dsh-session-stats` — turns, steps, llmMs, toolMs, ttftMs,
  decodeMs. No model.
- `plugins/claude-code/lib/usage.js` — the usage ring. It is the
  provider-status pill fed by Claude's own `/usage` (`Query.usage_…()`):
  plan-quota **utilization percentages** for the 5-hour and weekly windows plus
  server-labelled per-model weekly buckets (`model_scoped[].display_name`).
  Account-wide, at this instant, in percent. Not token counts, not
  attributable to a row, a session or an org, and not historical.

So the ring cannot feed a row dashboard: different axis, granularity and unit.
True per-model tokens need a NEW dsh projection keyed by the routed model off
the `llm` route on the event (new projection key, stateVersion, cache row) —
**its own plan step, not this one**. The cheap alternative — grouping sessions
by "the model the session was configured with" — was refused: a mid-session
model switch misattributes the whole session, and no session-meta model field
exists to key on anyway.

### Ceilings (ponytail)

- The shipping shell is **WKWebView / system WebKit 624** (`otool -L
  /Applications/Arxa Studio.app/Contents/MacOS/arxa-desktop`), while `arxa
  lens` drives headless **Chrome**. Lens-green is therefore NOT app-green for
  bleeding-edge CSS. Every modern effect (`animation-timeline: view()`,
  `sideways-lr`) is `@supports`-gated with a flat fallback, and the installed
  build is verified separately, as in §13.
- **Wall time does not roll up.** Concurrent sessions overlap; summing spans
  invents hours nobody worked. Wall stays per-session and the card says so.
- Focus reads `—`, never `0`, until heartbeats accrue.
- Delivery and Engine stay styled empty states until steps 5–6.

### Gates

Each stage: plugin selftests → `node scripts/ci.mjs` → `node
scripts/dashboard-smoke.mjs` (extended with x-scroll, **y-scroll** and
no-scroll cards, and a no-hole assertion) → `arxa lens` ladder
390/744/1280 with every PNG read back → repack + installed verify.

### What landed (build, 2026-09-10)

Host — `plugins/arxa-dashboard/lib/repo.js`: `previousWindow()` counts commits
in the window before this one (`--since=2n days --until=n days ago`) and
`activityOf()` carries it as `prevCommits`. `all` has no previous window: null,
never 0.

Seams — `plugins/arxa-sidebar/lib/workspace-region.snippet.txt`: `orgRows(orgId)`
(the org + its five docks, `[]` on a failed tree) and `selectRow(sel)` (refuses
an unknown org or a non-string rowId, otherwise delegates to the store so
highlight, CTA target and boot-landing memory move together). Client
regenerated with `node scripts/gen-workspace.mjs --write`.

Client — `plugins/arxa-dashboard/lib/client.js`: `Rail` (one scroller, both
axes, `overscroll-behavior:contain`, snap, focusable), `Card({span,title,count,
live,scroll,hook})`, `NavPills`, the hero/toolbar split, the 12-column bento,
`SessionCard` as the bank-card face (spine, chips, tokens figure, magstripe),
`SessionPanel` beneath the rail, `SessionsHead` as chips + totals, `TimeBody`
(model/tool ring + separate focus figure), the area line with a peak pill, the
delta chip, and the six motion moves with the reduced-motion block. Nine new
dictionary keys × three languages.

### Defects met (all found by running it, not by reading it)

1. **Two structural edits deleted live helpers.** Replacing a region by its
   start/end anchors also took `fmtDate` / `dayBack` / `factsGrid` the first
   time and `Rail` / `Card` / `NavPills` the second. Both surfaced as a page
   error in the lens (`ReferenceError`), not in review. Both restored; the file
   now carries an inventory check in the selftest by way of the pins that name
   each component.
2. **The next card covered the chips.** The fan's overlap hid whatever the face
   drew in its right 28px. Fixed with
   `.aXa_db_bank:not(:last-child) .aXa_db_bankFace{padding-right:34px}` (and
   the magstripe inset to match) — the covered strip now holds nothing.
3. **The live Time card printed white on white.** A compound rule
   (`.aXa_db_gaugeVal,.aXa_db_dot{color:#fff;background:#fff}`) gave the value a
   white background. Split.
4. **The gauge's centre label was clipped by its own ring** — moved under it.
5. **The peak pill printed a mangled date.** A regex meant to pull the count out
   of the localised week string kept the year. The pill is the count; the week
   rides a `<title>`.
6. **A divider with nothing above it** — the Time card drew its focus separator
   on rows with no engine time.
7. **`{done} done · {open} open` on screen.** A fact was labelled with its own
   parameterised key, so the label column rendered the raw template. The old
   narrow column had been hiding it. Fixed with a separate label key, and a
   selftest now refuses ANY fact whose label key carries a `{param}`.
8. **A 264 px card in a 206 px rail** meant no card was ever whole at 390 —
   width is now `min(264px,100%)`.
9. **The first hand-scroll assertion was vacuous** (one session ⇒ nothing to
   scroll) and its second draft could not run at 390 because the sidebar is a
   rail there with no tree rows. It now navigates by NAV PILL, which is exactly
   what the pills are for, and proves overlap, vertical spine, real overflow,
   containment, snap and the panel's position in one pass.

### Proof

- `plugins/arxa-dashboard/selftest.mjs` — 72 pins (was 61), including the two
  new seams, the rail/bento/hand/spine/panel/motion contracts, the Time ring's
  model-vs-tool rule and the parameterised-label refusal.
- `plugins/arxa-dashboard/selftest.focus.mjs` — 19, unchanged and still green:
  the heartbeat survived the restyle.
- `node scripts/ci.mjs` — ALL GREEN.
- `node scripts/dashboard-smoke.mjs` — **35 checks, 0 fail**. New: the bento
  ladder at 390/744/1280 measures GEOMETRY (every visual row starts at the
  grid's left edge, ends at its right, carries no gap wider than the grid gap
  and no ragged height) plus rail bounds and axes; the nav-pill pass proves one
  click moves dashboard, sidebar selection and CTA target together; the hand
  pass at 390 proves the fan overlaps, the spine is vertical, the rail scrolls
  and the summary opens beneath it.
- Evidence read back: `bento/bento-{390,744,1280}.png`, `bento/hand-390.png`,
  `nav-pill-1512.png`, `samples-and-tabs-1512.png`,
  `tier2-session-figures-1512.png`.

### Correction to the grill

The grill settled on "Time ring = model / tool / focus". Focus is a **different
clock**: the operator sits with a session while the model runs, so a ring over
all three would total two overlapping axes and claim time nobody spent. Built
as: ring = model vs tool (a true composition of engine time), focus stated
separately beneath the rule with its own figure.

### Closing (2026-09-10)

- Repack: payload sha12 `380f6ef2e45c` (239.8 MB, ad-hoc signed). Installed with
  `launchctl bootout gui/$UID/solutions.arxadigital.arxa.engine` → `cp -f` →
  `chmod 755` → `xattr -c` → `codesign --force --sign - --identifier
  solutions.arxadigital.arxa.engine` → `launchctl bootstrap gui/$UID …`. The
  agent's `KeepAlive.PathState` respawns the engine the moment it dies, so
  killing the process is never the install.
- The first installed run failed every check: the engine was still extracting
  the new payload to `~/.arxa/engine/380f6ef2e45c` and had already rotated the
  desktop token. Waiting for the extraction and re-running gave **ALL PASS** —
  worth recording, because the failure looks exactly like a broken build.
- Installed verification (read-only, WebKit): both seams published, six pills,
  six bento cards, **no holes at any row**, spine `writing-mode` vertical in
  WebKit as well as in the lens's Chrome, hand `overscroll-behavior-x: contain`,
  `scroll-snap-type` on x, Time card present. Evidence
  `designs/org-dashboard/evidence/installed-bento-1512.png` — read back: the
  operator's real TERRA row renders the restyle, the Time card honestly reads
  "No time recorded yet." and the delta chip stays absent (no baseline).
- The operator's registry is untouched: `focusMs` is still `null` on their row.
- Steps 5–8 are unchanged and now inherit this grammar: a new card is
  `h(Card, { span, hook, title, scroll })` and nothing else.

### Revision — the peek is gone (operator, 2026-09-10)

The fanned hand shipped and **did not read as a hand**. Diagnosis before
changing anything: the depth came entirely from
`animation-timeline: view(inline)` with `animation-range: entry 0% entry 100%`,
so (a) with a rail that does not overflow every card is fully "entered" and
sits at scale 1 — nothing recedes; (b) even when it does overflow, `entry`
only touches cards arriving from the right, never the ones at rest; and (c)
the whole rule is behind `@supports (animation-timeline: view())`, which the
shipping WebKit may skip, so the installed app could have zero depth by
design. Overlap with no scale, shadow or dim reads as a crop, not a card
behind.

Grilled: Q1 answered **A — the front card is a SELECTION fact, not a scroll
fact**; then "no vertical text"; then, plainly, **"no more peeking at all —
sessions cards with no peeking at all, just normal horizontal carousel
scrolling."**

Built as asked:

- overlap removed (`margin-left:-28px` gone), the spine element gone,
  `writing-mode` gone, the `view()` timeline gone — **no `animation-timeline`
  survives anywhere in the client**, which also removes the whole class of
  "silently absent on the shipping engine" defect.
- cards sit side by side on the shared rail gap (12px), snap, contained
  overscroll, real `<button>`s, focusable rail.
- face reads horizontally: name (two-line clamp) top-left, chips top-right,
  tokens figure bottom-left, magstripe bled into the bottom corners.
- selected card takes an accent ring, hover lifts 2px. Both killed under
  `prefers-reduced-motion`.
- **running implies open** — two chips saying the same thing had starved the
  name to two clipped lines. The running chip now replaces the state chip.

### Sidebar selection was never wired (same day)

`selectRow()` has written `selectedRowId` since D2 and **nothing in the tree
ever read it**, so neither a row click nor a nav pill left any row marked.
`OrgContainerRow` now derives `isSelected` from the store with the same rowId
shape its own click writes (`""` for an org, the slug for a dock,
`projects/<slug>` for a project) and marks it with the accent: accent text, a
2px inset accent marker, `aria-current="true"` and `data-arxa-row-selected`.
Colour is never the only signal — weight and the marker carry it too.

Gates for the revision: 74 selftest pins, CI ALL GREEN, smoke **35/35**. The
smoke now asserts the OPPOSITE of the fan — `minSeparation >= 0` (a negative
number means cards overlap again), even gaps, and no element in a card with a
vertical `writing-mode` — plus, in the nav-pill pass, that exactly one sidebar
row is marked, that it is the row navigated to, and that it carries
`aria-current`. Evidence: `bento/carousel-390.png`, `nav-pill-1512.png`.

### Closing the revision (2026-09-10)

- Repack: payload sha12 `08ea4f0c4e69`, installed by the same
  bootout → copy → codesign → bootstrap recipe.
- **The repack failed first with `tar: Write error`** — the system disk was at
  **348 MB free**. Cause: `arxa lens` leaves a throwaway Chrome profile per
  invocation (`/var/folders/.../T/arxa-chrome-*`, ~150 MB each) and the smoke
  leaves a scratch org + home per run (`arxa-dashboard-*`). Ten smoke runs had
  banked **4.4 GB**. Cleared; worth knowing before a long gating session,
  because the failure surfaces as a broken pack rather than as a full disk.
- A second, standing cost: `~/.arxa/engine/` keeps EVERY extracted payload —
  eight of them, **5.1 GB**, all but the current one unreachable. Not touched
  here (it is the operator's app data), but it is the first place to look when
  the disk is tight.
- Installed verification, read-only on WebKit: **ALL PASS** — seams published,
  six pills, six bento cards, no holes, carousel cards separate and upright,
  overscroll contained, snap on x, and exactly one sidebar row marked.
  Evidence `installed-bento-1512.png`, read back: the real TERRA row wears the
  accent in the tree, matching the active pill.

### The bottom bars are gone (operator, 2026-09-10)

The per-session magstripe — three segments for tokens / engine / focus bled
into the card's bottom corners — was removed on sight: *"what are those things
at the bottom of the cards sessions? remove those."*

No figure was lost, only a drawing of it. Tokens remain the card's big number;
model, tool, wall and focus are stated in the expanded panel, where they are
labelled instead of guessed from a bar length. `scaleOf()` went with them — it
existed solely to scale those bars against the widest row, and nothing else
called it. Card padding closed up to match.

The smoke now asserts the ABSENCE: `noStripe` (no
`[data-arxa-dashboard-sessionbars]` anywhere in the root) at every rung and in
the tier-2 pass, alongside `faces === bankCards` so each card still carries its
name and figure. The tier-2 pass no longer proves "a bar is drawn" — it proves
the wall span and the banked focus time are STATED in the panel, which is what
step 4 actually promised.

Repack `65bf77a93127`, installed, verified read-only on WebKit: **ALL PASS**.

**Operational note worth keeping:** the installed check failed all seven of its
assertions once more simply because the engine had not finished booting. The
extracted directory appearing under `~/.arxa/engine/<sha12>/` is NOT the same
event as the engine serving. There is now a `wait-engine.mjs` poller that waits
for the token exchange to hand out a cookie before the check runs — the failure
mode looks exactly like a broken build and it is not one.

### The check moved out of the scratchpad (2026-09-10, operator)

The installed check lived in the session scratchpad, which another Claude Code
process wiped once mid-session, and it read the desktop token exactly once —
the two failure modes that cost the most time in step 4.5. Both are closed:

- It is now **`scripts/installed-check.mjs`**, versioned beside
  `scripts/dashboard-smoke.mjs`. `scripts/ci.mjs` does not pick it up (it
  discovers `plugins/*/selftest(.<topic>)?.mjs`), so it stays an on-demand
  post-install gate rather than a CI step that would need a running engine.
- `wait-engine.mjs` is folded into it as `waitForEngine()`: up to 120 × 2 s,
  **re-reading `~/.arxa/dsh/desktop-session.json` on every attempt** because
  the engine rotates the desktop token while it boots. It succeeds on the
  first attempt against an already-serving engine (`waited 0s`) and prints
  `note  waiting for the installed engine to serve…` otherwise. If the wait
  runs out it exits 1 with the last exchange body rather than reporting seven
  unrelated failures.
- Evidence path is now derived from the script location, not hardcoded.

Run after the launchctl recipe: `node scripts/installed-check.mjs`.
Verified against the installed `65bf77a93127`: **ALL PASS**, `waited 0s`.

### Disk (2026-09-10, operator)

`~/.arxa/engine/` had accumulated **nine extracted payloads at ~640 MB each**;
only the live `65bf77a93127` is reachable — the LaunchAgent runs one. The lens
and the smokes also leave throwaway scratch under `$TMPDIR`: **4 378
`arxa-*` directories, 3.7 GB** (Chrome profiles, scratch orgs and homes from
every smoke/CI run ever). Together ~8.7 GB against 4.2 GB free.

Neither directory is cleaned by anything today. `arxa lens` and the smokes
should remove their own scratch on exit; until they do this is a manual sweep:

```sh
ls -1 ~/.arxa/engine | grep -v "$(ps -eo command | grep -o '\.arxa/engine/[0-9a-f]*' | head -1 | cut -d/ -f3)" | sed "s|^|$HOME/.arxa/engine/|" | xargs rm -rf
find "$TMPDIR" -maxdepth 1 -name 'arxa-*' -mmin +60 -print0 | xargs -0 rm -rf
```

**ponytail:** a manual sweep, not a reaper. Add a reaper to the lens teardown
if this bites a third time.

---

## 15. Steps 5–8 — Delivery, Engine, filters, docs (2026-09-10)

Research fanned out to three subagents (github-link surface, the engine file
contract, the docs house style); the decisions and the code stayed here.

### Step 5 — Delivery (D130/D133/D142)

`plugins/arxa-dashboard/lib/delivery.js`, verb `row.delivery`, card body
`DeliveryBody`. Pure over injected `g` (github-link), `gw` (git-workspace) and
a JSON reader, so `selftest.delivery.mjs` drives it with fakes and the host
never reaches the network itself.

- **Reached through the SIDEBAR host**, not a private import: `sb.getGithub()`
  and `sb.mainChecksFor()` already exist there (D111/D116) with their own 30 s
  per-repo cache. The dashboard adds no second GitHub client.
- **Figures:** CI state on `main` per repo (from `prChecks`, which returns
  `green | red | pending | none` or null), and the workflow success rate over
  the last 20 runs on `main` (from `workflowRuns`). Roll-up: the WORST CI state
  wins for an org — one failing repo makes the org red — and the rate is the
  mean of the repos that have one.
- **Connect-state:** `unavailable` (no service), `not-linked` (no grant),
  `relink` (`relinkRequired`, carrying the reason), and per-repo `local-only`
  (no `repoOwner`, or `localOnly` in the manifest — that repo is never queried).
- **Cache:** module-scope Map keyed `owner/name#branch`, `RUNS_TTL_MS = 60_000`,
  and ONLY the toolbar refresh button sets `fresh: true`. Selecting another row
  reads the cache.
- **Ceiling:** `MAX_REPOS = 8`. An org with more repos fetches the first eight
  and SAYS how many it skipped, rather than spending twenty API calls on one
  render.
- **Absent ⇒ null:** a repo whose run list could not be read reports
  `runs: null`; a repo with no runs reports `rate: null`, never `0%`. An
  in-flight run counts in `total` and in neither `ok` nor `failed`.
- **The database boundary holds:** github-link is per-user — the user's own
  OAuth grant, token in the OS keyring, no Arxa Digital Solutions service in
  the request path. Unlinked is a rendered state, not a broken card, and the
  tier-1 local git figures beside it are unaffected.

**ponytail:** CI + run rate only. Pull requests belong to the git card, which
already owns the review flow; add a PR figure here when it is asked for.
Review latency is not obtainable without extending github-link's GraphQL query
(the PR's own `createdAt`/`mergedAt` are not fetched today) — recorded, not
guessed at. Releases and deployments have no API call anywhere in the codebase.
GitHub rate limiting has **no constant to detect it with** anywhere in
github-link — a 403 rate-limit is indistinguishable from a permissions 403, so
it currently reads as `runs: null` rather than a fabricated state.

### Step 6 — Engine (D131/D141)

`plugins/arxa-dashboard/lib/engine.js`, verb `row.engine`, body `EngineBody`.
Pure over an injected `readJson`, so `selftest.engine.mjs` runs it on a fake
filesystem.

- **Read, in `StateReader` precedence:** `pipeline/state/run.state.json`, else
  `pipeline/state/default.state.json`; `pipeline/state/deploy-ledger.json`;
  `design/structure.json` (else `structure.json`).
- **Phase order** is the engine's own: intake, prototype, design, scaffold,
  review, build, deploy. A phase the engine does not know is refused, not
  passed through.
- **Per project:** phase + position, the current phase's gate `status` and
  `attempts`, `dirty`, `review.rejections`/`approved`, `targets`, `updatedAt`,
  `screens` and `flows` from structure.json, `shipped`/`halted` from the ledger.
- **Org roll-up:** the LEAST advanced project is how far the org actually is.
- **`evidence/` is never walked** and neither is `memory/events.jsonl`: one lens
  smoke is 1.5 MB of PNGs per project and the event log rotates at 50 MB. A
  roll-up costs a handful of KB per project. A selftest refuses any directory
  listing or log read in that file.
- **Absent ⇒ null:** no `pipeline/` means `phase: null`, not `"intake"`, and
  `shipped: null`, not `0`. Only a literal zero inside an existing state file
  (`initPipeline` writes `rejections: 0`) is reported as zero.
- **Reality check:** the survey found **zero projects with engine artifacts** on
  this machine — TERRA and MIMI have none, and the engine repo's own dogfood app
  has `structure.json` but has never run the FSM. So the state the operator will
  actually see is `not-set-up`, and that is a designed, translated state.

**Correction to plan §5.** The risk list said the Engine group would be *hidden*
on category rows. Hiding a card leaves a hole in the twelve-column bento, which
the operator ruled out ("no negative space when resizing"). Category rows now
render `not-applicable` instead. The later constraint wins.

### Step 7 — Filters, drill-downs, tooltips, keyboard order (D137)

No new toolbar chips were added: **the state counts in the Sessions head ARE the
filter.** Clicking "parked 3" is the drill-down into parked; clicking it again
clears it. The head keeps counting EVERY session while only the carousel is
filtered — a filtered view that also changes its own totals cannot be reasoned
about. A filter that matches nothing says so rather than drawing an empty rail,
and the filter (and any open summary) is cleared when the row changes, because a
filter belongs to the row it was set on.

Keyboard order, on the rail primitive rather than a new scroller: the rail is
ONE tab stop, `ArrowLeft`/`ArrowRight` walk the cards inside it, `Home`/`End`
jump to the ends, and `Escape` closes the open summary. Every interactive chip
carries a tooltip naming what clicking it does.

### Step 8 — Docs

- `CONTEXT.md` gains **Selected row** and **Dashboard** (append-only glossary,
  house style: `- **Term** — …`, D-numbers cited inline, no file paths).
- `docs/plans/arxa-studio-grill-decisions.md` gains
  **`## Organisation row dashboard (2026-09-09/10 grills)`** with **D127–D147**,
  continuing from D126. The plan's local D1–D16 map to D127–D142; the §14
  restyle grill adds D143–D147.

### Gate

`node scripts/ci.mjs` ALL GREEN · dashboard selftests: 84 + 19 focus + 32
delivery + 29 engine · `node scripts/dashboard-smoke.mjs` (see the closing note
below) · installed check `node scripts/installed-check.mjs`.

### Closing (2026-09-10)

- Repack: payload sha12 `387abbb38417` (239.8 MB, ad-hoc signed). An earlier
  pack of the morning's tree (`cafe739941ef`, 14:18) was superseded before
  install — the smoke refreshed the evidence PNGs between the two packs, and
  the payload tar carries them.
- Install: the standard bootout → copy → codesign → bootstrap recipe. The
  installed check against `387abbb38417`: **ALL PASS** — seams published, six
  pills, six bento cards, carousel separate and upright, overscroll contained,
  one sidebar row marked, Delivery stating `ci=green, rate=50` over the
  operator's two linked repos, Engine `not-set-up` (correct: no project has
  engine artifacts), filters pressable.
- **A swapped engine serving is a third event, after install and after
  extract.** The first check run spent its whole 240 s window on
  ECONNREFUSED: the first boot after a payload swap re-materialises the
  profile before it rotates the desktop token — bootstrap 14:24 → first
  cookie 14:49, **26 minutes** on this machine (a check started mid-boot
  measured 317 s of it). `waitForEngine` is now 900 × 2 s with a
  per-minute progress note — raised the same day; one failure condition, no
  second mode, and an agent running it should give the tool call a
  40-minute ceiling of its own.
- **The lens died on a compiler, not on the app.** Mid-check the operator's
  palette session was editing `../arxa` live: the `arxa` wrapper rebuilds on
  staleness, their in-flight tree did not compile (a generated file not yet
  emitted), and every `arxa` invocation — lens included — exited non-zero.
  The check's failure detail printed EMPTY because its filter matches lens
  output, not compiler errors. `ARXA_FAST=1` (the wrapper's own tool-call
  escape) ran the last good binary and the check passed. The check
  deliberately does not set `ARXA_FAST` itself — it wants a fresh lens — but
  its detail filter should learn the words `Error:` and `rebuilding`.
  Recorded, not patched: the tree next door was someone else's live work.
- Gates: `node scripts/ci.mjs` ALL GREEN · smoke 36/36 OK (the §7 filter and
  boot-after-open passes included) · installed check ALL PASS.
- Disk at pack time: 4.0 GB free — the §14 tar failure did not recur (the
  operator had swept `~/.arxa/engine`; it holds only live payloads).

### Defect — "notes is not being synced in the sidebar" (operator, 2026-09-10)

**Symptom.** Selecting Notes moved the dashboard but left the sidebar tree
unmarked. Projects, Meetings, Account and Communications all marked correctly,
so it looked like a Notes-specific data problem.

**It was not a data problem.** The host reports the docks like this
(read live off the operator's TERRA):

| dock | workspace | containers |
|---|---|---|
| projects | false | null |
| **notes** | **true** | **[]** |
| meetings | false | scheduler, notes |
| account | false | receipts, invoices, subscriptions, profile |
| communications | false | emails, messages, comments |

`notes` is the only dock with no containers, so it is the only one the host
reports as `workspace: true`. `buildEmit` skips exactly those:

```js
for (const d of tree.docks) {
  if (d.workspace) continue;      // ← notes never becomes an OrgContainerRow
```

With no emit entry, `ARXA_IS_CONTAINER_GROUP` is false and the row renders as
the **stock `ProjectRowItem`**. The selection mark added in step 4.5 lives only
on `OrgContainerRow` (`data-arxa-row-selected` appeared exactly ONCE in the
generated client, inside that component). `ARXA_SELECT_WS` had always been
setting `selectedRowId` for notes — which is why the dashboard followed the
click. Only the drawing was missing.

The same held for every DEEPER workspace row: `notes/<sub>`,
`meetings/scheduler`, a project container.

**Fix.** One helper + one generator splice, mirroring the click splice that was
already there:

- `ARXA_WS_SELECTED(workspaceId)` in the snippet, reading `selectedRowId`
  straight off the store the way `ARXA_WS_HIDDEN` reads collapse state (the
  tree re-renders on every store emit, so it needs no subscription).
- `scripts/gen-workspace.mjs` extends the `ROW_TOGGLE` splice to add
  `aria-current`, `data-arxa-row-selected` and the same accent + weight + 2px
  inset marker to the stock row.

A double mark is structurally impossible: `ARXA_CONTAINER_ROWS` and the stock
`ProjectRowItem` are the two arms of one ternary on `ARXA_IS_CONTAINER_GROUP`.

**Why the gate missed it.** `navPillScript` clicked
`pills.find((p) => !p.className.includes('navPillOn'))` — on boot that is
always **Projects**, a container dock. The one dock rendered by the other code
path was never selected by any test. The pass now walks EVERY pill and asserts
exactly one marked row for each.

**Verification status.** Failing pin written first (it failed), then the fix
(it passes); `node scripts/ci.mjs` **ALL GREEN**. The lens half is **not yet
run**: `arxa` cannot compile right now — `arxa/lib/gate_design_palettes.dart`
imports `design_palette_index.dart`, which does not exist yet — in-progress
palette work in the sibling repo, untracked and unrelated to this change. The
every-pill assertion is committed to the smoke and must be run once `arxa`
builds again.

### Install stall — first boot under launchd (2026-09-10)

Verified after the Notes fix. Two facts worth keeping:

- **Disk.** `~/.arxa/engine/` had eleven extractions (7.0 GB, 2.6 GB free). Ten
  removed, only the live one kept → 9.1 GB free. Each install adds ~650 MB;
  the launcher never prunes. `$TMPDIR/arxa-*` still needs a hand (the
  classifier blocks the sweep).
- **First boot after an install stalls.** The LaunchAgent spawned dsh while the
  642 MB payload was still landing: main thread blocked in `uv_fs_open` →
  `open()`, 0 % CPU, 1.0 s of CPU consumed in 13 minutes, last file opened
  `~/.arxa/dsh/.credentials.yaml`. Reproduced twice. NOT the ad-hoc signature
  and NOT TCC (no TCC activity in the log at all) — the same payload booted
  clean from a terminal, and the same LaunchAgent booted clean once the
  extraction was already on disk. `installed-check.mjs` already waits for the
  engine; the wait just has to outlast a cold extraction.

`node scripts/installed-check.mjs` → **ALL PASS** against the real registry:
`delivery: 2 linked repo(s), ci=green, rate=50`, `engine: not-set-up`, and the
sidebar marking exactly one row.

## §16 Live-wiring audit (2026-09-10)

Read-only audit of the INSTALLED engine against independently computed truth,
not against the smoke's fixtures.

| card | live? | evidence |
|---|---|---|
| Activity / Repository | **yes, exact** | dashboard says files 39, branches 3, commits 13; `git ls-files`/`branch`/`log` over the same 2-repo set (TERRA + projects/Peter) says **39 / 3 / 13**. `days` carries the real per-day counts (09-08: 4, 09-09: 9), `weeks` the real 13-week histogram, `current`/`longest` = 2/2. |
| Delivery | **yes, live GitHub** | login `unfazed-dev`, repos TERRA + Peter, 4 workflow runs each, 2 ok / 2 failed, `rate` 50, real `lastAt`, `lastConclusion: success`. |
| Engine | **yes, correctly empty** | `not-set-up` — no project on this machine has `pipeline/state/`. Category rows answer `not-applicable`. |
| Sessions | **yes** | one real registry row, `focusMs: null` (never focused — absent, not zero). |
| Tokens / model time | **NOT exercised** | the only real session has `turns: 0`, `tokens: null`, `llmMs: 0`. Honest values, but nothing proves the figures are wired to anything a model produced. |

### Findings that are not defects of this feature

- **Only TERRA is an org.** `~/.arxa/organisation.json` → `orgs: ["/Volumes/developer_ssd/TERRA"]`. MIMI
  (`/Volumes/business_ssd/MIMI/MIMI`) is not registered, so no dashboard has ever
  rendered against it. Left alone — the operator's registry is theirs.
- **The live registry carries smoke litter.** `names` holds ~12 entries under
  `/tmp/arxa-d90-smoke/…` and `/tmp/org-purge-smoke-…`, and `workspace.json` holds
  10 worktrees under `/private/tmp/arxa-d90-smoke/…`. Earlier smokes wrote into the
  REAL home. This smoke does not (scratch `ARXA_HOME` + copied org), but the
  leftovers are still on record.
- `prevCommits: 0` on a 90-day range is a **real** zero: git can answer "no commits
  in that window" truthfully for a repo whose history starts 2026-09-08. Not a
  null-vs-zero violation.

### §16.1 The real-turn leg

`ARXA_DASHBOARD_SMOKE_TURN=1` (default OFF) seeds the scratch home with
**GLM 5.3 at `reasoningEffort: max`** (`provider: zai` via `dsh-llm-pi-ai`), then
drives the operator's own path — org row → Notes → session card → Open → type into
the composer → send → wait the answer out — and reads the figures back off the host:

    turns ≥ 1  ∧  llmMs > 0  ∧  tokens.total > 0  ∧  lastPromptAt is a number

The key is never read out of the credential store by the script: the run supplies
`ZAI_API_KEY`, and it reaches the child engine's env only — never the scratch home,
never a log. Ordinary runs still strip every provider key, so the default smoke
costs nothing and needs no network.

### §16.2 The real-turn leg false-greened once (2026-09-11)

First run with a real key: the lens leg said the conversation "answers", the host
said `turns 0, llmMs 0, tokens null, lastPromptAt null`. The host was right — both
scratch transcripts held only setup events (`permission/preset`, `sandbox/mode`,
`approval/policy`, `session/title`). **No message of any kind was ever sent.**

Root cause: two worthless signals.

1. *"the box no longer holds my text"* — a React re-render clears a composer just
   as well as a send does.
2. *"document.body.innerText grew by 8 characters"* — a clock tick does that.

Compounded by the target: the leg picked "the tallest visible editable box", which
is the SIDEBAR's composer card, not the conversation's.

Fixed by proving the turn the way the transcript would: take the composer from
dsh's own slot (`conversation.composer` / `conversation.input`), require the prompt
to APPEAR in it, require it to POST as a message, and require the answer to be a
NEW message element — never a text-length delta. Every exit carries facts.

A dry run with a deliberately bad key then proved the driver end to end:

    request/header  { provider: "zai", model: "glm-5.3", reasoningEffort: "max" }
    turn/end        { error: 401 "token expired or incorrect", code: AUTH }

— so **GLM 5.3 at max really is the model the turn spends** (evidence, not
assumption), and the flow reaches the provider. The host then read back
`turns: 1`, `lastPromptAt: 1789049922964`, with `llmMs 0 / tokens null` because the
call 401'd. That is the correct shape for a failed call.

That dry run also caught a second defect: the prompt posted **doubled**
(`…PONGReply with exactly one word: PONG`) because the "did my text land?" check
read only the queried node while `execCommand` had inserted into its child, so the
fallback typed it again. The check now reads the whole composer region. Re-verified:
`PROMPT SENT: 'Reply with exactly one word: PONG'` — once.

Still outstanding: one run with a valid key, to see `llmMs > 0` and a real token count.

### §16.3 The lens depends on a repo nobody here controls (2026-09-11)

A real-key run died at `bento-1280` — pass 30 of 36, with the operator's key
already in play — and the failure had nothing to do with the bento:

    lib/arxa_dial.dart:563:7: Error: The non-abstract class 'SupabaseDialStore'
      is missing implementations for: DialStore.readOverlay, DialStore.writeOverlay
    Error: AOT compilation failed

`arxa` is a SIBLING repo, it is edited while this smoke runs, and `arxa lens`
re-AOT-compiles it on every invocation. Passes 1–29 compiled fine; a file was
saved half-written between two shots. Minutes later `arxa lens --help` compiled
again — the breakage was purely transient.

Handled, not worked around: a shot whose output carries `AOT compilation failed`
waits 20 s and runs once more, and if it still fails the message says
*"arxa does not compile — the lens could not run (sibling repo mid-edit)"*
instead of blaming the card. A toolchain state must never read as a dashboard defect.

### §16.4 tokens: null was a real defect (2026-09-11)

The operator ran a real GLM 5.3 turn in the SHIPPING app and sent the screenshot.
Its own status bar: `1 turns · 1 steps | LLM 7.4s | TTFT avg 5.7s | Input 14.6K tok
· Output 277 tok`. The dashboard, for that same session, said:

    turns 1, steps 1, llmMs 7402, ttftMs 5722   ← exact
    tokens: null                                 ← wrong

**Root cause.** `readValues` returned the live checkpoint the moment it was
non-empty. That checkpoint is a VIEW: `viewCheckpoint` (dsh-session-projection)
skips every projection whose `wire` is undefined, and `tokenUsage` is one. The
durable record on disk held `uncachedInputTokens 14627 / outputTokens 277` and was
never consulted. Live winning was right; live winning *by erasure* was not — a key
the live view never served is not evidence of absence, and absence is exactly what
turns a real figure into a null.

**Fix.** Merge per key: durable row first, live values over the top. Live still
wins wherever it actually served a key; it can no longer delete one it didn't.
Verified on the installed app against the screenshot — `total: 14904` (= "Usage
14.9K tok"), and `createdAt`/`cwd` stopped being null for the same reason.

**Not fixed, stated instead.** Mid-session, before dsh flushes the cache, tokens
are still null: `stateOf` looked like the way to read the raw cell, but on a live
engine it yielded nothing and the reason was not established, so it was removed
rather than shipped unproven. The smoke's turn leg therefore asserts turns, model
time and prompt timestamp — the token path is proven on the installed app above.

Full smoke with a real turn: **38 OK, exit 0**, `turns=1 llmMs=5320`.

---

## §17 The Engine card, on bytes the engine wrote (2026-09-11)

§16's audit table graded Engine **"yes, correctly empty"**. That grade was as far
as the evidence went: no project on this machine has ever run the FSM, so every
run of every gate had exercised exactly one branch — `not-set-up` — and the
populated branch, the whole point of tier 4, had never rendered once. Its 29
selftests all ran on JSON the selftest itself invented, which proves the reader
and says nothing about the *contract*.

### The contract, checked against the engine's own output

The FSM was driven for real out of `arxa/lib/pipeline_fsm.dart` — `initPipeline`
(targets macos+web) → `recordPhaseStatus(intake, pass)` → `advance` →
`recordPhaseStatus(prototype, fail)` then `(pass)` → `approvePrototype` →
`advance` → design pass → `advance` → scaffold pass → `advance` →
`reviewVerdict(reject)` → `markDirty`. The ledger came from
`arxa deploy --self-test` (`deploy.dart _recordLedger`) and structure.json is
the engine repo's real `mobile_flutter/design/structure.json`.

Result: **the file contract holds, field for field.** `phase design`, `step 3/7`,
gate `ready`, `attempts 1`, `dirty true`, `rejections 1`, `approved false`,
`targets [macos, web]`, real `updatedAt`, `screens 8`, `flows 2`, `shipped 1`,
`halted 0`. Three things worth writing down:

- **`initPipeline` writes `default.state.json`, not `run.state.json`.** The
  reader's precedence (run first, then default — gates.dart `StateReader`) was
  right, but the file the FSM actually creates is the *fallback* one. A reader
  that had only ever been tested on `run.state.json` would report nothing on a
  real project.
- **`halted: 0` here is a real zero** — the ledger exists and has no halted row.
  A project with no ledger still reports null. The rule holds on real bytes.
- The state carries `schema`, `approvalTokens`, `humanApproved`, `createdAt` and
  `designHash`; none of them reach the card. Pinned as a check, so a future
  reader that starts passing the state through fails here.

Those bytes now live in `plugins/arxa-dashboard/engine-authored.fixture.json`
(its `_how` names the calls that produced each file) and have **one** consumer
shape: `selftest.engine.mjs` reads them through the fake filesystem (29 → 35
checks), and `scripts/dashboard-smoke.mjs` writes the same three files into the
scratch org's first project. One source, so the reader and the card can never be
proven against different evidence.

### What the card actually draws

`designs/org-dashboard/evidence/engine-card-1512.png` — the first time this card
has rendered anything but the not-set-up line: **Design** / Phase · **1**
Projects with runs · **1** Shipped, the project row `Peter — Design · 3/7 ·
8 screens · 28m ago`, and beneath it *"1 more scanned, none of them has run the
engine"* — the org root, honestly counted, not silently dropped.

Smoke: **39 OK, exit 0** (was 36) — `row.engine` on the org row, `row.engine` on
a category row (`not-applicable`), and the rendered card.

### Two defects met on the way

- **A lens script that throws reported a BLANK reason.** `Identifier 'rows' has
  already been declared` — PRELUDE owns `rows`, and the new script redeclared it
  in the same scope. The lens exited 255 with `CdpException` in the transcript,
  but `lensFails` only matched `expect not truthy` / `selector not found` /
  `console/page error`, so the FAIL line printed the label and nothing else.
  `lensFails` now names `CdpException`/`SyntaxError`/`Unhandled exception` too.
- **Green evidence that showed nothing.** The card is last in the bento; at
  1512×900 the shot cropped it off entirely while the assertion passed against
  the DOM. The shot now scrolls the card into frame and captures at 1512×1000 —
  a PNG that proves the assertion to a human, which is the only reason it exists.

### Not done, stated

The seed is written into the smoke's **copy** of the org, never the operator's.
Nothing here makes a real project run the engine — when one finally does, this
leg is what says the card will be right about it. `ponytail:` the fixture is
pinned bytes rather than a live Dart run, because a selftest that needs the Dart
SDK stops being runnable in CI; re-pin when `pipeline_fsm.dart` changes shape.

---

## §18 The Activity card's dead band, filled (2026-09-11, operator)

The operator's screenshot: the span-5 Activity card held two FIXED-width SVGs
(heatmap 169×91, weekly line 169×40) left-aligned in a ~420px body — a dead band
right of the charts, plus stretch space below (the bento row sizes to its tallest
sibling). Proposed a menu, operator took the recommendation as-is:

| fill | cost | honest shape |
|---|---|---|
| **Weekday strip** — Mon–Sun bars off the SAME `days[]` the heatmap drew, Busiest caption | none — pure client transform | zero-count weekday draws a stub, never a gap |
| **Active days** — `days.length / range` | none | `all` range prints bare count |
| **Churn** — `+{a} −{r} lines` from `log --numstat` | one git call per repo | no commits in window ⇒ null, never 0/0; binary `-/-` rows skipped |

`churnOf` in `lib/repo.js`; strip + figure + churn line in `ActivityBody`
(`aXa_db_chartRow` puts the strip BESIDE the chart column, not under it — that
was the point). 11 new keys × en/pl/fr. Not proposed, stated: turns/focus (the
Sessions card owns them), engine/delivery figures (their own cards).

Evidence `evidence/activity-fill-1512.png`: 4 figure row, strip beside the
heatmap, `Busiest: W · 9`, `+356 −10 lines`. Some stretch space remains under
the strip when a sibling row is taller — the churn line pins to the bottom
(`margin-top:auto`), the rest breathes. Smoke **41 OK, exit 0**; repo selftest
+3 churn checks (stubbed-git parse, null-on-empty, real-runner payload).

**The disk filled during this work.** `scripts/ci.mjs` went 5-FAIL with ENOSPC
(disk 100%, 139 Mi free) in plugins this change never touched; dashboard
selftests and the full smoke ran clean before the wall. The TMPDIR sweep is the
operator's (classifier-blocked twice this session). The installed engine was NOT
restarted on a full disk — plugins load from the working tree, so a restart
after the sweep is all it takes.

## §19 Sidebar rows that open a dashboard wear its mark (2026-09-11, operator)

Operator ask: tree rows **with a dashboard** show a dashboard icon, not the
folder. Which rows those are was never a new decision — `ARXA_SELECT_WS` tags
`kind:"dock"` for exactly a TOP-LEVEL ws (`notes/…`, `projects/<slug>` stay
leaf picks → guide, not a dashboard) — so the glyph reuses that shape:

- `ARXA_WS_DASH(ws)` = `ws !== "" && !ws.includes("/")` — one predicate, two
  icon sites, so the mark and the click can never disagree.
- `DashGlyph` — 2×2 tile SVG in `OrgGlyph`'s stroke style (15px, 1.3 stroke,
  currentColor), org rows keep `OrgGlyph`, project rows keep folders.
- Sites: `OrgContainerRow` (`d.kind === "dock"`) + the stock workspace row
  (gen-workspace splice 6g on the unique stock folder-icon anchor).

Sources are the generator + snippet (`scripts/gen-workspace.mjs`,
`workspace-region.snippet.txt`); `lib/client.js` regenerated — the drift gate
in the sidebar selftest enforces byte-parity, and a new check pins the
predicate + both sites. The smoke's org-row leg now counts 4-rect glyph SVGs
in the expanded tree (`dashGlyphs >= 3`). Smoke **41 OK, exit 0** ×2; CI
ALL GREEN.

**Ship path (corrects §18's closing line):** working-tree plugin bytes reach
the installed app ONLY via `node bin/arxa-engine-sync.mjs` (content-hash sync
into `~/.arxa/engine/<hash>/arxa-studio`, deletes the `.arxa-seeded` marker)
followed by a sidecar bounce — a restart alone re-seeds the STALE packed
payload. Shipped as `arxa-sidebar: 057983466c25 → b6dd4e7d6ff5`, sidecar
bootstrapped, installed-check **ALL PASS** (fresh evidence
`installed-bento-1512.png`). Reopen an open window to reload the webview.

**Rider (same day, operator): selected icons in the accent too.** The row
text went accent on selection but the icon slot paints its own tertiary
(`.aXa_wsr_slot`), and stock `active` = `group.expanded && containsCurrent` —
a dsh SESSION notion, so a selected dock with no open session stayed grey.
Two gates now: `OrgContainerRow` adds `isSelected && folderActive`; the stock
row OR-extends the stock rule with `ARXA_WS_SELECTED(row.workspaceId)`
(gen-workspace 6g-bis). The nav-pill smoke leg asserts the selected row's
glyph span computes to the same color as the row.

**Rider (2026-09-12, operator): ONE active-row style — the settings-nav
soft-accent fill.** "The way cordis highlights active rows must be a soft
accent color, unified across arxa; the sidebar currently has 2 styles." The
reference was measured live (lens probe on the settings modal): dsh's nav
cell paints `.active { background: var(--dsw-specific-sidebar-nav-item-active) }`
— text untouched, r12, no bar — and that token resolves through the
palette-washed neutral-bluish ladder, so it IS the soft accent in every
theme. The sidebar shipped TWO marks: workspace/org rows an inline accent
bar + accent text + bold (ROW_TOGGLE splice), session rows selected ==
hover gray (`interactive-bg-hover`). Both collapsed onto the nav token:
selected rows (project, session, search, freestyle — the freestyle rows
already carried the `selected` class and inherit the fill) paint
`--dsw-specific-sidebar-nav-item-active`; hover stays hover; the old inline
bar/color/weight are gone (org headers keep their 600). The stock row
gained the `selected` class (generator delta 6h: `(active ||
ARXA_WS_SELECTED(...)) && selected`); the snippet's org row gained
`isSelected && selected`. `data-arxa-row-selected`/`aria-current` stay as
the functional identity, and the accent glyph rider above still applies.
installed-check's lens now gates the fill itself: the marked row must
compute a NON-transparent background with NO box-shadow (`markedFill ===
'filled'` — 'transparent' or 'old-bar' fails). Selftest pins on both
sides (sidebar + dashboard). Shipped as `arxa-sidebar: 813dc2078fb0 →
fccc90323be1`, bounced, installed-check **ALL PASS** ("marks exactly one
row with the unified soft-accent fill"); cropped-screenshot vision
confirms the TERRA row wears the soft tinted fill, reference-style.

### Rider (2026-09-12, operator): the dashboard joins the theme — no ink-black fills

**Report:** "fonts in the dashboard bento boxes are black instead of the
theme font color, the same for the nav bar on top must also match the
theme." Systematic-debugging run, measured before touching anything:

- **Bento TEXT is token-identical to dsh's own UI.** Live lens probe
  (installed app, sage palette #84A98C): `.aXa_db_numVal` ink = resolved
  `--dsw-alias-label-primary` = oklab(0.2257) — the SAME token and value
  the sidebar rows paint. The palette wash reaches the dashboard (tokens
  measured identical at sidebar node and bento node). dsh's own workspace
  bundle paints row titles with the same label-primary tier. There is no
  font-color defect to fix in the cards — the ink is the app's ink.
- **The genuinely un-themed element was the ACTIVE NAV PILL.** Pixel
  measurement of the operator's screenshot: pill fill = rgb(24,24,24)
  (#181818 = the TEXT-INK token painted as a fill) with inverted white
  text — the one solid-black surface on the page, next to an app whose
  active rows all wear the soft palette tint. `.aXa_db_ciRed` had the
  same disease (a CI-failure dot painted with the text ink — black, and
  semantically wrong).
- **Palette archaeology (why the screenshot looked neutral):** the
  engine's stored palette is sage, the screenshot's accent was slate —
  the operator had switched palettes; under a low-chroma accent the 10%
  ink wash is invisible, which is the wash working as designed
  (scope A: labels keep their lightness ladder).

**Fix:** `.aXa_db_navPillOn(:hover)` → the ONE active-row style —
`background:var(--dsw-specific-sidebar-nav-item-active)`, text
`label-primary` (settings-nav/sidebar recipe, rides the palette wash).
`.aXa_db_ciRed` → `var(--dsw-alias-state-error-primary)`. The
accent-filled filter/delta chip keeps `label-primary-inverted` (accent =
selected/live, the stock dsh pressed-control language) — pinned as the
ONLY surviving inverted pair. Selftest: three new theme pins.
installed-check: new `pillOnL` fact — the active pill's computed oklab
lightness must read > 0.5 (the tint ≈ 0.92; the old black pill ≈ 0.23),
gating the pass. Shipped `arxa-dashboard: 0fa2fe63bf80 → 5a0fd0deff53`,
bounced.

**Not done (offered):** making app-wide text VISIBLY palette-hued (a
stronger ink-stop wash in theme-accent's NEUTRAL_MIX) is a one-knob
change to a scope-A-locked ladder — offered to the operator, not taken
unilaterally.
