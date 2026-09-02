// Checks the arxa agent preset / host patch split (docs/plans/
// arxa-harness-and-distribution.md). GREEN/RED per check, non-zero exit on
// any failure — same report shape as scripts/ci.mjs.
//
// Uses js-yaml to parse both preset files and the host patch. NOTE: js-yaml
// is NOT a direct dependency of this package (package.json lists only the
// @deepseek-ai/dsh-* bundles) — it resolves here only because npm hoists it
// as a transitive dependency of @deepseek-ai/dsh-agent-presets. That is an
// undeclared-dependency risk: an npm install elsewhere in the tree could
// stop hoisting it flat and this script would fail to resolve. Flagged, not
// fixed, per instruction not to add a dependency without saying so.
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
    if (Array.isArray(entry.insert)) collectIds(entry.insert, out)
    if (Array.isArray(entry.config)) collectIds(entry.config, out)
  }
  return out
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
