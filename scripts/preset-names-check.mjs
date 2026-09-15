#!/usr/bin/env node
// preset-names-check — the shipped-preset drift gate (grill round 3, 2026-09-14).
//
// bin/arxa-studio.mjs rewrites settings.yaml agent-presets.default → 'arxa'
// when it names a SHIPPED preset. That shipped set is a literal inside the
// launcher, and upstream renamed 'code' → 'ptc' before the 0.1.2-rc.1 wave
// without any arxa notice — a renamed or added preset name upstream means the
// rewrite silently misses real homes (the user keeps a shipped default
// forever). This gate makes the launcher's literal track the installed
// @deepseek-ai/dsh-agent-presets tree, offline and deterministically:
//   1. every preset the wave actually ships is IN the launcher's set;
//   2. every launcher entry NOT installed is a whitelisted legacy name below.
//
//   node scripts/preset-names-check.mjs
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let failed = 0
const ok = (label, cond, note = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${note ? '  — ' + note : ''}`)
  if (!cond) failed++
}

// 'code' — renamed to 'ptc' upstream; homes seeded before the rename may
// still carry the old literal, so the rewrite keeps working for them.
const LEGACY = new Set(['code'])

const installed = new Set(
  readdirSync(join(root, 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name))

const bin = readFileSync(join(root, 'bin', 'arxa-studio.mjs'), 'utf8')
const m = bin.match(/const shipped = new Set\(\[([^\]]*)\]\)/)
ok('launcher declares a shipped-preset set literal', !!m, m ? '' : 'anchor moved — update this gate')
const shipped = new Set(m ? (m[1].match(/'[^']+'/g) ?? []).map((s) => s.slice(1, -1)) : [])

const missing = [...installed].filter((p) => !shipped.has(p))
ok('every preset the wave ships is in the launcher rewrite set', missing.length === 0,
  missing.length ? `add to bin/arxa-studio.mjs: ${missing.join(', ')}` : [...installed].sort().join(', '))

const ghosts = [...shipped].filter((p) => !installed.has(p) && !LEGACY.has(p))
ok('launcher entries without an installed preset are whitelisted legacy', ghosts.length === 0,
  ghosts.length ? `not shipped by this wave, not in LEGACY: ${ghosts.join(', ')}` : '')

console.log(failed === 0 ? '\npreset names: intact' : `\npreset names: ${failed} BREAK(S)`)
process.exit(failed === 0 ? 0 : 1)
