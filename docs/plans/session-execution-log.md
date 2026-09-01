# Execution log — unattended run

Started after the user left; full permission to proceed, no blocking questions.
Newest last. Every entry is verified, not assumed.

## Done

| # | Item | Verification |
|---|---|---|
| 0 | Committed all outstanding work (83 entries, 65 MB) | secrets scan clean, no `.env`; 7 grouped commits |
| 1 | **B11** gate never reached nested targets | real 106 MB Flutter app: was exit 0 in 0.033 s, now exit 1 in 12 s |
| 2 | **B15** `[ -d test ]` ANDed away the analyzer | fixture S3 red |
| 3 | **B16** `dart test` reds a healthy Flutter app | runner now chosen per target; clean app green in 84 s, 169 tests |
| 4 | **Frame migration** — `FRAME_VERSION`, stamp+hash, upgrade/conflict/force | 4 real legacy repos upgraded, 0 conflicts; wired into `openOrg` + project sweep |
| 5 | **mcp-apps flake** — discovery warnings were swallowed | proved: failure now names `MCP error -32000: Connection closed` |
| 6 | **B1** card reported a dead worktree as clean | `worktreeHealth()`; deleted worktree → `missing`/`null`, no throw |

Suite: **17/17 plugin selftests green.** git-workspace 52/52, file-org-shell 193/193,
arxa-sidebar drift gate green.

## Notes that cost time (worth keeping)

- `check.sh` does `cd "$(dirname "$0")"` — a test invoking it from outside the
  fixture silently tests an empty dir and passes by absence.
- `plugins/arxa-sidebar/lib/client.js` is **generated**. SSOT is
  `lib/workspace-region.snippet.txt` + `scripts/gen-workspace.mjs`, and a byte
  drift gate enforces it. Regenerate with
  `node scripts/gen-workspace.mjs > plugins/arxa-sidebar/lib/client.js`.
- `mcp-apps` failed twice then passed 12/12 unchanged. Root cause never
  reproduced; the test no longer hides the reason.
