// Copies the arxa agent preset (profile/agent-presets/arxa/) into a dsh
// home's .agent-presets/arxa/ — the agent-plane analog of the profile patch
// copy in arxa-studio.mjs (profile/cordis.patch.yml ->
// <dshHome>/profiles/arxa/cordis.patch.yml). Extracted into its own module
// so scripts/preset-check.mjs can exercise the same code path against a
// temp DSH_HOME without booting the rest of arxa-studio.mjs.
import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

// Three preset rows name a plugin by ABSOLUTE path (agent.cordis.yml rows
// arxa-memory, arxa-pi-delegate, arxa-claude-code-tools). An absolute path is
// stable only on the machine that wrote it, and the checked-in file carries
// the BUILD machine's checkout — so on every install but that one, all three
// rows failed to resolve and the whole `arxa` preset refused to mount
// ("3 rows name plugins that cannot be resolved", measured on Omarchy
// 2026-09-08). Every session then silently ran the host default composition,
// without arxa's memory, pi-delegate or claude-code tools.
//
// The install ships those files at <installRoot>/plugins/..., so repoint each
// row at THIS install. Rewrite only when the rewritten file actually exists:
// a bare package name, a relative path, and an absolute path we cannot place
// are all left exactly as written rather than replaced with a guess.
export function rewritePluginRoots(yaml, installRoot) {
  const marker = sep + 'plugins' + sep
  return yaml.replace(/^(\s*(?:-\s+)?name:\s*)(\/\S+)$/gm, (line, head, target) => {
    const at = target.replace(/\//g, sep).lastIndexOf(marker)
    if (at === -1) return line
    const rebased = resolve(installRoot, target.slice(at + 1))
    return existsSync(rebased) ? head + rebased : line
  })
}

export function materialisePreset(dshHome, presetSrcDir) {
  const presetDir = join(dshHome, '.agent-presets', 'arxa')
  mkdirSync(presetDir, { recursive: true })
  cpSync(presetSrcDir, presetDir, { recursive: true })
  // presetSrcDir is <installRoot>/profile/agent-presets/arxa
  const installRoot = resolve(presetSrcDir, '..', '..', '..')
  const composition = join(presetDir, 'agent.cordis.yml')
  if (existsSync(composition)) {
    const src = readFileSync(composition, 'utf8')
    const out = rewritePluginRoots(src, installRoot)
    if (out !== src) writeFileSync(composition, out)
  }
  return presetDir
}
