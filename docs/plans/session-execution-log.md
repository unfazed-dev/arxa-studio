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

| 7 | **B13** project format stamp written, published, never read | removed from the project contract; org stays the only authority |
| 8 | **Template v4** track/target vocabulary + per-project chosen targets | 3 real orgs migrated 3→4; v3 output byte-identical |
| 9 | **B17** project migration commit `migrate:` fails the frame gate | now `chore(migrate): …` |
| 10 | **B18** org migration pair `stage:` fails the org gate | now `chore(migrate): …` |
| 11 | **B19** org gate walked into project repos, failed on `android/.gradle/9.1.0` | org prunes `projects/`; project gate owns depth-1 stages |
| 12 | **B20** detached snapshot worker committed `stage: scaffold organisation` | the production path's FIRST commit failed the gate while the suite stayed green (only the sync path was tested) |
| 13 | `scripts/e2e-self-gate.mjs` | new: proves arxa's own scaffold passes arxa's own gate |

**B17/B18/B20 are one family:** arxa writing commits its own gate rejects — a
red on a commit the user never wrote and cannot amend. Nothing tested it
because the tests exercised the sync path while production ran the detached
one. `scripts/e2e-self-gate.mjs` now closes that whole class.

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
