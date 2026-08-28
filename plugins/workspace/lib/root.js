// Workspace-root persistence (D36). The workspace root is the single
// folder the user picks at first run (e.g. ~/Arxa) that holds the whole
// organisations tree. It is NEVER inside the app checkout and NEVER in
// OS app-data — those are rejected on save and on load. The chosen path
// is stored in <ARXA_HOME or ~/.arxa>/workspace.json.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT_FILE = 'workspace.json'

/** Directory holding studio-level config: $ARXA_HOME or ~/.arxa. */
export function arxaHome(env = process.env) {
  return env.ARXA_HOME || path.join(os.homedir(), '.arxa')
}

/** Full path of the workspace.json persistence file. */
export function rootFilePath(env = process.env) {
  return path.join(arxaHome(env), ROOT_FILE)
}

/** Walk up from this module to the app checkout root (nearest package.json above plugins/). */
function appCheckoutRoot() {
  // lib/root.js -> lib -> workspace -> plugins -> app checkout
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
}

/** OS app-data directories a workspace root must not live under (D36). */
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
 * Validate a candidate workspace root. Throws with a reason when the
 * path is unusable; returns the resolved absolute path when valid.
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

/** Persist the chosen workspace root (validating it first). */
export function saveWorkspaceRoot(candidate, env = process.env) {
  const resolved = validateWorkspaceRoot(candidate, env)
  const file = rootFilePath(env)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ root: resolved }, null, 2) + '\n')
  return resolved
}

/**
 * Load the persisted workspace root, re-validating it (the folder may
 * have been deleted or moved since it was saved). Returns null when no
 * root has been chosen yet; throws when a stored root fails validation.
 */
export function loadWorkspaceRoot(env = process.env) {
  const file = rootFilePath(env)
  if (!fs.existsSync(file)) return null
  let data
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`)
  }
  if (typeof data?.root !== 'string') {
    throw new Error(`${file} is missing the "root" field`)
  }
  return validateWorkspaceRoot(data.root, env)
}
