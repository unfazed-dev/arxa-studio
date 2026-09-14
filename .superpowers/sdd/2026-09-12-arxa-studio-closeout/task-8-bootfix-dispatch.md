You are DIAGNOSING AND FIXING a boot regression blocking Task 8's evidence captures (arxa-studio closeout). Work in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout (git worktree, branch closeout-2026-09-12, HEAD f5e90d4).

## Symptom (reproduced twice, minutes ago)

- `node scripts/engine-boot-smoke.mjs` → PASSES (empty scratch home; serves 200 in 5s).
- Studio boot with ANY registered org → fatal before/independent of serving: `dsh: fatal load failure: failed to apply loader entry arxa-conversation (plugins/conversation/lib/index.js): cannot get property "sessionController" without inject` (cordis-plugin-loader, `Promise.allSettled (index 163)`). Reproduced with (a) the operator's REAL home (multiple orgs, one served URL then fatal), (b) the capture script's scratch home + `organisation.json` + seeded org. Related noise: `[arxa-approvals] $events stream ended: cannot get property "typertGateway" without inject`.
- T7's evidence captures booted org-registered studios successfully at commit 78c1654 — so the regression landed between 78c1654 and HEAD (T9 confinement incl. `profile/cordis.patch.yml` FileSystem-provider swap + launcher preset seeding; T13 workspace-provider row + bin wiring; T14 supabase row are the suspects touching loader/injection surfaces). NO existing suite boots with a registered org (engine-boot-smoke is empty-home) — that's the coverage hole.

## Your job (systematic; cheapest-first)

1. Reproduce minimally: scratch home + `organisation.json` pointing at a seeded org, boot via bin/arxa-studio.mjs, capture the fatal. Confirm empty-home boot still passes.
2. Bisect the boot path across 78c1654..HEAD (git worktree-free: use `git stash`-free scratch checkouts or `git show <sha>:file > /tmp` overrides of ONLY the loader-suspect files — never alter the implementation worktree; commit bisect via `git worktree add /tmp/bisect-<sha> <sha>` scratch worktrees is allowed and preferred, remove them after).
3. Identify the exact breaking change. Likely classes: loader injection order (new provider row), plugin apply path reading a service that isn't injected when an org exists, preset seeding interaction. Do not assume — prove.
4. Fix test-first: add a FAILING boot-with-org smoke row (extend scripts/engine-boot-smoke.mjs or a sibling script wired into scripts/ci.mjs discovery) that reproduces the fatal, then the minimal product fix, then green.
5. Re-run: the new smoke ×3 (flake check), the focused suite owning the touched file, full `npm test` ONCE (exit 0, ALL GREEN, record suite count — count should grow by your new row).
6. Commit: `fix: restore org-registered studio boot` (blank line, trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`). `package-lock.json` dirt stays out.

## Constraints (binding)

Scratch homes/orgs ONLY — NEVER boot against the operator's real ~/.arxa (the controller accidentally did once; do not repeat). Never print tokens (if a boot URL with token appears in captured output, redact it in reports/logs). No browsers. One suite at a time (RAM-constrained). No push/merge/tag. No subagents ever. Findings → ledger append (.superpowers/sdd/2026-09-12-arxa-studio-closeout/progress.md). If the bisect proves the breaking commit is OUTSIDE 78c1654..HEAD (i.e. pre-existing), stop and report BLOCKED with the evidence — do not widen scope.

## Report

Append `## Boot-regression diagnosis + fix` to .superpowers/sdd/2026-09-12-arxa-studio-closeout/task-8-report.md: repro, bisect table (commit → boot result), root cause, fix, test evidence. Reply ONLY (under 12 lines): Status; commit; breaking commit + one-line cause; test summary (incl. new suite count); concerns.
