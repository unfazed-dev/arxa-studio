// arxa-freestyle paths — home/registry locations and root-confined path
// resolution (F1/F6, docs/plans/freestyle-section.md).
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'

/** Studio state a freestyle verb must never write into or list. */
export const RESERVED = ['.git', '.arxa']

// Local one-liner, not a cross-package import: `plugins/artifact-viewer/lib/follow.js`
// (commit 07dd1ab, 2026-08-31) measured that pnpm's virtual store copies
// file: deps into .pnpm on install, breaking a RELATIVE cross-package import
// of exactly this function (`../../workspace/lib/root.js`) at boot in
// installed profiles — ERR_MODULE_NOT_FOUND. `github-link/lib/state.js`
// independently carries the same local copy for the same reason. Same
// ARXA_HOME contract as `plugins/workspace/lib/root.js:24`.
export function arxaHome(env = process.env) { return env.ARXA_HOME || path.join(os.homedir(), '.arxa') }

/** ~/.arxa/freestyle.json — the roots registry (ARXA_HOME override). */
export function registryPath(env = process.env) { return path.join(arxaHome(env), 'freestyle.json') }

/** <root>/.arxa/freestyle.json — the per-root manifest. */
export function manifestPath(rootPath) { return path.join(rootPath, '.arxa', 'freestyle.json') }

/** <root>/.arxa/trash — where trashed entries land before purge. */
export function trashDir(rootPath) { return path.join(rootPath, '.arxa', 'trash') }

/**
 * Confine relPath inside rootPath: normalizes, refuses escapes (`../`,
 * absolute paths) and reserved studio dirs (`.git`, `.arxa`), and refuses a
 * symlink escape by realpath-ing the deepest existing ancestor. `relPath ===
 * ''` resolves to the root itself, so later verbs can list/address the root.
 * @returns {{ abs: string, rel: string }}
 */
export function resolveInside(rootPath, relPath) {
  if (typeof relPath !== 'string' || path.isAbsolute(relPath)) throw new Error('outside-root: absolute or missing path')
  // `abs`/`rel` are built off the root AS GIVEN (path.resolve, not
  // realpathSync): a caller's root.path is registry-stored identity (see
  // roots.js addRoot), and realpath-ing it here would rewrite that identity
  // out from under it whenever an ancestor is a symlink — e.g. macOS's own
  // tmp dir (/var/... -> /private/var/...). The symlink-escape check below
  // still realpaths independently, so this loses no safety.
  const rootResolved = path.resolve(rootPath)
  const abs = path.resolve(rootResolved, relPath)
  const rel = path.relative(rootResolved, abs)
  if (rel === '' ? false : (rel.startsWith('..') || path.isAbsolute(rel))) throw new Error('outside-root: ' + relPath)
  const first = rel.split(path.sep)[0]
  if (RESERVED.includes(first)) throw new Error('reserved: ' + first + '/ is studio state')
  // symlink escape: realpath the root and the deepest existing ancestor of
  // `abs`, then check containment — catches a symlink anywhere under the
  // root (e.g. `docs` itself) that points outside it, even though the
  // syntactic join above never left the root.
  const rootReal = fs.realpathSync(rootResolved)
  let probe = abs; while (!fs.existsSync(probe)) probe = path.dirname(probe)
  const probeReal = fs.realpathSync(probe)
  if (probeReal !== rootReal && !probeReal.startsWith(rootReal + path.sep)) throw new Error('outside-root: symlink escape')
  return { abs, rel: rel.split(path.sep).join('/') }
}
