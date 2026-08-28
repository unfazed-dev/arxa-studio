# File-org shell integration plan

Wires the six proven file-organisation plugins (`workspace`,
`workspace-index`, `git-workspace`, `account-mirror`, `cairn-rail`,
plus the trash module inside `workspace`) into the running arxa-studio
shell, then makes the rebuild gate permanent CI. Extends
`docs/plans/file-organisation-implementation.md`, which built the
libraries but left them unreferenced outside `plugins/`.

Advisor note: consult-mode returned `over_budget` (session fuse 21/20)
at planning time; skip recorded, plan grounded on primary sources
(dsh package READMEs, existing plugin manifests, `bin/arxa-studio.mjs`).

## Constraints (inherited, non-negotiable)

- **Depend-don't-fork**: dsh pins stay EXACT (`0.1.1-rc.2`); no dsh
  source edits. All integration is arxa-side plugins.
- **Ownership boundary**: nothing may require the Arxa Digital
  Solutions database. Everything here is local-first; `account-mirror`
  stays read-only and optional.
- **Plugin conventions**: follow the seven existing shell plugins —
  `package.json` with `dsh.client.inject` + `lib/client.js` for UI,
  `lib/index.js` for server side, registered by package name in
  `bin/arxa-studio.mjs`, zero-dep, immutable per release.

## Phase A — Server-side wiring: org lifecycle service

One new plugin `plugins/file-org-shell/` (server side only in this
phase) that owns the org lifecycle and composes the six libraries:

- **Boot**: discover orgs via `workspace` scaffold/resolve API; no org
  auto-opened.
- **Org open** (single entry point, in order): per-org process lock →
  stamp check / forward-only migration (template plugin) →
  `workspace-index` open with rebuild-if-missing → `git-workspace`
  repo attach → session branch/worktree ready. Failure at any step
  surfaces fail-loud in the shell, never a silent fallback.
- **Org switch/close**: reverse teardown; lock released; watchers
  killed (grill D-decision: processes die on org switch, cannot
  express an outside path).
- **Optional rails**: `account-mirror` and `cairn-rail` attach only
  when configured; absence is a normal state, not an error.
- Exit check: `arxa-studio` boots, opens a fixture org end-to-end,
  survives kill -9 mid-open (lock + rewind already proven in libs);
  integration selftest `plugins/file-org-shell/selftest.mjs` green.

## Phase B — Sidebar redesign: per-org surface + CTAs

**New scope** — no prior plan covers the sidebar (verified: zero
matches across `docs/plans/`). Registered into the `sidebar` slot
declared by `@deepseek-ai/dsh-client-ui-layout` (owner share is only
`collapsed`/`width`; our data comes from our own inject faces).

- **Org header**: current org identity (name, brand accent via
  existing `theme-accent`/`brand` seams), org switcher.
- **Per-org tree**: projects from the org manifest (workspace
  plugin), version chips from git rail data source, session state
  badges from worktree lifecycle.
- **CTAs, state-dependent, one primary per state**:
  - no org open → "Open organisation" / "New organisation"
  - org open, empty → "New project"
  - project selected → "New session" (branch-per-session)
  - dirty/parked sessions → resume/merge affordances
  - trash non-empty → restore entry point
  - CI verb → manual CTA slot reserved per grill D3 (CI trigger is a
    dsh plugin CTA; wire the slot, stub the verb until CI phase).
- **UI harmony via Creator mode**: validate the composition in the
  Cordis preset ("Creator mode" — dsh's preset-authoring/plugin-
  experiment mode, already patched in via `profile/cordis.patch.yml`).
  Iterate the surface there before freezing; the shipped preset stays
  read-only, arxa ships its own composition.
- Exit check: sidebar renders per-org state from a fixture org; every
  CTA drives the Phase A lifecycle API; no `localStorage` writes
  (layout store is transient by dsh contract).

## Phase C — Permanent CI: rebuild gate + suite

- `scripts/ci.mjs` (single entry): runs all plugin selftests
  (workspace, workspace-index, git-workspace, account-mirror,
  cairn-rail, file-org-shell) and the **rebuild gate** — delete DB →
  full rescan → query-equivalent index — as a hard failure, per the
  Phase 2 "permanent CI, not a one-off" commitment.
- `npm test` aliases it; grill D3's manual-CTA hybrid means the same
  entry is what the future UI trigger invokes.
- Exit check: one command, non-zero exit on any failure, run clean on
  master.

## Order & traceability

A → B → C. B depends on A's lifecycle API; C freezes both.
Discharges: D3 (CTA slot), D5 (creator-mode-built shell), remaining
integration half of D46; sidebar scope newly added here.
