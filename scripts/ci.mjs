// arxa-studio CI — one entry, run-all report-all, non-zero on any failure.
// Phase C of docs/plans/file-org-shell-integration.md: the permanent gate.
//
// Discovery is dynamic (plugins/*/selftest.mjs, plus arxa-sidebar's
// route-level smoke) so an eleventh plugin joins the suite without editing
// this file. The rebuild gate rides inside plugins/workspace-index/selftest.mjs
// ("THE REBUILD GATE: delete index + rebuild loses nothing") — inclusion makes
// it a hard failure, discharging the Phase 2 "permanent CI, not a one-off"
// commitment. Exit check: one command, clean on master, non-zero on any red.
//
// scripts/*.mjs is NOT auto-discovered the way plugins/*/selftest.mjs is —
// scripts/preset-check.mjs (arxa preset / host patch split) is wired in
// explicitly below.
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const pluginsDir = join(root, 'plugins')

const suites = readdirSync(pluginsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .flatMap((e) => {
    const out = []
    // selftest.mjs plus any selftest.<topic>.mjs — topic files let parallel
    // work land tests without every branch appending to one shared file.
    for (const f of readdirSync(join(pluginsDir, e.name)).filter((f) => /^selftest(\.[\w-]+)?\.mjs$/.test(f)).sort()) {
      out.push([pluginsDir, e.name, f])
    }
    if (e.name === 'arxa-sidebar' && readdirSync(join(pluginsDir, e.name)).includes('smoke.mjs')) {
      out.push([pluginsDir, e.name, 'smoke.mjs'])
    }
    return out
  })
suites.push([root, 'scripts', 'preset-check.mjs'])

console.log('arxa-studio CI — ' + suites.length + ' suites')
let failed = 0
const failedNames = []
for (const [base, plugin, script] of suites) {
  const label = plugin + '/' + script
  const r = spawnSync(process.execPath, [join(base, plugin, script)], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5 * 60 * 1000,
  })
  const green = r.status === 0
  if (!green) { failed++; failedNames.push(label) }
  console.log((green ? 'GREEN  ' : 'RED    ') + label)
  if (!green && r.stdout) console.log(r.stdout.split('\n').slice(-6).join('\n'))
}
if (failed > 0) {
  console.log('arxa-studio CI: ' + failed + ' FAILURE(S): ' + failedNames.join(', '))
  process.exit(1)
}
console.log('arxa-studio CI: ALL GREEN')
