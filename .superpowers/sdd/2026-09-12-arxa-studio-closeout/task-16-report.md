# Task 16 report — Authenticated and physical acceptance gates

## Part A (attempt 2 — attempt-1 WIP judged, verified, completed)

Attempt 1 (OOM-killed) left: the matrix skeleton with §G3-notes measured and
`SBX_PIN` filled, both selftest extensions, the finish/backend probe legs, and
the physical-gates.md gap-fix. All verified real and kept. Attempt 2 completed
the probe (langstrip + viewer-strip legs on a fresh boot), the remaining
matrix sections, G12b, prep verification, the full test run, and the commits.

Integrity note: attempt 1's wrapper survived its session's OOM and kept
running during attempt 2's startup; its langstrip pair was killed by attempt
2's leftover-chrome sweep (exit 13) — that leg was re-run cleanly on a fresh
boot. The finish/backend legs (studio alive when captured) stand.

### Adjudications (deliverable 5) — HEAD `8e3bc01`, fresh scratch boots, 2026-09-14

- **L1/L2 (E1) viewer LSP chain: REPRODUCED — keep pre-existing defect row.**
  Evidence: `designs/evidence/studio-closeout-2026-09-12/probe-launch-2.log`;
  `…/studio-closeout/narrow-capture-logs/1280-langstrip.log` (no ts/css/json
  squiggles, no html preview iframe); `1280-viewer-strip.log` (dart state
  `strip:false, editor:true`, light+dark shots
  `1280/viewer-install-strip-{light,dark}-1280.png`). Owner: artifact-viewer
  owner; trigger: any fresh scratch boot (install-door-coupled chain).
- **Dock-dead (E2): REPRODUCED — keep limitation + external rows (RIDE
  respected).** Evidence: `…studio-closeout-2026-09-12/probe-launch.log`
  (finish leg: create ✓ open-via-row ✓ bind ✓ composer ✓, `[data-git-dock]`
  never mounts); `…narrow-capture-logs/1280-finish.log`;
  `1280/finish-failed-{light,dark}-1280.png`.
- **L3 (E3) wp.info: REPRODUCED — keep limitation + external row.** Evidence:
  `…narrow-capture-logs/1280-backend.log` (`mounted-error: connection:
  invalid server-response result`; provider keys present);
  `1280/workspace-backend-model-{light,dark}-1280.png`.
- None branch-caused (each pre-existing at BASE; T8 diffs literals→`t()`
  only) → no fix loop; documented limitation/external rows (deliverable 5's
  else-branch).

### Deliverables

1. **Matrix** `docs/plans/closeout-evidence-2026-09-12.md` — 20 rows:
   **DONE 8 · PREPARED 8 · EXTERNAL 4** (DONE: G3a, G5a, G7, G12b, G13, E1,
   E2, E3 · PREPARED: G1, G2, G4, G5, G6, G8, G12, G12c · EXTERNAL: G3, G9,
   G10, G11).
2. **physical-gates.md** (arxa worktree): PHASE=phone real-APNs doorbell leg
   documented (attempt 1, kept); line-cites re-verified against
   `approvals_e2e_test.dart` — PHASE=phone @268-277, re-dial wait @290-313
   (`TransportService.resume()` exactly :306), push-token case @319-336 —
   all accurate.
3. **Prep verification**: every matrix script parses (`node --check` /
   `bash -n`); zero hardcoded secret shapes; credentials env/keychain-only;
   wrapper redacts `token=` in persisted logs; G9's draft path corrected to
   the arxa worktree's `desktop/scripts/sign-and-notarize.sh` (bash -n green).
4. **Scratch-safe legs run**: G3a feed measurement (attempt 1, pins verified
   by selftest); G5a skill-pack policy test 6 ok; G7 fresh-boot probe (4
   pairs, all EVIDENCE OK, honest FAILURE-STATE/MISSING rows); sbx-install
   selftest 12/12; G12b `arxa deploy --self-test` exit 0, 12/12 (incl.
   `deploy halts without approval`). G12/G12c PREPARED under RAM discipline
   (exact verbatim commands in §G12-notes).
5. See adjudications above.
6. No fix loop — no in-repo failure found.
7. Commits: studio `4e7f552` + arxa `3b6e08ea` under
   `test: record authenticated and physical closeout evidence`.

### Test gates

- `plugins/sandbox/selftest.sbx-install.mjs` — 12 checks green (measured-pin
  fill + unmeasured-pin-still-fails-closed rows).
- `plugins/claude-code/selftest.skill-packs.mjs` — 6 ok (bundled-root-empty
  G5 policy).
- Full studio `npm test` — **130 suites ALL GREEN** (2026-09-14).

### Authorization request list (Part B, per-leg)

- **G1** card-cicd-smoke: consumes GitHub private-repo Actions minutes.
- **G3** real sbx leg: OAuth login + **mutates operator sbx state/policy**;
  disposable sandbox lifecycle in the operator's daemon.
- **G5** Claude signed-in smoke: runs under the operator's signed-in `claude`.
- **G6** Z.ai live smoke: one metered API call under `ZAI_API_KEY`.
- **G9** release gates: notarization submission (Apple quotas) + first live
  `release-linux` tag/publish.
- **G2/G4/G10** operator-machine: operator starts own Docker daemon/VM (legs
  spend no credentials).
- **G11** CI: operator pushes branch + sets branch protection.
- **G8** physical: devices + real APNs `.p8` / FCM credentials.

### Concerns

- The escalated trio all reproduced at HEAD — the branch closes with honest
  limitation + external rows (owners named), not fixes.
- G12/G12c remain PREPARED: simulator + Gradle/fastlane are the OOM class;
  rerun on an idle machine.
- Arxa-side evidence logs are `*.log`-ignored by convention (`mobile_flutter/
  .gitignore`): G12b's verdict is recorded inline in the matrix row; the
  artifact lives on disk in the worktree.

## Fix round 1 (2026-09-14, review findings applied)

### Fix 1 — E3/L3 wp.info (Critical): FIXED, studio `7351ddf`

The Part A "pre-existing at BASE" ruling for E3 is retracted — the reviewer
was right. workspace-provider is branch-born (absent from BASE `4d1b924`'s
plugin tree; created T13 `72a2a83`/T14 `75d090f`, wired into boot by T13
`4cc0380`), so the Part A adjudication could not hold.

**RED (live, fresh scratch boot, free port, one-shot driver modeled on
engine-boot-smoke — no browser needed; the RPC is plain HTTP + session
cookie).** Same boot, two channels:

- Control `/arxa-provider-status/current` → HTTP 200
  `{"type":"server-response","rpcId":"probe-vsyh67h9qq8","result":{"ok":true,"value":{"status":{…claude usage…}}}}`
  — transport exculpated (matches Part A's in-browser finding).
- Target `/arxa-workspace-provider/info` → HTTP 200
  `{"type":"server-response","rpcId":"probe-pznd76g607s","result":{"provider":"local","config":{"provider":"local","sections":[]},"capabilities":{"auth":true,…,"analytics":false}}}`
  — `result` is the handler's bare return, no `ok` field.

**Root cause, three independent sites:** the engine hands the RPC handler's
return VERBATIM to the browser as the server-response `result`
(`@deepseek-ai/dsh-client-connection` `rpcFetchHandler` → `fullResponse(rpcId,
result)`, lib/index.js:605,654); the browser's `parseConnectionResponse`
accepts only `{ok:true,value}` / `{ok:false,error:{code,message,details}}`
(client.js:4637-4654 — `result.ok===undefined` throws exactly `connection:
invalid server-response result`); the working sibling handler
(`plugins/provider-status/lib/index.js:209`) returns `{ok:true,value:…}`.
Our host half returned the bare record; the browser half additionally did no
unwrap. The green Part A selftest was green only because it called the
handler directly, bypassing the engine wrapper.

**TDD:** `selftest.settings.mjs` re-pinned FIRST — envelope-law mirror of
`parseConnectionResponse` (`lawfulResult`), unknown-endpoint-inside-envelope
row, client.js unwrap static rows. RED run failed at
`task 13 step 9 / E3: the info RPC result is a lawful dsh server-response
result (ok/value or ok/error), never a bare record`. Fix then green:
host half returns `{ok:true,value:{provider,config,capabilities}}` (errors
inside the envelope, code from the frozen ERROR_CODES set), browser half
`info()` unwraps `rpc.call`'s envelope to the bare record panel callers
expect.

**GREEN (live):** same driver → `result":{"ok":true,"value":{"provider":"local",…}}`
— LAWFUL. Browser lane re-captured: `1280-backend.log` now reads
`backend model: mounted: title=Workspace backend provider=Local (offline,
zero config)` with live badges (analytics honestly off), both shots ok,
exit 0.

**Wire freeze held:** `git diff 3597a40 -- plugins/workspace-provider/lib/
{contract,errors,wire}.js` → zero diff (byte-identical). Fix touched only
`lib/index.js`, `lib/client.js`, `selftest.settings.mjs`.

**Gates:** all 7 workspace-provider selftests green; `npm run smoke` green
(boot 4s); full `npm test` **130/130 ALL GREEN** (0 red).

### Fix 2 — §Escalated wording (Important): DONE

The blanket "each measured pre-existing at BASE" sentence is gone. §Escalated
now states each row's real basis: E1 = pre-existing at BASE (verbatim 403
gate in `git show 4d1b924:plugins/artifact-viewer/lib/index.js`); E2 = T8
RIDE condition honored (fresh-HEAD probe + external rows + operator's
installed studio counter-evidence; no BASE claim); E3 = branch-born, FIXED
`7351ddf`. Explicit do-not-propagate note for Task 17 added.

### Fix 3 — Minors: DONE

- **Minor 1:** §Escalated's "structured rows … narrow-capture-log.json"
  pointer replaced — the wrapper overwrites that json every run (root cause
  of the staleness); the durable record is the pair logs + PNGs, and the
  matrix now says so explicitly.
- **Minor 2:** matrix artifact column aligned to reality (no file moves —
  committed paths others cite must not churn): E1/E2/E3 + G7 rows now point
  at `designs/evidence/studio-closeout/` for pair logs + PNGs and name
  `studio-closeout-2026-09-12/` for the two probe-launch logs only.
- **Minor 3:** `package-lock.json` restored from `8e3bc01`
  (`git checkout 8e3bc01 -- package-lock.json`) and committed with this
  round's docs — the +2 lock catch-up rides no `test:` message and the
  residue contract is restored.

### Commits

- `7351ddf` `fix: return the dsh result envelope from the workspace info RPC`
  (product fix, RED evidence above).
- this round's docs commit: matrix/§Escalated/minors + green backend
  evidence re-capture + lockfile restore + this report section.

### Concerns (fix round)

- None open on E1–E3. The withdrawn E3 external-owner row no longer applies;
  E1/E2 dispositions unchanged and re-affirmed per-row.
