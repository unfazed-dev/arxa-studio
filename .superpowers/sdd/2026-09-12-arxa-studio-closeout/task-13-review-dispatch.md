You are reviewing Task 13 as a whole (WorkspaceProvider wire contract + local provider + generic REST adapter; Parts A+B, base e800fe9 → head 72a2a83). Part A already survived its contract-freeze checkpoint review (verdict: CONTRACT STANDS, all 10 ambiguity resolutions upheld, golden pins verified) — do NOT re-litigate the frozen contract. Focus on Part B's implementation and the cross-part integration. You are a FRESH independent reviewer; the implementer is a different agent you never talk to.

## What Was Requested

Read the task brief: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-13-brief.md (Steps 4–10 are Part B's scope; Step 2 checkpoint is settled).

Global constraints binding Part B (verbatim):
- Conformance kit covers: CRUD, watch/poll degradation, adaptive polling transitions (3s/30s/120s + immediate-after-write), optimistic conflict, pagination, audit immutability, blob hashes, member roles (owner|admin|billing|member), idempotent replay, migration round-trip; network providers additionally pass cross-org raw-request/IDOR tests; local reports that section `n/a (single-user local store)`.
- LocalWorkspaceProvider: atomic JSON docs + append-only JSONL under `<ARXA_HOME>/workspace/<orgId>/`, mode 0700 workspace root, ZERO network/account/database/env.
- GenericRestWorkspaceProvider: injected fetch, opaque credential handle via credential service, only the declared sign-in flows, timeouts + bounded retries, maps ONLY Wire v1; hostile fixture server proves tenant/IDOR failures turn conformance RED.
- CLI spellings (only these): `arxa-studio workspace export|import`, `arxa-studio provider verify`, `arxa-studio diagnose`. Export: versioned manifest.json, one JSONL per collection, storage/, members.json, hashes, NO credentials/entitlements/subscriptions; hash-verify before mutation; IDs preserved where accepted / ID map otherwise; members re-invited via provider ops; audit imported read-only. provider verify prints every conformance section, nonzero on any required red row. diagnose: versions, redacted config shape, provider-verify results, bounded error logs, NO tokens/secrets/client records.
- Step 9: scratch profile materialization + host/client settings boot, sidecar pack + manifest inspection for `arxa-workspace-provider`, packed-engine boot, focused conformance + migration pressure + CLI smokes + full npm test.
- Rulings 6/7/8: no arbitrary JS adapters, no npm publish, no staff backdoor capability; token-opaque identity.
- Local-first parity is FIRST-CLASS law: local provider UX equals remote.
- Commit messages: Part A `feat: freeze the workspace provider wire contract`, Part B `feat: add fixed workspace providers and local storage`.
- Checkpoint obligations Part B owed: golden-pin token/session response envelope + X-Arxa-Cursor-Next consume semantics.

## What the Implementer Claims

Read the report (Part A section + `## Part B` section): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-13-report.md

CRITICAL claim to verify first: engine WEB boot (checkout + packed) fails since Task 11 — `git-workspace/lib/sessions.js` imports `sandbox/` which is missing from the pack list (`fiveLibs`); implementer verified identical failure at BASE via stash round-trip and ledgered it high-severity; the CLI-path packed proof stands. Reproduce/adjudicate this: confirm the import exists, confirm the pack list lacks it, and judge whether this is a T11-introduced regression that must be fixed NOW (before Task 14 builds on the plugin) or can ride to a later fix. Note the implementer also ledgered a pre-existing pack-list scanner blind spot that let npm test stay green.

## Diff Under Review

**Base:** e800fe9 **Head:** 72a2a83
**Diff file:** /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-13-review-package.txt

Read the diff file once; do not re-derive with git commands; inspect outside the diff only for concrete named risks (one focused check each). No git-state mutation; verification runs may create artifacts.

## You Do Not Dispatch Subagents

Do all of this yourself. Never spawn claude/agents/reviewers.

## Do Not Trust the Report

Verify claims against the diff. Rationales never downgrade severity.

## Independent Verification (plan overrides do-not-rerun)

In /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout (one suite at a time; RAM-constrained):
1. The five plugin suites + CLI smoke the report names (workspace-provider selftests: contract/local/rest/polling/export + bin CLI suite) — all green.
2. Confirm frozen contract/wire/errors are byte-identical to 3597a40 (`git diff 3597a40..HEAD -- plugins/workspace-provider/lib/contract.js plugins/workspace-provider/lib/wire.js plugins/workspace-provider/lib/errors.js` should be empty).
3. Reproduce the engine-web-boot failure claim at HEAD: run the web-boot smoke/proof the report used (or the smallest equivalent: boot the engine from checkout per the repo's existing boot smoke path) and confirm the sandbox-import failure; then confirm at BASE e800fe9 the same failure exists (per the implementer's claim it PRE-DATES Part B — spot-verify via `git show e800fe9:plugins/git-workspace/lib/sessions.js` importing sandbox, and whether fiveLibs lacked it then too).
4. `npm test` — exit 0, ALL GREEN, record suite count.
5. Redaction spot-check: run `arxa-studio diagnose` (or its selftest) and scan output shapes for token/secret leakage patterns.

## Part 1: Spec Compliance (Part B focus)

Conformance kit coverage vs the 11 listed areas + local `n/a` row; local provider atomicity/0700/zero-env; REST adapter injected-fetch + hostile fixture RED on IDOR/tenant failures; the four CLI spellings EXACTLY and no others added; export manifest fields + no credentials; import hash-verify + ID map + read-only audit; provider-verify nonzero-on-red; diagnose redaction bounds; bin/arxa-studio.mjs wiring (dispatch BEFORE studio boot; PROFILE_PLUGINS/BY_NAME_PLUGINS; packed/materialization checks); cordis.patch.yml host/client row; locale keys en/pl/fr; Step 9 evidence quality (what was actually proven vs claimed).

## Part 2: Code Quality

Atomicity mechanism (temp+rename? fsync?), JSONL append discipline, ETag/If-Match optimistic conflict correctness, cursor codec round-trip, retry/timeout bounds honored, hostile fixture genuinely hostile (does it exercise cross-org paths?), diagnose bundle bounded, pristine test output.

## Calibration

Important = cannot be trusted until fixed. The engine-web-boot regression: if you confirm it breaks the PACKED product boot, that is at least Important regardless of which task introduced it — rule on the cheapest correct fix location (pack list + scanner blind spot). Polish = Minor. Strengths first. Every finding carries file:line.

## Output Format

### Spec Compliance
- ✅ / ❌ / ⚠️ items

### Web-Boot Regression Adjudication
[what you reproduced, where it lives, fix-location ruling]

### Independent Verification Results
[commands, exits, key lines]

### Strengths
### Issues
#### Critical (Must Fix)
#### Important (Should Fix)
#### Minor (Nice to Have)

### Assessment
**Task quality:** Approved | Needs fixes
**Reasoning:** [1-2 sentences]

Your final message IS the report — begin with the spec-compliance verdict, no preamble.
