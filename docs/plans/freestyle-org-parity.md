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
- Live lens run: see the "Installed" section once done.

## Part 2 — rows, archives, trash

Pending the parity audit of the row menus and the Archives/Trash sections;
gaps found there are recorded below and closed in the same ruling.
