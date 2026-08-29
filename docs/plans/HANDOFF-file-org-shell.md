# HANDOFF — file-org shell integration (Phases A/B done, C open)

Written 2026-08-29. Continues `docs/plans/file-org-shell-integration.md`.
Everything below is committed on `master` in `arxa-studio` (plus one commit
in the sibling `arxa` repo, noted in §5).

## 1. Where the work stands

| Phase | Scope | State |
|---|---|---|
| A | `plugins/file-org-shell/` — org lifecycle service | **DONE**, merged, selftest 40/40 |
| B | `plugins/arxa-sidebar/` — own sidebar plugin | **DONE**, merged, selftest ALL GREEN, lens-verified |
| C | `scripts/ci.mjs` — permanent CI incl. rebuild gate | **DONE**, `npm test` = 10 suites ALL GREEN |

Phases 1–6 of the earlier `file-organisation-implementation.md` (the six
libraries) were already done before this session; A/B wire them into the
running shell.

## 2. Commits this session (arxa-studio, newest first)

- `d80ff9f` ci: permanent suite — scripts/ci.mjs, npm test, workflow step
  (Phase C; rebuild gate is a hard failure by inclusion; 10 suites green)
- `652c07f` evidence: lens shots for the open-org flow past the CTA click
  (§8's visual gap discharged; the project tag is proven through the real UI)
- `d6e5807` fix: env-overridable ARXA_PORT + copy the five relative-import
  libraries in checkout mode too (fresh checkout boots silently served a
  stubbed sidebar — see §8, engine finding)
- `c5c2720` feat: project-scoped sessions with scope-resolution ladder in the
  sidebar CTA contract (registry `project` field, Q4 semantics, Org grouping,
  +14 smoke checks; CONTEXT.md gains org-level/project session)
- `4504e85` fix: rebuild arxa-sidebar from the stock dsh shell (see §4 — this
  fixes a real regression I shipped earlier in the session)
- `3c40f41` feat: flip arxa-sidebar seam to real file-org-shell lifecycle with
  handle contract faces and wiring smoke
- `8f08eaf` merge: Phase B (`071f872` arxa-sidebar plugin + stock sidebar disabled)
- `9faf13e` merge: Phase A (`d20a109` file-org-shell plugin)
- `e9f3bbd` docs: Phase B switched to own-plugin approach
- `22cadc3` docs: the integration plan itself

## 3. What Phase A/B actually built

**`plugins/file-org-shell/`** (server-side only, no client surface)
- `createOrgLifecycle({ workspaceRoot })` → `listOrgs`, `createOrg`,
  `openOrg`, `closeOrg`, `switchOrg`, `current` (getter), `isOrgRepo`.
- `openOrg` runs a 7-step ordered open with a reverse-unwind stack:
  `shell-lock → stamp-migrate → index → git-attach → sessions →
  account-mirror → cairn-rail`. Failure tears down in reverse and throws
  `OrgOpenError` naming the failed step.
- The open-org handle carries **contract faces** the sidebar consumes:
  `projects()`, `parkedSessions()`, `trashCount()`, `newProject()`,
  `newSession()`, `resumeSession()`, `mergeSession()`, `restoreTrash()`.
  These live on the handle deliberately so switch/close teardown stays the
  lifecycle's job.
- Re-exports `loadWorkspaceRoot` / `saveWorkspaceRoot` / `arxaHome` so the
  sidebar needs only this one import surface.

**`plugins/arxa-sidebar/`**
- `lib/client.js` — the browser half (see §4 for its provenance).
- `lib/index.js` — host half serving two routes, registered on `webServer`:
  - `GET /__arxa/sidebar/state?project=<id>` → `{ seam, org, orgs, projects,
    parkedSessions, trashCount, selectedProject, cta }`
  - `POST /__arxa/sidebar/action` `{ action, arg }` → dispatch table
    (`org.open|new|switch|close`, `project.new`, `session.new|resume|merge`,
    `trash.restore`; `ci.run` deliberately absent until D3).
- `lib/cta-state.mjs` — the CTA state machine, **server-side** so it has one
  testable home; the client renders whatever it receives.
- `selftest.mjs` (contract/registration/reference checks) and `smoke.mjs`
  (route-level end-to-end against a real sandboxed lifecycle, 15 checks).

## 4. ⚠️ Read this before touching the sidebar

**I broke the studio chrome earlier in this session and then fixed it.**
The first Phase B build wrote a *from-scratch* sidebar component. It rendered
the org section and CTAs but **deleted the arxa brand header, the fold
toggle, the New Session button, the Workspaces region and the Settings
control** — because the stock dsh sidebar is the shell that hosts those slots,
and replacing it dropped them all.

`4504e85` rebuilds `lib/client.js` correctly: it is now the **stock
`@deepseek-ai/dsh-client-ui-sidebar@0.1.1-rc.2` `lib/client.js` copied whole**,
with exactly four deltas:
1. class prefix `hHd-Xa_` → `aXa_sb_`, module id → `arxa-sidebar`
2. brand fallbacks `"DSH Local Build"`/`"29b22c5"` → `"arxa"`/`"studio"`
   (the real arxa-brand slot registrants still override these)
3. an appended `orgCss` block on the same injected `<style>` tag
4. an `OrgSection` component spliced into `regionArea` **above** the
   `sidebar.workspaces` registrant, divider-separated

Everything else — `logoRow`, brand mark/name slots, fold toggle, New Session,
`sidebar.workspaces`, `footArea` (`sidebar.footer.action` + `sidebar.settings`),
collapse/rail animation, scrollbar-linger, locale dicts, the slot children map
— is byte-for-byte the stock shell.

**If you regenerate it**, `/tmp/gen-sidebar.mjs` was the transform script
(not committed — it reads the node_modules original and applies the four
deltas). Re-deriving from the original beats hand-editing.

The stock package in `node_modules` is untouched and hash-pinned by the
selftest (`EXPECTED_PKG_HASH`), so drift is detectable.

**Second opinion (this session):** both advisor APIs were unavailable
(consult-z 401 invalid key; consult-kimi 403 weekly quota), so a fresh-context
review subagent did a full diff. Verdict: **KEEP copy-whole** (0.82) — a
wrapper is structurally impossible because stock regionArea renders only
`renderSlot("sidebar.workspaces")` with no extension point above it. The diff
confirmed the four deltas plus two harmless extras worth recording: the
header comment block, and a dropped `sourceMappingURL` trailer. Top risks
(open follow-ups, not done): commit the regenerate transform
(`/tmp/gen-sidebar.mjs` is still uncommitted), add a CI regenerate→byte-diff
gate (the selftest pins the ORIGINAL, not the copy), treat dsh rc bumps as
explicit re-transform + lens visual gate.

## 5. Sibling repo change (`/Volumes/developer_ssd/Developer/totem_labs/arxa`)

- `4c0652c4` feat: `ARXA_LENS_UA` env override in `arxa/lib/cdp.dart`.

**Why it was needed:** the waiting-page presence referee parks *any* plain
browser tab while the desktop shell is alive, so every lens capture returned
a parked card, not the app. Setting
`ARXA_LENS_UA="Mozilla/5.0 (Macintosh) ArxaShell/1.0 (lens)"` makes Chrome
present the shell UA, the page takes the shell branch, and the real surface
renders. **Export that variable for any future lens run against a live
studio.**

Two lens CLI traps found the hard way: `--expect=…` and `--out-dir=…` must
use the `=` form. The space-separated form silently evaluates to empty and
the check "fails" with `got null`.

## 6. How to verify from cold

```sh
# 1. unit + contract
cd arxa-studio
for p in workspace workspace-index git-workspace account-mirror \
         cairn-rail file-org-shell arxa-sidebar; do
  node plugins/$p/selftest.mjs || echo "FAILED: $p"
done
node plugins/arxa-sidebar/smoke.mjs        # 15 route-level checks

# 2. live shell (sandboxed home — never uses ~/.arxa)
export ARXA_HOME=/tmp/arxa-lens-home
node --import ./bin/loopback-localhost-patch.mjs bin/arxa-studio.mjs
# → http://127.0.0.1:7891

# 3. visual (from the sibling arxa repo)
cd ../arxa
export ARXA_LENS_UA="Mozilla/5.0 (Macintosh) ArxaShell/1.0 (lens)"
dart run arxa/bin/arxa.dart lens check http://127.0.0.1:7891 /tmp/sb.png \
  1280 832 3500 "--expect=(()=>!!document.querySelector('.aXa_sb_logoRow'))()"
```

Evidence PNGs: `designs/file-org-shell/evidence/smoke/` — notably
`sidebar-restored-1280.png` (correct anatomy) vs `expanded_1280.png`
(the broken version, kept as the before-shot).

## 7. Phase C — DONE (d80ff9f)

`scripts/ci.mjs` discovers `plugins/*/selftest.mjs` dynamically (plus the
arxa-sidebar smoke), runs all, reports each, exits non-zero on any red — ten
suites green on master. `npm test` aliases it, and the GitHub workflow runs
that same entry as a step after `npm ci` (its own header asked for exactly
this). The rebuild gate is a hard failure by inclusion. D3's `ci-run` button
and the absent `ci.run` action stay untouched, as reserved.

## 7b. Engine findings this session (both fixed in d6e5807)

- `ARXA_PORT` is now env-overridable. `--headless` boots cannot take web
  flags at all (the dsh-headless CLI has no `--port`), so a second instance
  boots the web bundle with `ARXA_PORT=<port> ... --no-open`.
- The five relative-import libraries (workspace, workspace-index,
  git-workspace, account-mirror, cairn-rail) now copy flat into the profile's
  node_modules in CHECKOUT mode too — pnpm's virtual store isolates file:
  deps, so before this fix every fresh checkout boot silently served the
  sidebar stub (seam false, all actions no-workspace) while rendering a
  normal-looking no-org UI. Long-lived profiles kept working, which is why it
  survived. If a boot still stubs, check for the five dirs flat in
  `$DSH_HOME/profiles/arxa/node_modules`.

## 8. Known gaps / caveats

**Discharged this session:**
- Sessions are now **project-annotated** (registry `project` slug or null;
  see CONTEXT.md: org-level session vs project session). Scope ladder:
  exact id → sole in-scope (selected project + org-level) → sole parked
  anywhere → `ambiguous-parked-session`. Proven through the real UI
  (`652c07f`): a session created by clicking carries `project: "rocket"`.
- The open-org flow past the CTA click is lens-verified — including one real
  UI click (the old client sent the selected project id as `arg` to every
  CTA, which made Open throw `org-not-found`; fixed).
- Sidebar composition second opinion delivered (see §4), with caveats.

**Discharged in the follow-up sweep (all green under `npm test`):**
- `trash.restore` with no entry id now restores the whole trash, per-entry
  failures collected — the CTA works. (lifecycle +4 selftest checks, smoke +3)
- Reviewer follow-ups closed: the regenerate transform is committed
  (`scripts/gen-sidebar.mjs` + two snippet files), the sidebar selftest has
  a byte drift gate (regenerate → compare; hand-edits go RED), and the
  rc-bump policy is the transform script's header.
- The physical per-project design is written down for its own future grill
  round: `docs/plans/project-sessions-physical.md` (deferred by decision
  Q3 — annotation shipped, physical reattachment scoped with open questions).

**Still open:**
- Per-project session WORK (physical branch/worktree on the project repo) —
  deferred by decision; design ready in the doc above.
- Evidence shots show dsh's stock first-run notice modal — cosmetic, fresh
  sandbox home, not a regression (stock dsh chrome; not actionable here).
