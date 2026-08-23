// Generate a frozen-frame fixture for the gen-ui entrance choreography, for
// appbox-lens evidence. Both stylesheets are slice-evaluated from the REAL
// lib/client.js (same technique as selftest.mjs), so the fixture can never
// drift from the plugin. The freeze scaffolding is fixture-only: pausing an
// animation with a negative delay pins it at an absolute millisecond offset,
// which turns the 850ms choreography into deterministic stills.
//
//   node plugins/gen-ui/enter-fixture.mjs [out.html]
//
// Then: appbox lens check file://<out> <evidence.png> 900 640 1800 --expect ...

import { readFileSync, writeFileSync } from 'node:fs'

const src = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')

function sliceBlock (startMarker, fnMarker) {
  const start = src.indexOf(startMarker)
  if (start < 0) throw new Error('marker missing: ' + startMarker)
  const end = src.indexOf('\n    }', src.indexOf(fnMarker, start))
  if (end < 0) throw new Error('end not found for ' + fnMarker)
  return src.slice(start, end + 6)
}

const ACCENT = 'rgb(122,149,87)' // the client.js fallback token
/* eslint-disable no-new-func */
const { GLOW_CSS } = new Function('accent', sliceBlock('const GLOW_CLASS', 'function installGlow') + '; return { GLOW_CSS }')(ACCENT)
const { ENTER_CSS } = new Function('accent', sliceBlock('const ENTER_CLASS', 'function installEnter') + '; return { ENTER_CSS }')(ACCENT)

// Fixture-only scaffolding: page chrome + freeze frames. Never shipped.
const SCAFFOLD = [
  'body { font: 13px/1.5 system-ui, sans-serif; background: #151518; color: #ddd; padding: 24px; }',
  '.col { width: 520px; margin: 0 auto; border: 1px solid #333; border-radius: 8px;',
  '  padding: 12px; display: flex; flex-direction: column; gap: 8px; }',
  '.cap { color: #777; font-size: 11px; margin: 10px 0 0; }',
  'p { margin: 4px 0; }',
  '.hd { font-size: 15px; font-weight: 600; margin: 8px 0 4px; }',
  '.cta { padding: 5px 12px; border-radius: 6px; font-weight: 600; text-align: center;',
  '  background: ' + ACCENT + '; color: #0d0d10; }',
  // Static freeze states. The paused-negative-delay trick does not survive
  // fill-mode forwards in headless Chromium (a never-played paused animation
  // resolves to base values), so the frozen states are painted STATICALLY —
  // the REAL ring paint (masked conic gradient, registered angle) with the
  // animation off, the rise states as inline opacity/transform. Timing is
  // proven by the live recording, not by these stills.
  '.st-ring::after { animation: none !important; opacity: 0.75; }',
  '.st-gone::after { animation: none !important; opacity: 0; }',
  // ...and the rise animation must die on static nodes too: CSS animations
  // override inline styles in the cascade, so a completed rise would stomp
  // the frozen opacity. (This is why C, which runs them for real, settles.)
  '.st-ring > .arxa-genui-enter-rise, .st-gone > .arxa-genui-enter-rise { animation: none !important; }',
].join('\n')

// Each row mirrors renderEntry exactly: ring host (never fades) > rise box.
// riseStyle replicates a frozen rise state (inline, static).
const row = (extra, style, inner, riseStyle) =>
  `<div class="arxa-genui-enter ${extra}" style="${style}">` +
  `<div class="arxa-genui-enter-rise" style="${riseStyle ?? ''}">${inner}</div></div>`

const FIT = 'width: fit-content; max-width: 100%'
const html = [
  '<!doctype html><meta charset="utf-8"><title>gen-ui entrance fixture</title>',
  '<style>' + GLOW_CSS + '</style>',
  '<style>' + ENTER_CSS + '</style>',
  '<style>' + SCAFFOLD + '</style>',
  '<div class="col">',
  // A/B/D/E are static stills (see SCAFFOLD note); C runs the REAL
  // animations, which complete well before the lens settle. Assertions
  // touch the statics for state and C for the real end state.
  '  <div class="cap">A — ring LEADS: sweep visible, content still hidden</div>',
  row('st-ring txt', FIT + '; --arxa-glow-angle: 130deg', '<p>Fast setup</p>', 'opacity: 0'),
  '  <div class="cap">B — ring done, content mid-rise</div>',
  row('st-gone txt', FIT, '<p>Unlimited projects</p>', 'opacity: 0.45; transform: translateY(4px)'),
  '  <div class="cap">C — settled (nothing lingers)</div>',
  row('settled txt', FIT, '<p>Team roles</p>'),
  '  <div class="cap">D — full-width node: the ring spans the whole bar</div>',
  row('st-ring bar', '--arxa-glow-angle: 220deg', '<div class="cta">Start free</div>', 'opacity: 0'),
  '  <div class="cap">E — heading ink, hugged</div>',
  row('st-ring txt', FIT + '; --arxa-glow-angle: 300deg', '<div class="hd">Studio</div>', 'opacity: 0'),
  '</div>',
].join('\n')

const out = process.argv[2] ?? '/tmp/gen-ui-enter-fixture.html'
writeFileSync(out, html)
console.log('wrote', out)

// ---- the live loop, for lens record/burst -------------------------------
// The same REAL css, playing for real. The choreography re-runs every 3.5s
// (innerHTML swap = fresh nodes = fresh animations) so a recording started
// anywhere after navigation is guaranteed one full cycle. Batch delays are
// spread wider than the app's 90ms steps so single frames catch distinct
// phases; per node the contract is the real one: ring [D, D+600], rise
// [D+600, D+850].
const LIVE_ROWS = [
  '  <div class="cap">A — Text, batch delay 0 (ring, then rise)</div>',
  row('txt', '--arxa-enter-delay: 0ms; ' + FIT, '<p>Fast setup</p>'),
  '  <div class="cap">B — Text, batch delay 400ms</div>',
  row('txt', '--arxa-enter-delay: 400ms; ' + FIT, '<p>Unlimited projects</p>'),
  '  <div class="cap">C — Heading, batch delay 800ms</div>',
  row('txt', '--arxa-enter-delay: 800ms; ' + FIT, '<div class="hd">Studio</div>'),
  '  <div class="cap">D — full-width Button bar, batch delay 1200ms</div>',
  row('bar', '--arxa-enter-delay: 1200ms', '<div class="cta">Start free</div>'),
  '  <div class="cap">E — replay reference: no wrapper, never animates</div>',
  '  <p>Priority support</p>',
].join('\n')

const live = [
  '<!doctype html><meta charset="utf-8"><title>gen-ui entrance fixture (live)</title>',
  '<style>' + GLOW_CSS + '</style>',
  '<style>' + ENTER_CSS + '</style>',
  '<style>' + SCAFFOLD + '</style>',
  '<div class="col" id="col">' + LIVE_ROWS + '</div>',
  '<script>const col = document.getElementById("col"), rows = col.innerHTML;' +
  'setInterval(() => { col.innerHTML = rows }, 3500)</scr' + 'ipt>',
].join('\n')
const liveOut = out.replace(/\.html$/, '') + '-live.html'
writeFileSync(liveOut, live)
console.log('wrote', liveOut)

// ---- the studio sim (faithful reproduction) -------------------------------
// The tenth run's actual payload and cadence (session e0b1b8ce, 2026-08-23:
// 8 fold steps ~705ms apart, one component per call, pcta last at 4936ms) on
// the REAL stylesheets: a toolview div carrying the warm ring, the card
// component, children inserted at their measured arrival times, stubs below.
// ?warm=always reproduces the pre-fix double ring at the button;
// ?warm=fixed plays the arrival-suppressed state machine.
const SIM_CSS = [
  '.tv { position: relative; max-width: 560px; margin: 24px auto; border-radius: 10px;',
  '  border: 1px solid #2a2a2e; padding: 12px 14px; background: #1b1b1f; }',
  '.tv-h { font-weight: 600; margin-bottom: 8px; }',
  '.stub { color: #777; font-size: 12px; padding: 2px 0; }',
].join('\n')

// The card container is one entering node; its children arrive one per fold
// step. Each is rendered as the real two boxes (ring host > rise box).
const CARD_HTML = '<div id="pcard" style="border: 1px solid #333; border-radius: 8px;' +
  ' padding: 12px; display: flex; flex-direction: column; gap: 8px"></div>'
const SIM_STEPS = [
  { t: 0, html: CARD_HTML, fit: false, host: true },
  { t: 705, html: '<div class="hd">Studio</div>', fit: true },
  { t: 1410, html: '<p>$29 / month</p>', fit: true },
  { t: 2115, html: '<p>\u2713 Fast setup</p>', fit: true },
  { t: 2820, html: '<p>\u2713 Unlimited projects</p>', fit: true },
  { t: 3525, html: '<p>\u2713 Team roles</p>', fit: true },
  { t: 4230, html: '<p>\u2713 Priority support</p>', fit: true },
  { t: 4935, html: '<div class="cta">Start free</div>', fit: false },
]

const simHtml = [
  '<!doctype html><meta charset="utf-8"><title>studio sim</title>',
  '<style>' + GLOW_CSS + '</style>',
  '<style>' + ENTER_CSS + '</style>',
  '<style>' + SCAFFOLD + SIM_CSS + '</style>',
  '<div class="tv" id="tv"><div class="tv-h">Studio pricing card</div><div id="surf"></div></div>',
  '<div id="stubs" style="max-width:560px;margin:0 auto"></div>',
  '<script>const NODES = ' + JSON.stringify(SIM_STEPS) + ';',
  'const FIX = location.search.includes("warm=fixed");',
  'const FITCSS = ' + JSON.stringify(FIT) + ';',
  'const tv = document.getElementById("tv"), surf = document.getElementById("surf"), stubs = document.getElementById("stubs");',
  'function enterBox(n) { const h = document.createElement("div"); h.className = "arxa-genui-enter";',
  '  if (n.fit) h.style.cssText = FITCSS; const r = document.createElement("div");',
  '  r.className = "arxa-genui-enter-rise"; r.innerHTML = n.html; h.appendChild(r); return h }',
  'function setWarm(on) { tv.classList.toggle("arxa-genui-pending", on) }',
  'setWarm(!FIX) // fixed mode: the arrival window owns the accent',
  'NODES.forEach((n, k) => setTimeout(() => {',
  '  if (n.host) surf.appendChild(enterBox(n)); else document.getElementById("pcard").appendChild(enterBox(n))',
  '  if (k > 0) { const d = document.createElement("div"); d.className = "stub"; d.textContent = "\u2191 assembled into Studio pricing card \u2014 step " + (k + 1); stubs.appendChild(d) }',
  '}, n.t))',
  '// warm state machine: always = pre-fix (on until 1500ms after the last',
  '// arrival); fixed = suppressed while any arrival plays (600 ring + 250',
  '// rise), then a 650ms tail pulse inside the warm window, then done.',
  'setTimeout(() => { if (FIX) setWarm(true) }, 4935 + 850)',
  'setTimeout(() => setWarm(false), 4935 + 1500)',
  '</scr' + 'ipt>',
].join('\n')
const simOut = out.replace(/\.html$/, '') + '-sim.html'
writeFileSync(simOut, simHtml)
console.log('wrote', simOut)