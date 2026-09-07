# Composer resume + cordis breadcrumb + sidebar sync

Status: GRILLED 2026-09-02 (Q1–Q7 confirmed). Supersedes nothing; follows
`docs/plans/git-card-stock-dock-rebuild.md` (Part B landed).

## Problem (observed on the packed desktop app, real `~/.arxa`)

1. Launch shows the stock "Sessions start…" hero copy even though a session
   is resumed underneath it.
2. Left composer chip is the stock `WorkspacePicker` — a selectable dropdown
   reading only `note-001`.
3. Right "arxa mode" chip floats short of the composer's right edge.
4. The resumed session is not reflected in the sidebar (ancestor containers
   collapsed, no selection, no scroll).

## Facts (looked up, not assumed)

- Boot resume exists: `plugins/arxa-sidebar/lib/client.js` ~2852 picks the
  last `state === "open"` session (`cand`), sets `currentSessionId`, runs
  `orgStore.mutate("session.open")` then `arxaOpenConversation(cand.id)`.
- Stock tree auto-expand (`SessionTree`, ~1622) expands only the session's
  leaf group via `groupExpansion`, and skips if the key was ever set.
- arxa container rows use a separate in-memory map `orgStore.expanded`
  (`toggleExpand(key)`, keys `orgId` and `orgId|path/prefix`), never
  persisted. `leafHidden` hides a leaf group unless every ancestor is open.
- No `scrollIntoView` in the sidebar. Session rows carry `aria-selected`.
- Hero copy lives in the stock `conversation.hero.*` slots; arxa already
  overrides `conversation.hero.workspace` (breadcrumb + agent preset).
- Cordis breadcrumb primitives: `~/.claude/skills/cordis` (crumb sep,
  label tertiary/primary tokens, 20px composer side clearance
  `--dsh-composer-side-clearance`).

## Decisions

| # | Decision |
|---|----------|
| Q1 | Hero copy only when there is nothing to resume; resumed session opens into its thread. |
| Q2 | Left chip = cordis breadcrumb `org / dock / project / session / worktree`, read-only, from sidebar tree data. Stock `WorkspacePicker` removed from composer. |
| Q3 | New session left empty then quit is not resumed; relaunch shows welcome hero; empty session is dropped (no orphan row). |
| Q4 | Breadcrumb `flex:1; min-width:0`; middle segments ellipsize; session + worktree always visible. |
| Q5 | Mode chip `margin-left:auto`, mirrored 20px inset on the right edge. **Revised 2026-09-03:** the hero-row crumb is gone (the composer crumb is the only one); the preset chip is pushed to the composer's top-right by a rule on the chip itself — dsh renders the `agentPreset` slot wrapper `display:contents`, so the original margin on the wrapper was a no-op. 16px inset (the card's own inset inside the stack), bound state only. An overlay re-home (`conversation.input.overlay` + `renderSlot`) was tried and withdrawn: slot components never receive `renderSlot` (runtime: only root does). **Corner 2026-09-03 (shipped, `b0d95f3`):** the margin rule only pushed the chip along the hero ROW above the card — the user wants it INSIDE the composer card, top-right. `ArxaPresetCorner` registers on `conversation.input.overlay` (locale `settings.agentPreset`) and re-renders the stock seat entry via `slots.entriesOfSlot(PRESET_SEAT_KEY)[0]` (no `renderSlot` needed); `[data-arxa-preset-corner]{position:absolute;top:10px;right:14px}` inside the card, textarea `padding-right:var(--arxa-preset-inset,120px)` so the placeholder never runs under it, hidden outside hero (`.uV2eYG_root:not(.uV2eYG_hero)` — stock shows no chip in thread state either), hero-row copy `display:none` in every state. Verified headless on the smoke server (`lens/probe-hero-corner.mjs`): chip box inside the card, single copy, menu anchors under the chip; selftest 178 PASS; desktop rebuilt + relaunched (engine `6af802e44064` == repo). |
| Q6 | `revealSession(id)`: expand every ancestor container + leaf group (force, even if user collapsed), scroll row into view, selected highlight. Called from boot-resume and every `session.open`. Adds only; never collapses. |
| Q7 | Four smoke flows on `ARXA_HOME=/tmp/arxa-smoke`, each lens PNG + selftest assertion; then desktop rebuild for manual check of flows 1–2. |

Out of scope: session rename/archive, PR/CI card, anything needing a DB.

## Work items

### A. Resume gating (Q1, Q3)
- A1 client.js boot: when `cand` is chosen, mark `state.resumed = true`;
  hero slot renders copy only when `!resumed && sessions.length === 0`.
- A2 Empty-session drop: on `session.open` boot path, if the candidate has
  no messages (dsh `conversation.entries === 0` / no first-message stamp)
  → do not resume; server `session.gc-empty` deletes it; welcome hero.
- A3 selftest: `resume: hero hidden when resumed`, `resume: empty session
  dropped`.

### B. Breadcrumb chip (Q2, Q4, Q5)
- B1 New `conversation.composer.workspace` override: cordis crumb from
  `orgStore` (org name, dock label, project name, session name, worktree
  name). No click handlers, `aria-current="location"`.
- B2 Remove stock `WorkspacePicker` from composer row (keep it in hero
  override where it is already replaced).
- B3 CSS: crumb `flex:1;min-width:0`, segments `text-overflow:ellipsis`,
  last two segments `flex-shrink:0`. Mode chip (revised 2026-09-03):
  `.wSkVaW_composerStack:not([data-arxa-empty]) .wSkVaW_heroWorkspaceRow>[data-slot='conversation.hero.agentPreset']>*{margin-left:auto;margin-right:16px}`
  — targets the chip, not its `display:contents` wrapper. The hero-row crumb
  (`ArxaHeroGuide` bound branch) renders a hidden anchor, so the composer crumb
  is the only breadcrumb on screen.
- B4 selftest: crumb text order, no `<select>`/dropdown role in composer,
  mode chip right edge within 1px of composer right edge − 20px.

### C. Reveal on resume/open (Q6)
- C1 `orgStore.revealSession(sessionId)`: derive `{orgId, ws}` via
  `wsParts`; set `expanded[orgId]` and each `orgId|prefix` true (write
  directly, not toggle); `setGroupExpanded(groupKey, true)`; emit.
- C2 After emit, `requestAnimationFrame` → `[data-session-id=id]`
  `.scrollIntoView({block:"nearest"})`.
- C3 Wire: boot-resume path (2865) and `session.open` action (2922, 3012,
  5097) all call `revealSession` before `arxaOpenConversation`.
- C4 selftest: after resume, every ancestor key true, row `aria-selected`,
  row within sidebar viewport.

### D. Smoke flows (Q7)
- D1 `scripts/smoke-flows.mjs` seeds `/tmp/arxa-smoke` and runs flows
  1–4 via lens; PNGs to `designs/composer-resume/evidence/<flow>-1280.png`.
- D2 Flow assertions appended to `plugins/arxa-sidebar/selftest.mjs`.
- D3 Rebuild desktop (`scripts/build-desktop.sh` per README 180-187),
  hand to user for flows 1–2 on real data.

## Sequence and commits
1. A → `feat: gate composer hero on resume and drop empty sessions`
2. B → `feat: cordis breadcrumb composer chip and mode chip alignment`
3. C → `feat: reveal resumed session in sidebar tree`
4. D → `test: smoke flows for resume, git and worktree wiring`

## Verification
- `node plugins/arxa-sidebar/selftest.mjs` ALL GREEN.
- Lens PNGs reviewed (read back, not just exit code).
- Desktop app rebuilt and launched; user confirms flows 1–2.

## Status (2026-09-02, smoke on `/tmp/arxa-smoke`)
- A/B/C landed in one commit — the snippet, `client.js`, `dsh-bridge.js`, `lifecycle.js` and `git-workspace/sessions.js` carry all three areas in the same regions, so the four planned commits were folded into one.
- Breadcrumb now registered in the composer's **left** zone (`conversation.input.left`), not only the shell's workspace slot: the composer's own stock `WorkspacePicker` slot host is `display:contents`, so the crumb sizes from the composer flex row. Served row now carries `worktree`; crumb renders six segments (`Acme Labs / projects / rocket / 01-intake / 01-intake-001 / s-<id>`), last one `aria-current`.
- Row "+" flow was broken: it created the registry row (server) but never opened it client-side. Fixed in `workspace-region.snippet.txt` — the "+" handler now opens the created session directly (`orgStore.openSession` → `arxaOpenConversation`), evidence: new session current at 300 ms, composer visible, message sent, dsh log `user/message` ×4 + `turn/end` ×1 (frame-aware zstd read).
- Sidebar selftest ALL GREEN (`node plugins/arxa-sidebar/selftest.mjs`).
- Scratch lens drivers (`/tmp/arxa-smoke/lens/cdp-flow1.mjs`, `cdp-console.mjs`, `cdp-shot.mjs`) are not in the repo; the driver skips already-open tree groups on a resumed boot.
- Flow 2 (git card / worktree wiring) driven end-to-end on a resumed boot; two real bugs found and fixed in `plugins/arxa-git-card`:
  1. **Seat lookup by the wrong id.** The shell seats the card with the dsh conversation id (`arxa-<id>`, on the registry row as `dshSessionId`); every handler handed that id to git-workspace, which only knows registry ids → `card.status` fell back to the org seat (card read `main` on a session), `card.commit` answered `unknown session "arxa-s-…"`. Fixed once at the action boundary in `lib/index.js` (dsh id → registry id before dispatch); selftest section F covers `card.status` by bare id, by dsh id, unknown id, and `version.mint` by dsh id.
  2. **Commit gated on dirty files only.** `canCommit` required `changed > 0`, but the watcher auto-saves every change as a WIP commit, so the tree is clean whenever there is something to land, and `card.commit` → `gw.sessionStageBoundary` squashes the WIP run above the session base anyway. Gate now opens on `wipRun > 0` too; preview reads `1 wip` when clean.
  - Evidence: dock reads `arxa/session/s-mtk3qnbs-earnv2 · clean · 1 wip · local-only`, Commit enabled; subject `docs(notes): add smoke note` → worktree `fe48606`, main fast-forwarded to `fe48606`, card back to `clean · nothing to commit`. `selftest.mjs`, `selftest.actions.mjs` (git card) and the sidebar selftest ALL GREEN.
  - Smoke-server trap: the launcher re-execs (`node --import …/bin/loopback…`), so `pkill -f 'bin/arxa-studio.mjs'` never reaches the listener and a "restart" silently keeps the old code (`EADDRINUSE` in the new log). Restart by `kill $(lsof -nP -iTCP:7891 -sTCP:LISTEN -t)` and confirm the listening pid changed.
- Not done: desktop app rebuild + user confirmation of flows 1–2 on real `~/.arxa`.

## Packed-desktop rebuild — 2026-09-02 23:52 (verified live)

- **Problem:** first rebuild after a89b02e produced a sidecar that died on boot with `ERR_MODULE_NOT_FOUND` for `bin/materialise-preset.mjs` — the launcher imported it, but `scripts/pack-sidecar.mjs` copied a hard-coded two-file list into the stage.
- **Fix:** single `BIN_FILES` constant drives both the existence check and the stage copy (explicit list, not a glob — `bin/` also holds dev-only scripts that must not ship).
- **Verified on the installed app:** sidecar pid under `arxa-desktop`, `DSH_HOME=~/.arxa/dsh`, engine `2549e9e1f3b5`, `dsh web: http://127.0.0.1:7891`; served `/plugins/arxa-git-card/client.js` contains the `wipRun > 0` commit gate; `/__arxa/sidebar/state` returns the real `RESTO` org.
- **Gap noted:** the smoke suite runs the engine from the repo, so pack-list drift is only caught by a real bundle boot. Candidate follow-up: a `pack-sidecar --check` step that boots the packed binary once and asserts the port binds.
- **Closed 2026-09-07 (static, not a boot):** `scripts/pack-manifest.mjs` owns `BIN_FILES` plus a scan of what `bin/arxa-studio.mjs` actually loads (static import, dynamic import, and the bare-filename literal the `--import` re-exec uses; comments stripped). `pack-sidecar` runs it before the bun build and `--check` runs the whole cheap validation set alone; `scripts/pack-list-check.mjs` is CI suite #N (fixtures + the live tree). Verified it flags the historical regression: with the pre-a89b02e two-file list, `missing: ['materialise-preset.mjs']`. The boot-the-binary variant is NOT built — it needs a 141 MB build and a spawned engine to catch a class the scan already covers; revisit only if a bundle ever dies on something other than a missing bin/ module.
