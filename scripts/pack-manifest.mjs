// pack-manifest — what the packed sidecar ships out of bin/, and the scan that
// proves the list still matches what the launcher actually loads.
//
// The failure this exists to stop (2026-09-02): a89b02e added
// `import { materialisePreset } from './materialise-preset.mjs'` to
// bin/arxa-studio.mjs; the pack list still named two files; the packed sidecar
// died on ERR_MODULE_NOT_FOUND before binding its port. Nothing was red — the
// repo engine boots from a full checkout, so only a real bundle boot saw it.
//
// The scan is static and takes milliseconds, so it runs on every pack (before
// the two-minute bun build) and as a CI gate, instead of the boot-the-141MB-
// binary check the plan first proposed.
//
// ponytail: a text scan, not a parser. It reads two reference shapes, which is
// every shape bin/ uses: a relative specifier (`from './x.mjs'`,
// `import('./x.mjs')`) and a bare filename literal that gets joined to a dir
// (`join(here, 'loopback-localhost-patch.mjs')` — the --import re-exec). If bin/
// ever loads a file through a COMPUTED name, this cannot see it; add it to
// BIN_FILES by hand and the check stays quiet (an unreachable entry is a
// warning, never a failure).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every bin/ module the launcher loads at runtime. Explicit (not a glob) on
 * purpose: bin/ also holds dev-only scripts (arxa-explore, isolation-check,
 * arxa-engine-sync) that must NOT ship in the sidecar.
 */
export const BIN_FILES = ['arxa-studio.mjs', 'loopback-localhost-patch.mjs', 'materialise-preset.mjs']

/** The launcher — the one entry the Mach-O payload execs. */
export const BIN_ENTRY = 'arxa-studio.mjs'

// Full-line comments and block comments are stripped before scanning so that a
// comment naming a dev-only script (they do: the pack list is discussed in
// bin/arxa-studio.mjs's own header) cannot fake a dependency.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*)/.test(l))
  .join('\n')

const NAME_RE = /['"`]([\w./-]+\.m?js)['"`]/g

/**
 * Files under `binDir` reachable from `entry`, transitively. Returns sorted
 * basenames, entry included.
 */
export function binDeps (binDir, entry = BIN_ENTRY) {
  const seen = new Set()
  const queue = [entry]
  while (queue.length > 0) {
    const name = queue.shift()
    if (seen.has(name)) continue
    seen.add(name)
    const file = join(binDir, name)
    if (!existsSync(file)) continue
    for (const m of stripComments(readFileSync(file, 'utf8')).matchAll(NAME_RE)) {
      const base = m[1].split('/').pop()
      if (base !== name && existsSync(join(binDir, base))) queue.push(base)
    }
  }
  return [...seen].sort()
}

/**
 * @returns {{ reachable: string[], missing: string[], unused: string[] }}
 *   missing — loaded at runtime but NOT packed (fatal: the sidecar dies on boot).
 *   unused  — packed but unreachable from the entry (a warning: harmless bytes,
 *             or a computed load the scan cannot see).
 */
export function checkPackList (studioRoot, files = BIN_FILES, entry = BIN_ENTRY) {
  const reachable = binDeps(join(studioRoot, 'bin'), entry)
  return {
    reachable,
    missing: reachable.filter((f) => !files.includes(f)),
    unused: files.filter((f) => !reachable.includes(f)),
  }
}
