// arxa-theme-accent selftest — run: node plugins/theme-accent/selftest.mjs
//
// 0.3.0 (2026-09-11, grilled): the palette contract. Four fronts:
//   1. the contrast ENGINE (lib/contrast.js, ported from
//      arxa/arxa/lib/palette_contrast.dart) against the Dart suite's cases
//   2. the host store: 2–10 unique-hex validation, persistence, the
//      best-effort coolors <h1> name fill (fake fetcher), junk rejection
//   3. the routes: ONE registration per path (D84), GET/PUT flow, 400s,
//      and the engine route serving lib/contrast.js byte-identical
//   4. the client: the three built-ins present, the legacy swatches GONE,
//      and — the real gate — every built-in palette SOLVES to WCAG 2.2 AA
//      with the studio's own pair contract (rebuilt here from the same
//      constants; the constants themselves are pinned by string checks).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPaletteStore, paletteFilePath, apply, validState, validatePalette } from './lib/index.js'
import * as mod from './lib/index.js'
import * as E from './lib/contrast.js'

// 0. D84: webServer is a cordis SERVICE — the module must declare inject.
assert.deepEqual(mod.inject, ['webServer'], 'declares inject: ["webServer"]')

const env = { ...process.env, ARXA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-palette-')) }

// ── 1. the engine: the Dart suite, ported ─────────────────────────────────
{
  assert.ok(Math.abs(E.contrastRatio('#000000', '#FFFFFF') - 21) < 0.01, 'black/white is 21:1')
  assert.ok(Math.abs(E.contrastRatio('#774C60', '#774C60') - 1) < 1e-9, 'self is 1:1')
  assert.ok((E.contrastRatio('#040306', '#774C60') ?? 0) < 4.5, 'the c-1a1423 breakage class measures below AA')

  // OKLCH roundtrip through the exported toOklch/fromOklch on locally-parsed rgb.
  const rgb2hex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()
  const parse = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
  for (const hex of ['#1A1423', '#774C60', '#EACDC2', '#007EA7']) {
    const ok = E.toOklch(parse(hex))
    const back = E.fromOklch(ok)
    const again = E.toOklch(back)
    assert.ok(Math.abs(again.l - ok.l) < 0.02, 'roundtrip lightness ' + hex)
    assert.ok(Math.abs(again.h - ok.h) < 0.05, 'roundtrip hue ' + hex)
    const r = E.contrastRatio(rgb2hex(back), hex)
    assert.ok(r !== null && Math.abs(r - 1) <= 0.05, 'roundtrip color ' + hex + ' (' + r + ')')
  }

  // mixOklab = exactly what CSS color-mix(in oklab) paints; endpoints identity.
  assert.equal(E.mixOklab('#123456', 100, '#abcdef'), '#123456', 'mix 100% is identity')
  assert.equal(E.mixOklab('#123456', 0, '#abcdef'), '#abcdef', 'mix 0% is identity')
  assert.equal(E.mixOklab('#000000', 50, '#FFFFFF'), E.mixOklab('#FFFFFF', 50, '#000000'), 'mix is symmetric')
  const mid = E.mixOklab('#000000', 50, '#FFFFFF')
  const rm = E.contrastRatio(mid, '#FFFFFF')
  assert.ok(rm > 3.5 && rm < 8, 'black/white 50% oklab mix lands mid-gray (' + rm + ')')

  // solveContrast — the three-phase law.
  {
    const { hexes, moves, unsolved } = E.solveContrast(
      { ink: '#8E518D', paper: '#F7C7DB' },
      [{ fg: 'ink', bg: 'paper', level: 'body' }])
    assert.deepEqual(unsolved, [], 'phase 1: solved')
    assert.ok((E.contrastRatio(hexes.ink, hexes.paper) ?? 0) >= 4.5, 'phase 1: ratio ≥ 4.5')
    assert.equal(moves.length, 1, 'phase 1: one move')
    assert.equal(moves[0].movedSide, 'fg', 'phase 1: the foreground moved')
    assert.equal(hexes.paper, '#F7C7DB', 'phase 1: the paper never moved')
  }
  {
    const { hexes, moves, unsolved } = E.solveContrast(
      { 'card-text': '#1A1423', beige: '#B75D69' },
      [{ fg: 'card-text', bg: 'beige', level: 'body' }],
      () => '#EACDC2')
    assert.deepEqual(unsolved, [], 'phase 2: solved')
    assert.equal(hexes.beige, '#B75D69', 'phase 2: the surface never moves for a simple text pair')
    assert.ok((E.contrastRatio(hexes['card-text'], hexes.beige) ?? 0) >= 4.5, 'phase 2: ratio ≥ 4.5')
    assert.ok(moves.length > 0, 'phase 2: a move happened')
    assert.ok(moves.every((m) => m.movedSide !== 'bg'), 'phase 2: no surface move')
  }
  {
    const { hexes, moves, unsolved } = E.solveContrast(
      { ink: '#808080', bg: '#7F7F7F' },
      [{ fg: 'ink', bg: 'bg', level: 'body' }])
    assert.deepEqual(unsolved, [], 'phase 3: solved')
    assert.equal(moves.length, 1, 'phase 3: one move')
    assert.ok(['fg', 'bg'].includes(moves[0].movedSide), 'phase 3: fg or bg moved')
    assert.ok((E.contrastRatio(hexes.ink, hexes.bg) ?? 0) >= 4.5, 'phase 3: ratio ≥ 4.5')
  }
  {
    const { hexes, unsolved } = E.solveContrast(
      { ink: '#1A1423', paper: '#EACDC2', field: '#774C60' },
      [
        { fg: 'ink', bg: 'paper', level: 'body' },
        { fg: 'ink', bg: 'field', level: 'body' },
      ])
    assert.equal(hexes.paper, '#EACDC2', 'all-pairs: the light paper is never the casualty')
    if (unsolved.length === 0) {
      assert.ok((E.contrastRatio(hexes.ink, hexes.paper) ?? 0) >= 4.5, 'all-pairs: paper pair holds')
      assert.ok((E.contrastRatio(hexes.ink, hexes.field) ?? 0) >= 4.5, 'all-pairs: field pair holds')
    }
    for (const label of unsolved) assert.ok(label.includes('ink on'), 'all-pairs: residue names its pair (' + label + ')')
  }
  {
    // Soft (alpha) pairs are measured as the composite — proven by the
    // solve itself holding the 3:1 soft target (composite isn't exported).
    const { unsolved } = E.solveContrast(
      { 'ink-soft': '#8E518D', paper: '#D7C0D0' },
      [{ fg: 'ink-soft', bg: 'paper', level: 'soft', fgAlpha: 0.64 }])
    assert.deepEqual(unsolved, [], 'soft alpha: solved as the composited color')
  }
}

// ── 2. the palette store ───────────────────────────────────────────────────
assert.equal(validatePalette('1a1423-b75d69'), '1a1423-b75d69', 'a valid palette normalizes')
assert.equal(validatePalette('ABC-DEF'), 'aabbcc-ddeeff', '3-digit hexes expand')
assert.equal(validatePalette('ff0000'), null, '1 swatch refused (coolors 404s it)')
assert.equal(validatePalette(Array.from({ length: 11 }, (_, i) => (i + 16).toString(16).padStart(2, '0') + '00').join('-')), null, '11 swatches refused (coolors refuses 11+)')
assert.equal(validatePalette('1a1423-zzzzzz'), null, 'non-hex refused')
assert.equal(validatePalette('aabbcc-aabbcc'), null, 'duplicate swatches refused')
assert.equal(validatePalette('1a1423-372549-774c60-b75d69-eacdc2'), '1a1423-372549-774c60-b75d69-eacdc2', 'Mystic Evening is valid')
assert.equal(validatePalette('f8f9fa-e9ecef-dee2e6-ced4da-adb5bd-6c757d-495057-343a40-212529'), 'f8f9fa-e9ecef-dee2e6-ced4da-adb5bd-6c757d-495057-343a40-212529', 'Light Steel (9) is valid at the cap')
assert.equal(validState({ palette: '1a1423-b75d69', accent: '#ff0000' }).accent, null, 'an off-palette accent nulls, never rejects')

const fetches = []
const fakeFetchName = async (palette) => {
  fetches.push(palette)
  if (palette.startsWith('1a1423')) return 'Mystic Evening'
  if (palette.startsWith('000814')) return 'Palette' // the generic page heading
  throw new Error('offline') // name fetch failure is a non-event
}
const store = createPaletteStore(env, { fetchName: fakeFetchName })
assert.equal(store.read(), null, 'fresh home reads null')

const w1 = await store.write({ palette: '1a1423-372549-774c60-b75d69-eacdc2' })
assert.deepEqual(w1, { palette: '1a1423-372549-774c60-b75d69-eacdc2', accent: null, name: 'Mystic Evening' }, 'write fills the name best-effort')
assert.deepEqual(fetches, ['1a1423-372549-774c60-b75d69-eacdc2'], 'one name fetch per write')
const w2 = await store.write({ palette: 'cad2c5-84a98c-52796f-354f52-2f3e46', accent: '#52796f' })
assert.deepEqual(w2, { palette: 'cad2c5-84a98c-52796f-354f52-2f3e46', accent: '#52796f', name: null }, 'offline name answers null (Custom)')
assert.ok(fs.readFileSync(paletteFilePath(env), 'utf8').includes('"palette": "cad2c5'), 'file persists')
const w3 = await store.write({ palette: '000814-001d3d-003566-ffc300-ffd60a' })
assert.equal(w3.name, null, 'the generic page heading "Palette" is rejected as a name')
await assert.rejects(() => store.write({ palette: 'ff0000' }), /2-10 unique hex/, 'junk refused')

// The deselect race (live-caught 2026-09-11): the choice must LAND on disk
// before the best-effort name fetch — the 5s client poll reading the OLD
// palette inside the fetch window converged it back and reverted the pick.
{
  const envR = { ...process.env, ARXA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-palette-race-')) }
  let release
  const gate = new Promise((r) => { release = r })
  const racing = createPaletteStore(envR, { fetchName: () => gate })
  const first = racing.write({ palette: 'ff0000-00ff00' })
  await new Promise((r) => setTimeout(r, 25))
  const landed = JSON.parse(fs.readFileSync(paletteFilePath(envR), 'utf8'))
  assert.equal(landed.palette, 'ff0000-00ff00', 'the palette hits the disk BEFORE the name resolves')
  assert.equal(landed.name, null, 'a pending name never blocks the write')
  const second = racing.write({ palette: '1a1423-372549' })
  release('Slow Sunset')
  const [r1, r2] = await Promise.all([first, second])
  assert.equal(r1.name, null, 'a name that lost its race answers null')
  const after = JSON.parse(fs.readFileSync(paletteFilePath(envR), 'utf8'))
  assert.equal(after.palette, '1a1423-372549', 'the late name never clobbers the newer palette')
  assert.equal(r2.name, 'Slow Sunset', 'the name attaches to the write that still owns the file')
  fs.rmSync(envR.ARXA_HOME, { recursive: true, force: true })
}

// ── 3. the routes ─────────────────────────────────────────────────────────
const routes = {}
const ctx = { webServer: { register(r) { routes[r.path] = r } } }
apply(ctx, { store })
assert.equal(Object.keys(routes).length, 2, 'exactly two registrations (D84: one per path)')
const route = routes['/__arxa/theme-accent/palette']
const engineRoute = routes['/__arxa/theme-accent/contrast.js']

function fakeRes() {
  let done
  const promise = new Promise((resolve) => { done = resolve })
  const res = {
    statusCode: 0, headers: null, body: '', done: promise,
    writeHead(status, headers) { this.statusCode = status; this.headers = headers },
    end(body) { this.body = body; done(this) },
  }
  return res
}
function fakeReq(raw, method = 'GET') {
  return { method, on(ev, fn) { if (ev === 'end') queueMicrotask(fn); if (ev === 'data' && raw) fn(raw) } }
}

let r1 = fakeRes()
await route.handler(fakeReq(), r1); r1 = await r1.done
assert.equal(r1.statusCode, 200)
assert.equal(JSON.parse(r1.body).palette, '000814-001d3d-003566-ffc300-ffd60a', 'GET serves the persisted palette')

let r2 = fakeRes()
await route.handler(fakeReq(JSON.stringify({ palette: '1a1423-372549-774c60-b75d69-eacdc2', accent: '#b75d69' }), 'PUT'), r2); r2 = await r2.done
assert.equal(r2.statusCode, 200)
assert.equal(JSON.parse(r2.body).name, 'Mystic Evening', 'PUT answers the filled name')

let r3 = fakeRes()
await route.handler(fakeReq(), r3); r3 = await r3.done
assert.equal(JSON.parse(r3.body).accent, '#b75d69', 'GET reflects the PUT')

let r4 = fakeRes()
await route.handler(fakeReq(JSON.stringify({ palette: 'zzz' }), 'PUT'), r4); r4 = await r4.done
assert.equal(r4.statusCode, 400, 'junk PUT is 400')

let r5 = fakeRes()
await engineRoute.handler(fakeReq(), r5); r5 = await r5.done
assert.equal(r5.statusCode, 200)
assert.equal(r5.headers['content-type'], 'text/javascript; charset=utf-8', 'engine route is JS')
assert.equal(r5.body, fs.readFileSync(new URL('./lib/contrast.js', import.meta.url), 'utf8'), 'engine route serves lib/contrast.js byte-identical (ONE copy)')

fs.rmSync(env.ARXA_HOME, { recursive: true, force: true })

// ── 4. the client contract ────────────────────────────────────────────────
const clientSrc = fs.readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
// D86 lesson (ported 2026-09-11, the hard way — the live spike caught a
// missing paren that every string check below sailed past): the bundle
// must PARSE. A syntax error makes the webview load client.js without it
// ever calling __ModuleLoader__.load, while greps stay green.
{
  let parseErr = ''
  try { new (await import('node:vm')).Script(clientSrc, { filename: 'lib/client.js' }) } catch (e) { parseErr = String(e) }
  assert.equal(parseErr, '', 'client.js parses (syntax error = unloadable row)')
}
// the three built-ins, named as coolors names them (lens-verified)
for (const [name, palette] of [
  ['Mystic Evening', '1a1423-372549-774c60-b75d69-eacdc2'],
  ['Earthy Green', 'cad2c5-84a98c-52796f-354f52-2f3e46'],
  ['Light Steel', 'f8f9fa-e9ecef-dee2e6-ced4da-adb5bd-6c757d-495057-343a40-212529'],
]) {
  assert.ok(clientSrc.includes("name: '" + name + "'") && clientSrc.includes("palette: '" + palette + "'"), 'preset ' + name)
}
// the legacy world is gone
assert.ok(!clientSrc.includes('0EBAE4') && !clientSrc.includes('0EE4E0') && !clientSrc.includes('12D49A'), 'the three legacy hexes are gone')
assert.ok(!clientSrc.includes('const SWATCHES'), 'the swatch whitelist array is gone')
assert.ok(!clientSrc.includes('arxa.themeAccent'), 'the legacy storage key is gone from the bundle')
assert.ok(!clientSrc.includes('/__arxa/theme-accent\\u0027'), 'no bare legacy route')
// storage + server + engine wiring
assert.ok(clientSrc.includes("STORE_KEY = 'arxa.themePalette'"), 'palette storage key')
assert.ok(clientSrc.includes("SERVER_PATH = '/__arxa/theme-accent/palette'"), 'palette route path')
assert.ok(clientSrc.includes("ENGINE_URL = '/__arxa/theme-accent/contrast.js'"), 'engine import URL')
assert.ok(clientSrc.includes('norm.length >= 2 && norm.length <= 10'), 'parse enforces the coolors bounds 2-10')
assert.ok(clientSrc.includes('/\\/palette\\/([0-9a-fA-F#-]+)/'), 'parse accepts a coolors URL')
assert.ok(clientSrc.includes('palette: DEFAULT.palette, accent: null, name: DEFAULT.name'), 'no choice → the default palette (legacy hexes ignored)')
// the pair contract, pinned as strings (the behavior test below mirrors them)
assert.ok(clientSrc.includes("level: 'nontext'") && clientSrc.includes("level: 'body'"), 'both levels contracted')
assert.ok(clientSrc.includes("bgD1: washed['875'], bgD2: washed['850'], bgD3: washed['800']"), 'dark surfaces = the REAL stock bg-layer stops')
assert.ok(clientSrc.includes("bgL: washed['00']"), 'light bg = neutral-00 (every light bg layer reads it)')
assert.ok(clientSrc.includes("accentLight: E.mixOklab(accentHex, 78, '#FFFFFF')"), 'light accent = the deepseek-400 position')
assert.ok(!clientSrc.includes('onAccent'), 'no fictional accent-bg button pair (business-primary has zero background uses)')
assert.ok(clientSrc.includes('const NEUTRAL_MIX = 10'), 'wash mix pinned')
// 0.3.5 (operator 2026-09-12, "raise it"): ink stops fold double so text
// reads palette-hued; the painter AND the solveStudio mirror must agree.
assert.ok(clientSrc.includes('const INK_MIX = 15') && clientSrc.includes("new Set(['50', '200', '300', '400', '600', '700', '750', '1000'])"), 'ink stops (label aliases, both themes) wash at 15% — the strict minimum that still shows hue')
assert.ok(clientSrc.includes("accentDark + ' ' + mixFor(stop) + '%, rgb('"), 'the inline painter uses the per-stop mix')
assert.ok(clientSrc.includes('E.mixOklab(accentHex, mixFor(stop), grayHex(NEUTRAL_L[stop]))'), 'solveStudio computes pairs against the SAME per-stop wash')
assert.ok(clientSrc.includes("850: 44, 875: 35, 900: 27, 950: 21, 1000: 16"), 'the lightness ladder is pinned (scope A: hue moves, depth never)')
assert.ok(clientSrc.includes('maxC >= 0.04'), 'auto accent = most saturated, monochrome threshold')
assert.ok(clientSrc.includes('return sorted[1].hx'), 'monochrome falls to the 2nd-darkest (ascending puts darkest FIRST — index 1)')
assert.ok(clientSrc.includes('paintRamps(r.accentDark, r.accentLight)'), 'the SOLVED accents paint, not the anchors')
assert.ok(clientSrc.includes("stop === 400\n            ? accentLight"), 'the 400 position carries the light accent')
assert.ok(/E\.solveContrast\(slots, pairs, alt\)/.test(clientSrc), 'the engine solves the studio contract')
// consumers follow the key
assert.ok(fs.readFileSync(new URL('../prism/lib/client.js', import.meta.url), 'utf8').includes("'arxa.themePalette'"), 'prism reads the palette key')
assert.ok(fs.readFileSync(new URL('../pairing/lib/client.js', import.meta.url), 'utf8').includes("'arxa.themePalette'"), 'pairing reads the palette key')
// live-caught (2026-09-11, user-reported 000814-…-ffd60a): anchors must
// reach paintRamps as #-prefixed uppercase hexes — a bare hex the solve
// does not move paints an INVALID CSS color and the app breaks.
assert.ok(clientSrc.includes('const withHash = ('), 'withHash normalization exists in the client')
assert.ok(clientSrc.includes('accentDark: withHash(accentHex)'), 'solveStudio normalizes the anchor at entry')
assert.ok(clientSrc.includes('paintRamps(withHash(anchor), withHash(anchor))'), 'the offline fallback paints a paintable hex')
assert.ok(clientSrc.includes('best ? withHash(best.hx) : null'), 'the polarity alt returns a paintable hex')
// the generic coolors page heading ("Palette") is never a palette name
assert.ok(clientSrc.includes("v.name !== 'Palette'"), 'the client drops the generic "Palette" name')
assert.ok(fs.readFileSync(new URL('./lib/index.js', import.meta.url), 'utf8').includes("GENERIC_NAMES"), 'the host name-fetch rejects generic page headings')
// the Custom placeholder: a dashed 4th slot when no custom is active
assert.ok(clientSrc.includes('placeholder: true'), 'a Custom placeholder card exists')
assert.ok(clientSrc.includes('arxaAc_phCard') && clientSrc.includes('arxaAc_phStrip'), 'the placeholder has its dashed classes')
// the deselect race: a pick's PUT is tracked and a stale GET never reverts it
assert.ok(clientSrc.includes('let landing = null'), 'an in-flight pick PUT is tracked (landing)')
assert.ok(clientSrc.includes('if (landing) return'), 'converge refuses GETs that predate the in-flight pick')
assert.ok(clientSrc.includes('s.name && s.name !== cur.name'), 'a fetched NAME catching up adopts without a repaint')

// ── 4c. the remnant sweep (2026-09-11): nothing served stays stale ────────
// Scrollbars read the PLAIN neutral ramp — paintRamps washes it too.
assert.ok(clientSrc.includes("SCROLLBAR_NEUTRALS = { 200: '#e5e5e5'"), 'the scrollbar plain-neutral stops carry the palette wash')
assert.ok(clientSrc.includes("'--dsw-static-neutral-' + stop"), 'the plain-neutral paint loop exists')
// brand: zero legacy cyan; defaults are Mystic Evening SOLVED; the favicon
// follows the live ramp.
const brandSrc = fs.readFileSync(new URL('../brand/lib/client.js', import.meta.url), 'utf8')
assert.ok(!/0EBAE4|0EE4E0|08336F/.test(brandSrc), 'brand carries no legacy cyan anywhere')
assert.ok(brandSrc.includes('#C56975') && brandSrc.includes('#BC757D'), 'brand defaults are the Mystic Evening solved pair')
assert.ok(brandSrc.includes('refreshFavicon') && brandSrc.includes("--dsw-static-deepseek-500"), 'the favicon rebuilds from the live painted 500 stop')
assert.ok(brandSrc.includes("import('/__arxa/theme-accent/contrast.js')"), 'the favicon derives its stops from the ONE engine copy')
assert.ok(brandSrc.includes(':focus-visible { outline-color: var(--dsw-alias-state-business-primary); }'), 'native focus rings tint to the solved accent (no platform-blue remnant)')
// prism: fallback literals are palette defaults, never cyan.
assert.ok(!/0EBAE4|0ED6E4|14, 186, 228/.test(fs.readFileSync(new URL('../prism/lib/client.js', import.meta.url), 'utf8')), 'prism fallbacks are Mystic defaults, not cyan')
// waiting-page: the boot logo tints from the palette store.
const waitingSrc = fs.readFileSync(new URL('../waiting-page/lib/index.js', import.meta.url), 'utf8')
assert.ok(waitingSrc.includes('theme-palette.json') && waitingSrc.includes("replaceAll('#0EBAE4'"), 'the waiting-page logo swaps cyan for the palette accent')

// ── 4b. the real gate: every built-in SOLVES to WCAG 2.2 AA ───────────────
// The studio contract rebuilt exactly as the client builds it (constants
// pinned above), driven against the engine for each shipped preset + a
// nasty custom. Accent slots may be adjusted in LIGHTNESS (hue/chroma
// kept) or polarity-flipped to the palette's far end; labels and surfaces
// never move; what cannot clear is reported, never silently painted.
{
  const NEUTRAL_MIX = 10
  const INK_MIX = 15
  const INK_STOPS = new Set(['50', '200', '300', '400', '600', '700', '750', '1000'])
  const mixFor = (stop) => (INK_STOPS.has(stop) ? INK_MIX : NEUTRAL_MIX)
  const NEUTRAL_L = { '00': 254, 50: 250, 60: 245, 75: 241, 100: 238, 150: 236, 200: 230, 300: 209, 400: 177, 500: 156, 600: 132, 700: 100, 750: 68, 800: 53, 850: 44, 875: 35, 900: 27, 950: 21, 1000: 16 }
  const grayHex = (g) => '#' + [g, g, g].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
  const rgbOf = (hx) => [parseInt(hx.slice(0, 2), 16), parseInt(hx.slice(2, 4), 16), parseInt(hx.slice(4, 6), 16)]
  const solveStudio = (palette, forcedAccent) => {
    const hexes = palette.split('-')
    const labs = hexes.map((hx) => ({ hx, ok: E.toOklch(rgbOf(hx)) }))
    const maxC = labs.reduce((mx, x) => Math.max(mx, x.ok.c), 0)
    const anchor = forcedAccent
      || (maxC >= 0.04
        ? labs.slice().sort((a, b) => b.ok.c - a.ok.c)[0].hx
        : labs.slice().sort((a, b) => a.ok.l - b.ok.l)[1].hx)
    // RAW anchor in — exactly what the client's autoAccent feeds (bare,
    // lowercase) — then the entry normalization the client owes every
    // paint path (live-caught 2026-09-11: a bare hex that the solve does
    // not move painted an INVALID CSS color and the app broke).
    const withHash = (hx) => (/^#?[0-9a-fA-F]{6}$/.test(String(hx || '')) ? '#' + String(hx).replace(/^#/, '').toUpperCase() : hx)
    const accentHex = withHash(anchor)
    const washed = {}
    for (const s of Object.keys(NEUTRAL_L)) washed[s] = E.mixOklab(accentHex, mixFor(s), grayHex(NEUTRAL_L[s]))
    const slots = {
      accentDark: accentHex,
      accentLight: E.mixOklab(accentHex, 78, '#FFFFFF'),
      bgL: washed['00'],
      bgD1: washed['875'], bgD2: washed['850'], bgD3: washed['800'],
      labelPL: washed['1000'], labelPD: washed['50'],
      labelTL: washed['400'], labelTD: washed['600'],
    }
    const pairs = [
      { fg: 'accentLight', bg: 'bgL', level: 'nontext' },
      { fg: 'labelPL', bg: 'bgL', level: 'body' },
      { fg: 'labelTL', bg: 'bgL', level: 'nontext' },
      { fg: 'accentDark', bg: 'bgD1', level: 'nontext' },
      { fg: 'accentDark', bg: 'bgD2', level: 'nontext' },
      { fg: 'accentDark', bg: 'bgD3', level: 'nontext' },
      { fg: 'labelPD', bg: 'bgD1', level: 'body' },
      { fg: 'labelTD', bg: 'bgD1', level: 'nontext' },
    ]
    const anchorL = E.toOklch(rgbOf(anchor)).l
    const alt = (slot) => {
      if (slot !== 'accentDark') return null
      let best = null
      for (const hx of hexes) {
        if (hx === anchor) continue
        const l = E.toOklch(rgbOf(hx)).l
        if (best === null || Math.abs(l - anchorL) > Math.abs(best.l - anchorL)) best = { l, hx }
      }
      return best ? '#' + best.hx.toUpperCase() : null
    }
    const { hexes: solved } = E.solveContrast(slots, pairs, alt)
    const unsolved = pairs.filter((p) => (E.contrastRatio(solved[p.fg], slots[p.bg]) ?? 0) < E.pairTarget(p.level)).map((p) => p.fg + ' on ' + p.bg)
    return { anchor: accentHex, accentDark: solved.accentDark, accentLight: solved.accentLight, unsolved }
  }
  const presets = [...clientSrc.matchAll(/palette: '([0-9a-f-]+)'/g)].map((m) => m[1])
  assert.equal(presets.length, 3, 'three presets found in the shipped source')
  // The live-caught breakage class (2026-09-11, user-reported): an anchor
  // the solve does NOT move passes through VERBATIM — if it enters bare,
  // paintRamps writes an invalid CSS color and the app loses its accent.
  for (const p of [...presets, '000814-001d3d-003566-ffc300-ffd60a']) {
    const r = solveStudio(p)
    assert.ok(/^#[0-9A-F]{6}$/.test(r.accentDark) && /^#[0-9A-F]{6}$/.test(r.accentLight),
      p + ': the solved accents are #-prefixed paintable hexes (got ' + r.accentDark + ' / ' + r.accentLight + ')')
  }
  for (const p of presets) {
    const r = solveStudio(p)
    assert.deepEqual(r.unsolved, [], 'preset ' + p + ' solves to AA by construction (' + r.anchor + ' → dark ' + r.accentDark + ', light ' + r.accentLight + ')')
    if (r.accentDark.toUpperCase() !== r.anchor.toUpperCase() && r.accentDark.toUpperCase() !== (solveStudio(p).accentLight || '').toUpperCase()) {
      // an adjusted accent keeps its hue — unless it flipped polarity
      // (then hue difference is expected; the flip is the engine's law).
      const a = E.toOklch(rgbOf(r.anchor.slice(1)))
      const d = E.toOklch(rgbOf(r.accentDark.slice(1)))
      const flipped = Math.abs(a.l - d.l) > 0.5
      if (!flipped) assert.ok(Math.abs(a.h - d.h) < 0.15, 'preset ' + p + ': the solved dark accent keeps its hue (' + r.anchor + ' → ' + r.accentDark + ')')
    }
  }
  // a monochrome custom (Light Steel's family, 2 greys) — the near-black
  // anchor CANNOT read on the dark surfaces; the engine flips polarity to
  // the light end (its law), and the answer is honest either way.
  const nasty = solveStudio('343a40-f8f9fa', '343a40')
  assert.ok(Array.isArray(nasty.unsolved), 'custom solve answers with a residue list')
  if (nasty.unsolved.length === 0) {
    assert.ok((E.contrastRatio(nasty.accentDark, E.mixOklab('#343A40', 10, grayHex(53))) ?? 0) >= 3, 'the flipped custom clears the worst dark surface')
  }
}

// ── 5. editor font machinery intact (0.2.5 → 0.3.0 carries it verbatim) ──
// Pills + Add button speak the MEASURED dsh recipes (dist _pill_e3ygd_1 /
// _active_e3ygd_23 / _primary_cfgyt_38) — same UI language as the app.
assert.ok(clientSrc.includes('background:var(--dsw-alias-button-primary-fill)'), 'the Add button is a dsh primary button')
assert.ok(clientSrc.includes('background:var(--dsw-alias-button-ghost-active-fill)'), 'a selected pill uses the dsh ghost-active recipe')
assert.ok(/arxaAc_fontPill\{height:24px;padding:0 8px;border:none;/.test(clientSrc), 'the pill geometry is the measured dsh pill (h24 r12)')
assert.ok(clientSrc.includes('arxaAc_btn'), 'the Add button has its own primary class')
assert.ok(clientSrc.includes('FONT_STORE_KEY'), 'font choice storage key present')
assert.ok(clientSrc.includes('--arxa-editor-font'), 'font choice applies the editor var')
assert.ok(clientSrc.includes('fira-code-latin.woff2') && clientSrc.includes('fira-code-latin-ext.woff2'), 'both Fira Code subsets @font-faced')
assert.ok(clientSrc.includes('unicode-range:U+0100'), 'latin-ext unicode-range covers pl/fr')
assert.ok(clientSrc.includes('EditorFontRow') && clientSrc.includes("id: 'arxa-theme-accent-font'"), 'font row registered')
assert.ok(clientSrc.includes('removeProperty'), 'unknown font choice clears the editor var')
assert.ok(!clientSrc.includes('--dsw-font-mono'), 'no phantom --dsw-font-mono token anywhere')
assert.ok(clientSrc.includes('preloadEditorFont'), 'editor webfont preloads at plugin load')
assert.ok(clientSrc.includes("new FontFace('Fira Code Variable',"), 'faces register through the FontFace API')
assert.ok(clientSrc.includes('f.load()'), 'preload awaits face load, not just fetch')
assert.ok(clientSrc.includes('a => b >= c != d |> 0OoIl1 :: -> =>'), 'ligature battery intact')
assert.ok(clientSrc.includes('fontStackFor'), 'preview resolves its stack per pick')
assert.ok(clientSrc.includes("id: 'arxa-theme-accent',\n          order: 0"), 'palette row owns order 0')

console.log('arxa-theme-accent selftest: ALL GREEN')
