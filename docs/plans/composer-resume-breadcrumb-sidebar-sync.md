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
| Q5 | Mode chip `margin-left:auto`, mirrored 20px inset on the right edge. |
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
  last two segments `flex-shrink:0`. Mode chip `margin-left:auto;
  margin-right:var(--dsh-composer-side-clearance)`.
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
