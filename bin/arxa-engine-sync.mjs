#!/usr/bin/env node
// arxa-engine-sync — sync repo plugins into the desktop engine payload so the
// next app launch doesn't reseed the shared dsh profile with stale bytes.
//
// Why: ~/.arxa/engine/<sha12>/arxa-studio is a packed snapshot of this repo.
// Every sidecar launch rm+cp's its plugins/ over ~/.arxa/dsh/profiles/arxa/
// node_modules (packed mode) — while a checkout launch reseeds via
// pnpm --force. Both share the profile; LAST LAUNCH WINS. An old payload
// silently downgrades repo-fresh plugins (the 2026-08-31 files-invisible
// regression). Until the sidecar is repacked (scripts/pack-sidecar.mjs) and
// released, run this after shipping plugin changes, then bounce the sidecar
// (kill its dsh child — the desktop app's heartbeat watchdog respawns it).
import { readdirSync, readFileSync, rmSync, cpSync, existsSync, statSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname, relative, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'

/** Content identity of a directory tree: every file's path AND bytes.
 *
 * This replaces two version-keyed comparisons that both failed SILENTLY — the
 * worst kind of build tool, one that prints success while shipping nothing:
 *
 *  - `rv === ev` skipped any plugin whose package.json version was unchanged, so
 *    editing a plugin without remembering to bump it synced NOTHING and still
 *    reported "already in sync". (Observed 2026-09-04: a four-plugin change
 *    shipped zero bytes.)
 *  - the `package.json` existence check skipped plugins that have no manifest at
 *    all — claude-code, memory and pi-delegate — so they were never in ANY engine
 *    payload, with no warning that they had been passed over.
 *
 * Hashing content costs a few ms per plugin and cannot be forgotten.
 */
/** What a synced plugin does NOT include. hashDir and the copy MUST agree on
 * this — see SKIP's use in sync(). node_modules is a build product, not source:
 * hashing it is slow and its churn would force a full recopy on every run. */
export const SKIP = (name) => name === 'node_modules' || name === '.git'

export function hashDir (root) {
  const h = createHash('sha256')
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      if (SKIP(e.name)) continue
      const p = join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      h.update(relative(root, p)); h.update(readFileSync(p))
    }
  }
  walk(root)
  return h.digest('hex').slice(0, 12)
}

/** Replace `dst` with exactly the tree hashDir walked — SAME skip list, so the
 * two cannot disagree. Shipped without the filter and they did: hashDir ignored
 * node_modules while the copy took it, so plugins/artifact-viewer/lib/monaco-build
 * put 1.3 GB of build-time node_modules into a live engine payload — and because
 * the hash never saw those bytes, nothing ever reported it. Any plugin with a
 * nested node_modules trips this; monaco-build was only the first to have one. */
export function copyTree (src, dst) {
  rmSync(dst, { recursive: true, force: true })
  cpSync(src, dst, { recursive: true, filter: (s) => !SKIP(basename(s)) })
  // The launcher skips its profile seed while <profile>/node_modules/.arxa-seeded
  // names the payload; a rewritten payload must reseed, so drop the marker.
  try { rmSync(join(homedir(), '.arxa', 'dsh', 'profiles', 'arxa', 'node_modules', '.arxa-seeded'), { force: true }) } catch { /* absent */ }
}

/** Platform coherence invariant: synced plugin bytes are only meaningful
 * against the platform they were built for. The 2026-09-05 incident — a dsh
 * wave (0.1.1-rc.2 → 0.1.2-rc.1) changed client seed words (locale's external
 * became "@deepseek-ai/dsh-client-store", seeded only by the new shell) and
 * moved host services (sessionController, typertGateway). Syncing the
 * regenerated plugins onto the OLD payload platform made every webview fail
 * with "missed the module table", and the next engine boot crashed on
 * services the old platform does not provide. A platform wave must advance
 * the payload's node_modules WITH the plugins — scripts/pack-sidecar.mjs (or a
 * full node_modules+plugins mirror) — never this plugin-only sync. Returns
 * null when coherent, else why syncing must be refused. */
export function platformSkew (repoRoot, engineStudio) {
  const read = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
  const repoPin = read(join(repoRoot, 'package.json'))?.dependencies?.['@deepseek-ai/dsh'] ?? null
  const engineVer = read(join(engineStudio, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))?.version ?? null
  if (repoPin === null || engineVer === null) return { repoPin, engineVer, reason: 'unverifiable' }
  if (repoPin !== engineVer) return { repoPin, engineVer, reason: 'mismatch' }
  return null
}

const main = () => {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
  const engineRoot = join(homedir(), '.arxa', 'engine')
  const engines = existsSync(engineRoot) ? readdirSync(engineRoot).map((d) => join(engineRoot, d, 'arxa-studio')).filter((p) => existsSync(join(p, 'plugins'))) : []
  if (!engines.length) { console.log('no engine payload found — nothing to sync'); return }
  // Target selection, in order:
  //  1. explicit `--engine <dir>` / ARXA_ENGINE_DIR;
  //  2. the payload the LIVE engine process is running from (its argv names
  //     ~/.arxa/engine/<sha12>/arxa-studio/bin/...) — the only choice that
  //     guarantees the bounce afterwards picks up what we just wrote;
  //  3. newest engine dir by its own mtime.
  // It used to sort by plugins/ mtime — which this very sync bumps, so it
  // locked onto whichever payload it touched last and silently passed over
  // the one the app launched (2026-09-05: wrote to a Sep 3 payload while the
  // desktop ran that day's build; "4 path(s) synced", nothing changed).
  const flagIdx = process.argv.indexOf('--engine')
  const explicit = flagIdx !== -1 ? process.argv[flagIdx + 1] : process.env.ARXA_ENGINE_DIR
  let engine
  if (explicit) {
    engine = explicit.endsWith('arxa-studio') ? explicit : join(explicit, 'arxa-studio')
    if (!engines.includes(engine)) { console.error('arxa-engine-sync: --engine dir has no plugins/: ' + engine); process.exit(2) }
  } else {
    let live = ''
    try { live = execSync('ps -axo args=', { encoding: 'utf8' }) } catch {}
    engine = engines.find((p) => live.includes(p + '/'))
      ?? engines.sort((a, b) => statSync(dirname(b)).mtimeMs - statSync(dirname(a)).mtimeMs)[0]
    if (engines.length > 1 && !live.includes(engine + '/')) console.warn('arxa-engine-sync: no live engine found; falling back to newest payload dir (pass --engine to pin)')
  }
  console.log('engine payload: ' + engine)

  const skew = platformSkew(repo, engine)
  if (skew) {
    console.error(`arxa-engine-sync: REFUSING to sync — repo pins @deepseek-ai/dsh ${skew.repoPin ?? 'unreadable'} but the payload carries ${skew.engineVer ?? 'unreadable'}. Plugin bytes are platform-keyed; syncing across a platform wave breaks the client module table and host service wiring (2026-09-05). Advance the whole payload instead: scripts/pack-sidecar.mjs (or mirror node_modules + plugins together).`)
    process.exit(1)
  }

  let changed = 0
  const sync = (label, src, dst) => {
    if (!existsSync(src)) return
    const rh = hashDir(src); const eh = existsSync(dst) ? hashDir(dst) : null
    if (rh === eh) return
    copyTree(src, dst)
    console.log('synced ' + label + ': ' + (eh ?? 'MISSING') + ' -> ' + rh); changed++
  }

  for (const p of readdirSync(join(repo, 'plugins'))) {
    sync('plugins/' + p, join(repo, 'plugins', p), join(engine, 'plugins', p))
  }
  // The artifact viewer's editable lane import()s the Monaco bundle, which is a
  // build product of a separate npm root and gitignored — so a checkout that
  // has never run that build syncs a viewer whose editor 404s with nothing
  // saying why. pack-sidecar REFUSES in this case; a dev sync only warns,
  // because everything else in the payload is still worth advancing.
  if (!existsSync(join(repo, 'plugins', 'artifact-viewer', 'lib', 'monaco-build', 'dist', 'arxa-monaco.js'))) {
    console.log('note: plugins/artifact-viewer/lib/monaco-build/dist is missing — the viewer\'s editor will not load. Build it with `npm ci && npm run build` in that directory.')
  }
  // profile/ was never copied, so a profile row added in the repo (the authorization
  // seam, the github-link sign-in row) never reached a user's payload — the sidecar
  // reseeds the shared profile from HERE on every launch.
  sync('profile', join(repo, 'profile'), join(engine, 'profile'))

  console.log(changed ? changed + ' path(s) synced — bounce the sidecar to reseed the profile' : 'engine payload already in sync')
  // Honest about what syncing does NOT achieve: the payload carries no
  // @anthropic-ai/claude-agent-sdk, and both claude-code rows load by absolute repo
  // path, so the plugin still runs only on a machine that has this checkout.
  if (!existsSync(join(engine, 'node_modules', '@anthropic-ai', 'claude-agent-sdk'))) {
    console.log('note: payload lacks @anthropic-ai/claude-agent-sdk — claude-code cannot run from the payload alone (see docs/plans/claude-signin-and-effort-selector.md, F11)')
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
