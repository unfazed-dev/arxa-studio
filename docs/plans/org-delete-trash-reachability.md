# Deleting an org threw you at the welcome view

**Reported:** "when i deleted TERRA a github linked org - it did not move it to
the trash but got redirected straight away to the welcome view … when user
deletes anything in the sidebar, for orgs and freestyle they must always just
move to their respective trash - that feature of restore in the welcome view is
obsolete remove that".

**Prior art this supersedes:** [`org-trash-unreachable.md`](org-trash-unreachable.md)
(2026-09-08). That round added the welcome-view Restore as a *rescue* for the
same underlying defect. This round fixes the defect and removes the rescue.

## The premise, corrected

The org **did** move to the trash. `trashOrg()` (`file-org-shell/lib/lifecycle.js`)
parks the folder under `<scope>/.arxa/trash/<entryId>/`, appends to
`org-trash.json` and drops the org from recents. The reporter's own screenshot
proves it — TERRA is listed under "Recently deleted".

Nothing in the org trash *path* is broken. What broke is **reachability**: the
sidebar's Trash section — which already lists trashed orgs with Restore and
Delete forever — was covered by a full-screen overlay at the exact moment it
became the only thing you needed.

## Root cause

Three facts compose into the bug.

| # | Fact | Where |
|---|---|---|
| 1 | `showWelcomeGate(orgCount, activeTab)` → `orgCount === 0 && activeTab !== "freestyle"` | `freestyle-region.snippet.txt:73` |
| 2 | `WelcomeGate` renders `{ position:"absolute", inset:0, background:"var(--dsw-alias-bg-base)" }` | `workspace-region.snippet.txt:2815` |
| 3 | It mounts into the frame's `shell.overlay` slot — `.aXa_fr_overlayLayer{z-index:20;position:absolute;inset:0}`, spanning **all four grid columns** | `arxa-frame/lib/client.js:350` |

Trash your last org → `orgCount` hits 0 → an opaque backdrop covers the whole
app, sidebar column included. The Trash row is rendered and correct underneath;
you simply cannot reach it.

The gate already declines to cover the Freestyle tab (`activeTab !== "freestyle"`).
That asymmetry is the tell: covering the sidebar was incidental, not intended.

## Why the sidebar is the right home for this

Both preconditions for removing the welcome-view Restore already hold:

- **The Trash section renders at zero orgs.** `ARXA_TRASH_AFTER_ORGS()` is
  spliced as a *sibling* of the org-group `.map()` (`client.js:2167`), so an
  empty org list does not suppress it. The host serves the rows even with no
  lifecycle at all — `index.js:773` returns `{...emptySnap(), orgTrash}`, itself
  a fix from the previous round. The section auto-opens while anything is
  trashed.
- **The sidebar has its own create-org affordance.** The stock "+" is spliced to
  dispatch `arxa-create-org` (`gen-workspace.mjs`), the same event the welcome
  card fires.

So the sidebar already offers everything the rescue offered, plus purge.

## The fix

Keep the welcome hero — it is the right first-run surface and it still covers
the stray dsh-home sessions D69 was written for — but stop it spanning the
sidebar column.

| Layer | Change |
|---|---|
| `scripts/gen-frame.mjs` (5c) | the frame root already computes `cols.sidebar` for `gridTemplateColumns`; publish it as `--aXa-fr-sidebar` on the same element. Derived from `cols.sidebar`, so collapsed (`0px`) and narrow are handled with no extra branch. |
| `workspace-region.snippet.txt` | backdrop `inset:0` → `top/right/bottom:0, left:var(--aXa-fr-sidebar, 0px)`. Delete the `trashed` read and the whole "Recently deleted" block. |
| locales ×3 | drop `welcome.trashed` / `welcome.restore`. |
| `selftest.mjs` | the S-rescue pins asserted the rescue existed; they now assert the opposite — the gate offsets by the sidebar column and mints no restore of its own. |

`orgtrash.restore` stays on the host untouched: the sidebar Trash row calls it,
and `smoke.mjs` still exercises it live.

## Deliberately NOT changed

**Freestyle roots keep "Forget folder".** A root is a folder the user owns
somewhere on their disk — arxa registered it, it did not create it. Moving it
into arxa's trash would be a destructive surprise, and the shipped copy already
promises "The folder stays on disk." `forgetRoot()` only splices the registry
row. Freestyle *files and sessions* do have a real trash (restore + purge,
`freestyle.trash.*`), which is the trash the request is about.

**GitHub-linked orgs already round-trip.** `trashOrg` states it and the code
holds: the folder moves wholesale, so `.git` and its remote travel with it and
no GitHub API call is made. Repos are deleted only by `purgeOrgTrash`, behind a
typed confirm. `restoreOrg` moves the folder back and `touchRecent`s it, so the
org returns linked.

## Verification

- `plugins/arxa-sidebar/selftest.mjs` — the rewritten S-rescue block, six pins.
  Neutered the frame var and watched "the frame publishes its sidebar width"
  go red on its own, so the pin measures the fix rather than restating it.
- `node scripts/ci.mjs` — ALL GREEN, drift gate included.
- Freestyle trash untouched and still green: `selftest.trash-sessions.mjs`,
  `selftest.files.mjs`, `arxa-sidebar/selftest.freestyle.mjs`,
  `workspace/selftest.trash-session.mjs`.

### Live, in a running engine — the trash observed *as it happens*

A scratch org `TERRAX` with a real `origin` remote, trashed from inside the
running page with **no reload**, which is the transition a fresh page load
cannot stand in for:

```json
{"before":{"orgRow":4,"gate":false},"trashOk":true,
 "gateShown":true,"sidebarVar":"280px","gateLeft":280,
 "trashRowVisible":true,"clickLandsOn":"SPAN.aXa_wsr_title",
 "clickSwallowedByGate":false,"gateHasRestore":false,"ok":true}
```

`gateLeft` equals the sidebar width exactly, and a hit test at the centre of the
trashed org's row returns the row's own title span — the row is genuinely
clickable, not merely painted. Screenshot:
[trash-reachable-at-zero-orgs.png](phase0b-snapshots/org/trash-reachable-at-zero-orgs.png)
— sidebar with Trash open (count 1, `ORGANISATIONS`, `TERRAX` + restore +
delete-forever), welcome card centred in the content area, no restore on it.

### The same engine, with the fix undone

Setting `--aXa-fr-sidebar` back to `0px` in the live page reproduces the
reported bug and nothing else changes:

| | click lands on | swallowed by the gate | gate left |
|---|---|---|---|
| with the fix | `SPAN.aXa_wsr_title` | no | 280 |
| var forced to 0 | `DIV` (the backdrop) | **yes** | 0 |

### GitHub round-trip

`orgtrash.restore` on the trashed linked org returned the folder with
`git remote get-url origin` still `https://github.com/arxa-test/terrax.git`,
branch `main`, and emptied `org-trash.json`. No GitHub call is made by trash or
restore; only purge touches the remote.

**Not verified:** a real GitHub-linked org against the live GitHub API — the
remote here is a URL on a scratch repo, which exercises the code path that
matters (trash and restore never call GitHub) but not the network.

---

## Round 2 — the gate removed outright (same day)

The offset above shipped, and the reporter came straight back with two
screenshots: zero orgs showed the "Welcome to arxa studio" card, one org showed
the `Flowing High` hero.

> "need to see the same thing regardless of what is in the trash — we need to
> always see: Flowing High / Sessions start inside a workspace … when empty or
> no session is active"

So the gate goes entirely. **This partly undoes the section above**: the
sidebar-width offset made the Trash reachable *past* the gate; with no gate
there is nothing to reach past, and the offset is deleted with it. The record
above stays as written — it is what was true for that hour.

### What was removed

| Layer | Change |
|---|---|
| `workspace-region.snippet.txt` | the `WelcomeGate` component (61 lines) and its six `welcome.*` strings across all three dictionaries (18 lines) |
| `freestyle-region.snippet.txt` | `showWelcomeGate` — the gate was its only caller |
| `gen-workspace.mjs` | the sidebar's `shell.overlay` seat. **`design-panel` also registers into that slot**, so only our registration went; the frame's declaration and the inject stay |
| `gen-frame.mjs` | `--aXa-fr-sidebar` reverted — the gate was its only consumer, and a published mechanism nothing reads is worse than none |

### Why nothing is lost

Checked live at zero orgs before cutting, because the gate held the only
`arxa-create-org` dispatch sites in the tree:

- the sidebar header carries a **"New organisation…"** button, and firing
  `arxa-create-org` mounts the modal — name, location, and the D36 "Creates at"
  root picker. First-run org creation never depended on the card.
- "Use Freestyle" duplicated a visible peer tab; "arxa business" was disabled.

### Verified — the same view either way

One engine, org present then trashed live, comparing every text node in the
content column:

```json
{"withOrg":  ["Flowing High","Sessions start inside a workspace — …","design"],
 "zeroOrgs": ["Flowing High","Sessions start inside a workspace — …","design"],
 "same": true, "ok": true}
```

[hero-with-org.png](phase0b-snapshots/org/hero-with-org.png) ·
[hero-at-zero-orgs.png](phase0b-snapshots/org/hero-at-zero-orgs.png) — identical
content column; only the sidebar differs, which is the point. The saturated hero
background appears in **both**, so it is the hero's own, not a side effect of
removing the gate.

`node scripts/ci.mjs`: ALL GREEN. Three stale pins retired rather than left to
fail — the gate-registration pin, the `welcome.freestyle` locale-parity entry,
and three `showWelcomeGate` behaviour assertions whose intent (a zero-org app
stays usable) is now structural instead of conditional.
