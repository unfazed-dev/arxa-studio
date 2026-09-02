// Checks the arxa agent preset / host patch split (docs/plans/
// arxa-harness-and-distribution.md). GREEN/RED per check, non-zero exit on
// any failure — same report shape as scripts/ci.mjs.
//
// Uses js-yaml to parse both preset files and the host patch. js-yaml is
// declared in package.json's devDependencies (pinned to ^4.3.1, matching
// what was already hoisted) — only this dev-time check script imports it;
// bin/arxa-studio.mjs and bin/materialise-preset.mjs don't use it at
// runtime, so it isn't a `dependencies` entry.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { materialisePreset } from '../bin/materialise-preset.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const presetDir = join(root, 'profile', 'agent-presets', 'arxa')
const compositionFile = join(presetDir, 'agent.cordis.yml')
const metadataFile = join(presetDir, 'preset.yml')
const hostPatchFile = join(root, 'profile', 'cordis.patch.yml')

// The host patch and both preset files use dsh's `!!js <expr>` custom tag
// (e.g. `!!js process.cwd()`) to evaluate JS in the composition context.
// This check only needs structure, not evaluation, so the tag is accepted
// as an opaque scalar rather than run.
const jsTag = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: (data) => data,
})
const SCHEMA = yaml.DEFAULT_SCHEMA.extend([jsTag])
const parseCordis = (file) => yaml.load(readFileSync(file, 'utf8'), { schema: SCHEMA })

function collectIds(list, out = new Set()) {
  if (!Array.isArray(list)) return out
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    if (entry.id) out.add(entry.id)
    if (Array.isArray(entry.config)) collectIds(entry.config, out)
  }
  return out
}

// Mirrors dsh-agent-presets' own pre-mount health check (entryListProblem in
// @deepseek-ai/dsh-agent-presets/lib/index.js): every row must be a map with
// a `name` string, or the WHOLE preset is discovered as broken and refuses
// to mount. `insert:` is cordis-plugin-include's PATCH verb (the form
// profile/cordis.patch.yml uses) — a bare `- insert: [...]` row has no
// `name` and fails this exact check. A preset's agent.cordis.yml must never
// use it; this function catches that class of mistake mechanically.
function entryListProblem(rows, at = '') {
  if (!Array.isArray(rows)) return at === '' ? 'the composition must be a top-level list of plugin rows' : `group ${at} must hold a list of plugin rows`
  for (const [index, row] of rows.entries()) {
    const label = at === '' ? `row ${index + 1}` : `${at} row ${index + 1}`
    if (!row || typeof row !== 'object' || Array.isArray(row)) return `${label} is not a plugin row (expected a map with a "name")`
    if (row.insert !== undefined) return `${label} uses the patch-only \`insert:\` verb — not valid in a preset composition`
    const { name, group, config } = row
    if (typeof name !== 'string' || name === '') return `${label} names no plugin (a "name" string is required)`
    if (group === true) {
      const nested = entryListProblem(config, label)
      if (nested !== undefined) return nested
    }
  }
}

// Finds a row by id, recursing into group rows' config lists the same way
// collectIds does. Used to pull matching rows out of the preset and the
// host patch for a byte-for-byte config comparison.
function findRow(rows, id) {
  if (!Array.isArray(rows)) return undefined
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    if (row.id === id) return row
    if (Array.isArray(row.config)) {
      const nested = findRow(row.config, id)
      if (nested) return nested
    }
  }
  return undefined
}

// Plain structural equality — good enough for cordis row `config` blocks
// (nested maps/arrays of strings, numbers, booleans). Key order doesn't
// matter; array/object shape does.
function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]))
}

let failed = 0
function check(label, ok, detail) {
  console.log((ok ? 'GREEN  ' : 'RED    ') + label)
  if (!ok) { failed++; if (detail) console.log('  ' + detail) }
}

// -- 1. preset files parse, and expected rows are present -------------------
const presetEntries = parseCordis(compositionFile)
const presetIds = collectIds(presetEntries)
const expectedPresetIds = [
  'persona', 'agent-instructions', 'arxa-memory',
  'tool-bash', 'tool-pwsh', 'tool-fs', 'tool-fs-search', 'tool-jobs',
  'skill-filesystem', 'tool-skill', 'tool-goal',
  'planning', 'plan-mode',
  'compaction', 'compaction-basic', 'command-compact', 'tool-result-pruner',
  'delegation', 'tool-subagent-control', 'tool-subagent-list-agents',
  'tool-subagent', 'tool-subagent-fork', 'tool-subagent-codex',
  'tool-subagent-claude-code', 'workflow-worker-thread', 'tool-workflow',
  'tool-ralph', 'arxa-pi-delegate',
  'tool-ask-user', 'tool-todo', 'tool-web', 'arxa-gen-ui',
]
const missing = expectedPresetIds.filter((id) => !presetIds.has(id))
check('agent.cordis.yml parses and has all expected row ids', missing.length === 0,
  missing.length ? 'missing: ' + missing.join(', ') : '')
check('agent.cordis.yml has no tool-cordis / skill-authoring rows',
  !presetIds.has('tool-cordis'))

const shapeProblem = entryListProblem(presetEntries)
check('agent.cordis.yml rows match dsh-agent-presets\' health check shape (no `insert:`, every row has a name)',
  shapeProblem === undefined, shapeProblem || '')

const metadata = yaml.load(readFileSync(metadataFile, 'utf8'))
check('preset.yml has name/description/order',
  typeof metadata?.name === 'string' && typeof metadata?.description === 'string'
  && typeof metadata?.order === 'number')

// -- 2. the three moved rows are absent from the host patch -----------------
const hostEntries = parseCordis(hostPatchFile)
const hostIds = collectIds(hostEntries)
const moved = ['arxa-memory', 'arxa-pi-delegate', 'arxa-gen-ui']
const stillInHost = moved.filter((id) => hostIds.has(id))
check('moved rows are absent from profile/cordis.patch.yml', stillInHost.length === 0,
  stillInHost.length ? 'still present: ' + stillInHost.join(', ') : '')
const missingFromPreset = moved.filter((id) => !presetIds.has(id))
check('moved rows are present in the arxa preset', missingFromPreset.length === 0,
  missingFromPreset.length ? 'missing: ' + missingFromPreset.join(', ') : '')

// A preset-mounted session runs the preset's own agent-instructions row, in
// its own mounted subtree — never the host composition's patched copy. So
// the host patch's restriction to AGENTS.md only (profile/cordis.patch.yml)
// has to be repeated in the preset's row or it silently never applies to a
// preset-mounted session. This check keeps the two configs from drifting.
const presetInstructionsRow = findRow(presetEntries, 'agent-instructions')
const hostInstructionsRow = findRow(hostEntries, 'agent-instructions')
// Guard against both configs being absent: deepEqual(undefined, undefined)
// is true, so a plain equality check would go GREEN if the restriction were
// deleted from both rows. Require the actual restriction to be present, not
// just "the two sides agree with each other" (which "both empty" satisfies).
const presetCandidates = presetInstructionsRow?.config?.instructionFileCandidates
const hasRestriction = Array.isArray(presetCandidates)
  && presetCandidates.length === 1 && presetCandidates[0] === 'AGENTS.md'
const instructionsConfigsMatch = Boolean(presetInstructionsRow) && Boolean(hostInstructionsRow)
  && hasRestriction && deepEqual(presetInstructionsRow.config, hostInstructionsRow.config)
check('preset agent-instructions config matches host patch\'s agent-instructions config',
  instructionsConfigsMatch,
  instructionsConfigsMatch ? '' : 'preset: ' + JSON.stringify(presetInstructionsRow?.config)
    + ' vs host: ' + JSON.stringify(hostInstructionsRow?.config))

// -- 3. materialise writes the preset files under a temp DSH_HOME -----------
const tmpDshHome = mkdtempSync(join(tmpdir(), 'arxa-preset-check-'))
try {
  const writtenDir = materialisePreset(tmpDshHome, presetDir)
  check('materialisePreset writes agent.cordis.yml',
    existsSync(join(writtenDir, 'agent.cordis.yml')))
  check('materialisePreset writes preset.yml',
    existsSync(join(writtenDir, 'preset.yml')))
} finally {
  rmSync(tmpDshHome, { recursive: true, force: true })
}

if (failed > 0) {
  console.log('preset-check: ' + failed + ' FAILURE(S)')
  process.exit(1)
}
console.log('preset-check: ALL GREEN')
