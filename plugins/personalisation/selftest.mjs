// arxa-personalisation selftest — run: node plugins/personalisation/selftest.mjs
//
// 0.2.0 (2026-09-12, operator): the Appearance row MOVES from General to the
// top of Personalisation. Pinned here: the two registrations (real row at
// order -10; the General cell replaced by nothing under the same shipped id),
// the theme-service contract (getTheme/setTheme/'theme/change'), ui-theme's
// verbatim cube recipe, and the icon names drift-gated against ui-theme's own
// bundle (the mirror — dsh-client-ui-primitives only resolves in-browser).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { stockFile } from '../../scripts/stock-path.mjs'

const src = fs.readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')

// D86 lesson (ported): the bundle must PARSE — a syntax error unloads the
// whole section silently while every string check below stays green.
{
  let parseErr = ''
  try { new (await import('node:vm')).Script(src, { filename: 'lib/client.js' }) } catch (e) { parseErr = String(e) }
  assert.equal(parseErr, '', 'client.js parses (syntax error = no section at all)')
}

// The move: two registrations under the SAME shipped id.
assert.ok(src.includes("slots.inject('settings.personalisation.item', () =>"), 'the real row registers into Personalisation')
assert.ok(src.includes("id: 'appearance',\n          order: -10,"), 'the Appearance row sits at the TOP (order -10, above the Palette row\'s 0)')
assert.ok(src.includes("slots.inject('settings.general.item', () =>"), 'the General cell is re-registered')
assert.ok(/id: 'appearance',[\s\S]{0,300}?priority: -1,[\s\S]{0,60}?\}, \(\) => null\)/.test(src), 'the General cell renders nothing (same id at priority -1 shadows the shipped row — lowest renders)')
// 0.2.1: the Font size row follows, as the THIRD row.
assert.ok(src.includes("id: 'font-size',\n          order: 5,"), 'the Font size row is the THIRD row (order 5: below Palette, above Editor font)')
assert.ok(/id: 'font-size',[\s\S]{0,120}?priority: -1,[\s\S]{0,60}?\}, \(\) => null\)/.test(src), "General's font-size cell renders nothing (same id at priority -1)")
assert.ok(src.includes('.setFontSize(fontSize + 1)') && src.includes('.setFontSize(fontSize - 1)'), 'writes via setFontSize(px)')
assert.ok(src.includes('disabled: fontSize >= 17') && src.includes('disabled: fontSize <= 12'), 'the stepper bounds are the runtime\'s own 12..17 law')
assert.ok(src.includes("'Only affects conversation content'"), 'the description copy is ui-theme\'s own')
assert.ok(src.includes('font-variant-numeric:tabular-nums'), 'the value readout is tabular (dsh stepper recipe)')
assert.ok(src.includes('border-radius:18px;justify-content:center;align-items:center;min-width:72px;'), 'the stepper pill geometry is the dsh recipe (r18, 72x36)')
assert.ok(src.includes('.arxaFs_arrow:disabled{color:var(--dsw-alias-label-caption);cursor:default}'), 'disabled arrows dim to label-caption (dsh recipe)')
assert.ok(src.includes('.arxaFs_stepper:hover .arxaFs_arrows,.arxaFs_stepper:focus-within .arxaFs_arrows{opacity:1}'), 'arrows reveal on hover/focus-within (dsh recipe)')
// The service contract, exactly as ui-theme publishes it.
assert.ok(src.includes("pluginCtx.get('theme')"), 'reads the provided theme service (at render time — ui-theme may provide it late)')
assert.ok(src.includes(".getTheme().preference"), 'current preference via getTheme()')
assert.ok(src.includes(".setTheme(id)"), 'writes via setTheme(id)')
assert.ok(src.includes("'theme/change'"), 'continuous sync via the theme/change event')
// The cube recipe: ui-theme's own AppearanceRow.module.css, verbatim geometry.
assert.ok(/arxaPers_cube\{box-sizing:border-box;border:\.5px solid var\(--dsw-alias-border-l4\)/.test(src), 'cube border is the dsh recipe')
assert.ok(src.includes('border-radius:20px;flex-direction:column;flex:180px;'), 'cube geometry (r20, flex-basis 180px) is the dsh recipe')
assert.ok(src.includes('padding:20px 32px;font-size:14px;line-height:22px'), 'cube padding/type is the dsh recipe')
assert.ok(src.includes('background:var(--dsw-alias-bg-module-platform);'), 'selected cube fills with bg-module-platform')
assert.ok(src.includes('border-color:var(--dsw-static-neutral-bluish-400)'), 'selected cube rings neutral-bluish-400')
assert.ok(src.includes('background:var(--dsw-alias-interactive-bg-hover)}'), 'unselected hover is interactive-bg-hover')
assert.ok(src.includes('border-bottom:.5px solid var(--dsw-alias-border-l2);'), 'the row chrome carries the .5px section hairline')
// The icons: names drift-gated against ui-theme's own bundle (the mirror —
// primitives resolves only inside the browser __ModuleLoader__).
const mirror = fs.readFileSync(
  new URL(pathToFileURL(stockFile('@deepseek-ai/dsh-client-ui-theme')).href), 'utf8')
for (const icon of ['IconLightOutline16', 'IconDarkOutline16', 'IconFollowsystemOutline16', 'IconChevronUpOutline14', 'IconChevronDownOutline14']) {
  assert.ok(src.includes('P.' + icon), 'uses ' + icon)
  assert.ok(mirror.includes(icon), 'ui-theme still ships ' + icon + ' (mirror drift gate)')
}
// The Palette row still owns order 0 — Appearance (-10) above, Font size (5) below.
const accentSrc = fs.readFileSync(new URL('../theme-accent/lib/client.js', import.meta.url), 'utf8')
assert.ok(accentSrc.includes("id: 'arxa-theme-accent',\n          order: 0"), 'the Palette row still owns order 0 in Personalisation')
assert.ok(accentSrc.includes("id: 'arxa-theme-accent-font',\n          order: 10"), 'the Editor font row still owns order 10 (Font size at 5 slots between)')

console.log('arxa-personalisation selftest: ALL GREEN')
