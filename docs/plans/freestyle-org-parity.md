# Freestyle ↔ Organisations parity — one flow, one interface

**Ruling (operator, 2026-09-09):** the Freestyle tab behaves *exactly* like the
Organisations tab — same menu, same modal, same create / delete / archive /
restore / publish flows and words — with one difference only: the structure of
the folders arxa studio generates. Organisations get the opinionated org tree;
Freestyle gets the generic frame (`git init -b main`, manifest, `check.sh`) and
nothing else. Every ambiguity below is resolved as "like orgs"; no further
questions were asked, per the operator's instruction.

## Part 1 — create (done)

### What the org tab does

| step | Organisations |
|---|---|
| `+` | dsh add-menu with one entry → fires `arxa-create-org` → `OrgCreateModal` |
| modal | Name (autofocus) · Location (typed, or click = native picker; default `~/Arxa`, sticky last parent from `~/.arxa/create-root.json`) · live preview "Creates at: `<location>/<slug(name)>`" · debounced collision check via `/__arxa/sidebar/folder-info` · "already lives here — Open it instead" when the target is an org · non-empty target blocks Submit · Publish-to-GitHub switch, ON by default, disabled + hint when unlinked · Cancel / Create · Enter submits · errors inside the modal |
| host | `org.create-at { name, path, link }`: slug(name) under `path`, non-empty refusal, mkdir, scaffold, remember parent, `link:false` → local-only |

### What Freestyle did

`+` menu ("Open existing folder…" / "Create new folder…") → native picker for
the parent → small confirm modal with a bare name field → `root.new { parent, name }`
(raw name, no slug, no location field, no preview, no collision preview, no
publish switch). The confirm modal's name field had been added the same day to
replace `window.prompt`.

### The change

| piece | change |
|---|---|
| `OrgCreateModal` (`workspace-region.snippet.txt`) | gains `kind`. `kind: "freestyle"` swaps only the words that say "organisation" (`FS_KEYS`: title, submit, exists, two publish hints) and the store behind Submit: `freestyleStore.mutate("root.new", { name, path, link })`. "Open it instead" fires `root.add { path }` when the host says `isFreestyle`. Everything else — fields, preview, slug mirror, collision effect, switch, footer — is the same code path. |
| `FreestyleBrowser` (`freestyle-region.snippet.txt`) | `creating` state; "Create new folder…" → `setCreating(true)`; renders `OrgCreateModal { t, kind: "freestyle", open: creating }` next to the confirm modal. No native picker before the modal — the Location field has it, like orgs. |
| `FreestyleConfirmModal` | the day-old name-field branch is gone (dead once the create modal owns names); it confirms trash/purge only. |
| host `arxa-freestyle/lib/roots.js` | `createRoot({ name, path, link })` mirrors `org.create-at`: `~` expansion, `slugify` from `workspace/lib/slug.js` (same slug the org preview mirrors), non-empty target → `folder-exists:` refusal, empty existing folder adopted, `mkdir -p`, `addRoot` (generic frame), `create-root.json` under `ARXA_HOME` (same file the org host writes under `~/.arxa` — identical in production), `link` → `publishRoot` at once; a refused publish throws (`linked-required` for an unlinked account) *after* the folder is registered local-only, so the modal shows the reason and the row menu can publish later. |
| host `arxa-freestyle/lib/index.js` | `root.new` → `createRoot` with the GitHub bridge when `link !== false`; still accepts the old `parent` key. |
| host `arxa-sidebar/lib/index.js` | `folder-info` also answers `isFreestyle` (`<target>/.arxa/freestyle.json` exists). |
| locales ×3 | `freestyle.create.title` "New folder", `freestyle.create.exists.root`, `freestyle.create.ghOffHint`, `freestyle.create.ghUnavailableHint`; `freestyle.add.newPrompt` removed. |
| selftests | sidebar `S-newfolder` block rewritten (six pins: modal wiring, store contract, word swap, open-it-instead + `isFreestyle`, host mirror, confirm modal collects no names); the D90 fragment-evaluation pin learns the three new free variables (`K`, `fsKind`, `freestyleStore`); `selftest.freestyle.mjs` locale list updated; `arxa-freestyle/selftest.mjs` gains seven `createRoot` checks (slug + display name, sticky parent, non-empty refusal, empty adopt, no-slug refusal, unlinked publish → local-only + `linked-required`). |

Kept: the `+` menu itself (the org `+` is also a dsh menu — one entry there,
two here because Freestyle must be able to open an arbitrary folder, F1);
"Open existing folder…" untouched.

### Verification

- `node scripts/ci.mjs` — 103 suites, ALL GREEN. `window.prompt(` in `client.js`: 0.
- Live, scratch engine, headless Chrome through the arxa lens (1440×900), the
  real `+` → "Create new folder…" path with the location typed:
  title "New folder", label "Folder name", no "organisation" word anywhere;
  preview `Creates at: <parent>/Lens-Parity`; Create enabled; on submit the
  modal closes, one root appears (display name "Lens Parity", folder
  `Lens-Parity` with `.arxa`, `.git`, `check.sh` and nothing org-shaped),
  `create-root.json` remembers the parent; the same name again shows "Lens
  Parity is already a Freestyle folder here." + "Open it instead" with Create
  disabled. Capture: `docs/plans/phase0b-snapshots/freestyle/create-parity.png`.
- Committed as `2fa57f4`.

## Part 2 — rows, archives, trash (done)

### The audit (org tab vs Freestyle tab, before)

| surface | Organisations | Freestyle before | gap |
|---|---|---|---|
| row menu | rename, open, sync, sweep, connect \| disconnect, ─, trash | newFile, newFolder, newSession, rename (inline), open/close, reveal, publish (disabled unless linked), trash (confirm) | no sync, no sweep, no disconnect, publish without the modal, rename without the modal |
| rename | `OrgRenameModal` (phases, error mapping) | inline edit in the row | differs |
| publish | `OrgPublishModal` (confirm / busy / done / error, reason words, "Open on GitHub") | fire-and-toast | differs |
| disconnect | `OrgDisconnectModal` (keep / remove radios, typed repo slug gate, re-link) + `org.disconnect` | none | missing |
| sync | row item → `org.sync` → "In sync / Synced / Sync failed" span on the row | none | missing |
| sweep | `OrgSweepModal` (dry-run preview → confirm with `only`) + `org.sweep` | host had `session.sweep`, no verb in the sidebar | missing |
| Move to Trash (folder, archived session, file) | immediate, restorable | asked a confirm modal first | differs |
| purge | `OrgPurgeModal` — retype the exact name to arm Delete forever | generic confirm modal, no typed gate | differs |
| Archives / Trash sections | revive / trash; restore / purge | same verbs, same grammar | none |

### The change

| piece | change |
|---|---|
| `FreestyleRootRow` menu | the org items in the org order — Rename…, Open/Close, Sync with GitHub, Sweep merged sessions, Connect to GitHub \| Disconnect GitHub… — then a separator, the file verbs a folder needs (New file, New folder, New session, Reveal in Finder), a separator, Move to Trash. Connected rows wear the GitHub mark (D91); the last sync outcome sits on the row (D97), from the shared `arxaSyncSummary`. |
| modals | Freestyle owns **no modal of its own** any more. `FreestyleModals` mounts `OrgRenameModal`, `OrgPublishModal`, `OrgDisconnectModal`, `OrgSweepModal`, `OrgPurgeModal` with `kind: "freestyle"` (or `scope: "freestyle"` for purge) on the target; the rows ask through one setter. `FreestyleConfirmModal` is deleted. Needed because the org tab's own mounts live in `OrgBrowser`, which is not rendered while the Freestyle tab is. |
| each org modal | one `kind === "freestyle"` branch: the store call (`root.rename`, `root.publish`, `root.disconnect`, `session.sweep`, the purge target's own `call`) and the words that said "organisation" (`freestyle.rename.*`, `freestyle.publish.confirmDesc` / `errNotLinked`, `freestyle.disconnect.warn`, `freestyle.sweep.scope`, purge title / warn / cta / busy). The Freestyle route spreads its result, so those branches read `b`, not `b.result`. |
| Move to Trash | asks nothing — folder, archived session and file all move at once and are restorable, like the org rows. |
| purge | through `OrgPurgeModal` with the typed-name gate. A trashed **folder** is only untracked ("The folder stays on disk — arxa just stops tracking it", CTA "Remove from Trash"); a trashed **file** is really deleted. |
| host `roots.js` | `disconnectRoot(root, { removeRepos, github })` mirrors `disconnectOne`: KEEP strips the manifest link state and leaves origin; REMOVE deletes the GitHub repo first (a refusal leaves the folder connected) and drops origin. `syncRoot(root, { github })` mirrors `syncRepoNow`: fetch, diverged → park a `sync-conflict` note, ahead → push, behind → fast-forward only, a healthy end clears the note; never throws. `authedUrl` shared with publish. |
| host `index.js` | `root.disconnect`, `root.sync` (returns `{ repos: [...] }`), `session.sweep` takes `only`; state rows carry `connected`, `repoName`, `repoUrl` from the manifest. |
| host `sessions.js` | `sweep(root, { dryRun, only })` — the preview's ids are a ceiling. |
| locales ×3 | added `freestyle.menu.sweep`, `freestyle.rename.title/note/busy`, `freestyle.publish.confirmDesc/errNotLinked`, `freestyle.disconnect.warn`, `freestyle.sweep.scope`, `freestyle.purge.entryWarn/entryBusy/rootBusy`; removed the dead confirm-modal and publish-toast keys. |
| selftests | sidebar: `S-orgparity` block (row menu, one setter, the store branch per modal, purge gate, sync span ×2, no confirms, host mirror); D113 sweep pins retargeted to the shared `sweep()`; `selftest.freestyle.mjs` pins and key list updated. `arxa-freestyle/selftest.mjs`: six disconnect / sync checks (33 total). |

### Deliberate divergences (recorded, not hidden)

- **Rename is display-only.** An org rename moves the folder and renames the
  GitHub repo. A Freestyle folder is the user's own folder (or one arxa made at
  a location they chose) with sessions' worktrees inside it; arxa never moves
  it. The modal's note says exactly that.
- **Purging a trashed folder does not delete it from disk.** Already grilled in
  `freestyle-trash-parity.md`: arxa did not create most Freestyle folders, so
  it never deletes them. The purge modal's words say so; a trashed *file* is
  really deleted, like the org side.
- **The `+` menu keeps "Open existing folder…"** (F1): any folder can become a
  Freestyle root; an organisation can only be created. The org `+` is also a
  menu (one entry), so the shape matches.

### Verification

- `node scripts/ci.mjs` — 103 suites, ALL GREEN.
- Live, scratch engine, headless Chrome through the arxa lens, the row's
  context menu driven end to end: menu reads `Rename… | Close | Sync with
  GitHub | Sweep merged sessions | Connect to GitHub | …`; Rename… opens
  "Rename folder", renames to Sandbox, shows "Renamed", the host row carries the
  new name; Connect to GitHub opens the publish modal in Freestyle words with no
  "organisation" anywhere and, GitHub being unlinked, Publish ends in "Publish
  failed — GitHub isn't linked. Sign in with GitHub in Settings…"; Sweep opens
  the sweep modal with the Freestyle scope line and "Nothing to sweep"; Sync
  paints "In sync" on the row; Move to Trash asks nothing — one root fewer, one
  trashed folder, no dialog; Remove from Trash on the trashed row opens the
  purge modal "Remove this folder from the Trash?" with the button dead until
  "Sandbox" is retyped. Capture (the purge modal, armed):
  `docs/plans/phase0b-snapshots/freestyle/parity-purge-modal.png`.
- Committed as `52262e9`.

## Installed

- `2fa57f4` + `52262e9` on `main`, pushed. CI 103 suites ALL GREEN.
- Sidecar 241.1 MB, payload sha12 `840ace568bee`; bundled binary `57db2fe3ac2cc076` matches the packed sidecar.
- Installed engine `~/.arxa/engine/840ace568bee` — `client.js` sha `d439d7adfd36` byte-identical to the repo; `FreestyleModals` and `root.disconnect` present. LaunchAgent count 1, Freestyle state route answering on 7891.
- Rollback: `/Applications/Arxa Studio.app.bak`.
- Observed in the Part 2 capture, not touched: with the Trash section auto-opened, the "Trash" header text and the trashed row's title overlap for a moment. Pre-existing section geometry from the trash-parity round; worth its own look.
