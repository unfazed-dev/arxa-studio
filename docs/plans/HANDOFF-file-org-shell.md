# HANDOFF — file-org shell integration (Phases A/B done, C open)

Written 2026-08-29. Continues `docs/plans/file-org-shell-integration.md`.
Everything below is committed on `master` in `arxa-studio` (plus one commit
in the sibling `arxa` repo, noted in §5).

## 1. Where the work stands

| Phase | Scope | State |
|---|---|---|
| A | `plugins/file-org-shell/` — org lifecycle service | **DONE**, merged, selftest 40/40 |
| B | `plugins/arxa-sidebar/` — own sidebar plugin | **DONE**, merged, selftest ALL GREEN, lens-verified |
| C | `scripts/ci.mjs` — permanent CI incl. rebuild gate | **NOT STARTED** |

Phases 1–6 of the earlier `file-organisation-implementation.md` (the six
libraries) were already done before this session; A/B wire them into the
running shell.

## 2. Commits this session (arxa-studio, newest first)

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

## 7. Next: Phase C (not started)

Per the plan:
- `scripts/ci.mjs` — single entry running all seven plugin selftests **plus
  the rebuild gate** (delete index DB → full rescan → query-equivalent index)
  as a hard failure. That gate was called "permanent CI, not a one-off" in
  the Phase 2 commitment but currently only runs by hand.
- Alias it as `npm test`. Same entry the future D3 "Run CI" CTA invokes —
  the sidebar button already exists, disabled, id `ci-run`.
- Exit check: one command, non-zero on any failure, clean on master.

## 8. Known gaps / caveats

- **Sessions are org-level, not project-level.** The git-workspace registry
  has no `project` field, so `parkedSessions()` returns `project: null` and
  the CTA machine treats a null-project session as belonging to any selected
  project. `session.resume`/`merge` resolve ambiguity by: exact session id →
  sole project match → sole parked session → else throw
  `ambiguous-parked-session`. If per-project sessions are wanted, that field
  has to be added in git-workspace first.
- **The full open-org flow past the CTA click is unverified visually.**
  Directory picking needs interactive flow tests; the still capture returns
  to base state after the transient overlay.
- **Advisor was unavailable for the last stretch** — consult-mode returned
  `over_budget` (session fuse 21/20). Phase B's build and this rebuild
  proceeded on primary sources (dsh package source + local plan docs). A
  fresh session resets the fuse; worth a second opinion on the sidebar
  composition.
- `plugins/file-org-shell` reaches its five composed libraries by **relative
  path**, so packed mode copies those five directories into the profile's
  `node_modules` under their `plugins/` directory names. See the comment
  block in `bin/arxa-studio.mjs`.
