// Resolve a stock dsh client package INSIDE the pinned wave — through the
// pnpm graph via dsh-web-app's dependency tree, never the repo root.
// The root node_modules used to carry pre-pnpm leftover REAL directories
// from an old wave: scripts that joined `root/node_modules/@deepseek-ai/…`
// silently read DEAD stock (measured 2026-09-15: gen-frame regenerated the
// 0.1.2 layout after the 0.1.5 bump and the drift gate stayed green). The
// leftovers are gone; this keeps the next ones from mattering.
import { createRequire } from 'node:module'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
export const WAVE = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies['@deepseek-ai/dsh']

/** Absolute path to `<pkg>/<sub>` from the pinned wave. Dies loud — never
 *  falls back to another copy, never returns a different version. */
export function stockFile(pkg, sub = 'lib/client.js') {
  const req = createRequire(import.meta.url)
  // The web app is the composition root for every client-ui package, and it
  // is a declared dependency, so its resolution lands in .pnpm at the pin.
  const webAppDir = dirname(req.resolve('@deepseek-ai/dsh-web-app/package.json'))
  let main
  try {
    main = req.resolve(pkg, { paths: [webAppDir] })
  } catch {
    // No exports main (e.g. dsh-web-frontend ships dist/ only). Fall back to
    // the pnpm store: the wave dir carries the version in its name, so the
    // pin is still enforced by the match itself.
    const store = join(webAppDir.slice(0, webAppDir.indexOf('/node_modules/')), 'node_modules', '.pnpm')
    const base = pkg.replace('/', '+')
    const hit = readdirSync(store).find((d) => d === base + '@' + WAVE || d.startsWith(base + '@' + WAVE + '_'))
    if (hit === undefined) throw new Error(pkg + ' not resolvable at wave ' + WAVE + ' (no entry, no store dir)')
    return join(store, hit, 'node_modules', pkg, sub)
  }
  // Walk up from the entry to the package root (the dir holding package.json).
  let dir = dirname(main)
  for (let i = 0; i < 4; i++) {
    try {
      const pkgJson = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      if (pkgJson.name === pkg) {
        if (pkgJson.version !== WAVE) {
          throw new Error(pkg + ' resolved at ' + pkgJson.version + ', pin is ' + WAVE + ' (' + dir + ')')
        }
        return join(dir, sub)
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
    dir = dirname(dir)
  }
  throw new Error('no package.json for ' + pkg + ' above ' + main)
}
