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

| 14 | **rows-snap flake** — the pending-state test only passed on a slow disk | opt-in `ARXA_SNAPSHOT_DELAY_MS` seam; 5/5 green, was 1/6 |

Verified deterministic: **3 consecutive rounds of 17/17 + e2e self-gate PASS**,
and the frame fixture green on all four states (S1 clean, S2 broken, S3 broken
without `test/`, S4 broken nested).

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

## Deliberately NOT done, and why

**S1 — SandboxProvider + preset flip. Not started.**
`~/.arxa/dsh/settings.yaml:38` still reads `defaultPreset: danger-full-access`,
so the cross-client exposure is still open. The plan's own order is
provider-first, because §17 measured that flipping the preset alone breaks
`dart` and `flutter` (`dsh-sandbox/lib/index.js:154` hardcodes `writableRoots`
with no extension point). The provider must be written against the **dsh base**
profile — `dsh-base/cordis.patch.yml:169-185` — not arxa-studio's own
`profile/cordis.patch.yml`, which carries no sandbox row.

This changes the permissions of the user's live agent environment. Half-landing
it unattended would be worse than not starting: the failure mode is an opaque
permission error on every Flutter command. Next steps, in order:
1. Provider extending writable roots with the **runtime-resolved** FVM/Flutter
   SDK cache (never a hardcoded path — `which flutter` → resolve → cache dir).
2. Swap at the cordis row arxa already overrides.
3. `permission.defaultPreset: workspace-write`.
4. Verify: `dart --version` and `flutter --version` pass, **and** a write to a
   sibling project is denied. `git`/`node`/`npm` already pass — they are the
   regression baseline.

**Version minting — designed, not built.** See `arxa-studio-vocabulary-collisions.md`
§V5. "Agreement provided" cleared arxa's participation, not the wire-format
shape. Building it unilaterally is the `Kind` mistake again.

**Container tiers (L1/L2).** Depend on session→repo routing, which is not done.

## Final verification (all green)

- Plugin selftests **17/17, twice consecutively**
- `scripts/e2e-self-gate.mjs` PASS — arxa's own scaffold passes arxa's own gate
- `scripts/e2e-org-seat-gate.mjs` PASS — a red gate rewinds main, work preserved
- `scripts/frame-gate-fixture.sh` 4/4 states
- Real orgs RESTO/TESTO/TOPO: frame `current`; the newly-wired `frameStatus`
  immediately found two `unversioned` `ci.yml` files and upgraded them, which is
  the wiring proving itself
- project-001 still reds a broken real Flutter target:
  `FAIL: flutter analyze (./05-scaffold/application/ios)`
- arxa repo untouched: `kit/showcase_app` 0 modified, 27/27 relative deps, HEAD
  unchanged at `bdcb530f`
