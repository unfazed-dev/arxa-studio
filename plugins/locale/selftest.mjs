#!/usr/bin/env node
// arxa-locale selftest — en/pl/fr locale-world gate
// (docs/plans/dsh-plugin-ui-conformance.md, Phase 0):
//   1. manifest shape (repo plugin convention: dsh.client.inject + lib/client.js
//      UI half, lib/index.js server half, zero runtime dependencies)
//   2. client.js parses + provenance header names the generator and dsh version
//   3. locale-world content: en/pl/fr aboard, zh gone from CODE, the stock
//      service face kept whole (provide("locale"), FALLBACK_LOCALE, lookup
//      chain, register calls, Language row)
//   4. drift gate: regenerate and byte-compare
//   5. stock dsh-client-locale byte-identical (content hash)
//   6. registration wired (bin/arxa-studio.mjs ×3 + profile/cordis.patch.yml:
//      stock locale row DISABLED, arxa-locale inserted — one locale world)
//   7. host half: namespace + en/pl/fr preference schema, zh gone
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..')
let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}

// ---- 1. manifest shape -------------------------------------------------------
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
check('manifest: name', pkg.name === 'arxa-locale')
check('manifest: server half', pkg.main === 'lib/index.js')
check('manifest: client half exported', pkg.exports?.['./client'] === './lib/client.js')
check('manifest: dsh.client.inject mirrors stock (connection/runtime/settings/remotes)',
  ['@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-api-remotes']
    .every((s) => pkg.dsh?.client?.inject?.includes(s)))
check('manifest: platform web', pkg.dsh?.client?.platform === 'web')
check('manifest: immediately (boot-critical, same as stock)', pkg.dsh?.client?.immediately === true)
check('manifest: zero runtime dependencies', !pkg.dependencies)

// ---- 2. client parses + provenance -------------------------------------------
const client = readFileSync(join(here, 'lib', 'client.js'), 'utf8')
let clientParseErr = ''
try { new vm.Script(client, { filename: 'lib/client.js' }) } catch (e) { clientParseErr = String(e) }
check('client.js parses (syntax error = unloadable locale)', !clientParseErr, clientParseErr)
check('headers: names its generator', client.includes('scripts/gen-locale.mjs'))
check('headers: names dsh version', client.includes('0.1.1-rc.2'))
check('headers: module id repainted', client.includes('id: "arxa-locale",') && !client.includes('id: "@deepseek-ai/dsh-client-locale",'))
check('headers: class prefix repainted', client.includes('aXa_loc_row') && !client.includes('hVGvvW_'))

// ---- 3. locale-world content ---------------------------------------------------
check('locales: LOCALE_IDS is en/pl/fr', client.includes('const LOCALE_IDS = ["en", "pl", "fr"];'))
check('locales: LOCALES array carries three labelled locales',
  client.includes('id: "en",') && client.includes('id: "pl",') && client.includes('id: "fr",')
  && client.includes('label: "Polski"') && client.includes('label: "Français"') && client.includes('label: "English"'))
check('locales: DOCUMENT_LANGUAGE covers en/pl/fr, zh-CN gone',
  client.includes('en: "en",') && client.includes('pl: "pl",') && client.includes('fr: "fr"') && !client.includes('zh-CN'))
check('locales: common namespace registers en/pl/fr dicts',
  client.includes('const pl$1 = {') && client.includes('const fr$1 = {')
  && /locale\.register\(COMMON_NS, \{\s*en: en\$1,\s*pl: pl\$1,\s*fr: fr\$1\s*\}\);/.test(client))
check('locales: settings namespace registers en/pl/fr',
  client.includes('"language.title": "Język"') && client.includes('"language.title": "Langue"') && client.includes('"language.title": "Language"'))
check('locales: common dicts complete (24 stock keys in each new language)',
  ['"ok"', '"cancel"', '"close"', '"copy"', '"copied"', '"retry"', '"loading"', '"load.failed"', '"submit"', '"submitting"', '"next"', '"previous"', '"skip"', '"delete"', '"edit"', '"save"', '"search"', '"more"', '"collapse"', '"expand"', '"back"', '"unknown"', '"none"', '"truncated"']
    .every((k) => client.includes(k + ': "')))
// No zh in CODE (comments may narrate the drop).
const zhCode = client.split('\n').filter((l) => /\bzh\b/.test(l) && !/^\s*(\/\/|\*)/.test(l) && !l.trimStart().startsWith('/*'))
check('locales: zh gone from code (comments may mention it)', zhCode.length === 0, zhCode.slice(0, 2).join(' | '))
check('face: service name unchanged (stock consumers keep working)', client.includes('ctx.provide("locale", locale);'))
check('face: FALLBACK_LOCALE stays en', client.includes('const FALLBACK_LOCALE = "en";'))
check('face: lookup chain intact (active → en fallback)',
  client.includes('locales?.get(this.snapshot.active)?.[key] ?? locales?.get("en")?.[key];'))
check('face: browser-locale detection iterates LOCALES (pl/fr resolve automatically)',
  client.includes('const match = LOCALES.find((locale) => locale.id === primary);'))
check('face: Language row still registered into settings.general.item',
  client.includes('ctx.slots.inject("settings.general.item"') && client.includes('id: "language",'))
check('face: inject set unchanged', client.includes('"settingsScope"') && client.includes('"connection"') && client.includes('"remote"'))

// ---- 4. drift gate -------------------------------------------------------------
{
  const rootDir = join(here, '..', '..')
  const r = spawnSync(process.execPath, [join(rootDir, 'scripts', 'gen-locale.mjs')], {
    cwd: rootDir, encoding: 'utf8', timeout: 60_000,
  })
  const regen = r.stdout ?? ''
  check('drift gate: client.js equals gen-locale regenerated',
    r.status === 0 && regen === client,
    r.status === 0 ? 'byte drift — regenerate, or fix scripts/gen-locale.mjs' : String(r.stderr).slice(0, 200))
}

// ---- 5. original dsh package byte-identical -------------------------------------
const hashPkg = (specifier, expected) => {
  const pkgDir = dirname(createRequire(import.meta.url).resolve(specifier + '/package.json'))
  const files = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const f = join(d, e.name)
      e.isDirectory() ? walk(f) : files.push(f)
    }
  }
  walk(pkgDir)
  const hash = createHash('sha256')
  for (const f of files) {
    hash.update(relative(pkgDir, f))
    hash.update('\0')
    hash.update(readFileSync(f))
    hash.update('\0')
  }
  const got = hash.digest('hex')
  return { ok: got === expected }
}
{
  const s = hashPkg('@deepseek-ai/dsh-client-locale', 'e2541abb614319292d6d3f21cb72d12658a2509b811bffc2d1a99ca1880d07f0')
  check('reference: dsh locale package byte-identical', s.ok, 'expected e2541abb…')
}

// ---- 6. registration wired -------------------------------------------------------
const bin = readFileSync(join(repo, 'bin', 'arxa-studio.mjs'), 'utf8')
check('registration: profile dependency', bin.includes("'arxa-locale': `file:${localeDir}`"))
check('registration: BY_NAME_PLUGINS', /BY_NAME_PLUGINS = \[[^\]]*'arxa-locale'/.test(bin))
check('registration: packed-mode copy list', bin.includes("['arxa-locale', localeDir]"))
const patch = readFileSync(join(repo, 'profile', 'cordis.patch.yml'), 'utf8')
check('registration: stock locale row disabled', /^- id: locale\n  disabled: true$/m.test(patch))
check('registration: arxa-locale inserted by package name', /^ {2}- id: arxa-locale\n {4}name: arxa-locale$/m.test(patch))

// ---- 7. host half ------------------------------------------------------------------
const host = readFileSync(join(here, 'lib', 'index.js'), 'utf8')
check('host: settings namespace "locale" registered', host.includes("settings.register('locale', LocaleSettingsSchema)"))
check('host: preference schema is en/pl/fr', host.includes("const LOCALE_IDS = ['en', 'pl', 'fr']") && host.includes('z.union([...LOCALE_IDS])'))
const hostCode = host.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
check('host: zh gone from code (comments may narrate)', !/["']zh["']/.test(hostCode))
check('host: no declared-import drift (engine-tree schemastery only)',
  host.includes("from '@deepseek-ai/schemastery'") && !host.includes("from '@deepseek-ai/dsh-settings'"))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
