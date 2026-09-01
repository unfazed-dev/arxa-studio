# DSH plugin-UI conformance — arxa-sidebar + arxa-artifact-viewer

Grilled and confirmed 2026-09-02 (grill-me session, /fakimi gates). North star:
both sidebars brought to **full DSH plugin-UI conformance — visual AND
architectural — under one unified standard**. No stock dsh package is ever
edited; every replacement follows the established disable-row/insert-row
revert shape.

## The contract (verified against shipped dsh source)

Client plugins are `__ModuleLoader__.load({id, factory})` bundles; the loader
is authoring-agnostic (dsh-client-modules/lib/client.js: resolution order
seed word → memoized record → registered factory → loud throw). Seed words
`react`, `react/jsx-runtime`, `react-dom`,
`@deepseek-ai/dsh-client-ui-primitives` are free for every bundle (baked into
dsh-web-frontend's static module table); `dsh.client.external` is only for
package→package requires. dsh's own dynamic path (dsh-cordis-client-runner)
documents the hand-written style: "plain JavaScript (no JSX, no TypeScript);
build elements with React.createElement" — so hand-written conformant bundles
are first-class, no build step required.

Conformance means:
- primitives (Button, Tooltip, Modal, Menu, StateDot, DisclosureRow, Toast,
  Icon* family — full catalog harvested from shipped bundles)
- theme tokens from the REAL vocabulary (`--dsw-alias-*`, `--dsw-static-*`,
  `--ds-*` — harvested from dsh-client-ui-theme; invented names like
  `--dsw-alias-text-critical` resolve to nothing and were the sidebar's
  silent-fallback defect)
- `ctx.locale.register(NS, dicts)` + `t()` for every user-facing string
- every side effect inside `ctx.effect()` disposers
- slot-declared surfaces (e.g. `shell.overlay`) instead of hand-layered DOM

## Decisions locked in the grill

| # | Decision | Answer |
|---|----------|--------|
| 1 | Scope | (c) full conformance, both sidebars, one unified standard |
| 2 | Sequencing | artifact-viewer BEFORE sidebar surgical |
| 3 | Authoring | (a) conformant hand-written, zero-dep (evidence-backed) |
| 4 | Locale | en/pl/fr, zh dropped, via NEW arxa-locale plugin (step 0); pl/fr translations need native review pre-ship |
| 5 | Themes | both light+dark; screenshot pairs in verification |
| 6 | Viewer runtime | (a) store-based ingress; window event kept as public API; service face deferred to sidebar phase |
| 7 | Auto-open | (b) gesture-based + first-produced-file-per-turn; live reload of open artifact on re-writes |
| 8 | Edit model | rendered-primary markdown w/ corner source toggle; code/text open editable; session-ensure at OPEN time; debounced auto-save (~1.5s) + StateDot; no edit/save buttons; 409 flow kept; "Edit-with-agent" deferred |
| 9 | Chrome | filename + lane badge + version Menu; copy/download; source toggle; diff; maximize/close icon buttons; StateDot absorbs session badge; path form killed; idle = restyled session-changes |
| 10 | Sidebar scope | dead tokens→real, WelcomeGate→shell.overlay, toggle re-token (no Switch primitive exists), ErrorNote dedup ×5, zhOver→plOver/frOver, inline-style audit→aXa_sb_* block |
| 11 | Verification | per-phase selftests + scripts/ci.mjs stage + lens matrices (light/dark × 390/744/1280) + interaction proofs + Gate 4 claim lists |

## Phase 0 — arxa-locale (new plugin)

Replace stock `locale` row (dsh-web-app cordis.patch.yml row id `locale`):
`- id: locale / disabled: true` + insert `arxa-locale` by package name.

- Host half (~30 lines): settings namespace `locale`, preference schema
  `z.union(["en","pl","fr"])` (stock: dsh-client-locale/lib/index.js).
- Client half: scripts/gen-locale.mjs transforms stock
  dsh-client-locale/lib/client.js (same pattern as gen-sidebar.mjs):
  LOCALES → [{en, English},{pl, Polski},{fr, Français}];
  DOCUMENT_LANGUAGE → {en:'en', pl:'pl', fr:'fr'}; common NS (~40 keys) +
  settings.locale row translated to pl/fr; zh dropped; browser-locale
  resolver maps pl/fr → pl/fr, else en; class-prefix repaint (aXa_loc_).
- Service face identical (register/bind/setLocale/getLocale/subscribe/
  installLocale) — stock plugins injecting @deepseek-ai/dsh-client-locale
  keep working; untranslated stock surfaces fall back to en through the
  existing lookup chain (active → en → common → key).
- en is the key-set source of truth (it is already FALLBACK_LOCALE).
- Verify: Language row lists 3 locales, switch re-renders, <html lang>
  tracks, preference persists across reload, stock plugin (conversation)
  falls back to en with nothing blank.

## Phase 1 — artifact-viewer presentation rebuild

Rewrite plugins/artifact-viewer/lib/client.js (669 lines, hand-written) into
a conformant hand-written bundle. Host half untouched except where noted.

**Contract layer:** primitives throughout; one injected `aXa_av_*` CSS block
(all values from --dsw-* tokens); `arxa-artifact-viewer` locale NS (en/pl/fr);
every listener/subscription in ctx.effect.

**Claude-window replica (support.claude.com article 9487310):**
- auto-open: gesture-based (produced-file chips, sidebar file rows, gen-ui
  cards) + first-produced-file-per-turn; live reload of the open artifact on
  re-writes ("updates in place").
- automatic edit: markdown = rendered-primary with corner source toggle
  (always editable CM6); code/text open directly editable; session-ensure at
  OPEN time (transparent D80 ensure); guards (no org open, >5MB, binary) →
  view-only with styled reason.
- auto-save debounced ~1.5s through the existing write API; no edit/save
  buttons; StateDot = clean/dirty/saving/conflict; 409 external-change flow
  kept (reload-theirs vs force-save-yours); diff-vs-main kept as corner
  action (@codemirror/merge, read-only).
- chrome: filename + lane badge + version Menu (chip/timeline data) |
  copy-content, download, source toggle (markdown), diff (editable lanes),
  maximize/close icon buttons with Tooltips. StateDot absorbs the session
  badge (name in tooltip). Path-input form killed (debug affordance; real
  ingress = file rows + chips). Idle body = session-changes list restyled on
  DisclosureRow/token classes.
- pdf/image/audio/video/iframe lanes: view-only, chrome only.

**Runtime:** store-based ingress — apply() owns ONE ctx.effect-registered
'arxa-av-open' listener → writes {sessionId?, relPath} to a store +
layout.openViewer(); panel consumes store on mount/update and clears. Dies:
5-attempt setTimeout retry loop, __ARXA_AV_PENDING__, the 4s session-poll
(replaced by sessions.list.subscribe — snapshot store verified in
dsh-client-runtime), window debug globals. Chip interception stays
capture-phase on '[data-produced-files-row] button[title]' (only way to
reroute stock chips without forking ui-deliverables) but moves inside
ctx.effect with a disposer.

**Deferred (documented):** "Edit-with-the-agent" gesture (highlight → agent
edits in place; needs session-routing design); full client-service face
(provide('arxaArtifactViewer')) — lands when sidebar phase migrates its
file-row bridge.

## Phase 2 — arxa-sidebar surgical

All edits in plugins/arxa-sidebar/lib/workspace-region.snippet.txt, then
`node scripts/gen-workspace.mjs --write`, then selftest hash gate:

1. Dead tokens → real: text-critical→--dsw-alias-label-error (7 uses),
   status-danger→--dsw-alias-state-error-primary,
   text-link→--dsw-alias-brand-primary (links then follow theme-accent),
   text-secondary→--dsw-alias-label-secondary,
   bg-raised→--dsw-alias-bg-layer-2. All hex fallbacks deleted.
2. WelcomeGate → shell.overlay slot registration (kind:list, scope:root)
   instead of position:fixed z-index:2147483000.
3. Publish toggle re-tokened (no Switch primitive exists — hand shape stays):
   --dsw-alias-brand-primary / --dsw-alias-fill-l2 / --dsw-alias-border-l2.
4. ErrorNote dedup: 5 modals' identical inline errMsg divs → one shared
   component in the snippet.
5. zhOver deleted, plOver/frOver added (after Phase 0). Generated stock zh
   dicts stay as dead weight (transform fidelity).
6. Inline-style audit: dynamic layout values stay inline; theme-able values
   move to a snippet-owned aXa_sb_* CSS block.

## Verification (every phase)

- selftest.mjs per plugin (stock-package hashes + contract anchors) +
  scripts/ci.mjs stage.
- arxa-lens matrices: light/dark × 390(sheet)/744/1280(docked) × key states.
- Interaction proofs: auto-save → file on disk; 409 → conflict UI;
  first-produced-file auto-open; chip click → open; locale switch +
  persistence + en fallback.
- Gate 4 claim list (verified/assumed/unknown) before the next phase starts.

## Risks / honest flags

- pl/fr translations authored by the agent — native-speaker review required
  before user-facing ship.
- arxa-locale is a THIRD replace-stock surface: rc-bump policy extends
  (DSH_VERSION pin in gen-locale.mjs + re-transform + anchors).
- Capture-phase chip interception is DOM-coupled to stock ui-deliverables —
  selftest anchor should assert the selector still exists per rc bump.
- The stock locale host schema validates the persisted preference; a user
  who had zh persisted will fail validation after the swap — the adopt()
  path falls back to browser-derived locale (acceptable, one-time).
