You are performing a SCOPED RE-REVIEW of a fix round for Task 10 (Docker/devcontainer isolation). Work in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout. You are a FRESH reviewer; you judge ONLY whether the listed findings were addressed and whether the fix diff introduced new Critical/Important breakage. Do not re-review the whole task.

## Inputs

- Findings list (the six that entered the fix): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-10-review.md (Issues section, findings 1–6)
- Fix report (appended under `## Fix round 1`): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-10-report.md
- Fix diff package (base 62ee8d5 → head f35389b): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-10-rereview-package.txt

## Verdict per finding

For each of findings 1–6, read the fix diff and judge: **ADDRESSED** (with file:line) or **NOT ADDRESSED** (with why). Specifically:
1. stopContainer rm-refusal: does non-zero rm now cause refusal with row+secretDir kept? Does the stale `row.head` fallback (commits after last fetch) also no longer disarm the guard?
2. real-smoke flag: does `ARXA_A4_REAL_SMOKE=1` now genuinely select a real runner leg that skips honestly when the daemon is down?
3. stale registry read: new-project-id start no longer TypeError/clobbers? Regression test present (started without pre-allocation)?
4. assumed docker: `detectDocker()` on the default path, no import cycle breaking anything?
5. startContainer idempotency: existing session re-start returns live handle from registry, no docker calls?
6. signal-path plaintext: boot sweep of `arxa-secret-*` present + tested; concurrent-process ceiling ponytail-marked?

## New breakage

Flag NEW Critical/Important issues IN THE FIX DIFF ONLY. Out-of-scope observations → note as deferred minors (do not extend the loop).

## Independent verification (run these)

1. `node plugins/sandbox/selftest.devcontainer.mjs` — expect 39 green + 1 honest skip.
2. `node plugins/sandbox/selftest.project-database.mjs` — expect 14 green.
3. `node plugins/sandbox/selftest.mjs` — expect 34 green.
4. `npm test` — exit 0, ALL GREEN; record suite count.
One suite at a time (RAM-constrained). No daemon starting, no installs, no git-state mutation.

## Output

For each finding 1–6: `ADDRESSED` / `NOT ADDRESSED` + file:line + one sentence. Then `New breakage in fix diff:` (Critical/Important items or none). Then `Deferred minors observed:` (or none). Then final line: `Verdict: all findings addressed` or `Verdict: <N> open`.

Your final message IS the report — no preamble.
