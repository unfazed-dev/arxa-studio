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

## Rounds 4–7 (2026-09-07 01:12 → 01:46): from 4.6s to 2.7s launch→painted

Measured per cold boot (engine.log + page trace), what moved:

| fix | commit | effect |
|---|---|---|
| shell: no re-navigation after the 303 exchange; ready probe throw = not ready | desktop `e90ff601` | one page load instead of two; invoke on `ready(status200)` |
| dsh `coldBlankProbeMaxBytes: 0` (profile patch) | `d0f0e83` | catalog wait 1.2s → 385ms |
| header index (first-line cache) | `63786d1` | **no effect** — decode was not the cost |
| list cache keyed on the set of present logs, one parallel scan | `263b91d` | list 800–1400ms → 4ms; catalog lands before open-res |
| prewarm: first snapshot + pre-open the boot org at apply | `747c9f0` | state 150→0ms host, ensureOpen 215→0ms; painted 1.37s → 1.02s after page start |
| NODE_COMPILE_CACHE on the engine spawn | `747c9f0` | **no effect** (spawn→first apply 1.18–1.27s either way) |
| keychain probe lazy | `d1575c0` | −38ms boot (two sync `security` spawns) |

Page path now (01:46 boot): dcl 66 · client-eval 821 · state 899→917 ·
open 918→1012 · catalog 952 · painted 1036. Everything after the client
script runs is ~215ms; **80% of the page is JavaScript parse/eval before
the sidebar snippet runs** (≈2MB dsh clients + 0.9MB arxa clients, no
bytecode cache on a fresh WKWebView).

Engine boot (CPU profile of an isolated engine, ARXA_HOME relocated):
991ms to the webserver apply = native `read`/`readFileUtf8` 381ms +
`compileSourceTextModule` 99ms + dlopen 39ms (sharp, koffi — dsh's) +
spawnSync 38ms (keychain probe, now lazy). It is module-graph I/O in dsh
core (1744+ files); the loader hook (`loopback-localhost-patch.mjs`)
measured neutral (dump-config 483 vs 482–506ms). Not ours to bundle.

Open levers, by size:
1. Engine persistence across app restarts (launchd agent; rider 1 already
   prefers an external engine) — relaunch would be page-only (~1s). Product
   decision.
2. Client bundle diet / lazy client halves — 0.8s of parse. Trace now
   records `js=<n>/<KB>/last@` to size it.
3. Prune 30 orphan sessions (user's call) — list is cached now, so minor.
4. dsh core bundling — upstream.

## Round 8 — the two remaining levers (2026-09-07)

### Lever 1: engine outlives the shell — DONE (arxa `fda4b2b3`)

Problem: every app launch paid ~1.2–1.3 s of dsh core boot (module-graph file
I/O, upstream), because the shell killed the engine on exit and respawned it.

Fix (`desktop/src-tauri/src/lib.rs`):
- The engine launcher is spawned with `std::process::Command`, `process_group(0)`,
  stdio to `<dsh home>/engine-stdio.log`, and a reaper thread. It is no longer a
  `tauri-plugin-shell` sidecar child, so neither the plugin's exit hook nor the
  shell's death touches it. `RunEvent::Exit` no longer calls `kill_spawned`.
- Owner record `<dsh home>/desktop-engine.json` = `{ pid, stamp }`, stamp = mtime
  of the bundled `arxa-studio` sidecar binary.
- Launch: reachable + owner pid alive + `ps` says it is an arxa-studio launcher +
  stamp matches → adopt (page-only boot). Stamp differs (app update) → kill the
  group, wait for the port, spawn fresh. No owner record → external engine,
  never managed (launchd rider unchanged).
- New menu **Engine → Restart Engine**: kills the owned engine tree, waits for
  the port, spawns, sets `EngineSpawnedAt` so `open_studio` waits for the fresh
  token; the watchdog parks the window on the waiting page meanwhile. This is
  now the dev path after `bin/arxa-engine-sync.mjs` (a payload sync does not
  change the stamp).
- Token reuse across shell runs works because the signing secret is durable
  (`plugins/desktop-session/lib/index.js`): the previous engine's token is still
  the current engine's token.

Measured (02:21, `open -a` → painted trace):
| run | what | open→painted | page start→painted |
|---|---|---|---|
| 1 | cold, fresh engine | 8.45 s (includes `open` latency + engine boot) | 1.17 s |
| quit | app gone, launcher pid alive, port held | — | — |
| 2 | relaunch, adopted, 0 new engine boots | **2.17 s** | 1.17 s |
| menu | Restart Engine → new pid, old dead | 5.2 s to repaint | 1.01 s |

Keychain probe (`plugins/github-link`, `d1575c0`) confirmed absent from the new
engine's boot log.

Known limits: no crash supervision after the shell quits (relaunch respawns);
an uninstalled app leaves the engine running until reboot/`kill`; one global
engine per port. Rollback copy: `~/.arxa/Arxa Studio.app.pre-persist`.

### Lever 2: client bundle diet — NOT WORTH BUILDING (measured)

- Clean boot loads **4 scripts / 1.2 MB** (`js=` mark, 02:21): vite shell
  vendor 723 K + index 413 K, artifact-viewer icons 85 K, plus the dsh
  application combo(s) (size not exposed by Resource Timing). The earlier
  11.5 MB figure was a same-page re-run 9 minutes in, counting Monaco and
  everything else loaded since.
- dsh's `client-modules` composes EVERY plugin client half into one
  application combo (`partitionComboRecords` splits only by URL length),
  served `cache-control: immutable`; `immediately` is parsed but the only
  consumers are dsh's own shell. Factories register on script execution,
  `apply` runs on activation by `dsh-cordis-client-runner` — unused code is
  pre-parsed lazily by WebKit anyway.
- Studio-owned client bytes: 865 KB raw (552 KB without comments/indent) of
  ~5.8 MB total client JS; sidebar 356 KB is needed for first paint. Deferring
  the rest saves ≤ 500 KB of mostly-lazy-parsed code — tens of ms at best
  against the ~780 ms dcl→client-eval window, which is dsh's shell boot.
- Kept: the trace now names the four heaviest scripts (`1b1c9e0`) so a
  regression shows up by name.

### Incident note
While probing the boot HTML from the sandbox, a connection error echoed the
current engine launch token into the session transcript. The engine was
restarted twice since (token rotates per engine boot), so that token is dead.

## Round 9 — launchd agent closes the crash gap (2026-09-07, arxa `see git log`)

`desktop/src-tauri/src/engine_agent.rs` + `lib.rs`:
- The shell writes `~/Library/LaunchAgents/solutions.arxadigital.arxa.engine.plist`:
  `ProgramArguments` = bundled `arxa-studio --no-open`, `RunAtLoad`,
  `KeepAlive.PathState[<sidecar>] = true` (restart on every exit for as long
  as the app binary exists — deleting the app ends the loop), `ThrottleInterval 5`,
  `ProcessType Interactive`, stdio → `~/.arxa/dsh/engine-stdio.log`,
  `EnvironmentVariables` = the shell's own PATH plus any ARXA_* overrides.
- Launch: port owner nobody here started → never managed (rider 1 intact).
  Otherwise: stop a detached engine from round 8 (owner pid), then
  `ensure()`: plist changed or agent not loaded → bootout, wait for the port,
  bootstrap; plist current but sidecar stamp changed (app update) →
  `launchctl kickstart -k`. Owner record becomes `{pid:0, stamp}`.
- Engine → Restart Engine = `kickstart -k` when launchd owns the engine.
- Watchdog: launchd restarts a crashed engine in ~1s, inside one 2s poll, so
  the port never reads down and the page would reconnect its socket while
  still running client bundles the new engine does not serve. The watchdog
  now also tracks the session file's mtime (rewritten once per engine boot;
  baselined on the first up tick) and sends the window through the waiting
  page when it changes.
- No launchctl → the round-8 detached spawn + adopt path.

Measured (02:38–02:40, `open -a` / action → painted trace):
| step | result |
|---|---|
| launch after install (stamp changed) | kickstart, 1 engine boot, painted 7.4 s (first launch of a fresh bundle, Gatekeeper) |
| `kill -9` the engine group | launchd back in 1.0 s, page reloaded and painted 6.2 s |
| Engine → Restart Engine | new pid, old dead, painted 5.4 s |
| quit, relaunch | engine kept, 0 boots, painted **2.2 s** |

Rollbacks: `~/.arxa/Arxa Studio.app.pre-agent` (round 8 build),
`~/.arxa/Arxa Studio.app.pre-agent2`. To stop supervising by hand:
`launchctl bootout gui/$(id -u)/solutions.arxadigital.arxa.engine` and delete
the plist; the shell reinstalls it on next launch. The old dev-machine agent
`solutions.arxadigital.arxa.studio.plist.disabled` is unrelated and stays disabled.
