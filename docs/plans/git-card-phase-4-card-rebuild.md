# Git card — Phase 4 card rebuild + composition harmony with the `cordis` preset

Status: LANDED 2026-09-02 — all of §5 shipped on master; `ci.mjs` 29/29 GREEN.
A1 `ade8f2e` + `43e6167` + `9de6104` (D117) · A2 `eb97bd2` + `5fa0eb1` (D116) · A3 `8a46a4c` +
`6a03469` + `7429dab` · B1–B6 `a89b02e` + `f14576d` + `09b64cf` + `4593b16` +
`ee0b702` (D118) · viewer selftest flake diagnosed test-side, `3370a37` (D119).
Ledger: `git-card-sessions-worktree-rewire.md` D116–D119. Original approval line kept
below for the record.
Was: APPROVED 2026-09-02 ("Approve as written"). Implementation in progress.
Discipline (user-chosen, from the dsh `cordis` preset persona): explore first; ONE
decision-complete plan; implementation only after explicit approval.

## 1. Context

- `git-card-sessions-worktree-rewire.md` Phase 4 (:328-345) "Card rebuild (D105, D101,
  B8)" was never built. Verified against the live card (`workspace-region.snippet.txt:408-521`):
  head / status chips / subject / PR problem+fix / Commit·Push·PR / err. No slides, no
  insight surface, no `frame.wired`/`frame.runner` chips, no wake CTA; dock `order: 20`
  (`selftest.mjs:139` asserts 20).
- Phases 0–3 + D98–D115 landed (`d92a418`); `ci.mjs` 26/26 GREEN; `client.js` is
  byte-identical to `gen-workspace.mjs` output (drift gate `selftest.mjs:184-192`).
- `open-items-completion.md` names the rest as Wave 2 (per-repo merge, `card.pr.merge`,
  B8 chips + wake CTA, `version.mint`, D111 block, order 30) + Wave 3 e2e. Wave 2 is
  the minimal slice; the user asked for the whole Phase 4 (D105 slides + D101 streak +
  insight column).
- Backend pieces already exist and have NO caller: `mergeSessionPr` (`prflow.js:224`),
  `prMergeApi` (`github-link/lib/frame.js:125`), `mintAtStageBoundary`
  (`git-workspace/lib/index.js:104`), asleep classification in `prChecksApi`
  (`frame.js:204-224`), `ensureRunner` (`runner.js:61`), `card.status.frame{wired,
  protection,runner,files}` (`arxa-sidebar/lib/index.js:805`).
- Collision warning (rewire.md:337-340): session `cairn-de` rewriting `arxa-sidebar`.
  Checked today: nothing listens on :7891, no `cairn-de` process. Conformance Phase 2
  "sidebar surgical" is NOT done (no commits) — Phase 4 writes the card conformant, and
  does not attempt the rest of Phase 2.
- The user supplied the dsh `cordis` agent preset as the model of a well-formed
  composition (two planes: HOST composition vs AGENT PRESET). arxa today authors only a
  host profile patch (`profile/cordis.patch.yml`, byte-copied by `bin/arxa-studio.mjs:177`)
  and ships NO preset of its own; three agent-plane rows are forced host-wide there.

## 2. Goal / success criteria

1. The dock card is D105-shaped: 3 hand-built slides (Status · Commit · Approve) + a
   one-line teaser; insights (streak, CI history, sessions) open in the right column.
2. B8 visible: wired/runner chips; runner-asleep wake CTA that works or says why not.
3. `card.pr.merge`, `version.mint`, D111 new-session classification wired; order 30.
4. Conformant: real `--dsw-*` tokens, `t()` for every string (en/pl/fr), side effects in
   `ctx.effect()`, no hand-layered DOM, no JSX, edits only via the snippet.
5. arxa ships an agent preset shaped like `cordis`; the three misplaced rows move there;
   the host patch keeps only host-plane rows. Sessions still get every tool they get today.
6. `ci.mjs` GREEN, drift gate GREEN, new selftests per topic, smoke extended.

## 3. Part A — Card (server: `plugins/arxa-sidebar/lib/index.js` table at :657)

### A1. New / changed actions
- `card.pr.merge {sessionId}` — resolve PR via `g.prListForHead` (as `card.pr.create`
  :878 does); require `checks.state === 'green'` (from `card.pr.status` :907) else return
  `{ok:false, reason:'checks-'+state}` (asleep/pending/red/none never merge); call
  `mergeSessionPr(repoPath, id, {owner,name,number, sha: PR head sha, subject: PR title,
  api:{prMerge: prMergeApi bound with token/fetch/apiBase}, origin})`. Return
  `{merged, mergeSha, reconcile}`. §9 shape (`merge_method: merge`), never squash.
- `version.mint {sessionId, name?, state?}` — human-initiated "publish to client";
  calls `mintAtStageBoundary(repoPath,{name,state,env})`; returns `{squashed, sha, chip}`.
- `card.runner.wake {sessionId}` — `ensureRunner({owner,name, registrationToken: () =>
  registrationTokenApi({...}), latestRunnerTarball: () => latestRunnerTarballApi({...})})`.
  Returns its result verbatim (`{ok, existing, dir}` or `{ok:false, reason}`); the client
  shows the manual instruction when `ok:false` (runner.js:10-16: wake is a human action —
  `svc.sh start` under `~/.arxa/runners/<owner>__<name>`).
- D111 in `'workspace.new-session'` (:932-941): when the target repo is linked and not
  `localOnly`, run `prChecksApi` for `main`'s head sha. `state==='red'` → throw
  `Error('main-red')` (blocks). `asleep|pending|none` → proceed; return
  `{...session, notice:'runner-asleep'|'checks-pending'|null}`. Unlinked → proceed silently.
- `card.status`: unchanged shape; add `main: {checks: state|null}` (same call, cached
  30 s per repo) so the teaser can say "main red" without a second round trip.
- Dock registration `order: 30` (snippet; `selftest.mjs:139` updated to assert 30).

### A2. Slides (client, snippet `ArxaGitCard` rewrite, lines 408-521)
- Markers: `[data-arxa-card-strip]` (overflow hidden) › `[data-arxa-card-track]` (flex
  row, `transform: translateX(-idx*100%)`, transition `var(--ds-transition-duration-slow)`)
  › three `[data-arxa-card-slide=status|commit|approve]`; nav = prev/next Icon buttons +
  three dot buttons `[data-arxa-card-dot]`, `aria-label` via `t()`. State `slide` (0-2),
  reset to 0 on session change; jump to `approve` after a successful `card.pr.create`.
- Head/teaser (`[data-arxa-card-teaser]`): one line built from `card.status`:
  `"3 dirty · ↑2 · PR #12 pending · runner asleep"` — parts only when non-null.
- Status slide: existing chips + `frame.wired` (ok/missing) + `frame.runner`
  (online/asleep/unknown) via `StateDot`; wake CTA button when runner asleep or
  `checks.asleep`; three "Insights" links (streak / CI / sessions) → dispatch
  `arxa-av-open` with `{kind:'insight', view, sessionId}`.
- Commit slide: subject input, askDraft, Commit, Push (existing logic, untouched).
- Approve slide: no PR → problem/fix inputs + Create PR; PR open → number/url/state,
  checks chip (green/red/pending/asleep/none), Merge (enabled only `green` + open), wake
  CTA when asleep; merged → `version.mint` button + resulting chip.
- Polling: keep 30 s `card.status`; `card.pr.status` every 30 s only while the Approve
  slide is visible and a PR exists; all timers inside component effects with cleanup.
- Conformance fixes in the same pass (card block only): style injection moves inside
  `ctx.effect()` with a disposer (today `snippet:499-521` is bare); hex fallbacks removed;
  every new string in en/pl/fr dicts (`snippet:1932/2107/2282`; pl/fr flagged for native
  review per conformance decision 4).

### A3. Insight surface (right column)
- `plugins/artifact-viewer/lib/client.js:1146-1154`: accept `detail.kind==='insight'`
  (today returns when `!relPath`); `store.request({kind:'insight', view, sessionId})`;
  panel renders `InsightPanel` for that kind, existing file flow otherwise. Below 744 px
  the existing sheet layer already full-screens (`artifact-viewer-docked-column.md:71`).
- Server actions (sidebar table; viewer POSTs `/__arxa/sidebar/action`):
  - `insight.streak {sessionId}` → new `commitDays(repoPath,{since:'90 days',env})` in
    `git-workspace/lib/commits.js`: `git log --date=short --pretty=%ad --since=…`,
    bucketed by day → `{days:[{day,count}], current, longest}`; 60 s per-repo cache in
    module scope (D101: live from git, short-lived, no persisted index).
  - `insight.ci {sessionId}` → new `workflowRunsApi({owner,name,branch,perPage:20,
    accessToken,fetch,apiBase})` in `github-link/lib/frame.js`:
    `GET /repos/{owner}/{repo}/actions/runs?branch=&per_page=` (docs: GitHub REST
    "List workflow runs for a repository", API 2022-11-28); map to `{id,name,status,
    conclusion,createdAt,url,headSha, asleep: status==='queued'}`.
  - `insight.sessions {orgId}` → `listSessionsAcrossRepos(orgPath)` rows; panel buttons
    reuse existing `session.open`, `session.archive`, `session.rename` — no new actions.
- Rendering: streak = CSS grid of day cells (4 intensity classes, tokens only) + numbers;
  CI = rows with `StateDot` + link; sessions = rows with state chip + the three buttons.

### A4. Tests (Part A)
- `arxa-sidebar/selftest.mjs`: order 30; strip/track/slide/dot/teaser markers; wired/
  runner chips; wake CTA; merge + mint buttons; en/pl/fr for every new key; no
  `createPortal`; drift gate stays.
- `git-workspace/selftest.commits.mjs` (new): `commitDays` with `GIT_AUTHOR_DATE`-dated
  commits — buckets, current/longest, cache TTL.
- `github-link/selftest.mjs`: `workflowRunsApi` with injected fetch fixture; asleep flag.
- `arxa-sidebar/selftest.actions.mjs` (new): `card.pr.merge` (fake api → merged,
  reconcile called; non-green → refused), `version.mint`, `card.runner.wake` (injected
  `ensureRunner`), D111 (red → throws `main-red`; asleep → ok + notice; unlinked → ok).
- `arxa-sidebar/smoke.mjs`: new-session on unlinked project still ok; `card.status`
  carries `main`; insight actions answer for the fixture repo.
- Manual: 1280 px (docked column) and 390 px (sheet) — slides, insights, wake CTA.

## 4. Part B — Composition harmony (agent preset)

- B1. New `profile/agent-presets/arxa/{agent.cordis.yml,preset.yml}`, authored by copying
  the shipped `standard` preset row set (`~/.arxa/engine/…/dsh/config/agent-presets/
  standard`) and adopting the `cordis` preset's structure and comments: persona row with
  `{{model}}`/`{{cwd}}`, plane comment per row, `planning`/`compaction`/`delegation`
  isolate groups with the same `isolate:` keys. Deliberately WITHOUT `tool-cordis` and the
  authoring skill: arxa is distributed software; self-modification is shell access and
  must not be every session's default (a later `arxa-dev` preset may add it).
- B2. Move the three agent-plane rows out of `profile/cordis.patch.yml` into the preset:
  `arxa-memory` (:65-69, systemPrompt section), `arxa-pi-delegate` (:75-77, tool),
  `arxa-gen-ui` (:133-135, tool). Every UI/webServer row stays host (sidebar, frame,
  conversation, approvals, brand, locale, viewer, …) — the card's new actions are
  webServer routes, i.e. host-plane, consistent with this split.
- B3. Persona: the preset `persona` row carries the arxa persona (text from
  `cordis.patch.yml:14-20`) plus a two-plane paragraph naming arxa's planes (HOST =
  profile patch; AGENT = this preset). The host `system-prompt` override stays as the
  deployment default for any non-arxa preset.
- B4. `bin/arxa-studio.mjs`: materialise the preset into `${DSH_HOME}/.agent-presets/arxa/`
  on every launch (same byte-copy "build product" pattern as :177); never touch the
  shipped `config/agent-presets`. Seed `agent-presets.default: arxa` (:226-227). For an
  existing settings file whose default names a shipped preset (`code|cordis|standard|
  minimal`) rewrite that one key to `arxa` and print a one-line notice; any other value
  is left alone.
- B5. `arxa-harness-and-distribution.md` is cited by the patch header but does not exist
  (never in history). Create it with the two-plane rule as applied to arxa (≤ 60 lines)
  so the citation is true.
- B6. Tests: `scripts/preset-check.mjs` (discovered by `ci.mjs`): parses both YAML files,
  asserts the preset's row ids, asserts the three rows are absent from the host patch and
  present in the preset, asserts `bin` copies to the right path (dry-run env). Manual:
  launch, open a session, confirm `delegate_pi` and `gen_ui` in the tool catalog and the
  memory section in the system prompt.

## 5. Sequence and commits

1. Copy this plan (done — this file). 2. A1 server actions + selftests. 3. A2 slides via
snippet → `gen-workspace.mjs --write` → drift gate. 4. A3 insights (git-workspace,
github-link, viewer, sidebar). 5. A4 smoke + manual. 6. B1–B6. One commit per step;
ledger entries D116 (card geometry built), D117 (D111 wired), D118 (arxa preset).

## 6. Assumptions / out of scope

- Conformance Phase 2 items 1–6 (whole-sidebar surgical) stay out of scope; only the card
  block is made conformant here.
- `cairn-de` is not live today; if it reappears, stop before step 3 and re-sequence.
- pl/fr strings ship machine-drafted and flagged for native review (conformance dec. 4).
- Wave 3 e2e against a bare remote is a follow-up; PR merge is covered by fake-api tests.
- Phase 0b (destructive cleanup) is untouched — still gated on named confirmation.
