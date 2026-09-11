// Browser half of arxa-prism — step 3 of the prism background field: the
// FULL WALL. Hand-written in the __ModuleLoader__ factory shape every dsh
// client bundle uses (same pattern as arxa-brand / arxa-theme-accent).
//
// THE FEATURE (grilled and confirmed with the operator):
//   The whole conversation scrollport background is filled with a grid of
//   glued 100x100 squares (auto-grown on giant screens past a 400-square
//   cap), each split by the top-right -> bottom-left diagonal into two
//   stroke-less triangles. Squares are keyed by grid coordinate, so window
//   resizes never reshuffle a square's identity — the wall just grows or
//   trims at the right/bottom edges (ResizeObserver-driven regen).
//
// THE MOTION MODEL (grilled 2026-09, "organic it is" + step-3 wall
// character locked as "rolling swell x mosaic WITHOUT hue offset"):
//   - EVERY triangle runs a breath oscillator: h/s/l oscillate as sines
//     around the seed with small amplitudes and its own rolled period
//     (9-20s) kept FOREVER as that triangle's jitter factor.
//   - MOSAIC (per-square tonal identity, hue untouched): each square rolls
//     once and keeps a permanent saturation offset (+/-8), lightness offset
//     (+/-10) and breath-depth scale (0.6..1.2, s/l amps only). The wall
//     reads as a tonal tapestry of the ONE accent family — the locked hue
//     discipline (worst case 8 deg: 6 amp + 2 drift) is sim-proven across
//     all three swatch seeds and every slider position.
//   - ROLLING SWELL: the shared drift field carries a spatial wavevector
//     (0.35 rad/square diagonal), so a broad swell ROLLS corner-to-corner
//     across the wall instead of pulsing in lockstep. Drift phase is
//     INTEGRATED (advanced by dt, never read from absolute time), so a
//     hidden-tab gap pauses the whole organism — no refocus teleport.
//   - The two halves of ONE square start ANTI-PHASE; differing periods let
//     them wander apart organically over time.
//
// THE RATE CONTROL (step 2c, unchanged contract): Settings > Personalisation
// "Breathing rate" slider, log 3.5s..60s of average breath, center = the
// natural tempo bit-for-bit (scale EXACTLY 1 at t=0.5). Phase-integrator +
// 300ms tempo chase = no jitter or sudden jump ever; per-triangle period
// clamps to [3.5s, 60s]; drift and mosaic stay unscaled (the wind current,
// not the breath). localStorage 'arxa.prismBreath', local-only.
//
// PERF: writes are QUANTIZED — the css string is compared against the last
// written value per triangle and setProperty is skipped when the rendered
// 0.1-resolution value has not changed (big win at slow tempos). Pure math
// for 1200 triangles benchmarks at ~0.16ms/frame (node sim); the loop is
// rAF-driven and freezes under prefers-reduced-motion.
//
// THE LENS-PROVEN LESSON (2026-09): the first cut derived colors with
// relative color syntax — `hsl(from var(--seed) calc(h + var(--shift)) ...)`.
// Chrome computes `hsl(from var(--p) h s l)` fine, but ANY calc() inside the
// relative-color components is INVALID AT COMPUTED VALUE TIME, so the whole
// background shorthand collapsed to background-image: none — an invisible
// square, in every engine (arxa-lens probe evidence, designs/prism-step1/
// evidence/lens/). The fix stands: the browser only ever sees PLAIN
// `linear-gradient(135deg, hsl(a) 50%, hsl(b) 50%)` layers — universally
// valid — while JS owns the seed reading, oscillator math and writing.
//
// HOW IT WORKS
//   - SINGLETON (locked invariant, 2026-09): the whole organism lives in ONE
//     app-lifetime stage layer ([data-arxa-prism-stage]) hosted by the
//     nearest positioned ancestor of the conversation scrollport (arxa's
//     frame) and rect-tracked to the conversation box every frame. React may
//     remount the scrollport on any navigation — the wall never remounts,
//     never gaps, never double-runs. The stage box is the scrollport's
//     BORDER box, so a classic-scrollbar lane is covered by construction.
//   - One hard-stop linear-gradient BACKGROUND LAYER per square on the wall
//     element ([data-arxa-prism-wall], first stage child), positioned at its
//     grid offset and pinned to the square size, no-repeat. The per-triangle
//     color vars are set on the stage and INHERIT down. On a square, a
//     135deg gradient's 50% stop is exactly the TR -> BL corner diagonal;
//     45deg is its TL -> BR mirror. The wall rides its own element so the
//     mosaic gets a TRUE opacity of its own — element opacity composites
//     over the stock surface, which a background image can never do.
//   - FLIP (Truchet, locked): a square travels between the two diagonals by
//     DISSOLVE-THROUGH-UNITY — both halves ease to their instantaneous
//     midpoint, the gradient angle snaps while the square is uniform
//     (invisible), then the halves exhale into the mirrored variant. An
//     envelope over the breath oscillators; theta is never touched.
//   - FROST: the second stage child ([data-arxa-prism-frost]) carries
//     backdrop-filter blur+saturate and a translucent tint — dark smoky veil
//     under body[data-ds-dark-theme], milky veil in light, crossfading on
//     flips — plus its own opacity var. The scrollport's parent (the only
//     occluder) is punched transparent via :has(); the frame below paints
//     the same surface token, so off/non-chat surfaces stay exactly stock.
//     Text stays crisp above the glass; the breath reads through as soft
//     diffused waves.
//   - The SEED is the live studio accent: the exact swatch hex chosen in the
//     theme-accent settings row — read from localStorage('arxa.themeAccent')
//     with the inline <body> var --dsw-static-deepseek-500 as fallback.
//     (Never the alias tokens: they are color-mix TINTS whose computed color
//     serializes as oklab(...), unparseable, and cyan-fallback was the bug.)
//     A MutationObserver on <body> plus the 1.5s heal interval re-resolve
//     the seed on every accent pick — every oscillator's CENTER glides to
//     the new family over 4-7s (phases continue; no snap) and the seed
//     ALWAYS syncs because the seed IS the theme's own accent. Squares
//     created later by a resize seed directly (nothing to glide from).
//   - prefers-reduced-motion freezes the oscillators (colors still live,
//     motion gone).

window.__ModuleLoader__.load({
  id: 'arxa-prism',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement

    // Confirmed breath envelope (operator, 2026-09): amplitudes +/-6 (the
    // +/-12 hue window read as "too large"; sat/lit tightened to match).
    // Per-triangle period rolls 9-20s ONCE and stays as the jitter factor.
    const ROLL_MIN = 9000, ROLL_MAX = 20000 // ms — per-triangle period roll
    const AMP_H = 6  // deg — hue breath amplitude ceiling (per-triangle roll 3..6)
    const AMP_S = 6  // saturation points
    const AMP_L = 6  // lightness points
    // Rolling swell: tile-wide drift sines with a spatial wavevector, so the
    // swell rolls across the wall diagonally instead of pulsing in lockstep.
    const DRIFT_H = 2, DRIFT_T_H = 53000
    const DRIFT_L = 2, DRIFT_T_L = 67000
    const SWELL_KX = 0.35, SWELL_KY = 0.35 // rad of phase per grid step
    // Mosaic (locked: NO hue component): per-square tonal identity.
    const MOSAIC_S = 8, MOSAIC_L = 10
    const AMP_SCALE_MIN = 0.6, AMP_SCALE_MAX = 1.2
    // Wall geometry: 100px squares; grow the square past a 400-square cap on
    // giant screens rather than letting the layer count run away.
    const SQ_BASE = 100, MAX_SQUARES = 400

    // Truchet flip (locked spec, 2026-09): a square travels between the two
    // diagonal variants (135deg TR-BL <-> 45deg TL-BR) by DISSOLVE-THROUGH-
    // UNITY — never rotation: both halves ease (smoothstep) from their live
    // breath state to their INSTANTANEOUS MIDPOINT, hold solid for a beat
    // (the gradient angle snaps while the square is uniform — invisible),
    // then exhale into the mirrored variant. The dissolve is an ENVELOPE over
    // the two breath oscillators: theta and periods are never touched, so a
    // flip can never teleport and flips can interrupt flips. Every square
    // rolls its own dwell (60-180s, locked) — ~3% of the wall is mid-flip at
    // any moment: a living Truchet field, perpetual, never repeating.
    const FLIP_IN_MS = 2000   // converge to unity
    const FLIP_HOLD_MS = 600  // held solid — the invisible snap window
    const FLIP_OUT_MS = 2000  // exhale into the mirrored diagonal
    const FLIP_ROLL_MIN = 60000, FLIP_ROLL_MAX = 180000 // dwell roll between flips

    // Stroke mode (locked): the same two-tone layers clipped by a mask to a
    // band around each square's divide — a field of floating Truchet lines.
    // The mask consumes the SAME per-square angle var as the fill, so a
    // flip's invisible snap re-orients both in the same instant; breath
    // rides the same color vars. Width never animates.
    const STROKE_KEY = 'arxa.prismStroke' // '0'/'1' — fill (default) | stroke
    // Band weight PROPORTIONAL to the tile (research-locked): pro Truchet
    // strokes run ~5-12% of tile; our fixed 2.5% hairline lost >50% of its
    // energy to anti-aliasing and read as "disappearing". 5% = 5px on a
    // 100px square, 10px on a 2x block — the line-weight hierarchy.
    const STROKE_BAND_PCT = 0.05
    // Stroke color discipline (0.5.1, diagnosis-locked): a LINE field reads
    // through UNIFORMITY OF THE MARK — variety lives in the pattern
    // (orientation/scale/spacing), never in per-line brightness. Fill's wide
    // tonal identity (lOff ±10, ampL to 7.2) let each hairline scintillate
    // on its own oscillator and sink below perceptual threshold = the
    // "random broken line" strobing. In stroke mode: compress the L identity
    // spread and L breath depth, keep hue/sat breath FULL (the living part),
    // and clamp L into a figure-ground band held clear of the surface.
    const STROKE_LOFF_SCALE = 0.3  // ±10 -> ±3 identity spread on lines
    const STROKE_AMPL_SCALE = 0.35 // L breath depth on lines
    const STROKE_L_MIN_DARK = 42   // a line never sinks toward a dark surface
    const STROKE_L_MAX_LIGHT = 62  // a line never floats toward a light one
    // Dash-draw flips (0.6.0, research-locked): in STROKE mode the flip is
    // GEOMETRIC, not chromatic — the canonical SVG stroke-draw technique.
    // Instead of dissolving to color unity, the line RETREATS corner-to-
    // corner into its right-side corner (dir0: TR, dir1: BR), the angle
    // snaps while NOTHING is drawn (a truly invisible snap — no uniformity
    // needed), then the mirror line GROWS out of the same corner. Colors
    // never leave their breath path (flipMix is skipped for lines). The
    // window rides a per-tile occluder layer in the exact surface color:
    // a linear-gradient whose transparent window [0..q%] is the drawn
    // segment, animated by the --arxa-prism-d<key> var (0..100, idle 100).
    // The occluder axis is perpendicular to the fill axis with 0% at the
    // right-side corner: dir0 (135deg fill, TR-BL line) -> 225deg; dir1
    // (45deg fill, TL-BR line) -> 315deg. Fill mode never sees occluders —
    // its rule is bit-identical (framerate is sacred).

    // Multi-scale (research-locked): even-aligned 2x2 supercells roll ONCE
    // per coordinate into a single big tile — one giant diagonal with its
    // own breath/flip identity, its stroke band scaling with it (2x). The
    // signature "pro" Truchet look: a few big tiles among the small field.
    const BLOCK_P = 0.18 // supercell -> block probability (~4 blocks on 11x8)
    // Birth-variant jitter (0.6.1): checkerboard parity with this coin of
    // flipping — kills iid clumping without reading as a mechanical grid.
    const BIRTH_JITTER = 0.22

    // Frost (locked spec): true backdrop-filter glass over the wall, riding
    // as the stage's second child — the wall beneath is in its backdrop, the
    // message flow paints above it, so text stays crisp while the mosaic
    // melts behind the veil. Tint is pure CSS off body[data-ds-dark-theme]
    // and crossfades on theme flips.
    // Perf rule: framerate is sacred, radius is negotiable — if the measured
    // frame gap degrades, FROST_BLUR steps down, never the fps.
    const FROST_BLUR = 24 // px — medium frost: geometry melts, tiles survive
    const FROST_SAT = 1.25 // backdrop saturation: keeps the accent alive
    const FROST_TINT_LIGHT = 'rgba(255,255,255,0.42)' // milky veil
    const FROST_TINT_DARK = 'rgba(10,12,16,0.35)' // smoky veil
    const FROST_FADE_MS = 350 // theme-flip tint crossfade
    // Opacity controls (user request): one slider per layer. Each layer's
    // opacity is a var on the scrollport (inherited by the layer elements),
    // persisted local-only like the rate. 0 = the layer is simply gone —
    // wall at 0 additionally stops the loop (nothing visible to animate).
    const FROST_OP_KEY = 'arxa.prismFrostOp' // '0'..'1' — glass veil opacity
    const WALL_OP_KEY = 'arxa.prismWallOp' // '0'..'1' — mosaic opacity
    const frostCssText =
      // The occluder: the scrollport's parent paints the conversation surface.
      // Punch it transparent (hash-immune :has beats the module class); the
      // frame below paints the SAME surface token, so the off state and every
      // non-chat surface look exactly stock.
      'div:has(> [data-conversation-scroll]){background:transparent !important}' +
      // The singleton stage: one app-lifetime layer inside the nearest
      // positioned ancestor of the scrollport (arxa frame), rect-tracked to
      // the conversation box. Wall and frost ride as its two children — the
      // organism never remounts, never gaps, whatever React does above it.
      '[data-arxa-prism-stage]{position:absolute;pointer-events:none;' +
      'overflow:hidden;z-index:0}' +
      // The mosaic wall: fills the stage; per-triangle color vars inherit.
      '[data-arxa-prism-wall]{position:absolute;inset:0;' +
      'opacity:var(--arxa-prism-wall-op,1);' +
      'transition:opacity 250ms ease}' +
      '[data-arxa-prism-frost]{position:absolute;inset:0;' +
      '-webkit-backdrop-filter:blur(' + FROST_BLUR + 'px) saturate(' + FROST_SAT + ');' +
      'backdrop-filter:blur(' + FROST_BLUR + 'px) saturate(' + FROST_SAT + ');' +
      'background-color:' + FROST_TINT_LIGHT + ';' +
      'opacity:var(--arxa-prism-frost-op,1);' +
      'transition:background-color ' + FROST_FADE_MS + 'ms ease,opacity 250ms ease}' +
      'body[data-ds-dark-theme] [data-arxa-prism-frost]{' +
      'background-color:' + FROST_TINT_DARK + '}' +
      // Master switch off: wall and frost both fade out (specificity 0,2,1
      // beats the base rules and any user-set opacity var) — plain surface.
      'body[data-arxa-prism-off] [data-arxa-prism-wall]{opacity:0}' +
      'body[data-arxa-prism-off] [data-arxa-prism-frost]{opacity:0}' +
      '@media (prefers-reduced-motion:reduce){' +
      '[data-arxa-prism-wall]{transition:none}' +
      '[data-arxa-prism-frost]{transition:none}}'

    // Rate control (locked spec): log slider of AVERAGE breath; geometric
    // middle == the natural tempo, so the shipped default (t=0.5, scale
    // exactly 1) changes nothing at all. Fast end 1.5s (user request,
    // 0.6.1): a literal 0 would divide by zero in TAU*dt/period — 1.5s is
    // the energetic floor, still a smooth sine, never a strobe.
    const RATE_KEY = 'arxa.prismBreath'
    const RATE_MIN = 1500, RATE_MAX = 60000 // ms — slider travel (average breath)
    const NATURAL = Math.sqrt(RATE_MIN * RATE_MAX) // 9486.8ms — center detent
    const P_MIN = 1500, P_MAX = 60000 // per-triangle period clamp: 60s max is literal
    const CHASE_MS = 300  // tempo chase time constant — velocity never jumps
    const DT_MAX = 100    // ms — per-frame dt clamp: breath never teleports
    // Stall immunity (0.8.0, ring-proven: the app stalls the rAF loop 1-2.4s
    // on a ~60s cadence; the hard DT_MAX clamp turned every stall into a
    // visible 2s freeze = the user's "stopping and starting over"). Classic
    // animation-clock catch-up: time lost past DT_MAX accrues as DEBT and is
    // repaid gradually at +33% speed (dt*4/3 per frame), so a 2s stall is
    // absorbed as a gentle ~6s hurry instead of a freeze — the SAME
    // integrator advances, position stays continuous, nothing teleports.
    // Debt is hard-capped (2.5s) and FORGIVEN on visibility flips: a hidden
    // tab still pauses the organism and resumes seamlessly, never hurries.
    const DEBT_MAX = 2500   // ms — beyond this, resume in place (occlusion)
    const DEBT_RATE = 1 / 3 // extra dt per frame while repaying (~6s per 2s)

    // Master switch (user request): a Settings > Personalisation toggle, default ON.
    // Off suppresses the wall layers AND the frost (frost without the mosaic
    // is a bare veil) and stops the rAF loop — zero cost, plain studio
    // surface. Same local-only persistence precedent as the rate; the frost
    // veil's 250ms opacity fade smooths the cut both ways; phases hold while
    // off, so re-enabling resumes the breath exactly where it paused.
    const ENABLED_KEY = 'arxa.prismEnabled' // '0' = off, anything else = on

    // Randomness seed (user request, 0.7.0): a Background-group slider,
    // integer 0..999. A seed re-rolls every square's/triangle's RANDOM
    // IDENTITY (period, amps, mosaic tone, diagonal variant) from a
    // deterministic PRNG — slide to remix, a number replays the same
    // field. Phases (theta) are NEVER re-rolled (the integrator invariant:
    // nothing teleports); variant changes travel through the normal flip
    // dissolve, staggered under a second; tone re-rolls land under the
    // same 280ms wall dip as the stroke toggle. Absent key = boot-random
    // (today's behavior); once touched, fields are seed-reproducible.
    const SEED_KEY = 'arxa.prismSeed' // int string '0'..'999'
    // mulberry32: tiny deterministic PRNG — same seed, same field, anywhere.
    function mulberry32(a) {
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    }

    const rand = (min, max) => min + Math.random() * (max - min)
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
    const smooth = (t) => t * t * (3 - 2 * t) // smoothstep — seamless, no snap
    const TAU = Math.PI * 2

    // Hue is a polar angle (MDN <hue>: 0-360 around the wheel, 0 == 360), so
    // every hue comparison goes through circular distance and every hue write
    // wraps — oscillation near 0deg reaches across the seam instead of
    // clamping into a pile-up.
    const wrapH = (h) => ((h % 360) + 360) % 360
    const hueDist = (a, b) => {
      const d = Math.abs(wrapH(a) - wrapH(b))
      return Math.min(d, 360 - d)
    }
    const shortDelta = (from, to) => {
      let d = wrapH(to) - wrapH(from)
      if (d > 180) d -= 360
      if (d < -180) d += 360
      return d
    }

    // ---- rate state ---------------------------------------------------------
    // t===0.5 returns EXACTLY 1: the exp/log round-trip gives 1±1ulp, and the
    // row's magnetic detent makes t literally 0.5 — so center is bit-for-bit
    // the natural animation (grilled requirement: default changes nothing).
    const scaleFromT = (t) => t === 0.5 ? 1 :
      Math.exp(Math.log(RATE_MIN) + t * (Math.log(RATE_MAX) - Math.log(RATE_MIN))) / NATURAL
    const avgFromT = (t) => t === 0.5 ? NATURAL :
      Math.exp(Math.log(RATE_MIN) + t * (Math.log(RATE_MAX) - Math.log(RATE_MIN)))

    function storedT() {
      try {
        const v = parseFloat(localStorage.getItem(RATE_KEY))
        return isFinite(v) ? clamp(v, 0, 1) : 0.5
      } catch { return 0.5 }
    }

    let rateT = storedT()               // slider position 0..1 (center = natural)
    let targetScale = scaleFromT(rateT) // where the tempo is headed
    let scale = targetScale             // where it is NOW — boot restores
                                        // instantly (no chase, no tempo flash)

    function setRateT(t, persist) {
      rateT = clamp(t, 0, 1)
      targetScale = scaleFromT(rateT)
      if (persist) {
        try { localStorage.setItem(RATE_KEY, String(rateT)) } catch { /* cache lost, anim still retunes */ }
      }
      kick()
    }

    // ---- enabled state (master switch) --------------------------------------
    function storedEnabled() {
      try { return localStorage.getItem(ENABLED_KEY) !== '0' } catch { return true }
    }
    let enabled = storedEnabled()

    // The off state lives as a <body> attribute so CSS alone fades the wall
    // and frost out (higher-specificity opacity:0 overrides any user var) —
    // no layer rebuild, no DOM churn, instant either way.
    function syncOffAttr() {
      if (enabled) document.body.removeAttribute('data-arxa-prism-off')
      else document.body.setAttribute('data-arxa-prism-off', '')
    }

    function setEnabled(v, persist) {
      enabled = !!v
      if (persist) {
        try { localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0') } catch { /* anim follows anyway */ }
      }
      syncOffAttr()
      if (enabled) {
        // Colors are time-based, so this repaints the CURRENT breath state
        // instantly — no fade-in from stale hues, no phase jump on resume.
        const now = performance.now()
        fixStage(true)
        ensureGrid(now)
        writeAll(now)
      }
      kick()
    }

    // ---- opacity state (frost veil + mosaic wall sliders) --------------------
    // Same local-only contract as the rate: default 1 (changes nothing), live
    // var writes for instant preview, cross-window storage sync in apply().
    function storedOp(key) {
      try {
        const v = parseFloat(localStorage.getItem(key))
        return isFinite(v) ? clamp(v, 0, 1) : 1
      } catch { return 1 }
    }
    let frostOp = storedOp(FROST_OP_KEY)
    let wallOp = storedOp(WALL_OP_KEY)

    // The vars live on the stage so both layer elements inherit them;
    // re-applied on every (re)mount so nothing ever drops a user's setting.
    function applyOpacityVars() {
      if (!stageEl) return
      stageEl.style.setProperty('--arxa-prism-frost-op', String(frostOp))
      stageEl.style.setProperty('--arxa-prism-wall-op', String(wallOp))
    }

    function setFrostOp(v, persist) {
      frostOp = clamp(v, 0, 1)
      if (persist) {
        try { localStorage.setItem(FROST_OP_KEY, String(frostOp)) } catch { /* veil still follows */ }
      }
      applyOpacityVars()
    }

    function setWallOp(v, persist) {
      wallOp = clamp(v, 0, 1)
      if (persist) {
        try { localStorage.setItem(WALL_OP_KEY, String(wallOp)) } catch { /* wall still follows */ }
      }
      applyOpacityVars()
      kick() // wall 0 stops the loop; dragging back above 0 resumes seamlessly
    }

    // ---- stroke mode (diagonal band vs filled halves) -----------------------
    // Same local-only contract as the other prefs. The mode is a stage
    // ATTRIBUTE so CSS alone swaps the mask — layers, breath vars and flips
    // are identical either way (animation parity, locked).
    function storedStroke() {
      try { return localStorage.getItem(STROKE_KEY) === '1' } catch { return false }
    }
    let strokeOn = storedStroke()

    function applyStrokeAttr() {
      if (!stageEl) return
      if (strokeOn) stageEl.setAttribute('data-arxa-prism-stroke', '')
      else stageEl.removeAttribute('data-arxa-prism-stroke')
    }

    function setStroke(on, persist) {
      on = !!on
      if (on === strokeOn) return
      strokeOn = on
      if (persist) {
        try { localStorage.setItem(STROKE_KEY, on ? '1' : '0') } catch { /* mode still follows */ }
      }
      // Fade-through-out (locked): dip the wall, swap the mask at the bottom
      // of the dip, fade back — the wall never snaps between fill and stroke.
      // When the wall is invisible anyway (off / opacity 0 / reduced motion
      // kills the transition) the swap is instant; a dip would be pure cost.
      if (!wallEl || !enabled || wallOp <= 0 || reducedMotion()) { applyStrokeAttr(); return }
      wallEl.style.opacity = '0'
      setTimeout(() => {
        applyStrokeAttr() // reads the LATEST strokeOn — rapid re-toggles converge
        wallEl.style.opacity = ''
      }, 280)
    }

    // ---- color plumbing ----------------------------------------------------
    // The accent is chosen in theme-accent's swatch row (three fixed hexes):
    // cached in localStorage('arxa.themeAccent') and written inline on <body>
    // as --dsw-static-deepseek-500 (TINTS[500] = the raw hex). Reading EITHER
    // gives the exact accent with zero color parsing.
    //
    // WHY NOT the alias token: --dsw-alias-brand-primary is a 10% color-mix
    // TINT of the accent, and per css-color-5 its computed color serializes
    // in the interpolation space (probe-verified: oklab(...), not rgb()) —
    // regex parsing silently failed and the old seed fell back to hardcoded
    // cyan forever, never syncing to the picked accent. Hex or bust.
    function hexToRgb(hex) {
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec((hex || '').trim())
      return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null
    }

    function rgbToHsl(r, g, b) {
      r /= 255; g /= 255; b /= 255
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      const l = (max + min) / 2
      let h = 0, s = 0
      if (max !== min) {
        const d = max - min
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0))
        else if (max === g) h = (b - r) / d + 2
        else h = (r - g) / d + 4
        h *= 60
      }
      return { h, s: s * 100, l: l * 100 }
    }

    const cssColor = (c) =>
      'hsl(' + wrapH(c.h).toFixed(1) + ', ' + clamp(c.s, 0, 100).toFixed(1) + '%, ' +
      clamp(c.l, 0, 100).toFixed(1) + '%)'

    // ---- seed + wall state ---------------------------------------------------
    let seed = null       // { h, s, l } — the live accent, re-resolved on theme flips
    let mountedEl = null  // the live [data-conversation-scroll] — the stage's rect source
    const squares = new Map() // 'gx,gy' -> 1x square record (identity survives resizes)
    const blocks = new Map() // 'gx,gy' (top-left) -> 2x2 block record (scale 2)
    const blockRolls = new Map() // supercell 'gx,gy' -> permanent block decision
    const covered = new Set() // 'gx,gy' keys a block owns — smalls never born there
    let gridCols = 0, gridRows = 0, gridSq = SQ_BASE
    let baseStyle = null
    let frostStyle = null
    let stageEl = null    // the singleton stage: app-lifetime wall+frost host
    let stageHost = null  // positioned ancestor currently hosting the stage
    let wallEl = null     // the mosaic layer (stage child)
    let frostEl = null    // the glass layer (stage child)
    let stageRect = { l: -1, t: -1, w: -1, h: -1 } // last written stage box
    let stageVisible = false // conversation box present — loop gate

    // Reset/jank evidence ring (0.7.2, user report "the wall resets itself —
    // stops and starts over"): transition-only events (boot, loop stop with
    // reason, loop start, stage hide/show with reason, grid rebuild, rAF gap
    // >750ms, visibility flips) persisted to localStorage so the REAL
    // window's history survives reloads and can be read from the WebKit
    // store afterwards. Cap 60, persist throttled to 1/s + a pagehide flush
    // — zero per-frame cost. Read-only diagnostics, like __arxaPrismDebug.
    const EVENTS_KEY = 'arxa.prismEvents'
    let events = []
    try {
      const parsed = JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]')
      if (Array.isArray(parsed)) events = parsed.slice(-60)
    } catch { /* storage blocked — ring stays memory-only */ }
    let evLastPersist = 0
    function persistEvents() {
      try { localStorage.setItem(EVENTS_KEY, JSON.stringify(events)) } catch { /* full/blocked */ }
    }
    function logEvent(e, detail) {
      events.push({ t: Date.now(), e: detail ? e + ':' + detail : e })
      if (events.length > 60) events.splice(0, events.length - 60)
      const n = Date.now()
      if (n - evLastPersist > 1000) { evLastPersist = n; persistEvents() }
    }
    window.addEventListener('pagehide', persistEvents)
    document.addEventListener('visibilitychange', () => {
      logEvent('vis', document.hidden ? 'hidden' : 'visible')
      // Occlusion forgiveness (0.8.0): a hidden tab pauses the organism and
      // resumes IN PLACE — the stall debt is forgiven, never hurried back.
      if (!document.hidden) debt = 0
    })

    // The dash-draw occluder needs the EXACT surface color behind the wall
    // (an oklab/color-mix string is fine — it is handed straight back to
    // CSS, never parsed). Walk up from the stage host past punched-
    // transparent ancestors to the first real background; resample on host
    // swaps and theme flips. Fallback follows the theme attribute.
    function sampleSurface() {
      if (!stageEl) return
      let el = stageHost || stageEl.parentElement
      let color = ''
      while (el && el !== document.documentElement) {
        const bg = getComputedStyle(el).backgroundColor
        if (bg && bg !== 'transparent' && !/^rgba\(0,\s*0,\s*0,\s*0\)$/.test(bg)) { color = bg; break }
        el = el.parentElement
      }
      if (!color) color = document.body.hasAttribute('data-ds-dark-theme') ? '#0d1014' : '#f4f5f7'
      stageEl.style.setProperty('--arxa-prism-surface', color)
    }

    // Pin the stage to the live conversation box (SINGLETON invariant: one
    // organism, zero reload across ANY navigation). The host is the nearest
    // POSITIONED ancestor of the current scrollport (arxa's frame — probe-
    // verified position:relative, and it paints the same surface token the
    // occluding root does); the stage box is the scrollport's border box
    // re-expressed in host coordinates — so it covers the classic-scrollbar
    // lane by construction (the 0.1.2 leak fix is now architectural).
    // 0.7.2 layout-thrash fix (web.dev "Avoid forced synchronous layouts"):
    // the breath frame calls this with hostWalk=false BEFORE its var writes
    // — pure geometry reads against the previous frame's clean layout, no
    // getComputedStyle walk, so the loop never forces a synchronous layout
    // the docs warn about. The host-position walk (getComputedStyle chain)
    // runs only on the mount/RO/heal paths (hostWalk=true). No scrollport
    // (trajectory, waiting room) or a detached one -> hide + the loop gate
    // closes.
    function hideStage(reason) {
      if (stageEl && stageVisible) {
        stageVisible = false
        stageEl.style.display = 'none'
        logEvent('hide', reason)
      }
    }
    function fixStage(hostWalk) {
      if (mountedEl && !mountedEl.isConnected) mountedEl = null
      const sp = mountedEl
      if (!sp || !stageEl) { hideStage('no-scrollport'); return }
      if (hostWalk || !stageHost) {
        let host = sp.parentElement
        while (host && host !== document.body && getComputedStyle(host).position === 'static') host = host.parentElement
        if (!host) host = document.body
        if (host !== stageHost) {
          stageHost = host
          if (stageEl.parentNode !== host) host.insertBefore(stageEl, host.firstChild)
          sampleSurface() // the occluder's erase color follows the host
        }
      }
      const r = sp.getBoundingClientRect()
      const hr = stageHost.getBoundingClientRect()
      const l = Math.round(r.left - hr.left), t = Math.round(r.top - hr.top)
      const w = Math.round(r.width), hgt = Math.round(r.height)
      if (!w || !hgt) { hideStage('zero-rect'); return }
      if (!stageVisible) {
        stageVisible = true
        stageEl.style.display = ''
        logEvent('show')
        kick()
      }
      const sr = stageRect
      if (l !== sr.l || t !== sr.t || w !== sr.w || hgt !== sr.h) {
        stageRect = { l: l, t: t, w: w, h: hgt }
        stageEl.style.left = l + 'px'
        stageEl.style.top = t + 'px'
        stageEl.style.width = w + 'px'
        stageEl.style.height = hgt + 'px'
        ensureGrid(performance.now()) // box changed -> grid follows
      }
    }

    function seedNow() {
      let rgb = null
      // 0.3.0: the accent lives in the palette state {palette, accent} (the
      // painted token below carries the SOLVED accent — prefer it).
      try { rgb = hexToRgb(JSON.parse(localStorage.getItem('arxa.themePalette') || 'null')?.accent) } catch { /* storage blocked */ }
      if (!rgb) rgb = hexToRgb(getComputedStyle(document.body).getPropertyValue('--dsw-static-deepseek-500'))
      if (!rgb) rgb = [197, 105, 117] // Mystic Evening solved dark — pre-theme-accent paint
      return rgbToHsl(rgb[0], rgb[1], rgb[2])
    }

    // A square of the wall. MOSAIC: rolls a permanent tonal identity once —
    // saturation/lightness offsets and a breath-depth scale (s/l amps only;
    // hue amplitude is NEVER scaled, the 8-deg envelope is invariant). Its
    // two triangles are breath oscillators: phase THETA is STATE advanced by
    // TAU*dt/period (an integrator), so retiming can never teleport position.
    // Partners start anti-phase, then wander apart on their own periods.
    function makeSquare(gx, gy, now, scale) {
      const ampScale = rand(AMP_SCALE_MIN, AMP_SCALE_MAX)
      const sq = {
        gx, gy,
        scale: scale || 1, // 1 = grid square, 2 = 2x2 multi-scale block
        sOff: rand(-MOSAIC_S, MOSAIC_S),
        lOff: rand(-MOSAIC_L, MOSAIC_L),
        ampScale,
        lastQ: 100, // dash-draw window: 100 = fully drawn (idle)
        tri: [],
      }
      for (let k = 0; k < 2; k++) {
        sq.tri.push({
          rolled: rand(ROLL_MIN, ROLL_MAX),
          theta: rand(0, TAU),
          ampH: rand(3, AMP_H),
          ampS: rand(3, AMP_S) * ampScale,
          ampL: rand(3, AMP_L) * ampScale,
          cFrom: { h: seed.h, s: seed.s, l: seed.l },
          cTo: { h: seed.h, s: seed.s, l: seed.l },
          cT0: now, cDur: 1,
          lastCss: '',
        })
      }
      sq.tri[1].theta = sq.tri[0].theta + Math.PI
      // Flip state (locked: envelope over the oscillators). dir 0 = 135deg
      // (TR-BL, the classic split), 1 = 45deg (TL-BR). mid is the captured
      // unity point; phase 0 idle, 1 converge, 2 hold, 3 exhale. The first
      // flip lands one rolled dwell after the square is born. Flips stay
      // deterministic toggles on their own rolled dwells (a visible change
      // is guaranteed every time).
      // BIRTH variant (0.6.1, user report): pure 50/50 iid boots clumpy —
      // same-dir runs of 3-4 tiles read as "not random", and at ~10%
      // flips/min a clump persists for minutes. Stratified instead: the
      // checkerboard parity with a 22% jitter — a neighbor pair matches
      // only when exactly one side jittered: 2p(1-p) = 0.34 vs iid 0.5
      // (probe-verified adjSame 0.5 -> 0.33). Runs die young, the field
      // reads deliberately mixed while staying organic. Blocks keep the
      // coin (isolated tiles, no adjacency to clump).
      const birthDir = scale === 2 ? (Math.random() < 0.5 ? 0 : 1)
        : (((gx + gy) & 1) ^ (Math.random() < BIRTH_JITTER ? 1 : 0))
      sq.flip = { dir: birthDir, phase: 0, t0: 0, mid: null, nextAt: now + rand(FLIP_ROLL_MIN, FLIP_ROLL_MAX) }
      return sq
    }

    // Re-roll one square's random identity from the seeded stream (0.7.0).
    // Theta, the color glide and flip PHASE are untouched — the organism
    // never teleports. A variant change captures the unity point from the
    // CURRENT colors first, then rides the normal flip envelope with a
    // stagger so the wall re-mixes as a wave, not a pop. initial=true
    // (boot) assigns the variant directly — nothing has painted yet.
    function rerollSquare(sq, rng, now, initial) {
      const f = sq.flip
      const targetDir = sq.scale === 2 ? (rng() < 0.5 ? 0 : 1)
        : (((sq.gx + sq.gy) & 1) ^ (rng() < BIRTH_JITTER ? 1 : 0))
      // The stagger is drawn UNCONDITIONALLY: rng consumption per square
      // must be constant, or the stream diverges whenever a birth variant
      // (unseeded) happens to differ from the seeded target — probe-verified
      // divergence after the first such square.
      const stagger = rng() * 900
      if (initial) { f.dir = targetDir; if (stageEl) writeAngle(sq) } // boot: paint the seeded variant from frame one
      else if (targetDir !== f.dir && f.phase === 0) {
        f.mid = flipMid(sq, now) // captured BEFORE the identity moves
        f.phase = 1
        f.t0 = now + stagger // stagger: the remix rolls across the wall
      }
      const ampScale = AMP_SCALE_MIN + rng() * (AMP_SCALE_MAX - AMP_SCALE_MIN)
      sq.ampScale = ampScale
      sq.sOff = (rng() * 2 - 1) * MOSAIC_S
      sq.lOff = (rng() * 2 - 1) * MOSAIC_L
      for (const t of sq.tri) {
        t.rolled = ROLL_MIN + rng() * (ROLL_MAX - ROLL_MIN)
        t.ampH = 3 + rng() * (AMP_H - 3)
        t.ampS = (3 + rng() * (AMP_S - 3)) * ampScale
        t.ampL = (3 + rng() * (AMP_L - 3)) * ampScale
      }
    }

    // Apply a seed to the whole wall (0.7.0): one deterministic stream in
    // coordinate order (Map insertion is row-major birth order), blocks
    // last. Live applies dip the wall so the simultaneous tone step reads
    // as a remix pulse, exactly like the stroke toggle.
    function applySeed(n, initial) {
      const rng = mulberry32((n | 0) + 1)
      const now = performance.now()
      const run = () => {
        for (const sq of squares.values()) rerollSquare(sq, rng, now, initial)
        for (const b of blocks.values()) rerollSquare(b, rng, now, initial)
      }
      if (initial || !wallEl || !enabled || wallOp <= 0 || reducedMotion()) { run(); return }
      wallEl.style.opacity = '0'
      setTimeout(() => { run(); wallEl.style.opacity = '' }, 280)
    }

    function storedSeed() {
      try {
        const v = localStorage.getItem(SEED_KEY)
        if (v === null) return null
        const n = parseInt(v, 10)
        return isFinite(n) ? clamp(Math.round(n), 0, 999) : null
      } catch { return null }
    }
    function setSeed(n, persist) {
      n = clamp(Math.round(n), 0, 999)
      if (persist) {
        try { localStorage.setItem(SEED_KEY, String(n)) } catch { /* remix still runs */ }
      }
      applySeed(n, false)
    }
    // Auto mode (0.8.0, user report "no randomness on the diagonal
    // variants" — a stored seed replays the SAME field at every boot, and
    // the row had no way back): clearSeed drops the stored seed and remixes
    // to a FRESH unseeded field on the spot (a random seed applied for this
    // boot only, never persisted) — every launch is a new wall again.
    function clearSeed(persist) {
      if (persist) {
        try { localStorage.removeItem(SEED_KEY) } catch { /* remix still runs */ }
      }
      applySeed(Math.floor(Math.random() * 1000000), false)
    }

    // The rolling swell: two INTEGRATED global drift phases (advanced by dt
    // in the frame loop — hidden tabs pause the whole organism), felt per
    // square through the spatial wavevector.
    const drift = { thH: rand(0, TAU), thL: rand(0, TAU) }
    const driftH = (sq) => DRIFT_H * Math.sin(drift.thH + SWELL_KX * sq.gx + SWELL_KY * sq.gy)
    const driftL = (sq) => DRIFT_L * Math.sin(drift.thL + SWELL_KX * sq.gx + SWELL_KY * sq.gy)
    let flipCount = 0 // dev probe: lifetime flips (read via __arxaPrismDebug)
    let lastFlip = null // dev probe: { key, dir, atMs } of the latest snap

    // Current breathing center for a triangle (the eased seed glide).
    function centerAt(t, now) {
      const k = clamp((now - t.cT0) / t.cDur, 0, 1)
      const e = smooth(k)
      return {
        h: wrapH(t.cFrom.h + shortDelta(t.cFrom.h, t.cTo.h) * e),
        s: t.cFrom.s + (t.cTo.s - t.cFrom.s) * e,
        l: t.cFrom.l + (t.cTo.l - t.cFrom.l) * e,
      }
    }

    // The breath itself: center + mosaic tone + sine oscillation + swell.
    // Stroke mode reroutes lightness through the line discipline (compressed
    // identity + depth, figure-ground clamp) — hue and saturation ride on
    // untouched, so lines still breathe as one organism. Fill is unchanged.
    function valueAt(sq, t, now) {
      const c = centerAt(t, now)
      const s1 = Math.sin(t.theta)
      const st = strokeOn
      const l = c.l + sq.lOff * (st ? STROKE_LOFF_SCALE : 1) +
        t.ampL * (st ? STROKE_AMPL_SCALE : 1) * s1 + driftL(sq)
      let lo = 4, hi = 96
      if (st) {
        if (document.body && document.body.hasAttribute('data-ds-dark-theme')) lo = STROKE_L_MIN_DARK
        else hi = STROKE_L_MAX_LIGHT
      }
      return {
        h: wrapH(c.h + t.ampH * s1 + driftH(sq)),
        s: clamp(c.s + sq.sOff + t.ampS * s1, 0, 100),
        l: clamp(l, lo, hi),
      }
    }

    // The flip envelope: blends the live breath toward the captured unity
    // midpoint and releases it — the oscillators keep running underneath,
    // so the displayed color path is continuous whenever a flip starts.
    // STROKE mode skips the detour entirely: the dash-draw window makes the
    // snap invisible geometrically, so line colors stay on their pure
    // breath path. Fill mode is unchanged (locked dissolve-through-unity).
    function flipMix(sq, v, now) {
      if (strokeOn) return v
      const f = sq.flip
      if (!f || f.phase === 0 || !f.mid) return v
      const e = f.phase === 1 ? smooth(clamp((now - f.t0) / FLIP_IN_MS, 0, 1))
        : f.phase === 2 ? 1
        : 1 - smooth(clamp((now - f.t0) / FLIP_OUT_MS, 0, 1))
      if (e <= 0) return v
      return {
        h: wrapH(v.h + shortDelta(v.h, f.mid.h) * e),
        s: v.s + (f.mid.s - v.s) * e,
        l: v.l + (f.mid.l - v.l) * e,
      }
    }

    // The unity point (locked): instantaneous midpoint of the two halves'
    // CURRENT breath — circular in hue, minimal travel from any phase.
    function flipMid(sq, now) {
      const a = valueAt(sq, sq.tri[0], now), b = valueAt(sq, sq.tri[1], now)
      return {
        h: wrapH(a.h + shortDelta(a.h, b.h) / 2),
        s: (a.s + b.s) / 2,
        l: (a.l + b.l) / 2,
      }
    }

    function writeAngle(sq) {
      if (!stageEl) return
      const pre = (sq.scale === 2 ? 'B' : '') + sq.gx + 'x' + sq.gy
      stageEl.style.setProperty('--arxa-prism-g' + pre, sq.flip.dir ? '45deg' : '135deg')
      // Dash-draw occluder axis: 0% at the line's right-side corner.
      stageEl.style.setProperty('--arxa-prism-o' + pre, sq.flip.dir ? '315deg' : '225deg')
    }

    // Production driver: idle -> converge -> (snap while uniform) -> hold ->
    // exhale -> re-roll the dwell. Transitions are pure state changes; the
    // envelope makes the motion.
    function flipTick(sq, now) {
      const f = sq.flip
      if (f.phase === 0) {
        if (now >= f.nextAt) { f.mid = flipMid(sq, now); f.phase = 1; f.t0 = now }
        return
      }
      if (f.phase === 1 && now - f.t0 >= FLIP_IN_MS) {
        f.dir ^= 1
        flipCount++ // dev probe: lifetime flip counter for lens diagnostics
        lastFlip = { key: (sq.scale === 2 ? 'B' : '') + sq.gx + 'x' + sq.gy, dir: f.dir, atMs: Math.round(now) }
        writeAngle(sq) // square is uniform here — the snap is invisible
        f.phase = 2; f.t0 = now
        return
      }
      if (f.phase === 2 && now - f.t0 >= FLIP_HOLD_MS) { f.phase = 3; f.t0 = now; return }
      if (f.phase === 3 && now - f.t0 >= FLIP_OUT_MS) {
        f.phase = 0; f.t0 = 0; f.mid = null
        f.nextAt = now + rand(FLIP_ROLL_MIN, FLIP_ROLL_MAX)
      }
    }

    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)')
    function reducedMotion() { return !!(reduced && reduced.matches) }

    const varName = (sq, k) =>
      '--arxa-prism-' + (k === 0 ? 'a' : 'b') + (sq.scale === 2 ? 'B' : '') + sq.gx + 'x' + sq.gy

    // Quantized write: build the rendered string (0.1 resolution) and skip
    // setProperty when nothing visible changed — the wall's frame cost stays
    // low even at 400 squares, especially at slow tempos.
    function writeTri(sq, k, now) {
      const t = sq.tri[k]
      const css = cssColor(flipMix(sq, valueAt(sq, t, now), now))
      if (css === t.lastCss) return
      t.lastCss = css
      if (stageEl) stageEl.style.setProperty(varName(sq, k), css)
    }

    function writeAll(now) {
      const write = (sq) => {
        if (sq.gx >= gridCols || sq.gy >= gridRows) return
        writeTri(sq, 0, now); writeTri(sq, 1, now)
        if (sq.flip && sq.flip.dir) writeAngle(sq) // heal angle vars across remounts
      }
      for (const sq of squares.values()) write(sq)
      for (const b of blocks.values()) write(b)
    }

    // One hard-stop gradient layer per ACTIVE tile; layers composite into
    // the glued wall on the wall element (vars inherit from the stage).
    // Rebuilt only when the grid shape changes. Tiles past a shrunk grid
    // edge emit nothing — they rejoin seamlessly on regrow.
    // Modes (0.6.1): 'fill' renders EVERY 1x square and no blocks — a
    // uniform 100px mosaic (the 2x block read as a flat anomaly in fill);
    // 'stroke' renders non-covered squares + blocks (the multi-scale
    // line-weight hierarchy lives in stroke mode only).
    function buildLayers(mode) {
      const layers = []
      const emit = (sq) => {
        if (sq.gx >= gridCols || sq.gy >= gridRows) return
        const pre = sq.scale === 2 ? 'B' : ''
        const size = sq.scale * gridSq
        layers.push(
          'linear-gradient(var(--arxa-prism-g' + pre + sq.gx + 'x' + sq.gy + ',135deg),' +
          'var(--arxa-prism-a' + pre + sq.gx + 'x' + sq.gy + ',#C56975) 50%,' +
          'var(--arxa-prism-b' + pre + sq.gx + 'x' + sq.gy + ',#BC757D) 50%' +
          ') ' + sq.gx * gridSq + 'px ' + sq.gy * gridSq + 'px / ' + size + 'px ' + size + 'px no-repeat')
      }
      for (const sq of squares.values()) {
        if (mode === 'stroke' && covered.has(sq.gx + ',' + sq.gy)) continue
        emit(sq)
      }
      if (mode === 'stroke') for (const b of blocks.values()) emit(b)
      return layers.join(',')
    }

    // The stroke mask: one band layer per ACTIVE square on the same geometry
    // as the fill, keeping only the proportional band around the divide. The
    // same angle var drives fill and mask, so a Truchet snap re-orients both
    // in the same invisible instant. Rebuilt with the grid, exactly like fill.
    function buildMaskLayers() {
      const layers = []
      const emit = (sq) => {
        if (sq.gx >= gridCols || sq.gy >= gridRows) return
        const pre = sq.scale === 2 ? 'B' : ''
        const size = sq.scale * gridSq
        const half = (size * STROKE_BAND_PCT / 2).toFixed(2) // 5% of the tile
        layers.push(
          'linear-gradient(var(--arxa-prism-g' + pre + sq.gx + 'x' + sq.gy + ',135deg),' +
          'transparent calc(50% - ' + half + 'px),' +
          '#000 calc(50% - ' + half + 'px),' +
          '#000 calc(50% + ' + half + 'px),' +
          'transparent calc(50% + ' + half + 'px)' +
          ') ' + sq.gx * gridSq + 'px ' + sq.gy * gridSq + 'px / ' + size + 'px ' + size + 'px no-repeat')
      }
      for (const sq of squares.values()) { if (covered.has(sq.gx + ',' + sq.gy)) continue; emit(sq) }
      for (const b of blocks.values()) emit(b)
      return layers.join(',')
    }

    // The dash-draw occluders (stroke mode only): one surface-colored
    // window per ACTIVE tile, stacked ABOVE the fill layers. The
    // transparent window [0..q%] along the occluder axis is the drawn
    // segment; q=100 (idle) renders the layer fully transparent. The wall
    // mask clips the occluder to the band too, so only the line's segment
    // is ever covered — the rest of the tile shows surface either way.
    function buildOccluderLayers() {
      const layers = []
      const emit = (sq) => {
        if (sq.gx >= gridCols || sq.gy >= gridRows) return
        const pre = sq.scale === 2 ? 'B' : ''
        const key = pre + sq.gx + 'x' + sq.gy
        const size = sq.scale * gridSq
        const q = 'calc(var(--arxa-prism-d' + key + ',100) * 1%)'
        const surf = 'var(--arxa-prism-surface,#101418)'
        layers.push(
          'linear-gradient(var(--arxa-prism-o' + key + ',225deg),' +
          'transparent 0%,transparent ' + q + ',' +
          surf + ' ' + q + ',' + surf + ' 100%' +
          ') ' + sq.gx * gridSq + 'px ' + sq.gy * gridSq + 'px / ' + size + 'px ' + size + 'px no-repeat')
      }
      for (const sq of squares.values()) { if (covered.has(sq.gx + ',' + sq.gy)) continue; emit(sq) }
      for (const b of blocks.values()) emit(b)
      return layers.join(',')
    }

    // Size the grid to the stage box; grow squares past the cap on giant
    // screens. Coordinate-keyed: existing squares are untouched, new edge
    // squares roll their mosaic identity on arrival.
    function ensureGrid(now) {
      if (!stageEl || !stageRect.w || !stageRect.h) return
      const w = stageRect.w, hgt = stageRect.h
      let sq = SQ_BASE
      while (Math.ceil(w / sq) * Math.ceil(hgt / sq) > MAX_SQUARES && sq < 400) sq += 20
      const cols = Math.ceil(w / sq), rows = Math.ceil(hgt / sq)
      if (cols === gridCols && rows === gridRows && sq === gridSq) return
      gridCols = cols; gridRows = rows; gridSq = sq
      logEvent('grid', cols + 'x' + rows + '@' + sq)
      // Multi-scale pass: even-aligned 2x2 supercells roll their block
      // decision ONCE per coordinate; winners own a big tile whose breath
      // and flip identity run forever. RENDERING is stroke-only (0.6.1):
      // the covered smalls are still born and breathe — fill mode renders
      // them as a uniform 100px mosaic; only the stroke rule swaps in the
      // big tiles (the line-weight hierarchy lives on lines).
      for (let gy = 0; gy + 1 < rows; gy += 2) {
        for (let gx = 0; gx + 1 < cols; gx += 2) {
          const bk = gx + ',' + gy
          if (!blockRolls.has(bk)) blockRolls.set(bk, Math.random() < BLOCK_P)
          if (!blockRolls.get(bk) || blocks.has(bk)) continue
          blocks.set(bk, makeSquare(gx, gy, now, 2))
          covered.add(bk)
          covered.add((gx + 1) + ',' + gy)
          covered.add(gx + ',' + (gy + 1))
          covered.add((gx + 1) + ',' + (gy + 1))
        }
      }
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const key = gx + ',' + gy
          if (!squares.has(key)) squares.set(key, makeSquare(gx, gy, now))
        }
      }
      if (baseStyle) {
        baseStyle.textContent = [
          '[data-arxa-prism-wall]{',
          'background:' + buildLayers('fill') + '}',
          // Stroke mode: the stage attribute gates mask + occluders; the
          // fill rule above stays bit-identical (framerate is sacred). The
          // background override restacks occluders ABOVE the stroke tiles;
          // the mask SHORTHAND carries the per-layer position/size/repeat
          // grammar (the mask-image longhand would drop it as invalid).
          '[data-arxa-prism-stage][data-arxa-prism-stroke] [data-arxa-prism-wall]{',
          'background:' + buildOccluderLayers() + ',' + buildLayers('stroke') + ';',
          '-webkit-mask:' + buildMaskLayers() + ';',
          'mask:' + buildMaskLayers() + '}',
        ].join('\n')
      }
      writeAll(now)
    }

    // The rAF loop runs FOREVER (a sine never stops breathing). Every
    // advancement rides dt clamped to DT_MAX: a hidden tab pauses the
    // organism; refocus resumes seamlessly instead of jumping.
    // 0.7.2 frame discipline (docs-backed): geometry READS lead the frame
    // (fixStage(false) — no host walk), style WRITES follow; never a read
    // after this frame's writes, so no forced synchronous layout.
    let rafId = 0
    let lastNow = 0
    let lastGapAt = 0
    let debt = 0 // ms of stalled time still to repay (stall immunity, 0.8.0)
    function frame(now) {
      if (!stageEl || reducedMotion() || !enabled || wallOp <= 0 || !stageVisible) {
        rafId = 0
        logEvent('stop',
          !stageEl ? 'no-stage'
            : reducedMotion() ? 'reduced-motion'
            : !enabled ? 'disabled'
            : wallOp <= 0 ? 'opacity-0' : 'stage-hidden')
        lastNow = 0
        return
      }
      if (!lastNow) lastNow = now
      const rawDt = now - lastNow
      if (rawDt > 750 && now - lastGapAt > 4000) {
        lastGapAt = now
        logEvent('gap', String(Math.round(rawDt)))
      }
      lastNow = now
      // Stall catch-up (0.8.0): time past DT_MAX becomes debt, repaid at
      // +33% of each frame's own clamped step — a 2s stall melts away as a
      // ~6s gentle hurry on the SAME integrator, never a freeze, never a
      // snap (the recovery frame itself repays only 33ms).
      if (rawDt > DT_MAX) debt = Math.min(debt + rawDt - DT_MAX, DEBT_MAX)
      const clamped = Math.min(rawDt, DT_MAX)
      const repay = Math.min(debt, clamped * DEBT_RATE)
      debt -= repay
      const dt = clamped + repay
      // The tempo chase: scale eases toward the slider's target with a
      // ~300ms time constant, so even whip-drags change VELOCITY smoothly
      // (position is already continuous by integrator construction).
      if (scale !== targetScale) {
        scale += (targetScale - scale) * (1 - Math.exp(-dt / CHASE_MS))
        if (Math.abs(targetScale - scale) < 1e-4) scale = targetScale
      }
      drift.thH += TAU * dt / DRIFT_T_H
      drift.thL += TAU * dt / DRIFT_T_L
      // READ phase: track the conversation box against the previous frame's
      // clean layout — before a single style write below.
      fixStage(false)
      const tick = (sq) => {
        if (sq.gx >= gridCols || sq.gy >= gridRows) return
        flipTick(sq, now)
        if (strokeOn) {
          // Dash-draw window: retreat 100->0 (converge), 0 (hold/snap),
          // grow 0->100 (exhale) — smoothstepped, so the tip accelerates
          // and lands softly. Quantized + write-on-change like the colors.
          const f = sq.flip
          let q = 100
          if (f.phase === 1) q = 100 * (1 - smooth(clamp((now - f.t0) / FLIP_IN_MS, 0, 1)))
          else if (f.phase === 2) q = 0
          else if (f.phase === 3) q = 100 * smooth(clamp((now - f.t0) / FLIP_OUT_MS, 0, 1))
          q = Math.round(q * 10) / 10
          if (q !== sq.lastQ) {
            sq.lastQ = q
            if (stageEl) stageEl.style.setProperty(
              '--arxa-prism-d' + (sq.scale === 2 ? 'B' : '') + sq.gx + 'x' + sq.gy, String(q))
          }
        }
        for (let k = 0; k < 2; k++) {
          const t = sq.tri[k]
          const period = clamp(t.rolled * scale, P_MIN, P_MAX)
          t.theta += TAU * dt / period
          writeTri(sq, k, now)
        }
      }
      for (const sq of squares.values()) tick(sq)
      for (const b of blocks.values()) tick(b)
      rafId = requestAnimationFrame(frame)
    }
    const kick = () => {
      if (!rafId && !reducedMotion() && enabled && wallOp > 0 && stageVisible) {
        rafId = requestAnimationFrame(frame)
        logEvent('start')
      }
    }

    //#region settings row (Language-row metrics, own class names)
    const rowCss = {
      row: 'arxaPrism_row',
      rowText: 'arxaPrism_rowText',
      title: 'arxaPrism_title',
      desc: 'arxaPrism_desc',
      ctrl: 'arxaPrism_ctrl',
      cap: 'arxaPrism_cap',
      slider: 'arxaPrism_slider',
      val: 'arxaPrism_val',
      sw: 'arxaPrism_switch',
      swOn: 'arxaPrism_switchOn',
      thumb: 'arxaPrism_thumb',
      chip: 'arxaPrism_chip',
      chipOn: 'arxaPrism_chipOn',
      group: 'arxaPrism_group',
      groupLabel: 'arxaPrism_groupLabel',
    }
    const rowCssText =
      '.arxaPrism_row{border-bottom:1px solid var(--dsw-alias-border-l2);' +
      'align-items:center;gap:8px;padding:16px 0;display:flex}' +
      '.arxaPrism_rowText{flex-direction:column;flex:1;gap:4px;min-width:0;' +
      'padding-right:48px;display:flex}' +
      '.arxaPrism_title{color:var(--dsw-alias-label-primary);font-size:14px;' +
      'font-weight:400;line-height:22px}' +
      '.arxaPrism_desc{color:var(--dsw-alias-label-secondary,#8a8f98);' +
      'font-size:12px;line-height:18px}' +
      '.arxaPrism_ctrl{align-items:center;gap:10px;display:flex}' +
      '.arxaPrism_cap{color:var(--dsw-alias-label-secondary,#8a8f98);font-size:12px;' +
      'line-height:18px;user-select:none}' +
      '.arxaPrism_slider{-webkit-appearance:none;appearance:none;width:140px;height:4px;' +
      'border-radius:2px;outline:none;margin:0;padding:0;cursor:pointer;' +
      'border:none;background:var(--dsw-alias-border-l2)}' +
      '.arxaPrism_slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;' +
      'width:14px;height:14px;border-radius:50%;border:none;cursor:pointer;' +
      'background:var(--dsw-static-deepseek-500)}' +
      '.arxaPrism_slider::-moz-range-thumb{width:14px;height:14px;border-radius:50%;' +
      'border:none;cursor:pointer;background:var(--dsw-static-deepseek-500)}' +
      '.arxaPrism_slider:focus-visible{outline:2px solid var(--dsw-static-deepseek-500);' +
      'outline-offset:4px}' +
      '.arxaPrism_val{color:var(--dsw-alias-label-secondary,#8a8f98);font-size:12px;' +
      'line-height:18px;font-family:var(--ds-font-family-code);min-width:48px;text-align:right;' +
      'font-variant-numeric:tabular-nums;user-select:none}' +
      // Switch: iOS-style track+thumb, same accent token as the slider thumb
      // (no stock switch exists in the dsh UI kits — verified by grep).
      '.arxaPrism_switch{width:36px;height:20px;border-radius:10px;border:none;' +
      'padding:2px;cursor:pointer;position:relative;flex:none;' +
      'background:var(--dsw-alias-border-l2);transition:background-color .2s ease}' +
      '.arxaPrism_switchOn{background:var(--dsw-static-deepseek-500)}' +
      '.arxaPrism_thumb{display:block;width:16px;height:16px;border-radius:50%;' +
      'background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);' +
      'transition:transform .2s ease}' +
      '.arxaPrism_switchOn .arxaPrism_thumb{transform:translateX(16px)}' +
      '.arxaPrism_switch:focus-visible{outline:2px solid var(--dsw-static-deepseek-500);' +
      'outline-offset:2px}' +
      // Auto chip (0.8.0 seed row): small pill right of the readout; the
      // active state carries the accent like the switch's on state.
      '.arxaPrism_chip{height:22px;padding:0 10px;border-radius:11px;flex:none;' +
      'border:1px solid var(--dsw-alias-border-l2);background:transparent;' +
      'color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;' +
      'line-height:20px;cursor:pointer;margin-left:8px}' +
      '.arxaPrism_chip:hover{border-color:var(--dsw-alias-label-tertiary)}' +
      '.arxaPrism_chipOn{border-color:var(--dsw-static-deepseek-500);' +
      'color:var(--dsw-static-deepseek-500)}' +
      '.arxaPrism_chip:focus-visible{outline:2px solid var(--dsw-static-deepseek-500);' +
      'outline-offset:2px}' +
      // Background group: one settings.general.item registration wrapping all
      // four background rows — a small section label on top, hairlines inside,
      // the group's own bottom rule separating it from the next plugin's rows
      // (the General section clears that rule only for the slot's LAST child).
      '.arxaPrism_group{border-bottom:1px solid var(--dsw-alias-border-l2);' +
      'flex-direction:column;display:flex}' +
      '.arxaPrism_group .arxaPrism_row:last-child{border-bottom:none}' +
      '.arxaPrism_groupLabel{color:var(--dsw-alias-label-secondary,#8a8f98);' +
      'font-size:12px;font-weight:600;line-height:18px;padding:20px 0 0;' +
      'user-select:none}'

    const fmtAvg = (t) => {
      const s = Math.round(avgFromT(t) / 100) / 10 // one decimal, trimmed
      return '≈ ' + (Number.isInteger(s) ? String(s) : s.toFixed(1)) + 's'
    }

    function BreathRow() {
      const [t, setT] = React.useState(() => rateT)
      // Another window moved the rate — follow it live (same local-only
      // sync contract as the animation's own storage listener).
      React.useEffect(() => {
        const onStorage = (e) => {
          if (e.key !== RATE_KEY) return
          const v = parseFloat(e.newValue)
          if (isFinite(v)) setT(clamp(v, 0, 1))
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
      }, [])
      const onChange = (e) => {
        let v = parseFloat(e.target.value) / 1000
        if (!isFinite(v)) return
        // Magnetic center detent: returning to the natural rate is effortless.
        if (Math.abs(v - 0.5) < 0.02) v = 0.5
        setT(v)
        setRateT(v, true)
      }
      const pct = (t * 100).toFixed(1)
      return h('div', { className: rowCss.row },
        h('div', { className: rowCss.rowText },
          h('div', { className: rowCss.title }, 'Breathing rate'),
          h('div', { className: rowCss.desc },
            "Tempo of the conversation background's organic breath. Centered is the natural rate.")),
        h('div', { className: rowCss.ctrl },
          h('span', { className: rowCss.cap, 'aria-hidden': 'true' }, 'Fast'),
          h('input', {
            type: 'range',
            className: rowCss.slider,
            min: 0, max: 1000, step: 1,
            value: Math.round(t * 1000),
            onChange,
            'aria-label': 'Breathing rate',
            'aria-valuetext': fmtAvg(t),
            style: {
              background: 'linear-gradient(90deg, var(--dsw-static-deepseek-500) ' +
                pct + '%, var(--dsw-alias-border-l2) ' + pct + '%)',
            },
          }),
          h('span', { className: rowCss.cap, 'aria-hidden': 'true' }, 'Slow'),
          h('span', { className: rowCss.val }, fmtAvg(t))))
    }
    // Seed slider (0.7.0): same slider grammar as the breath row, integer
    // 0..999 with a mono readout. Local state follows the thumb instantly;
    // the remix applies debounced 350ms after the scrub settles — a dip per
    // pixel would strobe the wall. A boot with no stored seed shows the
    // middle without applying anything (the field stays boot-random until
    // first touched). 0.8.0: the Auto chip is the way back to boot-random —
    // it clears the stored seed (until then, a pinned number replays the
    // same field at every launch, which read as "no randomness").
    function SeedRow() {
      const [n, setN] = React.useState(() => { const s = storedSeed(); return s === null ? 500 : s })
      const [auto, setAuto] = React.useState(() => storedSeed() === null)
      const timer = React.useRef(0)
      React.useEffect(() => {
        const onStorage = (e) => {
          if (e.key !== SEED_KEY) return
          if (e.newValue === null) { setAuto(true); setN(500); return }
          const v = parseInt(e.newValue, 10)
          if (isFinite(v)) { setAuto(false); setN(clamp(v, 0, 999)) }
        }
        window.addEventListener('storage', onStorage)
        return () => { window.removeEventListener('storage', onStorage); clearTimeout(timer.current) }
      }, [])
      const onChange = (e) => {
        const v = parseInt(e.target.value, 10)
        if (!isFinite(v)) return
        setAuto(false)
        setN(v)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setSeed(v, true), 350)
      }
      const onAuto = () => {
        setAuto(true)
        setN(500)
        clearTimeout(timer.current)
        clearSeed(true)
      }
      const pct = (n / 999 * 100).toFixed(1)
      return h('div', { className: rowCss.row },
        h('div', { className: rowCss.rowText },
          h('div', { className: rowCss.title }, 'Randomness'),
          h('div', { className: rowCss.desc },
            "Seed for the wall's random identities — slide to remix squares, tones and diagonals; a number replays the same field at every launch. Auto returns to a fresh field each time.")),
        h('div', { className: rowCss.ctrl },
          h('span', { className: rowCss.cap, 'aria-hidden': 'true' }, '0'),
          h('input', {
            type: 'range',
            className: rowCss.slider,
            min: 0, max: 999, step: 1,
            value: n,
            onChange,
            'aria-label': 'Randomness seed',
            'aria-valuetext': auto ? 'Auto — fresh field each launch' : 'Seed ' + n,
            style: {
              opacity: auto ? 0.5 : 1,
              background: 'linear-gradient(90deg, var(--dsw-static-deepseek-500) ' +
                pct + '%, var(--dsw-alias-border-l2) ' + pct + '%)',
            },
          }),
          h('span', { className: rowCss.cap, 'aria-hidden': 'true' }, '999'),
          h('span', { className: rowCss.val }, auto ? '—' : String(n)),
          h('button', {
            type: 'button',
            className: rowCss.chip + (auto ? ' ' + rowCss.chipOn : ''),
            onClick: onAuto,
            'aria-pressed': auto ? 'true' : 'false',
            'aria-label': 'Auto randomness — a fresh field each launch',
          }, 'Auto')))
    }

    function EnabledRow() {
      const [on, setOn] = React.useState(() => enabled)
      React.useEffect(() => {
        const onStorage = (e) => {
          if (e.key !== ENABLED_KEY) return
          setOn(e.newValue !== '0')
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
      }, [])
      const toggle = () => { setOn(!on); setEnabled(!on, true) }
      return h('div', { className: rowCss.row },
        h('div', { className: rowCss.rowText },
          h('div', { className: rowCss.title }, 'Prism mosaic'),
          h('div', { className: rowCss.desc },
            "The conversation background's living mosaic under frosted glass. Off returns to the plain studio surface.")),
        h('div', { className: rowCss.ctrl },
          h('button', {
            type: 'button',
            role: 'switch',
            'aria-checked': on ? 'true' : 'false',
            'aria-label': 'Prism mosaic',
            className: rowCss.sw + (on ? ' ' + rowCss.swOn : ''),
            onClick: toggle,
          }, h('span', { className: rowCss.thumb }))))
    }

    // Opacity slider row factory: identical slider grammar as the breath row
    // (accent fill, mono readout) with a percent value — one per layer.
    function opacityRow(cfg) {
      return function OpacityRow() {
        const [v, setV] = React.useState(() => cfg.get())
        React.useEffect(() => {
          const onStorage = (e) => {
            if (e.key !== cfg.key) return
            const n = parseFloat(e.newValue)
            if (isFinite(n)) setV(clamp(n, 0, 1))
          }
          window.addEventListener('storage', onStorage)
          return () => window.removeEventListener('storage', onStorage)
        }, [])
        const onChange = (e) => {
          const n = parseFloat(e.target.value) / 1000
          if (!isFinite(n)) return
          setV(n)
          cfg.set(n, true)
        }
        const pct = (v * 100).toFixed(1)
        return h('div', { className: rowCss.row },
          h('div', { className: rowCss.rowText },
            h('div', { className: rowCss.title }, cfg.title),
            h('div', { className: rowCss.desc }, cfg.desc)),
          h('div', { className: rowCss.ctrl },
            h('input', {
              type: 'range',
              className: rowCss.slider,
              min: 0, max: 1000, step: 1,
              value: Math.round(v * 1000),
              onChange,
              'aria-label': cfg.title,
              'aria-valuetext': Math.round(v * 100) + '%',
              style: {
                background: 'linear-gradient(90deg, var(--dsw-static-deepseek-500) ' +
                  pct + '%, var(--dsw-alias-border-l2) ' + pct + '%)',
              },
            }),
            h('span', { className: rowCss.val }, Math.round(v * 100) + '%')))
      }
    }
    const FrostRow = opacityRow({
      key: FROST_OP_KEY,
      title: 'Frost overlay',
      desc: 'Opacity of the frosted glass veil over the mosaic.',
      get: () => frostOp,
      set: setFrostOp,
    })
    const WallRow = opacityRow({
      key: WALL_OP_KEY,
      title: 'Mosaic opacity',
      desc: 'Opacity of the living mosaic behind the glass.',
      get: () => wallOp,
      set: setWallOp,
    })

    // Stroke mode switch: identical control grammar as the master row.
    function StrokeRow() {
      const [on, setOn] = React.useState(() => strokeOn)
      React.useEffect(() => {
        const onStorage = (e) => {
          if (e.key !== STROKE_KEY) return
          setOn(e.newValue === '1')
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
      }, [])
      const toggle = () => { setOn(!on); setStroke(!on, true) }
      return h('div', { className: rowCss.row },
        h('div', { className: rowCss.rowText },
          h('div', { className: rowCss.title }, 'Stroke mode'),
          h('div', { className: rowCss.desc },
            "Draw each square's dividing diagonal as a line instead of filling the halves.")),
        h('div', { className: rowCss.ctrl },
          h('button', {
            type: 'button',
            role: 'switch',
            'aria-checked': on ? 'true' : 'false',
            'aria-label': 'Stroke mode',
            className: rowCss.sw + (on ? ' ' + rowCss.swOn : ''),
            onClick: toggle,
          }, h('span', { className: rowCss.thumb }))))
    }

    // All five background controls, one grouped block: master switch first,
    // then the stroke mode, then tempo, then the two layer opacities.
    function BackgroundGroup() {
      return h('div', { className: rowCss.group },
        h('div', { className: rowCss.groupLabel }, 'Background'),
        h(EnabledRow),
        h(StrokeRow),
        h(BreathRow),
        h(SeedRow),
        h(FrostRow),
        h(WallRow))
    }
    //#endregion

    // ---- mount + theme reactivity ------------------------------------------
    let resizeObs = null
    function apply(ctx) {
      baseStyle = document.createElement('style')
      baseStyle.dataset.arxaPrism = 'base'
      document.head.appendChild(baseStyle)

      frostStyle = document.createElement('style')
      frostStyle.dataset.arxaPrism = 'frost'
      frostStyle.textContent = frostCssText
      document.head.appendChild(frostStyle)

      const rowTag = document.createElement('style')
      rowTag.dataset.arxaPrism = 'row'
      rowTag.textContent = rowCssText
      document.head.appendChild(rowTag)

      // Dev probe: live flip-state introspection for lens diagnostics.
      window.__arxaPrismDebug = () => {
        const now = performance.now()
        const phases = [0, 0, 0, 0]
        let minWait = Infinity, maxWait = -Infinity, born = 0
        let d1 = 0, adjSame = 0, adjTotal = 0
        const ident = [] // first squares' seeded identity (determinism probe)
        const scan = (sq) => {
          const f = sq.flip
          if (!f) return
          born++
          phases[f.phase]++
          if (f.dir) d1++
          const wait = f.nextAt - now
          if (f.phase === 0) { if (wait < minWait) minWait = wait; if (wait > maxWait) maxWait = wait }
        }
        for (const sq of squares.values()) {
          if (sq.gx >= gridCols || sq.gy >= gridRows) continue
          scan(sq)
          if (ident.length < 8) ident.push(sq.flip.dir + ':' + Math.round(sq.tri[0].rolled) + ':' + sq.sOff.toFixed(1) + ':' + sq.lOff.toFixed(1))
          // Same-dir adjacency (clustering measure): share of right/down
          // neighbor pairs with equal variants; iid 50/50 expects ~0.5.
          const r = squares.get((sq.gx + 1) + ',' + sq.gy)
          const d = squares.get(sq.gx + ',' + (sq.gy + 1))
          if (r && r.gx < gridCols) { adjTotal++; if (r.flip.dir === sq.flip.dir) adjSame++ }
          if (d && d.gy < gridRows) { adjTotal++; if (d.flip.dir === sq.flip.dir) adjSame++ }
        }
        for (const b of blocks.values()) scan(b)
        return { now: Math.round(now), tiles: born, flips: flipCount, last: lastFlip, phases, d1, adjSame, adjTotal, ident, minWaitS: +(minWait / 1000).toFixed(1), maxWaitS: +(maxWait / 1000).toFixed(1) }
      }

      // Grid follows the conversation box (window resizes, sidebar toggles,
      // hero/session layout shifts) — the RO pokes fixStage, whose rect
      // write-on-change re-grids only when the box actually moved. Created
      // BEFORE the first mount so mount() observes the initial scrollport.
      let roDebounce = 0
      resizeObs = new ResizeObserver(() => {
        clearTimeout(roDebounce)
        roDebounce = setTimeout(() => fixStage(true), 150)
      })

      seed = seedNow()
      syncOffAttr() // off-boot: attribute lands before the first frame paints
      mount(true)
      // A stored seed makes the field deterministic from the first paint
      // (variants assigned directly — nothing has rendered yet).
      const bootSeed = storedSeed()
      if (bootSeed !== null) applySeed(bootSeed, true)
      logEvent('boot', bootSeed !== null ? 'seed-' + bootSeed : 'boot-random')
      kick()

      // React re-mounts the scrollport on some navigations — a MutationObserver
      // pokes mount(false) on the very next frame so the stage tracker never
      // sits on a detached node (the 1.5s heal below stays as the backstop;
      // reseed rides along as the accent safety net).
      let swapScheduled = false
      new MutationObserver(() => {
        if (swapScheduled) return
        swapScheduled = true
        requestAnimationFrame(() => {
          swapScheduled = false
          if (document.querySelector('[data-conversation-scroll]') !== mountedEl) mount(false)
        })
      }).observe(document.body, { childList: true, subtree: true })
      setInterval(() => { mount(false); reseed() }, 1500)

      // Accent swatch (theme-accent writes inline vars on <body>) and
      // dark/light flips both land here; re-resolve and glide to the new
      // spectrum. The debounce rides out multi-attribute flips.
      let debounce = 0
      new MutationObserver(() => {
        clearTimeout(debounce)
        debounce = setTimeout(() => { reseed(); sampleSurface() }, 300)
      }).observe(document.body, { attributes: true, attributeFilter: ['style', 'class', 'data-ds-dark-theme'] })
      if (reduced) reduced.addEventListener && reduced.addEventListener('change', kick)

      // Rate/opacity changed in ANOTHER window (same-device sync; local-only
      // by the grilled Editor-font precedent — the phone never mounts this
      // surface).
      window.addEventListener('storage', (e) => {
        if (e.key === RATE_KEY) {
          const v = parseFloat(e.newValue)
          if (isFinite(v)) setRateT(v, false)
          return
        }
        if (e.key === ENABLED_KEY) { setEnabled(e.newValue !== '0', false); return }
        if (e.key === FROST_OP_KEY) {
          const v = parseFloat(e.newValue)
          if (isFinite(v)) setFrostOp(v, false)
          return
        }
        if (e.key === WALL_OP_KEY) {
          const v = parseFloat(e.newValue)
          if (isFinite(v)) setWallOp(v, false)
          return
        }
        if (e.key === STROKE_KEY) { setStroke(e.newValue === '1', false); return }
        if (e.key === SEED_KEY) {
          if (e.newValue === null) { clearSeed(false); return } // Auto in another window
          const v = parseInt(e.newValue, 10)
          if (isFinite(v)) setSeed(v, false)
        }
      })

      // Background group: Settings > Personalisation (since 0.7.1 — the tab
      // arxa-personalisation owns; settings.general.item before), order 20 —
      // behind the accent rows (0/10), one registration carrying master
      // switch, stroke mode, breath, seed, and both layer opacities.
      ctx.slots.inject('settings.personalisation.item', () =>
        ctx.slots.register({
          name: 'settings.personalisation.item',
          id: 'arxa-prism-background',
          order: 20,
        }, BackgroundGroup))
    }

    function mount(force) {
      const el = document.querySelector('[data-conversation-scroll]')
      if (!el) { mountedEl = null; fixStage(true); return }
      if (el === mountedEl && !force) { fixStage(true); return }
      mountedEl = el
      // The scrollport instance changed — re-point the grid observer.
      if (resizeObs) { resizeObs.disconnect(); resizeObs.observe(el) }
      // The singleton stage and its two layers are created exactly once per
      // app lifetime — React can remount the scrollport around them forever.
      if (!stageEl) {
        stageEl = document.createElement('div')
        stageEl.setAttribute('data-arxa-prism-stage', '')
        wallEl = document.createElement('div')
        wallEl.setAttribute('data-arxa-prism-wall', '')
        frostEl = document.createElement('div')
        frostEl.setAttribute('data-arxa-prism-frost', '')
        stageEl.appendChild(wallEl)
        stageEl.appendChild(frostEl)
      }
      fixStage(true) // re-host (if remounted) + re-pin the box
      applyOpacityVars()
      applyStrokeAttr() // boot/remount: the mode lands before the first paint
      const now = performance.now()
      ensureGrid(now)
      writeAll(now)
      // The scrollport may not exist yet when apply() runs — then frame()
      // dies on its first tick and only this heal path ever lands here.
      // Re-kick so the breath actually starts (kick is idempotent).
      kick()
    }

    function reseed() {
      const next = seedNow()
      // Idempotent: the MutationObserver and the heal interval both land here;
      // when the accent has not actually moved there is nothing to do.
      if (hueDist(next.h, seed.h) < 0.5 && Math.abs(next.s - seed.s) < 0.5 &&
          Math.abs(next.l - seed.l) < 0.5) return
      const now = performance.now()
      seed = next
      for (const sq of squares.values()) {
        for (const t of sq.tri) {
          // Glide the oscillator CENTER from wherever it currently breathes to
          // the new accent — phases and periods continue, so the wall turns to
          // the new family like one organism shifting its breath, not a snap.
          t.cFrom = centerAt(t, now)
          t.cTo = { h: seed.h, s: seed.s, l: seed.l }
          t.cT0 = now
          t.cDur = rand(4000, 7000)
        }
      }
      for (const b of blocks.values()) {
        for (const t of b.tri) {
          t.cFrom = centerAt(t, now)
          t.cTo = { h: seed.h, s: seed.s, l: seed.l }
          t.cT0 = now
          t.cDur = rand(4000, 7000)
        }
      }
      kick()
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
