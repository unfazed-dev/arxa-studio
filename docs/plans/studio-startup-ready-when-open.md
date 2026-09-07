# Studio startup: ready when it opens

Date: 2026-09-07. Owner: artifact-viewer / sidebar / git-workspace / desktop shell.

## Problem, measured

- The desktop splash ("Getting things ready…", `arxa/desktop/src/main.js`) is a
  reachability poll: it lifts the moment the studio port answers anything. The
  engine log shows the port opens BEFORE plugins finish applying.
- For 3s–12.6s after boot the host event loop is blocked in ~1s stalls, ten in
  a row. The spawn wrapper named them: 8 × `git fetch` and 2 × `git push` to
  GitHub, each 0.3–0.95s, synchronous (`execFileSync` via `runGit`), from
  `fetchRepo`/`pushRepo` in `plugins/git-workspace/lib/repos.js`, called by
  `file-org-shell/lib/lifecycle.js` (`syncRepoNow`, `pushWithAuthRetry`,
  `publishRepoOnce`) out of the org-open GitHub heal and the sidebar's repo
  sync kick. One more fetch at +36s.
- Every request during that window waits. A viewer click measured at 3.0s was
  2.9s of waiting. Session resume (`arxa-sidebar/lib/client.js` ~3174) is a
  sequential chain — state fetch → host `session.open` → poll up to 4.8s — and
  the host step sits in the same window.
- The org shell's own docs already forbid sync git on request paths (run.js:
  "6-minute freeze").

## Plan (advisor-ordered: unblock first, then signal readiness, then measure)

### A. Remote git on the boot path must not block the loop — DO FIRST
- `git-workspace/lib/run.js`: add `runGitAsync` (execFile, same args/env/
  identity/timeout, same error shape, `allowFail` → null).
- `git-workspace/lib/repos.js`: add `fetchRepoAsync`, `pushRepoAsync`
  mirroring the sync pair; local ref reads stay sync (ms).
- `file-org-shell/lib/lifecycle.js`: `syncRepoNow`, `pushWithAuthRetry`,
  `publishRepoOnce` await the async forms. Order inside each routine is kept
  (the ahead/behind read still follows its fetch), so results are identical;
  only the event loop is free while git talks to GitHub.
- Sync callers elsewhere (integrate, prflow, tests) unchanged.
- Check: lag sampler shows no stall > 100ms from `fetchRepo`/`pushRepo`;
  git-workspace + file-org-shell selftests green.

### B. A real readiness signal for the splash
- Host: `/__arxa/ready` on the sidebar plugin → 200 `{ready:true}` once the
  lifecycle has opened the persisted org (or there is no org), else 503.
  CORS `*` on this one boolean route so the shell page (tauri origin) can read
  the status.
- Shell (`arxa/desktop/src/main.js`): poll `<studio>/__arxa/ready` and require
  `res.ok`; keep the existing port poll as the fallback when the route 404s
  (older studio). Needs a desktop rebuild to ship.
- Risk: the flag never flips on a plugin error → splash hangs. The shell keeps
  its existing "Reconnecting…" copy and a hard cap: after N ready-polls, open
  anyway.

### C. Session resume — measure after A, then decide
- Expected: the 4.8s poll was mostly the blocked loop. Re-measure with the
  viewer trace + a resume mark; only then make the poll event-driven.

### D. Later, not now
- Launcher copies ~25 plugin dirs per launch (~160ms) — fine.
- Editor bundle already warmed 1.5s after boot (artifact-viewer).
- The +36s fetch: attribute with the 5-frame stack, then apply A's pattern.

## Diagnostics to remove once green
- artifact-viewer `loop-lag` sampler and `sync-spawn` wrapper (index.js).

## Measured after step A (2026-09-07, boot at 10:00)

- The 8 fetch + 2 push storm is gone. Remaining sync git in the first 35 s: 6 local calls,
  four under 90 ms, plus two `fetchRepo` of ~340 ms from `reconcileLocalMain`
  (git-workspace `prflow.js`) called by `card.status` in arxa-git-card on every status poll.
  Fixed in `1eac7b8`: `reconcileLocalMain` is now async over `fetchRepoAsync`; both
  callers (`mergeSessionPr`, `card.status`) already ran in async scope.
- Loop lag after boot: worst 815 ms at +5.7 s (was multi-second). First click 375 ms
  warm, later clicks 95–130 ms.
- Desktop shell: `arxa` commit `d5337c42` (splash waits for `/__arxa/ready`). The local
  release build must pack the sidecars from the installed app: `src-tauri/binaries/` held a
  Sep 5 12:04 studio sidecar whose payload hash differs from the running engine
  (`dc67c634ff0c`), so a naive rebuild would have booted an older payload without today's
  plugin fixes. Sidecars are gitignored; the CI release pipeline injects them.

## Boot trace rounds (2026-09-07, after step B)

Instrumentation (`7c2c023`): the launcher relays child stdout/stderr into engine.log with ISO
timestamps (the timestamp cliff is gone), host marks `[arxa-boot] …`, the page posts one
`trace boot@<nav start>` line to `/__arxa/artifacts/trace`, the shell posts `trace shell`
(desktop `7a49b2d9`+). Artifact: https://claude.ai/code/artifact/3e67cbd6-b245-4472-bd0a-85003ff84f78

Measured (launcher boot = 0):
- 10:34 boot: copy 254ms · dsh core → listen 1.39s · ready seen +2.15s · nav +3.07s · painted +5.94s.
  Page: state 200ms, session.open round trip 946ms (host 375ms + a second state fetch the client
  waited on), catalog wait 1.34s (400ms poll), paint 230ms.
- 10:43/10:49 boots (after `c91cfae`, `34d6fff`): copy 6ms when seeded · dsh core 1.28-1.31s ·
  listen → nav 1.04s every time · page 2.6-3.0s, catalog-first at 2.5-2.7s after nav is the whole
  critical path; open-call fires the same ms.
- Host `sessionController.list()` = **911ms for 54 items** when idle (`936a300` splits query vs
  summarize). dsh's own restore (`dsh.sessions.current`) waits on the same list.
- Shell: /tmp/arxa-open-studio.trace shows navigate#1 with the PREVIOUS engine's token, "token
  rotated at poll[0]", navigate#2 — a double page load on every boot. The `/__arxa/ready` route was
  never hit by the shell on those boots (works when probed directly: 200 in 29ms); the shell trace
  will say why.

Fixes shipped: async remote git (`7e8e44d`), git card fetch async (`1eac7b8`), ready route
(`6196a1a`), seed marker (`c91cfae`), open on host answer + catalog subscribe (`c91cfae`),
single-flight state refresh (`34d6fff`), splash polls 200ms (desktop `7a49b2d9`), fresh-token
guard + shell trace (desktop, this round).

Open: (1) session list 0.9s — see query-vs-summarize split next boot; candidates: fewer persisted
sessions (54 logs / 26 scopes, many from dropped worktrees), or `coldBlankProbeMaxBytes: 0`;
(2) sync host work queued ahead of the list on boot: `ensureOpen` 225-587ms, `hasHead`+`allSessions`
88-191ms, state snapshot 259ms; (3) dsh core boot 1.3s before the first studio plugin applies;
(4) relaunch race: quitting and reopening within ~2s lets the old engine answer the new shell's
probes — cold starts are unaffected.

## Cairn question and shell round 3 (2026-09-07)

**Cairn is not a startup lever.** Grill D32/D46/D61/D62 place cairn as the
mobile DB rail (approvals, session state, the phone's tree projection);
`plugins/cairn-rail` is a pure local JSONL library that the sidebar never
attaches (no `rails` passed at `plugins/arxa-sidebar/lib/index.js:450`).
The Tauri shell already runs a `cairn-server` sidecar for the B2 approvals
mirror (`desktop/src-tauri/src/cairn_server.rs`); on the dev machine it
reuses the external one, so its boot cost is two loopback probes. A
sidebar/session-list projection cache belongs in the engine as a plain
file, not behind a CRDT.

**Two shell defects found in the boot trace and fixed (desktop repo):**

- `open_studio` re-navigated to the clean root after the 303 exchange even
  though the window was already there — a full second page load every
  boot; only that second load ever painted, ~1.1 s after `dsh web:`.
  Now: settle and return (`lib.rs`, "settled on clean root").
- The splash's `/__arxa/ready` probe threw "Load failed" (the engine's 404
  before the sidebar registers the route carries no CORS header) and the
  catch branch treated that as ready, so the shell invoked on "port open"
  alone. Now: catch = not ready, keep polling; `READY_CAP` 150 → 50
  (10 s bound).

Expected next trace: `ready(status200)=`, `settled on clean root` in
`/tmp/arxa-open-studio.trace`, no `navigate#2`, page `boot@` within
~200 ms of the ready flip.
