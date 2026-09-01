# Prism stroke mode — web research & best practices (0.4.0 follow-up)

Sources consulted (primary):
- paezha/truchet (R package, reference implementation of animated Truchet mosaics):
  https://paezha.github.io/truchet/articles/a06-animated-mosaics.html
- Multi-scale Truchet generators: https://github.com/zhaoliang0302/truchet · https://paezha.github.io/truchet/
- Variable-width / figurative mosaics:
  https://raw.githubusercontent.com/paezha/truchet/5f8c93c1c316288612aa6280244cf176e7eed18e/vignettes/articles/a04-figurative-mosaics-variable-width.Rmd
- Random Truchet SVG generator: https://github.com/cpoczatek/truchet
- Perf: many-node animated SVG backgrounds are a known trap:
  https://stackoverflow.com/questions/79595539/how-to-improve-performance-of-a-very-slow-animated-svg-background
- Motion perf canon (compositor-only properties):
  https://github.com/oakoss/agent-skills/blob/main/skills/css-animation-patterns/references/transforms-and-performance.md
- Glassmorphism recipe (bold shapes under blur): https://www.thisdevtool.com/blog/glassmorphism-css-guide
- SVG dash-flow/draw techniques: https://blog.csdn.net/weixin_29002595/article/details/158588040

## Findings mapped to our implementation

1. **Rendering tech: our CSS gradient+mask approach is the researched-correct one.**
   Many-node animated SVG backgrounds are the documented perf trap; canvas forces
   full-scene repaints per frame. One element + declarative layers + quantized
   var writes keeps us on the compositor. No change.

2. **Line weight: research says ~5–12% of tile size; we ship 2.5%.**
   Professional Truchet renders scale stroke with tile (paezha `scale_p`,
   cpoczatek weight param, variable-width mosaics). Our fixed 2.5px/100px = 2.5%
   is why strokes vanish under frost: a Gaussian blur of radius r spreads a
   line's peak contrast by roughly w/(w+2r) — 2.5px under 24px blur keeps ~5%.
   Fix: make the band proportional (STROKE_HALF = gridSq * 0.025 → 5px = 5%),
   rebuilt with the grid like everything else.

3. **"Animate the stroke" canonically = dash-draw (line grows along its length).**
   Doable inside our architecture: the mask band gets a second, moving alpha
   window along the diagonal direction (one more gradient sweep driven by the
   flip envelope) — the line draws itself corner-to-corner during a flip,
   holds, and re-draws mirrored. No SVG, no extra elements.

4. **Flip choreography matches published practice.**
   paezha animates rotations with explicit dwell pauses at 90° multiples
   (`rep(pi/2, pause)`) — our dissolve → hold (FLIP_HOLD_MS) → exhale is the
   same rhythm; our snap-while-uniform guarantees edge continuity the same way
   their discrete-angle rotation does. Duotone palette is the canonical look —
   our two-tone halves match.

5. **Multi-scale Truchet is the signature "pro" look.**
   Reference generators merge random 2x2 blocks into one big diagonal whose
   stroke scales up proportionally (5px -> 10px). For us: a block entity owning
   four squares, one 200px layer, shared breath. Moderate complexity, large
   visual payoff. Candidate next feature.

6. **Legibility under frost:** glassmorphism guidance keeps under-blur shapes
   bold/saturated. Beyond weight (2), a small lightness spread between the two
   band tones in stroke mode preserves the divide under blur.

## Ranked recommendations
- A. Proportional stroke weight (~5% of tile) — research-backed, fixes faintness.
- B. Dash-draw grow animation on flips in stroke mode (canonical stroke motion).
- C. Multi-scale 2x2 merged diagonals (signature look; bigger build).
- D. Small two-tone lightness spread in stroke mode for under-frost legibility.

## Shipped outcomes (0.5.1 / 0.6.0)
- **A shipped (0.5.1):** band is proportional 5% of tile (5px@100px, 10px on 2x
  blocks). Verified: AA energy loss fixed, line-weight hierarchy live.
- **B shipped (0.6.0):** dash-draw flips in stroke mode — the line retreats
  corner-to-corner into its right-side corner (dir0 TR, dir1 BR) via a
  per-tile surface-colored occluder window (--arxa-prism-d<key> 0..100),
  the angle+axis snap while nothing is drawn, then the mirror grows out of
  that corner. flipMix color-unity is skipped for lines (colors never leave
  the breath path). Pixel-proven on video: retreat -> invisible snap ->
  mirror grow; 57 flips in 146 page-s, p95 frame 16.7ms with 236 layers.
- **D superseded:** the 0.5.1 stroke color discipline (L identity ±10->±3,
  L breath x0.35, figure-ground clamp dark>=42/light<=62, hue/sat breath
  full) fixed under-frost legibility at the root — a line field reads
  through uniformity of the mark; variety lives in the pattern.
- **Diagnostics:** window.__arxaPrismDebug() (tiles/flips/last/phases) ships
  in the build for steady-state verification on the real app.
- **Lens caveat discovered:** lens headless runs ~10x virtual-time dilation —
  page-now advances ~1s per 10 wall-s (and `record <seconds>` records ~10x).
  Verify timing against page-now (overlay), never wall time. Lens eval/check
  sessions boot a fresh page — flips (60-180s dwell) are never observable in
  short eval windows; use overlay records.
