// Copies the arxa agent preset (profile/agent-presets/arxa/) into a dsh
// home's .agent-presets/arxa/ — the agent-plane analog of the profile patch
// copy in arxa-studio.mjs (profile/cordis.patch.yml ->
// <dshHome>/profiles/arxa/cordis.patch.yml). Extracted into its own module
// so scripts/preset-check.mjs can exercise the same code path against a
// temp DSH_HOME without booting the rest of arxa-studio.mjs.
import { cpSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export function materialisePreset(dshHome, presetSrcDir) {
  const presetDir = join(dshHome, '.agent-presets', 'arxa')
  mkdirSync(presetDir, { recursive: true })
  cpSync(presetSrcDir, presetDir, { recursive: true })
  return presetDir
}
