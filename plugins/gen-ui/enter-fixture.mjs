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