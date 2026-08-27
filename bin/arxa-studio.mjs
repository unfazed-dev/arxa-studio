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
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const template = join(here, '..', 'profile', 'cordis.patch.yml')

const args = process.argv.slice(2)
const headless = args.includes('--headless')
const passthrough = args.filter((a) => a !== '--headless')

const arxaHome = process.env.ARXA_HOME?.trim()
  ? resolve(process.env.ARXA_HOME)
  : join(homedir(), '.arxa')
const dshHome = process.env.DSH_HOME?.trim()
  ? resolve(process.env.DSH_HOME)
  : join(arxaHome, 'dsh')
const piHome = join(arxaHome, 'pi')
const profileDir = join(dshHome, 'profiles', 'arxa')

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
// Installed always, loaded only when the profile enables it (row 10 ships
// commented out — it needs a real MCP server to point at).
const mcpAppsDir = resolve(here, '..', 'plugins', 'mcp-apps')
const waitingPageDir = resolve(here, '..', 'plugins', 'waiting-page')
const themeAccentDir = resolve(here, '..', 'plugins', 'theme-accent')
const pairingDir = resolve(here, '..', 'plugins', 'pairing')
mkdirSync(profileDir, { recursive: true })
writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
  name: 'dsh-profile-arxa',
  private: true,
  dependencies: {
    'arxa-design-panel': `file:${designPanelDir}`,
    'arxa-brand': `file:${brandDir}`,
    'arxa-gen-ui': `file:${genUiDir}`,
    'arxa-mcp-apps': `file:${mcpAppsDir}`,
    'arxa-waiting-page': `file:${waitingPageDir}`,
    'arxa-theme-accent': `file:${themeAccentDir}`,
    'arxa-pairing': `file:${pairingDir}`,
  },
  dsh: { profile: { bundles } },
}, null, 2) + '\n')
writeFileSync(join(profileDir, 'cordis.patch.yml'), readFileSync(template))

// Seed once, then the operator owns it (the web Models/Settings pages write
// here). glm-5.3 effort max on the international CODING endpoint is the arxa
// default; `zai` is the same key against the general pay-per-token endpoint
// (pi-ai's catalog zai route secretly points at the coding endpoint, so the
// baseURL is explicit). Model auth resolution: inherited env WINS over the
// store (dsh-credentials-local), so `arxa credentials exec ZAI_API_KEY --
// arxa` works against an empty store.
const settingsFile = join(dshHome, 'settings.yaml')
if (!existsSync(settingsFile)) {
  writeFileSync(settingsFile, `llm-pi-ai:
  providers:
    zai:
      apiKeyEnv: ZAI_API_KEY
      baseURL: https://api.z.ai/api/paas/v4
      models:
        - id: glm-5.3
          name: GLM-5.3
          contextWindow: 1000000
          maxTokens: 131072
          input: [ text ]
          reasoningEfforts:
            off:
            high: high
            max: max
          compat:
            thinkingFormat: zai
            supportsReasoningEffort: true
        - id: glm-4.6v
          name: GLM-4.6V
          input: [ text, image ]
          contextWindow: 131072
    zai-coding-cn:
      apiKeyEnv: ZAI_API_KEY
      baseURL: https://api.z.ai/api/coding/paas/v4
      reasoning: max
      models:
        - id: glm-5.3
          name: GLM-5.3
          reasoning: true
          input: [ text ]
          contextWindow: 1000000
          maxTokens: 131072
          reasoningEfforts:
            off:
            high: high
            max: max
          thinkingLevelMap:
            minimal: null
            low: "low"
            medium: "low"
            high: "high"
            max: "max"
          compat:
            thinkingFormat: zai
            supportsReasoningEffort: true
            zaiToolStream: true
agent-default-model:
  # Wallet endpoint: glm-5.3 + effort max verified working 2026-08-21.
  # zai-coding-cn stays configured — flip here to burn plan quota instead
  # (weekly cap resets 2026-08-24 10:04).
  provider: zai
  model: glm-5.3
  reasoningEffort: max
agent-presets:
  default: code
permission:
  defaultPreset: danger-full-access
`)
}

// Seed the credential store from the operator's dsh install, once. A plain
// file copy — no value is ever read into a variable, printed, or logged.
const credFile = join(dshHome, '.credentials.yaml')
const operatorCreds = join(homedir(), '.dsh', '.credentials.yaml')
if (!existsSync(credFile) && existsSync(operatorCreds)) {
  try { copyFileSync(operatorCreds, credFile) } catch { /* env layer still works */ }
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
      'zai-wallet': {
        name: 'Z.ai general API (wallet)',
        baseUrl: 'https://api.z.ai/api/paas/v4',
        api: 'openai-completions',
        // Shelled at request time by pi itself; the value never lands in a file.
        apiKey: '!arxa credentials exec ZAI_API_KEY -- printenv ZAI_API_KEY',
        models: [
          // glm-5.3 + reasoning verified working on the wallet 2026-08-21.
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

// The design panel, brand and gen-ui plugins resolve by package name (their
// browser halves are discovered through package.json dsh.client, which a
// file-path entry never reaches).
const BY_NAME_PLUGINS = ['arxa-design-panel', 'arxa-brand', 'arxa-gen-ui', 'arxa-mcp-apps', 'arxa-waiting-page', 'arxa-theme-accent', 'arxa-pairing']
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
// give dsh the identical by-name resolution (all seven plugins have zero
// runtime dependencies of their own — react is a peer the web app provides).
const packed = existsSync(join(here, 'packed.json'))
if (packed) {
  const nm = join(profileDir, 'node_modules')
  for (const [name, dir] of [
    ['arxa-design-panel', designPanelDir],
    ['arxa-brand', brandDir],
    ['arxa-gen-ui', genUiDir],
    ['arxa-mcp-apps', mcpAppsDir],
    ['arxa-waiting-page', waitingPageDir],
    ['arxa-theme-accent', themeAccentDir],
    ['arxa-pairing', pairingDir],
  ]) {
    rmSync(join(nm, name), { recursive: true, force: true })
    cpSync(dir, join(nm, name), { recursive: true })
  }
} else {
  const r = spawnSync('pnpm', ['install', '--force', '--dir', profileDir], { stdio: 'inherit' })
  if (r.error || r.status !== 0) {
    console.error('arxa: could not pnpm-install the profile — the design '
      + 'panel will not mount. Run: dsh plugin --profile arxa add '
      + `file:${designPanelDir}`)
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
const ARXA_PORT = '7891'
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
const child = spawn(process.execPath, [...loaderArgs, dshBin, '--profile', 'arxa', ...passthrough, ...trustArgs], {
  stdio: 'inherit',
  env: { ...childEnv, DSH_HOME: dshHome, PI_CODING_AGENT_DIR: piHome },
})
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1))
