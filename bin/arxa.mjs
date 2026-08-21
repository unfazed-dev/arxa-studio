#!/usr/bin/env node
// arxa — boots dsh with the arxa profile (identity, repo-law-only
// instructions, appbox gate). A composition, never a fork: the profile is
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
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
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
mkdirSync(profileDir, { recursive: true })
writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
  name: 'dsh-profile-arxa',
  private: true,
  dependencies: {
    'arxa-design-panel': `file:${designPanelDir}`,
    'arxa-brand': `file:${brandDir}`,
    'arxa-gen-ui': `file:${genUiDir}`,
    'arxa-mcp-apps': `file:${mcpAppsDir}`,
  },
  dsh: { profile: { bundles } },
}, null, 2) + '\n')
writeFileSync(join(profileDir, 'cordis.patch.yml'), readFileSync(template))

// Seed once, then the operator owns it (the web Models/Settings pages write
// here). glm-5.3 effort max on the international CODING endpoint is the arxa
// default; `zai` is the same key against the general pay-per-token endpoint
// (pi-ai's catalog zai route secretly points at the coding endpoint, so the
// baseURL is explicit). Model auth resolution: inherited env WINS over the
// store (dsh-credentials-local), so `appbox credentials exec ZAI_API_KEY --
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
const appBoxDir = resolve(here, '..', '..', 'app-box')
for (const [link, target] of [
  [join(piExtensions, 'appbox-gate.ts'), join(appBoxDir, 'harness', 'pi', 'appbox-gate.ts')],
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
        apiKey: '!appbox credentials exec ZAI_API_KEY -- printenv ZAI_API_KEY',
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
// dsh's bin, resolved from arxa's own node_modules when installed, else the
// operator install this machine already carries (read-only reuse — arxa never
// writes there).
const candidates = [
  join(here, '..', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  join(homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
]
const dshBin = candidates.find(existsSync)
if (!dshBin) {
  console.error('arxa: cannot find @deepseek-ai/dsh — npm install in arxa-studio, or install dsh')
  process.exit(127)
}

// The design panel, brand and gen-ui plugins resolve by package name (their
// browser halves are discovered through package.json dsh.client, which a
// file-path entry never reaches).
const BY_NAME_PLUGINS = ['arxa-design-panel', 'arxa-brand', 'arxa-gen-ui', 'arxa-mcp-apps']
if (BY_NAME_PLUGINS.some((p) => !existsSync(join(profileDir, 'node_modules', p)))) {
  const r = spawnSync('pnpm', ['install', '--dir', profileDir], { stdio: 'inherit' })
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

// The design panel subscribes to `appbox design serve`'s /__events stream for
// live reload, which is a CROSS-ORIGIN request — the panel is served from
// arxa.studio.localhost, the design server from 127.0.0.1. That server refuses
// unlisted origins (app-box appboxd/lib/design_server/browser_trust.dart), so
// register ours in appbox's machine-wide allowlist instead of making every
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
  const appboxHome = process.env.APPBOX_HOME?.trim()
    ? resolve(process.env.APPBOX_HOME)
    : join(homedir(), '.appbox')
  const file = join(appboxHome, 'trusted-origins')
  try {
    mkdirSync(appboxHome, { recursive: true })
    const existing = existsSync(file) ? readFileSync(file, 'utf8') : ''
    const already = existing.split('\n')
      .some((l) => l.split('#')[0].trim() === origin)
    if (!already) {
      const header = existing
        ? ''
        : '# Origins allowed to call an `appbox design serve` /__* endpoint\n'
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
const child = spawn(process.execPath, [...loaderArgs, dshBin, '--profile', 'arxa', ...passthrough, ...trustArgs], {
  stdio: 'inherit',
  env: { ...process.env, DSH_HOME: dshHome, PI_CODING_AGENT_DIR: piHome },
})
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1))
