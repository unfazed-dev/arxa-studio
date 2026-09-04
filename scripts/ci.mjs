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
// The CI/CD stress harness (identity collision, concurrency, partial
// failure). Offline and deterministic — the LIVE variant is cicd-smoke.mjs,
// which needs a real engine and real GitHub and is hand-run only.
suites.push([root, 'scripts', 'cicd-stress.mjs'])
// arxa-jobs reads an UNDOCUMENTED shape out of the installed dsh (the job
// registry's `.id` fence). Its selftest runs against a faithful fake, so this
// gate is the half that notices when the real thing moves.
suites.push([root, 'scripts', 'jobs-fence-check.mjs'])
// F6 mirror drift: MIRROR_TOOL_NAMES vs the pinned CLI's advertised tool list.
// OFFLINE — reads plugins/claude-code/live-tools.json, never launches claude, so
// it is safe here. It fails on CHANGE, not on the standing (unruled) diff, so a
// CLI bump or an edit to the list goes red instead of drifting unnoticed.
suites.push([root, 'scripts', 'mirror-drift-check.mjs'])

// An event type dsh cannot load makes the WHOLE session unreadable on reopen, and nothing goes
// red when it is written — only when a user restarts and finds "Failed to load history". Two real
// sessions were lost to this before the gate existed.
suites.push([root, 'scripts', 'session-event-vocabulary-check.mjs'])

// bin/ is outside the plugins/*/selftest.mjs sweep, so this is wired by hand.
// arxa-engine-sync decides what reaches a user's desktop payload, and both of its
// previous skip rules failed silently — a version-keyed compare shipped nothing when
// the version was unchanged, and plugins without a package.json were passed over
// entirely. A build tool that reports success while shipping nothing needs a gate.
suites.push([root, 'bin', 'selftest.engine-sync.mjs'])

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
  // On RED show the tail of BOTH streams: assertion messages and stack traces
  // go to stderr, and a suite that dies there prints nothing useful on stdout.
  if (!green && r.stdout) console.log(r.stdout.split('\n').slice(-6).join('\n'))
  if (!green && r.stderr) {
    // The message ("AssertionError [ERR_ASSERTION]: …", "Error: …") sits at the
    // TOP of node's stderr block; the tail is stack frames and the node version.
    const lines = r.stderr.trim().split('\n')
    const named = lines.filter((l) => /error|assert/i.test(l)).slice(0, 4)
    const tail = lines.slice(-3).filter((l) => !named.includes(l))
    console.log('stderr: ' + [...named, ...(tail.length ? ['…', ...tail] : [])].join('\n'))
  }
  if (!green && r.error) console.log('spawn error: ' + r.error.message)
}
if (failed > 0) {
  console.log('arxa-studio CI: ' + failed + ' FAILURE(S): ' + failedNames.join(', '))
  process.exit(1)
}
console.log('arxa-studio CI: ALL GREEN')
