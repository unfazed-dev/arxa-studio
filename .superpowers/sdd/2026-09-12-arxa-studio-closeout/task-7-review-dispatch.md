You are reviewing one task's implementation: first whether it matches its requirements, then whether it is well-built. This is a task-scoped gate, not a merge review — a broad whole-branch review happens separately after all tasks are complete. You are a FRESH independent reviewer; the implementer is a different agent you never talk to.

## What Was Requested

Read the task brief: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-7-brief.md

Global constraints from the plan that bind this task (verbatim):
- Security invariant: extension/webview execution receives NO ambient studio cookies, credentials, host bridges, or mutation token; file access remains explicit, scoped, short-lived, and root-bound.
- Step 2: build-manifest/allowlist test permits ONLY pinned vendored built-ins registered in `monaco-build/src/entry.mjs`; marketplace/VSIX loading stays disabled.
- Program ruling 3: Prettier and pdf.js REMAIN — no removal, no PDF extension experiment, no allowlist widening.
- Program ruling 4: the tested 1.5-second viewer debounce remains autosave owner; ownership changes only on a probe-proven competing save path + save-race suite.
- Step 9 gate: `npm ci`, `npm run build`, `node check.mjs`, `node check.mjs --webkit` in monaco-build; every `plugins/artifact-viewer/selftest*.mjs`; root `npm test`; updated live runbook.
- Step 4: deterministic diagnostics in `.ts`, `.html`, `.css`, `.json`; 390/744/1280 evidence with zero console/page errors.
- Commit message fixed: `fix: close artifact viewer runtime and trust boundaries`.

Implementation history (does not soften findings): three implementer attempts were OOM-killed leaving WIP; a fourth finished, verifying/keeping the WIP and adding two in-scope fixes (a WIP-introduced sidebar SSE break; a deterministic LSP wedge — server kept past its last socket). Judge only the diff.

## What the Implementer Claims They Built

Read the report: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-7-report.md

Three flagged concerns for your judgment:
1. 390/744 ladder evidence BLOCKED — sheet won't mount on emulated resize and no headless file entry at narrow widths; 1280 captured. The plan's Task 8 later captures the full ladder for ALL touched surfaces (including viewer) under the same `designs/evidence/studio-closeout/` tree via the arxa lens. Rule whether the Step 4 gap is acceptable-deferred-to-Task-8 or a real spec failure this task must close.
2. Brief's `.html` squiggle claimed unsatisfiable by design (preview lane; html server validates nothing by default) — documented, not force-changed. Judge the claim.
3. Zero-console-error gate scoped with a named filter list (ledger-recorded). Judge whether the filters are honest or masking.

## Diff Under Review

**Base:** 82296f8
**Head:** 78c1654
**Diff file:** /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-7-review-package.txt

Read the diff file once — commit list, stat, full diff with context, `git diff --check`. Do not re-derive with git commands; do not crawl the codebase. Inspect code outside the diff only for a concrete named risk — one focused check per named risk, named in your report. No git-state mutation; verification runs may create build/test artifacts.

## You Do Not Dispatch Subagents

Do all of this review yourself. Never spawn claude, agents, helpers, or other reviewers.

## Do Not Trust the Report

Treat the report as unverified claims; verify against the diff. Rationales never downgrade severity.

## Independent Verification (this plan OVERRIDES the usual do-not-rerun rule)

Independently run, in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout (run the RAM-heavy browser gate FIRST while your context is small; one command at a time):
1. In `plugins/artifact-viewer/lib/monaco-build`: `npm ci` (skip if node_modules current and lock unchanged), `npm run build`, `node check.mjs`, `node check.mjs --webkit` — all green.
2. Every `plugins/artifact-viewer/selftest*.mjs` (there are several) — all pass.
3. Root `npm test` — exit 0, `arxa-studio CI: ALL GREEN`.
4. Inspect `designs/evidence/studio-closeout/` — what actually exists at 390/744/1280, and does the 1280 evidence show the language strip with deterministic diagnostics and the zero-error claim?

Record commands, exit codes, key lines. If a hook refuses a compound command, split into simple single commands.

## Part 1: Spec Compliance

Compare diff vs brief, step by step (1–10) — Missing / Extra / Misunderstood with file:line. Specifically verify: the threat-model table exists IN the plan doc with per-row current behavior; the allowlist test actually fails on an arbitrary entry (how does it pin?); ambient-capability closures (cookies/CSP/localStorage/parent access/fetch reach/token exposure/navigation); LSP runtime invariants incl. Dart-absent guidance WITHOUT downloader; autosave single-owner probe; pdf.js + Prettier retained; gen-ui Step 8 branch decision and its evidence (which branch, and does it meet that branch's requirements?); runbook updated. Requirements outside the diff → ⚠️ items.

## Part 2: Code Quality

Allowlist enforcement soundness (can it be bypassed at runtime, not just build?), the two in-scope fixes (SSE break, LSP last-socket scoping) — correct and regression-tested? Root-confinement on any new file paths; escape discipline on diagnostics text; pristine test output; no debug leftovers.

## Calibration

Important = task cannot be trusted until fixed. Polish = Minor. Acknowledge genuine strengths first. Every finding carries file:line.

## Output Format

### Spec Compliance
- ✅ Spec compliant | ❌ Issues found | ⚠️ Cannot verify from diff: [items]

### Independent Verification Results
[commands, exit codes, key lines; evidence-tree inventory]

### Strengths
### Issues
#### Critical (Must Fix)
#### Important (Should Fix)
#### Minor (Nice to Have)

### Assessment
**Task quality:** Approved | Needs fixes
**Reasoning:** [1-2 sentences]

Your final message is the report itself — begin directly with the spec-compliance verdict, no preamble.
