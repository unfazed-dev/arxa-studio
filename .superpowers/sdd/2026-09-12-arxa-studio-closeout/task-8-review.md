⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set and takes precedence over your claude.ai login · Unset it to load your organization's connectors
[claude-code:unrecognized_model] {"model":"glm-5.3[1m]","query_source":"sdk"}
# Task 8 Review — Fresh Independent Adjudication

### Spec Compliance
- **Step 1 parity test** ✅ — `selftest.parity.mjs` green (7 owners × 6 sub-checks); BREAK-CHECK: scratch tree, deleted pl `font.default` → `FAIL … missing: font.default`, discarded. Non-vacuous, CI-discovered (in the 130).
- **Step 2 translations/terms** ✅ — 57 pl/fr added lines audited; only verbatim tokens (coolors, hex, `1a1423-b75d69`, Fira Code, artifact viewer, `svc.sh start`, `~/.arxa/runners/…`) inside translated prose. No translated IDs/paths/model IDs.
- **Step 3 native reviews** ✅ — separate PL/FR docs exist (2+3 must-fix, 12+13 nice); all 5 must-fixes verified at HEAD (lsp.none/hint/install/installing ×3 locales wired via `t()`; pl „testy"; fr « Gate rouge », « vérifications »; old strings gone); 10 landed / 15 skipped reconciles exactly against both review docs (one row split landed/skipped).
- **Step 4 evidence** ❌ **partial** — fully captured: Sweep, Personalisation (390/744/1280, light+dark), viewer strip (1280 + committed 744 dart-absent; 390 = editor-state only). Zero renders at **any** width: Finish, Checks-red, preparation, confinement, backend, sign-in; trash = one 390 view shot only. All misses rowed with causes — honest, but 5/9 brief surfaces unevidenced.
- **Step 5 tests** ✅ — 8/8 touched selftests EXIT 0; both `gen --check` EXIT 0; `npm test` ×1: EXIT 0, **130 suites, ALL GREEN**.
- **Step 6 commits** ⚠️ — `feat:`/`docs:` per ruling ✓; capture-script commit is `feat:` not the ruled `fix:`; ~111 script-fix lines rode the `docs:` commit.
- **T7 (a) viewer ladder** ⚠️ — 390 html-preview ✓; ts/css/json squiggles missing (L1); dart lane rowed. **T7 (b) gate in-repo** ✅ — 6 named+justified IGNORED patterns verified in source; capture driver holds zero filters.

### Ladder + Findings Adjudication
- **L1 LSP chain dead (all widths)**: **regression-to-escalate.** Code-verified: `lib/index.js:183-191` lsp token 403s without `selectedOpenRoot`; committed 1280 squiggle shots (78c1654, richer boot env) unreproducible on today's fresh boots. T8-diff-innocent (index.js untouched; client.js diff = literals→`t()`; `lsp ?` gate pre-exists at BASE:887). Ride to whole-branch review — branch must not close on stale viewer evidence.
- **L2 dart-absent strip**: same root as L1 — **regression-to-escalate**, bundled.
- **L3 wp.info() invalid server-response**: real failure, all widths, T8-innocent (4 locale lines only) — **escalate as New finding**. But the report's "regression vs T8-era committed backend evidence" is **unsupported**: no backend PNG exists anywhere under `designs/evidence` (find-verified); error string also absent from repo source.
- **L4 finish/checks-red/confinement/preparation/trash-744 (conversation pane never mounts)**: **fixable defect or driver gap — NOT an acceptable recorded limitation.** No width gate found in dashboard/sidebar clients; no 1280 control exists (proven1280 excludes these); cause is symptom-shaped ("git dock never mounted") — and this task already found two trigger-discovery bugs in its own driver. Must capture-or-fix (with a 1280 control) before closeout.
- **L5/L6/L7**: ride with L4; signin = genuine scope limitation (no surface, credential-free boot), acceptable as rowed.

### Independent Verification Results
Parity green + break-check FAIL ✓ · selftests 8/8 + drift gates ✓ · must-fixes at HEAD ✓ · evidence tree: 390=8, 744=7 (1 pre-existing), 1280=14 PNGs; log = 26 rows, **390: 2 ok/9 missing/2 hard; 744: 2 ok/11 missing** (prompt's "390→3 ok/10 limitation" and report's "46 rows" both slightly muddled — log is authoritative; every non-ok row carries a cause) · PNGs 780×1688 / 1488×1626 (=390×844, 744×813 @2×); pixel stats on 7 shots: real content, none blank (dark sweep: sd 23.9, 52 colors) · `npm test` EXIT 0, 130 GREEN.

### Strengths
Parity gate genuinely bites and covers exactly the T2–14 owners; sandbox no-client-dict claim verified; corrections land/skip discipline faithful to reviews; filter list single-sourced and justified; honest failure-row ledger; boot-regression bisect clean (identical at both ends).

### Issues
**Critical:** none in the locale half.
**Important:** ① Step 4: five surfaces with zero visual evidence at any width (L4 bucket) — needs 1280 control or fix+capture; ② L1/L2/L3 must ride as explicit New findings to whole-branch review (viewer LSP + wp.info broken on today's fresh boots vs committed evidence).
**Minor:** ③ L3's "vs T8-era committed backend evidence" claim unsupported; ④ ladder summary counts muddled vs log; ⑤ capture-script commit message type deviates from the recorded ruling.

### Assessment
**Task quality: Needs fixes**
**Reasoning:** Locale half (Steps 1–3, 5) is fully verified and approved-grade; Step 4 is materially incomplete — 5 of 9 brief surfaces unevidenced anywhere, and the L4 "limitation" rows lack the 1280 control needed to call them product behavior rather than an unclosed driver/product defect.
