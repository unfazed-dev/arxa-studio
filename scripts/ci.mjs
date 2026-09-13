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
// The LOCAL-ONLY card run. Every other card smoke (cicd-smoke, card-cicd-smoke)
// needs a real GitHub token and a real repo, so the configuration most users
// run — an org that was never published — had no coverage through the card's
// own route at all. Offline and sandboxed, so unlike its two siblings it can
// live here rather than being hand-run.
suites.push([root, 'scripts', 'card-local-smoke.mjs'])
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
// The platform-pin lockstep gate (update-strategy amendment 2026-09-05):
// one wave, one version — every @deepseek-ai/dsh* in the lockfile on the
// pinned release, the import surface still exporting what the plugins
// destructure, and pi-ai owned by upstream’s range again.
suites.push([root, 'scripts', 'dsh-contract-check.mjs'])
// The packed sidecar ships an EXPLICIT bin/ list. A checkout boots fine with a
// stale list (all of bin/ is there); the bundle dies on ERR_MODULE_NOT_FOUND
// before binding its port, two minutes of build and an install later. This
// scans what the launcher actually loads and compares (2026-09-02 regression).
suites.push([root, 'scripts', 'pack-list-check.mjs'])
// The packed-boot gate. pack-list-check.mjs above scans bin/ vs BIN_FILES —
// it cannot see a PLUGIN importing another plugin's lib (git-workspace →
// sandbox, the T11 regression: web boot died ERR_MODULE_NOT_FOUND with every
// scanner green). This smoke boots the real engine end-to-end against a
// scratch home — live but fully local (loopback port, no credentials, no
// model calls, ~15s), so ANY import the launcher loads must actually resolve.
suites.push([root, 'scripts', 'engine-boot-smoke.mjs'])

// bin/ is outside the plugins/*/selftest.mjs sweep, so this is wired by hand.
// arxa-engine-sync decides what reaches a user's desktop payload, and both of its
// previous skip rules failed silently — a version-keyed compare shipped nothing when
// the version was unchanged, and plugins without a package.json were passed over
// entirely. A build tool that reports success while shipping nothing needs a gate.
suites.push([root, 'bin', 'selftest.engine-sync.mjs'])
suites.push([root, 'bin', 'selftest.loopback-patch.mjs'])
// The launcher's permission-preset seeding (S1 step 3): new profiles get
// workspace-write; existing ones migrate only on marker proof. Pinned pure
// AND end-to-end through a real --materialise-only boot.
suites.push([root, 'bin', 'selftest.launcher-settings.mjs'])
// The workspace-provider CLI (task 13 steps 7–8): canonical spellings,
// dispatch-before-boot, redacted diagnose, nonzero exit on red rows. bin/ is
// outside the plugins/*/selftest sweep, so it is wired by hand like the rows
// above.
suites.push([root, 'bin', 'selftest.provider-cli.mjs'])
// The Supabase provider's disposable-harness smoke (task 14). This OFFLINE
// leg runs the injected protocol fake — the full conformance kit with
// RLS/IDOR, the hostile idor/leak reds, and the local → Supabase → local
// migration equivalence, zero ports. The REAL disposable local-Supabase
// stack leg needs the Docker daemon and lives in the dedicated CI job
// (.github/workflows/ci.yml → supabase-conformance), never in npm test.
suites.push([root, 'scripts', 'workspace-provider-supabase-smoke.mjs'])

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
