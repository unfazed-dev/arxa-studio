// Organisation recents persistence (D69). The workspace-root tree is
// retired: the folder picked at org creation IS the organisation root, so
// ~/.arxa/organisation.json no longer stores one "root" — it stores the
// RECENTS: the list of organisation folders the user has opened,
// most-recent-first, capped at 10. Shape: { orgs: [abs paths] }.
// Previous shapes ({ root: ... } and the pre-rename workspace.json) are
// migrated one-way on first load. D36 placement rules (never the app
// checkout, never OS app-data) now apply to each org folder itself.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT_FILE = 'organisation.json'

/** Pre-rename name (2026-08-29); read as a fallback, migrated on load. */
export const LEGACY_ROOT_FILE = 'workspace.json'

/** Recents list is capped at this many organisation folders. */
export const RECENTS_CAP = 10

/** Directory holding studio-level config: $ARXA_HOME or ~/.arxa. */
export function arxaHome(env = process.env) {
  return env.ARXA_HOME || path.join(os.homedir(), '.arxa')
}

/** Full path of the organisation.json persistence file. */
export function rootFilePath(env = process.env) {
  return path.join(arxaHome(env), ROOT_FILE)
}

/** Full path of the legacy workspace.json file, when one exists. */
export function legacyRootFilePath(env = process.env) {
  return path.join(arxaHome(env), LEGACY_ROOT_FILE)
}

/** Walk up from this module to the app checkout root (nearest package.json above plugins/). */
function appCheckoutRoot() {
  // lib/root.js -> lib -> workspace -> plugins -> app checkout
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
}

/** OS app-data directories an org folder must not live under (D36). */
function appDataDirs(env = process.env) {
  const home = os.homedir()
  const dirs = []
  if (process.platform === 'darwin') {
    dirs.push(path.join(home, 'Library'))
  } else if (process.platform === 'win32') {
    if (env.APPDATA) dirs.push(env.APPDATA)
    if (env.LOCALAPPDATA) dirs.push(env.LOCALAPPDATA)
  } else {
    dirs.push(env.XDG_CONFIG_HOME || path.join(home, '.config'))
    dirs.push(env.XDG_DATA_HOME || path.join(home, '.local', 'share'))
    dirs.push(env.XDG_CACHE_HOME || path.join(home, '.cache'))
  }
  dirs.push(arxaHome(env)) // studio's own config dir counts as app-data
  return dirs
}

function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Validate a candidate org folder (D36 rules, applied to the org folder
 * itself since D69). Throws with a reason when the path is unusable;
 * returns the resolved absolute path when valid.
 */
export function validateWorkspaceRoot(candidate, env = process.env) {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    throw new Error('workspace root must be a non-empty path')
  }
  const resolved = path.resolve(candidate)
  if (!fs.existsSync(resolved)) {
    throw new Error(`workspace root does not exist: ${resolved}`)
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`workspace root is not a directory: ${resolved}`)
  }
  if (isInside(resolved, appCheckoutRoot())) {
    throw new Error(`workspace root must not be inside the app checkout (${appCheckoutRoot()}) (D36)`)
  }
  for (const dir of appDataDirs(env)) {
    if (isInside(resolved, dir)) {
      throw new Error(`workspace root must not be inside OS app-data (${dir}) (D36)`)
    }
  }
  return resolved
}

function writeRecents(orgs, env) {
  const file = rootFilePath(env)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ orgs }, null, 2) + '\n')
}

/**
 * Read the recents file, migrating previous shapes one-way:
 *   { root } (organisation.json, pre-D69) and workspace.json → { orgs }.
 * Returns the raw orgs array (most-recent-first); never throws for a
 * missing file — returns [].
 */
export function readRecents(env = process.env) {
  const file = rootFilePath(env)
  const legacy = legacyRootFilePath(env)
  const usingLegacy = !fs.existsSync(file) && fs.existsSync(legacy)
  const source = usingLegacy ? legacy : file
  if (!fs.existsSync(source)) return []
  let data
  try {
    data = JSON.parse(fs.readFileSync(source, 'utf8'))
  } catch (err) {
    throw new Error(`${source} is not valid JSON: ${err.message}`)
  }
  let orgs
  if (Array.isArray(data?.orgs)) {
    orgs = data.orgs.filter((p) => typeof p === 'string' && p.trim() !== '')
  } else if (typeof data?.root === 'string') {
    orgs = [data.root] // pre-D69 single-root shape → one-way migration
  } else {
    throw new Error(`${source} is missing the "orgs" field`)
  }
  if (usingLegacy || typeof data?.root === 'string') {
    writeRecents(orgs, env) // one-way: write the new shape…
    if (usingLegacy) fs.rmSync(legacy, { force: true }) // …then drop the legacy file
  }
  return orgs
}

/** The recents list face: organisation folders, most-recent-first. */
export function listRecents(env = process.env) {
  return readRecents(env)
}

/**
 * Record an organisation folder as just-opened: move it to the front of
 * the recents list (deduped), cap the list, persist. The D36 placement
 * rules are enforced here too — a folder that must not be an org must
 * not enter the recents either. Returns the resolved path.
 */
export function touchRecent(candidate, env = process.env) {
  const resolved = validateWorkspaceRoot(candidate, env)
  const rest = readRecents(env).filter((p) => path.resolve(p) !== resolved)
  writeRecents([resolved, ...rest].slice(0, RECENTS_CAP), env)
  return resolved
}

/** Drop one organisation folder from the recents list (idempotent). */
export function removeRecent(candidate, env = process.env) {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    throw new Error('removeRecent: path must be a non-empty string')
  }
  const resolved = path.resolve(candidate)
  writeRecents(readRecents(env).filter((p) => path.resolve(p) !== resolved), env)
  return resolved
}

/**
 * Back-compat face over the recents (D69): the previous single-root API.
 * Returns the most recent org folder (re-validated), or null when the
 * recents are empty. Saves route through touchRecent.
 */
export function loadWorkspaceRoot(env = process.env) {
  const orgs = readRecents(env)
  if (orgs.length === 0) return null
  return validateWorkspaceRoot(orgs[0], env)
}

/** Back-compat face: record the picked folder as most-recent. */
export function saveWorkspaceRoot(candidate, env = process.env) {
  return touchRecent(candidate, env)
}
