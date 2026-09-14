You are reviewing one task's implementation: first whether it matches its requirements, then whether it is well-built. This is a task-scoped gate, not a merge review. You are a FRESH independent reviewer; the implementer is a different agent you never talk to.

## What Was Requested

Read the task brief: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-11-brief.md

Global constraints from the plan that bind this task (verbatim):
- Interfaces: `sbxStatus`, `sbxLoginFlow`, `ensurePolicy`, `createSandbox`, `startSandbox`, `resolveGitEndpoint`, `fetchSandboxCommits`, `removeSandbox`.
- Safety invariant: never pass `sbx rm --force` until all sandbox commits are reachable from a host ref and verified; retain `refs/sandboxes/<name>/<branch>` as recovery evidence.
- Step 2: bundled or official checksum-pinned artifact per shipped platform + idempotent updater; no Homebrew assumption; unit tests inject downloader/filesystem, never touch the operator install.
- Step 3: A5 is the only tier allowed to require a Docker account; cancellation/failure falls back cleanly and never blocks a session.
- Step 4: policy planning WITHOUT touching global state; fixtures use isolated fake state roots; real `sbx policy init` belongs to Task 16 after explicit authorization.
- Step 5: resolve the port EVERY start, wake before fetch, add/maintain the remote, fetch into a host recovery ref, verify object reachability.
- Step 6: Finish/Sweep refuse teardown with unfetched commits; once reachable, remove non-interactively; report retained cache separately from reclaimed workspace bytes.
- Step 7: injected/fake-state tests ONLY; prepare the exact disposable real-sbx command + expected evidence for Task 16; no sign-in, no global policy change, no operator state mutation here.
- Step 1 matrix: unauthenticated 401, OAuth device flow, daemon stopped, absent global policy, changing ephemeral ports, auto-stopped sandbox, missing host remote, unfetched work, retained image-cache accounting.
- Preserve local-first parity; root confinement; never print secrets; commit message fixed: `feat: add Docker Sandbox isolation with recoverable teardown`.

## What the Implementer Claims They Built

Read the report: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-11-report.md

Claims for your judgment: (1) `SBX_PIN` ships null checksums — fail-closed by design, install leg blocked until Task 16 measures the official v0.42.1 sha256s/asset names; (2) `sbx ls --json` per-entry field shape is INFERRED (tolerant `git://` parse) — Task 16 reconciles against a real listing; (3) A5 lifecycle is interface-only + finish/drop guard — session-start tier selection left to the caller, claimed per brief scope; (4) 4 New findings ledgered (notably: `sbx ls` auto-starts a stopped daemon — side-effectful read).

## Diff Under Review

**Base:** f35389b
**Head:** 18c52cc
**Diff file:** /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-11-review-package.txt

Read the diff file once — commit list, stat, full diff, `git diff --check`. Do not crawl the codebase beyond concrete named risks (one focused check each, named). No git-state mutation; verification runs may create build/test artifacts.

## You Do Not Dispatch Subagents

Do all of this review yourself. Never spawn claude, agents, helpers, or reviewers.

## Do Not Trust the Report

Treat the report as unverified claims; verify against the diff. Rationales never downgrade severity.

## Independent Verification (this plan OVERRIDES the usual do-not-rerun rule)

Independently run, in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout (one suite at a time; RAM-constrained):
1. `node plugins/sandbox/selftest.sbx.mjs` — expect 32 green.
2. `node plugins/sandbox/selftest.sbx-install.mjs` — expect 11 green (verify the fail-closed null-checksum path actually fails an install attempt rather than skipping silently).
3. `node plugins/sandbox/selftest.mjs` — expect 34 green (effective-tier A5 rows).
4. The finish/guard suite the report names (finish 18/18).
5. Full `npm test` — exit 0, ALL GREEN; record suite count.
6. `command -v sbx` — record absence/presence (expected absent; all real paths must be gated off).

DO NOT install sbx, sign in, run any real sbx command, or touch global policy — the real leg belongs to Task 16.

Record commands, exit codes, key lines. If a hook refuses a compound command, split into simple single commands.

## Part 1: Spec Compliance

Compare diff vs brief, step by step (1–8) — Missing / Extra / Misunderstood with file:line. Verify: all eight interface functions; the Step 1 matrix fully covered; checksum-pin + idempotent updater with injected downloader; device-flow surface that never blocks; policy planning on fake state roots ONLY (grep the diff for any real `policy init` execution path); port resolution per start; wake-before-fetch; recovery-ref retention `refs/sandboxes/<name>/<branch>`; the never-force invariant (where is `--force` constructed and what gates it?); finish/drop refusal with unfetched commits; retained-cache vs reclaimed-bytes reporting; Task-16 command plan present in the report.

## Part 2: Code Quality

Parser tolerance vs strictness on the inferred `ls --json` shape (fail-loud on unknown shape, or silent misparse?); no secret/OAuth-code logging; bounded operations; idempotent updater; the side-effectful-read finding (sbx ls auto-starts daemon) — is the code at least honest about it?

## Calibration

Important = task cannot be trusted until fixed (force-rm before reachability = Critical; any real-state mutation path = Critical). External/Task-16 reconciliation items are ⚠️/ruling items, not automatically Important. Polish = Minor. Acknowledge genuine strengths first. Every finding carries file:line.

## Output Format

### Spec Compliance
- ✅ Spec compliant | ❌ Issues found | ⚠️ Cannot verify from diff: [items]

### Independent Verification Results
[commands, exit codes, key lines]

### Strengths
### Issues
#### Critical (Must Fix)
#### Important (Should Fix)
#### Minor (Nice to Have)

### Assessment
**Task quality:** Approved | Needs fixes
**Reasoning:** [1-2 sentences]

Your final message is the report itself — begin directly with the spec-compliance verdict, no preamble.
