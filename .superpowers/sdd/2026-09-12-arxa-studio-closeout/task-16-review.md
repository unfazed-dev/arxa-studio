# Task 16 Part A — review (fresh independent reviewer, 2026-09-14)

Scope: preparation + scratch-safe legs of "Execute authenticated and physical
acceptance gates". Review only — no fixes, no commits, no agents, no
authenticated/physical gates run, no operator state touched (my only network
call: one read-only public GitHub API GET to cross-check G3a digests).

## Verdicts

- **Spec: ❌** — deliverables 1–4, 7 verified sound; deliverable 5's L3
  adjudication is wrong (fault sits in branch diff scope, was ruled
  "pre-existing at BASE", which is impossible for that code), so the
  deliverable-6 fix loop was skipped on an in-scope fault.
- **Quality: Needs-fixes** — 1 Critical, 1 Important, 3 Minor.

## Checklist audit

### 1. Escalated-trio adjudication (core)

(a) **Artifacts exist and support "reproduced at HEAD" — ✅ all three.**
Verified on disk and committed in 4e7f552:
- E2: `designs/evidence/studio-closeout/narrow-capture-logs/1280-finish.log`
  — `composer: activated`, bind JSON answering the fresh session
  (`T8CLOSE/notes/note-wt-260914-001`), and `FAILURE STATE: the git dock never
  mounted`; light+dark PNGs committed.
- E3: `1280-backend.log` — `backend model: mounted-error: connection: invalid
  server-response result`; PNGs committed.
- E1: `1280-langstrip.log` (MISSING squiggles ts/css/json + no preview iframe)
  and `1280-viewer-strip.log` (`dart state: {"strip":false,"editor":true}`,
  light+dark). Probe wrappers `probe-launch.log` / `probe-launch-2.log`
  present; the attempt-1 langstrip exit-13 kill is visible in the log and the
  leg was re-run clean (exit 0, honest MISSING rows) — matches the report's
  integrity note.

(b) **"Pre-existing / BASE-measured" claims:**
- **E1 (L1/L2): SOUND.** `git show 4d1b924:plugins/artifact-viewer/lib/index.js`
  contains the `lsp`-scope route verbatim — `selectedOpenRoot(env, body.rootId)`
  → `403 'no org open'` — i.e. the failing gate is BASE code. The whole branch
  diff on that file is ONE hunk (`@@ -484`, T7's SSE push-stream verify),
  nowhere near :183-191. In-branch squiggle evidence exists (78c1654, richer
  boot env), so the chain works when the install door is person-pressed;
  fresh-boot failure is the BASE gate's designed 403. Keep-row ruling correct.
- **E2 (dock-dead): disposition honors the T8 RIDE CONDITION — ✅.** Fresh
  HEAD probe ran and reproduced; E2 row records the operator's installed
  studio as daily counter-evidence + named external owners (arxa-git-card +
  dsh conversation-input). Note: git-card WAS branch-touched (T4 7d9e866,
  T6 bd14065, T10 62ee8d5, T8-locale 4347f07), so this branch-innocence rests
  on the standing T8 re-review RIDE ruling + counter-evidence, not on
  diff-untouchedness — accepted, that is exactly what the condition mandated.
- **E3 (L3 wp.info): **NOT SOUND — see Critical 1.**

(c) T8 condition closure: honest (fresh probe + external row + counter-evidence).

### 2. Matrix integrity — ✅
20 rows = G1–G13 complete (splits G3a/G5a/G12b/G12c + E1/E2/E3). Counts
reproduced: DONE 8 (G3a, G5a, G7, G12b, G13, E1, E2, E3) · PREPARED 8 ·
EXTERNAL 4. Every DONE row opened on disk: probe logs/PNGs (above), G3a
§G3-notes + SBX_PIN, G5a selftest, G12b log (12 passed, 0 failed incl.
`deploy halts without approval`), G13 decision row. Every PREPARED/EXTERNAL
row carries a verbatim command + named prerequisite/owner (G12/G12c exact
commands present; G12-default-PREPARED per dispatch2 RAM ruling). NO
authenticated/physical row marked DONE. ✅

### 3. Product changes rode along — ✅ (with one note)
- `SBX_PIN` (plugins/sandbox/lib/sbx-install.js): externally verified — I
  re-fetched the public feed (api.github.com …/tags/v0.42.1, read-only):
  22 assets, published 2026-09-07; `DockerSandboxes-darwin.tar.gz`
  `3c5738…8df1`, `linux-amd64` `fe46fa…da6f`, `linux-arm64` `285b36…8dd4c` —
  all three digests + the darwin-universal naming match matrix §G3-notes and
  the pins exactly.
- `selftest.skill-packs.mjs` G5a row is NON-VACUOUS: resolves against the
  REAL app root with an empty scratch ARXA_HOME and `deepEqual []` — a
  bundled pack would fail it.
- `selftest.sbx-install.mjs` keeps the fail-closed invariant row (null pin →
  refused) alongside the new measured-pin rows.
- Only other diff: `package-lock.json` +2 (see Minor 3). No unexplained code.

### 4. Redaction sweep — ✅ CLEAN
Swept all 19 committed files (logs, json, matrix, code, lock) for
token/JWT/key/secret shapes plus `strings` on the 6 committed PNGs for
`token=`: only hit is the matrix's own prose naming its grep patterns;
probe logs show `token=REDACTED`. The nohup-bypass re-redaction held.

### 5. Gates — ✅
- Full studio `npm test` (reviewer re-run): exit 0, `arxa-studio CI: ALL
  GREEN`; suite count reconciled statically against ci.mjs discovery:
  115 plugin selftests + 1 sidebar smoke + 14 pushed suites = **130**.
- Focused re-runs: `selftest.sbx-install.mjs` 12/12; `selftest.skill-packs.mjs`
  6 ok — both green, matching the report.
- G12b: inline matrix verdict + on-disk log verified; not re-run (heavy, per
  review contract).

### 6. PHASE=phone + line-cite drift — ✅
`mobile_flutter/deploy/physical-gates.md` now documents the 4th phase
(PHASE=phone, ARXA_DOORBELL_PUSH / ARXA_APPROVALS_TEST_SEAM /
CAIRN_APNS_SANDBOX + .p8) and the PHASE list. Cites verified against
`approvals_e2e_test.dart`: phone testWidgets + D68 comment @268-277,
`TransportService.resume()` exactly :306, push-token case @318-336. Accurate.

### 7. Commit discipline — ✅
Both commits carry `Co-Authored-By: Claude Code <noreply@anthropic.com>`;
`git diff --check` clean both ranges; studio HEAD 4e7f552 (single commit
8e3bc01..4e7f552), arxa HEAD 3b6e08ea (single commit 5930302d..HEAD,
physical-gates.md only, +6/−3); no push (branch has no upstream movement), no
tags; worktree residues: studio `?? .cache/` only, arxa `?? .cache/` only.

### 8. Report accuracy — matches reproduction on every claim I tested, except
the adjudication narrative (Critical 1) and the stale json pointer (Minor 1).

## Findings

**Critical 1 — E3/L3 adjudicated as "pre-existing at BASE"; the code is
branch-born and the fault sits in branch diff scope.**
`docs/plans/closeout-evidence-2026-09-12.md:152-160` (E3 row + "each measured
pre-existing at BASE during escalation"), `task-16-report.md:30-36`.
Evidence: `git ls-tree 4d1b924 plugins/` shows NO workspace-provider plugin —
`window.__arxaWorkspaceProvider` was created by this branch (T13 72a2a83,
T14 75d090f) and is wired into the probe boot path
(`bin/arxa-studio.mjs:234`), so nothing about it can pre-date BASE. The
transport is exculpated: on the very boots where wp.info failed, the
pre-existing sibling `arxa-provider-status` RPC answered
(`probe-launch.log` slow-list `arxa-provider-status/current`), and that plugin
uses the identical `ctx.inject(['connection'], … rpc.handle)` host shape
(`plugins/provider-status/lib/index.js:209`). The error string is the dsh
client rejecting a non-record result
(`node_modules/@deepseek-ai/dsh-client-connection/lib/client.js:4639,4647`) —
i.e. the branch's own handler never produced a valid record. The plugin's
green selftests are unit-level (fake info results); no live-green evidence of
this surface exists anywhere. Per brief deliverable 5 ("fix test-first if the
fault is in this branch's diff scope") + deliverable 6, the correct Part A
action was a diagnosis-first fix round in workspace-provider, or an
evidence-backed exculpation — not a limitation row justified by a BASE claim
that cannot be true. Required before Part B: diagnose the fresh-boot RPC
failure (registration vs response shape), TDD the fix, re-run the focused
suites + backend probe; or downgrade with real exculpatory evidence.

**Important 1 — §Escalated's blanket "each measured pre-existing at BASE
during escalation" is true only for E1.** E2's actual basis is the T8 RIDE
ruling + operator counter-evidence (no BASE measurement exists); E3's is
false (Critical 1). `docs/plans/closeout-evidence-2026-09-12.md:157-158`.
This sentence must not propagate into Task 17's final matrix — restate each
row's real basis (E1: BASE-identical gate code; E2: RIDE condition honored).

**Minor 1 — `designs/evidence/studio-closeout/narrow-capture-log.json` was
overwritten by the second probe run.** It now holds only 3 viewer rows; the
finish/backend structured rows the §Escalated section cites ("structured rows
…/narrow-capture-log.json") and the T8-era limitation rows (finish/checksred/
confine) are gone from it. Substantive evidence survives in the pair logs +
PNGs; fix the pointer or regenerate a merged json.

**Minor 2 — artifact-column path looseness.** E1/E2/E3 rows cite
`designs/evidence/studio-closeout-2026-09-12/` as the artifact, but the PNGs
and pair logs live under `designs/evidence/studio-closeout/` (only the two
probe-launch logs are in the -2026-09-12 dir). §Escalated/§G7-notes carry the
correct paths; align the artifact column.

**Minor 3 — `package-lock.json` (+2) committed under the test-evidence
message.** The dispatch expected the known lock catch-up to remain as
worktree residue (T1 ruling: environmental, not product). Harmless — the two
lines are the package.json-declared pins catching up — but it deviates from
the recorded residue contract and rides a `test:` message.

## What I ran vs reasoned

Ran: git state/log/stat/diff/-U0/--check on both repos (packages rebuilt
myself from the worktrees, not the txt); read of all four probe/pair logs;
redaction grep over all committed artifacts + `strings` on the 6 PNGs;
`selftest.sbx-install.mjs` (12/12), `selftest.skill-packs.mjs` (6 ok); full
studio `npm test` (exit 0, ALL GREEN; 130 reconciled statically from ci.mjs
discovery); live public-feed digest fetch for G3a; `bash -n` on
sign-and-notarize.sh; `node --check` on the capture wrapper; line-cite reads
against `approvals_e2e_test.dart`. Reasoned (not re-run): E1 BASE comparison
via `git show` of BASE file content; E2 acceptance of the standing T8 RIDE
ruling; E3 branch-causation from plugin birth records + same-boot transport
counter-evidence + dsh client validation site; G12/G12c PREPARED acceptance
(RAM discipline per dispatch2); no browser boots (heavy; logs audited
instead).

## Bottom line

Preparation, matrix, pins, redaction, mobile runbook, and both commits are
solid and independently reproduced. The one real defect is adjudicative:
E3's "pre-existing" ruling cannot hold for branch-born code — route it back
through a diagnosis-first fix round (or evidence-backed downgrade) before
Part B executes. E1's ruling verified sound at the code level; E2's
disposition honors the T8 condition exactly.
