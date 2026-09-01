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
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const engineRoot = join(homedir(), '.arxa', 'engine')
const ver = (p) => { try { return JSON.parse(readFileSync(join(p, 'package.json'), 'utf8')).version } catch { return null } }
const engines = existsSync(engineRoot) ? readdirSync(engineRoot).map((d) => join(engineRoot, d, 'arxa-studio')).filter((p) => existsSync(join(p, 'plugins'))) : []
if (!engines.length) { console.log('no engine payload found — nothing to sync'); process.exit(0) }
const engine = engines.sort((a, b) => statSync(join(b, 'plugins')).mtimeMs - statSync(join(a, 'plugins')).mtimeMs)[0]
console.log('engine payload: ' + engine)
let changed = 0
for (const p of readdirSync(join(repo, 'plugins'))) {
  const src = join(repo, 'plugins', p); const dst = join(engine, 'plugins', p)
  if (!existsSync(join(src, 'package.json'))) continue
  const rv = ver(src); const ev = existsSync(dst) ? ver(dst) : null
  if (rv === ev) continue
  rmSync(dst, { recursive: true, force: true }); cpSync(src, dst, { recursive: true })
  console.log('synced ' + p + ': ' + (ev ?? 'MISSING') + ' -> ' + rv); changed++
}
console.log(changed ? changed + ' plugin(s) synced — bounce the sidecar to reseed the profile' : 'engine payload already in sync')
