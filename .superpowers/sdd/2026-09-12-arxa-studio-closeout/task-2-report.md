# Task 2 Report — Stop live sessions before organisation trash and preserve display names

**Status: DONE** · Commit `8f10a08` `fix: stop organisation sessions before trash` (BASE `7334ddb`, branch `closeout-2026-09-12`). Closes inventory row AXS-002 (governing narrative: `docs/plans/org-trash-unreachable.md` Bug B).

## Predecessor WIP handling

The killed implementer's WIP (10 modified files + untracked `selftest.trash-live-sessions.mjs`) was inspected in full before anything ran. It proved correct against every seam (see Verification below), so it was kept, with two changes by me:

1. Added the missing blank line between `quiesceSessionsUnder` and `sweepDeadTmpSessions` (file style).
2. Nothing else — the diff is otherwise the predecessor's, now mine by ownership.

RED evidence was reconstructed per the mandated safe pattern (never bare `git stash pop`; shared stash): untracked test copied to `/tmp`, `git stash push -u -m task2-red-verify -- plugins/arxa-sidebar plugins/file-org-shell` (pathspec keeps `package-lock.json` dirt untouched in the tree), SHA captured from `git stash list --format='%H %gs'`, WIP **test files only** restored onto clean BASE libs (`git checkout <sha> -- <4 test paths>` + copy back the untracked one), suites run for RED, tests reset to HEAD, `git stash apply <sha>`, `git stash drop` by re-found `stash@{0}`. Tree verified identical afterwards; stash list empty.

## TDD evidence

### RED (WIP tests on clean BASE libs — command + excerpts)

`node plugins/arxa-sidebar/selftest.trash-live-sessions.mjs`

```
FAIL  T1: stopped/alreadyStopped reported as session ids
FAIL  T1: original path stays absent (no husk)  …/ws/Live-Husk-Co
FAIL  T1: trash row renders the display name  …{"name":"Live-Husk-Co"}…   (slug rendered)
FAIL  T1: restore succeeds (no occupied-path refusal)  {"ok":false,"error":"cannot restore …: …/ws/Live-Husk-Co is already occupied"}
FAIL  T2: trash fails closed on an unstoppable session  {"ok":true,…}      (BASE trashes anyway)
arxa-sidebar selftest.trash-live-sessions: 9 FAILURE(S)
```

The RED run reproduces Bug B end-to-end on BASE: the live writer recreates the org's path after the move (the husk) and restore is refused with "already occupied".

`node plugins/arxa-sidebar/selftest.session-sweep.mjs`

```
SyntaxError: The requested module './lib/session-sweep.js' does not provide an export named 'quiesceSessionsUnder'
```

(exact "no quiesce seam exists" failure the brief requires)

`node plugins/file-org-shell/selftest.mjs` → `AssertionError: D81: trashed org listed in the org-trash index` (row renders slug, not display name)
`node plugins/arxa-sidebar/selftest.actions.mjs` → `FAIL  T: trash row renders the display name … {"name":"Trash-Offline-Co"}` (1 FAILURE)
`node plugins/arxa-sidebar/selftest.mjs` → 2 FAILURE(S): bridge face lacks `stopAgentIds`; routes check lacks `quiesceSessionsUnder(`

### GREEN (WIP restored, command + output)

```
$ node plugins/arxa-sidebar/selftest.trash-live-sessions.mjs   → ALL GREEN (14 checks: T1 husk-free trash + display name + restore, T2 fail-closed, T3 outside untouched)
$ node plugins/arxa-sidebar/selftest.session-sweep.mjs         → ALL GREEN (quiesce block: 2 inside / 1 outside / 1 already-stopped / prefix trap / stop-failed / no-face / timeout / fresh live row / offline skip / empty org)
$ node plugins/arxa-sidebar/selftest.actions.mjs               → ALL GREEN
$ node plugins/file-org-shell/selftest.mjs                     → 210 checks passed
$ node scripts/org-purge-smoke.mjs                             → SMOKE OK (live engine 127.0.0.1:7891, throwaway repo created + purged + 404 verified)
$ npm test                                                     → arxa-studio CI: ALL GREEN
```

## What was implemented

1. **Bounded quiescence** (`plugins/arxa-sidebar/lib/session-sweep.js`): `quiesceSessionsUnder({ sessions, sessionPersistence, agentControl }, orgPath, { timeoutMs = 5000, log })` → `{ stopped, alreadyStopped, skipped? }`. Enumerates persisted session headers (`readFirstZstdLine` → `header.cwd`) plus live in-process rows (`sessions.list()`, catches sessions too fresh to have a header). Canonical path semantics: org and each cwd resolved through `realpath` (macOS `/var` vs `/private/var`); a cwd whose tail is gone realpaths its deepest existing ancestor; containment is `=== base || startsWith(base + sep)` — the textual-prefix trap (`/vol/RESTOX`) is excluded. Fails CLOSED: any stop failure/timeout throws naming ONLY session ids (`session-stop-failed: …` / `session-stop-timeout: …` / `session-stop-unavailable: …`) — never a path. Offline host (no persistence) skips, never blocks. Session history is never deleted — stopped sessions stay resumable.
2. **Retained handle + narrow face** (`plugins/arxa-sidebar/lib/index.js`): `agentHandles` Map beside `ctx.agents.create` (sessionId → AgentHandle; the handle's `dispose()` is the public stop — the agents store has no stop-by-id). `makeDshFaces` gains `stopAgentIds(ids, { timeoutMs })`: one total deadline across the batch; retained handle → `dispose()`; live handle-less agent (dsh-resumed) → best-effort `agent.cancel({ kind: 'disposed' })` + `await agent.whenIdle()`; nothing live → `alreadyStopped`; any failure → `{ok:false, reason:'stop-failed', failed}`. Exposed through `dsh-bridge.js` as a throw-proof passthrough (`{ok:false, reason:'dsh-unavailable'}` on throw/absent face) — the bridge's sixth face.
3. **Wired `org.trash`** (index.js route): quiesce BEFORE `l.trashOrg`; budget 5s (`ARXA_SESSION_STOP_BUDGET_MS` test override); a quiesce throw rides the route's standard catch → `{ok:false,error}`, org folder/recents/GitHub/trash index untouched (T2 asserts all of this); `out.sessions` reports stopped/alreadyStopped ids — no impossible live-state rollback claimed.
4. **Identity preserved** (`plugins/file-org-shell/lib/lifecycle.js`): `trashOrg(orgPath, { displayName } = {})` reads `org.json` `name` before the move; the trash index keeps the folder slug in `name` (restore/purge derive paths from it) and adds `displayName`; `listOrgTrash()` rows render `displayName ?? slug`. The sidebar's zero-lifecycle trash reader renders the same. Restore returns the org to its original slug/path.

## Files changed (commit 8f10a08)

- `plugins/arxa-sidebar/lib/session-sweep.js` — `quiesceSessionsUnder` (+ blank-line fix)
- `plugins/arxa-sidebar/lib/index.js` — handle map, `stopAgentIds` face, `org.trash` wiring, trash-row display name
- `plugins/file-org-shell/lib/dsh-bridge.js` — `stopAgentIds` passthrough
- `plugins/file-org-shell/lib/lifecycle.js` — `trashOrg` displayName param, index slug+displayName, row rendering
- Tests: `plugins/arxa-sidebar/selftest.session-sweep.mjs`, `selftest.actions.mjs` (T block), `selftest.mjs` (source checks), `selftest.trash-live-sessions.mjs` (new, auto-discovered by `scripts/ci.mjs`), `plugins/arxa-sidebar/smoke.mjs` (trash row now display name), `plugins/file-org-shell/selftest.mjs` (D81 + explicit-override checks)
- `package-lock.json` left dirty and uncommitted (pre-existing, not mine).

## Verification of predecessor claims against real sources

I re-derived the WIP's API claims rather than trusting its comments: `AgentHandle = { agent, dispose(): Promise<void> }` and "ctx.agents.get(id) returns a bare Agent" (`@deepseek-ai/dsh-agent/lib/types/index.d.ts:145-160`); `Agent.cancel(cause)` / `whenIdle()` (`@deepseek-ai/dsh-agent-loop/lib/types/agent.d.ts:38,49`); `AgentCancelCause` includes `{ kind: 'disposed' }` (dsh-api-session-controller typert). Route throw → `{ok:false,error}` at `index.js:1875`. `sessions.list()` already used in production (`index.js:466`). `orgByRef` rows carry `.name`/`.path`. `ci.mjs:29` regex auto-discovers the new suite; `smoke.mjs` is wired at `ci.mjs:32`.

## Self-review findings

- Interface match: brief's `quiesceSessionsUnder` signature and `stopAgentIds(ids, { timeoutMs })` face are verbatim; `trashOrg(orgPath, { displayName? } = {})` verbatim; index keeps slug + displayName, restore to original slug (asserted by basename checks).
- Ruling 1 (fail closed, ids only, no paths): enforced at three layers (face → bridge → quiesce error strings) and asserted by `!t.error.includes('/')` and the sweep-test "no paths in the error" check.
- `stopAgentIds` treats an `agents.get` throw as "already stopped" — internal-store-invariant break only; the bridge's own throw path still fails closed. Accepted (documented in the face's comment).
- Output pristine: no warnings/errors in any suite; `npm test` ALL GREEN; live smoke OK and self-cleaning.
- YAGNI: no new deps, no config surface beyond the one test-only env knob, `sweepSessionsUnder` extended by sibling function rather than duplicated.

## Concerns

None blocking. Two notes: (1) `ARXA_SESSION_STOP_BUDGET_MS` is a test-only override parsed inline in the route — fine for now, document if it ever becomes operator-facing. (2) The live purge smoke touches a real GitHub account with a self-cleaning throwaway repo (engine was up; brief Step 7 mandates it); it verified the full create→trash→purge→404 flow with the new quiesce step in the path.

## New findings

None. (Process note, not a product finding: this git version rejects `git stash drop <raw-sha>`; the re-find-by-tag pattern in the dispatch instructions is the correct workaround and was used.)
