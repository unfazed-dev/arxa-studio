#!/usr/bin/env node
// dsh-contract-check — the platform-pin lockstep gate (update-strategy
// amendment 2026-09-05: "arxa update = bump these pins, run the suite").
//
// arxa-studio composes dsh rather than forking it, so the relationship is a
// CONTRACT with the installed wave, and a bump that silently breaks half of
// it looks exactly like a green build with a dead plugin. This gate pins the
// mechanical half of that contract, offline and deterministically:
//
//   1. WAVE: the five direct @deepseek-ai/dsh* pins are EXACT (no carets —
//      a caret on a prerelease moves under you) and ALL EQUAL — one wave,
//      one version, the two-clocks doctrine's team-side face.
//   2. LOCKSTEP: every @deepseek-ai/dsh* package in the lockfile resolves to
//      that wave version. Exceptions are packages on upstream's OWN cadence,
//      named here so a new straggler is a red gate, not a surprise:
//        node-addon-landlock-run* — Linux sandbox addon, last published 0.1.1.
//   3. IMPORT SURFACE: every @deepseek-ai module arxa's host half actually
//      destructures resolves from this tree AND still exports the names the
//      plugins use (the artifact-viewer settingsNamespace removal of
//      0.1.2-rc.1 shipped exactly this class of break — caught then by a
//      selftest, now pinned here for the whole surface).
//   4. NO OVERRIDE: pi-ai is owned by upstream's own range again (the
//      temporary override was dropped at the 0.1.2-rc.1 bump when dsh-llm-pi-ai
//      declared ^0.84.2). An overrides block reappearing here is a decision
//      to un-make, not a fix to smuggle in.
//
//   node scripts/dsh-contract-check.mjs
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const require = createRequire(join(root, 'package.json'))

let failed = 0
const ok = (label, cond, note = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${note ? '  — ' + note : ''}`)
  if (!cond) failed++
}

// ---- 1. the wave -------------------------------------------------------------
const WAVE_PINS = ['dsh', 'dsh-authorization', 'dsh-base', 'dsh-headless', 'dsh-web-app']
const wave = pkg.dependencies['@deepseek-ai/dsh']
ok('wave version is exact (no range operators)', /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(wave), `pin: ${wave}`)
const offWave = WAVE_PINS.filter((p) => pkg.dependencies[`@deepseek-ai/${p}`] !== wave)
ok('all five direct dsh pins equal the wave version', offWave.length === 0,
  offWave.map((p) => `${p}=${pkg.dependencies[`@deepseek-ai/${p}`]}`).join(', '))

// ---- 2. lockstep -------------------------------------------------------------
// Packages on upstream's own version cadence, NOT the dsh wave. Every entry
// needs a reason; an unexplained straggler must stay red.
const OWN_CADENCE = [/^node-addon-landlock-run/]
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
const stragglers = []
// NOTE: filter on entry.name, not the lockfile path — nested deps
// (…/dsh-client-ui-trajectory/node_modules/@tanstack/react-virtual) have
// @deepseek-ai paths whose LEAF is an unrelated package.
for (const entry of Object.values(lock.packages)) {
  if (typeof entry.name !== 'string' || !entry.name.startsWith('@deepseek-ai/dsh')) continue
  if (entry.version !== wave && !OWN_CADENCE.some((re) => re.test(entry.name))) {
    stragglers.push(`${entry.name}@${entry.version}`)
  }
}
ok(`every @deepseek-ai/dsh* package in the lockfile is on the ${wave} wave`, stragglers.length === 0,
  stragglers.join(', ') || 'lockstep')

// ---- 3. the import surface ----------------------------------------------------
// [module, {exportName: typeof}] — the names the host half (plugins/*)
// actually destructures. BROWSER-RUNTIME ids (dsh-client-ui-primitives,
// dsh-client-runtime/client) are deliberately NOT here: they resolve inside
// dsh's in-browser __ModuleLoader__, not under node, and their contract is
// pinned by the vendored-mirror drift-gate selftests instead.
const SURFACE = [
  ['@deepseek-ai/cordis', { Context: 'function' }],
  ['@deepseek-ai/dsh-sandbox-policy', { SANDBOX_MODES: 'object', setSandboxMode: 'function' }],
  ['@deepseek-ai/dsh-sandbox', { canonicalPath: 'function', writableRoots: 'function' }],
  ['@deepseek-ai/dsh-sandbox-local', { default: 'function' }],
  ['@deepseek-ai/dsh-credentials', { credentialKey: 'function' }],
  ['@deepseek-ai/dsh-llm', { LlmAdapter: 'function' }],
  ['@deepseek-ai/schemastery', { default: 'function' }],
]
for (const [mod, exports] of SURFACE) {
  try {
    const imported = require(mod)
    for (const [name, kind] of Object.entries(exports)) {
      const value = imported[name] ?? (name === 'default' ? imported : undefined)
      ok(`${mod} exports ${name} (${kind})`, typeof value === kind || (kind === 'object' && Array.isArray(value)),
        typeof value)
    }
  } catch (e) {
    ok(`import surface resolves: ${mod}`, false, String(e.message).split('\n')[0].slice(0, 90))
  }
}

// ---- 4. no override ------------------------------------------------------------
const overridesPi = pkg.overrides?.['@earendil-works/pi-ai']
ok('pi-ai is upstream-owned (no overrides block pinning it)', overridesPi === undefined,
  overridesPi ? `overrides.${'@earendil-works/pi-ai'} = ${overridesPi}` : '')

console.log(failed === 0
  ? `\ndsh contract: intact — ${wave} wave, one version, surface resolves`
  : `\ndsh contract: ${failed} BREAK(S) — read the notes above before shipping`)
process.exit(failed === 0 ? 0 : 1)
