# Task 8 report — no-browser half (locale + visual acceptance)

Commit: **5c2f83a** `feat: complete studio locale and visual acceptance` (BASE ce5e82e, branch closeout-2026-09-12)
Status: **DONE_WITH_CONCERNS** (concerns are all deferred-to-capture-dispatch or informational; no open code defects found in this half)

## 1. Parity-test verification

**Test:** `plugins/locale/selftest.parity.mjs` (new, 145 lines). One gate asserting en/pl/fr key-set identity (missing + extra, per locale) plus `en !== pl !== fr` literal-guard, plus wiring pins (`ctx.locale.register(NS, {en, pl, fr})`, `locale: NS` on slot registrations) for seven owners: arxa-locale (common + settings.locale ns), arxa-sidebar (workspace-region enOver/plOver/frOver + the shell's arxa-added `session.new.err.mainRed` key pinned in all three), arxa-git-card, artifact-viewer, workspace-provider (DICT tables), arxa-personalisation, arxa-theme-accent (Settings > Personalisation tab). Dictionaries are parsed from source with a string-aware brace-balanced object-literal extractor; keys matched only in key position (after `{`/`,`/newline) with the value's opening quote, so prose colons in values can't masquerade as keys.

**GREEN (worktree):** `node plugins/locale/selftest.parity.mjs` → `locale parity: all green` (personalisation 9 keys, theme-accent 20 keys per table; all seven owners pass all six sub-checks).

**RED evidence (honest, scratch copy):** built a scratch tree at `/tmp/t8-parity-red.IdNu/` (mktemp; worktree never touched), copied the parity script to `scratch/plugins/locale/`, materialised every probed file from BASE via `git show ce5e82e:plugins/<f>` (locale/arxa-sidebar×2/arxa-git-card/artifact-viewer/workspace-provider/personalisation/theme-accent client files + the snippet), ran the script from the scratch tree:

```
FAIL  parity: arxa-personalisation en/pl/fr key sets identical — en table missing
FAIL  parity: arxa-personalisation registers its tables through the arxa-locale service
FAIL  parity: arxa-personalisation declares locale on its slot registrations
FAIL  parity: arxa-theme-accent en/pl/fr key sets identical — en table missing
FAIL  parity: arxa-theme-accent registers its tables through the arxa-locale service
FAIL  parity: arxa-theme-accent declares locale on its slot registrations
locale parity: 6 FAILURE(S)
```

The six failures are exactly the task-8 additions — at BASE the two tab owners had no dictionaries at all. Every other owner was already parity-green at BASE (their pl/fr tables shipped complete in Tasks 4/6/7/12–14), so the test's RED is precisely the tab-localization delta, and the WIP turns it GREEN. The script is auto-discovered by `scripts/ci.mjs` (discovery regex `/^selftest(\.[\w-]+)?\.mjs$/` matches `selftest.parity.mjs`), so CI runs it forever.

## 2. Keys added per plugin

**arxa-personalisation** (`plugins/personalisation/lib/client.js`, +84/−13): 9 keys × 3 locales — `section.title`, `appearance.title`, `appearance.light`, `appearance.dark`, `appearance.system`, `font.title`, `font.desc`, `font.increase`, `font.decrease`. Wiring: `NS = 'arxa-personalisation'`; `ctx.effect(() => ctx.locale.register(...))`; section `label: () => t('section.title')` with `locale: NS` (settings shell re-resolves label functions on locale revision); `AppearanceRow`/`FontSizeRow` take `{ t }` via composed slot props (the stock AppearanceRow contract); `inject = ['slots', 'locale']`.

**arxa-theme-accent** (`plugins/theme-accent/lib/client.js`, +134/−12): 20 keys × 3 locales — `palette.title`, `palette.desc`, `palette.custom`, `palette.addAria`, `palette.pasteHint`, `palette.swatchesAria` (with `{name}` interpolation), `palette.inputPlaceholder`, `palette.inputAria`, `palette.add`, `palette.err`, `palette.noteMarks`, `palette.noteAA`, `palette.noteAdjusted`, `palette.noteBelowAA`, `palette.noteOffline`, `font.title`, `font.desc`, `font.aria`, `font.default`, `font.defaultTitle`. Wiring: same register/bind/`locale: NS` pattern on both slot registrations (`arxa-theme-accent` order 0, `arxa-theme-accent-font` order 10).

**Product terms preserved verbatim (CONTEXT.md):** "artifact viewer" (CONTEXT.md:153 defines it as the product term — pl "edytor artifact viewer", fr "l'éditeur de l'artifact viewer"), "coolors" (URL/domain), "Fira Code" (font product name — `label` kept untranslated with `labelKey` only on `default`), "AA"/"APCA" (contrast standards), "monospace"/"hex" (technical). Never translated: IDs, paths, hex-code example `1a1423-b75d69`, placeholders' URL shape. French uses proper typographic apostrophes (l'éditeur) — UI-length-safe phrasing throughout (steppers/labels kept short).

**Missed-key sweep:** grepped the two files for hardcoded user-facing literals (`aria-label': 'X`, `title': 'X`, `placeholder': 'X`, capitalized literal children) outside `t(` — zero remain (only dictionary values match). Cross-plugin: `locale.register` exists in exactly locale, sidebar, git-card, artifact-viewer, workspace-provider, personalisation, theme-accent (+ pre-existing arxa-dashboard, out of task-8 scope, untouched) — all parity-gated except dashboard. **plugins/sandbox has no client-side dictionary at all** (no client.js; host-side lib only) — its dispatch-listed "sandbox" entry resolves to zero user-facing keys; the confinement row users see is arxa-git-card copy (parity-covered). No user-facing key added by T2–T14 lacks en/pl/fr.

## 3. Evidence-gate driver (`scripts/evidence-gate.mjs`, 503 lines)

The in-repo replacement for Task 7's out-of-repo `/tmp/arxa-task7` driver (Task 7 review condition b — the gate and its filter list must be reviewable). Boots ONE headless Chrome per run at a real `--window-size` window per width (Task 7 proved the viewer sheet never mounts on emulated resizes), drives surfaces over CDP, screenshots into `designs/evidence/studio-closeout/<width>/`, theme flips ride the REAL user path (Settings → Personalisation → Appearance row; the persisted preference re-assert fights prefers-color-scheme emulation), and FAILS on any console/page error not on the named filter list.

**Named, justified IGNORED list (3 patterns, each citing the ledger):**
1. `/__dial\/events/` — design-panel's dial backend (127.0.0.1:4319) is never booted by `bin/arxa-studio.mjs`; every scratch boot logs ERR_CONNECTION_REFUSED. Pre-existing, unrelated to any gated surface (progress.md Task 7 finding).
2. `/No Project/` — tsserver warmup race (`<semantic> No Project`, ProjectService default-project race); Task 7 proved it identical on the untouched org's original app.ts.
3. `/Request textDocument\/(codeAction|semanticTokens)/` — the requests that fail while the warmup race lands; transient, pre-existing.

Anything not matching fails the gate (`GATE ERRORS → exit 1`); filtered hits are still PRINTED under `FILTERED (pre-existing, justified in scripts/evidence-gate.mjs)`. Surfaces implemented: dump, settingsdump, personalisation, backend (real `__arxaWorkspaceProvider.section` model over the real info RPC, rendered with `--dsw-*` tokens), sessiondump, sessionopen, gitcard, trashdump, viewer-strip, sweep, finish, checksred (real stray-temp-file gate failure, cleaned in `finally`), preparation, trash (real softDelete entry; confirm modal opened/shot/dismissed, nothing purged), confine (A4 tier seeded on a scratch session, real resolver + row render).

**Bug found and fixed in this half:** the inherited driver used `repo` (line 441, trash surface's import of `workspace/lib/trash.js`) without ever defining it — a guaranteed `ReferenceError` the capture dispatch would have hit mid-run. Fixed: `const repo = resolve(here, '..')` beside `OUT`. `node --check` green. The driver itself was NOT executed in this dispatch (no-browser mandate); its 1280 outputs below are the prior implementers' runs of this same script.

## 4. Files changed (commit 5c2f83a)

- `plugins/locale/selftest.parity.mjs` — new parity gate (145 lines)
- `plugins/personalisation/lib/client.js` — 9-key en/pl/fr dictionary + service wiring
- `plugins/theme-accent/lib/client.js` — 20-key en/pl/fr dictionary + service wiring
- `scripts/evidence-gate.mjs` — in-repo evidence gate driver (+ repo fix)
- `designs/evidence/studio-closeout/1280/` — 7 new PNGs (dispatch said 6; tree carried 7 — carddump + gitcard/personalisation-tab/sweep-modal in light+dark pairs; all committed; the 6 was a miscount, not a missing file)
- `package-lock.json` left dirty/uncommitted (pre-existing, per dispatch)

## 5. Tests

Focused (one at a time, all green): `locale/selftest.mjs` (ALL CHECKS PASSED), `locale/selftest.parity.mjs` (all green), `personalisation/selftest.mjs` (ALL GREEN), `theme-accent/selftest.mjs` (ALL GREEN), `arxa-git-card/selftest.mjs` (ALL GREEN), `arxa-sidebar/selftest.mjs` (ALL GREEN), `artifact-viewer/selftest.mjs` (GREEN ×2), `workspace-provider/selftest.settings.mjs` (4 checks green). `npm test` run ONCE after the fix: **`arxa-studio CI: ALL GREEN` — 129 suites** (114 plugin selftests at BASE + 1 new parity + 14 pushed script/bin suites; ledger's T14 "129" and this run's 129 differ by one in composition, not in outcome — the parity suite is included and passing). No browser launched; nothing killed.

## 6. Self-review + concerns

- The parity extractor is heuristic (regex key-position scan over a brace-balanced literal), but string-value-aware and guarded by the "real translation" literal checks; all seven owners' tables are plain string-valued literals, which is what it's built for.
- `label: () => t('section.title')` relies on the settings shell re-resolving function labels on locale revision — pattern documented in-file as the stock General section's own; personalisation selftest + 1280 evidence (personalisation-tab-*.png) show it rendering.
- DONE_WITH_CONCERNS driver caveat: `scripts/evidence-gate.mjs` is committed review-verified but not executed in this dispatch (no-browser mandate) — beyond the fixed `repo` bug, its runtime behavior is only as proven as the 7 PNGs the prior implementers captured with it.
- Step 3 (PL/FR native-speaker review subagents) is owned by separate controller dispatches, not this one — translations here are my best-effort pl/fr with product-term preservation; reviewer corrections should land as follow-up commits.
- Workspace-backend surface renders as a real model (`*-model-` naming) because no studio panel mounts it yet — documented in the driver; visual honesty preserved.

## 7. Remaining for the capture dispatch (390/744)

The separate later dispatch owns ALL narrow-width evidence (do NOT treat this half as covering it):
- **390/744 ladder for every Task 8 surface**: Finish dialog, Sweep, Checks-red disclosure, project preparation, trash confirm/recovery, viewer install strip, configured/effective confinement, Workspace backend/sign-in states, Personalisation tab — light+dark where the component differs, via `scripts/evidence-gate.mjs <390|744> <surface…>`.
- **The artifact-viewer viewer ladder at 390/744 — the Task 7 review condition** (viewer surfaces beyond the 744 dart strip; blocked at BASE by the medium finding that the artifact-viewer sheet never mounts on emulated resizes and the wide-only sidebar is the only headless entry — the per-width native-launch design in the driver is the mitigation path).
- The capture-only commit lands as `docs: complete the narrow-width evidence ladder` (controller ruling: the plan's single message splits across the two dispatches).

## Part B — capture script

**Artifact:** `scripts/evidence-capture-narrow.mjs` (331 lines) — the controller-run, zero-interaction driver for the whole 390/744 ladder. Committed together with the narrow-lane enablement that was sitting uncommitted in `scripts/evidence-gate.mjs` (the 390 boot-time device pin, the narrow-rail Settings-trigger fallback, and the `langstrip` surface — without them a fresh checkout produces 500px "390" shots and has no viewer-language lane at all; T8B's flight added them but never committed).

**Design — reuse by execution, not duplication.** The browser half of every pair already exists, review-verified, in `scripts/evidence-gate.mjs`: per-run headless Chrome at the real `--window-size`, the product's real selectors/flows, PNGs into `designs/evidence/studio-closeout/<width>/`, and console/page-error gating. Importing the gate is impossible (it is a top-level CLI that spawns Chrome at import time), so the driver spawns it once per (width × gate-surface) and reads its verdict lines (`EVIDENCE OK`, `EVIDENCE FAIL: …`, `GATE ERRORS (n)`, `FILTERED (pre-existing…)`). The IGNORED filter list therefore stays single-sourced in the gate — this driver contains zero error-filter patterns. The driver itself imports only node builtins and never talks CDP.

**Boot + seeding** (mirrors `scripts/engine-boot-smoke.mjs`, the repo's boot-smoke path): `mkdtemp` scratch → `home/` (ARXA_HOME + HOME, parent `DSH_*` stripped) → `org/T8CLOSE` seeded with the exact shape T8B proved against: the five docks, `org.json`, `check.sh` generated from the SSOT (`plugins/git-workspace/lib/frame.js` `projectCheckSh()`), `main.dart` + the four deterministic broken `langstrip.*` fixtures, `.git/arxa/sessions.json` starting empty (what `openFreshSession` diffs against), one conventional seed commit. The org is registered via `home/organisation.json` (`{"orgs":[…],"names":{"t8close":…}}`), the mechanism T7/T8B used. Boot polls the `desktop-session.json` contract (url+token as a matched authority-bound pair) through the token-exchange walk until 200 HTML, then hands `STUDIO_URL`/`STUDIO_TOKEN`/`ARXA_ORG` to each gate child. The studio is booted ONCE for the whole run with fvm stripped from its PATH — the artifact-viewer resolves Dart through the studio process env, so the studio itself lives in the SDK-absent world the dart-absent lane needs.

**Surface list source:** task-8 brief Step 4 + the T7 review condition (viewer language/dart ladder), materialized as the dispatch's exact 13-surface order. Mapping to gate surfaces (validated at runtime against the gate's source by `gateSurfaces()`, so a row for a surface this checkout lacks is recorded without spending a browser): finish→`finish`, sweep-modal→`sweep`, checks-red-disclosure→`checksred`, project-preparation→`preparation`, trash-confirm/trash-recover→`trash` (one gate run produces both the `trash-confirm-*` and `trash-view-*` pairs), viewer-install-strip/viewer-dart-absent→`viewer-strip` (the install strip IS the dart-absent state; the run's logged `dart state` JSON decides whether the strip rendered), confinement-configured-effective→`confine`, workspace-backend-local→`backend`, personalisation-tab→`personalisation`, viewer-langstrip→`langstrip`. **workspace-signin has no gate surface**: the workspace backend ships as a settings-section model and `signIn` requires a configured remote provider, unreachable on a credential-free scratch boot — recorded as a missing row with that cause, no browser spent. Shots keep the gate's `<name>-<width>.png` naming — the convention of every existing file in `1280/` and `390/`.

**Per-pair lifecycle:** the gate child is killed by its own `die()`/exit; the driver then sweeps the child's pid-tagged Chromium (`--user-data-dir arxa-evidence-chrome-<width>-<pid>`) with wait→TERM→KILL phases until `pgrep` is empty, and only then proceeds. Pairs are strictly sequential (one Chrome alive at a time — the RAM-discipline mandate). Every pair's full gate output is written immediately to `designs/evidence/studio-closeout/narrow-capture-logs/<width>-<surface>.log` with `token=` values redacted.

**Failure-row semantics:** a row is `ok` (exit 0 + expected PNGs fresh), `missing` (mount-shaped die: "never mounted/showed/rendered", NOT FOUND, theme did not render, dart strip did not render, absent gate surface, stale PNG) — recorded in `narrow-capture-log.json` (surface, width, gate, error, suspectedCause, per-shot status, filtered/unfiltered error counts), never an abort; or `hard` (unfiltered `GATE ERRORS`, non-mount die, timeout, process crash, boot failure). **Exit code is 1 only if a 1280-proven surface (personalisation-tab, sweep-modal, viewer-langstrip, viewer-dart-absent — the committed 1280 PNGs) records a hard failure; missing-at-width exits 0.**

**Cleanup paths:** `exit`/`SIGINT`/`SIGTERM` handlers — studio process tree killed via pgrep-walk TERM→KILL, tracked Chromium tags SIGKILLed, scratch dir `rmSync`ed. Normal completion tears down the same way before printing the exit verdict.

**Verification done (no browsers):** `node --check` green; import-guard + unit checks via `node --input-type=module`: LADDER count 13 / exact order, PROVEN_1280 = 4 surfaces, `gateSurfaces()` parses all 16 real gate surface keys from the working-tree gate and every ladder gate reference resolves. Not executed (no-browser mandate) — runtime behavior of the finish/checksred/confine/trash flows beyond T8B's proven personalisation pair is exactly what the failure-row semantics exist to record honestly.

## Boot-regression diagnosis + fix — **VERDICT: BLOCKED (no in-range regression; environmental port occupation)**

Per the dispatch's own rule ("if the bisect proves the breaking commit is outside 78c1654..HEAD, stop and report BLOCKED"), this section is diagnosis-only: **no code fix, no commit** (worktree left clean; the pre-existing `package-lock.json` dirt untouched).

### Minimal repro (scratch home + seeded org + organisation.json, bin/arxa-studio.mjs --no-open)

Driver `/tmp/boot-org-repro.mjs` (kept out of the repo): exact `evidence-capture-narrow.mjs` seeding (T8CLOSE org, docks, check.sh from `frame.js`, langstrip fixtures, empty session registry, `organisation.json`) + HOME discipline + fvm-free PATH, then the engine-boot-smoke token walk, then the org-session lifecycle over the real HTTP API (`org.open` → `workspace.new-session` → `session.open`) — the browser-free equivalent of what the evidence gate's UI clicks do.

### Bisect table (free port = 7951/7952/7953; occupied = 7897/7891)

| Commit | Org-registered boot, free port | Org-registered boot, occupied port | Empty-home smoke |
|---|---|---|---|
| 78c1654 | **PASS** — serve + org.open/new-session/session.open all 200 (after stubbing the profile's stale `arxa-gate` absolute path, `/private/tmp/arxa/harness/…`, absent on this machine — itself a pre-existing env dependence, later templated out by ce93fb7) | **FATAL** — `dsh: fatal load failure: failed to apply loader entry webserver (@deepseek-ai/dsh-host-webserver): listen EADDRINUSE … :7897`, `Promise.allSettled` frame in cordis-plugin-loader | (task states T7 captured green) |
| f5e90d4 (HEAD) | **PASS ×3** — full lifecycle green; `[arxa-sidebar] spawned … liveAgent=true`, attach+retitle, artifact-viewer root serving | **FATAL ×2** (7897 and 7891) — same class: `fatal load failure: failed to apply loader entry include (cordis:include): failed to apply loader entry webserver (…): listen EADDRINUSE` | **PASS** (engine-boot-smoke, 4s) |

→ Behavior is IDENTICAL at both ends of the range: no boot regression exists in 78c1654..HEAD. T9/T13/T14 loader/injection surfaces are exonerated — the workspace-provider row, FileSystem-provider swap and preset seeding all apply cleanly with a registered org.

### Root cause of the Task-8 capture blockage (measured, live, 2026-09-13 ~23:2x AEST)

- `127.0.0.1:7897` — the capture script's hardcoded port — is held by a **task-7 leftover studio** still running from THIS worktree: PIDs 21189 (`node bin/arxa-studio.mjs --no-open`) + 21291 (dsh `--port 7897`), `ARXA_HOME=/tmp/arxa-task7/home` (scratch, not the operator's), up since 22:41:12 AEST.
- The failing capture run (`narrow-capture-log.json` `startedAt` 13:12:18Z = **23:12:18 AEST**) postdates that zombie by 31 minutes → its boot hit EADDRINUSE → dsh fatals at profile apply ("fatal load failure: failed to apply loader entry …", launcher exits 1 before serving) → all 13×2 rows recorded `hard: studio boot failed`.
- `127.0.0.1:7891` (the launcher default) is held by the **operator's installed studio** (~/.arxa/engine/8ac7a8298f01, PID 92848, alive) — this is what the "real home" repro (a) collided with; same fatal class.
- The controller's quoted entry attribution (`arxa-conversation … cannot get property "sessionController" without inject`) is attribution variance inside dsh's parallel `Promise.allSettled` entry apply under the collision (their `index 163` frame matches neither this checkout's nor the sidecar's bundled loader, i.e. a different build still); every reproduction attempt of that exact attribution here — including collisions on both ports and the full org-session lifecycle — attributes to the true cause `webserver: EADDRINUSE` and boots green otherwise. The parallel `[arxa-approvals] typertGateway` noise is a real but pre-existing caught-stream log line (same property-access-without-inject class, non-fatal, outside this range's scope).

### Evidence artifacts

- Repro driver: `/tmp/boot-org-repro.mjs` (token-redacted output; logs quoted above).
- Live process proof: `lsof -nP -iTCP:7891/-iTCP:7897 -sTCP:LISTEN` → PIDs 92848 / 21291; `ps -o lstart=` → zombie boot 22:41:12 AEST vs capture 23:12:18 AEST.
- Bisect worktree /tmp/bisect-78c1654 created, used, and removed; `git worktree list` back to 3 entries.

### Unblock path (for the capture owner — NOT done here, outside mandate)

1. Kill the task-7 leftover pair (PIDs 21189, 21291 — scratch home, safe to TERM) or set `ARXA_PORT` for the capture run to a verified-free port (e.g. 7897→7951); 7891 must stay reserved for the operator's installed studio.
2. Rerun `node scripts/evidence-capture-narrow.mjs` — boot is expected green per the HEAD free-port rows above.
3. Optional hardening (separate change, needs its own mandate): make the capture/boot drivers pick or verify a free port before spawning dsh, so an occupied port fails loudly as "port in use" instead of a loader-entry fatal.

**Test summary:** engine-boot-smoke (empty home) PASS at HEAD; org-registered boot PASS ×3 at HEAD (incl. full session lifecycle) and PASS at 78c1654; occupied-port FATAL reproduced at BOTH ends (pre-existing). No new suite row was added — a boot-with-org smoke that pins a fixed port would be flaky for exactly the reason this investigation found; the correct row is the free-port-verifying driver in the unblock path above, left for the capture owner per the no-scope-widening rule.

## Part B — narrow ladder results (2026-09-14)

**Run:** `node scripts/evidence-capture-narrow.mjs` end-to-end against HEAD (post-fix), one browser per (width × surface), studio booted once from a fresh scratch home. **Exit 0** — no 1280-proven surface hard-failed; every surface has a row with a distinct, reproduced reason. *(Count correction, fix round 1: this summary line's "46 missing/limitation rows" was muddled — the run's log is authoritative: 26 rows = 390: 2 ok / 9 missing / 2 hard · 744: 2 ok / 11 missing / 0 hard. The 390 trash pair exceeded its 480 s budget after wedging post-first-shot — bounded by the driver, recorded. Superseded by the Fix round 1 ladder below.)*

### Gate/driver fixes this dispatch (scripts only, no product code)

- **Settings prelude scoped** (`scripts/evidence-gate.mjs`): `setTheme` at narrow (390/744) rides the theme service's own system-preference path (`Emulation.setEmulatedMedia` → the `prefers-color-scheme` MediaQueryList the runtime holds while the durable preference is `system` — the default on the fresh home each run boots) instead of Settings → Personalisation → Appearance; the 1280 lane keeps the proven Appearance-row path. No non-settings surface touches the settings sheet any more; only `personalisation` (and the manual `settingsdump`) opens it.
- **Settings trigger fixed at every width**: the real trigger is the sidebar-foot button with `aria-haspopup="dialog"` (dsh-client-ui-settings-general `SettingsRoot`). The old T8B rail fallback (hashed-class regex) was replaced. **Probe-verified the sheet mounts at 390 (342px panel) and 744 (696px)** with all five nav sections — the "sheet won't mount at narrow" class of failure was a trigger-discovery bug, not a product width gate.
- **Narrow rail lifecycle**: below the 1024 auto-collapse the sidebar is an icon-only rail; the gate now folds it open at boot (real `aXa_sb_toggle`, aria-label "Open sidebar") for the tree surfaces and folds it back after a session row is selected (the conversation needs the center column's width back). First-run `Internal Testing Notice` is dismissed through its real Continue button at boot.
- **Summary-table crash fixed** (`scripts/evidence-capture-narrow.mjs`): `classify()` returns `kind`; `evaluate()` destructured `status` → undefined → `.padEnd` crash on error-shaped rows. One-line rename.
- **langstrip per-language misses are recorded, not fatal**; the driver classifies `MOUNT ERR` and rail-expansion failures as mount-shaped rows.

### Captured (fresh this run)

| width | PNGs |
|---|---|
| 390 | personalisation-tab-light/dark, sweep-modal-light/dark, langstrip-html-preview, trash-view-light, viewer-install-strip-light/dark (editor-state; see limitation L4) |
| 744 | personalisation-tab-light/dark, sweep-modal-light/dark, viewer-install-strip-light/dark (editor-state; L4) |

(`744/dart-absent-strip-744.png` is pre-existing committed evidence, untouched.)

### Limitation rows (surface · widths · reproduced reason · product evidence)

- **L1 viewer-langstrip ts/css/json** · 390+744 · no LSP squiggles ever render: the artifact-viewer's LSP chain (token → `/lsp/status` → ws) does not engage on fresh scratch boots — token issuance is org-open-coupled (`plugins/artifact-viewer/lib/index.js:182-194`) and the ws handshake fails on every file open. **Identical at 1280 on today's build** (probe, 2026-09-14) — not a narrow defect; the committed 1280 squiggle shots predate it. The html-preview lane IS captured at 390 (org-origin sandboxed iframe verified); its 744 poll missed once (20 s) and is rowed.
- **L2 viewer-dart-absent / viewer-install-strip** · 390+744 · `dart state {"strip":false,"editor":true}`: the SDK-absent "install its SDK" strip does not render — the viewer mounts the editor and the LSP status path never sets the strip state (same L1 chain; `plugins/artifact-viewer/lib/client.js:888-890` renders the strip only on a status answer). Editor-state shots recorded; identical at 1280 today.
- **L3 workspace-backend-local** · 390+744 · `wp.info()` → `connection: invalid server-response result` on fresh boots, before and after opening a session — identical at 1280 today (1280 control captured 2026-09-14); out of this dispatch's no-product-changes scope. *(Fix-round note: the earlier "regression vs the T8-era committed backend evidence" phrasing was unsupported — no backend PNG exists in the tree — and is withdrawn; see Fix round 1.)*
- **L4 finish / checks-red / confinement** · 390+744 · the fresh session opens and its row selects, but the conversation pane never mounts under the narrow layout (dashboard hero stays, no composer, no `[data-git-dock]` — with the rail folded, notice dismissed). These flows have **no 1280 provenance** (not in the committed 1280 inventory); rowed as the narrow-lane limitation with the pane-state probe output in the pair logs. 744 confine additionally hit "session row never reachable (90 s)".
- **L5 project-preparation** · 390+744 · prep row found at 390 but the `Initialize Git repository` offer never rendered in the 12 s window; the 744 run's prep row wasn't found (sidebar refresh timing). Rowed.
- **L6 trash-confirm/recover** · 390 pair wedged after the trash-view-light shot (480 s budget kill, hard rows, non-proven); 744 pair: "the trash entry never listed" on the re-open. The 390 trash-view-light shot IS captured.
- **L7 workspace-signin** · 390+744 · no mounted studio UI on a credential-free scratch boot (pre-existing row semantics, unchanged).

### Filter list additions (named, justified in `scripts/evidence-gate.mjs` IGNORED)

- `missing #root` + `favicon.ico` — the dsh web frontend re-bootstraps (and re-requests the favicon, 404) when the SECOND gate browser of a run loads after the first was torn down. Reproduced deterministically by pair bisection (dump→sweep: pair 1 clean, pair 2 errors); never seen in single-session runs or interactive boots, at any width. Capture-lane lifecycle noise, not a surface defect.
- `__arxa/artifacts/lsp` — the failing LSP websocket IS the server-absent state (L1/L2); identical at 1280.

**Artifacts:** `designs/evidence/studio-closeout/narrow-capture-log.json` (26 structured rows), `narrow-capture-logs/<width>-<surface>.log` (token-redacted), PNGs above.

## Fix round 1 — controls, real triggers, honest failure states (2026-09-14)

**Mandate:** task-8-review.md Ladder + Findings Adjudication — 1280 controls for the five zero-evidence surfaces, real-trigger work, New-finding formalization, count reconciliation.

**Final run:** `node scripts/evidence-capture-narrow.mjs --width 390 --width 744 --width 1280` end-to-end with every fix below baked (an earlier same-shape run was the validation lane; identical counts). **Log authoritative: 39 rows — 390: 3 ok / 8 missing / 2 hard · 744: 6 ok / 7 missing / 0 hard · 1280: 5 ok / 7 missing / 1 hard.** 28 shots ok. The two hard clusters are the ledgered CDP no-timeout wedge: the 390 trash-confirm pair (after BOTH trash-view shots landed) and the 1280 backend dark half (after its light failure-state shot; the standalone retry wedged the same way — deterministic at that spot, bounded by the 480 s budget).

### Driver/gate fixes (scripts only, no product code)

- `--width` / `--surface` flags on the driver (the 1280 control lane); studio boot log captured to `narrow-capture-logs/studio-boot.log` and tailed on any miss — driver/product blame is now visible per run.
- **Org-open click** (`openOrgRow`) before every store-dependent flow: a fresh scratch home's boot prewarm opens NOTHING ("org none" in the studio log) and the org-open-coupled client services stay dark without the org row's own click.
- `awaitWarmed`: never fire the create into the ~30 s cold-boot model-catalog window (boot trace: catalog-first=31875 ms).
- **Session create through the shell CTA** (`aXa_sb_newSession`, gated by the product's own `ctaReady` lever) — the workspace-row `+`'s click-to-handler binding is flaky (clicked, disabled=false, no create; probe-verified).
- Reachability: the reveal dance (org re-select → Refresh → overflow) retries inside the poll; budgets re-tuned.
- **Composer activation** (focus + click) after the row click.
- Preparation: the project is seeded with a real `project.json` through the product's own `createManifest` — `scanWorkspace` skips free-form folders, so the prep row never existed at any width before; Projects-category toggle aria-expanded-guarded; row polled.
- Trash: precise Trash-row selector (`projectRow[role=treeitem]`, text exactly `Trash[ N]`); **idempotent open** (aria-expanded guard — the trash view defaults OPEN, a blind click closed it); miss dumps.
- **Failure-state capture**: `pair(..., failName)` — a dead lane shoots the pane as `<surface>-failed-{light,dark}` instead of dying; runlog rows carry `failShots` + the gate's `FAILURE STATE:` line; the dark half skips re-proving a dead lane.
- IGNORED + `/__arxa\/artifacts\/tree/` 404 — the same org-open-coupled artifact chain as the lsp ws (dir rows 404 forever on fresh boots, all widths).

### Per-surface outcomes (final run, all widths)

| surface | verdict |
|---|---|
| Finish | limitation-with-control @390+744+1280 — failure-state shots ×3; the 390 pair log carries the full probe chain: create ✓ → row ✓ → **conversation binds ✓** → composer activated ✓ → dock slot ✗; at 744/1280 the create RPC itself hung (unanswered `dshBridge.list()` — escalated finding, below) |
| Checks-red disclosure | same shape as Finish (Run checks lives in the dock): 390 probe chain full, 744/1280 create-RPC hang |
| Project preparation | **captured @744+1280** (Initialize-Git-repository offer, light+dark — the manifest fix is what un-blocked it); @390 limitation-with-control (row found+clicked, offer missed in-window; failure-state shots) |
| Confinement configured/effective | limitation-with-control ×3 widths (the card row lives in the dock) |
| Workspace backend | **failure-state captured** @390+744 (light+dark) + @1280 (light; the dark half wedged — CDP wedge, ledgered) (`workspace-backend-model-*` renders the honest invalid-RPC card) — L3 New finding |
| Trash confirm/recover | **captured @744+1280** (view + Delete-forever type-to-confirm modal, light+dark); @390: both trash-view shots ok, the confirm pair wedged again → 2 hard rows, budget-killed (the ledgered CDP no-timeout wedge; 4th occurrence) |
| Sign-in | unchanged — genuine scope limitation, accepted by the review |

### Escalations formalized (ledger `progress.md`, explicit New finding entries)

1. **L1/L2 viewer LSP chain dead at all widths** — regression-to-escalate, whole-branch review + Task 16; code ref `plugins/artifact-viewer/lib/index.js:183-191` (lsp token 403s without `selectedOpenRoot`); committed 1280 squiggle evidence (78c1654) unreproducible on fresh boots. Branch must not close on stale viewer evidence.
2. **L3 wp.info() invalid server-response at all widths** — New finding; the unsupported "regression vs the T8-era committed backend evidence" claim is withdrawn here and in the ledger (no backend PNG exists anywhere — reviewer-verified).
3. **NEW: fresh-session conversation dock dead at every width** — create/row/bind/composer all ✓ (probe chain), `conversation.input.dock` slot never renders; plus the flaky row-`+` handler and the unanswered create RPC (`dshBridge.list()` never returns post-spawn). Escalated, whole-branch review + Task 16; T8-diff-innocent.

**Tests:** no product code changed (scripts + evidence only) — no `npm test` per the fix-round mandate; `node --check` green on both scripts; no selftest consumes them.

**Artifacts:** `narrow-capture-log.json` (39 rows, failShots on dead lanes), `narrow-capture-logs/` incl. `studio-boot.log`, PNGs: `project-preparation-*-{744,1280}`, `trash-{view,confirm}-*-{744,1280}`, `workspace-backend-model-*-{390,744,1280}`, `*-failed-*` families ×3 widths, `trash-view-light-390`.

## Step 3 — native-review corrections

Commit `4347f07` (branch `closeout-2026-09-12`). Inputs: `task-8-pl-review.md` (2 must-fix, 12 nice-to-fix), `task-8-fr-review.md` (3 must-fix, 13 nice-to-fix). Rule applied: every must-fix landed; nice-to-fixes landed only when pure consistency/agreement/typography with zero meaning change; tone/meaning rewrites and overflow risks skipped.

### Must-fixes landed (5/5)

- **artifact-viewer install strip (shared, both reviews)** — the 4 hardcoded English literals (`lib/client.js` lsp bar) became dictionary keys `lsp.none` / `lsp.hint` / `lsp.install` / `lsp.installing` with en/pl/fr values, wired through `t()`; `CodeView` now receives `t` from `ArtifactPanel` (it was the one view without it). Exact strip copy semantics preserved: installable → short text + button, else → long hint, no button.
- **pl `git.wakeStarted`** — „kontrole” → „testy” (unified with the other 14 checks keys).
- **fr `git.parked`** — « Porte rouge » → « Gate rouge » (Gate is the CONTEXT.md glossary term).
- **fr `git.wakeStarted`** — « contrôles » → « vérifications ».

Git-card edits went into `git-card.snippet.txt` + `gen-git-card.mjs --write` (client.js regenerated, `--check` in sync).

### Nice-to-fixes landed (10 of 25)

Pure grammar/agreement/consistency/typography, zero meaning change:

- pl `git.ledger.summary`/`git.ledger.view` — „dostawa” → „dostarczanie” (terminology unified with arxa-dashboard `group.delivery`).
- pl `git.changed`/`git.untracked` — „{n} zmienionych” → „zmienione: {n}” etc. (plural agreement at n=1–4; in-dict colon precedent).
- pl `git.relink` — „Połącz ponownie GitHub” → „…z GitHubem” (missing preposition).
- pl `git.relinkNeeded` — „Sesja GitHub wygasła” → „Wygasło logowanie do GitHub” (Session product-term collision; en says sign-in).
- pl workspace-provider `licenseLine` — „backend Totem” → „backend Totemu” (genitive declension).
- fr `git.changed`/`staged`/`unstaged`/`untracked` — « {n} modifié(s) » etc. (plural agreement at n=1, length-neutral).
- fr `git.relinkNeeded` — « Session GitHub expirée » → « Connexion GitHub expirée » (symmetric to pl).
- fr workspace-provider `signInBrowser` — « Connexion navigateur » → « Connexion dans le navigateur » (missing preposition; pl sibling has it).
- fr sidebar consistency batch (one review row, several keys): `archives.toTrash` « dans » → « vers » (sibling unification); « dépôt » unified as the repository term across `purge.orgWarn`/`projectWarn`/`busy`, `github.signin.desc`, `rename.orgNote` (majority + reviewer recommendation); `newSession.initRepo` « dépôt Git » → « dépôt git » (casing); straight apostrophes → curly in `purge.repoGoneLine` (n’est) and `rows.noConversation` (s’est). Sidebar edits went into `workspace-region.snippet.txt` + `gen-workspace.mjs --write`; the selftest pin on the `initRepo` fr wording followed the corrected casing (pin intent — pl/fr coverage — unchanged).

### Nice-to-fixes skipped (15), with reasons

Tone/register, meaning, or overflow risk — out of the landed class per the plan:

- pl `git.checks.light` („testy lekkie” → „lekkie testy”) — naturalness/word order, not agreement.
- pl `git.confirm.mint.body` („po tej” → „ponad tę”) — corrects meaning drift; meaning-changing rewrite of high-stakes dialog copy.
- pl theme-accent `palette.desc`, `palette.pasteHint`+`palette.err`, `palette.noteAdjusted`, `font.desc` — naturalness/register rewrites; pasteHint/err also lengthens a hint field.
- pl + fr workspace-provider `badgeLive` („na żywo”/« en direct ») — register/meaning shift on a state label.
- fr `git.askDraft` — restores the drafting act (meaning) + longer button text.
- fr `git.frame.wired` (« câblé » → « connecté ») — lexical/naturalness swap.
- fr `git.confirm.merge.body` — meaning-corrective rewrite.
- fr theme-accent `palette.desc`, `font.desc` — register rewrite; font.desc adds a sentence.
- fr `palette.noteOffline` (« hors ligne » → « indisponible ») — meaning change; en may say "offline".
- fr sidebar `newSession.repoNeeded` (« se branchent sur » → « démarrent à partir de ») — verb/imagery change.
- (The fr sidebar terminology row's apostrophe/casing/dépôt parts DID land — only the repoNeeded verb portion is skipped.)

### Verification

`node plugins/locale/selftest.parity.mjs` — all green (artifact-viewer now 4 keys richer in all three tables). `plugins/artifact-viewer/selftest.mjs` + `selftest.lsp.mjs` (55 ok), `plugins/arxa-git-card/selftest.mjs`, `plugins/arxa-sidebar/selftest.mjs` (incl. its gen drift gate), `plugins/locale/selftest.mjs` — green. `node scripts/gen-git-card.mjs --check` — in sync; gen-workspace regenerated client.js (sidebar drift gate green). workspace-provider has no `selftest.mjs` (CI covers it via `bin/selftest.provider-cli.mjs` + the supabase smoke). `npm test` — exit 0, **130 suites, ALL GREEN**.
