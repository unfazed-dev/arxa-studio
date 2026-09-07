/**
 * Skill packs — the arxa (and user) Claude Code plugins a turn loads.
 *
 * Phase 2 of the subscription engine: Claude Code's own `plugins:` seam
 * (SdkPluginConfig, sdk.d.ts:4818) loads skills/commands/agents/hooks from a
 * LOCAL directory. That is how an arxa pipeline skill (designer, lens, intake)
 * reaches a studio turn without arxa re-implementing skills on top of the SDK.
 *
 * D5 says a turn reads NO filesystem settings (`settingSources: []`), and this
 * does not weaken that: nothing is discovered from the user's `~/.claude`, the
 * project tree, or anything Claude finds on its own. Only directories arxa
 * resolves here are passed, and every one is loaded with
 * `skipMcpDiscovery: true` — a pack's own `.mcp.json` would otherwise open MCP
 * connections outside arxa's sandbox and outside the approval bridge, which the
 * mcp-bridge owns.
 *
 * Roots, in precedence order (first pack of a given name wins):
 *   1. `ARXA_SKILL_PACKS` — colon-separated PACK directories. The dev and test
 *      door; also how a packaged build could pin an exact set.
 *   2. `$ARXA_HOME/skill-packs/<pack>` — what a user installs. Works with no
 *      database and no account, which the distribution boundary requires.
 *   3. `<appRoot>/skill-packs/<pack>` — packs shipped inside the app bundle.
 *      None ship today; the resolver is ready for the first that does.
 *
 * A pack is a directory holding `.claude-plugin/plugin.json` with a `name` —
 * Claude Code's own plugin marker, so a pack that works here works when the
 * user points the CLI at it too. Anything else in a root is ignored: a broken
 * pack must never cost a turn.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const PACKS_DIRNAME = 'skill-packs'
export const MANIFEST_REL = join('.claude-plugin', 'plugin.json')

const arxaHome = (env) => env.ARXA_HOME || join(homedir(), '.arxa')

/** The pack's declared name, or undefined when the directory is not a pack. */
export function packName (dir) {
  try {
    const manifest = JSON.parse(readFileSync(join(dir, MANIFEST_REL), 'utf8'))
    const name = manifest?.name
    return typeof name === 'string' && name.trim() !== '' ? name.trim() : undefined
  } catch {
    return undefined
  }
}

const dirsIn = (root) => {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => join(root, e.name))
      .sort()
  } catch {
    return []
  }
}

const isDir = (p) => { try { return statSync(p).isDirectory() } catch { return false } }

/**
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} [opts.appRoot] the studio root (bundled packs live under it)
 * @param {(msg: string) => void} [opts.log]
 * @returns {{ type: 'local', path: string, skipMcpDiscovery: true }[]}
 */
export function resolveSkillPacks ({ env = process.env, appRoot, log = () => {} } = {}) {
  const candidates = [
    ...String(env.ARXA_SKILL_PACKS ?? '').split(':').filter((s) => s.trim() !== '').map((s) => resolve(s.trim())),
    ...dirsIn(join(arxaHome(env), PACKS_DIRNAME)),
    ...(appRoot ? dirsIn(join(appRoot, PACKS_DIRNAME)) : []),
  ]
  const packs = []
  const seenName = new Set()
  const seenPath = new Set()
  for (const dir of candidates) {
    if (seenPath.has(dir)) continue
    seenPath.add(dir)
    if (!isDir(dir)) { log(`skill pack skipped (not a directory): ${dir}`); continue }
    const name = packName(dir)
    if (name === undefined) { log(`skill pack skipped (no readable ${MANIFEST_REL}): ${dir}`); continue }
    if (seenName.has(name)) { log(`skill pack "${name}" already loaded from an earlier root; skipping ${dir}`); continue }
    seenName.add(name)
    packs.push({ type: 'local', path: dir, skipMcpDiscovery: true })
  }
  if (packs.length > 0) log(`skill packs: ${[...seenName].join(', ')}`)
  return packs
}
