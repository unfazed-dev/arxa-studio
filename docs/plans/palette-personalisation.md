# Palette Personalisation — Settings > Personalisation (2026-09-11, operator)

> **Outcome 2026-09-14 (closeout):** shipped and green — one active-row style, ink wash,
> `theme-accent` + `personalisation` selftests GREEN (AXS-048, `967b2cc`); EN/PL/FR parity for
> the new keys closed by Task 8 (AXS-007, parity suite + native-speaker corrections `4347f07`).
> Final matrix: [`open-work-inventory-2026-09-12.md`](open-work-inventory-2026-09-12.md).

The Accent row (three fixed hexes) became the **Palette row**: three
built-in coolors palettes — **Mystic Evening** (default, for everyone out
of the box), **Earthy Green**, **Light Steel** — plus **one custom slot**
(paste a coolors URL or a bare hex list). Grilled to a decision one
question at a time; every ruling below is the operator's, not a default.

## The rulings (the grill)

1. **Scope = A, palette-fed current model.** One chosen swatch drives the
   proven 0.2.5 mechanism unchanged: the `--dsw-static-deepseek-*` +
   `--dsw-static-blue-*` ramps as `color-mix()` tints inline on `<body>`
   (beats `:root` light, dark block, and the brand stylesheet) plus the
   19-stop `--dsw-static-neutral-bluish-*` wash. Palettes repaint HUE;
   surface lightness (the `NEUTRAL_L` ladder) never moves. Full theme
   takeover (B) was declined — revisit only if the built-ins feel tame.
2. **Accent pick = tap-to-pick, auto default.** Tapping a swatch inside a
   strip overrides the accent (stored per palette). Default = most
   saturated (oklch chroma ≥ 0.04); monochrome falls to the 2nd-darkest
   (ascending-by-L puts the darkest FIRST — `sorted[1]`, the `length-2`
   off-by-one reads the 2nd-LIGHTEST and shipped once for an hour).
3. **Legacy = remove + migrate.** The old `#0EBAE4/#0EE4E0/#12D49A`
   swatches are gone; a stored legacy hex or `theme-accent.json` is simply
   ignored and Mystic Evening takes over. No data migration.
4. **Custom contract.** One slot; a new paste replaces it. Input accepts a
   coolors URL **or** a bare hex list; validation is **2–10 unique hexes**
   after normalization (coolors' own bounds, LENS-VERIFIED live 2026-09-11:
   1 → 404, 2 ✓ ("Fiery Forest", even named), 10 ✓, 11/12 refused — and
   coolors' own copy says "up to 10"). Invalid → inline error, the current
   palette keeps painting. Storage: engine file
   `$ARXA_HOME/theme-palette.json` `{palette, accent, name}` is the
   cross-device source of truth (GET/PUT `/__arxa/theme-accent/palette`,
   5 s poll, PUT validated by format+count+4 KB cap — the old whitelist
   is gone because arbitrary hexes ARE the feature); localStorage
   `arxa.themePalette` is the instant cache. The custom's NAME is fetched
   best-effort by the host from `coolors.co/palette/<hexes>` (<h1>/
   og:title, 6 s cap, cached in the file); any failure → `null` → the card
   reads "Custom". Fully local-capable: no name, no network, no DB.
5. **Apply = instant.** Pick or paste repaints at once (prism glides in on
   its own 4–7 s envelope). No preview/save step.

Names come from coolors' own data (lens-rendered the pages: h1 "Mystic
Evening" etc.); the three built-ins hardcode their verified names.

## The contrast engine (the rider, also grilled)

`lib/contrast.js` — a 1:1 JS port of
`arxa/arxa/lib/palette_contrast.dart` (locked 2026-09-11): WCAG 2.2
relative-luminance ratio, OKLab/OKLCH with gamut mapping (public Ottosson
matrices, chroma-decay ×0.92, degenerate → neutral gray), APCA 0.1.9 as an
ADVISORY readout, alpha compositing, and the three-phase solve — foreground
lightness first (smallest step clearing ALL its pairs at once), polarity
inversion second (alt = the palette's far end in lightness), surfaces last
(never, in scope A). `mixOklab()` is the studio addition: it evaluates
exactly what CSS `color-mix(in oklab, A P%, B)` paints, so derived stops
are checked offline before the browser paints them.

**ONE copy**: the host serves the file at
`/__arxa/theme-accent/contrast.js`; the client half `import()`s that URL
(engine route asserted byte-identical in the selftest). Host, client and
tests can never drift.

### The studio pair contract — the REAL token map, measured

Measured from `@deepseek-ai/dsh-client-ui-theme` (not guessed — the first
draft guessed and its gate failed):

- light: bg-layer-1/2/3 ALL read `neutral-bluish-00` (#fff); the accent
  alias reads `deepseek-400`; label-primary reads `neutral-1000`,
  label-tertiary `neutral-400`.
- dark: bg layers read `neutral-875/850/800`; the accent reads
  `deepseek-500`; label-primary `neutral-50`, tertiary `neutral-600`.
- `business-primary` is consumed as TEXT color + focus rings + marks
  (5 × `color:`, ZERO background uses in the shipped CSS) — so the accent
  pairs gate at **3:1 (SC 1.4.11 non-text)**. Stock's own light accent
  (#679efe on #fff) is 2.66:1 — the solve IMPROVES on stock, it does not
  enforce 4.5:1 text on the accent. Labels pair at body 4.5 / tertiary 3:1.

Eight pairs, two moving slots (`accentDark` = the 500 position,
`accentLight` = the 400 position = 78 % accent tint); labels and surfaces
are fixed — any engine move on them is reverted and the residue
re-reported in the row's readout (marks ratios + APCA Lc), never silently
painted. Anchors (the pasted swatches) are inviolate.

**Solved anchors** (the selftest gate proves all three presets clear every
pair — AA by construction, hue kept or polarity-flipped):
Mystic Evening `#B75D69 → dark #C56975 / light #BC757D` ·
Earthy Green `#84A98C → #84A98C / #75927B` ·
Light Steel `#343A40 → polarity-flipped to the light end / #909295` (a
near-black anchor cannot read on near-black surfaces; the engine's flip
law answers it, exactly as designed).

## Consumers

`prism` reads the accent from the palette state first, then the live
painted token (which now carries the SOLVED accent — prefer that).
`pairing`'s theme relay parses the palette state's `accent`. The Editor
font row rides unchanged (order 10; the palette row owns order 0).

## The remnant sweep (2026-09-11, same day)

The first pass left stale surfaces. Swept, each with a selftest pin:

- **Scrollbars** — `--dsw-alias-scrollbar-*` resolve through the PLAIN
  `--dsw-static-neutral-*` ramp (light 200/300, dark 550/600/700), the one
  ramp `paintRamps` never touched; bars stayed stock gray mid-palette.
  `paintRamps` now washes those stops (+ 850, dark bg-multi-select) with
  the same 10% accent-over-stock formula. Lens-proven: after picking Earthy
  Green, the alias at the app host computes
  `color-mix(in oklab, 84a98c 10%, #545557)`.
- **Brand stylesheet (plugins/brand)** — the MOSS block re-defaulted the
  whole ramp to legacy cyan `#0EBAE4`, so boot (and any pre-paint window)
  flashed cyan. It now defaults to Mystic Evening SOLVED
  (`#C56975`/`#BC757D`, engine-verified) + the rose wash, and gained
  `blue-50p`. Zero `0EBAE4/0EE4E0/08336F` literals remain.
- **Favicon** — static cyan SVG → rebuilt per palette: top = the painted
  500 stop (always a plain hex), bottom/glyph computed by importing the
  ONE engine (`mixOklab` with the ramp's own 800/400 formulas). Refresh on
  cross-tab `storage` + refocus. Lesson baked in: a CSSOM `var()` probe
  (`el.style.background='var(--x)'` + computed read) does NOT substitute in
  WebKit-class engines — lens-proven transparent; compute, don't probe.
- **Waiting-page boot logo** — host reads `$ARXA_HOME/theme-palette.json`
  (the theme-accent store contract) and swaps the SVG's cyan stops for the
  accent family (sRGB-blend approximations for derived stops — the oklab
  solve is client-only; default = the exact Mystic SOLVED literals).
- **prism fallbacks** — gradient fallback hexes + the pre-paint seed rgb
  were cyan; now Mystic defaults.
- **Native focus rings** — the settings modal's autofocus X wore the
  platform-blue ring (the last cyan in the vision sweep). Global
  `:focus-visible { outline-color: var(--dsw-alias-state-business-primary) }`
  — contract-backed: rings are the SC 1.4.11 non-text case the pair set
  already gates.

Deliberately kept: `provider-status` hexes (semantic status scale —
5h/7d age colors, not accent) and the `arxa-brand-logo.svg` source file
(cyan is the corporate mark; every SERVE path tints it).

## The 0.3.2 fix (2026-09-11, user-reported breakage + the placeholder)

**The break** (palette `000814-001d3d-003566-ffc300-ffd60a`): `autoAccent`
returns the raw swatch — bare, lowercase. When the solve has no reason to
move the dark accent (yellow already clears every dark pair) it passes
through **verbatim** → `paintRamps` wrote `--dsw-static-deepseek-500:
ffd60a` — an invalid CSS color → every accent use-site computed to
invalid and the app broke. The earlier spikes stayed green by luck AND by
leak: presets' anchors got moved by the solve (which re-emits `#`-hex),
and assertions read the inline style STRING (which stores invalid values
fine) while the browser silently fell back.

Fix: `withHash()` at every paint boundary — `solveStudio` normalizes the
anchor at entry, the polarity `alt` returns a paintable hex, the offline
fallback paints `withHash(anchor)`. Gated three ways: selftest mirror fed
the RAW anchor must emit `#`-hexes for every preset + the user's palette
(the paintability gate), source pins on each call site, and the live
spike now asserts `^#…$` tokens (not substring matches).

Also fixed from the same incident: the coolors name fetch caught the
page's generic "Palette" heading as a name → `GENERIC_NAMES` stop-list at
fetch AND store boundaries, and the client's `validState` drops it (the
user's stored `"name": "Palette"` heals to "Custom" on next converge).

**The placeholder** (operator): the 4th slot is now ALWAYS present — a
dashed "Custom" card ("paste a coolors URL below") when no custom is
active, focusing the input on click/Enter; it becomes the real card the
moment a custom palette is applied.

## The deselect race (0.3.3, 2026-09-12, user-reported)

"Select a palette → it deselects." Live-reproduced first: with the custom
stored server-side, picking Earthy Green flipped the row BACK to Custom for
~4 s, then re-selected Earthy when the pick's PUT finally landed.

**Root cause (both ends):** the host's `store.write` persisted the file
only AFTER the best-effort coolors name fetch (up to its 6 s timeout) — so
every GET in that window answered the PREVIOUS palette, and the client's
5 s convergence poll (or a forced visibilitychange pass) converged the old
choice straight back over the fresh pick. Secondary catch from the same
repro: `converge` early-returned on palette+accent equality, so a fetched
coolors name NEVER reached the row (customs read "Custom" forever).

**Fix:** the choice hits the disk BEFORE any network (name fills in after,
guarded by a read-back so a late name can never clobber a newer palette);
the client tracks the pick's in-flight PUT (`landing`) and `converge`
refuses GETs that predate it; a name-only delta now adopts into the row
without a repaint. Proven live: seeded server with the custom → picked
Earthy → forced convergence passes → 14 samples over 7 s all Earthy
selected + `#84A98C`, PUT lands in ~1.5 s with the file already readable.

**Lens lesson (cost an hour):** a passing `--expect` prints NOTHING — only
failures print. A settle complaint alone (the waiting page's SMIL logo
looping) with no `expect not truthy` line is a PASS, not a swallowed run;
`check` always evaluates the expect, settle-fail only adds its own failure.
Also: a plugin edit re-keys the engine payload dir, so every scratch boot
after an edit re-materializes cold (~4 min measured) — don't chase ghosts
in that window.

## 0.3.4: the row's controls speak dsh's own recipes

The Default/Fira Code pills and the Add button were hand-rolled shapes.
Re-measured from the shipped CSS and re-authored on the app's own tokens:
pill = `_pill_e3ygd_1` (h24, r12, p0 8, bg-layer-2, label-secondary,
hover interactive-bg-hover), selected pill = `_active_e3ygd_23`
(ghost-active-fill + inset 1px ghost-active-border + label-primary), Add =
the primary button (`_primary_cfgyt_38`: button-primary-fill +
label-primary-foreground, hover primary-hover, active interactive-bg-active).
Note the app's dark-theme primary is a WHITE fill (brand-primary =
neutral-bluish-50) — that is dsh's language, and it rides the palette wash.
Verified by cropped-screenshot vision (full-shot vision misreads tiny
glassy controls — crop before trusting it).

## 0.2.0 personalisation: the Appearance row moves in (2026-09-12, operator)

"The Appearance section in Settings > General must move to Personalisation,
at the top, above the color palettes." The row is dsh's own feature
(`dsh-client-ui-theme` registers id `appearance` into `settings.general.item`)
— the move rides three of its published seams, nothing hand-rolled:

- **The shadow (General loses the row).** The list-slot law, straight from
  the runtime's own error text (read in `dsh-web-frontend` dist): same id at
  the same `priority` **throws**; at a *different* priority it shadows, and
  **lowest renders**. `order` is NOT priority — the shipped row sits at
  order 10 / priority 0; our null renders at order 9 / `priority: -1`.
  First attempt (same priority) threw on modal-open and tore the plugin's
  fiber down — the lens caught it as a console error plus the whole section
  going missing. Priority is the knob.
- **The row (Personalisation gains it, at the top).** Registered into
  `settings.personalisation.item` at order -10 — above the Palette row's 0.
  It speaks ui-theme's published service contract verbatim: reads via
  `getTheme()`, writes via `setTheme(id)` ('light'|'dark'|'system'), live
  sync via the `theme/change` event (snapshot carries preference/revision/
  fontSize). The cubes are ui-theme's own AppearanceRow.module.css recipe
  copied verbatim (r20 cubes, flex-basis 180, selected =
  bg-module-platform + neutral-bluish-400 ring) + its own icons
  (`Icon{Light,Dark,Followsystem}Outline16` from dsh-client-ui-primitives —
  browser-runtime-only package; drift-gated in the selftest against
  ui-theme's bundle as the mirror).
- **The read-timing lesson (cost one spike).** `ctx.get('theme')` at APPLY
  time answered undefined — ui-theme provides the service after our plugin
  applies — and the row rendered null forever while General's shadow worked.
  The service is read AT RENDER TIME now; the modal opens long after boot.

Lens-proven live (scratch boot, 1280×832): General shows 0 cubes + keeps
its Font size row; Personalisation stacks Appearance → Palette → Editor
font; Dark applies `body[data-ds-dark-theme]`, Light reverts, aria-pressed
follows; vision on the capture confirms the filled+ringed selected cube.
Labels stay EN like the rest of the tab (the tab-wide en/pl/fr rider
below covers them). Selftest: `plugins/personalisation/selftest.mjs`
(first one the plugin ever had — CI auto-discovers it).

**0.2.1: Font size follows (same day, "3rd row not 2nd").** The Font size
row (ui-theme id `font-size`, order 11 in General) moves to the THIRD seat
— order 5, below the Palette row's 0, above Editor font's 10 — same two
seams as Appearance: a priority -1 null shadow in General, the real row
here. The row is ui-theme's FontSizeRow.module.css recipe verbatim (r18
stepper pill 72×36, tabular-nums value, hover/focus-within-revealed 17×12
chevron arrows, disabled dims to label-caption) + its own
`Icon{ChevronUp,ChevronDown}Outline14` icons, `size: 9`. Same service
contract: `getTheme().fontSize` reads, `setFontSize(px)` writes (the
runtime's own 12..17 integer bounds also gate the buttons' disabled
states), `theme/change` syncs. Lens-proven live: General shows no Font
size row and no stepper; the stack is Appearance → Palette → Font size →
Editor font (vision-confirmed); stepping up lands `14 → 15` in the readout
AND `--dsh-content-font-size: 15px` on body, stepping down restores 14.

## Verification

- `plugins/theme-accent/selftest.mjs`: the Dart suite ported (ratios,
  OKLCH roundtrip, the three solve phases, all-pairs convergence, soft
  alpha), the store (2–10 bounds, junk, name fill incl. throwing fetcher),
  both routes (D84 single registration, engine route byte-identity), the
  client contract pins, and the **AA-by-construction gate** — every preset
  found in the shipped source is solved through the mirrored contract and
  must clear every pair. `node scripts/ci.mjs` ALL GREEN.
- Localization rider: the row ships EN strings, matching the
  Personalisation tab it lives in (the tab header itself is EN today);
  the en/pl/fr pass should cover the whole tab when it happens, not this
  row alone.

## 0.3.5: the ink wash doubles (operator: "raise it", 2026-09-12)

Follow-up to the dashboard theme-consolidation round: offered the knob,
operator took it. The label-ink stops of the 19-stop neutral wash fold the
accent at **20%** (was 10%) — surfaces keep 10% (scope A: depth never
moves). Measured label-alias→stop map drove the set (light
primary/secondary/tertiary/caption/dimmed = 1000/700/600/400/200, dark =
50/300/400/600/750): `INK_STOPS = {50,200,300,400,600,700,750,1000}`,
`INK_MIX = 20`, `mixFor(stop)` used in BOTH the inline painter and
solveStudio's washed map so the contrast readout describes what paints.
Under sage #84A98C: light body ink ≈ oklab L .28 (≈12:1 on the .94 bg —
AA body holds with margin); every built-in + the nasty custom still solve
(selftest 4b gate, ALL GREEN). Pins: INK constants, the per-stop mix in
both loops. Shipped `arxa-theme-accent: 3fb06df65504 → 223b45b57ec9`.
A light-anchor custom palette could someday push the light body pair
under 4.5 at 20% — the solve reports it honestly in the row readout
(locked scope-A behavior: labels never move, residue is never silent).

Operator correction, same day: 20% read loud ("too much — lower to a
strict minimum"). **0.3.6: INK_MIX = 15** — the smallest step above the
10% that read un-themed black. Pins + mirror updated; shipped
`223b45b57ec9 → fc7374a3a793`.
