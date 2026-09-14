# arxa studio closeout — 2026-09-12 program (final report)

Program: [`docs/superpowers/plans/2026-09-12-arxa-studio-closeout.md`](../superpowers/plans/2026-09-12-arxa-studio-closeout.md),
Tasks 1–16 implemented and review-clean; this document is Task 17's closeout report (Step 8).
Written 2026-09-14. Studio HEAD `902551d`, arxa worktree HEAD `3b6e08ea`, both branch
`closeout-2026-09-12`. No remote was ever moved (no push/merge/tag by program law).

## Final matrix

Lives in [`open-work-inventory-2026-09-12.md`](open-work-inventory-2026-09-12.md) (the 2026-09-12
inventory, rewritten as the final matrix — chosen over this doc because every `AXS-*` row already
lived there). Every row ends `CLOSED`, `DEFERRED` (concrete trigger), or `EXTERNAL` (owner +
prepared command/trigger). Zero ambiguous rows.

Row counts: **CLOSED 33** (14 program outcomes AXS-001–014 + 19 pre-program AXS-033–051) ·
**EXTERNAL 18** (AXS-015–022, 053, 055–059, 062–064, 067) · **DEFERRED 17** (AXS-023–032, 052,
054, 060, 061, 065, 066, 068). ID note: Task 15's inserted AXS-042/043 collided with pre-existing
CLOSED IDs and are renumbered AXS-052/053 (references fixed in `closeout-evidence-2026-09-12.md`
G10 and arxa `docs/linux-support.md`).

The three whole-branch-review-owned rows (AXS-062 cell-launcher seed, AXS-063 viewer-LSP E1,
AXS-064 dock-dead E2) state their owners and await Step 7 adjudication — deliberately not resolved
here. Task 16 Part B legs remain EXTERNAL/PREPARED pending per-leg operator authorization
(authorization request list surfaced 2026-09-14; see `closeout-evidence-2026-09-12.md`).

## Commits by repository

Studio (`4d1b924..902551d`, 27 commits; BASE `4d1b924`, plan `1781083`):

    902551d test: correct the closeout evidence matrix (fix round 1)
    7351ddf fix: return the dsh result envelope from the workspace info RPC
    4e7f552 test: record authenticated and physical closeout evidence
    8e3bc01 docs: close the mobile migration checklist
    2c74ab0 docs: close the linux distribution evidence rows
    d1771af fix: complete the surface evidence ladder with controls
    4347f07 fix: apply native-review locale corrections
    d3a7c47 docs: complete the narrow-width evidence ladder
    f5e90d4 feat: add the narrow-width evidence capture script
    5c2f83a feat: complete studio locale and visual acceptance
    ce5e82e fix: correct prefer semantics and make the supabase smoke deterministic
    75d090f feat: add the first-party Supabase workspace provider
    4cc0380 fix: bound blob payloads, refuse unimplemented providers, pack sandbox lib
    72a2a83 feat: add fixed workspace providers and local storage
    3597a40 feat: freeze the workspace provider wire contract
    e800fe9 fix: gate the live sbx probe behind the real-smoke flag
    18c52cc feat: add Docker Sandbox isolation with recoverable teardown
    f35389b fix: harden docker isolation teardown and registry
    62ee8d5 feat: add automatic Docker project isolation
    fd6fd5f feat: provision local confinement and project integrity
    78c1654 fix: close artifact viewer runtime and trust boundaries
    82296f8 test: cover main races and auto-commit storms
    bd14065 feat: show the latest delivery ledger on the git card
    7d9e866 feat: surface local checks and complete tree decorations
    db6de5f feat: prepare imported projects for sessions
    8f10a08 fix: stop organisation sessions before trash
    7334ddb docs: reconcile the arxa studio closeout inventory

Arxa sibling (`5749402b..3b6e08ea`, 6 commits):

    3b6e08ea test: record authenticated and physical closeout evidence
    5930302d fix: close the mobile release documentation gaps
    458f97e8 style: settle pinned-sdk tool output in mobile and transport kit
    132f9003 feat: reconcile mobile ci and release readiness
    27878bcb style(mobile): format tall under the pinned sdk and clear analyzer lints
    fff96bee feat: close macos linux distribution and windows deferral

## Final verification (2026-09-14, one gate at a time)

| gate | result |
|---|---|
| studio `npm test` | **130 suites ALL GREEN** (`arxa-studio CI: ALL GREEN`; engine-boot-smoke GREEN in the list). Ran twice — the second run only counted GREEN lines (130); both runs fully green |
| arxa `fvm flutter analyze` (mobile_flutter) | **No issues found!** (4.6 s) |
| arxa focused `flutter test test/android_release_signing_contract_test.dart` | **4/4 All tests passed** |
| arxa `bash scripts/check.sh` | green everywhere except `FAIL [gates] arxa gate --all exit 1` — exactly the inherited pre-branch debt (AXS-059; branch diff ∩ gate inputs = ∅); rust transport 11/11 visible green |
| arxa `actionlint` ×4 (`ci.yml`, `desktop-gate.yml`, `desktop-release.yml`, `mobile-release.yml`) | **all OK** |

**Controller ruling honored (full-suite acceptance):** full arxa `dart test` + full `flutter test`
+ `cargo test` are ACCEPTED on their 2026-09-13/14 review-clean runs (T15 ALL-PASS; T12 re-review
108/108 + kit rust 11/11) because **no `arxa/lib`, `mobile_flutter/lib`, or `kit` Dart source
changed after those runs** — verified per-path: `git show --name-status 3b6e08ea` (the only commit
after `5930302d`, the T12 re-review base) touches exactly one file,
`mobile_flutter/deploy/physical-gates.md` (a doc). No affected suite needed re-running.

## Evidence pointers

- **Matrix of gates:** [`closeout-evidence-2026-09-12.md`](closeout-evidence-2026-09-12.md) —
  20 rows (8 DONE / 8 PREPARED / 4 EXTERNAL), G3-notes (SBX_PIN v0.42.1 measured digests),
  G7-notes (viewer legs incl. honest FAILURE-STATE rows), G12-notes (RAM-discipline legs),
  G13-notes (tree-404 mask decision), §Escalated (E1/E2/E3 per-row bases; E3 fixed in-branch
  `7351ddf`, wire freeze held).
- **Visual/locale:** `designs/evidence/studio-closeout/{390,744,1280}` — L1–L4 ladder with
  controls light+dark, EN/PL/FR parity suite + native-speaker corrections (`4347f07`).
- **Physical/mobile:** `mobile_flutter/deploy/physical-gates.md` + evidence dir
  `mobile_flutter/deploy/evidence/closeout-2026-09-12/` (arxa worktree; G12b deploy self-test
  12/12 log).
- **Per-task process evidence:** `.superpowers/sdd/2026-09-12-arxa-studio-closeout/` (SDD ledger
  `progress.md` + per-task briefs/reports/reviews — every ruling, RED proof, fix round).

## Retained deferrals (with triggers) — summary

Freestyle verbs (AXS-028), viewer edit-with-agent (AXS-029), dashboard-inside-open-chat (AXS-030),
biometric approvals (AXS-027), dsh cold-boot/upstream (AXS-020), vscode-monaco phases 4–5
(AXS-023), gen-ui Diff real-input renderer (AXS-065), D77 plugin version bumps (AXS-066),
installer-channel divergence (AXS-054, trigger: first src-tauri channel-file read change),
Windows distribution (AXS-052, D23 trigger), simulator smoke + release-shaped builds (AXS-060/061,
RAM-discipline, idle-machine trigger), person-driven demo legs (AXS-068), the vocabulary V5
ledger-shape/`supersededBy` decision (AXS-032 — **not accepted, not added**: no arxa-side
contract carries the field, verified by grep at `3b6e08ea`). Full text in the final matrix.

## External gates with owners (not closable in this program)

G1 card-cicd-smoke rerun (AXS-055, operator quota) · G2 A4 real Docker (AXS-056) · G3 A5 live sbx
(AXS-015) · G4 Supabase real stack (AXS-057) · G5 Claude signed-in (AXS-016) · G6 Z.ai live
(AXS-017) · G8 mobile physical (AXS-018) · G9 notarization + first tags (AXS-019) · G10 Omarchy
VM/container lanes (AXS-058) · G11 first runner pass + branch protection after first green
(AXS-053) · `arxa gate --all` inherited gates-area debt (AXS-059, arxa maintainers) · Phase 0b
destructive cleanup (AXS-067, operator authorization). Prepared commands verbatim in the matrix /
T16 doc.

## Rollback notes

- No remote was ever moved: both branches live only in their worktrees; the canonical checkouts
  were read-only throughout. Rollback = delete the branches/worktrees.
- Per-repo revert: studio `git revert 4d1b924..902551d` (or `git reset --hard 4d1b924` on an
  unmerged branch); arxa `git revert 5749402b..3b6e08ea` (`git reset --hard 5749402b`).
- The only stateful product surface is the Supabase workspace v1 migration:
  `plugins/workspace-provider/migrations/20260913000000_workspace_v1.sql` documents its inverse
  SQL in-file; `supabase migration down --last N` is the reversal proof path (T14). No migration
  was ever applied to any database outside disposable local stacks (real-stack leg never ran —
  AXS-057).
- A0 profile migration (workspace-write seeding with provenance) is provenance-gated by design:
  existing profiles keep their preset unless launcher provenance is proven (A0 degrades safely);
  reverting the launcher reverts seeding; already-migrated homes are identifiable via the
  provenance record and can be re-set by hand.

## Documentation consistency searches (Step 5) — dispositions

Searches over `docs/plans/*.md`: `PLAN ONLY`, `nothing built`, `still open`, unchecked acceptance
boxes (`^- \[ \]`). Every match is historical context, an inventory row, or carries a dated
resolution pointer:

- `PLAN ONLY` — `open-work-inventory-2026-09-07.md:36` (historical; superseded-banner + agency
  plan's own banner; now AXS-012 CLOSED). Rewritten inventory cites it as history.
- `nothing built` — `file-organisation-grill-agenda.md:4` (the agenda's own honesty framing,
  historical); `linux-omarchy-port.md:283` (fresh-checkout measurement, historical).
- `still open` — 11 matches: `mobile-grill-decisions.md:75` (dated pointer added → AXS-019/053);
  `local-only-git-parity…:147/640` (dated banner added; Sweep resolved in-file at :186; Bug B =
  AXS-001); `session-execution-log.md:76` (dated snapshot note added); `session-naming…:425`
  (dated snapshot note added); `freestyle-trash-parity.md:17` (verbatim user quote, historical);
  `open-work-inventory-2026-09-07.md` (superseded doc, banner at top); grill-decisions :1066
  (pricing band — sibling commerce backlog, AXS-021) and :1349 / vscode-monaco :566 ("still
  open(s)" as verb, not an open item); `claude-cicd-live-smoke.md:208` (B2 org-local git state,
  historical; the shipped sync sweep pushes local main on open — standing remedy).
- Unchecked acceptance boxes — three files, all now carry dated banners: artifact-viewer
  implementation (5 boxes → banner 2026-09-14, each dispositioned: AXS-065/066/068 + ladder),
  demo-runbook (17 boxes → banner; G7-notes rows), claude-subscription-engine-implementation
  (88 boxes → banner 2026-09-12 + closeout addendum 2026-09-14).

## Vocabulary (Step 2) outcome

All claims that studio lacks `changes-requested` or version minting are resolved with dated notes
(`arxa-studio-vocabulary-collisions.md` final-outcome banner + list note; `arxa-isolation-levels.md`
B12/§28a notes; `session-execution-log.md` snapshot note). The cross-product `supersededBy`
decision is recorded as **not accepted, not added** with the pointer (AXS-032): the arxa worktree
at `3b6e08ea` carries no `supersededBy` field or contract (grep: zero matches); no unconsumed
field was added on either side.
