#!/usr/bin/env node
// dsh-wave-latest-check — the bump radar (grill round 3, 2026-09-14).
//
// "arxa update = bump these pins, run the suite" (update-strategy amendment)
// needs to know WHEN. This prints the registry's newest published version for
// every pinned @deepseek-ai package next to the pin, and exits 1 when
// anything is ahead — cron-able:
//   node scripts/dsh-wave-latest-check.mjs
//
// It reads the FULL versions list and takes the last entry (the registry
// sorts it semver-ascending): dist-tag "latest" is misleading for most of
// these packages, and prereleases count. NOT wired into ci.mjs on purpose —
// network. When it fires, the bump decision rule is
// docs/research/dsh-0.1.5-upgrade-analysis.md §Parity-by-plugin (needed
// engine feature, security fix, or 0.2.x API stabilization).
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const pins = Object.keys(pkg.dependencies)
  .filter((d) => d.startsWith('@deepseek-ai/'))
  .sort()
  .map((d) => [d, pkg.dependencies[d]])

let ahead = 0
for (const [name, pin] of pins) {
  let latest = '(registry error)'
  try {
    const versions = JSON.parse(execFileSync('npm', ['view', name, 'versions', '--json'], {
      encoding: 'utf8', timeout: 30_000,
    }))
    latest = Array.isArray(versions) ? versions[versions.length - 1] : String(versions)
  } catch (e) {
    latest = '(error: ' + String(e.message).split('\n')[0].slice(0, 60) + ')'
  }
  const stale = latest !== pin && !latest.startsWith('(error')
  if (stale) ahead++
  console.log(`${stale ? 'AHEAD' : 'ok   '}  ${name}  pin ${pin}  latest ${latest}`)
}

console.log(ahead === 0
  ? '\nwave radar: pins are the newest published'
  : `\nwave radar: ${ahead} package(s) ahead — decision rule: docs/research/dsh-0.1.5-upgrade-analysis.md §Parity-by-plugin`)
process.exit(ahead === 0 ? 0 : 1)
