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
import { fileURLToPath } from 'node:url'
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
mkdirSync(profileDir, { recursive: true })
writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
  name: 'dsh-profile-arxa',
  private: true,
  dependencies: { 'arxa-design-panel': `file:${designPanelDir}` },
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
  provider: zai-coding-cn
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
          { id: 'glm-4.6v', name: 'GLM-4.6V', contextWindow: 131072, maxTokens: 8192 },
          { id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 1000000, maxTokens: 131072 },
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
  console.error('arxa: cannot find @deepseek-ai/dsh — npm install in arxa-harness, or install dsh')
  process.exit(127)
}

// The design panel resolves by package name (its browser half is discovered
// through package.json dsh.client, which a file-path entry never reaches).
if (!existsSync(join(profileDir, 'node_modules', 'arxa-design-panel'))) {
  const r = spawnSync('pnpm', ['install', '--dir', profileDir], { stdio: 'inherit' })
  if (r.error || r.status !== 0) {
    console.error('arxa: could not pnpm-install the profile — the design '
      + 'panel will not mount. Run: dsh plugin --profile arxa add '
      + `file:${designPanelDir}`)
  }
}

const child = spawn(process.execPath, [dshBin, '--profile', 'arxa', ...passthrough], {
  stdio: 'inherit',
  env: { ...process.env, DSH_HOME: dshHome, PI_CODING_AGENT_DIR: piHome },
})
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1))
