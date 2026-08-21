#!/usr/bin/env node
// arxa — boots dsh with the arxa profile (identity, repo-law-only
// instructions, appbox gate). A composition, never a fork: the profile is
// materialized from profile/cordis.patch.yml into $DSH_HOME/profiles/arxa and
// dsh's own bin is exec'd against it.
//
//   arxa                  → web UI profile (dsh-base + dsh-web-app)
//   arxa --headless "..." → one-shot no-browser run (dsh-base + dsh-headless)
//   DSH_HOME=<dir> arxa   → sandbox home (used by the H3 verification)
//
// The profile patch is REWRITTEN on every launch so edits to the template in
// this repo take effect next boot — the materialized copy is a build product,
// not a place to edit.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const template = join(here, '..', 'profile', 'cordis.patch.yml')

const args = process.argv.slice(2)
const headless = args.includes('--headless')
const passthrough = args.filter((a) => a !== '--headless')

const dshHome = process.env.DSH_HOME?.trim()
  ? resolve(process.env.DSH_HOME)
  : join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', 'arxa')

const bundles = headless
  ? ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless']
  : ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

const designPanelDir = resolve(here, '..', 'plugins', 'design-panel')
mkdirSync(profileDir, { recursive: true })
writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
  name: 'dsh-profile-arxa',
  private: true,
  dependencies: { 'arxa-design-panel': `file:${designPanelDir}` },
  dsh: { profile: { bundles } },
}, null, 2) + '\n')
writeFileSync(join(profileDir, 'cordis.patch.yml'), readFileSync(template))

// The design panel resolves by package name (its browser half is discovered
// through package.json dsh.client, which a file-path entry never reaches).
// Install is pnpm's job; do it when missing, or say exactly what to run.
if (!existsSync(join(profileDir, 'node_modules', 'arxa-design-panel'))) {
  const r = spawnSync('pnpm', ['install', '--dir', profileDir], { stdio: 'inherit' })
  if (r.error || r.status !== 0) {
    console.error('arxa: could not pnpm-install the profile — the design '
      + 'panel will not mount. Run: dsh plugin --profile arxa add '
      + `file:${designPanelDir}`)
  }
}

// dsh's bin, resolved from arxa's own node_modules when installed, else the
// operator install this machine already carries.
const candidates = [
  join(here, '..', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  join(homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
]
const dshBin = candidates.find(existsSync)
if (!dshBin) {
  console.error('arxa: cannot find @deepseek-ai/dsh — npm install in harness/arxa, or install dsh')
  process.exit(127)
}

const child = spawn(process.execPath, [dshBin, '--profile', 'arxa', ...passthrough], {
  stdio: 'inherit',
  env: process.env,
})
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1))
