// The contrast engine — ported 1:1 from arxa/arxa/lib/palette_contrast.dart
// (grilled + locked 2026-09-11). One home of the contrast math in the studio:
// WCAG 2.2 ratios (4.5:1 body, 3:1 large/soft/nontext — SC 1.4.3/1.4.11),
// OKLCH with gamut mapping, APCA 0.1.9 as an ADVISORY readout (never a gate),
// alpha compositing (soft tokens measured as the visitor sees them), and the
// three-phase solve — foreground lightness first (hue/chroma preserved,
// smallest step that clears ALL its pairs at once), polarity inversion
// second, surfaces only as the genuine last resort. Anchors are inviolate:
// they only move if the caller puts them in the slot map. Zero runtime
// dependencies by plugin convention. mixOklab() is the studio addition: it
// evaluates exactly what CSS `color-mix(in oklab, A P%, B)` paints, so the
// palette's derived stops can be contrast-checked OFFLINE, before the
// browser ever paints them.
//
// ponytail: the oklab matrices are public constants (Björn Ottosson); no
// color library is ever needed here.

export const hexToRgb = (hex) => {
  let h = String(hex ?? '').trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}$/i.test(h)) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

const rgbHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase()

/** Alpha-composite fg over bg at alpha — soft tokens are measured as seen. */
const composite = (fg, bg, alpha) => fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)))

// ── WCAG 2.2 relative luminance + contrast ratio ────────────────────────────

const linearize = (channel) => {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

const relativeLuminance = (rgb) =>
  0.2126 * linearize(rgb[0]) + 0.7152 * linearize(rgb[1]) + 0.0722 * linearize(rgb[2])

/** WCAG 2.x contrast ratio, 1..21. Order-agnostic. Bad hex → null. */
export const contrastRatio = (a, b) => {
  const ra = hexToRgb(a), rb = hexToRgb(b)
  if (!ra || !rb) return null
  const la = relativeLuminance(ra), lb = relativeLuminance(rb)
  const hi = Math.max(la, lb), lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

// ── OKLab / OKLCH (public matrices) ─────────────────────────────────────────

const srgbToF = (channel) => {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
const fToSrgb = (v) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
  return Math.max(0, Math.min(255, Math.round(c * 255)))
}

/** sRGB → OKLab (the mixing space). */
export const toOklab = (rgb) => {
  const r = srgbToF(rgb[0]), g = srgbToF(rgb[1]), b = srgbToF(rgb[2])
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

/** OKLab → sRGB, gamut-mapped by chroma reduction (hue + lightness kept). */
export const fromOklab = (o) => {
  let { a, b } = o
  for (let i = 0; i < 24; i++) {
    const l_ = o.L + 0.3963377774 * a + 0.2158037573 * b
    const m_ = o.L - 0.1055613458 * a - 0.0638541728 * b
    const s_ = o.L - 0.0894841775 * a - 1.291485548 * b
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_
    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    const bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
    if (r >= -0.001 && r <= 1.001 && g >= -0.001 && g <= 1.001 && bb >= -0.001 && bb <= 1.001) {
      return [fToSrgb(r), fToSrgb(g), fToSrgb(bb)]
    }
    a *= 0.92; b *= 0.92
  }
  // Degenerate: neutral gray at the requested lightness.
  const v = fToSrgb(Math.max(0, Math.min(1, o.L)))
  return [v, v, v]
}

export const toOklch = (rgb) => {
  const o = toOklab(rgb)
  return { l: o.L, c: Math.sqrt(o.a * o.a + o.b * o.b), h: Math.atan2(o.b, o.a) }
}

export const fromOklch = (ok) =>
  fromOklab({ L: ok.l, a: ok.c * Math.cos(ok.h), b: ok.c * Math.sin(ok.h) })

/**
 * Exactly what CSS `color-mix(in oklab, aHex pct%, bHex)` paints.
 * pct is a's share, 0..100 (CSS normalizes p2 = 100 - pct for two opaque
 * colors). Endpoints bypass the lab trip so 100/0 are identity.
 */
export const mixOklab = (aHex, pct, bHex) => {
  if (pct >= 100) return aHex
  if (pct <= 0) return bHex
  const A = toOklab(hexToRgb(aHex)), B = toOklab(hexToRgb(bHex))
  if (!A || !B) return null
  const p = pct / 100
  return rgbHex(fromOklab({
    L: A.L * p + B.L * (1 - p),
    a: A.a * p + B.a * (1 - p),
    b: A.b * p + B.b * (1 - p),
  }))
}

// ── APCA (advisory only — the WCAG 3 candidate, 0.1.9 constants) ───────────

const apcaY = (rgb) => {
  const ch = (v) => Math.pow(v / 255, 2.4)
  return 0.2126729 * ch(rgb[0]) + 0.7151522 * ch(rgb[1]) + 0.072175 * ch(rgb[2])
}

/** Lightness contrast (Lc). Positive = dark text on light bg. Advisory only. */
export const apcaLc = (textHex, bgHex) => {
  const NORM_BG = 0.56, NORM_TXT = 0.57, REV_TXT = 0.62, REV_BG = 0.65
  const BLK_THRS = 0.022, BLK_CLMP = 1.414, SCALE = 1.14, OFFSET = 0.027, LO_CLIP = 0.1
  const softClamp = (y) => (y >= BLK_THRS ? y : y + Math.pow(BLK_THRS - y, BLK_CLMP))
  let ytxt = softClamp(apcaY(hexToRgb(textHex)))
  let ybg = softClamp(apcaY(hexToRgb(bgHex)))
  if (Math.abs(ytxt - ybg) < 0.0005) return 0
  const darkText = ytxt < ybg
  let out
  if (darkText) {
    ytxt = Math.pow(ytxt, NORM_TXT); ybg = Math.pow(ybg, NORM_BG)
    out = (ybg - ytxt) * SCALE
  } else {
    ytxt = Math.pow(ytxt, REV_TXT); ybg = Math.pow(ybg, REV_BG)
    out = (ybg - ytxt) * SCALE
  }
  if (Math.abs(out) < LO_CLIP) return 0
  return (out + (out > 0 ? -OFFSET : OFFSET)) * 100
}

// ── the pair contract + the solver ──────────────────────────────────────────

/** target per level: body 4.5:1, large/soft/nontext 3:1 (WCAG 2.2). */
export const pairTarget = (level) => (level === 'body' ? 4.5 : 3)

/**
 * Solve slotHexes (id -> hex) until every pair clears its target. Pairs are
 * {fg, bg, level, fgAlpha?}. alt: (slotId) => flipHex|null — the polarity
 * candidate for phase 2. Returns {hexes, moves, unsolved}; a move is
 * {slot, pairLabel, was, now, movedSide} where movedSide ∈ fg|flip|bg.
 */
export function solveContrast(slotHexes, pairs, alt) {
  const hexes = { ...slotHexes }
  const moves = []

  const effective = (fg, bg, alpha) =>
    alpha == null ? fg : rgbHex(composite(hexToRgb(fg), hexToRgb(bg), alpha))
  const pairPasses = (pair, fg, bg) =>
    (contrastRatio(effective(fg, bg, pair.fgAlpha), bg) ?? 0) >= pairTarget(pair.level)

  const worstLabel = (myPairs, was, now) => {
    let worst = null, worstRatio = 99
    for (const pr of myPairs) {
      const r = contrastRatio(effective(was, hexes[pr.bg], pr.fgAlpha), hexes[pr.bg])
      if (r < worstRatio) { worstRatio = r; worst = pr }
    }
    return worst === null ? '' : 'worst ' + worst.fg + ' on ' + worst.bg + ' (' + worst.level + ') '
      + worstRatio.toFixed(2) + ':1 -> '
      + (contrastRatio(effective(now, hexes[worst.bg], worst.fgAlpha), hexes[worst.bg]) ?? 0).toFixed(2) + ':1'
  }

  // Group the pairs each side must answer for TOGETHER.
  const fgPairs = {}, bgPairs = {}
  for (const pair of pairs) {
    if (!(pair.fg in slotHexes) || !(pair.bg in slotHexes)) continue
    ;(fgPairs[pair.fg] ??= []).push(pair)
    ;(bgPairs[pair.bg] ??= []).push(pair)
  }

  // The nearest passing lightness for slot against its whole pair set.
  const nearestPassing = (slot, myPairs) => {
    const ok = toOklch(hexToRgb(hexes[slot]))
    let best = null
    for (let i = 0; i <= 100; i++) {
      const cand = rgbHex(fromOklch({ l: i / 100, c: ok.c, h: ok.h }))
      if (myPairs.every((pr) => pairPasses(pr, cand, hexes[pr.bg]))) {
        if (best === null || Math.abs(i / 100 - ok.l) < Math.abs(best / 100 - ok.l)) best = i
      }
    }
    return best === null ? null : rgbHex(fromOklch({ l: best / 100, c: ok.c, h: ok.h }))
  }

  // Two rounds: surfaces that move in round one let the foregrounds re-answer.
  for (let round = 0; round < 2; round++) {
    // PHASE 1 — lightness, all pairs at once.
    for (const key of Object.keys(fgPairs)) {
      const base = hexes[key]
      const myPairs = fgPairs[key]
      if (myPairs.every((pr) => pairPasses(pr, base, hexes[pr.bg]))) continue
      const stepped = nearestPassing(key, myPairs)
      if (stepped !== null && stepped !== base) {
        hexes[key] = stepped
        moves.push({ slot: key, pairLabel: myPairs.length + ' pair(s), ' + worstLabel(myPairs, base, stepped), was: base, now: stepped, movedSide: 'fg' })
      }
    }
    // PHASE 2 — polarity inversion: the ink flips family, the surface keeps it.
    for (const key of Object.keys(fgPairs)) {
      const base = hexes[key]
      const myPairs = fgPairs[key]
      if (myPairs.every((pr) => pairPasses(pr, base, hexes[pr.bg]))) continue
      const flipped = alt ? alt(key) : null
      if (flipped && myPairs.every((pr) => pairPasses(pr, flipped, hexes[pr.bg]))) {
        hexes[key] = flipped
        moves.push({ slot: key, pairLabel: 'polarity inverted — ' + myPairs.length + ' pair(s), ' + worstLabel(myPairs, base, flipped), was: base, now: flipped, movedSide: 'flip' })
      }
    }
    // PHASE 3 — the genuinely stuck: the surface moves, least shift that
    // satisfies every pair it carries.
    for (const key of Object.keys(bgPairs)) {
      const baseBg = hexes[key]
      const myPairs = bgPairs[key]
      if (myPairs.every((pr) => pairPasses(pr, hexes[pr.fg], baseBg))) continue
      const ok = toOklch(hexToRgb(baseBg))
      let best = null
      for (let i = 0; i <= 100; i++) {
        const cand = rgbHex(fromOklch({ l: i / 100, c: ok.c, h: ok.h }))
        if (myPairs.every((pr) => pairPasses(pr, hexes[pr.fg], cand))) {
          if (best === null || Math.abs(i / 100 - ok.l) < Math.abs(best / 100 - ok.l)) best = i
        }
      }
      if (best !== null) {
        const stepped = rgbHex(fromOklch({ l: best / 100, c: ok.c, h: ok.h }))
        if (stepped !== baseBg) {
          hexes[key] = stepped
          moves.push({ slot: key, pairLabel: 'surface moved — ' + myPairs.length + ' pair(s)', was: baseBg, now: stepped, movedSide: 'bg' })
        }
      }
    }
  }

  // What still fails after all three phases — the honest residue.
  const unsolved = []
  for (const pair of pairs) {
    const fg = hexes[pair.fg], bg = hexes[pair.bg]
    if (fg == null || bg == null) continue
    if (!pairPasses(pair, fg, bg)) {
      const label = pair.fg + ' on ' + pair.bg + ' (' + pair.level + ')'
      if (!unsolved.includes(label)) unsolved.push(label)
    }
  }
  return { hexes, moves, unsolved }
}
