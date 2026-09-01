// gen-locale — regenerate plugins/locale/lib/client.js (the WHOLE arxa-locale
// browser half) from the stock @deepseek-ai/dsh-client-locale lib/client.js
// (dsh 0.1.1-rc.2). The stock package stays byte-identical in node_modules as
// reference; hand-edits of the generated file are caught by the drift gate in
// plugins/locale/selftest.mjs.
//
// Deltas (docs/plans/dsh-plugin-ui-conformance.md, Phase 0 — grilled
// 2026-09-02): arxa studio ships English/Polish/French; zh is dropped.
//   1. identity: module id/tag arxa-locale; class prefix hVGvvW_ → aXa_loc_
//   2. LOCALE_IDS (the client-side copy) → ["en", "pl", "fr"]
//   3. common namespace: zh$1 dictionary REPLACED by pl$1 + fr$1 (en kept)
//   4. settings.locale namespace: zh → pl + fr ("language.title")
//   5. LOCALES frozen array → en/pl/fr (labels English/Polski/Français)
//   6. DOCUMENT_LANGUAGE → { en, pl, fr } (BCP 47 primaries — no script
//      ambiguity to disambiguate, unlike zh → zh-CN)
//   7. register() calls carry { en, pl, fr } for both namespaces
// Everything else — LocaleRuntime, lookup chain (active → en → common →
// key), FALLBACK_LOCALE "en", detectBrowserLocale (iterates LOCALES
// dynamically), the Language row, inject set, provide("locale") — is the
// stock contract kept whole, so every stock plugin injecting
// @deepseek-ai/dsh-client-locale works unchanged against this service face.
//
// rc-bump policy: a dsh bump is an explicit re-transform — update
// DSH_VERSION, refresh anchors if the stock shape moved, run this script,
// then the boot gate (Language row lists three locales) before committing.
//
// Usage: node scripts/gen-locale.mjs [--write]   (default: stdout)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const DSH_VERSION = '0.1.1-rc.2'
const stockPath = join(root, 'node_modules', '@deepseek-ai', 'dsh-client-locale', 'lib', 'client.js')
const outPath = join(root, 'plugins', 'locale', 'lib', 'client.js')
const T = (n) => '\t'.repeat(n)

/** Loud-anchor surgery: throw when the stock shape moved under us. */
function mustReplaceOnce(out, from, to, label) {
  const first = out.indexOf(from)
  if (first === -1) throw new Error(`gen-locale: anchor missing (${label}) — stock shape moved?`)
  if (out.indexOf(from, first + 1) !== -1) throw new Error(`gen-locale: anchor not unique (${label})`)
  return out.slice(0, first) + to + out.slice(first + from.length)
}

// ---- dictionaries ------------------------------------------------------------
// Key set = the stock en dictionary (en is the source of truth AND
// FALLBACK_LOCALE). Native-speaker review flagged as a pre-ship product gate
// (plan doc §Risks).
const plCommon = {
  'ok': 'OK',
  'cancel': 'Anuluj',
  'close': 'Zamknij',
  'copy': 'Kopiuj',
  'copied': 'Skopiowano',
  'retry': 'Ponów',
  'loading': 'Ładowanie…',
  'load.failed': 'Nie udało się załadować',
  'submit': 'Wyślij',
  'submitting': 'Wysyłanie…',
  'next': 'Dalej',
  'previous': 'Wstecz',
  'skip': 'Pomiń',
  'delete': 'Usuń',
  'edit': 'Edytuj',
  'save': 'Zapisz',
  'search': 'Szukaj',
  'more': 'Więcej',
  'collapse': 'Zwiń',
  'expand': 'Rozwiń',
  'back': 'Wróć',
  'unknown': 'Nieznany',
  'none': 'Brak',
  'truncated': 'Obcięto',
}
const frCommon = {
  'ok': 'OK',
  'cancel': 'Annuler',
  'close': 'Fermer',
  'copy': 'Copier',
  'copied': 'Copié',
  'retry': 'Réessayer',
  'loading': 'Chargement…',
  'load.failed': 'Échec du chargement',
  'submit': 'Envoyer',
  'submitting': 'Envoi…',
  'next': 'Suivant',
  'previous': 'Précédent',
  'skip': 'Ignorer',
  'delete': 'Supprimer',
  'edit': 'Modifier',
  'save': 'Enregistrer',
  'search': 'Rechercher',
  'more': 'Plus',
  'collapse': 'Réduire',
  'expand': 'Développer',
  'back': 'Retour',
  'unknown': 'Inconnu',
  'none': 'Aucun',
  'truncated': 'Tronqué',
}
/** Emit one dictionary const in the stock bundle's formatting. */
function dictConst(name, dict, comment) {
  const body = Object.entries(dict)
    .map(([k, v]) => `${T(3)}"${k}": "${v}"`)
    .join(',\n')
  return `${T(2)}${comment}\n${T(2)}const ${name} = {\n${body}\n${T(2)}};`
}

let out = readFileSync(stockPath, 'utf8')

// 0. drop sourcemap pointer
out = out.replace(/\/\/#[ ]sourceMappingURL=client\.js\.map\s*$/m, '')

// 1. identity renames
out = mustReplaceOnce(out, 'id: "@deepseek-ai/dsh-client-locale",', 'id: "arxa-locale",', 'module id')
out = out.replaceAll('hVGvvW_', 'aXa_loc_')
out = mustReplaceOnce(out, '"@deepseek-ai/dsh-client-locale/LanguageRow.module.css"', '"arxa-locale/LanguageRow.module.css"', 'css tag id')
out = mustReplaceOnce(out, 'tag.dataset.plugin = "@deepseek-ai/dsh-client-locale";', 'tag.dataset.plugin = "arxa-locale";', 'css dataset.plugin')

// 2. LOCALE_IDS (client-side copy of the durable id set)
out = mustReplaceOnce(out, 'const LOCALE_IDS = ["zh", "en"];', 'const LOCALE_IDS = ["en", "pl", "fr"];', 'LOCALE_IDS')

// 3. common namespace: zh$1 → pl$1 + fr$1 (the whole object literal, plus the
//    now-wrong zh comment lines around the splice)
out = mustReplaceOnce(out, '//#region lib/types/locales/zh.js', '//#region arxa: locales pl+fr (stock locales/zh.js — zh dropped)', 'zh region label')
{
  const startAnchor = '/** zh base dictionary for the common namespace: cross-feature standard words. */\n' + T(2) + 'const zh$1 = {'
  const si = out.indexOf(startAnchor)
  if (si === -1) throw new Error('gen-locale: zh$1 anchor missing — stock shape moved?')
  const ei = out.indexOf('\n' + T(2) + '};', si)
  if (ei === -1) throw new Error('gen-locale: zh$1 terminator missing — stock shape moved?')
  const replacement = [
    dictConst('pl$1', plCommon, '/** pl base dictionary for the common namespace, checked complete against the en key set. */'),
    ',\n',
    dictConst('fr$1', frCommon, '/** fr base dictionary for the common namespace, checked complete against the en key set. */'),
  ].join('')
  // Replace `const zh$1 = {` … `};` with two consts (drop the comma hack: write both fully)
  out = out.slice(0, si) + [
    dictConst('pl$1', plCommon, '/** pl base dictionary for the common namespace, checked complete against the en key set. */'),
    dictConst('fr$1', frCommon, '/** fr base dictionary for the common namespace, checked complete against the en key set. */'),
  ].join('\n') + out.slice(ei + ('\n' + T(2) + '};').length)
}

// 4. settings.locale namespace: zh → pl + fr
out = out.replaceAll('checked complete against the zh key set', 'checked complete against the en key set')
out = mustReplaceOnce(out,
  'const zh = { "language.title": "语言" };',
  'const pl = { "language.title": "Język" };\n' + T(2) + '/** French dictionary, checked complete against the en key set. */\n' + T(2) + 'const fr = { "language.title": "Langue" };',
  'settings locale dicts')

// 5. LOCALES frozen array
out = mustReplaceOnce(out,
  ['const LOCALES = Object.freeze([{', T(3) + 'id: "zh",', T(3) + 'label: "中文"', T(2) + '}, {', T(3) + 'id: "en",', T(3) + 'label: "English"', T(2) + '}]);'].join('\n'),
  ['const LOCALES = Object.freeze([{', T(3) + 'id: "en",', T(3) + 'label: "English"', T(2) + '}, {', T(3) + 'id: "pl",', T(3) + 'label: "Polski"', T(2) + '}, {', T(3) + 'id: "fr",', T(3) + 'label: "Français"', T(2) + '}]);'].join('\n'),
  'LOCALES array')

// 6. DOCUMENT_LANGUAGE
out = mustReplaceOnce(out,
  ['const DOCUMENT_LANGUAGE = {', T(3) + 'zh: "zh-CN",', T(3) + 'en: "en"', T(2) + '};'].join('\n'),
  ['const DOCUMENT_LANGUAGE = {', T(3) + 'en: "en",', T(3) + 'pl: "pl",', T(3) + 'fr: "fr"', T(2) + '};'].join('\n'),
  'DOCUMENT_LANGUAGE')

// 7. register() calls
out = mustReplaceOnce(out,
  ['locale.register(COMMON_NS, {', T(4) + 'zh: zh$1,', T(4) + 'en: en$1', T(3) + '});'].join('\n'),
  ['locale.register(COMMON_NS, {', T(4) + 'en: en$1,', T(4) + 'pl: pl$1,', T(4) + 'fr: fr$1', T(3) + '});'].join('\n'),
  'COMMON_NS registration')
out = mustReplaceOnce(out,
  ['locale.register(SETTINGS_NS, {', T(4) + 'zh,', T(4) + 'en', T(3) + '});'].join('\n'),
  ['locale.register(SETTINGS_NS, {', T(4) + 'en,', T(4) + 'pl,', T(4) + 'fr', T(3) + '});'].join('\n'),
  'SETTINGS_NS registration')

// 8. provenance header
out = `// Browser half of arxa-locale. GENERATED from
// @deepseek-ai/dsh-client-locale lib/client.js (dsh ${DSH_VERSION}) +
// scripts/gen-locale.mjs deltas — do not hand-edit: regenerate and let the
// selftest drift gate compare bytes. The stock LocaleRuntime, lookup chain,
// Language row, and service face are kept whole; the shipped languages are
// en/pl/fr (zh dropped — arxa studio's languages, grilled 2026-09-02). The
// original package stays untouched in node_modules as reference.
` + out

if (process.argv.includes('--write')) {
  writeFileSync(outPath, out)
  console.error('gen-locale: wrote ' + outPath)
} else {
  process.stdout.write(out)
}
