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
import { join, dirname, relative } from 'node:path'
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
export function hashDir (root) {
  const h = createHash('sha256')
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      // node_modules is a build product, not source: hashing it is slow and its
      // churn would force a full recopy on every run.
      if (e.name === 'node_modules' || e.name === '.git') continue
      const p = join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      h.update(relative(root, p)); h.update(readFileSync(p))
    }
  }
  walk(root)
  return h.digest('hex').slice(0, 12)
}

const main = () => {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
  const engineRoot = join(homedir(), '.arxa', 'engine')
  const engines = existsSync(engineRoot) ? readdirSync(engineRoot).map((d) => join(engineRoot, d, 'arxa-studio')).filter((p) => existsSync(join(p, 'plugins'))) : []
  if (!engines.length) { console.log('no engine payload found — nothing to sync'); return }
  const engine = engines.sort((a, b) => statSync(join(b, 'plugins')).mtimeMs - statSync(join(a, 'plugins')).mtimeMs)[0]
  console.log('engine payload: ' + engine)

  let changed = 0
  const sync = (label, src, dst) => {
    if (!existsSync(src)) return
    const rh = hashDir(src); const eh = existsSync(dst) ? hashDir(dst) : null
    if (rh === eh) return
    rmSync(dst, { recursive: true, force: true }); cpSync(src, dst, { recursive: true })
    console.log('synced ' + label + ': ' + (eh ?? 'MISSING') + ' -> ' + rh); changed++
  }

  for (const p of readdirSync(join(repo, 'plugins'))) {
    sync('plugins/' + p, join(repo, 'plugins', p), join(engine, 'plugins', p))
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
