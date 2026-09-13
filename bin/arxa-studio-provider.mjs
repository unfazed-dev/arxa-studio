#!/usr/bin/env node
// arxa-studio provider/workspace/diagnose CLI (task 13 steps 7–8).
//
// THE canonical spellings, dispatched from bin/arxa-studio.mjs BEFORE normal
// studio boot (no dsh spawn, no pnpm, no profile writes):
//   arxa-studio workspace export --org <id> --out <dir>
//   arxa-studio workspace import <bundleDir> [--config <file>]
//   arxa-studio provider verify [--config <file>]
//   arxa-studio diagnose [--out <file>]
//
// `provider verify` prints EVERY conformance section and exits nonzero on any
// required red row. `diagnose` emits the redacted, user-inspectable bundle
// (versions, config shape, verify results, bounded error logs) with no
// tokens, secrets, or client records. All user-facing strings exist in
// en/pl/fr (T8 sweeps the whole surface; the three tables are here now).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pluginDir = join(here, '..', 'plugins', 'workspace-provider')

const { assertProviderConfig } = await import(join(pluginDir, 'lib', 'contract.js'))
const { LocalWorkspaceProvider } = await import(join(pluginDir, 'lib', 'local.js'))
const { GenericRestWorkspaceProvider } = await import(join(pluginDir, 'lib', 'generic-rest.js'))
const { runConformance } = await import(join(pluginDir, 'lib', 'conformance.js'))
const { exportBundle, importBundle } = await import(join(pluginDir, 'lib', 'export-bundle.js'))

// ---- locale (en/pl/fr through the arxa-locale world; env-selected in a CLI) --
const STRINGS = {
  en: {
    title: 'arxa studio workspace provider',
    usage: 'usage: arxa-studio workspace export --org <id> --out <dir> | workspace import <dir> [--config <file>] | provider verify [--config <file>] | diagnose [--out <file>]',
    verifyTitle: 'provider verify — every conformance section:',
    rowGreen: 'green  {id} — {detail}',
    rowRed: 'RED    {id} — {detail}',
    rowNa: 'n/a    {id} — {detail}',
    verifyOk: 'provider verify: all sections green',
    verifyFailed: 'provider verify: FAILED — red rows above',
    exportDone: 'exported org {org} to {out}',
    importDone: 'imported bundle {dir} as org {org} (id map written into the bundle)',
    diagnoseTitle: 'arxa-studio diagnose — user-inspectable bundle (redacted)',
    configShape: 'workspace backend config (shape only, values redacted): {shape}',
    errorLogs: 'bounded error log tail (last {n} lines, redacted):',
    noErrorLogs: 'no error logs found',
    unknownCommand: 'unknown command: {cmd}',
    configRejected: 'workspace backend config rejected: {why}',
    missingArg: 'missing required argument: {arg}',
    notSignedIn: 'provider verify needs an authenticated session for this provider (no credentials are ever accepted in config files)',
  },
  pl: {
    title: 'arxa studio — dostawca obszaru roboczego',
    usage: 'użycie: arxa-studio workspace export --org <id> --out <katalog> | workspace import <katalog> [--config <plik>] | provider verify [--config <plik>] | diagnose [--out <plik>]',
    verifyTitle: 'provider verify — wszystkie sekcje zgodności:',
    rowGreen: 'zielona {id} — {detail}',
    rowRed: 'CZERWONA {id} — {detail}',
    rowNa: 'nd.    {id} — {detail}',
    verifyOk: 'provider verify: wszystkie sekcje zielone',
    verifyFailed: 'provider verify: NIEPOWODZENIE — czerwone wiersze powyżej',
    exportDone: 'wyeksportowano organizację {org} do {out}',
    importDone: 'zaimportowano pakiet {dir} jako organizację {org} (mapa id zapisana w pakiecie)',
    diagnoseTitle: 'arxa-studio diagnose — pakiet do wglądu dla użytkownika (zanonimizowany)',
    configShape: 'konfiguracja backendu obszaru (tylko kształt, wartości ukryte): {shape}',
    errorLogs: 'ograniczony koniec logu błędów (ostatnie {n} linii, zanonimizowane):',
    noErrorLogs: 'nie znaleziono logów błędów',
    unknownCommand: 'nieznana komenda: {cmd}',
    configRejected: 'konfiguracja backendu odrzucona: {why}',
    missingArg: 'brak wymaganego argumentu: {arg}',
    notSignedIn: 'provider verify wymaga uwierzytelnionej sesji tego dostawcy (pliki konfiguracyjne nigdy nie przyjmują poświadczeń)',
  },
  fr: {
    title: 'arxa studio — fournisseur d’espace de travail',
    usage: 'usage : arxa-studio workspace export --org <id> --out <dossier> | workspace import <dossier> [--config <fichier>] | provider verify [--config <fichier>] | diagnose [--out <fichier>]',
    verifyTitle: 'provider verify — chaque section de conformité :',
    rowGreen: 'vert   {id} — {detail}',
    rowRed: 'ROUGE  {id} — {detail}',
    rowNa: 's.o.   {id} — {detail}',
    verifyOk: 'provider verify : toutes les sections au vert',
    verifyFailed: 'provider verify : ÉCHEC — lignes rouges ci-dessus',
    exportDone: 'organisation {org} exportée vers {out}',
    importDone: 'paquet {dir} importé comme organisation {org} (carte d’ids écrite dans le paquet)',
    diagnoseTitle: 'arxa-studio diagnose — paquet consultable (caviardé)',
    configShape: 'configuration du backend (forme seule, valeurs caviardées) : {shape}',
    errorLogs: 'fin bornée du journal d’erreurs ({n} dernières lignes, caviardées) :',
    noErrorLogs: 'aucun journal d’erreurs trouvé',
    unknownCommand: 'commande inconnue : {cmd}',
    configRejected: 'configuration du backend rejetée : {why}',
    missingArg: 'argument requis manquant : {arg}',
    notSignedIn: 'provider verify exige une session authentifiée pour ce fournisseur (aucun identifiant n’est jamais accepté dans les fichiers de configuration)',
  },
}
const locale = ['en', 'pl', 'fr'].includes(process.env.ARXA_LOCALE) ? process.env.ARXA_LOCALE : 'en'
const t = (key, vars = {}) => (STRINGS[locale][key] ?? STRINGS.en[key])
  .replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')

// ---- config + provider construction --------------------------------------
const arxaHome = () => {
  const h = process.env.ARXA_HOME?.trim()
  return h ? resolve(h) : join(homedir(), '.arxa')
}

/** Precedence: env (provider name only, D32) > --config file > user config. */
function loadBackend (args) {
  const i = args.indexOf('--config')
  const file = i >= 0 ? resolve(args[i + 1]) : join(arxaHome(), 'studio.json')
  let backend = {}
  if (existsSync(file)) {
    try { backend = JSON.parse(readFileSync(file, 'utf8')).workspaceBackend ?? {} } catch { backend = {} }
  }
  const envProvider = process.env.ARXA_WORKSPACE_PROVIDER?.trim()
  if (envProvider) backend = { ...backend, provider: envProvider }
  try { assertProviderConfig(backend) } catch (e) {
    console.error(t('configRejected', { why: e.message }))
    process.exit(2)
  }
  return backend
}

const resolveTilde = (p) => p.startsWith('~/') ? join(homedir(), p.slice(2)) : p

/** The CLI credential store: one opaque handle file under ARXA_HOME, 0600. */
function credentialStore () {
  const file = join(arxaHome(), 'workspace-credentials.json')
  const read = () => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return {} } }
  return {
    async get (k) { return read()[k] ?? null },
    async set (k, v) {
      const all = read(); all[k] = v
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(all), { mode: 0o600 })
    },
    async delete (k) { const all = read(); delete all[k]; writeFileSync(file, JSON.stringify(all), { mode: 0o600 }) },
  }
}

function buildProvider (backend) {
  if (backend.provider === 'generic-rest') {
    return new GenericRestWorkspaceProvider({
      baseUrl: backend['generic-rest']?.baseUrl,
      credentialStore: credentialStore(),
      fetch,
    })
  }
  // local (the default) and supabase-not-yet (task 14) both fall back to the
  // local store — local-first parity: nothing about the CLI needs a backend.
  const root = backend.local?.root ? resolveTilde(backend.local.root) : undefined
  return new LocalWorkspaceProvider(root ? { root } : {})
}

const flag = (args, name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

// ---- commands ---------------------------------------------------------------
async function providerVerify (args) {
  const backend = loadBackend(args)
  const provider = buildProvider(backend)
  const isLocal = !(provider instanceof GenericRestWorkspaceProvider)
  console.log(t('verifyTitle'))
  const report = await runConformance(provider, isLocal ? { localExempt: true } : {})
  for (const s of report.sections) {
    const template = s.status === 'green' ? 'rowGreen' : s.status === 'n/a' ? 'rowNa' : 'rowRed'
    for (const d of s.details.length ? s.details : ['']) console.log(t(template, { id: s.id, detail: d }))
  }
  if (report.ok) { console.log(t('verifyOk')); return 0 }
  console.log(t('verifyFailed'))
  return 1
}

async function workspaceExport (args) {
  const orgId = flag(args, '--org')
  const out = flag(args, '--out')
  if (!orgId) { console.error(t('missingArg', { arg: '--org <id>' })); return 2 }
  if (!out) { console.error(t('missingArg', { arg: '--out <dir>' })); return 2 }
  const provider = buildProvider(loadBackend(args))
  await exportBundle(provider, orgId, resolve(out))
  console.log(t('exportDone', { org: orgId, out: resolve(out) }))
  return 0
}

async function workspaceImport (args) {
  const dir = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'))
  if (!dir) { console.error(t('missingArg', { arg: '<bundleDir>' })); return 2 }
  const provider = buildProvider(loadBackend(args))
  const { orgId } = await importBundle(provider, resolve(dir))
  console.log(t('importDone', { dir: resolve(dir), org: orgId }))
  return 0
}

// Diagnose redaction: long opaque runs (tokens, JWTs, keys) never print.
const OPAQUE_RUN = /[A-Za-z0-9+/_=-]{20,}/g
const redactLine = (line) => line
  .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
  .replace(OPAQUE_RUN, (m) => (m.startsWith('line') ? m : '[redacted]'))

async function diagnose (args) {
  const backend = loadBackend(args)
  const provider = buildProvider(backend)
  const report = await runConformance(provider, backend.provider === 'local' || !backend.provider ? { localExempt: true } : {})
  const lines = [t('diagnoseTitle')]
  const pkg = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'))
  const node = process.version
  lines.push(`versions: node ${node}, arxa-workspace-provider ${pkg.version}, wire v${(await import(join(pluginDir, 'lib', 'contract.js'))).WIRE_VERSION}`)
  // Config SHAPE only — provider name plus section keys; values never print.
  const sections = Object.keys(backend).filter((k) => k !== 'provider')
  const shape = `provider: ${backend.provider ?? 'local'}` + (sections.length ? `, sections: ${sections.join(', ')}` : '')
  lines.push(t('configShape', { shape }))
  lines.push(t('verifyTitle'))
  for (const s of report.sections) {
    const template = s.status === 'green' ? 'rowGreen' : s.status === 'n/a' ? 'rowNa' : 'rowRed'
    for (const d of s.details.length ? s.details : ['']) lines.push(t(template, { id: s.id, detail: d }))
  }
  const logFile = join(arxaHome(), 'dsh', 'engine.log')
  if (existsSync(logFile)) {
    const tail = readFileSync(logFile, 'utf8').trim().split('\n').slice(-50)
    lines.push(t('errorLogs', { n: tail.length }))
    for (const l of tail) lines.push(redactLine(l))
  } else {
    lines.push(t('noErrorLogs'))
  }
  const text = lines.join('\n')
  const out = flag(args, '--out')
  if (out) { writeFileSync(resolve(out), text + '\n'); console.log(out) } else console.log(text)
  return report.ok ? 0 : 1
}

// ---- entry ------------------------------------------------------------------
export async function run (argv) {
  const [a, b, ...rest] = argv
  try {
    if (a === 'provider' && b === 'verify') return await providerVerify(rest)
    if (a === 'workspace' && b === 'export') return await workspaceExport(rest)
    if (a === 'workspace' && b === 'import') return await workspaceImport(rest)
    if (a === 'diagnose') return await diagnose(argv.slice(1)) // b is the first flag here, not a subcommand
  } catch (e) {
    console.error((e?.code ? e.code + ': ' : '') + (e?.message ?? e))
    return 1
  }
  console.error(t('unknownCommand', { cmd: [a, b].filter(Boolean).join(' ') }))
  console.error(t('usage'))
  return 2
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await run(process.argv.slice(2)))
}
