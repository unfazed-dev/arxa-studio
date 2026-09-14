You are reviewing one task's implementation: first whether it matches its requirements, then whether it is well-built. This is a task-scoped gate, not a merge review. You are a FRESH independent reviewer; the implementer is a different agent you never talk to.

## What Was Requested

Read the task brief: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-10-brief.md

Global constraints from the plan that bind this task (verbatim):
- Interfaces: `detectDocker()`, `ensureDevcontainer(projectRepo, target)`, `startContainer({ repoPath, branch, sessionId })`, `execContainer(handle, argv)`, `fetchContainerCommits(handle)`, `stopContainer(handle)`.
- Each session branch is cloned into a private named volume. Results return to a host recovery ref through Git before teardown; the container NEVER runs on project `main` and never mounts sibling projects, the organisation root, or a host worktree's pointer-style `.git` file. Refuse teardown until every container commit is reachable from a host recovery ref.
- Per-project Supabase lifecycle: stable project ID, separately allocated/persisted port block, own containers/volume, one active local stack at a time, local file/SQLite as the zero-Docker floor. Never link the vendor's Supabase project.
- Step 4 secrets: consume Task 9's project key + `.env.sops`, decrypt host-side to a bounded temporary file, mount as Compose secret under /run/secrets, clean on every exit path; negative tests for Docker inspect, process arguments, logs, sibling projects.
- Detect, never install Docker/Supabase CLI; missing daemon degrades to A0–A3 with effective reason; no second settings taxonomy for tier UI.
- Preserve local-first parity, root confinement, no secret printing, scratch-only Docker state with cleanup.
- Commit message fixed: `feat: add automatic Docker project isolation`.

## What the Implementer Claims They Built

Read the report: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-10-report.md

Claims for your judgment: (1) Step 6 smoke DEGRADED — docker CLI present but daemon unreachable (`Cannot connect … docker.sock`), so the docker surface ran doubled against an injected runner while the host git recovery loop ran REAL; real-container leg exists behind daemon + `ARXA_A4_REAL_SMOKE=1` but never executed live (image pull / chown-1000 / read-only runtime unverified); (2) supabase CLI 2.67.1 detected, DB tier degrades to sqlite floor here; devcontainer CLI absent (honest path); (3) container-per-session density on low-RAM untested; (4) `--network none` default means in-container installs fail offline BY DESIGN; (5) New finding: freestyle repos' `.arxa` exclusion unverified.

## Diff Under Review

**Base:** fd6fd5f
**Head:** 62ee8d5
**Diff file:** /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-10-review-package.txt

Read the diff file once — commit list, stat, full diff, `git diff --check`. Do not crawl the codebase beyond concrete named risks (one focused check each, named). No git-state mutation; verification runs may create build/test artifacts.

## You Do Not Dispatch Subagents

Do all of this review yourself. Never spawn claude, agents, helpers, or reviewers.

## Do Not Trust the Report

Treat the report as unverified claims; verify against the diff. Rationales never downgrade severity.

## Independent Verification (this plan OVERRIDES the usual do-not-rerun rule)

Independently run, in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout (one suite at a time; RAM-constrained):
1. `node plugins/sandbox/selftest.devcontainer.mjs` — pass (note any honest skips and verify skip honesty).
2. `node plugins/sandbox/selftest.project-database.mjs` — pass.
3. `node plugins/sandbox/selftest.mjs` — pass (34 checks incl. effective-tier A5/A4 degrade reasons).
4. The frame/finish/git-card/file-org-shell suites the report names as pinned — spot-run at least `plugins/file-org-shell/selftest.mjs`.
5. Full `npm test` — exit 0, `arxa-studio CI: ALL GREEN`; capture the suite count.
6. `docker info` — record the daemon state yourself to confirm the degradation claim is environmental, not laziness.

DO NOT attempt to start the Docker daemon, install anything, or set ARXA_A4_REAL_SMOKE=1. The real-container leg is controller-ruled an external pending item (Task 16 / operator-started daemon).

Record commands, exit codes, key lines. If a hook refuses a compound command, split into simple single commands.

## Part 1: Spec Compliance

Compare diff vs brief, step by step (1–8) — Missing / Extra / Misunderstood with file:line. Verify: all six interface functions with the exact signatures; private named volume per session; no-main invariant; never mounting siblings/org-root/pointer-.git (check the mount construction); teardown refusal until commits reachable from host recovery ref; Compose secret under /run/secrets with cleanup on every exit path incl. signals; the four negative secret-leak tests; port block allocation collision-free + persisted by stable project ID; one-active-stack; sqlite floor with truthful reason; tier UI uses existing card/status language with configured-vs-effective; frame generation only through owned functions (devcontainer.json + target-aware Dockerfile).

## Part 2: Code Quality

Injected-runner seam clean (no real docker in unit paths)? Bounded/idempotent lifecycle ops; error taxonomy; escape/realpath on all host paths; secret temp file bounds + signal cleanup; port allocation race-free; pristine output.

## Calibration

Important = task cannot be trusted until fixed (mount escape, secret leak, teardown data loss = Critical). The untested real-container leg is a ⚠️/ruling item, not automatically Important — judge whether the injected-runner coverage genuinely pins the docker command surface. Polish = Minor. Acknowledge genuine strengths first. Every finding carries file:line.

## Output Format

### Spec Compliance
- ✅ Spec compliant | ❌ Issues found | ⚠️ Cannot verify from diff: [items]

### Independent Verification Results
[commands, exit codes, key lines; daemon state]

### Strengths
### Issues
#### Critical (Must Fix)
#### Important (Should Fix)
#### Minor (Nice to Have)

### Assessment
**Task quality:** Approved | Needs fixes
**Reasoning:** [1-2 sentences]

Your final message is the report itself — begin directly with the spec-compliance verdict, no preamble.
