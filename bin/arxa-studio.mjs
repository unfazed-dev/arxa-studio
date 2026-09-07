#!/usr/bin/env node
// arxa — boots dsh with the arxa profile (identity, repo-law-only
// instructions, arxa gate). A composition, never a fork: the profile is
// materialized from profile/cordis.patch.yml into arxa's OWN home and dsh's
// own bin is exec'd against it.
//
// HOME DISCIPLINE: arxa owns ~/.arxa outright and never writes into the
// operator's ~/.dsh or ~/.pi (the 2026-08-21 provider flip changed the
// operator's daily default — shared homes have zero isolation).
//
//   ~/.arxa/dsh   DSH_HOME for arxa sessions: settings.yaml (seeded once),
//                 .credentials.yaml (seeded from ~/.dsh if present),
//                 profiles/arxa (rewritten every launch — a build product)
//   ~/.arxa/pi    PI_CODING_AGENT_DIR for delegated Pi: models.json (seeded
//                 once), extensions/ (symlinks refreshed every launch)
//
//   arxa                  → web UI profile (dsh-base + dsh-web-app)
//   arxa --headless "..." → one-shot no-browser run (dsh-base + dsh-headless)
//   ARXA_HOME=<dir> arxa  → relocate the whole home (sandbox verification)
//   DSH_HOME=<dir> arxa   → override just the dsh home (legacy sandbox path)
import { closeSync, copyFileSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, writeSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'
import { materialisePreset } from './materialise-preset.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const template = join(here, '..', 'profile', 'cordis.patch.yml')
const presetSrcDir = join(here, '..', 'profile', 'agent-presets', 'arxa')

const args = process.argv.slice(2)
const headless = args.includes('--headless')
// Materialises the profile patch and the arxa agent preset into DSH_HOME
// (and seeds/rewrites settings.yaml) without pnpm-installing the profile,
// resolving the dsh bin, or exec'ing it — for CI and scripts/preset-check.mjs.
const materialiseOnly = args.includes('--materialise-only')
const passthrough = args.filter((a) => a !== '--headless' && a !== '--materialise-only')

// PACKED MODE (desktop sidecar) isolation: `open -a` / LaunchServices forward
// the CALLING shell's environment, and a shell inside any dsh session exports
// managed DSH_* vars (DSH_HOME=~/.dsh among them — the legacy sandbox
// override). Inherited DSH_* are the parent session's identity, never arxa's,
// so the packed sidecar strips them for its whole process here — the same
// sanitize the dsh child env below has always done. (Measured 2026-08-29:
// without this, a terminal `open` of the app made the isolation guard below
// exit 127 and the window sat on the waiting page forever — a GUI refusal is
// invisible.)
const packed = existsSync(join(here, 'packed.json'))
if (packed) {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('DSH_')) delete process.env[k]
  }
}

const arxaHome = process.env.ARXA_HOME?.trim()
  ? resolve(process.env.ARXA_HOME)
  : join(homedir(), '.arxa')
const dshHome = process.env.DSH_HOME?.trim()
  ? resolve(process.env.DSH_HOME)
  : join(arxaHome, 'dsh')
const piHome = join(arxaHome, 'pi')
const profileDir = join(dshHome, 'profiles', 'arxa')
// PACKED MODE (desktop sidecar): the engine and this launcher log to
// <dshHome>/engine.log — NEVER stdio-inherit. Under the desktop shell
// inherit means Tauri's unread pipes: a dying engine vanished without a
// word (measured 2026-08-29 — fresh install, engine died silently, the
// window sat on the waiting page with zero diagnostics anywhere). The
// file opens at the very top of packed boot and every stage
// breadcrumbs into it; uncaught exceptions land there too, launcher-side.
// Declared THIS early because the first breadcrumb (profile
// materialization) fires long before the old late-block position.
let engineLogFd = -1
function engineLog(line) {
  if (engineLogFd === -1) return
  try { writeSync(engineLogFd, new Date().toISOString() + ' ' + line + '\n') } catch {}
}
if (packed) {
  try {
    const logFile = join(dshHome, 'engine.log')
    try { if (existsSync(logFile) && statSync(logFile).size > 10 * 1024 * 1024) rmSync(logFile, { force: true }) } catch {}
    engineLogFd = openSync(logFile, 'a')
    engineLog('launcher boot (pid ' + process.pid + '), argv: ' + JSON.stringify(process.argv.slice(2)))
    process.on('uncaughtException', (e) => {
      engineLog('UNCAUGHT: ' + (e && e.stack || e))
      process.exit(1)
    })
    process.on('unhandledRejection', (e) => {
      engineLog('UNHANDLED REJECTION: ' + (e && e.stack || e))
    })
  } catch {
    // A studio that cannot write the log still runs; diagnostics lose.
  }
}

// ISOLATION HARD STOP (2026-08-22): a shell inside any dsh session exports
// managed DSH_* vars — DSH_HOME=~/.dsh among them — and DSH_HOME above is
// the legacy sandbox override. So arxa launched from inside a dsh session
// (agent OR operator terminal) boots against the OPERATOR'S home: their
// sessions and workspaces listed in arxa's UI, arxa's writes landing in
// their store. Measured live: studio pid 25528 ran with
// DSH_HOME=/Users/unfazed-mac/.dsh exactly this way. The operator's ~/.dsh
// is never a legitimate arxa home — refuse BEFORE the first write, with no
// fallback and no partial boot.
const operatorDsh = resolve(homedir(), '.dsh')
const inOperatorDsh = (p) => p === operatorDsh || p.startsWith(operatorDsh + sep)
if (inOperatorDsh(arxaHome) || inOperatorDsh(dshHome)) {
  console.error('arxa: refusing to boot — the effective home lands in the operator\'s ~/.dsh:')
  console.error('  ARXA_HOME=' + arxaHome)
  console.error('  DSH_HOME=' + dshHome)
  console.error('  A parent dsh session exports DSH_HOME into its shells; arxa')
  console.error('  must never share that home. Relaunch with a clean environment:')
  console.error('    env -u DSH_HOME arxa')
  process.exit(127)
}

const bundles = headless
  ? ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless']
  : ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

// ---- dsh home ----------------------------------------------------------------
const designPanelDir = resolve(here, '..', 'plugins', 'design-panel')
const brandDir = resolve(here, '..', 'plugins', 'brand')
const genUiDir = resolve(here, '..', 'plugins', 'gen-ui')
// arxa-provider-status: provider/status session events → providerStatus
// projection → composer pill, shared by every model provider (docs/plans/
// claude-subscription-engine.md task 13). By-name because it ships a
// browser half via package.json dsh.client, like gen-ui above.
const providerStatusDir = resolve(here, '..', 'plugins', 'provider-status')
// Installed always, loaded only when the profile enables it (row 10 ships
// commented out — it needs a real MCP server to point at).
const mcpAppsDir = resolve(here, '..', 'plugins', 'mcp-apps')
const waitingPageDir = resolve(here, '..', 'plugins', 'waiting-page')
const themeAccentDir = resolve(here, '..', 'plugins', 'theme-accent')
const pairingDir = resolve(here, '..', 'plugins', 'pairing')
const sidebarDir = resolve(here, '..', 'plugins', 'arxa-sidebar')
// Git card (docs/plans/git-card-stock-dock-rebuild.md): its own plugin —
// host half serves /__arxa/git-card/action over the sidebar's org shell;
// browser half is the conversation.input.dock card in stock QueueDock grammar.
const gitCardDir = resolve(here, '..', 'plugins', 'arxa-git-card')
const jobsDir = resolve(here, '..', 'plugins', 'arxa-jobs')
// Approvals loop (grill D60–D68): approvals doors new pendings through the
// push-doorbell library by bare-name-then-relative import probe (the sidebar
// importShell pattern) — both dirs ride the flat copies below so the probe
// resolves in packed mode AND inside pnpm's isolated profile node_modules.
const approvalsDir = resolve(here, '..', 'plugins', 'approvals')
const pushDoorbellDir = resolve(here, '..', 'plugins', 'push-doorbell')
// Phase A lifecycle service (library, not a dsh client plugin — stays out of
// BY_NAME_PLUGINS). arxa-sidebar's host half import-probes it by this name;
// its own imports reach its five composed libraries by RELATIVE path, which
// resolves through the pnpm file: symlink back into plugins/.
const fileOrgShellDir = resolve(here, '..', 'plugins', 'file-org-shell')
// org-model-v2 W3 (D69 gate half): the github-link LIBRARY materializes by
// name so arxa-sidebar's bare import resolves in every profile boot.
const githubLinkDir = resolve(here, '..', 'plugins', 'github-link')
// Artifact viewer-editor (D7 + D78-D87): by-package-name plugin with a
// browser half — dir const feeds the profile package.json, BY_NAME_PLUGINS,
// and the packed-mode copy list below.
const artifactViewerDir = resolve(here, '..', 'plugins', 'artifact-viewer')
const arxaFrameDir = resolve(here, '..', 'plugins', 'arxa-frame')
// arxa's locale world (en/pl/fr — the stock locale row is disabled in the
// patch; Phase 0 of docs/plans/dsh-plugin-ui-conformance.md).
const localeDir = resolve(here, '..', 'plugins', 'locale')
// Prism background field (step 1): the animated split-triangle square on the
// conversation scrollport. Pure client-side CSS — see plugins/prism/lib/client.js.
const prismDir = resolve(here, '..', 'plugins', 'prism')
// Personalisation settings tab: the 4th settings section owning the
// look-and-feel rows (accent/editor-font/Background retarget there).
const personalisationDir = resolve(here, '..', 'plugins', 'personalisation')
mkdirSync(profileDir, { recursive: true })
/**
 * The profile's plugin set — ONE list, two consumers.
 *
 * It feeds the profile package.json below (checkout mode, where pnpm installs
 * the file: deps) AND the packed-mode directory copy further down. Those were
 * two hand-maintained lists until 2026-09-03, when `arxa-personalisation` sat
 * in the deps but not in the packed copy: the desktop sidecar extracted fine,
 * printed its banner, then died on `Cannot find package 'arxa-personalisation'`
 * before binding its port — silently, because packed mode sends engine stdio
 * to the engine log. Same failure shape as the bin/ file list that became
 * BIN_FILES in eb9f088, so it gets the same cure rather than a second patch.
 */
const PROFILE_PLUGINS = [
  ['arxa-design-panel', designPanelDir],
  ['arxa-brand', brandDir],
  ['arxa-gen-ui', genUiDir],
  ['arxa-mcp-apps', mcpAppsDir],
  ['arxa-waiting-page', waitingPageDir],
  ['arxa-theme-accent', themeAccentDir],
  ['arxa-pairing', pairingDir],
  ['arxa-sidebar', sidebarDir],
  ['arxa-git-card', gitCardDir],
  ['arxa-jobs', jobsDir],
  ['arxa-file-org-shell', fileOrgShellDir],
  ['arxa-github-link', githubLinkDir],
  ['arxa-artifact-viewer', artifactViewerDir],
  ['arxa-frame', arxaFrameDir],
  ['arxa-locale', localeDir],
  ['arxa-prism', prismDir],
  ['arxa-personalisation', personalisationDir],
  ['arxa-provider-status', providerStatusDir],
]
writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
  name: 'dsh-profile-arxa',
  private: true,
  dependencies: Object.fromEntries(PROFILE_PLUGINS.map(([name, dir]) => [name, `file:${dir}`])),
  dsh: { profile: { bundles } },
}, null, 2) + '\n')
// Path-loaded rows (sandbox, approvals, conversation, claude-code, github-link, desktop-session)
// name their entry as `__ARXA_STUDIO_PLUGINS__/<plugin>/...` and are resolved HERE to the
// plugins/ dir beside this launcher: the repo checkout in checkout mode, the payload in packed
// mode. The template used to carry one developer's absolute `/Volumes/...` path, which no
// end-user machine has, and which in a checkout split the plugin tree in two — claude-code ran
// from the repo while provider-status ran from the profile's node_modules copy, so the usage
// reader landed in a module instance the poller never read (2026-09-05).
const pluginsRoot = resolve(here, '..', 'plugins')
writeFileSync(join(profileDir, 'cordis.patch.yml'), readFileSync(template, 'utf8').replaceAll('__ARXA_STUDIO_PLUGINS__', pluginsRoot))
engineLog('profile materialized: ' + profileDir)

// The arxa agent preset (AGENT-PLANE, docs/plans/arxa-harness-and-distribution.md)
// — same build-product treatment as the profile patch above: copied fresh on
// every launch, never hand-edited at the destination.
const presetDir = materialisePreset(dshHome, presetSrcDir)
engineLog('preset materialized: ' + presetDir)

// Seed once, then the operator owns it (the web Models/Settings pages write
// here). glm-5.3 effort max on the CODING endpoint is the arxa default —
// bench 2026-08-29: flash is the slow tier (~7.4s TTFT with tools, 26-50 tok/s
// vs glm-5.3's ~2.9s / 85-89); flash stays in the route for image input, and
// `low` effort is the no-thinking speed lever. baseURL is pinned because the
// seeded key is coding-plan scoped (the general endpoint 429s with it; flip
// to https://api.z.ai/api/paas/v4 for a wallet-funded key). Model auth
// resolution: inherited env WINS over the store (dsh-credentials-local), so
// `arxa credentials exec ZAI_API_KEY -- arxa` works against an empty store.
const settingsFile = join(dshHome, 'settings.yaml')
if (!existsSync(settingsFile)) {
  writeFileSync(settingsFile, `llm-pi-ai:
  providers:
    zai:
      apiKeyEnv: ZAI_API_KEY
      baseURL: https://api.z.ai/api/coding/paas/v4
      models:
        - id: glm-5.3-flash
          name: GLM-5.3-Flash
          contextWindow: 1000000
          maxTokens: 131072
          input: [ text, image ]
          reasoningEfforts:
            low: low
            high: high
            max: max
        - id: glm-5.3
          name: GLM-5.3
          contextWindow: 1000000
          maxTokens: 131072
          input: [ text ]
          reasoningEfforts:
            low: low
            high: high
            max: max
        - id: glm-4.6v
          name: GLM-4.6V
          input: [ text, image ]
          contextWindow: 131072
agent-default-model:
  # glm-5.3 + effort max — the fast tier (bench 2026-08-29: ~2.5x faster
  # TTFT with tools, ~2x decode vs flash). flash remains in the route above
  # for text+image turns; 'low' effort is the no-thinking speed lever.
  provider: zai
  model: glm-5.3
  reasoningEffort: max
agent-presets:
  default: arxa
permission:
  defaultPreset: danger-full-access
`)
} else {
  // agent-presets.default previously seeded (or hand-set) to one of the
  // shipped preset names now gets rewritten to arxa, once, with a printed
  // notice; any other value (arxa already, or an operator's own preset id)
  // is left alone. Line-based, not a full YAML parse+reserialize, so every
  // other byte of an existing settings.yaml — comments included — survives.
  const raw = readFileSync(settingsFile, 'utf8')
  const lines = raw.split('\n')
  const shipped = new Set(['code', 'cordis', 'standard', 'minimal'])
  const topIdx = lines.findIndex((l) => l === 'agent-presets:')
  if (topIdx !== -1) {
    for (let i = topIdx + 1; i < lines.length && (lines[i] === '' || /^\s/.test(lines[i])); i++) {
      const m = lines[i].match(/^(\s*default:\s*)(\S+)\s*$/)
      if (m && shipped.has(m[2])) {
        lines[i] = m[1] + 'arxa'
        writeFileSync(settingsFile, lines.join('\n'))
        console.log(`arxa: settings.yaml agent-presets.default was '${m[2]}' (a shipped preset) — set to 'arxa'.`)
        break
      }
    }
  }
}

// Seed the credential store from the operator's dsh install, once. A plain
// file copy — no value is ever read into a variable, printed, or logged.
const credFile = join(dshHome, '.credentials.yaml')
const operatorCreds = join(homedir(), '.dsh', '.credentials.yaml')
if (!existsSync(credFile) && existsSync(operatorCreds)) {
  try { copyFileSync(operatorCreds, credFile) } catch { /* env layer still works */ }
}

if (materialiseOnly) {
  console.log('arxa: materialise-only — profile at ' + profileDir + ', preset at ' + presetDir)
  process.exit(0)
}

// ---- pi home -----------------------------------------------------------------
// Delegated-Pi state (decision 3: Pi as delegated subagent engine). Extensions
// are symlinked fresh every launch so repo moves never leave stale links; the
// gate resolves its guard through realpath, so symlinking is safe.
const piExtensions = join(piHome, 'extensions')
mkdirSync(piExtensions, { recursive: true })
const arxaDir = resolve(here, '..', '..', 'arxa')
for (const [link, target] of [
  [join(piExtensions, 'arxa-gate.ts'), join(arxaDir, 'harness', 'pi', 'arxa-gate.ts')],
  [join(piExtensions, 'arxa-memory.ts'), join(here, '..', 'pi', 'arxa-memory.ts')],
]) {
  try { rmSync(link, { force: true }) } catch { /* first run */ }
  symlinkSync(target, link)
}

const piModels = join(piHome, 'models.json')
if (!existsSync(piModels)) {
  writeFileSync(piModels, JSON.stringify({
    providers: {
      'zai-coding': {
        name: 'Z.ai coding API (plan quota)',
        baseUrl: 'https://api.z.ai/api/coding/paas/v4',
        api: 'openai-completions',
        // Shelled at request time by pi itself; the value never lands in a file.
        apiKey: '!arxa credentials exec ZAI_API_KEY -- printenv ZAI_API_KEY',
        models: [
          // glm-5.3 + reasoning verified working on the coding endpoint 2026-08-29.
          {
            id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 1000000, maxTokens: 131072,
            reasoning: true,
            thinkingLevelMap: { minimal: null, low: 'low', medium: 'low', high: 'high', max: 'max' },
          },
          { id: 'glm-4.6v', name: 'GLM-4.6V', contextWindow: 131072, maxTokens: 8192 },
        ],
      },
    },
  }, null, 2) + '\n')
}

// ---- exec dsh ----------------------------------------------------------------
// dsh's bin, resolved ONLY from arxa's own node_modules.
//
// There used to be a second candidate here, ~/.dsh/profiles/node_modules,
// justified as "read-only reuse — arxa never writes there". That justification
// was about writing; the leak was reading. Executing the operator's binary means
// running the operator's VERSION. arxa-studio/node_modules was never installed,
// so that fallback always won: arxa pinned dsh 0.1.0-rc.7 and actually ran
// whatever `npx @deepseek-ai/dsh` last wrote into the shared npm cache slot
// (measured 2026-08-22: pinned rc.7, running 0.1.1-rc.2). One `npx` invocation
// changed the version under arxa and the operator at the same instant, because
// all 1039 package symlinks in both profile trees point into that one slot.
//
// Resolving an executable from a path the operator controls is an isolation
// break even when nothing is written there. Failing to boot is strictly better
// than silently booting someone else's version, so there is no fallback.
// See arxa/docs/plans/dsh-isolation-from-operator-install.md.
const dshBin = join(here, '..', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
if (!existsSync(dshBin)) {
  console.error('arxa: @deepseek-ai/dsh is not installed in arxa-studio.')
  console.error('  fix:  npm install --prefix ' + resolve(here, '..'))
  console.error('  arxa deliberately will NOT fall back to the operator install at')
  console.error('  ~/.dsh — that would run an unpinned version. See')
  console.error('  arxa/docs/plans/dsh-isolation-from-operator-install.md')
  process.exit(127)
}
engineLog('dsh bin resolved: ' + dshBin)

// The design panel, brand and gen-ui plugins resolve by package name (their
// browser halves are discovered through package.json dsh.client, which a
// file-path entry never reaches).
const BY_NAME_PLUGINS = ['arxa-design-panel', 'arxa-brand', 'arxa-gen-ui', 'arxa-mcp-apps', 'arxa-waiting-page', 'arxa-theme-accent', 'arxa-pairing', 'arxa-sidebar', 'arxa-git-card', 'arxa-artifact-viewer', 'arxa-frame', 'arxa-locale', 'arxa-prism', 'arxa-provider-status']
// ALWAYS install, never skip on presence: these are file: dependencies, and
// pnpm copies them into .pnpm at add-time. A plain `pnpm install` sees the
// lockfile entry unchanged and keeps the OLD copy — measured 2026-08-25: the
// studio served an Aug-21 design panel (no selection handoff) three days
// after slice 7 landed in plugins/, and the two-tab compose proof could not
// pass until `pnpm install --force` refreshed the bytes. --force re-copies
// every file: plugin on boot (~160ms measured) — the only policy under which
// editing a plugin's source and relaunching arxa does what it visibly says.
// PACKED MODE (desktop sidecar): bin/packed.json is written only by
// scripts/pack-sidecar.mjs into the self-extracting sidecar payload — it never
// exists in a git checkout. End-user machines have no pnpm, and a payload's
// plugin dirs are immutable per release, so the pnpm --force freshness dance
// is pointless there: plain directory copies into the profile's node_modules
// give dsh the identical by-name resolution (the dsh plugins have zero npm
// runtime dependencies of their own — react is a peer the web app provides;
// arxa-file-org-shell reaches its five composed libraries by RELATIVE path,
// so those are copied below under their plugins/ directory names to keep
// `../../<lib>/lib/index.js` resolving inside node_modules).
// Relative-import targets of arxa-file-org-shell (directory names, not
// package names — see the header note above). Copied in BOTH modes:
// pnpm's virtual store isolates file: deps, so in checkout mode the
// profile symlink of arxa-file-org-shell cannot see the five via
// ../../<lib> unless they sit flat in the profile's node_modules.
// Measured live: a fresh checkout profile without them made
// importShell() fail and BOTH sidebar routes serve the stub (seam false,
// every action no-workspace) while the UI still rendered no-org — silent.
const fiveLibs = [
  ['workspace', resolve(here, '..', 'plugins', 'workspace')],
  ['workspace-index', resolve(here, '..', 'plugins', 'workspace-index')],
  ['git-workspace', resolve(here, '..', 'plugins', 'git-workspace')],
  ['account-mirror', resolve(here, '..', 'plugins', 'account-mirror')],
  ['cairn-rail', resolve(here, '..', 'plugins', 'cairn-rail')],
  // arxa-approvals probes 'arxa-push-doorbell' bare, then the relative
  // ../../push-doorbell/lib/index.js — both shapes need these two flat.
  ['arxa-approvals', approvalsDir],
  ['push-doorbell', pushDoorbellDir],
]
const nm = join(profileDir, 'node_modules')
if (packed) {
  // PROFILE_PLUGINS (above) is the single source for the plugin set; only the
  // relative-import libs are extra here. A plugin added to the profile is
  // therefore shipped by the sidecar automatically — the drift that killed the
  // 2026-09-03 build cannot recur by omission.
  const cp0 = Date.now()
  for (const [name, dir] of [...PROFILE_PLUGINS, ...fiveLibs]) {
    rmSync(join(nm, name), { recursive: true, force: true })
    cpSync(dir, join(nm, name), { recursive: true })
  }
  engineLog('profile plugins copied in ' + (Date.now() - cp0) + 'ms')
} else {
  const r = spawnSync('pnpm', ['install', '--force', '--dir', profileDir], { stdio: 'inherit' })
  if (r.error || r.status !== 0) {
    console.error('arxa: could not pnpm-install the profile — the design '
      + 'panel will not mount. Run: dsh plugin --profile arxa add '
      + `file:${designPanelDir}`)
  }
  // arxa-file-org-shell must be a REAL directory, not the pnpm symlink:
  // its ../../<lib> relative imports resolve against the parent node_modules
  // (where the fiveLibs copies sit), but the symlink targets the .pnpm
  // virtual store where they do not exist — importShell() then fails on
  // every fresh checkout home and both sidebar routes serve the stub
  // (measured live 2026-08-29: shell-unavailable / no-workspace, silent).
  rmSync(join(nm, 'arxa-file-org-shell'), { recursive: true, force: true })
  cpSync(fileOrgShellDir, join(nm, 'arxa-file-org-shell'), { recursive: true })
  for (const [name, dir] of fiveLibs) {
    rmSync(join(nm, name), { recursive: true, force: true })
    cpSync(dir, join(nm, name), { recursive: true })
  }
}

// Web mode answers as arxa.studio.localhost — baked in, zero sudo, zero
// moving parts: the OS resolver and browsers both send *.localhost to
// loopback natively (verified on macOS 2026-08-21), and the W3C
// secure-context spec treats http://*.localhost as a trustworthy origin, so
// no "Not Secure" chip and no loss of secure-context APIs (an earlier
// .local mDNS name drew the chip — .local is not on that allowlist).
// arxa.studio additionally works wherever it already resolves to loopback:
// an operator hosts line today; the product path is a public A 127.0.0.1
// record on the real domain (localtest.me-style) — zero-config for every
// install, no code change. The /api browser-trust fence accepts only
// declared authorities, so both names are declared (host:port for the real
// port, bare host for a port-80 forward). Trust args go last on the argv so
// the variadic flag can't swallow passthrough; an explicit --port in
// passthrough wins by dropping ours.
const ARXA_PORT = process.env.ARXA_PORT?.trim() || '7891'
const portArgs = passthrough.includes('--port') ? [] : ['--port', ARXA_PORT]
const trustArgs = headless
  ? []
  : [...portArgs, '--trusted-host',
    `arxa.studio.localhost:${ARXA_PORT}`, 'arxa.studio.localhost',
    `arxa.studio:${ARXA_PORT}`, 'arxa.studio']
if (!headless) console.log(`arxa studio: http://arxa.studio.localhost:${ARXA_PORT}`)

// The design panel subscribes to `arxa design serve`'s /__events stream for
// live reload, which is a CROSS-ORIGIN request — the panel is served from
// arxa.studio.localhost, the design server from 127.0.0.1. That server refuses
// unlisted origins (arxa arxa/lib/design_server/browser_trust.dart), so
// register ours in arxa's machine-wide allowlist instead of making every
// operator remember --trusted-origin on every serve. Idempotent, provenance in
// the file, plain text the operator can edit or delete.
//
// ONLY the .localhost name, never the bare `arxa.studio:PORT` the trust args
// also declare: .localhost is reserved to loopback (RFC 6761) so nobody can
// be served from it, while arxa.studio is a real public domain — trusting it
// would hand the design server's /__* endpoints to whoever answers that name.
if (!headless) {
  const i = passthrough.indexOf('--port')
  const eq = passthrough.find((a) => a.startsWith('--port='))
  const webPort = i >= 0 ? (passthrough[i + 1] ?? ARXA_PORT)
    : eq ? eq.slice(7)
      : ARXA_PORT
  const origin = `http://arxa.studio.localhost:${webPort}`
  const arxaHome = process.env.ARXA_HOME?.trim()
    ? resolve(process.env.ARXA_HOME)
    : join(homedir(), '.arxa')
  const file = join(arxaHome, 'trusted-origins')
  try {
    mkdirSync(arxaHome, { recursive: true })
    const existing = existsSync(file) ? readFileSync(file, 'utf8') : ''
    const already = existing.split('\n')
      .some((l) => l.split('#')[0].trim() === origin)
    if (!already) {
      const header = existing
        ? ''
        : '# Origins allowed to call an `arxa design serve` /__* endpoint\n'
          + '# cross-origin. One per line; # starts a comment.\n'
      const pad = existing && !existing.endsWith('\n') ? '\n' : ''
      writeFileSync(file, `${existing}${pad}${header}${origin}  # arxa studio\n`)
    }
  } catch {
    // A studio that cannot write here still runs; the panel loses live reload
    // and says so. Never block a boot on a convenience.
  }
}
// --import loads bin/loopback-localhost-patch.mjs before dsh: it widens the
// privileged-plane loopback classifier to *.localhost (RFC 6761) so the
// settings/models/plugins pages work under arxa.studio.localhost. Fail-loud
// on dep bumps — see that file.
const loaderArgs = ['--import', pathToFileURL(join(here, 'loopback-localhost-patch.mjs')).href]
// Inherited DSH_* vars are the PARENT session's identity (DSH_SESSION_ID,
// DSH_SESSION_JSONL, DSH_SHELL, DSH_WEB_URL — managed vars a harness shell
// exports), never arxa's. Strip every one of them; DSH_HOME is then set
// explicitly to arxa's own home and dsh derives the rest fresh.
const childEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('DSH_')))

// ---- workspace store preflight (2026-09-03) -------------------------------
// dsh validates the workspace domain at BOOT and every failure is a hard
// throw, so ONE duplicated session id means the engine never starts — and a
// product that will not start cannot offer a repair UI. That is not
// hypothetical: a legacy bare-leaf id claimed by two workspaces took this
// engine down and had to be fixed by hand-editing the user's JSON.
//
// dsh is a dependency, never a fork, so the validator stays untouched and the
// repair runs here instead — before the child is spawned. Loud, backed up,
// and conservative: nothing whose path still exists is ever deleted.
try {
  const { healWorkspaceStore } = await import(
    pathToFileURL(join(here, '..', 'plugins', 'workspace', 'lib', 'store-heal.js')).href)
  const storeFile = join(dshHome, 'storages', 'workspace.json')
  if (existsSync(storeFile)) {
    const { store, changes } = healWorkspaceStore(JSON.parse(readFileSync(storeFile, 'utf8')))
    if (changes.length > 0) {
      // Back up BEFORE writing: this is the user's session-to-workspace map,
      // and a wrong repair must stay undoable.
      const backup = storeFile + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-')
      copyFileSync(storeFile, backup)
      writeFileSync(storeFile, JSON.stringify(store, null, 2) + '\n')
      const lines = [
        'arxa: repaired the workspace store so dsh can boot (' + changes.length + ' change(s)):',
        ...changes.map((c) => '  - ' + c),
        '  backup: ' + backup,
      ]
      for (const l of lines) { console.error(l); engineLog(l) }
    }
  }
} catch (err) {
  // A store that cannot be read or healed is left exactly as it was; dsh will
  // report it itself. Never turn a repair attempt into a new failure mode.
  engineLog('arxa: workspace store preflight skipped — ' + (err?.message ?? err))
}

engineLog('spawning dsh')
// Packed: the child's stdout/stderr flow through this process so every line
// lands in engine.log with an ISO timestamp (2026-09-07). Handing the child
// the raw fd left everything after this point unclockable — the plugin
// apply, the listen, the resume — which is exactly the part worth timing.
const child = spawn(process.execPath, [...loaderArgs, dshBin, '--profile', 'arxa', ...passthrough, ...trustArgs], {
  stdio: packed ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  env: { ...childEnv, DSH_HOME: dshHome, PI_CODING_AGENT_DIR: piHome },
})
if (packed) {
  const relay = (stream) => {
    let rest = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      rest += chunk
      let i
      while ((i = rest.indexOf('\n')) !== -1) { engineLog(rest.slice(0, i)); rest = rest.slice(i + 1) }
    })
    stream.on('end', () => { if (rest !== '') engineLog(rest) })
  }
  relay(child.stdout)
  relay(child.stderr)
}
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1))
