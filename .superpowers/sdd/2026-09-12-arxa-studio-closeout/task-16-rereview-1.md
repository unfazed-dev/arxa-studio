# Task 16 — Re-review 1 (fix round 1)

Fresh scoped re-reviewer, canonical read-only, scratch only.
Scope: `4e7f552..HEAD` = `7351ddf` (E3 product fix) + `902551d` (matrix corrections).
Date: 2026-09-14.

## Verdict: ALL FINDINGS ADDRESSED — no regressions, no scope creep

## 1. Package

- `git log --oneline 4e7f552..HEAD` → exactly `7351ddf`, `902551d`. ✓
- `--stat` / `-U10` reviewed (both commits, full diff). ✓
- `git diff --check 4e7f552..HEAD` → clean. ✓
- Trailers: `Co-Authored-By: Claude Code <noreply@anthropic.com>` on both commits. ✓
- Worktree residue: only untracked `.cache/` (scratch). The expected `M package-lock.json`
  churn does NOT reappear — restoration landed inside `902551d` itself, which is cleaner
  than the anticipated residue: `git diff 8e3bc01..HEAD -- package-lock.json` = 0 lines
  and worktree-vs-`8e3bc01` = 0 lines → lockfile bytes identical to `8e3bc01`. ✓

## 2. E3 fix audit (Critical 1)

**(a) Fix half — host wrap, not a client mask.** The wrap lands in the host half
(`plugins/workspace-provider/lib/index.js`): the RPC handler now returns
`{ok:true, value:{provider,config,capabilities}}`, and the unknown-endpoint throw became
`{ok:false, error:{code:'invalid_request', message, details:{}}}` — `invalid_request`
confirmed present in the frozen `errors.js:16`. The client change (`client.js`) is NOT a
tolerance mask: `unwrap` is strict — `ok===true` → `res.value`, anything else → throw.
A bare record (the old shape) is rejected, so the client now accepts only the lawful
envelope, never both shapes. The wire law itself lives in the frozen transport parse,
which the fix never touches — no weakening.

**(b) Wire freeze.** `git diff 3597a40..HEAD -- plugins/workspace-provider/lib/contract.js
wire.js errors.js` → **0 lines** (byte-identical). Note: the lib/ directory as a whole
differs vs `3597a40` (client.js/index.js from this fix + pre-range commits), but the
frozen trio is untouched, exactly as claimed in the commit message.

**(c) RED-first pin genuinely bites at the host seam.** The re-pinned
`selftest.settings.mjs` drives the registered RPC handler directly (`rpcCall` →
`handler(endpoint)`, mirroring how the engine would call it) and asserts `lawfulResult(result)`
— the `{ok:true,value}` / `{ok:false,error:{code,message,details}}` law — before any value
assertions. **Empirically verified**: scratch copy of the plugin with the OLD host
`index.js` (`git show 4e7f552:…`) + the new selftest → exit 1,
`AssertionError: task 13 step 9 / E3: the info RPC result is a lawful dsh server-response
result (ok/value or ok/error), never a bare record`. The pin also asserts the
unknown-endpoint error shape inside the envelope. Not client-only. ✓
Minor (not a defect): `lawfulResult` mirrors the wire law rather than importing the real
parser (transport files are browser-scoped; the mirror is documented in a comment).

**(d) Test runs (this reviewer, this session).**
- 7/7 `plugins/workspace-provider/selftest.*.mjs` → PASS.
- `scripts/engine-boot-smoke.mjs` → PASS.
- Full `npm test` → exit 0, **130 suites, `arxa-studio CI: ALL GREEN`**. ✓

## 3. Matrix corrections (902551d)

- **E3 row**: result = FIXED, commit column = `studio 7351ddf (fix round 1)`, artifacts
  named inline; limitation + external rows withdrawn with branch-born justification —
  verified: `git merge-base main HEAD` = `4d1b924`; `plugins/workspace-provider/` absent
  from `4d1b924` (`git cat-file -e` fails; BASE has other `workspace*` plugins but not
  this one); created by `72a2a83` (diff-filter=A). Claim accurate.
- **§Escalated per-row bases**: E1 = BASE-pre-existing verbatim 403 (spot-verified: BASE
  `4d1b924:plugins/artifact-viewer/lib/index.js` carries the 403 gate lines); E2 = T8
  RIDE condition honored (no BASE measurement claimed); E3 = branch-born, fixed.
  Blanket "pre-existing at BASE" sentence removed; do-not-propagate note for Task 17
  present ("each row's own basis"). ✓
- **narrow-capture-log.json pointer**: now documented as latest-driver-run-only (wrapper
  overwrites each run; never cite as merged history) — truthful; file content is indeed
  the fix-round backend re-capture (`workspace-backend-local`, status ok). ✓
- **E-row/G7 artifact paths**: all verified on disk — `designs/evidence/studio-closeout/
  narrow-capture-logs/1280-backend.log` reads exactly `backend model: mounted:
  title=Workspace backend provider=Local (offline, zero config)` with live badges
  (analytics honestly off) and `EVIDENCE OK @1280 — backend — zero unfiltered console/page
  errors`; old `invalid server-response` error gone. PNG pair
  `1280/workspace-backend-model-{light,dark}-1280.png` present, byte sizes 428295/443430
  matching the commit stat. `studio-closeout-2026-09-12/probe-launch{,-2}.log` present. ✓
- **Lockfile** bytes == `8e3bc01` at HEAD and in the worktree (§1). ✓

## 4. New defects / scope creep

None. `7351ddf` touches exactly the three product files (host, client unwrap, re-pinned
selftest); `902551d` touches exactly evidence artifacts + matrix + the lockfile restore.
PNG/log changes are the justified green re-capture. Binary evidence regenerations match
their cited log content.

Minor observations (no action required):
- `client.js` `unwrap` would silently resolve `undefined` for `{ok:true}` without `value`;
  unreachable while the host supplies `value` (and the frozen transport parse governs).
- The `?? .cache/` untracked directory is scratch residue, consistent with the contract.
