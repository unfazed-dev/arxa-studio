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
